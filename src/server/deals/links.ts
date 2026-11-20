// Other people linked to a deal and its followers (SF-95 data-model.md § State changes, research.md §7). Each change
// is one transaction that locks the deal through visibleDeal(); people go through visiblePerson(). Following is not
// recorded in the history; linking and unlinking are.
import { sql, type Sql } from "@/server/db";
import { recordEvent } from "@/server/records/timeline";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

export type LinkResult = { status: "ok" } | { status: "already_linked" } | { status: "not_allowed" } | { status: "not_found" };
export type UnlinkResult = { status: "ok" } | { status: "not_linked" } | { status: "not_found" };
export type FollowResult = { status: "ok" } | { status: "not_found" };

async function lockDeal(db: Sql, actorId: number, dealId: number) {
  const [row] = await db<{ person_id: number | null; archived: boolean }[]>`
    select d.person_id::int as person_id, d.archived_at is not null as archived from deals d
    where d.id = ${dealId} and ${visibleDeal(db, actorId)} for update`;
  return row;
}

// A person the actor can see and that is not archived, not the main person and not linked yet (open or closed deal,
// not archived). The deal row lock and the primary key keep a person linked once.
export async function linkPerson(actorId: number, dealId: number, personId: number): Promise<LinkResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const deal = await lockDeal(db, actorId, dealId);
    if (!deal) return { status: "not_found" as const };
    if (deal.archived) return { status: "not_allowed" as const };
    const [person] = await db`
      select 1 from persons p where p.id = ${personId} and p.archived_at is null and ${visiblePerson(db, actorId)}`;
    if (!person) return { status: "not_allowed" as const };
    if (deal.person_id === personId) return { status: "already_linked" as const };
    const rows = await db`
      insert into deal_people (deal_id, person_id, linked_by) values (${dealId}, ${personId}, ${actorId})
      on conflict do nothing returning person_id`;
    if (rows.length === 0) return { status: "already_linked" as const };
    await recordEvent(db, { dealId, kind: "person_linked", actorId, relatedPersonId: personId });
    return { status: "ok" as const };
  });
}

// Only a person the actor can see (a hidden one cannot be unlinked, nor learnt about).
export async function unlinkPerson(actorId: number, dealId: number, personId: number): Promise<UnlinkResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const deal = await lockDeal(db, actorId, dealId);
    if (!deal) return { status: "not_found" as const };
    if (deal.archived) return { status: "not_linked" as const };
    const rows = await db`
      delete from deal_people dp using persons p
      where dp.deal_id = ${dealId} and dp.person_id = ${personId} and p.id = dp.person_id and ${visiblePerson(db, actorId)}
      returning dp.person_id`;
    if (rows.length === 0) return { status: "not_linked" as const };
    await recordEvent(db, { dealId, kind: "person_unlinked", actorId, relatedPersonId: personId });
    return { status: "ok" as const };
  });
}

// Each user follows or unfollows only themselves, on a deal they can see that is not archived.
async function follow(actorId: number, dealId: number, on: boolean): Promise<FollowResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const deal = await lockDeal(db, actorId, dealId);
    if (!deal || deal.archived) return { status: "not_found" as const };
    if (on) await db`insert into deal_followers (deal_id, user_id) values (${dealId}, ${actorId}) on conflict do nothing`;
    else await db`delete from deal_followers where deal_id = ${dealId} and user_id = ${actorId}`;
    return { status: "ok" as const };
  });
}

export function followDeal(actorId: number, dealId: number): Promise<FollowResult> {
  return follow(actorId, dealId, true);
}

export function unfollowDeal(actorId: number, dealId: number): Promise<FollowResult> {
  return follow(actorId, dealId, false);
}

// People the deal page's picker offers: every person the viewer can see that is not archived (the server re-checks).
export async function linkablePeople(viewerId: number): Promise<{ id: number; name: string; archived: boolean }[]> {
  return [
    ...(await sql<{ id: number; name: string; archived: boolean }[]>`
      select p.id::int as id, btrim(p.first_name || ' ' || p.last_name) as name, false as archived from persons p
      where p.archived_at is null and ${visiblePerson(sql, viewerId)}
      order by lower(btrim(p.first_name || ' ' || p.last_name)), p.id`),
  ];
}
