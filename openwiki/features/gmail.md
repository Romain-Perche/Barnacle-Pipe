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
  - id: openwiki-source-88f5ce2aae6df34b0e7bc3f8
    resource: repo://src/server/emails/process.ts
  - id: openwiki-source-505f917d9247b00a278f8a50
    resource: repo://src/server/gmail/past.ts
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T18:09:57.686Z
generated: { by: "claude-code", at: "2026-11-26T18:09:57.686Z" }
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
  transaction. `storeMessage` also calls `processMessage` (SF-127, below) in the same transaction.
- Tables (`migrations/0016_gmail.sql`): `gmail_connections` (one per user), `email_threads`, `email_messages`,
  `email_attachments` (names and sizes only, never contents).

## Email on the timeline (SF-127)

Copied emails show on people, organisations and deals, in `src/server/emails/` (table changes in
`migrations/0020_email_timeline.sql`).

- `processMessage` (`process.ts`) runs inside `storeMessage`'s transaction. It locks `email_conversations`, raises the
  people's Last contacted (never lowers it), puts the thread in a conversation (two mailboxes holding the same Message-ID
  are one conversation; two found to be one are merged into the smaller id), records its addresses, then `autoLink`. No
  network call. `catchUpEmails` processes emails copied before SF-127 (`linked_at` null) first thing in `runGmailCheck`.
- `autoLink` links by address to people, their organisation and their one open deal, only with
  `insert … on conflict do nothing`, so a hand choice (`email_links.how` manual, `removed` = unlinked by hand) is never
  changed. `linkForPeople` does the same when a person is created, edited or imported.
- `timeline.ts` gives one EMAIL entry per email to `readTimeline`; `conversations.ts` reads the conversation page
  (`/emails/[id]`, plain text only, never HTML) and links or unlinks records; `visibleConversation()` in
  `records/visibility.ts` hides a conversation when a person in it or a linked person or deal is not visible to the viewer.
- `attachments.ts` serves attachments from `/emails/attachments/[id]/download`: it fetches the bytes from Gmail through a
  mailbox holding the email (no Google call inside a transaction) and sends them as `application/octet-stream` with
  `Content-Disposition: attachment`, or redirects back with a notice.

## Fetch past emails (SF-128)

The Gmail card on Settings can fetch the last 12 months of mail for CRM people, in `src/server/gmail/past.ts`.

- `startPastFetch` (the button) holds the connection row and does a conditional upsert, so two fetches never run at once.
  Its state is one `past_email_fetches` row per connection (`migrations/0020_past_email_fetches.sql`), deleted by a
  disconnect or deactivation (`forgetGmailInTx`); copied mail stays.
- `runPastFetchPart` works under a lease column, walking the window backwards in 7-day slices with `threads.list`. It reads
  each thread as metadata, decides with the pure `planPastThread` (`rules.ts`), and stores each new message through
  `storeMessage` in `sync.ts` (one transaction each, counting new conversations in `copied`). The cursor is saved after every
  thread. A part is capped at 100 threads or 20 s. No Google call is made inside a transaction.
- Two callers: the Settings page's `PastFetchRunner.tsx` through `runPastFetchPartFor`, and `runGmailCheck` through
  `runPastFetches` after the connections. Slow-downs set `wait_until`; "can't be reached" keeps the cursor; a refused key marks
  the connection as needing reconnect while the fetch waits.
- The fake mailbox of 100 conversations is `fake-past-mailbox.ts`, shown at `/dev/fake-gmail`.

Data movement is drawn in [the data flow](../../dataflow/DATAFLOW.md).

## Google Calendar sync (SF-124)

When `CALENDAR_SYNC=on` and Gmail is set up (`calendarConfig()` in `env.ts`), the same connection also syncs the user's
Google Calendar both ways, in `src/server/calendar/`. A connection whose `scopes` lack the Calendar scope shows a
"missing" Calendar state and Settings warns; the sidebar "!" covers it.

- `syncCalendar` (`sync.ts`) takes its own lease, then pulls Google's changes (sync token, or a full listing after a
  410) and pushes a reconcile of activities against `calendar_events`. A linked event goes through a three-way merge
  (the later change wins); a new eligible event with a visible CRM person as guest becomes a Meeting. At most 200
  Google writes per run. No Google call is made inside a transaction.
- Calls are plain `fetch` in `calendar-api.ts` (`sendUpdates=none`, never attendees). Notices arrive at the public
  `src/app/calendar/push/route.ts` (`push.ts` checks channel id, token hash and resource id); `runGmailCheck` also calls
  `runCalendarCheck` to renew channels and catch missed notices.
- Activity actions and record deletes start the sync after the response (`soon.ts`), so saving never waits on Google.
- Table `calendar_events` and the `calendar_*` columns on `gmail_connections` come from `migrations/0019_calendar.sql`;
  `activities.updated_at` is new. Moves from Google set the reminder as CRM edits do. The fake Calendar lives in the fake
  Gmail and is shown at `/dev/fake-calendar`.

## Sending

`sendGmail` in `send.ts` is the one way to send. It builds the MIME message (`buildMime` rejects CR/LF in headers) and
fails with `GmailNotConnected`, `GmailNeedsReconnect` or `GmailUnavailable`. The Settings "send test email" action uses it.

## Modes and fakes

`gmailConfig()` in `env.ts` is real (topic set and all Google settings present), fake (no topic, fakes allowed), or
off (Settings says Gmail can't be connected; cron and push do nothing). The fake Google consent screen is
`/dev/fake-google/gmail` and the fake mailbox is `/dev/fake-gmail`; `src/server/gmail/fake-gmail.ts` keeps its state in
memory in tests and in `.fake-gmail/state.json` in development. `src/seed/gmail.ts` seeds Ada Fake's connection and
three conversations.
