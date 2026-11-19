# Quickstart: validate the app skeleton end-to-end

Settings and commands: [contracts/settings-and-commands.md](./contracts/settings-and-commands.md).
Pages, actions and exact messages: [contracts/routes.md](./contracts/routes.md).

## Prerequisites

- Node.js 24 (≥ 22.12 works), npm.
- A local Postgres (any recent version) with two empty databases, e.g. `crm_dev` and `crm_test`.
- No Google, Vercel or Supabase account.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env.local     # APP_ENV=development, DATABASE_URL=…/crm_dev, FIRST_ADMIN_EMAIL=ada@barnacle.ai
npm run db:migrate              # applies 0001_users_sessions.sql
npm run db:seed                 # prints the 5 fake users
npm run dev                     # http://localhost:3000
```

## Scenarios

| # | Do | Expect | Covers |
|---|---|---|---|
| 1 | Open `http://localhost:3000/admin/users` signed out | Sign-in page with "Sign in with Google" and `[ FAKE GOOGLE LOGIN ]` | FR-001, US4-1 |
| 2 | Fake login → pick Ada Fake | Lands on `/admin/users` (the page first asked for); sidebar shows Home, "// Admin" › Users (highlighted), "Ada Fake" + `[ Sign out ]` | US1-1, US4-2 |
| 3 | Open `/` | "Hello, Ada" | US1-2 |
| 4 | Users page: add `  New.Person@barnacle.ai  ` | Row `new.person@barnacle.ai`, "new.person", User, Active, Never | US2-2, edges |
| 5 | Add `x@gmail.com`, then `ada@barnacle.ai` | The two Users-page messages; row count unchanged | US2-3 |
| 6 | In a second browser profile sign in as Linus; as Ada deactivate Linus; Linus reloads | Linus sees "Your access has been removed…"; signing in again shows the same | US2-6, FR-007 |
| 7 | As Ada: remove Grace's admin, then try removing own admin | Grace → User; then "The CRM must always have at least one active admin." | US2-5, US2-8 |
| 8 | Ada's own row | `[ REMOVE ADMIN ]` but no `[ DEACTIVATE ]` | edge case |
| 9 | Sign in as Margaret (user), open `/admin/users` | "You don't have access to this page.", no "// Admin" group | US2-9 |
| 10 | Fake login with `someone@barnacle.ai`, then `me@gmail.com`, then Cancel | the `not_allowed`, `domain`, `cancelled` messages | US1-4, US1-5 |
| 11 | Signed in, open `/nope` | "Page not found." inside the sidebar layout, link to Home | edge case |
| 12 | `[ Sign out ]`, then open `/` | Sign-in page | US1-6 |
| 13 | Stop the app; `APP_ENV=production npm run db:seed`; `APP_ENV= npm run db:seed` | "Fake data can only be loaded when APP_ENV is development or test.", exit 1, no change | US3-4 |
| 14 | Start with `APP_ENV=production`; open `/sign-in` and `/dev/fake-google` | No fake link; "Page not found." | US3-4 |
| 15 | Start with `VERCEL_ENV=preview` and no `DATABASE_URL`; open `/` | Sign-in page: "Sign-in is turned off on preview deployments.", no button | FR-028 |
| 16 | Empty database, `FIRST_ADMIN_EMAIL` empty; open `/sign-in` | "The CRM isn't set up yet. No first admin has been named.", no button | edge case |
| 17 | Empty database, `FIRST_ADMIN_EMAIL=boss@barnacle.ai`; fake login as `Boss@Barnacle.ai` | Home page; sidebar has "// Admin" › Users; Users page shows boss as Admin | US1-3, FR-004 |
| 18 | `npm run db:seed` again | No error; same number of rows | US3-2 |
| 19 | `APP_ENV=development VERCEL_ENV=production npm run db:seed`; then `VERCEL_ENV=preview` | The `seed_refused` message, exit 1, no change; the app started with the same settings has no fake link and `/dev/fake-google` shows "Page not found." | FR-026, edge case |
| 20 | `npm run db:migrate` twice in a row; then two at once (`npm run db:migrate & npm run db:migrate; wait`) | Every run ends within 30 s; later runs print "Database is up to date."; `select count(*) from pg_locks where locktype='advisory'` = 0 | FR-027, edge cases |
| 21 | `psql`: `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where nspname='public' and relkind='r' and not relrowsecurity` | No rows | FR-032 |

## Automated checks

```bash
DATABASE_URL=postgres://…/crm_test APP_ENV=test npm test         # unit + integration, 0 failures
DATABASE_URL=postgres://…/crm_test APP_ENV=test npm run test:e2e # browser tests, 0 failures
npm run typecheck
APP_ENV=production VERCEL_ENV=preview npm run build              # builds with no DATABASE_URL
```
