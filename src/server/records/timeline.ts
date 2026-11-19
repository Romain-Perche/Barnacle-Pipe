// Timeline events on people, organisations and deals (research.md §10; SF-93 research.md §3). Later features add
// kinds to the same table.
import { sql, type Sql } from "@/server/db";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

export type EventKind = "added" | "edited" | "archived" | "restored" | "person_linked" | "person_unlinked" | "moved";
// Why an admin's change moved a deal (the history line ends "(stage deleted)" / "(pipeline deleted)").
export type MoveCause = "stage_deleted" | "pipeline_deleted";

export type TimelineEvent = {
  id: number;
  kind: EventKind;
  actorName: string | null;
  fields: string[] | null;
  relatedPerson: { id: number; name: string } | null;
  fromStage: string | null;
  toStage: string | null;
  cause: MoveCause | null;
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
    fromStage?: string;
    toStage?: string;
    cause?: MoveCause | null;
  },
): Promise<void> {
  const personId = "personId" in event ? event.personId : null;
  const organisationId = "organisationId" in event ? event.organisationId : null;
  const dealId = "dealId" in event ? event.dealId : null;
  await db`
    insert into timeline_events (person_id, organisation_id, deal_id, kind, actor_id, fields, related_person_id, from_stage, to_stage, cause)
    values (${personId}, ${organisationId}, ${dealId}, ${event.kind}, ${event.actorId}, ${event.fields ?? null},
            ${event.relatedPersonId ?? null}, ${event.fromStage ?? null}, ${event.toStage ?? null}, ${event.cause ?? null})`;
}

// Newest first. Nothing for a person or deal the viewer cannot see; on an organisation, events about a person the
// viewer cannot see are left out.
export async function readTimeline(viewerId: number, target: Target): Promise<TimelineEvent[]> {
  const where =
    "personId" in target
      ? sql`e.person_id = ${target.personId}
            and exists (select 1 from persons p where p.id = e.person_id and ${visiblePerson(sql, viewerId)})`
      : "dealId" in target
        ? sql`e.deal_id = ${target.dealId}
              and exists (select 1 from deals d where d.id = e.deal_id and ${visibleDeal(sql, viewerId)})`
        : sql`e.organisation_id = ${target.organisationId}
              and (e.related_person_id is null or ${visiblePerson(sql, viewerId, "rp")})`;
  const rows = await sql<
    {
      id: number; kind: EventKind; actor_name: string | null; fields: string[] | null; rp_id: number | null; rp_name: string | null;
      from_stage: string | null; to_stage: string | null; cause: MoveCause | null; created_at: Date;
    }[]
  >`
    select e.id::int as id, e.kind, u.name as actor_name, e.fields, rp.id::int as rp_id,
           btrim(rp.first_name || ' ' || rp.last_name) as rp_name, e.from_stage, e.to_stage, e.cause, e.created_at
    from timeline_events e
    left join users u on u.id = e.actor_id
    left join persons rp on rp.id = e.related_person_id
    where ${where}
    order by e.created_at desc, e.id desc`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    actorName: r.actor_name,
    fields: r.fields,
    relatedPerson: r.rp_id === null ? null : { id: r.rp_id, name: r.rp_name ?? "" },
    fromStage: r.from_stage,
    toStage: r.to_stage,
    cause: r.cause,
    createdAt: r.created_at,
  }));
}
