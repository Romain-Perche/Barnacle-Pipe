// Pipelines, stages and deals for the SF-93 integration tests: direct inserts (setup without the code under test)
// and the deal form as DealForm.tsx sends it.
import { sql } from "@/server/db";
import type { DealForm } from "@/server/deals/rules";

export async function makePipeline(name: string, stages: string[], position?: number): Promise<{ id: number; stages: number[] }> {
  const [p] = await sql<{ id: number }[]>`
    insert into pipelines (name, position)
    values (${name}, ${position ?? sql`(select coalesce(max(position), 0) + 1 from pipelines)`}) returning id::int as id`;
  const ids: number[] = [];
  for (const [i, s] of stages.entries()) {
    const [row] = await sql<{ id: number }[]>`
      insert into stages (pipeline_id, name, position) values (${p.id}, ${s}, ${i + 1}) returning id::int as id`;
    ids.push(row.id);
  }
  return { id: p.id, stages: ids };
}

export async function makeDeal(d: {
  title: string; stageId: number; createdBy: number; ownerId?: number; valuePence?: number | null; organisationId?: number | null;
  personId?: number | null; private?: boolean; archived?: boolean; enteredAt?: Date;
}): Promise<number> {
  const entered = d.enteredAt ?? new Date();
  const [row] = await sql<{ id: number }[]>`
    insert into deals (title, value_pence, stage_id, stage_entered_at, organisation_id, person_id, owner_id, private, created_by, archived_at)
    values (${d.title}, ${d.valuePence ?? null}, ${d.stageId}, ${entered}, ${d.organisationId ?? null}, ${d.personId ?? null},
            ${d.ownerId ?? d.createdBy}, ${d.private ?? false}, ${d.createdBy}, ${d.archived ? new Date() : null})
    returning id::int as id`;
  await sql`
    insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, entered_at)
    select ${row.id}, s.id, s.name, p.name, ${entered} from stages s join pipelines p on p.id = s.pipeline_id where s.id = ${d.stageId}`;
  return row.id;
}

export function dealForm(over: Partial<DealForm> = {}): DealForm {
  return {
    title: "Fakeco website",
    value: "",
    pipelineId: "",
    stageId: "",
    organisationId: "",
    newOrganisationName: "",
    personId: "",
    ownerId: "",
    expectedClose: "",
    private: false,
    ...over,
  };
}

export async function dealRow(id: number) {
  const [row] = await sql<
    { title: string; value_pence: string | null; stage_id: number; organisation_id: number | null; person_id: number | null; owner_id: number;
      private: boolean; created_by: number; archived: boolean; version: number; expected_close: string | null }[]
  >`
    select title, value_pence, stage_id::int as stage_id, organisation_id::int as organisation_id, person_id::int as person_id,
           owner_id::int as owner_id, private, created_by::int as created_by, archived_at is not null as archived, version,
           to_char(expected_close_on, 'YYYY-MM-DD') as expected_close
    from deals where id = ${id}`;
  return row ? { ...row, value_pence: row.value_pence === null ? null : Number(row.value_pence) } : undefined;
}

export async function periods(dealId: number) {
  return sql<{ stage_id: number | null; stage_name: string; pipeline_name: string; open: boolean; moved_by: number | null }[]>`
    select stage_id::int as stage_id, stage_name, pipeline_name, left_at is null as open, moved_by::int as moved_by
    from deal_stage_periods where deal_id = ${dealId} order by entered_at, id`;
}

export async function dealEvents(dealId: number) {
  return sql<{ kind: string; actor_id: number | null; fields: string[] | null; from_stage: string | null; to_stage: string | null; cause: string | null }[]>`
    select kind, actor_id::int as actor_id, fields, from_stage, to_stage, cause from timeline_events where deal_id = ${dealId} order by id`;
}

export async function dealCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from deals`;
  return row.n;
}
