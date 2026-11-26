# Tasks: Fetch past emails (SF-128)

**Input**: Design documents from `specs/sf-128-step-19-fetch-past-emails/` (plan.md, spec.md, research.md, data-model.md,
contracts/routes.md, contracts/google.md, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: requested by the spec (FR-015, SC-001 to SC-005, every Independent Test). Each test names what it covers
(`// covers FR-003, US1 scenario 2`). Fakes only for outside services; Postgres is real (`APP_ENV=test`,
`DATABASE_URL=postgres://postgres@localhost:5432/crm_test`).

**Organization**: tasks grouped by user story. `blueprints.json` is `[]` (no blueprint index in this run): no blueprint
task and no `docs/DECISIONS.md` exception line.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 to US4 of spec.md

## Path Conventions

Single Next.js project: `src/`, `migrations/`, `tests/` at the repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the table and the test reset

- [x] T001 Create `migrations/0020_past_email_fetches.sql` exactly as data-model.md § Migration: table `past_email_fetches` with `id bigint generated always as identity primary key`, `connection_id bigint not null unique references gmail_connections (id) on delete cascade`, `state text not null check (state in ('running', 'ended'))`, `window_start timestamptz not null`, `window_end timestamptz not null`, `slice_end timestamptz not null`, `page_token text null check (char_length(page_token) <= 1024)`, `page_offset int not null default 0 check (page_offset >= 0)`, `copied int not null default 0 check (copied >= 0)`, `problem text null check (problem in ('unavailable'))`, `wait_until timestamptz null`, `lease_until timestamptz null`, `started_at timestamptz not null`, `ended_at timestamptz null`, `updated_at timestamptz not null default now()`, `check (window_start < window_end)`, `check ((state = 'ended') = (ended_at is not null))`, `check (state = 'running' or (lease_until is null and wait_until is null and problem is null))`; then `alter table past_email_fetches enable row level security;` (no policies, only statements allowed in a transaction)
- [x] T002 Add `past_email_fetches` to the `truncate` list in `tests/support/reset.ts` (before `gmail_connections`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: pure rules and fixed texts used by every story

**⚠️ CRITICAL**: no user story work before this phase is done

- [x] T003 [P] Unit tests in `tests/unit/gmail-past-rules.test.ts` (`// covers FR-003, Edge Cases "The 12 months", "Address matching", "Conversation partly older", "CRM person only in an older message"`): `pastWindow(new Date("2026-11-26T10:00:00Z"))` → start `2025-11-26T10:00:00Z`, end the press; `planPastThread` returns `[]` when no candidate has a CRM address, when the CRM address is only on a DRAFT / SPAM / TRASH message, only on a message before `windowStart` or after `windowEnd`, or only matches by display name; returns the in-window not-stored candidates oldest first when one matches (an older message and a stored id left out; a message 11 months 29 days old counts, 12 months 2 days does not; an unreadable `internalDate` never counts); `slowDownSeconds("12")` → 12, `"0.2"` → 1, `"999"` → 300, `null` / `"soon"` → 30
- [x] T004 In `src/server/gmail/rules.ts` add `pastWindow(now)` (`end = now`, `start` = `now` with `setUTCFullYear(year − 1)`), `planPastThread(input)` exactly as data-model.md § Copy rule (sharing the existing `SKIP_LABELS`), and `slowDownSeconds(header: string | null)` (numeric seconds rounded up, else 30, within 1–300); make T003 pass
- [x] T005 [P] In `src/server/messages.ts` add `past_emails_explain` ("Copies the last 12 months of your conversations with people in the CRM. Press again after an import: nothing is copied twice."), `past_emails_leave` ("You can leave this page: fetching carries on by itself."), `past_emails_paused` ("Fetching past emails is paused until Gmail is reconnected."), `past_emails_unreachable` ("Gmail can't be reached right now. Fetching will carry on by itself."), `past_emails_fetching` ("FETCHING…"), and templates `past_emails_progress(n)` ("Fetching past emails: <n> conversation(s) copied"), `past_emails_done(n)` ("Past emails fetched: <n> conversation(s) copied."), `past_emails_last(time)` ("Last fetched <time>. Press again after an import to copy conversations with new people."), with the same plural rule as `gmail_conversations` (1 → "conversation", spec Clarifications)

**Checkpoint**: rules and texts ready

---

## Phase 3: User Story 1 - Fetch my last 12 months of conversations with CRM people (Priority: P1) 🎯 MVP

**Goal**: the `// PAST EMAILS` part and a fetch that copies exactly the conversations of FR-003, run part after part
while Settings is open

**Independent Test**: fake mailbox of 100 conversations (data-model.md § Fake mailbox), connect a fake user, press
`[ FETCH PAST EMAILS ]`, run to the end: 60 conversations copied, each once, the card says so

### Tests for User Story 1

- [x] T006 [US1] Download `gmail-api.json` from `https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json` at commit `3f740bc15212818d4d0eb041b02c951457ff63fa` into `.factory/schemas/` (`git init -q /tmp/google-api-go-client && git -C /tmp/google-api-go-client fetch -q --depth 1 https://github.com/googleapis/google-api-go-client 3f740bc15212818d4d0eb041b02c951457ff63fa && git -C /tmp/google-api-go-client show FETCH_HEAD:gmail/v1/gmail-api.json > .factory/schemas/gmail-api.json`), and make the fake of the Gmail API refuse a request that the schema refuses: in `tests/unit/gmail-fake-schema.test.ts` add tests (`// covers FR-015`) that `GET users/me/threads` with an undeclared query parameter (`afterDate=1`) and `GET users/me/threads/{id}` with an undeclared one (`fields2=x`) throw from the schema check in `tests/fakes/gmail.ts`, that a fake `threads.list` answer carrying a property not in `ListThreadsResponse` / `Thread` fails, and that the valid `q`, `maxResults`, `pageToken`, `includeSpamTrash`, `format`, `metadataHeaders` pass (the file is already pinned in `scripts/fetch-schemas.mjs`; keep its sha256)
- [x] T007 [P] [US1] Unit tests for the card in `tests/unit/gmail-card.test.ts` (`// covers FR-001, FR-009, FR-010, FR-014, US1 scenarios 1, 4, 5`): for each row of data-model.md § Card state, `GmailCard` renders the `// PAST EMAILS` label, `[ FETCH PAST EMAILS ]` only for none/ended on a working connection, `FETCHING…` while running, and exactly the listed lines; no part when not connected or Gmail is off
- [x] T008 [US1] Integration tests in `tests/integration/gmail-past-fetch.test.ts` with the 100-conversation mailbox (`putPastMailbox`) and the CRM people of data-model.md § Fake mailbox created in `tests/integration/gmail-helpers.ts` (`// covers FR-002, FR-003, FR-004, FR-005, SC-001, US1 scenarios 1-3, 5`): `startPastFetch` then `runPastFetchPart` until `ended` → `copied = 60`, `email_threads` +60, no thread from groups G–O, group D threads have exactly 2 messages, a group A message's sender, recipients, subject, `received_at`, text, HTML and attachment names and sizes equal what the live sync stores, no `email_messages` duplicate; a mailbox with no CRM conversation in the 12 months ends with `copied = 0`; the test email (`sendTestEmail`) is never copied

### Implementation for User Story 1

- [x] T009 [US1] Fake Gmail in `src/server/gmail/fake-gmail.ts` (contracts/google.md § Fake): `GET users/me/threads` reading `after:<n>` / `before:<n>` (epoch seconds on `internalDate`; a thread listed when one of its messages is within), `includeSpamTrash` (default false: SPAM/TRASH messages never make a thread listed), `maxResults` (default 100, at most 500), numeric `pageToken` (unknown or non-numeric → 400 `invalidArgument`), threads ordered by their newest message, answer `{ threads?: [{ id, snippet: "", historyId }], nextPageToken?, resultSizeEstimate }`; `threads/{id}` honouring `format` `minimal` / `metadata` / `full`; make T006 pass
- [x] T010 [P] [US1] Create `src/server/gmail/fake-past-mailbox.ts` exporting `putPastMailbox(fake, email, { now })` that puts the 100 conversations of data-model.md § Fake mailbox (groups A–O, counts 40/8/4/3/3/2 copied, 5/5/8/8/4/4/3/2/1 not), clearly fake `@example.test` addresses and teammates `@barnacle.ai`
- [x] T011 [US1] In `src/server/gmail/google-api.ts` add `PageTokenRefused`, `listThreads(access, q, pageToken?)` (`maxResults=100`, `includeSpamTrash=false`; 400 with a `pageToken` → `PageTokenRefused`) and `getThreadMessages(access, threadId)` (`format=metadata`, `metadataHeaders` From, To, Cc, Bcc; 404 → null), per contracts/google.md
- [x] T012 [US1] In `src/server/gmail/sync.ts` export `storeMessage(connectionId, m, opts?: { fetchId?: number })`: thread insert `on conflict (connection_id, gmail_thread_id) do nothing returning id`; when it inserted and `fetchId` is set, `update past_email_fetches set copied = copied + 1, updated_at = now() where id = ${fetchId} and state = 'running'` in the same transaction; live sync calls unchanged
- [x] T013 [US1] Create `src/server/gmail/past.ts` (research.md §4, §7): constants `PART_BUDGET_MS = 20_000`, `PART_THREADS = 100`, `LEASE_MS = 90_000`, `SLICE_MS = 7 days`, `MARGIN_MS = 1 day`; `setPastFetchPartForTests({ threads, budgetMs })` (throws outside `APP_ENV=test`); `startPastFetch(userId, now)` → `"started" | "running" | "not_working"` (one transaction: `gmail_connections` row `for update`, require `state = 'working'`, `insert … on conflict (connection_id) do update set <fresh fetch> where past_email_fetches.state = 'ended'`; window from `pastWindow(now)`, `slice_end = now + 1 day`); `runPastFetchPart(connectionId, { now, deadline? })`: lease (`lease_until = now + 90 s` where running, connection working, lease free, `wait_until` over), `loadKey` → `refreshAccessToken`, slice `[max(slice_end − 7 days, window_start − 1 day), slice_end)` listed with `after:`/`before:` seconds, per thread from `page_offset`: `getThreadMessages` → `readMessage` → `person_emails` query → stored ids → `planPastThread` → `getMessage` + `readMessage` + `storeMessage(…, { fetchId })`, then the cursor saved guarded by `lease_until` (row gone or lease lost → stop); next page / next slice / `ended` with `ended_at = now`; stop after `PART_BUDGET_MS` or `PART_THREADS`; `PageTokenRefused` → slice restarts; no Google call inside `sql.begin()`; lease released in `finally`; `runPastFetchPartFor(userId, { now })` with the answers of contracts/routes.md; `pastFetchView(...)` per data-model.md § Card state
- [x] T014 [US1] In `src/server/gmail/connections.ts` extend `GmailSettings` with `pastFetch: PastFetchView` read by a `left join past_email_fetches` in the `gmailSettings` query (`paused` from `needs_reconnect`, `unreachable` from `problem`, `waitSeconds` from `wait_until`)
- [x] T015 [US1] In `src/app/(app)/settings/actions.ts` add `startPastFetchAction()` (`requireUser()` first, `startPastFetch(user.id, new Date())`, `redirect("/settings")`) and `runPastFetchPartAction()` (`requireUser()` first, `runPastFetchPartFor(user.id, { now: new Date() })`, returns only `{ next, seconds? }`)
- [x] T016 [P] [US1] Create `src/app/(app)/settings/PastFetchRunner.tsx` (client, `{ waitSeconds }`): wait, call `runPastFetchPartAction()`, `router.refresh()`, then 1 s after `again`, `seconds` after `wait`, end on `stop` or a thrown action (shape of `pipedrive-import/ImportRunner.tsx`); renders nothing
- [x] T017 [US1] In `src/app/(app)/settings/GmailCard.tsx` add the `// PAST EMAILS` part after `.gm-lines` (contracts/routes.md § Gmail card; lines per data-model.md § Card state; `PastFetchRunner` while running on a working connection); in `src/app/(app)/settings/page.tsx` add `export const maxDuration = 60;`; in `src/app/globals.css` add `.gm-sub`, `.gm-pd`, `.gm-run`, `.spin` (no animation under `prefers-reduced-motion: reduce`) following `docs/DESIGN.md`; make T007 and T008 pass

**Checkpoint**: US1 works with the page open

---

## Phase 4: User Story 2 - It finishes even if I close the page (Priority: P1)

**Goal**: parts carried on by the 15-minute check; Gmail's slow-downs and outages handled

**Independent Test**: part size 10, one part, no more page calls, `runGmailCheck` a few times → ended with 60

### Tests for User Story 2

- [x] T018 [US2] Google OAuth 2.0 token endpoint (no public schema on GitHub): the fake in `src/server/gmail/fake-gmail.ts` keeps following RFC 6749 §5.1–5.2 and Google's "Using OAuth 2.0 for Web Server Applications" page (developers.google.com/identity/protocols/oauth2/web-server: refresh-token request, `invalid_grant` 400 for a revoked or expired refresh token, an access token valid one hour); add a test in `tests/unit/gmail-fake-oauth.test.ts` (`// covers FR-011`) that every part asks one fresh access token with `grant_type=refresh_token` and that a revoked key answers 400 `invalid_grant`, which the part turns into the connection's `needs_reconnect`
- [x] T019 [US2] In `tests/unit/gmail-fake-schema.test.ts` add (`// covers FR-007, SC-005`): `fake.slowDown(30)` makes the next Gmail call answer 429 with body `{ error: { code: 429, status: "RESOURCE_EXHAUSTED", errors: [{ reason: "rateLimitExceeded" }] } }` and `Retry-After: 30`, the error body checked against the schema checker's error shape; and that `failWith` turns 429 and 403 `rateLimitExceeded` / `userRateLimitExceeded` into `GmailSlowDown(seconds)` that is `instanceof GoogleUnavailable`, while 403 `insufficientPermissions` stays `GoogleKeyRefused`
- [x] T020 [US2] Integration tests in `tests/integration/gmail-past-fetch.test.ts` (`// covers FR-007, FR-008, FR-011, SC-002, SC-003, SC-005, US2 scenarios 1-4, Edge Case "Large mailbox"`): with `setPastFetchPartForTests({ threads: 10 })`, `copied` never goes down between parts and ends at 60; one part then only `runGmailCheck(now)` calls → ended with 60 (same as open page); a slow-down: no Gmail request in `fake.requests` before `wait_until`, `runPastFetchPartFor` answers `wait` with the seconds, then ends with 60; unreachable (`setUnreachable(true)`): `problem = 'unavailable'`, cursor and `copied` unchanged, view `unreachable`, then reachable + check → 60; a mailbox of 100 matching conversations ends at 100; a second part while one holds the lease does nothing

### Implementation for User Story 2

- [x] T021 [US2] In `src/server/gmail/google-api.ts` add `GmailSlowDown extends GoogleUnavailable` (with `seconds`) thrown by `failWith` for 429 and for 403 with reason `rateLimitExceeded` / `userRateLimitExceeded` (seconds from `slowDownSeconds(res.headers.get("retry-after"))`), before `classifyGoogleError`
- [x] T022 [US2] In `src/server/gmail/fake-gmail.ts` add `slowDown(seconds, calls = 1)` kept in the fake's state (contracts/google.md § Fake); make T019 pass
- [x] T023 [US2] In `src/server/gmail/past.ts` handle errors (research.md §5): `GmailSlowDown` → `wait_until = now + seconds`, `problem = null`; other `GoogleUnavailable` → `problem = 'unavailable'`, cursor unchanged; a handled thread clears `problem`; add `runPastFetches(now, deadline)` (every running fetch on a working connection with `wait_until` over, oldest `started_at` first, parts back to back until the deadline, one failure never stops the others)
- [x] T024 [US2] In `src/server/gmail/sync.ts` `runGmailCheck` call `runPastFetches(now, started + CHECK_BUDGET_MS)` after the connections loop; make T020 pass
- [x] T025 [P] [US2] Dev fake mailbox page `src/app/dev/fake-gmail/page.tsx` and `src/app/dev/fake-gmail/actions.ts` (contracts/routes.md § Fake mailbox page): "Days ago" field on put-a-message, `[ PUT 100 PAST CONVERSATIONS ]`, `[ SLOW DOWN NEXT CALL ]`, `[ GMAIL UNREACHABLE: ON / OFF ]`, fixed `DONE` texts `past_mailbox`, `slowed`, `unreachable_on`, `unreachable_off`; still 404 unless `isFakeAllowed()` and fake Gmail; a test in `tests/integration/gmail-dev-fake.test.ts` (`// covers FR-015`)

**Checkpoint**: US1 and US2 work; a closed page still ends the fetch

---

## Phase 5: User Story 3 - Press it again later; nothing is ever copied twice (Priority: P1)

**Goal**: a second press copies only what is new; one fetch at a time

**Independent Test**: full fetch, add Nia Later, press again → 5; two presses at once → one fetch

### Tests for User Story 3

- [x] T026 [US3] Integration tests in `tests/integration/gmail-past-fetch.test.ts` (`// covers FR-002, FR-005, FR-006, SC-001, SC-004, US3 scenarios 1-5`): a second fetch with nothing changed ends with 0 and the total stays 60; after adding a person with `nia.later@example.test` → 5 and total 65; a conversation the live sync copied (a reply after connecting in a 3-month-old thread) → fetch ends with 0, its earlier in-window messages stored once beside the reply; a live-sync message arriving during a fetch (`syncConnection` between two parts) counts once in the total and is stored once; `Promise.all` of two `startPastFetch` → exactly one `"started"`, one `running` row; `startPastFetchAction` while running changes nothing; Edge Case "Teammates' mailboxes": two users with the same conversation each end with 1 and one user's fetch leaves the other's row unchanged; Edge Case "Private and archived people" (2 + 1 → 3; a deleted person's address → 0)

### Implementation for User Story 3

- [x] T027 [US3] Check and fix in `src/server/gmail/past.ts` and `src/server/gmail/sync.ts` whatever T026 finds (the conditional upsert of `startPastFetch`, the count only on a created thread, `person_emails` read per thread so a person added after the first fetch is matched by the next); no new mechanism beyond research.md §3 and §7

**Checkpoint**: never twice, by message and by count

---

## Phase 6: User Story 4 - A fetch stops cleanly when the connection changes (Priority: P2)

**Goal**: paused on a refused key, resumed on reconnect; ended for good on disconnect or deactivation

**Independent Test**: refuse the key mid-fetch → paused; reconnect → 60; disconnect → no parts, threads kept

### Tests for User Story 4

- [x] T028 [US4] Integration tests in `tests/integration/gmail-past-fetch.test.ts` (`// covers FR-011, FR-001, US4 scenarios 1-3, Edge Cases "Connection not working", "Reload after the end", "Deactivated user reactivated"`): `fake.refuseKey` mid-fetch → connection `needs_reconnect`, view `paused`, no part runs (`runPastFetchPartFor` → `stop`, check changes nothing); `finishConnect` with the same account → ends with 60; `disconnect` and `users.deactivate` mid-fetch → row gone, check changes nothing, threads kept, after connecting again the view is `none`; `startPastFetch` on not connected / needs reconnecting / Gmail off → `not_working` and no row; after the end, the view stays `ended` until the next press

### Implementation for User Story 4

- [x] T029 [US4] In `src/server/gmail/connections.ts` `forgetGmailInTx` add `delete from past_email_fetches where connection_id = ${row.id}` in its transaction; in `src/server/gmail/past.ts` `GoogleKeyRefused` → `markNeedsReconnect(connectionId)`, fetch left `running`; make T028 pass

**Checkpoint**: all stories work

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T030 [P] Add one SF-128 line to the Layout of `AGENTS.md` under `src/server/gmail/` (`past.ts`, `fake-past-mailbox.ts`, table `past_email_fetches`, `runPastFetches` in the 15-minute check, `storeMessage`'s `fetchId`)
- [x] T031 [P] Add at the end of `docs/DECISIONS.md` the three choices of spec.md Clarifications decided by the factory, as `- <choice> (SF-128, decided by the factory, to confirm)` (plural "1 conversation copied"; 12 calendar months from the press; no button while Gmail needs reconnecting)
- [x] T032 Supabase Postgres (no public schema on GitHub): no fake; the integration tests run on a real local Postgres (`crm_test`) with migration `0020_past_email_fetches.sql` applied by `npm run migrate`, so the table's checks (data-model.md § Migration) are the real ones; confirm `npm test && npm run typecheck` pass and record the run in quickstart.md order
- [x] T033 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) and `## Schemas` (each schema's GitHub URL at its commit). Services: Gmail API → `src/server/gmail/fake-gmail.ts` checked by `tests/fakes/gmail.ts` against `gmail-api.json`; Google OAuth 2.0 token endpoint → the same fake, RFC 6749 / Google's web-server OAuth page, no schema; Supabase Postgres → real local Postgres, no schema. Schemas: `https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json` (keep the other schemas already listed)

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (T001–T002) → Foundational (T003–T005) → US1 (T006–T017) → US2 (T018–T025) → US3 (T026–T027) and US4 (T028–T029), which can run in either order → Polish (T030–T033); T033 is last.

### User Story Dependencies

- US1: needs Foundational only (MVP).
- US2: builds on US1's `past.ts` and the fake's thread routes.
- US3: uses US1's start and store; independent of US2 except the part-size hook (T013).
- US4: uses US1's part; independent of US2 and US3.

### Within Each User Story

- Tests first, failing; then the fake and Google calls; then `past.ts`; then actions and UI.
- `tests/integration/gmail-past-fetch.test.ts` is shared: its story tasks are sequential.

### Parallel Opportunities

- T003 ‖ T005; T007 ‖ T010 ‖ T016 (different files); T025 ‖ T023; T030 ‖ T031.

## Parallel Example: User Story 1

```text
T007 card unit tests (tests/unit/gmail-card.test.ts)
T010 putPastMailbox (src/server/gmail/fake-past-mailbox.ts)
T016 PastFetchRunner (src/app/(app)/settings/PastFetchRunner.tsx)
```

## Implementation Strategy

- MVP: Phases 1–3 (US1): a fetch that runs to the end with Settings open.
- Then US2 (closed page, slow-downs), US3 (second press, concurrency), US4 (connection changes), then Polish.
- Each checkpoint: `npx vitest run tests/unit/gmail-past-rules.test.ts tests/integration/gmail-past-fetch.test.ts`, then
  `npm test && npm run typecheck` before the end.
