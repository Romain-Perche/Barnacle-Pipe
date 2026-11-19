---

description: "Tasks for SF-80 App skeleton — sign-in, users and admins"
---

# Tasks: App skeleton — sign-in, users and admins

**Input**: Design documents from `/specs/sf-80-app-skeleton-sign-in-users-and-admins/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, contracts/settings-and-commands.md, quickstart.md

**Tests**: Requested by the spec (FR-030, SC-002, SC-003, SC-007): Vitest unit + integration tests against a real local Postgres test database, Playwright browser tests. Within each story, write the tests first and see them fail.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use those strings verbatim, from `src/server/messages.ts` only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4 from spec.md
- Paths are from the repository root (single Next.js project, see plan.md § Project Structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the Next.js project from the empty repo.

- [X] T001 Create `package.json` with exactly the dependencies and versions in `specs/sf-80-app-skeleton-sign-in-users-and-admins/dependencies.json` (`next`, `react`, `react-dom`, `postgres`, `geist` as dependencies; `typescript`, `@types/*`, `tsx`, `vitest`, `@playwright/test` as devDependencies), `"engines": {"node": ">=22.12"}`, and the scripts of `contracts/settings-and-commands.md`: `dev`, `build`, `start`, `vercel-build` (`if [ "$VERCEL_ENV" = production ]; then npm run db:migrate; fi && next build`), `db:migrate` (`tsx scripts/migrate.ts`), `db:seed` (`tsx scripts/seed.ts`), `test` (`vitest run`), `test:e2e` (`playwright test`), `typecheck` (`tsc --noEmit`); run `npm install` to create `package-lock.json`
- [X] T002 [P] Create `tsconfig.json` (strict, `moduleResolution: bundler`, `paths: {"@/*": ["./src/*"]}`, Next.js plugin) and `next.config.ts` (no options beyond defaults)
- [X] T003 [P] Create `.env.example` listing every setting of `contracts/settings-and-commands.md` (`APP_ENV`, `DATABASE_URL`, `FIRST_ADMIN_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`; note that Vercel sets `VERCEL_ENV`) with local example values and no secrets; extend `.gitignore` with `node_modules/`, `.next/`, `.env*.local`, `.env`, `test-results/`, `playwright-report/`, `.factory/schemas/`
- [X] T004 [P] Create `vitest.config.ts` (node environment, `@/` alias, `tests/unit/**` and `tests/integration/**`, `globalSetup: tests/integration/global-setup.ts`, integration files run sequentially with `fileParallelism: false`) and `playwright.config.ts` (Chromium only, `testDir: tests/e2e`, `globalSetup: tests/e2e/global-setup.ts`, `webServer` = `npm run build && npm start` on port 3000 with `APP_ENV=test`, `baseURL` http://localhost:3000)
- [X] T005 [P] Create the root layout `src/app/layout.tsx` (Geist and Geist Mono from the `geist` package, `<html lang="en">`) and `src/app/globals.css` with the `docs/DESIGN.md` tokens (cream `#FAF6F1`, blue `#2B00FF`, deep blue `#1A0099`, orange `#FF4200`, ink `#111827`, danger `#DC2626`, line alphas), `font-feature-settings: "ss08" 1` on `html`, square buttons in mono uppercase `[ … ]` style

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Settings, database, migrations, messages and the pure rules every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Write `migrations/0001_users_sessions.sql` exactly as `data-model.md`: table `users` (`id bigint generated always as identity primary key`, `email text not null unique` with `check (email = lower(email))` and `check (email like '%@barnacle.ai')`, `name text not null`, `role text not null default 'user'` `check (role in ('admin','user'))`, `status text not null default 'active'` `check (status in ('active','deactivated'))`, `added_by bigint null references users(id)`, `created_at timestamptz not null default now()`, `last_sign_in_at timestamptz null`); table `sessions` (`id`, `token_hash bytea not null unique`, `user_id bigint not null references users(id)` + index, `created_at`, `last_seen_at timestamptz not null default now()`, `expires_at timestamptz not null`, `revoked_at timestamptz null`); table `user_changes` (`id`, `user_id bigint not null references users(id)`, `actor_id bigint null references users(id)`, `action text not null` `check (action in ('added','made_admin','admin_removed','deactivated','reactivated'))`, `created_at timestamptz not null default now()`); then `alter table users enable row level security;`, the same for `sessions` and `user_changes`, no policy, not `force` (FR-032). Only statements allowed inside a transaction
- [X] T007 [P] Implement `src/server/env.ts`: `appEnv()`, `isFakeAllowed()` = (`APP_ENV === "development" || APP_ENV === "test"`, exact compare, unset → false) AND `VERCEL_ENV !== "production" && VERCEL_ENV !== "preview"` (FR-026), `isPreview()` = `VERCEL_ENV === "preview"`, `firstAdminEmail()` (trimmed, lowercased, empty → null), `googleConfig()` (client id, secret, `APP_URL`; throws a clear error if missing when real Google sign-in is used)
- [X] T008 [P] Implement `src/server/db.ts`: one module-level postgres.js client from `DATABASE_URL` with `prepare: false`, `max: 5`, `idle_timeout: 20`, created lazily on first use (so previews and builds never connect); export `sql` and `closeDb()`
- [X] T009 Implement `scripts/migrate.ts` (research.md §8). Never use the session-level `pg_advisory_lock`: through Supabase's transaction pooler it can stay held after the command exits. For each `migrations/*.sql` in name order, run ONE `sql.begin` transaction that: (1) `select pg_advisory_xact_lock(<fixed bigint key>)`; (2) `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())` and `alter table schema_migrations enable row level security`; (3) skips the file if its name is already in `schema_migrations`; (4) runs the file with `tx.unsafe(text)` and inserts its name. Print each applied name, or "Database is up to date." when none was applied; close the client; exit non-zero on error (depends on T006, T008)
- [X] T010 [P] Implement `src/server/messages.ts`: a map of every code in `contracts/routes.md` § Messages to its exact text, and `messageFor(code)` returning `undefined` for unknown codes (text from URLs is never shown)
- [X] T011 [P] Implement the pure rules in `src/server/auth/rules.ts`: `normalizeEmail()` (trim + lowercase), `isBarnacleEmail()` (`^[a-z0-9._%+-]+@barnacle\.ai$` after normalising), `decideSignIn({email, emailVerified, hd}, existingUser, firstAdminEmail)` returning `ok | create_first_admin | domain | removed | not_allowed` in the order of research.md §3 (`hd` checked only when not null), `isSafeNext(next)` (starts with `/`, not `//` or `/\`, not `/auth/`; else `/`), `firstName(name)` (first word), `displayNameFor(email, googleName)` (Google name, else local part)
- [X] T012 [P] Write unit tests for T011 and T007 in `tests/unit/rules.test.ts` and `tests/unit/env.test.ts`: case-insensitive match (`Mikey@Barnacle.ai`), spaces trimmed, non-barnacle domain, unverified email, `hd` mismatch, deactivated → `removed`, first admin only when no record exists, `isSafeNext` rejects `//evil.com`, `/\evil.com`, `https://x`, `/auth/end`; `isFakeAllowed` false for `production`, `Development`, `dev`, empty and unset; false for `APP_ENV=development` or `test` with `VERCEL_ENV=production` and with `VERCEL_ENV=preview`; true for `APP_ENV=development` with `VERCEL_ENV` unset or `development`
- [X] T013 Create `tests/integration/global-setup.ts` (refuses to run unless `APP_ENV=test` and `DATABASE_URL` is set; runs the migrations of T009) and `tests/integration/db-helpers.ts` (`resetDb()` truncating `user_changes`, `sessions`, `users` restart identity cascade; `makeUser({email, name, role, status})`); and write `tests/integration/migrate.test.ts`: create a scratch database (`create database crm_migrate_<random>`, dropped in `afterAll`), run `scripts/migrate.ts` as a child process against it twice in a row, then twice at the same time on a fresh scratch database; every run exits 0 within 30 s, the second sequential run prints "Database is up to date.", each file appears once in `schema_migrations`, and `select count(*) from pg_locks where locktype = 'advisory'` is 0 afterwards (FR-027, SC-009); and `tests/integration/rls.test.ts`: every table in schema `public` (`pg_class` `relkind in ('r','p')`) has `relrowsecurity = true`, `pg_policies` has no row for `public`; a role `crm_rls_probe` (created if missing, `nologin`, granted `select, insert` on `users`) under `set local role` reads 0 rows from `users` while it has rows, and its `insert` is refused (FR-032, SC-010)

**Checkpoint**: `npm run db:migrate` works on an empty local database and again right after; `npm test` runs the unit tests, the migration tests and the RLS tests green.

---

## Phase 3: User Story 1 — Team member signs in with their barnacle.ai Google account (Priority: P1) 🎯 MVP

**Goal**: Google sign-in (real and fake), database sessions, the design B shell and the home page.

**Independent Test**: With a user already in the database, sign in through the fake Google login and see the home page with the sidebar; sign out and confirm pages redirect to sign-in.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T014 [US1] Download `oauth2-api.json` from https://github.com/googleapis/google-api-go-client/blob/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json at commit `fb095823b5150e5301d201e7f19a5119edbbbdfd` into `.factory/schemas/` (`git init -q /tmp/google-api-go-client && git -C /tmp/google-api-go-client fetch -q --depth 1 https://github.com/googleapis/google-api-go-client fb095823b5150e5301d201e7f19a5119edbbbdfd && git -C /tmp/google-api-go-client show FETCH_HEAD:oauth2/v2/oauth2-api.json > .factory/schemas/oauth2-api.json`), and make the fake of Google Sign-In refuse a request that the schema refuses: a test sends a wrong field and must fail. The fake lives in `tests/fakes/google.ts`: an in-process `fetch` replacement for `https://oauth2.googleapis.com/token` (standard OAuth 2.0 token response per RFC 6749 §5.1: `access_token`, `token_type`, `expires_in`; `invalid_grant` 400 for an unknown code or a wrong PKCE verifier) and `GET https://www.googleapis.com/oauth2/v2/userinfo` whose path, method and query parameters must match the `userinfo.get` method of the schema (anything else → 400/404) and whose response body is built only from properties of the schema's `Userinfo` object (`email`, `verified_email`, `hd`, `name`, `given_name`, …): building a response with a property that is not in `Userinfo` (e.g. `email_verified`) throws, and a test in `tests/unit/google-fake.test.ts` proves that both a wrong field and a wrong path fail. The test reads the schema with `test -s .factory/schemas/oauth2-api.json` semantics: missing schema = failing test, never a skip
- [X] T015 [P] [US1] Unit tests for `src/server/auth/google.ts` in `tests/unit/google.test.ts` using the fake of T014: authorization URL has `client_id`, `redirect_uri=${APP_URL}/auth/google/callback`, `response_type=code`, `scope=openid email profile`, `state`, `code_challenge` (S256 of the verifier), `hd=barnacle.ai`, `prompt=select_account`; token exchange + userinfo return `{email, emailVerified, hd, name}` mapped from `email`, `verified_email`, `hd`, `name`; token error or userinfo error → a `cancelled` result
- [X] T016 [P] [US1] Integration tests in `tests/integration/sign-in.test.ts` for `completeSignIn()`: listed active user → session created, `name` and `last_sign_in_at` updated; unlisted barnacle.ai → `not_allowed`, no session row; gmail → `domain`; deactivated → `removed`; first admin on empty DB → user created as active admin with a `user_changes` `added` row (actor null), two concurrent first sign-ins create one row; first admin already deactivated → `removed`; new Google name replaces the stored name
- [X] T017 [P] [US1] Integration tests in `tests/integration/session.test.ts`: only the SHA-256 hash is stored; lookup refuses expired (`expires_at` past), revoked (`revoked_at` set) and deactivated-user sessions with the right reason (`expired` vs `removed`); `last_seen_at`/`expires_at` refreshed at most hourly; sign-out deletes only the current session
- [X] T018 [P] [US1] Playwright tests in `tests/e2e/sign-in.spec.ts` (sign in via `/dev/fake-google`): signed out `/admin/users` → sign-in page → after sign-in lands back on the asked page (US1-1); "Hello, <first name>" and full name above `[ Sign out ]` (US1-2); unlisted and gmail messages (US1-4, US1-5); Cancel → "Sign-in was cancelled or failed. Please try again." with the Google button; sign-out then `/` and `/admin/users` → sign-in (US1-6); session cookie persists with a 30-day max-age (US1-7: new browser context with the saved storage state lands on home)

### Implementation for User Story 1

- [X] T019 [US1] Implement `src/server/auth/session.ts`: `createSession(userId)` (32 random bytes base64url token, store SHA-256 in `token_hash`, `expires_at = now() + 30 days`; cookie `crm_session` httpOnly, SameSite=Lax, Path=/, Secure over https, max-age 30 days), `lookupSession(token)`, `endSession(token)`, `revokeAllSessions(userId)` (sets `revoked_at`), and `requireUser()` for server components/actions: preview → redirect `/sign-in`; no/expired session → redirect `/auth/end?next=<x-pathname>`; revoked or deactivated → `/auth/end?reason=removed`; returns the fresh user row (role/status read on every request, FR-017)
- [X] T020 [US1] Implement `src/server/auth/sign-in.ts` `completeSignIn({email, name, emailVerified, hd})`: apply `decideSignIn`, insert the first admin with `on conflict (email) do nothing` + `user_changes` `added` (actor null), update `name` and `last_sign_in_at`, delete the user's expired/revoked sessions, `createSession`; return `{ok: true}` or `{ok: false, code}` (depends on T019)
- [X] T021 [P] [US1] Implement `src/server/auth/google.ts`: `authorizationUrl({state, codeChallenge})`, `newPkce()`, `exchangeCode(code, verifier)` (POST form to `https://oauth2.googleapis.com/token`), `fetchUserinfo(accessToken)` (GET `https://www.googleapis.com/oauth2/v2/userinfo`, read only `email`, `verified_email`, `hd`, `name`); any non-2xx or missing field → throw `GoogleSignInFailed`
- [X] T022 [US1] Implement `src/proxy.ts`: public paths `/sign-in`, `/auth/*`, `/dev/fake-google`, `/_next/*`, static files; on other paths with no `crm_session` cookie → redirect `/sign-in?next=<path+query>`; with a cookie, re-send it with max-age 30 days; always forward the path as request header `x-pathname`
- [X] T023 [US1] Implement `src/app/auth/google/start/route.ts` and `src/app/auth/google/callback/route.ts` per `contracts/routes.md` (oauth cookie with state, verifier, safe next, 10 min; state mismatch, `error` param or `GoogleSignInFailed` → `/sign-in?error=cancelled`; refusal → `/sign-in?error=<code>`; success → safe next; always clear the oauth cookie; preview → `/sign-in`)
- [X] T024 [P] [US1] Implement `src/app/auth/end/route.ts`: delete the session row (if any) and the `crm_session` cookie, then redirect to `/sign-in?error=removed` when `reason=removed`, else `/sign-in?next=<safe next>`
- [X] T025 [US1] Implement `src/app/sign-in/page.tsx` (design per `docs/DESIGN.md`, wordmark `BARNACLE_LABS` with orange `_`): preview notice first (no DB access, no button); then valid session → redirect to safe next; then setup notice when `FIRST_ADMIN_EMAIL` is empty and `users` is empty (no button); else the `error` message (via `messageFor`), "Sign in with Google" → `/auth/google/start?next=…`, and only when `isFakeAllowed()` a `[ FAKE GOOGLE LOGIN ]` link → `/dev/fake-google?next=…`
- [X] T026 [US1] Implement the fake Google login `src/app/dev/fake-google/page.tsx` and `src/app/dev/fake-google/actions.ts`: `notFound()` unless `isFakeAllowed()` (actions re-check and do nothing otherwise); a chooser with one button per user in the database (name + email), a form with Email and Name, `[ CANCEL ]` → `/sign-in?error=cancelled`; submit calls `completeSignIn({email, name, emailVerified: true, hd: null})` and redirects like the callback
- [X] T027 [US1] Implement the design B shell: `src/app/(app)/nav.ts` (`mainNav = [{href: "/", label: "Home"}]`, `adminNav = [{href: "/admin/users", label: "Users"}]`, with a comment that later features add entries here), `src/app/(app)/SidebarLink.tsx` (`'use client'`, highlights the current link with `usePathname`), `src/app/(app)/layout.tsx` (`requireUser()`; blue sidebar with the wordmark, main nav, "// Admin" group only when `role === 'admin'`, user name and a `[ Sign out ]` form at the bottom) and `src/app/(app)/actions.ts` `signOut()` (end the current session, delete cookie, redirect `/sign-in`)
- [X] T028 [US1] Implement the home page `src/app/(app)/page.tsx` (`requireUser()`, "Hello, <firstName(name)>"), the in-shell not-found `src/app/(app)/not-found.tsx` + `src/app/(app)/[...missing]/page.tsx` ("Page not found." with a link to Home) and the outside-shell `src/app/not-found.tsx` ("Page not found.")

**Checkpoint**: US1 tests pass; a listed user signs in with the fake login, sees home, signs out.

---

## Phase 4: User Story 2 — Admin manages who can use the CRM (Priority: P2)

**Goal**: The Users page (design A) with add, make/remove admin, deactivate/reactivate, last-admin rule and audit.

**Independent Test**: As an admin add a barnacle.ai address, make it admin, sign in as it and see Users; deactivate it and see it signed out and refused.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T029 [P] [US2] Integration tests in `tests/integration/users.test.ts` for `src/server/users.ts`: add trims/lowercases (`  jd@barnacle.ai  ` → `jd@barnacle.ai`), name = local part, role user, status active, `added_by` = actor, `user_changes` `added`; `invalid_domain` for gmail, `x@barnacle.ai.evil.com` and empty input; `duplicate` for `JD@barnacle.ai` when `jd@barnacle.ai` exists; make/remove admin; remove own admin allowed when another active admin exists; `last_admin` on removing or deactivating the only active admin; `self_deactivate`; deactivate revokes all sessions; reactivate keeps the previous role; non-admin or deactivated actor → `forbidden` and no row changes; two concurrent demotions of the last two admins leave ≥ 1 active admin (SC-008); every change writes one `user_changes` row with actor and action
- [X] T030 [P] [US2] Playwright tests in `tests/e2e/users.spec.ts`: table columns and "Never" (US2-1); add (US2-2) and the two add errors with row count unchanged (US2-3); make admin → that user's reload shows "// Admin" (US2-4); remove admin → "You don't have access to this page." for them (US2-5); deactivate a signed-in user in a second browser context → their next page shows "Your access has been removed. Ask an admin if this is a mistake." and signing in again shows it too (US2-6); reactivate (US2-7); last admin message (US2-8); own row has `[ REMOVE ADMIN ]` and no `[ DEACTIVATE ]`; non-admin direct `/admin/users` and direct action POST refused with no row change (US2-9, SC-003); admins A and B both on the page, A demotes B, B (no reload) demotes A → B sees the forbidden message and A stays Admin

### Implementation for User Story 2

- [X] T031 [US2] Implement `src/server/users.ts`: `listUsers()` (active first, then name case-insensitively), `addUser(actorId, email)`, `makeAdmin`, `removeAdmin`, `deactivate`, `reactivate` (`actorId`, `userId`); each in one transaction that locks the actor row and all `role='admin' and status='active'` rows `FOR UPDATE`, re-checks the actor is an active admin (`forbidden`), applies the change, refuses with `last_admin` if `count(*) where role='admin' and status='active'` would be 0, refuses `self_deactivate`, calls `revokeAllSessions` on deactivate, and inserts a `user_changes` row (`added`, `made_admin`, `admin_removed`, `deactivated`, `reactivated`); returns `{ok}` or `{ok: false, code}`
- [X] T032 [US2] Add `requireAdmin()` to `src/server/auth/session.ts`: `requireUser()` then returns `{user, isAdmin}` for pages; an `assertAdminForAction()` variant redirects to `/admin/users` when the user is not an admin
- [X] T033 [P] [US2] Implement `src/app/(app)/Forbidden.tsx`: "You don't have access to this page." in the shell, HTTP 403 semantics
- [X] T034 [US2] Implement `src/app/(app)/admin/users/actions.ts`: `addUser`, `makeAdmin`, `removeAdmin`, `deactivate`, `reactivate` server actions (form data `email` or `userId`), each calling `assertAdminForAction()` then `src/server/users.ts`, then redirecting to `/admin/users` or `/admin/users?error=<code>`
- [X] T035 [US2] Implement `src/app/(app)/admin/users/page.tsx` per design A of `design-options.html`: non-admin → `Forbidden`; header `// ADMIN`, "Users", `N USERS · M ADMINS`; add field (placeholder `name@barnacle.ai`) + `[ ADD USER ]`; orange-bordered error box above the table from `messageFor(error)`; one row per user: name with email under it, role badge Admin/User, status Active or Deactivated (greyed row), last sign-in in `Europe/London` as `19 Nov 2026, 09:12` or "Never"; row buttons `[ MAKE ADMIN ]`/`[ REMOVE ADMIN ]` on active rows, `[ DEACTIVATE ]` on active rows except the viewer's own, `[ REACTIVATE ]` on deactivated rows

**Checkpoint**: US1 and US2 tests pass.

---

## Phase 5: User Story 3 — Developer loads fake data (Priority: P3)

**Goal**: `npm run db:seed` with the APP_ENV gate, idempotent fake users, usable through the fake login.

**Independent Test**: On an empty local copy run the seed, sign in as a fake admin and a fake user, each sees what their role allows.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T036 [P] [US3] Integration tests in `tests/integration/seed.test.ts`: running the seeders twice gives the same 5 users of `data-model.md` § Fake data (2 admins, 2 users, 1 deactivated, all @barnacle.ai); running `scripts/seed.ts` as a child process with `APP_ENV` = `production`, `Development`, empty and unset, and with `APP_ENV=development` plus `VERCEL_ENV` = `production` and `preview`, prints exactly "Fake data can only be loaded when APP_ENV is development or test.", exits 1 and leaves the database unchanged
- [X] T037 [P] [US3] Playwright tests in `tests/e2e/fake-data.spec.ts`: the fake chooser lists the seeded users; Ada Fake (admin) sees the 5 rows on the Users page; Linus Fake (user) has no "// Admin" group; Alan Fake (deactivated) gets the `removed` message; a typed unlisted address gets the `not_allowed` message. Add a separate Playwright project or test that starts the app with `APP_ENV=production` (and one with `APP_ENV=development VERCEL_ENV=preview`, no database needed) and checks the sign-in page has no `[ FAKE GOOGLE LOGIN ]` link and `/dev/fake-google` shows "Page not found." (US3-4, SC-007)

### Implementation for User Story 3

- [X] T038 [P] [US3] Implement `src/seed/users.ts`: the 5 fake users of `data-model.md` (`ada@barnacle.ai` Ada Fake admin active, `grace@barnacle.ai` Grace Fake admin active, `linus@barnacle.ai` Linus Fake user active, `margaret@barnacle.ai` Margaret Fake user active, `alan@barnacle.ai` Alan Fake user deactivated) with `insert … on conflict (email) do nothing`, an `added` `user_changes` row (actor null) only for rows actually inserted; returns lines "created <email> (<role>, <status>)" or "already there <email>"
- [X] T039 [US3] Implement `src/seed/index.ts` (ordered `seeders` list with a comment that later features append theirs) and `scripts/seed.ts`: if not `isFakeAllowed()` print the `seed_refused` message and exit 1 before opening any database connection; else run every seeder, print their lines, close the DB
- [X] T040 [US3] Make `tests/e2e/global-setup.ts` run the migrations and the seeders against the test database (refusing unless `APP_ENV=test`)

**Checkpoint**: US1–US3 work; `npm run db:seed` twice is safe.

---

## Phase 6: User Story 4 — Later features slot into the skeleton (Priority: P3)

**Goal**: One layout and one set of access rules everywhere; README that gets a newcomer running.

**Independent Test**: Open every page signed out, as a user and as an admin; follow the README on a fresh checkout.

### Tests for User Story 4 ⚠️

- [X] T041 [P] [US4] Playwright tests in `tests/e2e/layout.spec.ts`: signed out, `/`, `/admin/users`, `/anything` → sign-in (US4-1); signed in, `/` and `/admin/users` show the same sidebar with wordmark, Home, the name above `[ Sign out ]`, current link highlighted (US4-2); `/nope` → "Page not found." inside the sidebar with a link to Home; `/sign-in?next=//evil.com` signs in to `/`
- [X] T042 [P] [US4] Unit test in `tests/unit/preview.test.ts`: with `VERCEL_ENV=preview` and no `DATABASE_URL`, the sign-in page data loader returns the `preview` notice without touching the database, and `/auth/google/start` and `requireUser()` redirect to `/sign-in`

### Implementation for User Story 4

- [X] T043 [US4] Write `README.md`: what the app is; prerequisites (Node 24, a local Postgres, no Google/Vercel/Supabase account); setup (`npm install`, `npx playwright install chromium`, `.env.local` from `.env.example`); `npm run db:migrate`; `npm run db:seed`; `npm run dev`; signing in as a fake admin through `[ FAKE GOOGLE LOGIN ]`; `npm test` and `npm run test:e2e` with a `crm_test` database; the full settings table of `contracts/settings-and-commands.md`; production notes (Vercel `vercel-build` migrates only on production, migrations use a per-transaction lock so they are safe through Supabase's transaction pooler, every table has Row Level Security on with no policies, fake login/data never on Vercel production or preview, previews have no database, `FIRST_ADMIN_EMAIL`, Google Internal OAuth app redirect URI `${APP_URL}/auth/google/callback`); "Adding a feature" section listing the four extension points of `contracts/routes.md`
- [X] T044 [US4] Verify `VERCEL_ENV=preview APP_ENV=production npm run build` succeeds with no `DATABASE_URL` (all `(app)` pages and `/sign-in` are dynamic; nothing queries at build time); fix any page that is statically prerendered

**Checkpoint**: All stories work independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T045 [P] Security pass over `src/`: every server action calls `requireUser()`/`assertAdminForAction()` first; no message text taken from URLs; `next` always through `isSafeNext`; no secret in the repo (`git grep -i secret` shows only setting names); cookies httpOnly
- [X] T046 Run `npm run typecheck`, `npm test` and `npm run test:e2e` against a local test database: 0 failures; walk the scenarios of `specs/sf-80-app-skeleton-sign-in-users-and-admins/quickstart.md`
- [X] T047 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) and `## Schemas` (each schema's GitHub URL at its commit). Google Sign-In: fake `tests/fakes/google.ts` (token endpoint + userinfo), checked against `oauth2-api.json` (https://github.com/googleapis/google-api-go-client/blob/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json); in the running app the in-app fake Google login `/dev/fake-google` is used. Supabase Postgres: no fake — a real local Postgres; no public schema on GitHub, so it follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler: no prepared statements, copied by always running with `prepare: false`; connection limits, copied by `max: 5`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories → **Polish (Phase 7)**.
- T047 (test recipe) is the last task of the feature.

### User Story Dependencies

- **US1 (P1)**: after Phase 2. No dependency on other stories.
- **US2 (P2)**: after US1 (needs sessions, `requireUser`, the shell; its browser tests sign in via the fake login).
- **US3 (P3)**: after US1 (the fake login). Independent of US2 for implementation; its Users-page check uses US2's page.
- **US4 (P3)**: after US1; its layout test covers `/admin/users` from US2.

### Within Each User Story

- Tests first, failing; T014 (schema + Google fake) before T015.
- `rules.ts` → `session.ts` → `sign-in.ts` → routes/pages.
- `users.ts` → actions → page.

### Parallel Opportunities

- Phase 1: T002–T005 together after T001.
- Phase 2: T007, T008, T010, T011, T012 together; T009 after T006 + T008.
- US1: T015–T018 together after T014; T021 and T024 alongside T019/T020.
- US2: T029, T030, T033 together.
- US3: T036, T037, T038 together.
- US4: T041, T042 together.

---

## Parallel Example: User Story 1

```bash
# After T014 (schema download + Google fake):
Task: "Unit tests for src/server/auth/google.ts in tests/unit/google.test.ts"
Task: "Integration tests for completeSignIn() in tests/integration/sign-in.test.ts"
Task: "Integration tests for sessions in tests/integration/session.test.ts"
Task: "Playwright sign-in tests in tests/e2e/sign-in.spec.ts"

# Implementation side by side:
Task: "Implement src/server/auth/google.ts"
Task: "Implement src/app/auth/end/route.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2.
2. Phase 3 (US1): the first admin (from `FIRST_ADMIN_EMAIL`) can sign in and out; nobody else can.
3. Stop and validate with the US1 tests.

### Incremental Delivery

1. US1 → sign-in works (MVP).
2. US2 → the team can be added and managed.
3. US3 → fake data for every later feature.
4. US4 → README and cross-page checks; skeleton ready for Pipelines and deals.

---

## Notes

- Use the message texts of `contracts/routes.md` verbatim.
- Never use the real team's names or any real account in tests or fake data.
- Do not commit `.factory/schemas/` (git-ignored by T003).

---

## Fix round 1: a fresh checkout's test commands pass (US4 scenario 3, FR-031)

- [x] T048 [US4] Write the failing checks first (`// covers US4 scenario 3, FR-031, US3 scenario 4`): (a) an e2e check that creates a `.env.local` with `APP_ENV=development` in the project folder for the duration of the test (restoring any existing file afterwards), then runs the `gated: APP_ENV unset` server and asserts no `[ FAKE GOOGLE LOGIN ]` link and a 404 on `/dev/fake-google` — fails now because `next start` loads `.env.local`; (b) a test that runs `npm run test:schemas` in a temporary copy of the repo without `.factory/schemas/` and asserts the file appears with a `Userinfo` schema, and that a second run makes no download — fails now because the script does not exist. Then, in a fresh clone with `.env.local` from the README and no `.factory/schemas/`, run `npm test` and `npm run test:e2e`: record the failures (2 files, 1 test) before fixing
- [x] T049 [US4] Add `npm run test:schemas` (fetch `oauth2/v2/oauth2-api.json` at commit `fb095823b5150e5301d201e7f19a5119edbbbdfd` of googleapis/google-api-go-client into `.factory/schemas/` only when missing; on failure print the missing file and the command, exit 1) and run it as `pretest`; make `tests/fakes/google.ts` name that command when the file is missing. `.factory/schemas/` stays git-ignored
- [x] T050 [US4] Isolate the e2e servers from the developer's env files: the gated servers in `tests/e2e/fake-data.spec.ts` and the main `webServer` in `playwright.config.ts` must not load `.env`, `.env.local` or `.env.*.local` (verify the chosen way against Next.js 16.4.6). Do not change the app's environment rules
- [x] T051 [P] [US4] README Tests section: the first `npm test` downloads the Google schema from GitHub (`npm run test:schemas`); the test commands ignore `.env.local`. Update `.factory/test-env.md`: remove the "Fresh checkout notes" workaround
- [x] T052 [P] Add three lines to `docs/DECISIONS.md`, each ending `(SF-80)`: the Users page uses design A (a table with actions on each row, the add field above it); every table has Row Level Security on with no policies, so Supabase's Data API cannot read or write app data; users are deactivated, never deleted
- [x] T053 [P] [US2] Users page header: singular for 1 ("1 USER · 1 ADMIN"), plural otherwise; add a unit or e2e check (`// covers US2 scenario 1`)
- [x] T054 In a fresh clone with the README's `.env.local` and no `.factory/schemas/`, follow the README: `npm test`, `npm run test:e2e` and `npm run typecheck` report 0 failures

---

## Fix round 2: no open redirect through control characters in `next` (FR-009, security review)

- [ ] T055 [US1] Write the failing checks first (`// covers FR-009, edge case "next with a tab or newline"`): (a) in `tests/unit/rules.test.ts`, `isSafeNext` returns `"/"` for `"/\t/evil.com"`, `"/\n/evil.com"`, `"/\r/evil.com"`, `"/\t\\evil.com"`, `"/\x00/evil.com"`, `"/\x7f"` and `"/admin\\users"`, and still keeps `"/admin/users?error=duplicate"` and `"/%09/evil.com"`-style encoded paths only if they resolve on the app; plus a loop asserting that for every test input, `new URL(isSafeNext(v), "https://crm.example/x").origin === "https://crm.example"`; (b) a route-level check: signed in (fake login), `GET /auth/end?next=%2F%09%2Fevil.com` without following redirects answers a redirect whose `Location` has the app's own origin and path `/`. Both fail now (the unit returns the value unchanged; the route answers `https://evil.com/`)
- [ ] T056 [US1] In `isSafeNext()` (`src/server/auth/rules.ts`), return `"/"` when `next` contains any ASCII control character (U+0000–U+001F, U+007F) or a backslash, before the existing checks; keep the `//`, `/\` and `/auth` rules. No route changes
- [ ] T057 Run `npm test`, `npm run test:e2e` and `npm run typecheck`: 0 failures
