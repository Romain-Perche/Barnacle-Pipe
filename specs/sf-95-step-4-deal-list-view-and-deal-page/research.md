# Research: Deal list view and deal page

Every "NEEDS CLARIFICATION" of the Technical Context is resolved here. Each section: Decision, Rationale,
Alternatives considered. The code read for this research: `src/server/deals/deals.ts`, `src/server/deals/rules.ts`,
`src/server/records/{list-query,choices,timeline,visibility,people}.ts`, `src/app/(app)/deals/*`,
`src/app/(app)/people/page.tsx`, `src/app/(app)/records/*`, `migrations/0004_pipelines_deals.sql`.

## 1. Dependencies

- **Decision**: nothing added. List, deal page, Lost box, stage bar and labels are server-rendered pages,
  links and forms on the existing stack; the arrow-shaped stage bar is CSS `clip-path` (as in
  `design-options.html`).
- **Rationale**: every piece already exists in the repo (filter row, table, drawer, `AutoSubmit`,
  `PersonPicker`, `DeleteConfirm`, flash cookie, timeline).
- **Alternatives**: a modal/dialog library for the Lost box (unneeded: a server-rendered overlay works without
  JavaScript, like `DeleteConfirm`); a data-grid library for the list (the People list already does it).

## 2. Deal status: columns on `deals`, not a separate table

- **Decision**: `deals.status` (`open` | `won` | `lost`, default `open`), `deals.closed_at`, `deals.lost_reason`,
  with a check keeping them consistent (`open` ⇔ no `closed_at`; `lost` ⇔ a reason). The reason is also copied
  on the history event (`timeline_events.reason`) because reopening clears the deal's reason but the history line
  "Marked as lost by <name>: <reason>" must stay.
- **Rationale**: one row read for the board/list filter (`status = 'open'`), the partial board index stays small;
  the history keeps what was said at the time.
- **Alternatives**: a `deal_outcomes` table (one more join everywhere for one value); deriving status from the
  last event (slow to filter and sort).

## 3. Days per stage

- **Decision**: from `deal_stage_periods` (SF-93): for each stage of the deal's **current** pipeline, sum
  `coalesce(left_at, now()) - entered_at` of the deal's periods with that `stage_id`, then floor to whole days
  (sum first, then floor: a deal that came back adds both periods). Marking Won or Lost **closes** the open period
  (`left_at = now()`); reopening **opens** a new period in the same stage. So stage days stop while a deal is
  closed and go on after reopening, with no special case in the read. Archiving does nothing to periods (the count
  of an archived open deal goes on). Bar states, in a pure function `stageBar()` in `src/server/deals/rules.ts`:
  stages before the current one `done` with their days (0 when skipped), current `now` with its days, later ones
  `next` with no count (even if visited earlier — spec US1 scenario 2).
- **Stage or pipeline delete on a closed deal** (`transferDeal`, SF-93): a closed deal has no open period, so
  `transferDeal` inserts the new period already closed (`entered_at = left_at = now()`) when the deal is not
  `open`; reopening then opens a fresh one. Without this a moved closed deal would start counting again.
- **Rationale**: the period table already holds the truth (SC-004: the days shown equal the recorded periods by
  construction); one grouped query per page.
- **Alternatives**: compute "end = closed_at" in the read (breaks when a closed deal is moved by a stage delete:
  a period would start after `closed_at`); store days on the deal (gets stale).

## 4. Where the list lives

- **Decision**: a separate route `/deals/list` beside the board at `/deals`; both heads have a "Board | List"
  switch (two links, the current one `aria-current="page"`). The sidebar "Deals" link stays `/deals` and is already
  marked current on `/deals/*` (`SidebarLink` prefix match).
- **Rationale**: the board page keeps its address and tests (SF-93); the list has its own query parser and
  defaults without a `view=` switch in one page.
- **Alternatives**: `/deals?view=list` (mixes two query grammars in one parser).

## 5. List address and query

- **Decision**: `parseDealsQuery(params)` in `src/server/records/list-query.ts`, same rules as people and
  organisations: `q` (title text, ≤ 200), `pipeline`, `stage`, `owner`, `label` (ids), `status` (`open|won|lost`),
  `closed=1`, `archived=1`, `sort` (`title|value|organisation|stage|owner|close|added`, default `added`), `dir`
  (default `desc` for deals: "newest first"), `page`, `open`. `withParams` and `SortHeader` get the deals query and
  a per-list defaults table (`DEFAULTS` becomes per list; people/organisations keep `sort=name, dir=asc`).
  Server-side checks after parsing: `stage` kept only when it belongs to the chosen `pipeline`; `status` only used
  when `closed` or `archived` is on; ids that match nothing simply match no row and are never shown back (the
  selects only show known options).
- **Filters as SQL**: `archived=1` → `archived_at is not null` (every status: spec US4 scenario 1 and Edge Cases);
  else `archived_at is null and (closed=1 ? true : status = 'open')`; then `status`, `pipeline`, `stage`, `owner`,
  `label` (`exists` on `deal_label_links`, removed labels included), `title ilike %q%` (escaped with `escapeLike`). Always
  `visibleDeal()`.
- **Count and total** (FR-012): one `select count(*), coalesce(sum(value_pence), 0)` with the same `where`
  (all matching deals, not the page). Header "<n> deals · £<total>".
- **Sort**: `title` → `lower(title)`; `value` → `value_pence <dir> nulls last`; `organisation` → `lower(o.name) <dir>
  nulls last`; `stage` → `pl.position, s.position`; `owner` → `lower(u.name)`; `close` → `expected_close_on <dir> nulls
  last`; `added` → `created_at`; each then `d.id <dir>` so pages are stable. Page past the last → last page.
- **Rationale**: the same shapes and helpers the People list uses; one way to build list addresses.
- **Alternatives**: a second address helper for deals (two ways of doing one thing).

## 6. Deal labels

- **Decision**: a separate list `deal_labels` (id, name, removed_at; unique `lower(name)`) like `labels`, and a link
  table `deal_label_links (deal_id, label_id)`. Managed through `src/server/records/choices.ts` with a third kind
  `deal_label` (same add / rename / remove, same admin re-check). The admin page gets a third `ChoiceList`
  "Deal labels". The duplicate message for deal labels is "This name is already used." (spec US5 scenario 4) —
  a new code `deal_label_exists`; people labels and lead sources keep "This name is already on the list.".
- **Removed deal labels** (spec Clarifications 2026-11-20, alexis@barnacle.ai; Edge Cases; FR-017): exactly as
  removed people labels in `src/server/records/people.ts` (SF-90). Removing sets `removed_at`; the link rows stay.
  The deal page and the list row show every label the deal has, removed or not. `dealFilterOptions` offers
  non-removed deal labels plus removed ones that a deal the viewer can see has (as `peopleFilterOptions`).
  `dealFormChoices` offers non-removed deal labels plus the ones the deal already has (as `personFormChoices`).
  On save, a requested id is kept when it is a non-removed deal label or one the deal already has (as
  `allowedLabels`); all links are then rewritten and compared, so a kept removed label makes no "Edited: Labels"
  line and an unticked one is gone for good. Re-adding the name brings the removed entry back (SF-90).
- **Alternatives (removed labels)**: hide removed labels everywhere (the first plan; replaced by the person's
  answer: it would make one label list behave unlike the other).
- **Labels on edit**: `DealForm` gets the label checkboxes the person form has; `DEAL_FIELDS` gets
  `["labelIds", "Labels"]` so a change is recorded "Edited by <name>: Labels".
- **Alternatives**: one `labels` table with a `kind` column (would change SF-90's unique index and every label
  query).

## 7. Other linked people and followers

- **Decision**: `deal_people (deal_id, person_id, linked_by, created_at)`, primary key `(deal_id, person_id)`,
  both FKs `on delete cascade`; `deal_followers (deal_id, user_id, created_at)`, primary key `(deal_id, user_id)`,
  `deal_id` cascades, `user_id` no cascade (users are never deleted). Link and unlink record the existing
  `person_linked` / `person_unlinked` kinds with `deal_id` and `related_person_id`; following records nothing.
- **Already linked**: refused with "This person is already linked to this deal." when the person is the main
  person or in `deal_people` (checked under the deal's row lock; the primary key catches a race).
- **Main person set to someone already in "Other people"** (edit): that link row is removed in the same
  transaction (the person stays linked, as main), no extra history line beyond "Edited: Person".
- **Privacy**: other people are read with `visiblePerson()`; a hidden one is never shown, named or counted. The
  deal history leaves out link events about a person the viewer cannot see (the organisation timeline already does
  this; `readTimeline({ dealId })` gets the same `related_person_id is null or visiblePerson(rp)` condition).
  A deleted person: the link row goes (cascade); events stay as "A deleted person was linked/unlinked" (SF-92;
  `deletePerson` already removes events about a person who was private).
- **Who can link**: anyone who sees the deal, people they can see and that are not archived (the picker offers
  only those; the server re-checks). An archived person already linked stays shown, marked "Archived".

## 8. Deal page, Lost box and messages in the address

- **Decision**: `/deals/[id]` server page, design C. Query: `confirm=delete` (admins), `confirm=lost` (Lost box,
  open non-archived deal), `error` from an allow-list (`deal_edit_conflict`, `lost_reason_required`,
  `lost_reason_too_long`, `deal_person_already_linked`). Every button is a plain form posting to a server action
  that redirects back to `/deals/<id>` (or `?error=` / `?confirm=lost&error=…`). The Lost box is a server-rendered
  overlay (`role="dialog"`, `aria-modal="true"`, textarea `autoFocus`, `maxLength=500`) with `[ MARK AS LOST ]` and
  `[ CANCEL ]` (link back to the page) — works without JavaScript, like `DeleteConfirm`.
- **Missing, deleted or hidden deal**: `notFound()` with a segment `src/app/(app)/deals/[id]/not-found.tsx`
  showing "This deal doesn't exist or you can't see it." (HTTP 404; also covers `/deals/<id>/edit`).
- **Stale**: Won, Lost, Reopen and the stage bar post the page's `version`; a different version (or a deal that
  became closed/archived in between) → `?error=deal_edit_conflict` ("Someone else changed this deal while you were
  editing. Reload to see their changes."), nothing changes.
- **Where actions return**: the edit form and delete get a hidden `back` field (allow-list `page` | `list`;
  anything else = board as today). From the deal page, a save returns to `/deals/<id>`; a delete goes to
  `/deals/list` with the "<title> was deleted." flash; a save that hides a private deal goes to `/deals/list` with
  `deal_no_longer_visible`. From the board, behaviour is unchanged (SF-93 tests keep passing).

## 9. Drawer on the list

- **Decision**: reuse `DealDrawer` with props for its links (`hereHref`, `closeHref`, `deleteConfirmHref`) and
  `canMove`. On the list the drawer opens for any deal the viewer sees (open, closed, archived). Closed deal: "Won"
  or "Lost" badge with the date, no "Move to". Archived: "Archived" badge, only `[ OPEN DEAL PAGE ]` and
  `[ CLOSE ]`. Both drawers get `[ OPEN DEAL PAGE ]` → `/deals/<id>` (FR-004). The board drawer still only opens
  open, non-archived deals of the shown pipeline.

## 10. Server-side rules for closed deals

- `getBoard` adds `d.status = 'open'` (FR-006); `deals_board_idx` is recreated with `where archived_at is null and
  status = 'open'`.
- `moveDeal` returns `stale` when the deal is not `open` (closed deals do not change stage until reopened).
- `updateDeal` works on closed deals (not on archived ones, as today); it never changes status, value is untouched by
  Won/Lost.
- `archiveDeal` works on any status; `restoreDeal` clears `archived_at` only (status kept, FR-014).
- Won/Lost/Reopen/Restore are allowed to anyone who sees the deal (PRODUCT §7: owner is not a permission).

## 11. Performance (SC-003)

- **Decision**: two queries per list page (count+total, page rows with joins and an `array()` of label names),
  plus filter options. 2,000 deals is far below where indexes matter, but `deals_created_at_idx (created_at desc,
  id desc)` keeps the default order an index scan and `deal_label_links_label_idx` serves the label filter. An
  integration test seeds 2,000 deals and checks a filtered, sorted page answers in < 2 s (as
  `lists-performance.test.ts`).

## 12. Outside services

- **Decision**: none new. The new code only reads and writes the app's own Postgres (Supabase in production).
  The Supavisor/Supabase search for a schema was done in SF-93 and its line is repeated in plan.md.
