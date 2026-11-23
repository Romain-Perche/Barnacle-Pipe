// In-app notifications of @mentions (SF-102 research.md §4, §12; contracts/routes.md). A notification is a
// `note_mentions` row of the user, not saved by themselves, shown and counted only while the note's record is visible
// to them (the one rule in visibility.ts): a deal made private hides it, sharing it again brings it back.
import { sql, type Sql } from "@/server/db";
import { notificationPreview } from "@/server/records/notes-rules";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

export type NotificationView = {
  eventId: number; byName: string; recordName: string; href: string; preview: string; createdAt: Date; read: boolean;
};

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

function href(r: { deal_id: number | null; person_id: number | null; organisation_id: number | null }): string {
  if (r.deal_id !== null) return `/deals/${r.deal_id}`;
  if (r.person_id !== null) return `/people/${r.person_id}`;
  return `/organisations/${r.organisation_id}`;
}

export async function listNotifications(userId: number, limit = 50): Promise<{ items: NotificationView[]; more: boolean }> {
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
  const shown = rows.slice(0, limit);
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
  return {
    more: rows.length > limit,
    items: shown.map((r) => ({
      eventId: r.event_id,
      byName: r.by_name,
      recordName: r.record_name,
      href: href(r),
      preview: notificationPreview(r.body, names.get(r.event_id) ?? new Map()),
      createdAt: r.created_at,
      read: r.read,
    })),
  };
}

export async function unreadCount(userId: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from ${FROM(sql)} where m.read_at is null and ${mine(sql, userId)}`;
  return row.n;
}

// Marks the user's own notification read (only while its record is visible) and answers where it leads; else null.
export async function openNotification(userId: number, eventId: number): Promise<{ href: string } | null> {
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

// Every unread row of the user, visible or not (harmless: hidden ones are neither shown nor counted).
export async function markAllRead(userId: number): Promise<void> {
  await sql`update note_mentions set read_at = now() where user_id = ${userId} and read_at is null`;
}
