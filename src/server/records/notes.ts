// Notes on deals, people and organisations, with @mentions (SF-102 contracts/routes.md § Domain functions,
// data-model.md § State changes, research.md §3–§5, §10). Each change is one transaction that locks the record row
// through the one visibility rule (visibility.ts) and re-checks that it is not archived. Anyone who can see a note can
// edit or delete it. A mention is a `note_mentions` row; a row for someone other than who saved it is a notification.
import { sql, type Sql } from "@/server/db";
import { detokenize, tokenizeMentions, validateNoteText } from "@/server/records/notes-rules";
import type { Target } from "@/server/records/timeline";
import { visibleDeal, visiblePerson, type Viewer } from "@/server/records/visibility";

export type NoteTarget = Target;
export type NoteResult =
  | { status: "ok"; id: number }
  | { status: "invalid"; code: "note_required" | "note_too_long" }
  | { status: "cannot_mention"; name: string }
  | { status: "archived" }
  | { status: "not_found" }
  | { status: "gone" }
  | { status: "conflict" };
export type DeleteNoteResult = { status: "ok" | "archived" | "not_found" };

const MAX_MENTIONS = 50;

// Whether `viewer` (an id, or a column such as sql`u.id`) can see the record.
function canSee(db: Sql, viewer: Viewer, target: NoteTarget) {
  if ("dealId" in target) return db`exists (select 1 from deals d where d.id = ${target.dealId} and ${visibleDeal(db, viewer)})`;
  if ("personId" in target) return db`exists (select 1 from persons p where p.id = ${target.personId} and ${visiblePerson(db, viewer)})`;
  return db`exists (select 1 from organisations o where o.id = ${target.organisationId})`;
}

// The record row, locked, when the actor can see it: { archived } or null.
async function lockRecord(db: Sql, actorId: number, target: NoteTarget): Promise<{ archived: boolean } | null> {
  const [row] =
    "dealId" in target
      ? await db<{ archived: boolean }[]>`
          select d.archived_at is not null as archived from deals d where d.id = ${target.dealId} and ${visibleDeal(db, actorId)} for update`
      : "personId" in target
        ? await db<{ archived: boolean }[]>`
            select p.archived_at is not null as archived from persons p where p.id = ${target.personId} and ${visiblePerson(db, actorId)} for update`
        : await db<{ archived: boolean }[]>`
            select o.archived_at is not null as archived from organisations o where o.id = ${target.organisationId} for update`;
  return row ?? null;
}

// The note's own record column equals the posted target.
function onTarget(db: Sql, target: NoteTarget) {
  if ("dealId" in target) return db`e.deal_id = ${target.dealId}`;
  if ("personId" in target) return db`e.person_id = ${target.personId}`;
  return db`e.organisation_id = ${target.organisationId}`;
}

// The users behind the posted ids, with whether they may be mentioned now (active and can see the record).
async function mentionUsers(db: Sql, target: NoteTarget, ids: number[]) {
  if (ids.length === 0) return [];
  return db<{ id: number; name: string; allowed: boolean }[]>`
    select u.id::int as id, u.name, (u.status = 'active' and ${canSee(db, db`u.id`, target)}) as allowed
    from users u where u.id in ${db(ids)}`;
}

const uniqueIds = (ids: number[]) => [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MAX_MENTIONS);

// Tokenizes the text with the posted mentions. A mention not already in the note (`kept`) must be an active user
// who can see the record; else the first such user's name is returned and nothing is saved (research.md §5).
type Resolved = { refused: string } | { refused: null; body: string; ids: number[] };

async function resolve(db: Sql, target: NoteTarget, text: string, posted: number[], kept: Set<number>): Promise<Resolved> {
  const users = await mentionUsers(db, target, uniqueIds(posted));
  const { body, ids } = tokenizeMentions(text, users);
  const refused = users.find((u) => ids.includes(u.id) && !kept.has(u.id) && !u.allowed);
  return refused ? { refused: refused.name } : { refused: null, body, ids };
}

async function insertMentions(db: Sql, eventId: number, ids: number[], by: number) {
  for (const id of ids) {
    await db`insert into note_mentions (event_id, user_id, mentioned_by) values (${eventId}, ${id}, ${by}) on conflict do nothing`;
  }
}

export async function addNote(actorId: number, target: NoteTarget, text: string, mentionIds: number[]): Promise<NoteResult> {
  const valid = validateNoteText(text);
  return sql.begin(async (tx): Promise<NoteResult> => {
    const db = tx as unknown as Sql;
    const record = await lockRecord(db, actorId, target);
    if (!record) return { status: "not_found" };
    if (record.archived) return { status: "archived" };
    if (!valid.ok) return { status: "invalid", code: valid.code };
    const mentions = await resolve(db, target, valid.text, mentionIds, new Set());
    if (mentions.refused !== null) return { status: "cannot_mention", name: mentions.refused };
    const personId = "personId" in target ? target.personId : null;
    const organisationId = "organisationId" in target ? target.organisationId : null;
    const dealId = "dealId" in target ? target.dealId : null;
    const [row] = await db<{ id: number }[]>`
      insert into timeline_events (person_id, organisation_id, deal_id, kind, actor_id, body)
      values (${personId}, ${organisationId}, ${dealId}, 'note', ${actorId}, ${mentions.body}) returning id::int as id`;
    await insertMentions(db, row.id, mentions.ids, actorId);
    return { status: "ok", id: row.id };
  });
}

export async function editNote(
  actorId: number, target: NoteTarget, noteId: number, version: number, text: string, mentionIds: number[],
): Promise<NoteResult> {
  const valid = validateNoteText(text);
  return sql.begin(async (tx): Promise<NoteResult> => {
    const db = tx as unknown as Sql;
    const record = await lockRecord(db, actorId, target);
    if (!record) return { status: "not_found" };
    if (record.archived) return { status: "archived" };
    const [note] = await db<{ version: number }[]>`
      select e.version from timeline_events e where e.id = ${noteId} and e.kind = 'note' and ${onTarget(db, target)} for update`;
    if (!note) {
      // Still there (on another record, or not a note): not this record's note. Gone: deleted meanwhile.
      const [other] = await db`select 1 from timeline_events where id = ${noteId}`;
      return other ? { status: "not_found" } : { status: "gone" };
    }
    if (note.version !== version) return { status: "conflict" };
    if (!valid.ok) return { status: "invalid", code: valid.code };
    const current = await db<{ user_id: number }[]>`select user_id::int as user_id from note_mentions where event_id = ${noteId}`;
    const kept = new Set(current.map((m) => m.user_id));
    const mentions = await resolve(db, target, valid.text, mentionIds, kept);
    if (mentions.refused !== null) return { status: "cannot_mention", name: mentions.refused };
    await db`
      update timeline_events set body = ${mentions.body}, edited_by = ${actorId}, edited_at = now(), version = version + 1
      where id = ${noteId}`;
    const dropped = [...kept].filter((id) => !mentions.ids.includes(id));
    if (dropped.length > 0) await db`delete from note_mentions where event_id = ${noteId} and user_id in ${db(dropped)}`;
    await insertMentions(db, noteId, mentions.ids.filter((id) => !kept.has(id)), actorId);
    return { status: "ok", id: noteId };
  });
}

// Its mentions (notifications) go with it (on delete cascade).
export async function deleteNote(actorId: number, target: NoteTarget, noteId: number): Promise<DeleteNoteResult> {
  return sql.begin(async (tx): Promise<DeleteNoteResult> => {
    const db = tx as unknown as Sql;
    const record = await lockRecord(db, actorId, target);
    if (!record) return { status: "not_found" };
    if (record.archived) return { status: "archived" };
    const rows = await db`delete from timeline_events e where e.id = ${noteId} and e.kind = 'note' and ${onTarget(db, target)} returning e.id`;
    return { status: rows.length > 0 ? "ok" : "not_found" };
  });
}

// Who can be mentioned on the record: active users who can see it, by name. Nothing when the viewer cannot see it.
export async function mentionCandidates(viewerId: number, target: NoteTarget): Promise<{ id: number; name: string }[]> {
  return sql<{ id: number; name: string }[]>`
    select u.id::int as id, u.name from users u
    where ${canSee(sql, viewerId, target)} and u.status = 'active' and ${canSee(sql, sql`u.id`, target)}
    order by lower(u.name), u.id`;
}

// The note as the edit box shows it: tokens back to "@<current name>", the mentions to pre-fill, the version.
export async function noteForEdit(
  viewerId: number, target: NoteTarget, noteId: number,
): Promise<{ text: string; mentions: { id: number; name: string }[]; version: number } | null> {
  const [note] = await sql<{ body: string; version: number }[]>`
    select e.body, e.version from timeline_events e
    where e.id = ${noteId} and e.kind = 'note' and ${onTarget(sql, target)} and ${canSee(sql, viewerId, target)}`;
  if (!note) return null;
  const mentions = await sql<{ id: number; name: string }[]>`
    select u.id::int as id, u.name from note_mentions m join users u on u.id = m.user_id where m.event_id = ${noteId} order by u.id`;
  return { text: detokenize(note.body, new Map(mentions.map((m) => [m.id, m.name]))), mentions, version: note.version };
}
