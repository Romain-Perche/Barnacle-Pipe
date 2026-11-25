-- SF-123: activity reminders in the app (specs/sf-123-step-17-activity-reminders-in-the-app/data-model.md).
-- One reminder per planned activity, for its assignee, kept on the activity row: `remind_at` (null: no reminder) and
-- `reminder_read_at` (null: unread). Set by schedule / edit / untick in src/server/activities/activities.ts.
-- Planned activities whose due moment is still ahead get theirs now; past ones get none.
alter table activities add column remind_at timestamptz null, add column reminder_read_at timestamptz null;

update activities
set remind_at = case
  when due_time is null then (due_on + time '09:00') at time zone 'Europe/London'
  else ((due_on + due_time) at time zone 'Europe/London') - interval '15 minutes'
end
where done_at is null
  and case
    when due_time is null then ((due_on + 1)::timestamp at time zone 'Europe/London') > now()
    else ((due_on + due_time) at time zone 'Europe/London') > now()
  end;

create index activities_reminder_idx on activities (assignee_id, remind_at desc) where done_at is null and remind_at is not null;
