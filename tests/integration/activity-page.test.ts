// covers SF-109 US1 scenarios 1, 2, 5, 6, 7, FR-016 (T013; replaces the browser test of the record pages)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteActivity, editActivity, getActivity, nextActivities, pageActivity, prefillLinks, scheduleActivity } from "@/server/activities/activities";
import { formatDue } from "@/server/activities/rules";
import { closeDb } from "@/server/db";
import { activityForm, makeActivity, okId } from "./activity-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, bob: TestUser;
let org: number, person: number, deal: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  const stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  person = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, organisationId: org });
  deal = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id, personId: person, organisationId: org });
});
afterAll(closeDb);

const asForm = (l: { dealId: number | null; personId: number | null; organisationId: number | null }) => ({
  dealId: l.dealId === null ? "" : String(l.dealId), personId: l.personId === null ? "" : String(l.personId), organisationId: l.organisationId === null ? "" : String(l.organisationId),
});

describe("the address parameters of a record page", () => {
  it("pageActivity takes only a visible activity linked to that record", async () => {
    const onDeal = await makeActivity({ by: ada.id, dealId: deal });
    const elsewhere = await makeActivity({ by: ada.id, organisationId: org });
    const secret = await makePerson({ firstName: "Secret", createdBy: bob.id, private: true });
    const hidden = await makeActivity({ by: bob.id, dealId: deal, personId: secret });
    expect((await pageActivity(ada.id, String(onDeal), { dealId: deal }))?.id).toBe(onDeal);
    expect(await pageActivity(ada.id, String(elsewhere), { dealId: deal })).toBeNull();
    expect(await pageActivity(ada.id, String(hidden), { dealId: deal })).toBeNull();
    expect(await pageActivity(ada.id, "abc", { dealId: deal })).toBeNull();
    expect(await pageActivity(ada.id, "999999", { dealId: deal })).toBeNull();
    expect((await pageActivity(ada.id, String(elsewhere), { organisationId: org }))?.id).toBe(elsewhere);
    expect((await pageActivity(ada.id, String(elsewhere), null))?.id).toBe(elsewhere);
  });
});

describe("// NEXT ACTIVITIES after scheduling, editing and deleting", () => {
  it("a call scheduled from the deal shows once on the deal, its person and its organisation", async () => {
    const id = okId(await scheduleActivity(ada.id, activityForm({ subject: "Call Ada about the proposal", dueOn: "2026-11-24", dueTime: "10:00", ...asForm(await prefillLinks(ada.id, { dealId: deal })) })));
    for (const target of [{ dealId: deal }, { personId: person }, { organisationId: org }]) {
      const rows = await nextActivities(ada.id, target);
      expect(rows.map((r) => r.id), JSON.stringify(target)).toEqual([id]);
      expect(rows[0]).toMatchObject({ type: "call", subject: "Call Ada about the proposal", assignee: { name: "Ada Fake" } });
      expect(formatDue(rows[0])).toBe("24 Nov 2026 10:00");
    }
  });

  it("reads a 30-minute meeting as a range and an untimed task as a date", async () => {
    const meeting = await makeActivity({ by: ada.id, personId: person, type: "meeting", dueOn: "2026-11-24", dueTime: "10:00", durationMinutes: 30 });
    const task = await makeActivity({ by: ada.id, personId: person, type: "task", dueOn: "2026-11-25" });
    const rows = await nextActivities(ada.id, { personId: person });
    expect(rows.map((r) => [r.id, formatDue(r)])).toEqual([[meeting, "24 Nov 2026 10:00–10:30"], [task, "25 Nov 2026"]]);
  });

  it("shows the new values after an edit and nothing after a delete", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal, personId: person });
    expect((await editActivity(ada.id, id, 1, activityForm({ subject: "New subject", dealId: String(deal), personId: String(person) }))).status).toBe("ok");
    expect((await nextActivities(ada.id, { personId: person }))[0].subject).toBe("New subject");
    expect((await deleteActivity(ada.id, id, 2)).status).toBe("ok");
    expect(await getActivity(ada.id, id)).toBeNull();
    for (const target of [{ dealId: deal }, { personId: person }, { organisationId: org }]) expect(await nextActivities(ada.id, target)).toEqual([]);
  });
});
