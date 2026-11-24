---

description: "Task list for SF-117 part a — Pipedrive import: connection, people and organisations"
---

# Tasks: Pipedrive import — connection, people and organisations

**Input**: Design documents from `/specs/sf-117-step-11a-pipedrive-import-connection-peo/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/pipedrive-api.md, contracts/routes.md,
quickstart.md

**Tests**: The repo (AGENTS.md § Tests) and the spec (SC-002 to SC-008) ask for tests. They are Vitest unit tests,
and Vitest integration tests against a real local Postgres (`crm_test`) with the fake Pipedrive. There are no browser
tests (docs/DECISIONS.md, 2026-11-23): never start the app in a browser. Each test file names what it covers
(`// covers FR-013, US2 scenario 9`). Write each story's tests first and see them fail before writing the code.

**Organization**:
- Tasks are grouped by user story.
- Where the details live:
  - Message texts: contracts/routes.md § Messages. Use them verbatim, from `src/server/messages.ts` only.
  - The migration, states, counts and report: data-model.md.
  - Pages, actions and domain functions: contracts/routes.md.
  - The six Pipedrive calls, settings, the fake and the schemas: contracts/pipedrive-api.md.
  - Decisions: research.md (§n below).
- Dependencies: exactly one new one, the devDependency `yaml@2.9.1` (dependencies.json). Add no other package, and in
  particular no `pipedrive` client.
- Blueprints: none apply (`blueprints.json` is `[]` and there is no blueprint index in this run). So there are no
  blueprint tasks and no "Departs from blueprint" line.
- Spec choices: the four factory choices in spec.md § Clarifications ("decided by the factory, to confirm") are built
  as written there.
- Outside services:
  - Pipedrive API v1 (schema): T012, the first test task of US1.
  - Pipedrive API v2 (schema): T024, the first test task of US2.
  - Supabase Postgres (no schema): T013.
  - The test recipe is T052, the last task.
- Fake CRM users: Ada Fake (admin), Linus Fake and Margaret Fake (users), and Alan Fake (deactivated). The fake
  Pipedrive owners are "Fake Person" (the token's user, email `linus@barnacle.ai` in tests so it matches Linus),
  "Margaret Pipedrive Fake" (`margaret@barnacle.ai`) and "Jane Fake" (`jane@fake.example`, no CRM user).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US3)

---

## Phase 1: Setup

**Purpose**: the dependency, the schemas download, the settings and the migration.

- [X] T001 Run `npm install --save-dev --save-exact yaml@2.9.1`, which updates `package.json` (devDependencies) and
  `package-lock.json`. Add nothing else.
- [X] T002 Add the two Pipedrive schemas to `scripts/fetch-schemas.mjs`.
  - Append two entries to `SCHEMAS`:
    - `{ file: "pipedrive_v2_openapi.json", url: "https://raw.githubusercontent.com/soenneker/soenneker.pipedrive.openapiclient/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json", sha256: "0974486d220a6462ea2e7f03acc440f5e6cba215ec875551544c83de685807c2" }`
    - `{ file: "pipedrive_v1_openapi.yml", url: "https://raw.githubusercontent.com/Zenika/zenpipe/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml", sha256: "9d309b9bf5f520b5f4d5ca95baad2660cd8705404b8940b20ab9d6bbba662e01" }`
  - Update the head comment to name the Pipedrive schemas (they are used by `tests/fakes/pipedrive.ts`).
- [X] T003 [P] Extend `tests/unit/fetch-schemas.test.ts` (`// SF-117: and the two Pipedrive schemas`).
  - The fresh copy downloads `pipedrive_v2_openapi.json`, and its `paths` contain `/persons`, `/organizations`,
    `/personFields` and `/organizationFields`.
  - It downloads `pipedrive_v1_openapi.yml`, parsed with `import { parse } from "yaml"`, and its `paths` contain
    `/users/me` and `/users`.
- [X] T004 Write `migrations/0012_pipedrive.sql` exactly as data-model.md § Migration.
  - **`pipedrive_connections`**:
    - `user_id bigint primary key references users (id)`
    - `token bytea not null check (octet_length(token) between 30 and 1024)`
    - `pipedrive_user_id bigint not null`
    - `pipedrive_user_name text not null check (char_length(pipedrive_user_name) <= 255)`
    - `company_id bigint not null`
    - `company_name text not null check (char_length(company_name) <= 255)`
    - `saved_at timestamptz not null default now()`
  - **`pipedrive_imports`**:
    - every column of data-model.md, with `state … check (state in ('running', 'waiting', 'paused', 'stopped', 'finished'))`
    - `pause_reason … check (pause_reason in ('unreachable', 'token_refused', 'other_company'))`
    - `stop_reason … check (stop_reason in ('by_user'))`
    - `step … check (step in ('prepare', 'count_organisations', 'count_people', 'organisations', 'people', 'done'))`
    - `consent … check (consent in ('subscribed', 'unsubscribed'))`
    - the six table checks, from `(want_people or want_organisations)` to `((state = 'stopped') = (stop_reason is not null))`
    - `create unique index pipedrive_imports_one_open on pipedrive_imports (user_id) where state in ('running', 'waiting', 'paused')`
    - `pipedrive_imports_user_idx`
  - **`pipedrive_links`**:
    - `primary key (company_id, kind, pipedrive_id)`
    - `kind … check (kind in ('person', 'organisation'))`
    - `how … check (how in ('imported', 'linked'))`
    - `person_id` / `organisation_id` `references … on delete set null`
    - `import_id … references pipedrive_imports (id) on delete set null`
    - the two kind checks and the two partial indexes
  - **`alter table … enable row level security`** after each `create table`, with no policies.
  - **`timeline_events_kind_check`**: replace it, keeping every kind of `0011_files.sql` and adding
    `'pipedrive_imported', 'pipedrive_unsubscribed'`. Above it, add a comment pointing to the SF-115 rule (each
    migration's kind list keeps every kind present).
  - No `begin`/`commit`/`concurrently`. If `0012` is already taken when merging, renumber.
- [X] T005 [P] Add `pipedrive_links, pipedrive_imports, pipedrive_connections` to the `truncate` of
  `tests/support/reset.ts`, and to `.factory/run/reset-db.sh` if it lists tables.
- [X] T006 [P] Add `pipedriveConfig()` to `src/server/env.ts` (contracts/pipedrive-api.md § Settings).
  - It returns `{ mode: "real" | "fake"; baseUrl: string; key: Buffer | null }`:
    - `PIPEDRIVE_URL` trimmed, without a trailing slash;
    - empty and `isFakeAllowed()` → `mode: "fake"`, `baseUrl: "https://fake.pipedrive.invalid"`;
    - empty otherwise → `mode: "real"`, `baseUrl: "https://api.pipedrive.com"`;
    - set → `mode: "real"` with that base URL.
  - `key` is `Buffer.from(PIPEDRIVE_TOKEN_KEY, "base64")` when it decodes to exactly 32 bytes, else `null`.
  - Read at call time.
  - Extend `tests/unit/env.test.ts`: fake versus real, a key of 31 bytes or not base64 → `null`, and fake refused when
    `VERCEL_ENV=production`.
- [X] T007 [P] Add every message and template of contracts/routes.md § Messages to `src/server/messages.ts` under an
  `// SF-117` comment, with the Pipedrive type words as a fixed map `PIPEDRIVE_TYPE_WORDS`. Extend
  `tests/unit/messages.test.ts`: every new code has text, and the templates quote values with `'…'` exactly as listed.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: token sealing, the Pipedrive calls and the in-process fake. Every story needs them.

- [X] T008 Create `src/server/pipedrive/crypto.ts` (research.md §3).
  - `sealToken(key: Buffer, userId: number, token: string): Buffer` returns `[0x01] ‖ iv(12, randomBytes) ‖
    tag(16) ‖ ciphertext`, with `aes-256-gcm` and `setAAD(Buffer.from(`pipedrive-token:${userId}`))`.
  - `openToken(key, userId, sealed): string` throws `TokenUnreadable` on a wrong version, key, user or byte.
  - No logging.
- [X] T009 Create `src/server/pipedrive/api.ts` (contracts/pipedrive-api.md § Calls).
  - The six functions: `whoAmI`, `listUsers`, `listFields`, `listOrganizations`, `listPersons`, all typed answers.
  - Every call is a `GET` with headers `x-api-token` and `accept: application/json` and
    `signal: AbortSignal.timeout(10_000)`. The token never goes in the URL.
  - Errors `PipedriveRefused` (401/403), `PipedriveSlowDown(seconds)` (429), `PipedriveBadRequest` (400) and
    `PipedriveUnreachable` (everything else, network, timeout). They carry no URL, header or body.
  - Export `retrySeconds(headers)`: `Retry-After` seconds, else `x-ratelimit-reset`, else 10, clamped to 1–300.
  - Export `usePipedriveFetchForTests(fn | null)`, which throws unless `APP_ENV === "test"`. Otherwise, in fake mode
    the calls go to `fakePipedrive().fetch`, and in real mode to global `fetch`.
- [X] T010 Create `src/server/pipedrive/fake-pipedrive.ts` (contracts/pipedrive-api.md § The fake).
  - `class FakePipedrive` with `fetch(url, init)` serving `/v1/users/me`, `/v1/users`, `/api/v2/personFields`,
    `/api/v2/organizationFields`, `/api/v2/organizations` and `/api/v2/persons` in the v1/v2 shapes. The v2 answers
    are `{ success: true, data: [...], additional_data: { next_cursor } }`.
  - Builders: `addCompany`, `addUser`, `addField`, `addOrganization`, `addPerson`, `deletePerson`,
    `deleteOrganization`, `refuseToken`.
  - Switches: `slowDownEvery(n, seconds)` (429 + `Retry-After`), `failNext("network" | 500)`, `noMarketingApp()`
    (400 on `include_fields=marketing_status`), and `requests` (method, path, query; never the token).
  - Paging: cursor = base64 of the last id, ids ascending, `limit` > 500 → 400, `ids` filter. An unknown token → 401.
  - `fakePipedrive()`: the development instance built on first use, with the deterministic data of contracts §
    The fake:
    - token `fake-pipedrive-token` → Fake Person / Fakeco Pipedrive (1001), 60 organisations and 300 people
      covering every spec case;
    - token `fake-pipedrive-other` → Otherco Pipedrive (1002).
    - Only `@fake.example` addresses and "… Fake" names, except the owners matching the seeded CRM users.
- [X] T011 Add `tests/fakes/pipedrive-schema.ts`, the schema loaders.
  - `loadPipedriveV2()` reads `.factory/schemas/pipedrive_v2_openapi.json`. `loadPipedriveV1()` parses
    `.factory/schemas/pipedrive_v1_openapi.yml` with `yaml`.
  - A missing or empty file throws: `run "npm run test:schemas"`. Never a skip.
  - Shared helpers: find an operation for a method and path (strip `/api/v2` or `/v1`; match `{id}` templates), list
    declared query parameters (with `enum` and `maximum`), and collect the declared properties of the `200` answer's
    `data` (array items or object), following `allOf`.

---

## Phase 3: User Story 1 - Connect a Pipedrive account (Priority: P1) 🎯 MVP

**Goal**: a user saves, replaces and removes their own token on a new Settings page. It is checked with Pipedrive and
never shown.

**Independent Test**: with the fake, save an accepted token → "Connected to Pipedrive as Fake Person (Fakeco
Pipedrive)." and no part of the token in the page. A refused token → the message, and nothing saved. Remove → back to
the empty field.

### Tests for User Story 1 ⚠️

- [X] T012 [US1] Download `pipedrive_v1_openapi.yml` from https://github.com/Zenika/zenpipe/blob/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml at commit `1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4` into `.factory/schemas/` (`git init -q /tmp/zenpipe && git -C /tmp/zenpipe fetch -q --depth 1 https://github.com/Zenika/zenpipe 1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4 && git -C /tmp/zenpipe show FETCH_HEAD:pipedrive-api/src/main/resources/openapi.yml > .factory/schemas/pipedrive_v1_openapi.yml`), and make the fake of Pipedrive API v1 refuse a request that the schema refuses: a test sends a wrong field and must fail.
  - **The test fake**: `tests/fakes/pipedrive.ts` exports `installFakePipedrive(): FakePipedrive`. It builds a fresh
    `FakePipedrive`, installs a checking wrapper with `usePipedriveFetchForTests`, and uninstalls in `afterEach`.
  - **What it checks for `/v1/*`**, against `pipedrive_v1_openapi.yml` (T011):
    - the path and method exist;
    - every query parameter is declared;
    - every property of the `data` of a `200` answer (`/users/me`: an object; `/users`: array items) is declared;
    - an `x-api-token` header is present. The v1 file names the `api_token` query parameter; the app deliberately
      uses the header (research.md §9), so a request with `api_token` in the query must throw too.
  - **`tests/unit/pipedrive-fake.test.ts`** (`// covers FR-030; SF-117 outside service Pipedrive v1`):
    - `whoAmI` through the installed fake passes;
    - a request to `/v1/users/me?api_token=x`, or with an undeclared parameter `?foo=1`, throws;
    - a fake answer with an extra `data.not_a_field` property throws (use a test hook that adds a property);
    - with the schema file renamed away, loading throws.
- [X] T013 [P] [US1] Supabase Postgres has no public schema on GitHub. The tests use a real local PostgreSQL 17, and
  the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres
  (transaction-mode pooler). It copies these limits: no prepared statements (`prepare: false`, unchanged), no session
  state (no `set`, `listen` or session advisory lock), every multi-statement change in one `sql.begin()`, at most 5
  connections, and no network call inside a transaction. Extend `tests/integration/migrate.test.ts`:
  - scan `src/server/pipedrive/*.ts` for `set `/`listen`/`pg_advisory_lock` and fail on any;
  - check that `migrations/0012_pipedrive.sql` has no `begin`/`commit`/`concurrently`;
  - apply 0012 on a fresh database;
  - check Postgres's own 23514/23505 refusals:
    - a second open import for one user;
    - `state = 'paused'` without `pause_reason`;
    - `want_people` without `consent`;
    - neither kind ticked;
    - a link of kind `person` with an `organisation_id`;
    - `how = 'copied'`;
    - a 256-character `company_name`;
  - check that the kind check still accepts `'file_added'`, `'custom_set'` and `'imported'`, and accepts the two new
    kinds.
  - Extend `tests/integration/rls.test.ts` with the three tables.
- [X] T014 [P] [US1] `tests/unit/pipedrive-crypto.test.ts` (`// covers FR-003, SC-007`):
  - the round trip works;
  - another user id, another key, a flipped byte or version 2 → throws;
  - the sealed bytes contain neither the token nor its base64;
  - two seals of one token differ (random IV).
- [X] T015 [P] [US1] `tests/unit/pipedrive-api.test.ts` (`// covers FR-002, FR-022`), against the installed fake:
  - `whoAmI` maps `id`, `name`, `company_id` and `company_name`;
  - 401 → `PipedriveRefused`; 500, a network error, or a timeout (fake hook that never answers, fake timers) →
    `PipedriveUnreachable`;
  - `retrySeconds`: `Retry-After: 8` → 8, only `x-ratelimit-reset: 3` → 3, none → 10, 9999 → 300, 0 → 1;
  - no recorded request URL contains the token.
- [X] T016 [US1] `tests/integration/pipedrive-connection.test.ts` (`// covers US1 scenarios 1–6, FR-001–FR-003,
  FR-027, SC-007, edge cases on the token, deactivation and no key`):
  - **Saving**:
    - an accepted token saves the user name, company and date;
    - `"  token  "` is trimmed before the check;
    - empty → `pipedrive_token_required`;
    - 201 characters → `pipedrive_token_refused` with no request to the fake;
    - refused or unreachable → the error, with an earlier token kept unchanged (the same bytes);
  - **Removal and deactivation**:
    - removal deletes the row;
    - `deactivate()` deletes the row;
  - **Two users**: each sees only their own connection;
  - **No key**: `PIPEDRIVE_TOKEN_KEY` empty → `getConnection` reports not set up, and `saveToken` refuses with
    `pipedrive_not_set_up`;
  - **Rendered page**: render `/settings` (call the page component and serialise with `renderToString`). The token
    and any 6-character slice of it are absent, and "Connected to Pipedrive as Fake Person (Fakeco Pipedrive)." is
    present.

### Implementation for User Story 1

- [X] T017 [US1] Create `src/server/pipedrive/connection.ts`:
  - `getConnection(userId)` returns `{ ready: false } | { ready: true, connection: null | { userName, companyName,
    companyId, savedAt } }` and never selects `token` for callers.
  - `saveToken(userId, raw)` follows research.md §4. Nothing is written before `whoAmI` succeeds, then it upserts.
  - `removeToken(userId)`.
  - `tokenFor(userId)`, for `imports.ts` only, returns the opened token and company, or null.
  - `deleteConnection(db, userId)`.
- [X] T018 [US1] In `src/server/users.ts` `deactivate()`, call `deleteConnection(db, userId)` inside its transaction.
  Extend `tests/integration/users.test.ts` with one case.
- [X] T019 [P] [US1] In `src/app/(app)/nav.ts`, add `export const footerNav: NavItem[] = [{ href: "/settings", label:
  "Settings" }]`, and render it in `src/app/(app)/layout.tsx` at the bottom, above `[ SIGN OUT ]` (with
  `SidebarLink`). Extend `tests/unit/nav.test.ts`.
- [X] T020 [US1] Create `src/app/(app)/settings/page.tsx`, `PipedriveSection.tsx` and `RemoveTokenConfirm.tsx`
  (contracts/routes.md § Pages, design B of `design-options.html`).
  - "// YOU", "Settings", "// PIPEDRIVE".
  - The not-set-up line.
  - The form: `type="password"`, `name="token"`, `autoComplete="off"`, never a value.
  - The connected lines with the date (`formatDay` style "24 Nov 2026"), `[ REPLACE TOKEN ]` (`?replace=1`),
    `[ REMOVE TOKEN ]` (`?remove-token=1` box), and `[ IMPORT FROM PIPEDRIVE ]` (link to `/settings/pipedrive-import`).
  - Notices from `?error=` (looked up in a fixed list of codes only), `?saved=1` and `?removed=1`.
- [X] T021 [US1] Create `src/app/(app)/settings/actions.ts`: `saveTokenAction` and `removeTokenAction`, with
  `requireUser()` first and redirects only to `/settings?...`.
- [X] T022 [US1] Add a small Settings section to `README.md`: the `/settings` row in the pages table, and the
  `PIPEDRIVE_TOKEN_KEY` / `PIPEDRIVE_URL` rows in the Settings table. Add both, empty and commented, to
  `.env.example`: the key is a secret, generated with `openssl rand -base64 32`; an empty URL means the fake in
  development and test.

**Checkpoint**: US1 tests pass. Settings works with the fake.

---

## Phase 4: User Story 2 - Import people and organisations with all their fields (Priority: P1)

**Goal**: one complete import of a small account brings every value in, links matches, and ends with a report.

**Independent Test**: the spec's 30-people / 10-organisations data set, imported start to finish: every value,
link and report line checked (SC-008).

### Tests for User Story 2 ⚠️

- [X] T023 [P] [US2] Add `tests/integration/pipedrive-helpers.ts`. It holds:
  - `connect(userId, fake)`, which saves `test-token-<n>` through `saveToken`;
  - `runToEnd(userId, max = 500)`, which calls `runPart` until `next` is `stop` and fast-forwards `wait_until` in the
    database instead of sleeping;
  - `smallAccount(fake)`, the spec's 30/10 data set: several emails and phones, labels "Hot" (on the CRM list) and
    "Cold" (not), "Job title", "Lead source" "Webinar" (not on the list) and "Referral", "LinkedIn", custom "Budget"
    (double; the CRM has "Budget" number) and "Favourite colour" (varchar, no CRM field), "Region" (address), one
    unsubscribed person, one `visible_to: 1` person owned by Margaret, one owned by Jane Fake (no CRM user), one email
    already in the CRM, one organisation name already in the CRM (archived), and one duplicate email between two
    Pipedrive people.
- [X] T024 [US2] Download `pipedrive_v2_openapi.json` from https://github.com/soenneker/soenneker.pipedrive.openapiclient/blob/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json at commit `77695f9076c899e2ba1e7e8eb029aabb28abed27` into `.factory/schemas/` (`git init -q /tmp/soenneker.pipedrive.openapiclient && git -C /tmp/soenneker.pipedrive.openapiclient fetch -q --depth 1 https://github.com/soenneker/soenneker.pipedrive.openapiclient 77695f9076c899e2ba1e7e8eb029aabb28abed27 && git -C /tmp/soenneker.pipedrive.openapiclient show FETCH_HEAD:openapi.json > .factory/schemas/pipedrive_v2_openapi.json`), and make the fake of Pipedrive API v2 refuse a request that the schema refuses: a test sends a wrong field and must fail.
  - **What `tests/fakes/pipedrive.ts` checks for `/api/v2/*`**, against `pipedrive_v2_openapi.json` (T011):
    - the path and method exist;
    - every query parameter is declared;
    - an `enum` value is in its enum (`sort_by`, `sort_direction`, each item of `include_fields`);
    - `limit` ≤ the declared `maximum` (500);
    - every property of a `200` answer's `data[]` items and of `additional_data` is declared;
    - the `x-api-token` header is present (the v2 `api_key` scheme).
  - **Extend `tests/unit/pipedrive-fake.test.ts`** (`// SF-117 outside service Pipedrive v2`):
    - `listPersons` / `listOrganizations` / `listFields` pass;
    - `include_fields=marketing_statuses`, `sort_by=name`, `limit=501` or an undeclared `?org=1` throws;
    - a fake person with an extra `email` property (instead of `emails`) throws.
- [X] T025 [P] [US2] `tests/unit/pipedrive-rules.test.ts` (`// covers FR-007–FR-011, FR-013–FR-016, US2 scenarios
  2, 3, 5–12, edge cases on values`):
  - **Names**: first/last kept; only `name` "Ada May Example" → "Ada" / "May Example"; empty → `pipedrive_no_name`.
  - **Emails and phones**: in order with the primary first; work → work, home/mobile → personal, other → other; an
    invalid value left out with a warning.
  - **Built-in field keys**: "Job Title", "role", "Lead-source", "Source", "LinkedIn URL" and "linkedin profile" are
    recognised and never listed as unmatched custom fields.
  - **Too long**: a role of 201 characters → left out, `pipedrive_value_too_long`.
  - **Consent**: `consentOf`: unsubscribed / subscribed / no_consent / archived / absent with the user's choice.
  - **Privacy**: `isOwnerOnly(1)` is true; 3, 5 and 7 are false.
  - **Size band**: `employee_count` 0 → warning; 12 → "11–50".
  - **Custom fields**, `customCompatibility` for every row of FR-016:
    - each compatible pair (`text` → long_text, or → text when the value fits);
    - Yes/No options → yes_no;
    - `monetary` in EUR → warning;
    - `address` → unsupported;
    - a type mismatch;
    - no CRM field;
    - an option not a current choice → counted.
- [X] T026 [P] [US2] `tests/unit/pipedrive-page.test.ts` (`// covers FR-017, FR-018, US2 scenarios 13–15, edge cases
  on duplicates`), on the pure `planPersonPage` / `planOrganisationPage`:
  - a person with a link → `already`;
  - one matching CRM person → `link`;
  - two → not imported `pipedrive_email_many_people`;
  - a CRM person linked from another Pipedrive id → `pipedrive_email_other_person`;
  - two persons in one page sharing an email → the first is added, the second not imported;
  - two organisations with one name → the second links to the first;
  - an archived organisation → link plus `pipedrive_org_archived`;
  - an owner with no CRM user → the importer, counted under that Pipedrive owner;
  - owner-only and owned by Margaret → `private: true`, `createdBy` = Margaret.
- [X] T027 [US2] `tests/integration/pipedrive-import.test.ts` (`// covers US2 scenarios 1–16, FR-004, FR-005, FR-007–
  FR-016, FR-019, FR-025, FR-026, SC-008`), with `smallAccount` and `runToEnd`:
  - **Starting**: with nothing ticked → `pipedrive_tick_something`; People without a consent →
    `pipedrive_consent_required`.
  - **Values**: check every value on the imported people and organisations:
    - emails and phones with their kinds and order;
    - organisation, role, lead source, LinkedIn, labels "Hot" only, owner;
    - consent: unsubscribed stays unsubscribed; no status takes the choice;
    - `created_at` from `add_time`;
    - "Budget" in `custom_values`, with no `custom_set` events.
  - **Timeline**: one `pipedrive_imported` event per imported record, plus `person_linked` on organisations.
  - **Links**: the matched person and organisation are linked and unchanged (compare every column and `version`
    before and after), with no new event.
  - **People only**: with only People ticked, the person's organisation is imported too, and no other organisation.
  - **Report**:
    - "Lead source not on the list: 'Webinar' (n people)";
    - "Label not on the list: 'Cold' (n people)";
    - "No CRM field named 'Favourite colour'.";
    - "'Region' is an address field in Pipedrive: not imported.";
    - the Jane Fake owner line;
    - the linked lines, with a hidden person named only through the anonymous template;
    - the not-imported list with Pipedrive names and reasons.
- [X] T028 [P] [US2] `tests/integration/pipedrive-private.test.ts` (`// covers US2 scenario 9, FR-013, FR-019,
  SC-006`), with three users: Linus imports, Margaret owns owner-only people, Ada is a third user.
  - Margaret's owner-only person is private with `created_by` = `owner_id` = Margaret.
  - Linus and Ada do not find it in `listPeople` or search.
  - The report counts "1 private people of other owners imported." and never contains its name; neither do the
    rendered progress or report pages.
  - Jane Fake's owner-only person → Linus is owner and creator, and only Linus sees it.
  - An owner-only organisation is shared, and counted.
- [X] T029 [P] [US2] `tests/integration/pipedrive-consent.test.ts` (`// covers US2 scenario 14, FR-014, FR-018,
  SC-004, SC-005`):
  - an existing Subscribed CRM person unsubscribed in Pipedrive becomes Unsubscribed with `version + 1` and the event
    `pipedrive_unsubscribed`, and nothing else changes; the report line is named or anonymous depending on visibility;
  - an Unsubscribed CRM person subscribed in Pipedrive stays Unsubscribed;
  - no imported person is Subscribed unless Pipedrive said so or the user chose it;
  - with `noMarketingApp()`, everyone gets the choice and the part retried without `include_fields`.

### Implementation for User Story 2

- [X] T030 [US2] Create the pure `src/server/pipedrive/rules.ts` (research.md §7). Reuse `splitFullName` and
  `parseSize` (`imports/rows.ts`), `normaliseEmail`, `isValidEmail`, `normalisePhone`, `normaliseWebsite`,
  `normaliseLinkedIn`, `validatePerson` and `validateOrganisation` (`records/rules.ts`), and `readValue` /
  `parseNumber` (`custom-fields/rules.ts`). Do not write second versions of them.
- [X] T031 [US2] Create the pure `src/server/pipedrive/page.ts`: `planOrganisationPage` and `planPersonPage` with the
  types `Lookups` (links, emails, organisations by key, lead sources, labels, active users by email, custom fields
  per kind, snapshot) and `PagePlan` (adds, links, already, notImported, warnings, unsubscribes, counter
  increments).
- [X] T032 [US2] Move `newIds`, `inChunks`, `col` and `insertCustomValues` out of `src/server/imports/imports.ts` into
  `src/server/imports/bulk.ts` and import them from both places. The CSV import tests must stay green.
- [X] T033 [US2] Create `src/server/pipedrive/imports.ts`, the engine part for one page (research.md §5–§6).
  - `startImport(userId, { people, organisations, consent })`: checks, then one `sql.begin()` that deletes the user's
    finished or stopped imports and inserts the row (an open one → return its id).
  - `runPart(userId, id)`: read the row and the token, fetch outside any transaction, then `sql.begin()`:
    1. `select … for update`;
    2. check the step and cursor are unchanged;
    3. `lock table organisations, person_emails, pipedrive_links in share row exclusive mode`;
    4. load the lookups for the page;
    5. plan, then bulk insert the organisations, persons, emails, phones, labels, custom values, links (`on conflict
       do nothing` is never needed: the lock makes the check exact) and events, and apply the unsubscribes;
    6. update the cursor, counts, report, `seen_at` and step.
  - Steps and the fetch of missing organisations by `ids` in the `people` step.
  - In this story, the happy path and `finished`. Errors and waits come in US3.
- [X] T034 [US2] Add the timeline kinds to `src/server/records/timeline.ts` (`EventKind`) and
  `src/server/records/timeline-view.ts` (CHANGE tag), and the lines "Imported from Pipedrive by <name>" / "Unsubscribed
  by the Pipedrive import of <name>" in `src/app/(app)/records/Timeline.tsx` and `RecordTimeline.tsx`.
  `src/server/records/ambassadors.ts` latest updates treat them like `imported`. Extend
  `tests/unit/timeline-view.test.ts`.
- [X] T035 [US2] Create `src/server/pipedrive/report.ts`: `namesForReport(viewerId, report)` through `visiblePerson()`,
  and `reportLines(report, names)` → `{ text }[]` built only from `messages` / `templates`.
- [X] T036 [US2] Create `src/app/(app)/settings/pipedrive-import/page.tsx` (`export const maxDuration = 60`) and
  `ChooseStep.tsx`, `ReportStep.tsx` and `actions.ts` (`startPipedriveImportAction`) (contracts/routes.md).
  - Give `src/app/(app)/records/import/StepBar.tsx` an optional `steps` prop (default: the CSV steps), and pass
    `["1 CHOOSE", "2 IMPORTING", "3 REPORT"]`.
  - The consent radios show only when People is ticked, with CSS `:has()` in `src/app/globals.css`, and nothing is
    chosen in advance.
  - Not connected → redirect `/settings`.

**Checkpoint**: a small import runs to its report through `runToEnd`.

---

## Phase 5: User Story 3 - A long import runs in parts, with progress, and can be resumed (Priority: P1)

**Goal**: thousands of records in parts, with waits on 429, pauses, continue, stop, one import per user, and repeats
and concurrent imports without copies.

**Independent Test**: 3,000 people and 800 organisations, a 429 every 7 calls, a failure and a "closed page"
half-way, continued to the end. Every Pipedrive record → exactly one CRM record, and the counts match.

### Tests for User Story 3 ⚠️

- [X] T037 [P] [US3] `tests/integration/pipedrive-resume.test.ts` (`// covers US3 scenarios 1–6, 8, FR-020–FR-024,
  SC-002, SC-003`):
  - **Large account**: `slowDownEvery(7, 8)` → the import becomes `waiting` with `wait_until` ≈ 8 s, and the part
    answers `{ next: "wait", seconds: 8 }`.
  - **Failure**: `failNext("network")` mid-people → `paused`/`unreachable`, no half-saved page (counts and rows equal
    those before the part).
  - **Closed page**: `seen_at` set 31 s back → `getImportView` shows paused with the `pipedrive_paused` text, and
    parts do not run until `continueImport`.
  - **Revoked token**: `refuseToken` → `token_refused`.
  - **Removed token**: `removeToken` → `token_refused`.
  - **Other company**: a token from the other company → `other_company` on continue, and nothing imported.
  - **Changes during the import**: a person deleted in the fake before its page → absent and not counted; a person
    added during the import → imported on that run (higher id) or the next.
  - **Stop**: → `stopped`/`by_user`, the records stay, and the report shows "Stopped by you before the end.".
  - **Totals**: done equals total for both kinds, and `select count(*)` per link kind equals the fake's counts.
  - **Second run**: all records counted `already`, no new rows.
  - **Timing**: each `runPart` takes under 10 s in the test (measure).
- [X] T038 [P] [US3] `tests/integration/pipedrive-concurrency.test.ts` (`// covers US3 scenarios 7, 9, FR-006, FR-017,
  SC-003`):
  - a second `startImport` while one is open returns the open one's id;
  - **Two users at once**: Linus and Margaret, both connected to company 1001, run parts interleaved and with
    `Promise.all` → exactly one CRM record per Pipedrive record, and the second import counts the rest as `already`;
  - **Two tabs**: the same import's part run twice at once → the second throws its page away (the cursor check), with
    no duplicates;
  - **Deleted CRM record**: a person deleted by Ada after import → the next import counts it `already` and does not
    re-add it (spec Clarifications).
- [X] T039 [P] [US3] `tests/integration/pipedrive-access.test.ts` (`// covers FR-027, edge cases on signed-out and
  deactivated users`):
  - each of the six actions with no session, or as deactivated Alan Fake, refuses (redirects to sign-in) and changes
    nothing;
  - `runPart` / `stopImport` with another user's import id does nothing;
  - the import page of a user without a connection redirects to `/settings`.

### Implementation for User Story 3

- [X] T040 [US3] Complete `src/server/pipedrive/imports.ts`.
  - **Waits**: `PipedriveSlowDown` → `waiting` with `wait_until = now() + seconds`; the next part after that sets
    `running`.
  - **Pauses**: `PipedriveUnreachable` / timeout → `paused`/`unreachable`. `PipedriveRefused`, or no token →
    `token_refused`. A company mismatch → `other_company`.
  - **Marketing status**: `PipedriveBadRequest` on persons with `include_fields` → retry once without it and set
    `options.noMarketingStatus`.
  - **Pacing**: answer `{ next: "wait", seconds }` while `wait_until` is in the future.
  - **Pause by absence**: the effective paused view in `getImportView` (`seen_at` older than 30 s).
  - **Actions**: `continueImport(userId)` (sets `running`, clears the reasons, `seen_at = now()`) and
    `stopImport(userId)`.
  - **Totals**: `max(total, done)`.
- [X] T041 [US3] Create `src/app/(app)/settings/pipedrive-import/ProgressStep.tsx` (server), `StopConfirm.tsx`
  (`?stop=1`) and `ImportRunner.tsx` (client: loop `runPipedrivePartAction` → `router.refresh()` → 1 s → again; a
  countdown text on `wait`; stop on `stop`; started only when the server-rendered view is running and not paused).
  - Add `runPipedrivePartAction`, `continuePipedriveImportAction` and `stopPipedriveImportAction` to `actions.ts`.
  - Step 2 per FR-029: the three counts, "// PROGRESS" with a `<progress>` and "<Kind> · <done> of <total>" per ticked
    kind, the state line (running / slow down / paused message with `[ CONTINUE ]`), the keep-open note, and
    `[ STOP IMPORT ]`.
- [X] T042 [US3] Show an open import on `/settings` in `PipedriveSection.tsx` ("Import paused: …" or running, linking
  to the import page). Starting while one is open redirects to it.
- [X] T043 [P] [US3] Add the CSS of design B (`design-options.html`) to `src/app/globals.css`: count tiles, progress
  bars, and the state chip, with the existing variables only.

**Checkpoint**: all three stories pass. `npm test && npm run typecheck` is green.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T044 [P] Add a test in `tests/integration/pipedrive-import.test.ts` (`// covers FR-028`):
  - a Pipedrive person named `<a href="https://evil.example">Click</a>`, a label `Your account is locked`, and a
    custom value with markup;
  - rendered settings, progress and report HTML contain them only escaped, with no `<a href="https://evil.example"`,
    and the report shows them inside quotes.
- [X] T045 [P] Add a check to `tests/integration/pipedrive-connection.test.ts` (`// covers SC-007`): spy on
  `console.*` during a full import and a refused save; nothing logged contains the token.
- [X] T046 [P] Add an `src/seed/` note: the fake Pipedrive needs no seeding, because `fakePipedrive()` builds its
  data. Check that the CRM fake users seeded by `src/seed/users.ts` include the emails used by the dev fake owners, so
  owners match by hand. If they don't, use the seeded emails in `fake-pipedrive.ts`.
- [X] T047 [P] Update `README.md`:
  - the `/settings/pipedrive-import` row in the pages table;
  - a "Pipedrive import" section: the token, what is imported, matching and linking, parts and pause, waits, the
    report, and the dev tokens `fake-pipedrive-token` / `fake-pipedrive-other`;
  - the `test:schemas` line naming the Pipedrive schemas.
- [X] T048 [P] Update `AGENTS.md` § Layout:
  - `src/server/pipedrive/`: the token is opened only in `connection.ts`; no Pipedrive call inside `sql.begin()`;
    `pipedrive_links` is the "never twice" key;
  - the settings and import UI files;
  - `tests/fakes/pipedrive.ts`, checked against `pipedrive_v2_openapi.json` and `pipedrive_v1_openapi.yml`;
  - `src/server/imports/bulk.ts`.
- [X] T049 Append to the end of `docs/DECISIONS.md`, one line each:
  - "The Pipedrive import uses design B: Settings holds the token; the import has its own page with a step bar (choose, importing, report), like the CSV import (SF-117)"
  - "A Pipedrive contact visible only to its owner is private in the CRM and its owner is its creator: only the owner sees it, not whoever ran the import (SF-117)"
  - "A person Subscribed in the CRM whom Pipedrive says is unsubscribed becomes Unsubscribed on import, with a timeline entry and a report line; an import never makes anyone Subscribed (SF-117)"
  - plus one line per factory choice of spec.md § Clarifications that the Plan Review confirmed.
  - No blueprint exception, so no "Departs from blueprint" line. Update `tests/unit/decisions.test.ts` if it counts
    lines.
- [X] T050 Run `npm run test:schemas && npm test && npm run typecheck` with `APP_ENV=test`,
  `DATABASE_URL=postgres://postgres@localhost:5432/crm_test` and a `PIPEDRIVE_TOKEN_KEY`. Fix until green, and keep
  the complete output of any failure.
- [X] T051 Walk through quickstart.md § Automated checks and check that each listed test file exists and names what
  it covers.
- [X] T052 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) and `## Schemas` (each schema's GitHub URL at its commit).
  - **Services**:
    - Pipedrive API (v1 `/users/me`, `/users`; v2 `/persons`, `/organizations`, `/personFields`,
      `/organizationFields`): fake `src/server/pipedrive/fake-pipedrive.ts` (`FakePipedrive`). For the tests it is
      wrapped by `tests/fakes/pipedrive.ts` (`installFakePipedrive`, via `usePipedriveFetchForTests`) and checked
      against `pipedrive_v2_openapi.json` and `pipedrive_v1_openapi.yml`.
      - It copies 401 for an unknown or refused token, 429 with `Retry-After` (`slowDownEvery`), 400 on `limit` > 500
        and on `include_fields=marketing_status` without the marketing app, cursor paging in ascending ids, and the
        `ids` filter.
      - Switches: `failNext`, `deletePerson`/`deleteOrganization`, `requests`.
      - In the running app (APP_ENV development/test and `PIPEDRIVE_URL` empty), the same fake runs in process, with
        tokens `fake-pipedrive-token` (Fakeco Pipedrive) and `fake-pipedrive-other` (Otherco Pipedrive). It needs
        `PIPEDRIVE_TOKEN_KEY` set.
    - Supabase Postgres: keep the existing line, and add SF-117's tables (`migrations/0012_pipedrive.sql`) and the
      lock `organisations, person_emails, pipedrive_links in share row exclusive mode` per part, with no network call
      inside a transaction.
  - **Schemas**: keep `oauth2-api.json` and `storage_v0_openapi.json`, and add:
    - `pipedrive_v2_openapi.json`: https://github.com/soenneker/soenneker.pipedrive.openapiclient/blob/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json
    - `pipedrive_v1_openapi.yml`: https://github.com/Zenika/zenpipe/blob/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 before T003 (the test needs `yaml`), T002 before T003. T004–T007 are independent.
- **Foundational (Phase 2)**: needs T006 (config). T008, T009 → T010 → T011.
- **US1 (Phase 3)**: needs Phase 2. MVP. T012 is its first test task, and T016 comes after T012.
- **US2 (Phase 4)**: needs US1 (a saved token). T024 is its first schema task, and T027–T029 need T023 and T024.
- **US3 (Phase 5)**: needs US2's engine (T033).
- **Polish (Phase 6)**: after the stories. T052 is the last task.

### Within Each User Story

Write the tests first and see them fail. Pure code (`rules.ts`, `page.ts`) comes before the engine, the engine before
pages. A story is done at its checkpoint.

### Parallel Opportunities

- Setup: T004, T005, T006 and T007.
- US1: T013, T014 and T015 beside T012. T019 beside T017.
- US2: T023, T025 and T026 beside T024. T028 and T029 after T027's helpers.
- US3: T037, T038 and T039. T043.
- Polish: T044–T048.

---

## Parallel Example: User Story 2

```bash
Task: "T025 tests/unit/pipedrive-rules.test.ts"
Task: "T026 tests/unit/pipedrive-page.test.ts"
Task: "T023 tests/integration/pipedrive-helpers.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 and Phase 2, then US1: users can connect Pipedrive safely.
2. Validate with T012–T016 and the US1 checkpoint.

### Incremental Delivery

1. US1 (connection) → US2 (a complete small import with report) → US3 (parts, waits, pause, stop, concurrency) →
   Polish.
2. Run `npm test` at each checkpoint.

## Notes

- Never write a real Pipedrive token anywhere. Tests use `test-token-<n>`, and development uses
  `fake-pipedrive-token`.
- No Pipedrive call inside `sql.begin()`. No `console.*` of tokens, headers or URLs.
- Pipedrive values are shown only as React text, inside quotes in report lines.

## Fix round 1: counts per kind on the report (FR-025, US2 scenario 16)

- [x] T053 Write the test first, in `tests/integration/pipedrive-import.test.ts` (`// covers FR-025, US2 scenario 16`):
  run the US2 fake-data import (people and organisations ticked, one person and one organisation already in the CRM),
  then rerun it so records count as already imported, render `ReportStep` with `renderToStaticMarkup` and check the
  "// COUNTS" table has a People row and an Organisations row whose Imported, Linked, Already imported and Not imported
  cells equal `view.counts.people` / `view.counts.organisations` (each also checked against the fake data's known numbers,
  not a guess). It fails now (no such table) and passes once T054 is built.
- [x] T054 Add `src/app/(app)/settings/pipedrive-import/KindCounts.tsx` (server component: "// COUNTS" label, table
  rows People / Organisations, columns Imported, Linked, Already imported, Not imported, `en-GB` numbers; a row only
  for a ticked kind, or Organisations when any of its counts is not zero) and render it in `ReportStep.tsx` after the
  total tiles and "Already imported: n". The progress step stays as it is.
- [x] T055 Run `npm test && npm run typecheck` with `APP_ENV=test`.
