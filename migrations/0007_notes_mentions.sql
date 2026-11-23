-- SF-102: notes on the timeline, @mentions and their notifications (data-model.md).

-- A note is a timeline entry of kind 'note' (research.md §2).
alter table timeline_events add column body text null check (char_length(body) <= 100000);
alter table timeline_events add column edited_by bigint null references users (id);
alter table timeline_events add column edited_at timestamptz null;
alter table timeline_events add column version int not null default 1;
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported'));
alter table timeline_events add constraint timeline_events_note_check
  check ((kind = 'note') = (body is not null) and (kind = 'note' or (edited_by is null and edited_at is null)));
alter table timeline_events add constraint timeline_events_note_author_check
  check (kind <> 'note' or actor_id is not null);

-- Mentions; a mention of someone other than who saved it is a notification (research.md §4).
create table note_mentions (
  event_id bigint not null references timeline_events (id) on delete cascade,
  user_id bigint not null references users (id),
  mentioned_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  primary key (event_id, user_id)
);
alter table note_mentions enable row level security;
create index note_mentions_user_idx on note_mentions (user_id, created_at desc, event_id desc);
create index note_mentions_unread_idx on note_mentions (user_id) where read_at is null;
