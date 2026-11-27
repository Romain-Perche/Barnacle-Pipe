// covers SF-129 US2 scenarios 1–4, 6–8, FR-015, FR-017, FR-018, FR-019, Edge Cases "One CRM person with two
// addresses", "Deactivated sender", "Written from an archived-later or deleted record": the sent email is one EMAIL
// entry on the record written from (hand link) and on every record SF-127 links, hidden by visibleConversation().
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
const { getConversation, unlinkRecord } = await import("@/server/emails/conversations");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");

let w: Awaited<ReturnType<typeof e.world>>;

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

const count = async (viewer: number, target: Parameters<typeof e.emailEntries>[1]) => (await e.emailEntries(viewer, target)).length;
const deal = () => ({ kind: "deal" as const, id: w.pilot });

describe("where the sent email shows", () => {
  it("from the deal to Ana (To) and Ben (Cc): once on the deal, Ana and Ben; the conversation lists them", async () => {
    await c.send(w.ada, deal(), { cc: ["ben@example.test"] });
    for (const t of [{ dealId: w.pilot }, { personId: w.ana }, { personId: w.ben }]) expect(await count(w.ada, t)).toBe(1);
    const [conv] = await e.conversationIds();
    const links = (await getConversation(w.ada, conv))!.links.map((l) => `${l.kind}-${l.recordId}`);
    expect(links).toEqual(expect.arrayContaining([`deal-${w.pilot}`, `person-${w.ana}`, `person-${w.ben}`]));
  });
  it("from Ana's page: on Ana, her organisation and her one open deal", async () => {
    await c.send(w.ada, { kind: "person", id: w.ana });
    for (const t of [{ personId: w.ana }, { organisationId: w.exampleLtd }, { dealId: w.pilot }]) expect(await count(w.ada, t)).toBe(1);
    // Ana is in the email, so SF-127 already linked her; the hand link (on conflict do nothing) adds no second row.
    expect((await sql`select count(*)::int as n from email_links where person_id = ${w.ana}`)[0].n).toBe(1);
  });
  it("from an organisation to Ana: once on the organisation, once on Ana", async () => {
    await c.send(w.ada, { kind: "organisation", id: w.exampleLtd });
    expect(await count(w.ada, { organisationId: w.exampleLtd })).toBe(1);
    expect(await count(w.ada, { personId: w.ana })).toBe(1);
  });
  it("to an address of no CRM person: only the hand link, no person made", async () => {
    const people = (await sql`select count(*)::int as n from persons`)[0].n;
    await c.send(w.ada, deal(), { to: ["nobody@example.test"] });
    expect(await sql`select how from email_links`).toEqual([{ how: "manual" }]);
    expect((await sql`select count(*)::int as n from persons`)[0].n).toBe(people);
  });
  it("Ana's two addresses in To and Cc: one entry on Ana", async () => {
    await c.send(w.ada, deal(), { to: ["ana@example.test"], cc: ["ana.example@mail.test"] });
    expect(await count(w.ada, { personId: w.ana })).toBe(1);
  });
  it("a private recipient the teammate cannot see: on no timeline for that teammate", async () => {
    await makePerson({ firstName: "Pia", createdBy: w.ada, private: true, emails: ["pia@example.test"] });
    await c.send(w.ada, deal(), { cc: ["pia@example.test"] });
    expect(await count(w.ada, { dealId: w.pilot })).toBe(1);
    expect(await count(w.bob, { dealId: w.pilot })).toBe(0);
    expect(await count(w.bob, { personId: w.ana })).toBe(0);
  });
});

describe("Last contacted", () => {
  it("raised to the send time for the people in the email, never lowered; the person written from but not in it: unchanged", async () => {
    const later = new Date(Date.now() + 86_400_000);
    await sql`update persons set last_contacted_at = ${later} where id = ${w.ben}`;
    const before = Date.now();
    await c.send(w.ada, { kind: "person", id: w.ana }, { to: ["ben@example.test"] });
    expect(await e.lastContacted(w.ana)).toBeNull();
    expect((await e.lastContacted(w.ben))!.getTime()).toBe(later.getTime());
    await c.send(w.ada, deal());
    expect((await e.lastContacted(w.ana))!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe("later changes", () => {
  it("the deal unlinked by hand, then the sync: not on the deal, the link stays removed", async () => {
    await c.send(w.ada, deal());
    const [conv] = await e.conversationIds();
    const link = (await getConversation(w.ada, conv))!.links.find((l) => l.kind === "deal")!;
    expect((await unlinkRecord(w.ada, { conversationId: conv, linkId: link.id })).status).toBe("ok");
    await e.sync(w.adaConn);
    expect(await count(w.ada, { dealId: w.pilot })).toBe(0);
    expect((await sql`select removed from email_links where deal_id = ${w.pilot}`)[0].removed).toBe(true);
  });
  it("the sender deactivated: their name stays; the deal archived: still on it; deleted: still on the people", async () => {
    await c.send(w.ada, deal());
    await sql`update users set status = 'deactivated' where id = ${w.ada}`;
    const [entry] = await e.emailEntries(w.bob, { personId: w.ana });
    expect(entry.email!.from).toEqual({ email: e.ADA, name: "Ada Fake" });
    await sql`update deals set archived_at = now() where id = ${w.pilot}`;
    expect(await count(w.bob, { dealId: w.pilot })).toBe(1);
    await sql`delete from deals where id = ${w.pilot}`;
    expect(await count(w.bob, { personId: w.ana })).toBe(1);
  });
});
