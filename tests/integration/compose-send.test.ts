// covers SF-129 US1 scenarios 1–7, FR-002, FR-003, FR-006, FR-009, FR-010, FR-014, FR-020, SC-002: the email box's
// data (To filled with the first address of the person / the deal's main person), the send through the user's Gmail
// (From "<name> <address>", the CRM's Message-ID, the text as typed), stored at once and on the record's timeline
// (SF-127's EMAIL entry), sent once per box even when pressed twice, nothing left behind when Gmail fails.
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
const { emailBox, sendFromRecord } = await import("@/server/emails/compose");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const { makeDeal } = await import("./deal-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");
const actions = await import("@/app/(app)/records/email-actions");
const { readFlash } = await import("@/server/records/flash");
const { signInAs } = await import("./gmail-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  await signInAs(jar, w.ada);
  fake.requests.length = 0;
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const deal = () => ({ kind: "deal" as const, id: w.pilot });

describe("US1 scenarios 1–2: the box", () => {
  it("on a deal: To = the main person's first address, From = the user's Gmail, nothing else filled, a fresh send key", async () => {
    const box = (await emailBox(w.ada, deal()))!;
    expect(box).toMatchObject({ gmail: "ok", from: e.ADA, to: ["ana@example.test"], files: [], record: { kind: "deal", id: w.pilot, name: "Example Ltd – pilot" } });
    expect(box.sendKey).toMatch(/^[0-9a-f-]{36}$/);
    expect((await emailBox(w.ada, deal()))!.sendKey).not.toBe(box.sendKey);
  });
  it("on a person: their first address; on an organisation: To empty", async () => {
    expect((await emailBox(w.ada, { kind: "person", id: w.ana }))!.to).toEqual(["ana@example.test"]);
    expect((await emailBox(w.ada, { kind: "organisation", id: w.exampleLtd }))!.to).toEqual([]);
  });
  it("To empty: no main person, a main person with no address, a private main person the viewer cannot see", async () => {
    const none = await makeDeal({ title: "No person", stageId: w.stage, createdBy: w.ada });
    const noMail = await makePerson({ firstName: "Nomail", createdBy: w.ada });
    const withNoMail = await makeDeal({ title: "No mail", stageId: w.stage, createdBy: w.ada, personId: noMail });
    const pia = await makePerson({ firstName: "Pia", createdBy: w.bob, private: true, emails: ["pia@example.test"] });
    const withPia = await makeDeal({ title: "Pia's", stageId: w.stage, createdBy: w.ada, personId: pia });
    for (const id of [none, withNoMail, withPia]) expect((await emailBox(w.ada, { kind: "deal", id }))!.to).toEqual([]);
  });
  it("opens nothing on an archived or hidden record", async () => {
    await sql`update deals set archived_at = now() where id = ${w.pilot}`;
    expect(await emailBox(w.ada, deal())).toBeNull();
    const hidden = await makeDeal({ title: "Bob's private", stageId: w.stage, createdBy: w.bob, private: true });
    expect(await emailBox(w.ada, { kind: "deal", id: hidden })).toBeNull();
  });
});

describe("US1 scenarios 3–5: [ SEND ]", () => {
  it("sends from the user's Gmail, stores it at once, shows it on the deal's timeline", async () => {
    const r = await c.send(w.ada, deal());
    expect(r).toEqual({ status: "sent", notice: { name: "ana@example.test", count: 1 } });
    const [m] = fake.sentMessages(e.ADA);
    expect(m).toMatchObject({ from: `Ada Fake <${e.ADA}>`, to: "ana@example.test", cc: "", bcc: "", subject: "Next steps", text: "Hi Ana,\n\nHere is the plan." });
    expect(m.messageId).toMatch(/^<crm-[0-9a-f]{24}@barnacle\.ai>$/);
    const [row] = await c.messageRows();
    expect(row).toMatchObject({ direction: "sent", gmail_message_id: m.id, rfc_message_id: m.messageId, from_name: "Ada Fake", from_address: e.ADA, subject: "Next steps" });
    expect(row.linked_at).not.toBeNull();
    const [entry] = (await e.emailEntries(w.ada, { dealId: w.pilot }));
    expect(entry.email!.subject).toBe("Next steps");
    expect((await c.ledger())[0]).toMatchObject({ state: "sent", deal_id: w.pilot, message_id: row.id, gmail_message_id: m.id });
    // The upload endpoint, never the JSON send.
    expect(fake.requests.filter((x) => x.path.endsWith("/messages/send")).map((x) => x.path)).toEqual(["/upload/gmail/v1/users/me/messages/send"]);
  });
  it("To / Cc / Bcc changed: exactly those, and Ana (no longer in it) gets no link", async () => {
    const ben = "ben@example.test";
    await c.send(w.ada, deal(), { to: [ben], cc: ["cat@example.test"], bcc: ["dan@example.test"] });
    const [m] = fake.sentMessages(e.ADA);
    expect([m.to, m.cc, m.bcc]).toEqual([ben, "cat@example.test", "dan@example.test"]);
    expect((await e.emailEntries(w.ada, { personId: w.ana }))).toHaveLength(0);
    expect((await e.emailEntries(w.ada, { personId: w.ben }))).toHaveLength(1);
  });
  it("the text exactly as typed: accents, emoji, markup as text, a link", async () => {
    const text = "Bonjour Zoë,\n\n<b>prix</b> 🎉\nhttps://example.test";
    await c.send(w.ada, deal(), { text });
    expect(fake.sentMessages(e.ADA)[0].text).toBe(text);
    expect((await c.messageRows())[0].text_body).toBe(text);
  });
});

describe("FR-010: one email per box", () => {
  it("the same send key twice, and twice at once: one email, one row, one entry", async () => {
    const one = c.input(deal());
    expect((await sendFromRecord(w.ada, one)).status).toBe("sent");
    expect((await sendFromRecord(w.ada, one)).status).toBe("sent");
    const two = c.input(deal(), { subject: "Twice at once" });
    const both = await Promise.all([sendFromRecord(w.ada, two), sendFromRecord(w.ada, two)]);
    expect(both.map((x) => x.status)).toEqual(["sent", "sent"]);
    expect(fake.sentMessages(e.ADA)).toHaveLength(2);
    expect(await c.messageRows()).toHaveLength(2);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(2);
  });
});

describe("FR-009: Gmail fails", () => {
  it("compose_send_failed, nothing recorded, no ledger row; the same box then sends", async () => {
    const box = c.input(deal());
    fake.down();
    expect(await sendFromRecord(w.ada, box)).toEqual({ status: "refused", errors: [{ code: "compose_send_failed" }] });
    fake.down(false);
    expect(await c.messageRows()).toEqual([]);
    expect(await c.ledger()).toEqual([]);
    expect((await sendFromRecord(w.ada, box)).status).toBe("sent");
    expect(fake.sentMessages(e.ADA)).toHaveLength(1);
  });
});

describe("FR-020: nothing else changes", () => {
  it("the deal and its person keep their fields, consent and version; no notification", async () => {
    const before = await sql`select owner_id, stage_id, version, archived_at from deals where id = ${w.pilot}`;
    const consent = await sql`select consent from persons where id = ${w.ana}`;
    await c.send(w.ada, deal());
    expect(await sql`select owner_id, stage_id, version, archived_at from deals where id = ${w.pilot}`).toEqual(before);
    expect(await sql`select consent from persons where id = ${w.ana}`).toEqual(consent);
    expect((await sql`select count(*)::int as n from note_mentions`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from timeline_events`)[0].n).toBe(0);
  });
});

describe("the action sendEmailFromRecord", () => {
  it("sends, sets the flash 'Email sent to …' and answers the checked back address", async () => {
    const r = await actions.sendEmailFromRecord({ ...c.input(deal()), to: ["ana@example.test", "ben@example.test"], target: "deal", id: w.pilot, back: `/deals/${w.pilot}` });
    expect(r).toEqual({ status: "sent", back: `/deals/${w.pilot}` });
    expect(await readFlash(["email_sent"])).toEqual({ text: "Email sent to ana@example.test, ben@example.test." });
  });
  it("refuses a malformed input and an outside back address", async () => {
    expect(await actions.sendEmailFromRecord({ ...c.input(deal()), target: "lead", id: w.pilot, back: "/" })).toEqual({ status: "refused", errors: [{ code: "compose_send_failed" }] });
    const r = await actions.sendEmailFromRecord({ ...c.input(deal()), target: "deal", id: w.pilot, back: "https://evil.example/x" });
    expect(r).toEqual({ status: "sent", back: "/" });
  });
});
