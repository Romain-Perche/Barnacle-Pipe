# Research: Gmail connect and sync (SF-118)

Each section: Decision / Rationale / Alternatives considered. No NEEDS CLARIFICATION is left. Choices a person should
confirm are in spec.md § Clarifications ("decided by the factory, to confirm").

## 1. Talking to Google: plain `fetch`, no library

- **Decision**: every Google call (token exchange, token refresh, revoke, Gmail `getProfile`, `watch`, `stop`,
  `history.list`, `messages.list`, `messages.get`, `threads.get`, `messages.send`, Google's signing keys) is one `fetch`
  in `src/server/gmail/google-api.ts`. The module follows `src/server/files/storage.ts`: settings read at call time,
  `fake` mode goes in-process to the fake, `useGmailFetchForTests(fn)` for tests (throws outside `APP_ENV=test`), 10 s
  time-out per call.
- **Rationale**: the repo already does Google sign-in and Storage this way (SF-80 research §2, SF-116 research §1). About
  eleven small JSON calls do not justify `googleapis` (very large) or `google-auth-library`.
- **Alternatives**: `googleapis` / `@googleapis/gmail`: big dependency and a second way to call Google next to
  `auth/google.ts`. `google-auth-library` only for JWT checks: node:crypto does it (§6).

## 2. Permissions (scopes) and the consent request

- **Decision** (person, plan review 2026-11-24): ask for exactly `https://www.googleapis.com/auth/gmail.modify` (read
  mail, change its labels and read state, send; bin but no permanent delete) and
  `https://www.googleapis.com/auth/gmail.send` (send mail as the user). Authorization URL:
  the same `https://accounts.google.com/o/oauth2/v2/auth` and client as sign-in, with `response_type=code`, PKCE S256,
  `state`, `access_type=offline`, `prompt=consent` (always gives a refresh token), `include_granted_scopes=false`,
  `login_hint=<user's sign-in address>`, `hd=barnacle.ai`, and redirect URI `${APP_URL}/settings/gmail/callback`.
  The token answer's `scope` must contain both. Otherwise the connection is refused (`missing_scopes`) and the
  token is revoked. Google lets the user untick boxes ("granular consent").
- **Rationale**: `gmail.labels` cannot mark mail read or change a message's labels, which the later Inbox needs;
  asking for `gmail.modify` now saves every user a reconnect (spec.md § Clarifications). This issue still changes
  nothing in Gmail: it only reads and sends. `gmail.modify` alone also allows sending; `gmail.send` is asked as well,
  as the person chose, and the check needs both.
- **Alternatives**: `gmail.readonly` + `gmail.send` + `gmail.labels` (the factory's first choice, refused: a reconnect
  later). `https://mail.google.com/` (full access, permanent delete). Reusing the
  sign-in flow with more scopes would ask every user for Gmail when signing in.

## 3. Checking the return from Google

- **Decision**: `startGmailConnect` (server action, `requireUser()`) sets the cookie `crm_gmail_oauth`
  (`{state, verifier, userId}`, httpOnly, SameSite=Lax, path `/settings/gmail`, 10 minutes) and redirects to the consent
  URL. The callback route `/settings/gmail/callback` takes these steps:
  1. `requireUser()`;
  2. cookie present, same `state` and same `userId`, else `not_connected`;
  3. `error` in the query (cancel or refusal), else `not_connected`;
  4. exchange the code with the verifier;
  5. scopes check (`missing_scopes`);
  6. `getProfile` with the new access token: `emailAddress` normalised equals the user's email, else `wrong_account`;
  7. no `refresh_token`, else `not_connected`.
  Any refusal after step 4 revokes the new token (best effort) and stores nothing. The cookie is always cleared.
- **Rationale**: FR-002 (belongs to the request the same user started) and US1 scenarios 3-5. `getProfile` works with
  `gmail.modify`, so no `openid email` scope is needed.

## 4. Keeping the key: AES-256-GCM through the shared seal module, refresh token only

- **Decision**: only the refresh token is stored, in `gmail_connections.token_cipher` (`bytea`). SF-117's
  `src/server/pipedrive/crypto.ts` moves to one shared module, `src/server/crypto/seal.ts`
  (person, plan review 2026-11-24): `sealToken(key, purpose, userId, token)` / `openToken(key, purpose, userId, sealed)`
  and `TokenUnreadable` (with a neutral message). The format is unchanged: version byte 1 ‖ 12-byte IV ‖ 16-byte tag ‖
  ciphertext, AES-256-GCM (`node:crypto`), tag length pinned to 16. The additional data is `"<purpose>:<userId>"`,
  with purpose `pipedrive-token` (exactly SF-117's string, so saved Pipedrive tokens still open) or `gmail-token`, so a
  cipher copied to another user or to the other service does not open. Pipedrive keeps `PIPEDRIVE_TOKEN_KEY`; Gmail
  uses its own `GMAIL_TOKEN_KEY` (32 random bytes, base64), decoded by one shared `readTokenKey(raw)` helper in
  `env.ts` that `pipedriveConfig()` also uses. `pipedrive/crypto.ts` is removed and its importers
  (`pipedrive/connection.ts`, `tests/unit/pipedrive-crypto.test.ts`) point at the shared module. Access tokens are never stored: each sync, renewal or send asks for a fresh one
  (`grant_type=refresh_token`), kept in memory for that call only. As for Pipedrive, there is no built-in key:
  without a valid `GMAIL_TOKEN_KEY` Gmail mode is `off`, in fake mode too (`.env.example` says how to make one; the
  test setup sets one).
- **Rationale**: FR-003 / SC-004. It is the same rule as the Pipedrive token (DECISIONS kickoff), now the same code.
  Separate keys keep a leak or rotation of one service's key from touching the other. With ≤ 10 users
  every 15 minutes, one extra refresh per run is cheap. `GoogleRefused`/`GmailError` messages carry only the HTTP
  status and Google's `error` code, never a token or a body.
- **Alternatives**: pgcrypto (the key would travel in SQL text and could reach query logs). Caching access tokens
  (another secret at rest for no real gain).

## 5. "Google no longer accepts the key"

- **Decision**: these mean `needs_reconnect`:
  - a refresh answered `400 invalid_grant` (`invalid_client` is our own setup, so it is "unavailable", not a key
    refusal);
  - a Gmail answer `401` with a fresh token;
  - a Gmail answer `403` whose `error.errors[].reason` is `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`.
  Everything else (network, time-out, 429, 5xx, other 4xx) is "unavailable": state unchanged, retried by the next
  check. Marking `needs_reconnect` is one update `where state = 'working'`, done after the network call.
- **Rationale**: FR-006, US4 scenario 2, and the "Renewal fails" edge case (a non-key failure keeps the connection
  working).

## 6. Proving a notice comes from Google (Pub/Sub push with authentication)

- **Decision**: the push subscription uses an authenticated push with a service account. Each POST to `/gmail/push`
  carries `Authorization: Bearer <Google-signed OIDC JWT>`. `verifyPushToken` (`src/server/gmail/push.ts`, node:crypto
  only) checks:
  - header `alg` is `RS256`;
  - `kid` is among Google's keys from `https://www.googleapis.com/oauth2/v3/certs` (JWK set, cached in memory for the
    `max-age` of the answer, at most 1 h; fetched again once on an unknown `kid`);
  - the signature verifies with `crypto.createPublicKey({ key: jwk, format: "jwk" })` + `crypto.verify("sha256", …)`;
  - `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`};
  - `aud` === `GMAIL_PUSH_AUDIENCE` (default `${APP_URL}/gmail/push`);
  - `email` === `GMAIL_PUSH_SERVICE_ACCOUNT` and `email_verified` true;
  - `exp` in the future and `iat` not more than 1 h in the past, with 5 minutes of clock leeway.
  Body: `{ message: { data, messageId, publishTime, attributes? }, subscription }`. The subscription must equal
  `GMAIL_PUSH_SUBSCRIPTION` when set. `data` is base64 JSON `{ emailAddress, historyId }`.
  - Bad proof: `403`, empty body.
  - Bad body: `400`.
  - An address with no `working` connection: `204`, nothing done. An acknowledgement, so Pub/Sub does not retry forever.
  - Otherwise: sync that connection, then `204`. A sync failure is `204` too: the 15-minute check recovers it.
- **Rationale**: FR-008 / FR-015 ("only notices it can confirm come from the team's Google Cloud setup"). This is the
  method Google documents for push authentication. No JWT library is needed for one fixed algorithm.
- **Alternatives**: a secret token in the push URL's query (weaker: URLs end up in logs). `jose` (a dependency for
  about 40 lines).

## 7. What runs the 15-minute check and the daily renewal

- **Decision**: one Vercel cron job (spec clarification: Vercel Pro): `vercel.json` →
  `{"crons":[{"path":"/cron/gmail","schedule":"*/15 * * * *"}]}`. The route `GET /cron/gmail` requires
  `Authorization: Bearer ${CRON_SECRET}` (Vercel sends it; compared in constant time; else `401`, empty body) and runs
  `runGmailCheck(now)`, which does this:
  1. for every `working` connection, oldest `last_synced_at` first, it syncs (§8);
  2. it renews the watch (`users.watch`) when `watch_renewed_at` is null or older than 20 hours.
  So each connection is renewed once a day ("at least once every 24 hours", FR-007), plus on connect and reconnect.
  `export const maxDuration = 300`. The run stops starting new connections after 240 s.
- **Rationale**: one scheduled job instead of two does the same work. Renewal failures are handled by connection, so a
  failed renewal is retried 15 minutes later instead of the next day.
- **Alternatives**: a second daily cron route (more config, same work). Supabase `pg_cron` calling the app (a second
  scheduler and secret).

## 8. Sync algorithm

- **Decision** `syncConnection(connectionId, now)` (`src/server/gmail/sync.ts`):
  1. **Lease**: `update gmail_connections set sync_lease_until = now + 2 min, sync_again = false where id = … and state =
     'working' and (sync_lease_until is null or sync_lease_until < now) returning …`. With no row, set `sync_again =
     true` and return: the holder loops once more. No lock is held across network calls (pooler rule: no session
     state, no network inside `sql.begin()`).
  2. **Token**: refresh the access token (§4, §5).
  3. **Changes**: `history.list` with `startHistoryId = history_id`, `historyTypes=messageAdded`, `maxResults=500`, all
     pages. Collect `messagesAdded[].message.id` and remember the answer's `historyId`.
     **History gone** (`404`): `getProfile` first (new `historyId`), then `messages.list` with
     `q = "after:<unix seconds of (last_synced_at ?? connected_at) − 1 h>"`, `includeSpamTrash=false`, all pages
     (Edge case "Large catch-up").
  4. Ids already stored for this connection are dropped in one query.
  5. Each remaining id: `messages.get` `format=full`, then the pure `decideCopy` (rules.ts) decides:
     - skip when `labelIds` has `DRAFT`, `SPAM` or `TRASH`, or when `internalDate` < `connected_at`;
     - copy when the thread is already copied for this connection, or when any address in From / To / Cc / Bcc
       (parsed, trimmed, lower-cased; display names ignored) is in `person_emails.email` (one query for the batch).
  6. **Store** each copied message in one `sql.begin()`:
     - upsert `email_threads` (connection, `threadId`), with `on conflict do nothing` then select;
     - insert `email_messages` `on conflict (connection_id, gmail_message_id) do nothing`;
     - insert `email_attachments`.
  7. **Finish**: one update sets `history_id` to the remembered `historyId` (never lower: `greatest` as numeric),
     `last_synced_at = now`, `sync_lease_until = null`; then it loops when `sync_again`.
  8. **Time budget**: at most 300 `messages.get` per run. The rest is left for the next notice or check (`history_id`
     not advanced, so nothing is lost; stored ids are skipped).
- **Rationale**: FR-009 to FR-012, SC-003. The unique index makes "copied at most once" hold even if two runs overlap.
  `internalDate` (when Gmail got the message) is the reliable date. The `Date` header is the sender's claim and is
  stored but not used to decide.
- **"Last sync"**: set only when a sync finishes. A sync that copies nothing still sets it (US2 scenario 3).

## 9. Reading a Gmail message

- **Decision**: pure functions in `src/server/gmail/rules.ts`:
  - `parseAddressList` (RFC 5322 address-list with quoted display names, comments, groups, `<addr>`);
  - `headerValue` (case-insensitive, RFC 2047 encoded-words decoded for Subject and names: `=?utf-8?B?…?=` / `?Q?`);
  - `walkParts`:
    - the first `text/plain` and first `text/html` not marked as an attachment become `text_body` / `html_body`
      (base64url `body.data` decoded with the part's `charset`, via `TextDecoder`, UTF-8 when unknown);
    - every part with a `filename` or a `body.attachmentId` becomes an attachment: name (`"(no name)"` when empty),
      `mimeType`, `body.size`. Its contents are never fetched.
  - `direction`: `sent` when `labelIds` has `SENT`, else `received`.
- **Rationale**: FR-010; US2 scenario 7; edge cases "only HTML or only attachments" and "Address match".

## 10. Sending (FR-013)

- **Decision**: `sendGmail(userId, { to, cc?, bcc?, subject, text, html?, threadId? })` → `{ messageId, threadId }`.
  - It refuses with `GmailNotConnected` / `GmailNeedsReconnect` before any network call.
  - The pure `buildMime` builds RFC 5322 text: `From: <connected address>`, `To`, `Cc`, `Bcc`, `Subject` (RFC 2047 when
    not ASCII), `Date`, `Message-ID` (Gmail sets its own), `MIME-Version`, `multipart/alternative` when HTML is given,
    else `text/plain; charset=utf-8`, base64 bodies.
  - It refuses CR/LF in any header value or address (no header injection).
  - It POSTs `{ raw: base64url(mime), threadId? }` to `gmail/v1/users/me/messages/send`.
  - With a `threadId`, it first reads `threads.get` `format=metadata`, `metadataHeaders=Message-ID,References,Subject`,
    and sets `In-Reply-To` / `References` from the last message, so Gmail keeps the conversation.
  - A key refusal → `needs_reconnect` + `GmailNeedsReconnect`. Other failures → `GmailUnavailable`.
  - The test email: `to = [own address]`, subject `Barnacle CRM test email`, fixed text from `messages.ts`.
- **Rationale**: Gmail's documented way to send in a thread (threadId + RFC headers + same Subject).

## 11. Disconnect, deactivation, reconnect

- **Decision**:
  - **Disconnect**: one transaction takes the cipher and sets `state='disconnected'`, `token_cipher=null`, watch and
    lease fields null. After commit, best effort: refresh → `users.stop` → `POST https://oauth2.googleapis.com/revoke`
    (`token=<refresh token>`). Failures are ignored (FR-005).
  - **Deactivation**: `users.deactivate` does the same in its own transaction (`forgetGmailInTx`), and the admin action
    runs the Google calls after commit (`afterGmailForgotten`).
  - **Reconnect** from `needs_reconnect`: the same flow as connect. The row keeps `connected_at`, `history_id` and
    `last_synced_at`, so sync carries on from where it stopped (catch-up through §8 step 3 when history is gone). The
    notice is `reconnected`.
  - **Connect** from `disconnected` or with no row: new `connected_at = now` and `history_id` from `getProfile`. The
    connection keeps its old conversations, so the count goes on.
  - **Connect while working** (second tab): the new token replaces the old one, which is revoked after commit.
- **Rationale**: US4, edge cases "Deactivated user" and "Connecting twice". Emails are kept (spec clarification).

## 12. Settings states and "Gmail not set up"

- **Decision**: `gmailConfig()` in `env.ts`:
  - `real` when `GMAIL_PUBSUB_TOPIC` is set and `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`,
    `GMAIL_TOKEN_KEY` (32 bytes once decoded), `GMAIL_PUSH_SERVICE_ACCOUNT` and `CRON_SECRET` are all valid;
  - `fake` when `GMAIL_PUBSUB_TOPIC` is empty, `isFakeAllowed()` and `GMAIL_TOKEN_KEY` is valid;
  - else `off`: Settings shows "Gmail can't be connected right now." and no button, the actions refuse, and the cron and
    push routes answer `204` doing nothing.
  An existing connection shown while `off` keeps its state line, but the buttons are hidden.

## 13. The "!" on the Settings link on every page

- **Decision**: the "!" goes on SF-117's one "Settings" link, `footerNav` at the bottom of the sidebar above
  `[ SIGN OUT ]` (no new nav entry). The layout reads `gmailNeedsReconnect(user.id)` beside `unreadCount`. SF-108's `currentUnread` becomes
  `currentSidebar()` → `{ unread, gmailWarn }`, and the client part is generalised so the Notifications count and the
  Settings "!" are both refreshed after each client navigation. `SidebarLink` gets `warn?: boolean`: a
  `<span className="warn" aria-label="Gmail needs reconnecting">!</span>` in orange (`--orange` / the nearest existing
  variable).
- **Rationale**: FR-017 "on every signed-in page". A background sync can flip the state while the user moves around
  with client navigation, which is the same problem SF-108 solved.

## 14. Fakes (FR-018)

- **Decision**: `src/server/gmail/fake-gmail.ts` `FakeGoogleMail`, one class used by local runs and by tests (like
  `FakeStorage`).
  - **State**: users' mailboxes (messages with labels, thread ids, internalDate, payload), a history log with ids,
    codes, refresh and access tokens with scopes, revoked tokens, watches, and an RSA key pair for push JWTs.
  - **Store**: `MemoryStore` in tests, `DiskStore` `.fake-gmail/state.json` in development (git-ignored).
  - **Fetch**: answers the token, revoke, certs and Gmail calls of §1 at the real URLs.
  - **Consent screen** `/dev/fake-google/gmail`: account field pre-filled with `login_hint`, two ticked boxes ("Read, change and send your email" = `gmail.modify`, "Send email as you" = `gmail.send`), `[ ALLOW ]`
    and `[ CANCEL ]`. It redirects to the `redirect_uri` with `code`+`state` or `error=access_denied`.
  - **Mailbox page** `/dev/fake-gmail`:
    - pick a user;
    - put in a received or sent message (from, to, cc, bcc, subject, text, HTML, attachments as `name:size` lines, date
      offset, label INBOX/SPAM/DRAFT/TRASH, thread: new or an existing one);
    - with or without delivering its notice;
    - `[ RUN THE 15-MINUTE CHECK ]`;
    - `[ REFUSE THE KEY ]` (Google stops accepting it), `[ FAIL RENEWALS ]` and `[ FORGET HISTORY ]` switches;
    - the list of the mailbox's messages (so the test email can be seen in Sent and Inbox), and the key's status
      (active / cancelled) and the watch's status.
    Delivering a notice calls the same `receiveGmailPush` the route uses, with a JWT signed by the fake's key and the
    fake's JWKS at the certs URL.
  - Both pages answer 404 unless `isFakeAllowed()` and the Gmail mode is `fake`.
  - **Tests**: `tests/fakes/gmail.ts` wraps the fake (`GmailFake`, `useGmailFetchForTests`) and checks every Gmail call
    and answer against `.factory/schemas/gmail-api.json`, and every push body against `PubsubMessage` in
    `.factory/schemas/pubsub-api.json` (contracts/google.md § Fake checks).

## 15. Fake data (FR-019)

- **Decision**: `src/seed/gmail.ts`, run after `people`:
  - Ada Fake (first fake user) gets a `working` connection with a fake refresh token, encrypted with the fake-mode key,
    made in the fake Google.
  - It gets 3 conversations with fake CRM people. Each has 1-3 messages, sent and received, with 1-2 attachments
    (`proposal-fake.pdf` 245 KB, `logo-fake.png` 18 KB).
  - The messages are put into the fake mailbox and copied by `syncConnection`, the real path.
  - It is re-runnable through the unique keys. It needs fake mode. With real settings, the seeder prints "Gmail fake
    data skipped (real Gmail settings)."
