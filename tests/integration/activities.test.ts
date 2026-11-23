// covers SF-109 FR-001, FR-002, FR-003, FR-007, FR-011, FR-013, FR-015, US1 scenarios 1–7 (T012, T058)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityFormChoices, deleteActivity, editActivity, getActivity, nextActivities, prefillLinks, scheduleActivity,
} from "@/server/activities/activities";
import { closeDb, sql } from "@/server/db";
import { activityCount, activityForm, activityRow, makeActivity, okId } from "./activity-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;
let bob: TestUser;
let cy: TestUser;
let stage: number;
let org: number;
let person: number;
let deal: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  cy = await makeUser({ email: "cy@barnacle.ai", name: "Cy Fake" });
  stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  person = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, organisationId: org });
  deal = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id, personId: person, organisationId: org });
});
afterAll(closeDb);

describe("scheduleActivity", () => {
  it("stores every field, created and assigned by the actor", async () => {
    const id = okId(await scheduleActivity(ada.id, activityForm({
      type: "meeting", subject: "  Kick-off  ", dueOn: "2026-11-25", dueTime: "10:00", duration: "30", assigneeId: String(bob.id),
      note: "Bring\r\nthe deck", dealId: String(deal), personId: String(person), organisationId: String(org),
    })));
    const row = await activityRow(id);
    expect(row).toMatchObject({
      type: "meeting", subject: "Kick-off", due_on: "2026-11-25", due_time: "10:00", duration_minutes: 30, note: "Bring\nthe deck",
      deal_id: deal, person_id: person, organisation_id: org, assignee_id: bob.id, created_by: ada.id, assigned_by: ada.id,
      done_at: null, version: 1,
    });
  });

  it("assigns the actor by default; an activity may have no link", async () => {
    const id = okId(await scheduleActivity(ada.id, activityForm()));
    expect(await activityRow(id)).toMatchObject({ assignee_id: ada.id, deal_id: null, person_id: null, organisation_id: null });
  });

  it("refuses invalid values and saves nothing", async () => {
    for (const over of [{ subject: "" }, { dueOn: "" }, { dueOn: "2026-03-29", dueTime: "01:30" }, { duration: "30" }, { subject: "x".repeat(201) }]) {
      const r = await scheduleActivity(ada.id, activityForm(over));
      expect(r.status, JSON.stringify(over)).toBe("invalid");
    }
    expect(await activityCount()).toBe(0);
  });

  it("refuses a deactivated or unknown assignee", async () => {
    const gone = await makeUser({ email: "gone@barnacle.ai", name: "Gone Fake", status: "deactivated" });
    expect((await scheduleActivity(ada.id, activityForm({ assigneeId: String(gone.id) }))).status).toBe("invalid");
    expect((await scheduleActivity(ada.id, activityForm({ assigneeId: "99999" }))).status).toBe("invalid");
    expect(await activityCount()).toBe(0);
  });

  it("refuses a newly picked won deal, an archived record or a hidden one", async () => {
    const won = await makeDeal({ title: "Won fake", stageId: stage, createdBy: ada.id });
    await sql`update deals set status = 'won', closed_at = now() where id = ${won}`;
    const archivedOrg = await makeOrganisation({ name: "Old Fakeco", ownerId: ada.id, archived: true });
    const hidden = await makePerson({ firstName: "Hidden", createdBy: bob.id, private: true });
    expect((await scheduleActivity(ada.id, activityForm({ dealId: String(won) }))).status).toBe("link_not_found");
    expect((await scheduleActivity(ada.id, activityForm({ organisationId: String(archivedOrg) }))).status).toBe("archived");
    expect((await scheduleActivity(ada.id, activityForm({ personId: String(hidden) }))).status).toBe("link_not_found");
    expect((await scheduleActivity(ada.id, activityForm({ dealId: "99999" }))).status).toBe("link_not_found");
    expect(await activityCount()).toBe(0);
  });

  // covers FR-015 (T058): kept as typed
  it("keeps a subject with markup and a note with a line break as typed", async () => {
    const id = okId(await scheduleActivity(ada.id, activityForm({ subject: "<b>x</b>", note: "one\ntwo", dealId: String(deal) })));
    expect(await getActivity(ada.id, id)).toMatchObject({ subject: "<b>x</b>", note: "one\ntwo" });
    expect((await nextActivities(ada.id, { dealId: deal }))[0]).toMatchObject({ subject: "<b>x</b>", note: "one\ntwo" });
  });
});

describe("prefillLinks and activityFormChoices", () => {
  it("pre-fills from a deal, a person, an organisation, or nothing", async () => {
    expect(await prefillLinks(ada.id, { dealId: deal })).toEqual({ dealId: deal, personId: person, organisationId: org });
    expect(await prefillLinks(ada.id, { personId: person })).toEqual({ dealId: null, personId: person, organisationId: org });
    expect(await prefillLinks(ada.id, { organisationId: org })).toEqual({ dealId: null, personId: null, organisationId: org });
    expect(await prefillLinks(ada.id, null)).toEqual({ dealId: null, personId: null, organisationId: null });
  });

  it("leaves out a deal's main person the viewer cannot see", async () => {
    const secret = await makePerson({ firstName: "Secret", createdBy: ada.id, private: true });
    const d = await makeDeal({ title: "Shared deal", stageId: stage, createdBy: ada.id, personId: secret, organisationId: org });
    expect(await prefillLinks(bob.id, { dealId: d })).toEqual({ dealId: d, personId: null, organisationId: org });
  });

  it("offers open, non-archived, visible deals and non-archived people and organisations", async () => {
    const won = await makeDeal({ title: "Won fake", stageId: stage, createdBy: ada.id });
    await sql`update deals set status = 'won', closed_at = now() where id = ${won}`;
    await makeDeal({ title: "Archived fake", stageId: stage, createdBy: ada.id, archived: true });
    await makeDeal({ title: "Bob's secret", stageId: stage, createdBy: bob.id, private: true });
    await makeOrganisation({ name: "Old Fakeco", ownerId: ada.id, archived: true });
    await makePerson({ firstName: "Archived", createdBy: ada.id, archived: true });
    const gone = await makeUser({ email: "gone@barnacle.ai", name: "Gone Fake", status: "deactivated" });
    const c = await activityFormChoices(ada.id, { dealId: null, personId: null, organisationId: null });
    expect(c.deals.map((d) => d.name)).toEqual(["Fakeco website"]);
    expect(c.organisations.map((o) => o.name)).toEqual(["Example Ltd Fake"]);
    expect(c.people.map((p) => p.name)).toEqual(["Ada Example"]);
    expect(c.assignees.map((u) => u.name)).toEqual(["Ada Fake", "Bob Fake", "Cy Fake"]);
    expect(c.assignees.some((u) => u.id === gone.id)).toBe(false);
  });
});

describe("nextActivities", () => {
  it("lists only the record's planned activities, earliest first, untimed after timed on the same day", async () => {
    const late = await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-26", subject: "Late" });
    const untimed = await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-25", subject: "Untimed" });
    const timed = await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-25", dueTime: "15:00", subject: "Timed" });
    await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-20", subject: "Done", doneAt: new Date() });
    await makeActivity({ by: ada.id, personId: person, subject: "Other record" });
    expect((await nextActivities(ada.id, { dealId: deal })).map((a) => a.id)).toEqual([timed, untimed, late]);
  });
});

describe("editActivity", () => {
  it("saves the new values and bumps the version", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal });
    expect((await editActivity(bob.id, id, 1, activityForm({ subject: "New subject", dealId: String(deal), assigneeId: String(ada.id) }))).status).toBe("ok");
    expect(await activityRow(id)).toMatchObject({ subject: "New subject", version: 2, assignee_id: ada.id, assigned_by: ada.id });
  });

  it("refuses an old version (conflict) and a deleted activity (gone), changing nothing", async () => {
    const id = await makeActivity({ by: ada.id, subject: "Before" });
    await sql`update activities set version = 2 where id = ${id}`;
    expect((await editActivity(ada.id, id, 1, activityForm({ subject: "After" }))).status).toBe("conflict");
    expect((await activityRow(id)).subject).toBe("Before");
    await sql`delete from activities where id = ${id}`;
    expect((await editActivity(ada.id, id, 2, activityForm({ subject: "After" }))).status).toBe("gone");
  });
});

describe("deleteActivity", () => {
  it("deletes it; an old version is a conflict; anyone who can see it may delete it", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal });
    expect((await deleteActivity(cy.id, id, 2)).status).toBe("conflict");
    expect((await deleteActivity(cy.id, id, 1)).status).toBe("ok");
    expect(await activityCount()).toBe(0);
    expect((await deleteActivity(cy.id, id, 1)).status).toBe("gone");
  });
});

// covers FR-013, spec Edge Cases (archived records)
describe("archived records", () => {
  it("refuses every change while a linked record is archived, and still lists the activity", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal, personId: person });
    await sql`update persons set archived_at = now() where id = ${person}`;
    expect((await editActivity(ada.id, id, 1, activityForm({ dealId: String(deal), personId: String(person) }))).status).toBe("archived");
    expect((await deleteActivity(ada.id, id, 1)).status).toBe("archived");
    expect((await scheduleActivity(ada.id, activityForm({ personId: String(person) }))).status).toBe("archived");
    expect((await nextActivities(ada.id, { personId: person })).map((a) => a.id)).toEqual([id]);
    expect((await getActivity(ada.id, id))?.archived).toBe(true);
  });
});

// covers SF-109 spec Edge Cases (T061): links only change by editing the activity; won or lost deals keep their activities
describe("edge cases", () => {
  it("keeps an activity's links when the person is removed from the deal or the deal's organisation changes", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal, personId: person, organisationId: org });
    const other = await makeOrganisation({ name: "Other Fake", ownerId: ada.id });
    await sql`update deals set person_id = null, organisation_id = ${other} where id = ${deal}`;
    expect(await activityRow(id)).toMatchObject({ deal_id: deal, person_id: person, organisation_id: org });
  });

  it("lets a won deal keep its activities, still shown, ticked and edited", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-01" });
    await sql`update deals set status = 'won', closed_at = now() where id = ${deal}`;
    expect((await nextActivities(ada.id, { dealId: deal })).map((a) => a.id)).toEqual([id]);
    expect((await editActivity(ada.id, id, 1, activityForm({ subject: "Still here", dealId: String(deal) }))).status).toBe("ok");
    expect(await getActivity(ada.id, id)).toMatchObject({ subject: "Still here", deal: { id: deal } });
  });

  it("shows a deactivated assignee as such and still lets anyone reassign it", async () => {
    const gone = await makeUser({ email: "gone@barnacle.ai", name: "Gone Fake", status: "deactivated" });
    const id = await makeActivity({ by: ada.id, assignee: gone.id, dealId: deal });
    expect((await getActivity(bob.id, id))!.assignee).toEqual({ id: gone.id, name: "Gone Fake", active: false });
    const c = await activityFormChoices(bob.id, { dealId: deal, personId: null, organisationId: null }, gone.id);
    expect(c.assignees.find((u) => u.id === gone.id)?.name).toBe("Gone Fake (deactivated)");
    expect((await editActivity(bob.id, id, 1, activityForm({ subject: "Kept", dealId: String(deal), assigneeId: String(gone.id) }))).status).toBe("ok");
    expect((await editActivity(bob.id, id, 2, activityForm({ dealId: String(deal), assigneeId: String(cy.id) }))).status).toBe("ok");
    expect((await activityRow(id)).assignee_id).toBe(cy.id);
  });
});
