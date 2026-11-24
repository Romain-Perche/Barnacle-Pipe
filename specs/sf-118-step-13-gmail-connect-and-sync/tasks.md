---

description: "Task list for SF-118 Gmail: connect and sync"
---

# Tasks: Gmail: connect and sync

**Input**: Design documents from `/specs/sf-118-step-13-gmail-connect-and-sync/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, contracts/google.md, quickstart.md

**Tests**: Required by the repo (AGENTS.md § Tests) and by the spec (SC-003 to SC-005).
- Tools: Vitest unit tests, and Vitest integration tests against a real local Postgres (`crm_test`) with the Gmail fake.
- No browser tests (docs/DECISIONS.md, 2026-11-23): never start the app in a browser.
- Each test file names what it covers (`// covers FR-009, US2 scenario 5`).
- Write each story's tests first and see them fail before writing the code.

**Organization**: Tasks are grouped by user story. Where each detail lives:
- Message texts: contracts/routes.md § Messages, verbatim, from `src/server/messages.ts` only.
- Migration, entities, state changes, copy rules and fake data: data-model.md.
- Pages, routes, actions and domain functions: contracts/routes.md.
- Google calls, settings, the Google Cloud setup and the fake: contracts/google.md.
- Decisions: research.md (§n below).

**Constraints and choices**:
- No new dependency (`dependencies.json` is `[]`): no `googleapis`, `google-auth-library` or `jose`. Use `fetch` and
  `node:crypto` only.
- No blueprint applies (`blueprints.json` is `[]`; there is no blueprint index in this run). So there are no
  blueprint tasks and no "Departs from blueprint" line.
- The choices of spec.md § Clarifications (Session 2026-11-24, plan review) are built as written there: scopes
  `gmail.modify` + `gmail.send`; build on SF-117's Settings page, footer "Settings" link and token sealing.
- Outside services:
  - Gmail API: schema; T010.
  - Cloud Pub/Sub: schema; T024.
  - Google OAuth token, revoke and signing keys: no schema; T011.
  - Supabase Postgres: no schema; T012.
  - The recipe is T044, the last task.
- Fake users: Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users), Alan Fake (deactivated); their
  emails are `<first name lower-case>@barnacle.ai`.
- Never put a Google call inside `sql.begin()`. No session state (`set`, `listen`, session advisory locks).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup

**Purpose**: Schema, settings and texts every story uses.

- [x] T000 Merge `origin/main` into the branch first (SF-117: `/settings` with `PipedriveSection`, `footerNav`'s
  "Settings" link in `layout.tsx`, `src/server/pipedrive/crypto.ts`, `PIPEDRIVE_TOKEN_KEY`, `0012_pipedrive.sql`). Run
  `npm test` once to see the base is green. Every task below builds on these files; none adds a second Settings page
  or link.
- [x] T001 Write `migrations/0013_gmail.sql` exactly as data-model.md § Migration. No `begin`/`commit`/`concurrently`.
  - **`gmail_connections`**:
    - `user_id bigint not null unique references users (id)`
    - `email text not null unique check (email = lower(btrim(email)) and email like '%@barnacle.ai')`
    - `state text not null check (state in ('working', 'needs_reconnect', 'disconnected'))`
    - `token_cipher bytea null`
    - `scopes text not null default ''`
    - `connected_at timestamptz not null`
    - `history_id numeric(20, 0) null check (history_id >= 0)`
    - `last_synced_at`, `watch_renewed_at`, `watch_expires_at`, `sync_lease_until`: `timestamptz null`
    - `sync_again boolean not null default false`
    - `updated_at timestamptz not null default now()`
    - `check ((state = 'disconnected') = (token_cipher is null))`
    - `check (state <> 'disconnected' or (watch_renewed_at is null and watch_expires_at is null and sync_lease_until is null))`
  - **`email_threads`**:
    - `connection_id … references gmail_connections (id) on delete cascade`
    - `gmail_thread_id text not null check (gmail_thread_id <> '' and char_length(gmail_thread_id) <= 64)`
    - `subject text not null default ''`
    - `created_at`
    - `unique (connection_id, gmail_thread_id)`
  - **`email_messages`**:
    - `connection_id`, and `thread_id … references email_threads (id) on delete cascade`
    - `gmail_message_id text not null check (gmail_message_id <> '' and char_length(gmail_message_id) <= 64)`
    - `rfc_message_id text null check (char_length(rfc_message_id) <= 998)`
    - `direction text not null check (direction in ('sent', 'received'))`
    - `from_address`, `from_name`
    - `to_list` / `cc_list` / `bcc_list`: `jsonb not null default '[]' check (jsonb_typeof(…) = 'array')`
    - `subject text not null default ''`
    - `sent_at timestamptz null`, `received_at timestamptz not null`
    - `text_body`, `html_body`, `created_at`
    - `unique (connection_id, gmail_message_id)`
    - indexes `email_messages_thread_idx (thread_id, received_at)` and `email_messages_rfc_idx (rfc_message_id) where rfc_message_id is not null`
  - **`email_attachments`**:
    - `message_id … on delete cascade`
    - `position int not null check (position >= 0)`
    - `name text not null check (name <> '' and char_length(name) <= 255)`
    - `content_type text not null default 'application/octet-stream' check (char_length(content_type) <= 255)`
    - `size bigint not null check (size >= 0)`
    - `unique (message_id, position)`
  - **RLS**: `alter table … enable row level security` after each of the four `create table`, with no policies.
- [x] T002 [P] Add the messages and templates of contracts/routes.md § Messages to `src/server/messages.ts`, under an
  `// SF-118` comment.
  - Codes: `gmail_not_connected`, `gmail_unavailable`, `gmail_connected`, `gmail_reconnected`, `gmail_cancelled`,
    `gmail_missing_scopes`, `gmail_disconnected`, `gmail_disconnect_confirm`, `gmail_test_failed`, `gmail_not_synced`,
    `gmail_test_subject`, `gmail_test_text`, `gmail_settings_warn`.
  - Templates: `gmail_connected_as`, `gmail_wrong_account`, `gmail_needs_reconnect`, `gmail_test_sent`,
    `gmail_conversations` (1 → "conversation", otherwise "conversations"), `gmail_last_sync`, `gmail_copying_since`.
- [x] T003 [P] Add `gmailConfig()` to `src/server/env.ts` (research.md §12, contracts/google.md § Settings). Read at call
  time.
  - Mode `real`: `GMAIL_PUBSUB_TOPIC` is set, and `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`,
    `GMAIL_TOKEN_KEY` (base64 that decodes to exactly 32 bytes), `GMAIL_PUSH_SERVICE_ACCOUNT` and `CRON_SECRET`
    (≥ 16 characters) are all valid.
  - Mode `fake`: `GMAIL_PUBSUB_TOPIC` is empty, `isFakeAllowed()` is true and `GMAIL_TOKEN_KEY` is valid. No built-in
    key (as SF-117): without it the mode is `off`. Set a test key in the test setup and the README dev steps.
  - Decode the key with a new `readTokenKey(raw)` (base64 → exactly 32 bytes, else null) and make `pipedriveConfig()`
    use it too, with the same behaviour.
  - Otherwise `{ mode: "off" }`.
  - `pushAudience` defaults to `${APP_URL}/gmail/push`.
  - Then add, after the Pipedrive block, `GMAIL_PUBSUB_TOPIC=`, `GMAIL_TOKEN_KEY=` (its own key, never the
    `PIPEDRIVE_TOKEN_KEY` value), `GMAIL_PUSH_SERVICE_ACCOUNT=`, `GMAIL_PUSH_AUDIENCE=`,
    `GMAIL_PUSH_SUBSCRIPTION=` and `CRON_SECRET=` (empty, with comments, the secrets marked as secrets) to
    `.env.example`, and `.fake-gmail/` to `.gitignore`.
- [x] T004 [P] In `scripts/fetch-schemas.mjs`, add two entries to `SCHEMAS`:
  - `gmail-api.json`: `https://raw.githubusercontent.com/googleapis/google-api-go-client/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json`,
    sha256 `839b7963df95481f3cd2ba7aa1e906f1fc67c4ae89719d09bb7305040e99f0fb`;
  - `pubsub-api.json`: `…/3f740bc15212818d4d0eb041b02c951457ff63fa/pubsub/v1/pubsub-api.json`,
    sha256 `df690a6912844276487a3dae9db3346e65b19aa5434ab0ae024fc89dcffffc17`.

  Update the head comment, and any test that lists the files.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The pure rules, encryption, database reset and migration test. ⚠️ No story starts before this phase is
done.

- [x] T005 [P] Unit tests `tests/unit/gmail-rules.test.ts` for `src/server/gmail/rules.ts` (research.md §2, §5, §9,
  §10). Cover:
  - `GMAIL_SCOPES` is exactly the two URLs `gmail.modify` and `gmail.send`. `hasAllScopes` is true only when both are
    in a space-separated scope string, in any order, with extra scopes allowed (`gmail.modify` alone is refused).
  - `parseAddressList`:
    - `"Ana Fake" <ana@example.test>, "Kim, Fake" <kim@example.test>` gives two entries, with names;
    - `ANA@Example.test ` gives `ana@example.test`;
    - groups and comments are read; an address-less display name is dropped.
  - `decodeHeader` for `=?utf-8?B?…?=` and `=?ISO-8859-1?Q?…?=`.
  - `readMessage`:
    - text plus HTML;
    - HTML only (`text_body` null);
    - attachments only;
    - an attachment with an empty `filename` and an `attachmentId` is stored as `(no name)` with its `body.size`;
    - a 20 MB `contract.pdf` part gives name, type and size, and no contents;
    - `direction` is `sent` when `labelIds` has `SENT`;
    - `received_at` comes from `internalDate`;
    - names over 255 characters are cut.
  - `decideCopy`:
    - skip for `DRAFT`, `SPAM` or `TRASH`;
    - skip when `internalDate` < `connectedAt`;
    - copy for a known thread with no CRM address;
    - copy when the CRM address is only in Bcc;
    - skip when only the display name matches.
  - `buildMime`:
    - refuses CR/LF in a subject or an address (`BadHeader`);
    - RFC 2047 for a non-ASCII subject;
    - `multipart/alternative` with HTML;
    - `In-Reply-To` / `References` when given.
  - `classifyGoogleError`:
    - `400 invalid_grant`, a Gmail `401`, and a `403` with reason `insufficientPermissions` → `key_refused`;
    - a `403` with another reason, `429`, `5xx`, and `400 invalid_client` → `unavailable`.
- [x] T006 [P] Move `tests/unit/pipedrive-crypto.test.ts` to `tests/unit/seal.test.ts` for the shared module (covers
  FR-003, SC-004, and SF-117 FR-003):
  - `sealToken` / `openToken` round trip for both purposes `"pipedrive-token"` and `"gmail-token"`;
  - the cipher contains no byte run of the token;
  - two seals of one token differ (random IV);
  - opening with another `userId`, another purpose or another key throws `TokenUnreadable`;
  - a tampered byte throws;
  - the first byte is version 1;
  - a fixed sample sealed by SF-117's `pipedrive/crypto.ts` (made once before the move, key and value in the test)
    still opens with purpose `"pipedrive-token"`.
- [x] T007 Write `src/server/gmail/rules.ts`, and move `src/server/pipedrive/crypto.ts` to `src/server/crypto/seal.ts`
  (research.md §4): `sealToken(key, purpose, userId, token)` / `openToken(key, purpose, userId, sealed)`, additional
  data `"<purpose>:<userId>"`, format and 16-byte tag unchanged, `TokenUnreadable` with a neutral message. Point
  `src/server/pipedrive/connection.ts` at it with purpose `"pipedrive-token"` and delete `pipedrive/crypto.ts`. Work
  until T005, T006 and the SF-117 Pipedrive tests pass. Pure: no database and no network.
- [x] T008 Add `gmail_connections`, `email_threads`, `email_messages` and `email_attachments` to
  `tests/support/reset.ts`, in an order that respects the foreign keys (and to `.factory/run/reset-db.sh` if it lists
  tables).
- [x] T009 Extend `tests/integration/migrate.test.ts` (covers data-model.md § Migration). Check:
  - `0013_gmail.sql` applies on a fresh database, after `0012_pipedrive.sql`;
  - `23514` for:
    - a `disconnected` row with a cipher;
    - a `working` row without one;
    - `email` `x@other.test`;
    - a `disconnected` row with `watch_expires_at`;
    - `direction` `forwarded`;
    - an attachment `size` of -1 or `name` `''`;
    - `to_list` `'{}'`;
  - `23505` for a second `(connection_id, gmail_message_id)`;
  - deleting a thread cascades its messages and attachments;
  - the existing scan for session state still passes.

**Checkpoint**: the rules, encryption and tables are ready.

---

## Phase 3: User Story 1 - Connect my Gmail account (Priority: P1) 🎯 MVP

**Goal**: A Gmail card on SF-117's Settings page and the "!" on its sidebar link. A connect flow that stores the
encrypted key only for the user's own account with both permissions.

**Independent Test**: With the fake Google, sign in as Linus Fake, connect, and see the connected card. The refresh
token never appears in plain text in the database, a page, a message or the console.

### Tests for User Story 1

- [x] T010 [US1] Download `gmail-api.json` from
  https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
  at commit `3f740bc15212818d4d0eb041b02c951457ff63fa` into `.factory/schemas/`:

  ```
  git init -q /tmp/google-api-go-client && git -C /tmp/google-api-go-client fetch -q --depth 1 https://github.com/googleapis/google-api-go-client 3f740bc15212818d4d0eb041b02c951457ff63fa && git -C /tmp/google-api-go-client show FETCH_HEAD:gmail/v1/gmail-api.json > .factory/schemas/gmail-api.json
  ```

  Then make the fake of the Gmail API refuse a request that the schema refuses. A test sends a wrong field and must
  fail.
  - Write `tests/fakes/gmail.ts` (`GmailFake`, installed with `useGmailFetchForTests`) around `FakeGoogleMail`
    (T013), as contracts/google.md § Fake › Checks says:
    - the path and method must be among the schema's `resources.users` methods;
    - query parameters must be declared for that method;
    - JSON body properties must be declared in `WatchRequest` / `Message`;
    - every answer's properties must be declared in its response schema (`Profile`, `WatchResponse`,
      `ListHistoryResponse`, `History`, `HistoryMessageAdded`, `ListMessagesResponse`, `Message`, `MessagePart`,
      `MessagePartHeader`, `MessagePartBody`, `Thread`), with JSON types (`int64`/`uint64` as strings);
    - it throws when the schema file is missing (fail, never skip).
  - In `tests/unit/gmail-fake-schema.test.ts`, assert that each of these makes the test fail:
    - `watch` with body `{ "topic": "…" }` (not `topicName`);
    - `history.list` with query `startHistory=1`;
    - a fake answer of `getProfile` with `email` instead of `emailAddress`.
- [x] T011 [P] [US1] Google OAuth token and revoke endpoints and Google's signing keys have no public schema on GitHub.
  The fake follows Google's documentation pages "Using OAuth 2.0 for Web Server Applications"
  (https://developers.google.com/identity/protocols/oauth2/web-server: code exchange, refresh, revoke, granular
  consent) and "Authenticate push subscriptions"
  (https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions: the OIDC token and its claims), together with
  RFC 6749 §5.1/§5.2/§6, RFC 7636, RFC 7009 §2.2 and RFC 7517.
  - Errors and limits it copies:
    - `400 invalid_grant` for an unknown, used or expired code (codes last 10 minutes and work once);
    - `400 invalid_grant` for a wrong `code_verifier`;
    - `400 invalid_grant` for a revoked or refused refresh token;
    - `401 invalid_client` for a wrong client secret;
    - `400 invalid_request` for a missing parameter;
    - `scope` lists only the ticked scopes;
    - `refresh_token` is given only with `access_type=offline`;
    - access tokens last 3600 s, and revoking a refresh token kills its access tokens (Gmail `401`);
    - `revoke` answers `200`, or `400 invalid_token` for an unknown token;
    - the certs answer is a JWK set with `kid`, `kty: "RSA"`, `alg: "RS256"`, `n`, `e` and `cache-control: max-age`.
  - Tests in `tests/unit/gmail-fake-oauth.test.ts` check each of these against the fake.
- [x] T012 [P] [US1] Supabase Postgres has no public schema on GitHub (Supabase's "Connect to your database" page,
  https://supabase.com/docs/guides/database/connecting-to-postgres). The tests use the real local PostgreSQL 17 and
  copy the transaction-mode pooler's limits: `prepare: false`, `max: 5`, no session state. Extend the session-state
  scan in `tests/integration/migrate.test.ts` to `src/server/gmail/*.ts`.
- [x] T013 [US1] Write `src/server/gmail/fake-gmail.ts`: `FakeGoogleMail` with `MemoryStore` (tests) and `DiskStore`
  (`.fake-gmail/state.json`, development), and `fakeGmail()` returning the instance for the current mode (research.md
  §14, contracts/google.md § Fake).
  - Its `fetch` answers the token, revoke, certs and Gmail URLs of contracts/google.md § Calls.
  - Its state covers mailboxes, a history log with rising ids, codes, tokens with scopes, watches, and an RSA key.
  - Switches: `down()`, `refuseKey(email)`, `failWatch(on)`, `forgetHistory()`, `advance(ms)`, `requests`,
    `mailbox(email)`, `tokenStatus(token)`.
  - Make T010 and T011 pass.
- [x] T014 [P] [US1] Integration tests `tests/integration/gmail-connect.test.ts`, through the settings actions and the
  callback route handler, with `GmailFake`:
  - US1 scenario 1: `gmailSettings` gives `not connected`, and the layout's `warn` is false;
  - US1 scenario 2: connect → `working`, `email`, `last_synced_at` null, 0 conversations; the fake has an active watch
    on the configured topic; the flash is `gmail_connected`;
  - US1 scenario 3: `error=access_denied`, or a `state` that does not match → nothing stored, `?gmail=not_connected`;
  - US1 scenario 4: another account → nothing stored, the `gmail_wrong_account` template with the user's sign-in
    address, and the new token revoked at the fake;
  - US1 scenario 5: one scope unticked → `missing_scopes`, nothing stored, the token revoked;
  - FR-002: a callback whose cookie was made for another user, or with no cookie, is refused;
  - Edge case "Connecting twice": a second connect leaves one row, and the old refresh token is revoked at the fake;
  - Edge case "Gmail not set up": mode `off` → `gmail_unavailable`, and `startGmailConnect` refuses;
  - SC-004: after a connect, the refresh token is not found in any text or bytea column of any table (search with
    `encode(token_cipher,'escape')` and every text column), in the rendered `/settings` HTML, in any message, or in the
    captured `console.*` output.
- [x] T015 [P] [US1] Unit test `tests/unit/proxy-matcher.test.ts` (extend): `/gmail/push`, `/cron/gmail`,
  `/dev/fake-google/gmail` and `/dev/fake-gmail` are public. `/settings` and `/settings/gmail/callback` redirect to
  sign-in without a session.

### Implementation for User Story 1

- [x] T016 [US1] Write `src/server/gmail/google-api.ts` (contracts/google.md § Calls; research.md §1, §2): each call is
  one `fetch` with `AbortSignal.timeout(10_000)`.
  - `consentUrl({ state, codeChallenge, loginHint })`, with the parameters of research.md §2 and the fake consent URL
    `${appBaseUrl()}/dev/fake-google/gmail` in fake mode.
  - The calls: `exchangeGmailCode`, `refreshAccessToken`, `revokeToken`, `getProfile`, `watch`, `stopWatch`,
    `listHistory`, `listMessages`, `getMessage`, `getThreadMetadata`, `sendRaw`.
  - Errors `GoogleKeyRefused`, `GoogleUnavailable` and `HistoryGone`, through `classifyGoogleError`. Their messages
    hold only the status and the `error` code.
  - `useGmailFetchForTests(fn)` throws outside `APP_ENV=test`.
  - Fake mode uses `fakeGmail().fetch`, copied from `src/server/files/storage.ts`.
- [x] T017 [US1] Write `src/server/gmail/connections.ts` (data-model.md § State changes; research.md §3, §4, §11):
  - `gmailSettings(userId)`: never selects `token_cipher`. Count = `count(*) from email_threads where connection_id`.
  - `gmailNeedsReconnect(userId)`.
  - `finishConnect(userId, { refreshToken, scope, profile })`: one `sql.begin()` upsert on `user_id`.
    - From no row or `disconnected`: `connected_at = now`, and `history_id = profile.historyId`.
    - From `needs_reconnect`: keep `connected_at`, `history_id` and `last_synced_at`, and return `reconnected`.
    - From `working`: return the old cipher to revoke after commit.
    - After commit, call `watch` and set `watch_renewed_at` and `watch_expires_at`. A watch failure keeps the
      connection working.
  - `loadKey(connectionId)`: the only function that selects `token_cipher`.
  - `markNeedsReconnect(connectionId)`: `where state = 'working'`.
- [x] T018 [US1] Add `startGmailConnect` to SF-117's `src/app/(app)/settings/actions.ts` (`requireUser()` first). It sets the
  cookie `crm_gmail_oauth` `{ state, verifier, userId }` (httpOnly, SameSite=Lax, path `/settings/gmail`, maxAge 600,
  secure on https) and redirects to `consentUrl`.
- [x] T019 [US1] Write `src/app/(app)/settings/gmail/callback/route.ts` (research.md §3): the 7 steps in order. Every
  refusal after the code exchange revokes the new token. The cookie is always cleared. It answers with a 303 to
  `/settings`: `setFlash` for `gmail_connected` / `gmail_reconnected`, and `?gmail=<code>` for errors.
- [x] T020 [US1] Write `src/app/(app)/settings/GmailCard.tsx` and render it in SF-117's `src/app/(app)/settings/page.tsx`
  after `<PipedriveSection>` (contracts/routes.md § Gmail card, design B in `design-options.html`):
  - keep SF-117's page head (`// YOU` / "Settings") and its Pipedrive section and query parameters unchanged;
  - the card states for off, not connected, working and needs reconnecting;
  - green `.dot` or red `.dot.bad` in the heading, with the buttons on the right;
  - times through `src/server/format.ts`;
  - `?gmail=` read only from the fixed code list.
  Add the `.dot`, `.dot.bad`, card heading and `.warn` styles to `src/app/globals.css`, with existing variables
  (`--green` or the nearest, `--danger`, `--orange`).
- [x] T021 [US1] Sidebar:
  - `src/app/(app)/nav.ts`: unchanged; SF-117's `footerNav` "Settings" link is the one that gets the "!";
  - `src/app/(app)/SidebarLink.tsx`: a `warn?: boolean` prop renders `<span className="warn">!</span>`, with
    `aria-label` from `messages.gmail_settings_warn`;
  - `src/app/(app)/notifications/actions.ts`: `currentUnread` becomes `currentSidebar()` → `{ unread, gmailWarn }`;
  - `src/app/(app)/UnreadLink.tsx`: generalised into the client part that keeps both the Notifications count and the
    Settings "!" up to date after client navigation (research.md §13);
  - `src/app/(app)/layout.tsx`: passes `gmailNeedsReconnect(user.id)` as the start value, and renders the footer
    Settings link (bottom of the sidebar, above `[ SIGN OUT ]`) with `warn`. Exactly one "Settings" link.
  Update the SF-108 tests that import `currentUnread`.
- [x] T022 [US1] Write the fake consent screen `src/app/dev/fake-google/gmail/page.tsx` and its `actions.ts`
  (research.md §14):
  - an account field pre-filled from `login_hint`;
  - two ticked boxes, "Read, change and send your email" (`gmail.modify`) and "Send email as you" (`gmail.send`);
  - `[ ALLOW ]` makes a code in `fakeGmail()` and redirects to `redirect_uri` with `code` and `state`;
  - `[ CANCEL ]` redirects with `error=access_denied`;
  - `notFound()` unless `isFakeAllowed()` and the mode is `fake`;
  - `redirect_uri` must start with `${appBaseUrl()}/settings/gmail/callback`.
- [x] T023 [US1] Add `/^\/dev\/fake-google\/gmail\/?$/`, `/^\/dev\/fake-gmail\/?$/`, `/^\/gmail\/push\/?$/` and
  `/^\/cron\/gmail\/?$/` to `PUBLIC` in `src/proxy.ts`, and update its head comment. Make T014 and T015 pass.

**Checkpoint**: US1 works on its own: connect, refusals, the Settings card and the sidebar link.

---

## Phase 4: User Story 2 - Conversations with CRM people are copied as they happen (Priority: P1)

**Goal**: Push notices and the 15-minute check copy the right messages exactly once.

**Independent Test**: The spec's mailbox (a)-(d), with notices delivered or dropped, plus the check. Exactly (a) and
(b) are copied once, and the count is right.

### Tests for User Story 2

- [x] T024 [US2] Download `pubsub-api.json` from
  https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/pubsub/v1/pubsub-api.json
  at commit `3f740bc15212818d4d0eb041b02c951457ff63fa` into `.factory/schemas/`:

  ```
  git init -q /tmp/google-api-go-client && git -C /tmp/google-api-go-client fetch -q --depth 1 https://github.com/googleapis/google-api-go-client 3f740bc15212818d4d0eb041b02c951457ff63fa && git -C /tmp/google-api-go-client show FETCH_HEAD:pubsub/v1/pubsub-api.json > .factory/schemas/pubsub-api.json
  ```

  Skip `git init` when `/tmp/google-api-go-client` already exists. Then make the fake of Cloud Pub/Sub refuse a request
  that the schema refuses. A test sends a wrong field and must fail.
  - In `tests/fakes/gmail.ts`, every push body the fake builds (`deliver(email)`) is checked: the `message` properties
    must be declared in `PubsubMessage` (`attributes`, `data`, `messageId`, `orderingKey`, `publishTime`), with
    `data` base64. The wrapper is `{ message, subscription }`.
  - In `tests/unit/gmail-fake-schema.test.ts`, assert that a push body with `message.payload` instead of
    `message.data` makes the test fail.
- [x] T025 [P] [US2] Unit tests `tests/unit/gmail-push.test.ts` for `verifyPushToken` (research.md §6; FR-008,
  FR-015, edge case "Notices not from Google"). With tokens signed by the fake's key, each of these is refused:
  - `alg` other than RS256;
  - an unknown `kid` (with exactly one certs fetch again);
  - a bad signature;
  - a wrong `iss`, `aud` or `email`;
  - `email_verified` false;
  - an expired token;
  - `iat` more than 1 h old;
  - a missing `Authorization`.
  A good token is accepted. The JWKS is cached by `max-age`.
- [x] T026 [P] [US2] Integration tests `tests/integration/gmail-sync.test.ts` with `GmailFake`. Linus Fake is
  connected; the person has `ana@example.test` and `ana.k@example.test`. Cover:
  - US2 scenario 1: a message from `ana.k@example.test` with 2 attachments, delivered → 1 conversation;
    `last_synced_at` set; 2 attachment rows;
  - US2 scenario 2: a message sent to `ana@example.test` (label SENT) → 2, `direction` `sent`;
  - US2 scenario 3: a newsletter, or mail between teammates only → count unchanged, `last_synced_at` moved;
  - US2 scenario 4: a teammate-only reply in a copied thread → the message is stored, the count is unchanged;
  - US2 scenario 5: notice dropped, then `runGmailCheck` → +1; the same notice delivered again → unchanged;
  - US2 scenario 6: a message with `internalDate` 1 day before `connected_at` → not copied;
  - US2 scenario 7: a 20 MB `contract.pdf` → the name and 20971520 stored, no contents column, no `attachments.get`
    call in `requests`;
  - edge cases:
    - a person added later;
    - `ANA@Example.test ` matches, and a display name "Ana Fake" alone does not;
    - private and archived people match, and a deleted person no longer does;
    - two connected teammates each count 1, with the same `rfc_message_id`;
    - DRAFT, SPAM and TRASH are skipped, and moving a copied message to the bin keeps the count;
    - large catch-up: `forgetHistory()`, 600 matching messages, `runGmailCheck` run until done → all copied once;
    - an HTML-only message is copied;
    - a nameless attachment is stored as `(no name)`;
  - the renewal edge case: `failWatch(true)` → the check still copies, the state stays `working`, and the renewal is
    retried on the next check;
  - FR-011: two `syncConnection` calls at once → one copies, the other returns `busy` with `sync_again` set, and every
    message is stored once;
  - push route (`receiveGmailPush`):
    - a bad proof → 403, nothing changed;
    - a bad body → 400;
    - an unknown address, or a non-working connection → 204, nothing changed;
  - cron route: no `Authorization` or a wrong one → 401, empty body; a right one → 204 and the sync done.

### Implementation for User Story 2

- [x] T027 [US2] Write `src/server/gmail/push.ts` (research.md §6): `verifyPushToken` with `node:crypto` (`createPublicKey`
  with `format: "jwk"`, `crypto.verify("sha256", …)`), the JWKS cache from `max-age` (at most 1 h), and
  `receiveGmailPush(authorization, body)` → `{ status }`. In the fake, add `deliver(email)` / `dropNotice()`, which
  sign with the fake key. Make T025 pass.
- [x] T028 [US2] Write `src/server/gmail/sync.ts` (research.md §8, data-model.md § Copy rules):
  - `syncConnection(connectionId, now)`:
    - the lease update (2 minutes) and `sync_again`;
    - refresh the access token;
    - `history.list` pages with `historyTypes=messageAdded` and `maxResults=500`;
    - on `HistoryGone`: `getProfile` first, then `messages.list` with `q=after:` (last sync, or `connected_at`, minus
      1 h) and `includeSpamTrash=false`;
    - drop the ids already stored (one query), then `getMessage` `format=full` for at most 300 per run;
    - one `person_emails` query per batch, `decideCopy`, and one `sql.begin()` per stored message (thread upsert,
      message `on conflict do nothing`, attachments);
    - finish by setting `history_id = greatest(…)` and `last_synced_at`, clearing the lease, and looping while
      `sync_again`;
    - on `GoogleKeyRefused`, `markNeedsReconnect`.
  - `runGmailCheck(now)`: working connections, oldest `last_synced_at` first. Sync each, then renew the watch when
    `watch_renewed_at` is null or older than 20 h. Stop starting new connections after 240 s.
- [x] T029 [US2] Write the routes:
  - `src/app/gmail/push/route.ts` (POST, `maxDuration = 60`, `receiveGmailPush`, empty bodies);
  - `src/app/cron/gmail/route.ts` (GET, `maxDuration = 300`; `CRON_SECRET` compared with `crypto.timingSafeEqual` on
    the SHA-256 of both values; 401/204, empty bodies);
  - `vercel.json`: `{ "crons": [{ "path": "/cron/gmail", "schedule": "*/15 * * * *" }] }`.
  In mode `off`, both answer 204 and do nothing. Make T026 pass.
- [x] T030 [US2] Write the fake mailbox page `src/app/dev/fake-gmail/page.tsx` and its `actions.ts` (research.md §14,
  FR-018):
  - pick a user;
  - a message form:
    - received or sent;
    - from, to, cc, bcc, subject, text, HTML;
    - attachments as `name:size` lines;
    - a date offset in minutes;
    - label INBOX/SPAM/DRAFT/TRASH;
    - a new thread or an existing one;
    - "Deliver its notice";
  - `[ RUN THE 15-MINUTE CHECK ]` (calls `runGmailCheck`);
  - `[ REFUSE THE KEY ]`, `[ FAIL RENEWALS ]` and `[ FORGET HISTORY ]`;
  - the list of the mailbox's messages with their labels, and the key and watch status;
  - `notFound()` unless `isFakeAllowed()` and the mode is `fake`.

**Checkpoint**: US1 and US2 work: a connected user's CRM conversations are copied once.

---

## Phase 5: User Story 3 - Send an email from my Gmail (Priority: P1)

**Goal**: `sendGmail` and `[ SEND ME A TEST EMAIL ]`.

**Independent Test**: Press the button. The fake mailbox has one message from and to the user, with the fixed subject,
in SENT and INBOX. Make the fake refuse, and see the failure message.

### Tests for User Story 3

- [x] T031 [P] [US3] Integration tests `tests/integration/gmail-send.test.ts` with `GmailFake`:
  - US3 scenario 1: `sendTestEmail` → one `messages.send` whose decoded `raw` has `From` and `To` = the user,
    `Subject: Barnacle CRM test email` and the `gmail_test_text` text; the fake mailbox has it with SENT and INBOX; the
    flash is the `gmail_test_sent` template;
  - US3 scenario 2: `down()`, or a 500 → `?gmail=test_failed`, the state unchanged, nothing sent;
  - US3 scenario 3: `sendGmail` with `to`, `cc`, `subject`, `text`, `html` and a `threadId` →
    - the result is `{ messageId, threadId }` from the fake;
    - `threads.get` was read with `format=metadata`;
    - the `raw` has `In-Reply-To` and `References`;
    - the fake stored it in that thread;
  - US3 scenario 3: with no connection → `GmailNotConnected`, and no Google call in `requests`;
  - US3 scenario 4: after a test email, `runGmailCheck` → the count is unchanged;
  - `refuseKey` then send → `GmailNeedsReconnect` and the state `needs_reconnect` (FR-006);
  - a subject with CR/LF → refused, nothing sent.

### Implementation for User Story 3

- [x] T032 [US3] Write `src/server/gmail/send.ts` (research.md §10): `sendGmail(userId, input)` →
  `{ messageId, threadId }`.
  - It refuses before any network call (`GmailNotConnected`, `GmailNeedsReconnect`).
  - It uses `buildMime`, base64url `raw` and `sendRaw`.
  - With a `threadId`, it reads `getThreadMetadata` first.
  - `GoogleKeyRefused` → `markNeedsReconnect` + `GmailNeedsReconnect`; other failures → `GmailUnavailable`.
  In the fake, `messages.send` puts the message in the sender's mailbox with SENT, and with INBOX when it is addressed
  to self.
- [x] T033 [US3] Add `sendTestEmail` to `src/app/(app)/settings/actions.ts` (`requireUser()` first): `testEmail(address)`
  through `sendGmail`, then the flash `gmail_test_sent` or `?gmail=test_failed`. In `GmailCard.tsx`,
  `[ SEND ME A TEST EMAIL ]` is shown only when `working`. Make T031 pass.

**Checkpoint**: US1-US3 work.

---

## Phase 6: User Story 4 - Disconnect, and reconnect when Google stops accepting the key (Priority: P2)

**Goal**: Disconnect forgets the key. A refused key shows the reconnect state and the "!", and reconnecting carries
on.

**Independent Test**: Connect, then disconnect: the key is gone and the fake's watch is stopped. Connect, refuse the
key, run the check: the reconnect state shows. Reconnect: a new message is copied.

### Tests for User Story 4

- [x] T034 [P] [US4] Integration tests `tests/integration/gmail-disconnect.test.ts` with `GmailFake`:
  - US4 scenario 1: `disconnectGmail` →
    - `state` `disconnected`, `token_cipher` null, watch fields null;
    - the fake shows `stop` called and the token revoked;
    - the flash is `gmail_disconnected`;
    - the conversations remain;
    - a delivered notice for the address afterwards → 204, nothing copied;
  - FR-005: with `down()`, disconnect still forgets the key;
  - US4 scenario 2: `refuseKey`, then each of `runGmailCheck` (sync), the renewal, and `sendGmail` →
    - `needs_reconnect`;
    - `last_synced_at` and the count unchanged;
    - `gmailNeedsReconnect` true;
    - the rendered layout has the Settings `.warn` "!", and `currentSidebar()` returns `gmailWarn: true`;
    - the card shows the `gmail_needs_reconnect` template, `[ RECONNECT GMAIL ]` and `[ DISCONNECT ]`, and no test
      button;
    - a later check does not sync it;
  - US4 scenario 3: with 37 seeded conversations, reconnect →
    - flash `gmail_reconnected`, `connected_at` kept, still 37;
    - `gmailWarn` false;
    - a new message in a new thread → 38;
    - a message already copied before, reported again → still 38;
    - a message that arrived while it needed reconnecting (after the last sync) is copied;
  - US4 scenario 4: `sendGmail` while `needs_reconnect` → `GmailNeedsReconnect`, no Google call;
  - `markNeedsReconnect` after a disconnect does not bring the row back;
  - edge case "Deactivated user": an admin deactivates Linus →
    - `disconnected`, `token_cipher` null;
    - the fake shows the token revoked and the watch stopped;
    - reactivated → `gmailSettings` is not connected;
  - disconnect then connect again → a new `connected_at`; the old conversations stay counted; mail in the gap is not
    copied (spec.md § Clarifications, Plan 2026-11-24).

### Implementation for User Story 4

- [x] T035 [US4] In `src/server/gmail/connections.ts`, add:
  - `disconnect(userId)`: one transaction takes the cipher and sets `disconnected` with the nulls of data-model.md;
    after commit, best effort: refresh → `stopWatch` → `revokeToken`, with errors ignored;
  - `forgetGmailInTx(db, userId)`, which returns the cipher;
  - `afterGmailForgotten(userId, cipher)`, which does the same Google calls.
- [x] T036 [US4] Add `disconnectGmail` to SF-117's `src/app/(app)/settings/actions.ts` (`requireUser()` first). In
  `src/app/(app)/settings/page.tsx`, `?disconnect=1` opens the confirmation box with `gmail_disconnect_confirm`,
  `[ DISCONNECT ]` (red) and `[ CANCEL ]`, reusing the existing delete-confirm look. `[ RECONNECT GMAIL ]` posts
  `startGmailConnect`.
- [x] T037 [US4] In `src/server/users.ts`, `deactivate` calls `forgetGmailInTx` inside its `asAdmin` transaction, beside
  SF-117's `deleteConnection`. In
  `src/app/(app)/admin/users/actions.ts`, `deactivate` calls `afterGmailForgotten` after the change succeeds. Make T034
  pass, and keep the existing users tests green.

**Checkpoint**: all four stories work.

---

## Phase 7: Polish & cross-cutting concerns

- [x] T038 [P] Write the fake data `src/seed/gmail.ts` (data-model.md § Fake data, FR-019): Ada Fake `ada@barnacle.ai`
  gets a working connection through `FakeGoogleMail`.
  - Three conversations with fake people from `src/seed/people.ts`:
    - "Fake proposal": received, then sent; `proposal-fake.pdf` 250880 bytes;
    - "Fake intro call": received; `logo-fake.png` 18432 bytes and `notes-fake.txt` 1024 bytes;
    - "Fake follow-up": sent.
  - They are put into the fake mailbox after `connected_at` and copied by `syncConnection`.
  - With real settings it prints "Gmail fake data skipped (real Gmail settings)."
  - With Gmail mode `off` (no valid `GMAIL_TOKEN_KEY`) it prints "Gmail fake data skipped (GMAIL_TOKEN_KEY not set)."
  - Register it in `src/seed/index.ts` after `deals`, with a `// SF-118` comment.
  - Test in `tests/integration/seed.test.ts` that running it twice leaves 3 conversations and no duplicates.
- [x] T039 [P] Update `README.md`:
  - the Settings table: the six settings of contracts/google.md § Settings;
  - a "Gmail" section with the Google Cloud setup steps of contracts/google.md, the fake used when
    `GMAIL_PUBSUB_TOPIC` is empty in development/test, `/dev/fake-gmail`, the Vercel Pro cron and the scopes;
  - the `npm run test:schemas` line.
- [x] T040 [P] Update `AGENTS.md` § Layout:
  - `src/server/crypto/seal.ts` (shared token sealing, one key per service);
  - `src/server/gmail/` (`rules.ts`, `google-api.ts`, `push.ts`, `connections.ts`, `sync.ts`, `send.ts`,
    `fake-gmail.ts`);
  - "only `loadKey` reads `token_cipher`; no Google call inside `sql.begin()`";
  - `src/app/(app)/settings/`, `src/app/gmail/push`, `src/app/cron/gmail`, `vercel.json`, `src/app/dev/fake-gmail`
    and `src/app/dev/fake-google/gmail`;
  - `tests/fakes/gmail.ts`, checked against `gmail-api.json` and `pubsub-api.json`;
  - the `gmail` seeder.
- [x] T041 [P] Add to the end of `docs/DECISIONS.md` one line per choice of spec.md § Clarifications:
  - "Gmail settings use design B: a Gmail card on the Settings page after Pipedrive, and an orange "!" on the one
    Settings link on every page while Gmail needs reconnecting (SF-118)";
  - "Saved tokens of outside services are sealed by one shared AES-256-GCM module, each service with its own key
    (PIPEDRIVE_TOKEN_KEY, GMAIL_TOKEN_KEY) (SF-118)";
  - "Emails copied from a user's Gmail are kept when they disconnect or are deactivated (SF-118)";
  - "The 15-minute Gmail check and the daily renewal of Gmail notices run as one Vercel cron job every 15 minutes, on
    the Vercel Pro plan (SF-118)";
  - "Gmail asks for gmail.modify and gmail.send, so the later Inbox can mark mail read and change labels without
    every user reconnecting (SF-118)";
  - "After a disconnect, copying starts again from the new connection; after a reconnect from "needs reconnecting",
    sync carries on from the last successful sync (SF-118)";
  - "Gmail copying uses the time Gmail received or sent a message, not the sender's Date line (SF-118)";
  - "Deactivating a user also cancels their Gmail access at Google (SF-118)".

  No "Departs from blueprint" line (no blueprint applies).
- [x] T042 Run `npm run test:schemas && npm test && npm run typecheck` with `APP_ENV=test` and
  `DATABASE_URL=postgres://postgres@localhost:5432/crm_test`. Fix any failure. Every test file has its `// covers`
  line.
- [x] T043 Check SC-004 across the codebase: grep `src/` for `console.` in `src/server/gmail/` and the new routes, and
  confirm no token, cipher or Google body is logged; confirm `token_cipher` is selected only in `loadKey`
  (`grep -rn token_cipher src/`).
- [x] T044 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its
  schema) and `## Schemas` (each schema's GitHub URL at its commit).
  - Gmail API: fake `src/server/gmail/fake-gmail.ts`, wrapped by `tests/fakes/gmail.ts`; schema `gmail-api.json`.
  - Cloud Pub/Sub push: the same fake's `deliver`; schema `pubsub-api.json` (`PubsubMessage`).
  - Google OAuth token, revoke and certs: the same fake; no schema, following Google's OAuth web-server and
    push-authentication pages and RFC 6749/7009/7517.
  - Supabase Postgres: the real local PostgreSQL 17; no schema.
  - Keep the existing lines (Google Sign-In, Supabase Storage).
  - `## Schemas`: the URLs of `oauth2-api.json`, `storage_v0_openapi.json`, `gmail-api.json` and `pubsub-api.json`
    at their commits.

## Fix round 1 (AI review: the fake consent screen never connects)

- [ ] T045 Test first, in `tests/integration/gmail-dev-fake.test.ts` (`// covers SF-118 FR-018, FR-002, US1 scenarios
  2-5, US4 scenario 3, plan.md Fix round 1`): render the consent page and check both buttons submit a plain form to
  `/dev/fake-google/gmail/answer` with `method="post"` (no server action); `POST` the allow form (as
  `application/x-www-form-urlencoded`) to the route's handler and check 303 with `Location` = the callback with
  `code` and the same `state`; then call the callback with only the cookies a browser sends to that path (the
  `crm_gmail_oauth` cookie set by `startGmailConnect`, path `/settings/gmail`, so sent) and check Linus is connected
  and the answer goes to `/settings` with the connected notice. Also: cancel → 303 with `error=access_denied` →
  `?gmail=not_connected`; one box unticked → the callback gives the missing-permissions notice; another account →
  the wrong-account notice; the route answers 404 outside fake mode and for any other `redirect_uri`. Replace the
  calls to `allowFakeGmail` / `cancelFakeGmail`. See it fail before T046.
- [ ] T046 Add `src/app/dev/fake-google/gmail/answer/route.ts` (`POST`, `dynamic = "force-dynamic"`): the checks of
  today's `callback()` (404 unless `isFakeAllowed()` and `gmailConfig().mode === "fake"`, 404 unless `redirect_uri`
  is exactly `${appBaseUrl()}/settings/gmail/callback`); `decision=allow` → `fakeGmail().consent(...)` with the same
  fields as today and `code` on the callback; `decision=cancel` → `error=access_denied`; any other decision → 404;
  `state` added in both; answer `NextResponse.redirect(url, 303)`. Point the two forms of
  `src/app/dev/fake-google/gmail/page.tsx` at it (`action="/dev/fake-google/gmail/answer" method="post"`, the button
  pressed as `decision`), keep the page's text and fields, and delete `src/app/dev/fake-google/gmail/actions.ts`.
  Update the fake consent screen line in `AGENTS.md` if it names the actions.
- [ ] T047 Run `npm run test:schemas && npm test && npm run typecheck` with `APP_ENV=test` and
  `DATABASE_URL=postgres://postgres@localhost:5432/crm_test`; then, with `npm run dev`, press `[ CONNECT GMAIL ]` and
  `[ ALLOW ]` in a browser and see "Gmail connected." on Settings. Update `.factory/test-env.md` only if it names the
  consent screen's actions.

---

## Dependencies & Execution Order

- **Setup (T000-T004)**: T000 first; then T002-T004 [P].
- **Foundational (T005-T009)**: after Setup. T005/T006 [P], then T007. T008 and T009 after T001.
- **US1 (T010-T023)**: after Foundational.
  - T010 needs T013 (write T010's checks, see them fail, then T013).
  - T016 → T017 → T018/T019 → T020/T021.
  - T022 and T023 are independent of T020/T021.
- **US2 (T024-T030)**: after US1 (a connection is needed). T027 → T028 → T029 → T030.
- **US3 (T031-T033)**: after US1. It can run beside US2 except for the shared `actions.ts` and `GmailCard.tsx`.
- **US4 (T034-T037)**: after US1 and US2 (the reconnect scenarios use sync) and US3 (a send that finds the key
  refused).
- **Polish (T038-T044)**: after all the stories. T044 is the last task.
- **Fix round 1 (T045-T047)**: T045 → T046 → T047.

## Parallel examples

- Setup: T002, T003 and T004 together.
- Foundational: T005 and T006 together.
- US1: T011, T012, T014 and T015 together (after T010/T013 for the fake).
- US2: T025 and T026 together, after T024.
- Polish: T038, T039, T040 and T041 together.

## Implementation strategy

1. **MVP**: Setup + Foundational + US1. A user can connect and see the Gmail card, with the key encrypted.
2. Add US2 (sync): this is the value of the issue.
3. Add US3 (send) and US4 (disconnect, reconnect).
4. Polish: fake data, docs, decisions, the full test run, then the test recipe last.
