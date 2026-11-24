# Data model: Unsubscribe page (SF-121)

## Changed table: `persons`

| Column | Type | Rule |
|---|---|---|
| `unsubscribe_token` (new) | `text not null` | default `replace(gen_random_uuid()::text \|\| gen_random_uuid()::text, '-', '')`; unique; `check (unsubscribe_token ~ '^[0-9a-f]{64}$')` |
| `consent` (existing) | `text not null` | `'subscribed' \| 'unsubscribed'`; the link only ever sets `'unsubscribed'` |
| `version` (existing) | `int` | **not** changed by an unsubscribe (research.md §4) |

- Each existing row gets its own token when the column is added: a volatile default is evaluated per row.
- The token never changes, so the link works for as long as the person exists (FR-003). It is gone when the person
  is deleted (`on delete` removes the row).
- No other table is added. Campaign-level data (which campaign the click came from) belongs to the campaign issues.

## Changed table: `timeline_events`

New kinds (all on `person_id`):

| Kind | actor_id | old_value / new_value | Line (messages.ts `templates`) |
|---|---|---|---|
| `unsubscribed_link` | null | null | `unsubscribed_link_event`: "Unsubscribed from campaigns through the unsubscribe link" |
| `unsubscribed_mail_app` | null | null | `unsubscribed_mail_app_event`: "Unsubscribed from campaigns through their mail app" |
| `consent_changed` | teammate | consent labels of the time ("Subscribed" / "Unsubscribed") | `consent_changed_event(old, new)`: "Consent: Unsubscribed → Subscribed", then " by <name>" |

Tag: CHANGE for all three (`entryTag` default; no change to `timeline-view.ts`).

## Migration `migrations/0012_unsubscribe.sql`

Take the next free number on `main` at build time (research.md §5). Use only statements that are allowed in a
transaction, and create no table, so no RLS line is needed.

```sql
-- SF-121: per-person unsubscribe token; three timeline kinds.
alter table persons add column unsubscribe_token text not null
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  check (unsubscribe_token ~ '^[0-9a-f]{64}$');
alter table persons add constraint persons_unsubscribe_token_key unique (unsubscribe_token);

-- Kind list: every kind on main at build time + SF-117's two (planned in parallel) + this step's three.
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared',
                  'custom_set', 'custom_changed', 'custom_cleared',
                  'file_added', 'file_deleted',
                  'pipedrive_imported', 'pipedrive_unsubscribed',
                  'unsubscribed_link', 'unsubscribed_mail_app', 'consent_changed'));

-- consent_changed keeps the old and new labels in old_value / new_value (no field_name).
alter table timeline_events drop constraint timeline_events_custom_check;
alter table timeline_events add constraint timeline_events_custom_check
  check ((kind in ('custom_set', 'custom_changed', 'custom_cleared')) = (field_name is not null)
         and (kind in ('custom_set', 'custom_changed', 'custom_cleared', 'consent_changed')
              or (old_value is null and new_value is null))
         and (kind <> 'consent_changed' or (old_value is not null and new_value is not null and actor_id is not null))
         and (kind not in ('unsubscribed_link', 'unsubscribed_mail_app') or (actor_id is null and person_id is not null)));
```

## State transitions (person consent)

```
subscribed ──[page button | one-click]──▶ unsubscribed      (+1 unsubscribed_link | unsubscribed_mail_app)
unsubscribed ──[page button | one-click]──▶ unsubscribed    (no change, no line, same success)
unsubscribed ──[teammate edit form]──▶ subscribed           (+1 consent_changed, actor = teammate)
subscribed ──[teammate edit form]──▶ unsubscribed           (+1 consent_changed, actor = teammate)
```

Nothing public ever moves a person to `subscribed` (FR-011, US4-1).

## Server types (`src/server/records/unsubscribe.ts`, `src/server/records/unsubscribe-rules.ts`)

```ts
type UnsubscribeVia = "link" | "mail_app";
type UnsubscribeResult = "done" | "not_found";            // a database error is thrown, not returned
type PageState = "ready" | "done" | "not_found" | "error"; // what /unsubscribe/<token> shows
type UnsubscribeLinks = { pageUrl: string; listUnsubscribe: string; listUnsubscribePost: "List-Unsubscribe=One-Click" };
```
