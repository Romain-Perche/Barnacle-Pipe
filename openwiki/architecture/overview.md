---
type: architecture
title: Architecture overview
description: How the Barnacle CRM is put together — a Next.js 16 App Router app with its own Google sign-in and database sessions, plain-SQL Postgres access, hosted on Vercel with Supabase Postgres.
tags: [architecture, nextjs, postgres, vercel, supabase]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-b1b8983f5dc78551445443a8
    resource: repo://migrations/0001_users_sessions.sql
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-f34ac1e549d94dc3ac475ae4
    resource: repo://src/proxy.ts
  - id: openwiki-source-263124bfd29ff09eabb33461
    resource: repo://src/server/auth/session.ts
  - id: openwiki-source-06c17fd9fbcb90c595072826
    resource: repo://src/server/db.ts
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Architecture overview

The Barnacle CRM (repo `Barnacle-Pipe`, package `barnacle-crm`) is one Next.js App Router application
written in TypeScript. At this stage (SF-80, the "app skeleton") it provides sign-in for barnacle.ai
staff, database sessions, a signed-in shell with a sidebar, and an admin **Users** page. Later
features (pipelines, deals, contacts, Pipedrive import…) plug into the same skeleton; see
[Adding a feature](../workflows/adding-a-feature.md).

Library versions are listed in the software bill of materials, [`sbom/SBOM.md`](../../sbom/SBOM.md).
How data moves between the parts below is drawn in [`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md).

## Stack

- **Next.js App Router + React server components.** Pages are server components by default; client
  components only where the browser is needed. The request proxy is `src/proxy.ts` (Next.js 16's
  name for middleware).
- **Postgres through postgres.js**, plain SQL in tagged templates, no ORM (`src/server/db.ts`).
- **No auth library.** The app runs its own Google OAuth code flow and stores sessions in Postgres
  (`src/server/auth/`).
- **Plain CSS** in `src/app/globals.css`, Geist fonts from the `geist` package (`src/app/layout.tsx`).

## Code layout

| Path | Role |
|---|---|
| `src/proxy.ts` | Runs before every page: a cheap cookie gate that sends cookie-less visitors to `/sign-in`, and passes the requested path on as the `x-pathname` header. |
| `src/app/(app)/` | Every signed-in page, sharing the sidebar layout (`layout.tsx`) and the nav registry (`nav.ts`). |
| `src/app/sign-in`, `src/app/auth/*` | Public sign-in page and route handlers: `/auth/google/start`, `/auth/google/callback`, `/auth/end`. |
| `src/app/dev/fake-google` | Fake Google account chooser, only in development and test. |
| `src/server/` | Domain code with no UI: sign-in rules, sessions, users, settings, messages. Tested without the browser. |
| `src/seed/` | Fake data seeders (registry in `index.ts`). |
| `migrations/` | Numbered SQL files applied by `scripts/migrate.ts`. |
| `scripts/` | Command-line tools: migrate, seed, test schema download, isolated app start for e2e tests. |

## Request path

1. The browser asks for a page. `src/proxy.ts` checks only that the `crm_session` cookie exists on a
   non-public path; otherwise it redirects to `/sign-in?next=…`. On GET page loads it re-sets the
   cookie to keep it alive.
2. The `(app)` layout and the page call `requireUser()` (or `requireAdmin()`), which looks the token's
   SHA-256 up in the `sessions` table joined with `users`, reading role and status fresh on every
   request. The lookup is memoised per request with React `cache`.
3. Server actions call `requireUser()` or `assertAdminForAction()` first, then call domain functions
   in `src/server/` that run SQL in transactions.

Details: [Sessions and access control](../auth/sessions-and-access-control.md),
[Google sign-in flow](../auth/google-sign-in.md), [User management](../features/user-management.md).

## Data

Postgres holds `users`, `sessions` and `user_changes` (plus `schema_migrations`). Every table has row
level security enabled with no policies, so Supabase's Data API cannot read app data while the app's
owning database user is unaffected. See [Database schema and access](../data/database-schema.md).

The database client is created lazily on first use, so `next build` and preview deployments never
connect; it uses `prepare: false` (required by Supabase's transaction-mode pooler) and at most 5
connections.

## Deployment shape

- **Vercel** hosts the app; no Docker image and no long-running server of its own.
- **Supabase Postgres** in production, reached through Supabase's connection pooler. Local runs and
  tests use a local Postgres; no Vercel, Supabase or Google account is needed to develop.
- **Production builds** (`npm run vercel-build` with `VERCEL_ENV=production`) run migrations before
  `next build`; migrations never run at app start.
- **Preview deployments** only build: no database, and the sign-in page says sign-in is off.

See [Configuration and environments](../operations/configuration-and-environments.md) and
[Migrations and fake data](../operations/migrations-and-seeding.md).

## Outside services

Only Google is reached at runtime: the OAuth authorization page, the token endpoint and the userinfo
endpoint (`src/server/auth/google.ts`). In development and tests the in-app
[fake Google login](../auth/fake-google-login.md) replaces it.
