# Implementation Plan: Fetch past emails

**Branch**: `factory/sf-128-step-19-fetch-past-emails` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/sf-128-step-19-fetch-past-emails/spec.md`

## Summary

A `// PAST EMAILS` part in the Settings Gmail card (design B) with `[ FETCH PAST EMAILS ]`. Pressing it creates one
`past_email_fetches` row for the user's connection (row lock + conditional upsert: never two at once). The fetch walks
the 12-month window backwards in 7-day slices with Gmail `threads.list`, reads each thread's metadata
(`threads.get?format=metadata`), decides on the whole thread with a pure `planPastThread` (a non-draft/spam/bin message
in the window with a CRM address → copy its in-window messages not stored yet), and stores each message through
SF-118's `storeMessage`, which now adds 1 to the fetch's `copied` in the same transaction when it creates the thread.
It runs in parts of ≤ 20 s / 100 threads under a lease, saving its cursor after every thread; the Settings page chains
parts while open (`PastFetchRunner`, like the Pipedrive `ImportRunner`), and the existing 15-minute check carries
running fetches on with what is left of its budget. Gmail's slow-downs (429 / rate-limit 403) set a `wait_until`;
"can't be reached" keeps the cursor; a refused key pauses through SF-118's needs-reconnect; a disconnect or
deactivation deletes the row. Details: [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/).

## Technical Context

**Language/Version**: TypeScript 5 on Node.js (Next.js 16 App Router, React 19)

**Primary Dependencies**: existing only: `next`, `react`, `postgres` (postgres.js), `geist`; Gmail by plain `fetch`
(SF-118 `google-api.ts`). No new package (`dependencies.json` is `[]`).

**Storage**: Postgres: new table `past_email_fetches` (migration `0020_past_email_fetches.sql`); SF-118's
`email_threads` / `email_messages` / `email_attachments` unchanged.

**Testing**: Vitest unit (pure rules) and integration (real Postgres, fake Gmail through `useGmailFetchForTests` /
`tests/fakes/gmail.ts`, checked against `gmail-api.json`).

**Target Platform**: Vercel (Pro: function `maxDuration` 60 s for Settings, 300 s for `/cron/gmail`), Supabase Postgres.

**Project Type**: web application (single Next.js project).

**Performance Goals**: 100 conversations fetched within 2 minutes with the page open (fake), card number updated at
least every 30 s (20 s parts + 1 s gap); ≤ ~100 Gmail quota units per second per user (sequential calls).

**Constraints**: no Google call inside `sql.begin()`; a part ≤ 20 s of work + one 10 s call; no request to Gmail
before `wait_until`; no new scheduled job; no email content in any answer; all text from `messages.ts`.

**Scale/Scope**: a team of about ten users; mailboxes up to several thousand threads a year (several 15-minute checks
when the page is closed).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template, so the gates are the rules of `AGENTS.md` and
`docs/DECISIONS.md`:

| Gate | Status |
|---|---|
| Server components by default; client only where needed | Pass: only `PastFetchRunner.tsx` is a client component (it calls the next part) |
| Every server action calls `requireUser()` first; own data only | Pass: `startPastFetchAction`, `runPastFetchPartAction` use `user.id`, take no id |
| User-facing text from `messages.ts`; nothing from a URL or Gmail shown | Pass: research.md §9 |
| Migrations transactional, RLS enabled, never at app start | Pass: data-model.md § Migration |
| No Google call inside `sql.begin()` | Pass: research.md §4 (calls between transactions; one transaction per stored message) |
| Fakes only for outside services, checked against their schema | Pass: fake Gmail `threads` routes checked against `gmail-api.json` |
| Fake data clearly fake; fakes only when `isFakeAllowed()` | Pass: `@example.test` addresses, Fake names; dev page 404 otherwise |
| No secrets; every setting in `.env.example` / README | Pass: no new setting |
| DECISIONS: past email only from this button; 15-minute job only; Gmail dates; emails kept on disconnect | Pass |

Re-check after Phase 1: still pass; no Complexity Tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/sf-128-step-19-fetch-past-emails/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── routes.md        # actions, card, runner, background check, dev page
│   └── google.md        # Gmail calls, errors, fake
├── dependencies.json    # []
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
migrations/0020_past_email_fetches.sql            # new table (data-model.md § Migration)
src/server/gmail/
├── rules.ts            # + planPastThread, slowDownSeconds, pastWindow(now) (12 calendar months, UTC), SKIP_LABELS shared
├── google-api.ts       # + GmailSlowDown (extends GoogleUnavailable), PageTokenRefused, listThreads, getThreadMessages; failWith → slow-down
├── sync.ts             # storeMessage(connectionId, m, { fetchId }?) → { stored, newThread } and copied + 1 in the same tx; export it;
│                       #   runGmailCheck → runPastFetches(now, started + CHECK_BUDGET_MS) after the connections loop
├── past.ts             # NEW: startPastFetch, runPastFetchPart, runPastFetchPartFor, runPastFetches, pastFetchView, setPastFetchPartForTests
├── connections.ts      # gmailSettings → + pastFetch; forgetGmailInTx → delete from past_email_fetches
├── fake-gmail.ts       # + GET threads, threads/{id} format, slowDown(seconds, calls)
└── fake-past-mailbox.ts  # NEW: putPastMailbox(fake, email, { now }) — the 100 conversations
src/server/messages.ts  # + past_emails_* messages and templates (research.md §9)
src/app/(app)/settings/
├── page.tsx            # + export const maxDuration = 60
├── GmailCard.tsx       # + the // PAST EMAILS part (contracts/routes.md § Gmail card)
├── PastFetchRunner.tsx # NEW client: one part, refresh, next
└── actions.ts          # + startPastFetchAction, runPastFetchPartAction
src/app/globals.css     # + .gm-sub, .gm-pd, .gm-run, .spin
src/app/dev/fake-gmail/ # page.tsx + actions.ts: days ago, 100 past conversations, slow down, unreachable
tests/support/reset.ts  # + past_email_fetches
tests/fakes/gmail.ts    # schema check covers users.threads.list / users.threads.get
tests/unit/gmail-past-rules.test.ts, tests/integration/gmail-past-fetch.test.ts (+ gmail-helpers.ts: CRM people of the fake mailbox)
AGENTS.md               # Layout: one SF-128 line under src/server/gmail/ (past.ts, fake-past-mailbox.ts, table past_email_fetches)
```

**Structure Decision**: the single existing Next.js project; the fetch lives beside SF-118's sync in
`src/server/gmail/` and reuses its key, token, message reading and storing, so there is one way to copy a message.

## Build steps

1. **Migration** `0020_past_email_fetches.sql` exactly as data-model.md; add the table to `tests/support/reset.ts`.
2. **Pure rules** (`rules.ts`): `pastWindow(now)` → `{ start, end }` (`end = now`, `start` = `now` with
   `setUTCFullYear(year − 1)`); `planPastThread` (data-model.md § Copy rule); `slowDownSeconds(header)` (numeric
   seconds rounded up, else 30, clamped 1–300). Unit tests with `// covers FR-003, …` lines.
3. **Google calls** (`google-api.ts`, contracts/google.md): `GmailSlowDown(seconds)` and `PageTokenRefused` classes;
   `failWith` throws `GmailSlowDown` for 429 and for 403 with reason `rateLimitExceeded` / `userRateLimitExceeded`
   before `classifyGoogleError`; `listThreads` (`maxResults=100`, `includeSpamTrash=false`); `getThreadMessages`
   (`format=metadata`, the four address headers, 404 → null).
4. **Store with count** (`sync.ts`): `storeMessage(connectionId, m, opts?: { fetchId?: number })`: thread insert
   `on conflict do nothing returning id`, then the select as now; when the insert returned a row and `fetchId` is set,
   `update past_email_fetches set copied = copied + 1, updated_at = now() where id = ${fetchId} and state = 'running'`
   in the same transaction. Live sync calls unchanged.
5. **The fetch** (`past.ts`, research.md §4–§7):
   - constants `PART_BUDGET_MS = 20_000`, `PART_THREADS = 100` (tests: `setPastFetchPartForTests({ threads, budgetMs })`,
     throws outside `APP_ENV=test`), `LEASE_MS = 90_000`, `SLICE_MS = 7 days`, `MARGIN_MS = 1 day`,
     `UNREACHABLE_RETRY_S = 30`;
   - `startPastFetch(userId, now)` → `"started" | "running" | "not_working"`;
   - `runPastFetchPart(connectionId, { now, deadline? })` → `PartOutcome` (`again` / `wait` seconds / `ended` / `idle`);
     lease; `loadKey` → `refreshAccessToken`; loop: list the current slice page, for each thread from `page_offset`:
     `getThreadMessages` → `readMessage` each → `person_emails` query → stored ids query → `planPastThread` →
     `getMessage` + `readMessage` + `storeMessage(…, { fetchId })` for each id → save cursor guarded by the lease
     (`problem = null`); `PageTokenRefused` → restart the slice; errors as research.md §5; release the lease in
     `finally` (unless the row is gone);
   - `runPastFetchPartFor(userId, { now })` (the page): the user's own connection → contracts/routes.md answers;
   - `runPastFetches(now, deadline)` (the cron loop), `pastFetchView(connectionId, connectionState, now)`.
6. **Connection hooks** (`connections.ts`): `gmailSettings` adds `pastFetch` (a `left join past_email_fetches` in the
   same query); `forgetGmailInTx` deletes the row. `sync.ts` `runGmailCheck` calls `runPastFetches` after its loop.
7. **Messages** (`messages.ts`): the keys and templates of research.md §9; the plural through the same rule as
   `gmail_conversations`.
8. **UI**: `GmailCard.tsx` part, `PastFetchRunner.tsx`, the two actions, `maxDuration = 60` on `settings/page.tsx`, CSS
   (contracts/routes.md). Design B of `design-options.html`, `docs/DESIGN.md`.
9. **Fake Gmail** (contracts/google.md § Fake) and `fake-past-mailbox.ts` (data-model.md § Fake mailbox); dev page
   controls (contracts/routes.md); `tests/fakes/gmail.ts` schema check extended to the two thread routes.
10. **Integration tests** for every user story, edge case and SC (quickstart.md § Automated checks), each with its
    `// covers` line; part size 10 where the spec says "small in tests".
11. **Docs**: one `AGENTS.md` Layout line for SF-128 (past.ts, fake-past-mailbox.ts, `past_email_fetches`, the cron
    loop); `docs/DECISIONS.md` gets the three clarifications of `spec.md` decided by the factory
    (Build adds them as `(SF-128, decided by the factory, to confirm)` lines like SF-120's).

## Outside services

- Gmail API, scopes `gmail.modify` and `gmail.send` (new: users.threads.list, users.threads.get format=metadata; reused: users.messages.get): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
- Google OAuth 2.0 token endpoint (oauth2.googleapis.com/token, a fresh access token per part, unchanged call): no public schema found on GitHub (looked in github.com/googleapis/google-api-go-client oauth2/v1 and oauth2/v2, whose `oauth2-api.json` only describes userinfo and tokeninfo; the fake follows RFC 6749, as in SF-118)
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93, SF-102 and SF-118: only an OpenAPI file for Supavisor's own management API; this change only adds a table to the app's own database, and tests use a real local Postgres rather than a fake)

## Complexity Tracking

No gate violation.
