// covers SF-127 FR-006, FR-012, US2 scenarios 3-4, US5 scenario 2, edge case "Mailbox owner deactivated or
// disconnected": GET /emails/attachments/<id>/download fetches the bytes from Gmail through a working mailbox holding
// the email (its own first, then a teammate's copy) and answers them as a download; with none it goes back to the
// conversation with the notice; a hidden or missing attachment is the same empty 404.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/emails" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
}));

const { closeDb, sql } = await import("@/server/db");
const { disconnect } = await import("@/server/gmail/connections");
const { GET: download } = await import("@/app/(app)/emails/attachments/[id]/download/route");
const { installGmailFake } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");
const e = await import("./email-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
const AT = new Date("2026-11-25T14:05:00Z");
const PDF = new TextEncoder().encode("%PDF-1.4 fake figures\n%%EOF\n");

beforeEach(async () => {
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function get(userId: number, id: number | string) {
  await h.signInAs(jar, userId);
  return download(new Request(`http://localhost/emails/attachments/${id}/download`), { params: Promise.resolve({ id: String(id) }) });
}
const attachment = async (name = "figures.pdf") => {
  const [a] = await sql<{ id: number; message_id: number; conversation_id: number }[]>`
    select a.id::int as id, a.message_id::int as message_id, t.conversation_id::int as conversation_id
    from email_attachments a join email_messages m on m.id = a.message_id join email_threads t on t.id = m.thread_id
    where a.name = ${name} order by a.id limit 1`;
  return a;
};
const send = (mailbox: string, o: { inline?: boolean; messageId?: string; to?: string } = {}) =>
  fake.addMessage(mailbox, {
    from: `"Ana Example" <ana@example.test>`, to: o.to ?? mailbox, subject: "Proposal", text: "See attached", internalDate: AT, messageId: o.messageId,
    attachments: [{ name: "figures.pdf", size: PDF.length, type: "application/pdf", data: PDF, inline: o.inline }],
  });
const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());

describe("US2: attachments fetched from Gmail", () => {
  it("scenario 3: the bytes from Gmail as a download named figures.pdf, never shown as a page", async () => {
    send(e.ADA);
    await e.sync(w.adaConn);
    const a = await attachment();
    const res = await get(w.bob, a.id);
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual(PDF);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="figures.pdf"; filename*=UTF-8''figures.pdf`);
    expect(res.headers.get("content-length")).toBe(String(PDF.length));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("an inline small part is served from messages.get, with no attachments.get call", async () => {
    send(e.ADA, { inline: true });
    await e.sync(w.adaConn);
    const calls: string[] = [];
    const real = fake.fetch;
    fake.fetch = async (req: Request) => (calls.push(new URL(req.url).pathname), real(req));
    try {
      const res = await get(w.bob, (await attachment()).id);
      expect(res.status).toBe(200);
      expect(await bytesOf(res)).toEqual(PDF);
    } finally {
      fake.fetch = real;
    }
    expect(calls.some((p) => p.includes("/attachments/"))).toBe(false);
    expect(calls.some((p) => /\/messages\/[^/]+$/.test(p))).toBe(true);
  });

  describe("scenario 4: no working mailbox → back to the conversation with the notice", () => {
    const unavailable = async (userId: number) => {
      const a = await attachment();
      const res = await get(userId, a.id);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`/emails/${a.conversation_id}?notice=attachment-unavailable#email-${a.message_id}`);
      expect(res.headers.get("cache-control")).toBe("no-store");
    };
    beforeEach(async () => {
      send(e.ADA);
      await e.sync(w.adaConn);
    });
    it("the mailbox is disconnected", async () => {
      await disconnect(w.ada);
      await unavailable(w.bob);
    });
    it("the mailbox needs reconnecting", async () => {
      await sql`update gmail_connections set state = 'needs_reconnect' where id = ${w.adaConn}`;
      await unavailable(w.bob);
    });
    it("its owner is deactivated", async () => {
      await sql`update users set status = 'deactivated' where id = ${w.ada}`;
      await unavailable(w.bob);
    });
    it("Gmail cannot be reached", async () => {
      fake.down();
      await unavailable(w.bob);
      fake.down(false);
    });
    it("Gmail no longer has the message", async () => {
      const [m] = await sql<{ id: string }[]>`select gmail_message_id as id from email_messages`;
      fake.deleteMessage(e.ADA, m.id);
      await unavailable(w.bob);
    });
    it("Google refuses the key: that mailbox needs reconnecting", async () => {
      fake.refuseKey(e.ADA);
      await unavailable(w.bob);
      expect((await h.connectionOf(w.ada))!.state).toBe("needs_reconnect");
    });
  });

  it("scenario 4: the same email also in Bob's working mailbox → fetched through Bob's", async () => {
    const messageId = "<shared@example.test>";
    send(e.ADA, { messageId, to: `${e.ADA}, ${e.BOB}` });
    send(e.BOB, { messageId, to: `${e.ADA}, ${e.BOB}` });
    await e.sync(w.adaConn);
    await e.sync(w.bobConn);
    await sql`update gmail_connections set state = 'needs_reconnect' where id = ${w.adaConn}`;
    const res = await get(w.ada, (await attachment()).id);
    expect(res.status).toBe(200);
    expect(await bytesOf(res)).toEqual(PDF);
  });
});

describe("hidden or missing → the same empty 404", () => {
  it("a conversation with a private person is 404 for Bob, with nothing about it; Ada downloads it", async () => {
    await makePerson({ firstName: "Pia", lastName: "Private", createdBy: w.ada, private: true, emails: ["pia@example.test"] });
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, cc: "pia@example.test", subject: "Secret plan", text: "x", internalDate: AT, attachments: [{ name: "secret.pdf", size: 3, data: "abc" }] });
    await e.sync(w.adaConn);
    const a = await attachment("secret.pdf");
    const hidden = await get(w.bob, a.id);
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe("");
    const missing = await get(w.bob, a.id + 1000);
    expect(missing.status).toBe(404);
    expect((await get(w.bob, "x")).status).toBe(404);
    expect((await get(w.ada, a.id)).status).toBe(200);
  });
});
