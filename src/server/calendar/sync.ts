// Google Calendar two-way sync (SF-124 research.md §7-§12, §14, data-model.md § Sync rules).
// syncCalendar(connection): one run at a time per connection (a lease column, separate from Gmail's), then
// - pull: Google's changes since the last sync token (a full listing the first time, or after a 410, handling only items
//   updated since the connection or the last sync minus an hour). A linked event goes through the three-way merge
//   (the later change wins); a cancelled one, or a meeting from Google the user declined, ends its link for good; a new
//   eligible event with a visible CRM person as guest becomes a Meeting;
// - push: a reconcile of what the user's calendar should hold against calendar_events: events of deleted, reassigned or
//   hidden activities removed (a meeting from Google is left in the calendar), changed ones patched, planned activities
//   due today or later with no link created under an id chosen before the insert (a retry never makes a second event).
//   At most 200 Google writes per run; the rest goes on in the next round or run.
// No Google call is ever made inside sql.begin(); every link write is conditional on the row's state and activity, so a
// row changed meanwhile is left for the next run.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ukToday, type ActivityType } from "@/server/activities/rules";
import { CalendarRefused, deleteEvent, insertEvent, listEvents, patchEvent, stopChannel, watchEvents } from "@/server/calendar/calendar-api";
import {
  bodyHash,
  decideIncoming,
  eventBody,
  fromEvent,
  googleEventBody,
  isCancelled,
  merge,
  newEventId,
  selfDeclined,
  subjectFromTitle,
  type GoogleEvent,
  type SyncValues,
} from "@/server/calendar/rules";
import { sql, type Sql } from "@/server/db";
import { calendarConfig, gmailConfig } from "@/server/env";
import { loadKey, markNeedsReconnect } from "@/server/gmail/connections";
import { GoogleKeyRefused, GoogleUnavailable, refreshAccessToken } from "@/server/gmail/google-api";
import { CALENDAR_SCOPE } from "@/server/gmail/rules";
import { messages } from "@/server/messages";
import { visibleActivity, visiblePerson } from "@/server/records/visibility";

const LEASE_MS = 2 * 60 * 1000;
export const MAX_WRITES_PER_RUN = 200;
const MAX_ROUNDS = 5;
const CATCH_UP_MARGIN_MS = 60 * 60 * 1000;
const RENEW_AFTER_MS = 20 * 60 * 60 * 1000;
const CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60;

export type CalendarSyncResult =
  | { pulled: number; created: number; changed: number; removed: number; imported: number }
  | { skipped: "busy" | "off" | "not_working" | "no_calendar" | "needs_reconnect" | "unavailable" };
type Totals = { pulled: number; created: number; changed: number; removed: number; imported: number };

// Whether a connection row (`c`) holds the Calendar scope.
export const hasCalendar = (db: Sql, alias = "c") => db`(${CALENDAR_SCOPE} = any(regexp_split_to_array(${db(alias)}.scopes, '[[:space:]]+')))`;

type Conn = { id: number; userId: number; connectedAt: Date; syncToken: string | null; lastSyncedAt: Date | null };

async function takeLease(connectionId: number, now: Date): Promise<Conn | null> {
  const [row] = await sql<{ user_id: string; connected_at: Date | null; token: string | null; last: Date | null }[]>`
    update gmail_connections c set calendar_lease_until = ${new Date(now.getTime() + LEASE_MS)}, calendar_sync_again = false
    where c.id = ${connectionId} and c.state = 'working' and ${hasCalendar(sql)}
      and (c.calendar_lease_until is null or c.calendar_lease_until < ${now})
    returning c.user_id::text as user_id, c.calendar_connected_at as connected_at, c.calendar_sync_token as token,
              c.calendar_last_synced_at as last`;
  if (!row) return null;
  return { id: connectionId, userId: Number(row.user_id), connectedAt: row.connected_at ?? now, syncToken: row.token, lastSyncedAt: row.last };
}

const releaseLease = (connectionId: number) => sql`update gmail_connections set calendar_lease_until = null where id = ${connectionId}`;

// Google says the key no longer reaches the calendar (the user took Calendar away): the scope goes, so Settings shows
// "Calendar access missing" and the "!"; Gmail carries on.
async function dropCalendarScope(connectionId: number) {
  await sql`
    update gmail_connections
    set scopes = array_to_string(array_remove(regexp_split_to_array(scopes, '[[:space:]]+'), ${CALENDAR_SCOPE}), ' '),
        calendar_lease_until = null, calendar_sync_again = false, updated_at = now()
    where id = ${connectionId}`;
}

type LinkRow = {
  id: string;
  google_updated_at: Date | null;
  activity_id: string | null;
  google_event_id: string;
  origin: "crm" | "google";
  state: "creating" | "synced" | "ended";
  base: Partial<SyncValues>;
  synced_version: number | null;
  sent_hash: string | null;
  dirty: boolean;
};

type ActivityRow = {
  id: string;
  type: ActivityType;
  subject: string;
  due_on: string;
  due_time: string | null;
  duration_minutes: number | null;
  note: string | null;
  done: boolean;
  version: number;
  updated_at: Date;
};

const ACTIVITY = (db: Sql) => db`
  a.id::text as id, a.type, a.subject, to_char(a.due_on, 'YYYY-MM-DD') as due_on, to_char(a.due_time, 'HH24:MI') as due_time,
  a.duration_minutes, a.note, a.done_at is not null as done, a.version, a.updated_at`;

const valuesOf = (a: ActivityRow): SyncValues => ({ subject: a.subject, dueOn: a.due_on, dueTime: a.due_time, durationMinutes: a.duration_minutes });
const forEvent = (a: ActivityRow) => ({ ...valuesOf(a), id: Number(a.id), type: a.type, note: a.note, done: a.done });

function isBase(b: Partial<SyncValues>): b is SyncValues {
  return typeof b.subject === "string" && typeof b.dueOn === "string";
}

// ---- pull (Google → CRM) ---------------------------------------------------------------------------------------------

async function listAll(access: string, syncToken: string | null): Promise<{ items: GoogleEvent[]; nextSyncToken: string | null }> {
  const items: GoogleEvent[] = [];
  let page: string | null = null;
  for (;;) {
    const r = await listEvents(access, { syncToken, pageToken: page });
    items.push(...r.items);
    if (!r.nextPageToken) return { items, nextSyncToken: r.nextSyncToken };
    page = r.nextPageToken;
  }
}

async function pull(conn: Conn, access: string, now: Date): Promise<{ pulled: number; imported: number }> {
  let listed: { items: GoogleEvent[]; nextSyncToken: string | null } | null = null;
  let since: Date | null = null;
  if (conn.syncToken) {
    try {
      listed = await listAll(access, conn.syncToken);
    } catch (e) {
      if (!(e instanceof CalendarRefused && e.kind === "sync_token_gone")) throw e;
    }
  }
  if (!listed) {
    since = conn.lastSyncedAt ? new Date(conn.lastSyncedAt.getTime() - CATCH_UP_MARGIN_MS) : conn.connectedAt;
    listed = await listAll(access, null);
  }
  const items = listed.items.filter((e) => typeof e.id === "string" && (since === null || new Date(e.updated ?? 0).getTime() >= since.getTime()));
  let pulled = 0;
  let imported = 0;
  const ids = [...new Set(items.map((e) => e.id as string))];
  const links = new Map(
    (ids.length === 0
      ? []
      : await sql<LinkRow[]>`
          select id::text as id, activity_id::text as activity_id, google_event_id, origin, state, base, synced_version, sent_hash, dirty, google_updated_at
          from calendar_events where connection_id = ${conn.id} and google_event_id = any(${ids})`
    ).map((l) => [l.google_event_id, l]),
  );
  for (const item of items) {
    const link = links.get(item.id as string);
    if (link) {
      if (await applyLinkedChange(conn, link, item)) pulled += 1;
    } else if (await importEvent(conn, item, now)) {
      imported += 1;
    }
  }
  await sql`
    update gmail_connections set calendar_sync_token = ${listed.nextSyncToken}, calendar_last_synced_at = ${now}
    where id = ${conn.id} and state = 'working'`;
  return { pulled, imported };
}

// The activity of a link, when it is still the user's to sync: assigned to them and visible to them.
async function mine(conn: Conn, activityId: string): Promise<ActivityRow | null> {
  const [a] = await sql<ActivityRow[]>`
    select ${ACTIVITY(sql)} from activities a
    where a.id = ${activityId} and a.assignee_id = ${conn.userId} and ${visibleActivity(sql, conn.userId)}`;
  return a ?? null;
}

const endLink = (linkId: string) => sql`update calendar_events set state = 'ended', updated_at = now() where id = ${linkId} and state = 'synced'`;

// A change to a linked event (research.md §9). True when the activity changed.
async function applyLinkedChange(conn: Conn, link: LinkRow, item: GoogleEvent): Promise<boolean> {
  if (link.state !== "synced" || link.activity_id === null) return false;
  const a = await mine(conn, link.activity_id);
  if (!a) return false;
  if (isCancelled(item) || (link.origin === "google" && selfDeclined(item))) {
    await endLink(link.id);
    return false;
  }
  const when = fromEvent(item);
  const googleUpdated = new Date(item.updated ?? 0);
  // Nothing changed in Google since the link last saw the event (the CRM's own write, or a notice delivered twice).
  if (!when || (link.google_updated_at && googleUpdated.getTime() <= link.google_updated_at.getTime())) return false;
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [l] = await db<LinkRow[]>`
      select id::text as id, activity_id::text as activity_id, google_event_id, origin, state, base, synced_version, sent_hash, dirty, google_updated_at
      from calendar_events where id = ${link.id} and state = 'synced' and activity_id = ${a.id} for update`;
    if (!l) return false;
    const [cur] = await db<ActivityRow[]>`select ${ACTIVITY(db)} from activities a where a.id = ${a.id} for update`;
    if (!cur) return false;
    const crm = valuesOf(cur);
    const base = isBase(l.base) ? l.base : crm;
    const m = merge(base, crm, { ...when, subject: subjectFromTitle(item.summary, l.origin, cur.type) }, cur.updated_at, googleUpdated);
    let version = cur.version;
    if (m.fromGoogle) {
      const v = m.values;
      const [row] = await db<{ version: number }[]>`
        update activities set subject = ${v.subject}, due_on = ${v.dueOn}, due_time = ${v.dueTime}, duration_minutes = ${v.durationMinutes},
               version = version + 1, updated_at = now()
        where id = ${a.id} returning version`;
      version = row.version;
    }
    // Nothing of the CRM's was waiting to be sent: the new version is in step with Google.
    const inStep = l.synced_version === cur.version && !l.dirty && !m.dirty;
    await db`
      update calendar_events set base = ${db.json(m.values)}, google_updated_at = ${Number.isNaN(googleUpdated.getTime()) ? null : googleUpdated},
             dirty = ${l.dirty || m.dirty}, synced_version = ${inStep ? version : l.synced_version}, updated_at = now()
      where id = ${l.id}`;
    return m.fromGoogle;
  });
}

class Skip extends Error {}

// A new event that may come in as a Meeting (research.md §10). True when it did.
async function importEvent(conn: Conn, item: GoogleEvent, now: Date): Promise<boolean> {
  const d = decideIncoming(item, { since: conn.connectedAt, now });
  const when = fromEvent(item);
  if (!d || !when) return false;
  const [p] = await sql<{ person_id: string; organisation_id: string | null }[]>`
    select p.id::text as person_id, case when o.archived_at is null then o.id::text end as organisation_id
    from unnest(${d.guests}::text[]) with ordinality as g(email, n)
    join person_emails pe on pe.email = g.email
    join persons p on p.id = pe.person_id and p.archived_at is null and ${visiblePerson(sql, conn.userId)}
    left join organisations o on o.id = p.organisation_id
    order by g.n limit 1`;
  if (!p) return false;
  const values: SyncValues = { ...when, subject: subjectFromTitle(item.summary, "google", "meeting") ?? messages.calendar_untitled };
  const updated = new Date(item.updated ?? 0);
  try {
    await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const [act] = await db<{ id: string; version: number }[]>`
        insert into activities (type, subject, due_on, due_time, duration_minutes, note, person_id, organisation_id, assignee_id, created_by, assigned_by)
        values ('meeting', ${values.subject}, ${values.dueOn}, ${values.dueTime}, ${values.durationMinutes}, null, ${p.person_id},
                ${p.organisation_id}, ${conn.userId}, ${conn.userId}, ${conn.userId})
        returning id::text as id, version`;
      const [link] = await db`
        insert into calendar_events (activity_id, connection_id, google_event_id, origin, state, base, synced_version, sent_hash, google_updated_at)
        values (${act.id}, ${conn.id}, ${item.id as string}, 'google', 'synced', ${db.json(values)}, ${act.version},
                ${bodyHash(googleEventBody({ ...values, done: false }))}, ${Number.isNaN(updated.getTime()) ? null : updated})
        on conflict (connection_id, google_event_id) do nothing
        returning id`;
      // Another run brought it in meanwhile: this meeting is not made.
      if (!link) throw new Skip();
    });
  } catch (e) {
    if (e instanceof Skip) return false;
    throw e;
  }
  return true;
}

// ---- push (CRM → Google) ---------------------------------------------------------------------------------------------

type PushTotals = { created: number; changed: number; removed: number; more: boolean };

async function push(conn: Conn, access: string, now: Date): Promise<PushTotals> {
  const t: PushTotals = { created: 0, changed: 0, removed: 0, more: false };
  let writes = 0;
  const room = () => {
    if (writes < MAX_WRITES_PER_RUN) return true;
    t.more = true;
    return false;
  };

  // 1. Gone, reassigned or hidden.
  const gone = await sql<(LinkRow & { has_activity: boolean })[]>`
    select ce.id::text as id, ce.activity_id::text as activity_id, ce.google_event_id, ce.origin, ce.state, ce.base,
           ce.synced_version, ce.sent_hash, ce.dirty, a.id is not null as has_activity
    from calendar_events ce left join activities a on a.id = ce.activity_id
    where ce.connection_id = ${conn.id}
      and ((ce.activity_id is null and not (ce.state = 'ended' and ce.origin = 'google'))
        or (ce.state <> 'ended' and a.id is not null and (a.assignee_id <> ${conn.userId} or not ${visibleActivity(sql, conn.userId)})))
    order by ce.id`;
  for (const l of gone) {
    if (l.state === "ended") {
      await sql`delete from calendar_events where id = ${l.id} and state = 'ended' and activity_id is null`;
      continue;
    }
    if (l.origin === "google") {
      // A meeting from Google stays in the user's calendar, unsynced (spec § Clarifications).
      await sql`update calendar_events set state = 'ended', updated_at = now() where id = ${l.id} and state = 'synced'`;
      continue;
    }
    if (!room()) break;
    writes += 1;
    await deleteEvent(access, l.google_event_id);
    await sql`delete from calendar_events where id = ${l.id} and state = ${l.state} and activity_id is not distinct from ${l.activity_id}`;
    t.removed += 1;
  }

  // 2. Changed in the CRM, or a field the CRM won in a merge.
  const changed = await sql<(LinkRow & ActivityRow & { link_id: string })[]>`
    select ce.id::text as link_id, ce.google_event_id, ce.origin, ce.state, ce.base, ce.synced_version, ce.sent_hash, ce.dirty, ${ACTIVITY(sql)}
    from calendar_events ce join activities a on a.id = ce.activity_id
    where ce.connection_id = ${conn.id} and ce.state = 'synced' and a.assignee_id = ${conn.userId} and ${visibleActivity(sql, conn.userId)}
      and (ce.synced_version is distinct from a.version or ce.dirty)
    order by ce.id`;
  for (const r of changed) {
    const body = r.origin === "crm" ? eventBody(forEvent(r), gmailAppUrl()) : googleEventBody(forEvent(r));
    const hash = bodyHash(body);
    const settle = (fields: { hash: string | null; updated?: string }) => sql`
      update calendar_events set sent_hash = ${fields.hash}, synced_version = ${r.version}, base = ${sql.json(valuesOf(r))},
             google_updated_at = coalesce(${fields.updated ? new Date(fields.updated) : null}::timestamptz, google_updated_at), dirty = false, updated_at = now()
      where id = ${r.link_id} and state = 'synced' and activity_id = ${r.id}`;
    if (hash === r.sent_hash && !r.dirty) {
      // Nothing Google shows would change (e.g. ticking a meeting from Google).
      await settle({ hash });
      continue;
    }
    if (!room()) break;
    writes += 1;
    try {
      const ev = await patchEvent(access, r.google_event_id, body);
      if (isCancelled(ev)) await endLink(r.link_id);
      else await settle({ hash, updated: ev.updated });
      t.changed += 1;
    } catch (e) {
      if (!(e instanceof CalendarRefused)) throw e;
      if (e.kind === "event_gone") await endLink(r.link_id);
      else if (e.kind === "event_refused") {
        // Google refuses this one change (e.g. the user did not organise the meeting): tried again only after the next.
        await sql`update calendar_events set synced_version = ${r.version}, dirty = false, updated_at = now() where id = ${r.link_id} and state = 'synced'`;
      } else throw e;
    }
  }

  // 3. Missing: links whose insert was not confirmed, then planned activities due today or later with no link at all.
  // A link left by a connection that no longer syncs (its user disconnected) does not block the new assignee's event.
  await sql`
    delete from calendar_events ce using activities a, gmail_connections oc
    where a.id = ce.activity_id and oc.id = ce.connection_id and a.assignee_id = ${conn.userId} and ce.connection_id <> ${conn.id}
      and ce.origin = 'crm' and ce.state <> 'ended' and (oc.state <> 'working' or not ${hasCalendar(sql, "oc")})`;
  if (!t.more) {
    const retry = await sql<(ActivityRow & { link_id: string; google_event_id: string })[]>`
      select ce.id::text as link_id, ce.google_event_id, ${ACTIVITY(sql)}
      from calendar_events ce join activities a on a.id = ce.activity_id
      where ce.connection_id = ${conn.id} and ce.state = 'creating' and a.assignee_id = ${conn.userId} and ${visibleActivity(sql, conn.userId)}
      order by ce.id`;
    const fresh = await sql<ActivityRow[]>`
      select ${ACTIVITY(sql)} from activities a
      where a.assignee_id = ${conn.userId} and a.done_at is null and a.due_on >= ${ukToday(now)}::date and ${visibleActivity(sql, conn.userId)}
        and not exists (select 1 from calendar_events ce where ce.activity_id = a.id)
      order by a.due_on, a.due_time nulls first, a.id
      limit ${MAX_WRITES_PER_RUN + 1}`;
    const todo: (ActivityRow & { link_id: string; google_event_id: string })[] = [...retry];
    for (const a of fresh) {
      if (todo.length > MAX_WRITES_PER_RUN) break;
      const [row] = await sql<{ id: string; google_event_id: string }[]>`
        insert into calendar_events (activity_id, connection_id, google_event_id, origin, state)
        values (${a.id}, ${conn.id}, ${newEventId()}, 'crm', 'creating')
        on conflict (activity_id) do nothing
        returning id::text as id, google_event_id`;
      if (row) todo.push({ ...a, link_id: row.id, google_event_id: row.google_event_id });
    }
    for (const r of todo) {
      if (!room()) break;
      writes += 1;
      const body = eventBody(forEvent(r), gmailAppUrl());
      let ev: GoogleEvent;
      try {
        try {
          ev = await insertEvent(access, r.google_event_id, body);
        } catch (e) {
          // The id already exists: an insert whose answer was lost. Bring it to the activity's values.
          if (!(e instanceof CalendarRefused && e.kind === "exists")) throw e;
          ev = await patchEvent(access, r.google_event_id, body);
        }
      } catch (e) {
        if (!(e instanceof CalendarRefused)) throw e;
        if (e.kind === "event_refused") await sql`delete from calendar_events where id = ${r.link_id} and state = 'creating'`;
        else if (e.kind === "event_gone") await sql`update calendar_events set state = 'ended', updated_at = now() where id = ${r.link_id} and state = 'creating'`;
        else throw e;
        continue;
      }
      if (isCancelled(ev)) {
        await sql`update calendar_events set state = 'ended', updated_at = now() where id = ${r.link_id} and state = 'creating'`;
        continue;
      }
      await sql`
        update calendar_events set state = 'synced', sent_hash = ${bodyHash(body)}, synced_version = ${r.version}, base = ${sql.json(valuesOf(r))},
               google_updated_at = ${ev.updated ? new Date(ev.updated) : null}, dirty = false, updated_at = now()
        where id = ${r.link_id} and state = 'creating'`;
      t.created += 1;
    }
  }
  return t;
}

function gmailAppUrl(): string {
  const c = gmailConfig();
  return c.mode === "off" ? "" : c.appUrl;
}

// ---- runs ------------------------------------------------------------------------------------------------------------

async function runOnce(conn: Conn, now: Date): Promise<Totals> {
  const key = await loadKey(conn.id);
  if (!key) throw new GoogleKeyRefused(0, "unreadable");
  const access = await refreshAccessToken(key);
  const { pulled, imported } = await pull(conn, access, now);
  const p = await push(conn, access, now);
  if (p.more) await sql`update gmail_connections set calendar_sync_again = true where id = ${conn.id}`;
  return { pulled, imported, created: p.created, changed: p.changed, removed: p.removed };
}

// One calendar sync of a connection: pull then push, again while another caller asked for it meanwhile (at most 5).
export async function syncCalendar(connectionId: number, now = new Date()): Promise<CalendarSyncResult> {
  if (calendarConfig().mode === "off") return { skipped: "off" };
  const totals: Totals = { pulled: 0, created: 0, changed: 0, removed: 0, imported: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const conn = await takeLease(connectionId, now);
    if (!conn) {
      if (round > 0) return totals;
      const [row] = await sql<{ state: string; cal: boolean }[]>`
        select c.state, ${hasCalendar(sql)} as cal from gmail_connections c where c.id = ${connectionId}`;
      if (!row || row.state === "disconnected") return { skipped: "not_working" };
      if (row.state === "needs_reconnect") return { skipped: "needs_reconnect" };
      if (!row.cal) return { skipped: "no_calendar" };
      // Someone else holds the lease: they go once more, so this caller's changes are not missed.
      await sql`update gmail_connections set calendar_sync_again = true where id = ${connectionId} and state = 'working'`;
      return { skipped: "busy" };
    }
    try {
      const r = await runOnce(conn, now);
      for (const k of Object.keys(totals) as (keyof Totals)[]) totals[k] += r[k];
    } catch (e) {
      if (e instanceof GoogleKeyRefused) {
        await markNeedsReconnect(connectionId);
        return { skipped: "needs_reconnect" };
      }
      if (e instanceof CalendarRefused && e.kind === "no_calendar_access") {
        await dropCalendarScope(connectionId);
        return { skipped: "no_calendar" };
      }
      await releaseLease(connectionId);
      if (e instanceof GoogleUnavailable) return { skipped: "unavailable" };
      throw e;
    }
    const [row] = await sql<{ again: boolean }[]>`
      update gmail_connections set calendar_lease_until = null where id = ${connectionId} returning calendar_sync_again as again`;
    if (!row?.again) break;
  }
  return totals;
}

// Asks Google to post change notices for the primary calendar (research.md §11): a new channel with a random secret
// token (only its sha256 is kept), then the old channel stopped (best effort).
export async function renewCalendarChannel(connectionId: number, now = new Date()): Promise<"renewed" | "needs_reconnect" | "unavailable" | "off"> {
  const cfg = calendarConfig();
  if (cfg.mode === "off") return "off";
  const [row] = await sql<{ id: string | null; resource: string | null }[]>`
    select c.calendar_channel_id as id, c.calendar_channel_resource_id as resource from gmail_connections c
    where c.id = ${connectionId} and c.state = 'working' and ${hasCalendar(sql)}`;
  if (!row) return "off";
  try {
    const key = await loadKey(connectionId);
    if (!key) throw new GoogleKeyRefused(0, "unreadable");
    const access = await refreshAccessToken(key);
    const token = randomBytes(32).toString("base64url");
    const ch = await watchEvents(access, { id: randomUUID(), address: cfg.pushAddress, token, ttlSeconds: CHANNEL_TTL_SECONDS });
    const [stored] = await sql`
      update gmail_connections c
      set calendar_channel_id = ${ch.id}, calendar_channel_resource_id = ${ch.resourceId},
          calendar_channel_token_hash = ${createHash("sha256").update(token).digest()}, calendar_channel_expires_at = ${ch.expiration},
          calendar_channel_renewed_at = ${now}
      where c.id = ${connectionId} and c.state = 'working' and ${hasCalendar(sql)}
      returning c.id`;
    const old = stored ? (row.id && row.resource ? { id: row.id, resourceId: row.resource } : null) : { id: ch.id, resourceId: ch.resourceId };
    if (old) await stopChannel(access, old).catch(() => {});
    return stored ? "renewed" : "off";
  } catch (e) {
    if (e instanceof GoogleKeyRefused) {
      await markNeedsReconnect(connectionId);
      return "needs_reconnect";
    }
    if (e instanceof CalendarRefused && e.kind === "no_calendar_access") {
      await dropCalendarScope(connectionId);
      return "off";
    }
    if (e instanceof GoogleUnavailable || e instanceof CalendarRefused) return "unavailable";
    throw e;
  }
}

// The calendar part of the 15-minute check for one connection: a sync, then the channel renewal when it is due.
export async function runCalendarCheck(connectionId: number, now = new Date()): Promise<void> {
  if (calendarConfig().mode === "off") return;
  const [row] = await sql<{ due: boolean }[]>`
    select (c.calendar_channel_renewed_at is null or c.calendar_channel_renewed_at < ${new Date(now.getTime() - RENEW_AFTER_MS)}) as due
    from gmail_connections c where c.id = ${connectionId} and c.state = 'working' and ${hasCalendar(sql)}`;
  if (!row) return;
  await syncCalendar(connectionId, now);
  if (row.due) await renewCalendarChannel(connectionId, now);
}

// After a change in the CRM (research.md §12): the connections holding those activities' links, then their assignees'
// connections, then any connection with a link whose activity is gone; each synced. Never throws.
export async function calendarAfterChange(activityIds: number[], now = new Date()): Promise<void> {
  try {
    if (calendarConfig().mode === "off") return;
    const rows = await sql<{ id: string; first: boolean }[]>`
      select c.id::text as id, bool_or(x.first) as first from (
        select ce.connection_id as id, true as first from calendar_events ce
        where ce.activity_id = any(${activityIds}::bigint[])
           or (ce.activity_id is null and not (ce.state = 'ended' and ce.origin = 'google'))
        union all
        select gc.id, false from activities a join gmail_connections gc on gc.user_id = a.assignee_id where a.id = any(${activityIds}::bigint[])
      ) x join gmail_connections c on c.id = x.id
      where c.state = 'working' and ${hasCalendar(sql)}
      group by c.id order by bool_or(x.first) desc, c.id`;
    for (const r of rows) await syncCalendar(Number(r.id), now).catch(() => {});
  } catch {
    // The 15-minute check catches up.
  }
}

// The user's connection id, for the connect callback.
export async function calendarConnectionOf(userId: number): Promise<number | null> {
  const [row] = await sql<{ id: string }[]>`select id::text as id from gmail_connections where user_id = ${userId}`;
  return row ? Number(row.id) : null;
}
