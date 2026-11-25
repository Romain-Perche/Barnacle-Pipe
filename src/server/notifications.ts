// In-app notifications of @mentions (SF-102 research.md §4, §12; contracts/routes.md). A notification is a
// `note_mentions` row of the user, not saved by themselves, shown and counted only while the note's record is visible
// to them (the one rule in visibility.ts): a deal made private hides it, sharing it again brings it back.
// SF-109 (research.md §7): an activity assigned to the user by someone else is a notification too, kept on the
// activity row (assigned_by / assigned_at / assignment_read_at), shown only while visibleActivity() holds for them.
// SF-123 (research.md §5): a planned activity's reminder is a third kind, for its current assignee (themselves included),
// kept on the activity row (remind_at / reminder_read_at), shown from `remind_at` while planned and visibleActivity()
// holds. Every reminder read and write goes through myReminders(); `now` is a parameter so the tests pass the clock.
import type { ActivityType } from "@/server/activities/rules";
import { sql, type Sql } from "@/server/db";
import { notificationPreview } from "@/server/records/notes-rules";
import { visibleActivity, visibleDeal, visiblePerson } from "@/server/records/visibility";

export type MentionView = {
  kind: "mention"; eventId: number; byName: string; recordName: string; href: string; preview: string; createdAt: Date; read: boolean;
};
export type AssignmentView = {
  kind: "assignment"; id: number; byName: string; type: ActivityType; subject: string; dueOn: string; dueTime: string | null;
  durationMinutes: number | null; href: string; createdAt: Date; read: boolean;
};
export type ReminderView = {
  kind: "reminder"; id: number; type: ActivityType; subject: string; dueOn: string; dueTime: string | null;
  durationMinutes: number | null; href: string; createdAt: Date; read: boolean;
};
export type NotificationView = MentionView | AssignmentView | ReminderView;
export type NotificationRef = { kind: "mention" | "assignment" | "reminder"; id: number };

// The user's own live assignment notifications they can see now. Needs `a` (activities).
function myAssignments(db: Sql, userId: number) {
  return db`a.assignee_id = ${userId} and a.assigned_by <> ${userId} and ${visibleActivity(db, userId)}`;
}

// The user's own reminders shown at `now`: planned, their time come, visible. Needs `a` (activities).
function myReminders(db: Sql, userId: number, now: Date) {
  return db`a.assignee_id = ${userId} and a.done_at is null and a.remind_at is not null and a.remind_at <= ${now}
    and ${visibleActivity(db, userId)}`;
}

// The user's own notifications whose record they can see now. Needs `m` (note_mentions), `e`, `p`, `d`, `o` joined.
function mine(db: Sql, userId: number) {
  return db`m.user_id = ${userId} and m.user_id <> m.mentioned_by
    and (e.person_id is null or ${visiblePerson(db, userId, "p")})
    and (e.deal_id is null or ${visibleDeal(db, userId, "d")})`;
}

const FROM = (db: Sql) => db`
  note_mentions m
  join timeline_events e on e.id = m.event_id
  left join persons p on p.id = e.person_id
  left join deals d on d.id = e.deal_id
  left join organisations o on o.id = e.organisation_id`;

// The deal, else the person, else the organisation; an activity linked to nothing: the Activities list.
function href(r: { deal_id: number | null; person_id: number | null; organisation_id: number | null }): string {
  if (r.deal_id !== null) return `/deals/${r.deal_id}`;
  if (r.person_id !== null) return `/people/${r.person_id}`;
  if (r.organisation_id !== null) return `/organisations/${r.organisation_id}`;
  return "/activities";
}

async function listAssignments(userId: number, limit: number): Promise<AssignmentView[]> {
  const rows = await sql<
    { id: number; by_name: string; type: ActivityType; subject: string; due_on: string; due_time: string | null; duration_minutes: number | null;
      deal_id: number | null; person_id: number | null; organisation_id: number | null; assigned_at: Date; read: boolean }[]
  >`
    select a.id::int as id, bu.name as by_name, a.type, a.subject, to_char(a.due_on, 'YYYY-MM-DD') as due_on,
           to_char(a.due_time, 'HH24:MI') as due_time, a.duration_minutes, a.deal_id::int as deal_id, a.person_id::int as person_id,
           a.organisation_id::int as organisation_id, a.assigned_at, a.assignment_read_at is not null as read
    from activities a join users bu on bu.id = a.assigned_by
    where ${myAssignments(sql, userId)}
    order by a.assigned_at desc, a.id desc
    limit ${limit}`;
  return rows.map((r) => ({
    kind: "assignment" as const, id: r.id, byName: r.by_name, type: r.type, subject: r.subject, dueOn: r.due_on, dueTime: r.due_time,
    durationMinutes: r.duration_minutes, href: href(r), createdAt: r.assigned_at, read: r.read,
  }));
}

async function listReminders(userId: number, limit: number, now: Date): Promise<ReminderView[]> {
  const rows = await sql<
    { id: number; type: ActivityType; subject: string; due_on: string; due_time: string | null; duration_minutes: number | null;
      deal_id: number | null; person_id: number | null; organisation_id: number | null; remind_at: Date; read: boolean }[]
  >`
    select a.id::int as id, a.type, a.subject, to_char(a.due_on, 'YYYY-MM-DD') as due_on, to_char(a.due_time, 'HH24:MI') as due_time,
           a.duration_minutes, a.deal_id::int as deal_id, a.person_id::int as person_id, a.organisation_id::int as organisation_id,
           a.remind_at, a.reminder_read_at is not null as read
    from activities a
    where ${myReminders(sql, userId, now)}
    order by a.remind_at desc, a.id desc
    limit ${limit}`;
  return rows.map((r) => ({
    kind: "reminder" as const, id: r.id, type: r.type, subject: r.subject, dueOn: r.due_on, dueTime: r.due_time,
    durationMinutes: r.duration_minutes, href: href(r), createdAt: r.remind_at, read: r.read,
  }));
}

export async function listNotifications(userId: number, limit = 50, now: Date = new Date()): Promise<{ items: NotificationView[]; more: boolean }> {
  const rows = await sql<
    { event_id: number; by_name: string; record_name: string; deal_id: number | null; person_id: number | null; organisation_id: number | null;
      body: string; created_at: Date; read: boolean }[]
  >`
    select m.event_id::int as event_id, bu.name as by_name,
           coalesce(d.title, btrim(p.first_name || ' ' || p.last_name), o.name) as record_name,
           e.deal_id::int as deal_id, e.person_id::int as person_id, e.organisation_id::int as organisation_id,
           e.body, m.created_at, m.read_at is not null as read
    from ${FROM(sql)} join users bu on bu.id = m.mentioned_by
    where ${mine(sql, userId)}
    order by m.created_at desc, m.event_id desc
    limit ${limit + 1}`;
  const shown = rows;
  const names = new Map<number, Map<number, string>>();
  if (shown.length > 0) {
    const mentions = await sql<{ event_id: number; user_id: number; name: string }[]>`
      select m.event_id::int as event_id, m.user_id::int as user_id, u.name
      from note_mentions m join users u on u.id = m.user_id where m.event_id in ${sql(shown.map((r) => r.event_id))}`;
    for (const m of mentions) {
      if (!names.has(m.event_id)) names.set(m.event_id, new Map());
      names.get(m.event_id)!.set(m.user_id, m.name);
    }
  }
  const mentions: NotificationView[] = shown.map((r) => ({
    kind: "mention" as const,
    eventId: r.event_id,
    byName: r.by_name,
    recordName: r.record_name,
    href: href(r),
    preview: notificationPreview(r.body, names.get(r.event_id) ?? new Map()),
    createdAt: r.created_at,
    read: r.read,
  }));
  // Mentions, assignments and reminders together, newest first (a stable sort keeps each kind's own order on a tie):
  // the top `limit + 1` of each hold the page.
  const [assignments, reminders] = await Promise.all([listAssignments(userId, limit + 1), listReminders(userId, limit + 1, now)]);
  const all = [...mentions, ...assignments, ...reminders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { more: all.length > limit, items: all.slice(0, limit) };
}

export async function unreadCount(userId: number, now: Date = new Date()): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select (select count(*) from ${FROM(sql)} where m.read_at is null and ${mine(sql, userId)})::int
         + (select count(*) from activities a where a.assignment_read_at is null and ${myAssignments(sql, userId)})::int
         + (select count(*) from activities a where a.reminder_read_at is null and ${myReminders(sql, userId, now)})::int as n`;
  return row.n;
}

// Marks the user's own notification read (only while its record is visible) and answers where it leads; else null.
// `ref`: { kind, id } (a bare number is a mention's event id, as before SF-109). A reminder's id is its activity's.
export async function openNotification(userId: number, ref: number | NotificationRef, now: Date = new Date()): Promise<{ href: string } | null> {
  const { kind, id: eventId } = typeof ref === "number" ? { kind: "mention", id: ref } : ref;
  if (kind === "assignment") return openAssignment(userId, eventId);
  if (kind === "reminder") return openReminder(userId, eventId, now);
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [row] = await db<{ deal_id: number | null; person_id: number | null; organisation_id: number | null }[]>`
      select e.deal_id::int as deal_id, e.person_id::int as person_id, e.organisation_id::int as organisation_id
      from ${FROM(db)} where m.event_id = ${eventId} and ${mine(db, userId)}`;
    if (!row) return null;
    await db`update note_mentions set read_at = coalesce(read_at, now()) where event_id = ${eventId} and user_id = ${userId}`;
    return { href: href(row) };
  });
}

async function openAssignment(userId: number, id: number): Promise<{ href: string } | null> {
  const [row] = await sql<{ deal_id: number | null; person_id: number | null; organisation_id: number | null }[]>`
    update activities a set assignment_read_at = coalesce(a.assignment_read_at, now())
    where a.id = ${id} and ${myAssignments(sql, userId)}
    returning a.deal_id::int as deal_id, a.person_id::int as person_id, a.organisation_id::int as organisation_id`;
  return row ? { href: href(row) } : null;
}

// Only the reminder, never the assignment line of the same activity.
async function openReminder(userId: number, id: number, now: Date): Promise<{ href: string } | null> {
  const [row] = await sql<{ deal_id: number | null; person_id: number | null; organisation_id: number | null }[]>`
    update activities a set reminder_read_at = coalesce(a.reminder_read_at, ${now})
    where a.id = ${id} and ${myReminders(sql, userId, now)}
    returning a.deal_id::int as deal_id, a.person_id::int as person_id, a.organisation_id::int as organisation_id`;
  return row ? { href: href(row) } : null;
}

// Every unread row of the user, visible or not (harmless: hidden ones are neither shown nor counted); reminders only
// when shown now (SF-123 FR-004: those still to come stay unread), through myReminders().
export async function markAllRead(userId: number, now: Date = new Date()): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`update note_mentions set read_at = now() where user_id = ${userId} and read_at is null`;
    await tx`update activities set assignment_read_at = now()
             where assignee_id = ${userId} and assigned_by <> ${userId} and assignment_read_at is null`;
    await tx`update activities a set reminder_read_at = ${now} where a.reminder_read_at is null and ${myReminders(tx as unknown as Sql, userId, now)}`;
  });
}
