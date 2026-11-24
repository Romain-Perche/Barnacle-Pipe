# Data model: Pipedrive import — connection, people and organisations (SF-117 part a)

## Migration `migrations/0012_pipedrive.sql`

The migration uses only statements allowed in a transaction, and enables RLS after every `create table`, with no
policy.

```sql
-- SF-117: Pipedrive connections, imports and links; two timeline kinds.
create table pipedrive_connections (
  user_id bigint primary key references users (id),
  token bytea not null check (octet_length(token) between 30 and 1024),   -- sealed: version ‖ iv ‖ tag ‖ ciphertext
  pipedrive_user_id bigint not null,
  pipedrive_user_name text not null check (char_length(pipedrive_user_name) <= 255),
  company_id bigint not null,
  company_name text not null check (char_length(company_name) <= 255),
  saved_at timestamptz not null default now()
);
alter table pipedrive_connections enable row level security;

create table pipedrive_imports (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  company_id bigint not null,
  company_name text not null,
  want_people boolean not null,
  want_organisations boolean not null,
  consent text null check (consent in ('subscribed', 'unsubscribed')),
  state text not null default 'running' check (state in ('running', 'waiting', 'paused', 'stopped', 'finished')),
  pause_reason text null check (pause_reason in ('unreachable', 'token_refused', 'other_company')),
  stop_reason text null check (stop_reason in ('by_user')),
  wait_until timestamptz null,
  step text not null default 'prepare'
    check (step in ('prepare', 'count_organisations', 'count_people', 'organisations', 'people', 'done')),
  cursor text null,                       -- Pipedrive next_cursor of the current step (null: first page)
  organisations_total int null, people_total int null,
  organisations_done int not null default 0, people_done int not null default 0,
  snapshot jsonb null,                    -- users and field definitions read in 'prepare'
  options jsonb not null default '{}',    -- e.g. {"noMarketingStatus": true}
  counts jsonb not null default '{}',     -- data-model § Counts
  report jsonb not null default '{}',     -- data-model § Report
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  check (want_people or want_organisations),
  check (not want_people or consent is not null),
  check ((state = 'paused') = (pause_reason is not null)),
  check ((state = 'waiting') = (wait_until is not null)),
  check ((state in ('stopped', 'finished')) = (finished_at is not null)),
  check ((state = 'stopped') = (stop_reason is not null))
);
alter table pipedrive_imports enable row level security;
create unique index pipedrive_imports_one_open on pipedrive_imports (user_id) where state in ('running', 'waiting', 'paused');
create index pipedrive_imports_user_idx on pipedrive_imports (user_id);

create table pipedrive_links (
  company_id bigint not null,
  kind text not null check (kind in ('person', 'organisation')),
  pipedrive_id bigint not null,
  person_id bigint null references persons (id) on delete set null,
  organisation_id bigint null references organisations (id) on delete set null,
  how text not null check (how in ('imported', 'linked')),
  import_id bigint null references pipedrive_imports (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, kind, pipedrive_id),
  check (kind = 'person' or person_id is null),
  check (kind = 'organisation' or organisation_id is null)
);
alter table pipedrive_links enable row level security;
create index pipedrive_links_person_idx on pipedrive_links (person_id) where person_id is not null;
create index pipedrive_links_organisation_idx on pipedrive_links (organisation_id) where organisation_id is not null;

alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared',
                  'custom_set', 'custom_changed', 'custom_cleared',
                  'file_added', 'file_deleted',
                  'pipedrive_imported', 'pipedrive_unsubscribed'));
```

If another migration numbered `0012` merges first, Build renumbers this one. The kind list must keep every kind
present at that time.

Links with a deleted CRM record keep their row (both ids null), so the Pipedrive record is counted as "already
imported" and never comes back (spec Clarifications).

Add `pipedrive_links, pipedrive_imports, pipedrive_connections` to `tests/support/reset.ts` (and to
`.factory/run/reset-db.sh` if it lists tables), and add the three tables to `migrate.test.ts` and `rls.test.ts`.

## Entities

### Pipedrive connection (`pipedrive_connections`)
There is one row per user, or none. `token` is never selected outside `src/server/pipedrive/connection.ts`, which
opens it only to make a call. The view returned to pages is `{ userName, companyName, companyId, savedAt }`.

### Pipedrive import (`pipedrive_imports`)
States:

```
start ──► running ──(429)──► waiting ──(wait over, next part)──► running
            │  ▲                                       
            │  └──────────── [ CONTINUE ] ◄──── paused (unreachable | token_refused | other_company)
            │                                     ▲
            ├──(failure)──────────────────────────┘
            ├──(step 'done')──► finished
            └──[ STOP IMPORT ] (also from waiting/paused)──► stopped (by_user)
```

"Paused" is also derived for display: a `running`/`waiting` row with `seen_at < now() - interval '30 seconds'` shows
as paused, and the page does not move it on until `[ CONTINUE ]`.

Steps: `prepare → count_organisations → count_people → organisations → people → done`, skipping the steps of an
unticked kind. `cursor` is reset to null at each step change.

`snapshot` (written in `prepare`):
```json
{ "users": { "<pdUserId>": { "name": "Jane Fake", "email": "jane@fake.example" } },
  "personFields": [{ "code": "…40 hex…", "name": "Budget", "type": "double", "custom": true, "options": [{ "id": 1, "label": "…" }] }],
  "organizationFields": [ … ] }
```

### Counts (`counts`)
```json
{ "organisations": { "imported": 0, "linked": 0, "already": 0, "notImported": 0 },
  "people":        { "imported": 0, "linked": 0, "already": 0, "notImported": 0 } }
```
The three page counts are: Imported = the sum of `imported`; Linked to CRM records = the sum of `linked`;
Not imported = the sum of `notImported`. "Already imported" is shown in the report (US3-8).

### Report (`report`)
```json
{ "notImported": [{ "kind": "person", "pipedriveId": 12, "label": "Cleo Fake", "code": "pipedrive_no_name", "args": {} }],
  "linked":      [{ "kind": "person", "personId": 5, "pipedriveId": 9 }, { "kind": "organisation", "organisationId": 3, "pipedriveId": 4 }],
  "owners":      { "<pdUserId>": { "name": "Jane Fake", "email": "jane@fake.example", "records": 12 } },
  "lists":       [{ "list": "lead_source" | "label", "value": "Webinar", "records": 4 }],
  "fields":      [{ "kind": "person", "name": "Favourite colour", "code": "pipedrive_field_no_match", "args": {} }],
  "choices":     [{ "kind": "person", "field": "Colour", "value": "Teal", "records": 3 }],
  "warnings":    [{ "kind": "person", "pipedriveId": 12, "label": "Ada Fake", "code": "pipedrive_email_invalid", "value": "ada@" }],
  "unsubscribed":[{ "personId": 5 }],
  "privateOthers": 3,
  "ownerOnlyOrganisations": 2 }
```
All Pipedrive text is stored as data and shown quoted, as text. `personId` entries are named only when
`visiblePerson()` allows it, else the anonymous template. `fields` gets one entry per Pipedrive field, `owners` one per
Pipedrive owner, and `lists`/`choices` one per value, with a counter. The last report is kept until the user starts
another import (FR-025).

### Pipedrive link (`pipedrive_links`)
There is one row per (company, kind, Pipedrive id), which is the "never twice" guarantee (FR-017). `how = 'imported'`
means this import made the CRM record. `how = 'linked'` means it matched an existing one (email or name). Part b will
use these links to attach deals, notes, activities and files.

### Person, organisation, timeline (existing tables)
- An imported person: `persons` columns as the CSV import fills them, plus `private`, `created_by` (FR-013) and
  `created_at = add_time`. Emails, phones, labels and `custom_values` are bulk inserted as in `importPeople`.
- An imported organisation: `organisations` (name, website, sector, size, location, owner_id, created_by = the
  importing user).
- Timeline: `pipedrive_imported` on each imported person and organisation (actor = the importing user);
  `person_linked` on the organisation of each imported person; `pipedrive_unsubscribed` on an existing person made
  Unsubscribed. Timeline rendering (`Timeline.tsx` / `RecordTimeline.tsx`, `timeline-view.ts` CHANGE tag) gains the
  two lines. Ambassador "latest updates" treat them like `imported`.

## Validation summary

| Value | Rule | When refused |
|---|---|---|
| Token | trimmed, 1–200 chars, accepted by `/v1/users/me` | message, nothing saved |
| Person name | form rules (≤ 100 each, not both empty) | not imported |
| Organisation name | form rules (≤ 200, trimmed, not empty) | not imported (its people come without organisation, with a warning) |
| Email / phone / LinkedIn / website / role / location / sector | form rules | left out, warning |
| Size | `parseSize` | left out, warning |
| Lead source / label | still offered on the list | left out, counted per value |
| Custom value | `readValue` for the CRM field's type, GBP only for money | left out, warning |
| Option | current choice of the CRM field | left out, counted per value |
| Consent | Pipedrive `subscribed`/`unsubscribed`, else the user's choice | — |
