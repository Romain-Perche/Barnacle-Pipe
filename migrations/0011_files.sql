-- SF-116: files on deals, people and organisations; contents in Supabase Storage (specs/sf-116-step-8-files/data-model.md).
create table files (
  id bigint generated always as identity primary key,
  deal_id bigint null references deals (id) on delete cascade,
  person_id bigint null references persons (id) on delete cascade,
  organisation_id bigint null references organisations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  size bigint not null check (size between 1 and 26214400),
  kind text not null check (kind in ('jpeg', 'png', 'gif', 'webp', 'pdf', 'other')),
  storage_path text not null unique,
  added_by bigint not null references users (id),
  added_at timestamptz not null default now(),
  constraint files_one_record check (num_nonnulls(deal_id, person_id, organisation_id) = 1)
);
alter table files enable row level security;
create index files_deal_idx on files (deal_id, added_at desc, id desc) where deal_id is not null;
create index files_person_idx on files (person_id, added_at desc, id desc) where person_id is not null;
create index files_organisation_idx on files (organisation_id, added_at desc, id desc) where organisation_id is not null;

-- An upload asked for but not yet read back from Storage: never listed (FR-002).
create table file_uploads (
  id bigint generated always as identity primary key,
  deal_id bigint null references deals (id) on delete cascade,
  person_id bigint null references persons (id) on delete cascade,
  organisation_id bigint null references organisations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  size bigint not null check (size between 1 and 26214400),
  content_type text not null,
  storage_path text not null unique,
  user_id bigint not null references users (id),
  created_at timestamptz not null default now(),
  constraint file_uploads_one_record check (num_nonnulls(deal_id, person_id, organisation_id) = 1)
);
alter table file_uploads enable row level security;
create index file_uploads_created_idx on file_uploads (created_at);

-- Contents to remove from Storage (research.md §8).
create table file_cleanup (
  storage_path text primary key,
  due_at timestamptz not null default now(),
  attempts int not null default 0
);
alter table file_cleanup enable row level security;
create index file_cleanup_due_idx on file_cleanup (due_at);

-- FILE entries on the timeline: the name and size are kept so the entry still reads after the file is deleted.
alter table timeline_events add column file_id bigint null references files (id) on delete set null;
alter table timeline_events add column file_name text null check (char_length(file_name) between 1 and 255);
alter table timeline_events add column file_size bigint null;
-- The id of the file a file_deleted entry is about (no FK: the row is gone); lets an old address answer "doesn't exist any more".
alter table timeline_events add column deleted_file_id bigint null;
create index timeline_events_file_idx on timeline_events (file_id) where file_id is not null;
create index timeline_events_deleted_file_idx on timeline_events (deleted_file_id) where deleted_file_id is not null;
-- 'custom_set', 'custom_changed' and 'custom_cleared' belong to SF-115 (Custom fields, 0010_custom_fields.sql), which
-- rewrites this same constraint and lists 'file_added' and 'file_deleted' in turn. Both lists hold every kind of both
-- steps so that neither migration drops the other's kinds, whichever one merges or runs first.
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared',
                  'custom_set', 'custom_changed', 'custom_cleared',
                  'file_added', 'file_deleted'));
alter table timeline_events add constraint timeline_events_file_check
  check ((kind in ('file_added', 'file_deleted')) = (file_name is not null)
         and (file_size is null or kind = 'file_added')
         and (file_id is null or kind = 'file_added')
         and ((kind = 'file_deleted') = (deleted_file_id is not null))
         and (kind not in ('file_added', 'file_deleted') or actor_id is not null));
