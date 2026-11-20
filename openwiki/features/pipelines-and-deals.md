---
type: feature
title: Pipelines, deals and the board
description: The Deals board with native drag and drop, the deal list, the deal page with Won, Lost and Reopen, deal labels, linked people and followers, private deals, optimistic stage moves with history, and the admin Pipelines pages.
tags: [deals, pipelines, stages, board, timeline, private]
sources:
  - id: sf93-src-deals
    resource: repo://src/server/deals/deals.ts
  - id: sf93-src-pipelines
    resource: repo://src/server/deals/pipelines.ts
  - id: sf93-src-rules
    resource: repo://src/server/deals/rules.ts
  - id: sf93-src-visibility
    resource: repo://src/server/records/visibility.ts
  - id: sf93-src-board
    resource: repo://src/app/(app)/deals/Board.tsx
  - id: sf93-src-migration
    resource: repo://migrations/0004_pipelines_deals.sql
  - id: sf95-src-list
    resource: repo://src/server/deals/list.ts
  - id: sf95-src-links
    resource: repo://src/server/deals/links.ts
  - id: sf95-src-migration
    resource: repo://migrations/0005_deal_page.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-20T11:58:24.937Z
generated: { by: "claude-code", at: "2026-11-20T11:58:24.937Z" }
---

# Pipelines, deals and the board

Staff track deals on a board of stages. The tables are described in
[Database schema](../data/database-schema.md); how data moves between the pages, the tables and the
browser is drawn in [`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md) (group "Deals"). People and
organisations that deals link to are in [People and organisations](people-and-organisations.md).

## Pages

- `src/app/(app)/deals/`: the board (`page.tsx`, `Board.tsx` using native drag and drop), the deal drawer
  (`DealDrawer.tsx`), forms (`DealForm.tsx`, `new/`, `[id]/edit/`), `StageSelect.tsx` and the server actions in
  `actions.ts`. `ViewSwitch.tsx` switches between Board and List; `list/page.tsx` is the deal list; `[id]/page.tsx`
  is the deal page (`StageBar.tsx`, `LostBox.tsx`, `not-found.tsx`). **Deals** is in `mainNav` of `nav.ts`.
- `src/app/(app)/admin/pipelines/`: the admin pages for pipelines and their stages. **Pipelines** is in `adminNav`.

Every page calls `requireUser()` or `requireAdmin()` and every action checks the user first (see
[Sessions and access control](../auth/sessions-and-access-control.md)).

## Domain code

`src/server/deals/rules.ts` holds the pure rules (money in pence, validation, board address). `deals.ts` has the
board (`getBoard`), the deal (`getDeal`), and add, edit, move, archive and delete. `pipelines.ts` has the admin
changes to pipelines and stages. `list.ts` reads the deal list (rows across pipelines, count, total and filter
options) and `links.ts` links other people to a deal and manages followers.

- **Board**: one pipeline at a time (no or an unknown id shows the first). A column's count and total cover the
  visible, non-archived deals of its stage; a deal with no value counts as £0.
- **Private deals**: every `deals` read goes through `visibleDeal()` in `records/visibility.ts`: a private deal is
  seen by its creator or its owner only.
- **Moves**: `moveDeal` locks the deal row and answers `stale` when the deal is gone, archived, won or lost, at
  another version or no longer in the stage the drag started from; `same` when the stage does not change. A real move goes
  through `transferDeal`, which closes the open `deal_stage_periods` row, opens a new one and records a `moved`
  timeline event with stage names ("Sales · Qualified" when the pipeline changes).
- **Deal list**: `getDeal`-style reads in `list.ts` go through `visibleDeal()` (and `visiblePerson()` for the main
  person), so a private deal or person is never listed, named or counted for anyone it is hidden from.
- **Won, Lost, Reopen**: `markWon`, `markLost` (a reason of up to 500 characters is required) and `reopenDeal`
  lock the deal and answer `conflict` for a wrong version, an archived deal or a status that no longer allows the
  change. Closing ends the open stage period; reopening starts a new one in the stage the deal kept. Each records a
  `won`, `lost` (with the reason) or `reopened` timeline event. `restoreDeal` brings an archived deal back in its stage.
- **Labels, linked people, followers**: deal labels are kept by admins on the lead sources and labels page
  (`choices.ts`, kind `deal_label`) and are separate from people labels. `linkPerson` and `unlinkPerson` change
  `deal_people` and are recorded in the history; following (`deal_followers`) is not.
- **Admin changes**: pipelines and stages can be added, renamed, reordered and deleted. Deleting a stage or a
  pipeline that holds deals needs a target stage elsewhere; `moveAllDeals` moves them with the cause
  `stage_deleted` or `pipeline_deleted`. The database refuses to delete a stage that still holds a deal.

## Seed data and tests

`src/seed/deals.ts` is registered in `src/seed/index.ts` (see
[Migrations and seeding](../operations/migrations-and-seeding.md)). Tests are in `tests/unit/deals-rules.test.ts`,
`tests/integration/{deals,deals-move,deals-private,board,board-performance,pipelines,deals-list,deals-status,deals-links,deal-labels,deal-page,deals-restore}.test.ts` and
`tests/e2e/{deals,deals-private,board,pipelines,deal-list,deal-page,deal-won-lost,deal-labels,deal-restore}.spec.ts`.
