# Data model: Google Calendar: two-way sync (SF-124)

## Migration `migrations/0019_calendar.sql`

Only statements allowed in a transaction; RLS after the one `create table` (no policies). Number 0019 follows
SF-122's `0018_pipedrive_fetched.sql` on `origin/main`. If SF-123 has taken 0019 by then, use the next free number.

```sql
-- SF-124: Google Calendar two-way sync (data-model.md). The Calendar part of the SF-118 connection, the time of an
-- activity's last change (the later change wins, research.md §9) and one link per synced activity and event.
alter table gmail_connections
  add column calendar_connected_at timestamptz null,
  add column calendar_sync_token text null check (char_length(calendar_sync_token) <= 4096),
  add column calendar_last_synced_at timestamptz null,
  add column calendar_channel_id text null check (char_length(calendar_channel_id) <= 64),
  add column calendar_channel_resource_id text null check (char_length(calendar_channel_resource_id) <= 255),
  add column calendar_channel_token_hash bytea null check (octet_length(calendar_channel_token_hash) = 32),
  add column calendar_channel_expires_at timestamptz null,
  add column calendar_channel_renewed_at timestamptz null,
  add column calendar_lease_until timestamptz null,
  add column calendar_sync_again boolean not null default false,
  add constraint gmail_connections_calendar_channel check (
    (calendar_channel_id is null) = (calendar_channel_token_hash is null)
    and (calendar_channel_id is null) = (calendar_channel_resource_id is null)),
  add constraint gmail_connections_calendar_off check (
    state <> 'disconnected' or (calendar_channel_id is null and calendar_lease_until is null and calendar_sync_token is null));
create unique index gmail_connections_calendar_channel_idx on gmail_connections (calendar_channel_id)
  where calendar_channel_id is not null;

-- Existing rows: now(). Set by editActivity, tickActivity, untickActivity and changes from Google.
alter table activities add column updated_at timestamptz not null default now();

create table calendar_events (
  id bigint generated always as identity primary key,
  activity_id bigint null unique references activities (id) on delete set null,
  connection_id bigint not null references gmail_connections (id) on delete cascade,
  google_event_id text not null check (char_length(google_event_id) between 5 and 1024),
  origin text not null check (origin in ('crm', 'google')),
  state text not null check (state in ('creating', 'synced', 'ended')),
  -- The values last agreed by both sides, in CRM terms: { subject, dueOn, dueTime, durationMinutes }.
  base jsonb not null default '{}' check (jsonb_typeof(base) = 'object'),
  synced_version int null,
  sent_hash text null check (sent_hash ~ '^[0-9a-f]{64}$'),
  google_updated_at timestamptz null,
  dirty boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, google_event_id),
  check (state <> 'creating' or origin = 'crm'),
  check (activity_id is not null or state = 'ended' or origin = 'crm')
);
alter table calendar_events enable row level security;
create index calendar_events_connection_idx on calendar_events (connection_id, state);
create index calendar_events_orphan_idx on calendar_events (connection_id) where activity_id is null;
```

`tests/support/reset.ts` truncates `calendar_events` too (before `activities` and `gmail_connections` in its list).

## Entities

### Google connection (`gmail_connections`, SF-118, extended)

| Column | Meaning |
|---|---|
| `scopes` (existing) | Space-separated scopes granted. Calendar is granted when it holds `https://www.googleapis.com/auth/calendar.events.owned` |
| `calendar_connected_at` | When calendar sync (re)started. Events updated before it never come in (FR-009) |
| `calendar_sync_token` | Google's `nextSyncToken` after the last complete listing. Null: the next sync does a full listing (§8) |
| `calendar_last_synced_at` | End of the last complete pull + push. The 410 catch-up lists changes since this minus 1 hour |
| `calendar_channel_id` / `_resource_id` / `_token_hash` / `_expires_at` / `_renewed_at` | The active push channel. The token is kept only as its sha256 |
| `calendar_lease_until` / `calendar_sync_again` | One calendar sync at a time per connection (research.md §14) |

Derived Calendar state (never stored), when `calendarConfig().mode !== "off"`:
- `syncing`: `state = 'working'` and the Calendar scope is granted;
- `missing`: `state = 'working'` and the scope is not granted (card message, "!");
- `needs_reconnect` and `disconnected`: no Calendar line; nothing syncs.

### Activity (`activities`, SF-109, extended)

`updated_at`: when the activity was last changed. It is used only to decide which side changed last (FR-011).
- set to `now()` by `editActivity`, `tickActivity`, `untickActivity` and by a change from Google;
- inserts get the default (SF-122's Pipedrive insert and `scheduleActivity` need no change).

No other change. Every change still bumps `version`.

### Calendar event link (`calendar_events`, new)

One row per activity that is or was synced (`activity_id` unique), in one connection's primary calendar.

| Column | Meaning |
|---|---|
| `activity_id` | The activity; null once it is deleted (then the row is cleaned up, or kept as `ended` for origin `google`) |
| `connection_id` | Whose calendar holds the event |
| `google_event_id` | The event's id: chosen by the CRM before the insert (`"crm"` + 32 base32hex) for origin `crm`; Google's for origin `google` |
| `origin` | `crm`: made by the CRM (US2). `google`: came in from Google (US4) |
| `state` | `creating`: id chosen, insert not confirmed. `synced`: in sync. `ended`: never synced again (FR-018) |
| `base` | The values last agreed, in CRM terms, the base of the three-way merge (research.md §9) |
| `synced_version` | The activity `version` last sent or received. The push sends again when it differs |
| `sent_hash` | sha256 of the last event body sent (research.md §4) |
| `google_updated_at` | Google's `updated` of the event last seen |
| `dirty` | The CRM won a field in a merge: send again even though the version matches |

### Person and person email (SF-90, unchanged)

`person_emails.email` (lower-case) is matched against event guest addresses, trimmed and lower-cased. The person must
be visible to the user (`visiblePerson`) and not archived.

## State changes

### Connection (Calendar part)

| From | Event | To |
|---|---|---|
| none / `disconnected` | connect with every asked scope | `working`. `calendar_connected_at = now`, token, channel and last sync null. Existing `synced` links of the connection get `dirty = true` |
| `working` without Calendar | reconnect with every scope | `working` with Calendar. Same reset as above. Outcome `reconnected` |
| `needs_reconnect` (Calendar had been granted) | reconnect | `working`. Calendar columns kept; the next sync carries on (410 → catch-up) |
| `working` | connect/reconnect missing any asked scope | unchanged; nothing stored (`missing_scopes`) |
| `working` with Calendar | Google answers `no_calendar_access` (§13) | the Calendar scope is removed from `scopes` → "Calendar access missing" |
| `working` | key refused | `needs_reconnect` (SF-118 `markNeedsReconnect`; also clears `calendar_lease_until`) |
| any | disconnect / deactivate | `disconnected`. Calendar token, channel, lease, `calendar_connected_at` cleared in the same transaction. After commit: `channels.stop`, then revoke (SF-118) |

After the connect commits: `events.watch` (best effort; a failure leaves `calendar_channel_renewed_at` null, so the
next check retries), then `runAfterResponse(syncCalendar)`.

### Link

| From | Event | To |
|---|---|---|
| none | push finds a planned, visible activity due today or later with no row | `creating` (origin `crm`) → insert → `synced` |
| none | pull finds an eligible new event (§10) | `synced` (origin `google`) with a new Meeting |
| `creating` | insert refused (`event_refused`) | row deleted |
| `synced` | activity version changed, or `dirty` | event patched; `synced_version`, `base`, `sent_hash` updated |
| `synced` / `creating` (crm) | activity deleted, reassigned or hidden from the user | event deleted in Google; row deleted (the new assignee gets their own row) |
| `synced` (google) | activity deleted, reassigned or hidden | `ended` (event untouched) |
| `synced` | event cancelled in Google, or patch answers 404/410 / `status: cancelled` | `ended`; activity unchanged |
| `synced` (google) | user declines it in Google | `ended`; activity unchanged |
| `ended` | anything | stays `ended`. Crm-origin rows whose activity is deleted are removed |

## Sync rules (summary; research.md has the reasons)

- **Which activities have an event**: assignee has a `working` connection with Calendar; the activity is visible to the
  assignee (`visibleActivity`); it has no row yet; and when first synced it is planned with `due_on >= ukToday(now)`.
  Once linked it stays synced (done, moved into the past) until deleted, reassigned, hidden or ended.
- **Event body**: research.md §4–§5. Title `"<Type> · <subject>"` (done: `"✓ "` first). Description = note, blank line,
  `templates.calendar_description` link. Reminders email + popup at 15 minutes with a time; none (`useDefault: false`,
  no overrides) for all-day or done. `visibility: private`; all-day `transparent`. `sendUpdates=none`; no attendees.
- **From Google**: date/time/duration (rounded down to 5 minutes, 5…1440) and subject only, through the three-way merge.
- **Coming in**: research.md §10.

## Fake data (`src/seed/calendar.ts`)

Fake mode and `CALENDAR_SYNC=on` only. Steps:
1. Ada Fake (`ada@barnacle.ai`) has a working connection with the Calendar scope (`seedGmail` now asks
   `askedScopes()`; a connection without it is reconnected through the fake consent);
2. `syncCalendar` puts her planned activities due today or later into her fake calendar;
3. her fake calendar gets one event, "Fake intro meeting", seven days ahead 15:00–15:45 UK time, with the first visible,
   non-archived fake person's first address as guest. Then `syncCalendar` brings it in as a Meeting.

Re-run: when an origin-`google` link exists for her connection, it returns "already there calendar events". Messages
follow the seeder registry style. Registered in `src/seed/index.ts` after `activities` and `gmail`.
