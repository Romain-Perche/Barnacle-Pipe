---
type: "Reference"
title: "Segments (SF-120)"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T18:25:19.853Z
sources:
  - id: openwiki-source-c11c28cf1917d03e6960020c
    resource: repo://src/server/segments/reach.ts
  - id: openwiki-source-1d002b44f4dfbc6660b385e3
    resource: repo://src/server/segments/rules.ts
generated: { by: "claude-code", at: "2026-11-24T18:25:19.853Z" }
---


# Segments (SF-120)

A segment is a saved choice of recipients, shared by the whole team. It stores the choice, never people: the
people are worked out from the live records each time it is read. [Campaigns](campaigns.md) (drafts only so far) will use segments later;
`reachedPeople` (person and first email) is the function they will call. For how segment data moves, see
[the data flow](../../dataflow/DATAFLOW.md).

## What a segment holds

The `segments` table (see [Database schema](../data/database-schema.md#segments-migration-0014)) keeps a name
(at most 100 characters, unique ignoring case), `who`, and a list of conditions (at most 20):

- `who` is `everyone`, `pipeline` or `stage`; the last two carry a deal status (`open`, `won`, `lost`, `all`).
- A condition is a lead source, label, organisation or owner choice, a text match on role, or a test on a custom
  field of a person (text, number, money, date, single or multiple choice, yes/no). The pure types, form reading and
  checking, and the plain-words description are in `src/server/segments/rules.ts`.

Ids inside a segment have no foreign keys: a deleted pipeline, stage, organisation or custom field stays in the
segment shown as "(deleted)" and matches nobody.

## Reach

`reachWhere` in `reach.ts` builds the test on `persons p`: `visiblePerson()` (private people stay private to the
viewer), the "who" part (deals through `visibleDeal()`, archived deals never), and the conditions. The custom value
test is `customProbe` in `src/server/custom-fields/values.ts`, shared with the People list filters. `countReach` runs
one query and puts each person under the first reason that applies: archived, then unsubscribed, then no email
address; the rest are reached. Counts are never stored.

## Pages and actions

Under `src/app/(app)/segments/`: the table (`page.tsx`), the segment page (`[id]/`, with a delete confirmation),
`new/` and `[id]/edit/` (one form, `SegmentForm.tsx`, with [ COUNT AGAIN ]), and `actions.ts`. Every action checks
the signed-in user first. Edits carry the segment's `version`, so a stale save is refused. The sidebar link is in
`mainNav` of `nav.ts`. The seeder adds example segments (`src/seed/segments.ts`).
