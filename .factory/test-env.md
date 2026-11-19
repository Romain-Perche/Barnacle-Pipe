# Test environment

## Services
- Google Sign-In (OAuth 2.0 token endpoint + userinfo v2): fake (tests/fakes/google.ts), an in-process `fetch`
  for `POST https://oauth2.googleapis.com/token` and `GET https://www.googleapis.com/oauth2/v2/userinfo`,
  checked against the schema `oauth2-api.json` (userinfo method, path, query parameters, `Userinfo`
  properties and types). The token endpoint follows RFC 6749 §4.1.3/§5.2 and PKCE RFC 7636 (not in the
  schema): copies `invalid_grant` for an unknown or reused code and a wrong `code_verifier`,
  `invalid_client` for a wrong secret, `invalid_request` for a missing parameter. In the running app the
  in-app fake Google login `/dev/fake-google` (APP_ENV=test or development) is used instead.
- Supabase Postgres (through the Supavisor pooler): no fake — a real local PostgreSQL 17. No public schema
  on GitHub; follows Supabase's docs (https://supabase.com/docs/guides/database/connecting-to-postgres):
  transaction-mode pooler copied by always connecting with `prepare: false` and taking only
  transaction-level advisory locks in migrations; connection limit copied by `max: 5`. The people and
  organisations code (SF-90) keeps to the same limits: no session state (`set`, `listen`, session locks),
  every multi-statement change in one `sql.begin()` transaction; tables come from
  `migrations/0002_people_organisations.sql`, checked on a fresh database by `tests/integration/migrate.test.ts`.

## Schemas
- oauth2-api.json: https://github.com/googleapis/google-api-go-client/blob/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json

## Docker images
- none (PostgreSQL comes from Debian's apt repository, see below)

## How to run the app
- PostgreSQL: `sudo apt-get install -y postgresql` (its post-install script may fail in the VM; the
  binaries in `/usr/lib/postgresql/17/bin` still work), then as the normal user:
  `initdb -D /tmp/pgdata -U postgres --auth=trust && pg_ctl -D /tmp/pgdata -o "-k /tmp -c listen_addresses=localhost" -l /tmp/pg.log start`
  and `psql -h localhost -U postgres -c "create database crm_test" -c "create database crm_dev"`.
- Schema: `.factory/schemas/oauth2-api.json`, downloaded by `npm run test:schemas` (run by `npm test` as `pretest`; commit above, sha256 checked).
- Browsers: Playwright's Chromium 1254 is in `~/.cache/ms-playwright` (matches `@playwright/test` 1.65.0).
- Tests: `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`, then
  `npm test` and `npm run test:e2e` (builds, starts on port 3000 from a temporary folder without `.env*` files via `scripts/start-isolated.mjs` with `FIRST_ADMIN_EMAIL=boss@barnacle.ai`,
  migrates and seeds; the gating tests start extra servers on ports 3101–3104).
- Manual run: `npm run db:migrate && npm run db:seed && npm run build && npm start` with
  `APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev FIRST_ADMIN_EMAIL=ada@barnacle.ai`,
  then open http://localhost:3000 and use `[ FAKE GOOGLE LOGIN ]`.

- Scripts (AI review, `.factory/run/`):
  - `bash .factory/run/start-postgres.sh` — installs PostgreSQL 17 if missing (apt's post-install error is
    harmless), starts it on localhost:5432 (trust auth, data in /tmp/pgdata), creates crm_dev and crm_test.
  - `bash .factory/run/start-app.sh` — starts Postgres, migrates, seeds, builds and runs `next start` in the
    background (log `/tmp/app-$PORT.log`). Env: `PORT` (3000), `APP_ENV` (development; `APP_ENV=` for empty),
    `DATABASE_URL` (crm_dev), `FIRST_ADMIN_EMAIL` (ada@barnacle.ai; `FIRST_ADMIN_EMAIL=` for none), `VERCEL_ENV`,
    `SKIP_BUILD=1` (reuse `.next`), `SKIP_SEED=1`. One build serves every extra server (settings are read at runtime).
  - `bash .factory/run/reset-db.sh [db]` — empties every app table (users, sessions, people, organisations,
    labels, timeline…), puts back the six starting lead sources, and seeds again (`NO_SEED=1`: empty).
    The seed adds 5 fake users, 32 fake people (Gus Lorem is private, created by Ada Fake; Fay Mockup is
    archived) and 9 fake organisations ("Old Fakeco Archive" is archived), labels Hot/Investor/Partner.
  - People and organisations scenarios (SF-90) are covered by `tests/e2e/{people,organisations,lists,archive-delete,private,choices}.spec.ts`;
    a "direct request" check replays a server action form post (`$ACTION_ID_…` field from the server-rendered
    page, see `tests/e2e/records.ts` `actionField`) as a non-admin.
  - Playwright scenario scripts (`NODE_PATH=/opt/playwright/node_modules node <script>`): `scenarios-main.js`
    (:3000, crm_dev freshly reset), `scenarios-env.js` (:3101 empty DB + FIRST_ADMIN boss@, :3102 empty DB no
    FIRST_ADMIN, :3103 VERCEL_ENV=preview, :3104 APP_ENV empty, :3105 production, :3106 development+VERCEL_ENV
    production, :3107 "Development"), `scenarios-seed.js` (:3108 on a fresh crm_seed). Helpers in `lib.js`.
  - Extra servers for `scenarios-env.js` (after the main build; DBs crm_e1/crm_e2 dropped and created empty first):
    `D=postgres://postgres@localhost:5432; PORT=3101 APP_ENV=test DATABASE_URL=$D/crm_e1 FIRST_ADMIN_EMAIL=boss@barnacle.ai SKIP_BUILD=1 SKIP_SEED=1 bash .factory/run/start-app.sh`,
    `PORT=3102 APP_ENV=test DATABASE_URL=$D/crm_e2 FIRST_ADMIN_EMAIL= …`, `PORT=3103 VERCEL_ENV=preview …`, `PORT=3104 APP_ENV= …`,
    `PORT=3105 APP_ENV=production …`, `PORT=3106 VERCEL_ENV=production …`, `PORT=3107 APP_ENV=Development …` (all with SKIP_BUILD=1 SKIP_SEED=1).
    `scenarios-seed.js`: fresh crm_seed, `db:migrate`, `db:seed`, start on 3108 with SKIP_SEED=1; run the script, seed again, run it with `count`.
    Edge 14/15 by hand: two `db:migrate` in parallel on a fresh DB; `set role anon` (granted all on the tables) gets 0 rows and an RLS error on insert.
  - Edge 16 (open redirect) is in `scenarios-main.js` (`/auth/end` with hidden characters, raw `Location` and
    followed; fake login with the same `next`). The real `/auth/google/start` needs Google settings: start one more
    server `GOOGLE_CLIENT_ID=fake-id GOOGLE_CLIENT_SECRET=fake-secret PORT=3110 SKIP_BUILD=1 SKIP_SEED=1 bash .factory/run/start-app.sh`
    and check `curl -s -D - -o /dev/null "http://localhost:3110/auth/google/start?next=%2F%0A%2Fexample.com"`: the
    `crm_oauth` cookie holds `"next":"/"` (Google endpoints are hard-coded, so the callback itself is not driven).
    The not-found page is Edge 17.
  - `bash .factory/run/fresh-checkout.sh > /tmp/fresh.log 2>&1` — US4 scenario 3: clones the branch to /tmp/fresh,
    recreates crm_dev/crm_test, follows the README (install, `.env.local`, migrate, seed, dev server shows the fake
    login), then `npm test`, `npm run test:e2e`, `npm run typecheck` (stop every server on :3000 first; ~10 min).
  - Stop servers by pid (`ss -ltnp | grep next-server`), not `pkill -f next…`: that also kills the calling shell.

## Smoke checks
1. test -s .factory/schemas/oauth2-api.json
2. /usr/lib/postgresql/17/bin/pg_isready -h localhost -p 5432
3. curl -fs -o /dev/null http://localhost:3000/sign-in
