// covers FR-009, FR-010, FR-013, SC-004, US1 scenarios 1, 2, 4, 5, edge cases "empty value counts £0",
// "a deal with no organisation or person", "archived deals never shown or counted", "cards ordered by entry into the stage"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealForm, makeDeal, makePipeline } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

// Each column's count and total equal the visible non-archived deals of that stage, straight from the table.
async function expectColumnsMatchTable(viewerId: number, pipelineId: number) {
  const board = (await deals.getBoard(viewerId, pipelineId))!;
  for (const col of board.columns) {
    const [row] = await sql<{ n: number; total: string }[]>`
      select count(*)::int as n, coalesce(sum(value_pence), 0)::bigint as total from deals d
      where d.stage_id = ${col.id} and d.archived_at is null
        and (not d.private or d.created_by = ${viewerId} or d.owner_id = ${viewerId})`;
    expect([col.count, col.totalPence, col.cards.length], col.name).toEqual([row.n, Number(row.total), row.n]);
  }
}

describe("getBoard", () => {
  it("returns null when there are no pipelines", async () => {
    expect(await deals.getBoard(ada.id, null)).toBe(null);
  });

  it("shows the first pipeline by position when none or an unknown one is asked for", async () => {
    const second = await makePipeline("Ambassadors", ["Introduced"], 2);
    const first = await makePipeline("Sales", ["Lead in"], 1);
    expect((await deals.getBoard(ada.id, null))!.pipeline).toEqual({ id: first.id, name: "Sales" });
    expect((await deals.getBoard(ada.id, 999999))!.pipeline).toEqual({ id: first.id, name: "Sales" });
    expect((await deals.getBoard(ada.id, second.id))!.pipeline).toEqual({ id: second.id, name: "Ambassadors" });
    expect((await deals.getBoard(ada.id, null))!.pipelines.map((p) => p.name)).toEqual(["Sales", "Ambassadors"]);
  });

  it("has one column per stage in stage order, with counts and totals of visible, non-archived deals", async () => {
    const sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal", "Closing"]);
    const [leadIn, qualified, proposal] = sales.stages;
    const fakeco = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
    const person = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
    await makeDeal({ title: "Fakeco website", stageId: qualified, createdBy: ada.id, valuePence: 400000, organisationId: fakeco, personId: person, enteredAt: minutesAgo(30) });
    await makeDeal({ title: "Sample Gyms CRM", stageId: qualified, createdBy: ada.id, valuePence: 850000, enteredAt: minutesAgo(10) });
    await makeDeal({ title: "Intro call", stageId: qualified, createdBy: ada.id, valuePence: null, enteredAt: minutesAgo(20) });
    await makeDeal({ title: "Archived deal", stageId: qualified, createdBy: ada.id, valuePence: 999, archived: true });
    await makeDeal({ title: "Ada's secret", stageId: proposal, createdBy: ada.id, valuePence: 100, private: true });
    await makeDeal({ title: "Mock Labs audit", stageId: leadIn, createdBy: linus.id, valuePence: 800000 });

    const board = (await deals.getBoard(linus.id, sales.id))!;
    expect(board.columns.map((c) => c.name)).toEqual(["Lead in", "Qualified", "Proposal", "Closing"]);
    const q = board.columns[1];
    expect([q.count, q.totalPence]).toEqual([3, 1250000]);
    // Most recently entered first.
    expect(q.cards.map((c) => c.title)).toEqual(["Sample Gyms CRM", "Intro call", "Fakeco website"]);
    expect(q.cards[2]).toMatchObject({
      title: "Fakeco website",
      valuePence: 400000,
      organisation: { id: fakeco, name: "Fakeco Ltd" },
      person: { id: person, name: "Ada Example" },
      private: false,
      stageId: qualified,
    });
    expect(q.cards[1]).toMatchObject({ organisation: null, person: null, valuePence: null });
    // The private deal of Ada is neither shown nor counted for Linus; an empty stage is 0 / £0.
    expect(board.columns[2]).toMatchObject({ count: 0, totalPence: 0, cards: [] });
    expect(board.columns[3]).toMatchObject({ count: 0, totalPence: 0, cards: [] });
    await expectColumnsMatchTable(linus.id, sales.id);
    await expectColumnsMatchTable(ada.id, sales.id);
  });

  it("keeps counts and totals equal to the table after adds, edits, moves, archives and deletes (SC-004)", async () => {
    const sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal"]);
    const [leadIn, qualified, proposal] = sales.stages;
    const add = async (title: string, stageId: number, value: string) => {
      const r = await deals.createDeal(linus.id, dealForm({ title, stageId: String(stageId), value }));
      if (r.status !== "saved") throw new Error(JSON.stringify(r));
      return r.id;
    };
    const a = await add("A", leadIn, "100");
    const b = await add("B", leadIn, "250.50");
    const c = await add("C", qualified, "");
    await expectColumnsMatchTable(linus.id, sales.id);
    const deal = (await deals.getDeal(linus.id, a))!;
    await deals.updateDeal(linus.id, a, deal.version, { ...deals.dealToForm(deal), value: "1000" });
    await expectColumnsMatchTable(linus.id, sales.id);
    await deals.moveDeal(linus.id, { dealId: b, version: 1, fromStageId: leadIn, toStageId: proposal });
    await expectColumnsMatchTable(linus.id, sales.id);
    await deals.archiveDeal(linus.id, c);
    await expectColumnsMatchTable(linus.id, sales.id);
    await deals.deleteDeal(ada.id, a);
    await expectColumnsMatchTable(linus.id, sales.id);
    const board = (await deals.getBoard(linus.id, sales.id))!;
    expect(board.columns.map((col) => [col.count, col.totalPence])).toEqual([[0, 0], [0, 0], [1, 25050]]);
  });

  it("names no person on a card when the person is private to someone else", async () => {
    const sales = await makePipeline("Sales", ["Lead in"]);
    const hidden = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true });
    await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, personId: hidden });
    expect((await deals.getBoard(linus.id, null))!.columns[0].cards[0].person).toBe(null);
    expect((await deals.getBoard(ada.id, null))!.columns[0].cards[0].person).toEqual({ id: hidden, name: "Gus Lorem" });
  });

  it("has no columns for a pipeline with no stages", async () => {
    const p = await makePipeline("Partners", []);
    expect((await deals.getBoard(ada.id, p.id))!.columns).toEqual([]);
  });
});
