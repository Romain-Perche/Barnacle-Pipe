// covers SF-127 FR-015, FR-001, US7 scenarios 1 and 3, US1 scenario 1 (design B): the person, organisation and deal pages
// show the details in a left column and, in a right column, the note box, // NEXT ACTIVITIES, // FILES and // TIMELINE in
// that order, [ EDIT ] / [ ARCHIVE ] in the header; an EMAIL entry is a blue-edged box whose subject opens the
// conversation, back to the record. The deal drawer keeps one column.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/people" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { closeDb, sql } = await import("@/server/db");
const { default: PersonPage } = await import("@/app/(app)/people/[id]/page");
const { default: OrganisationPage } = await import("@/app/(app)/organisations/[id]/page");
const { default: DealPage } = await import("@/app/(app)/deals/[id]/page");
const { RecordTimeline } = await import("@/app/(app)/records/RecordTimeline");
const { installGmailFake } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const { makeActivity } = await import("./activity-helpers");
const h = await import("./gmail-helpers");
const e = await import("./email-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  fake.addMessage(e.ADA, {
    from: `"Ana Example" <ana@example.test>`, to: `"Ada Fake" <${e.ADA}>`, subject: "Proposal", text: "Hi Ada, here are the figures we discussed last week…",
    attachments: [{ name: "figures.pdf", size: 240 * 1024 }], internalDate: new Date("2026-11-25T14:05:00Z"),
  });
  await e.sync(w.adaConn);
  await sql`insert into timeline_events (person_id, organisation_id, deal_id, kind, actor_id, body) values (${w.ana}, null, null, 'note', ${w.ada}, 'Ana wants the figures'), (null, ${w.exampleLtd}, null, 'note', ${w.ada}, 'Org note'), (null, null, ${w.pilot}, 'note', ${w.ada}, 'Deal note')`;
  await makeActivity({ by: w.ada, subject: "Follow up", personId: w.ana, organisationId: w.exampleLtd, dealId: w.pilot, dueOn: "2030-01-01" });
  await h.signInAs(jar, w.bob);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const props = (id: number) => ({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve({}) });

// The left and right column of a rendered record page.
function columns(out: string) {
  const start = out.indexOf('<div class="recordcols">');
  const right = out.indexOf('<div class="recordright">');
  expect(start).toBeGreaterThan(-1);
  expect(right).toBeGreaterThan(start);
  return { head: out.slice(0, start), left: out.slice(start, right), right: out.slice(right) };
}
function inOrder(text: string, parts: string[]) {
  const at = parts.map((p) => text.indexOf(p));
  expect(at.every((i) => i >= 0), `missing one of ${parts.join(", ")}`).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
}
const RIGHT = ['aria-label="Add a note"', "NEXT ACTIVITIES", "FILES", "TIMELINE"];

describe("US7: details on the left, timeline on the right", () => {
  it("the person page", async () => {
    const c = columns(await e.html(await PersonPage(props(w.ana))));
    expect(c.head).toContain("[ EDIT ]");
    expect(c.head).toContain("[ ARCHIVE ]");
    inOrder(c.left, ["DETAILS", "Email addresses", "Referred by", "Last contacted"]);
    expect(c.left).not.toContain("TIMELINE");
    inOrder(c.right, RIGHT);
    inOrder(c.right, ["Ana wants the figures", "Proposal"]); // the note is newer than the email
  });
  it("the organisation page", async () => {
    const c = columns(await e.html(await OrganisationPage(props(w.exampleLtd))));
    expect(c.head).toContain("[ EDIT ]");
    inOrder(c.left, ["DETAILS", "PEOPLE", "Ana Example"]);
    inOrder(c.right, RIGHT);
    expect(c.right).toContain("Org note");
    expect(c.right).toContain('class="kd email"');
  });
  it("the deal page: stage bar, value and linked people on the left; [ EDIT ] / [ ARCHIVE ] / [ WON ] above", async () => {
    const c = columns(await e.html(await DealPage(props(w.pilot))));
    inOrder(c.head, ["[ WON ]", "[ EDIT ]", "[ ARCHIVE ]"]);
    inOrder(c.left, ["Value", "DETAILS", "Main person", "Other people", "Referred by"]);
    inOrder(c.right, RIGHT);
    expect(c.right).toContain("Deal note");
    expect(c.right).toContain('class="kd email"');
  });
  it("an archived record has no note box; the rest stays on the right", async () => {
    await sql`update persons set archived_at = now() where id = ${w.ana}`;
    const c = columns(await e.html(await PersonPage(props(w.ana))));
    expect(c.right).not.toContain('aria-label="Add a note"');
    inOrder(c.right, ["NEXT ACTIVITIES", "FILES", "TIMELINE"]);
  });
});

describe("US1 scenario 1 (design B): the EMAIL entry", () => {
  it("tag EMAIL, sender → recipients, a blue-edged box with the subject linking to the conversation, the text start and the attachment", async () => {
    const [cid] = await e.conversationIds();
    const [{ id: mid }] = await sql<{ id: number }[]>`select id::int as id from email_messages`;
    const out = await e.html(await RecordTimeline({ viewerId: w.bob, target: { personId: w.ana }, archived: false }));
    expect(out).toContain(`<li id="email-${mid}" class="ent"><span class="kd email">EMAIL</span>`);
    expect(out).toContain('<div class="emailhead">Ana Example → Ada Fake</div><div class="emailbody">');
    expect(out).toContain(`<a class="subj" href="/emails/${cid}?from=person-${w.ana}#email-${mid}">Proposal</a>`);
    expect(out).toContain('<div class="snip">Hi Ada, here are the figures we discussed last week…</div>');
    expect(out).toContain('<span class="att">figures.pdf · 240 KB</span>');
    expect(out).toContain('<span class="when">14:05</span>');
    // The drawer (read-only, deal): the same entry, back to the deal.
    const drawer = await e.html(await RecordTimeline({ viewerId: w.bob, target: { dealId: w.pilot }, archived: false, readOnly: true }));
    expect(drawer).toContain(`href="/emails/${cid}?from=deal-${w.pilot}#email-${mid}"`);
  });
  it("[ SHOW MORE ] anchors on the last email when the page ends with one", async () => {
    for (let i = 0; i < 50; i++) await sql`insert into timeline_events (person_id, kind, actor_id, body, created_at) values (${w.ana}, 'note', ${w.ada}, ${`n${i}`}, '2026-12-01')`;
    await sql`delete from timeline_events where body in ('Ana wants the figures', 'Deal note')`;
    await sql`delete from timeline_events where person_id = ${w.ana} and kind = 'note' and body = 'n0'`;
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "Older", text: "x", internalDate: new Date("2026-11-01T10:00:00Z") });
    await e.sync(w.adaConn);
    const [{ id: mid }] = await sql<{ id: number }[]>`select id::int as id from email_messages where subject = 'Proposal'`;
    const out = await e.html(await RecordTimeline({ viewerId: w.bob, target: { personId: w.ana }, archived: false }));
    expect(out.slice(out.indexOf(`class="more"`))).toContain(`timeline=100#email-${mid}`);
  });
});
