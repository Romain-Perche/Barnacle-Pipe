-- SF-129: writing an email from a deal, person or organisation (data-model.md). The sent email itself is an SF-118
-- email_messages row processed by SF-127 like any copied email; these two tables only hold the sending.
-- email_sends: one row per press of [ SEND ] (the ledger), claimed before any Storage or Google call so a second press
-- of the same box sends nothing; deleted when the send fails before Gmail accepted it; `sent` once stored with its hand
-- link to the record written from.
create table email_sends (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  send_key uuid not null,
  connection_id bigint not null references gmail_connections (id) on delete cascade,
  deal_id bigint null references deals (id) on delete set null,
  person_id bigint null references persons (id) on delete set null,
  organisation_id bigint null references organisations (id) on delete set null,
  rfc_message_id text not null unique,
  gmail_message_id text null,
  gmail_thread_id text null,
  state text not null check (state in ('sending', 'sent')),
  message_id bigint null references email_messages (id) on delete set null,
  upload_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, send_key),
  check (num_nonnulls(deal_id, person_id, organisation_id) <= 1)
);
alter table email_sends enable row level security;
create index email_sends_pending_idx on email_sends (connection_id, gmail_message_id) where state = 'sending';

-- A file chosen from the computer for an email, waiting to be sent (never a record file, never in // FILES). Its path is
-- queued in file_cleanup for 24 hours at once, and made due as soon as the email is sent.
create table email_uploads (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  storage_path text not null unique,
  name text not null check (char_length(name) between 1 and 255),
  size bigint not null check (size between 1 and 26214400),
  content_type text not null check (char_length(content_type) <= 255),
  created_at timestamptz not null default now()
);
alter table email_uploads enable row level security;
create index email_uploads_created_idx on email_uploads (created_at);
