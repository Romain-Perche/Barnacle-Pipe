// Timeline events on people and organisations (research.md §10). Later features add kinds to the same table.
import { sql, type Sql } from "@/server/db";
import { visiblePerson } from "@/server/records/visibility";

export type EventKind = "added" | "edited" | "archived" | "restored" | "person_linked" | "person_unlinked";

export type TimelineEvent = {
  id: number;
  kind: EventKind;
  actorName: string | null;
  fields: string[] | null;
  relatedPerson: { id: number; name: string } | null;
  createdAt: Date;
};

type Target = { personId: number } | { organisationId: number };

export async function recordEvent(
  db: Sql,
  event: Target & { kind: EventKind; actorId: number | null; fields?: string[]; relatedPersonId?: number },
): Promise<void> {
  const personId = "personId" in event ? event.personId : null;
  const organisationId = "organisationId" in event ? event.organisationId : null;
  await db`
    insert into timeline_events (person_id, organisation_id, kind, actor_id, fields, related_person_id)
    values (${personId}, ${organisationId}, ${event.kind}, ${event.actorId}, ${event.fields ?? null}, ${event.relatedPersonId ?? null})`;
}

// Newest first. Nothing for a person the viewer cannot see; on an organisation, events about a person the
// viewer cannot see are left out.
export async function readTimeline(viewerId: number, target: Target): Promise<TimelineEvent[]> {
  const where =
    "personId" in target
      ? sql`e.person_id = ${target.personId}
            and exists (select 1 from persons p where p.id = e.person_id and ${visiblePerson(sql, viewerId)})`
      : sql`e.organisation_id = ${target.organisationId}
            and (e.related_person_id is null or ${visiblePerson(sql, viewerId, "rp")})`;
  const rows = await sql<
    { id: number; kind: EventKind; actor_name: string | null; fields: string[] | null; rp_id: number | null; rp_name: string | null; created_at: Date }[]
  >`
    select e.id::int as id, e.kind, u.name as actor_name, e.fields, rp.id::int as rp_id,
           btrim(rp.first_name || ' ' || rp.last_name) as rp_name, e.created_at
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
    createdAt: r.created_at,
  }));
}
