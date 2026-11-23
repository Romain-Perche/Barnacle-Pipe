// covers SF-109 FR-004, US2 scenarios 1 and 3, spec Edge Cases (several links shown once, deactivated "Done by",
// [ SHOW MORE ] mixing entries) (T028)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { tickActivity, untickActivity } from "@/server/activities/activities";
import { closeDb, sql } from "@/server/db";
import { readTimeline, recordEvent } from "@/server/records/timeline";
import { entryTag } from "@/server/records/timeline-view";
import { makeActivity } from "./activity-helpers";
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

const activityIds = async (target: Parameters<typeof readTimeline>[1], viewer = ada.id) =>
  (await readTimeline(viewer, target)).entries.filter((e) => e.kind === "activity").map((e) => e.id);

describe("done activities on timelines", () => {
  it("shows a done activity on each linked record, tagged ACTIVITY, at the time it was done, with its details", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal, personId: person, organisationId: org, type: "meeting", subject: "Kick-off", note: "Went\nwell" });
    await tickActivity(bob.id, id);
    for (const target of [{ dealId: deal }, { personId: person }, { organisationId: org }]) {
      const entries = (await readTimeline(ada.id, target)).entries.filter((e) => e.kind === "activity");
      expect(entries.map((e) => e.id), JSON.stringify(target)).toEqual([id]);
      const e = entries[0];
      expect(entryTag(e)).toBe("ACTIVITY");
      expect(e.activity).toMatchObject({ id, type: "meeting", subject: "Kick-off", note: "Went\nwell", doneByName: "Bob Fake", doneByActive: true });
      const [row] = await sql<{ done_at: Date }[]>`select done_at from activities where id = ${id}`;
      expect(e.createdAt.getTime()).toBe(row.done_at.getTime());
    }
  });

  // covers SF-109 FR-013 (T065, fix round 1): the untick box is hidden when another link of the activity is archived
  it("flags a done activity whose deal, person or organisation is archived", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal, personId: person, doneAt: new Date() });
    const flag = async () => (await readTimeline(ada.id, { personId: person })).entries.find((e) => e.id === id && e.kind === "activity")?.activity?.archived;
    expect(await flag()).toBe(false);
    await sql`update deals set archived_at = now() where id = ${deal}`;
    expect(await flag()).toBe(true);
    await sql`update deals set archived_at = null where id = ${deal}`;
    await sql`update persons set archived_at = now() where id = ${person}`;
    expect(await flag()).toBe(true);
  });

  it("leaves planned activities out and removes an unticked one", async () => {
    const id = await makeActivity({ by: ada.id, dealId: deal });
    expect(await activityIds({ dealId: deal })).toEqual([]);
    await tickActivity(ada.id, id);
    expect(await activityIds({ dealId: deal })).toEqual([id]);
    await untickActivity(ada.id, id);
    expect(await activityIds({ dealId: deal })).toEqual([]);
  });

  it("shows an activity of the person's deal once on the person's and the organisation's timelines", async () => {
    const onDealOnly = await makeActivity({ by: ada.id, dealId: deal, doneAt: new Date() });
    const onBoth = await makeActivity({ by: ada.id, dealId: deal, personId: person, doneAt: new Date() });
    expect((await activityIds({ personId: person })).sort()).toEqual([onDealOnly, onBoth].sort());
    expect((await activityIds({ organisationId: org })).sort()).toEqual([onDealOnly, onBoth].sort());
  });

  it("marks a deactivated user who did it", async () => {
    const gone = await makeUser({ email: "gone@barnacle.ai", name: "Gone Fake", status: "deactivated" });
    await makeActivity({ by: ada.id, dealId: deal, doneAt: new Date(), doneBy: gone.id });
    const [e] = (await readTimeline(ada.id, { dealId: deal })).entries;
    expect(e.activity).toMatchObject({ doneByName: "Gone Fake", doneByActive: false });
  });

  it("pages events and activities together, newest first, with `more` right", async () => {
    const t = (min: number) => new Date(Date.UTC(2026, 10, 20, 10, min));
    for (let i = 0; i < 3; i++) {
      await recordEvent(sql, { dealId: deal, kind: "edited", actorId: ada.id, fields: ["title"] });
      await sql`update timeline_events set created_at = ${t(i * 2)} where id = (select max(id) from timeline_events)`;
      await makeActivity({ by: ada.id, dealId: deal, doneAt: t(i * 2 + 1), subject: `Call ${i}` });
    }
    const page = await readTimeline(ada.id, { dealId: deal }, 4);
    expect(page.more).toBe(true);
    expect(page.entries.map((e) => `${e.kind}@${e.createdAt.getUTCMinutes()}`)).toEqual(["activity@5", "edited@4", "activity@3", "edited@2"]);
    const all = await readTimeline(ada.id, { dealId: deal }, 6);
    expect(all.more).toBe(false);
    expect(all.entries).toHaveLength(6);
  });

  it("hides an activity linked to a person the viewer cannot see", async () => {
    const secret = await makePerson({ firstName: "Secret", createdBy: ada.id, private: true });
    await makeActivity({ by: ada.id, dealId: deal, personId: secret, doneAt: new Date() });
    expect(await activityIds({ dealId: deal }, bob.id)).toEqual([]);
    expect(await activityIds({ organisationId: org }, bob.id)).toEqual([]);
    expect(await activityIds({ dealId: deal }, ada.id)).toHaveLength(1);
  });
});
