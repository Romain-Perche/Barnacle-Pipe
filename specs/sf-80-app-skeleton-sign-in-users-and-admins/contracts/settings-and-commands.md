# Contract: settings and commands

## Settings (environment variables; `.env.example` lists them all, with no secret values)

| Name | Needed | Meaning |
|---|---|---|
| `APP_ENV` | always | `development`, `test` or `production`. Only the exact values `development`/`test` enable the fake login and fake data; anything else, including unset, disables them. |
| `DATABASE_URL` | not on previews | Postgres URL. Local: `postgres://…@localhost:5432/crm_dev` (tests: `crm_test`). Production: the Supabase pooler URL. Secret. |
| `FIRST_ADMIN_EMAIL` | production | barnacle.ai address of the first admin (Alexis). Empty + no users → sign-in shows the setup notice. |
| `GOOGLE_CLIENT_ID` | real Google sign-in | From the Internal OAuth app in the barnacle.ai Workspace. |
| `GOOGLE_CLIENT_SECRET` | real Google sign-in | Secret. |
| `APP_URL` | real Google sign-in | Public base URL, e.g. `http://localhost:3000`; redirect URI is `${APP_URL}/auth/google/callback`. |
| `VERCEL_ENV` | set by Vercel | `preview` → sign-in off, no database; `production` → `vercel-build` runs migrations. `production` or `preview` → fake login and fake data refused whatever `APP_ENV` says. |

No session secret: session tokens are random and stored hashed (research.md §4).

## Commands (`package.json` scripts)

| Command | Does |
|---|---|
| `npm run dev` | Start the app locally (`next dev`). Never migrates. |
| `npm run build` / `npm start` | `next build` / `next start`. Never touch the database at build. |
| `npm run vercel-build` | Used by Vercel: if `VERCEL_ENV=production` run `db:migrate` (fail the deploy on error), then `next build`. |
| `npm run db:migrate` | Apply pending `migrations/*.sql`, each in its own transaction under `pg_advisory_xact_lock` (no lock outlives a transaction, safe through Supabase's transaction pooler); prints applied names or "Database is up to date.". Two runs in a row or at once both finish. |
| `npm run db:seed` | Fake data. Not development/test, or `VERCEL_ENV` is `production`/`preview` → prints the `seed_refused` message, exits 1, opens no database connection. Else runs every seeder, prints the users created / already there. Re-runnable. |
| `npm test` | Vitest unit + integration tests (needs a local test database). |
| `npm run test:e2e` | Playwright browser tests (starts the app with `APP_ENV=test`, migrates and seeds first). |
| `npm run typecheck` | `tsc --noEmit`. |
