# AGENTS.md

How to work on this repo. Setup, commands and settings are in `README.md`. Product rules are in
`docs/PRODUCT.md`, the look in `docs/DESIGN.md`, team choices in `docs/DECISIONS.md`: follow them.

## Stack

Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript, Postgres through `postgres` (postgres.js,
plain SQL, no ORM), plain CSS (`src/app/globals.css`), fonts from `geist`. No auth library: own Google
OAuth code flow and database sessions.

## Layout

- `src/app/(app)/` — every signed-in page (design B sidebar layout). `nav.ts` is the sidebar registry.
- `src/app/sign-in`, `src/app/auth/*`, `src/app/dev/fake-google` — public sign-in pages and routes.
- `src/server/` — domain code, tested without the UI: `auth/rules.ts` (pure rules), `auth/session.ts`
  (`requireUser`, `requireAdmin`, `assertAdminForAction`), `auth/sign-in.ts`, `auth/google.ts`,
  `users.ts`, `env.ts` (`isFakeAllowed`, `isPreview`), `messages.ts` (every user-facing message).
- `src/seed/` — fake data; `index.ts` is the seeder registry.
- `migrations/` — numbered SQL files, applied by `scripts/migrate.ts`.
- `scripts/fetch-schemas.mjs` (`npm run test:schemas`, before `npm test`: pinned Google schema) and
  `scripts/start-isolated.mjs` (browser tests start the app without the developer's `.env*` files).
- `tests/unit`, `tests/integration` (Vitest, real Postgres), `tests/e2e` (Playwright), `tests/fakes` (outside services only).

## Rules

- Server components by default; a client component only where the browser is needed.
- Every signed-in page calls `requireUser()`/`requireAdmin()`; every server action calls `requireUser()` or
  `assertAdminForAction()` first. Never rely on hidden links alone.
- User-facing text comes from `src/server/messages.ts`; never show text taken from a URL. Redirect
  targets go through `isSafeNext()`.
- Migrations: only statements allowed in a transaction; `alter table … enable row level security` after
  every `create table` (no policies). Never run migrations at app start.
- The fake Google login and fake data only work when `isFakeAllowed()` is true. Fake data uses
  clearly fake names, never the real team.
- No secrets in the repo; every setting is listed in `.env.example` and the README.

## Tests

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run test:e2e && npm run typecheck
```

Each test names what it covers (`// covers FR-003, US1 scenario 2`). Fakes only for outside services
(Google Sign-In: `tests/fakes/google.ts`, checked against its schema; see `.factory/test-env.md`).
