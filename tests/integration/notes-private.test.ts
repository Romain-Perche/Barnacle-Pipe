// covers SF-102 FR-015, US4 scenarios 1–5, SC-005
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deleteDeal } from "@/server/deals/deals";
import { listNotifications, openNotification, unreadCount } from "@/server/notifications";
import { handOverPrivateRecords } from "@/server/records/handover";
import { addNote, deleteNote, editNote, mentionCandidates } from "@/server/records/notes";
import { readTimeline } from "@/server/records/timeline";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, linus: TestUser, grace: TestUser, alan: TestUser, margaret: TestUser;
let stage: number, org: number, main: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  main = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, organisationId: org });
});
afterAll(closeDb);

const page = async (viewer: number, target: Parameters<typeof readTimeline>[1], limit = 50) => {
  const p = await readTimeline(viewer, target, limit);
  return { ids: p.entries.map((e) => e.id), more: p.more };
};

describe("private deals (US4-1)", () => {
  it("hide their notes and changes from person and organisation timelines, with no count or gap", async () => {
    // 50 shared entries on the organisation, then a private deal with newer entries.
    await sql`insert into timeline_events (organisation_id, kind, actor_id, body, created_at)
              select ${org}, 'note', ${ada.id}, 'o' || g, now() - interval '1 day' - g * interval '1 minute' from generate_series(1, 50) g`;
    const before = { org: await page(grace.id, { organisationId: org }), person: await page(grace.id, { personId: main }) };
    const deal = await makeDeal({ title: "Fake secret project", stageId: stage, createdBy: ada.id, private: true, organisationId: org, personId: main });
    expect((await addNote(ada.id, { dealId: deal }, "secret talk", [])).status).toBe("ok");
    await sql`insert into timeline_events (deal_id, kind, actor_id) values (${deal}, 'added', ${ada.id})`;
    for (const viewer of [grace.id, linus.id]) {
      expect(await page(viewer, { organisationId: org })).toEqual(before.org);
      expect(await page(viewer, { personId: main })).toEqual(before.person);
      expect(await page(viewer, { dealId: deal })).toEqual({ ids: [], more: false });
    }
    expect((await page(ada.id, { organisationId: org })).ids).toHaveLength(50);
    expect((await readTimeline(ada.id, { organisationId: org })).entries[0].deal?.title).toBe("Fake secret project");
  });
});

describe("private people (US4-2)", () => {
  it("hide their notes, and nothing on linked organisation or deal timelines names them", async () => {
    const secret = await makePerson({ firstName: "Pat", lastName: "Privatefake", createdBy: ada.id, ownerId: linus.id, private: true, organisationId: org });
    const deal = await makeDeal({ title: "Shared deal", stageId: stage, createdBy: ada.id, organisationId: org });
    await sql`insert into deal_people (deal_id, person_id, linked_by) values (${deal}, ${secret}, ${ada.id})`;
    await sql`insert into timeline_events (deal_id, kind, actor_id, related_person_id) values (${deal}, 'person_linked', ${ada.id}, ${secret})`;
    await sql`insert into timeline_events (organisation_id, kind, actor_id, related_person_id) values (${org}, 'person_linked', ${ada.id}, ${secret})`;
    expect((await addNote(linus.id, { personId: secret }, "pat note", [])).status).toBe("ok");
    expect((await readTimeline(grace.id, { personId: secret })).entries).toEqual([]);
    for (const target of [{ organisationId: org }, { dealId: deal }]) {
      const entries = (await readTimeline(grace.id, target)).entries;
      expect(entries.some((e) => e.relatedPerson?.id === secret || e.kind === "note")).toBe(false);
    }
    expect((await readTimeline(ada.id, { personId: secret })).entries[0].kind).toBe("note");
  });
});

describe("mentions on private records (US4-3)", () => {
  it("offer only the creator and owner; anyone else is refused by name and nothing is saved", async () => {
    const deal = await makeDeal({ title: "Private deal", stageId: stage, createdBy: ada.id, ownerId: margaret.id, private: true });
    const secret = await makePerson({ firstName: "Pat", lastName: "Privatefake", createdBy: ada.id, ownerId: linus.id, private: true });
    expect((await mentionCandidates(ada.id, { dealId: deal })).map((u) => u.name)).toEqual(["Ada Fake", "Margaret Fake"]);
    expect((await mentionCandidates(ada.id, { personId: secret })).map((u) => u.name)).toEqual(["Ada Fake", "Linus Fake"]);
    expect(await mentionCandidates(grace.id, { dealId: deal })).toEqual([]);
    expect(await addNote(ada.id, { dealId: deal }, "@Grace Fake look", [grace.id])).toEqual({ status: "cannot_mention", name: "Grace Fake" });
    const ok = await addNote(ada.id, { dealId: deal }, "@Margaret Fake look", [margaret.id]);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(await editNote(ada.id, { dealId: deal }, ok.id, 1, "@Margaret Fake @Grace Fake", [margaret.id, grace.id])).toEqual({
      status: "cannot_mention", name: "Grace Fake",
    });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from note_mentions where user_id = ${grace.id}`;
    expect(n).toBe(0);
    const [{ c }] = await sql<{ c: number }[]>`select count(*)::int as c from timeline_events where kind = 'note'`;
    expect(c).toBe(1);
  });
});

describe("notifications on a deal made private (US4-4)", () => {
  it("are neither listed nor counted while hidden, and come back when shared", async () => {
    const deal = await makeDeal({ title: "Shared then private", stageId: stage, createdBy: ada.id });
    const r = await addNote(ada.id, { dealId: deal }, "@Linus Fake see", [linus.id]);
    if (r.status !== "ok") throw new Error();
    expect(await unreadCount(linus.id)).toBe(1);
    await sql`update deals set private = true where id = ${deal}`;
    expect(await unreadCount(linus.id)).toBe(0);
    expect((await listNotifications(linus.id)).items).toEqual([]);
    expect(await openNotification(linus.id, r.id)).toBeNull();
    const [row] = await sql`select read_at from note_mentions where event_id = ${r.id}`;
    expect(row.read_at).toBeNull();
    await sql`update deals set private = false where id = ${deal}`;
    expect(await unreadCount(linus.id)).toBe(1);
    expect((await listNotifications(linus.id)).items).toHaveLength(1);
  });

  it("on a person made private as well", async () => {
    const p = await makePerson({ firstName: "Sam", lastName: "Fake", createdBy: ada.id });
    await addNote(ada.id, { personId: p }, "@Linus Fake see", [linus.id]);
    await sql`update persons set private = true where id = ${p}`;
    expect(await unreadCount(linus.id)).toBe(0);
  });
});

describe("hand-over (US4-5)", () => {
  it("a handed-over private deal's notes go with it to the new owner", async () => {
    const deal = await makeDeal({ title: "Fake leaver deal", stageId: stage, createdBy: alan.id, private: true });
    const r = await addNote(alan.id, { dealId: deal }, "Alan's note", []);
    if (r.status !== "ok") throw new Error();
    await sql`update users set status = 'deactivated' where id = ${alan.id}`;
    expect((await readTimeline(margaret.id, { dealId: deal })).entries).toEqual([]);
    expect((await handOverPrivateRecords(grace.id, alan.id, margaret.id)).status).toBe("handed");
    const entries = (await readTimeline(margaret.id, { dealId: deal })).entries;
    expect(entries.some((e) => e.id === r.id && e.authorActive === false)).toBe(true);
    expect((await editNote(margaret.id, { dealId: deal }, r.id, 1, "Margaret's now", [])).status).toBe("ok");
  });
});

// covers US1 scenario 6, fix round 1: a delete on a hidden or deleted record never names the record
describe("deleteNote on a record the user cannot see", () => {
  it("answers record_not_found for a deal private to someone else and a deleted deal, not_found for an unknown note; deletes nothing", async () => {
    const hidden = await makeDeal({ title: "Fake private deal", stageId: stage, createdBy: ada.id, private: true });
    const r = await addNote(ada.id, { dealId: hidden }, "secret", []);
    if (r.status !== "ok") throw new Error();
    for (const viewer of [linus.id, grace.id]) {
      expect(await deleteNote(viewer, { dealId: hidden }, r.id)).toEqual({ status: "record_not_found" });
    }
    const shown = await makeDeal({ title: "Fake shared deal", stageId: stage, createdBy: ada.id });
    expect(await deleteNote(linus.id, { dealId: shown }, r.id)).toEqual({ status: "not_found" });
    expect(await deleteNote(linus.id, { dealId: shown }, 999_999)).toEqual({ status: "not_found" });
    const [row] = await sql`select count(*)::int as n from timeline_events where id = ${r.id}`;
    expect(row.n).toBe(1);
    const gone = await addNote(ada.id, { dealId: shown }, "on a deal soon deleted", []);
    if (gone.status !== "ok") throw new Error();
    expect((await deleteDeal(grace.id, shown)).status).toBe("deleted");
    expect(await deleteNote(linus.id, { dealId: shown }, gone.id)).toEqual({ status: "record_not_found" });
  });
});
