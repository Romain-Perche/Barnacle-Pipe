// covers SF-109 FR-005, US2 scenarios 1–3 (T029; replaces the browser test of ticking and the follow-up box)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { followupPrefill, getActivity, nextActivities, pageActivity, scheduleActivity, tickActivity, untickActivity } from "@/server/activities/activities";
import { closeDb } from "@/server/db";
import { readTimeline } from "@/server/records/timeline";
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

describe("tick, then schedule the follow-up", () => {
  it("moves the call to the timeline and pre-fills the follow-up with its links and assignee, no date", async () => {
    const call = await makeActivity({ by: ada.id, assignee: bob.id, dealId: deal, personId: person, organisationId: org, dueOn: "2026-11-20" });
    await tickActivity(ada.id, call);
    expect(await nextActivities(ada.id, { dealId: deal })).toEqual([]);
    const [entry] = (await readTimeline(ada.id, { dealId: deal })).entries;
    expect(entry).toMatchObject({ kind: "activity", activity: { id: call, doneByName: "Ada Fake" } });

    // The page opens the box from ?followup=<id>: only an activity of this record.
    const ticked = (await pageActivity(ada.id, String(call), { dealId: deal }))!;
    expect(await pageActivity(ada.id, String(call), { dealId: 999 })).toBeNull();
    const prefill = followupPrefill(ticked);
    expect(prefill).toMatchObject({
      type: "call", subject: "", dueOn: "", dueTime: "", assigneeId: String(bob.id),
      dealId: String(deal), personId: String(person), organisationId: String(org),
    });

    const followup = okId(await scheduleActivity(ada.id, { ...prefill, type: "task", subject: "Send the contract", dueOn: "2026-11-30" }));
    expect((await nextActivities(ada.id, { dealId: deal })).map((a) => a.id)).toEqual([followup]);
    expect(await getActivity(ada.id, followup)).toMatchObject({ assignee: { id: bob.id }, person: { id: person }, organisation: { id: org } });

    await untickActivity(ada.id, call);
    expect((await nextActivities(ada.id, { dealId: deal })).map((a) => a.id)).toEqual([call, followup]);
  });

  it("a follow-up with no date is refused", async () => {
    const call = await makeActivity({ by: ada.id, dealId: deal });
    const prefill = followupPrefill((await getActivity(ada.id, call))!);
    expect(await scheduleActivity(ada.id, { ...prefill, subject: "x" })).toEqual({ status: "invalid", errors: { dueOn: { code: "activity_due_required" } } });
    expect(activityForm().dueOn).not.toBe("");
  });
});
