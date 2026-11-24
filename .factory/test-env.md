# Test environment

## Services
- Google Sign-In (OAuth 2.0 token endpoint + userinfo v2): fake (tests/fakes/google.ts), an in-process `fetch`
  for `POST https://oauth2.googleapis.com/token` and `GET https://www.googleapis.com/oauth2/v2/userinfo`,
  checked against the schema `oauth2-api.json` (userinfo method, path, query parameters, `Userinfo`
  properties and types). The token endpoint follows RFC 6749 §4.1.3/§5.2 and PKCE RFC 7636 (not in the
  schema): copies `invalid_grant` for an unknown or reused code and a wrong `code_verifier`,
  `invalid_client` for a wrong secret, `invalid_request` for a missing parameter. In the running app the
  in-app fake Google login `/dev/fake-google` (APP_ENV=test or development) is used instead.
- Supabase Storage (SF-116, file contents): fake `src/server/files/fake-storage.ts` (`FakeStorage`), wrapped for the
  tests by `tests/fakes/storage.ts` (`StorageFake`, installed with `useStorageFetchForTests`), which checks every request
  and answer against the schema `storage_v0_openapi.json` (path and method among the schema's paths, query parameters
  declared, JSON body properties declared with their types and `required`, properties of each 200 JSON answer declared;
  the info answer has no 200 schema there and follows the Storage server's renderer `size`/`content_type`). The fake
  copies Storage's behaviour: 409 on an existing object (no upsert), 413 over 26214400 bytes, `400 InvalidJWT` for an
  expired or wrong token, a token valid for one path only (an upload token never reads), 60 s read addresses and 2 h
  upload addresses, `download` → `content-disposition: attachment`, `range` → 206, the key required in `authorization`
  and `apikey`. Switches: `down()` (network error), `failDeletes()` (500 on delete), `advance(ms)` (token clock),
  `objects()`, `requests`. In the running app (APP_ENV development/test and `SUPABASE_URL` empty) the same fake is
  reached by the browser at `/dev/fake-storage/...` (contents in `.fake-storage/`, git-ignored).
  AI review only: `.factory/run/storage-proxy.js`, a stand-in Storage on :54321 (`/storage/v1/*` forwarded to the app's
  `/dev/fake-storage`, CORS like Storage, `MODE=fail-deletes` answers 500 to every DELETE) for a second app run with
  `SUPABASE_URL=http://localhost:54321 SUPABASE_SECRET_KEY=fake-storage-key`.
- Pipedrive API (SF-117; v1 `GET /users/me`, `GET /users`; v2 `GET /persons`, `/organizations`, `/personFields`,
  `/organizationFields`): fake `src/server/pipedrive/fake-pipedrive.ts` (`FakePipedrive`), wrapped for the tests by
  `tests/fakes/pipedrive.ts` (`installFakePipedrive`, installed with `usePipedriveFetchForTests`; loaders in
  `tests/fakes/pipedrive-schema.ts`), which checks every request and answer against the schemas
  `pipedrive_v2_openapi.json` (`/api/v2/*`: path and method, query parameters declared, enum values (`sort_by`,
  `sort_direction`, each `include_fields` item), `limit` ≤ the declared maximum 500, every property of a 200 answer's
  `data[]` items (plus the fields asked for with `include_fields`) and of `additional_data` declared with its type, the
  `x-api-token` header of the `api_key` scheme) and `pipedrive_v1_openapi.yml` (`/v1/*`: path and method, query
  parameters declared (so `api_token` in the address throws: the app sends the header), every property of the 200
  answer's `data` declared, the `x-api-token` header). The fake copies Pipedrive's behaviour: 401 for an unknown or
  refused token, 429 with `Retry-After` (`slowDownEvery(n, seconds)`), 400 on `limit` > 500 and on
  `include_fields=marketing_status` without the marketing app (`noMarketingApp()`), cursor paging (base64 of the last
  id) in ascending ids, the `ids` filter. Switches: `failNext("network" | 500)`, `hangNext()` (no answer until the 10 s
  time-out), `deletePerson` / `deleteOrganization`, `refuseToken`, `tamper` (changes the next answer), `requests`
  (method, path, query; never the token). In the running app (APP_ENV development/test and `PIPEDRIVE_URL` empty) the
  same fake runs in process (no route, no proxy): tokens `fake-pipedrive-token` ("Fake Person", "Fakeco Pipedrive" 1001:
  60 organisations, 300 people; owners Fake Person = ada@barnacle.ai, Margaret Pipedrive Fake = margaret@barnacle.ai,
  Jane Fake = jane@fake.example with no CRM user; "Fakeco Ltd" matches the seeded organisation; person 17 shares
  person001's email, person 23 has an invalid email, person 99 has no name, organisation 60's name is over 200
  characters; "Budget" (double), "Favourite colour" (varchar), "Job title", "Lead source" (Referral / Webinar / Event),
  "LinkedIn", org "Region" (address), labels Hot / Cold / Investor) and `fake-pipedrive-other` ("Otherco Pipedrive"
  1002). It needs `PIPEDRIVE_TOKEN_KEY` set (`start-app.sh` makes one into /tmp/pipedrive-token-key; tests set their own).
- Supabase Postgres (through the Supavisor pooler): no fake — a real local PostgreSQL 17. No public schema
  on GitHub; follows Supabase's docs (https://supabase.com/docs/guides/database/connecting-to-postgres):
  transaction-mode pooler copied by always connecting with `prepare: false` and taking only
  transaction-level advisory locks in migrations; connection limit copied by `max: 5`. The people and
  organisations code (SF-90) keeps to the same limits: no session state (`set`, `listen`, session locks),
  every multi-statement change in one `sql.begin()` transaction; tables come from
  `migrations/0002_people_organisations.sql`, checked on a fresh database by `tests/integration/migrate.test.ts`.
  SF-92 adds `migrations/0003_private_owner_handover.sql` (plain `alter table`/`create index`, no new table;
  `migrate.test.ts` applies it on a fresh database and checks Postgres's own 23514 check violations) and keeps the
  same limits: `updatePerson`'s visibility re-check, `deletePerson` and `handOverPrivateRecords` (SF-97: also moves private deals; row locks on
  `users … for update`, no advisory lock) each run in one `sql.begin()` transaction.
  The pipelines and deals code (SF-93, `src/server/deals/`) keeps to the same pooler limits (no `set`/`listen`/session
  advisory lock, checked by `tests/integration/migrate.test.ts`; every change one `sql.begin()`); its tables come from
  `migrations/0004_pipelines_deals.sql` (pipelines, stages, deals, deal_stage_periods; timeline_events gains deal_id),
  applied on a fresh database by the same test.
  The deal list and deal page code (SF-95: `src/server/deals/list.ts`, `src/server/deals/links.ts` and the Won/Lost/
  Reopen/Restore functions in `deals.ts`) keeps to the same pooler limits (no `set`/`listen`/session advisory lock,
  scanned by `tests/integration/migrate.test.ts`; every change one `sql.begin()` locking the deal row `for update`); its
  tables and columns come from `migrations/0005_deal_page.sql` (deal status/closed_at/lost_reason, deal_labels,
  deal_label_links, deal_people, deal_followers, timeline_events.reason and the won/lost/reopened kinds), applied on a
  fresh database by the same test, which also checks Postgres's own 23514 refusals (won without a date, lost without a
  reason, a 501-character reason, a lost event without a reason).
  The CSV import code (SF-103, `src/server/imports/imports.ts`) keeps to the same pooler limits: no `set`/`listen`/session
  advisory lock (scanned by `tests/integration/migrate.test.ts`), one `sql.begin()` per change, only a transaction-level
  `lock table organisations, person_emails in share row exclusive mode` during an import, bulk inserts in chunks of
  1,000 rows through `unnest` arrays (one bind parameter per column, far under the 65,535 limit); its table `csv_imports`
  and the `imported` timeline kind come from `migrations/0006_csv_imports.sql`, applied on a fresh database by the same
  test, which also checks Postgres's own 23514 refusals (a done import without a report or still holding its file, a
  file over 5 MB, kind `deals`). No new outside service: the CSV file comes from the browser.
  The timeline and notes code (SF-102: `src/server/records/notes.ts`, `src/server/records/timeline.ts`,
  `src/server/notifications.ts`) keeps to the same pooler limits (no `set`/`listen`/session advisory lock, scanned by
  `tests/integration/migrate.test.ts`; every note change one `sql.begin()` locking the record row `for update`); its
  table and columns come from `migrations/0007_notes_mentions.sql` (timeline_events body/edited_by/edited_at/version and
  kind `note`, with `imported` kept for SF-103's 0006; note_mentions), applied on a fresh database by the same test,
  which also checks Postgres's own 23514/23505 refusals (a note without body or author, a body or editor on another
  kind, a second mention of the same user) and the cascade of mentions with their note. Notifications are in-app only:
  no email service, so no new fake.
  The activities code (SF-109: `src/server/activities/activities.ts`, `src/server/activities/list.ts`, and the changes to
  `src/server/records/timeline.ts`, `src/server/notifications.ts`, `src/server/deals/deals.ts`) keeps to the same pooler
  limits (no `set`/`listen`/session advisory lock, scanned by `tests/integration/migrate.test.ts`; every change one
  `sql.begin()` locking the activity and its linked rows `for update`; the clock is passed as a `now` parameter, never a
  session time zone). Its table comes from `migrations/0008_activities.sql` (`activities`; it does not touch
  `timeline_events`), applied on a fresh database by the same test, which also checks Postgres's own 23514 refusals (a
  type other than call/meeting/task, a subject with spaces around it, empty or over 200 characters, a duration without a
  time or not 5–1440 in steps of 5, done_at without done_by, an empty note) and that deleting a deal, person or
  organisation sets the activity's link to null. Assignment notifications are in-app only and Google Calendar sync comes
  later: no new outside service, so no new fake.
  The sidebar count (SF-108: `src/app/(app)/UnreadLink.tsx` and the server action `currentUnread` in
  `src/app/(app)/notifications/actions.ts`) runs the same read-only `unreadCount` query after every client navigation:
  no fake, the real local PostgreSQL, no public schema on GitHub, same pooler limits (no session state, no new
  connection).
  The ambassador code (SF-114: `src/server/records/ambassadors.ts`, `referral-rules.ts`, the referral and delete changes in
  `people.ts` and `deals.ts`) keeps to the same pooler limits: no fake, the real local PostgreSQL 17, no public schema on
  GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres; no session state (`set`/`listen`/session
  advisory lock, scanned by `tests/integration/migrate.test.ts`), each save one `sql.begin()` that re-checks the referrer
  (`isOfferedAmbassador`) and writes the referral event. Its columns and kinds come from `migrations/0009_ambassadors.sql`
  (`persons.is_ambassador`, `persons/deals.referred_by_id` + `referred_at`, `timeline_events.from_person_id`, kinds
  `ambassador_added`/`ambassador_removed`/`referrer_set`/`referrer_changed`/`referrer_cleared`, cause `person_deleted`;
  no new table), applied on a fresh database by `migrate.test.ts`, which also checks Postgres's own 23514 refusals (a
  person referred by themselves, a `from_person_id` on another kind, an unknown cause). No new outside service.
  The files code (SF-116: `src/server/files/*.ts`, the record deletes in `deals.ts`, `people.ts`, `organisations.ts`)
  keeps to the same pooler limits: no fake, the real local PostgreSQL 17, no public schema on GitHub, follows
  https://supabase.com/docs/guides/database/connecting-to-postgres; no session state (scanned by `migrate.test.ts`), every
  change one `sql.begin()` locking the record row `for update`, and no Storage (network) call inside a transaction (the
  read-back comes before it, the delete after it). Its tables and columns come from `migrations/0011_files.sql` (`files`,
  `file_uploads`, `file_cleanup`, RLS on each; `timeline_events.file_id/file_name/file_size/deleted_file_id`, kinds
  `file_added`/`file_deleted` plus SF-115's `custom_*` kinds), applied on a fresh database by `migrate.test.ts`, which also
  checks Postgres's own 23514 refusals (a file on two records or none, size 0 / 26214401, a 256-character name, kind
  `svg`, FILE events without their fields).
  The custom fields code (SF-115: `src/server/custom-fields/` — `rules.ts`, `fields.ts`, `values.ts` — and the value saves
  in `people.ts`, `organisations.ts`, `deals.ts` and the CSV import's `imports.ts`) keeps to the same pooler limits: no fake,
  the real local PostgreSQL 17, no public schema on GitHub, follows
  https://supabase.com/docs/guides/database/connecting-to-postgres; no session state (`set`/`listen`/session advisory lock,
  scanned by `tests/integration/migrate.test.ts`; only a transaction-level `pg_advisory_xact_lock` per kind while an admin
  adds or reorders fields), one `sql.begin()` per change (admin changes re-check `isActiveAdmin` inside it; record values are
  saved inside the record's own save transaction, the fields read `for share`), bulk inserts of imported values through
  `unnest` arrays in chunks of 1,000. Its tables, columns and kinds come from `migrations/0010_custom_fields.sql`
  (`custom_fields`, `custom_field_choices`, `custom_values`; `timeline_events.field_name`/`old_value`/`new_value`; kinds
  `custom_set`/`custom_changed`/`custom_cleared`, plus SF-116's `file_added`/`file_deleted` in the shared kind check), applied
  on a fresh database by `migrate.test.ts`, which also checks Postgres's own 23514/23505 refusals (a 61-character or
  `colour`-typed field, a second "diet" person field, a value row with two values or two targets, a second value for the
  same field and person, a `custom_set` without a field name, an `edited` event with an old value). No new outside service.
  Saved segments (SF-120, `src/server/segments/`) keep to the same pooler limits: no `set`/`listen`/session advisory lock
  (scanned by `tests/integration/migrate.test.ts`), each save one `sql.begin()` with an optimistic `version` check, counts
  as one read-only query per segment; the table and index come from `migrations/0014_segments.sql` (only `create table` /
  `create index`, RLS on), applied on a fresh database by the same test, which checks Postgres's own 23514 / 23505
  refusals. No new outside service and no new fake.
  The Pipedrive import code (SF-117: `src/server/pipedrive/*.ts`, `deactivate()` in `users.ts`) keeps to the same pooler
  limits: no fake, the real local PostgreSQL 17, no public schema on GitHub, follows
  https://supabase.com/docs/guides/database/connecting-to-postgres; no session state (`set`/`listen`/session advisory lock,
  scanned by `tests/integration/migrate.test.ts`), every change one `sql.begin()`, and NO Pipedrive (network) call inside a
  transaction: a part fetches first, then one transaction locks the import row `for update`, checks its step and cursor,
  takes `lock table organisations, person_emails, pipedrive_links in share row exclusive mode` and saves the page with
  bulk `unnest` inserts. Its tables come from `migrations/0012_pipedrive.sql` (`pipedrive_connections`,
  `pipedrive_imports` with the partial unique index "one open import per user", `pipedrive_links` with the primary key
  company + kind + Pipedrive id; RLS on each; kinds `pipedrive_imported`/`pipedrive_unsubscribed` added to the shared kind
  check), applied on a fresh database by `migrate.test.ts`, which also checks Postgres's own 23514/23505 refusals (a
  second open import, paused without a reason, People without consent, nothing ticked, a person link with an
  organisation id, `how = 'copied'`, a 256-character company name).
  The unsubscribe code (SF-121: `src/server/records/unsubscribe.ts`) keeps to the same pooler limits: no fake, the real
  local PostgreSQL 17, no public schema; no session state, each unsubscribe one `sql.begin()` with a conditional
  `update persons … where unsubscribe_token = $1 and consent = 'subscribed' returning id` (Read Committed re-checks the
  `where` after the row lock, so two requests at once write one line; `tests/integration/unsubscribe.test.ts` runs them
  with `Promise.all`). Its column and kinds come from `migrations/0013_unsubscribe.sql` (`persons.unsubscribe_token`, a
  64-hex `gen_random_uuid()` default per row, unique; kinds `unsubscribed_link`, `unsubscribed_mail_app`,
  `consent_changed`), applied on a fresh database by `migrate.test.ts`, which also checks existing rows each get a
  distinct token and Postgres's own refusals (23514: token `'abc'` or uppercase hex, `consent_changed` without
  `old_value`/`new_value` or actor, an unsubscribe kind with an actor; 23505: a duplicate token). Mail apps' RFC 8058
  one-click POSTs are not an outside service: the tests call the route handler straight with RFC 8058's body
  (`List-Unsubscribe=One-Click`, urlencoded and multipart).
  SF-119 (campaign drafts) keeps to the same pooler limits in `src/server/campaigns/` (no `set`/`listen`/session advisory
  lock; each change one `sql.begin()`, the save locking its row `for update`); its table comes from
  `migrations/0015_campaigns.sql` (`campaigns`: drafts with a `version`, `content_kind` blocks/html, `blocks` jsonb,
  `html`, `merge_links` jsonb), applied on a fresh database by `tests/integration/migrate.test.ts`, which also checks
  Postgres's own 23514 refusals (a 101-character or untrimmed name, status `sent`, blocks with html, html kind without
  html, html with no kind, `[]` or 51 blocks, 500,001 characters of HTML, `merge_links` `{}`, a 256-character subject)
  and that the pure files (`merge.ts`, `content.ts`, `rules.ts`) import nothing server-only. No new outside service:
  images or styles named in pasted HTML are fetched by the user's browser inside the sandboxed preview, never by the app.

## Schemas
- oauth2-api.json: https://github.com/googleapis/google-api-go-client/blob/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json
- storage_v0_openapi.json: https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json
- pipedrive_v2_openapi.json: https://github.com/soenneker/soenneker.pipedrive.openapiclient/blob/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json
- pipedrive_v1_openapi.yml: https://github.com/Zenika/zenpipe/blob/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml

- Pipedrive stand-in over HTTP (AI review, SF-117): `.factory/run/pipedrive-server.ts` serves Build's `FakePipedrive`
  (`buildDevFake()`, the same data as the in-process fake) on :9400 (`npx tsx .factory/run/pipedrive-server.ts`), for a second
  app started with `PIPEDRIVE_URL=http://localhost:9400`. `POST /__control` `{op, args}` calls the fake's switches
  (`slowDownEvery`, `failNext`, `hangNext`, `refuseToken`, `addCompany`, `addPerson`, `addOrganization`, `addField`, `addUser`,
  `deletePerson`, …), `{op:"reset"}`, `{op:"down", args:[true]}` (every call a network error), `{op:"requests"}`.

## Docker images
- none (PostgreSQL comes from Debian's apt repository, see below)

## How to run the app
- PostgreSQL: `sudo apt-get install -y postgresql` (its post-install script may fail in the VM; the
  binaries in `/usr/lib/postgresql/17/bin` still work), then as the normal user:
  `initdb -D /tmp/pgdata -U postgres --auth=trust && pg_ctl -D /tmp/pgdata -o "-k /tmp -c listen_addresses=localhost" -l /tmp/pg.log start`
  and `psql -h localhost -U postgres -c "create database crm_test" -c "create database crm_dev"`.
- Schemas: `.factory/schemas/oauth2-api.json`, `.factory/schemas/storage_v0_openapi.json`,
  `.factory/schemas/pipedrive_v2_openapi.json` and `.factory/schemas/pipedrive_v1_openapi.yml`, downloaded by
  `npm run test:schemas` (run by `npm test` as `pretest`; commits above, sha256 checked).
- Browsers: Chromium for the AI review's scenario scripts (`NODE_PATH=/opt/playwright/node_modules`) is in `~/.cache/ms-playwright`.
- Tests: `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`, then
  `npm test` and `npm run typecheck`. No browser tests in the repo (docs/DECISIONS.md): the AI review drives the app with
  the scenario scripts below.
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
  - SF-120 segments: `NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf120.js` (app on :3000 from
    `start-app.sh`). It resets crm_dev itself (`reset-db.sh` + seed) and loads `.factory/run/sf120-setup.sql`: pipelines
    RevPipe (stages RA, RB) and DelPipe (DA), 15 people "Rv …" (A1 on two deals with two addresses, A2 linked person, W1/W2
    on a won deal, X1 on an archived deal, L1 archived+unsubscribed+no address, L2 unsubscribed+no address, L3 no address,
    M1 only person of "Rv D9", G1 private (Grace), V1 on Grace's private deal, O1 at "Old Fakeco Archive", AL owned by
    deactivated Alan Fake, Z1 at "Rv TempOrg" with the person Yes/No field "Rv Opted (fake)"). Expected for Ada: RA open 3,
    all 5; RevPipe open 4 (left out 1/1/1); RB open 2, 1 after moving Rv D9 to RA. Runs all 23 SF-120 scenarios (~1 min; all pass, re-run in a second and third AI review, after the SF-121 merge).
    SF-117: `PIPEDRIVE_TOKEN_KEY` defaults to a key made once into /tmp/pipedrive-token-key (`PIPEDRIVE_TOKEN_KEY=` for
    "The Pipedrive import isn't set up yet."); `PIPEDRIVE_URL` empty → the in-process fake Pipedrive.
  - `bash .factory/run/reset-db.sh [db]` — empties every app table (users, sessions, people, organisations,
    labels, timeline, pipelines, stages, deals, stage periods, activities…), puts back the six starting lead sources, and seeds
    again (`NO_SEED=1`: empty). Run `npm run db:migrate` first on a database created before a new migration (the
    truncate lists every table).
    The seed adds 5 fake users, 35 fake people (Gus Lorem is private, created by Ada Fake; Fay Mockup is
    archived; SF-92: Pat Privatefake private, created by Ada Fake and owned by Linus Fake; Robin Leftfake (linked
    to Fakeco Ltd) and Sam Leftfake private, owned by deactivated Alan Fake) and 9 fake organisations ("Old Fakeco
    Archive" is archived), labels Hot/Investor/Partner, and (SF-93)
    the pipelines Sales (Lead in, Qualified, Proposal, Negotiation, Closing — Closing empty), Ambassadors, Fractional
    CTO, Exec Dinner and "Ada Fake's pipeline" with 46 fake deals: "Old fake opportunity" is archived, "Fake secret
    project" and "Ada's fake prospect 2" are private (created by Ada Fake), SF-97: "Fake leaver deal" (Sales · Lead in)
    and the archived "Fake leaver old deal" are private, created and owned by deactivated Alan Fake, "Lorem Logistics tracking" is NOT linked to
    Gus Lorem since the SF-92 merge (the seed picks people by id; `scenarios-sf93.js` links him by SQL for US6-4), some deals have a "moved" history line.
    SF-95 adds the deal labels Hot, Warm, Cold, Big ticket, Renewal (on 9 deals, e.g. "Fakeco website": Hot, Big ticket),
    won deals "Fakeco newsletter (won)", "Sample Gyms signage (won)", "Mock Labs retainer (won)", lost deals "Dummy
    Leisure app (lost)" ("Went with a fake competitor"), "Lorem Logistics pilot (lost)" ("Fake budget cut"), "Testfield
    Health kiosk (lost)" ("No fake decision maker") and the archived "Old fake tender (lost)" ("Fake tender cancelled"), all
    in Sales with periods of 1–11 days through its stages; other linked people on 6 deals (never the main person, never a
    private person) and followers on 6 ("Mock Labs audit" is followed by deactivated Alan Fake). `reset-db.sh` also
    empties deal_followers, deal_people, deal_label_links and deal_labels (SF-102: and note_mentions).
    SF-102 adds 7 fake notes (newest 3 hours old): Ada Fake on "Fakeco website" mentioning Linus Fake (Linus has
    1 unread notification), Linus Fake on "Fakeco AI pilot" edited by Grace Fake (version 2), Grace Fake on the first
    shared person mentioning Ada Fake (read), Margaret Fake on the second shared person, Ada Fake on Fakeco Ltd, on the
    private deal "Fake secret project" and on the private person Pat Privatefake. The seed already has a "Fakeco website" deal: scenario
    scripts that add their own should delete it first.
    SF-109 adds 12 fake activities (subjects "Fake call: …", "Fake meeting: …", "Fake task: …"), dated from the UK day the
    seed runs: Ada Fake's call overdue 4 days on "Fakeco website" (with its person and organisation), her task today 09:00
    on "Sample Gyms CRM", meeting today 15:00–16:00 on Fakeco Ltd, call in 2 days on "Mock Labs audit" (assigned by Grace
    Fake: a read notification), task in 5 days with no link; Grace Fake's meeting tomorrow on Fakeco Ltd (assigned by Ada
    Fake: Grace has 1 unread notification) and task next week on Bob Placeholder; three done ones ("Fakeco AI pilot",
    "Fakeco support contract", Fakeco Ltd; the first two set their main person's Last contacted); a call on the private
    deal "Fake secret project" and a task on the private person Gus Lorem (both Ada's). Every other open deal shows
    "⚠ No next activity" on the board.
    SF-114 adds (seeder "ambassadors", after notes) 9 people with `@example.com` addresses: ambassadors Cara Example (shared,
    owner Ada Fake, Sample Studios Fake, "Partnerships lead"), Dora Privatefake (private, Linus Fake's), the former ambassador
    Ezra Formerfake (unticked); Ben, Dee, Eli Referredfake (referred by Cara), Fay, Gus Referredfake (by Ezra), Hal Referredfake
    (shared, by Dora); 4 Sales deals referred by Cara: "Fake referral · website" (open £4,500, person Ben), "… · pilot" (won
    £4,000), "… · app" (lost £1,500, "Fake: chose another supplier"), "… · audit" (open £2,000, private, Linus Fake's); notes by
    Ada Fake on "… · website" and on Dee. So Sales has 4 more deals and there are 44 fake people. For Ada, Cara's page shows
    People 3 · Deals 3 · Open £4,500 · Won £4,000 · Lost 1; for Linus, Deals 4 · Open £6,500.
    SF-115 adds (seeder "custom-fields", after ambassadors) nine "(fake)" custom fields: people Diet (single choice None /
    Vegetarian / Vegan / Pescatarian (removed), in list), Birthday (date), Newsletter topics (multiple choice AI / Events /
    Hiring, in list), Head count met (number), Notes (long text); organisations Account code (text, in list), Annual budget
    (money, in list); deals Contract end (date, in list), Signed NDA (yes/no, in list). Values: Cara Example (Diet Vegan,
    Birthday 24 Nov 1990, topics AI + Events, Notes on two lines), Dora Privatefake (private, Linus Fake's: Diet Vegetarian),
    Ben Referredfake (the removed choice Pescatarian, Head count 12), Dee Referredfake (Hiring), Sample Studios Fake
    (FAKE-001, £25,000), "Fake referral · website" (31 Mar 2027, NDA Yes) and the private "… · audit" (15 Jan 2027, NDA No),
    each with a "<Field> set to <value>" timeline entry by the record's creator.
  - SF-117 AI review (Pipedrive import). Start, after the build on :3000: `nohup npx tsx .factory/run/pipedrive-server.ts >/tmp/pd.log 2>&1 &`,
    `PORT=3001 SKIP_BUILD=1 SKIP_SEED=1 PIPEDRIVE_URL=http://localhost:9400 bash .factory/run/start-app.sh` and (edge 18)
    `PORT=3002 SKIP_BUILD=1 SKIP_SEED=1 PIPEDRIVE_TOKEN_KEY= bash .factory/run/start-app.sh`. Then, each on fresh data
    (`bash .factory/run/reset-db.sh` first; helpers in `sf117-lib.js`): `NODE_PATH=/opt/playwright/node_modules node
    .factory/run/scenarios-sf117-a.js` (US1, US2, edge 1, 3–8, 10–15, 18; ~1.5 min) and `… scenarios-sf117-b.js` (US3, edge 2, 9,
    16, 17; adds company 2001 with 800 organisations / 3,000 people (token big-fake-token, Grace), 3001 (mid-a / mid-b, Linus and
    Margaret), marg-token (Margaret on 1001); ~6 min; pass name prefixes to run a subset). Notes: the dev fake's people have
    Pipedrive ids 61–360 (person i = id i+60: organisations 1–60 take the first ids); "Owner 'Jane Fake' (…)" and
    "Another Pipedrive person, 'Person001 Fake', …" quote the Pipedrive name (FR-028). All 48 scenarios pass (fix round 1
    added the "// COUNTS" table per kind on 3 REPORT, `section[aria-label="Counts per kind"]`). `check-sf117-kindcounts.js`
    (app on :3000, `BASE=http://localhost:3000`, fresh data) prints that table next to the `pipedrive_links` counts per kind
    (round 2: People 298/0/0/2, Organisations 58/1/0/1, equal to the links).
  - SF-114 AI-review scenario script `scenarios-sf114.js` (all 38: US1 1–5, US2 1–7, US3 1–7, US4 1–4, US5 1–2, edge cases
    1–13, ~4 min, :3000/crm_dev on fresh fake data; makes its own "SF114 …" people/deals by SQL, runs every action in the UI):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf114.js`
    (`ONLY="US2 scenario 4,Edge case 9"` for a subset; US2-5 needs US2-2's "SF114 Bob Sample"). Selectors: the picker is the
    `combobox` "Referred by" with `listbox` "Ambassadors" (options read "<name> <organisation> · <first email>"), its chip
    has the button "Clear Referred by"; the tick is the checkbox "Ambassador"; "Referred by" is `dt` + `dd` on the person page,
    deal page and `aside[aria-label=Deal]` drawer; the ambassador page has `dl.strip[aria-label=Summary]`, regions "People
    referred" / "Deals referred" (`a.nm`), `section[aria-label='Latest updates'] li.ent` (`.kd` tag, `.on-deal a` record link).
    Direct requests: rewrite the hidden `referredBy` (or add `ambassador=on`) in the form holding `firstName`/`title` — not the
    first form of the page (that is the sidebar's sign-out). Wait for `waitForURL` after link clicks (client navigation).
    Timeline lines read with the tag first ("CHANGEReferred by set to …"). Edge 13 (unknown `ref` on /people and
    /deals/list for Ada: Dora and Ben) checks for the text "Dora Privatefake" only: Pat Privatefake is Ada's own, and US2's
    deals are titled "SF114 Dora deal …". The script is not re-runnable without `reset-db.sh` (names are reused).
  - Files (SF-116). The seed (seeder "files", last) adds, through the fake storage: on "Fakeco website" `site-mockup.png`
    (PNG), `proposal.pdf`, `budget.xlsx` (empty zip, kind other) and the deleted `old-version.pdf` (a "deleted" FILE
    entry); `contract.pdf` on the private deal "Fake secret project"; `cv-fake.pdf` on the private Pat Privatefake;
    `brand-guide.pdf` and `logo.gif` on Fakeco Ltd; `old-brief.docx` on the archived "Old fake opportunity"; `fake.png`
    (text bytes, kind other, no preview) on the first shared person. Selectors: the section is the `region` "Files"
    (heading "// FILES (n)", button "[ ADD FILE ]" opens the hidden `input[type=file]` labelled "Files to add": use
    `setInputFiles` on it), table `table.files-table` (name link `a.nm`, chip `.ft`, links named "Preview <name>",
    "Download <name>", "Delete <name>"); upload progress `.upload-status .uploading`, messages `.upload-status
    .notice` / `.err`; the image box is the `dialog` labelled by the file name (`.filebox img`, links "[ DOWNLOAD ]",
    "[ CLOSE ]"); the confirmation is the `alertdialog` "Delete <name>? This can't be undone." (button "[ DELETE ]", link
    "[ CANCEL ]"); timeline FILE entries have `.kd.file`. A PDF name has `target=_blank`. `/files/<id>/download|preview`
    answer 303 (follow with `maxRedirects: 0` to read the Location); `/files/unavailable?reason=…` shows the message.
    `reset-db.sh` also empties `files`, `file_uploads`, `file_cleanup` (run `npm run db:migrate` first on an older
    crm_dev, else the truncate fails and nothing is seeded); `.fake-storage/` keeps old contents (harmless).
  - Campaigns (SF-119). The seed (seeder "campaigns", last) adds five drafts, each only when no campaign has its name:
    "Exec dinner – March (fake)" (Ada Fake; Text with a button; `{{First name | there}}`, `{{Organisation | your team}}`,
    button https://example.test/dinner), "Welcome note (fake)" (Grace Fake; Blank), "Event recap (fake)" (Linus Fake; Text;
    `{{Diet (fake) | not given}}` with its `merge_links` entry; skipped when the field is missing), "Newsletter – winter
    (fake)" (Margaret Fake; Newsletter, image https://example.test/winter.png) and "Pasted HTML sample (fake)" (Ada Fake;
    HTML with `<script>document.title='Changed (fake)'</script>`, an `onerror` image, a form posting to /campaigns and a
    link to https://example.test/). Selectors: the edit page's subject `#campaign-subject`, the form `#campaign-form` (posted
    by the header "[ SAVE ]" through `form=`), notices `.campaign-notes` ("Draft saved.", "Still empty: …", "Unknown merge
    tags: …"), block cards `.blk` (buttons "↑" / "↓" named "Move <Block> up|down", "[ REMOVE ]"), the layout chooser
    `.chooser`, the HTML box `textarea.html-box`, the merge tag menu buttons "[ INSERT MERGE TAG ]" (fields as `listitem`
    buttons, input "If empty, show"), the picker `.preview-picker input` (results `.picker-list button`), the preview
    `.mail-subject`, `.mail-from` and `iframe.mail-frame` (`frameLocator`). The switch boxes are `alertdialog`s with
    "[ SWITCH ]" / "[ CANCEL ]"; the delete confirmation an `alertdialog` with "[ DELETE FOR GOOD ]". Checking the sandbox in
    a browser (quickstart.md § By hand, step 4): open "Pasted HTML sample (fake)": the console shows "Blocked script
    execution in 'about:srcdoc'…", `page.title()` stays "Barnacle CRM", the frame's links carry `target="_blank"`, its form
    button sends nothing (no request to /campaigns), and the sidebar keeps its colours. Note: `start-app.sh` uses the
    `DATABASE_URL` already set in the shell (crm_test when the test variables are exported).
  - SF-116 AI review scripts (each on fresh data: `bash .factory/run/reset-db.sh` first; helpers in `sf116-lib.js`, which
    makes the test files in `$TMPDIR/sf116-files`): `scenarios-sf116-a.js` (US1, US2), `scenarios-sf116-b.js` (US3; waits
    61 s for a read address to expire; US3-7 moves a file onto Alan Fake's private deal/person by SQL, then hands over to
    Linus in /admin/users), `scenarios-sf116-c.js` (US4, US5, edge cases; needs the two extra apps below). Run with
    `NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf116-X.js`. Extra apps (after the build on :3000):
    `PORT=3001 SKIP_BUILD=1 SKIP_SEED=1 SUPABASE_URL=http://localhost:9 SUPABASE_SECRET_KEY=fake-storage-key bash .factory/run/start-app.sh`
    (Storage unreachable, edge 8) and `MODE=fail-deletes node .factory/run/storage-proxy.js &` then
    `PORT=3002 SKIP_BUILD=1 SKIP_SEED=1 SUPABASE_URL=http://localhost:54321 SUPABASE_SECRET_KEY=fake-storage-key bash .factory/run/start-app.sh`
    (a Storage that fails every delete, edge 9). Known: Next's proxy cuts request bodies at 10 MB (`proxyClientMaxBodySize`), so the
    `src/proxy.ts` matcher leaves out `/dev/fake-storage/` (fix round 1) and 25 MB uploads reach the fake; headless Chromium
    here names every download with a non-ASCII name "download" (read `content-disposition` instead); a file on disk whose
    name has a backslash is dropped by `setInputFiles` (pass `{ name, mimeType, buffer }`). Not re-runnable without a reset.
    `check-edge8-box.js` (with :3001 up, after a seed): `?file=<png>` on the Storage-down app goes back to the page with
    `?error=files_unreachable` and the message, no dialog (fix round 1; `NODE_PATH=/opt/playwright/node_modules node .factory/run/check-edge8-box.js`).
    All 37 SF-116 scenarios pass with a, b, c in a row (reset before each; ~3, ~2 and ~4 min).
  - CSV import scenarios (SF-103): the fake files are in `tests/fixtures/csv/` (people-20.csv: rows 4 and 15 use
    `dup.one@`/`DUP.TWO@fakeco.example`, which a scenario puts
    in the CRM first, row 9 has an invalid address; organisations-10.csv: "FAKECO LTD" matches the seeded Fakeco Ltd, size
    "medium" on row 5; lists-owners-consent.csv: 4 rows without consent, label "Cold" on row 7, owners "Nobody Fake" and
    deactivated alan@ on rows 4–5; people-cp1252.csv, not-csv.xlsx, people-bom.csv, people-quoted.csv,
    people-semicolon/tab.csv). The 5,000/5,001-row and 5 MB files are generated by the tests and scripts. Selectors: the step bar is
    the `list` "Steps" (current step `aria-current="step"`, done steps end " ✓"); the file input is labelled "CSV file"
    ("Choose another file" after [ BACK ]); column selects are labelled "Field for <heading>" (values `role`, `skip`,
    `email:work`…); preview/report regions "Rows not imported", "Warnings", "First people"; consent radios "Subscribed" /
    "Unsubscribed" (`exact: true`). Seeded labels are Hot, Investor, Partner, so "Cold" is not on the list.
    `reset-db.sh` also empties `csv_imports` (SF-117: and `pipedrive_links`, `pipedrive_imports`, `pipedrive_connections`).
  - SF-103 AI-review scenario script `scenarios-sf103.js` (all 40 US1–US3 scenarios and edge cases 1–24, ~4 min, against
    :3000/crm_dev on fresh fake data; it makes its own CSV files in memory, adds "Ada Example" and the private "Hidden Privfake"
    (Linus) by SQL, a removed lead source/label by SQL; Edge 22 makes the import fail part-way with a temporary trigger on
    `timeline_events` (dropped after); Edge 24 replays the [ IMPORT ] form post without cookies):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf103.js` (pass scenario
    name prefixes, e.g. `"Edge case 7"`, to run only those; US1 3–5 need US1 2 first). Notes: the heading
    "Source" is suggested as Lead source, so a later "Lead source" column is suggested "Don't import"; the report lists only rows
    not imported (an imported row's values appear on the preview and the person's page); wait ~1 s after the columns URL before
    using the selects (the client navigation re-renders once).
  - Deal list and deal page scenarios (SF-95). Selectors: the deal page's stage bar is the `list` named "Stages" (current stage `aria-current="step"`, other stages of
    an open deal are buttons "Move to <stage>"), the strip is `dl.strip`, the Lost box is the `dialog` named "Why was this
    deal lost?", other people are the `list` named "Other people" (buttons "Unlink <name>"), the deal labels admin list is
    the `region` "Deal labels" (input "New deal label"). The deal list's count line is `.head-r .count`; its title links are
    `td:first-child a.nm` (each row also has a hidden "Preview <title>" link: use `exact: true`). Saving a deal with no
    organisation and a main person fills the person's organisation (SF-93 FR-006): an "Edited: Organisation, …" line.
  - SF-95 AI-review scenario script `scenarios-sf95.js` (all 42 US1–US5 scenarios and edge cases 1–14 as renumbered by SF-95 fix round 1 — edge 11 is the unknown owner/label address, edge 12 the empty list, ~3 min, against
    :3000/crm_dev on fresh fake data; makes its own "SF95 …" deals by SQL with back-dated stage periods, adds 60 "SF95 Bulk"
    deals of Linus for paging; ends with Edge case 12, which deletes every deal):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf95.js`.
    Notes: Robin Leftfake is private (owned by Alan), so the script uses a public person as main person; the filter row's
    AutoSubmit posts every field (`pipeline=` empty), so wait for `/pipeline=\d/`; a "NOTE" line prints what the list does
    with unknown owner/label/pipeline ids (FR-013). Same-pipeline moves read "Moved from Proposal to Negotiation by …". US5-3 gives its deal the main person's organisation first, else saving also fills it ("Edited by …: Organisation, Labels").
    Archived-deal expectations (US4-1, Edge 13) are filtered by `visibleWhere` for Ada: since the SF-97 merge the seed has
    Alan's private archived "Fake leaver old deal", which Ada must not see. Edge 13 adds its own archived lost deal ("SF95
    Archived lost") because US4-4 restores the seeded one.
  - Timeline and notes scenarios (SF-102). Selectors: the timeline is the `region` "Timeline" (entries are its `listitem`s, `.kd` the tag, `.notebody` the
    note text, `.on-deal` the deal title of a DEAL entry, `.day` the day headings); the note box is the `form` "Add a
    note" (textbox "Note", buttons "[ ADD NOTE ]" / "[ CANCEL ]"), the edit box the `form` "Edit note" ("[ SAVE ]", link
    "[ CANCEL ]"); a note's links are named "Edit note" / "Delete note" (they read `[ EDIT ]` / `[ DELETE ]`), the delete
    confirmation is the `alertdialog` "Confirm note delete"; the @ picker is a `listbox` "Teammates" with `option`s
    (type with `pressSequentially`, it follows the caret); mentions are `mark.mention`. The sidebar link's accessible
    name is "Notifications (n)" from 1, else "Notifications"; the Notifications page is the `list` "Notifications", each
    row a button. Delete `note_mentions` first when a scenario needs a user at zero notifications (the seed gives Linus 1).
  - SF-102 AI-review scenario script `scenarios-sf102.js` (all 45 US1–US4 scenarios and edge cases 1–18, ~4 min, against
    :3000/crm_dev on fresh fake data; makes its own "SF102 …" records by SQL, so reset before every run — names are unique):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf102.js`
    (`ONLY="US1 scenario 6,Edge case 4"` runs a subset; US2-2/3/4 and Edge 13 share one setup, Edge 12 reads US2-5's result).
    Notes: the seed's users are Ada/Grace (admins), Linus/Margaret, deactivated Alan — the spec's "Bob"/"Cy" map to
    Linus/Margaret. The @ picker needs a space before "@" (`(?:^|\s)@`). The browser posts line breaks as CRLF; since fix round 1 they are stored as LF (older rows may still hold CRLF:
    compare `textContent` with `\r\n`→`\n`). US1-6's direct delete on a hidden/deleted record lands on the kind's list
    (`/deals`…) with the one-shot notice; on a visible record, its page with `?error=note_not_found`. Edge 17 types
    exactly 10,000 characters with 99 line breaks; Edge 18 picks "@Linus Fake" then types "@Linus Fakeson". Direct requests are made by rewriting the edit/delete
    forms' hidden `noteId`/`target`/`targetId` (or adding a hidden `mention` input) in the page before submitting.
    Archive/restore, making a deal private/shared, changing a deal's organisation and deactivation are done by SQL.
  - Activities (SF-109). Selectors for the AI review: "// NEXT ACTIVITIES" is the `region` "Next
    activities" (rows `li.arow`, links "Edit <subject>" / "Delete <subject>"), done boxes are buttons "Mark done" / "Mark not
    done"; the activity box is the `dialog` "Schedule activity" / "Edit activity" / "Schedule a follow-up?" (fields labelled
    Subject, Date, Time, Duration, Assigned to; type radios Call/Meeting/Task; pickers are comboboxes "Deal", "Person",
    "Organisation"; buttons "[ SAVE ]", links "[ CANCEL ]" / "[ NOT NOW ]"); the delete confirmation is the `alertdialog`
    "Delete this activity? This can't be undone."; the list's quick filters are links in the `navigation` "Show" (current
    one `aria-current="page"`), selects "Assignee" and "Type"; overdue rows `tr.over`, marks `.od` / `.td`; card lines
    `.card .warnline` / `.card .nextline`. A quick way to sign in from a script: insert a `sessions` row whose
    `token_hash` is the SHA-256 of a token and send it as the `crm_session` cookie.
  - SF-109 AI-review scenario script `scenarios-sf109.js` (all 44 US1–US6 scenarios and edge cases 1–14, ~6 min, against
    :3000/crm_dev on fresh fake data; makes its own "SF109 …" records and activities by SQL, signs in through a `sessions`
    row; it needs the repo's `postgres` package on NODE_PATH):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules:$PWD/node_modules node .factory/run/scenarios-sf109.js`
    (`ONLY="US6 scenario 1,Edge case 4"` runs a subset). Notes: the sidebar link's text is "Notifications" + the count in its
    own element (read the digits, not "(n)"); the hand-over panel opens at `/admin/users?handover=5`; record deletes use
    `?confirm=delete` then `button.danger-solid`; uppercase CSS: compare `innerText` case-insensitively. Start the app ONCE:
    two `start-app.sh` running at the same time rebuild `.next` under the running server and every server action then
    fails with "Failed to find Server Action" (stop the server by pid, run `start-app.sh` again).
  - SF-108 AI-review scenario script `scenarios-sf108.js` (US1 1–5, US2 1–3, US3 1, edge cases 1–6; ~1 min, :3000/crm_dev):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf108.js`
    (`ONLY="US1 scenario 5"` for a subset). Bob = Linus Fake; each scenario first empties `note_mentions`; US1-1's mention
    is typed by Ada in her own browser context, the others are inserted by SQL. The count is read from the sidebar link's
    accessible name and `.cnt`, waiting up to 5 s: since SF-108 the page shows first with the old count and `UnreadLink`
    updates it after its `currentUnread` POST, so the notes print the first and the final value. A `window.__noReload`
    marker proves no full reload. Read `.cnt` with `allTextContents()` (the link remounts on each layout render).
  - Pipelines, deals and the board scenarios (SF-93): real drag with `locator.dragTo`, a failed drag by aborting the
    server action POST with `page.route`. Board
    selectors: each column is a `region` named after its stage (`h2` name, `.tot` "<n> deals · £total"), cards are
    `a.card`, the drawer is the `complementary` named "Deal" with a "Timeline" region (SF-102; "History" before); the admin pages' rows are
    `table.order` with buttons named "Rename <name>", "Move <name> up/down" and links "Delete <name>". Non-admin
    pages answer "You don't have access to this page." with HTTP 200 (as the other admin pages).
  - SF-93 AI-review scenario script `scenarios-sf93.js` (all 33 US1–US6 scenarios and edge cases 1–16, 49 checks,
    ~4 min, against :3000/crm_dev, run in order on fresh fake data; it ends by emptying pipelines/deals for US1-5):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf93.js`.
    Notes: sign in with the user's real name (`signIn(page, base, email, "Linus Fake")`): an empty name renames the
    fake user. Use a wide viewport (1900px): with a sideways-scrolled board `dragTo` can grab a card of another column.
    Next's route announcer is also `role="alert"`: the board's messages are `p.err[role=alert]`. Leak checks read
    `innerText` (the page's `<script>` payload holds the address). Deactivation is done by SQL (`users.status`).
  - People and organisations scenarios (SF-90, SF-92: owner sees a private person, "A deleted person was linked by …",
    the Users page hand-over panel: `form.handover`, select "Hand over to"; SF-97 adds the private
    deals: Alan's row reads "2 private people · 2 private deals");
    a "direct request" check replays a server action form post (`$ACTION_ID_…` field from the server-rendered
    page) as a non-admin.
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
  - SF-97 scenario script `scenarios-sf97.js` (US1 1–6, US2 1–3, edge cases 1–13, 27 checks, ~2 min, :3000/crm_dev): it
    resets the data itself (five phases, `reset-db.sh` between them), so just run
    `NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf97.js`. Notes: the `deals` column is
    `expected_close_on`; the deal drawer has no creator field (creator shows as "Added by <name>" in // HISTORY, without
    "(deactivated)"; the seeded deals' `added` event has no actor); an empty drawer field shows "—"; reload the panel page
    before reading its `$ACTION_ID_` input for a direct post.
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
    login), then `npm test`, `npm run typecheck`.
  - Stop servers by pid (`ss -ltnp | grep next-server`), not `pkill -f next…`: that also kills the calling shell.
  - SF-115 (custom fields) AI-review scripts, against :3000/crm_dev, each on fresh fake data
    (`bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/<script>`); helpers in
    `sf115-lib.js` (`q` runs SQL on `$DB`, `addField`, `more` = text of a page's // MORE DETAILS; record pages are
    uppercase in `innerText`, so match names case-insensitively; the delete box is `role="alertdialog"`, the add/edit box
    `role="dialog"`). The seed's person fields are ids 1–5 (Diet single choice with removed "Pescatarian", Birthday date,
    Newsletter topics multiple, Head count number, Notes long text), organisation 6–7, deal 8–9 (Contract end, Signed NDA).
    Persons 36 (Cara), 38–42 are visible to Ada; 37 (Dora) is private to Linus; 31 (Fay Mockup) archived; 35 (Sam) Alan's.
    Edge numbers follow the spec after fix round 1 (Edge 7 is the "empty" text filter; the old 7–12 are now 8–13).
    - `scenarios-sf115-us1.js`: US1 1–8, edges 1, 2, 4, 10 (admin page, non-admin action replay).
    - `scenarios-sf115-us2.js`: US2 1–7, edges 3, 5, 8, 9, 11, 12 (forms, pages, drawer, timeline, archived, hand-over).
    - `scenarios-sf115-us3-4-6.js`: US3 1–5, US4 1–5, US6 1–3, edges 6, 13 (lists as Grace, delete box, privacy).
    - `scenarios-sf115-edge7.js`: edge 7 (`cf<id>=empty` on a Text / Long text filter is text; "Empty" only on Single choice / Yes/No).
    - `scenarios-sf115-us5.js`: US5 1–5 (CSV import; preview needs the consent radio "Subscribed"). Import warnings list rows
      as "(rows 3, 4)"; a Text cell over 255 shows the row reason "Keep the <field> under 255 characters.".

  - SF-119 AI-review scenario scripts (all 41, :3000/crm_dev on fresh fake data, ~6 min together; helpers `sf119-lib.js`:
    `newCampaign`, `save` (waits for [ SAVE ] to be enabled again, not for networkidle: a server-action POST can stay open),
    `frameText`/`frameHtml` of `iframe.mail-frame`, `choosePerson`, `pickerNames`, `chooseLayout`, `camp(id)` row):
    `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf119-a.js` (US1 1–5,
    US5-7, US6 1–3, edge cases 1, 9–12) then `node .factory/run/scenarios-sf119-b.js` (US2–US5, edge cases 2–8; `ONLY="US4
    scenario 2,…"` for a subset; it first removes the "SF119 …" people, fields and drafts of an earlier run). Notes: column
    headers, block labels and the merge tag list are upper-cased by CSS (compare case-insensitively); an image block saves only
    with an `https://` address (a `data:` image is refused), so the scripts use https://example.test/… there (not loaded
    offline) and a `data:` PNG only in pasted HTML. Fix round 1 scenarios: Edge case 13 (rename then delete, no save in
    between) is in `scenarios-sf119-b.js` (run with US2 4/5); it deletes the field through the admin page
    (`/admin/custom-fields?kind=people&delete=<id>`, the `alertdialog`'s submit button), never by SQL: `deleteField` writes the
    `last` name onto `campaigns.merge_links`, which a SQL delete skips. Edge case 14 (Reply-to "not-an-email" through the normal
    form shows the app's message: `#campaign-form` has `noValidate`) is checked inside US1 scenario 4 of `scenarios-sf119-a.js`.
    All 43 SF-119 scenarios pass (a then b after one reset; re-run after the merge with main that renumbered the migration
    to 0014: still all pass, schemas by `npm run -s test:schemas`, app by `start-app.sh`; re-run again with the
    migration at 0015 after the SF-120 merge: all 43 pass, ~7 min).

  - SF-121 (AI review): `node .factory/run/scenarios-sf121.js [prefix…]` (NODE_PATH=/opt/playwright/node_modules) on a
    fresh seed (app on :3000 from start-app.sh) runs every unsubscribe scenario: tokens and consents read with psql, the
    one-click POSTs sent by `fetch` with no cookie, a temporary person deleted through the app (`?confirm=delete`), and
    Edge 8 stops Postgres (`pg_ctl -D /tmp/pgdata -m fast stop`) then starts it again. Page checks use the visible text and
    the DOM without `<script>`: Next.js's router payload always carries the address (never shown). Edge 10 and the https
    part of US5 1: a second `npx next start -p 3002` with `APP_ENV=` (production) and `APP_URL=https://crm.example.com`
    (`node .factory/run/check-sf121-edge10.js`: 404 "Page not found."), and one on :3003 with `APP_ENV=test` and the same
    APP_URL to see https links on /dev/unsubscribe-links. ~1 min.
## Smoke checks
1. npm run -s test:schemas >/dev/null && test -s .factory/schemas/oauth2-api.json && test -s .factory/schemas/storage_v0_openapi.json && test -s .factory/schemas/pipedrive_v2_openapi.json && test -s .factory/schemas/pipedrive_v1_openapi.yml
2. /usr/lib/postgresql/17/bin/pg_isready -h localhost -p 5432
3. curl -fs -o /dev/null http://localhost:3000/sign-in
