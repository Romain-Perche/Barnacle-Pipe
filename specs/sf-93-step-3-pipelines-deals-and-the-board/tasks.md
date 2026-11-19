---

description: "Tasks for SF-93 Pipelines, deals and the board"
---

# Tasks: Pipelines, deals and the board

**Input**: Design documents from `/specs/sf-93-step-3-pipelines-deals-and-the-board/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-003 to SC-007): Vitest unit tests, Vitest integration tests against a real local Postgres (`crm_test`), Playwright browser tests through the fake Google login. Each test file names what it covers (`// covers FR-009, US1 scenario 1`). Write each story's tests first and see them fail before the code.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. Tables, visibility, validation and state changes are in `data-model.md`; pages, address parameters and actions in `contracts/routes.md`; decisions in `research.md`. No new dependency (`dependencies.json` is `[]`): do not add any package (drag and drop uses native HTML drag events, research.md §1). No blueprint applies (`blueprints.json` is `[]`), so there are no blueprint tasks and no `Departs from blueprint` line.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6 from spec.md
- Paths are from the repository root (single Next.js project, see plan.md § Project Structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The schema and the test plumbing.

- [x] T001 First run `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'timeline_events'::regclass` on a migrated database to confirm the default names `timeline_events_kind_check` and `timeline_events_check` (num_nonnulls(person_id, organisation_id) = 1). Then create `migrations/0004_pipelines_deals.sql` (numbered after SF-92's `0003_private_owner_handover.sql`) exactly as `data-model.md` § Tables: `pipelines` (`name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100)`, `position int not null`, `created_at`; `unique index pipelines_name_key on pipelines (lower(name))`); `stages` (`pipeline_id bigint not null references pipelines (id) on delete cascade`, same name check, `position int not null`; `unique index stages_name_key on stages (pipeline_id, lower(name))`; index `(pipeline_id, position)`); `deals` (`title text not null check (title = btrim(title) and title <> '' and char_length(title) <= 200)`, `value_pence bigint null check (value_pence between 0 and 999999999999)`, `stage_id bigint not null references stages (id)` **with no cascade**, `stage_entered_at timestamptz not null default now()`, `organisation_id … references organisations (id) on delete set null`, `person_id … references persons (id) on delete set null`, `owner_id`/`created_by bigint not null references users (id)`, `expected_close_on date null`, `private boolean not null default false`, `created_at`, `archived_at timestamptz null`, `version int not null default 1`; indexes `(stage_id, stage_entered_at desc) where archived_at is null`, `(stage_id)`, `(organisation_id)`, `(person_id)`, `(owner_id)`, `(created_by) where private`); `deal_stage_periods` (`deal_id … on delete cascade`, `stage_id … references stages (id) on delete set null`, `stage_name text not null`, `pipeline_name text not null`, `entered_at timestamptz not null default now()`, `left_at timestamptz null`, `moved_by bigint null references users (id)`; `unique index deal_stage_periods_open_key on deal_stage_periods (deal_id) where left_at is null`; index `(deal_id, entered_at)`); the `timeline_events` changes (`deal_id … references deals (id) on delete cascade`, `from_stage text`, `to_stage text`, `cause text null check (cause in ('stage_deleted', 'pipeline_deleted'))`, kind check recreated as `check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved'))` (keeps SF-92's `'handed_over'`), target check recreated as `timeline_events_target_check check (num_nonnulls(person_id, organisation_id, deal_id) = 1)`, index `timeline_events_deal_idx (deal_id, created_at desc)`). `alter table … enable row level security` after each of the 4 `create table`. Only statements allowed in a transaction.
- [x] T002 [P] Extend `tests/support/reset.ts` (`resetAppTables`): truncate `deal_stage_periods, deals, stages, pipelines` with the other tables (restart identity cascade); keep the six starting lead sources
- [x] T003 [P] Extend `.factory/run/reset-db.sh` to truncate the four new tables too, so the AI review's scenario scripts start clean
- [x] T004 [P] Add `pipelines`, `stages`, `deals`, `deal_stage_periods` to the expected list in `tests/integration/rls.test.ts`; extend `tests/integration/migrate.test.ts` to check, on a fresh database, that a `timeline_events` row with both `deal_id` and `person_id` is refused and that deleting a stage that still has a deal fails (FK, SC-007)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure rules, money, messages, visibility, timeline, navigation and read functions every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 [P] Unit tests in `tests/unit/deals-rules.test.ts` for `src/server/deals/rules.ts` (research.md §2, data-model.md § Validation): `parseMoney` ("" → null; "4000" → 400000; "£4,000.50" → 400050; " 4000.5 " → 400050; "4,000" → 400000; "0" → 0; "9999999999.99" → 999999999999; refused with `deal_value_invalid`: "-1", "abc", "4.001", "4,00", "£", "10000000000", "1e3"); `validateDeal` (title trimmed, empty → `deal_title_required`, 201 chars → `deal_title_too_long`; expected close empty or a real `YYYY-MM-DD`, "2026-02-30" → `deal_close_date_invalid`); `validatePipelineName` (trimmed, empty → `pipeline_name_required`, ≤ 100 chars); `changedDealFields` returns labels `Title`, `Value`, `Organisation`, `Person`, `Owner`, `Expected close date`, `Private` in that order, only for fields that changed
- [x] T006 [P] Unit tests in `tests/unit/format.test.ts` for `formatMoney`: null → "—", 0 → "£0", 400000 → "£4,000", 400050 → "£4,000.50", 1250000 → "£12,500", 999999999999 → "£9,999,999,999.99"; and in `tests/unit/messages.test.ts`: every code of contracts/routes.md § Messages exists with its exact text, `templates.deal_count(1)` = "1 deal", `(0)` = "0 deals", `templates.deal_deleted("Fakeco website")` = "Fakeco website was deleted."
- [x] T007 Implement `src/server/deals/rules.ts` (`parseMoney`, `validateDeal`, `validatePipelineName`, `DEAL_FIELDS`, `changedDealFields` reusing `changedFields` from `src/server/records/rules.ts`, types `DealForm`, `DealFields`) and `formatMoney(pence: number | null)` in `src/server/format.ts` (en-GB GBP, 0 fraction digits when whole pounds else 2) until T005–T006 pass
- [x] T008 [P] Add to `src/server/messages.ts` every code and template in contracts/routes.md § Messages (`deal_title_required` … `pipeline_delete_no_target`; templates `deal_deleted`, `deal_no_longer_visible`, `deal_count`, `pipeline_has_deals`, `pipeline_delete_confirm`); extend `fieldMessage` only if a deal field error carries a name (`organisation_exists` already does)
- [x] T009 [P] Add `visibleDeal(db, viewerId, alias = "d")` → `(not d.private or d.created_by = viewerId or d.owner_id = viewerId)` to `src/server/records/visibility.ts`, next to `visiblePerson`, with a comment that every `deals` read uses it
- [x] T010 Extend `src/server/records/timeline.ts`: `EventKind` gains `"moved"`; `Target` gains `{ dealId }`; `recordEvent` accepts `fromStage`, `toStage`, `cause` (`"stage_deleted" | "pipeline_deleted"`); `readTimeline(viewerId, { dealId })` returns nothing unless `exists (select 1 from deals d where d.id = e.deal_id and <visibleDeal>)`; `TimelineEvent` gains `fromStage`, `toStage`, `cause`. Extend `src/app/(app)/records/Timeline.tsx` with a `heading` prop (default "TIMELINE"; deals pass "HISTORY") and the line "Moved from <from> to <to> by <name>" plus " (stage deleted)" / " (pipeline deleted)"; people/organisation timelines unchanged (run their existing tests)
- [x] T011 [P] Add `{ href: "/deals", label: "Deals" }` right after Home in `mainNav` and `{ href: "/admin/pipelines", label: "Pipelines" }` at the end of `adminNav` in `src/app/(app)/nav.ts`; update `tests/e2e/layout.spec.ts` (everyone sees Deals; only admins see Pipelines, covers FR-018)
- [x] T012 Read functions in `src/server/deals/pipelines.ts`: `listPipelines()` (id, name, `order by position, id`), `getPipelineWithStages(id)` (stages `order by position, id` with the count of deals, archived included, per stage), `stageChoices()` (every stage grouped by pipeline in order, for `StageSelect` and the "Move to" picker)

**Checkpoint**: Foundation ready — stories can start.

---

## Phase 3: User Story 1 - See a pipeline as a board (Priority: P1) 🎯 MVP

**Goal**: `/deals` shows one pipeline's board: columns in stage order with name, "<n> deals · £total", rounded cards (title, organisation, person, value), a pipeline picker kept in the address.

**Independent Test**: With fake data loaded, open Deals, pick "Sales", check every column's count and total and every card's lines.

### Tests for User Story 1

- [x] T013 [US1] Outside service Supabase Postgres (no public schema on GitHub, plan.md § Outside services): there is no fake; the tests use a real local PostgreSQL 17 that follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres. The new deal code copies the transaction-mode pooler's limits: `prepare: false` (existing client), no session state (`set`, `listen`, session advisory locks), every multi-statement change inside one `sql.begin()` transaction, at most `max: 5` connections. Add a check in `tests/integration/migrate.test.ts` that `0004_pipelines_deals.sql` applies on a fresh database inside one transaction and that `grep` finds no `set `/`listen`/`pg_advisory_lock(` in `src/server/deals/`
- [x] T014 [P] [US1] Integration tests in `tests/integration/board.test.ts` for `getBoard(viewerId, pipelineId | null)` (covers FR-009, FR-010, FR-013, SC-004, US1 scenarios 1, 2, 4, edge cases): no pipeline id or unknown id → first pipeline by position; columns in stage order; each column's count and `sum(value_pence)` equal the visible non-archived deals of that stage (archived deal excluded, deal without value counts 0); cards ordered by `stage_entered_at desc, id desc`; card has title, organisation name, person name, value; a deal whose person is private to another user shows no person; empty stage → 0 / 0; a pipeline with no stages → no columns; no pipelines → `null`
- [x] T015 [P] [US1] Integration test in `tests/integration/board-performance.test.ts` (covers SC-003): a pipeline with 10 stages and 500 open deals; `getBoard` returns in < 500 ms on the local database, and a column with 200 deals reports count 200 and the sum of all 200
- [x] T016 [P] [US1] Integration test in `tests/integration/seed.test.ts` (covers FR-021): after `runSeeders` twice the pipelines Sales, Ambassadors, Fractional CTO, Exec Dinner and "Ada Fake's pipeline" exist once each in that order, each with 3–7 stages; ≥ 40 deals; several owners; deals with and without value, organisation, person; Sales "Closing" is empty; ≥ 1 archived and ≥ 1 private deal (created by Ada Fake); every deal has exactly one open stage period and an `added` event; nothing doubled by the second run
- [x] T017 [P] [US1] Playwright test in `tests/e2e/board.spec.ts` (covers US1 scenarios 1–5, FR-020): Deals opens the first pipeline; column headers show "<name>", "<n> deals · £…"; a seeded card shows title, organisation, person, value and no "No next activity"; picking "Ambassadors" changes the address to `?pipeline=<id>` and a reload keeps it; empty stage reads "No deals in this stage."; after deleting all pipelines (reset with `NO_SEED`-style setup) "No pipelines yet." with `[ ADD PIPELINE ]` for an admin and no link for a non-admin; `?pipeline=abc` shows the first board and never the text "abc"

### Implementation for User Story 1

- [x] T018 [US1] `getBoard` in `src/server/deals/deals.ts` (research.md §7): three queries in parallel — pipelines for the picker; stages of the chosen pipeline with `count(*)::int` and `coalesce(sum(d.value_pence), 0)::bigint` of deals `where d.archived_at is null and <visibleDeal>`; all cards of the pipeline (`left join organisations o`, `left join persons p on p.id = d.person_id and <visiblePerson(p)>`), each with id, title, value, organisation {id, name}, person {id, name} or null, private, version, stageId. Convert bigint strings with `Number()`
- [x] T019 [US1] Fake data `src/seed/deals.ts` (data-model.md § Fake data, research.md §10) and register `{ name: "deals", run: seedDeals }` after people in `src/seed/index.ts`: pipelines inserted `on conflict ((lower(name))) do nothing` with positions in order, stages only for a pipeline just created, deals skipped when the title exists, owners Ada/Grace/Linus/Margaret Fake, people and organisations from `src/seed/people.ts`; write stage periods (some deals with an earlier closed period and a `moved` event) and `added` events; returns "added …" / "already there …" lines like `seedPeople`
- [x] T020 [US1] `src/app/(app)/deals/page.tsx` (contracts/routes.md § Pages): `requireUser()`; `parseId` for `pipeline` and `open`; head `// DEALS`, pipeline name as `h1`, picker GET form "Pipeline: <name>" (`<select name="pipeline">` + `AutoSubmit` + `[ GO ]` for no JS), `[ ADD DEAL ]`; "No pipelines yet." (+ `[ ADD PIPELINE ]` → `/admin/pipelines` only for admins); "This pipeline has no stages yet."; renders `Board`
- [x] T021 [US1] `src/app/(app)/deals/Board.tsx` (`'use client'`, display only at this step): columns with header (stage name, `+` link → `/deals/new?pipeline=<p>&stage=<s>`, `templates.deal_count(n)` · `formatMoney(total)`), cards as links to `?pipeline=<p>&open=<id>` (scroll={false}), "No deals in this stage."; message texts passed in as props from the server page
- [x] T022 [US1] Board styles in `src/app/globals.css` (design A, docs/DESIGN.md): board `display: flex; overflow-x: auto`; columns fixed min width, own `overflow-y: auto` with header always visible; cards `border-radius: 8px` (the one rounded surface), `overflow-wrap: anywhere` so long titles wrap without widening the column; selected card blue outline; header line in mono; small screens stack readable

**Checkpoint**: The board shows the fake data — MVP.

---

## Phase 4: User Story 2 - Add a deal (Priority: P1)

**Goal**: `[ ADD DEAL ]` / column `+` open a form; the saved deal appears in its stage.

**Independent Test**: Add a deal to Sales "Proposal" with a new organisation name and an existing person; the card appears and the column count and total go up.

### Tests for User Story 2

- [x] T023 [P] [US2] Integration tests in `tests/integration/deals.test.ts` for `createDeal` (covers FR-005, FR-006, FR-007, US2 scenarios 1, 3–5): saved with owner = actor by default, `created_by` = actor, one open stage period (stage and pipeline names copied) and an `added` event; invalid title/value → `invalid` with `deal_title_required`/`deal_value_invalid` and nothing saved; a person with an organisation and no organisation chosen → deal linked to that organisation; a new organisation name → organisation created (or an existing one with that name ignoring case linked), as `resolveOrganisation`; a deactivated user as owner → falls back to the actor; a stage id that does not exist → `deal_stage_required`; a person the actor cannot see → no person
- [x] T024 [P] [US2] Playwright test in `tests/e2e/deals.spec.ts` (covers US2 scenarios 1–3): add "Fakeco website", 4000, organisation, person, stage "Proposal" → card first in "Proposal", count/total up; `+` on "Qualified" pre-selects Sales / Qualified; empty title and "-5" show the exact messages next to the fields and keep the typed values

### Implementation for User Story 2

- [x] T025 [US2] `createDeal(actorId, form)` and `dealFormChoices(viewerId, current)` in `src/server/deals/deals.ts` (data-model.md § State changes): one `sql.begin()`; validate; check the stage exists; `resolveOrganisation`; person accepted only if visible and not archived; FR-006; `resolveOwner`; insert deal, open period, `recordEvent({ dealId, kind: "added" })`. Choices: stages by pipeline, visible non-archived people, organisations for the picker, `ownerOptions`
- [x] T026 [P] [US2] `src/app/(app)/records/PersonPicker.tsx` (`'use client'`), built like `OrganisationPicker`: filters an embedded list of visible non-archived people, posts `personId`, `[ CLEAR ]`, no "add new"
- [x] T027 [P] [US2] `src/app/(app)/deals/StageSelect.tsx` (`'use client'`): pipeline `<select name="pipelineId">` and stage `<select name="stageId">` listing only that pipeline's stages; without JS both still post
- [x] T028 [US2] `dealFormFromData` in `src/server/records/form-data.ts`; `src/app/(app)/deals/DealForm.tsx` (`'use client'`, `useActionState`, `FieldError`, values kept on refusal, `seq` rebuild): title, value (text, placeholder "4000"), `StageSelect` (new only), `OrganisationPicker`, `PersonPicker`, owner select, expected close (`type="date"`); `src/app/(app)/deals/new/page.tsx` (`requireUser()`, `?pipeline=`/`?stage=` pre-select when valid); `createDeal` action in `src/app/(app)/deals/actions.ts` (`requireUser()` first, redirect `/deals?pipeline=<p>&open=<id>`, `revalidatePath("/deals")`)

**Checkpoint**: Deals can be added from the board.

---

## Phase 5: User Story 3 - Move deals between stages (Priority: P1)

**Goal**: Drag a card to another column, or use the drawer's "Move to"; every move is recorded.

**Independent Test**: Drag a card from "Qualified" to "Proposal", reload: still in "Proposal", counts and totals right, history shows the move.

### Tests for User Story 3

- [x] T029 [P] [US3] Integration tests in `tests/integration/deals-move.test.ts` for `moveDeal` (covers FR-007, FR-011, FR-012, US3 scenarios 1–5): a move closes the open period (`left_at` set), opens one in the new stage, sets `stage_entered_at`, `version + 1`, records `moved` with from/to names; a move to another pipeline stores "Sales · Qualified"-style names; same stage → `same`, nothing recorded; wrong `version`, wrong `fromStageId`, archived, deleted or not visible deal, or unknown target → `stale`, nothing changed; always exactly one open period per deal
- [x] T030 [P] [US3] Playwright test in `tests/e2e/board.spec.ts` (covers US3 scenarios 1–5, SC-002): drag a card from "Qualified" to "Proposal" (`locator.dragTo`) → card in the new column at once, both headers updated, still there after reload; drawer `// HISTORY` shows "Moved from Qualified to Proposal by <name>" with a UK date and time; drawer "Move to" + `[ MOVE ]` using only the keyboard moves it the same way; drop on its own column sends nothing; another session archives the deal, then dragging shows "This deal changed since you loaded the board. The board has been refreshed." and the card is gone; a failed request (route aborted with `page.route`) puts the card back and shows "The deal could not be moved. Try again."

### Implementation for User Story 3

- [x] T031 [US3] `moveDeal(actorId, { dealId, version, fromStageId | null, toStageId })` in `src/server/deals/deals.ts` (research.md §4): one transaction, lock with `for update` and `<visibleDeal>`, refuse as `stale` per T029, close/open period, update deal, `recordEvent({ dealId, kind: "moved", fromStage, toStage })`; return `{ status: "moved", version }`
- [x] T032 [US3] Actions in `src/app/(app)/deals/actions.ts`: `moveDealFromBoard(input)` (`requireUser()`, validates the ids are positive integers, returns the result object, `revalidatePath("/deals")`) and `moveDeal(formData)` for the drawer (redirect `/deals?pipeline=<new p>&open=<id>`; stale → `/deals?pipeline=<p>&error=deal_changed`)
- [x] T033 [US3] Drag and drop in `src/app/(app)/deals/Board.tsx`: `draggable` cards, `dragover` highlights the column, `drop` on another column applies an optimistic move (`useOptimistic`/local state: card to the top of the new column, counts and totals adjusted by its value) and calls `moveDealFromBoard`; `stale` → `router.refresh()` + `deal_changed` message; a thrown call → revert + `deal_move_failed`; same column → nothing
- [x] T034 [US3] `getDeal(viewerId, id)` in `src/server/deals/deals.ts` (visible only; pipeline, stage, organisation with archived flag, person only if visible with archived flag, owner with active flag, dates, private, createdBy, archived, version) and `src/app/(app)/deals/DealDrawer.tsx` (server): `// DEAL`, title, Pipeline · Stage, Value, Organisation link, Person link, Owner ("(deactivated)"), Expected close (`formatDate`), Date added, "Move to" form (`<optgroup>` per pipeline, current stage selected, hidden `id`/`version`, `[ MOVE ]`), `[ CLOSE ]`, `Timeline` with heading "HISTORY"; the page shows it only when the deal is visible, not archived and in the shown pipeline, and shows `?error=deal_changed` from the allow-list

**Checkpoint**: The board is fully usable for daily work.

---

## Phase 6: User Story 4 - Look at and edit a deal from the board (Priority: P2)

**Goal**: The drawer offers `[ EDIT ]`, `[ ARCHIVE ]` and, for admins, `[ DELETE ]`.

**Independent Test**: Edit a deal's value from £4,000 to £5,000; drawer, card, column total and history show it.

### Tests for User Story 4

- [x] T035 [P] [US4] Integration tests in `tests/integration/deals.test.ts` for `updateDeal`, `archiveDeal`, `deleteDeal` (covers FR-007, FR-008, SC-004, SC-006, US4 scenarios 2–5, edge cases): edit records `edited` with the changed labels only ("Value"); stale `version` → `deal_edit_conflict`, nothing overwritten; a hidden private main person is kept when the person field is empty (spec Clarifications); a deactivated current owner is kept; archive sets `archived_at`, keeps the stage, records `archived`, removes it from counts/totals; `deleteDeal` by a non-admin → `forbidden`, deal still there; by an admin → gone with its periods and events; deleting the deal's person or organisation leaves the deal with null links
- [x] T036 [P] [US4] Playwright test in `tests/e2e/deals.spec.ts` (covers US4 scenarios 1–5, FR-014): selecting a card opens the drawer and puts `open=<id>` in the address; edit value → "£5,000" on card, drawer and total, history "Edited by <name>: Value"; `[ ARCHIVE ]` removes the card and lowers the header; admin `[ DELETE ]` → "Delete Fakeco website for good? This can't be undone." → `[ DELETE FOR GOOD ]` → "Fakeco website was deleted."; a non-admin sees no `[ DELETE ]`, and posting `deleteDeal` directly lands on "You don't have access to this page." with the deal still there; `?open=<archived or missing id>` shows the board with no drawer

### Implementation for User Story 4

- [x] T037 [US4] `updateDeal(actorId, id, version, form)`, `archiveDeal(actorId, id)`, `deleteDeal(actorId, id)` in `src/server/deals/deals.ts` (data-model.md § State changes): lock with `<visibleDeal>`; version check; hidden-person rule; `private` only from the creator or the current owner; a private deal saved so that the actor is neither creator nor owner returns `no_longer_visible` (the action sets the `deal_no_longer_visible` flash with the title and redirects to `/deals?pipeline=<p>`); `edited` event when fields changed; delete re-checks `isActiveAdmin` inside the transaction and returns the title
- [x] T038 [US4] `src/app/(app)/deals/[id]/edit/page.tsx` (`requireUser()`, `notFound()` when not visible/archived/missing; `DealForm` without pipeline/stage, hidden `id`, `version`); actions `updateDeal`, `archiveDeal`, `deleteDeal` (`assertAdminForAction()`, `setFlash({ code: "deal_deleted", name })`) in `src/app/(app)/deals/actions.ts`; add `"deal_deleted"` to `CODES` in `src/server/records/flash.ts`; the board page shows `readFlash("deal_deleted")`
- [x] T039 [US4] `DealDrawer.tsx`: `[ EDIT ]`, `[ ARCHIVE ]` (form), `[ DELETE ]` only for admins (→ `&confirm=delete`), confirm block with `templates.delete_confirm(title)`, `[ DELETE FOR GOOD ]`, `[ CANCEL ]`; "Archived" badge on an archived organisation/person

**Checkpoint**: Deals can be corrected and removed from the board.

---

## Phase 7: User Story 5 - Manage pipelines and stages (Priority: P2)

**Goal**: Admins create, rename, reorder and delete pipelines and stages; deletes move deals, never lose them.

**Independent Test**: Create "Partners" with Intro, Talking, Signed; rename Talking to "In talks"; move Signed first; delete Intro; the board shows "Signed", "In talks".

### Tests for User Story 5

- [x] T040 [P] [US5] Integration tests in `tests/integration/pipelines.test.ts` (covers FR-001–FR-004, SC-006, SC-007, US5 scenarios 1–7, edge cases): add pipeline last / stage last; names unique ignoring case and outer spaces (" sales " vs "Sales") → `pipeline_name_exists`, also after a unique-index race; same stage name allowed in two pipelines; ↑/↓ renumber positions 1..n, first-up/last-down unchanged; delete stage with deals (archived included) requires a target in the same pipeline (else `stage_target_invalid`), moves every deal with a `moved` event `cause = 'stage_deleted'` and new period; the last stage of a pipeline with deals → `stage_last_with_deals`; delete pipeline with deals requires a stage in another pipeline (`pipeline_target_invalid`), none exists → `pipeline_delete_no_target`; empty pipeline deleted with its stages; total deal count equal before and after every delete; every function called by a non-admin (or deactivated admin) → `forbidden`, nothing changed
- [x] T041 [P] [US5] Playwright test in `tests/e2e/pipelines.spec.ts` (covers US5 scenarios 1–7): the independent test above end to end, then the board shows "Signed", "In talks" in order and a new pipeline reads "This pipeline has no stages yet." and appears in the picker; reordering pipelines changes the picker and the default board; deleting a stage with deals asks "<name> has <n> deals. Move them to:" and the moved deal's history ends "(stage deleted)"; a non-admin opening `/admin/pipelines` sees "You don't have access to this page." and has no Pipelines link

### Implementation for User Story 5

- [x] T042 [US5] Change functions in `src/server/deals/pipelines.ts` (research.md §6, contracts/routes.md): `addPipeline`, `renamePipeline`, `movePipeline`, `deletePipeline`, `addStage`, `renameStage`, `moveStage`, `deleteStage`; each one `sql.begin()`, `isActiveAdmin` re-check, lock the rows it renumbers, catch `pipelines_name_key`/`stages_name_key` unique violations; deletes move deals through the same period/event code as `moveDeal` (export a shared helper from `src/server/deals/deals.ts`) with `cause`
- [x] T043 [US5] `src/app/(app)/admin/pipelines/actions.ts` (every action `assertAdminForAction()` first, redirects and `?error=` codes per contracts/routes.md, `revalidatePath("/deals")` and `/admin/pipelines`)
- [x] T044 [US5] `src/app/(app)/admin/pipelines/page.tsx` and `src/app/(app)/admin/pipelines/[id]/page.tsx` (`requireAdmin()`, Forbidden for non-admins, design A Users-style rows: rename field + `[ RENAME ]`, `[ ↑ ]`, `[ ↓ ]`, `[ DELETE ]`; `?delete=<id>` confirm block with `templates.pipeline_delete_confirm` or `templates.pipeline_has_deals` + target `<select>`; `?error=` from the page's allow-list only)

**Checkpoint**: Admins shape their own pipelines.

---

## Phase 8: User Story 6 - Private deals (Priority: P3)

**Goal**: A deal's creator or owner can mark it private; nobody else (admins included) sees, counts or changes it.

**Independent Test**: As A, add a private deal owned by B; B sees it; as C and as an admin, the card is absent, totals exclude it, its drawer address shows no drawer.

### Tests for User Story 6

- [x] T045 [P] [US6] Integration tests in `tests/integration/deals-private.test.ts` (covers FR-015, FR-016, SC-005, US6 scenarios 1–6, edge cases): for a user who is neither creator nor owner and for such an admin, a private deal is absent from `getBoard` cards and from every column count and total, `getDeal` → null, `readTimeline({ dealId })` empty, and `updateDeal`/`moveDeal`/`archiveDeal`/`deleteDeal` → not found/stale with nothing changed; only the creator's and the current owner's `private` value is accepted on update; the owner (not creator) sees, counts, edits, moves and archives the deal; owner B changing the owner to C → `no_longer_visible`, then B no longer sees it and A and C do; owners A→B→C: B no longer sees it; a deal whose main person is private to A shows no person to B on card and drawer; a private deal of a deactivated creator is still seen by its active owner and by no admin; with both creator and owner deactivated it is seen by nobody
- [x] T046 [P] [US6] Playwright test in `tests/e2e/deals-private.spec.ts` (covers US6 scenarios 1–6): A ticks "Private" and makes B owner → "Private" badge on card and drawer for A and B; C and an admin don't see it, the header totals exclude it, `?open=<id>` shows no drawer; C's edit form for a non-private deal created by A and owned by B offers no "Private"; B changes the owner to C → board with "You can no longer see <title>: only its creator and owner can."

### Implementation for User Story 6

- [x] T047 [US6] "Private" checkbox in `src/app/(app)/deals/DealForm.tsx` shown on add and, on edit, to the creator and the current owner; "Private" badge on cards (`Board.tsx`) and in `DealDrawer.tsx`; confirm every deals query in `src/server/deals/deals.ts` and `src/server/deals/pipelines.ts` that reads deals for a viewer uses `visibleDeal` (admin deletes of stages/pipelines move every deal, private ones included, without showing them)

**Checkpoint**: All six stories work.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T048 [P] Docs: append to `docs/DECISIONS.md` the three people-made choices from spec Clarifications ("Only admins create, rename, reorder and delete pipelines and stages, on a Pipelines admin page (SF-93)", "The deals board uses design A: rounded cards in stage columns, a pipeline picker and a deal drawer (SF-93)", "Deal cards show no \"No next activity\" warning until activities exist (SF-93)"); README: the new pages and fake data; AGENTS.md § Layout: `src/server/deals/` (`rules.ts` pure, `deals.ts`, `pipelines.ts`), `visibleDeal` beside `visiblePerson`, `src/seed/deals.ts`
- [x] T049 Run `quickstart.md` end to end: `npm test && npm run test:e2e && npm run typecheck` green with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`; seed twice adds nothing the second time
- [x] T050 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — keep Google Sign-In as it is and update the Supabase Postgres line: no fake, a real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres, and the deals code (SF-93) keeps to the same pooler limits with tables from `migrations/0004_pipelines_deals.sql` — and `## Schemas` (each schema's GitHub URL at its commit: oauth2-api.json unchanged, nothing added); also describe the new fake pipelines and deals in the `reset-db.sh` line

---

## Dependencies & Execution Order

- **Setup (T001–T004)** → **Foundational (T005–T012)** → stories.
- **US1** (board) needs Foundational. **US2** (add) needs US1's page and `Board`. **US3** (move) needs US1 (board) and uses US2's deals in its e2e test (seeded deals also work). **US4** extends US3's drawer. **US5** needs Foundational and US3's shared move helper (T031). **US6** needs US2's form and US4's drawer.
- Within each story: tests first (fail), then domain functions, then actions, then pages/components.
- T050 is the last task.

### Parallel opportunities

- Setup: T002, T003, T004 together after T001.
- Foundational: T005, T006, T008, T009, T011 together; T007 after T005–T006; T010 after T009.
- Every story's test tasks marked [P] together (different files).
- US2: T026 and T027 together. US5 (after T031) can run beside US4.

### Parallel example: User Story 1

```text
T014 tests/integration/board.test.ts
T015 tests/integration/board-performance.test.ts
T016 tests/integration/seed.test.ts
T017 tests/e2e/board.spec.ts
```

## Implementation Strategy

- **MVP**: Setup + Foundational + US1 (the board with fake data), then US2 and US3, the other P1 stories: together they replace the daily Pipedrive board.
- Then US4 and US5 (P2), then US6 (P3); each checkpoint is a working, tested increment.
- Choices made here without asking: the drawer display and "Move to" form are built in US3 (US3 scenarios 2 and 3 need them) and US4 adds its buttons; the Supabase Postgres test task (T013) sits in US1, the first story whose code reads the new tables.
