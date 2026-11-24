-- SF-118: Gmail connect and sync (data-model.md § Migration). One connection per user (kept after disconnect and
-- deactivation, so its conversations stay), the refresh token sealed with GMAIL_TOKEN_KEY (null exactly when
-- disconnected), and the copied conversations, messages and attachment names and sizes (never their contents).
create table gmail_connections (
  id bigint generated always as identity primary key,
  user_id bigint not null unique references users (id),
  email text not null unique check (email = lower(btrim(email)) and email like '%@barnacle.ai'),
  state text not null check (state in ('working', 'needs_reconnect', 'disconnected')),
  token_cipher bytea null,
  scopes text not null default '',
  connected_at timestamptz not null,
  history_id numeric(20, 0) null check (history_id >= 0),
  last_synced_at timestamptz null,
  watch_renewed_at timestamptz null,
  watch_expires_at timestamptz null,
  sync_lease_until timestamptz null,
  sync_again boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((state = 'disconnected') = (token_cipher is null)),
  check (state <> 'disconnected' or (watch_renewed_at is null and watch_expires_at is null and sync_lease_until is null))
);
alter table gmail_connections enable row level security;

create table email_threads (
  id bigint generated always as identity primary key,
  connection_id bigint not null references gmail_connections (id) on delete cascade,
  gmail_thread_id text not null check (gmail_thread_id <> '' and char_length(gmail_thread_id) <= 64),
  subject text not null default '',
  created_at timestamptz not null default now(),
  unique (connection_id, gmail_thread_id)
);
alter table email_threads enable row level security;

create table email_messages (
  id bigint generated always as identity primary key,
  connection_id bigint not null references gmail_connections (id) on delete cascade,
  thread_id bigint not null references email_threads (id) on delete cascade,
  gmail_message_id text not null check (gmail_message_id <> '' and char_length(gmail_message_id) <= 64),
  rfc_message_id text null check (char_length(rfc_message_id) <= 998),
  direction text not null check (direction in ('sent', 'received')),
  from_address text null,
  from_name text null,
  to_list jsonb not null default '[]' check (jsonb_typeof(to_list) = 'array'),
  cc_list jsonb not null default '[]' check (jsonb_typeof(cc_list) = 'array'),
  bcc_list jsonb not null default '[]' check (jsonb_typeof(bcc_list) = 'array'),
  subject text not null default '',
  sent_at timestamptz null,
  received_at timestamptz not null,
  text_body text null,
  html_body text null,
  created_at timestamptz not null default now(),
  unique (connection_id, gmail_message_id)
);
alter table email_messages enable row level security;
create index email_messages_thread_idx on email_messages (thread_id, received_at);
create index email_messages_rfc_idx on email_messages (rfc_message_id) where rfc_message_id is not null;

create table email_attachments (
  id bigint generated always as identity primary key,
  message_id bigint not null references email_messages (id) on delete cascade,
  position int not null check (position >= 0),
  name text not null check (name <> '' and char_length(name) <= 255),
  content_type text not null default 'application/octet-stream' check (char_length(content_type) <= 255),
  size bigint not null check (size >= 0),
  unique (message_id, position)
);
alter table email_attachments enable row level security;
