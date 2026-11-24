# Quickstart: validate Gmail connect and sync (SF-118)

## Prerequisites

- Local Postgres. `APP_ENV=development` (or `test`). `GMAIL_PUBSUB_TOPIC` empty, so the fake Gmail is used.
- `npm run db:migrate && npm run db:seed` (Ada Fake gets a connected fake Gmail with 3 conversations).
- `npm run test:schemas` downloads `gmail-api.json` and `pubsub-api.json` (contracts/google.md § Schemas).

## Automated

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run typecheck
```

The tests should cover each item below and name it (`// covers FR-…, US… scenario …`):
- **Unit (`rules.ts`, `crypto.ts`, `push.ts`)**:
  - address parsing (quoted names with commas, `ANA@Example.test ` → `ana@example.test`, display name "Ana Fake"
    not matched);
  - RFC 2047 subjects;
  - `readMessage` on HTML-only, attachment-only and nameless-attachment payloads;
  - `decideCopy` for drafts, spam, trash, before `connected_at` and known thread;
  - `buildMime` refuses CR/LF and threads with `In-Reply-To`;
  - the seal/open round trip, and that a cipher from another `user_id` fails;
  - JWT checks: bad signature, wrong `aud`, `email`, `iss`, or an expired token are refused.
- **Integration with `GmailFake` (real Postgres)**: US1 scenarios 1-5, US2 scenarios 1-7, US3 scenarios 1-4, US4
  scenarios 1-4, every edge case, and SC-003 / SC-004. For SC-004, after a connect, search every table's text, every
  page's HTML, every message and captured `console` output for the refresh token: it is never found.
- **`migrate.test.ts`**:
  - `0012_gmail.sql` on a fresh database;
  - the `23514` refusals (a disconnected row with a cipher, a working row without one, a non-barnacle address);
  - the `23505` refusal (a second message with the same Gmail id for a connection);
  - the scan for session state still passes.
- **`fetch-schemas`**: the two new pinned files.

## By hand (`npm run dev`, http://localhost:3000)

1. Sign in through the fake Google as Linus Fake. The sidebar shows "Settings" with no "!". Settings shows "Gmail is
   not connected." and `[ CONNECT GMAIL ]`.
2. `[ CONNECT GMAIL ]` opens the fake consent screen. Untick "Change labels" and press `[ ALLOW ]`: "Gmail needs all the
   permissions…". Again with another address: "Connect the Gmail account you sign in with (linus@barnacle.ai).".
   `[ CANCEL ]`: "Gmail was not connected.". Then allow all: "Gmail connected.", "Connected as linus@barnacle.ai",
   "Last sync: Not synced yet", "0 conversations copied".
3. Open `/dev/fake-gmail` and pick Linus. Put in a received message from a seeded person's second address with two
   attachments, with its notice delivered. Reload Settings: "1 conversation copied", and "Last sync" set.
4. Put in a message from `someone@else.test`, delivered: the count is unchanged and "Last sync" moves. Put in a message
   from a CRM person in a new thread, notice dropped. Press `[ RUN THE 15-MINUTE CHECK ]`: +1. Deliver that notice
   again: unchanged.
5. `[ SEND ME A TEST EMAIL ]`: "Test email sent to linus@barnacle.ai. Check your inbox.". The fake mailbox shows it in
   SENT and INBOX. The count is unchanged after a check.
6. On `/dev/fake-gmail`, press `[ REFUSE THE KEY ]` for Linus, then `[ RUN THE 15-MINUTE CHECK ]`. Settings shows the red
   "Gmail · needs reconnecting" card with the message, `[ RECONNECT GMAIL ]` and no test-email button. Every page shows
   the orange "!". Reconnect: "Gmail reconnected.", the same count, and the "!" is gone.
7. `[ DISCONNECT ]` → confirm: "Gmail disconnected.". The fake shows the key cancelled and the watch stopped. A new CRM
   message changes nothing.
8. Restart with `APP_ENV=production` and no `GMAIL_PUBSUB_TOPIC`. Settings shows "Gmail can't be connected right now."
   and the `/dev/fake-gmail` page answers 404.
9. `curl -i http://localhost:3000/cron/gmail` → 401. `curl -i -X POST http://localhost:3000/gmail/push -d '{}'` → 403.
