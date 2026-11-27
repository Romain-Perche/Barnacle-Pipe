// covers SF-127 FR-012, US5 scenarios 1-6, SC-002, edge cases "Hidden linked record", "Archived person": a conversation
// with a private person in its emails, or linked to a private person or deal, is hidden entirely from those who cannot
// see them (no entry on any timeline, no page, no attachment: the same answer as a missing one), admins included.
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
const { getConversation, linkRecord, unlinkRecord } = await import("@/server/emails/conversations");
const { attachmentAccess } = await import("@/server/emails/attachments");
const { default: ConversationPage } = await import("@/app/(app)/emails/[id]/page");
const { GET: download } = await import("@/app/(app)/emails/attachments/[id]/download/route");
const { installGmailFake } = await import("../fakes/gmail");
const { makeOrganisation, makePerson, makeUser, resetDb } = await import("./db-helpers");
const { makeDeal } = await import("./deal-helpers");
const h = await import("./gmail-helpers");
const e = await import("./email-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
let pia: number, piaOrg: number;
const AT = new Date("2026-11-25T14:05:00Z");

beforeEach(async () => {
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  piaOrg = await makeOrganisation({ name: "Pia Org", ownerId: w.ada });
  pia = await makePerson({ firstName: "Pia", lastName: "Private", createdBy: w.ada, private: true, organisationId: piaOrg, emails: ["pia@example.test"] });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function copy(o: { cc?: string; mailbox?: string; conn?: number } = {}) {
  fake.addMessage(o.mailbox ?? e.ADA, { from: "ana@example.test", to: o.mailbox ?? e.ADA, cc: o.cc, subject: "Secret plan", text: "x", internalDate: AT, attachments: [{ name: "plan.pdf", size: 3, data: "abc" }] });
  await e.sync(o.conn ?? w.adaConn);
  return (await e.conversationIds()).at(-1)!;
}
const targets = () => [{ personId: w.ana }, { personId: pia }, { organisationId: w.exampleLtd }, { organisationId: piaOrg }, { dealId: w.pilot }];
const seen = async (userId: number) => Promise.all(targets().map(async (t) => (await e.emailEntries(userId, t)).length));
async function pageOf(userId: number, id: number) {
  await h.signInAs(jar, userId);
  return ConversationPage({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve({}) });
}
async function attachmentAnswer(userId: number) {
  const [a] = await sql<{ id: number }[]>`select id::int as id from email_attachments order by id desc limit 1`;
  await h.signInAs(jar, userId);
  return download(new Request(`http://localhost/emails/attachments/${a.id}/download`), { params: Promise.resolve({ id: String(a.id) }) });
}

describe("US5: private people and deals hide their conversations", () => {
  it("scenarios 1-2: Pia (private to Ada) in the emails → Ada sees it everywhere; Bob nowhere, and by address gets the plain not found", async () => {
    const cid = await copy({ cc: "pia@example.test" });
    expect(await seen(w.ada)).toEqual([1, 1, 1, 1, 1]);
    expect(await seen(w.bob)).toEqual([0, 0, 0, 0, 0]);
    expect(await getConversation(w.bob, cid)).toBeNull();
    await expect(pageOf(w.bob, cid)).rejects.toMatchObject({ to: "not-found" });
    const hidden = await attachmentAnswer(w.bob);
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe("");
    expect(await getConversation(w.ada, cid)).not.toBeNull();
    expect((await attachmentAnswer(w.ada)).status).toBe(200);
  });
  it("admins follow the same rule", async () => {
    const admin = (await makeUser({ email: "root@barnacle.ai", name: "Admin Fake", role: "admin" })).id;
    const cid = await copy({ cc: "pia@example.test" });
    expect(await seen(admin)).toEqual([0, 0, 0, 0, 0]);
    expect(await getConversation(admin, cid)).toBeNull();
    const [a] = await sql<{ id: number }[]>`select id::int as id from email_attachments`;
    expect(await attachmentAccess(admin, a.id)).toBeNull();
  });
  it("scenario 3: a conversation with Ana only, linked to a private deal of Ada's → hidden from all who cannot see the deal", async () => {
    const cid = await copy();
    const secret = await makeDeal({ title: "Ada's secret deal", stageId: w.stage, createdBy: w.ada, private: true });
    expect(await linkRecord(w.ada, { conversationId: cid, kind: "deal", recordId: secret })).toEqual({ status: "ok" });
    expect(await seen(w.bob)).toEqual([0, 0, 0, 0, 0]);
    expect(await getConversation(w.bob, cid)).toBeNull();
    expect((await e.emailEntries(w.ada, { dealId: secret }))).toHaveLength(1);
  });
  it("scenario 4: Pia made shared → Bob sees it", async () => {
    const cid = await copy({ cc: "pia@example.test" });
    await sql`update persons set private = false where id = ${pia}`;
    expect(await getConversation(w.bob, cid)).not.toBeNull();
    expect(await seen(w.bob)).toEqual([1, 1, 1, 1, 1]);
  });
  it("scenario 5: Bob sees a conversation from Ada's mailbox when he can see everyone in it", async () => {
    const cid = await copy();
    expect(await getConversation(w.bob, cid)).not.toBeNull();
    expect(await e.emailEntries(w.bob, { personId: w.ana })).toHaveLength(1);
  });
  it("scenario 6: Pia unlinked by hand → still hidden from Bob (she is still in its emails); Ada can unlink", async () => {
    const cid = await copy({ cc: "pia@example.test" });
    const link = (await getConversation(w.ada, cid))!.links.find((l) => l.recordId === pia && l.kind === "person")!;
    expect(await unlinkRecord(w.ada, { conversationId: cid, linkId: link.id })).toEqual({ status: "ok" });
    expect(await getConversation(w.bob, cid)).toBeNull();
    expect(await seen(w.bob)).toEqual([0, 0, 0, 0, 0]);
  });
  it("a private person linked by hand (not in the emails) hides it; unlinked → visible again; an archived person never hides it", async () => {
    const cid = await copy();
    expect(await linkRecord(w.ada, { conversationId: cid, kind: "person", recordId: pia })).toEqual({ status: "ok" });
    expect(await getConversation(w.bob, cid)).toBeNull();
    const link = (await getConversation(w.ada, cid))!.links.find((l) => l.recordId === pia)!;
    await unlinkRecord(w.ada, { conversationId: cid, linkId: link.id });
    expect(await getConversation(w.bob, cid)).not.toBeNull();
    await sql`update persons set archived_at = now() where id = ${w.ana}`;
    expect(await getConversation(w.bob, cid)).not.toBeNull();
    expect(await e.emailEntries(w.bob, { personId: w.ana })).toHaveLength(1);
  });
});
