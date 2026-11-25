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
  -- A deleted activity leaves its link with activity_id null (on delete set null), whatever its origin: the next sync
  -- removes a CRM event's link and ends a Google meeting's (data-model.md's "activity_id is not null or state = 'ended'
  -- or origin = 'crm'" check would refuse the delete itself, so it is not here).
  unique (connection_id, google_event_id),
  check (state <> 'creating' or origin = 'crm')
);
alter table calendar_events enable row level security;
create index calendar_events_connection_idx on calendar_events (connection_id, state);
create index calendar_events_orphan_idx on calendar_events (connection_id) where activity_id is null;
