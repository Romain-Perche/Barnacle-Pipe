---

description: "Tasks for SF-95 Deal list view and deal page"
---

# Tasks: Deal list view and deal page

**Input**: Design documents from `/specs/sf-95-step-4-deal-list-view-and-deal-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-003 to SC-007): Vitest unit tests, Vitest integration tests against a real local Postgres (`crm_test`), Playwright browser tests through the fake Google login. Each test file names what it covers (`// covers FR-005, US2 scenario 1`). Write each story's tests first and see them fail before the code.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. The migration, entities, state changes, validation and fake data are in `data-model.md`; pages, address parameters, actions and domain functions in `contracts/routes.md`; decisions in `research.md` (§n below). No new dependency (`dependencies.json` is `[]`): do not add any package. No blueprint applies (`blueprints.json` is `[]`), so there are no blueprint tasks and no `Departs from blueprint` line. The choices "decided by the factory, to confirm" in spec.md § Clarifications are built as written there.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 from spec.md
- Paths are from the repository root (single Next.js project, see plan.md § Project Structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The schema and the test plumbing.

- [X] T001 First run `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'timeline_events'::regclass` on a database migrated to 0004 to confirm the kind check is named `timeline_events_kind_check`. Then create `migrations/0005_deal_page.sql` exactly as `data-model.md` § Migration: on `deals` add `status text not null default 'open' check (status in ('open', 'won', 'lost'))`, `closed_at timestamptz null`, `lost_reason text null check (lost_reason = btrim(lost_reason) and lost_reason <> '' and char_length(lost_reason) <= 500)`, constraint `deals_status_check check ((status = 'open') = (closed_at is null) and (status = 'lost') = (lost_reason is not null))`; `drop index deals_board_idx` and recreate it `on deals (stage_id, stage_entered_at desc) where archived_at is null and status = 'open'`; `create index deals_created_at_idx on deals (created_at desc, id desc)`; tables `deal_labels` (`name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100)`, `removed_at timestamptz null`, `unique index deal_labels_name_key on deal_labels (lower(name))`), `deal_label_links` (`deal_id … references deals (id) on delete cascade`, `label_id … references deal_labels (id)`, `primary key (deal_id, label_id)`, index `deal_label_links_label_idx (label_id)`), `deal_people` (`deal_id … on delete cascade`, `person_id … references persons (id) on delete cascade`, `linked_by bigint null references users (id)`, `created_at timestamptz not null default now()`, `primary key (deal_id, person_id)`, index `deal_people_person_idx (person_id)`), `deal_followers` (`deal_id … on delete cascade`, `user_id bigint not null references users (id)` with no cascade, `created_at`, `primary key (deal_id, user_id)`, index `deal_followers_user_idx (user_id)`); `alter table … enable row level security` after each of the 4 `create table`; on `timeline_events` add `reason text null check (char_length(reason) <= 500)`, recreate `timeline_events_kind_check` as `check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved', 'won', 'lost', 'reopened'))`, add `timeline_events_reason_check check ((kind = 'lost') = (reason is not null))`. Only statements allowed in a transaction.
- [X] T002 [P] Extend `tests/support/reset.ts` (`resetAppTables`): truncate `deal_followers, deal_people, deal_label_links, deal_labels` with the other tables (restart identity cascade); no starting deal labels; keep the six starting lead sources
- [X] T003 [P] Extend `.factory/run/reset-db.sh` to truncate the four new tables too
- [X] T004 [P] Add `deal_labels`, `deal_label_links`, `deal_people`, `deal_followers` to the expected list in `tests/integration/rls.test.ts`; extend `tests/integration/migrate.test.ts` to check on a fresh database that a deal with `status = 'won'` and no `closed_at` is refused, a `lost` deal without a reason is refused, a 501-character `lost_reason` is refused, and a `lost` timeline event without `reason` is refused (23514)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure rules, messages, query parsing, the richer deal read and the timeline every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Unit tests first in `tests/unit/deals-rules.test.ts`: `stageBar(stages, currentStageId)` returns `done`/`now` with `days = Math.floor(seconds / 86400)` and `next` with `days: null` for stages after the current one (even with seconds > 0), skipped earlier stages read 0; `validateLostReason` — trimmed; `""`/spaces → `lost_reason_required`; 500 characters ok; 501 → `lost_reason_too_long`; `changedDealFields` lists "Labels" when `labelIds` differ and not when only the order differs (ids sorted). In `tests/unit/format.test.ts`: `formatDays(0)` "0 days", `formatDays(1)` "1 day", `formatDays(12)` "12 days". In `tests/unit/messages.test.ts`: the 8 new codes with their exact texts from contracts/routes.md § Messages
- [X] T006 [P] Unit tests first in `tests/unit/list-query.test.ts` for `parseDealsQuery` (research.md §5): defaults `sort=added`, `dir=desc`, page 1; `sort` only from `title|value|organisation|stage|owner|close|added`; `dir` `asc`/`desc` else `desc`; `status` only `open|won|lost`; `closed=1`, `archived=1` booleans; ids via `parseId` (`stage=abc` → null); `q` trimmed, ≤ 200; `withParams("/deals/list", …)` drops deals defaults (`sort=added`, `dir=desc`) from the address while people/organisations still drop `sort=name`, `dir=asc` (existing tests unchanged); changing a filter goes back to page 1 and closes the drawer
- [X] T007 Implement in `src/server/deals/rules.ts`: `stageBar`, `validateLostReason` (codes `lost_reason_required`, `lost_reason_too_long`, max 500), `labelIds: string[]` in `DealForm` and `labelIds: number[]` (sorted, `toId` each, at most 200) in `DealFields`, `["labelIds", "Labels"]` in `DEAL_FIELDS` after Person, `BACK_VALUES = ["page", "list"]` and `parseBack(raw)` (anything else → null = board); `formatDays` in `src/server/format.ts`; `dealFormFromData` reads `fd.getAll("labelIds")` (strings only, slice 200) and `back` in `src/server/records/form-data.ts`
- [X] T008 Implement `parseDealsQuery`, `DEAL_SORTS`, `DealsQuery`, `hasDealFilters`, and per-list defaults in `withParams` (add keys `pipeline`, `stage`, `status`, `closed` to `ORDER`; `closed` written as `1` like `archived`) in `src/server/records/list-query.ts`; make `SortHeader` in `src/app/(app)/records/ListBits.tsx` accept `DealsQuery`
- [X] T009 [P] Add to `src/server/messages.ts`: `deal_not_found` "This deal doesn't exist or you can't see it.", `lost_question` "Why was this deal lost?", `lost_reason_required` "Enter why this deal was lost.", `lost_reason_too_long` "Keep the reason under 500 characters.", `deal_person_already_linked` "This person is already linked to this deal.", `deal_label_exists` "This name is already used.", `no_deals_match` "No deals match these filters.", `no_deals_yet` "No deals yet."; template `deal_list_count(n, totalPence)` → "<n> deals · £<total>" ("1 deal") using `formatMoney`
- [X] T010 Timeline in `src/server/records/timeline.ts`: `EventKind` + `won`, `lost`, `reopened`; `recordEvent` takes `reason`; `TimelineEvent.reason`; `readTimeline({ dealId })` adds `and (e.related_person_id is null or visiblePerson(rp))` (research.md §7). In `src/app/(app)/records/Timeline.tsx`: "Marked as won by <name>", "Marked as lost by <name>: <reason>" (reason as a text node), "Reopened by <name>"; with `heading="HISTORY"`, link lines read "Linked <person> by <name>" / "Unlinked <person> by <name>" (person linked to `/people/<id>`; a deleted person keeps the SF-92 lines)
- [X] T011 Extend `getDeal` in `src/server/deals/deals.ts` (data-model.md § Deal): `status`, `closedAt`, `lostReason`, `labels` (every `deal_labels` row the deal has, removed included, A–Z), `otherPeople` (from `deal_people` joined through `visiblePerson`, `{ id, name, archived }`, A–Z), `followers` (`UserRef[]`, A–Z) and `followedByViewer`; extend the `DealView` type; existing callers keep working

**Checkpoint**: rules, messages, query parsing, timeline and deal read ready.

---

## Phase 3: User Story 1 - Open the full deal page (Priority: P1) 🎯 MVP

**Goal**: Every visible deal has its design C page with the stage bar (days per stage), strip, details, history; the stage bar moves an open deal; board drawer ↔ page links.

**Independent Test**: With the fake data loaded, open a deal that moved through three stages; the page shows every field, the bar with the current stage marked and days per stage, the history newest first.

### Tests for User Story 1

- [X] T012 [US1] Supabase Postgres has no public schema on GitHub, so there is no fake to check against a schema: the tests use a real local PostgreSQL 17, and the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler). It copies its limits: no prepared statements (`prepare: false`, unchanged in `src/server/db.ts`), no session state (no `set`, `listen` or session advisory lock in `src/server/deals/*.ts`), every multi-statement change in one `sql.begin()` transaction, at most 5 connections (`max: 5`). Extend the existing check in `tests/integration/migrate.test.ts` so it also scans `src/server/deals/list.ts` and `src/server/deals/links.ts` for `set `/`listen`/`pg_advisory_lock` and fails on any, and applies `0005_deal_page.sql` on a fresh database
- [X] T013 [P] [US1] Integration test `tests/integration/stage-days.test.ts` (covers FR-002, SC-004, US1 scenario 2, Edge Cases): a Sales deal with periods 3 days in "Qualified" and 5 days (open) in "Proposal" → `getStageSeconds` + `stageBar` give "Lead in" 0, "Qualified" 3, "Proposal" `now` 5, later stages `null`; a deal that left "Qualified" and came back adds both periods; a deal moved from another pipeline shows only its current pipeline's stages; after seeding, for every seeded deal the days shown equal `floor(sum(periods)/86400)` per stage
- [X] T014 [P] [US1] Integration test `tests/integration/deal-page.test.ts` (covers FR-001, FR-003, FR-020, US1 scenarios 1, 4, 5): `getDeal` returns status, labels, other people, followers; a private deal of someone else, a missing and a deleted deal → null; `moveDeal` from the stage bar input records `moved` and a new period exactly as a board move; the deal history leaves out a `person_linked` event about a person private to someone else
- [X] T015 [P] [US1] Playwright test `tests/e2e/deal-page.spec.ts` (covers US1 scenarios 1–5): from the board drawer `[ OPEN DEAL PAGE ]` opens `/deals/<id>`; the page shows title, "£4,000"-style value, "<pipeline> · <stage>", owner, expected close "19 Dec 2026"-style, organisation and main person links, date added, status "Open", `// HISTORY`; `← <pipeline> board` goes back; pressing a later stage on the bar moves the deal (history line, bar updated); `/deals/999999` and a private deal of another user show "This deal doesn't exist or you can't see it." and nothing about the deal

### Implementation for User Story 1

- [X] T016 [US1] Add `getStageSeconds(dealId, pipelineId)` to `src/server/deals/deals.ts` with the SQL of data-model.md § Stage bar (`coalesce(left_at, now()) - entered_at` summed per stage of the current pipeline, ordered by position)
- [X] T017 [US1] Add `moveDealFromPage(form)` to `src/app/(app)/deals/actions.ts`: `requireUser()`; id, version, fromStageId, toStageId; calls `deals.moveDeal`; stale → `/deals/<id>?error=deal_edit_conflict`; else `/deals/<id>`; revalidate `/deals`, `/deals/list`, `/deals/<id>`
- [X] T018 [P] [US1] Create `src/app/(app)/deals/[id]/StageBar.tsx` (server): one arrow per stage from `stageBar()`, name + `formatDays(days)` (nothing for `next`), current one `aria-current="step"`; when the deal is open and not archived, a form posting to `moveDealFromPage` with hidden id/version/fromStageId and one submit button per other stage (`name="toStageId"`); otherwise plain text
- [X] T019 [P] [US1] Create `src/app/(app)/deals/[id]/not-found.tsx` showing `messages.deal_not_found` (HTTP 404, also used by `/deals/<id>/edit`)
- [X] T020 [US1] Create `src/app/(app)/deals/[id]/page.tsx` (design C, contracts/routes.md § Pages): `requireUser()`, `parseId`, `getDeal` (null → `notFound()`), `getStageSeconds`, `readTimeline({ dealId })`; back link `boardHref(pipelineId)`; header `// DEAL`, title, Private badge; StageBar; strip (Value, Owner, Expected close, Status "Open"); actions `[ EDIT ]` (→ `/deals/<id>/edit?back=page`), `[ ARCHIVE ]`, `[ DELETE ]` for admins (`?confirm=delete` → `DeleteConfirm` with hidden `back=list`); `// DETAILS` two columns (Pipeline · Stage, Organisation, Main person with "Archived" badges, Date added); `// HISTORY`; `?error=` allow-list `deal_edit_conflict`, `lost_reason_required`, `lost_reason_too_long`, `deal_person_already_linked`
- [X] T021 [US1] `back` handling in `src/app/(app)/deals/actions.ts` (research.md §8): `updateDeal` with `back=page` → `/deals/<id>`, `no_longer_visible` with `back=page` → `/deals/list` + flash; `archiveDeal` with `back=page` → `/deals/<id>`; `deleteDeal` with `back=list` → `/deals/list` + flash `deal_deleted`; otherwise unchanged (board). `DeleteConfirm` in `src/app/(app)/records/DeleteConfirm.tsx` takes an optional `back` hidden field; the edit page `src/app/(app)/deals/[id]/edit/page.tsx` reads `?back=page` into a hidden `back` field of `DealForm` and sets `[ CANCEL ]` to `/deals/<id>`
- [X] T022 [US1] `DealDrawer` in `src/app/(app)/deals/DealDrawer.tsx`: props `hereHref`, `closeHref`, `deleteHref`, `canMove`; add `[ OPEN DEAL PAGE ]` → `/deals/<id>`; the board page `src/app/(app)/deals/page.tsx` passes the board links (behaviour otherwise unchanged)
- [X] T023 [US1] CSS in `src/app/globals.css`: stage arrows with `clip-path` as `design-options.html` C (current `--blue` with white text, done stages a light blue wash, later muted), the strip (mono labels, sans values), detail columns, long titles wrap (`overflow-wrap: anywhere`)

**Checkpoint**: the deal page works for every visible deal.

---

## Phase 4: User Story 2 - Mark a deal Won or Lost, and reopen it (Priority: P1)

**Goal**: `[ WON ]`, `[ LOST ]` (reason in a box over the page) and `[ REOPEN ]`; closed deals leave the board and stop counting stage days.

**Independent Test**: Mark a deal Won → it leaves its column and the total drops; Lost with "Went with a competitor" → the page shows the reason; reopen both → back in their columns.

### Tests for User Story 2

- [X] T024 [P] [US2] Integration test `tests/integration/deals-status.test.ts` (covers FR-005–FR-008, SC-005, US2 scenarios 1–6, Edge Cases): `markWon` sets status/closed_at, closes the open period, records `won`; `getBoard` no longer shows or counts it; `markLost` with "  Went with a competitor  " stores the trimmed reason and a `lost` event with the reason; empty reason → `invalid` `lost_reason_required`, deal still open; 501 characters → `lost_reason_too_long`; `reopenDeal` clears closed_at/reason, opens a new period in the same stage, records `reopened`, the deal is back on the board in its stage; stage days of a deal won 4 days into a stage still read 4 a week later (move `now` by updating period timestamps) and go on after reopening; a wrong version → `conflict`, nothing changes; value, owner and stage unchanged by Won/Lost; `moveDeal` on a closed deal → `stale`; `transferDeal` by a stage delete on a closed deal inserts a closed period; a private deal of someone else → `not_found`
- [X] T025 [P] [US2] Playwright test `tests/e2e/deal-won-lost.spec.ts` (covers US2 scenarios 1–6): `[ WON ]` shows "Won · <date>" and "Marked as won by <name>", the deal is gone from the board column; `[ LOST ]` opens the box "Why was this deal lost?" with `[ MARK AS LOST ]` / `[ CANCEL ]`; empty save → "Enter why this deal was lost."; "Went with a competitor" → "Lost" badge, date, reason, history line; a closed deal shows `[ REOPEN ]` and its stage bar has no buttons; two pages on one deal: Won in one, then Lost in the other → "Someone else changed this deal while you were editing. Reload to see their changes."

### Implementation for User Story 2

- [X] T026 [US2] In `src/server/deals/deals.ts` (data-model.md § State changes): `markWon(actorId, id, version)`, `markLost(actorId, id, version, reason)` (uses `validateLostReason`), `reopenDeal(actorId, id, version)`, each one `sql.begin()`, deal loaded `for update` through `visibleDeal()`, returning `ok | conflict | invalid | not_found`; close the open period on Won/Lost, insert an open period on Reopen; `getBoard` adds `d.status = 'open'`; `moveDeal` returns `stale` when not open; `transferDeal` inserts the new period with `left_at = entered_at` when the deal is not open
- [X] T027 [US2] Actions `markWon`, `markLost`, `reopenDeal` in `src/app/(app)/deals/actions.ts` (contracts/routes.md § Server actions): `requireUser()`; conflict → `/deals/<id>?error=deal_edit_conflict`; invalid → `/deals/<id>?confirm=lost&error=<code>`; not found → `/deals/list`; revalidate `/deals`, `/deals/list`, `/deals/<id>`
- [X] T028 [P] [US2] Create `src/app/(app)/deals/[id]/LostBox.tsx` (server): overlay over the page, `role="dialog"` `aria-modal="true"`, label `messages.lost_question`, `<textarea name="reason" maxLength={500} autoFocus required>`, hidden id/version, error message inside the box, `[ MARK AS LOST ]` (solid red) and `[ CANCEL ]` link to `/deals/<id>`
- [X] T029 [US2] Deal page `src/app/(app)/deals/[id]/page.tsx`: header buttons — open and not archived → solid green `[ WON ]` form and solid red `[ LOST ]` link (`?confirm=lost`); closed → `[ REOPEN ]` form; strip Status "Won · <date>" / "Lost · <date>"; "Lost because: <reason>" as plain text; `?confirm=lost` renders `LostBox` only for an open, non-archived deal
- [X] T030 [US2] `DealDrawer`: a closed deal shows a "Won · <date>" / "Lost · <date>" badge and no "Move to"; CSS in `src/app/globals.css`: `[ WON ]` solid `#16A34A`, `[ LOST ]` solid `var(--danger)`, the Lost box `border-radius: 8px` with a shadow over a dimmed page, the reason wraps (`overflow-wrap: anywhere`)

**Checkpoint**: Won/Lost/Reopen work; the board shows open deals only.

---

## Phase 5: User Story 3 - Browse deals as a list (Priority: P1)

**Goal**: `/deals/list` with filter row, sortable columns, count and total, closed deals option, drawer; Board/List switch.

**Independent Test**: Filter Sales + "Ada Fake", sort value high to low, check rows, count and total; tick "Show closed deals" and see won/lost deals with their status.

### Tests for User Story 3

- [X] T031 [P] [US3] Integration test `tests/integration/deals-list.test.ts` (covers FR-009–FR-013, FR-020, SC-006, US3 scenarios 1–5, Edge Cases): default lists open, non-archived visible deals newest first, 50 per page, `total` and `totalPence` over all matches; each filter (q in title, pipeline, stage within the pipeline, owner, label) alone and together; a stage not in the chosen pipeline is ignored; each sort both ways with null value / organisation / expected close last either way; `closed` adds won and lost; `status` narrows only when closed or archived is on; page past the last → last page; a private deal of someone else is never listed or counted in the total; a hidden main person is not shown
- [X] T032 [P] [US3] Integration test `tests/integration/deals-list-performance.test.ts` (covers SC-003): 2,000 deals across pipelines with labels; a filtered, sorted page (plus count/total and filter options) answers in under 2 s
- [X] T033 [P] [US3] Playwright test `tests/e2e/deal-list.spec.ts` (covers US3 scenarios 1–6): `[ LIST ]` on the board opens `/deals/list` and `[ BOARD ]` goes back; "<n> deals · £<total>" shown; filter Pipeline "Sales" and Owner "Ada Fake", sort Value descending; reload keeps it; "Show closed deals" lists won/lost with "Won"/"Lost"; `[ CLEAR ]` removes every filter; a row opens the drawer, the title opens the deal page; `?sort=evil&stage=abc&page=999` shows the last page and no text from the address; empty results show "No deals match these filters."

### Implementation for User Story 3

- [X] T034 [US3] Create `src/server/deals/list.ts`: `listDeals(viewerId, query)` → `{ rows, total, totalPence, page, pages }` and `dealFilterOptions(viewerId, pipelineId)` → `{ pipelines, stages (of the chosen pipeline), owners (active + owners of visible deals), labels (non-removed deal labels plus removed ones a visible deal has, as `peopleFilterOptions`) }`, exactly as research.md §5 (where clause, `escapeLike` on `q`, `visibleDeal`, main person through `visiblePerson`, labels as `array()` of every name the deal has, removed included, sorts with `nulls last` and `d.id` tie-break, `PAGE_SIZE` 50)
- [X] T035 [US3] `FilterRow` in `src/app/(app)/records/ListBits.tsx`: optional `toggles` prop (default `[{ name: "archived", label: "Show archived" }]`, so People and Organisations are unchanged)
- [X] T036 [P] [US3] Create `src/app/(app)/deals/ViewSwitch.tsx` (server): `[ BOARD ]` → `/deals`, `[ LIST ]` → `/deals/list`, the current one `aria-current="page"`; add it to the head of `src/app/(app)/deals/page.tsx`
- [X] T037 [US3] Create `src/app/(app)/deals/list/page.tsx` (contracts/routes.md § Pages, `/deals/list`): `requireUser()`, `parseDealsQuery`, keep `stage` only when it belongs to the chosen pipeline; head `// DEALS`, "Deals", ViewSwitch, `[ ADD DEAL ]`, `templates.deal_list_count`; filter row (search, Pipeline, Stage when a pipeline is chosen, Owner, Label, Status when closed or archived is on, Sort, Order, toggles "Show closed deals" / "Show archived deals", `[ CLEAR ]` when anything is set); table with `SortHeader`, `Cell`, `PreviewLink`, labels under the title, "Won"/"Lost"/"Archived"/"Private" badges; `Pager`; empty texts `no_deals_match` + `[ CLEAR FILTERS ]` / `no_deals_yet`; flash `deal_deleted`, `deal_no_longer_visible`; the drawer (`open`) via `DealDrawer` with list links for any visible deal
- [X] T038 [US3] CSS in `src/app/globals.css`: the view switch, the count line in mono, list badges; reuse the People list styles

**Checkpoint**: the list works with the board; closed deals are findable.

---

## Phase 6: User Story 4 - Restore an archived deal (Priority: P2)

**Goal**: archived deals found with "Show archived deals"; their page offers `[ RESTORE ]` (and `[ DELETE ]` for admins).

**Independent Test**: Archive from the board, find with "Show archived deals", restore, see it back in its column with its status unchanged.

### Tests for User Story 4

- [X] T039 [P] [US4] Integration test `tests/integration/deals-restore.test.ts` (covers FR-011, FR-014, FR-015, SC-005, SC-007, US4 scenarios 1–5): `archived` lists only archived deals of every status, respecting other filters; `restoreDeal` clears `archived_at`, records `restored`, an open deal is back on its board stage, a won deal stays won and off the board; a deal whose stage was deleted while archived is restored into the stage its deals were moved to; `deleteDeal` by a non-admin is refused (`forbidden`), including a direct call
- [X] T040 [P] [US4] Playwright test `tests/e2e/deal-restore.spec.ts` (covers US4 scenarios 1–3, Edge Cases): archive from the board drawer; on the list tick "Show archived deals" → the deal marked "Archived"; its page reads "Archived · <date>" with only `[ RESTORE ]` (and `[ DELETE ]` as admin), no edit, Won, Lost, follow or link; `[ RESTORE ]` → back on its board column, history "Restored by <name>"; as admin, delete from the page after "Delete <title> for good? This can't be undone." lands on the list with "<title> was deleted."

### Implementation for User Story 4

- [X] T041 [US4] Add `restoreDeal(actorId, id)` to `src/server/deals/deals.ts` (visible, archived → `archived_at = null`, `version + 1`, event `restored`; status and stage unchanged) and action `restoreDeal(form)` to `src/app/(app)/deals/actions.ts` (`requireUser()`, → `/deals/<id>`, not found → `/deals/list`)
- [X] T042 [US4] Deal page `src/app/(app)/deals/[id]/page.tsx` for archived deals: strip status "Archived · <date>", actions only `[ RESTORE ]` and `[ DELETE ]` (admins), no Won/Lost/Reopen, no stage bar buttons; `DealDrawer` for archived deals on the list: "Archived" badge, only `[ OPEN DEAL PAGE ]` and `[ CLOSE ]`

**Checkpoint**: archiving from the board can be undone.

---

## Phase 7: User Story 5 - Linked people, labels and followers (Priority: P2)

**Goal**: other linked people, deal labels (admin-managed) and followers on the deal page.

**Independent Test**: Link "Bob Example" to a deal whose main person is "Ada Example", add label "Hot", follow; reload: person, label and follower shown, history records the link.

### Tests for User Story 5

- [X] T043 [P] [US5] Integration test `tests/integration/deals-links.test.ts` (covers FR-016, FR-018, FR-020, US5 scenarios 1, 2, 5, 6, Edge Cases): `linkPerson` adds a visible, non-archived person and records `person_linked`; linking the main person or an already-linked person → `already_linked`, nothing changes; an archived or hidden person → `not_allowed`; `unlinkPerson` records `person_unlinked`; changing the main person to someone in "Other people" removes that link row; a person private to someone else linked by their creator is never returned in `otherPeople` nor in the history for another user; deleting a linked person removes the link and keeps "A deleted person was linked"; `followDeal` twice keeps one row, records no event; `unfollowDeal`; a deactivated follower stays listed
- [X] T044 [P] [US5] Integration test `tests/integration/deal-labels.test.ts` (covers FR-017, US5 scenarios 3–4, Edge Cases): `addChoice(…, "deal_label", "Hot")`, rename to "Very hot", remove; " hot " when "Hot" exists → `deal_label_exists`; a non-admin → `forbidden`, nothing saved; deal labels and people labels are separate lists; `updateDeal` with labels records "Labels" in the edited fields; a removed deal label stays in `getDeal`, the list row and the filter options while a visible deal has it (not when no visible deal has it); `dealFormChoices` offers it only for a deal that has it; editing that deal with it ticked keeps it and records no "Labels"; unticking it removes it; requesting it for another deal is ignored
- [X] T045 [P] [US5] Playwright test `tests/e2e/deal-labels.spec.ts` (covers US5 scenarios 1–5, Edge Cases removed deal label): as admin add "Hot" under "Deal labels" on `/admin/lead-sources-and-labels`, adding "hot" again → "This name is already used."; the person form still offers only people labels; edit a deal ticking "Hot" → page shows it, history "Edited by <name>: Labels", the list's Label filter finds it; the admin removes "Hot" → the deal page and list row still show it, the Label filter still offers and finds it, another deal's edit form does not offer it; link "Bob Example" → under "Other people", history "Linked Bob Example by <name>"; linking the main person → "This person is already linked to this deal."; `[ UNLINK ]`; `[ FOLLOW ]` → listed under Followers, button `[ UNFOLLOW ]`; a non-admin opening the admin page sees "You don't have access to this page."

### Implementation for User Story 5

- [X] T046 [US5] Create `src/server/deals/links.ts` (data-model.md § State changes): `linkPerson(actorId, dealId, personId)` → `ok | already_linked | not_allowed | not_found` (deal visible and not archived, locked `for update`; person visible and not archived; not main, not in `deal_people`; primary-key violation → `already_linked`), `unlinkPerson`, `followDeal` (`on conflict do nothing`), `unfollowDeal`; each one `sql.begin()`
- [X] T047 [US5] Labels in `src/server/deals/deals.ts`: `dealFormChoices` returns non-removed deal labels plus the ones the deal has (as `personFormChoices`); `updateDeal` keeps requested ids that are non-removed deal labels or already on the deal (as `allowedLabels` in `people.ts`), rewrites all the deal's links, records "Labels" via `changedDealFields`, and deletes the new main person from `deal_people`; `dealToForm` fills `labelIds`
- [X] T048 [US5] `src/server/records/choices.ts`: kind `deal_label` → table `deal_labels`, key `deal_labels_name_key`, duplicate code `deal_label_exists` (people labels and lead sources keep `choice_exists`); actions `addDealLabel`, `renameDealLabel`, `removeDealLabel` in `src/app/(app)/admin/lead-sources-and-labels/actions.ts` (`assertAdminForAction()` first); a third `ChoiceList` "Deal labels" on `src/app/(app)/admin/lead-sources-and-labels/page.tsx`; `deal_label_exists` in its error allow-list
- [X] T049 [US5] Label checkboxes in `src/app/(app)/deals/DealForm.tsx` (as `PersonForm`, `name="labelIds"`, the deal's labels ticked) fed by `dealFormChoices`
- [X] T050 [US5] Actions `linkPerson`, `unlinkPerson`, `followDeal`, `unfollowDeal` in `src/app/(app)/deals/actions.ts` (contracts/routes.md); deal page `src/app/(app)/deals/[id]/page.tsx`: Other people (links, "Archived" badge, `[ UNLINK ]`, then `PersonPicker` with visible non-archived people + `[ LINK PERSON ]`), Labels, Followers ("<name> (deactivated)"), `[ FOLLOW ]` / `[ UNFOLLOW ]` — none of these for an archived deal

**Checkpoint**: every story works on its own and together.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T051 Fake data in `src/seed/deals.ts` (data-model.md § Fake data, FR-023): deal labels "Hot", "Warm", "Cold", "Big ticket", "Renewal" (`on conflict ((lower(name))) do nothing`); new titles "Fakeco newsletter (won)", "Sample Gyms signage (won)", "Mock Labs retainer (won)", "Dummy Leisure app (lost)" ("Went with a fake competitor"), "Lorem Logistics pilot (lost)" ("Fake budget cut"), "Testfield Health kiosk (lost)" ("No fake decision maker"), "Old fake tender (lost)" ("Fake tender cancelled", archived a day ago), each with periods of varied days through the Sales stages, the last closed at `closed_at`, and its `won`/`lost` event; labels on ≥ 8 deals, other linked people on ≥ 5 (never the main person, never a private person), followers on ≥ 5; links `on conflict do nothing`. Extend `tests/integration/seed.test.ts`: running the seed twice adds nothing the second time; won, lost, archived-lost deals, ≥ 4 deal labels, links and followers exist
- [X] T052 [P] Docs: append to `docs/DECISIONS.md` the three people-made choices from spec Clarifications ("The deal page uses design C: solid Won and Lost buttons in the header, an arrow-shaped stage bar with days per stage, a summary strip, and the lost reason asked in a box over the page; the deal list follows the People list (SF-95)", "A lost reason is typed as free text (SF-95)", "Deal labels are a separate list, managed by admins on the Lead sources and labels page (SF-95)"); README: the list, the deal page and the new fake data; AGENTS.md § Layout: `src/server/deals/list.ts`, `src/server/deals/links.ts`, `src/app/(app)/deals/[id]/` and `deals/list/`
- [X] T053 Run `quickstart.md` end to end: `npm test && npm run test:e2e && npm run typecheck` green with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`; the SF-93 board, deals and pipelines tests still pass
- [X] T054 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — keep Google Sign-In as it is and update the Supabase Postgres line: no fake, a real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres, and the SF-95 code (`src/server/deals/list.ts`, `links.ts`) keeps to the same pooler limits with tables from `migrations/0005_deal_page.sql` — and `## Schemas` (each schema's GitHub URL at its commit: oauth2-api.json unchanged, nothing added); also describe the new fake won/lost deals, labels, links and followers in the `reset-db.sh` line

---

## Dependencies & Execution Order

- **Setup (T001–T004)** → **Foundational (T005–T011)** → stories.
- **US1** (deal page) needs Foundational. **US2** (Won/Lost) needs US1's page. **US3** (list) needs Foundational and US1's `DealDrawer` props (T022); its closed-deal option is fully tested once US2 is in. **US4** (restore) needs US1's page and US3's "Show archived deals". **US5** needs US1's page.
- Within each story: tests first (fail), then domain functions, then actions, then pages/components.
- T051 (seed) after US5 (it fills labels, links, followers); T054 is the last task.

### Parallel opportunities

- Setup: T002, T003, T004 together after T001.
- Foundational: T005, T006, T009 together; T007 after T005, T008 after T006; T010, T011 after T009.
- Every story's test tasks marked [P] together (different files).
- US1: T018 and T019 together. US2: T028 beside T026. US3: T036 beside T034. US5 (after US1) can run beside US3 and US4.

### Parallel example: User Story 3

```text
T031 tests/integration/deals-list.test.ts
T032 tests/integration/deals-list-performance.test.ts
T033 tests/e2e/deal-list.spec.ts
```

## Implementation Strategy

- **MVP**: Setup + Foundational + US1 (the deal page with the stage bar), then US2 and US3, the other P1 stories: together they give results (Won/Lost) and a way to find any deal.
- Then US4 and US5 (P2); each checkpoint is a working, tested increment.
- Choices made here without asking: the `back` handling (where actions from the deal page return) is built in US1 because the page's EDIT/ARCHIVE/DELETE need it; the Supabase Postgres test task (T012) sits in US1, the first story whose code reads the new tables; the seed is in the Polish phase because it needs every story's tables and functions.
