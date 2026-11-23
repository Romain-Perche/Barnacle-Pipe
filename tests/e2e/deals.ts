// Helpers for the SF-93 browser tests: board columns and cards, the deal drawer, and direct inserts for setup.
import { expect, type Page } from "@playwright/test";
import { db } from "./helpers";

export async function pipelineId(name: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`select id::int as id from pipelines where name = ${name}`;
  if (!row) throw new Error(`no pipeline ${name}`);
  return row.id;
}

export async function stageId(pipeline: string, stage: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`
    select s.id::int as id from stages s join pipelines p on p.id = s.pipeline_id where p.name = ${pipeline} and s.name = ${stage}`;
  if (!row) throw new Error(`no stage ${pipeline} · ${stage}`);
  return row.id;
}

export async function dealId(title: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`select id::int as id from deals where title = ${title} order by id desc limit 1`;
  if (!row) throw new Error(`no deal ${title}`);
  return row.id;
}

async function userId(name: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`select id::int as id from users where name = ${name}`;
  return row.id;
}

// A deal put straight into the database (with its open stage period), for setting up a scenario.
export async function insertDeal(d: {
  title: string; pipeline: string; stage: string; createdBy: string; owner?: string; valuePence?: number | null;
  organisation?: string; person?: string; private?: boolean;
}): Promise<number> {
  const stage = await stageId(d.pipeline, d.stage);
  const creator = await userId(d.createdBy);
  const owner = d.owner ? await userId(d.owner) : creator;
  const [row] = await db()<{ id: number }[]>`
    insert into deals (title, value_pence, stage_id, organisation_id, person_id, owner_id, private, created_by)
    values (${d.title}, ${d.valuePence ?? null}, ${stage},
            ${d.organisation ? db()`(select id from organisations where name = ${d.organisation})` : null},
            ${d.person ? db()`(select id from persons where btrim(first_name || ' ' || last_name) = ${d.person} limit 1)` : null},
            ${owner}, ${d.private ?? false}, ${creator})
    returning id::int as id`;
  await db()`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name) values (${row.id}, ${stage}, ${d.stage}, ${d.pipeline})`;
  await db()`insert into timeline_events (deal_id, kind, actor_id) values (${row.id}, 'added', ${creator})`;
  return row.id;
}

export function column(page: Page, stage: string) {
  return page.getByRole("region", { name: stage, exact: true });
}
export function card(page: Page, title: string) {
  return page.locator("a.card").filter({ hasText: title });
}
export function columnTotal(page: Page, stage: string) {
  return column(page, stage).locator(".tot");
}
export function dealDrawer(page: Page) {
  return page.getByRole("complementary", { name: "Deal" });
}
export function history(page: Page) {
  return page.getByRole("region", { name: "Timeline" }).getByRole("listitem");
}

// "<n> deals · £total" of the visible non-archived open deals of a stage (SF-95: won and lost deals are not on the
// board), as the database has them for a viewer.
export async function expectedHeader(pipeline: string, stage: string, viewer: string): Promise<string> {
  const viewerId = await userId(viewer);
  const [row] = await db()<{ n: number; total: string }[]>`
    select count(*)::int as n, coalesce(sum(d.value_pence), 0)::bigint as total
    from deals d join stages s on s.id = d.stage_id join pipelines p on p.id = s.pipeline_id
    where p.name = ${pipeline} and s.name = ${stage} and d.archived_at is null and d.status = 'open'
      and (not d.private or d.created_by = ${viewerId} or d.owner_id = ${viewerId})`;
  const pence = Number(row.total);
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);
  return `${row.n} ${row.n === 1 ? "deal" : "deals"} · ${money}`;
}

export async function expectHeader(page: Page, pipeline: string, stage: string, viewer: string) {
  await expect(columnTotal(page, stage)).toHaveText(await expectedHeader(pipeline, stage, viewer));
}

// SF-95: the deal page's parts.
export function stageStep(page: Page, stage: string) {
  return page.getByRole("list", { name: "Stages" }).getByRole("listitem").filter({ hasText: stage });
}
export function strip(page: Page) {
  return page.locator("dl.strip");
}
export function lostBox(page: Page) {
  return page.getByRole("dialog", { name: "Why was this deal lost?" });
}
