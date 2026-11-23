-- SF-103: CSV imports of people and organisations, and the "imported" timeline event.
-- Only statements allowed in a transaction; RLS on the new table, no policy.
create table csv_imports (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  kind text not null check (kind in ('people', 'organisations')),
  file_name text not null check (char_length(file_name) between 1 and 255),
  size_bytes int not null check (size_bytes between 1 and 5242880),
  parts_received int not null default 0,
  content bytea null check (octet_length(content) <= 5242880),
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'done')),
  row_count int null,
  mapping jsonb null,
  report jsonb null,
  created_at timestamptz not null default now(),
  imported_at timestamptz null,
  check ((status = 'done') = (report is not null and imported_at is not null)),
  check (status <> 'done' or content is null)
);
alter table csv_imports enable row level security;
create index csv_imports_user_idx on csv_imports (user_id);
create index csv_imports_created_at_idx on csv_imports (created_at);

-- 'note' is SF-102's kind (built at the same time): both migrations keep both kinds, in either order.
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'imported', 'note'));
