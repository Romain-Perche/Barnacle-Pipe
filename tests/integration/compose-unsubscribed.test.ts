// covers SF-129 US5 scenarios 1–2, FR-007: consent never blocks nor changes an email written by hand.
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
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const { makeDeal } = await import("./deal-helpers");
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
  fake.requests.length = 0;
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const deal = () => ({ kind: "deal" as const, id: w.pilot });
const nothingSent = async () => {
  expect(fake.sentMessages(e.ADA)).toEqual([]);
  expect(await c.ledger()).toEqual([]);
  expect(await c.messageRows()).toEqual([]);
};

describe("an Unsubscribed person", () => {
  it("is filled in To, written to, stays unsubscribed, and the email is on their timeline", async () => {
    await sql`update persons set consent = 'unsubscribed' where id = ${w.ana}`;
    const { emailBox } = await import("@/server/emails/compose");
    expect((await emailBox(w.ada, { kind: "person", id: w.ana }))!.to).toEqual(["ana@example.test"]);
    expect((await c.send(w.ada, { kind: "person", id: w.ana })).status).toBe("sent");
    expect((await sql`select consent from persons where id = ${w.ana}`)[0].consent).toBe("unsubscribed");
    expect((await sql`select count(*)::int as n from timeline_events where kind = 'consent_changed'`)[0].n).toBe(0);
    expect(await e.emailEntries(w.ada, { personId: w.ana })).toHaveLength(1);
  });
});
