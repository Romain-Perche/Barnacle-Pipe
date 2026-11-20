# Implementation Plan: Deal list view and deal page

**Branch**: `factory/sf-95-step-4-deal-list-view-and-deal-page` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-95-step-4-deal-list-view-and-deal-page/spec.md`

## Summary

Add the full deal page (design C: solid green `[ WON ]` / red `[ LOST ]`, an arrow-shaped stage bar with whole days per
stage, a strip with value, owner, expected close and status, // DETAILS, // HISTORY, the lost reason asked in a box over
the page), Won / Lost / Reopen, restoring archived deals, a deal list at `/deals/list` (filter row, sortable table, count
and total, preview drawer, "Show closed deals" / "Show archived deals"), other linked people, deal labels (a separate
admin-managed list on the existing "Lead sources and labels" page) and followers. One migration (`0005_deal_page.sql`:
status columns on `deals`, 4 new tables, 3 new history kinds and a reason column), domain code in `src/server/deals/`
(pure rules unit-tested, data functions integration-tested), thin server pages, plain forms and server actions. No
new client component except reuse of `PersonPicker` and `AutoSubmit`. No new dependency.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions, segment `not-found.tsx`), React 19.3, `postgres`
4.1 — all already in the repo. Nothing added (research.md §1).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). New migration
`migrations/0005_deal_page.sql` (data-model.md).

**Testing**: Vitest (unit: `stageBar`, `validateLostReason`, `parseDealsQuery`/`withParams` for deals, labels in
`changedDealFields`, `formatDays`, messages; integration against real Postgres: won/lost/reopen/restore with periods and
board counts, stage days, list filters/sorts/count/total, privacy, links, followers, deal labels admin, performance,
seed, RLS, migrate), Playwright (US1–US5 through the fake Google login).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-003 list of 2,000 deals with filters and sort < 2 s: two queries per page plus filter options,
`deals_created_at_idx` and `deal_label_links_label_idx` (research.md §11). Deal page: 5 small queries.

**Constraints**: private deals and private people never visible, counted or changeable for anyone the rules hide them
from (SC-006); closed and archived deals never on the board (SC-005); delete admin-only, re-checked in the transaction
(SC-007); every message from `messages.ts`; list state in the address, unknown values ignored (FR-013); lost reason
shown as plain text (FR-021).

**Scale/Scope**: ≤ 10 users, a few thousand deals; 2 new screens (deal list + drawer, deal page with the Lost box), 3
changed (board, edit deal, lead sources and labels).

No NEEDS CLARIFICATION left: research.md resolves each open point.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail. The binding
rules are `docs/DECISIONS.md` and `AGENTS.md`; the plan is checked against them:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | List, deal page, Lost box, stage bar, follow/link/unlink are server-rendered forms and links. Client components only reused: `PersonPicker` (link a person), `AutoSubmit` (filter row), `DealForm` (already client) | ✅ |
| Every page `requireUser()`/`requireAdmin()`; every action `requireUser()`/`assertAdminForAction()` first | Per route in contracts/routes.md; domain functions re-check `visibleDeal`, state, version and `isActiveAdmin` inside the transaction | ✅ |
| Messages only from `messages.ts`; never text from the URL; redirects via fixed paths | New codes in contracts/routes.md § Messages; `?error=` allow-listed per page; `back` allow-listed; redirects built from numeric ids | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0005_deal_page.sql`: DDL only, RLS on the 4 new tables, added to `rls.test.ts` | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/deals.ts` (already registered, command gated); "(won)"/"(lost)" Fakeco-style titles, fake reasons | ✅ |
| Anyone archives a deal, only an admin deletes (kickoff) | Restore for any viewer; delete from the page via `assertAdminForAction()` + `isActiveAdmin` | ✅ |
| A private deal: creator and owner only; a private person: creator and owner only (SF-92, SF-93) | `visibleDeal` in list, count, total, page, every action; `visiblePerson` on main and other people and on link events in the history | ✅ |
| A deal has one main contact plus any number of other linked people; teammates can follow a deal (kickoff) | `deal_people`, `deal_followers` (this issue) | ✅ |
| Only admins add, rename and remove lead sources and labels, on an admin page (SF-90) | Deal labels on the same page, same `choices.ts` admin re-check | ✅ |
| People and organisation lists use design C (SF-90); deal page design C (spec Clarifications) | Deal list reuses `FilterRow`, `SortHeader`, `Cell`, `Pager`, drawer; deal page per `design-options.html` C | ✅ |
| Money in GBP; users deactivated, never deleted | `formatMoney`; followers keep "(deactivated)" | ✅ |
| Every outside service has a fake | No new outside service | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-95-step-4-deal-list-view-and-deal-page/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, state changes, validation, fake data
├── quickstart.md        # Phase 1: how to validate end-to-end
├── contracts/
│   └── routes.md        # Pages, query parameters, server actions, domain functions, messages
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (no blueprint applies: the only one, ui/map-cursor, is for maps)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0005_deal_page.sql                 # data-model.md § Migration

src/
├── app/(app)/
│   ├── deals/
│   │   ├── page.tsx                   # + Board/List switch; drawer gets list-agnostic props
│   │   ├── ViewSwitch.tsx             # server: [ BOARD ] [ LIST ] links, current one aria-current="page"
│   │   ├── DealDrawer.tsx             # + hereHref/closeHref/deleteHref props, canMove, status/archived badges, [ OPEN DEAL PAGE ]
│   │   ├── DealForm.tsx               # + label checkboxes (as PersonForm), hidden `back`
│   │   ├── actions.ts                 # + markWon, markLost, reopenDeal, restoreDeal, moveDealFromPage, linkPerson,
│   │   │                              #   unlinkPerson, followDeal, unfollowDeal; updateDeal/archiveDeal/deleteDeal read `back`
│   │   ├── list/page.tsx              # the deal list (contracts/routes.md § Pages)
│   │   └── [id]/
│   │       ├── page.tsx               # the deal page, design C
│   │       ├── StageBar.tsx           # server: arrows, days, form buttons on open deals
│   │       ├── LostBox.tsx            # server: overlay box, ?confirm=lost
│   │       ├── not-found.tsx          # "This deal doesn't exist or you can't see it."
│   │       └── edit/page.tsx          # + labels, ?back=page
│   ├── admin/lead-sources-and-labels/ # + "Deal labels" list and its three actions
│   └── records/
│       ├── ListBits.tsx               # SortHeader accepts DealsQuery; FilterRow takes `toggles` (default: Show archived)
│       └── Timeline.tsx               # + won / lost (reason) / reopened; deal wording for link lines
├── server/
│   ├── deals/
│   │   ├── rules.ts                   # + stageBar, validateLostReason, labelIds in DealForm/DealFields/DEAL_FIELDS, BACK values
│   │   ├── deals.ts                   # + status changes, restore, getStageSeconds, richer getDeal, labels on update, open-only board/move
│   │   ├── list.ts                    # listDeals, dealFilterOptions
│   │   └── links.ts                   # linkPerson, unlinkPerson, followDeal, unfollowDeal
│   ├── records/
│   │   ├── list-query.ts              # + parseDealsQuery, DEAL_SORTS, per-list defaults in withParams, hasDealFilters
│   │   ├── choices.ts                 # + kind "deal_label"
│   │   ├── timeline.ts                # + kinds won/lost/reopened, `reason`; deal history hides events about hidden people
│   │   └── form-data.ts               # dealFormFromData + labelIds
│   ├── format.ts                      # + formatDays
│   └── messages.ts                    # + codes (contracts/routes.md § Messages)
├── seed/deals.ts                      # + deal labels, won/lost deals with multi-stage histories, links, followers
└── app/globals.css                    # + view switch, stage arrows, strip, solid won/lost buttons, overlay box

tests/
├── unit/                              # deals-rules (stageBar, lost reason, labels), list-query (deals), format, messages
├── integration/                       # deals-status, deals-list, deals-links, deal-labels, stage-days, deals-list-performance,
│                                      #   + board (closed excluded), seed, rls (+4), migrate, reset
└── e2e/                               # deal-page.spec.ts, deal-list.spec.ts, deal-labels.spec.ts
```

**Structure Decision**: same single Next.js project. Deals keep their domain folder `src/server/deals/`; the list and
links get their own files so `deals.ts` stays readable. List addresses keep one helper (`list-query.ts`) for people,
organisations and deals. Privacy stays in `visibility.ts` (`visibleDeal`, `visiblePerson`), used by every new query.

## Build steps (in order)

1. **Migration** `migrations/0005_deal_page.sql` exactly as data-model.md (confirm `timeline_events_kind_check` is the
   current constraint name on a migrated database first). Add `deal_labels`, `deal_label_links`, `deal_people`,
   `deal_followers` to `tests/integration/rls.test.ts`; `tests/support/reset.ts` and `.factory/run/reset-db.sh` truncate
   them.
2. **Pure rules**: `stageBar`, `validateLostReason`, `labelIds` in `DealForm`/`DealFields`/`DEAL_FIELDS` (after Person),
   `parseDealsQuery` + per-list defaults in `withParams` (people/organisations unchanged: `sort=name`, `dir=asc`; deals:
   `sort=added`, `dir=desc`), `formatDays`; messages and templates.
3. **Timeline**: kinds `won`, `lost`, `reopened`, `reason` in `recordEvent`/`readTimeline`; for `{ dealId }` add
   `and (e.related_person_id is null or visiblePerson(rp))` (join `persons rp` already there). `Timeline.tsx`: the new
   lines; on `heading="HISTORY"` link lines read "Linked <person> by <name>" / "Unlinked <person> by <name>".
4. **Deals domain** (`deals.ts`): `getBoard` and `moveDeal` open-only; `transferDeal` inserts a closed period for a
   closed deal; `getDeal` + status, labels (all the deal has, removed included), other people (`visiblePerson`), followers; `getStageSeconds`;
   `markWon`, `markLost`, `reopenDeal`, `restoreDeal` (data-model.md § State changes); `updateDeal` + labels (a requested id
   is kept when it is a non-removed deal label or already on the deal, as `allowedLabels` for people; links rewritten) and removing the new main person
   from `deal_people`; `dealFormChoices` + labels (non-removed plus the deal's own, as
   `personFormChoices`). Removed deal labels behave as removed people labels (spec Clarifications, research.md §6).
5. **Links** (`links.ts`): link/unlink with the already-linked check and `person_linked`/`person_unlinked` events;
   follow/unfollow (no event).
6. **Deal labels admin**: `choices.ts` kind `deal_label` (`deal_label_exists` on a duplicate); three actions; the
   "Deal labels" list on the page; allow-list `deal_label_exists`.
7. **List** (`list.ts`, `/deals/list`): research.md §5; `FilterRow` `toggles` prop (`closed` "Show closed deals",
   `archived` "Show archived deals"); `[ CLEAR ]`; drawer via `DealDrawer`.
8. **Deal page** (`/deals/[id]`, `StageBar`, `LostBox`, `not-found.tsx`), the board's Board/List switch and
   `[ OPEN DEAL PAGE ]`, `back` handling in update/archive/delete, edit page labels and `?back=page`. CSS: stage arrows
   with `clip-path` (current stage `--blue` background, done stages a light blue wash, later stages muted), strip in
   mono labels with sans values, `[ WON ]` solid `#16A34A`, `[ LOST ]` solid `--danger`, the Lost box with
   `border-radius: 8px` and a shadow over a dimmed page (as `design-options.html` C), long titles and reasons wrap
   (`overflow-wrap: anywhere`).
9. **Fake data** (`src/seed/deals.ts`, data-model.md § Fake data), idempotent.
10. **Docs**: `docs/DECISIONS.md` gets one line per spec clarification people made — "The deal page uses design C: solid
    Won and Lost buttons in the header, an arrow-shaped stage bar with days per stage, a summary strip, and the lost
    reason asked in a box over the page; the deal list follows the People list (SF-95)", "A lost reason is typed as free
    text (SF-95)", "Deal labels are a separate list, managed by admins on the Lead sources and labels page (SF-95)", "A removed deal
    label stays on the deals that have it and in the list's label filter, and is no longer offered on the edit form, as
    people labels (SF-95)" —
    plus the factory choices in spec.md § Clarifications once the Plan Review confirms them. README: the list, the deal
    page and the new fake data. AGENTS.md § Layout: `deals/list.ts`, `deals/links.ts`, the deal page folder.

No blueprint applies, so there is no blueprint exception and no `Departs from blueprint` line for `docs/DECISIONS.md`.

## Fix round 1

**Problem.** The AI review (feature test US3 scenario 5 and the code review) found that `/deals/list?owner=99999` or
`?label=99999` shows "0 deals · £0" and "No deals match these filters." while the filter row shows "Any owner" /
"Any label". FR-013 says unknown values in the address are ignored.

**Cause.** `src/app/(app)/deals/list/page.tsx` keeps `pipeline`, `stage` and `status` only when they are known, but
passes `owner` and `label` from `parseDealsQuery` to `listDeals` and `hasDealFilters` unchecked.

**Fix.** Move the "keep only known values" step out of the page into a pure function `knownDealsQuery(parsed, options)`
in `src/server/records/list-query.ts`: it keeps `pipeline` when it is in `options.pipelines`, `stage` when the pipeline
is kept and the stage is in `options.stages`, `owner` when it is in `options.owners`, `label` when it is in
`options.labels`, `status` only with closed or archived shown; everything else unchanged. The page uses it for the
query it lists, counts, totals, shows back and passes to `hasDealFilters`. An owner with no visible deal is not an
option, so it is ignored too (the list would be empty anyway, and the filter row could not show it).

**Files.** `src/server/records/list-query.ts`, `src/app/(app)/deals/list/page.tsx`, `tests/unit` (list-query test),
`tests/e2e/deal-list.spec.ts`. No new dependency, no new outside service.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor at commit e59909dc629230a4c07af3df16957ef22a184774, which only has an OpenAPI test for its own management API, and github.com/supabase/supabase, during SF-90 and SF-93; the app speaks the standard Postgres protocol, the new code only adds tables and columns to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: the list, the deal page, Won/Lost, labels, links and followers all run in the app and its
database.

## Complexity Tracking

No constitution violations to justify.
