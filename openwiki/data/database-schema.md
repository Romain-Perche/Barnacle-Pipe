---
type: data-model
title: Database schema and access
description: The Postgres tables (users, sessions, user_changes, schema_migrations), their constraints and row level security, and how the app connects with a lazily created postgres.js client.
tags: [database, postgres, schema, rls, supabase]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-b1b8983f5dc78551445443a8
    resource: repo://migrations/0001_users_sessions.sql
  - id: openwiki-source-c7141a489d89567be64a28f1
    resource: repo://scripts/migrate.ts
  - id: openwiki-source-06c17fd9fbcb90c595072826
    resource: repo://src/server/db.ts
  - id: openwiki-source-b32d9e2f594e42ac5679f049
    resource: repo://tests/integration/rls.test.ts
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Database schema and access

The schema is defined by numbered SQL files in `migrations/` (today only
`0001_users_sessions.sql`) plus the `schema_migrations` table created by the migrate command. How each
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

## Row level security

Every `create table` is followed by `alter table … enable row level security`, with no policies. On
Supabase this means the Data API roles (`anon`, `authenticated`) can neither read nor write app data,
while the app's own database user, which owns the tables, is not affected. `tests/integration/rls.test.ts`
fails if a table lacks it. Migration files may only contain statements allowed inside a transaction.

## Connecting

`src/server/db.ts` exports `sql`, a `Proxy` over a postgres.js client created on first use from
`DATABASE_URL` (it throws if unset). Creating it lazily means `next build` and preview deployments,
which have no `DATABASE_URL`, never connect. Options:

- `prepare: false` — required by Supabase's transaction-mode pooler (Supavisor);
- `max: 5` connections, `idle_timeout: 20` seconds; notices are ignored.

`closeDb()` ends the client; the command-line scripts call it before exiting. Code uses plain SQL in
tagged templates and `sql.begin(...)` for transactions; there is no ORM.
