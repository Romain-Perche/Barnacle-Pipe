---
type: feature
title: Segments (SF-120)
description: Saved, team-shared segments of people, what a definition holds, how the reach count is worked out, the pages and actions, and the segments table.
tags: [segments, campaigns, records, reach]
sources:
  - id: sf120-src-rules
    resource: repo://src/server/segments/rules.ts
  - id: sf120-src-reach
    resource: repo://src/server/segments/reach.ts
  - id: sf120-src-segments
    resource: repo://src/server/segments/segments.ts
  - id: sf120-src-actions
    resource: repo://src/app/(app)/segments/actions.ts
  - id: sf120-src-migration
    resource: repo://migrations/0012_segments.sql
  - id: sf120-src-seed
    resource: repo://src/seed/segments.ts
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T15:00:12.302Z
generated: { by: "claude-code", at: "2026-11-24T15:00:12.302Z" }
---

# Segments (SF-120)

A segment is a saved choice of recipients, shared by the whole team. It stores the choice, never people: the people
it reaches are worked out at each read. Data movement is drawn in [DATAFLOW.md](../../dataflow/DATAFLOW.md).

## Definition

`src/server/segments/rules.ts` (pure) holds the `Definition`: `who` (`everyone`, `pipeline` or `stage`), the
pipeline, stage and deal status (`open`, `won`, `lost`, `all`) that go with it, and up to 20 conditions. A condition
is a choice (lead source, label, organisation, owner), a role text, or a custom person field test (text, number,
money or date range, single or multiple choice, yes/no). The same file reads and checks the form and describes a
segment in words; deleted pipelines, stages, organisations or fields show as "(deleted)" and match nobody.

## Reach

`src/server/segments/reach.ts` builds one `where` on `persons p`: the viewer's `visiblePerson()` rule, the deals
through `visibleDeal` (archived deals never), then each condition. `countReach` answers in one query with four
numbers; each person counts under the first reason that applies: archived, unsubscribed, no email, else reached.
`reachedPeople` returns each reached person with their first email address, for the later campaign issue.

## Pages and actions

`src/app/(app)/segments/` has the table, the segment page (count strip, who, conditions, delete confirmation), and
`new` and `[id]/edit` forms. `actions.ts` calls `requireUser()` first; there is no owner or admin check because
segments are shared. [ COUNT AGAIN ] recounts without saving; saving an edit checks the `version` and refuses a
stale one. The sidebar entry is in `nav.ts`.

## Storage and seed

Table `segments` (migration 0012, see [Database schema](../data/database-schema.md)). `src/seed/segments.ts` adds
clearly fake segments, skipping any name that already exists.
