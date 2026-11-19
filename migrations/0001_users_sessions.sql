-- Users, sessions and the user change log (data-model.md).
-- Rule for every migration file: only statements allowed inside a transaction, and
-- "enable row level security" (no policy) after every "create table" (FR-032).

create table users (
  id bigint generated always as identity primary key,
  email text not null unique check (email = lower(email)) check (email like '%@barnacle.ai'),
  name text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  added_by bigint null references users (id),
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz null
);

create table sessions (
  id bigint generated always as identity primary key,
  token_hash bytea not null unique,
  user_id bigint not null references users (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null
);
create index sessions_user_id_idx on sessions (user_id);

create table user_changes (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  actor_id bigint null references users (id),
  action text not null check (action in ('added', 'made_admin', 'admin_removed', 'deactivated', 'reactivated')),
  created_at timestamptz not null default now()
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table user_changes enable row level security;
