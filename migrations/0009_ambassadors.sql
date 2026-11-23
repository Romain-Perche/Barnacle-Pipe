-- SF-114: ambassadors and who referred each person or deal (specs/sf-114-step-9-ambassador-tracking/data-model.md).
alter table persons add column is_ambassador boolean not null default false;
alter table persons add column referred_by_id bigint null references persons (id) on delete set null;
alter table persons add column referred_at timestamptz null;
alter table persons add constraint persons_referrer_not_self check (referred_by_id <> id);
create index persons_referred_by_idx on persons (referred_by_id) where referred_by_id is not null;
create index persons_ambassador_idx on persons (id) where is_ambassador;

alter table deals add column referred_by_id bigint null references persons (id) on delete set null;
alter table deals add column referred_at timestamptz null;
create index deals_referred_by_idx on deals (referred_by_id) where referred_by_id is not null;

-- Referral events: the previous referrer of a change; gone with the person (SF-92 rule, research.md §5–6).
alter table timeline_events add column from_person_id bigint null references persons (id) on delete set null;
create index timeline_events_from_person_idx on timeline_events (from_person_id) where from_person_id is not null;
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared'));
alter table timeline_events add constraint timeline_events_from_person_check
  check (from_person_id is null or kind = 'referrer_changed');
alter table timeline_events drop constraint timeline_events_cause_check;
alter table timeline_events add constraint timeline_events_cause_check
  check (cause in ('stage_deleted', 'pipeline_deleted', 'person_deleted'));
