// covers FR-007, FR-011, FR-012, US3 scenarios 1–5 (moves, stage periods, stale moves)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { readTimeline } from "@/server/records/timeline";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealEvents, dealRow, makeDeal, makePipeline, periods } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
let sales: { id: number; stages: number[] };
let partners: { id: number; stages: number[] };

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal"]);
  partners = await makePipeline("Partners", ["Intro", "Talking"]);
});
afterAll(closeDb);

async function openPeriods(): Promise<{ deal_id: number; n: number }[]> {
  return sql`select deal_id::int as deal_id, count(*)::int as n from deal_stage_periods where left_at is null group by deal_id having count(*) <> 1`;
}

describe("moveDeal", () => {
  it("closes the open period, opens one in the new stage, bumps the version and records 'moved'", async () => {
    const [, qualified, proposal] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: qualified, createdBy: ada.id, enteredAt: new Date(Date.now() - 86_400_000) });
    const r = await deals.moveDeal(linus.id, { dealId: id, version: 1, fromStageId: qualified, toStageId: proposal });
    expect(r).toEqual({ status: "moved", version: 2, pipelineId: sales.id });
    expect(await dealRow(id)).toMatchObject({ stage_id: proposal, version: 2 });
    expect(await periods(id)).toEqual([
      { stage_id: qualified, stage_name: "Qualified", pipeline_name: "Sales", open: false, moved_by: null },
      { stage_id: proposal, stage_name: "Proposal", pipeline_name: "Sales", open: true, moved_by: linus.id },
    ]);
    const [entered] = await sql<{ fresh: boolean }[]>`select stage_entered_at > now() - interval '1 minute' as fresh from deals where id = ${id}`;
    expect(entered.fresh).toBe(true);
    expect(await dealEvents(id)).toEqual([{ kind: "moved", actor_id: linus.id, fields: null, from_stage: "Qualified", to_stage: "Proposal", cause: null }]);
    const [line] = await readTimeline(ada.id, { dealId: id });
    expect(line).toMatchObject({ kind: "moved", actorName: "Linus Fake", fromStage: "Qualified", toStage: "Proposal", cause: null });
  });

  it("names the pipelines when a deal moves to another pipeline", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[1], createdBy: ada.id });
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 1, fromStageId: null, toStageId: partners.stages[0] })).toEqual({
      status: "moved",
      version: 2,
      pipelineId: partners.id,
    });
    expect((await dealEvents(id))[0]).toMatchObject({ from_stage: "Sales · Qualified", to_stage: "Partners · Intro" });
    expect((await periods(id)).at(-1)).toMatchObject({ stage_name: "Intro", pipeline_name: "Partners", open: true });
  });

  it("does nothing for a drop on the deal's own stage", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[1], createdBy: ada.id });
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 1, fromStageId: sales.stages[1], toStageId: sales.stages[1] })).toEqual({ status: "same" });
    expect(await dealEvents(id)).toEqual([]);
    expect((await dealRow(id))!.version).toBe(1);
  });

  it("refuses as stale when the deal changed since the board was loaded, and changes nothing", async () => {
    const [leadIn, qualified, proposal] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: qualified, createdBy: ada.id });
    // Wrong version (someone edited it).
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 7, fromStageId: qualified, toStageId: proposal })).toEqual({ status: "stale" });
    // Someone else moved it.
    await deals.moveDeal(linus.id, { dealId: id, version: 1, fromStageId: qualified, toStageId: leadIn });
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 1, fromStageId: qualified, toStageId: proposal })).toEqual({ status: "stale" });
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 2, fromStageId: qualified, toStageId: proposal })).toEqual({ status: "stale" });
    // Unknown target stage.
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 2, fromStageId: leadIn, toStageId: 999999 })).toEqual({ status: "stale" });
    // Archived.
    await deals.archiveDeal(linus.id, id);
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 3, fromStageId: leadIn, toStageId: proposal })).toEqual({ status: "stale" });
    expect((await dealRow(id))!.stage_id).toBe(leadIn);
    // Deleted.
    await deals.deleteDeal(ada.id, id);
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 3, fromStageId: leadIn, toStageId: proposal })).toEqual({ status: "stale" });
    // Not visible (private to someone else).
    const hidden = await makeDeal({ title: "Secret", stageId: qualified, createdBy: ada.id, private: true });
    expect(await deals.moveDeal(linus.id, { dealId: hidden, version: 1, fromStageId: qualified, toStageId: proposal })).toEqual({ status: "stale" });
    expect((await dealRow(hidden))!.stage_id).toBe(qualified);
  });

  it("keeps exactly one open period per deal through many moves, including at the same time", async () => {
    const [leadIn, qualified, proposal] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: leadIn, createdBy: ada.id });
    await deals.moveDeal(ada.id, { dealId: id, version: 1, fromStageId: leadIn, toStageId: qualified });
    await deals.moveDeal(ada.id, { dealId: id, version: 2, fromStageId: qualified, toStageId: proposal });
    await deals.moveDeal(ada.id, { dealId: id, version: 3, fromStageId: null, toStageId: partners.stages[1] });
    expect((await periods(id)).map((p) => [p.stage_name, p.open])).toEqual([
      ["Lead in", false],
      ["Qualified", false],
      ["Proposal", false],
      ["Talking", true],
    ]);
    const results = await Promise.all([
      deals.moveDeal(ada.id, { dealId: id, version: 4, fromStageId: partners.stages[1], toStageId: partners.stages[0] }),
      deals.moveDeal(linus.id, { dealId: id, version: 4, fromStageId: partners.stages[1], toStageId: leadIn }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["moved", "stale"]);
    expect(await openPeriods()).toEqual([]);
    expect((await periods(id)).filter((p) => p.open).length).toBe(1);
  });
});
