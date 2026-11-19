// covers FR-001, FR-002, FR-003, FR-004, SC-006, SC-007, US5 scenarios 1–7, edge case "the last stage of a pipeline
// with deals cannot be deleted", clarification "no other pipeline with a stage: pipeline delete refused"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import * as pipelines from "@/server/deals/pipelines";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealCount, dealEvents, dealRow, makeDeal, makePipeline, periods } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

const names = async () => (await pipelines.listPipelines()).map((p) => p.name);
const stageNames = async (id: number) => (await pipelines.getPipelineWithStages(id))!.stages.map((s) => s.name);
async function positions(table: "pipelines" | "stages") {
  return (await sql<{ position: number }[]>`select position from ${sql(table)} order by position`).map((r) => r.position);
}
function okId(r: pipelines.PipelineResult): number {
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r.id;
}
function okStage(r: pipelines.PipelineResult): number {
  if (r.status !== "ok" || r.stageId === undefined) throw new Error(JSON.stringify(r));
  return r.stageId;
}

describe("pipelines", () => {
  it("are added last with no stages, and show on the board with no columns (US5 scenario 1)", async () => {
    await makePipeline("Sales", ["Lead in"]);
    const id = okId(await pipelines.addPipeline(ada.id, "  Partners  "));
    expect(await names()).toEqual(["Sales", "Partners"]);
    expect(await pipelines.getPipelineWithStages(id)).toEqual({ id, name: "Partners", deals: 0, stages: [] });
    const board = (await deals.getBoard(linus.id, id))!;
    expect(board.pipelines.map((p) => p.name)).toEqual(["Sales", "Partners"]);
    expect(board.columns).toEqual([]);
  });

  it("need a name unique ignoring case and outer spaces (FR-001, US5 scenario 6)", async () => {
    const sales = okId(await pipelines.addPipeline(ada.id, "Sales"));
    const other = okId(await pipelines.addPipeline(ada.id, "Partners"));
    expect(await pipelines.addPipeline(ada.id, " sales ")).toEqual({ status: "invalid", code: "pipeline_name_exists" });
    expect(await pipelines.addPipeline(ada.id, "   ")).toEqual({ status: "invalid", code: "pipeline_name_required" });
    expect(await pipelines.renamePipeline(ada.id, other, "SALES")).toEqual({ status: "invalid", code: "pipeline_name_exists" });
    expect(await pipelines.renamePipeline(ada.id, sales, "sales")).toEqual({ status: "ok", id: sales });
    expect(await names()).toEqual(["sales", "Partners"]);
    expect(await pipelines.renamePipeline(ada.id, 999999, "Nope")).toEqual({ status: "not_found" });
  });

  it("refuse a duplicate added at the same time (unique-index race)", async () => {
    const results = await Promise.all([pipelines.addPipeline(ada.id, "Sales"), pipelines.addPipeline(ada.id, "SALES")]);
    expect(results.map((r) => r.status).sort()).toEqual(["invalid", "ok"]);
    expect(results.find((r) => r.status === "invalid")).toEqual({ status: "invalid", code: "pipeline_name_exists" });
    expect((await names()).length).toBe(1);
  });

  it("are reordered with up and down, renumbered 1..n (US5 scenario 3)", async () => {
    const a = okId(await pipelines.addPipeline(ada.id, "A"));
    okId(await pipelines.addPipeline(ada.id, "B"));
    const c = okId(await pipelines.addPipeline(ada.id, "C"));
    await pipelines.movePipeline(ada.id, c, "up");
    expect(await names()).toEqual(["A", "C", "B"]);
    await pipelines.movePipeline(ada.id, a, "up"); // first up: no change
    await pipelines.movePipeline(ada.id, a, "down");
    expect(await names()).toEqual(["C", "A", "B"]);
    expect(await positions("pipelines")).toEqual([1, 2, 3]);
    // The first one is the default board.
    expect((await deals.getBoard(linus.id, null))!.pipeline.name).toBe("C");
  });

  it("with no deals are deleted with their stages; positions renumbered", async () => {
    const a = await makePipeline("A", ["One", "Two"]);
    await makePipeline("B", ["Three"]);
    expect(await pipelines.deletePipeline(ada.id, a.id, null)).toEqual({ status: "ok", id: a.id });
    expect(await names()).toEqual(["B"]);
    expect(await positions("pipelines")).toEqual([1]);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from stages`;
    expect(n).toBe(1);
  });

  it("with deals need a stage of another pipeline; every deal moves there, archived ones too (FR-004, SC-007)", async () => {
    const sales = await makePipeline("Sales", ["Lead in", "Qualified"]);
    const partners = await makePipeline("Partners", ["Intro", "Talking"]);
    const d1 = await makeDeal({ title: "One", stageId: sales.stages[0], createdBy: linus.id });
    const d2 = await makeDeal({ title: "Two", stageId: sales.stages[1], createdBy: linus.id, archived: true });
    const d3 = await makeDeal({ title: "Three", stageId: sales.stages[1], createdBy: linus.id, private: true });
    const before = await dealCount();
    expect(await pipelines.deletePipeline(ada.id, sales.id, null)).toEqual({ status: "invalid", code: "pipeline_target_invalid" });
    expect(await pipelines.deletePipeline(ada.id, sales.id, sales.stages[0])).toEqual({ status: "invalid", code: "pipeline_target_invalid" });
    expect(await pipelines.deletePipeline(ada.id, sales.id, 999999)).toEqual({ status: "invalid", code: "pipeline_target_invalid" });
    expect(await names()).toEqual(["Sales", "Partners"]);
    expect(await pipelines.deletePipeline(ada.id, sales.id, partners.stages[1])).toEqual({ status: "ok", id: sales.id });
    expect(await dealCount()).toBe(before);
    for (const id of [d1, d2, d3]) expect((await dealRow(id))!.stage_id).toBe(partners.stages[1]);
    expect((await dealRow(d2))!.archived).toBe(true);
    expect((await dealEvents(d1)).at(-1)).toMatchObject({ kind: "moved", actor_id: ada.id, from_stage: "Sales · Lead in", to_stage: "Partners · Talking", cause: "pipeline_deleted" });
    expect((await periods(d1)).map((p) => [p.stage_id, p.stage_name, p.open])).toEqual([
      [null, "Lead in", false],
      [partners.stages[1], "Talking", true],
    ]);
    expect(await names()).toEqual(["Partners"]);
  });

  it("with deals are not deleted when no other pipeline has a stage", async () => {
    const sales = await makePipeline("Sales", ["Lead in"]);
    await makePipeline("Empty", []);
    await makeDeal({ title: "One", stageId: sales.stages[0], createdBy: linus.id });
    expect(await pipelines.deletePipeline(ada.id, sales.id, sales.stages[0])).toEqual({ status: "invalid", code: "pipeline_delete_no_target" });
    expect(await dealCount()).toBe(1);
    expect(await names()).toEqual(["Sales", "Empty"]);
  });
});

describe("stages", () => {
  it("are added last, renamed and reordered; deals stay in their renamed stage (US5 scenario 2)", async () => {
    const p = okId(await pipelines.addPipeline(ada.id, "Partners"));
    const intro = okStage(await pipelines.addStage(ada.id, p, "Intro"));
    const talking = okStage(await pipelines.addStage(ada.id, p, "Talking"));
    const signed = okStage(await pipelines.addStage(ada.id, p, "Signed"));
    const deal = await makeDeal({ title: "One", stageId: talking, createdBy: linus.id });
    expect(await pipelines.renameStage(ada.id, talking, "In talks")).toEqual({ status: "ok", id: p });
    await pipelines.moveStage(ada.id, signed, "up");
    await pipelines.moveStage(ada.id, signed, "up");
    await pipelines.moveStage(ada.id, signed, "up"); // already first
    expect(await stageNames(p)).toEqual(["Signed", "Intro", "In talks"]);
    expect(await pipelines.deleteStage(ada.id, intro, null)).toEqual({ status: "ok", id: p });
    expect(await stageNames(p)).toEqual(["Signed", "In talks"]);
    expect(await positions("stages")).toEqual([1, 2]);
    expect((await deals.getBoard(linus.id, p))!.columns.map((c) => [c.name, c.count])).toEqual([
      ["Signed", 0],
      ["In talks", 1],
    ]);
    expect((await dealRow(deal))!.stage_id).toBe(talking);
    expect((await pipelines.getPipelineWithStages(p))!.stages).toEqual([
      { id: signed, name: "Signed", deals: 0 },
      { id: talking, name: "In talks", deals: 1 },
    ]);
  });

  it("need a name unique within their pipeline; the same name is fine in another pipeline (FR-002)", async () => {
    const a = await makePipeline("A", ["Intro"]);
    const b = await makePipeline("B", []);
    expect(await pipelines.addStage(ada.id, a.id, " INTRO ")).toEqual({ status: "invalid", code: "pipeline_name_exists" });
    expect(await pipelines.addStage(ada.id, a.id, "")).toEqual({ status: "invalid", code: "pipeline_name_required" });
    expect((await pipelines.addStage(ada.id, b.id, "Intro")).status).toBe("ok");
    const second = await pipelines.addStage(ada.id, a.id, "Second");
    expect(second).toEqual({ status: "ok", id: a.id, stageId: expect.any(Number) });
    expect(await pipelines.renameStage(ada.id, a.stages[0], "second")).toEqual({ status: "invalid", code: "pipeline_name_exists" });
    expect(await pipelines.addStage(ada.id, 999999, "Nope")).toEqual({ status: "not_found" });
  });

  it("with deals move them to another stage of the same pipeline, with '(stage deleted)' history (US5 scenario 4)", async () => {
    const sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal"]);
    const other = await makePipeline("Partners", ["Intro"]);
    const [, qualified, proposal] = sales.stages;
    const d1 = await makeDeal({ title: "One", stageId: qualified, createdBy: linus.id });
    const d2 = await makeDeal({ title: "Two", stageId: qualified, createdBy: linus.id, archived: true });
    const before = await dealCount();
    expect(await pipelines.deleteStage(ada.id, qualified, null)).toEqual({ status: "invalid", code: "stage_target_invalid" });
    expect(await pipelines.deleteStage(ada.id, qualified, qualified)).toEqual({ status: "invalid", code: "stage_target_invalid" });
    expect(await pipelines.deleteStage(ada.id, qualified, other.stages[0])).toEqual({ status: "invalid", code: "stage_target_invalid" });
    expect(await pipelines.deleteStage(ada.id, qualified, proposal)).toEqual({ status: "ok", id: sales.id });
    expect(await dealCount()).toBe(before);
    for (const id of [d1, d2]) expect((await dealRow(id))!.stage_id).toBe(proposal);
    expect((await dealEvents(d2)).at(-1)).toMatchObject({ kind: "moved", from_stage: "Qualified", to_stage: "Proposal", cause: "stage_deleted" });
    expect(await stageNames(sales.id)).toEqual(["Lead in", "Proposal"]);
  });

  it("the last stage of a pipeline with deals cannot be deleted", async () => {
    const sales = await makePipeline("Sales", ["Only"]);
    await makeDeal({ title: "One", stageId: sales.stages[0], createdBy: linus.id });
    expect(await pipelines.deleteStage(ada.id, sales.stages[0], null)).toEqual({ status: "invalid", code: "stage_last_with_deals" });
    expect(await stageNames(sales.id)).toEqual(["Only"]);
  });
});

describe("admin rights (FR-003, SC-006)", () => {
  it("every change by a non-admin or a deactivated admin is refused and nothing changes", async () => {
    const sales = await makePipeline("Sales", ["Lead in", "Qualified"]);
    const other = await makePipeline("Partners", ["Intro"]);
    await makeDeal({ title: "One", stageId: sales.stages[0], createdBy: linus.id });
    const gone = await makeUser({ email: "grace@barnacle.ai", role: "admin", status: "deactivated" });
    const snapshot = async () => ({
      p: await sql`select id, name, position from pipelines order by id`,
      s: await sql`select id, pipeline_id, name, position from stages order by id`,
      d: await sql`select id, stage_id, version from deals order by id`,
    });
    const before = await snapshot();
    for (const u of [linus, gone]) {
      const forbidden = { status: "forbidden" };
      expect(await pipelines.addPipeline(u.id, "New")).toEqual(forbidden);
      expect(await pipelines.renamePipeline(u.id, sales.id, "New")).toEqual(forbidden);
      expect(await pipelines.movePipeline(u.id, other.id, "up")).toEqual(forbidden);
      expect(await pipelines.deletePipeline(u.id, sales.id, other.stages[0])).toEqual(forbidden);
      expect(await pipelines.addStage(u.id, sales.id, "New")).toEqual(forbidden);
      expect(await pipelines.renameStage(u.id, sales.stages[0], "New")).toEqual(forbidden);
      expect(await pipelines.moveStage(u.id, sales.stages[1], "up")).toEqual(forbidden);
      expect(await pipelines.deleteStage(u.id, sales.stages[0], sales.stages[1])).toEqual(forbidden);
    }
    expect(await snapshot()).toEqual(before);
  });
});
