// covers SF-130 FR-016, edge case "Sent but the CRM could not record it", research.md §1 (T029, T031): when the send
// path cannot store a reply or forward, the Gmail sync stores it in the answered email's conversation, once; a forward
// to an outside address in a new Gmail thread is still copied (its ledger row is pending); the sync storing first,
// before the send path saved the Gmail ids, matches on the CRM's Message-ID.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/deals/1" }),
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

const { closeDb } = await import("@/server/db");
const { onRecordSentForTests } = await import("@/server/emails/compose");
const { syncConnection } = await import("@/server/gmail/sync");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");
const r = await import("./reply-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
});
afterEach(() => onRecordSentForTests(null));
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const rowOf = async (gmailId: string) => (await c.messageRows()).filter((m) => m.gmail_message_id === gmailId);

describe("storing fails after Gmail accepted it", () => {
  it("a reply from a colleague's conversation: 'sent', then the sync stores it in the same conversation, once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    onRecordSentForTests(async () => {
      throw new Error("the database went away");
    });
    expect((await r.reply(w.bob, pricing.id)).status).toBe("sent");
    onRecordSentForTests(null);
    await afterResponseSettled();
    expect(await syncConnection(w.bobConn)).toEqual({ copied: 0 });
    const [m] = fake.sentMessages(e.BOB);
    const rows = await rowOf(m.id);
    expect(rows).toHaveLength(1);
    expect(await r.conversationOf(rows[0].id)).toBe(pricing.conversation_id);
    expect(await e.conversationIds()).toEqual([pricing.conversation_id]);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(2);
    expect((await r.sends())[0]).toMatchObject({ state: "sent", reply_message_id: pricing.id, message_id: rows[0].id });
  });
  it("a forward to ed@example.test (no CRM address, a new Gmail thread) is still copied, into the same conversation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    onRecordSentForTests(async () => {
      throw new Error("the database went away");
    });
    expect((await r.reply(w.bob, pricing.id, { mode: "forward", to: ["ed@example.test"], subject: "Fwd: Pricing" })).status).toBe("sent");
    onRecordSentForTests(null);
    await afterResponseSettled();
    await syncConnection(w.bobConn);
    const [m] = fake.sentMessages(e.BOB);
    const rows = await rowOf(m.id);
    expect(rows).toHaveLength(1);
    expect(await r.conversationOf(rows[0].id)).toBe(pricing.conversation_id);
    expect((await r.sends())[0].state).toBe("sent");
  });
});

describe("T031: the sync stores it first", () => {
  it("before the send path saved the Gmail ids: matched on the Message-ID, same conversation, one row", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    let copiedFirst = -1;
    onRecordSentForTests(async () => {
      const got = await syncConnection(w.bobConn);
      copiedFirst = "copied" in got ? got.copied : -1;
    });
    expect((await r.reply(w.bob, pricing.id)).status).toBe("sent");
    expect(copiedFirst).toBe(1);
    const [m] = fake.sentMessages(e.BOB);
    const rows = await rowOf(m.id);
    expect(rows).toHaveLength(1);
    expect(await r.conversationOf(rows[0].id)).toBe(pricing.conversation_id);
    expect(await e.conversationIds()).toEqual([pricing.conversation_id]);
    expect((await r.sends())[0]).toMatchObject({ state: "sent", message_id: rows[0].id });
  });
});
