-- SF-92: private people seen by their owner too, anonymous events about deleted people, hand-over of a
-- deactivated user's private people. Only statements allowed in a transaction; no new table.

-- Events about a deleted person stay on other records, without the person (FR-005).
alter table timeline_events drop constraint timeline_events_related_person_id_fkey;
alter table timeline_events add constraint timeline_events_related_person_id_fkey
  foreign key (related_person_id) references persons (id) on delete set null;

-- Hand-over event on a person (FR-011).
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over'));
alter table timeline_events add column related_user_id bigint null references users (id);
alter table timeline_events add constraint timeline_events_related_user_check
  check ((kind = 'handed_over') = (related_user_id is not null));

-- The owner branch of the visibility rule (FR-001).
create index persons_private_owner_idx on persons (owner_id) where private;
