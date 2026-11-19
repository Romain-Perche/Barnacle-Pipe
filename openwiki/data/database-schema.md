---
type: data-model
title: Database schema and access
description: The Postgres tables (users, sessions, user_changes, schema_migrations), their constraints and row level security, and how the app connects with a lazily created postgres.js client.
tags: [database, postgres, schema, rls, supabase]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T18:56:29.439Z
sources:
  - id: openwiki-source-b1b8983f5dc78551445443a8
    resource: repo://migrations/0001_users_sessions.sql
  - id: openwiki-source-4be5a90a7046f767d13b7bce
    resource: repo://migrations/0002_people_organisations.sql
  - id: openwiki-source-c7141a489d89567be64a28f1
    resource: repo://scripts/migrate.ts
  - id: openwiki-source-06c17fd9fbcb90c595072826
    resource: repo://src/server/db.ts
  - id: openwiki-source-b32d9e2f594e42ac5679f049
    resource: repo://tests/integration/rls.test.ts
generated: { by: "claude-code", at: "2026-11-19T18:56:29.439Z" }
---

# Database schema and access

The schema is defined by numbered SQL files in `migrations/` (`0001_users_sessions.sql`,
`0002_people_organisations.sql` and `0004_pipelines_deals.sql`) plus the `schema_migrations` table created by the migrate command. How each
part reads and writes these tables is drawn in [`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md).

## Tables

### `users`

| Column | Notes |
|---|---|
| `id` | `bigint` identity primary key. |
| `email` | Unique, must equal `lower(email)` and end in `@barnacle.ai` (check constraints). |
| `name` | Display name; updated from Google at each sign-in. |
| `role` | `admin` or `user` (default `user`). |
| `status` | `active` or `deactivated` (default `active`). Users are deactivated, never deleted. |
| `added_by` | Admin who added the user, nullable. |
| `created_at`, `last_sign_in_at` | Timestamps; `last_sign_in_at` is null until the first sign-in. |

### `sessions`

`token_hash` (unique `bytea`, the SHA-256 of the cookie token), `user_id`, `created_at`,
`last_seen_at`, `expires_at`, `revoked_at`. Indexed on `user_id`. See
[Sessions and access control](../auth/sessions-and-access-control.md).

### `user_changes`

An append-only log of who changed which user: `user_id`, `actor_id` (null for the first admin and for
seeded users), `action` (`added`, `made_admin`, `admin_removed`, `deactivated`, `reactivated`),
`created_at`. Written by [user management](../features/user-management.md), first-admin sign-in and the
seeder.

### `schema_migrations`

`name` (the migration file name, primary key) and `applied_at`. Created on demand by
`scripts/migrate.ts`; see [Migrations and fake data](../operations/migrations-and-seeding.md).

### People and organisations tables (migration 0002)

Added by `0002_people_organisations.sql`; behaviour is described in
[People and organisations](../features/people-and-organisations.md).

- `organisations`: `name` (unique ignoring case), `website`, `sector`, `size` (one of five bands), `location`,
  `owner_id`, `created_by`, `archived_at`, and a `version` counter.
- `persons`: first and last name (at least one required), optional `organisation_id` (set null when the
  organisation is deleted), `role`, `lead_source_id`, `linkedin_url`, `owner_id`, `consent`
  (`subscribed`/`unsubscribed`), `private`, `created_by`, `last_contacted_at`, `archived_at`, `version`.
- `person_emails` (unique email, kind, position) and `person_phones`: child rows deleted with the person.
- `lead_sources` and `labels`: names unique ignoring case, soft-removed with `removed_at`. The migration
  inserts six starting lead sources. `person_labels` links people to labels.
- `timeline_events`: one row per event on exactly one person or organisation (`added`, `edited`, `archived`,
  `restored`, `person_linked`, `person_unlinked`), with `actor_id` and changed `fields`.

### Pipelines and deals tables (migration 0004)

Added by `0004_pipelines_deals.sql`; behaviour is described in
[Deals, pipelines and the board](../features/deals-and-pipelines.md).

- `pipelines` (`name` unique ignoring case, `position`) and `stages` (`pipeline_id`, `name` unique within the
  pipeline, `position`). Deleting a pipeline cascades to its stages.
- `deals`: `title`, `value_pence`, `stage_id` (no cascade, so the database refuses to delete a stage that still
  holds a deal), `stage_entered_at`, optional `organisation_id` and `person_id` (set null on delete), `owner_id`,
  `expected_close_on`, `private`, `created_by`, `archived_at` and a `version` counter.
- `deal_stage_periods`: one row per stay in a stage (stage and pipeline names kept as text), with `entered_at`,
  `left_at` and `moved_by`; a unique index allows one open period per deal.
- `timeline_events` gains `deal_id`, `from_stage`, `to_stage`, `cause` and a `moved` kind; each event now
  targets exactly one person, organisation or deal.

## Row level security

Every `create table` is followed by `alter table … enable row level security`, with no policies. On
Supabase this means the Data API roles (`anon`, `authenticated`) can neither read nor write app data,
while the app's own database user, which owns the tables, is not affected. `tests/integration/rls.test.ts`
fails if any table in the public schema lacks it (it also checks that the expected tables exist, including the pipelines and deals tables). Migration files may only contain statements allowed inside a transaction.

## Connecting

`src/server/db.ts` exports `sql`, a `Proxy` over a postgres.js client created on first use from
`DATABASE_URL` (it throws if unset). Creating it lazily means `next build` and preview deployments,
which have no `DATABASE_URL`, never connect. Options:

- `prepare: false` — required by Supabase's transaction-mode pooler (Supavisor);
- `max: 5` connections, `idle_timeout: 20` seconds; notices are ignored.

`closeDb()` ends the client; the command-line scripts call it before exiting. Code uses plain SQL in
tagged templates and `sql.begin(...)` for transactions; there is no ORM.
