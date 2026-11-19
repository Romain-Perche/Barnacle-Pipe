---
type: feature
title: Deals, pipelines and the board
description: The deals board with native drag and drop, the deal drawer and forms, stage moves and their history, private deals, and the admin-only Pipelines pages that manage pipelines and stages.
tags: [deals, pipelines, stages, board, admin]
sources:
  - id: openwiki-source-818f3254e83dfbb4a902d66b
    resource: repo://src/server/deals/deals.ts
  - id: openwiki-source-827b41c92849356eb5627b39
    resource: repo://src/server/deals/pipelines.ts
  - id: openwiki-source-be39b8b1bb5e71358ceb1521
    resource: repo://src/server/records/visibility.ts
generated: { by: "claude-code", at: "2026-11-19T18:56:29.439Z" }
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T18:56:29.439Z
---

# Deals, pipelines and the board

Deals sit in the stages of pipelines. Pages are under `src/app/(app)/deals/` (the board, the deal drawer, the
add and edit forms) and `src/app/(app)/admin/pipelines/` (admin only); domain code is in `src/server/deals/`.
How data moves between these parts and the database is drawn in
[`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md). Tables are described in
[Database schema and access](../data/database-schema.md).

## The board

`getBoard()` in `deals.ts` loads the pipelines in position order, picks the requested one (or the first), and
returns its stages as columns of cards with a count and total value. `Board.tsx` implements drag and drop with the
browser's native API. A drag or the drawer's "Move to" calls `moveDeal()`, which locks the deal row and answers
`stale` when the deal is gone, archived, hidden from the viewer, has a different `version`, or is no longer in the
stage the board showed; `same` when the stage did not change; otherwise `moved`.

## Stage moves and history

`transferDeal()` is the single place a stage change is recorded: it closes the open `deal_stage_periods` row, opens
a new one (stage and pipeline names are copied as text so history survives renames and deletes), updates the deal's
stage and bumps `version`. Moves also write a `moved` event on the timeline (`records/timeline.ts`); a deal's
events appear on its person's and organisation's timelines too.

## Deal forms and rules

`rules.ts` holds the pure rules, unit-tested without a database: money is parsed to pence (`4,000.50`, optional `£`,
at most 999,999,999,999 pence), the expected close date must be a real `YYYY-MM-DD` day, and field changes are
compared for the history. `createDeal`, `updateDeal` (with an optimistic `version` check), `archiveDeal` and
`deleteDeal` are in `deals.ts`; the deal form can pick an existing organisation or add a new one. Every server
action calls `requireUser()` first, and all text comes from `src/server/messages.ts`.

## Private deals

A deal can be private. `visibleDeal()` in `records/visibility.ts` lets a viewer see it only when it is not private
or they created or own it; every read of `deals` uses it, and persons joined onto a deal use `visiblePerson()`. A
user who saves a deal into a state they can no longer see gets a `no_longer_visible` result.

## Pipelines admin

`pipelines.ts` changes pipelines and stages: add, rename, move up or down, and delete. Each change runs in one
transaction that first checks the actor is an active admin, and locks the rows it reorders. Names are unique
ignoring case (per pipeline for stages). Deleting a stage or pipeline that still holds deals requires a target stage
elsewhere: `moveAllDeals` moves them with a recorded cause (`stage_deleted` or `pipeline_deleted`), and the
database refuses to delete a stage that still holds a deal. Pages and actions use `requireAdmin()` /
`assertAdminForAction()`.

## Sidebar and fake data

`nav.ts` lists `Deals` in the main nav and `Pipelines` in the admin group (see
[Signed-in layout](./signed-in-layout-and-pages.md)). `src/seed/deals.ts` seeds five fake pipelines and fake deals
([Migrations and fake data](../operations/migrations-and-seeding.md)). Related: [People and
organisations](./people-and-organisations.md).
