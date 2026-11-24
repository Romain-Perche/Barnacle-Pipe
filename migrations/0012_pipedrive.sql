-- SF-117: Pipedrive connections (one encrypted token per user), imports (one run per user, moved on part by part by
-- the open import page) and links (company + kind + Pipedrive id: a Pipedrive record never leads to two CRM records);
-- two timeline kinds. Statements allowed in a transaction only; RLS on every new table, with no policy.
create table pipedrive_connections (
  user_id bigint primary key references users (id),
  -- sealed: version ‖ iv ‖ tag ‖ ciphertext (src/server/pipedrive/crypto.ts); never the token in plain text
  token bytea not null check (octet_length(token) between 30 and 1024),
  pipedrive_user_id bigint not null,
  pipedrive_user_name text not null check (char_length(pipedrive_user_name) <= 255),
  company_id bigint not null,
  company_name text not null check (char_length(company_name) <= 255),
  saved_at timestamptz not null default now()
);
alter table pipedrive_connections enable row level security;

create table pipedrive_imports (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  company_id bigint not null,
  company_name text not null,
  want_people boolean not null,
  want_organisations boolean not null,
  consent text null check (consent in ('subscribed', 'unsubscribed')),
  state text not null default 'running' check (state in ('running', 'waiting', 'paused', 'stopped', 'finished')),
  pause_reason text null check (pause_reason in ('unreachable', 'token_refused', 'other_company')),
  stop_reason text null check (stop_reason in ('by_user')),
  wait_until timestamptz null,
  step text not null default 'prepare'
    check (step in ('prepare', 'count_organisations', 'count_people', 'organisations', 'people', 'done')),
  -- Pipedrive next_cursor of the current step (null: first page)
  cursor text null,
  organisations_total int null,
  people_total int null,
  organisations_done int not null default 0,
  people_done int not null default 0,
  -- users and field definitions read in 'prepare'
  snapshot jsonb null,
  options jsonb not null default '{}',
  counts jsonb not null default '{}',
  report jsonb not null default '{}',
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  check (want_people or want_organisations),
  check (not want_people or consent is not null),
  check ((state = 'paused') = (pause_reason is not null)),
  check ((state = 'waiting') = (wait_until is not null)),
  check ((state in ('stopped', 'finished')) = (finished_at is not null)),
  check ((state = 'stopped') = (stop_reason is not null))
);
alter table pipedrive_imports enable row level security;
create unique index pipedrive_imports_one_open on pipedrive_imports (user_id) where state in ('running', 'waiting', 'paused');
create index pipedrive_imports_user_idx on pipedrive_imports (user_id);

-- A link whose CRM record was deleted keeps its row (both ids null): the Pipedrive record counts as already imported
-- and never comes back (spec Clarifications: a deletion may be an erasure request).
create table pipedrive_links (
  company_id bigint not null,
  kind text not null check (kind in ('person', 'organisation')),
  pipedrive_id bigint not null,
  person_id bigint null references persons (id) on delete set null,
  organisation_id bigint null references organisations (id) on delete set null,
  how text not null check (how in ('imported', 'linked')),
  import_id bigint null references pipedrive_imports (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, kind, pipedrive_id),
  check (kind = 'person' or person_id is null),
  check (kind = 'organisation' or organisation_id is null)
);
alter table pipedrive_links enable row level security;
create index pipedrive_links_person_idx on pipedrive_links (person_id) where person_id is not null;
create index pipedrive_links_organisation_idx on pipedrive_links (organisation_id) where organisation_id is not null;

-- Each migration's kind list keeps every kind present (SF-115 rule, docs/DECISIONS.md): 0011's kinds plus SF-117's.
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared',
                  'custom_set', 'custom_changed', 'custom_cleared',
                  'file_added', 'file_deleted',
                  'pipedrive_imported', 'pipedrive_unsubscribed'));
