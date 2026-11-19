# Research: Pipelines, deals and the board

All Technical Context items were known from the repo (SF-80, SF-90); nothing was left as NEEDS
CLARIFICATION. Each decision below follows the patterns already in `src/server/records/` unless it says why not.

## 1. No new dependency; drag and drop with the browser's own drag events

- **Decision**: The board's drag and drop uses the HTML drag and drop events (`draggable`, `dragstart`,
  `dragover`, `drop`) in one client component, `Board.tsx`. Keyboard and touch users move a deal with the
  drawer's "Move to" picker, a plain server-rendered form (FR-011). No package is added
  (`dependencies.json` is `[]`).
- **Rationale**: The board only needs "drop a card on a column", not sorting inside a column (cards are
  ordered by when they entered the stage, spec Assumptions). That is ~60 lines with native events.
  Accessibility for non-drag users is required anyway and is covered by the drawer form, so a library's
  keyboard drag support would duplicate it.
- **Alternatives**: `@dnd-kit/core` / `@dnd-kit/sortable` (touch + keyboard sensors, sorting) — rejected:
  no sorting needed, and the drawer form already serves keyboard and touch. `react-beautiful-dnd` —
  unmaintained.

## 2. Money stored as whole pence

- **Decision**: `deals.value_pence bigint null` (`check (value_pence between 0 and 999999999999)`, i.e.
  up to £9,999,999,999.99). Parsing and formatting are pure functions: `parseMoney(raw)` in
  `src/server/deals/rules.ts`, `formatMoney(pence)` in `src/server/format.ts`.
- `parseMoney`: trim; empty → `null` (no value); strip one leading `£`; the rest must match
  `^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$` (commas only as thousands separators); more than 10 whole-pound
  digits, letters, a minus sign or 3+ decimals → error `deal_value_invalid`. `"£4,000.50"` and `" 4000.5 "`
  → 400050.
- `formatMoney`: `null` → "—" on cards and drawer; whole pounds → "£4,000"; otherwise "£4,000.50"
  (`Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" })` with 0 or 2 fraction digits).
  Column totals use the same function; a missing value counts as £0, and an empty column shows "£0".
- Sums: `coalesce(sum(value_pence), 0)::bigint` comes back from postgres.js as a string; convert with
  `Number()` (safe: 500 deals × 1e12 < 2^53).
- **Rationale**: integers avoid float rounding in totals (SC-004 compares totals exactly).
- **Alternatives**: `numeric(14,2)` — works but comes back as a string and needs decimal handling in JS;
  pence is simpler.

## 3. Stage history and deal history

- **Decision**: two pieces.
  1. `deal_stage_periods` (deal, stage, stage and pipeline names copied at entry, `entered_at`, `left_at`,
     `moved_by`): one open row per deal (`left_at is null`, unique partial index). Every move closes the open
     row and opens a new one in the same transaction. This is what the deal page (next issue) uses for days
     per stage (FR-007).
  2. Deal history lines go into the existing `timeline_events` table with a new `deal_id` column and a new
     kind `moved` (columns `from_stage`, `to_stage`, `cause`). Added / edited (with field labels) / archived
     reuse the existing kinds. `readTimeline` gains a `{ dealId }` target.
- `deals.stage_entered_at` is a copy of the open period's `entered_at`, kept on the deal so the board orders
  cards (`order by stage_entered_at desc, id desc`) without a join.
- Stage and pipeline names are copied as text into the history, so "Moved from Qualified to Proposal" still
  reads right after a rename or after the stage is deleted. A move between pipelines stores
  "Sales · Qualified" / "Partners · Intro" style names (pipeline name added when the pipeline changes).
- `cause` is `stage_deleted` or `pipeline_deleted` for moves done by an admin deleting a stage or pipeline;
  the line then ends "(stage deleted)" / "(pipeline deleted)" (spec US5 scenario 4).
- **Rationale**: one timeline table, as SF-90 planned ("later features add event kinds to
  `timeline_events`"); later notes/emails/activities on deals join the same timeline.
- **Alternatives**: a separate `deal_events` table — rejected, it would split the one timeline the product
  asks for (PRODUCT §1).

## 4. Moves and concurrency

- **Decision**: every deal has `version int` (as persons/organisations). A board move posts
  `{ dealId, version, fromStageId, toStageId }`; `moveDeal` locks the deal (`for update`) and refuses with
  `stale` when it is not visible, is archived, is gone, or its `version`/`stage_id` differ from what the
  board had (FR-012). The board then calls `router.refresh()` and shows "This deal changed since you loaded
  the board. The board has been refreshed.". A drop on the same column does nothing (no request).
- If the action call itself fails (network), the optimistic card goes back and the board shows "The deal
  could not be moved. Try again.".
- The drawer's "Move to" form posts the same fields to the same domain function (redirects back to the
  board with the drawer open; a stale move redirects with `?error=deal_changed`).
- Edit conflict: `updateDeal` compares `version` → `deal_edit_conflict`.
- **Rationale**: the same optimistic-lock pattern already used for people; no websockets needed for ≤10
  users.

## 5. Visibility of private deals and private people on deals

- **Decision**: one SQL fragment `visibleDeal(db, viewerId, alias = "d")` =
  `(not d.private or d.created_by = viewerId or d.owner_id = viewerId)` in `src/server/records/visibility.ts`, next to
  `visiblePerson`. Every `deals` read (board cards, column totals, drawer, edit form, every change) uses it;
  every person shown on a deal is joined with `visiblePerson` (`left join persons p on p.id = d.person_id and
  <visiblePerson>`), so a private person is never named (FR-016, US6 scenario 4).
- Changes from someone else on a private deal find no row → `not_found` (nothing changes, nothing leaks).
- The creator and the current owner may change `private` (as SF-92 for people). Saving a private deal so that the actor is neither creator nor owner redirects to the board with `deal_no_longer_visible` (SF-92 FR-003 for people).
- Plan Review (alexis@barnacle.ai): a private deal is visible to its creator and its owner, nobody else, admins included. `visiblePerson` itself is changed by SF-92; deal code only calls it, so people on deals follow whichever rule is merged.
- The migration is `0004_pipelines_deals.sql` and its kind check includes SF-92's `'handed_over'` (Plan Review).
- A hidden main person is kept on edit when the person field comes back empty (spec Clarifications).

## 6. Pipelines and stages: order, names, delete

- **Decision**: `position int` on both, renumbered 1..n inside the change's transaction (after locking the
  pipeline rows / the pipeline row), `order by position, id` when reading. Reorder is `[ ↑ ]`/`[ ↓ ]`
  (spec Clarifications), each a small form posting `{ id, direction }`.
- Names: trimmed, 1–100 characters; unique ignoring case via `unique index … (lower(name))` on pipelines and
  `(pipeline_id, lower(name))` on stages; refusal message `pipeline_name_exists` "This name is already used."
  (also caught after a unique-index race, as `organisations_name_key`).
- Delete: `deals.stage_id … references stages (id)` with no cascade, so the database itself refuses to
  delete a stage that still holds a deal (SC-007). `deleteStage(actor, stageId, targetStageId)` and
  `deletePipeline(actor, pipelineId, targetStageId)` move every deal (archived ones included) with a
  `moved` history line (`cause`) and a new stage period, then delete. Target must be in the same pipeline
  (stage) / another pipeline (pipeline). Last stage of a pipeline with deals → `stage_last_with_deals`.
  No other pipeline with a stage → `pipeline_delete_no_target`.
- Admin rights are re-checked inside each transaction with `isActiveAdmin` (as `choices.ts`).
- **Alternatives**: fractional positions / drag reorder — not needed for a handful of rows.

## 7. Board query (SC-003: 10 stages, 500 deals, < 2 s)

- **Decision**: three queries per board view, run in parallel: pipelines for the picker; stages of the
  chosen pipeline with `count(*)` and `sum(value_pence)` of visible non-archived deals (one `group by`); all
  visible non-archived cards of the pipeline (title, value, organisation name, visible person name,
  private flag, version, stage id), ordered per stage by `stage_entered_at desc`. All cards are sent; each
  column scrolls on its own (CSS `overflow-y: auto`), so header totals are always of all deals, not only
  those on screen. Index `deals (stage_id, stage_entered_at desc) where archived_at is null`.
- 500 rows with two left joins is a few milliseconds; no paging.

## 8. Organisation and person on a deal

- **Decision**: organisation reuses `resolveOrganisation` (`src/server/records/organisations.ts`) and the
  `OrganisationPicker` client component unchanged (picked id, or a typed new name linked/created exactly as on
  the person form, FR-005, US2 scenario 5). Main person: a `PersonPicker` client component built like
  `OrganisationPicker` (filters an embedded list of visible, non-archived people; no "add new"). The server
  accepts a person id only if it is visible to the actor and not archived (or is already the deal's person).
- FR-006: when the saved person has an organisation and no organisation was chosen, the deal takes the
  person's organisation (in `createDeal`/`updateDeal`, after resolving the person).
- Archived organisation/person still on a deal: shown with an "Archived" badge in the drawer. Deleted by an
  admin: `on delete set null`, the deal stays.

## 9. Page address and drawer

- **Decision**: `/deals?pipeline=<id>&open=<deal id>` (both parsed with the existing `parseId`; anything
  else is ignored). An unknown pipeline → the first pipeline; a drawer for a deal that is missing, archived,
  private to someone else or in another pipeline → no drawer. Admin delete confirmation:
  `&confirm=delete`. Fixed messages only through `?error=<code>` from an allow-list. The deleted deal's name
  comes from the existing `crm_flash` cookie (new code `deal_deleted`), never from the address.
- Add form: `/deals/new?pipeline=<id>&stage=<id>` (the `+` of a column fills both). Edit form:
  `/deals/<id>/edit`. Both redirect to `/deals?pipeline=<p>&open=<id>` after saving. `/deals/<id>` itself
  is left for the deal page in the next issue (not created now; its address shows "Page not found.").

## 10. Fake data

- **Decision**: `src/seed/deals.ts`, registered after `people` in `src/seed/index.ts`. Pipelines inserted
  `on conflict ((lower(name))) do nothing`; stages only for a pipeline it just created; deals skipped when a
  deal with the same title already exists (titles are unique within the seed). Writes `deal_stage_periods`
  and `timeline_events` for each deal so history and days-in-stage look real.

## 11. Outside services

- Only the app's own Postgres (Supabase through Supavisor in production, local Postgres in tests), as in
  SF-90. `supabase/supavisor` (commit `e59909dc629230a4c07af3df16957ef22a184774`) has an OpenAPI test for
  its own management API, not for the Postgres wire protocol the app uses; no schema applies.
