-- SF-109: calls, meetings and tasks (specs/sf-109-step-6-activities/data-model.md).
-- Done activities are read into the timeline, never copied: this migration changes no other table.
create table activities (
  id bigint generated always as identity primary key,
  type text not null check (type in ('call', 'meeting', 'task')),
  subject text not null check (subject = btrim(subject) and subject <> '' and char_length(subject) <= 200),
  due_on date not null,
  due_time time null,
  duration_minutes int null check (duration_minutes between 5 and 1440 and duration_minutes % 5 = 0),
  note text null check (char_length(note) <= 10000),
  deal_id bigint null references deals (id) on delete set null,
  person_id bigint null references persons (id) on delete set null,
  organisation_id bigint null references organisations (id) on delete set null,
  assignee_id bigint not null references users (id),
  done_at timestamptz null,
  done_by bigint null references users (id),
  created_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  version int not null default 1,
  -- The assignment notification (research.md §7): live while assignee_id <> assigned_by.
  assigned_by bigint not null references users (id),
  assigned_at timestamptz not null default now(),
  assignment_read_at timestamptz null,
  check (duration_minutes is null or due_time is not null),
  check ((done_at is null) = (done_by is null)),
  check (note is null or note <> '')
);
alter table activities enable row level security;
create index activities_deal_id_idx on activities (deal_id);
create index activities_person_id_idx on activities (person_id);
create index activities_organisation_id_idx on activities (organisation_id);
create index activities_assignee_due_idx on activities (assignee_id, due_on, due_time) where done_at is null;
create index activities_assignee_done_idx on activities (assignee_id, done_at desc) where done_at is not null;
create index activities_deal_next_idx on activities (deal_id, due_on, due_time) where done_at is null;
create index activities_assigned_idx on activities (assignee_id, assigned_at desc) where assignee_id <> assigned_by;
create index activities_assigned_unread_idx on activities (assignee_id)
  where assignee_id <> assigned_by and assignment_read_at is null;
