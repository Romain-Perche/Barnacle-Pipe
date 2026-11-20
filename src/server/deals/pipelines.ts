// Pipelines and their stages (research.md §6, contracts/routes.md): read for everyone, changed by admins only.
// Every change re-checks, in its transaction, that the actor is an active admin. Deleting a stage or a pipeline
// moves its deals (archived and private ones included) with a history line; it never deletes a deal (SC-007).
import { sql, type Sql } from "@/server/db";
import { dealStageRef, transferDeal } from "@/server/deals/deals";
import { validatePipelineName } from "@/server/deals/rules";
import { isActiveAdmin, isUniqueViolation, type Option } from "@/server/records/common";
import type { MoveCause } from "@/server/records/timeline";

export { stageChoices } from "@/server/deals/deals";

export type PipelineCode =
  | "pipeline_name_required"
  | "pipeline_name_exists"
  | "stage_last_with_deals"
  | "stage_target_invalid"
  | "pipeline_target_invalid"
  | "pipeline_delete_no_target";
// `id` is always the pipeline the change was made in (the page to go back to); `stageId` for an added stage.
export type PipelineResult =
  | { status: "ok"; id: number; stageId?: number }
  | { status: "invalid"; code: PipelineCode }
  | { status: "forbidden" }
  | { status: "not_found" };
export type Direction = "up" | "down";
export type PipelineDetail = { id: number; name: string; deals: number; stages: { id: number; name: string; deals: number }[] };

const NAME_KEYS = ["pipelines_name_key", "stages_name_key"];

class Stop extends Error {
  constructor(readonly result: PipelineResult) {
    super(result.status);
  }
}
const stop = (code: PipelineCode): never => {
  throw new Stop({ status: "invalid", code });
};
const notFound = (): never => {
  throw new Stop({ status: "not_found" });
};

export async function listPipelines(): Promise<Option[]> {
  return [...(await sql<Option[]>`select id::int as id, name from pipelines order by position, id`)];
}

// One pipeline with its stages in order and how many deals each holds (archived and private included: they all
// move when the stage is deleted).
export async function getPipelineWithStages(id: number): Promise<PipelineDetail | null> {
  const [p] = await sql<{ id: number; name: string }[]>`select id::int as id, name from pipelines where id = ${id}`;
  if (!p) return null;
  const stages = await sql<{ id: number; name: string; deals: number }[]>`
    select s.id::int as id, s.name, (select count(*)::int from deals d where d.stage_id = s.id) as deals
    from stages s where s.pipeline_id = ${id} order by s.position, s.id`;
  return { ...p, deals: stages.reduce((n, s) => n + s.deals, 0), stages: [...stages] };
}

// Deals per pipeline, for the delete confirmation of the Pipelines page.
export async function pipelineDealCount(id: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from deals d join stages s on s.id = d.stage_id where s.pipeline_id = ${id}`;
  return row.n;
}

async function asAdmin(actorId: number, change: (db: Sql) => Promise<PipelineResult>): Promise<PipelineResult> {
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      if (!(await isActiveAdmin(db, actorId))) return { status: "forbidden" as const };
      return change(db);
    });
  } catch (err) {
    if (err instanceof Stop) return err.result;
    if (NAME_KEYS.some((key) => isUniqueViolation(err, key))) return { status: "invalid", code: "pipeline_name_exists" };
    throw err;
  }
}

function nameOf(raw: string): string {
  const v = validatePipelineName(raw);
  return v.ok ? v.name : stop(v.code);
}

// Locks and returns the rows in their order (pipelines, or the stages of one pipeline).
async function lockedPipelines(db: Sql): Promise<number[]> {
  return (await db<{ id: number }[]>`select id::int as id from pipelines order by position, id for update`).map((r) => r.id);
}
async function lockedStages(db: Sql, pipelineId: number): Promise<number[]> {
  const [p] = await db`select 1 from pipelines where id = ${pipelineId} for update`;
  if (!p) notFound();
  return (await db<{ id: number }[]>`select id::int as id from stages where pipeline_id = ${pipelineId} order by position, id for update`).map((r) => r.id);
}

async function renumber(db: Sql, table: "pipelines" | "stages", ids: number[]) {
  for (const [i, id] of ids.entries()) await db`update ${db(table)} set position = ${i + 1} where id = ${id} and position <> ${i + 1}`;
}

function swap(ids: number[], id: number, dir: Direction): number[] | null {
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

async function stagePipeline(db: Sql, stageId: number): Promise<number> {
  const [s] = await db<{ pipeline_id: number }[]>`select pipeline_id::int as pipeline_id from stages where id = ${stageId}`;
  return s ? s.pipeline_id : notFound();
}

// --- Pipelines -----------------------------------------------------------------------------------------------

export function addPipeline(actorId: number, raw: string): Promise<PipelineResult> {
  return asAdmin(actorId, async (db) => {
    const name = nameOf(raw);
    const ids = await lockedPipelines(db);
    const [same] = await db`select 1 from pipelines where lower(name) = lower(${name})`;
    if (same) stop("pipeline_name_exists");
    const [row] = await db<{ id: number }[]>`
      insert into pipelines (name, position) values (${name}, ${ids.length + 1}) returning id::int as id`;
    return { status: "ok", id: row.id };
  });
}

export function renamePipeline(actorId: number, id: number, raw: string): Promise<PipelineResult> {
  return asAdmin(actorId, async (db) => {
    const name = nameOf(raw);
    const [same] = await db`select 1 from pipelines where lower(name) = lower(${name}) and id <> ${id}`;
    if (same) stop("pipeline_name_exists");
    const rows = await db`update pipelines set name = ${name} where id = ${id} returning id`;
    return rows.length === 1 ? { status: "ok", id } : { status: "not_found" };
  });
}

export function movePipeline(actorId: number, id: number, dir: Direction): Promise<PipelineResult> {
  return asAdmin(actorId, async (db) => {
    const ids = await lockedPipelines(db);
    if (!ids.includes(id)) return { status: "not_found" };
    const next = swap(ids, id, dir);
    if (next) await renumber(db, "pipelines", next);
    return { status: "ok", id };
  });
}

// Moves every deal of the given stages to `to`, with a "moved" history line and a new stage period.
async function moveAllDeals(db: Sql, actorId: number, where: { stageId: number } | { pipelineId: number }, toStageId: number, cause: MoveCause) {
  const to = (await dealStageRef(db, toStageId))!;
  const rows = await db<{ id: number; stage_id: number }[]>`
    select d.id::int as id, d.stage_id::int as stage_id from deals d
    where ${"stageId" in where ? db`d.stage_id = ${where.stageId}` : db`d.stage_id in (select id from stages where pipeline_id = ${where.pipelineId})`}
    order by d.id for update`;
  const from = new Map<number, Awaited<ReturnType<typeof dealStageRef>>>();
  for (const r of rows) {
    if (!from.has(r.stage_id)) from.set(r.stage_id, await dealStageRef(db, r.stage_id));
    await transferDeal(db, r.id, from.get(r.stage_id)!, to, actorId, cause);
  }
}

// A pipeline with deals needs a stage of another pipeline to move them to (FR-004).
export function deletePipeline(actorId: number, id: number, targetStageId: number | null): Promise<PipelineResult> {
  return asAdmin(actorId, async (db) => {
    const ids = await lockedPipelines(db);
    if (!ids.includes(id)) return { status: "not_found" };
    const [{ n }] = await db<{ n: number }[]>`
      select count(*)::int as n from deals d join stages s on s.id = d.stage_id where s.pipeline_id = ${id}`;
    if (n > 0) {
      const [elsewhere] = await db`select 1 from stages where pipeline_id <> ${id} limit 1`;
      if (!elsewhere) stop("pipeline_delete_no_target");
      const target = targetStageId === null ? undefined : await dealStageRef(db, targetStageId);
      if (!target || target.pipelineId === id) stop("pipeline_target_invalid");
      await moveAllDeals(db, actorId, { pipelineId: id }, target!.id, "pipeline_deleted");
    }
    await db`delete from pipelines where id = ${id}`;
    await renumber(db, "pipelines", ids.filter((x) => x !== id));
    return { status: "ok", id };
  });
}

// --- Stages --------------------------------------------------------------------------------------------------

export function addStage(actorId: number, pipelineId: number, raw: string): Promise<PipelineResult> {
  return asAdmin(actorId, async (db) => {
    const name = nameOf(raw);
    const ids = await lockedStages(db, pipelineId);
    const [same] = await db`select 1 from stages where pipeline_id = ${pipelineId} and lower(name) = lower(${name})`;
    if (same) stop("pipeline_name_exists");
    const [row] = await db<{ id: number }[]>`
      insert into stages (pipeline_id, name, position) values (${pipelineId}, ${name}, ${ids.length + 1}) returning id::int as id`;
    return { status: "ok", id: pipelineId, stageId: row.id };
  });
}

export function renameStage(actorId: number, id: number, raw: string): Promise<PipelineResult> {
  return asAdmin(actorId, async (db) => {
    const name = nameOf(raw);
    const pipelineId = await stagePipeline(db, id);
    const [same] = await db`select 1 from stages where pipeline_id = ${pipelineId} and lower(name) = lower(${name}) and id <> ${id}`;
    if (same) stop("pipeline_name_exists");
    await db`update stages set name = ${name} where id = ${id}`;
    return { status: "ok", id: pipelineId };
  });
}

export function moveStage(actorId: number, id: number, dir: Direction): Promise<PipelineResult> {
  return asAdmin(actorId, async (db) => {
    const pipelineId = await stagePipeline(db, id);
    const ids = await lockedStages(db, pipelineId);
    const next = swap(ids, id, dir);
    if (next) await renumber(db, "stages", next);
    return { status: "ok", id: pipelineId };
  });
}

// A stage with deals needs another stage of the same pipeline to move them to; the last stage of a pipeline with
// deals stays (FR-004, edge cases).
export function deleteStage(actorId: number, id: number, targetStageId: number | null): Promise<PipelineResult> {
  return asAdmin(actorId, async (db) => {
    const pipelineId = await stagePipeline(db, id);
    const ids = await lockedStages(db, pipelineId);
    if (!ids.includes(id)) return { status: "not_found" };
    const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from deals where stage_id = ${id}`;
    if (n > 0) {
      if (ids.length === 1) stop("stage_last_with_deals");
      if (targetStageId === null || targetStageId === id || !ids.includes(targetStageId)) stop("stage_target_invalid");
      await moveAllDeals(db, actorId, { stageId: id }, targetStageId!, "stage_deleted");
    }
    await db`delete from stages where id = ${id}`;
    await renumber(db, "stages", ids.filter((x) => x !== id));
    return { status: "ok", id: pipelineId };
  });
}
