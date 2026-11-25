// covers SF-122 FR-009, FR-010, FR-013, US2 scenarios 1–5, SC-003, SC-004, SC-006, spec Clarifications (archived record,
// long note), edge cases (private record counted not named, notes on leads counted)
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { unreadCount } from "@/server/notifications";
import type { FakePipedrive } from "@/server/pipedrive/fake-pipedrive";
import { getImportView } from "@/server/pipedrive/imports";
import { itemText, namesForReport, reportLines } from "@/server/pipedrive/report";
import { deleteNote, editNote } from "@/server/records/notes";
import { readTimeline } from "@/server/records/timeline";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makeOrganisation, makePerson, makeUser, resetDb } from "./db-helpers";
import { makePipeline } from "./deal-helpers";
import { COMPANY, connect, fakeCompany, linkTarget, LINUS_TOKEN, runToEnd, start } from "./pipedrive-helpers";

// The notes set: notes on deals, people and organisations, on a deal and its person, on a person not imported, on a
// lead, with HTML and a mention, by Jane Fake (no CRM user), on an archived organisation, on a private person.
function seedNotesSet(fake: FakePipedrive) {
  fakeCompany(fake);
  const pipeline = fake.addPipeline(COMPANY, { name: "Sales" });
  const stage = fake.addStage(COMPANY, { pipeline_id: pipeline, name: "Lead" });
  const e = (value: string) => [{ value, primary: true, label: "work" }];
  const org = fake.addOrganization(COMPANY, { name: "Notes Org Fake", owner_id: 1 });
  const archivedOrg = fake.addOrganization(COMPANY, { name: "Archived Org Fake", owner_id: 1 });
  const person = fake.addPerson(COMPANY, { first_name: "Nora", last_name: "Notefake", owner_id: 1, org_id: org, emails: e("nora@fake.example") });
  const noName = fake.addPerson(COMPANY, { first_name: "", last_name: "", name: "", owner_id: 1, emails: e("noname.notes@fake.example") });
  const privatePerson = fake.addPerson(COMPANY, { first_name: "Pia", last_name: "Privatefake", owner_id: 2, visible_to: 1, emails: e("pia@fake.example") });
  const deal = fake.addDeal(COMPANY, { title: "Notes fake deal", owner_id: 1, stage_id: stage, person_id: person, org_id: org });
  const notDeal = fake.addDeal(COMPANY, { title: "Fakeco renewal", owner_id: 1, stage_id: stage, person_id: noName });
  const N = (o: Parameters<FakePipedrive["addNote"]>[1]) => fake.addNote(COMPANY, o);
  const note = {
    onDeal: N({ content: "<p>On the deal</p>", user_id: 1, deal_id: deal, add_time: "2025-02-03 04:05:06" }),
    onDealAndPerson: N({ content: "Deal and person", user_id: 2, deal_id: deal, person_id: person }),
    onPerson: N({ content: "On the person", user_id: 1, person_id: person, org_id: org }),
    onOrg: N({ content: "On the organisation", user_id: 1, org_id: org }),
    onNoName: N({ content: "On a person not imported", user_id: 1, person_id: noName }),
    onNotDeal: N({ content: "On a deal not imported", user_id: 1, deal_id: notDeal }),
    onLead: N({ content: "On a lead", user_id: 1, lead_id: "lead-uuid-1" }),
    onLead2: N({ content: "On a lead too", user_id: 1, lead_id: "lead-uuid-2" }),
    html: N({ content: '<p>Call <b>back</b><br>tomorrow</p><ul><li>slides</li></ul><p>Hi <span class="mention" data-id="3">@Jane Fake</span> see <a href="https://fake.example/doc">the doc</a></p>', user_id: 1, person_id: person }),
    byJane: N({ content: "By Jane", user_id: 3, org_id: org }),
    onArchived: N({ content: "On an archived org", user_id: 1, org_id: archivedOrg }),
    onPrivate: N({ content: "On a private person", user_id: 2, person_id: privatePerson }),
    empty: N({ content: "<p> </p>", user_id: 1, org_id: org }),
    long: N({ content: "L".repeat(50_000), user_id: 1, org_id: org }),
  };
  return { org, person, deal, note, noName, privatePerson, archivedOrg };
}

let linus: { id: number }, margaret: { id: number }, ada: { id: number };
let fake: FakePipedrive;
let set: ReturnType<typeof seedNotesSet>;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  set = seedNotesSet(fake);
  await connect(linus.id, LINUS_TOKEN);
  await makePipeline("Sales", ["Lead"]);
  await makeOrganisation({ name: "Archived Org Fake", ownerId: margaret.id, archived: true });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function importNotes() {
  const id = await start(linus.id, { deals: true, notes: true });
  await runToEnd(linus.id, id);
  return (await getImportView(linus.id))!;
}
const noteRow = async (pdId: number) => {
  const id = await linkTarget("note", pdId);
  if (typeof id !== "number") throw new Error(`note ${pdId} not imported`);
  const [row] = await sql<{ id: number; body: string; actor_id: number; created_at: Date; deal_id: number | null; person_id: number | null; organisation_id: number | null }[]>`
    select id::int as id, body, actor_id::int as actor_id, created_at, deal_id::int as deal_id, person_id::int as person_id, organisation_id::int as organisation_id
    from timeline_events where id = ${id}`;
  return row;
};

describe("notes on the right records (US2-1, US2-2, FR-009)", () => {
  it("puts each note once on its deal, else person, else organisation, at Pipedrive's time by its author", async () => {
    const before = await Promise.all([ada, linus, margaret].map((u) => unreadCount(u.id)));
    const view = await importNotes();
    const dealId = (await linkTarget("deal", set.deal))!;
    const personId = (await linkTarget("person", set.person))!;
    const orgId = (await linkTarget("organisation", set.org))!;
    expect(await noteRow(set.note.onDeal)).toMatchObject({ deal_id: dealId, person_id: null, body: "On the deal", actor_id: linus.id, created_at: new Date("2025-02-03T04:05:06Z") });
    expect(await noteRow(set.note.onDealAndPerson)).toMatchObject({ deal_id: dealId, person_id: null, actor_id: margaret.id });
    expect(await noteRow(set.note.onPerson)).toMatchObject({ person_id: personId, deal_id: null });
    expect(await noteRow(set.note.onOrg)).toMatchObject({ organisation_id: orgId });
    // The person's timeline shows the deal + person note once, as an entry of their deal.
    const timeline = await readTimeline(linus.id, { personId }, 100);
    const shown = timeline.entries.filter((e) => e.kind === "note" && e.note?.segments.some((s) => "text" in s && s.text === "Deal and person"));
    expect(shown).toHaveLength(1);
    expect(shown[0].deal?.id).toBe(dealId);
    expect(view.counts.notes).toMatchObject({ imported: 9, notImported: 3, already: 0 });
    // No notification for anyone (mentions are plain text).
    expect(await Promise.all([ada, linus, margaret].map((u) => unreadCount(u.id)))).toEqual(before);
    expect((await sql`select 1 from note_mentions`).length).toBe(0);
  });

  it("skips notes whose record was not imported (no link), counts notes on leads, never moves them elsewhere", async () => {
    const view = await importNotes();
    expect(await linkTarget("note", set.note.onNoName)).toBeUndefined();
    expect(await linkTarget("note", set.note.onNotDeal)).toBeUndefined();
    const names = await namesForReport(linus.id, view.report);
    const text = (pd: number) => itemText(view.report.notImported.find((n) => n.kind === "note" && n.pipedriveId === pd)!, names);
    expect(text(set.note.onNoName)).toBe("Its person 'noname.notes@fake.example' was not imported.");
    expect(text(set.note.onNotDeal)).toBe("Its deal 'Fakeco renewal' was not imported.");
    expect(view.report.notImported.find((n) => n.pipedriveId === set.note.onNotDeal)!.label).toBe("On a deal not imported");
    expect(text(set.note.empty)).toBe(`Empty once its formatting is removed. (on Notes Org Fake)`);
    const lines = reportLines(view.report, names).map((l) => l.text);
    expect(lines).toContain("2 notes on Pipedrive leads: not imported.");
    expect(lines).toContain("Owner 'Jane Fake' (jane@fake.example) has no CRM user: 1 record given to you.");
    expect(lines).toContain("1 note on private records of other owners imported.");
    expect(lines.join("\n")).not.toContain("Pia");
  });

  it("keeps formatting as plain text, the mention as text; a long note whole; an archived organisation's note on it", async () => {
    await importNotes();
    expect((await noteRow(set.note.html)).body).toBe("Call back\ntomorrow\n- slides\nHi @Jane Fake see the doc (https://fake.example/doc)");
    expect((await noteRow(set.note.long)).body).toHaveLength(50_000);
    expect((await noteRow(set.note.byJane)).actor_id).toBe(linus.id);
    const archived = await noteRow(set.note.onArchived);
    expect(archived.organisation_id).not.toBeNull();
    const priv = await noteRow(set.note.onPrivate);
    expect((await readTimeline(linus.id, { personId: priv.person_id! })).entries).toHaveLength(0);
  });

  it("an imported note can be edited and deleted by a teammate who sees the record (US2-5)", async () => {
    await importNotes();
    const n = await noteRow(set.note.onOrg);
    const target = { organisationId: n.organisation_id! };
    expect(await editNote(margaret.id, target, n.id, 1, "Edited by Margaret", [])).toEqual({ status: "ok", id: n.id });
    expect(await deleteNote(margaret.id, target, n.id)).toEqual({ status: "ok" });
  });

  it("brings in a skipped note once its person can be imported (US5-4), and never adds a note twice", async () => {
    await importNotes();
    fake.updatePerson(COMPANY, set.noName, { first_name: "Now", last_name: "Namedfake", name: "Now Namedfake" });
    const view = await importNotes();
    expect(typeof (await linkTarget("note", set.note.onNoName))).toBe("number");
    expect(view.counts.notes).toMatchObject({ imported: 2, already: 9 });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from timeline_events where kind = 'note'`;
    expect(n).toBe(11);
  });
});
