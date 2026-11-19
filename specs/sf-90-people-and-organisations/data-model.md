# Data model: People and organisations

One migration, `migrations/0002_people_organisations.sql` (transaction-safe statements only;
`alter table … enable row level security` after each `create table`, no policies). Existing `users` table
unchanged. All ids `bigint generated always as identity`.

## Tables

### organisations

| Column | Type | Rules |
|---|---|---|
| id | bigint pk | |
| name | text not null | `check (name = btrim(name) and name <> '')`, ≤ 200 chars; unique index on `lower(name)` (archived included, FR-007) |
| website | text null | normalised `http(s)://…` (research.md §13) |
| sector | text null | free text, ≤ 100 |
| size | text null | `check (size in ('1–10','11–50','51–200','201–1,000','1,000+'))` |
| location | text null | free text, ≤ 100 |
| owner_id | bigint not null → users | active user when chosen; kept if later deactivated |
| created_by | bigint not null → users | |
| created_at | timestamptz not null default now() | "Date added" |
| archived_at | timestamptz null | null = not archived |
| version | int not null default 1 | optimistic lock (research.md §9) |

Indexes: `lower(name)` unique; `owner_id`.

### persons

| Column | Type | Rules |
|---|---|---|
| id | bigint pk | |
| first_name, last_name | text not null default '' | trimmed, ≤ 100 each; `check (first_name <> '' or last_name <> '')` |
| organisation_id | bigint null → organisations `on delete set null` | |
| role | text null | ≤ 200 |
| lead_source_id | bigint null → lead_sources | removed sources stay linked |
| linkedin_url | text null | normalised, host linkedin.com |
| owner_id | bigint not null → users | |
| consent | text not null default 'subscribed' | `check (consent in ('subscribed','unsubscribed'))` |
| private | boolean not null default false | changeable only by `created_by` |
| created_by | bigint not null → users | the creator; the only viewer when private |
| created_at | timestamptz not null default now() | "Date added", never editable |
| last_contacted_at | timestamptz null | not editable here; "Never" until later features |
| archived_at | timestamptz null | |
| version | int not null default 1 | |

Indexes: `organisation_id`, `owner_id`, `lead_source_id`, `created_by` (partial `where private`).

### person_emails

| Column | Type | Rules |
|---|---|---|
| id | bigint pk | |
| person_id | bigint not null → persons `on delete cascade` | |
| email | text not null **unique** | `check (email = lower(btrim(email)))`; duplicate detection across all people (FR-004) |
| kind | text not null default 'work' | `in ('work','personal','other')` |
| position | int not null | 0 = main; `unique (person_id, position)` |

### person_phones

Same shape as `person_emails` with `phone text not null` (trimmed, as typed; not unique).

### lead_sources / labels

| Column | Type | Rules |
|---|---|---|
| id | bigint pk | |
| name | text not null | trimmed, non-empty, ≤ 100; unique index on `lower(name)` over all rows |
| removed_at | timestamptz null | null = offered |

The migration inserts lead sources: Duncan's LinkedIn, Referral, Exec dinner, Inbound, Event, Ambassador
(FR-021). Labels start empty.

### person_labels

`(person_id → persons on delete cascade, label_id → labels)`, primary key `(person_id, label_id)`,
index on `label_id`.

### timeline_events

| Column | Type | Rules |
|---|---|---|
| id | bigint pk | |
| person_id | bigint null → persons `on delete cascade` | |
| organisation_id | bigint null → organisations `on delete cascade` | |
| | | `check (num_nonnulls(person_id, organisation_id) = 1)` |
| kind | text not null | `in ('added','edited','archived','restored','person_linked','person_unlinked')`; later features extend the check |
| actor_id | bigint null → users | null for fake data |
| fields | text[] null | `edited` only: human field names, form order |
| related_person_id | bigint null → persons `on delete cascade` | `person_linked`/`person_unlinked` on an organisation |
| created_at | timestamptz not null default now() | |

Index: `(person_id, created_at desc)`, `(organisation_id, created_at desc)`, `related_person_id`.

All 8 tables: `enable row level security`, no policies.

## Visibility (FR-015, FR-019, FR-028)

A person is **visible** to viewer V when `not private or created_by = V`. Every read of persons and every
write path applies it (research.md §2). Consequences:

- Lists, search, counts, filter "values in use", the drawer, the record page: invisible = absent / "Page not found.".
- Organisation page and the "number of people" column: visible, non-archived people only.
- Organisation timeline: `person_linked`/`person_unlinked` events whose `related_person_id` is not visible are hidden.
- Duplicate email: conflict with a visible person → `duplicate_email` (name + link); with an invisible one → `duplicate_email_hidden`.
- Edit/archive/restore/delete of an invisible person → "Page not found." and nothing changes.
- The `private` checkbox is shown and accepted only when the user is `created_by` (on create: always the user).

Lists hide archived records unless `archived=1`; the record pages of archived records still open.

## Validation (pure, `src/server/records/rules.ts`)

| Field | Rule | Error code |
|---|---|---|
| first/last name | trimmed; at least one non-empty | `name_required` |
| each email | trimmed + lowercased, regex, ≤ 254; empty rows dropped | `email_invalid` |
| emails on one person | no repeat after normalising | `email_twice` |
| each phone | trimmed, `^[0-9 +().-]+$` with a digit, ≤ 40; empty rows dropped | `phone_invalid` |
| LinkedIn | research.md §13, host linkedin.com | `linkedin_invalid` |
| website | research.md §13 | `website_invalid` |
| organisation name | trimmed, non-empty, ≤ 200 | `organisation_name_required` |
| size | one of the five bands or empty | (ignored if unknown) |
| owner | an active user, or the record's current owner unchanged | (ignored → keeps current / defaults to user) |
| lead source / labels | ids of non-removed entries, or ones the person already has | (unknown ids ignored) |
| consent | `subscribed`/`unsubscribed` | default subscribed |
| list name (admin) | trimmed, non-empty, ≤ 100 | `choice_name_required` |

Database checks (unique email, unique org name, unique list name) are the final guard; their violations map
to `duplicate_email`/`duplicate_email_hidden`, `organisation_exists`, `choice_exists`.

## State changes and timeline events

| Change | Who | Effect | Event(s) |
|---|---|---|---|
| create person | any user | row + emails/phones/labels; owner default = user; consent default subscribed | person `added`; if organisation set: organisation `person_linked` |
| create person with new organisation | any user | organisation created (owner = user) in the same transaction | organisation `added`, then as above |
| edit person | any user who can see it | version-guarded update; replaces emails/phones/labels | person `edited` with `fields` (only if something changed); organisation change → old org `person_unlinked`, new org `person_linked` |
| archive / restore | any user who can see it | `archived_at` set / cleared (no event if already in that state) | `archived` / `restored` |
| delete person | admin who can see it | row + cascade (emails, phones, labels, its events, org events about it) | none (record gone) |
| create / edit organisation | any user | as person (no private flag) | `added` / `edited` |
| delete organisation | admin | row + its events; people keep existing with `organisation_id = null` | none |
| add / rename / remove lead source or label | admin | insert (or bring back a removed one) / update name / set `removed_at` | none |

Field names used in `edited` events (person, form order): First name, Last name, Email addresses, Phone
numbers, Organisation, Role, Lead source, LinkedIn, Owner, Labels, Consent, Private. Organisation: Name,
Website, Sector, Size, Location, Owner. The order or kind of emails/phones counts as a change of "Email
addresses"/"Phone numbers".

## Fake data (`src/seed/people.ts`, FR-027, SC-007)

Runs after the users seeder; idempotent (organisations `on conflict (lower(name)) do nothing`, people
skipped when their first email exists, labels by name). Content: ≥ 8 organisations (e.g. "Fakeco Ltd",
"Example Gyms Fake", …) covering every size band, ≥ 3 sectors, ≥ 2 owners, 1 archived; labels "Hot",
"Investor", "Partner" (fake data only; a fresh CRM has none); ≥ 30 people with `@example.com` /
`@example.net` addresses and clearly fake names, covering every lead source, every label, both consent
statuses, every active fake user as owner, people without organisation, ≥ 1 archived, ≥ 1 private (created
by Ada Fake), some with several emails/phones, and varied `created_at` and `last_contacted_at` (set
directly by the seeder) so every sort and filter returns rows. Each seeded record gets an `added` event with
`actor_id = null`.
