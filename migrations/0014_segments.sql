-- SF-120: saved segments, shared by the whole team (specs/sf-120-step-15-campaigns-segments/data-model.md).
-- A segment stores the choice of recipients, never people (FR-007). pipeline_id, stage_id and the ids inside
-- conditions have no foreign key on purpose: a deleted pipeline, stage, organisation or custom field stays in the
-- segment, shown as "(deleted)" and matching nobody (FR-013, research.md §2).
create table segments (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100),
  who text not null check (who in ('everyone', 'pipeline', 'stage')),
  pipeline_id bigint null,
  stage_id bigint null,
  deal_status text null check (deal_status in ('open', 'won', 'lost', 'all')),
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 20),
  created_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  updated_by bigint not null references users (id),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  check ((who = 'everyone') = (pipeline_id is null and deal_status is null)),
  check ((who = 'stage') = (stage_id is not null))
);
alter table segments enable row level security;
create unique index segments_name_key on segments (lower(name));

-- Pipeline / stage segments of won, lost or all deals (the board index only covers open deals), research.md §9.
create index deals_stage_live_idx on deals (stage_id) where archived_at is null;
