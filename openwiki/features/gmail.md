---
type: feature
title: Gmail connect and sync (SF-118)
description: How staff connect their Gmail, how conversations with CRM people are copied by push and a 15-minute check, how mail is sent, and how disconnect, reconnect and the fake Gmail work.
tags: [gmail, settings, tokens, sync]
sources:
  - id: sf118-src-gmail
    resource: repo://src/server/gmail/sync.ts
  - id: sf118-src-connections
    resource: repo://src/server/gmail/connections.ts
  - id: sf118-src-push
    resource: repo://src/server/gmail/push.ts
  - id: sf118-src-migration
    resource: repo://migrations/0016_gmail.sql
  - id: sf118-src-env
    resource: repo://src/server/env.ts
  - id: sf118-src-vercel
    resource: repo://vercel.json
  - id: openwiki-source-5e8222fa4f836ecb84cdb72d
    resource: repo://migrations/0019_calendar.sql
  - id: openwiki-source-5f48a9b55cca47c928e3fea2
    resource: repo://src/server/calendar/sync.ts
  - id: openwiki-source-142c3db3613355a16ad2c16c
    resource: repo://src/server/crypto/seal.ts
verified:
  - by: openwiki/0.9.0
    at: 2026-11-25T12:55:36.197Z
generated: { by: "claude-code", at: "2026-11-25T12:55:36.197Z" }
---

# Gmail connect and sync

Each user can connect their own `@barnacle.ai` Gmail account on the Settings page (`src/app/(app)/settings/`,
`GmailCard.tsx`). The app then copies conversations that involve CRM people and can send mail through that account.
How data moves is in [dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md); the settings are in
[Configuration and environments](../operations/configuration-and-environments.md); the same sealing is used by the
[Pipedrive import](pipedrive-import.md).

## Connect and disconnect

- `startGmailConnect` (settings actions) sends the user to Google's consent screen; the callback is
  `settings/gmail/callback/route.ts`, handled by `connectFromCallback` in `src/server/gmail/connections.ts`. Outcomes
  include connected, reconnected, wrong account and missing scopes. The scopes are `gmail.modify` and `gmail.send`
  (`GMAIL_SCOPES` in `rules.ts`).
- The refresh token is sealed with AES-256-GCM by `src/server/crypto/seal.ts` using `GMAIL_TOKEN_KEY`, bound to the
  user. `loadKey` in `connections.ts` is the only reader of `token_cipher`.
- `disconnect` forgets the token (and revokes it at Google); deactivating a user does the same (`forgetGmailInTx`,
  `afterGmailForgotten`). The connection row is kept so its conversations stay. A failed refresh marks the connection
  `needs_reconnect`; the sidebar Settings link then shows an orange "!".

## Sync

- Google notices arrive as Pub/Sub pushes at `src/app/gmail/push/route.ts`; `push.ts` checks Google's signed OIDC
  token with `node:crypto` before syncing. `vercel.json` also schedules `/cron/gmail` every 15 minutes
  (`runGmailCheck`), which syncs every working connection and renews watches; it recovers anything a push missed.
- `syncConnection` (`sync.ts`) takes a lease on the connection, reads Gmail history since `history_id` (or lists
  messages when history is gone), applies `decideCopy` and stores each message in its own transaction. Drafts, spam and
  bin are never copied, nor mail from before the connection; a message is copied when its thread is already copied or an
  address belongs to a CRM person. At most 300 `messages.get` calls per run. No Google call is made inside a
  transaction.
- Tables (`migrations/0016_gmail.sql`): `gmail_connections` (one per user), `email_threads`, `email_messages`,
  `email_attachments` (names and sizes only, never contents).

## Sending

`sendGmail` in `send.ts` is the one way to send. It builds the MIME message (`buildMime` rejects CR/LF in headers) and
fails with `GmailNotConnected`, `GmailNeedsReconnect` or `GmailUnavailable`. The Settings "send test email" action uses it.

## Modes and fakes

`gmailConfig()` in `env.ts` is real (topic set and all Google settings present), fake (no topic, fakes allowed), or
off (Settings says Gmail can't be connected; cron and push do nothing). The fake Google consent screen is
`/dev/fake-google/gmail` and the fake mailbox is `/dev/fake-gmail`; `src/server/gmail/fake-gmail.ts` keeps its state in
memory in tests and in `.fake-gmail/state.json` in development. `src/seed/gmail.ts` seeds Ada Fake's connection and
three conversations.

## Google Calendar sync (SF-124)

Two-way sync of activities with the user's Google Calendar, on the same connection, token key and Google helpers. It is
on when `CALENDAR_SYNC=on` and Gmail is set up (`calendarConfig()` in `env.ts`); a connection's Calendar state
(`syncing` / `missing`) comes from its `scopes`, and `settingsWarning()` drives the sidebar "!".

- `src/server/calendar/sync.ts`: `syncCalendar` takes a calendar lease, pulls changes (sync token; a 410 means a full
  listing), pushes activity changes, and reconciles `calendar_events` against activities. There is no outbox.
  `rules.ts` is pure (`merge` is three-way, the later change wins; `decideIncoming`). `runCalendarCheck` runs from
  `runGmailCheck`; `calendarAfterChange` and `calendarAfterVisibilityChange` run after activity, person and deal saves.
- `calendar-api.ts` makes the Calendar calls by plain `fetch` with `sendUpdates=none` and never sends attendees.
- Google's change notices arrive at the public `src/app/calendar/push/route.ts` (`push.ts` checks channel id, token hash
  and resource id).
- Table `calendar_events` (`migrations/0019_calendar.sql`): one link per activity, origin `crm` / `google`, state
  `creating` / `synced` / `ended`. A reassigned activity's link on a non-syncing connection is detached, not deleted.
- Fakes: `fake-calendar.ts` and the page `/dev/fake-calendar`; `src/seed/calendar.ts` seeds one meeting from Google.

Data movement: see [dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md).
