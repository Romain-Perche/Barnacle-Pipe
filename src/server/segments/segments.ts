// SF-120 saved segments (contracts/routes.md § Domain functions; research.md §5, §6, §8): shared by the whole team, so
// no owner or admin check here (the pages and actions call requireUser() first). A segment stores its definition only;
// counts are worked out by reach.ts at each read for the viewer. No timeline entries or notifications.
import { sql, type Sql } from "@/server/db";
import { listFields } from "@/server/custom-fields/fields";
import type { CustomField } from "@/server/custom-fields/rules";
import { messages, templates } from "@/server/messages";
import { isUniqueViolation } from "@/server/records/common";
import { countReach } from "@/server/segments/reach";
import {
  describeSegment, readConditions, referencedIds, validateSegmentForm,
  type Definition, type DealStatus, type Description, type FormOptions, type Names, type Reach, type SegmentErrors,
  type SegmentFormValues, type SegmentWho,
} from "@/server/segments/rules";

type SegmentRow = {
  id: number; name: string; who: SegmentWho; pipeline_id: number | null; stage_id: number | null; deal_status: DealStatus | null;
  conditions: unknown; updated_by: number; updated_by_name: string; updated_at: Date; version: number;
};
const COLUMNS = (db: Sql) => db`s.id::int as id, s.name, s.who, s.pipeline_id::int as pipeline_id, s.stage_id::int as stage_id,
  s.deal_status, s.conditions, s.updated_by::int as updated_by, u.name as updated_by_name, s.updated_at, s.version`;

function definitionOf(r: SegmentRow): Definition {
  return { who: r.who, pipelineId: r.pipeline_id, stageId: r.stage_id, dealStatus: r.deal_status, conditions: readConditions(r.conditions) };
}

const uniq = (ids: number[]) => [...new Set(ids)];
const byId = <T extends { id: number }, V>(rows: readonly T[], f: (r: T) => V) => Object.fromEntries(rows.map((r) => [r.id, f(r)])) as Record<number, V>;

// The names of every id the definitions refer to, in a few `= any($ids)` queries for all of them at once.
async function loadNames(defs: Definition[], fields: CustomField[], db: Sql = sql): Promise<Names> {
  const all = defs.map(referencedIds);
  const ids = (k: keyof ReturnType<typeof referencedIds>) => uniq(all.flatMap((x) => x[k]));
  const [pipelines, stages, leadSources, labels, organisations, users] = [
    await db<{ id: number; name: string }[]>`select id::int as id, name from pipelines where id = any(${ids("pipelines")}::bigint[])`,
    await db<{ id: number; name: string; pipeline_id: number }[]>`
      select id::int as id, name, pipeline_id::int as pipeline_id from stages where id = any(${ids("stages")}::bigint[])`,
    await db<{ id: number; name: string; removed: boolean }[]>`
      select id::int as id, name, removed_at is not null as removed from lead_sources where id = any(${ids("leadSources")}::bigint[])`,
    await db<{ id: number; name: string; removed: boolean }[]>`
      select id::int as id, name, removed_at is not null as removed from labels where id = any(${ids("labels")}::bigint[])`,
    await db<{ id: number; name: string; archived: boolean }[]>`
      select id::int as id, name, archived_at is not null as archived from organisations where id = any(${ids("organisations")}::bigint[])`,
    await db<{ id: number; name: string; active: boolean }[]>`
      select id::int as id, name, status = 'active' as active from users where id = any(${ids("users")}::bigint[])`,
  ];
  return {
    pipelines: byId(pipelines, (r) => ({ name: r.name })),
    stages: byId(stages, (r) => ({ name: r.name, pipelineId: r.pipeline_id })),
    leadSources: byId(leadSources, (r) => ({ name: r.name, removed: r.removed })),
    labels: byId(labels, (r) => ({ name: r.name, removed: r.removed })),
    organisations: byId(organisations, (r) => ({ name: r.name, archived: r.archived })),
    users: byId(users, (r) => ({ name: r.name, active: r.active })),
    fields: byId(fields, (f) => ({ name: f.name, type: f.type, choices: byId(f.choices, (c) => ({ name: c.name, removed: c.removed })) })),
  };
}

export type SegmentListRow = {
  id: number; name: string; summary: string; broken: boolean; reaches: number; updatedBy: string; updatedAt: Date;
};

// The Segments page: every segment ordered by name, each with its summary and its count for the viewer now. One count
// query per segment, one after the other (research.md §9: no contention for the pooled connections).
export async function listSegments(viewerId: number): Promise<SegmentListRow[]> {
  const rows = await sql<SegmentRow[]>`
    select ${COLUMNS(sql)} from segments s join users u on u.id = s.updated_by order by lower(s.name), s.id`;
  if (rows.length === 0) return [];
  const fields = await listFields("person");
  const defs = rows.map(definitionOf);
  const names = await loadNames(defs, fields);
  const out: SegmentListRow[] = [];
  for (const [i, r] of rows.entries()) {
    const d = describeSegment(defs[i], names);
    const reach = await countReach(viewerId, defs[i], sql, fields);
    out.push({ id: r.id, name: r.name, summary: d.summary, broken: d.broken, reaches: reach.reaches, updatedBy: r.updated_by_name, updatedAt: r.updated_at });
  }
  return out;
}

export type SegmentView = {
  id: number; name: string; version: number; definition: Definition; description: Description; reach: Reach;
  updatedBy: string; updatedAt: Date;
};

export async function getSegment(viewerId: number, id: number): Promise<SegmentView | null> {
  const [r] = await sql<SegmentRow[]>`select ${COLUMNS(sql)} from segments s join users u on u.id = s.updated_by where s.id = ${id}`;
  if (!r) return null;
  const fields = await listFields("person");
  const definition = definitionOf(r);
  const description = describeSegment(definition, await loadNames([definition], fields));
  const reach = await countReach(viewerId, definition, sql, fields);
  return { id: r.id, name: r.name, version: r.version, definition, description, reach, updatedBy: r.updated_by_name, updatedAt: r.updated_at };
}

// The options of the add / edit form (research.md §8). `def`: the stored definition of the segment being edited, whose
// removed lead sources, labels and choices, and deleted pipeline, stage, organisations, fields and choices are added
// (deleted ones as "(deleted)") so it can be saved as it is.
export async function segmentFormOptions(def: Definition | null, db: Sql = sql): Promise<FormOptions> {
  const used = def ? referencedIds(def) : referencedIds({ who: "everyone", pipelineId: null, stageId: null, dealStatus: null, conditions: [] });
  const usedChoices = (def?.conditions ?? []).flatMap((c) => (c.field === "custom" && "ids" in c ? c.ids : []));
  const DELETED = messages.segment_deleted_mark;
  const mark = (name: string, on: boolean, word: string) => (on ? `${name} ${word}` : name);

  const pipelines = await db<{ id: number; name: string }[]>`select id::int as id, name from pipelines order by position, id`;
  const stages = await db<{ id: number; name: string; pipeline_id: number }[]>`
    select id::int as id, name, pipeline_id::int as pipeline_id from stages order by position, id`;
  const pipelineOptions = pipelines.map((p) => ({ id: p.id, name: p.name, stages: stages.filter((s) => s.pipeline_id === p.id).map((s) => ({ id: s.id, name: s.name })) }));
  if (def?.pipelineId != null) {
    let p = pipelineOptions.find((x) => x.id === def.pipelineId);
    if (!p) pipelineOptions.push((p = { id: def.pipelineId, name: DELETED, stages: [] }));
    if (def.stageId !== null && !p.stages.some((s) => s.id === def.stageId)) p.stages.push({ id: def.stageId, name: DELETED });
  }

  const choiceList = async (table: "lead_sources" | "labels", keep: number[]) => {
    const rows = await db<{ id: number; name: string; removed: boolean }[]>`
      select id::int as id, name, removed_at is not null as removed from ${db(table)}
      where removed_at is null or id = any(${keep}::bigint[]) order by lower(name), id`;
    return rows.map((r) => ({ id: r.id, name: mark(r.name, r.removed, messages.segment_removed_mark) }));
  };
  const leadSources = await choiceList("lead_sources", used.leadSources);
  const labels = await choiceList("labels", used.labels);

  const orgRows = await db<{ id: number; name: string; archived: boolean }[]>`
    select id::int as id, name, archived_at is not null as archived from organisations order by lower(name), id`;
  const organisations = orgRows.map((o) => ({ id: o.id, name: mark(o.name, o.archived, messages.segment_archived_mark) }));
  for (const id of uniq(used.organisations)) if (!organisations.some((o) => o.id === id)) organisations.push({ id, name: DELETED });

  const userRows = await db<{ id: number; name: string; active: boolean }[]>`
    select id::int as id, name, status = 'active' as active from users order by lower(name), id`;
  const owners = userRows.map((u) => ({ id: u.id, name: mark(u.name, !u.active, messages.segment_deactivated_mark) }));

  const fields: FormOptions["fields"] = (await listFields("person", db)).map((f) => ({
    id: f.id, name: f.name, type: f.type,
    choices: f.choices.filter((c) => !c.removed || usedChoices.includes(c.id)).map((c) => ({ id: c.id, name: mark(c.name, c.removed, messages.segment_removed_mark) })),
  }));
  for (const c of def?.conditions ?? []) {
    if (c.field !== "custom") continue;
    let f = fields.find((x) => x.id === c.fieldId);
    if (f && f.type !== c.type) continue; // another type: the condition cannot be kept as it is
    if (!f) fields.push((f = { id: c.fieldId, name: DELETED, type: c.type, choices: [] }));
    for (const id of "ids" in c ? c.ids : []) if (!f.choices.some((x) => x.id === id)) f.choices.push({ id, name: DELETED });
  }
  return { pipelines: pipelineOptions, leadSources, labels, organisations, owners, fields };
}

async function storedDefinition(id: number, db: Sql = sql): Promise<{ definition: Definition; version: number } | null> {
  const [r] = await db<SegmentRow[]>`select ${COLUMNS(db)} from segments s join users u on u.id = s.updated_by where s.id = ${id}`;
  return r ? { definition: definitionOf(r), version: r.version } : null;
}

export type SaveSegmentResult =
  | { ok: true; id: number }
  | { ok: false; errors: SegmentErrors }
  | { ok: false; code: "segment_changed" | "segment_not_found" };

class Stop extends Error {
  constructor(readonly result: SaveSegmentResult) {
    super("stop");
  }
}
const nameTaken = (name: string): SaveSegmentResult => ({ ok: false, errors: { name: templates.segment_name_exists(name) } });

async function nameExists(db: Sql, name: string, except: number | null): Promise<boolean> {
  const rows = await db`select 1 from segments where lower(name) = lower(${name}) ${except === null ? db`` : db`and id <> ${except}`}`;
  return rows.length > 0;
}

const definitionColumns = (d: Definition) => ({
  who: d.who, pipeline_id: d.pipelineId, stage_id: d.stageId, deal_status: d.dealStatus,
});

export async function createSegment(actorId: number, input: SegmentFormValues): Promise<SaveSegmentResult> {
  const checked = validateSegmentForm(input, await segmentFormOptions(null));
  if (!checked.ok) return checked;
  const { name, definition: d } = checked;
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      if (await nameExists(db, name, null)) throw new Stop(nameTaken(name));
      const [row] = await db<{ id: number }[]>`
        insert into segments (name, who, pipeline_id, stage_id, deal_status, conditions, created_by, updated_by)
        values (${name}, ${d.who}, ${d.pipelineId}, ${d.stageId}, ${d.dealStatus}, ${db.json(d.conditions as never)}, ${actorId}, ${actorId})
        returning id::int as id`;
      return { ok: true as const, id: row.id };
    });
  } catch (err) {
    if (err instanceof Stop) return err.result;
    if (isUniqueViolation(err, "segments_name_key")) return nameTaken(name);
    throw err;
  }
}

// `version`: what the form was opened with. Saved only when nobody changed the segment since (FR-012).
export async function updateSegment(actorId: number, id: number, version: number, input: SegmentFormValues): Promise<SaveSegmentResult> {
  const stored = await storedDefinition(id);
  if (!stored) return { ok: false, code: "segment_not_found" };
  const checked = validateSegmentForm(input, await segmentFormOptions(stored.definition));
  if (!checked.ok) return checked;
  const { name, definition: d } = checked;
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      if (await nameExists(db, name, id)) throw new Stop(nameTaken(name));
      const cols = definitionColumns(d);
      const rows = await db<{ id: number }[]>`
        update segments set name = ${name}, who = ${cols.who}, pipeline_id = ${cols.pipeline_id}, stage_id = ${cols.stage_id},
          deal_status = ${cols.deal_status}, conditions = ${db.json(d.conditions as never)}, updated_by = ${actorId},
          updated_at = now(), version = version + 1
        where id = ${id} and version = ${version} returning id::int as id`;
      if (rows.length === 1) return { ok: true as const, id };
      const gone = (await db`select 1 from segments where id = ${id}`).length === 0;
      throw new Stop({ ok: false, code: gone ? "segment_not_found" : "segment_changed" });
    });
  } catch (err) {
    if (err instanceof Stop) return err.result;
    if (isUniqueViolation(err, "segments_name_key")) return nameTaken(name);
    throw err;
  }
}

// Anyone may delete any segment (FR-006); `name` (from the deleted row) for "Segment <name> deleted.".
export async function deleteSegment(_actorId: number, id: number): Promise<{ ok: true; name: string } | { ok: false; code: "segment_not_found" }> {
  const [row] = await sql<{ name: string }[]>`delete from segments where id = ${id} returning name`;
  return row ? { ok: true, name: row.name } : { ok: false, code: "segment_not_found" };
}

// COUNT AGAIN: the count of the form as it is, never saved. The name is not needed to count.
export async function countDefinition(
  viewerId: number,
  input: SegmentFormValues & { id?: number | null },
): Promise<{ ok: true; reach: Reach } | { ok: false; errors: SegmentErrors } | { ok: false; code: "segment_not_found" }> {
  let stored: Definition | null = null;
  if (input.id) {
    const s = await storedDefinition(input.id);
    if (!s) return { ok: false, code: "segment_not_found" };
    stored = s.definition;
  }
  const checked = validateSegmentForm({ ...input, name: "-" }, await segmentFormOptions(stored));
  if (!checked.ok) return checked;
  return { ok: true, reach: await countReach(viewerId, checked.definition) };
}
