// The deal list (SF-95 research.md §5, contracts/routes.md § Pages): one page of deals across pipelines, their count
// and total value, and the filter options. Every read goes through visibleDeal(); the main person through
// visiblePerson(), so a private deal or person is never listed, named or counted for anyone the rules hide it from.
import { sql } from "@/server/db";
import type { DealStatus } from "@/server/deals/deals";
import { referrerOptions } from "@/server/records/ambassadors";
import { direction, ownerOptions, type Option, type UserRef } from "@/server/records/common";
import { PAGE_SIZE, type DEAL_SORTS, type DealsQuery } from "@/server/records/list-query";
import type { CustomField } from "@/server/custom-fields/rules";
import { customListParts } from "@/server/custom-fields/values";
import { escapeLike } from "@/server/records/rules";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

export type DealRow = {
  id: number;
  title: string;
  valuePence: number | null;
  organisation: { id: number; name: string; archived: boolean } | null;
  person: { id: number; name: string } | null;
  pipeline: Option;
  stage: Option;
  owner: UserRef;
  expectedClose: string | null;
  createdAt: Date;
  status: DealStatus;
  archived: boolean;
  private: boolean;
  // Every label name the deal has, removed ones included, A–Z.
  labels: string[];
};

export type DealList = { rows: DealRow[]; total: number; totalPence: number; page: number; pages: number };

// The stage filter only counts when the stage belongs to the chosen pipeline (otherwise it is ignored).
export async function stageOfPipeline(pipelineId: number | null, stageId: number | null): Promise<number | null> {
  if (pipelineId === null || stageId === null) return null;
  const rows = await sql`select 1 from stages where id = ${stageId} and pipeline_id = ${pipelineId}`;
  return rows.length === 1 ? stageId : null;
}

// SF-115: `shown` are the deal fields shown in the list; their filters run inside the same visible `where`, so the
// count and the total follow them.
export async function listDeals(viewerId: number, query: DealsQuery, shown: CustomField[] = []): Promise<DealList> {
  const custom = customListParts(sql, "deal", "d", shown, query);
  const stage = await stageOfPipeline(query.pipeline, query.stage);
  const status = query.closed || query.archived ? query.status : null;
  const pattern = `%${escapeLike(query.q)}%`;
  const where = sql`
    ${visibleDeal(sql, viewerId)}
    ${query.archived ? sql`and d.archived_at is not null` : sql`and d.archived_at is null`}
    ${!query.archived && !query.closed ? sql`and d.status = 'open'` : sql``}
    ${status !== null ? sql`and d.status = ${status}` : sql``}
    ${query.pipeline !== null ? sql`and s.pipeline_id = ${query.pipeline}` : sql``}
    ${stage !== null ? sql`and d.stage_id = ${stage}` : sql``}
    ${query.owner !== null ? sql`and d.owner_id = ${query.owner}` : sql``}
    ${query.label !== null ? sql`and exists (select 1 from deal_label_links dl where dl.deal_id = d.id and dl.label_id = ${query.label})` : sql``}
    ${query.q ? sql`and d.title ilike ${pattern}` : sql``}
    ${query.ref !== null ? sql`and d.referred_by_id = ${query.ref}` : sql``}
    ${custom.where}`;
  const [{ total, total_pence }] = await sql<{ total: number; total_pence: string }[]>`
    select count(*)::int as total, coalesce(sum(d.value_pence), 0)::bigint as total_pence
    from deals d join stages s on s.id = d.stage_id where ${where}`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const dir = direction(sql, query.dir);
  const order = custom.order ? sql`${custom.order}, d.created_at desc, d.id desc` : {
    title: sql`lower(d.title) ${dir}, d.id ${dir}`,
    value: sql`d.value_pence ${dir} nulls last, d.id ${dir}`,
    organisation: sql`lower(o.name) ${dir} nulls last, d.id ${dir}`,
    stage: sql`pl.position ${dir}, s.position ${dir}, d.id ${dir}`,
    owner: sql`lower(u.name) ${dir}, d.id ${dir}`,
    close: sql`d.expected_close_on ${dir} nulls last, d.id ${dir}`,
    added: sql`d.created_at ${dir}, d.id ${dir}`,
  }[query.sort as (typeof DEAL_SORTS)[number]] ?? sql`d.created_at desc, d.id desc`;
  const rows = await sql<
    {
      id: number; title: string; value_pence: string | null; org_id: number | null; org_name: string | null; org_archived: boolean | null;
      person_id: number | null; person_name: string | null; pipeline_id: number; pipeline_name: string; stage_id: number; stage_name: string;
      owner_id: number; owner_name: string; owner_active: boolean; expected_close: string | null; created_at: Date; status: DealStatus;
      archived: boolean; private: boolean; labels: string[];
    }[]
  >`
    select d.id::int as id, d.title, d.value_pence, o.id::int as org_id, o.name as org_name, o.archived_at is not null as org_archived,
           p.id::int as person_id, btrim(p.first_name || ' ' || p.last_name) as person_name,
           pl.id::int as pipeline_id, pl.name as pipeline_name, s.id::int as stage_id, s.name as stage_name,
           u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active,
           to_char(d.expected_close_on, 'YYYY-MM-DD') as expected_close, d.created_at, d.status,
           d.archived_at is not null as archived, d.private,
           array(select l.name from deal_label_links dl join deal_labels l on l.id = dl.label_id
                 where dl.deal_id = d.id order by lower(l.name), l.id) as labels
    from deals d
    join stages s on s.id = d.stage_id
    join pipelines pl on pl.id = s.pipeline_id
    join users u on u.id = d.owner_id
    left join organisations o on o.id = d.organisation_id
    left join persons p on p.id = d.person_id and ${visiblePerson(sql, viewerId)}
    ${custom.join}
    where ${where}
    order by ${order}
    limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      valuePence: r.value_pence === null ? null : Number(r.value_pence),
      organisation: r.org_id === null ? null : { id: r.org_id, name: r.org_name ?? "", archived: r.org_archived === true },
      person: r.person_id === null ? null : { id: r.person_id, name: r.person_name ?? "" },
      pipeline: { id: r.pipeline_id, name: r.pipeline_name },
      stage: { id: r.stage_id, name: r.stage_name },
      owner: { id: r.owner_id, name: r.owner_name, active: r.owner_active },
      expectedClose: r.expected_close,
      createdAt: r.created_at,
      status: r.status,
      archived: r.archived,
      private: r.private,
      labels: r.labels,
    })),
    total,
    totalPence: Number(total_pence),
    page,
    pages,
  };
}

// Filter options: every pipeline; the chosen pipeline's stages; active users plus owners of deals the viewer sees;
// deal labels not removed plus removed ones a deal the viewer sees has (as people labels, SF-90); SF-114: the
// "Referred by" options (research.md §13).
export async function dealFilterOptions(
  viewerId: number,
  pipelineId: number | null,
): Promise<{ pipelines: Option[]; stages: Option[]; owners: Option[]; labels: Option[]; referrers: Option[] }> {
  const visible = visibleDeal(sql, viewerId);
  const [pipelines, stages, owners, labels, referrers] = await Promise.all([
    sql<Option[]>`select id::int as id, name from pipelines order by position, id`,
    pipelineId === null
      ? Promise.resolve([] as Option[])
      : sql<Option[]>`select id::int as id, name from stages where pipeline_id = ${pipelineId} order by position, id`,
    ownerOptions(sql, sql`exists (select 1 from deals d where d.owner_id = u.id and ${visible})`),
    sql<Option[]>`
      select l.id::int as id, l.name from deal_labels l
      where l.removed_at is null
         or exists (select 1 from deal_label_links dl join deals d on d.id = dl.deal_id where dl.label_id = l.id and ${visible})
      order by lower(l.name), l.id`,
    referrerOptions(viewerId),
  ]);
  return { pipelines: [...pipelines], stages: [...stages], owners, labels: [...labels], referrers };
}
