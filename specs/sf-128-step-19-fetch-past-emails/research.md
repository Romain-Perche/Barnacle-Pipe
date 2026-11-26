# Research: Fetch past emails (SF-128)

Every decision builds on SF-118's Gmail code (`src/server/gmail/`), which stays the one way the app reaches Gmail
(`google-api.ts`), opens the key (`connections.ts` `loadKey`) and stores a message (`sync.ts` `storeMessage`).
No new package, no new setting, no new scheduled job.

## §1 How the fetch finds the conversations: threads listed in time slices

- **Decision**: list the user's threads with `users.threads.list` (`q=after:<s> before:<e>`, `includeSpamTrash=false`,
  `maxResults=100`), walking the 12-month window **backwards in 7-day slices** (newest slice first). For each listed
  thread, read it with `users.threads.get?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc`
  and decide on the whole thread (§2); only the messages to copy are then read in full with the existing
  `users.messages.get?format=full` (`getMessage` + `readMessage`), exactly as the live sync reads them (FR-004).
- **Rationale**:
  - Thread-level: FR-003 copies a conversation when *any* of its in-window messages has a CRM address, and then *all*
    its in-window messages. `messages.list` returns messages one by one, newest first, so a thread's earlier messages
    could come before its matching message is seen; `threads.get` gives every message of the thread (labels,
    `internalDate`, the four address headers) in one call.
  - Metadata first: most threads of a mailbox (newsletters, teammates) do not match; their bodies are never
    downloaded. Bodies are fetched only for messages that will be stored and are not stored yet.
  - Slices instead of one long listing: Gmail orders threads by their newest message, so a thread that gets a new
    reply while a long fetch runs jumps to the top of a single listing and could be skipped. With slices, a thread is
    listed in every slice holding one of its messages, so its older messages are still found in their own slice.
    The cursor (`slice_end`, `page_token`, `page_offset`) is small and survives between parts; a page token only has to
    live for one slice.
  - Gmail's `after:`/`before:` take epoch seconds; the outermost slices add a 1-day margin (`after:` = window start − 1
    day, first `before:` = window end + 1 day) and the exact window is applied locally on `internalDate` (§2), so
    Gmail's own reading of dates never decides anything (edge cases "11 months 29 days" / "12 months 2 days").
- **Alternatives considered**: one `messages.list` over the window (misses earlier messages of a thread, see above);
  one `threads.list` over the window with a stored page token (a thread moving to the top is skipped, and page tokens
  are not documented to last 15 minutes between cron runs); a Gmail search built from every CRM address (`from:a OR
  to:a …`: thousands of addresses exceed the query length, and people added during the fetch would be missed);
  `threads.get?format=full` (downloads every body of every unmatched thread).

## §2 The decision on one thread (pure, `rules.ts` `planPastThread`)

- **Decision**: given the thread's messages (read from the metadata answer with `readMessage`, which already parses and
  lower-cases From/To/Cc/Bcc), the window `[start, end]`, the CRM addresses among them (one `person_emails` query per
  thread, at the moment it is examined) and the ids already stored for the account:
  1. candidates = messages with no `DRAFT`, `SPAM` or `TRASH` label and `start ≤ internalDate ≤ end`;
  2. the thread matches when some candidate has an address in the CRM set (display names never count);
  3. the result is the candidates not stored yet (all of them when the thread matches, none otherwise), oldest first.
- **Rationale**: exactly FR-003 and the clarifications (only in-window messages, earlier messages added to a thread the
  sync already copied). It differs from SF-118 `decideCopy` (connection date, "thread known") so it is a separate pure
  function beside it; both share `SKIP_LABELS`. `person_emails.email` is stored lower-cased (migration 0002 check), the
  same set the sync uses: archived and private people are in it; a deleted person's rows are gone (cascade).
- **Alternatives considered**: reusing `decideCopy` with `connectedAt = start` ("thread known" copies messages of
  threads with no CRM person in the window once one is stored; it decides message by message).

## §3 Never twice, and the count

- **Decision**: messages stay unique per account through SF-118's `unique (connection_id, gmail_message_id)`;
  `storeMessage` gains an optional `fetchId`: its thread insert becomes `insert … on conflict do nothing returning id`,
  and when that insert created the thread (and so this is the conversation's first stored message) **in the same
  transaction** `update past_email_fetches set copied = copied + 1 where id = <fetchId> and state = 'running'`.
- **Rationale**: the count is "conversations new to the account" (clarification; US3 scenarios 3 and 4): whoever creates
  the `email_threads` row first (the fetch or the live sync) owns it, decided by the unique index under concurrency.
  Counting inside the same transaction means a part cut short after a commit can never lose or repeat a count, and a
  re-examined thread (a cut-short part, a later slice, a second press) is never counted again. The card's total stays
  `count(email_threads)` (SF-118) and rises by exactly the same number.
- **Alternatives considered**: counting in memory and saving with the cursor (a crash between commit and save loses
  counts); a `fetch_id` column on `email_threads` (keeps history nobody asked for).

## §4 Parts, leases, time limits

- **Decision**: `runPastFetchPart(connectionId, { now, deadline })` in the new `src/server/gmail/past.ts`:
  1. takes a lease on the fetch row: `update past_email_fetches set lease_until = now + 90 s where connection_id = $1 and
     state = 'running' and (lease_until is null or lease_until < now) and (wait_until is null or wait_until <= now)` joined
     to a `working` connection; no row → nothing to do (another part runs, Gmail's wait is not over, ended, paused);
  2. opens the key (`loadKey`), gets an access token (`refreshAccessToken`), then handles threads one at a time: the
     page of the current slice (re-listed from the saved `page_token`), threads from `page_offset` on;
  3. after each thread, saves the cursor (`page_offset + 1`) with `where id = <fetch> and lease_until = <taken>` (lost
     lease or a disconnect deleting the row → stop at once);
  4. stops starting threads after **20 s** (`PART_BUDGET_MS`) or **100 threads** (`PART_THREADS`; tests make it 10 with
     `setPastFetchPartForTests`), whichever comes first; one Google call has its 10 s time-out, so a part ends within
     ~35 s, under the Settings page's `maxDuration = 60` (the same value as the Pipedrive import page);
  5. at the end of a page: next `page_token`, offset 0; at the end of a slice: `slice_end -= 7 days`, token null; when
     the slice just finished started at or before window start − 1 day: `state = 'ended'`, `ended_at = now`;
  6. releases the lease (`lease_until = null`).
- **Rationale**: same lease pattern as `syncConnection` (no lock across network calls, no session state); 20 s keeps the
  card's number changing at least every 30 s (SC-002) with the page's 1-second gap; the cursor saved per thread plus
  the once-only rules (§3) give "taken up again without losing or repeating anything" (FR-007).
- **Alternatives considered**: a Postgres advisory lock (held across Google calls, broken by the connection pooler);
  a queue service (none in the stack, DECISIONS: no new hosted service).

## §5 Gmail's limits and failures

- **Decision**:
  - Calls are sequential within a part and at most one part runs per user (lease), so a user's fetch uses at most
    ~10 calls a second (threads.list 10 units, threads.get 10, messages.get 5: well under Gmail's 250 units per user
    per second).
  - New `GmailSlowDown extends GoogleUnavailable` (`google-api.ts`, with `seconds`), thrown by `failWith` for **429**,
    and for **403** whose reason is `rateLimitExceeded` or `userRateLimitExceeded`; `seconds` from `Retry-After`
    (numeric seconds), else 30, kept within 1–300 (pure `slowDownSeconds(header)` in `rules.ts`). Being a
    `GoogleUnavailable`, every existing caller (sync, send, calendar) behaves exactly as before.
  - In a part: `GmailSlowDown` → `wait_until = now + seconds`, `problem = null`, lease released; no part (page or cron)
    takes the lease before `wait_until` (§4 step 1), so no request is sent to Gmail during the wait (SC-005). The card
    keeps the progress line (US2 scenario 3).
  - `GoogleUnavailable` (network, 5xx, other 4xx) → `problem = 'unavailable'`, cursor unchanged, lease released; the
    card shows "Gmail can't be reached right now. Fetching will carry on by itself."; the next successful thread
    clears `problem`.
  - A `threads.list` answering **400** while a `pageToken` was sent (token no longer valid) → the slice restarts
    (`page_token = null`, offset 0) and the part goes on: re-examined threads add and count nothing (§3).
  - `GoogleKeyRefused` → `markNeedsReconnect(connectionId)` (SF-118) and release; the fetch stays `running`, the card
    shows it paused (data-model.md § Card state) and no part takes the lease while the connection is not `working`.
    Reconnecting (SF-118 `finishConnect` needs_reconnect → working) resumes it with no extra code.
  - A thread gone between listing and reading (`threads.get` 404) or a message gone (`getMessage` null) is skipped.
- **Rationale**: matches Gmail's documented error handling (429 / 403 rate limits with back-off) and the Pipedrive
  import's handling of slow-downs; DECISIONS SF-118 classification is kept.
- **Alternatives considered**: sleeping inside the part (wastes the request's time limit); exponential back-off state
  (Gmail's answers carry or imply the wait; 30 s default is enough at one user's rate).

## §6 Carrying on with the page open and closed

- **Decision**:
  - Page open: `PastFetchRunner.tsx` (client), shown while the fetch is `running` on a `working` connection, calls the
    server action `runPastFetchPartAction()` (requireUser, the user's own connection only), then `router.refresh()`,
    then the next part **1 s** later, or after `seconds` when the answer is `wait` (Gmail's wait, or **30 s** after
    "can't be reached"); it stops on `stop` (ended, paused, gone). Same shape as `ImportRunner.tsx`.
  - Page closed: `runGmailCheck` (the existing 15-minute job, `CRON_SECRET`) gets a second loop after the connections'
    sync loop: every `running` fetch of a `working` connection, oldest first, parts back to back with
    `deadline = started + CHECK_BUDGET_MS` (240 s), each part within its own 20 s. One fetch's failure never stops the
    others.
- **Rationale**: FR-008 asks for the existing 15-minute check, not a new job; giving fetches what is left of the 240 s
  after every connection's sync keeps the live sync first. A closed-page fetch of a few thousand threads takes several
  checks (spec Assumptions).
- **Alternatives considered**: `after()` chaining parts on the server (Vercel ends the function at `maxDuration`, an
  unbounded chain is not allowed); a cron every minute (DECISIONS SF-118: one job every 15 minutes).

## §7 One fetch per user, start, stop

- **Decision**: table `past_email_fetches`, **one row per connection** (`connection_id` unique; a connection is one per
  user). `startPastFetch(userId, now)` in one transaction: lock the user's `gmail_connections` row `for update`, require
  `state = 'working'`, then `insert … on conflict (connection_id) do update set <fresh fetch> where
  past_email_fetches.state = 'ended'` → a row returned means started; none means one is running (or paused): nothing
  changes (FR-002, SC-004). The window is `end = now`, `start = end` minus 12 calendar months in UTC.
  `forgetGmailInTx` (disconnect and deactivation, SF-118) deletes the row in the same transaction (FR-011; US4 scenario
  3: after reconnecting, the button and no old end message). A part that held the lease finds its row gone at the next
  cursor save and stops.
- **Rationale**: the row lock plus the conditional upsert make two presses at the same moment start exactly one fetch;
  the row kept after the end gives "Past emails fetched: …" until the next press or a disconnect (FR-010).
- **Alternatives considered**: a fetch history table (nothing shows history); columns on `gmail_connections` (mixes
  the fetch's cursor into the connection row the live sync leases).

## §8 Fake Gmail and the 100-conversation mailbox

- **Decision**: `FakeGoogleMail` (`fake-gmail.ts`) gains: `GET threads` (`q` with `after:`/`before:` epoch seconds on
  `internalDate`, `includeSpamTrash`, `labelIds` ignored, `maxResults` ≤ 500, numeric `pageToken`, threads ordered by
  their newest message, `resultSizeEstimate`; the answer `{ threads: [{ id, snippet, historyId }], nextPageToken?,
  resultSizeEstimate }` as in `ListThreadsResponse`); `threads/{id}` honouring `format` (`minimal`: no payload,
  `metadata`: headers filtered by `metadataHeaders`, `full`: whole payload); and two switches `slowDown(seconds, calls =
  1)` (the next Gmail calls answer 429 `rateLimitExceeded` with `Retry-After`) and the existing `setUnreachable`. A
  pure builder `src/server/gmail/fake-past-mailbox.ts` `putPastMailbox(fake, email, { now, crm })` puts the 100
  conversations used by the tests and the dev page (data-model.md § Fake mailbox), so both see the same cases.
  The fake mailbox page (`/dev/fake-gmail`) gets: a "days ago" field for a put message, [ PUT 100 PAST CONVERSATIONS ],
  [ SLOW DOWN NEXT CALL ], [ UNREACHABLE ON / OFF ].
- **Rationale**: FR-015; the fake is checked against `gmail-api.json` by the existing schema check in
  `tests/fakes/gmail.ts` (paths, query parameters and answer fields of `users.threads.list` / `users.threads.get`).

## §9 What the user sees

- **Decision**: design B: inside `.gm-card`, after `.gm-lines`, a `// PAST EMAILS` row (`.gm-sub`: label on the left;
  on the right `[ FETCH PAST EMAILS ]` or `FETCHING…`), then its lines (`.gm-pd`). Fixed texts in `messages.ts`:
  - `past_emails_explain`: "Copies the last 12 months of your conversations with people in the CRM. Press again after an import: nothing is copied twice."
  - `past_emails_leave`: "You can leave this page: fetching carries on by itself."
  - `past_emails_paused`: "Fetching past emails is paused until Gmail is reconnected."
  - `past_emails_unreachable`: "Gmail can't be reached right now. Fetching will carry on by itself."
  - `past_emails_fetching`: "FETCHING…"
  - templates `past_emails_progress(n)`: "Fetching past emails: <n> conversation(s) copied", `past_emails_done(n)`:
    "Past emails fetched: <n> conversation(s) copied.", `past_emails_last(time)`: "Last fetched <time>. Press again after an import to copy conversations with new people."
  - "<n> conversations" uses the card's existing plural rule (`gmail_conversations`): "1 conversation" (spec
    Clarifications, decided by the factory, to confirm).
- **Rationale**: FR-013/FR-014, `design-options.html` option B; nothing from Gmail or the address is shown.
