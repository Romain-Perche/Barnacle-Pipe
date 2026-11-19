-- Pipelines, stages, deals and their stage history (specs/sf-93-step-3-pipelines-deals-and-the-board/data-model.md).
-- Rule for every migration file: only statements allowed inside a transaction, and
-- "enable row level security" (no policy) after every "create table".
-- Numbered 0004 so it runs after SF-92's 0003_private_owner_handover.sql; the kind check below keeps its 'handed_over'.

create table pipelines (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100),
  position int not null,
  created_at timestamptz not null default now()
);
alter table pipelines enable row level security;
create unique index pipelines_name_key on pipelines (lower(name));

create table stages (
  id bigint generated always as identity primary key,
  -- A pipeline is only deleted once it holds no deal, so the cascade only removes empty stages.
  pipeline_id bigint not null references pipelines (id) on delete cascade,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100),
  position int not null
);
alter table stages enable row level security;
create unique index stages_name_key on stages (pipeline_id, lower(name));
create index stages_pipeline_position_idx on stages (pipeline_id, position);

create table deals (
  id bigint generated always as identity primary key,
  title text not null check (title = btrim(title) and title <> '' and char_length(title) <= 200),
  value_pence bigint null check (value_pence between 0 and 999999999999),
  -- No cascade: the database refuses to delete a stage that still holds a deal (SC-007).
  stage_id bigint not null references stages (id),
  stage_entered_at timestamptz not null default now(),
  organisation_id bigint null references organisations (id) on delete set null,
  person_id bigint null references persons (id) on delete set null,
  owner_id bigint not null references users (id),
  expected_close_on date null,
  private boolean not null default false,
  created_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz null,
  version int not null default 1
);
alter table deals enable row level security;
create index deals_board_idx on deals (stage_id, stage_entered_at desc) where archived_at is null;
create index deals_stage_id_idx on deals (stage_id);
create index deals_organisation_id_idx on deals (organisation_id);
create index deals_person_id_idx on deals (person_id);
create index deals_owner_id_idx on deals (owner_id);
create index deals_private_created_by_idx on deals (created_by) where private;

create table deal_stage_periods (
  id bigint generated always as identity primary key,
  deal_id bigint not null references deals (id) on delete cascade,
  stage_id bigint null references stages (id) on delete set null,
  stage_name text not null,
  pipeline_name text not null,
  entered_at timestamptz not null default now(),
  left_at timestamptz null,
  moved_by bigint null references users (id)
);
alter table deal_stage_periods enable row level security;
create unique index deal_stage_periods_open_key on deal_stage_periods (deal_id) where left_at is null;
create index deal_stage_periods_deal_idx on deal_stage_periods (deal_id, entered_at);

alter table timeline_events add column deal_id bigint null references deals (id) on delete cascade;
alter table timeline_events add column from_stage text null;
alter table timeline_events add column to_stage text null;
alter table timeline_events add column cause text null check (cause in ('stage_deleted', 'pipeline_deleted'));
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved'));
alter table timeline_events drop constraint timeline_events_check;
alter table timeline_events add constraint timeline_events_target_check
  check (num_nonnulls(person_id, organisation_id, deal_id) = 1);
create index timeline_events_deal_idx on timeline_events (deal_id, created_at desc);
