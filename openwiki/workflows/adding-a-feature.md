---
type: workflow
title: Adding a feature
description: The four places a new CRM feature plugs into the skeleton — a page under (app), a sidebar link, a seeder, a migration — and the rules each one must follow.
tags: [extension, workflow, conventions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-b1b8983f5dc78551445443a8
    resource: repo://migrations/0001_users_sessions.sql
  - id: openwiki-source-ba467561895df40c1767967f
    resource: repo://src/app/(app)/nav.ts
  - id: openwiki-source-1c34aa4b66ba96eefc78bf08
    resource: repo://src/seed/index.ts
  - id: openwiki-source-b32d9e2f594e42ac5679f049
    resource: repo://tests/integration/rls.test.ts
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Adding a feature

The skeleton is built so that later features (pipelines, deals, contacts, imports) plug in at four seams.

## 1. A page

Add it under `src/app/(app)/…`; it inherits the sidebar layout
([Signed-in layout, pages and messages](../features/signed-in-layout-and-pages.md)).

- Call `requireUser()` — or `requireAdmin()` for admin pages, showing `<Forbidden />` when `isAdmin` is
  false — at the top of the page. Hidden links are never enough.
- Every server action calls `requireUser()` or `assertAdminForAction()` first. Re-check rights inside
  the domain transaction when they matter, as `src/server/users.ts` does.
- Prefer server components; use a client component only where the browser is needed.
- Put domain logic in `src/server/` so it can be tested without the UI.
- User-facing text goes in `src/server/messages.ts`; pages take only a code from the URL. Redirect
  targets go through `isSafeNext(next, appBaseUrl())`.

See [Sessions and access control](../auth/sessions-and-access-control.md).

## 2. A sidebar link

Add `{ href, label }` to `mainNav` (everyone) or `adminNav` (the `// ADMIN` group, admins only) in
`src/app/(app)/nav.ts`.

## 3. Fake data

Add `{ name, run }` to the `seeders` list in `src/seed/index.ts`. A seeder receives the `sql` client,
returns lines to print, must be safe to run twice, and uses clearly fake names, never the real team.
See [Migrations and fake data](../operations/migrations-and-seeding.md).

## 4. Database tables

Add the next numbered file to `migrations/` (e.g. `0002_….sql`):

- only statements allowed inside a transaction (each file runs in one);
- `alter table … enable row level security` after every `create table`, with no policies —
  `tests/integration/rls.test.ts` fails otherwise;
- never run migrations at app start.

See [Database schema and access](../data/database-schema.md).

## Outside services and settings

A new outside service is reached through settings and gets a fake for tests (`tests/fakes/`), checked
against a published schema where one exists. Every new setting is listed in `.env.example` and the
README; secrets never enter the repo. See [Configuration and environments](../operations/configuration-and-environments.md)
and [Testing](../testing/testing.md).
