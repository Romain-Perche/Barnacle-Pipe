// Ambassadors (SF-114 contracts/routes.md § Domain functions, research.md §4, §7–§10, §13): the Ambassadors page, an
// ambassador's page and latest updates, the "Referred by" options, checks and filter options.
// An ambassador is a person with `is_ambassador`. Every read of `persons` goes through visiblePerson() and of `deals`
// through visibleDeal(), so a private ambassador or referred record is never listed, counted or offered for anyone the
// rules hide it from. Counts and totals come from one shared fragment, so the two pages always agree (SC-004).
import { sql, type Fragment, type Sql } from "@/server/db";
import type { DealStatus } from "@/server/deals/deals";
import type { Option, UserRef } from "@/server/records/common";
import { getPerson, type PersonView } from "@/server/records/people";
import { selectEntries, type TimelinePage } from "@/server/records/timeline";
import { hasAmbassadorPage, visibleDeal, visiblePerson, type Viewer } from "@/server/records/visibility";

// A record's "Referred by" for a viewer: "hidden" when the referrer exists but the viewer cannot see them.
export type Referrer = { id: number; name: string; ambassadorPage: boolean } | "hidden" | null;
// A "Referred by" picker option; `detail`: "<organisation> · <first email>" so two same-name ambassadors differ.
export type AmbassadorOption = { id: number; name: string; detail: string };
export type AmbassadorSummary = { people: number; deals: number; openPence: number; wonPence: number; lost: number };
export type AmbassadorRow = AmbassadorSummary & {
  id: number;
  name: string;
  organisation: { id: number; name: string } | null;
  archived: boolean;
  latestReferral: Date | null;
};
export type ReferredPerson = {
  id: number;
  name: string;
  organisation: { id: number; name: string } | null;
  owner: UserRef;
  createdAt: Date;
  archived: boolean;
};
export type ReferredDeal = {
  id: number;
  title: string;
  pipeline: string;
  stage: string;
  valuePence: number | null;
  status: DealStatus;
  owner: UserRef;
  archived: boolean;
};
export type AmbassadorPage = {
  person: PersonView;
  former: boolean;
  summary: AmbassadorSummary;
  people: { rows: ReferredPerson[]; more: boolean };
  deals: { rows: ReferredDeal[]; more: boolean };
};

const NAME = (alias: string) => sql`btrim(${sql(alias)}.first_name || ' ' || ${sql(alias)}.last_name)`;

// What the ambassador `alias` brought in, as seen by the viewer (archived referred records included): lateral joins
// `sp` (people: count, latest referral) and `sd` (deals: count, open and won totals, lost count, latest referral).
function summaryJoins(db: Sql, viewer: Viewer, alias: string): Fragment {
  const a = db(alias);
  return db`
    left join lateral (
      select count(*)::int as people, max(r.referred_at) as latest
      from persons r where r.referred_by_id = ${a}.id and ${visiblePerson(db, viewer, "r")}
    ) sp on true
    left join lateral (
      select count(*)::int as deals,
             coalesce(sum(d.value_pence) filter (where d.status = 'open'), 0)::bigint as open_pence,
             coalesce(sum(d.value_pence) filter (where d.status = 'won'), 0)::bigint as won_pence,
             (count(*) filter (where d.status = 'lost'))::int as lost,
             max(d.referred_at) as latest
      from deals d where d.referred_by_id = ${a}.id and ${visibleDeal(db, viewer, "d")}
    ) sd on true`;
}

type SummaryRow = { people: number; deals: number; open_pence: string; won_pence: string; lost: number };
const summaryOf = (r: SummaryRow): AmbassadorSummary => ({
  people: r.people,
  deals: r.deals,
  openPence: Number(r.open_pence),
  wonPence: Number(r.won_pence),
  lost: r.lost,
});

// The Ambassadors page (FR-002): every ambassador the viewer can see, archived ones included, A–Z.
export async function listAmbassadors(viewerId: number): Promise<AmbassadorRow[]> {
  const rows = await sql<
    (SummaryRow & { id: number; name: string; org_id: number | null; org_name: string | null; archived: boolean; latest: Date | null })[]
  >`
    select a.id::int as id, ${NAME("a")} as name, o.id::int as org_id, o.name as org_name, a.archived_at is not null as archived,
           sp.people, sd.deals, sd.open_pence, sd.won_pence, sd.lost, greatest(sp.latest, sd.latest) as latest
    from persons a
    left join organisations o on o.id = a.organisation_id
    ${summaryJoins(sql, viewerId, "a")}
    where a.is_ambassador and ${visiblePerson(sql, viewerId, "a")}
    order by lower(${NAME("a")}), a.id`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    organisation: r.org_id === null ? null : { id: r.org_id, name: r.org_name ?? "" },
    archived: r.archived,
    latestReferral: r.latest,
    ...summaryOf(r),
  }));
}

// Offered in the "Referred by" pickers and accepted as a new referrer (FR-005): ticked, not archived, visible.
function offered(db: Sql, viewer: Viewer, alias: string) {
  return db`${db(alias)}.is_ambassador and ${db(alias)}.archived_at is null and ${visiblePerson(db, viewer, alias)}`;
}

export async function ambassadorOptions(db: Sql, viewerId: number, excludeId?: number): Promise<AmbassadorOption[]> {
  const rows = await db<{ id: number; name: string; org: string | null; email: string | null }[]>`
    select a.id::int as id, ${NAME("a")} as name, o.name as org,
           (select e.email from person_emails e where e.person_id = a.id order by e.position limit 1) as email
    from persons a left join organisations o on o.id = a.organisation_id
    where ${offered(db, viewerId, "a")} and a.id <> ${excludeId ?? 0}
    order by lower(${NAME("a")}), a.id`;
  return rows.map((r) => ({ id: r.id, name: r.name, detail: [r.org, r.email].filter(Boolean).join(" · ") }));
}

export async function isOfferedAmbassador(db: Sql, actorId: number, id: number): Promise<boolean> {
  const rows = await db`select 1 from persons a where a.id = ${id} and ${offered(db, actorId, "a")}`;
  return rows.length === 1;
}

// A person's or deal's "Referred by", for the viewer (person page, deal page, drawer, forms).
export async function referrerOf(db: Sql, viewerId: number, referredById: number | null): Promise<Referrer> {
  if (referredById === null) return null;
  const [r] = await db<{ id: number; name: string; visible: boolean; page: boolean }[]>`
    select a.id::int as id, ${NAME("a")} as name, ${visiblePerson(db, viewerId, "a")} as visible,
           ${hasAmbassadorPage(db, viewerId, "a")} as page
    from persons a where a.id = ${referredById}`;
  if (!r) return null;
  if (!r.visible) return "hidden";
  return { id: r.id, name: r.name, ambassadorPage: r.page };
}

// The list filters' "Referred by" options (research.md §13): visible ambassadors, archived ones included, plus any
// visible person who referred a person or deal the viewer can see (a former ambassador) — i.e. who has a page.
export async function referrerOptions(viewerId: number): Promise<Option[]> {
  return [
    ...(await sql<Option[]>`
      select a.id::int as id, ${NAME("a")} as name from persons a
      where ${visiblePerson(sql, viewerId, "a")} and ${hasAmbassadorPage(sql, viewerId, "a")}
      order by lower(${NAME("a")}), a.id`),
  ];
}

// The ambassador page (research.md §7–§9): null unless the person is visible and an ambassador or the referrer of a
// record the viewer can see. People newest first; deals open first, then most recently changed. `shown` rows each.
export async function getAmbassadorPage(viewerId: number, id: number, shown: { people: number; deals: number }): Promise<AmbassadorPage | null> {
  const person = await getPerson(viewerId, id);
  if (!person) return null;
  const [head] = await sql<(SummaryRow & { page: boolean })[]>`
    select ${hasAmbassadorPage(sql, viewerId, "a")} as page, sp.people, sd.deals, sd.open_pence, sd.won_pence, sd.lost
    from persons a ${summaryJoins(sql, viewerId, "a")}
    where a.id = ${id} and ${visiblePerson(sql, viewerId, "a")}`;
  if (!head?.page) return null;
  const [people, deals] = await Promise.all([
    sql<
      { id: number; name: string; org_id: number | null; org_name: string | null; owner_id: number; owner_name: string; owner_active: boolean;
        created_at: Date; archived: boolean }[]
    >`
      select r.id::int as id, ${NAME("r")} as name, o.id::int as org_id, o.name as org_name,
             u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active, r.created_at,
             r.archived_at is not null as archived
      from persons r
      join users u on u.id = r.owner_id
      left join organisations o on o.id = r.organisation_id
      where r.referred_by_id = ${id} and ${visiblePerson(sql, viewerId, "r")}
      order by r.created_at desc, r.id desc
      limit ${shown.people + 1}`,
    sql<
      { id: number; title: string; pipeline: string; stage: string; value_pence: string | null; status: DealStatus; owner_id: number;
        owner_name: string; owner_active: boolean; archived: boolean }[]
    >`
      select d.id::int as id, d.title, pl.name as pipeline, s.name as stage, d.value_pence, d.status,
             u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active, d.archived_at is not null as archived
      from deals d
      join stages s on s.id = d.stage_id
      join pipelines pl on pl.id = s.pipeline_id
      join users u on u.id = d.owner_id
      where d.referred_by_id = ${id} and ${visibleDeal(sql, viewerId, "d")}
      order by d.status <> 'open',
               coalesce((select max(e.created_at) from timeline_events e where e.deal_id = d.id), d.created_at) desc,
               d.id desc
      limit ${shown.deals + 1}`,
  ]);
  return {
    person,
    former: !person.ambassador,
    summary: summaryOf(head),
    people: {
      more: people.length > shown.people,
      rows: people.slice(0, shown.people).map((r) => ({
        id: r.id,
        name: r.name,
        organisation: r.org_id === null ? null : { id: r.org_id, name: r.org_name ?? "" },
        owner: { id: r.owner_id, name: r.owner_name, active: r.owner_active },
        createdAt: r.created_at,
        archived: r.archived,
      })),
    },
    deals: {
      more: deals.length > shown.deals,
      rows: deals.slice(0, shown.deals).map((r) => ({
        id: r.id,
        title: r.title,
        pipeline: r.pipeline,
        stage: r.stage,
        valuePence: r.value_pence === null ? null : Number(r.value_pence),
        status: r.status,
        owner: { id: r.owner_id, name: r.owner_name, active: r.owner_active },
        archived: r.archived,
      })),
    },
  };
}

// // LATEST UPDATES (research.md §10): the ambassador's own person timeline and those of the people and deals they
// referred that the viewer can see, newest first. Not the deals they are only linked to as a contact.
export async function readAmbassadorUpdates(viewerId: number, id: number, limit: number): Promise<TimelinePage> {
  const where = sql`
    exists (select 1 from persons a where a.id = ${id} and ${visiblePerson(sql, viewerId, "a")})
    and (e.person_id = ${id}
         or e.person_id in (select r.id from persons r where r.referred_by_id = ${id} and ${visiblePerson(sql, viewerId, "r")})
         or e.deal_id in (select d.id from deals d where d.referred_by_id = ${id} and ${visibleDeal(sql, viewerId, "d")}))`;
  return selectEntries(viewerId, where, limit, { deals: true, personOtherThan: id });
}
