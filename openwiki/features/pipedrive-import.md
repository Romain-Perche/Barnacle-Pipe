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
    resource: repo://src/server/crypto/seal.ts
  - id: sf122-src-records
    resource: repo://src/server/pipedrive/records-page.ts
  - id: sf122-src-deals
    resource: repo://src/server/pipedrive/deal-rules.ts
  - id: sf122-src-migration
    resource: repo://migrations/0017_pipedrive_deals.sql
  - id: sf117-src-env
    resource: repo://src/server/env.ts
  - id: sf117-src-migration
    resource: repo://migrations/0012_pipedrive.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-25T10:24:09.151Z
generated: { by: "claude-code", at: "2026-11-25T10:24:09.151Z" }
---

# Pipedrive import

Staff connect their own Pipedrive account on the Settings page (`src/app/(app)/settings/`) and import organisations,
people, deals, notes, activities and files from it on `settings/pipedrive-import/`. Tables are in [Database schema](../data/database-schema.md);
settings are in [Configuration and environments](../operations/configuration-and-environments.md); how data moves is
in [dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md).

## Connection

`src/server/pipedrive/connection.ts` saves, reads and removes one token per user. `src/server/crypto/seal.ts` seals it with
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
the counts, `organisations`, `people`, then (SF-122, only for the kinds chosen) `pipelines`, `deals`, `archived_deals`,
`notes`, `activities`, `files`, and `done`; people and organisation pages hold 100 records, deal pages 20, note and
activity pages 200. Pipedrive calls
happen before the page transaction, never inside it. Each transaction locks the run row, checks the step and cursor
(a stale or repeated page is thrown away) and locks `organisations`, `person_emails` and `pipedrive_links`, so a
record is saved whole or not at all.

States are `running`, `waiting` (Pipedrive asked to slow down), `paused` (unreachable, token refused or another
company) and the final `stopped` and `finished`. Importing people requires a consent choice. `pipedrive_links`
(company, kind and Pipedrive id) is the "never twice" key. `report.ts` builds the report and counts per kind shown on
the report step; timeline kinds `pipedrive_imported` and `pipedrive_unsubscribed` record the effect on records.

## Deals, notes, activities and files (SF-122)

The choose step (`KindChoice.tsx`) offers six kinds; ticking Deals, Notes, Activities or Files locks People and
Organisations on. `pipelines` reads pipelines and stages, then matches them by name or creates them in one transaction
(inserts only). Deals read followers and participants one call after another, outside the transaction. `deal-rules.ts`
and `records-page.ts` (pure) map Pipedrive records and plan each page; `html.ts` turns note HTML into plain text. A note
or activity goes to its deal, else person, else organisation; one with no target is skipped and gets no link. An import
notifies nobody (no `note_mentions`; an activity's `assigned_by` is its assignee). `pipedrive_links` also covers deals,
notes, activities and files (migration `0017_pipedrive_deals.sql`).

Files are copied one at a time: download, queue the Storage path in `file_cleanup`, upload to Storage, then one
transaction lists the file and removes the queue row; no new copy starts after 15 s or 25 MB in a part. A redirect to
Pipedrive's file host is followed once without the token. When Pipedrive asks to slow down, the answers a part already
got are kept in `pipedrive_imports.fetched` (migration `0018_pipedrive_fetched.sql`), and every save re-checks under lock
that the user is active and still holds the token. A record private to someone else is never named in the report
(`report.ts`, `privateItem`).
