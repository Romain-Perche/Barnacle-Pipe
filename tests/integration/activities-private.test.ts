// covers SF-109 FR-012, SC-005, US5 scenarios 1–3, spec Clarifications (a record made private later hides its activity
// from its assignee) (T040, T041; replaces the browser test)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityFormChoices, deleteActivity, editActivity, getActivity, nextActivities, pageActivity, scheduleActivity, tickActivity, untickActivity,
} from "@/server/activities/activities";
import { listActivities } from "@/server/activities/list";
import { closeDb, sql } from "@/server/db";
import { messageFor } from "@/server/messages";
import { parseActivitiesQuery, ACTIVITY_WHEN } from "@/server/records/list-query";
import { readTimeline } from "@/server/records/timeline";
import { activityForm, activityRow, okId } from "./activity-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, bob: TestUser, cy: TestUser, linus: TestUser;
let org: number, shared: number, secretPerson: number, privateDeal: number;
let onDeal: number, onPerson: number;
const now = new Date("2026-11-25T12:00:00Z");

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake", role: "admin" });
  cy = await makeUser({ email: "cy@barnacle.ai", name: "Cy Fake" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  const stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  shared = await makePerson({ firstName: "Shared", lastName: "Person", createdBy: ada.id, organisationId: org });
  secretPerson = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true, organisationId: org });
  privateDeal = await makeDeal({ title: "Fake secret project", stageId: stage, createdBy: ada.id, ownerId: linus.id, private: true, personId: shared, organisationId: org });
  onDeal = okId(await scheduleActivity(ada.id, activityForm({ subject: "Secret call", dueOn: "2026-11-20", dealId: String(privateDeal), personId: String(shared), organisationId: String(org) })));
  onPerson = okId(await scheduleActivity(ada.id, activityForm({ type: "task", subject: "Secret task", dueOn: "2026-11-25", personId: String(secretPerson), organisationId: String(org) })));
});
afterAll(closeDb);

describe("activities on private records", () => {
  it("are in no list, count, record section, timeline or direct read for Bob (an admin)", async () => {
    for (const when of ACTIVITY_WHEN) {
      const r = await listActivities(bob.id, parseActivitiesQuery({ when, assignee: "all" }), now);
      expect(r.count, when).toBe(0);
      expect(r.rows).toEqual([]);
      const own = await listActivities(bob.id, parseActivitiesQuery({ when, assignee: String(ada.id) }), now);
      expect(own.count, when).toBe(0);
    }
    expect(await nextActivities(bob.id, { organisationId: org })).toEqual([]);
    expect(await nextActivities(bob.id, { personId: shared })).toEqual([]);
    await tickActivity(ada.id, onDeal);
    await tickActivity(ada.id, onPerson);
    for (const target of [{ organisationId: org }, { personId: shared }]) {
      expect((await readTimeline(bob.id, target)).entries.filter((e) => e.kind === "activity")).toEqual([]);
    }
    expect(await getActivity(bob.id, onDeal)).toBeNull();
    expect(await getActivity(bob.id, onPerson)).toBeNull();
    // Ada still sees both everywhere.
    expect((await listActivities(ada.id, parseActivitiesQuery({ when: "done" }), now)).count).toBe(2);
    expect((await readTimeline(ada.id, { organisationId: org })).entries.filter((e) => e.kind === "activity")).toHaveLength(2);
  });

  it("refuses Bob's direct edit, tick, untick and delete as not found, changing nothing", async () => {
    const before = await activityRow(onDeal);
    expect((await editActivity(bob.id, onDeal, 1, activityForm({ subject: "Hacked" }))).status).toBe("not_found");
    expect(await tickActivity(bob.id, onDeal)).toEqual({ status: "not_found" });
    expect(await untickActivity(bob.id, onPerson)).toEqual({ status: "not_found" });
    expect((await deleteActivity(bob.id, onPerson, 1)).status).toBe("not_found");
    expect(await activityRow(onDeal)).toEqual(before);
    expect((await activityRow(onPerson)).subject).toBe("Secret task");
    expect(messageFor("activity_not_found")).toBe("This activity doesn't exist or you can't see it.");
  });

  it("changes no count when Ada schedules on her private deal, and ignores its id in Bob's addresses", async () => {
    const q = parseActivitiesQuery({ assignee: "all" });
    const before = (await listActivities(bob.id, q, now)).count;
    const id = okId(await scheduleActivity(ada.id, activityForm({ subject: "Another", dealId: String(privateDeal) })));
    expect((await listActivities(bob.id, q, now)).count).toBe(before);
    expect(await pageActivity(bob.id, String(id), { organisationId: org })).toBeNull();
    expect(await pageActivity(bob.id, String(id), null)).toBeNull();
  });

  it("offers only users who can see every link as assignees, and refuses one who cannot", async () => {
    const c = await activityFormChoices(ada.id, { dealId: privateDeal, personId: shared, organisationId: org });
    expect(c.assignees.map((u) => u.name)).toEqual(["Ada Fake", "Linus Fake"]);
    expect(await scheduleActivity(ada.id, activityForm({ dealId: String(privateDeal), assigneeId: String(bob.id) }))).toEqual({ status: "assignee_cannot_see", name: "Bob Fake" });
    expect(await editActivity(ada.id, onPerson, 1, activityForm({ personId: String(secretPerson), assigneeId: String(cy.id) }))).toEqual({ status: "assignee_cannot_see", name: "Cy Fake" });
    const open = okId(await scheduleActivity(ada.id, activityForm({ assigneeId: String(cy.id) })));
    expect(await editActivity(ada.id, open, 1, activityForm({ personId: String(secretPerson), assigneeId: String(cy.id) }))).toEqual({ status: "assignee_cannot_see", name: "Cy Fake" });
  });

  it("hides an activity from its assignee once its deal is made private (nothing reassigned)", async () => {
    const stage = (await sql<{ id: number }[]>`select id::int as id from stages limit 1`)[0].id;
    const deal = await makeDeal({ title: "Later private", stageId: stage, createdBy: ada.id });
    const id = okId(await scheduleActivity(ada.id, activityForm({ dealId: String(deal), assigneeId: String(cy.id) })));
    expect((await listActivities(cy.id, parseActivitiesQuery({}), now)).rows.map((r) => r.id)).toEqual([id]);
    await sql`update deals set private = true where id = ${deal}`;
    expect((await listActivities(cy.id, parseActivitiesQuery({}), now)).rows).toEqual([]);
    expect((await activityRow(id)).assignee_id).toBe(cy.id);
  });
});
