---
type: feature
title: Gmail connect and sync (SF-118)
description: Connecting a user's Gmail from Settings, sealed tokens, copying conversations with CRM people by Pub/Sub push and a 15-minute check, sending mail, and the fake Gmail used in development.
tags: [gmail, settings, sync, tokens]
sources:
  - id: sf118-src-connections
    resource: repo://src/server/gmail/connections.ts
  - id: sf118-src-sync
    resource: repo://src/server/gmail/sync.ts
  - id: sf118-src-push
    resource: repo://src/server/gmail/push.ts
  - id: sf118-src-send
    resource: repo://src/server/gmail/send.ts
  - id: sf118-src-cron
    resource: repo://src/app/cron/gmail/route.ts
  - id: sf118-src-env
    resource: repo://src/server/env.ts
  - id: sf118-src-migration
    resource: repo://migrations/0013_gmail.sql
  - id: openwiki-source-142c3db3613355a16ad2c16c
    resource: repo://src/server/crypto/seal.ts
  - id: openwiki-source-55831e92f29f8b3e9d43f58b
    resource: repo://vercel.json
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T18:41:40.383Z
generated: { by: "claude-code", at: "2026-11-24T18:41:40.383Z" }
---

# Gmail connect and sync

A user connects their own Gmail on the Settings page (`src/app/(app)/settings/`, card `GmailCard.tsx`, actions
`startGmailConnect`, `disconnectGmail`, `sendTestEmail`; the consent callback is `settings/gmail/callback/route.ts`).
Tables are in [Database schema](../data/database-schema.md); settings are in
[Configuration and environments](../operations/configuration-and-environments.md); how data moves is in
[dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md).

## Connection

`src/server/gmail/connections.ts` keeps one `gmail_connections` row per user (kept after disconnect). The Google
refresh token is sealed by `src/server/crypto/seal.ts` (shared with the [Pipedrive import](pipedrive-import.md)) with
`GMAIL_TOKEN_KEY`; `loadKey` is the only reader of `token_cipher`. The scopes are `gmail.modify` and `gmail.send`. When
Google refuses the key the connection becomes `needs_reconnect`, and the sidebar Settings link shows an orange "!".
Deactivating a user forgets their connection (`forgetGmailInTx`).

## Sync

`src/server/gmail/sync.ts` (`syncConnection`) runs one sync per connection at a time through a lease column. It reads
Gmail history since `history_id` (or lists mail when Gmail no longer has it), decides with the pure `decideCopy`
whether a message belongs to a CRM person, and stores it in one transaction per message, at most 300 `messages.get`
calls per run. Google calls are never made inside a transaction. Two things start a sync:

- Pub/Sub push to `src/app/gmail/push/route.ts`, checked by `push.ts` (`verifyPushToken`, Google's signed OIDC token).
- The 15-minute job `src/app/cron/gmail/route.ts` (scheduled in `vercel.json`, `Authorization: Bearer CRON_SECRET`),
  which also renews the Gmail watch daily.

## Sending

`send.ts` (`sendGmail`) is the one way the CRM sends mail; Settings' test email uses it. It refuses when the user has
no working connection (`GmailNotConnected`, `GmailNeedsReconnect`, `GmailUnavailable`).

## Real, fake and off

`gmailConfig()` in `env.ts` is real when a Pub/Sub topic and all other settings are present, fake in development and
test when there is no topic (`fake-gmail.ts`, the consent screen `/dev/fake-google/gmail` and the mailbox page
`/dev/fake-gmail`, 404 unless the mode is fake), otherwise off.
