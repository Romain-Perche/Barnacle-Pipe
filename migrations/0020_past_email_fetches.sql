-- SF-128: one past-email fetch per Gmail connection (so per user): running, then ended (kept to show its end
-- message until the next press). Deleted by a disconnect or a deactivation (forgetGmailInTx); what it copied stays.
create table past_email_fetches (
  id bigint generated always as identity primary key,
  connection_id bigint not null unique references gmail_connections (id) on delete cascade,
  state text not null check (state in ('running', 'ended')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  slice_end timestamptz not null,
  page_token text null check (char_length(page_token) <= 1024),
  page_offset int not null default 0 check (page_offset >= 0),
  copied int not null default 0 check (copied >= 0),
  problem text null check (problem in ('unavailable')),
  wait_until timestamptz null,
  lease_until timestamptz null,
  started_at timestamptz not null,
  ended_at timestamptz null,
  updated_at timestamptz not null default now(),
  check (window_start < window_end),
  check ((state = 'ended') = (ended_at is not null)),
  check (state = 'running' or (lease_until is null and wait_until is null and problem is null))
);
alter table past_email_fetches enable row level security;
