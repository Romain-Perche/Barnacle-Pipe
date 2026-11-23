---
type: operations
title: Migrations and fake data
description: How npm run db:migrate applies migrations/*.sql safely through Supabase's pooler, when it runs (never at app start), and how npm run db:seed loads idempotent fake data through the seeder registry.
tags: [migrations, seed, database, operations, fake-data]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-23T18:05:22.701Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-c7141a489d89567be64a28f1
    resource: repo://scripts/migrate.ts
  - id: openwiki-source-919c449abaee368e1ca5c9bf
    resource: repo://scripts/seed.ts
  - id: openwiki-source-1554a73332a66ceee3c8a725
    resource: repo://src/seed/ambassadors.ts
  - id: openwiki-source-1c34aa4b66ba96eefc78bf08
    resource: repo://src/seed/index.ts
  - id: openwiki-source-010903950424d10f20cb451d
    resource: repo://src/seed/users.ts
generated: { by: "claude-code", at: "2026-11-23T18:05:22.701Z" }
---

# Migrations and fake data

## `npm run db:migrate`

`scripts/migrate.ts` (run with `tsx`, reading `.env.local` when it exists) applies every
`migrations/*.sql` file in name order:

- Each file runs in **its own transaction**, which first takes `pg_advisory_xact_lock` on a fixed key.
  Postgres releases the lock at commit or rollback, so no lock outlives the command — safe through
  Supabase's transaction-mode pooler. A session-level `pg_advisory_lock` is deliberately never used.
- Inside the transaction it creates `schema_migrations` if needed (with row level security), skips the
  file if its name is recorded, otherwise runs the file and records it.
- It prints each file applied, or `Database is up to date.`; it is safe to run twice, or twice at once.
- A failure prints the error and exits 1.

Because each file runs inside a transaction, migration files may only contain statements allowed in a
transaction, and every `create table` must be followed by `alter table … enable row level security`
(see [Database schema and access](../data/database-schema.md)).

**When it runs.** Never at app start and never from `next build`. Locally you run it by hand. On Vercel,
`npm run vercel-build` runs it only when `VERCEL_ENV=production`, before `next build`, so a failed
migration fails the deploy. Previews never migrate. The integration and e2e test setups migrate the test
database themselves.

## `npm run db:seed`

`scripts/seed.ts` loads fake data. It checks `isFakeAllowed()` **before** connecting to the database
and otherwise prints "Fake data can only be loaded when APP_ENV is development or test." and exits 1
(see [Configuration and environments](./configuration-and-environments.md)).

It then runs `runSeeders()` from `src/seed/index.ts`, the **seeder registry**: an ordered list of
`{ name, run(sql) }` entries, each returning lines to print. Today it holds six seeders. The first,
`src/seed/users.ts`, inserts five clearly fake `@barnacle.ai` users — Ada Fake and Grace Fake
(admins), Linus Fake and Margaret Fake (users), Alan Fake (deactivated) — each with a `user_changes`
`added` row, in its own transaction and with `on conflict (email) do nothing`. Seeders must be
re-runnable; the output says `created …` or `already there …` per user.
The second, `src/seed/people.ts`, runs after it: it needs the fake users as owners and, once they exist, adds fake
organisations, people, labels and timeline rows for the
[People and organisations](../features/people-and-organisations.md) pages. Migration
`0002_people_organisations.sql` creates their tables.
The third, `src/seed/deals.ts`, adds five fake pipelines with their stages and a set of clearly fake
deals owned by the fake users (some private), for the
[Deals board](../features/pipelines-and-deals.md). It is re-runnable: pipelines are matched by name and deals
skipped when one with the same title exists. Migration `0004_pipelines_deals.sql` creates their tables.
The fourth, `src/seed/notes.ts`, adds clearly fake notes on deals, people and an organisation, two
with @mentions (one read, one unread notification), re-runnably (a note is found by its record and exact body).
Migration `0007_notes_mentions.sql` creates the mention table.
The fifth, `src/seed/activities.ts`, adds clearly fake [activities](../features/activities.md) with
dates relative to the UK day of the run (one overdue, two due today, later ones, three done), including one on a
private deal and one on a private person and two assignment notifications (one unread, one read). It is
re-runnable: an activity is found by its exact subject. Migration `0008_activities.sql` creates the table.
The sixth, `src/seed/ambassadors.ts`, runs last: it adds clearly fake ambassadors (one shared, one private, one former) with
the people and deals they referred and two notes on referred records. It is re-runnable: people are found by email,
deals by title. Migration `0009_ambassadors.sql` creates the columns.

Later features append their seeder to the registry; see [Adding a feature](../workflows/adding-a-feature.md).
Fake data never uses the real team's names.
