// Deals (data-model.md § State changes, research.md §3–§9): the board, one deal, add, edit, move, archive, delete.
// Every read of `deals` for a viewer goes through visibleDeal(); every change loads the deal through it first,
// inside its transaction, so a private deal of someone else behaves exactly like a missing one. People shown on a
// deal always go through visiblePerson().
import { sql, type Sql } from "@/server/db";
import { changedDealFields, validateDeal, type DealFields, type DealForm } from "@/server/deals/rules";
import { isActiveAdmin, isUniqueViolation, ownerOptions, refuse, Refused, resolveOwner, type Option, type UserRef } from "@/server/records/common";
import { organisationExistsAfterRace, resolveOrganisation } from "@/server/records/organisations";
import type { FieldErrors } from "@/server/records/rules";
import { recordEvent, type MoveCause } from "@/server/records/timeline";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

export type BoardCard = {
  id: number;
  title: string;
  valuePence: number | null;
  organisation: { id: number; name: string } | null;
  person: { id: number; name: string } | null;
  private: boolean;
  version: number;
  stageId: number;
};
export type BoardColumn = { id: number; name: string; count: number; totalPence: number; cards: BoardCard[] };
export type Board = { pipelines: Option[]; pipeline: Option; columns: BoardColumn[] };

export type DealView = {
  id: number;
  title: string;
  valuePence: number | null;
  pipeline: Option;
  stage: Option;
  organisation: { id: number; name: string; archived: boolean } | null;
  // null when there is none or the viewer may not see them (a private person is never named).
  person: { id: number; name: string; archived: boolean } | null;
  owner: UserRef;
  expectedClose: string | null;
  private: boolean;
  createdBy: number;
  createdAt: Date;
  archived: boolean;
  version: number;
};

export type DealSaveResult =
  | { status: "saved"; id: number; pipelineId: number }
  | { status: "invalid"; errors: FieldErrors }
  | { status: "not_found" }
  // The actor saved a private deal so that they are neither its creator nor its owner (FR-016).
  | { status: "no_longer_visible"; title: string; pipelineId: number };
export type MoveResult = { status: "moved"; version: number; pipelineId: number } | { status: "same" } | { status: "stale" };

type StageRef = { id: number; name: string; pipelineId: number; pipelineName: string };

const ORG_NAME_KEY = "organisations_name_key";
const PERSON_NAME = (alias = "p") => sql`btrim(${sql(alias)}.first_name || ' ' || ${sql(alias)}.last_name)`;
const pence = (v: string | number | null) => (v === null ? null : Number(v));

// --- Board ---------------------------------------------------------------------------------------------------

// One pipeline's board (research.md §7). No pipeline id or an unknown one → the first pipeline; no pipelines → null.
// Counts and totals are of every visible, non-archived deal of the stage (a missing value counts £0).
export async function getBoard(viewerId: number, pipelineId: number | null): Promise<Board | null> {
  const pipelines = [...(await sql<Option[]>`select id::int as id, name from pipelines order by position, id`)];
  if (pipelines.length === 0) return null;
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const [stages, cards] = await Promise.all([
    sql<{ id: number; name: string }[]>`
      select id::int as id, name from stages where pipeline_id = ${pipeline.id} order by position, id`,
    sql<
      { id: number; title: string; value_pence: string | null; org_id: number | null; org_name: string | null; person_id: number | null;
        person_name: string | null; private: boolean; version: number; stage_id: number }[]
    >`
      select d.id::int as id, d.title, d.value_pence, o.id::int as org_id, o.name as org_name, p.id::int as person_id,
             ${PERSON_NAME()} as person_name, d.private, d.version, d.stage_id::int as stage_id
      from deals d
      join stages s on s.id = d.stage_id
      left join organisations o on o.id = d.organisation_id
      left join persons p on p.id = d.person_id and ${visiblePerson(sql, viewerId)}
      where s.pipeline_id = ${pipeline.id} and d.archived_at is null and ${visibleDeal(sql, viewerId)}
      order by d.stage_entered_at desc, d.id desc`,
  ]);
  const columns: BoardColumn[] = stages.map((s) => ({ id: s.id, name: s.name, count: 0, totalPence: 0, cards: [] }));
  const byId = new Map(columns.map((c) => [c.id, c]));
  for (const r of cards) {
    const col = byId.get(r.stage_id);
    if (!col) continue;
    const card: BoardCard = {
      id: r.id,
      title: r.title,
      valuePence: pence(r.value_pence),
      organisation: r.org_id === null ? null : { id: r.org_id, name: r.org_name ?? "" },
      person: r.person_id === null ? null : { id: r.person_id, name: r.person_name ?? "" },
      private: r.private,
      version: r.version,
      stageId: r.stage_id,
    };
    col.cards.push(card);
    col.count++;
    col.totalPence += card.valuePence ?? 0;
  }
  return { pipelines, pipeline, columns };
}

// --- One deal ------------------------------------------------------------------------------------------------

export async function getDeal(viewerId: number, id: number, db: Sql = sql): Promise<DealView | null> {
  const [r] = await db<
    {
      id: number; title: string; value_pence: string | null; pipeline_id: number; pipeline_name: string; stage_id: number; stage_name: string;
      org_id: number | null; org_name: string | null; org_archived: boolean | null; person_id: number | null; person_name: string | null;
      person_archived: boolean | null; owner_id: number; owner_name: string; owner_active: boolean; expected_close: string | null;
      private: boolean; created_by: number; created_at: Date; archived: boolean; version: number;
    }[]
  >`
    select d.id::int as id, d.title, d.value_pence, pl.id::int as pipeline_id, pl.name as pipeline_name, s.id::int as stage_id,
           s.name as stage_name, o.id::int as org_id, o.name as org_name, o.archived_at is not null as org_archived,
           p.id::int as person_id, btrim(p.first_name || ' ' || p.last_name) as person_name, p.archived_at is not null as person_archived,
           u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active,
           to_char(d.expected_close_on, 'YYYY-MM-DD') as expected_close, d.private, d.created_by::int as created_by, d.created_at,
           d.archived_at is not null as archived, d.version
    from deals d
    join stages s on s.id = d.stage_id
    join pipelines pl on pl.id = s.pipeline_id
    join users u on u.id = d.owner_id
    left join organisations o on o.id = d.organisation_id
    left join persons p on p.id = d.person_id and ${visiblePerson(db, viewerId)}
    where d.id = ${id} and ${visibleDeal(db, viewerId)}`;
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    valuePence: pence(r.value_pence),
    pipeline: { id: r.pipeline_id, name: r.pipeline_name },
    stage: { id: r.stage_id, name: r.stage_name },
    organisation: r.org_id === null ? null : { id: r.org_id, name: r.org_name ?? "", archived: r.org_archived === true },
    person: r.person_id === null ? null : { id: r.person_id, name: r.person_name ?? "", archived: r.person_archived === true },
    owner: { id: r.owner_id, name: r.owner_name, active: r.owner_active },
    expectedClose: r.expected_close,
    private: r.private,
    createdBy: r.created_by,
    createdAt: r.created_at,
    archived: r.archived,
    version: r.version,
  };
}

export function dealToForm(d: DealView): DealForm {
  return {
    title: d.title,
    value: d.valuePence === null ? "" : (d.valuePence / 100).toFixed(d.valuePence % 100 === 0 ? 0 : 2),
    pipelineId: String(d.pipeline.id),
    stageId: String(d.stage.id),
    organisationId: d.organisation ? String(d.organisation.id) : "",
    newOrganisationName: "",
    personId: d.person ? String(d.person.id) : "",
    ownerId: String(d.owner.id),
    expectedClose: d.expectedClose ?? "",
    private: d.private,
  };
}

export type PipelineStages = { id: number; name: string; stages: Option[] };

// Every pipeline with its stages, in order (the add form's pipeline/stage fields and the drawer's "Move to").
export async function stageChoices(db: Sql = sql): Promise<PipelineStages[]> {
  const rows = await db<{ pipeline_id: number; pipeline_name: string; stage_id: number | null; stage_name: string | null }[]>`
    select pl.id::int as pipeline_id, pl.name as pipeline_name, s.id::int as stage_id, s.name as stage_name
    from pipelines pl left join stages s on s.pipeline_id = pl.id
    order by pl.position, pl.id, s.position, s.id`;
  const out: PipelineStages[] = [];
  for (const r of rows) {
    let p = out.at(-1);
    if (!p || p.id !== r.pipeline_id) out.push((p = { id: r.pipeline_id, name: r.pipeline_name, stages: [] }));
    if (r.stage_id !== null) p.stages.push({ id: r.stage_id, name: r.stage_name ?? "" });
  }
  return out;
}

export type DealChoices = {
  owners: Option[];
  organisations: { id: number; name: string; archived: boolean }[];
  people: { id: number; name: string; archived: boolean }[];
  pipelines: PipelineStages[];
};

// What the deal form offers: active owners, non-archived organisations and visible non-archived people, plus
// whatever the deal already has (a hidden person is never listed).
export async function dealFormChoices(viewerId: number, deal: DealView | null): Promise<DealChoices> {
  const [owners, organisations, people, pipelines] = await Promise.all([
    ownerOptions(sql, deal ? sql`u.id = ${deal.owner.id}` : null),
    sql<{ id: number; name: string; archived: boolean }[]>`
      select id::int as id, name, archived_at is not null as archived from organisations
      where archived_at is null or id = ${deal?.organisation?.id ?? 0} order by lower(name), id`,
    sql<{ id: number; name: string; archived: boolean }[]>`
      select p.id::int as id, ${PERSON_NAME()} as name, p.archived_at is not null as archived from persons p
      where (p.archived_at is null or p.id = ${deal?.person?.id ?? 0}) and ${visiblePerson(sql, viewerId)}
      order by lower(${PERSON_NAME()}), p.id`,
    stageChoices(),
  ]);
  return { owners, organisations: [...organisations], people: [...people], pipelines };
}

// --- Changes -------------------------------------------------------------------------------------------------

async function stageRef(db: Sql, stageId: number): Promise<StageRef | undefined> {
  const [r] = await db<StageRef[]>`
    select s.id::int as id, s.name, pl.id::int as "pipelineId", pl.name as "pipelineName"
    from stages s join pipelines pl on pl.id = s.pipeline_id where s.id = ${stageId}`;
  return r;
}

// A person the actor may put on a deal: visible and not archived, or the deal's current person.
async function allowedPerson(db: Sql, actorId: number, requested: number | null, current: number | null): Promise<{ id: number; organisationId: number | null } | null> {
  if (requested === null) return null;
  const [r] = await db<{ id: number; organisation_id: number | null }[]>`
    select p.id::int as id, p.organisation_id::int as organisation_id from persons p
    where p.id = ${requested} and (p.id = ${current ?? 0} or (p.archived_at is null and ${visiblePerson(db, actorId)}))`;
  return r ? { id: r.id, organisationId: r.organisation_id } : null;
}

// Moves a locked deal into another stage (research.md §3, §4): closes the open stage period, opens a new one,
// records "moved" with the names shown ("Sales · Qualified" when the pipeline changes). Shared with the stage and
// pipeline deletes (pipelines.ts), which pass their cause.
export async function transferDeal(db: Sql, dealId: number, from: StageRef, to: StageRef, actorId: number, cause: MoveCause | null = null): Promise<number> {
  const crossing = from.pipelineId !== to.pipelineId;
  await db`update deal_stage_periods set left_at = now() where deal_id = ${dealId} and left_at is null`;
  await db`
    insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, moved_by)
    values (${dealId}, ${to.id}, ${to.name}, ${to.pipelineName}, ${actorId})`;
  const [row] = await db<{ version: number }[]>`
    update deals set stage_id = ${to.id}, stage_entered_at = now(), version = version + 1 where id = ${dealId} returning version`;
  await recordEvent(db, {
    dealId,
    kind: "moved",
    actorId,
    fromStage: crossing ? `${from.pipelineName} · ${from.name}` : from.name,
    toStage: crossing ? `${to.pipelineName} · ${to.name}` : to.name,
    cause,
  });
  return row.version;
}

export { stageRef as dealStageRef };

async function withOrgRace<T>(newOrg: string | null, run: () => Promise<T>): Promise<T | { status: "invalid"; errors: FieldErrors }> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Refused) return err.result as { status: "invalid"; errors: FieldErrors };
    if (isUniqueViolation(err, ORG_NAME_KEY) && newOrg) {
      return { status: "invalid", errors: { organisation: await organisationExistsAfterRace(newOrg) } };
    }
    throw err;
  }
}

export async function createDeal(actorId: number, form: DealForm): Promise<DealSaveResult> {
  const v = validateDeal(form);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const value = v.value;
  return withOrgRace(value.newOrganisationName, () =>
    sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const stage = value.stageId === null ? undefined : await stageRef(db, value.stageId);
      if (!stage || (value.pipelineId !== null && value.pipelineId !== stage.pipelineId)) refuse({ stage: { code: "deal_stage_required" } });
      const org = await resolveOrganisation(db, actorId, value, null);
      if (!org.ok) refuse({ organisation: org.error });
      const person = await allowedPerson(db, actorId, value.personId, null);
      // FR-006: no organisation chosen → the main person's organisation.
      const organisationId = org.id ?? person?.organisationId ?? null;
      const ownerId = await resolveOwner(db, value.ownerId, actorId, null);
      const [row] = await db<{ id: number }[]>`
        insert into deals (title, value_pence, stage_id, organisation_id, person_id, owner_id, expected_close_on, private, created_by)
        values (${value.title}, ${value.valuePence}, ${stage.id}, ${organisationId}, ${person?.id ?? null}, ${ownerId},
                ${value.expectedClose}, ${value.private}, ${actorId})
        returning id::int as id`;
      await db`
        insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, moved_by)
        values (${row.id}, ${stage.id}, ${stage.name}, ${stage.pipelineName}, ${actorId})`;
      await recordEvent(db, { dealId: row.id, kind: "added", actorId });
      return { status: "saved" as const, id: row.id, pipelineId: stage.pipelineId };
    }),
  );
}

function fieldsOf(d: DealView, personId: number | null): DealFields {
  return {
    title: d.title,
    valuePence: d.valuePence,
    pipelineId: null,
    stageId: null,
    organisationId: d.organisation?.id ?? null,
    newOrganisationName: null,
    personId,
    ownerId: d.owner.id,
    expectedClose: d.expectedClose,
    private: d.private,
  };
}

// Edit (not the stage: moves go through moveDeal). Archived, missing or not visible → not_found.
export async function updateDeal(actorId: number, id: number, version: number, form: DealForm): Promise<DealSaveResult> {
  const v = validateDeal(form);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const value = v.value;
  return withOrgRace(value.newOrganisationName, () =>
    sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const [locked] = await db<{ person_id: number | null; created_by: number }[]>`
        select d.person_id::int as person_id, d.created_by::int as created_by from deals d
        where d.id = ${id} and d.archived_at is null and ${visibleDeal(db, actorId)} for update`;
      if (!locked) throw new Refused({ status: "not_found" });
      const current = (await getDeal(actorId, id, db))!;
      if (current.version !== version) refuse({ form: { code: "deal_edit_conflict" } });
      const before = fieldsOf(current, locked.person_id);
      const org = await resolveOrganisation(db, actorId, value, before.organisationId);
      if (!org.ok) refuse({ organisation: org.error });
      // A main person the actor cannot see stays when the field comes back empty (spec Clarifications).
      const hiddenPerson = locked.person_id !== null && current.person === null;
      const person =
        value.personId === null && hiddenPerson
          ? { id: locked.person_id!, organisationId: null }
          : await allowedPerson(db, actorId, value.personId, locked.person_id);
      const personOrg = value.personId !== null && person ? person.organisationId : null;
      const canSetPrivate = actorId === current.createdBy || actorId === current.owner.id;
      const after: DealFields = {
        ...value,
        pipelineId: null,
        stageId: null,
        newOrganisationName: null,
        organisationId: org.id ?? personOrg,
        personId: person?.id ?? null,
        ownerId: await resolveOwner(db, value.ownerId, current.owner.id, current.owner.id),
        private: canSetPrivate ? value.private : current.private,
      };
      await db`
        update deals set title = ${after.title}, value_pence = ${after.valuePence}, organisation_id = ${after.organisationId},
               person_id = ${after.personId}, owner_id = ${after.ownerId}, expected_close_on = ${after.expectedClose},
               private = ${after.private}, version = version + 1
        where id = ${id}`;
      const fields = changedDealFields(before, after);
      if (fields.length > 0) await recordEvent(db, { dealId: id, kind: "edited", actorId, fields });
      if (after.private && actorId !== current.createdBy && actorId !== after.ownerId) {
        return { status: "no_longer_visible" as const, title: after.title, pipelineId: current.pipeline.id };
      }
      return { status: "saved" as const, id, pipelineId: current.pipeline.id };
    }),
  );
}

// A board drag or the drawer's "Move to" (research.md §4). Refused as stale when the deal is gone, archived, not
// visible, changed since the board was loaded (version, or not in `fromStageId` any more), or the target is unknown.
export async function moveDeal(
  actorId: number,
  input: { dealId: number; version: number; fromStageId: number | null; toStageId: number },
): Promise<MoveResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [deal] = await db<{ stage_id: number; version: number; archived: boolean }[]>`
      select d.stage_id::int as stage_id, d.version, d.archived_at is not null as archived from deals d
      where d.id = ${input.dealId} and ${visibleDeal(db, actorId)} for update`;
    if (!deal || deal.archived || deal.version !== input.version) return { status: "stale" as const };
    if (input.fromStageId !== null && deal.stage_id !== input.fromStageId) return { status: "stale" as const };
    if (deal.stage_id === input.toStageId) return { status: "same" as const };
    const [from, to] = await Promise.all([stageRef(db, deal.stage_id), stageRef(db, input.toStageId)]);
    if (!from || !to) return { status: "stale" as const };
    const version = await transferDeal(db, input.dealId, from, to, actorId);
    return { status: "moved" as const, version, pipelineId: to.pipelineId };
  });
}

// Any user who sees the deal. The deal keeps its stage (restoring puts it back there).
export async function archiveDeal(actorId: number, id: number): Promise<{ status: "archived"; pipelineId: number } | { status: "not_found" }> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [cur] = await db<{ archived: boolean; pipeline_id: number }[]>`
      select d.archived_at is not null as archived, s.pipeline_id::int as pipeline_id
      from deals d join stages s on s.id = d.stage_id
      where d.id = ${id} and ${visibleDeal(db, actorId)} for update of d`;
    if (!cur) return { status: "not_found" as const };
    if (!cur.archived) {
      await db`update deals set archived_at = now(), version = version + 1 where id = ${id}`;
      await recordEvent(db, { dealId: id, kind: "archived", actorId });
    }
    return { status: "archived" as const, pipelineId: cur.pipeline_id };
  });
}

// Admins only, re-checked here. Its stage periods and history go with it (on delete cascade).
export async function deleteDeal(
  actorId: number,
  id: number,
): Promise<{ status: "deleted"; name: string; pipelineId: number } | { status: "forbidden" } | { status: "not_found" }> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    if (!(await isActiveAdmin(db, actorId))) return { status: "forbidden" as const };
    const [row] = await db<{ title: string; pipeline_id: number }[]>`
      delete from deals d using stages s
      where d.id = ${id} and s.id = d.stage_id and ${visibleDeal(db, actorId)}
      returning d.title, s.pipeline_id::int as pipeline_id`;
    return row ? { status: "deleted" as const, name: row.title, pipelineId: row.pipeline_id } : { status: "not_found" as const };
  });
}
