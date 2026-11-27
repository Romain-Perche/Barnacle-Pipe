// covers SF-129 US2 scenario 5, FR-016, SC-003, Edge Case "Sent but the CRM could not record it": the Gmail sync
// finds the sent email by its Gmail id and neither shows nor counts it twice; a sync that stores it first still leaves
// the hand link; when storing fails after Gmail accepted it, the user is told it was sent and the sync records it.
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

const { closeDb, sql } = await import("@/server/db");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { onRecordSentForTests } = await import("@/server/emails/compose");
const { syncConnection } = await import("@/server/gmail/sync");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");
const h = await import("./gmail-helpers");

let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  w = await e.world(installGmailFake(), jar);
});
afterEach(() => onRecordSentForTests(null));
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const deal = () => ({ kind: "deal" as const, id: w.pilot });
const onceEach = async () => {
  for (const t of [{ dealId: w.pilot }, { personId: w.ana }]) expect(await e.emailEntries(w.ada, t)).toHaveLength(1);
};

describe("the sync after a send", () => {
  it("one entry, one row, the Settings count + 1 only", async () => {
    await c.send(w.ada, deal());
    expect(await h.conversations(w.ada)).toBe(1);
    await e.sync(w.adaConn);
    await e.sync(w.adaConn);
    await onceEach();
    expect(await c.messageRows()).toHaveLength(1);
    expect(await h.conversations(w.ada)).toBe(1);
  });
  it("the sync stores it first: still one entry, and the hand link", async () => {
    onRecordSentForTests(async () => {
      await e.sync(w.adaConn);
    });
    expect((await c.send(w.ada, deal(), { to: ["ben@example.test"] })).status).toBe("sent");
    expect(await c.messageRows()).toHaveLength(1);
    expect(await c.handLinks()).toEqual([expect.objectContaining({ deal_id: w.pilot, changed_by: w.ada })]);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(1);
    expect((await c.ledger())[0].state).toBe("sent");
  });
  it("storing fails after Gmail accepted it: 'sent', then the sync records it with the hand link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = Date.now();
    onRecordSentForTests(async () => {
      throw new Error("the database went away");
    });
    expect((await c.send(w.ada, deal())).status).toBe("sent");
    onRecordSentForTests(null);
    await afterResponseSettled();
    // The send path started the sync itself (runAfterResponse): it already copied the email; another run copies nothing.
    expect(await syncConnection(w.adaConn)).toEqual({ copied: 0 });
    await onceEach();
    expect((await c.ledger())[0].state).toBe("sent");
    expect((await e.lastContacted(w.ana))!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The deal is Ana's one open deal: SF-127 links it too, and the hand link adds no second row (on conflict do nothing).
    expect(await sql`select removed from email_links where deal_id = ${w.pilot}`).toEqual([{ removed: false }]);
  });
});
