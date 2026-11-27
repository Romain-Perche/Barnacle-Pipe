// covers SF-129 FR-014, FR-015, FR-016, Edge Case "The sync stored it first": storeMessage of a sent email runs SF-127's
// processing and completePendingSend, which adds the one hand link to the record written from and marks the ledger
// sent — also when the message was already stored, never twice, never for another connection's or a done ledger row.
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
const { sentMessage } = await import("@/server/emails/compose");
const { storeMessage } = await import("@/server/gmail/sync");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");

let w: Awaited<ReturnType<typeof e.world>>;
const RFC = "<crm-000000000000000000000001@barnacle.ai>";

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  w = await e.world(installGmailFake(), jar);
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

async function pending(o: { connectionId?: number; dealId?: number | null; state?: string; gmailId?: string | null; rfc?: string } = {}) {
  await sql`
    insert into email_sends (user_id, send_key, connection_id, deal_id, rfc_message_id, gmail_message_id, state)
    values (${w.ada}, gen_random_uuid(), ${o.connectionId ?? w.adaConn}, ${o.dealId === undefined ? w.pilot : o.dealId}, ${o.rfc ?? RFC},
            ${o.gmailId === undefined ? "g-1" : o.gmailId}, ${o.state ?? "sending"})`;
}
const message = (o: { gmailId?: string; rfc?: string } = {}) =>
  sentMessage({
    gmailMessageId: o.gmailId ?? "g-1", gmailThreadId: "t-1", rfcMessageId: o.rfc ?? RFC, from: { email: e.ADA, name: "Ada Fake" },
    to: ["ben@example.test"], cc: [], bcc: [], subject: "Next steps", text: "Hi", attachments: [{ name: "a.pdf", contentType: "application/pdf", size: 3 }], now: new Date(),
  });

describe("storeMessage + completePendingSend", () => {
  it("stores, processes (SF-127) and adds the hand link to the deal; the ledger sent", async () => {
    await pending();
    expect(await storeMessage(w.adaConn, message())).toBe(true);
    const [m] = await c.messageRows();
    expect(m).toMatchObject({ direction: "sent", from_name: "Ada Fake", rfc_message_id: RFC });
    expect(m.linked_at).not.toBeNull();
    expect(await c.handLinks()).toEqual([{ deal_id: w.pilot, person_id: null, organisation_id: null, changed_by: w.ada, removed: false }]);
    expect((await sql`select count(*)::int as n from email_links where how = 'auto' and person_id = ${w.ben}`)[0].n).toBe(1);
    expect((await c.ledger())[0]).toMatchObject({ state: "sent", message_id: m.id });
    expect((await sql`select name, content_type, size::int as size from email_attachments`)).toEqual([{ name: "a.pdf", content_type: "application/pdf", size: 3 }]);
  });
  it("a second store of the same message: false, still one message and one deal link", async () => {
    await pending();
    await storeMessage(w.adaConn, message());
    expect(await storeMessage(w.adaConn, message())).toBe(false);
    expect(await c.messageRows()).toHaveLength(1);
    expect(await c.handLinks()).toHaveLength(1);
  });
  it("stored first with no ledger match (as the sync), the ledger row found later: the hand link is added", async () => {
    await storeMessage(w.adaConn, message());
    expect(await c.handLinks()).toEqual([]);
    await pending({ gmailId: null });
    expect(await storeMessage(w.adaConn, message())).toBe(false);
    expect(await c.handLinks()).toHaveLength(1);
    expect((await c.ledger())[0].state).toBe("sent");
  });
  it("the record deleted before storing: stored and processed, no hand link, the ledger sent", async () => {
    await pending();
    await sql`delete from deals where id = ${w.pilot}`;
    await storeMessage(w.adaConn, message());
    expect(await c.handLinks()).toEqual([]);
    expect((await c.ledger())[0]).toMatchObject({ state: "sent", deal_id: null });
  });
  it("another connection's ledger row, or one already sent, is not touched", async () => {
    await pending({ connectionId: w.bobConn });
    await pending({ state: "sent", rfc: "<crm-other@barnacle.ai>", gmailId: "g-1" });
    await storeMessage(w.adaConn, message());
    expect(await c.handLinks()).toEqual([]);
    expect((await c.ledger()).map((x) => x.state)).toEqual(["sending", "sent"]);
    expect((await c.ledger()).map((x) => x.message_id)).toEqual([null, null]);
  });
});
