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
  SF-92 adds `migrations/0003_private_owner_handover.sql` (plain `alter table`/`create index`, no new table;
  `migrate.test.ts` applies it on a fresh database and checks Postgres's own 23514 check violations) and keeps the
  same limits: `updatePerson`'s visibility re-check, `deletePerson` and `handOverPrivatePeople` (row locks on
  `users … for update`, no advisory lock) each run in one `sql.begin()` transaction.
  The pipelines and deals code (SF-93, `src/server/deals/`) keeps to the same pooler limits (no `set`/`listen`/session
  advisory lock, checked by `tests/integration/migrate.test.ts`; every change one `sql.begin()`); its tables come from
  `migrations/0004_pipelines_deals.sql` (pipelines, stages, deals, deal_stage_periods; timeline_events gains deal_id),
  applied on a fresh database by the same test.

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
    labels, timeline, pipelines, stages, deals, stage periods…), puts back the six starting lead sources, and seeds
    again (`NO_SEED=1`: empty).
    The seed adds 5 fake users, 35 fake people (Gus Lorem is private, created by Ada Fake; Fay Mockup is
    archived; SF-92: Pat Privatefake private, created by Ada Fake and owned by Linus Fake; Robin Leftfake (linked
    to Fakeco Ltd) and Sam Leftfake private, owned by deactivated Alan Fake) and 9 fake organisations ("Old Fakeco
    Archive" is archived), labels Hot/Investor/Partner, and (SF-93)
    the pipelines Sales (Lead in, Qualified, Proposal, Negotiation, Closing — Closing empty), Ambassadors, Fractional
    CTO, Exec Dinner and "Ada Fake's pipeline" with 44 fake deals: "Old fake opportunity" is archived, "Fake secret
    project" and "Ada's fake prospect 2" are private (created by Ada Fake), "Lorem Logistics tracking" has the private
    person Gus Lorem, some deals have a "moved" history line. The seed already has a "Fakeco website" deal: scenario
    scripts that add their own should delete it first (the browser tests do).
  - Pipelines, deals and the board scenarios (SF-93) are covered by `tests/e2e/{board,deals,pipelines,deals-private}.spec.ts`
    (real drag with `locator.dragTo`; a failed drag by aborting the server action POST with `page.route`). Board
    selectors: each column is a `region` named after its stage (`h2` name, `.tot` "<n> deals · £total"), cards are
    `a.card`, the drawer is the `complementary` named "Deal" with a "History" region; the admin pages' rows are
    `table.order` with buttons named "Rename <name>", "Move <name> up/down" and links "Delete <name>". Non-admin
    pages answer "You don't have access to this page." with HTTP 200 (as the other admin pages).
  - SF-93 AI-review scenario script `scenarios-sf93.js` (all 33 US1–US6 scenarios and edge cases 1–16, 49 checks,
    ~4 min, against :3000/crm_dev, run in order on fresh fake data; it ends by emptying pipelines/deals for US1-5):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf93.js`.
    Notes: sign in with the user's real name (`signIn(page, base, email, "Linus Fake")`): an empty name renames the
    fake user. Use a wide viewport (1900px): with a sideways-scrolled board `dragTo` can grab a card of another column.
    Next's route announcer is also `role="alert"`: the board's messages are `p.err[role=alert]`. Leak checks read
    `innerText` (the page's `<script>` payload holds the address). Deactivation is done by SQL (`users.status`).
  - People and organisations scenarios (SF-90) are covered by `tests/e2e/{people,organisations,lists,archive-delete,private,choices}.spec.ts`;
    SF-92 by `tests/e2e/private.spec.ts` (owner sees a private person), `archive-delete.spec.ts` ("A deleted person
    was linked by …") and `handover.spec.ts` (Users page hand-over panel: `form.handover`, select "Hand over to");
    a "direct request" check replays a server action form post (`$ACTION_ID_…` field from the server-rendered
    page, see `tests/e2e/records.ts` `actionField`) as a non-admin.
  - SF-90 scenario script `scenarios-sf90.js` (all 47 US1–US6 and edge-case scenarios, against :3000/crm_dev):
    phase A on an empty CRM: `NO_SEED=1 bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf90.js A`
    (US1, US2, US6-1, edge 1–4, 10, 11, 13, 14; adds Linus by SQL); phase B on the seed:
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf90.js B`.
    Selector notes: CSS text-transform makes `innerText` upper-case (use `textContent`); list name links are `td:first-child a.nm`
    (each cell also holds an empty `a.cell-link` that opens the drawer); form selects are `select[name=leadSourceId|ownerId]`;
    lead source/label names on the admin page are input values; the sidebar has two `nav`s.
  - SF-90 fix round 1 (edge cases 14–20: unknown sector, organisation picker typed text/Enter/case, one-shot delete
    notice, rename to a removed name): `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf90-fix1.js`.
    The spec renumbered the edge cases: `scenarios-sf90.js`'s "Edge case 14" (no Last contacted/Date added field) is now Edge case 21.
  - SF-92 scenario script `scenarios-sf92.js` (all US1–US3 scenarios and edge cases 1–13, against :3000/crm_dev, ~3 min):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf92.js`.
    It adds Carl Fake (user) and Dee Fake (deactivated, no private people) through the Users page, sets Sam Leftfake's
    address to `secret@example.com` and gives Alan two extra private people by SQL (the owner select only offers
    active users), deactivates Grace by SQL for edge 6, and replays the hand-over action as a direct post (edge 7, US3-7).
    Person pages: `[ DELETE ]` is a link that opens the confirm, then `[ DELETE FOR GOOD ]`; phones column is `phone`.
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
