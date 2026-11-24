---
type: feature
title: Saved segments (SF-120)
description: Saved, team-shared segments of people — who and conditions, reach counts worked out at each read, visibility, pages and actions, and the segments table.
tags: [segments, people, reach, custom-fields]
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
    resource: repo://migrations/0013_segments.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T17:35:43.352Z
generated: { by: "claude-code", at: "2026-11-24T17:35:43.352Z" }
---

# Saved segments

A segment is a saved choice of recipients for a later campaign. It stores the definition only, never people; the
people it reaches are counted at each read, for the person looking. Every signed-in user can create, edit and delete
any segment: it is shared by the whole team. How data moves is in [dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md);
the table is in [Database schema](../data/database-schema.md).

## Code

- `src/server/segments/rules.ts` is pure. A `Definition` is `who` (`everyone`, `pipeline` or `stage`), the pipeline,
  stage and deal status (`open`, `won`, `lost`, `all`), and up to 20 conditions (name up to 100 characters). Conditions
  are on lead source, label, organisation, owner, or a custom field (choice, range for number, money and date, or text).
  It also holds the form reading and validation, `describeSegment` (summary, // WHO and // CONDITIONS lines,
  "(deleted)" for things that no longer exist, `broken`) and `formToValues`.
- `src/server/segments/reach.ts`: `reachWhere` builds the test on `persons p` with `visiblePerson()`, so private people
  the viewer cannot see are never counted; deals go through `visibleDeal()` and archived deals never count.
  `countReach` runs one query and puts each person under the first reason that applies: archived, then unsubscribed,
  then no email address; the rest are reached. `reachedPeople` returns person and first email for the later campaign
  issue.
- `src/server/segments/segments.ts`: `listSegments`, `getSegment`, `segmentFormOptions`, `createSegment`,
  `updateSegment` (checks the row `version`), `deleteSegment`, `countDefinition`. Names of referenced ids are loaded
  in a few queries for all segments at once. Segments add no timeline entries or notifications.
- `customProbe` in `src/server/custom-fields/values.ts` is the custom value test shared with the People list filters.

## Pages

Under `src/app/(app)/segments/`: the table (`page.tsx`), the segment page (`[id]/`, with `?confirm=delete` opening
`SegmentDeleteConfirm.tsx`), `new/` and `[id]/edit/` (the form on its own page, `SegmentForm.tsx` with `MultiPicker.tsx`
and [ COUNT AGAIN ]), `ReachBlock.tsx` and `actions.ts`. Each page calls `requireUser()`; each action does too. The
sidebar entry is in `nav.ts`; user-facing text is in `messages.ts`, and the delete notice uses `records/flash.ts`.

## Storage

Table `segments` keeps the definition with conditions as jsonb. Pipeline, stage and condition ids have no foreign key,
so a deleted one stays and matches nobody. Seed data is in `src/seed/segments.ts`.
