// covers FR-005, FR-006, FR-007, FR-008, SC-004, SC-006, US2 scenarios 1, 3–5, US4 scenarios 2–5, edge cases
// "deactivated owner kept", "person or organisation deleted: the deal stays", clarification "a hidden main person is kept"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { readTimeline } from "@/server/records/timeline";
import { count, makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealCount, dealEvents, dealForm, dealRow, makeDeal, makePipeline, periods } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
let margaret: TestUser;
let alan: TestUser;
let sales: { id: number; stages: number[] };

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal"]);
});
afterAll(closeDb);

function saved(r: { status: string; id?: number }): number {
  if (r.status !== "saved" || r.id === undefined) throw new Error(`expected saved, got ${JSON.stringify(r)}`);
  return r.id;
}

describe("createDeal", () => {
  it("saves the deal in its stage, owned and created by the actor, with an open period and an 'added' event", async () => {
    const [, , proposal] = sales.stages;
    const r = await deals.createDeal(linus.id, dealForm({ value: "4000", pipelineId: String(sales.id), stageId: String(proposal) }));
    const id = saved(r);
    expect(r).toMatchObject({ pipelineId: sales.id });
    expect(await dealRow(id)).toMatchObject({ title: "Fakeco website", value_pence: 400000, stage_id: proposal, owner_id: linus.id, created_by: linus.id, private: false });
    expect(await periods(id)).toEqual([{ stage_id: proposal, stage_name: "Proposal", pipeline_name: "Sales", open: true, moved_by: linus.id }]);
    expect(await dealEvents(id)).toEqual([{ kind: "added", actor_id: linus.id, fields: null, from_stage: null, to_stage: null, cause: null }]);
    const board = await deals.getBoard(linus.id, sales.id);
    const col = board!.columns.find((c) => c.id === proposal)!;
    expect(col.count).toBe(1);
    expect(col.totalPence).toBe(400000);
  });

  it("refuses an empty title or a value that is not money, and saves nothing", async () => {
    const stageId = String(sales.stages[0]);
    expect(await deals.createDeal(ada.id, dealForm({ title: " ", stageId }))).toEqual({ status: "invalid", errors: { title: { code: "deal_title_required" } } });
    for (const value of ["-5", "abc", "4.001"]) {
      expect(await deals.createDeal(ada.id, dealForm({ value, stageId }))).toEqual({ status: "invalid", errors: { value: { code: "deal_value_invalid" } } });
    }
    expect(await dealCount()).toBe(0);
  });

  it("refuses a missing stage, an unknown stage, or a stage of another pipeline", async () => {
    const other = await makePipeline("Ambassadors", ["Introduced"]);
    const refused = { status: "invalid", errors: { stage: { code: "deal_stage_required" } } };
    expect(await deals.createDeal(ada.id, dealForm())).toEqual(refused);
    expect(await deals.createDeal(ada.id, dealForm({ stageId: "999999" }))).toEqual(refused);
    expect(await deals.createDeal(ada.id, dealForm({ pipelineId: String(sales.id), stageId: String(other.stages[0]) }))).toEqual(refused);
    expect(await dealCount()).toBe(0);
  });

  it("takes the person's organisation when no organisation was chosen (FR-006)", async () => {
    const fakeco = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
    const person = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, organisationId: fakeco });
    const id = saved(await deals.createDeal(linus.id, dealForm({ stageId: String(sales.stages[0]), personId: String(person) })));
    expect(await dealRow(id)).toMatchObject({ person_id: person, organisation_id: fakeco });
    // A chosen organisation wins over the person's.
    const other = await makeOrganisation({ name: "Sample Studios Fake", ownerId: ada.id });
    const id2 = saved(await deals.createDeal(linus.id, dealForm({ stageId: String(sales.stages[0]), personId: String(person), organisationId: String(other) })));
    expect(await dealRow(id2)).toMatchObject({ person_id: person, organisation_id: other });
  });

  it("creates a typed new organisation, or links an existing one ignoring case, as on the person form", async () => {
    const stageId = String(sales.stages[0]);
    const id = saved(await deals.createDeal(linus.id, dealForm({ stageId, newOrganisationName: "Brand New Fakeco" })));
    const [org] = await sql<{ id: number; owner_id: number }[]>`select id::int as id, owner_id::int as owner_id from organisations where name = 'Brand New Fakeco'`;
    expect(org.owner_id).toBe(linus.id);
    expect((await dealRow(id))!.organisation_id).toBe(org.id);
    const id2 = saved(await deals.createDeal(margaret.id, dealForm({ stageId, newOrganisationName: "  brand new FAKECO " })));
    expect((await dealRow(id2))!.organisation_id).toBe(org.id);
    expect(await count("organisations")).toBe(1);
    // An archived organisation's name is refused with a link to it.
    const archived = await makeOrganisation({ name: "Old Fakeco Archive", ownerId: ada.id, archived: true });
    expect(await deals.createDeal(margaret.id, dealForm({ stageId, newOrganisationName: "old fakeco archive" }))).toEqual({
      status: "invalid",
      errors: { organisation: { code: "organisation_exists", name: "Old Fakeco Archive", href: `/organisations/${archived}` } },
    });
  });

  it("offers active owners only: a deactivated or unknown owner falls back to the actor", async () => {
    const stageId = String(sales.stages[0]);
    expect((await dealRow(saved(await deals.createDeal(linus.id, dealForm({ stageId, ownerId: String(margaret.id) })))))!.owner_id).toBe(margaret.id);
    expect((await dealRow(saved(await deals.createDeal(linus.id, dealForm({ stageId, ownerId: String(alan.id) })))))!.owner_id).toBe(linus.id);
    expect((await dealRow(saved(await deals.createDeal(linus.id, dealForm({ stageId, ownerId: "99999" })))))!.owner_id).toBe(linus.id);
  });

  it("ignores a person the actor cannot see or an archived person", async () => {
    const stageId = String(sales.stages[0]);
    const hidden = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true });
    const archived = await makePerson({ firstName: "Fay", lastName: "Mockup", createdBy: ada.id, archived: true });
    expect((await dealRow(saved(await deals.createDeal(linus.id, dealForm({ stageId, personId: String(hidden) })))))!.person_id).toBe(null);
    expect((await dealRow(saved(await deals.createDeal(linus.id, dealForm({ stageId, personId: String(archived) })))))!.person_id).toBe(null);
    expect((await dealRow(saved(await deals.createDeal(ada.id, dealForm({ stageId, personId: String(hidden) })))))!.person_id).toBe(hidden);
  });

  it("saves the expected close date and the private flag", async () => {
    const id = saved(await deals.createDeal(linus.id, dealForm({ stageId: String(sales.stages[0]), expectedClose: "2026-12-15", private: true })));
    expect(await dealRow(id)).toMatchObject({ expected_close: "2026-12-15", private: true });
    expect(await deals.createDeal(linus.id, dealForm({ stageId: String(sales.stages[0]), expectedClose: "2026-02-30" }))).toEqual({
      status: "invalid",
      errors: { expectedClose: { code: "deal_close_date_invalid" } },
    });
  });
});

describe("updateDeal", () => {
  async function current(id: number) {
    return (await deals.getDeal(ada.id, id))!;
  }

  it("records 'edited' with the changed field labels only, and the board total follows", async () => {
    const [, qualified] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: qualified, createdBy: ada.id, valuePence: 400000 });
    const deal = await current(id);
    const r = await deals.updateDeal(linus.id, id, deal.version, { ...deals.dealToForm(deal), value: "5000" });
    expect(r).toEqual({ status: "saved", id, pipelineId: sales.id });
    expect((await dealRow(id))!.value_pence).toBe(500000);
    expect((await dealEvents(id)).map((e) => [e.kind, e.fields, e.actor_id])).toEqual([["edited", ["Value"], linus.id]]);
    const col = (await deals.getBoard(linus.id, sales.id))!.columns.find((c) => c.id === qualified)!;
    expect(col.totalPence).toBe(500000);
    // Saving with nothing changed records nothing.
    const again = await current(id);
    await deals.updateDeal(linus.id, id, again.version, deals.dealToForm(again));
    expect((await dealEvents(id)).length).toBe(1);
  });

  it("refuses a stale version with deal_edit_conflict and overwrites nothing", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, valuePence: 400000 });
    const deal = await current(id);
    saved(await deals.updateDeal(linus.id, id, deal.version, { ...deals.dealToForm(deal), value: "4500" }));
    expect(await deals.updateDeal(margaret.id, id, deal.version, { ...deals.dealToForm(deal), value: "9000" })).toEqual({
      status: "invalid",
      errors: { form: { code: "deal_edit_conflict" } },
    });
    expect((await dealRow(id))!.value_pence).toBe(450000);
  });

  it("keeps a hidden private main person when the person field comes back empty; a visible pick replaces it", async () => {
    const hidden = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, personId: hidden });
    const seen = (await deals.getDeal(linus.id, id))!;
    expect(seen.person).toBe(null);
    const form = deals.dealToForm(seen);
    expect(form.personId).toBe("");
    saved(await deals.updateDeal(linus.id, id, seen.version, { ...form, title: "Fakeco website v2" }));
    expect(await dealRow(id)).toMatchObject({ person_id: hidden, title: "Fakeco website v2" });
    expect((await dealEvents(id))[0].fields).toEqual(["Title"]);
    const visible = await makePerson({ firstName: "Bob", lastName: "Placeholder", createdBy: linus.id });
    const again = (await deals.getDeal(linus.id, id))!;
    saved(await deals.updateDeal(linus.id, id, again.version, { ...deals.dealToForm(again), personId: String(visible) }));
    expect((await dealRow(id))!.person_id).toBe(visible);
  });

  it("removes a visible person when the field is emptied", async () => {
    const person = await makePerson({ firstName: "Bob", lastName: "Placeholder", createdBy: linus.id });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, personId: person });
    const deal = await current(id);
    saved(await deals.updateDeal(linus.id, id, deal.version, { ...deals.dealToForm(deal), personId: "" }));
    expect((await dealRow(id))!.person_id).toBe(null);
  });

  it("keeps a deactivated current owner", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, ownerId: alan.id });
    const deal = await current(id);
    expect(deal.owner).toEqual({ id: alan.id, name: "Alan Fake", active: false });
    saved(await deals.updateDeal(linus.id, id, deal.version, { ...deals.dealToForm(deal), value: "10" }));
    expect((await dealRow(id))!.owner_id).toBe(alan.id);
  });

  it("refuses an archived or missing deal as not found", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, archived: true });
    expect(await deals.updateDeal(ada.id, id, 1, dealForm())).toEqual({ status: "not_found" });
    expect(await deals.updateDeal(ada.id, 999999, 1, dealForm())).toEqual({ status: "not_found" });
    expect(await deals.getDeal(ada.id, id)).toMatchObject({ archived: true });
  });
});

describe("archiveDeal", () => {
  it("archives for any user who sees it, keeps the stage, records 'archived' and leaves the board totals", async () => {
    const [, qualified] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: qualified, createdBy: ada.id, valuePence: 400000 });
    await makeDeal({ title: "Sample Gyms CRM", stageId: qualified, createdBy: ada.id, valuePence: 100 });
    expect(await deals.archiveDeal(linus.id, id)).toEqual({ status: "archived", pipelineId: sales.id });
    expect(await dealRow(id)).toMatchObject({ archived: true, stage_id: qualified, version: 2 });
    expect((await dealEvents(id)).map((e) => e.kind)).toEqual(["archived"]);
    const col = (await deals.getBoard(linus.id, sales.id))!.columns.find((c) => c.id === qualified)!;
    expect([col.count, col.totalPence, col.cards.map((c) => c.title)]).toEqual([1, 100, ["Sample Gyms CRM"]]);
    // Archiving again changes nothing more.
    await deals.archiveDeal(linus.id, id);
    expect((await dealEvents(id)).length).toBe(1);
    expect(await deals.archiveDeal(linus.id, 999999)).toEqual({ status: "not_found" });
  });
});

describe("deleteDeal", () => {
  it("is refused for a non-admin (SC-006): the deal stays", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: linus.id });
    expect(await deals.deleteDeal(linus.id, id)).toEqual({ status: "forbidden" });
    const demoted = await makeUser({ email: "grace@barnacle.ai", role: "admin", status: "deactivated" });
    expect(await deals.deleteDeal(demoted.id, id)).toEqual({ status: "forbidden" });
    expect(await dealCount()).toBe(1);
  });

  it("deletes for an admin, with its periods and events, and names the deleted deal", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: linus.id, valuePence: 5 });
    await deals.archiveDeal(linus.id, (await makeDeal({ title: "Other", stageId: sales.stages[0], createdBy: linus.id })));
    expect(await deals.deleteDeal(ada.id, id)).toEqual({ status: "deleted", name: "Fakeco website", pipelineId: sales.id });
    expect(await dealRow(id)).toBeUndefined();
    expect(await periods(id)).toEqual([]);
    expect(await dealEvents(id)).toEqual([]);
    expect(await deals.deleteDeal(ada.id, id)).toEqual({ status: "not_found" });
  });
});

describe("links to people and organisations", () => {
  it("keeps the deal, with no organisation or person, when they are deleted", async () => {
    const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
    const person = await makePerson({ createdBy: ada.id, organisationId: org });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, organisationId: org, personId: person });
    await sql`delete from persons where id = ${person}`;
    await sql`delete from organisations where id = ${org}`;
    expect(await dealRow(id)).toMatchObject({ person_id: null, organisation_id: null });
  });

  it("shows an archived organisation and person on the deal, marked archived", async () => {
    const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id, archived: true });
    const person = await makePerson({ firstName: "Fay", lastName: "Mockup", createdBy: ada.id, archived: true });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[1], createdBy: ada.id, organisationId: org, personId: person });
    expect(await deals.getDeal(linus.id, id)).toMatchObject({
      pipeline: { id: sales.id, name: "Sales" },
      stage: { id: sales.stages[1], name: "Qualified" },
      organisation: { id: org, name: "Fakeco Ltd", archived: true },
      person: { id: person, name: "Fay Mockup", archived: true },
    });
  });

  it("reads the deal's history newest first", async () => {
    const r = await deals.createDeal(ada.id, dealForm({ stageId: String(sales.stages[0]) }));
    const id = saved(r);
    await deals.archiveDeal(linus.id, id);
    const events = (await readTimeline(linus.id, { dealId: id })).entries;
    expect(events.map((e) => [e.kind, e.actorName])).toEqual([
      ["archived", "Linus Fake"],
      ["added", "Ada Fake"],
    ]);
  });
});
