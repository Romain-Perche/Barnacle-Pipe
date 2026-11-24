// Timeline events on people, organisations and deals (research.md §10; SF-93 research.md §3). Later features add
// kinds to the same table. SF-102: notes are events of kind "note" (body, editor, version); a person's and an
// organisation's timeline also read the entries of their currently linked deals (research.md §6).
import { sql, type Fragment, type Sql } from "@/server/db";
import type { FileKind } from "@/server/files/rules";
import { noteSegments, type NoteSegment } from "@/server/records/notes-rules";
import { hasAmbassadorPage, visibleActivity, visibleDeal, visiblePerson } from "@/server/records/visibility";

export type EventKind =
  | "added" | "edited" | "archived" | "restored" | "person_linked" | "person_unlinked" | "handed_over" | "moved"
  // SF-95: deal results
  | "won" | "lost" | "reopened"
  // SF-102: a note written on the record
  | "note"
  // SF-103: added by a CSV import (in place of "added")
  | "imported"
  // SF-114: the Ambassador tick (on the person) and "Referred by" (on the person or deal)
  | "ambassador_added" | "ambassador_removed" | "referrer_set" | "referrer_changed" | "referrer_cleared"
  // SF-115: a custom value set, changed or cleared (field name and values as shown at the time)
  | "custom_set" | "custom_changed" | "custom_cleared"
  // SF-109: a done activity, read from `activities` (never a timeline_events row)
  | "activity"
  // SF-116: a file added to or deleted from the record
  | "file_added" | "file_deleted"
  // SF-117: added by a Pipedrive import (in place of "added"); made Unsubscribed by a Pipedrive import
  | "pipedrive_imported" | "pipedrive_unsubscribed";
// Why an admin's change moved a deal (the history line ends "(stage deleted)" / "(pipeline deleted)"); SF-114:
// "person_deleted" on a referrer_cleared written when the referrer was deleted.
export type MoveCause = "stage_deleted" | "pipeline_deleted" | "person_deleted";

// A person named by an event; `ambassadorPage`: their name links to /ambassadors/<id> (else /people/<id>).
export type EventPerson = { id: number; name: string; ambassadorPage: boolean };

export type TimelineEvent = {
  id: number;
  kind: EventKind;
  actorName: string | null;
  fields: string[] | null;
  // On person_linked / person_unlinked: null once the person was deleted ("A deleted person …", SF-92 FR-005).
  // SF-114: on referrer_set / referrer_changed, the new referrer.
  relatedPerson: EventPerson | null;
  // SF-114: on referrer_changed, the previous referrer (null once deleted).
  fromPerson: EventPerson | null;
  // On handed_over: the new owner (SF-92 FR-011).
  relatedUserName: string | null;
  fromStage: string | null;
  toStage: string | null;
  cause: MoveCause | null;
  // On lost: the reason as typed then (reopening clears the deal's reason, not this).
  reason: string | null;
  // SF-115: on custom_set / custom_changed / custom_cleared, the field's name and the values as text of the time.
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
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
    // SF-114: the previous referrer of a referrer_changed.
    fromPersonId?: number;
    relatedUserId?: number;
    fromStage?: string;
    toStage?: string;
    cause?: MoveCause | null;
    reason?: string;
    // SF-116: file_added (fileId, fileName, fileSize) and file_deleted (fileName, deletedFileId)
    fileId?: number;
    fileName?: string;
    fileSize?: number;
    deletedFileId?: number;
    fieldName?: string;
    oldValue?: string | null;
    newValue?: string | null;
  },
): Promise<void> {
  const personId = "personId" in event ? event.personId : null;
  const organisationId = "organisationId" in event ? event.organisationId : null;
  const dealId = "dealId" in event ? event.dealId : null;
  await db`
    insert into timeline_events (person_id, organisation_id, deal_id, kind, actor_id, fields, related_person_id, related_user_id,
                                 from_stage, to_stage, cause, reason, from_person_id, file_id, file_name, file_size, deleted_file_id,
                                 field_name, old_value, new_value)
    values (${personId}, ${organisationId}, ${dealId}, ${event.kind}, ${event.actorId}, ${event.fields ?? null},
            ${event.relatedPersonId ?? null}, ${event.relatedUserId ?? null}, ${event.fromStage ?? null},
            ${event.toStage ?? null}, ${event.cause ?? null}, ${event.reason ?? null}, ${event.fromPersonId ?? null},
            ${event.fileId ?? null}, ${event.fileName ?? null}, ${event.fileSize ?? null}, ${event.deletedFileId ?? null},
            ${event.fieldName ?? null}, ${event.oldValue ?? null}, ${event.newValue ?? null})`;
}

export type TimelineEntry = TimelineEvent & {
  // Set on a person's or organisation's timeline for an entry of one of their deals.
  deal: { id: number; title: string; archived: boolean } | null;
  // SF-114: set on an ambassador's latest updates for an entry of a person they referred (always null elsewhere).
  person: { id: number; name: string; archived: boolean } | null;
  note: { segments: NoteSegment[]; editedByName: string | null; version: number } | null;
  // false: "(deactivated)" after the author's name.
  authorActive: boolean;
  // SF-109: a done activity (kind "activity"); `id` is then the activity's id and `createdAt` when it was marked done.
  activity: TimelineActivity | null;
  // SF-116: on file_added / file_deleted: the file's name and size as they were; `id` and `kind` while the file exists.
  file: TimelineFile | null;
};
export type TimelineFile = { id: number | null; name: string; size: number | null; kind: FileKind | null };
export type TimelineActivity = {
  id: number; type: "call" | "meeting" | "task"; subject: string; note: string | null; doneByName: string; doneByActive: boolean;
  dueOn: string; dueTime: string | null; durationMinutes: number | null;
  archived: boolean; // its deal, person or organisation is archived: it cannot be unticked (FR-013)
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
      due_on: string; due_time: string | null; duration_minutes: number | null; archived: boolean }[]
  >`
    select a.id::int as id, a.type, a.subject, a.note, a.done_at, u.name as done_by_name, u.status = 'active' as done_by_active,
           to_char(a.due_on, 'YYYY-MM-DD') as due_on, to_char(a.due_time, 'HH24:MI') as due_time, a.duration_minutes,
           (exists (select 1 from deals xd where xd.id = a.deal_id and xd.archived_at is not null)
            or exists (select 1 from persons xp where xp.id = a.person_id and xp.archived_at is not null)
            or exists (select 1 from organisations xo where xo.id = a.organisation_id and xo.archived_at is not null)) as archived
    from activities a join users u on u.id = a.done_by
    where a.done_at is not null and ${activityWhere(sql, viewerId, target)} and ${visibleActivity(sql, viewerId)}
    order by a.done_at desc, a.id desc
    limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, kind: "activity" as const, actorName: r.done_by_name, fields: null, relatedPerson: null, fromPerson: null, relatedUserName: null, fromStage: null,
    toStage: null, cause: null, reason: null, fieldName: null, oldValue: null, newValue: null, createdAt: r.done_at, authorActive: r.done_by_active, deal: null, person: null, note: null, file: null,
    activity: {
      id: r.id, type: r.type, subject: r.subject, note: r.note, doneByName: r.done_by_name, doneByActive: r.done_by_active,
      dueOn: r.due_on, dueTime: r.due_time, durationMinutes: r.duration_minutes, archived: r.archived,
    },
  }));
}

// Newest first, `limit` entries (`more` when there are older ones). Events about a person the viewer cannot see are left
// out (events about a deleted person have no related person and stay). Mentions show the users' current names.
export async function readTimeline(viewerId: number, target: Target, limit = 50): Promise<TimelinePage> {
  return selectEntries(viewerId, targetWhere(sql, viewerId, target), limit, {
    deals: !("dealId" in target),
    personOtherThan: null,
    activitiesOf: target,
  });
}

// The shared read of timeline entries (SF-114 research.md §10): `where` picks the events (it must hold the visibility
// of their records); `show.deals` names the deal of a deal's entry; `show.personOtherThan` names the person of a person's
// entry unless it is that person (the ambassador's own entries); `show.activitiesOf` merges in the done activities of
// that record (SF-109; the ambassador's latest updates hold notes and changes only). Each event has one target, so none
// is read twice.
export async function selectEntries(
  viewerId: number,
  where: Fragment,
  limit: number,
  show: { deals: boolean; personOtherThan: number | null; activitiesOf?: Target },
): Promise<TimelinePage> {
  const rows = await sql<
    {
      id: number; kind: EventKind; actor_name: string | null; actor_active: boolean | null; fields: string[] | null; rp_id: number | null;
      rp_name: string | null; rp_page: boolean | null; fp_id: number | null; fp_name: string | null; fp_page: boolean | null;
      ru_name: string | null; from_stage: string | null; to_stage: string | null; cause: MoveCause | null;
      reason: string | null; field_name: string | null; old_value: string | null; new_value: string | null; created_at: Date; body: string | null; version: number; editor_name: string | null; editor_active: boolean | null;
      deal_id: number | null; deal_title: string | null; deal_archived: boolean | null;
      person_id: number | null; person_name: string | null; person_archived: boolean | null;
      file_id: number | null; file_name: string | null; file_size: number | null; file_kind: FileKind | null;
    }[]
  >`
    select e.id::int as id, e.kind, u.name as actor_name, u.status = 'active' as actor_active, e.fields, rp.id::int as rp_id,
           btrim(rp.first_name || ' ' || rp.last_name) as rp_name,
           case when e.kind in ('referrer_set', 'referrer_changed') and rp.id is not null then ${hasAmbassadorPage(sql, viewerId, "rp")} end as rp_page,
           fp.id::int as fp_id, btrim(fp.first_name || ' ' || fp.last_name) as fp_name,
           case when fp.id is not null then ${hasAmbassadorPage(sql, viewerId, "fp")} end as fp_page,
           ru.name as ru_name, e.from_stage, e.to_stage, e.cause,
           e.reason, e.field_name, e.old_value, e.new_value, e.created_at, e.body, e.version, eu.name as editor_name, eu.status = 'active' as editor_active,
           de.id::int as deal_id, de.title as deal_title, de.archived_at is not null as deal_archived,
           pe.id::int as person_id, btrim(pe.first_name || ' ' || pe.last_name) as person_name, pe.archived_at is not null as person_archived,
           e.file_id::int as file_id, e.file_name, e.file_size::float8 as file_size, fi.kind as file_kind
    from timeline_events e
    left join users u on u.id = e.actor_id
    left join persons rp on rp.id = e.related_person_id
    left join persons fp on fp.id = e.from_person_id
    left join users ru on ru.id = e.related_user_id
    left join users eu on eu.id = e.edited_by
    left join deals de on de.id = e.deal_id
    left join persons pe on pe.id = e.person_id
    left join files fi on fi.id = e.file_id
    where ${where}
      and (e.related_person_id is null or ${visiblePerson(sql, viewerId, "rp")})
      and (e.from_person_id is null or ${visiblePerson(sql, viewerId, "fp")})
    order by e.created_at desc, e.id desc
    limit ${limit + 1}`;
  const activities = show.activitiesOf ? await doneActivities(viewerId, show.activitiesOf, limit + 1) : [];
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
      relatedPerson: r.rp_id === null ? null : { id: r.rp_id, name: r.rp_name ?? "", ambassadorPage: r.rp_page === true },
      fromPerson: r.fp_id === null ? null : { id: r.fp_id, name: r.fp_name ?? "", ambassadorPage: r.fp_page === true },
      relatedUserName: r.ru_name,
      fromStage: r.from_stage,
      toStage: r.to_stage,
      cause: r.cause,
      reason: r.reason,
      fieldName: r.field_name,
      oldValue: r.old_value,
      newValue: r.new_value,
      createdAt: r.created_at,
      authorActive: r.actor_active ?? true,
      deal: show.deals && r.deal_id !== null ? { id: r.deal_id, title: r.deal_title ?? "", archived: r.deal_archived ?? false } : null,
      person:
        show.personOtherThan !== null && r.person_id !== null && r.person_id !== show.personOtherThan
          ? { id: r.person_id, name: r.person_name ?? "", archived: r.person_archived ?? false }
          : null,
      note:
        r.kind === "note" && r.body !== null
          ? {
              segments: noteSegments(r.body, names.get(r.id) ?? new Map()),
              editedByName: r.editor_name === null ? null : withStatus(r.editor_name, r.editor_active ?? true),
              version: r.version,
            }
          : null,
      activity: null,
      file:
        (r.kind === "file_added" || r.kind === "file_deleted") && r.file_name !== null
          ? { id: r.file_id, name: r.file_name, size: r.file_size, kind: r.file_kind }
          : null,
    }));
  const merged = [...events, ...activities].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { more: merged.length > limit, entries: merged.slice(0, limit) };
}
