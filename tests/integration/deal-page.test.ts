// covers SF-95 FR-001, FR-003, FR-020, US1 scenarios 1, 4, 5 (getDeal for the deal page; the stage bar's move)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { readTimeline } from "@/server/records/timeline";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealEvents, labelDeal, makeDeal, makeDealLabel, makePipeline, periods } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
let alan: TestUser;
let sales: { id: number; stages: number[] };

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal"]);
});
afterAll(closeDb);

describe("getDeal for the deal page", () => {
  it("returns status, labels (removed included, A–Z), visible other people, followers and whether the viewer follows", async () => {
    const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
    const main = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id, archived: true });
    const hidden = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[1], createdBy: ada.id, organisationId: org, personId: main, valuePence: 400000 });
    await labelDeal(id, await makeDealLabel("Warm"));
    await labelDeal(id, await makeDealLabel("Hot", true));
    await sql`insert into deal_people (deal_id, person_id) values (${id}, ${bob}), (${id}, ${hidden})`;
    await sql`insert into deal_followers (deal_id, user_id) values (${id}, ${linus.id}), (${id}, ${alan.id})`;

    const d = (await deals.getDeal(linus.id, id))!;
    expect(d).toMatchObject({
      title: "Fakeco website",
      valuePence: 400000,
      status: "open",
      closedAt: null,
      lostReason: null,
      pipeline: { id: sales.id, name: "Sales" },
      stage: { id: sales.stages[1], name: "Qualified" },
      organisation: { id: org, name: "Fakeco Ltd", archived: false },
      person: { id: main, name: "Ada Example", archived: false },
      followedByViewer: true,
    });
    expect(d.labels.map((l) => l.name)).toEqual(["Hot", "Warm"]);
    // Gus Lorem is private to Ada: never shown, named or counted for Linus.
    expect(d.otherPeople).toEqual([{ id: bob, name: "Bob Example", archived: true }]);
    expect(d.followers).toEqual([
      { id: alan.id, name: "Alan Fake", active: false },
      { id: linus.id, name: "Linus Fake", active: true },
    ]);
    const forAda = (await deals.getDeal(ada.id, id))!;
    expect(forAda.otherPeople.map((p) => p.name)).toEqual(["Bob Example", "Gus Lorem"]);
    expect(forAda.followedByViewer).toBe(false);
  });

  it("returns null for a missing deal, a deleted deal and a private deal of someone else", async () => {
    expect(await deals.getDeal(ada.id, 999999)).toBeNull();
    const priv = await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true });
    expect(await deals.getDeal(linus.id, priv)).toBeNull();
    expect(await deals.getDeal(ada.id, priv)).not.toBeNull();
    const gone = await makeDeal({ title: "Gone deal", stageId: sales.stages[0], createdBy: ada.id });
    expect((await deals.deleteDeal(ada.id, gone)).status).toBe("deleted");
    expect(await deals.getDeal(ada.id, gone)).toBeNull();
  });
});

describe("the stage bar's move", () => {
  it("moves the deal exactly as a board move: a 'moved' event and a new stage period", async () => {
    const [leadIn, , proposal] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: leadIn, createdBy: ada.id });
    expect(await deals.moveDeal(linus.id, { dealId: id, version: 1, fromStageId: leadIn, toStageId: proposal })).toEqual({
      status: "moved", version: 2, pipelineId: sales.id,
    });
    expect((await periods(id)).map((p) => [p.stage_name, p.open])).toEqual([["Lead in", false], ["Proposal", true]]);
    expect(await dealEvents(id)).toEqual([{ kind: "moved", actor_id: linus.id, fields: null, from_stage: "Lead in", to_stage: "Proposal", cause: null }]);
    const bar = await deals.getStageSeconds(id, sales.id);
    expect(bar.map((s) => s.name)).toEqual(["Lead in", "Qualified", "Proposal"]);
  });
});

describe("the deal history", () => {
  it("leaves out link events about a person the viewer cannot see", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    const hidden = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true });
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id });
    await sql`insert into timeline_events (deal_id, kind, actor_id, related_person_id) values
      (${id}, 'person_linked', ${ada.id}, ${hidden}), (${id}, 'person_linked', ${ada.id}, ${bob})`;
    expect((await readTimeline(linus.id, { dealId: id })).map((e) => e.relatedPerson?.name)).toEqual(["Bob Example"]);
    expect((await readTimeline(ada.id, { dealId: id })).map((e) => e.relatedPerson?.name)).toEqual(["Bob Example", "Gus Lorem"]);
  });
});
