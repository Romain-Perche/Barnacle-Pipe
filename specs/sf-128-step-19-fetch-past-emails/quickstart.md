# Quickstart: Fetch past emails (SF-128)

How to see the feature work. Test code and the full test recipe are written by Build (`.factory/test-env.md`).

## Automated checks

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run migrate            # applies 0020_past_email_fetches.sql
npm run test:schemas       # gmail-api.json is already pinned
npx vitest run tests/unit/gmail-past-rules.test.ts tests/integration/gmail-past-fetch.test.ts
npm test && npm run typecheck
```

Expected:

- unit (`planPastThread`, `slowDownSeconds`, window of 12 calendar months): every row of data-model.md § Copy rule;
- integration, fake mailbox of 100 conversations (data-model.md § Fake mailbox): a full fetch ends `ended` with
  `copied = 60`, 60 new `email_threads`, group D threads with 2 messages each, no group G–O thread; a second fetch
  ends with 0; after adding Nia Later (`nia.later@example.test`), 5; with part size 10, every part's `copied` ≥ the
  previous one; two `startPastFetch` at once → one `running` row; a closed-page run through `runGmailCheck` ends
  with the same number; a slow-down (`fake.slowDown`) sends no Gmail call before `wait_until`; unreachable keeps the
  cursor and `problem = 'unavailable'`; a refused key → connection `needs_reconnect`, `finishConnect` → the fetch
  carries on to 60; disconnect → row gone, threads kept; a reply copied by the live sync during a fetch counts once.

## By hand (development, fake Gmail)

1. `npm run dev` with `APP_ENV=development` and Gmail in fake mode (README § Gmail); `npm run seed`.
2. Sign in as Ada Fake (fake Google), Settings → `[ CONNECT GMAIL ]` → allow on the fake consent screen.
3. `/dev/fake-gmail?user=<Ada's address>` → `[ PUT 100 PAST CONVERSATIONS ]` (the CRM people of data-model.md § Fake
   mailbox must exist: add Ana Fake with both addresses, Ben Fake, a private Pia and an archived Arlo, or use the
   people the test helper creates).
4. Settings: the Gmail card shows `// PAST EMAILS`, the explanation and `[ FETCH PAST EMAILS ]`. Press it: `FETCHING…`,
   "Fetching past emails: <n> conversations copied" rising, then "Past emails fetched: 60 conversations copied." and
   "Last fetched <date time>. …"; the card's total rises by 60.
5. Press again: "Past emails fetched: 0 conversations copied.".
6. Press, close the tab after the first refresh, then on `/dev/fake-gmail` press `[ RUN THE 15-MINUTE CHECK ]` until
   Settings shows the end message.
7. During a fetch: `[ SLOW DOWN NEXT CALL ]` (the number pauses ~30 s, then goes on), `[ GMAIL UNREACHABLE: ON ]`
   (the "can't be reached" line; OFF then the check: it ends), `[ REFUSE THE KEY ]` (the paused line; reconnect: it
   ends), `[ DISCONNECT ]` (no part line; reconnect: the button and no old end message).
