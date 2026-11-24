---
type: feature
title: Pipedrive import (SF-117, SF-122)
description: Saving a personal Pipedrive token (sealed per user) and importing organisations, people, deals, notes, activities and files from Pipedrive part by part, with never-twice links, consent, pause and resume, and a report.
tags: [pipedrive, import, settings, tokens]
sources:
  - id: sf117-src-imports
    resource: repo://src/server/pipedrive/imports.ts
  - id: sf117-src-api
    resource: repo://src/server/pipedrive/api.ts
  - id: sf117-src-connection
    resource: repo://src/server/pipedrive/connection.ts
  - id: sf117-src-crypto
    resource: repo://src/server/pipedrive/crypto.ts
  - id: sf117-src-env
    resource: repo://src/server/env.ts
  - id: sf117-src-migration
    resource: repo://migrations/0012_pipedrive.sql
  - id: sf122-src-records-page
    resource: repo://src/server/pipedrive/records-page.ts
  - id: sf122-src-deal-rules
    resource: repo://src/server/pipedrive/deal-rules.ts
  - id: sf122-src-migration-deals
    resource: repo://migrations/0013_pipedrive_deals.sql
  - id: sf122-src-migration-fetched
    resource: repo://migrations/0014_pipedrive_fetched.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T20:36:11.429Z
generated: { by: "claude-code", at: "2026-11-24T20:36:11.429Z" }
---

# Pipedrive import

Staff connect their own Pipedrive account on the Settings page (`src/app/(app)/settings/`) and import organisations,
people, and (SF-122) deals, notes, activities and files from it on `settings/pipedrive-import/`. Tables are in [Database schema](../data/database-schema.md);
settings are in [Configuration and environments](../operations/configuration-and-environments.md); how data moves is
in [dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md).

## Connection

`src/server/pipedrive/connection.ts` saves, reads and removes one token per user. `crypto.ts` seals it with
AES-256-GCM using the key `PIPEDRIVE_TOKEN_KEY` (32 bytes in base64, bound to the user); without a valid key the
connection is "not set up yet". `tokenFor` is the only place a token is opened, for the import engine. Deactivating a
user deletes their connection.

## Calls to Pipedrive

`api.ts` makes plain `fetch` GET calls with a 10 second time-out. The token travels in the `x-api-token` header, never
in the address. Failures are `PipedriveRefused`, `PipedriveSlowDown`, `PipedriveBadRequest` and
`PipedriveUnreachable`. `pipedriveConfig()` in `env.ts` picks `PIPEDRIVE_URL`, else the in-process fake
(`fake-pipedrive.ts`) where fakes are allowed, else the real Pipedrive.

## The import run

`imports.ts` keeps one run per user in `pipedrive_imports`, moved on part by part by the open import page
(`ImportRunner.tsx` refreshes the page and starts the next part; there is no cron). Steps are `prepare`,
`count_organisations`, `count_people`, `organisations`, `people` and `done`; pages hold 100 records. Pipedrive calls
happen before the page transaction, never inside it. Each transaction locks the run row, checks the step and cursor
(a stale or repeated page is thrown away) and locks `organisations`, `person_emails` and `pipedrive_links`, so a
record is saved whole or not at all.

States are `running`, `waiting` (Pipedrive asked to slow down), `paused` (unreachable, token refused or another
company) and the final `stopped` and `finished`. Importing people requires a consent choice. `pipedrive_links`
(company, kind and Pipedrive id) is the "never twice" key. `report.ts` builds the report and counts per kind shown on
the report step; timeline kinds `pipedrive_imported` and `pipedrive_unsubscribed` record the effect on records.

## Deals, notes, activities and files (SF-122)

The choose step has six checkboxes (`KindChoice.tsx`); ticking Deals, Notes, Activities or Files also ticks and locks
People and Organisations. After `people` the steps run in this order, each skipped when its kind is not ticked:
`pipelines` (Pipedrive pipelines and stages matched or created in one transaction; inserts only), `deals` and
`archived_deals` (20 a part, with a counting step before each), `notes` (200 a part), `activities` (200 a part) and
`files`. Pure mapping rules are in `deal-rules.ts` (`dealFromPipedrive`, `activityFromPipedrive`, `noteFromPipedrive`,
`targetOf`: a note or file goes to its deal, else person, else organisation) and `records-page.ts` (the plan of one page);
`html.ts` turns note HTML into plain text. `pipedrive_links` also covers deals, notes, activities and files, so none is
imported twice; a record with no target is skipped and gets no link. Migration `0013_pipedrive_deals.sql` adds the
`want_*`, `*_total` and `*_done` columns and the new steps.

Files are copied one at a time (cursor `<start>:<index>`, no new copy after 15 seconds or 25 MB in a part): download,
queue the Storage path in `file_cleanup`, upload to Storage, then one transaction lists the file and removes its
cleanup row. No Storage or Pipedrive call is made inside a transaction. A download redirect is followed once without
the token.

An import notifies nobody: notes create no mentions, and an activity's `assigned_by` is its assignee. A part keeps the
Pipedrive answers it already fetched across a slow-down (`pipedrive_imports.fetched`, migration `0014`), cleared when the
step or cursor moves. Every save re-checks under lock that the user is active and still holds the token; otherwise the
run pauses and nothing is saved. The report never names a record that is private to another owner, or put on a record
the importer cannot see; it shows "a private ..." instead (`report.ts`).
