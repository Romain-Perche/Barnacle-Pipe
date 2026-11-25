---
type: feature
title: Pipedrive import (SF-117)
description: Saving a personal Pipedrive token (sealed per user) and importing organisations and people from Pipedrive part by part, with never-twice links, consent, pause and resume, and a report.
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
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T14:34:59.724Z
generated: { by: "claude-code", at: "2026-11-24T14:34:59.724Z" }
---

# Pipedrive import

Staff connect their own Pipedrive account on the Settings page (`src/app/(app)/settings/`) and import organisations
and people from it on `settings/pipedrive-import/`. Tables are in [Database schema](../data/database-schema.md);
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
