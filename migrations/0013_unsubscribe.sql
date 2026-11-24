-- SF-121: a random unsubscribe token per person (the only authority of the public unsubscribe page and one-click
-- address); three timeline kinds. Statements allowed in a transaction only; no new table.
alter table persons add column unsubscribe_token text not null
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  check (unsubscribe_token ~ '^[0-9a-f]{64}$');
alter table persons add constraint persons_unsubscribe_token_key unique (unsubscribe_token);

-- Each migration's kind list keeps every kind present (SF-115 rule, docs/DECISIONS.md): 0012's kinds plus SF-121's.
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared',
                  'custom_set', 'custom_changed', 'custom_cleared',
                  'file_added', 'file_deleted',
                  'pipedrive_imported', 'pipedrive_unsubscribed',
                  'unsubscribed_link', 'unsubscribed_mail_app', 'consent_changed'));

-- consent_changed keeps the old and new consent labels in old_value / new_value (no field_name) and has a teammate;
-- the two unsubscribe kinds are on a person and have no actor.
alter table timeline_events drop constraint timeline_events_custom_check;
alter table timeline_events add constraint timeline_events_custom_check
  check ((kind in ('custom_set', 'custom_changed', 'custom_cleared')) = (field_name is not null)
         and (kind in ('custom_set', 'custom_changed', 'custom_cleared', 'consent_changed')
              or (old_value is null and new_value is null))
         and (kind <> 'consent_changed' or (old_value is not null and new_value is not null and actor_id is not null))
         and (kind not in ('unsubscribed_link', 'unsubscribed_mail_app') or (actor_id is null and person_id is not null)));
