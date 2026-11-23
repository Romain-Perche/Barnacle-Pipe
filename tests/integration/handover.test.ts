// covers FR-009, FR-010, FR-011, FR-012, FR-013, SC-004, SC-005, US3 scenarios 1, 3–7 (SF-92): handing a
// deactivated user's private people to an active user; SF-97 adds the private deals they own
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { parsePeopleQuery } from "@/server/records/list-query";
import { handOverPrivateRecords } from "@/server/records/handover";
import { createPerson, getPerson, listPeople, updatePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { listUsers } from "@/server/users";
import { getBoard, getDeal, updateDeal } from "@/server/deals/deals";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealForm, dealRow, makeDeal, makePipeline } from "./deal-helpers";
import { emails, personForm } from "./record-helpers";
import { getActivity, nextActivities } from "@/server/activities/activities";
import { makeActivity } from "./activity-helpers";

let ada: TestUser; // admin
let grace: TestUser; // admin
let linus: TestUser;
let margaret: TestUser;
let alan: TestUser; // deactivated, owns private people
let robin: number; // private, created and owned by Alan, archived
let sam: number; // private, created and owned by Alan
let pat: number; // private, created by Linus, owned by Alan
let kept: number; // private, created by Alan, owned by Linus: not touched
let shared: number; // shared, owned by Alan: not touched
let own: number; // private, Margaret's own

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
  const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
  robin = await makePerson({ firstName: "Robin", lastName: "Leftfake", createdBy: alan.id, private: true, archived: true, organisationId: org, emails: ["robin.leftfake@example.com"] });
  sam = await makePerson({ firstName: "Sam", lastName: "Leftfake", createdBy: alan.id, private: true, emails: ["sam.leftfake@example.net"] });
  pat = await makePerson({ firstName: "Pat", lastName: "Linusfake", createdBy: linus.id, ownerId: alan.id, private: true });
  kept = await makePerson({ firstName: "Kept", lastName: "Fake", createdBy: alan.id, ownerId: linus.id, private: true });
  shared = await makePerson({ firstName: "Shared", lastName: "Fake", createdBy: alan.id, private: false });
  own = await makePerson({ firstName: "Active", lastName: "Owned", createdBy: margaret.id, private: true });
});
afterAll(closeDb);

async function snapshot() {
  const persons = await sql`select * from persons order by id`;
  const events = await sql`select * from timeline_events order by id`;
  return { persons, events };
}

async function privatePeopleByUser() {
  return Object.fromEntries((await listUsers()).map((u) => [u.id, u.private_people]));
}

describe("listUsers private_people", () => {
  it("counts private people, archived included, owned by deactivated users only (US3 scenario 1)", async () => {
    expect(await privatePeopleByUser()).toEqual({ [ada.id]: 0, [grace.id]: 0, [linus.id]: 0, [margaret.id]: 0, [alan.id]: 3 });
  });
});

describe("handOverPrivateRecords", () => {
  it("moves every private person Alan owns to Margaret, with a handed_over event each (US3 scenarios 1, 3, 4)", async () => {
    const before = await sql`select id::int as id, created_by, archived_at, version from persons where id in ${sql([robin, sam, pat])} order by id`;
    expect(await handOverPrivateRecords(ada.id, alan.id, margaret.id)).toEqual({ status: "handed", people: 3, deals: 0, toName: "Margaret Fake" });
    const after = await sql`select id::int as id, owner_id::int as owner_id, private, created_by, archived_at, version from persons where id in ${sql([robin, sam, pat])} order by id`;
    for (const [i, p] of after.entries()) {
      expect(p).toMatchObject({ owner_id: margaret.id, private: true, created_by: before[i].created_by, archived_at: before[i].archived_at, version: before[i].version + 1 });
    }
    const events = await sql`select person_id::int as person_id, kind, actor_id::int as actor_id, related_user_id::int as related_user_id from timeline_events where kind = 'handed_over' order by person_id`;
    expect(events).toEqual([robin, sam, pat].sort((a, b) => a - b).map((id) => ({ person_id: id, kind: "handed_over", actor_id: ada.id, related_user_id: margaret.id })));
    expect(((await readTimeline(margaret.id, { personId: sam })).entries)[0]).toMatchObject({ kind: "handed_over", actorName: "Ada Fake", relatedUserName: "Margaret Fake" });

    const mine = await listPeople(margaret.id, parsePeopleQuery({ owner: String(margaret.id), archived: "1" }));
    expect(mine.rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([robin, sam, pat, own].sort((a, b) => a - b));
    expect((await getPerson(margaret.id, robin))!.owner.id).toBe(margaret.id);
    // Pat's creator still sees them; untouched people stay as they were.
    expect(await getPerson(linus.id, pat)).not.toBeNull();
    const untouched = await sql`select id::int as id, owner_id::int as owner_id, version from persons where id in ${sql([kept, shared])} order by id`;
    expect(untouched).toEqual([{ id: kept, owner_id: linus.id, version: 1 }, { id: shared, owner_id: alan.id, version: 1 }].sort((a, b) => a.id - b.id));
    // The admin still sees none of them.
    expect(await getPerson(ada.id, sam)).toBeNull();

    expect(await handOverPrivateRecords(ada.id, alan.id, margaret.id)).toEqual({ status: "none", fromName: "Alan Fake" });
    expect((await privatePeopleByUser())[alan.id]).toBe(0);
  });

  it("lets the new owner see the addresses in duplicate messages and free them (US3 scenarios 5, 6)", async () => {
    await handOverPrivateRecords(ada.id, alan.id, margaret.id);
    expect(await createPerson(margaret.id, personForm({ emails: emails("sam.leftfake@example.net") }))).toEqual({
      status: "invalid",
      errors: { "emails.0": { code: "duplicate_email", name: "Sam Leftfake", href: `/people/${sam}` } },
    });
    expect(await createPerson(linus.id, personForm({ emails: emails("sam.leftfake@example.net") }))).toEqual({
      status: "invalid",
      errors: { "emails.0": { code: "duplicate_email_hidden" } },
    });
    const v = (await getPerson(margaret.id, sam))!.version;
    expect((await updatePerson(margaret.id, sam, v, personForm({ firstName: "Sam", lastName: "Leftfake", private: true, ownerId: String(margaret.id) }))).status).toBe("saved");
    expect((await createPerson(linus.id, personForm({ emails: emails("sam.leftfake@example.net") }))).status).toBe("saved");
  });

  it("allows handing over to the acting admin", async () => {
    expect(await handOverPrivateRecords(ada.id, alan.id, ada.id)).toEqual({ status: "handed", people: 3, deals: 0, toName: "Ada Fake" });
    expect(await getPerson(ada.id, sam)).not.toBeNull();
  });
});

// covers FR-012, SC-005, spec Edge Cases (SF-92)
describe("handOverPrivateRecords refusals and races", () => {
  it("refuses and changes nothing", async () => {
    const deactivatedAdmin = await makeUser({ email: "old@barnacle.ai", name: "Old Admin", role: "admin", status: "deactivated" });
    const before = await snapshot();
    expect(await handOverPrivateRecords(linus.id, alan.id, margaret.id)).toEqual({ status: "forbidden" });
    expect(await handOverPrivateRecords(deactivatedAdmin.id, alan.id, margaret.id)).toEqual({ status: "forbidden" });
    expect(await handOverPrivateRecords(ada.id, linus.id, margaret.id)).toEqual({ status: "not_deactivated" });
    expect(await handOverPrivateRecords(ada.id, 999_999, margaret.id)).toEqual({ status: "not_deactivated" });
    expect(await handOverPrivateRecords(ada.id, alan.id, deactivatedAdmin.id)).toEqual({ status: "choose_user" });
    expect(await handOverPrivateRecords(ada.id, alan.id, 999_999)).toEqual({ status: "choose_user" });
    expect(await handOverPrivateRecords(ada.id, alan.id, alan.id)).toEqual({ status: "choose_user" });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses when the recipient is deactivated by a transaction running at the same time", async () => {
    const before = await snapshot();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let updated!: () => void;
    const didUpdate = new Promise<void>((r) => (updated = r));
    const other = sql.begin(async (tx) => {
      await tx`update users set status = 'deactivated' where id = ${margaret.id}`;
      updated();
      await gate;
    });
    await didUpdate;
    const handover = handOverPrivateRecords(ada.id, alan.id, margaret.id);
    await new Promise((r) => setTimeout(r, 150));
    release();
    await other;
    expect(await handover).toEqual({ status: "choose_user" });
    const after = await snapshot();
    expect(after.persons).toEqual(before.persons);
    expect(after.events).toEqual(before.events);
  });

  it("lets only one of two admins handing over at once move the people", async () => {
    const results = await Promise.all([handOverPrivateRecords(ada.id, alan.id, margaret.id), handOverPrivateRecords(grace.id, alan.id, linus.id)]);
    const handed = results.filter((r) => r.status === "handed");
    expect(handed).toHaveLength(1);
    expect(handed[0]).toMatchObject({ people: 3 });
    expect(results.filter((r) => r.status === "none")).toHaveLength(1);
    const [{ n }] = await sql`select count(*)::int as n from timeline_events where kind = 'handed_over'`;
    expect(n).toBe(3);
  });

  it("refuses a save from an edit form opened before the hand-over (edit_conflict)", async () => {
    const opened = (await getPerson(linus.id, pat))!;
    await handOverPrivateRecords(ada.id, alan.id, margaret.id);
    expect(await updatePerson(linus.id, pat, opened.version, personForm({ firstName: "Pat", lastName: "Linusfake", private: true, ownerId: String(alan.id) }))).toEqual({
      status: "invalid",
      errors: { form: { code: "edit_conflict" } },
    });
  });
});

// ---- SF-97: the hand-over also moves the private deals the deactivated user owns ------------------------------

describe("handOverPrivateRecords with private deals (SF-97)", () => {
  let sales: { id: number; stages: number[] };
  let open: number; // private, created and owned by Alan
  let old: number; // private, created and owned by Alan, archived
  let fromLinus: number; // private, created by Linus, owned by Alan
  let keptDeal: number; // private, created by Alan, owned by Linus: not touched
  let sharedDeal: number; // shared, owned by Alan: not touched

  beforeEach(async () => {
    sales = await makePipeline("Sales", ["Lead in", "Qualified"]);
    const org = await makeOrganisation({ name: "Dealco Fake", ownerId: ada.id });
    open = await makeDeal({ title: "Fake leaver deal", stageId: sales.stages[1], createdBy: alan.id, private: true, valuePence: 500_00, organisationId: org, personId: sam, enteredAt: new Date("2026-01-02T10:00:00Z") });
    old = await makeDeal({ title: "Fake leaver old deal", stageId: sales.stages[0], createdBy: alan.id, private: true, archived: true });
    fromLinus = await makeDeal({ title: "Linus fake deal", stageId: sales.stages[0], createdBy: linus.id, ownerId: alan.id, private: true, valuePence: 100 });
    keptDeal = await makeDeal({ title: "Kept fake deal", stageId: sales.stages[0], createdBy: alan.id, ownerId: linus.id, private: true });
    sharedDeal = await makeDeal({ title: "Shared fake deal", stageId: sales.stages[0], createdBy: alan.id, private: false });
    await sql`update deals set expected_close_on = '2027-03-01' where id = ${open}`;
  });

  async function dealState(ids: number[]) {
    return sql`
      select id::int as id, owner_id::int as owner_id, private, created_by::int as created_by, stage_id::int as stage_id, stage_entered_at,
             value_pence, organisation_id::int as organisation_id, person_id::int as person_id, expected_close_on, archived_at, version
      from deals where id in ${sql(ids)} order by id`;
  }
  async function dealSnapshot() {
    return { deals: await sql`select * from deals order by id`, periods: await sql`select * from deal_stage_periods order by id`, events: await sql`select * from timeline_events order by id` };
  }
  async function sees(viewer: TestUser, dealId: number): Promise<boolean> {
    const board = (await getBoard(viewer.id, sales.id))!;
    const onBoard = board.columns.some((col) => col.cards.some((card) => card.id === dealId));
    const drawer = (await getDeal(viewer.id, dealId)) !== null;
    if (!(await sql`select 1 from deals where id = ${dealId} and archived_at is not null`).length) expect(onBoard).toBe(drawer);
    return drawer;
  }

  // covers FR-002, US1 scenario 1
  it("counts private deals, archived included, owned by deactivated users only", async () => {
    const rows = await listUsers();
    const by = Object.fromEntries(rows.map((u) => [u.id, [u.private_people, u.private_deals]]));
    expect(by).toEqual({ [ada.id]: [0, 0], [grace.id]: [0, 0], [linus.id]: [0, 0], [margaret.id]: [0, 0], [alan.id]: [3, 3] });
  });

  // covers FR-001, FR-004, FR-005, FR-007, SC-001, US1 scenarios 3–6
  it("moves every private deal Alan owns to Margaret, keeping everything else, with one handed_over event each", async () => {
    const moved = [open, old, fromLinus];
    const before = await dealState(moved);
    const periodsBefore = await sql`select * from deal_stage_periods order by id`;
    const [{ n: movedEventsBefore }] = await sql`select count(*)::int as n from timeline_events where kind = 'moved'`;
    expect(await handOverPrivateRecords(ada.id, alan.id, margaret.id)).toEqual({ status: "handed", people: 3, deals: 3, toName: "Margaret Fake" });
    const after = await dealState(moved);
    for (const [i, d] of after.entries()) {
      expect(d).toEqual({ ...before[i], owner_id: margaret.id, version: before[i].version + 1 });
      expect(d.private).toBe(true);
    }
    const events = await sql`
      select deal_id::int as deal_id, kind, actor_id::int as actor_id, related_user_id::int as related_user_id
      from timeline_events where deal_id is not null order by deal_id`;
    expect(events).toEqual([...moved].sort((a, b) => a - b).map((id) => ({ deal_id: id, kind: "handed_over", actor_id: ada.id, related_user_id: margaret.id })));
    expect(await sql`select * from deal_stage_periods order by id`).toEqual(periodsBefore);
    const [{ n: movedEventsAfter }] = await sql`select count(*)::int as n from timeline_events where kind = 'moved'`;
    expect(movedEventsAfter).toBe(movedEventsBefore);
    expect(((await readTimeline(margaret.id, { dealId: open })).entries)[0]).toMatchObject({ kind: "handed_over", actorName: "Ada Fake", relatedUserName: "Margaret Fake" });
    expect(await sql`select id from deals where private and owner_id = ${alan.id}`).toHaveLength(0);
    expect((await listUsers()).find((u) => u.id === alan.id)).toMatchObject({ private_people: 0, private_deals: 0 });

    // Untouched: a private deal Alan created but Linus owns, and a shared deal Alan owns.
    expect(await sql`select id::int as id, owner_id::int as owner_id, version from deals where id in ${sql([keptDeal, sharedDeal])} order by id`).toEqual(
      [{ id: keptDeal, owner_id: linus.id, version: 1 }, { id: sharedDeal, owner_id: alan.id, version: 1 }].sort((a, b) => a.id - b.id),
    );

    // Margaret sees them (board card marked private, drawer with her as owner); Linus's own deal stays his to see.
    expect(await sees(margaret, open)).toBe(true);
    expect(await sees(margaret, old)).toBe(true);
    const card = (await getBoard(margaret.id, sales.id))!.columns[1].cards.find((c) => c.id === open)!;
    expect(card.private).toBe(true);
    expect((await getDeal(margaret.id, open))!.owner).toEqual({ id: margaret.id, name: "Margaret Fake", active: true });
    expect(await sees(linus, fromLinus)).toBe(true);
    expect(await sees(margaret, fromLinus)).toBe(true);
    // Neither Linus nor the admin sees Alan's deals.
    for (const viewer of [linus, ada]) {
      expect(await sees(viewer, open), viewer.name).toBe(false);
      expect(await sees(viewer, old), viewer.name).toBe(false);
      expect((await readTimeline(viewer.id, { dealId: open })).entries).toEqual([]);
    }
    const column = (await getBoard(ada.id, sales.id))!.columns[1];
    expect([column.count, column.totalPence]).toEqual([0, 0]);

    // Reactivated, Alan sees the private deals Alan created, not the one Alan only owned.
    await sql`update users set status = 'active' where id = ${alan.id}`;
    expect(await sees(alan, open)).toBe(true);
    expect(await sees(alan, old)).toBe(true);
    expect(await sees(alan, fromLinus)).toBe(false);
  });

  // covers US2 scenarios 1–2, FR-002
  it("hands over a user who owns only private deals", async () => {
    await sql`update persons set private = false where owner_id = ${alan.id}`;
    await sql`delete from deals where id in ${sql([old, fromLinus])}`;
    expect((await listUsers()).find((u) => u.id === alan.id)).toMatchObject({ private_people: 0, private_deals: 1 });
    expect(await handOverPrivateRecords(ada.id, alan.id, margaret.id)).toEqual({ status: "handed", people: 0, deals: 1, toName: "Margaret Fake" });
    expect((await dealRow(open))!.owner_id).toBe(margaret.id);
  });

  // covers spec Edge Cases (SF-97): hand-over to the acting admin
  it("makes the acting admin the owner when chosen", async () => {
    expect(await handOverPrivateRecords(ada.id, alan.id, ada.id)).toEqual({ status: "handed", people: 3, deals: 3, toName: "Ada Fake" });
    expect(await sees(ada, open)).toBe(true);
  });

  // covers FR-008, SC-004, spec Edge Cases
  it("refusals change no deal", async () => {
    const before = await dealSnapshot();
    expect(await handOverPrivateRecords(linus.id, alan.id, margaret.id)).toEqual({ status: "forbidden" });
    expect(await handOverPrivateRecords(ada.id, linus.id, margaret.id)).toEqual({ status: "not_deactivated" });
    expect(await handOverPrivateRecords(ada.id, alan.id, alan.id)).toEqual({ status: "choose_user" });
    const gone = await makeUser({ email: "gone@barnacle.ai", name: "Gone Fake", status: "deactivated" });
    expect(await handOverPrivateRecords(ada.id, alan.id, gone.id)).toEqual({ status: "choose_user" });
    expect(await dealSnapshot()).toEqual(before);
  });

  // covers spec Edge Cases: a second hand-over finds nothing; the only private deal made shared meanwhile
  it("answers none when nothing is left to hand over", async () => {
    await handOverPrivateRecords(ada.id, alan.id, margaret.id);
    expect(await handOverPrivateRecords(grace.id, alan.id, linus.id)).toEqual({ status: "none", fromName: "Alan Fake" });

    await sql`update persons set private = false, owner_id = ${alan.id}`;
    const only = await makeDeal({ title: "Only fake deal", stageId: sales.stages[0], createdBy: linus.id, ownerId: alan.id, private: true });
    const v = (await getDeal(linus.id, only))!.version;
    expect((await updateDeal(linus.id, only, v, dealForm({ title: "Only fake deal", private: false, ownerId: String(alan.id) }))).status).toBe("saved");
    expect(await handOverPrivateRecords(ada.id, alan.id, margaret.id)).toEqual({ status: "none", fromName: "Alan Fake" });
    expect((await dealRow(only))!.owner_id).toBe(alan.id);
  });

  // covers spec Edge Cases: two admins at once move each deal once
  it("moves each deal once when two admins hand over at the same time", async () => {
    const results = await Promise.all([handOverPrivateRecords(ada.id, alan.id, margaret.id), handOverPrivateRecords(grace.id, alan.id, linus.id)]);
    expect(results.filter((r) => r.status === "handed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "none")).toHaveLength(1);
    const perDeal = await sql`select deal_id::int as deal_id, count(*)::int as n from timeline_events where kind = 'handed_over' and deal_id is not null group by deal_id`;
    expect(perDeal).toHaveLength(3);
    expect(perDeal.every((r) => r.n === 1)).toBe(true);
  });

  // covers spec Edge Cases: an edit form opened before the hand-over is refused as stale
  it("refuses a deal save from an edit form opened before the hand-over", async () => {
    const opened = (await getDeal(linus.id, fromLinus))!;
    await handOverPrivateRecords(ada.id, alan.id, margaret.id);
    expect(await updateDeal(linus.id, fromLinus, opened.version, dealForm({ title: "Changed", private: true, ownerId: String(alan.id) }))).toEqual({
      status: "invalid",
      errors: { form: { code: "deal_edit_conflict" } },
    });
    expect((await dealRow(fromLinus))!).toMatchObject({ title: "Linus fake deal", owner_id: margaret.id });
  });

  // covers SF-109 US5 scenario 4 (T015): the new owner sees the handed-over records' activities; each keeps its assignee
  it("lets the new owner see the activities of the private deal and person handed over, assignee kept", async () => {
    const onDeal = await makeActivity({ by: alan.id, dealId: open, personId: sam, subject: "Fake leaver call" });
    const onPerson = await makeActivity({ by: alan.id, personId: sam, type: "task", subject: "Fake leaver task" });
    expect(await nextActivities(margaret.id, { dealId: open })).toEqual([]);
    expect(await getActivity(margaret.id, onPerson)).toBeNull();
    await handOverPrivateRecords(ada.id, alan.id, margaret.id);
    expect((await nextActivities(margaret.id, { dealId: open })).map((a) => a.id)).toEqual([onDeal]);
    expect((await nextActivities(margaret.id, { personId: sam })).map((a) => a.id)).toEqual([onDeal, onPerson]);
    const seen = (await getActivity(margaret.id, onPerson))!;
    expect(seen.assignee).toEqual({ id: alan.id, name: alan.name, active: false });
    expect((await getActivity(linus.id, onDeal))).toBeNull();
  });
});
