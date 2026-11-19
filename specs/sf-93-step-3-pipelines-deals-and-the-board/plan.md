# Implementation Plan: Pipelines, deals and the board

**Branch**: `factory/sf-93-step-3-pipelines-deals-and-the-board` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-93-step-3-pipelines-deals-and-the-board/spec.md`

## Summary

Add pipelines with ordered stages, deals, and the deals board (design A: rounded cards in stage columns, a
"Pipeline: <name>" picker and `[ ADD DEAL ]` above, a deal drawer on the right with `// HISTORY`). Admins
manage pipelines and stages on a new "Pipelines" admin page; anyone adds, edits, moves (drag, or the drawer's
"Move to" form) and archives deals they can see; only admins delete. Private deals are seen only by their
creator. Plain SQL on the existing Postgres (one migration: `pipelines`, `stages`, `deals`,
`deal_stage_periods`, and a `deal_id` + `moved` kind on the existing `timeline_events`), domain code in
`src/server/deals/` (pure rules unit-tested, data functions integration-tested), thin server pages, and four
client components (`Board` for drag and drop, `DealForm`, `PersonPicker`, `StageSelect`). Money stored as whole
pence. No new dependency: drag and drop uses the browser's own drag events.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions, `useActionState`, `useOptimistic`), React 19.3, `postgres` 4.1 — all already in the repo. Nothing added (research.md §1).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). New migration `migrations/0003_pipelines_deals.sql` (data-model.md).

**Testing**: Vitest (unit: money parse/format, deal and name validation, changed fields; integration against real Postgres: board counts/totals, visibility, admin checks, moves, deletes, concurrency, seed, RLS), Playwright (US1–US6 through the fake Google login, including a real drag).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers (small screens: basic layout + drawer "Move to").

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-003 board with 10 stages × 500 open deals < 2 s: three indexed queries per board (research.md §7). SC-002: card moves at once (optimistic), server confirms in well under 1 s.

**Constraints**: private deals and private people on deals never visible to anyone but their creator (SC-005); deal count unchanged by stage/pipeline deletes, enforced by a no-cascade FK (SC-007); admin checks inside the transaction (SC-006); every message from `messages.ts`; pipeline and open deal in the page address (FR-013).

**Scale/Scope**: ≤ 10 users, ~10 pipelines, ≤ 10 stages each, a few thousand deals; 5 new screens (board + drawer, add deal, edit deal, pipelines, stages of a pipeline).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail.
The binding rules are `docs/DECISIONS.md` and `AGENTS.md`; the plan is checked against them:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Board page, drawer, pipeline picker, admin pages are server-rendered (links, GET/POST forms). Client: `Board` (drag and drop), `DealForm` (`useActionState`), `PersonPicker`, `StageSelect` (stage list follows the chosen pipeline); `OrganisationPicker` and `AutoSubmit` reused | ✅ |
| Every page `requireUser()`/`requireAdmin()`; every action `requireUser()`/`assertAdminForAction()` first | Per route in contracts/routes.md; domain functions re-check visibility, `isActiveAdmin` and versions inside the transaction | ✅ |
| Messages only from `messages.ts`; never text from the URL; redirects via `isSafeNext` | New codes in contracts/routes.md § Messages; `?error=` allow-listed per page; ids parsed with `parseId`; deleted title via the `crm_flash` cookie; redirects go to fixed paths built from numeric ids | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0003_pipelines_deals.sql`: DDL only, RLS on the 4 new tables, added to `tests/integration/rls.test.ts` | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/deals.ts` registered in `src/seed/index.ts` (command already gated); "Fakeco"-style titles, owners are the fake users | ✅ |
| Anyone archives a deal; only an admin deletes (kickoff) | `archiveDeal` for any viewer; `deleteDeal` via `assertAdminForAction()` + `isActiveAdmin` in the transaction | ✅ |
| A private contact or deal hides it from everyone but its creator, admins included (kickoff) | `visibleDeal` in every deals query; people on deals through `visiblePerson` | ✅ |
| Money in GBP only (kickoff) | `value_pence`, `formatMoney` in GBP only | ✅ |
| A deal has one main contact (+ others later) (kickoff) | `deals.person_id`; other linked people and followers left for the next issue (spec Assumptions) | ✅ |
| Users are deactivated, never deleted (SF-80) | owner/creator/actor FKs to `users` without cascade; "(deactivated)" shown | ✅ |
| Design B shell; design A for the board (spec Clarifications) | Pages inside `(app)`; sidebar via `nav.ts`; cards are the one rounded surface | ✅ |
| Every outside service has a fake | No new outside service (only the existing Postgres) | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-93-step-3-pipelines-deals-and-the-board/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: tables, visibility, validation, state changes, fake data
├── quickstart.md        # Phase 1: how to validate end-to-end
├── contracts/
│   └── routes.md        # Pages, query parameters, server actions, messages, history lines
├── dependencies.json    # Direct dependencies this change adds ([])
├── blueprints.json      # [] (no blueprint applies: the only one, ui/map-cursor, is for maps)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0003_pipelines_deals.sql        # pipelines, stages, deals, deal_stage_periods; timeline_events changes; RLS

src/
├── app/(app)/
│   ├── nav.ts                       # + { href: "/deals", label: "Deals" } after Home; + { href: "/admin/pipelines", label: "Pipelines" }
│   ├── deals/
│   │   ├── page.tsx                 # board: head + picker, Board, drawer (?open=), delete confirm, flash
│   │   ├── Board.tsx                # 'use client': columns, cards (links), native drag and drop, useOptimistic,
│   │   │                            #   calls moveDealFromBoard; stale → router.refresh() + message; throw → revert + message
│   │   ├── DealDrawer.tsx           # server: details, Move to form, EDIT/ARCHIVE/DELETE/CLOSE, // HISTORY
│   │   ├── DealForm.tsx             # 'use client' (useActionState): title, value, StageSelect (new only),
│   │   │                            #   OrganisationPicker, PersonPicker, owner, expected close (type=date), Private (creator)
│   │   ├── StageSelect.tsx          # 'use client': pipeline <select> + stage <select> filtered by pipeline
│   │   ├── new/page.tsx             # add form (?pipeline=&stage=)
│   │   ├── [id]/edit/page.tsx       # edit form (hidden id, version)
│   │   └── actions.ts               # createDeal, updateDeal, moveDealFromBoard, moveDeal, archiveDeal, deleteDeal
│   ├── admin/pipelines/
│   │   ├── page.tsx                 # pipelines: add, rename, ↑/↓, delete (?delete=<id> confirm with target stage)
│   │   ├── [id]/page.tsx            # stages of one pipeline: add, rename, ↑/↓, delete (?delete=<stageId>)
│   │   └── actions.ts               # add/rename/move/delete pipeline and stage
│   └── records/
│       ├── PersonPicker.tsx         # 'use client': like OrganisationPicker, visible non-archived people, no "add new"
│       └── Timeline.tsx             # + `heading` prop ("HISTORY" on deals), + "moved" line
├── server/
│   ├── deals/
│   │   ├── rules.ts                 # PURE: parseMoney, validateDeal, validatePipelineName, changedDealFields, DEAL_FIELDS
│   │   ├── deals.ts                 # getBoard, getDeal, dealFormChoices, create/update/move/archive/delete
│   │   └── pipelines.ts             # list, get, add/rename/move/delete pipeline and stage (isActiveAdmin re-check)
│   ├── records/
│   │   ├── visibility.ts            # + visibleDeal(db, viewerId, alias = "d")
│   │   ├── timeline.ts              # + dealId target, "moved" kind, from/to stage, cause; deal visibility check
│   │   ├── flash.ts                 # + "deal_deleted" in CODES
│   │   └── form-data.ts             # + dealFormFromData
│   ├── format.ts                    # + formatMoney(pence | null)
│   └── messages.ts                  # + codes and templates (contracts/routes.md § Messages)
├── seed/
│   ├── index.ts                     # + { name: "deals", run: seedDeals } after people
│   └── deals.ts                     # 5 pipelines, ≥ 40 deals, periods and events; idempotent
└── app/globals.css                  # + board, columns, rounded cards, deal drawer, picker, admin rows

tests/
├── unit/                            # deals-rules (money, validation, changed fields), format (formatMoney), messages
├── integration/                     # deals (board counts/totals SC-004), deals-private (SC-005), deals-admin (SC-006),
│                                    #   pipelines (names, order, deletes SC-007), deals-concurrency (stale, edit conflict),
│                                    #   board-performance (SC-003), seed, rls (+4 tables), migrate
└── e2e/                             # board.spec.ts, deals.spec.ts, pipelines.spec.ts, deals-private.spec.ts
```

**Structure Decision**: same single Next.js project. Deals get their own domain folder `src/server/deals/`
(pages stay thin, rules tested without the UI) and reuse `src/server/records/common.ts` (`Refused`,
`isActiveAdmin`, `resolveOwner`, `ownerOptions`, `isUniqueViolation`), `resolveOrganisation`, the timeline,
the flash cookie and the drawer styles. The privacy rules for people and deals live together in
`src/server/records/visibility.ts`.

## Build steps (in order)

1. **Migration** `migrations/0003_pipelines_deals.sql` exactly as data-model.md (confirm the two default
   constraint names on `timeline_events` first); add `pipelines`, `stages`, `deals`, `deal_stage_periods` to
   `tests/integration/rls.test.ts`; `tests/support/reset.ts` empties the four new tables.
2. **Pure rules** `src/server/deals/rules.ts` + `formatMoney` in `src/server/format.ts` (research.md §2,
   data-model.md § Validation); messages and templates in `src/server/messages.ts`.
3. **Visibility and timeline**: `visibleDeal`; `readTimeline({ dealId })` returns nothing for a deal the
   viewer cannot see; `recordEvent` accepts `{ dealId }` and `fromStage`, `toStage`, `cause`.
4. **Pipelines domain + admin pages** (`src/server/deals/pipelines.ts`, `/admin/pipelines`,
   `/admin/pipelines/[id]`), nav entry "Pipelines".
5. **Deals domain** (`src/server/deals/deals.ts`): create (open period, `added`), update (version, FR-006,
   hidden-person rule, `edited` with fields), move (research.md §4: close/open period, `moved`), archive,
   delete; `getBoard` (research.md §7).
6. **Board page, drawer, forms, Board client component**, nav entry "Deals", CSS: columns with
   `overflow-y: auto` and a fixed min width (the board scrolls sideways with ≥ 10 stages), long titles wrap
   (`overflow-wrap: anywhere`), cards `border-radius: 8px` (the only rounded surface), selected card with a
   blue outline, header "<n> deals · £total" in mono.
7. **Fake data** `src/seed/deals.ts` (data-model.md § Fake data).
8. **Docs**: `docs/DECISIONS.md` gets one line per spec clarification people made — "Only admins create,
   rename, reorder and delete pipelines and stages, on a Pipelines admin page (SF-93)", "The deals board
   uses design A: rounded cards in stage columns, a pipeline picker and a deal drawer (SF-93)", "Deal cards
   show no "No next activity" warning until activities exist (SF-93)" — plus the factory choices once the
   Plan Review confirms them. README: new pages and fake data. AGENTS.md § Layout: `src/server/deals/`
   (`rules.ts` pure, `deals.ts`, `pipelines.ts`) and `visibleDeal` beside `visiblePerson`.

No blueprint applies, so there is no blueprint exception and no `Departs from blueprint` line for
`docs/DECISIONS.md`.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor at commit e59909dc629230a4c07af3df16957ef22a184774, which only has an OpenAPI test for its own management API, and github.com/supabase/supabase during SF-90; the app speaks the standard Postgres protocol, the new code only adds tables to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: the board, drag and drop and money formatting all run in the app and the browser.

## Complexity Tracking

No constitution violations to justify.
