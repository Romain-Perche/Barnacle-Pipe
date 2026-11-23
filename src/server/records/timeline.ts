// Timeline events on people, organisations and deals (research.md §10; SF-93 research.md §3). Later features add
// kinds to the same table. SF-102: notes are events of kind "note" (body, editor, version); a person's and an
// organisation's timeline also read the entries of their currently linked deals (research.md §6).
import { sql, type Sql } from "@/server/db";
import { noteSegments, type NoteSegment } from "@/server/records/notes-rules";
import { visibleActivity, visibleDeal, visiblePerson } from "@/server/records/visibility";

export type EventKind =
  | "added" | "edited" | "archived" | "restored" | "person_linked" | "person_unlinked" | "handed_over" | "moved"
  // SF-95: deal results
  | "won" | "lost" | "reopened"
  // SF-102: a note written on the record
  | "note"
  // SF-109: a done activity, read from `activities` (never a timeline_events row)
  | "activity";
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

export type Target = { personId: number } | { organisationId: number } | { dealId: number };

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

export type TimelineEntry = TimelineEvent & {
  // Set on a person's or organisation's timeline for an entry of one of their deals.
  deal: { id: number; title: string; archived: boolean } | null;
  note: { segments: NoteSegment[]; editedByName: string | null; version: number } | null;
  // false: "(deactivated)" after the author's name.
  authorActive: boolean;
  // SF-109: a done activity (kind "activity"); `id` is then the activity's id and `createdAt` when it was marked done.
  activity: TimelineActivity | null;
};
export type TimelineActivity = {
  id: number; type: "call" | "meeting" | "task"; subject: string; note: string | null; doneByName: string; doneByActive: boolean;
  dueOn: string; dueTime: string | null; durationMinutes: number | null;
};
export type TimelinePage = { entries: TimelineEntry[]; more: boolean };

const withStatus = (name: string, active: boolean) => (active ? name : `${name} (deactivated)`);

// Which events a timeline holds, for a viewer. Nothing for a person or deal the viewer cannot see; a person's and an
// organisation's timeline add the entries of their deals the viewer can see (main person or other linked person;
// organisation of the deal) while the link lasts. `where … or e.deal_id in (…)` reads each event once.
function targetWhere(db: Sql, viewerId: number, target: Target) {
  if ("dealId" in target) {
    return db`e.deal_id = ${target.dealId} and exists (select 1 from deals d where d.id = e.deal_id and ${visibleDeal(db, viewerId)})`;
  }
  if ("personId" in target) {
    const p = target.personId;
    return db`exists (select 1 from persons p where p.id = ${p} and ${visiblePerson(db, viewerId)})
      and (e.person_id = ${p}
           or e.deal_id in (select d.id from deals d
                            where (d.person_id = ${p} or exists (select 1 from deal_people dp where dp.deal_id = d.id and dp.person_id = ${p}))
                              and ${visibleDeal(db, viewerId)}))`;
  }
  const o = target.organisationId;
  return db`(e.organisation_id = ${o}
             or e.deal_id in (select d.id from deals d where d.organisation_id = ${o} and ${visibleDeal(db, viewerId)}))`;
}

// SF-109 (research.md §3): the done activities a timeline holds, for a viewer: those linked to the deal; on a person
// or an organisation, those linked to it or to one of its deals the viewer can see (each once). Always visibleActivity().
function activityWhere(db: Sql, viewerId: number, target: Target) {
  if ("dealId" in target) return db`a.deal_id = ${target.dealId}`;
  if ("personId" in target) {
    const p = target.personId;
    return db`exists (select 1 from persons p where p.id = ${p} and ${visiblePerson(db, viewerId)})
      and (a.person_id = ${p}
           or a.deal_id in (select d.id from deals d
                            where (d.person_id = ${p} or exists (select 1 from deal_people dp where dp.deal_id = d.id and dp.person_id = ${p}))
                              and ${visibleDeal(db, viewerId)}))`;
  }
  const o = target.organisationId;
  return db`(a.organisation_id = ${o} or a.deal_id in (select d.id from deals d where d.organisation_id = ${o} and ${visibleDeal(db, viewerId)}))`;
}

async function doneActivities(viewerId: number, target: Target, limit: number): Promise<TimelineEntry[]> {
  const rows = await sql<
    { id: number; type: TimelineActivity["type"]; subject: string; note: string | null; done_at: Date; done_by_name: string; done_by_active: boolean;
      due_on: string; due_time: string | null; duration_minutes: number | null }[]
  >`
    select a.id::int as id, a.type, a.subject, a.note, a.done_at, u.name as done_by_name, u.status = 'active' as done_by_active,
           to_char(a.due_on, 'YYYY-MM-DD') as due_on, to_char(a.due_time, 'HH24:MI') as due_time, a.duration_minutes
    from activities a join users u on u.id = a.done_by
    where a.done_at is not null and ${activityWhere(sql, viewerId, target)} and ${visibleActivity(sql, viewerId)}
    order by a.done_at desc, a.id desc
    limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, kind: "activity" as const, actorName: r.done_by_name, fields: null, relatedPerson: null, relatedUserName: null, fromStage: null,
    toStage: null, cause: null, reason: null, createdAt: r.done_at, authorActive: r.done_by_active, deal: null, note: null,
    activity: {
      id: r.id, type: r.type, subject: r.subject, note: r.note, doneByName: r.done_by_name, doneByActive: r.done_by_active,
      dueOn: r.due_on, dueTime: r.due_time, durationMinutes: r.duration_minutes,
    },
  }));
}

// Newest first, `limit` entries (`more` when there are older ones). Events about a person the viewer cannot see are left
// out (events about a deleted person have no related person and stay). Mentions show the users' current names.
export async function readTimeline(viewerId: number, target: Target, limit = 50): Promise<TimelinePage> {
  const onDeal = "dealId" in target;
  const rows = await sql<
    {
      id: number; kind: EventKind; actor_name: string | null; actor_active: boolean | null; fields: string[] | null; rp_id: number | null;
      rp_name: string | null; ru_name: string | null; from_stage: string | null; to_stage: string | null; cause: MoveCause | null;
      reason: string | null; created_at: Date; body: string | null; version: number; editor_name: string | null; editor_active: boolean | null;
      deal_id: number | null; deal_title: string | null; deal_archived: boolean | null;
    }[]
  >`
    select e.id::int as id, e.kind, u.name as actor_name, u.status = 'active' as actor_active, e.fields, rp.id::int as rp_id,
           btrim(rp.first_name || ' ' || rp.last_name) as rp_name, ru.name as ru_name, e.from_stage, e.to_stage, e.cause,
           e.reason, e.created_at, e.body, e.version, eu.name as editor_name, eu.status = 'active' as editor_active,
           de.id::int as deal_id, de.title as deal_title, de.archived_at is not null as deal_archived
    from timeline_events e
    left join users u on u.id = e.actor_id
    left join persons rp on rp.id = e.related_person_id
    left join users ru on ru.id = e.related_user_id
    left join users eu on eu.id = e.edited_by
    left join deals de on de.id = e.deal_id
    where ${targetWhere(sql, viewerId, target)}
      and (e.related_person_id is null or ${visiblePerson(sql, viewerId, "rp")})
    order by e.created_at desc, e.id desc
    limit ${limit + 1}`;
  const activities = await doneActivities(viewerId, target, limit + 1);
  // Up to `limit + 1` of each: merged below, newest first, the page is the first `limit` (SF-109).
  const shown = rows;
  const noteIds = shown.filter((r) => r.kind === "note").map((r) => r.id);
  const names = new Map<number, Map<number, string>>();
  if (noteIds.length > 0) {
    const mentions = await sql<{ event_id: number; user_id: number; name: string }[]>`
      select m.event_id::int as event_id, m.user_id::int as user_id, u.name
      from note_mentions m join users u on u.id = m.user_id where m.event_id in ${sql(noteIds)}`;
    for (const m of mentions) {
      if (!names.has(m.event_id)) names.set(m.event_id, new Map());
      names.get(m.event_id)!.set(m.user_id, m.name);
    }
  }
  const events: TimelineEntry[] = shown.map((r) => ({
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
      authorActive: r.actor_active ?? true,
      deal: !onDeal && r.deal_id !== null ? { id: r.deal_id, title: r.deal_title ?? "", archived: r.deal_archived ?? false } : null,
      note:
        r.kind === "note" && r.body !== null
          ? {
              segments: noteSegments(r.body, names.get(r.id) ?? new Map()),
              editedByName: r.editor_name === null ? null : withStatus(r.editor_name, r.editor_active ?? true),
              version: r.version,
            }
          : null,
      activity: null,
    }));
  const merged = [...events, ...activities].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { more: merged.length > limit, entries: merged.slice(0, limit) };
}
