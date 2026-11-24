// Deals (data-model.md § State changes, research.md §3–§9): the board, one deal, add, edit, move, archive, delete.
// Every read of `deals` for a viewer goes through visibleDeal(); every change loads the deal through it first,
// inside its transaction, so a private deal of someone else behaves exactly like a missing one. People shown on a
// deal always go through visiblePerson().
import { cleanupPathsFor, sweepFileCleanup } from "@/server/files/files";
import { sql, type Sql } from "@/server/db";
import { changedDealFields, validateDeal, validateLostReason, type DealFields, type DealForm } from "@/server/deals/rules";
import { isActiveAdmin, isUniqueViolation, ownerOptions, refuse, Refused, resolveOwner, type Option, type UserRef } from "@/server/records/common";
import { ambassadorOptions, referrerOf, type AmbassadorOption, type Referrer } from "@/server/records/ambassadors";
import { organisationExistsAfterRace, resolveOrganisation } from "@/server/records/organisations";
import { recordReferral, referredByToForm, resolveReferrer } from "@/server/records/people";
import type { FieldErrors } from "@/server/records/rules";
import { recordEvent, type MoveCause } from "@/server/records/timeline";
import { visibleActivity, visibleDeal, visiblePerson } from "@/server/records/visibility";
import type { ActivityType } from "@/server/activities/rules";
import { customToForm, readCustomValues, saveCustomValues, type CustomDetail } from "@/server/custom-fields/values";

export type BoardCard = {
  id: number;
  title: string;
  valuePence: number | null;
  organisation: { id: number; name: string } | null;
  person: { id: number; name: string } | null;
  private: boolean;
  version: number;
  stageId: number;
  // SF-109 (research.md §11): the earliest planned activity the viewer can see; null shows "⚠ No next activity".
  next: { dueOn: string; dueTime: string | null; durationMinutes: number | null; type: ActivityType } | null;
};
export type BoardColumn = { id: number; name: string; count: number; totalPence: number; cards: BoardCard[] };
export type Board = { pipelines: Option[]; pipeline: Option; columns: BoardColumn[] };

export type DealStatus = "open" | "won" | "lost";

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
  archivedAt: Date | null;
  version: number;
  // SF-95: result, labels, other linked people, followers.
  status: DealStatus;
  closedAt: Date | null;
  lostReason: string | null;
  // Every label the deal has, removed ones included, A–Z.
  labels: Option[];
  // Visible to the viewer only (a private person is never named or counted), A–Z.
  otherPeople: { id: number; name: string; archived: boolean }[];
  followers: UserRef[];
  followedByViewer: boolean;
  // SF-114: "Referred by" ("hidden": a referrer the viewer cannot see).
  referredBy: Referrer;
  // SF-115: every custom field of deals, in order, with this deal's value.
  custom: CustomDetail[];
};

export type StatusResult =
  | { status: "ok" }
  | { status: "conflict" }
  | { status: "invalid"; code: "lost_reason_required" | "lost_reason_too_long" }
  | { status: "not_found" };

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
// Counts and totals are of every visible, non-archived, open deal of the stage (a missing value counts £0); won and
// lost deals are never on the board (SF-95 FR-006).
export async function getBoard(viewerId: number, pipelineId: number | null): Promise<Board | null> {
  const pipelines = [...(await sql<Option[]>`select id::int as id, name from pipelines order by position, id`)];
  if (pipelines.length === 0) return null;
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const [stages, cards] = await Promise.all([
    sql<{ id: number; name: string }[]>`
      select id::int as id, name from stages where pipeline_id = ${pipeline.id} order by position, id`,
    sql<
      { id: number; title: string; value_pence: string | null; org_id: number | null; org_name: string | null; person_id: number | null;
        person_name: string | null; private: boolean; version: number; stage_id: number; next_due_on: string | null;
        next_due_time: string | null; next_duration: number | null; next_type: ActivityType | null }[]
    >`
      select d.id::int as id, d.title, d.value_pence, o.id::int as org_id, o.name as org_name, p.id::int as person_id,
             ${PERSON_NAME()} as person_name, d.private, d.version, d.stage_id::int as stage_id,
             nx.due_on as next_due_on, nx.due_time as next_due_time, nx.duration_minutes as next_duration, nx.type as next_type
      from deals d
      join stages s on s.id = d.stage_id
      left join organisations o on o.id = d.organisation_id
      left join persons p on p.id = d.person_id and ${visiblePerson(sql, viewerId)}
      left join lateral (
        select to_char(a.due_on, 'YYYY-MM-DD') as due_on, to_char(a.due_time, 'HH24:MI') as due_time, a.duration_minutes, a.type
        from activities a
        where a.deal_id = d.id and a.done_at is null and ${visibleActivity(sql, viewerId)}
        order by a.due_on, a.due_time nulls last, a.id
        limit 1
      ) nx on true
      where s.pipeline_id = ${pipeline.id} and d.archived_at is null and d.status = 'open' and ${visibleDeal(sql, viewerId)}
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
      next: r.next_due_on === null ? null : { dueOn: r.next_due_on, dueTime: r.next_due_time, durationMinutes: r.next_duration, type: r.next_type! },
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
      private: boolean; created_by: number; created_at: Date; archived_at: Date | null; version: number; status: DealStatus;
      closed_at: Date | null; lost_reason: string | null; referred_by_id: number | null;
    }[]
  >`
    select d.id::int as id, d.title, d.value_pence, pl.id::int as pipeline_id, pl.name as pipeline_name, s.id::int as stage_id,
           s.name as stage_name, o.id::int as org_id, o.name as org_name, o.archived_at is not null as org_archived,
           p.id::int as person_id, btrim(p.first_name || ' ' || p.last_name) as person_name, p.archived_at is not null as person_archived,
           u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active,
           to_char(d.expected_close_on, 'YYYY-MM-DD') as expected_close, d.private, d.created_by::int as created_by, d.created_at,
           d.archived_at, d.version, d.status, d.closed_at, d.lost_reason, d.referred_by_id::int as referred_by_id
    from deals d
    join stages s on s.id = d.stage_id
    join pipelines pl on pl.id = s.pipeline_id
    join users u on u.id = d.owner_id
    left join organisations o on o.id = d.organisation_id
    left join persons p on p.id = d.person_id and ${visiblePerson(db, viewerId)}
    where d.id = ${id} and ${visibleDeal(db, viewerId)}`;
  if (!r) return null;
  const [labels, otherPeople, followers, referredBy] = await Promise.all([
    db<Option[]>`
      select l.id::int as id, l.name from deal_label_links dl join deal_labels l on l.id = dl.label_id
      where dl.deal_id = ${id} order by lower(l.name), l.id`,
    db<{ id: number; name: string; archived: boolean }[]>`
      select p.id::int as id, ${PERSON_NAME()} as name, p.archived_at is not null as archived
      from deal_people dp join persons p on p.id = dp.person_id
      where dp.deal_id = ${id} and ${visiblePerson(db, viewerId)}
      order by lower(${PERSON_NAME()}), p.id`,
    db<UserRef[]>`
      select u.id::int as id, u.name, u.status = 'active' as active
      from deal_followers f join users u on u.id = f.user_id
      where f.deal_id = ${id} order by lower(u.name), u.id`,
    referrerOf(db, viewerId, r.referred_by_id),
  ]);
  const custom = await readCustomValues(db, viewerId, { dealId: id });
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
    archived: r.archived_at !== null,
    archivedAt: r.archived_at,
    version: r.version,
    status: r.status,
    closedAt: r.closed_at,
    lostReason: r.lost_reason,
    labels: [...labels],
    otherPeople: [...otherPeople],
    followers: [...followers],
    followedByViewer: followers.some((f) => f.id === viewerId),
    referredBy,
    custom,
  };
}

// Seconds spent in each stage of `pipelineId`, in order (data-model.md § Stage bar): the deal's periods in that stage
// summed, the open one counted up to now. Won and Lost close the open period, so closed deals stop counting.
export async function getStageSeconds(dealId: number, pipelineId: number): Promise<{ id: number; name: string; seconds: number }[]> {
  return [
    ...(await sql<{ id: number; name: string; seconds: number }[]>`
      select s.id::int as id, s.name,
             coalesce(sum(extract(epoch from coalesce(p.left_at, now()) - p.entered_at)), 0)::float8 as seconds
      from stages s
      left join deal_stage_periods p on p.stage_id = s.id and p.deal_id = ${dealId}
      where s.pipeline_id = ${pipelineId}
      group by s.id, s.name, s.position
      order by s.position, s.id`),
  ];
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
    labelIds: d.labels.map((l) => String(l.id)),
    referredBy: referredByToForm(d.referredBy),
    custom: customToForm(d.custom),
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
  // SF-114: referredById is the person's referrer only when that referrer is offered (pre-fills the add form).
  people: { id: number; name: string; archived: boolean; referredById: number | null }[];
  pipelines: PipelineStages[];
  // Non-removed deal labels plus the ones the deal already has (SF-95, as people labels).
  labels: Option[];
  // SF-114: the "Referred by" options (offered ambassadors).
  ambassadors: AmbassadorOption[];
};

// What the deal form offers: active owners, non-archived organisations and visible non-archived people, plus
// whatever the deal already has (a hidden person is never listed).
export async function dealFormChoices(viewerId: number, deal: DealView | null): Promise<DealChoices> {
  const [owners, organisations, people, pipelines, labels, ambassadors] = await Promise.all([
    ownerOptions(sql, deal ? sql`u.id = ${deal.owner.id}` : null),
    sql<{ id: number; name: string; archived: boolean }[]>`
      select id::int as id, name, archived_at is not null as archived from organisations
      where archived_at is null or id = ${deal?.organisation?.id ?? 0} order by lower(name), id`,
    sql<{ id: number; name: string; archived: boolean; referredById: number | null }[]>`
      select p.id::int as id, ${PERSON_NAME()} as name, p.archived_at is not null as archived,
             (select a.id::int from persons a
              where a.id = p.referred_by_id and a.is_ambassador and a.archived_at is null and ${visiblePerson(sql, viewerId, "a")}) as "referredById"
      from persons p
      where (p.archived_at is null or p.id = ${deal?.person?.id ?? 0}) and ${visiblePerson(sql, viewerId)}
      order by lower(${PERSON_NAME()}), p.id`,
    stageChoices(),
    sql<Option[]>`
      select id::int as id, name from deal_labels
      where removed_at is null or id = any(${deal?.labels.map((l) => l.id) ?? []}::bigint[])
      order by lower(name), id`,
    ambassadorOptions(sql, viewerId),
  ]);
  return { owners, organisations: [...organisations], people: [...people], pipelines, labels: [...labels], ambassadors };
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
  const [{ status }] = await db<{ status: DealStatus }[]>`select status from deals where id = ${dealId}`;
  await db`update deal_stage_periods set left_at = now() where deal_id = ${dealId} and left_at is null`;
  // A won or lost deal (moved by a stage or pipeline delete) gets its new period already closed, so its days do not
  // start counting again until it is reopened (SF-95 research.md §3).
  await db`
    insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, moved_by, left_at)
    values (${dealId}, ${to.id}, ${to.name}, ${to.pipelineName}, ${actorId}, ${status === "open" ? null : db`now()`})`;
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
      const referredById = await resolveReferrer(db, actorId, form.referredBy, null, null);
      const [row] = await db<{ id: number }[]>`
        insert into deals (title, value_pence, stage_id, organisation_id, person_id, owner_id, expected_close_on, private, created_by,
                           referred_by_id, referred_at)
        values (${value.title}, ${value.valuePence}, ${stage.id}, ${organisationId}, ${person?.id ?? null}, ${ownerId},
                ${value.expectedClose}, ${value.private}, ${actorId}, ${referredById}, ${referredById === null ? null : db`now()`})
        returning id::int as id`;
      await db`
        insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, moved_by)
        values (${row.id}, ${stage.id}, ${stage.name}, ${stage.pipelineName}, ${actorId})`;
      await recordEvent(db, { dealId: row.id, kind: "added", actorId });
      await saveCustomValues(db, actorId, { dealId: row.id }, form.custom, { archived: false });
      await recordReferral(db, { dealId: row.id }, actorId, null, referredById);
      return { status: "saved" as const, id: row.id, pipelineId: stage.pipelineId };
    }),
  );
}

function fieldsOf(d: DealView, personId: number | null, referredById: number | null): DealFields {
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
    labelIds: d.labels.map((l) => l.id).sort((a, b) => a - b),
    referredById,
  };
}

// Deal labels the actor may keep on a deal: non-removed ones, or ones the deal already has (as people labels).
async function allowedDealLabels(db: Sql, requested: number[], current: number[]): Promise<number[]> {
  if (requested.length === 0) return [];
  const rows = await db<{ id: number }[]>`
    select id::int as id from deal_labels where id = any(${requested}::bigint[]) and (removed_at is null or id = any(${current}::bigint[]))`;
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

// Edit (not the stage: moves go through moveDeal). Archived, missing or not visible → not_found.
export async function updateDeal(actorId: number, id: number, version: number, form: DealForm): Promise<DealSaveResult> {
  const v = validateDeal(form);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const value = v.value;
  return withOrgRace(value.newOrganisationName, () =>
    sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const [locked] = await db<{ person_id: number | null; created_by: number; referred_by_id: number | null }[]>`
        select d.person_id::int as person_id, d.created_by::int as created_by, d.referred_by_id::int as referred_by_id from deals d
        where d.id = ${id} and d.archived_at is null and ${visibleDeal(db, actorId)} for update`;
      if (!locked) throw new Refused({ status: "not_found" });
      const current = (await getDeal(actorId, id, db))!;
      if (current.version !== version) refuse({ form: { code: "deal_edit_conflict" } });
      const before = fieldsOf(current, locked.person_id, locked.referred_by_id);
      // SF-114: never changed by a change of main person (US2 scenario 6), only by the field.
      const referredById = await resolveReferrer(db, actorId, form.referredBy, before.referredById, null);
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
        labelIds: await allowedDealLabels(db, value.labelIds, before.labelIds),
        referredById,
      };
      const referrerChanged = before.referredById !== after.referredById;
      await db`
        update deals set title = ${after.title}, value_pence = ${after.valuePence}, organisation_id = ${after.organisationId},
               person_id = ${after.personId}, owner_id = ${after.ownerId}, expected_close_on = ${after.expectedClose},
               private = ${after.private}, referred_by_id = ${after.referredById},
               referred_at = ${referrerChanged ? (after.referredById === null ? null : db`now()`) : db`referred_at`},
               version = version + 1
        where id = ${id}`;
      await db`delete from deal_label_links where deal_id = ${id}`;
      for (const labelId of after.labelIds) await db`insert into deal_label_links (deal_id, label_id) values (${id}, ${labelId})`;
      // A person is linked once: the new main person leaves "Other people" (spec Clarifications).
      if (after.personId !== null) await db`delete from deal_people where deal_id = ${id} and person_id = ${after.personId}`;
      const fields = changedDealFields(before, after);
      await saveCustomValues(db, actorId, { dealId: id }, form.custom, { archived: current.archived });
      if (fields.length > 0) await recordEvent(db, { dealId: id, kind: "edited", actorId, fields });
      await recordReferral(db, { dealId: id }, actorId, before.referredById, after.referredById);
      if (after.private && actorId !== current.createdBy && actorId !== after.ownerId) {
        return { status: "no_longer_visible" as const, title: after.title, pipelineId: current.pipeline.id };
      }
      return { status: "saved" as const, id, pipelineId: current.pipeline.id };
    }),
  );
}

// A board drag, the drawer's "Move to" or the deal page's stage bar (research.md §4). Refused as stale when the deal is gone, archived, not
// visible, changed since the board was loaded (version, or not in `fromStageId` any more), or the target is unknown.
export async function moveDeal(
  actorId: number,
  input: { dealId: number; version: number; fromStageId: number | null; toStageId: number },
): Promise<MoveResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [deal] = await db<{ stage_id: number; version: number; archived: boolean; status: DealStatus }[]>`
      select d.stage_id::int as stage_id, d.version, d.archived_at is not null as archived, d.status from deals d
      where d.id = ${input.dealId} and ${visibleDeal(db, actorId)} for update`;
    // A won or lost deal keeps its stage until it is reopened (SF-95 research.md §10).
    if (!deal || deal.archived || deal.status !== "open" || deal.version !== input.version) return { status: "stale" as const };
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

// Any user who sees the deal (SF-95 FR-014): back where it is, status and stage unchanged. Not archived: nothing to do.
export async function restoreDeal(actorId: number, id: number): Promise<StatusResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [cur] = await db<{ archived: boolean }[]>`
      select d.archived_at is not null as archived from deals d where d.id = ${id} and ${visibleDeal(db, actorId)} for update`;
    if (!cur) return { status: "not_found" as const };
    if (cur.archived) {
      await db`update deals set archived_at = null, version = version + 1 where id = ${id}`;
      await recordEvent(db, { dealId: id, kind: "restored", actorId });
    }
    return { status: "ok" as const };
  });
}

// --- Won, Lost, Reopen (SF-95 data-model.md § State changes) -----------------------------------------------------
// Each: one transaction, the deal locked through visibleDeal(); a wrong version, an archived deal or a status that no
// longer allows the change is a conflict (shown as deal_edit_conflict); a missing or hidden deal is not_found.

type Locked = { status: DealStatus; archived: boolean; version: number; stage_id: number };

async function lockForResult(db: Sql, actorId: number, id: number): Promise<Locked | undefined> {
  const [row] = await db<Locked[]>`
    select d.status, d.archived_at is not null as archived, d.version, d.stage_id::int as stage_id from deals d
    where d.id = ${id} and ${visibleDeal(db, actorId)} for update`;
  return row;
}

function closeDeal(actorId: number, id: number, version: number, outcome: "won" | "lost", reason: string | null): Promise<StatusResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const deal = await lockForResult(db, actorId, id);
    if (!deal) return { status: "not_found" as const };
    if (deal.archived || deal.status !== "open" || deal.version !== version) return { status: "conflict" as const };
    await db`update deals set status = ${outcome}, closed_at = now(), lost_reason = ${reason}, version = version + 1 where id = ${id}`;
    // Stage days stop while the deal is closed.
    await db`update deal_stage_periods set left_at = now() where deal_id = ${id} and left_at is null`;
    await recordEvent(db, { dealId: id, kind: outcome, actorId, reason: reason ?? undefined });
    return { status: "ok" as const };
  });
}

export function markWon(actorId: number, id: number, version: number): Promise<StatusResult> {
  return closeDeal(actorId, id, version, "won", null);
}

export async function markLost(actorId: number, id: number, version: number, raw: string): Promise<StatusResult> {
  const v = validateLostReason(raw);
  if (!v.ok) return { status: "invalid", code: v.code };
  return closeDeal(actorId, id, version, "lost", v.reason);
}

// Back to the board in the stage it kept; its stage days go on from where they stopped.
export async function reopenDeal(actorId: number, id: number, version: number): Promise<StatusResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const deal = await lockForResult(db, actorId, id);
    if (!deal) return { status: "not_found" as const };
    if (deal.archived || deal.status === "open" || deal.version !== version) return { status: "conflict" as const };
    const stage = (await stageRef(db, deal.stage_id))!;
    await db`update deals set status = 'open', closed_at = null, lost_reason = null, version = version + 1 where id = ${id}`;
    await db`
      insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, moved_by)
      values (${id}, ${stage.id}, ${stage.name}, ${stage.pipelineName}, ${actorId})`;
    await recordEvent(db, { dealId: id, kind: "reopened", actorId });
    return { status: "ok" as const };
  });
}

// Admins only, re-checked here. Its stage periods and history go with it (on delete cascade).
export async function deleteDeal(
  actorId: number,
  id: number,
): Promise<{ status: "deleted"; name: string; pipelineId: number } | { status: "forbidden" } | { status: "not_found" }> {
  const result = await sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    if (!(await isActiveAdmin(db, actorId))) return { status: "forbidden" as const };
    const [found] = await db`select 1 from deals d where d.id = ${id} and ${visibleDeal(db, actorId)} for update`;
    if (!found) return { status: "not_found" as const };
    // SF-116 FR-012: its files' contents are queued for removal from Storage; the rows go by cascade.
    await cleanupPathsFor(db, { dealId: id });
    // SF-109 FR-014: its activities linked to nothing else go with it; the others lose the deal (on delete set null).
    await db`
      delete from activities a using deals d
      where a.deal_id = ${id} and a.person_id is null and a.organisation_id is null and d.id = a.deal_id and ${visibleDeal(db, actorId)}`;
    const [row] = await db<{ title: string; pipeline_id: number }[]>`
      delete from deals d using stages s
      where d.id = ${id} and s.id = d.stage_id and ${visibleDeal(db, actorId)}
      returning d.title, s.pipeline_id::int as pipeline_id`;
    return row ? { status: "deleted" as const, name: row.title, pipelineId: row.pipeline_id } : { status: "not_found" as const };
  });
  if (result.status === "deleted") await sweepFileCleanup();
  return result;
}
