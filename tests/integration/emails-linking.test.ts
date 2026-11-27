// covers SF-127 FR-007, FR-008, FR-009, US3 scenarios 1-9, Plan clarification "a person whose link was removed by hand
// brings no deal", edge cases "Person changes organisation", "Deal later Won, Lost or archived": copied conversations
// link themselves to people (any address), their organisations and their one open deal; people added later (form,
// CSV import, Pipedrive import) are linked to the conversations already copied.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/settings" }),
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
const { createPerson, getPerson, updatePerson } = await import("@/server/records/people");
const { runImport } = await import("@/server/imports/imports");
const { installGmailFake } = await import("../fakes/gmail");
const { installFakePipedrive, TEST_PIPEDRIVE_KEY } = await import("../fakes/pipedrive");
const { makeOrganisation, makePerson, resetDb } = await import("./db-helpers");
const { makeDeal } = await import("./deal-helpers");
const { uploaded, utf8 } = await import("./import-helpers");
const { personForm, emails, saved } = await import("./record-helpers");
const pd = await import("./pipedrive-helpers");
const e = await import("./email-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
const AT = new Date("2026-11-25T14:05:00Z");

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

let n = 0;
async function mail(o: { from?: string; to?: string; cc?: string; threadId?: string } = {}) {
  n += 1;
  const m = fake.addMessage(e.ADA, { from: o.from ?? "ana@example.test", to: o.to ?? e.ADA, cc: o.cc, subject: `S${n}`, text: "x", threadId: o.threadId, internalDate: AT });
  await e.sync(w.adaConn);
  const [c] = await sql<{ id: number }[]>`
    select t.conversation_id::int as id from email_threads t where t.gmail_thread_id = ${m.threadId}`;
  return { ...m, conversationId: c.id };
}
const linked = async (conversationId: number) => {
  const rows = await e.linksOf(conversationId);
  return {
    people: rows.filter((r) => r.person_id !== null && !r.removed).map((r) => r.person_id),
    organisations: rows.filter((r) => r.organisation_id !== null && !r.removed).map((r) => r.organisation_id),
    deals: rows.filter((r) => r.deal_id !== null && !r.removed).map((r) => r.deal_id),
  };
};

describe("US3: automatic links", () => {
  it("scenario 1: either of Ana's addresses links her and her organisation", async () => {
    const c = await mail({ to: "ana.example@mail.test", from: e.ADA });
    expect(await linked(c.conversationId)).toEqual({ people: [w.ana], organisations: [w.exampleLtd], deals: [w.pilot] });
    expect((await e.linksOf(c.conversationId)).every((l) => l.how === "auto")).toBe(true);
  });
  it("scenario 2: main person of one open deal → that deal", async () => {
    const c = await mail();
    expect((await linked(c.conversationId)).deals).toEqual([w.pilot]);
  });
  it("scenario 3: a linked (not main) person of exactly one open deal → that deal", async () => {
    await sql`update deals set person_id = null where id = ${w.pilot}`;
    await sql`insert into deal_people (deal_id, person_id) values (${w.pilot}, ${w.ana})`;
    const c = await mail();
    expect((await linked(c.conversationId)).deals).toEqual([w.pilot]);
  });
  it("scenario 4: on two open deals → no deal", async () => {
    const other = await makeDeal({ title: "Second", stageId: w.stage, createdBy: w.ada });
    await sql`insert into deal_people (deal_id, person_id) values (${other}, ${w.ana})`;
    const c = await mail();
    expect((await linked(c.conversationId)).deals).toEqual([]);
  });
  it("scenario 5: only Won, Lost or archived deals → no deal", async () => {
    await sql`update deals set status = 'won', closed_at = now() where id = ${w.pilot}`;
    await makeDeal({ title: "Old", stageId: w.stage, createdBy: w.ada, personId: w.ana, archived: true });
    const lost = await makeDeal({ title: "Lost", stageId: w.stage, createdBy: w.ada, personId: w.ana });
    await sql`update deals set status = 'lost', closed_at = now(), lost_reason = 'Price' where id = ${lost}`;
    const c = await mail();
    expect((await linked(c.conversationId)).deals).toEqual([]);
  });
  it("scenario 6: Ana (deal A) and Ben (deal B) → both deals", async () => {
    const b = await makeDeal({ title: "Other Co – renewal", stageId: w.stage, createdBy: w.ada, personId: w.ben });
    const c = await mail({ cc: "ben@example.test" });
    expect((await linked(c.conversationId)).deals.sort()).toEqual([w.pilot, b].sort());
  });
  it("scenario 7: a person added later with the address, or an address added to a person → linked with organisation and deal", async () => {
    const c = await mail({ cc: "cara@example.test, dan@example.test" });
    const cara = saved(await createPerson(w.bob, personForm({ firstName: "Cara", lastName: "Later", emails: emails("cara@example.test"), organisationId: String(w.otherCo) })));
    expect((await linked(c.conversationId)).people).toEqual([w.ana, cara]);
    expect((await linked(c.conversationId)).organisations).toEqual([w.exampleLtd, w.otherCo]);
    expect(await e.emailEntries(w.bob, { personId: cara })).toHaveLength(1);
    // An address added to Ben (who has his own open deal): Ben, and his deal.
    const deal = await makeDeal({ title: "Ben's deal", stageId: w.stage, createdBy: w.ada, personId: w.ben });
    const ben = (await getPerson(w.bob, w.ben))!;
    saved(await updatePerson(w.bob, w.ben, ben.version, personForm({ firstName: "Ben", lastName: "Example", emails: emails("ben@example.test", "dan@example.test"), organisationId: String(w.otherCo) })));
    expect(await linked(c.conversationId)).toEqual({ people: [w.ana, cara, w.ben], organisations: [w.exampleLtd, w.otherCo], deals: [w.pilot, deal] });
  });
  it("scenario 8: a later email of the conversation adds a CRM person in Cc → linked too", async () => {
    const first = await mail();
    const again = await mail({ cc: "ben@example.test", threadId: first.threadId });
    expect(again.conversationId).toBe(first.conversationId);
    expect(await linked(first.conversationId)).toEqual({ people: [w.ana, w.ben], organisations: [w.exampleLtd, w.otherCo], deals: [w.pilot] });
  });
  it("scenario 9: Ana's only open deal private to Ada → linked; Ada sees it on Ana's and the deal's timelines, Bob on neither", async () => {
    await sql`update deals set private = true where id = ${w.pilot}`;
    const c = await mail();
    expect((await linked(c.conversationId)).deals).toEqual([w.pilot]);
    expect(await e.emailEntries(w.ada, { personId: w.ana })).toHaveLength(1);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(1);
    expect(await e.emailEntries(w.bob, { personId: w.ana })).toHaveLength(0);
    expect(await e.emailEntries(w.bob, { dealId: w.pilot })).toHaveLength(0);
  });
  it("people added by a CSV import are linked to the conversations already copied", async () => {
    const c = await mail({ cc: "cara@example.test" });
    const id = await uploaded(w.bob, "people", utf8("First name,Last name,Email\nCara,Csvfake,cara@example.test\n"));
    expect(await runImport(w.bob, id, "subscribed")).toEqual({ status: "done" });
    const [{ id: cara }] = await sql<{ id: number }[]>`select person_id::int as id from person_emails where email = 'cara@example.test'`;
    expect((await linked(c.conversationId)).people).toEqual([w.ana, cara]);
  });
  it("people added by a Pipedrive import are linked to the conversations already copied", async () => {
    const fakePd = installFakePipedrive();
    pd.fakeCompany(fakePd);
    fakePd.addPerson(pd.COMPANY, { first_name: "Gia", last_name: "Pipefake", owner_id: 1, emails: [{ value: "gia@example.test", primary: true, label: "work" }] });
    const c = await mail({ cc: "gia@example.test" });
    await pd.connect(w.ada, pd.LINUS_TOKEN);
    await pd.runToEnd(w.ada, await pd.start(w.ada, { people: true, organisations: false }));
    const [{ id: gia }] = await sql<{ id: number }[]>`select person_id::int as id from person_emails where email = 'gia@example.test'`;
    expect((await linked(c.conversationId)).people).toEqual([w.ana, gia]);
  });
  it("a person whose link was removed by hand is not linked again and brings no deal", async () => {
    await sql`delete from deals where id = ${w.pilot}`;
    const c = await mail();
    await sql`update email_links set removed = true, how = 'manual' where conversation_id = ${c.conversationId} and person_id = ${w.ana}`;
    await makeDeal({ title: "New", stageId: w.stage, createdBy: w.ada, personId: w.ana });
    await mail({ threadId: c.threadId });
    const rows = await e.linksOf(c.conversationId);
    expect(rows.filter((r) => r.deal_id !== null)).toEqual([]);
    expect(rows.find((r) => r.person_id === w.ana)).toMatchObject({ removed: true });
  });
  it("edge cases: automatic links stay when the deal is Won or the person changes organisation; later emails link the new organisation", async () => {
    const c = await mail();
    await sql`update deals set status = 'won', closed_at = now() where id = ${w.pilot}`;
    const ana = (await getPerson(w.bob, w.ana))!;
    saved(await updatePerson(w.bob, w.ana, ana.version, personForm({ firstName: "Ana", lastName: "Example", emails: emails("ana@example.test", "ana.example@mail.test"), organisationId: String(w.otherCo) })));
    expect(await linked(c.conversationId)).toEqual({ people: [w.ana], organisations: [w.exampleLtd], deals: [w.pilot] });
    await mail({ threadId: c.threadId });
    expect((await linked(c.conversationId)).organisations).toEqual([w.exampleLtd, w.otherCo]);
  });
  it("a teammate's address is never linked to a CRM person unless a person has it", async () => {
    const c = await mail({ from: e.ADA, to: `ana@example.test, ${e.BOB}` });
    expect((await linked(c.conversationId)).people).toEqual([w.ana]);
    const bobAsPerson = await makePerson({ firstName: "Bob", lastName: "Contact", createdBy: w.ada, emails: [e.BOB], organisationId: await makeOrganisation({ name: "Barnacle", ownerId: w.ada }) });
    await sql.begin(async (tx) => (await import("@/server/emails/process")).linkForPeople(tx as never, [bobAsPerson]));
    expect((await linked(c.conversationId)).people).toEqual([w.ana, bobAsPerson]);
  });
});
