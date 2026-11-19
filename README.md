# Barnacle-Pipe

The Barnacle CRM: a Next.js (App Router, TypeScript) app on Postgres. The team signs in with their
barnacle.ai Google account; admins manage who has access on the Users page. Product rules are in
`docs/PRODUCT.md`, the look in `docs/DESIGN.md`, the team's choices in `docs/DECISIONS.md`.

You need **no Google, Vercel or Supabase account** to develop or test: a fake Google login and fake
data stand in for them.

## Prerequisites

- Node.js 24 (22.12 or newer works) and npm.
- A local PostgreSQL (any recent version) with two empty databases, for example `crm_dev` and `crm_test`:

  ```bash
  createdb crm_dev
  createdb crm_test
  ```

## Set up and run

```bash
npm install
npx playwright install chromium     # browser for the browser tests
cp .env.example .env.local          # APP_ENV=development, DATABASE_URL=…/crm_dev, FIRST_ADMIN_EMAIL=ada@barnacle.ai
npm run db:migrate                  # update the database structure
npm run db:seed                     # load fake data (prints the fake users)
npm run dev                         # http://localhost:3000
```

`npm run db:migrate` and `npm run db:seed` read `.env.local` when it exists. A variable set in the
shell wins over the file (`APP_ENV=production npm run db:seed` is refused even with `.env.local`).

Sign in: open http://localhost:3000, press `[ FAKE GOOGLE LOGIN ]` and pick **Ada Fake** (an admin).
The fake data team is Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users) and
Alan Fake (deactivated), all `@barnacle.ai`. On the fake login you can also type any email and name.

## Tests

Both test commands need a local test database and `APP_ENV=test`. They refuse to run otherwise.

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test             # Vitest: unit tests + integration tests against the test database (migrates it first)
npm run test:e2e     # Playwright: builds and starts the app, migrates and seeds, then runs the browser tests
npm run typecheck    # TypeScript
```

The test database is emptied and reloaded by the tests: never point `DATABASE_URL` at a database you care about.

The first `npm test` downloads the Google userinfo schema the fake Google sign-in is checked against
(`npm run test:schemas`, a pinned file from GitHub, into the git-ignored `.factory/schemas/`): it needs
network access once. The test commands ignore `.env.local`: the browser tests start the app from a
temporary folder without any `.env*` file, so it sees only the settings the tests give it.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Start the app locally. Never changes the database structure. |
| `npm run build` / `npm start` | Build / start the app. The build never touches the database. |
| `npm run vercel-build` | Vercel's build: runs `db:migrate` only when `VERCEL_ENV=production`, then `next build`. |
| `npm run db:migrate` | Apply the pending `migrations/*.sql`. Prints each one applied, or "Database is up to date.". Safe to run twice, or twice at once. |
| `npm run db:seed` | Load fake data. Only when `APP_ENV` is exactly `development` or `test` and `VERCEL_ENV` is not `production`/`preview`; otherwise prints "Fake data can only be loaded when APP_ENV is development or test." and exits 1. Safe to run again. |
| `npm test` | Unit and integration tests (runs `test:schemas` first). |
| `npm run test:schemas` | Download the pinned Google schema into `.factory/schemas/` when it is missing; does nothing otherwise. |
| `npm run test:e2e` | Browser tests. |
| `npm run typecheck` | `tsc --noEmit`. |

## Settings

Environment variables. `.env.example` lists them all, with no secret values. Secrets go in `.env.local`
(git-ignored) locally and in Vercel's environment settings in production. Never commit them.

| Name | Needed | Meaning |
|---|---|---|
| `APP_ENV` | always | `development`, `test` or `production`. Only exactly `development` or `test` turns on the fake Google login and the fake data command. Anything else, or not set, turns them off. |
| `DATABASE_URL` | not on previews | Postgres URL. Local: `postgres://…@localhost:5432/crm_dev` (tests: `crm_test`). Production: Supabase's connection pooler URL. Secret. |
| `FIRST_ADMIN_EMAIL` | production | barnacle.ai address of the first admin. Their first sign-in creates them as an admin. Empty with no users: the sign-in page says the CRM isn't set up yet. |
| `GOOGLE_CLIENT_ID` | real Google sign-in | From the Internal OAuth app in the barnacle.ai Google Workspace. |
| `GOOGLE_CLIENT_SECRET` | real Google sign-in | Secret. |
| `APP_URL` | real Google sign-in | Public base URL, e.g. `http://localhost:3000`. The OAuth redirect URI is `${APP_URL}/auth/google/callback`. Also anchors the check of the return path after sign-in (`http://localhost:3000` when unset). |
| `VERCEL_ENV` | set by Vercel | `preview`: sign-in off, no database. `production`: `vercel-build` migrates. `production` or `preview`: the fake login and fake data are refused, whatever `APP_ENV` says. |

There is no session secret: session tokens are random and only their SHA-256 is stored.

## Production notes

- **Vercel production**: `vercel-build` runs `npm run db:migrate` before `next build`. A failed migration fails the deploy.
- **Migrations through Supabase's pooler**: each migration runs in its own transaction under
  `pg_advisory_xact_lock`, which Postgres releases at commit or rollback. No lock outlives the command,
  so the transaction-mode pooler is safe. The app connects with `prepare: false` for the same pooler.
- **Row Level Security**: every table has Row Level Security on with no policies, so Supabase's Data API
  cannot read or write app data. The app's own database user owns the tables and is not affected.
- **Previews** only build the app: no `DATABASE_URL`, nobody can sign in, the sign-in page says so.
- **Fake login and fake data** are never available on Vercel production or preview deployments.
- **First admin**: set `FIRST_ADMIN_EMAIL`; that person signs in once and then adds the team on the Users page.
- **Google**: create an Internal OAuth client in the barnacle.ai Workspace with the redirect URI
  `${APP_URL}/auth/google/callback`, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_URL`.

## Adding a feature

The skeleton has four places where a new feature plugs in:

1. **A page**: add it under `src/app/(app)/…`. It gets the sidebar layout. Call `requireUser()` (or
   `requireAdmin()`) from `src/server/auth/session.ts` at the top of the page, and `requireUser()` or
   `assertAdminForAction()` at the top of every server action.
2. **A sidebar link**: add `{ href, label }` to `mainNav` or `adminNav` in `src/app/(app)/nav.ts`.
3. **Fake data**: add a seeder to the list in `src/seed/index.ts`. It must be safe to run twice.
4. **Database tables**: add a numbered SQL file to `migrations/`. Only statements allowed inside a
   transaction, and `alter table … enable row level security` after every `create table` (a test fails otherwise).

User-facing messages live in `src/server/messages.ts`.
