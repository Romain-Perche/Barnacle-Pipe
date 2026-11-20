// covers SF-95 FR-002, SC-004, US1 scenario 2, Edge Cases (whole days; a stage visited twice; another pipeline's stages)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { stageBar } from "@/server/deals/rules";
import { runSeeders } from "@/seed";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline, setPeriods } from "./deal-helpers";

let ada: TestUser;
let sales: { id: number; stages: number[] };
let partners: { id: number; stages: number[] };

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal", "Negotiation", "Closing"]);
  partners = await makePipeline("Partners", ["Intro", "Talking"]);
});
afterAll(closeDb);

async function bar(dealId: number, pipelineId: number, current: number) {
  return stageBar(await deals.getStageSeconds(dealId, pipelineId), current).map((s) => [s.name, s.state, s.days]);
}

describe("days per stage", () => {
  it("shows 3 days in Qualified, 5 days now in Proposal, 0 for a skipped stage and no count after", async () => {
    const [leadIn, qualified, proposal] = sales.stages;
    void leadIn;
    const id = await makeDeal({ title: "Fakeco website", stageId: proposal, createdBy: ada.id });
    await setPeriods(id, [[qualified, 3], [proposal, 5]]);
    expect(await bar(id, sales.id, proposal)).toEqual([
      ["Lead in", "done", 0],
      ["Qualified", "done", 3],
      ["Proposal", "now", 5],
      ["Negotiation", "next", null],
      ["Closing", "next", null],
    ]);
  });

  it("adds both periods when a deal left a stage and came back", async () => {
    const [, qualified, proposal] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: proposal, createdBy: ada.id });
    // 1.5 + 1.5 days in Qualified = 3 days (sum first, then round down).
    await setPeriods(id, [[qualified, 1.5], [proposal, 2], [qualified, 1.5], [proposal, 0.2]]);
    expect(await bar(id, sales.id, proposal)).toEqual([
      ["Lead in", "done", 0],
      ["Qualified", "done", 3],
      ["Proposal", "now", 2],
      ["Negotiation", "next", null],
      ["Closing", "next", null],
    ]);
  });

  it("shows only the current pipeline's stages for a deal moved from another pipeline", async () => {
    const [intro, talking] = partners.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: talking, createdBy: ada.id });
    await setPeriods(id, [[sales.stages[2], 4], [intro, 2], [talking, 1]]);
    await sql`update deals set stage_id = ${talking} where id = ${id}`;
    expect(await bar(id, partners.id, talking)).toEqual([
      ["Intro", "done", 2],
      ["Talking", "now", 1],
    ]);
  });

  // SC-004: for every seeded deal the days shown equal the recorded periods.
  it("equals floor(sum(periods) / 1 day) per stage for every deal of the fake data", async () => {
    await resetDb();
    await runSeeders(sql);
    const all = await sql<{ id: number; pipeline_id: number; stage_id: number }[]>`
      select d.id::int as id, s.pipeline_id::int as pipeline_id, d.stage_id::int as stage_id from deals d join stages s on s.id = d.stage_id`;
    expect(all.length).toBeGreaterThan(40);
    let checked = 0;
    for (const d of all) {
      const shown = stageBar(await deals.getStageSeconds(d.id, d.pipeline_id), d.stage_id);
      const recorded = await sql<{ stage_id: number; days: number }[]>`
        select stage_id::int as stage_id,
               floor(sum(extract(epoch from coalesce(left_at, now()) - entered_at)) / 86400)::int as days
        from deal_stage_periods where deal_id = ${d.id} and stage_id is not null group by stage_id`;
      const byStage = new Map(recorded.map((r) => [r.stage_id, r.days]));
      for (const s of shown) {
        if (s.state === "next") continue;
        expect(s.days, `deal ${d.id} stage ${s.name}`).toBe(byStage.get(s.id) ?? 0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
    // The fake data gives the bar varied counts (FR-023).
    const [{ n }] = await sql<{ n: number }[]>`
      select count(distinct floor(extract(epoch from coalesce(left_at, now()) - entered_at) / 86400))::int as n from deal_stage_periods`;
    expect(n).toBeGreaterThan(3);
  });
});
