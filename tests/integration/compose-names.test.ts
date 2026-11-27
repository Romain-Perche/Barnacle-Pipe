// covers SF-129 US2 scenario 1, Edge case 8 (fix round 1): recipients are named as the sender's visible CRM people, in
// the email's headers and in the stored copy, so the EMAIL entry reads "Ada Fake → Ana Example · Cc Ben Example".
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const { closeDb, sql } = await import("@/server/db");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { recipientsLine } = await import("@/server/emails/rules");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");

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
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const stored = async () =>
  (await sql<{ to_list: unknown; cc_list: unknown; bcc_list: unknown }[]>`select to_list, cc_list, bcc_list from email_messages order by id`)[0];

describe("recipient names", () => {
  it("named from the sender's visible people in the headers, the stored copy and the entry; others bare", async () => {
    const r = await c.send(w.ada, { kind: "deal", id: w.pilot }, { cc: ["BEN@example.test"], bcc: ["stranger@nowhere.test"] });
    expect(r.status).toBe("sent");
    const [m] = fake.sentMessages(e.ADA);
    expect(m.to).toBe("Ana Example <ana@example.test>");
    expect(m.cc).toBe("Ben Example <BEN@example.test>");
    expect(m.bcc).toBe("stranger@nowhere.test");
    expect(await stored()).toEqual({
      to_list: [{ email: "ana@example.test", name: "Ana Example" }],
      cc_list: [{ email: "BEN@example.test", name: "Ben Example" }],
      bcc_list: [{ email: "stranger@nowhere.test", name: null }],
    });
    const [entry] = await e.emailEntries(w.ada, { dealId: w.pilot });
    expect(recipientsLine(entry.email!)).toBe("Ada Fake → Ana Example · Cc Ben Example · Bcc stranger@nowhere.test");
  });
  it("another user's private person is never named", async () => {
    await makePerson({ firstName: "Pia", lastName: "Private", createdBy: w.bob, private: true, emails: ["pia@example.test"] });
    await c.send(w.ada, { kind: "deal", id: w.pilot }, { cc: ["pia@example.test"] });
    expect(fake.sentMessages(e.ADA)[0].cc).toBe("pia@example.test");
    expect((await stored()).cc_list).toEqual([{ email: "pia@example.test", name: null }]);
  });
  it("one person's two addresses in To and Cc: named twice, one entry on her page", async () => {
    await c.send(w.ada, { kind: "deal", id: w.pilot }, { to: ["ana@example.test"], cc: ["ana.example@mail.test"] });
    const entries = await e.emailEntries(w.ada, { personId: w.ana });
    expect(entries).toHaveLength(1);
    expect(recipientsLine(entries[0].email!)).toBe("Ada Fake → Ana Example · Cc Ana Example");
  });
  it("a non-ASCII name goes into the header as RFC 2047 and is stored as it is; the address matched ignoring case", async () => {
    await makePerson({ firstName: "Zoë", lastName: "Fake", createdBy: w.ada, emails: ["zoe@example.test"], archived: true });
    await c.send(w.ada, { kind: "deal", id: w.pilot }, { to: ["ZOE@example.test"] });
    const [m] = fake.sentMessages(e.ADA);
    expect(m.to).toBe(`=?UTF-8?B?${Buffer.from("Zoë Fake").toString("base64")}?= <ZOE@example.test>`);
    expect((await stored()).to_list).toEqual([{ email: "ZOE@example.test", name: "Zoë Fake" }]);
  });
});
