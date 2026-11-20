-- SF-95: deal status (won / lost), deal labels, other linked people, followers, and the history kinds for them.
-- data-model.md § Migration. Only statements allowed in a transaction; RLS on (no policies) after every create table.

-- Deal status (research.md §2)
alter table deals add column status text not null default 'open' check (status in ('open', 'won', 'lost'));
alter table deals add column closed_at timestamptz null;
alter table deals add column lost_reason text null
  check (lost_reason = btrim(lost_reason) and lost_reason <> '' and char_length(lost_reason) <= 500);
alter table deals add constraint deals_closed_check
  check ((status = 'open') = (closed_at is null) and (status = 'lost') = (lost_reason is not null));

-- The board only reads open, non-archived deals (FR-006)
drop index deals_board_idx;
create index deals_board_idx on deals (stage_id, stage_entered_at desc) where archived_at is null and status = 'open';
create index deals_created_at_idx on deals (created_at desc, id desc);

-- Deal labels (research.md §6), separate from people labels
create table deal_labels (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100),
  removed_at timestamptz null
);
alter table deal_labels enable row level security;
create unique index deal_labels_name_key on deal_labels (lower(name));

create table deal_label_links (
  deal_id bigint not null references deals (id) on delete cascade,
  label_id bigint not null references deal_labels (id),
  primary key (deal_id, label_id)
);
alter table deal_label_links enable row level security;
create index deal_label_links_label_idx on deal_label_links (label_id);

-- Other linked people (research.md §7)
create table deal_people (
  deal_id bigint not null references deals (id) on delete cascade,
  person_id bigint not null references persons (id) on delete cascade,
  linked_by bigint null references users (id),
  created_at timestamptz not null default now(),
  primary key (deal_id, person_id)
);
alter table deal_people enable row level security;
create index deal_people_person_idx on deal_people (person_id);

-- Followers (research.md §7)
create table deal_followers (
  deal_id bigint not null references deals (id) on delete cascade,
  user_id bigint not null references users (id),
  created_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);
alter table deal_followers enable row level security;
create index deal_followers_user_idx on deal_followers (user_id);

-- History: won, lost (with the reason as said then), reopened
alter table timeline_events add column reason text null check (char_length(reason) <= 500);
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened'));
alter table timeline_events add constraint timeline_events_lost_reason_check check ((kind = 'lost') = (reason is not null));
