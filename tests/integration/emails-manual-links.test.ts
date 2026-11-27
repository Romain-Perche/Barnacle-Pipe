// covers SF-127 FR-010, FR-011, FR-013, US4 scenarios 1-6, SC-005: anyone who can see a conversation links it to a deal,
// person or organisation they can see (not archived) and unlinks any link; hand choices stay: new emails and people
// saved later never undo them.
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
const { getConversation, linkChoices, linkRecord, unlinkRecord } = await import("@/server/emails/conversations");
const actions = await import("@/app/(app)/emails/actions");
const { default: ConversationPage } = await import("@/app/(app)/emails/[id]/page");
const { getPerson, updatePerson } = await import("@/server/records/people");
const { installGmailFake } = await import("../fakes/gmail");
const { makeOrganisation, makePerson, resetDb } = await import("./db-helpers");
const { makeDeal } = await import("./deal-helpers");
const { personForm, emails, saved } = await import("./record-helpers");
const h = await import("./gmail-helpers");
const e = await import("./email-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
let cid: number;
let threadId: string;
const AT = new Date("2026-11-25T14:05:00Z");

beforeEach(async () => {
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  threadId = fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "Proposal", text: "x", internalDate: AT }).threadId;
  await e.sync(w.adaConn);
  cid = (await e.conversationIds())[0];
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const linkOf = async (kind: "person" | "organisation" | "deal", recordId: number) =>
  (await getConversation(w.bob, cid))!.links.find((l) => l.kind === kind && l.recordId === recordId);
const form = (values: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, String(v));
  return fd;
};

describe("US4: link and unlink by hand", () => {
  it("scenario 1: // LINKED TO lists each link with its kind, name and [ UNLINK ], then the three link buttons", async () => {
    await h.signInAs(jar, w.bob);
    const out = await e.html(await ConversationPage({ params: Promise.resolve({ id: String(cid) }), searchParams: Promise.resolve({}) }));
    expect(out).toMatch(/<span class="kind">PERSON<\/span><a href="\/people\/\d+">Ana Example<\/a>/);
    expect(out).toMatch(/<span class="kind">ORG<\/span><a href="\/organisations\/\d+">Example Ltd<\/a>/);
    expect(out).toMatch(/<span class="kind">DEAL<\/span><a href="\/deals\/\d+">Example Ltd – pilot<\/a>/);
    expect(out.match(/\[ UNLINK \]/g)).toHaveLength(3);
    const withForm = await e.html(await ConversationPage({ params: Promise.resolve({ id: String(cid) }), searchParams: Promise.resolve({ link: "deal" }) }));
    expect(withForm).toContain('name="dealId"');
    expect(withForm).toContain("[ LINK ]");
  });
  it("scenario 2: linked to another deal → on that deal's timeline at once (through the action)", async () => {
    const renewal = await makeDeal({ title: "Other Co – renewal", stageId: w.stage, createdBy: w.ada, personId: w.ben });
    await h.signInAs(jar, w.bob);
    const to = await h.redirectOf(actions.linkRecord(form({ conversationId: cid, kind: "deal", dealId: renewal, from: `person-${w.ana}` })));
    expect(to).toBe(`/emails/${cid}?from=person-${w.ana}&notice=linked`);
    expect(await e.emailEntries(w.bob, { dealId: renewal })).toHaveLength(1);
    expect(await linkOf("deal", renewal)).toBeDefined();
  });
  it("scenario 3: linked to a person or organisation not in its emails → on their timelines", async () => {
    expect(await linkRecord(w.bob, { conversationId: cid, kind: "person", recordId: w.ben })).toEqual({ status: "ok" });
    expect(await linkRecord(w.bob, { conversationId: cid, kind: "organisation", recordId: w.otherCo })).toEqual({ status: "ok" });
    expect(await e.emailEntries(w.bob, { personId: w.ben })).toHaveLength(1);
    expect(await e.emailEntries(w.bob, { organisationId: w.otherCo })).toHaveLength(1);
    const rows = await e.linksOf(cid);
    expect(rows.find((r) => r.person_id === w.ben)).toMatchObject({ how: "manual", removed: false });
  });
  it("scenario 4, SC-005: the deal unlinked → off its timeline, and never linked again by new emails or changes to Ana", async () => {
    const link = (await linkOf("deal", w.pilot))!;
    await h.signInAs(jar, w.bob);
    expect(await h.redirectOf(actions.unlinkRecord(form({ conversationId: cid, linkId: link.id, from: "x" })))).toBe(`/emails/${cid}?notice=unlinked`);
    expect(await e.emailEntries(w.bob, { dealId: w.pilot })).toEqual([]);
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "Again", text: "y", threadId, internalDate: AT });
    await e.sync(w.adaConn);
    const ana = (await getPerson(w.bob, w.ana))!;
    saved(await updatePerson(w.bob, w.ana, ana.version, personForm({ firstName: "Ana", lastName: "Example", emails: emails("ana@example.test", "ana.example@mail.test", "ana3@example.test"), organisationId: String(w.exampleLtd) })));
    expect(await e.emailEntries(w.bob, { dealId: w.pilot })).toEqual([]);
    expect((await e.linksOf(cid)).find((r) => r.deal_id === w.pilot)).toMatchObject({ removed: true });
  });
  it("scenario 5: Ana unlinked → off her timeline, not linked again automatically; linked again by hand", async () => {
    const link = (await linkOf("person", w.ana))!;
    expect(await unlinkRecord(w.bob, { conversationId: cid, linkId: link.id })).toEqual({ status: "ok" });
    expect(await e.emailEntries(w.bob, { personId: w.ana })).toEqual([]);
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "Again", text: "y", threadId, internalDate: AT });
    await e.sync(w.adaConn);
    expect(await e.emailEntries(w.bob, { personId: w.ana })).toEqual([]);
    expect(await linkRecord(w.bob, { conversationId: cid, kind: "person", recordId: w.ana })).toEqual({ status: "ok" });
    expect((await e.linksOf(cid)).find((r) => r.person_id === w.ana)).toMatchObject({ how: "manual", removed: false });
    expect(await e.emailEntries(w.bob, { personId: w.ana })).toHaveLength(2);
  });
  it("scenario 6: the pickers offer only records the user can see, archived ones left out (deals of any status)", async () => {
    await makePerson({ firstName: "Pia", lastName: "Private", createdBy: w.ada, private: true });
    await makePerson({ firstName: "Old", lastName: "Archived", createdBy: w.ada, archived: true });
    await makeOrganisation({ name: "Gone Ltd", ownerId: w.ada, archived: true });
    await makeDeal({ title: "Private deal", stageId: w.stage, createdBy: w.ada, private: true });
    await makeDeal({ title: "Archived deal", stageId: w.stage, createdBy: w.ada, archived: true });
    const won = await makeDeal({ title: "Won deal", stageId: w.stage, createdBy: w.ada });
    await sql`update deals set status = 'won', closed_at = now() where id = ${won}`;
    const c = await linkChoices(w.bob);
    expect(c.people.map((p) => p.name)).toEqual(["Ana Example", "Ben Example"]);
    expect(c.organisations.map((o) => o.name)).toEqual(["Example Ltd", "Other Co"]);
    expect(c.deals.map((d) => d.name)).toEqual(["Example Ltd – pilot", "Won deal"]);
    expect((await linkChoices(w.ada)).people.map((p) => p.name)).toContain("Pia Private");
  });
  it("refused for an archived or hidden record; not_found for a hidden or missing conversation", async () => {
    const pia = await makePerson({ firstName: "Pia", lastName: "Private", createdBy: w.ada, private: true });
    const gone = await makeOrganisation({ name: "Gone Ltd", ownerId: w.ada, archived: true });
    expect(await linkRecord(w.bob, { conversationId: cid, kind: "person", recordId: pia })).toEqual({ status: "refused" });
    expect(await linkRecord(w.bob, { conversationId: cid, kind: "organisation", recordId: gone })).toEqual({ status: "refused" });
    expect(await linkRecord(w.bob, { conversationId: cid + 9, kind: "person", recordId: w.ben })).toEqual({ status: "not_found" });
    await h.signInAs(jar, w.bob);
    expect(await h.redirectOf(actions.linkRecord(form({ conversationId: cid, kind: "person", personId: pia })))).toBe(`/emails/${cid}?notice=link-refused`);
    expect(await h.redirectOf(actions.linkRecord(form({ conversationId: cid, kind: "nope", personId: w.ben })))).toBe(`/emails/${cid}?notice=link-refused`);
    // Ada links it to Pia: now hidden from Bob, whose actions answer as for a missing conversation.
    expect(await linkRecord(w.ada, { conversationId: cid, kind: "person", recordId: pia })).toEqual({ status: "ok" });
    expect(await linkRecord(w.bob, { conversationId: cid, kind: "person", recordId: w.ben })).toEqual({ status: "not_found" });
    expect(await unlinkRecord(w.bob, { conversationId: cid, linkId: (await e.linksOf(cid)).length })).toEqual({ status: "not_found" });
    expect(await h.redirectOf(actions.unlinkRecord(form({ conversationId: cid, linkId: 1 })))).toBe(`/emails/${cid}`);
  });
  it("actions need a session", async () => {
    jar.clear();
    const to = await h.redirectOf(actions.linkRecord(form({ conversationId: cid, kind: "person", personId: w.ben })));
    expect(to).toMatch(/^\/auth\/end/);
  });
});
