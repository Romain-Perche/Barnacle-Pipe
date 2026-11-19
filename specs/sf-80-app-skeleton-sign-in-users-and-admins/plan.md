# Implementation Plan: App skeleton — sign-in, users and admins

**Branch**: `factory/sf-80-app-skeleton-sign-in-users-and-admins` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-80-app-skeleton-sign-in-users-and-admins/spec.md`

## Summary

Create the CRM app from an empty repo: a Next.js (App Router, TypeScript) app with its own Google sign-in
(OAuth 2.0 authorization code flow with PKCE, then Google's userinfo endpoint), database-backed sessions
in Postgres, a shared signed-in layout (design B sidebar), a Users admin page (design A table) with the
"always one active admin" rule, a fake Google login and a fake-data command that only work when
`APP_ENV` is exactly `development` or `test`, an explicit migration command, unit/integration tests
(Vitest, real local Postgres) and browser tests (Playwright). Later features plug in through two
registries: the sidebar navigation list and the fake-data seeder list.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (Vercel's current runtime; local works on ≥ 22.12)

**Primary Dependencies**: Next.js 16.4 (App Router, server components, server actions, `proxy.ts`), React 19.3, `postgres` (postgres.js) 4.1 for SQL, `geist` fonts. No auth library, no ORM, no CSS framework (see research.md).

**Storage**: PostgreSQL — local Postgres for development and tests, Supabase Postgres through its connection pooler in production. Schema managed by plain SQL migration files and an explicit `npm run db:migrate` command.

**Testing**: Vitest 5 (unit tests for the pure rules, integration tests against a real local Postgres test database), Playwright 1.65 (browser tests through the fake Google login).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: Not a driver: ≤ 10 users. Each signed-in request does one session lookup (one indexed query).

**Constraints**: No Docker image or long-running server for the app; no migrations at app start or on previews; preview deployments never touch a database; all secrets from environment settings; whole app buildable and testable without Google, Vercel or Supabase accounts.

**Scale/Scope**: ~3–10 users; 5 screens (sign-in, fake Google login, home, Users, not-found/forbidden).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: it has no ratified principles, so no
constitution gate can fail. The binding constraints are the team choices in `docs/DECISIONS.md`; the plan
is checked against them instead:

| Decision (DECISIONS.md) | Plan | Status |
|---|---|---|
| TypeScript + Postgres; Vercel + Supabase; local Postgres for dev/tests | Next.js/TS, postgres.js, local Postgres in README/tests | ✅ |
| Next.js App Router, server components by default, client only where needed | Only the sidebar link (active highlight) is a client component | ✅ |
| No Docker image, no long-running server; Supabase through its pooler | Serverless functions; `prepare: false` for the transaction pooler | ✅ |
| Migrations: explicit command, run in production build, never at start, never on previews | `db:migrate` script; `vercel-build` runs it only when `VERCEL_ENV=production` | ✅ |
| Previews only build: no database, nobody signs in | `VERCEL_ENV=preview` short-circuits before any DB access | ✅ |
| Own Google sign-in and database sessions, not Supabase Auth | Hand-written OAuth code flow + `sessions` table | ✅ |
| Only admin-added barnacle.ai accounts + first admin from settings | `decideSignIn` rule + `FIRST_ADMIN_EMAIL` | ✅ |
| Fake login & fake data only when `APP_ENV` is exactly development/test | Single `isFakeAllowed()` check used by page, action and command | ✅ |
| Secrets out of the repo; every outside service via settings with a fake | `.env.example` only; fake Google login | ✅ |
| Playwright browser tests with a command | `npm run test:e2e` | ✅ |
| Design B sidebar | Shared `(app)` layout | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-80-app-skeleton-sign-in-users-and-admins/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: tables, rules, state transitions
├── quickstart.md        # Phase 1: how to validate end-to-end
├── contracts/
│   ├── routes.md        # Pages, route handlers, server actions, messages
│   └── settings-and-commands.md  # Environment settings and npm commands
├── dependencies.json    # Direct dependencies this change adds
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
package.json             # scripts: dev, build, vercel-build, start, db:migrate, db:seed, test, test:e2e, typecheck
tsconfig.json            # "@/*" -> "src/*"
next.config.ts
vitest.config.ts
playwright.config.ts
.env.example             # every setting, no secret values
README.md                # setup, migrate, seed, run, test, settings list

migrations/
└── 0001_users_sessions.sql   # users, sessions, user_changes

scripts/
├── migrate.ts           # applies migrations/*.sql in order, records them in schema_migrations
└── seed.ts              # fake data command: APP_ENV gate, then runs every seeder

src/
├── proxy.ts             # Next 16 proxy: no session cookie on a protected path -> /sign-in?next=...;
│                        #   refreshes cookie max-age; passes the path on as x-pathname
├── app/
│   ├── layout.tsx       # root: Geist fonts, globals.css
│   ├── globals.css      # design tokens from docs/DESIGN.md
│   ├── not-found.tsx    # "Page not found." outside the app shell (e.g. fake login when refused)
│   ├── sign-in/page.tsx # Google button, notices/errors, fake login link in dev/test
│   ├── auth/
│   │   ├── google/start/route.ts     # builds Google URL, state+PKCE cookie
│   │   ├── google/callback/route.ts  # code -> token -> userinfo -> completeSignIn
│   │   └── end/route.ts              # clears an invalid/ended session cookie, -> /sign-in?error=...
│   ├── dev/fake-google/
│   │   ├── page.tsx     # fake Google account chooser (notFound() unless dev/test)
│   │   └── actions.ts   # fakeSignIn, cancel -> same completeSignIn
│   └── (app)/           # every signed-in page lives here
│       ├── layout.tsx   # design B sidebar shell
│       ├── nav.ts       # REGISTRY: mainNav[] and adminNav[] entries (later features add lines)
│       ├── SidebarLink.tsx  # 'use client' (usePathname for highlight)
│       ├── page.tsx     # Home: "Hello, <first name>"
│       ├── not-found.tsx    # "Page not found." + link Home, inside the shell
│       ├── [...missing]/page.tsx  # notFound() so unknown signed-in URLs get the shell
│       ├── Forbidden.tsx    # "You don't have access to this page."
│       └── admin/users/
│           ├── page.tsx     # design A table
│           └── actions.ts   # addUser, makeAdmin, removeAdmin, deactivate, reactivate
├── server/
│   ├── env.ts           # reads/validates settings; isFakeAllowed(); isPreview()
│   ├── db.ts            # postgres.js client (singleton, prepare:false)
│   ├── auth/
│   │   ├── rules.ts     # PURE: decideSignIn(), normalizeEmail(), isSafeNext(), firstName()
│   │   ├── sign-in.ts   # completeSignIn(): applies rules, upserts user, creates session
│   │   ├── session.ts   # create/lookup/end sessions; requireUser(), requireAdmin()
│   │   └── google.ts    # authorization URL, token exchange, userinfo fetch
│   ├── users.ts         # user management with last-admin rule, audit records
│   └── messages.ts      # code -> exact user-facing text (single source)
└── seed/
    ├── index.ts         # REGISTRY: ordered seeders (later features append)
    └── users.ts         # fake users, idempotent

tests/
├── unit/                # rules.ts, env gate, email normalisation, safe next
├── integration/         # sign-in, sessions, users.ts against the test database
└── e2e/                 # Playwright: sign-in, sign-out, Users page, gating, layout
```

**Structure Decision**: a single Next.js project at the repository root (no frontend/backend split: the
server components and server actions are the backend). Domain rules live in `src/server/` so they are
tested without the UI; pages stay thin. The two registries (`src/app/(app)/nav.ts`, `src/seed/index.ts`)
and the helpers `requireUser()` / `requireAdmin()` are the "slot-in" points for later features (US4).

## Outside services

- Google Sign-In (OAuth 2.0 authorization + token endpoints, userinfo v2): schema https://github.com/googleapis/google-api-go-client/blob/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supabase and github.com/supabase/supavisor; the app speaks the standard Postgres protocol, and tests use a real local Postgres rather than a fake)

Note for Build: the schema above covers the userinfo response (`email`, `verified_email`, `hd`, `name`,
`given_name`). Google's authorization and token endpoints are standard OAuth 2.0 (RFC 6749 + PKCE,
RFC 7636) and are not in that file; see research.md §2.

## Complexity Tracking

No constitution violations to justify.
