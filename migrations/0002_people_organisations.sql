-- People and organisations (specs/sf-90-people-and-organisations/data-model.md).
-- Rule for every migration file: only statements allowed inside a transaction, and
-- "enable row level security" (no policy) after every "create table".

create table organisations (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 200),
  website text null check (char_length(website) <= 2000),
  sector text null check (char_length(sector) <= 100),
  size text null check (size in ('1–10', '11–50', '51–200', '201–1,000', '1,000+')),
  location text null check (char_length(location) <= 100),
  owner_id bigint not null references users (id),
  created_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz null,
  version int not null default 1
);
alter table organisations enable row level security;
create unique index organisations_name_key on organisations (lower(name));
create index organisations_owner_id_idx on organisations (owner_id);

create table lead_sources (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100),
  removed_at timestamptz null
);
alter table lead_sources enable row level security;
create unique index lead_sources_name_key on lead_sources (lower(name));

create table labels (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100),
  removed_at timestamptz null
);
alter table labels enable row level security;
create unique index labels_name_key on labels (lower(name));

create table persons (
  id bigint generated always as identity primary key,
  first_name text not null default '' check (first_name = btrim(first_name) and char_length(first_name) <= 100),
  last_name text not null default '' check (last_name = btrim(last_name) and char_length(last_name) <= 100),
  organisation_id bigint null references organisations (id) on delete set null,
  role text null check (char_length(role) <= 200),
  lead_source_id bigint null references lead_sources (id),
  linkedin_url text null check (char_length(linkedin_url) <= 2000),
  owner_id bigint not null references users (id),
  consent text not null default 'subscribed' check (consent in ('subscribed', 'unsubscribed')),
  private boolean not null default false,
  created_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  last_contacted_at timestamptz null,
  archived_at timestamptz null,
  version int not null default 1,
  check (first_name <> '' or last_name <> '')
);
alter table persons enable row level security;
create index persons_organisation_id_idx on persons (organisation_id);
create index persons_owner_id_idx on persons (owner_id);
create index persons_lead_source_id_idx on persons (lead_source_id);
create index persons_private_created_by_idx on persons (created_by) where private;

create table person_emails (
  id bigint generated always as identity primary key,
  person_id bigint not null references persons (id) on delete cascade,
  email text not null unique check (email = lower(btrim(email)) and email <> '' and char_length(email) <= 254),
  kind text not null default 'work' check (kind in ('work', 'personal', 'other')),
  position int not null,
  unique (person_id, position)
);
alter table person_emails enable row level security;

create table person_phones (
  id bigint generated always as identity primary key,
  person_id bigint not null references persons (id) on delete cascade,
  phone text not null check (phone = btrim(phone) and phone <> '' and char_length(phone) <= 40),
  kind text not null default 'work' check (kind in ('work', 'personal', 'other')),
  position int not null,
  unique (person_id, position)
);
alter table person_phones enable row level security;

create table person_labels (
  person_id bigint not null references persons (id) on delete cascade,
  label_id bigint not null references labels (id),
  primary key (person_id, label_id)
);
alter table person_labels enable row level security;
create index person_labels_label_id_idx on person_labels (label_id);

create table timeline_events (
  id bigint generated always as identity primary key,
  person_id bigint null references persons (id) on delete cascade,
  organisation_id bigint null references organisations (id) on delete cascade,
  kind text not null check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked')),
  actor_id bigint null references users (id),
  fields text[] null,
  related_person_id bigint null references persons (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id) = 1)
);
alter table timeline_events enable row level security;
create index timeline_events_person_idx on timeline_events (person_id, created_at desc);
create index timeline_events_organisation_idx on timeline_events (organisation_id, created_at desc);
create index timeline_events_related_person_idx on timeline_events (related_person_id);

insert into lead_sources (name) values
  ('Duncan''s LinkedIn'), ('Referral'), ('Exec dinner'), ('Inbound'), ('Event'), ('Ambassador');
