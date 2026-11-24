---

description: "Task list for SF-122 — Pipedrive import: deals, notes, activities and files"
---

# Tasks: Pipedrive import — deals, notes, activities and files

**Input**: Design documents from `/specs/sf-122-step-11b-12-pipedrive-import-deals-notes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/pipedrive-api.md, contracts/routes.md,
quickstart.md

**Tests**: The repo (AGENTS.md § Tests) and the spec (SC-002 to SC-006) ask for tests:
- Vitest unit tests;
- Vitest integration tests on the real local Postgres (`crm_test`), with the fake Pipedrive (`installFakePipedrive()`,
  schema-checked) and the fake Storage (`tests/fakes/storage.ts`, schema-checked).

There are no browser tests (docs/DECISIONS.md, 2026-11-23). Each test file names what it covers
(`// covers FR-005, US1 scenario 4`). Write each story's tests first and see them fail before the code.

**Organization**:
- Tasks are grouped by user story. Phases follow priority: US1, US2, US3 and US5 (P1), then US4 (P2). The parts of US5
  that concern files are tested in US4, once files exist.
- Where the details live:
  - Message texts: contracts/routes.md § Messages, verbatim, only from `src/server/messages.ts`.
  - The migration, columns, steps and report shape: data-model.md.
  - Calls, the fake and the schemas: contracts/pipedrive-api.md.
  - Decisions: research.md (§n below).
- Dependencies: none (dependencies.json `[]`). Add no package (no `html-to-text`, no Pipedrive client).
- Blueprints: `blueprints.json` is `[]` and there is no blueprint index in this run. So there are no blueprint tasks
  and no "Departs from blueprint" line.
- Spec choices: the three factory choices in spec.md § Clarifications ("to confirm") are built as written: long notes
  imported whole, records on archived CRM records imported, email attachments counted not listed.
- Outside services (plan.md § Outside services):
  - Pipedrive API v2 (schema): T014, the first test task of US1.
  - Pipedrive API v1, full copy (schema): T015, in US1.
  - Supabase Postgres (no schema): T016, in US1.
  - Pipedrive API v1, Zenika copy (schema): T032, the first test task of US2.
  - Supabase Storage (schema): T052, the first test task of US4.
  - The test recipe is T070, the last task.
- Fake people: reuse `tests/integration/pipedrive-helpers.ts`:
  - CRM users Ada Fake (admin), Linus Fake and Margaret Fake (users), Alan Fake (deactivated);
  - the Pipedrive users "Fake Person" (`linus@barnacle.ai`), "Margaret Pipedrive Fake" and "Jane Fake"
    (`jane@fake.example`, no CRM user).

  Every new name is clearly fake ("… Fake", `@fake.example`, `*.invalid` hosts).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: the user story (US1–US5).

---

## Phase 1: Setup

**Purpose**: the third Pipedrive schema and the migration.

- [ ] T001 Add the full v1 schema to `scripts/fetch-schemas.mjs`. Append
  `{ file: "pipedrive_v1_full_openapi.yml", url: "https://raw.githubusercontent.com/konfig-sdks/openapi-examples/161ab49c45e45825ca3832945c59a3ba904321ba/pipedrive/openapi.yaml", sha256: "24230787d0c71b1e528a2824e8aa6d3137db26aa57973e65f3819b1fce825665" }`
  to `SCHEMAS`. Update the head comment: the full v1 file is used by `tests/fakes/pipedrive.ts` for the v1 paths the
  Zenika file lacks. Run `npm run test:schemas`.
- [ ] T002 [P] Extend `tests/unit/fetch-schemas.test.ts` (`// SF-122: the full Pipedrive v1 schema`). The fresh copy
  downloads `pipedrive_v1_full_openapi.yml`, and once parsed with `yaml`'s `parse`, its `paths` contain
  `/deals/{id}/participants`, `/files/{id}/download`, `/notes`, `/files` and `/activityTypes`.
- [ ] T003 Write `migrations/0013_pipedrive_deals.sql` exactly as data-model.md § Migration. First confirm the 0012
  constraint names (`pipedrive_imports_step_check`, `pipedrive_imports_pause_reason_check`,
  `pipedrive_links_kind_check`) with `select conname from pg_constraint where conrelid = 'pipedrive_imports'::regclass`
  (and likewise for `pipedrive_links`). The file holds:
  - **`pipedrive_imports`**:
    - `want_deals`, `want_notes`, `want_activities`, `want_files` `boolean not null default false`;
    - `deals_total`, `notes_total`, `activities_total`, `files_total` `int null`;
    - `deals_done`, `notes_done`, `activities_done`, `files_done` `int not null default 0`;
    - `pipedrive_imports_records_check`
      `check (not (want_deals or want_notes or want_activities or want_files) or (want_people and want_organisations))`;
    - `pipedrive_imports_step_check` re-created with
      `step in ('prepare', 'count_organisations', 'count_people', 'count_deals', 'count_archived_deals', 'count_notes', 'count_activities', 'count_files', 'organisations', 'people', 'pipelines', 'deals', 'archived_deals', 'notes', 'activities', 'files', 'done')`;
    - `pipedrive_imports_pause_reason_check` re-created with
      `pause_reason in ('unreachable', 'token_refused', 'other_company', 'files_unreachable')`.
  - **`pipedrive_links`**:
    - `deal_id … references deals (id) on delete set null`;
    - `note_id … references timeline_events (id) on delete set null`;
    - `activity_id … references activities (id) on delete set null`;
    - `file_id … references files (id) on delete set null`;
    - `pipedrive_links_kind_check` re-created with
      `kind in ('person', 'organisation', 'deal', 'note', 'activity', 'file')`;
    - `pipedrive_links_target_check` as in data-model.md, including `(kind in ('person', 'organisation') or how = 'imported')`;
    - four partial indexes `pipedrive_links_{deal,note,activity,file}_idx … where <col> is not null`.
  - No new table, no change to the timeline kind check, no `begin` / `commit` / `concurrently`. Renumber if `0013` is
    taken when merging.
- [ ] T004 [P] Extend `tests/integration/migrate.test.ts` (`// covers SF-122 data-model.md § Migration`):
  - the twelve new columns with their defaults;
  - the records check refuses `want_deals = true, want_people = false`;
  - the step check accepts `'archived_deals'` and refuses `'emails'`;
  - the pause reason check accepts `'files_unreachable'`;
  - a `pipedrive_links` row of kind `note` with a `deal_id` is refused, and one of kind `deal` with `how = 'linked'` is
    refused;
  - `0013` has no `begin` / `commit` / `concurrently`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: shared helpers, the widened report and counts, the messages, the step machine. Every story needs them.

- [ ] T005 [P] In `src/server/imports/bulk.ts`:
  - `newIds(db, table)` accepts `"persons" | "organisations" | "deals" | "timeline_events" | "activities"`;
  - `insertCustomValues(db, kind, …)` accepts kind `"deals"` (target column `deal_id`), keeping `people` /
    `organisations` unchanged.

  Do not change the `ImportKind` of the CSV import: give the function its own `"people" | "organisations" | "deals"`
  parameter type.
- [ ] T006 [P] Add an option to `putSigned(url, bytes, contentType, { timeoutMs = 10_000 } = {})` in
  `src/server/files/storage.ts`. Its comment now says it is used by the fake data and the Pipedrive import. Add an
  optional `addedAt?: Date` to `insertFile` in `src/server/files/files.ts`. It sets `files.added_at` and the
  `file_added` event's `created_at` (default `now()`). The existing callers are unchanged.
- [ ] T007 [P] Add every code of contracts/routes.md § Messages to `src/server/messages.ts`, verbatim:
  - twelve fixed codes, from `pipedrive_emails_note` to `pipedrive_private_person`;
  - templates, from `pipedrive_pipeline_added` to `pipedrive_duration_left_out`, with `counted()` for the plurals;
  - `PIPEDRIVE_KIND_WORDS` gains `deals: "Deals"`, `notes: "Notes"`, `activities: "Activities"`, `files: "Files"`;
  - `pipedrive_progress` / `pipedrive_paused` accept the six kinds.

  Quote every Pipedrive argument with `'…'`. A unit test in `tests/unit/pipedrive-messages.test.ts` checks the singular
  and plural forms of each counted template and `pipedrive_file_too_large("26.1")` → "Over 25 MB (26.1 MB).".
- [ ] T008 Widen `src/server/pipedrive/report.ts` per data-model.md § Counts and report:
  - `Counts` gets `deals`, `notes`, `activities` and `files`;
  - `RecordKind` (in `page.ts`) gets `"deal" | "note" | "activity" | "file"`;
  - `ListMiss.list` gets `"deal_label"`;
  - `FieldNotImported.kind` gets `"deal"`;
  - `Report` gets `pipelinesAdded`, `stagesAdded`, `merged`, `notCreated`, `activityTypes`, `elsewhere`,
    `privateDeals` and `privateOn`.

  Then:
  - `readCounts` / `readReport` fill what an SF-117 row lacks;
  - `PageReport` gets optional parts for the new pieces;
  - `mergeReport` sums them (activityTypes per `type`, elsewhere per `kind` + `on`, the counts per kind).

  `tests/unit/pipedrive-report.test.ts` (`// covers FR-019`): an SF-117 report JSON reads with zeros, and merging two
  pages sums the type and elsewhere counters.
- [ ] T009 In `src/server/pipedrive/imports.ts`, widen the step machine only (no new saver yet):
  - `Step` and `ORDER` in the order of data-model.md;
  - `nextStep` skips `count_deals` / `count_archived_deals` / `pipelines` / `deals` / `archived_deals` unless
    `want_deals`, and the notes, activities and files steps unless their flag;
  - `Row` and `load()` read the new columns;
  - `startImport(userId, { people, organisations, deals, notes, activities, files, consent })`: when any of the four
    is true, `people = organisations = true` (FR-002). The insert writes the four flags.
  - `PauseReason` gets `"files_unreachable"`;
  - `getImportView` returns `progress` for the six kinds in the order Organisations, People, Deals, Notes, Activities,
    Files (only those wanted), and counts and totals summed over six kinds.

  `startPipedriveImportAction` in `src/app/(app)/settings/pipedrive-import/actions.ts` reads `deals`, `notes`,
  `activities` and `files` (`=== "on"`).
- [ ] T010 [P] Write `src/server/pipedrive/html.ts`: `htmlToText(html: string): string` (research.md §6).
  - `<br>` and the end of `p`, `div`, `li`, `h1`–`h6` and `tr` → `\n`; `<li>` → `- `.
  - `<a href="u">t</a>` → `t`, plus ` (u)` when `u` ≠ `t`, keeping only `http:`, `https:` and `mailto:` addresses.
  - Every other tag is removed, as are `script` / `style` contents.
  - Entities decoded: `&amp; &lt; &gt; &quot; &apos; &#39; &nbsp;` and `&#n;` / `&#xh;`.
  - Three or more `\n` → two; trimmed.

  Unit tests first, in `tests/unit/pipedrive-html.test.ts` (`// covers FR-010, US2 scenario 4`):
  - paragraphs and lists;
  - a link with the same text, with a different address, and with a `javascript:` address (dropped);
  - a mention span → "@Jane Fake";
  - `<a href="https://evil.example">Click</a>` → `Click (https://evil.example)`;
  - `&lt;b&gt;` → `<b>` as text.
- [ ] T011 [P] Export `ownerOf` from `src/server/pipedrive/page.ts`, unchanged, for reuse by the new planners.
- [ ] T012 Extend the API types and reading helpers in `src/server/pipedrive/api.ts`:
  - the types `PdDeal`, `PdActivity`, `PdNote`, `PdFile`, `PdPipeline`, `PdStage` and `PdActivityType`, exactly as in
    contracts/pipedrive-api.md;
  - a `getV1Paged(token, path, { start, limit, sort })` helper that returns `{ data, next }` from
    `additional_data.pagination` (`next_start` when `more_items_in_collection`).

  No new calls yet: each story adds the ones it uses.
- [ ] T013 [P] In `src/app/(app)/settings/pipedrive-import/ProgressStep.tsx`, `Counts.tsx` and `KindCounts.tsx`:
  - render a progress line and bar per item of `view.progress` (six kinds possible) using `pipedrive_progress`;
  - `KindCounts` rows for Deals, Notes, Activities and Files when wanted or non-zero, with Linked "—" for them;
  - the paused state shows `messageFor("files_unreachable")` for pause reason `files_unreachable`, with `[ CONTINUE ]`.

**Checkpoint**: the migration runs, `npm run typecheck` passes, and SF-117's tests still pass.

---

## Phase 3: User Story 1 - Import deals into the right pipelines and stages (Priority: P1) 🎯 MVP

**Goal**: deals come in with every value, in pipelines and stages matched or created by name.

**Independent Test**: spec US1 Independent Test. The fake has 3 pipelines (Sales with an extra stage, "exec dinner "
matching "Exec Dinner", Fake Partners missing) and 40 deals. After the import, the board, list, deal page, the created
pipeline and stage, and the report lines are right.

### Tests for User Story 1

- [ ] T014 [US1] Download `pipedrive_v2_openapi.json` from
  `https://github.com/soenneker/soenneker.pipedrive.openapiclient/blob/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json`
  at commit `77695f9076c899e2ba1e7e8eb029aabb28abed27` into `.factory/schemas/` (`git init -q /tmp/soenneker.pipedrive.openapiclient && git -C /tmp/soenneker.pipedrive.openapiclient fetch -q --depth 1 https://github.com/soenneker/soenneker.pipedrive.openapiclient 77695f9076c899e2ba1e7e8eb029aabb28abed27 && git -C /tmp/soenneker.pipedrive.openapiclient show FETCH_HEAD:openapi.json > .factory/schemas/pipedrive_v2_openapi.json`),
  and make the fake of Pipedrive API v2 refuse a request that the schema refuses: a test sends a wrong field and must
  fail. In `tests/unit/pipedrive-fake.test.ts` (`// covers FR-023, contracts/pipedrive-api.md § Schemas`), through
  `checkedFetch`, each of these must throw:
  - `GET /api/v2/deals?sort_by=title`;
  - `GET /api/v2/deals?include_fields=followers`;
  - `GET /api/v2/deals?unknown_param=1`;
  - `GET /api/v2/stages?pipeline=1` (the declared parameter is `pipeline_id`);
  - a fake deal answer carrying an undeclared property such as `stage_name` (set on the fake through a test-only
    extra-field switch).

  `GET /api/v2/deals?include_fields=followers_count,participants_count` passes, and so do `/api/v2/deals/archived`,
  `/api/v2/deals/{id}/followers`, `/api/v2/pipelines`, `/api/v2/stages` and `/api/v2/dealFields`.
- [ ] T015 [US1] Download `pipedrive_v1_full_openapi.yml` from
  `https://github.com/konfig-sdks/openapi-examples/blob/161ab49c45e45825ca3832945c59a3ba904321ba/pipedrive/openapi.yaml`
  at commit `161ab49c45e45825ca3832945c59a3ba904321ba` into `.factory/schemas/` (`git init -q /tmp/openapi-examples && git -C /tmp/openapi-examples fetch -q --depth 1 https://github.com/konfig-sdks/openapi-examples 161ab49c45e45825ca3832945c59a3ba904321ba && git -C /tmp/openapi-examples show FETCH_HEAD:pipedrive/openapi.yaml > .factory/schemas/pipedrive_v1_full_openapi.yml`),
  and make the fake of Pipedrive API v1 (full copy) refuse a request that the schema refuses: a test sends a wrong
  field and must fail.
  - In `tests/fakes/pipedrive-schema.ts`, add `PIPEDRIVE_V1_FULL_PATH` and `loadPipedriveV1Full()`.
  - In `tests/fakes/pipedrive.ts`, a `/v1/*` request is checked against `pipedrive_v1_openapi.yml` when it declares
    the path and method, else against `pipedrive_v1_full_openapi.yml`, and the error names the file used.
  - A 200 answer whose `content-type` is not JSON is checked only for a content type the operation declares
    (`application/octet-stream` for the download), never parsed.
  - A request to `files.fake-pipedrive.invalid` is not schema-checked, but throws if it carries `x-api-token`.

  In `tests/unit/pipedrive-fake.test.ts`, each of these must throw:
  - `GET /v1/deals/5/participants?per_page=10`;
  - a participants answer item with an undeclared property `person_title`;
  - `GET /v1/files/5/download?inline=1`.

  `GET /v1/deals/5/participants?start=0&limit=100` passes.
- [ ] T016 [P] [US1] Supabase Postgres has no public schema on GitHub. The tests use the real local Postgres, and the
  new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres
  (transaction-mode pooler). It copies these limits: no prepared statements (`prepare: false`, unchanged), no session
  state (no `set`, `listen` or session advisory lock), every multi-statement change in one `sql.begin()`, at most 5
  connections, and no network call inside a transaction.
  - Extend the scan of `tests/integration/migrate.test.ts` to the new files `src/server/pipedrive/html.ts`,
    `deal-rules.ts` and `records-page.ts`.
  - Add a test in `tests/integration/pipedrive-deals.test.ts` that wraps the installed Pipedrive fetch and fails if a
    call happens while a `sql.begin()` of the import is open. Do it by counting calls between a `before` / `after`
    hook on `save`: export a test-only `onSaveForTests(fn)` from `imports.ts`, which throws outside `APP_ENV=test`.
- [ ] T017 [P] [US1] Write the unit tests `tests/unit/pipedrive-deal-rules.test.ts` for `dealFromPipedrive`
  (`// covers FR-005, FR-007, FR-008, US1 scenarios 4, 6, 8, 9, 11, edge cases`):
  - Title: trimmed. Empty → the form's required message. 201 characters → the form's too-long message (not imported).
  - Value: GBP 1234.5 → 123450 pence. USD → no value and the warning "Value in USD, not GBP: left out.". Negative or
    over `MAX_PENCE` → left out with the `pipedrive_value_invalid` warning.
  - Expected close: invalid → warning.
  - Dates: `created_at` = add_time. `stage_entered_at` = `stage_change_time`, else add_time.
  - Won: `closed_at` = won_time.
  - Lost:
    - with a reason → `closed_at` = lost_time and the reason;
    - with no reason → "No reason given in Pipedrive.";
    - with 501 characters → "Lost reason too long to import from Pipedrive." plus a warning (never cut).
  - Archived → `archived` true.
  - Privacy: `visible_to` 1 → private, with `created_by` = the owner's CRM user (the importer when the owner has no
    CRM user). Else shared, with `created_by` = the importer.
  - Labels: matched to offered deal labels ignoring case and spaces. An unmatched one goes in `lists`
    (`deal_label`), counted.
- [ ] T018 [P] [US1] Write the unit tests `tests/unit/pipedrive-pipelines.test.ts` for `planPipelines`
  (`// covers FR-004, US1 scenarios 2–3, edge cases`):
  - "exec dinner " matches "Exec Dinner".
  - A missing stage is added at the end in Pipedrive `order_nr` order.
  - "Fake Partners" is created with 5 stages, at `max(position) + 1`.
  - Deleted pipelines and stages are ignored; empty pipelines are still created.
  - "Sales" and "sales " → one CRM pipeline and one `merged` item (likewise for two stages).
  - A 101-character name → `notCreated`, with its stages mapped to `null`.
  - Nothing is ever renamed or reordered: the plan holds inserts only.
- [ ] T019 [US1] Write `tests/integration/pipedrive-deals.test.ts` (`// covers FR-004–FR-008, US1 scenarios 1–11, SC-003, SC-005`),
  with the fake set of the Independent Test (add a `seedDealsSet(fake)` to `tests/integration/pipedrive-helpers.ts`).
  Import as Linus Fake (not an admin) with Deals ticked, then assert:
  - **Pipelines and stages**: the CRM has "Fake Partners" with 5 stages, and "Proposal" at the end of Sales. The board
    of each pipeline lists its open deals.
  - **Values**: each deal has its title, value, owner, person, organisation, expected close date, `created_at`, labels,
    followers (active CRM users only), other linked people and "Budget" custom value.
  - **Report lines**: "Stage 'Proposal' added to the pipeline Sales.", "Pipeline 'Fake Partners' added with 5
    stages.", "No CRM field named 'Region'.", "2 private deals of other owners imported.", and on the USD deal "Value
    in USD, not GBP: left out.".
  - **Status**: won and lost with their dates and reasons; an archived deal is archived.
  - **Stage bar**: `getStageSeconds` counts only the current stage, from `stage_change_time`.
  - **Timeline**: exactly one event per deal (`pipedrive_imported`), and no `won` / `lost` / `added` events.
  - **Not imported**: a deal whose person had no name → not imported, with "Its person 'No Name Fake' was not
    imported.". A participant not imported → the warning "Linked person 'Ada Example' was not imported: left out.".
  - **Privacy**: the owner-only deal is visible to its owner only (`visibleDeal`).
  - **Admin pages**: `addPipeline` / `addStage` called by Linus Fake still refuse (not an admin).
- [ ] T020 [P] [US1] Write `tests/integration/pipedrive-choose.test.ts` (`// covers FR-001, FR-002, US1 scenario 1, edge case 1`):
  - `startImport` with `deals: true, people: false, organisations: false` stores `want_people` and
    `want_organisations` true;
  - with only `notes: true` and no consent → `pipedrive_consent_required`;
  - the rendered `ChooseStep` (through `renderToStaticMarkup`) has the six checkboxes in order, all unticked, and the
    emails note "Pipedrive emails are not imported: they will come from Gmail.".

### Implementation for User Story 1

- [ ] T021 [P] [US1] Add `listPipelines`, `listStages`, `listDeals({ archived, cursor, limit })` (with
  `include_fields=followers_count,participants_count`), `dealFollowers(token, dealId)` and
  `dealParticipants(token, dealId)` (v1, reading `person_id.value`, else `person_id` as a number, else `id`) to
  `src/server/pipedrive/api.ts`. Also allow `listFields(token, "deal", cursor)` → `/api/v2/dealFields`. Follow
  contracts/pipedrive-api.md § Calls exactly.
- [ ] T022 [P] [US1] Extend `src/server/pipedrive/fake-pipedrive.ts`:
  - per company: `dealFields`, `pipelines`, `stages`, `deals` (with `is_archived` and `is_deleted`), `followers` (deal →
    user ids) and `participants` (deal → person ids);
  - the helpers `addPipeline`, `addStage`, `addDeal` and `deleteDeal`;
  - the answers for `/api/v2/pipelines`, `/api/v2/stages`, `/api/v2/dealFields`, `/api/v2/deals`,
    `/api/v2/deals/archived`, `/api/v2/deals/{id}/followers` (cursor) and `/v1/deals/{id}/participants` (`start` /
    `limit`, `additional_data.pagination`, `limit` > 500 → 400);
  - `include_fields` adds `followers_count` / `participants_count`;
  - `slowDownEvery` and `failNext` apply to these addresses;
  - every property must be one the schemas declare (T014 / T015 catch the rest).

  Update the file's head comment.
- [ ] T023 [US1] Write `src/server/pipedrive/deal-rules.ts` (pure): `dealFromPipedrive(d, ctx)`, per research.md §5.
  It reuses `parseMoney`, `parseDate`, `validateLostReason` and `MAX_PENCE` from `src/server/deals/rules.ts`, the
  deal form's title rule, `parseAddTime` and `isOwnerOnly` from `rules.ts`, and `ownerOf` from `page.ts`.
- [ ] T024 [US1] Allow kind `"deal"` in `planFields` in `src/server/pipedrive/rules.ts`. For deals, the field with
  code `label` gives `labelOptions` (deal label names by option id). There are no built-in names for deals.
- [ ] T025 [US1] Write `planPipelines(pdPipelines, pdStages, crm)` and `planDealPage(items, lookups)` in
  `src/server/pipedrive/records-page.ts` (pure).
  - `planDealPage` takes the links of the persons and organisations (`Map<pdId, crmId | null>`), the names of records
    not imported (from the report), the `stageMap`, the active users, the deal labels and the fields plan.
  - It returns `adds` (with their followers, other people, labels and custom values), `already`, `notImported`
    (reasons from research.md §5), `warnings`, `lists`, `choices`, `owners`, `privateDeals` and `done`.
  - Deleted Pipedrive deals are passed over and not counted.
- [ ] T026 [US1] In `src/server/pipedrive/imports.ts`, add the deal steps:
  - **`prepare`**: when `want_deals`, also read every page of `dealFields`, `pipelines` and `stages` into the
    snapshot.
  - **Counting**: `count_deals` / `count_archived_deals` count non-deleted deals 500 at a time.
  - **`pipelines`** (no fetch): one `sql.begin()` that locks the import row (and checks the step), then
    `lock table pipelines, stages in share row exclusive mode`, reads the CRM pipelines and stages, runs
    `planPipelines`, inserts with `position = max + 1`, and writes `stageMap` / `pipelineNames` into the snapshot and
    the report parts. It never updates or deletes a pipeline or stage.
  - **Fetch for `deals` / `archived_deals`**: `listDeals` with `limit` `DEAL_PAGE = 20`. Then, one after the other,
    `dealFollowers` when `followersCount > 0`, and `dealParticipants` when `participantsCount > (personId ? 1 : 0)`.
    All of it happens outside any transaction.
  - **`saveDeals`**: lock as for people, load the lookups, `planDealPage`, then bulk insert with `newIds(db, "deals",
    n)`, in order:
    - `deals`: every column of data-model.md § Records written; `status` / `closed_at` / `lost_reason`;
      `archived_at` = `update_time ?? now()` when archived;
    - `deal_stage_periods`: `entered_at` = `stage_entered_at`, `moved_by` = the importer, `left_at` = `closed_at` when
      closed;
    - `deal_label_links`, `deal_people` (`linked_by` = the importer) and `deal_followers`;
    - `insertCustomValues(db, "deals", …)`;
    - one `pipedrive_imported` event per deal (`deal_id`, actor = the importer);
    - the links (kind `deal`, `how = 'imported'`).

    Then move the cursor, `deals_done` and `deals_total`.
- [ ] T027 [US1] Extend `src/server/pipedrive/report.ts`:
  - `namesForReport` loads deal titles of `notImported` / warnings args `dealId` through `visibleDeal()` (hidden →
    `pipedrive_private_deal`), and people through `visiblePerson()` (hidden → `pipedrive_private_person`);
  - `itemText` covers the new deal codes;
  - a new `pipelineLines(report)` gives the added, merged and not-created lines;
  - `reportLines` adds `pipedrive_private_deals`.
- [ ] T028 [US1] Write `src/app/(app)/settings/pipedrive-import/KindChoice.tsx` (`"use client"`):
  - the six checkboxes, in the order People, Organisations, Deals, Notes, Activities, Files, all unticked;
  - while any of Deals, Notes, Activities or Files is ticked, People and Organisations are checked, `aria-disabled`
    and not clickable, with a hidden `<input name="people" value="on">` and `organisations` posted;
  - unticking all four frees them again.

  Render it from `ChooseStep.tsx`, with the note `messageFor("pipedrive_emails_note")` under it. The consent radios
  keep showing through `:has()` on the People box.
- [ ] T029 [US1] In `ReportStep.tsx`:
  - add a "// PIPELINES" block (only when not empty), with `pipelineLines` as text nodes;
  - make the "// NOT IMPORTED" Kind column read Deal / Note / Activity / File;
  - add links to `/deals` and `/activities` beside People and Organisations.

  Follow design B in `docs/DESIGN.md`; add CSS to `src/app/globals.css` only if needed.
- [ ] T030 [US1] Check that a deal's `pipedrive_imported` event reads `templates.pipedrive_imported_by(name)` on the
  deal page timeline, the drawer, and the person's and organisation's timelines through their deals
  (`src/app/(app)/records/Timeline.tsx`, `RecordTimeline.tsx`, `src/server/records/timeline-view.ts`). Add the deal
  case if missing, and assert it in T019.
- [ ] T031 [US1] Make T014–T020 pass. `npm test && npm run typecheck`.

**Checkpoint**: deals import on their own. This is the MVP.

---

## Phase 4: User Story 2 - Import notes onto the right records (Priority: P1)

**Goal**: every note on a deal, person or organisation lands once, on the most specific record, as plain text, at
Pipedrive's time, by its author.

**Independent Test**: spec US2 Independent Test (50 notes).

### Tests for User Story 2

- [ ] T032 [US2] Download `pipedrive_v1_openapi.yml` from
  `https://github.com/Zenika/zenpipe/blob/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml`
  at commit `1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4` into `.factory/schemas/` (`git init -q /tmp/zenpipe && git -C /tmp/zenpipe fetch -q --depth 1 https://github.com/Zenika/zenpipe 1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4 && git -C /tmp/zenpipe show FETCH_HEAD:pipedrive-api/src/main/resources/openapi.yml > .factory/schemas/pipedrive_v1_openapi.yml`),
  and make the fake of Pipedrive API v1 refuse a request that the schema refuses: a test sends a wrong field and must
  fail. In `tests/unit/pipedrive-fake.test.ts`, each of these must throw (checked against the Zenika file):
  - `GET /v1/notes?page=2`;
  - `GET /v1/files?per_page=50`;
  - a fake note answer with an undeclared property `body`.

  `GET /v1/notes?start=0&limit=200&sort=id%20ASC` and `GET /v1/activityTypes` pass.
- [ ] T033 [P] [US2] Write the unit tests `tests/unit/pipedrive-notes.test.ts` (`// covers FR-009, FR-010, US2 scenarios 2–4, edge cases`):
  - `targetOf`: deal over person over organisation; lead only → `lead`; nothing → `project`;
  - `noteFromPipedrive`: empty after markup → "Empty once its formatting is removed."; 100,001 characters →
    "Longer than 100,000 characters."; 50,000 characters → imported whole (spec Clarifications);
  - `notePreview`: the first 60 characters plus "…".
- [ ] T034 [US2] Write `tests/integration/pipedrive-notes.test.ts` (`// covers FR-009, FR-010, FR-013, US2 scenarios 1–5, SC-003, SC-004, SC-006`)
  with the spec's 50-note set (`seedNotesSet(fake)` in `pipedrive-helpers.ts`). Import People, Organisations, Deals
  and Notes, then assert:
  - **Placement**: each note on the right timeline with its text, author and `created_at`. A deal + person note → one
    row, on the deal, shown once on the person's timeline through the deal.
  - **Skipped**: a note on a person not imported → not imported, with "Its person 'No Name Fake' was not imported.",
    and no link row. "… notes on Pipedrive leads: not imported." is counted.
  - **Author fallback**: a note by Jane Fake → by the importer, counted in Jane's owner line.
  - **Mentions**: a note with an @-mention → text "@Jane Fake", and no `note_mentions` row. The unread count of every
    user is unchanged.
  - **Edit and delete**: `editNote` and `deleteNote` by a teammate who can see the record work.
  - **Archived**: a note on an archived linked organisation is imported onto it (spec Clarifications).
  - **Private**: a note on a private person of Margaret Fake, imported by Linus Fake → counted "1 note on private
    records of other owners imported." and not named.

### Implementation for User Story 2

- [ ] T035 [P] [US2] Add `listNotes(token, { start, limit })` (v1, `sort=id ASC`) and
  `listActivityTypes(token)` to `src/server/pipedrive/api.ts`. `PdNote` follows contracts/pipedrive-api.md.
- [ ] T036 [P] [US2] Extend `fake-pipedrive.ts`:
  - `notes`, `addNote` and `deleteNote` (sets `active_flag` false);
  - `/v1/notes` with `start` / `limit` / `sort=id ASC` and `additional_data.pagination`;
  - `activityTypes`, with the default `call`, `meeting`, `task`, `deadline`, `email` and `lunch`, and
    `/v1/activityTypes`;
  - only properties the Zenika file declares (T032 catches the rest).
- [ ] T037 [US2] Add `targetOf`, `noteFromPipedrive(n)` (using `htmlToText`; limits "1..100,000 characters") and
  `notePreview` to `deal-rules.ts`. Add `planNotePage(items, lookups)` to `records-page.ts`:
  - **Targets**: through the deal, person and organisation links. No link → the `pipedrive_*_not_imported` reason
    (name from the report's `notImported` label, else `#id`). A null link → `pipedrive_target_deleted`.
  - **Elsewhere**: on a lead or project → `elsewhere` counter.
  - **Author**: through `ownerOf`.
  - **Private counter**: `privateOn.notes`, from the targets' privacy loaded in the transaction (research.md §9).
- [ ] T038 [US2] In `imports.ts`:
  - `count_notes` pages v1 `/notes` 500 at a time, counting `active_flag` true;
  - `notes` fetches 200 (cursor = `next_start` as text);
  - `saveNotes` locks as for people, loads the links of the page's deal, person and organisation ids, the targets'
    `private` / `created_by` / `owner_id` and the users, then runs `planNotePage`;
  - it bulk inserts `timeline_events` (`kind 'note'`, the one target column, `body`, `actor_id`, `created_at`) with
    `newIds(db, "timeline_events", n)`, then the links (kind `note`, `note_id`);
  - no `note_mentions`;
  - then the cursor, `notes_done` and `notes_total`.
- [ ] T039 [US2] Make T032–T034 pass.

**Checkpoint**: US1 and US2 work together.

---

## Phase 5: User Story 3 - Import activities with their dates, status and assignee (Priority: P1)

**Goal**: calls, meetings and tasks (and other types as tasks) with due dates in UK time, done or not, the right
assignee, the right links, and no notification.

**Independent Test**: spec US3 Independent Test (60 activities).

### Tests for User Story 3

- [ ] T040 [P] [US3] Extend `tests/unit/pipedrive-fake.test.ts`: through `checkedFetch`, `GET /api/v2/activities?sort_by=subject`
  and `GET /api/v2/activities?include_fields=notes` must throw (the v2 schema, T014). `GET /api/v2/activities?sort_by=id&sort_direction=asc&limit=200`
  passes, and a fake activity answer with an undeclared property `assignee_id` throws.
- [ ] T041 [P] [US3] Write the unit tests `tests/unit/pipedrive-activities.test.ts` (`// covers FR-011, FR-012, US3 scenarios 1–2, edge cases`):
  - `ukFromUtc`: "2026-01-15" "09:30" → "2026-01-15" "09:30"; "2026-07-15" "09:30" → "10:30"; "2026-07-15" "23:30" →
    "2026-07-16" "00:30".
  - `durationMinutes`: "00:07" → 10, "01:00" → 60, "24:00" → 1440, "24:05" → the warning, "" → null, a duration
    without a due time → the warning.
  - `activityFromPipedrive`:
    - "deadline" → `task` plus a type counter;
    - an empty subject → refused with the activity form's message;
    - 201 characters → refused;
    - no due date → "No due date.";
    - a note of 10,001 characters → left out with a warning;
    - done → `done_at` = `marked_as_done_time`, `done_by` = assignee;
    - `assigned_by` = the assignee.
- [ ] T042 [US3] Write `tests/integration/pipedrive-activities.test.ts` (`// covers FR-011–FR-013, US3 scenarios 1–6, SC-003, SC-006`)
  with the 60-activity set (`seedActivitiesSet(fake)`), importing all of People, Organisations, Deals and Activities.
  Assert:
  - **Values**: type, subject, due date and time, duration, note, links and assignee of each; "14 'deadline'
    activities imported as tasks.".
  - **Done**: done ones appear on the timelines at `done_at`.
  - **Last contacted**: a done call raises its person's Last contacted to `least(due, done_at)`, and an earlier one
    never lowers it.
  - **Planned**: planned ones are on the Activities list (`src/server/activities/list.ts`) as Overdue / Today / planned
    for a fixed `now`. The deal's `nextActivities` / `cardLine` show its next date.
  - **Not imported**: an activity on a deal not imported → listed with its subject and reason. One on nothing →
    imported unlinked. One on a lead → counted.
  - **No notification**: an activity assigned to Margaret Fake gives no notification
    (`src/server/notifications.ts` count unchanged) and is on her list.
  - **Archived**: an activity on an archived deal is imported onto it.

### Implementation for User Story 3

- [ ] T043 [P] [US3] Add `listActivities(token, { cursor, limit })` (v2, `sort_by=id`, `sort_direction=asc`) to
  `api.ts`. Extend `fake-pipedrive.ts` with `activities`, `addActivity` and `deleteActivity`, and the
  `/api/v2/activities` cursor answers with declared properties only.
- [ ] T044 [US3] Add `ukFromUtc(date, time)` (through `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London" })`),
  `durationMinutes(text)` and `activityFromPipedrive(a, ctx)` to `deal-rules.ts` (research.md §7). They reuse
  `SUBJECT_MAX` (200), `ACTIVITY_NOTE_MAX` (10,000) and `ukInstant` from `src/server/activities/rules.ts`. The
  duration must satisfy `duration_minutes between 5 and 1440 and duration_minutes % 5 = 0` and needs a due time.
- [ ] T045 [US3] Add `planActivityPage(items, lookups)` to `records-page.ts`:
  - links through deal, person and organisation (any set but not brought in → not imported, with the reason);
  - a lead / project only → `elsewhere`;
  - nothing → unlinked;
  - the type counters (named from the snapshot's `activityTypes`);
  - the owner fallback through `ownerOf`;
  - `privateOn.activities`.
- [ ] T046 [US3] In `imports.ts`:
  - `prepare` reads `listActivityTypes` when `want_activities`;
  - `count_activities` counts 500 at a time;
  - `activities` fetches 200;
  - `saveActivities` bulk inserts `activities` with `newIds(db, "activities", n)`: `created_by` = the importer,
    `created_at` = add_time, `assigned_by` = `assignee_id`, `assigned_at` = add_time;
  - then the links (kind `activity`);
  - then one update for the done calls and meetings with a person:
    `update persons p set last_contacted_at = greatest(coalesce(p.last_contacted_at, '-infinity'), v.at) from unnest(...) v(id, at) where p.id = v.id`,
    with `at = least(ukInstant(due), done_at)`;
  - then the cursor, `activities_done` and `activities_total`.
- [ ] T047 [US3] Make T040–T042 pass.

**Checkpoint**: deals, notes and activities import together.

---

## Phase 6: User Story 5 - The report and repeats cover the new kinds (Priority: P1)

**Goal**: progress in order, a complete report, and never twice across repeats, resumes and two users. Files are
covered in Phase 7 (T062).

**Independent Test**: spec US5 Independent Test, scaled down for speed (300 people, 80 organisations, 200 deals, 1,000
notes, 800 activities) with `slowDownEvery(7)`.

### Tests for User Story 5

- [ ] T048 [P] [US5] Write `tests/integration/pipedrive-resume-records.test.ts` (`// covers FR-016, FR-017, FR-018, US5 scenarios 1, 3–5, SC-002`):
  - **Run, stop, continue**: run some parts, stop the runner, `continueImport`, finish. Each Pipedrive deal, note and
    activity has exactly one link and one CRM row. The imported count of each kind = the fake's records − those
    listed as not imported.
  - **Run again**: everything counts as already imported, with no new rows.
  - **Deleted between parts**: delete a deal in the fake between two parts → no line for it.
  - **Deleted in the CRM**: delete an imported deal in the CRM, then run again → it is not added back, and its new
    notes are listed with "Its deal was deleted in the CRM.".
  - **Skipped, then brought in**: a note skipped for a missing person (no name) is imported once the person is given a
    name in the fake.
  - **Failed part**: make a note page's transaction fail (`failNext` on the next call after the fetch, or a forced
    error through `onSaveForTests`) → nothing of that page is saved, and continuing saves it once.
- [ ] T049 [P] [US5] Extend `tests/integration/pipedrive-concurrency.test.ts` (`// covers FR-016, SC-002`): two users
  of one fake company import People, Organisations, Deals, Notes and Activities with interleaved parts. There is one
  CRM deal, note and activity per Pipedrive one, and one set of created pipelines.
- [ ] T050 [P] [US5] Write `tests/integration/pipedrive-report.test.ts` (`// covers FR-018, FR-019, FR-021, US5 scenario 2, edge cases`):
  - **Progress**: `getImportView` lists progress in the order Organisations, People, Deals, Notes, Activities.
    `pipedrive_paused` lists them in the same order.
  - **Report**: the counts per kind; "// NOT IMPORTED" items for each kind, with labels as given (an HTML-like deal
    title `<a href="https://evil.example">Click</a>` is plain text in `renderToStaticMarkup(ReportStep)`, with no
    `<a` from it); the elsewhere and type lines; the links to `/deals` and `/activities`.
  - **Privacy**: a private deal of Margaret Fake whose notes are skipped is named "a private deal" for Linus Fake.

### Implementation for User Story 5

- [ ] T051 [US5] Finish `reportLines` in `report.ts` in this fixed order: owners, private people, private deals, private
  notes / activities / files, owner-only organisations, lists (with `deal_label`), fields, choices, activity types as
  tasks, elsewhere (notes, activities, files × lead, project, email), linked, unsubscribed. Then make T048–T050 pass,
  fixing the engine where a test shows a gap.

**Checkpoint**: all P1 stories work and are repeat-safe.

---

## Phase 7: User Story 4 - Import files onto the right records (Priority: P2)

**Goal**: files copied byte for byte into the CRM file store, listed once on the right record, with nothing
half-stored, and over 25 MB left out.

**Independent Test**: spec US4 Independent Test (12 files) with the fake file store.

### Tests for User Story 4

- [ ] T052 [US4] Download `storage_v0_openapi.json` from
  `https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json`
  at commit `aa0fb9e84b9d128342f0127c7650d8cc5b240202` into `.factory/schemas/` (`git init -q /tmp/supabase && git -C /tmp/supabase fetch -q --depth 1 https://github.com/supabase/supabase aa0fb9e84b9d128342f0127c7650d8cc5b240202 && git -C /tmp/supabase show FETCH_HEAD:apps/docs/spec/storage_v0_openapi.json > .factory/schemas/storage_v0_openapi.json`),
  and make the fake of Supabase Storage refuse a request that the schema refuses: a test sends a wrong field and must
  fail. In `tests/unit/storage-fake.test.ts` (create it, or extend the SF-116 test of `tests/fakes/storage.ts`), each
  of these must throw through the checking wrapper:
  - a sign-upload `POST` with an undeclared JSON body property `upsert_mode`;
  - an `object/info` call on an undeclared path.

  The import's call sequence passes: `createSignedUploadUrl`, the `putSigned` PUT with
  `{ timeoutMs: 20_000 }`, `objectInfo` and `removeObjects`.
- [ ] T053 [P] [US4] Extend `tests/unit/pipedrive-fake.test.ts` for downloads:
  - `GET /v1/files/7/download` → 200 `application/octet-stream` with the bytes, checked only for its content type;
  - with `redirectDownloads(true)` → 302 to `files.fake-pipedrive.invalid`;
  - a follow-up request carrying `x-api-token` throws;
  - `GET /v1/files?sort=id%20ASC&start=0&limit=50` passes the Zenika file.
- [ ] T054 [P] [US4] Write the unit tests `tests/unit/pipedrive-files.test.ts` for `fileCheck` and `formatMb`
  (`// covers FR-015, US4 scenarios 3–4`):
  - Sizes: 26,214,400 bytes is allowed; 27,367,014 → "Over 25 MB (26.1 MB).", using `formatMb` (one decimal,
    1 MB = 1,048,576 bytes); 0 → "Empty file.".
  - A 256-character name → the SF-116 `file_name_too_long` message.
  - `remote_location: "googledrive"` → "A linked document, not an uploaded file.".
  - `mail_message_id` set (even with a `deal_id`) → the email counter.
  - Lead only → the lead counter.
  - `active_flag` false → passed over without a line.
- [ ] T055 [US4] Write `tests/integration/pipedrive-files.test.ts` (`// covers FR-003, FR-014, FR-015, FR-017, FR-020, US4 scenarios 1–5, SC-004`),
  with the fake Storage installed (`tests/fakes/storage.ts`) and the 12-file set (`seedFilesSet(fake)`: PDF, PNG,
  `.docx`, 26 MB from a repeated byte, empty, on a person not imported, attached to an email, a Drive link, and others
  on a deal, person and organisation). Assert:
  - **Copied files**: each copied file is in `listFiles` of its record, with its name, size and `kind`, `added_at` =
    add_time and `added_by` matched. The FILE event has the same date. The bytes in the fake Storage are identical
    to the fake Pipedrive's.
  - **Left out**: the 26 MB file → "Over 25 MB (26.1 MB).", and the Storage object count is unchanged. The others are
    listed or counted by research.md §8.
  - **Redirects**: with `redirectDownloads(true)`, everything still works and no request to the file host carried the
    token.
  - **Start check**: Storage `down()` before the start, with Files ticked → `startImport` returns
    `files_unreachable` and no import row exists; also with `storageConfig()` off.
  - **Failure mid-part**: Storage down during a file part → the import is paused with `files_unreachable`, there is no
    `files` row for that file, and `file_cleanup` holds its path. After Storage is back and `continueImport`, exactly
    one `files` row exists, and `sweepFileCleanup` removes the orphan object.
  - **Duplicate**: a stale part (cursor moved by another tab) leaves the uploaded path in `file_cleanup` with
    `due_at <= now()`, and no second row.
- [ ] T056 [P] [US4] Extend `tests/integration/pipedrive-choose.test.ts`: ticking `files` with no Storage set up →
  `?error=files_unreachable` from `startPipedriveImportAction` (called with a `FormData`) shows "Files can't be reached
  right now. Try again in a minute.".

### Implementation for User Story 4

- [ ] T057 [P] [US4] Add `listFiles(token, { start, limit })` (v1, `sort=id ASC`) and
  `downloadFile(token, id, maxBytes)` to `api.ts`:
  - `redirect: "manual"`;
  - on a 3xx, fetch `Location` once with **no** `x-api-token`;
  - 404 / 410 → `"gone"`;
  - a streamed read capped at `maxBytes` → `"too_large"`;
  - a 20-second timer, like `get()`.

  Extend `fake-pipedrive.ts` with `files` (metadata and bytes), `addFile`, `deleteFile`, `/v1/files`,
  `/v1/files/{id}/download` and `redirectDownloads(on)`, serving `https://files.fake-pipedrive.invalid/<id>` and
  answering 400 when the token header is present.
- [ ] T058 [US4] Add `fileCheck(f)`, `formatMb(bytes)` and `planFileItem(f, lookups)` to `deal-rules.ts` /
  `records-page.ts` (research.md §8). They reuse `validateFile`, `MAX_FILE_BYTES` (26,214,400) and `MAX_FILE_NAME`
  (255) from `src/server/files/rules.ts`.
- [ ] T059 [US4] In `imports.ts`, the start check: when `files` is ticked, `startImport` returns
  `{ error: "files_unreachable" }` if `storageConfig().mode === "off"`, or if
  `objectInfo("files/pipedrive-import-check")` throws `StorageUnreachable`. `startPipedriveImportAction` redirects to
  `?error=files_unreachable`, and `ChooseStep` shows the message.
- [ ] T060 [US4] In `imports.ts`, the `count_files` step (500 at a time, `active_flag` true) and the `files` step.
  The cursor is `"<start>:<index>"`, and a page of 50 is fetched each part. For each item from `index`, while under
  15 s elapsed and 25 MB copied:
  1. **Check**: `planFileItem` against the links read just before (outside a transaction). Skipped and already items
     are collected.
  2. **Download**: `downloadFile(token, id, MAX_FILE_BYTES)`. `"gone"` → "No longer in Pipedrive.", `"too_large"` →
     the size reason.
  3. **Queue**: `path = newStoragePath()`, then
     `insert into file_cleanup (storage_path, due_at) values (path, now() + interval '1 hour')`.
  4. **Upload**: `createSignedUploadUrl(path)`, then
     `putSigned(url, bytes, uploadContentType(name), { timeoutMs: 20_000 })`; `false` → `StorageUnreachable`.
  5. **Save**, in one `sql.begin()`:
     - lock the import row and check the step, cursor and state;
     - `lock table pipedrive_links in share row exclusive mode`, then re-check the link is absent and the target exists;
     - `insertFile(db, uploader, target, { name, size: bytes.length, kind: fileKind({ head: bytes.subarray(0, 16), name, storedType: uploadContentType(name) }), path, addedAt })`;
     - the link (kind `file`, `file_id`);
     - `delete from file_cleanup where storage_path = path`;
     - merge the collected report items and move the cursor past the file.

     A stale or duplicate file → `update file_cleanup set due_at = now() where storage_path = path`.

  At the end of the page or the budget, one transaction saves the collected items and the cursor.
  `StorageUnreachable` anywhere → `pause(userId, id, "files_unreachable")`. `sweepFileCleanup()` runs after each part.
  There is never a Storage or Pipedrive call inside `sql.begin()`.
- [ ] T061 [US4] Add `privateOn.files` to the file plan, and `elsewhere` for emails, leads and projects. Make T052–T056
  pass.
- [ ] T062 [US4] Extend `tests/integration/pipedrive-resume-records.test.ts` and `pipedrive-concurrency.test.ts` with
  30 files (`// covers FR-016, FR-017, US5 scenario 5, SC-002`): after a stop and continue mid-files, a repeat, and two
  users at once, each Pipedrive file is in `files` exactly once, and no Storage object exists without a `files` row
  once `sweepFileCleanup` has run (with `due_at` moved back by the test).

**Checkpoint**: every story works; the whole import is repeat-safe.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T063 [P] Extend the development instance `fakePipedrive()` in `src/server/pipedrive/fake-pipedrive.ts` with the
  small hand-testing set of contracts/pipedrive-api.md § The fake:
  - 2 pipelines;
  - 30 deals (open, won, lost, owner-only, USD, archived);
  - 40 notes (HTML and a mention, one on a lead);
  - 30 activities (each type, a "deadline");
  - 6 files (PDF, PNG, 26 MB, empty, Drive link, email attachment).

  Use clearly fake names. Extend `tests/integration/pipedrive-dev-fake.test.ts` to import it once without error.
- [ ] T064 [P] Extend `tests/integration/pipedrive-access.test.ts` (`// covers spec edge case "not signed in or deactivated"`):
  a deactivated user's `runPart` returns `stop` and imports no deal, note, activity or file. `startImport` with the
  four new kinds still needs a connection.
- [ ] T065 [P] Extend `tests/integration/pipedrive-markup.test.ts`: a deal title, note, activity subject and file name
  of `<a href="https://evil.example">Click</a>` are shown as text on the deal page, timeline, Activities list and
  "// FILES" (`renderToStaticMarkup`). The file downloads under `safeDownloadName`.
- [ ] T066 [P] Update `README.md` § "Pipedrive import":
  - what is imported now (deals, notes, activities, files; emails not);
  - pipelines and stages created by any import;
  - files copied into the file store, with the 25 MB limit;
  - the fake data set;
  - the `test:schemas` line naming the third Pipedrive schema.
- [ ] T067 [P] Update `AGENTS.md` § Layout:
  - on the `src/server/pipedrive/` line:
    - `html.ts`, `deal-rules.ts` and `records-page.ts`;
    - the steps and kinds;
    - the file copy rule (the path queued in `file_cleanup` before the upload, listed in the commit that takes it off
      the queue);
    - the token never sent on a download redirect;
    - `pipedrive_links` now covering deal, note, activity and file;
  - on the tests line: `tests/fakes/pipedrive.ts` checks v1 against the Zenika file, else `pipedrive_v1_full_openapi.yml`;
  - on the import UI line: `KindChoice.tsx` (client).
- [ ] T068 Add these lines at the end of `docs/DECISIONS.md`, exactly:
  - `- Any user's Pipedrive import creates the pipelines and stages the CRM lacks (matched by name, never renaming, reordering or deleting one); the only exception to admins-only pipelines (SF-122)`
  - `- In the Pipedrive import, ticking Deals, Notes, Activities or Files ticks People and Organisations, which stay ticked (SF-122)`
  - `- Pipedrive activities of a type the CRM does not have come in as tasks, counted per Pipedrive type in the report (SF-122)`

  Add also any factory choice of spec.md § Clarifications the Plan Review confirmed. There is no "Departs from
  blueprint" line: there are no blueprints.
- [ ] T069 Run `npm run test:schemas && npm test && npm run typecheck` with `APP_ENV=test` and
  `DATABASE_URL=postgres://postgres@localhost:5432/crm_test`. Fix every failure and keep the complete failure output
  in the session.
- [ ] T070 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its
  schema) and `## Schemas` (each schema's GitHub URL at its commit).
  - **Services**:
    - Pipedrive API v2: fake `src/server/pipedrive/fake-pipedrive.ts` via `tests/fakes/pipedrive.ts`, schema
      `pipedrive_v2_openapi.json`.
    - Pipedrive API v1 (Zenika copy): same fake, schema `pipedrive_v1_openapi.yml`.
    - Pipedrive API v1 (full copy: participants, download): same fake, schema `pipedrive_v1_full_openapi.yml`.
    - Supabase Storage: `tests/fakes/storage.ts`, schema `storage_v0_openapi.json`.
    - Supabase Postgres: a real local Postgres, no schema (the pooler documentation's limits).
  - **Schemas**:
    - https://github.com/soenneker/soenneker.pipedrive.openapiclient/blob/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json
    - https://github.com/Zenika/zenpipe/blob/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml
    - https://github.com/konfig-sdks/openapi-examples/blob/161ab49c45e45825ca3832945c59a3ba904321ba/pipedrive/openapi.yaml
    - https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json

  Keep the existing lines of the file (Google, Storage, Pipedrive from SF-117) and update them rather than duplicate.

---

## Dependencies & Execution Order

- **Setup (T001–T004)** → **Foundational (T005–T013)** → the stories.
- **US1 (T014–T031)** first: the deals step creates the pipelines and deal links that notes, activities and files
  attach to.
- **US2 (T032–T039)** and **US3 (T040–T047)** each need US1 (their targets include deals). They can go in either
  order, or in parallel by different people, apart from their shared edits of `imports.ts`, `records-page.ts` and
  `deal-rules.ts`.
- **US5 (T048–T051)** needs US1–US3.
- **US4 (T052–T062)** needs US1 (targets) and the US5 report pieces; T062 extends the US5 tests.
- **Polish (T063–T070)** last. T070 is the last task.

Within a story: the schema task, then the other tests (failing), then calls and fake, then pure rules, then the engine,
then the UI.

## Parallel Opportunities

- Setup: T002 and T004 beside T001 / T003.
- Foundational: T005, T006, T007, T010, T011 and T013 in parallel; T008 → T009 → T012 in order.
- US1: T016, T017, T018 and T020 in parallel after T014 / T015; T021 and T022 in parallel.
- US2: T033 beside T032; T035 and T036 in parallel.
- US3: T040 and T041 in parallel; T043 beside T044.
- US5: T048, T049 and T050 in parallel.
- US4: T053, T054 and T056 in parallel after T052; T057 beside T058.
- Polish: T063–T067 in parallel.

### Parallel example: User Story 1

```text
Task: "T017 unit tests for dealFromPipedrive in tests/unit/pipedrive-deal-rules.test.ts"
Task: "T018 unit tests for planPipelines in tests/unit/pipedrive-pipelines.test.ts"
Task: "T020 choose step tests in tests/integration/pipedrive-choose.test.ts"
Task: "T021 deal calls in src/server/pipedrive/api.ts"   # beside T022 (fake-pipedrive.ts)
```

## Implementation Strategy

1. **MVP**: Setup, Foundational, then US1. Deals import into matched or created pipelines; validate with T019.
2. Add US2 (notes) and US3 (activities); each is validated by its integration test.
3. Add US5: repeat, resume, concurrency and the report across the kinds.
4. Add US4 (files) last. It is P2, and it adds the Storage copy and its failure paths.
5. Polish: the development fake, the docs, `docs/DECISIONS.md`, the full test run, and the test recipe (T070).
