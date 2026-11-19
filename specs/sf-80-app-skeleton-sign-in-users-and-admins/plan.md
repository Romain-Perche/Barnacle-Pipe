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

**Storage**: PostgreSQL — local Postgres for development and tests, Supabase Postgres through its connection pooler in production. Schema managed by plain SQL migration files and an explicit `npm run db:migrate` command; each migration runs in its own transaction under `pg_advisory_xact_lock` (never a session-level lock, which the transaction pooler can leave held). Row Level Security is enabled, with no policies, on every table so Supabase's Data API cannot read or write them.

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
| Migrations: explicit command, run in production build, never at start, never on previews | `db:migrate` script; `vercel-build` runs it only when `VERCEL_ENV=production`; transaction-level lock per migration, safe through the pooler | ✅ |
| Supabase's Data API must not reach app data (review 2026-11-19) | Row Level Security enabled, no policies, on every table; test checks all tables | ✅ |
| Previews only build: no database, nobody signs in | `VERCEL_ENV=preview` short-circuits before any DB access | ✅ |
| Own Google sign-in and database sessions, not Supabase Auth | Hand-written OAuth code flow + `sessions` table | ✅ |
| Only admin-added barnacle.ai accounts + first admin from settings | `decideSignIn` rule + `FIRST_ADMIN_EMAIL` | ✅ |
| Fake login & fake data only when `APP_ENV` is exactly development/test | Single `isFakeAllowed()` check used by page, action and command; also false when `VERCEL_ENV` is `production` or `preview` | ✅ |
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
└── 0001_users_sessions.sql   # users, sessions, user_changes; RLS enabled on each, no policies

scripts/
├── migrate.ts           # per file: one transaction, pg_advisory_xact_lock, skip if applied, apply, record
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
│   ├── env.ts           # reads/validates settings; isFakeAllowed() (APP_ENV dev/test AND VERCEL_ENV not production/preview); isPreview()
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
├── integration/         # sign-in, sessions, users.ts, migrations (twice in a row / at once), RLS on every table
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

## Fix round 1

**Problem** (AI review, US4 scenario 3 and FR-031): a developer who follows the README on a fresh
checkout gets failing tests.
1. `npm test`: 2 files fail with ENOENT on `.factory/schemas/oauth2-api.json`. The file is git-ignored
   (factory rule: schemas are never committed) and the README does not say how to get it.
2. `npm run test:e2e`: 1 test fails, `gated: APP_ENV unset`. The README tells the developer to
   `cp .env.example .env.local` (APP_ENV=development). `next start` reads `.env.local`, so the server that
   must run with APP_ENV unset runs with APP_ENV=development and shows the fake login link.
3. `docs/DECISIONS.md` misses three choices this issue made (code review).
4. Minor (feature test): the Users header reads "1 ADMINS".

**Cause**
1. The schema is fetched only by the factory's recipe; nothing in the repo fetches it.
2. The gating test removes APP_ENV from the process environment, but Next.js still loads the developer's
   `.env.local` from the project folder. The app behaves correctly; the test setup is not isolated.
3. Decisions taken in Clarifications and plan review were not copied to `docs/DECISIONS.md`.
4. The header always adds "S" to the count.

**Fix**
1. Add `npm run test:schemas` (a small script, `scripts/fetch-schemas.ts` or a shell script): when
   `.factory/schemas/oauth2-api.json` is missing, download exactly the pinned file
   (googleapis/google-api-go-client, commit `fb095823b5150e5301d201e7f19a5119edbbbdfd`, path
   `oauth2/v2/oauth2-api.json`) into `.factory/schemas/`; when present, do nothing. Run it as `pretest`
   so `npm test` gets the file by itself. When the download fails, print one clear line saying the schema
   is missing and the command to fetch it, and exit 1. The schema test (`tests/fakes/google.ts`) also
   names that command in its error when the file is missing. The file stays git-ignored. The README's
   Tests section says the first `npm test` downloads the schema from GitHub (needs network once).
2. The gated e2e servers never read the developer's `.env.local`, `.env.development.local` or `.env`:
   start each gated server so Next.js cannot see those files (for example, run `next start` with
   `NODE_ENV=test`, for which Next.js skips `.env.local`, after checking this holds for Next 16.4.6; or run
   it from a temporary folder that holds the build without any `.env*` file). Do the same for the main
   e2e `webServer` so a developer's `.env.local` never changes what the e2e app sees. Do not change the
   app's environment rules. The README's Tests section says the test commands ignore `.env.local`.
3. Add to `docs/DECISIONS.md` (one line each, `(SF-80)`): the Users page uses design A (a table with
   actions on each row and the add field above it); every table has Row Level Security on with no
   policies, so Supabase's Data API cannot read or write app data; users are deactivated, never deleted.
4. The Users header says "1 ADMIN" / "2 ADMINS" and "1 USER" / "2 USERS".

**Files to change**: `package.json` (scripts), a new `scripts/fetch-schemas.*`, `tests/fakes/google.ts`
(error text), `tests/e2e/fake-data.spec.ts`, `playwright.config.ts`, `README.md`, `docs/DECISIONS.md`,
`src/app/(app)/admin/users/page.tsx`, a new test under `tests/` (T048), and `.factory/test-env.md`
(drop the "Fresh checkout notes" workaround once fixed). No new dependency.
