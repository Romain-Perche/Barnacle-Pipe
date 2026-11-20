// Timeline events on people, organisations and deals (research.md §10; SF-93 research.md §3). Later features add
// kinds to the same table.
import { sql, type Sql } from "@/server/db";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

export type EventKind =
  | "added" | "edited" | "archived" | "restored" | "person_linked" | "person_unlinked" | "handed_over" | "moved"
  // SF-95: deal results
  | "won" | "lost" | "reopened";
// Why an admin's change moved a deal (the history line ends "(stage deleted)" / "(pipeline deleted)").
export type MoveCause = "stage_deleted" | "pipeline_deleted";

export type TimelineEvent = {
  id: number;
  kind: EventKind;
  actorName: string | null;
  fields: string[] | null;
  // On person_linked / person_unlinked: null once the person was deleted ("A deleted person …", SF-92 FR-005).
  relatedPerson: { id: number; name: string } | null;
  // On handed_over: the new owner (SF-92 FR-011).
  relatedUserName: string | null;
  fromStage: string | null;
  toStage: string | null;
  cause: MoveCause | null;
  // On lost: the reason as typed then (reopening clears the deal's reason, not this).
  reason: string | null;
  createdAt: Date;
};

type Target = { personId: number } | { organisationId: number } | { dealId: number };

export async function recordEvent(
  db: Sql,
  event: Target & {
    kind: EventKind;
    actorId: number | null;
    fields?: string[];
    relatedPersonId?: number;
    relatedUserId?: number;
    fromStage?: string;
    toStage?: string;
    cause?: MoveCause | null;
    reason?: string;
  },
): Promise<void> {
  const personId = "personId" in event ? event.personId : null;
  const organisationId = "organisationId" in event ? event.organisationId : null;
  const dealId = "dealId" in event ? event.dealId : null;
  await db`
    insert into timeline_events (person_id, organisation_id, deal_id, kind, actor_id, fields, related_person_id, related_user_id,
                                 from_stage, to_stage, cause, reason)
    values (${personId}, ${organisationId}, ${dealId}, ${event.kind}, ${event.actorId}, ${event.fields ?? null},
            ${event.relatedPersonId ?? null}, ${event.relatedUserId ?? null}, ${event.fromStage ?? null},
            ${event.toStage ?? null}, ${event.cause ?? null}, ${event.reason ?? null})`;
}

// Newest first. Nothing for a person or deal the viewer cannot see; on an organisation or a deal, events about a person
// the viewer cannot see are left out (events about a deleted person have no related person and stay).
export async function readTimeline(viewerId: number, target: Target): Promise<TimelineEvent[]> {
  const where =
    "personId" in target
      ? sql`e.person_id = ${target.personId}
            and exists (select 1 from persons p where p.id = e.person_id and ${visiblePerson(sql, viewerId)})`
      : "dealId" in target
        ? sql`e.deal_id = ${target.dealId}
              and exists (select 1 from deals d where d.id = e.deal_id and ${visibleDeal(sql, viewerId)})
              and (e.related_person_id is null or ${visiblePerson(sql, viewerId, "rp")})`
        : sql`e.organisation_id = ${target.organisationId}
              and (e.related_person_id is null or ${visiblePerson(sql, viewerId, "rp")})`;
  const rows = await sql<
    {
      id: number; kind: EventKind; actor_name: string | null; fields: string[] | null; rp_id: number | null; rp_name: string | null;
      ru_name: string | null; from_stage: string | null; to_stage: string | null; cause: MoveCause | null; reason: string | null;
      created_at: Date;
    }[]
  >`
    select e.id::int as id, e.kind, u.name as actor_name, e.fields, rp.id::int as rp_id,
           btrim(rp.first_name || ' ' || rp.last_name) as rp_name, ru.name as ru_name, e.from_stage, e.to_stage, e.cause,
           e.reason, e.created_at
    from timeline_events e
    left join users u on u.id = e.actor_id
    left join persons rp on rp.id = e.related_person_id
    left join users ru on ru.id = e.related_user_id
    where ${where}
    order by e.created_at desc, e.id desc`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    actorName: r.actor_name,
    fields: r.fields,
    relatedPerson: r.rp_id === null ? null : { id: r.rp_id, name: r.rp_name ?? "" },
    relatedUserName: r.ru_name,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    cause: r.cause,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}
