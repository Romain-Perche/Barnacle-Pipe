# Research: Write an email from a deal or contact (SF-129)

Every point below was settled by reading the repo (SF-116 files, SF-118 Gmail, SF-102/SF-109 timeline, SF-124 `soon.ts`)
and the pinned Google and Supabase schemas. There is nothing left as NEEDS CLARIFICATION.

## §1 How the email reaches Gmail: the upload endpoint, `message/rfc822`

- **Decision**: `sendGmail` (SF-118, `src/server/gmail/send.ts`) stays the only way to send. It gains attachments and
  sends a message without `threadId` with Gmail's **simple media upload**:
  `POST https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media`, `Content-Type:
  message/rfc822`, body = the RFC 5322 bytes (not base64url, not JSON). The answer is the `Message` resource (`id`,
  `threadId`). With a `threadId` (the Settings test email never has one, replies are a later issue) the existing JSON
  `{ raw, threadId }` call stays as it is.
- **Rationale**: the pinned discovery document (`gmail-api.json` @ 3f740bc) gives `users.messages.send`
  `"supportsMediaUpload": true`, `mediaUpload.accept: ["message/*"]`, `maxSize: "36700160"` (35 MiB) and the simple path
  `/upload/gmail/v1/users/{userId}/messages/send`. The metadata-only JSON call is limited by Google's request size for
  non-upload calls (a few MB), far under 25 MB of files. 25 MiB of files (26,214,400 bytes, `MAX_FILE_BYTES` of SF-116)
  in base64 with CRLF every 76 characters is 35,872,336 bytes; a 100,000-character text (at most 400,000 UTF-8 bytes,
  540,540 in base64) and the headers keep the message under 36,700,160. `sendGmail` still checks the built message's
  length against `MAX_RAW_BYTES = 36_700_160` before calling Google and throws `GmailTooLarge` (shown as the 25 MB
  message), so a message Google would refuse is never sent.
- **Time-outs**: `google-api.ts`'s `call` keeps 10 s for every other call; the upload uses its own 40 s time-out
  (`SEND_TIMEOUT_MS`). The pages that hold the email box export `maxDuration = 60` (Vercel; SF-117 already does so).
- **Alternatives**: resumable upload (two requests, only worth it above 5 MB on unreliable links; the fake and the code
  double); JSON `raw` for every size (refused above Google's metadata limit).

## §2 Files chosen from the computer go to Storage first, never through the app

- **Decision**: a file from the computer is sent by the browser straight to Supabase Storage with a signed upload
  address, exactly as `[ ADD FILE ]` does (SF-116 `AddFiles.tsx`: `startFileUpload` → PUT with progress). A new table
  `email_uploads` holds the path, name, size, type and owner; the path is queued in `file_cleanup` at once with `due_at`
  = now + 24 h, so it is removed even when the email is never sent; after a send the CRM sets those paths due now.
  `sweepFileCleanup` (already run after every file action) does the removal: no cron, no new sweeper.
- **Rationale**: the server action body limit is 4 MB (`next.config.ts`) and Vercel refuses request bodies over 4.5 MB,
  so 25 MB cannot pass through a server action. Storage already holds and cleans the record files with this exact
  flow. The spec (clarified) keeps computer files out of `// FILES`: `email_uploads` is separate from `file_uploads` /
  `files`.
- **Alternatives**: send the bytes in parts through server actions like the CSV import (512 KiB parts) — 50 round trips
  for 25 MB and the parts held in Postgres; rejected.

## §3 Reading the attachments' bytes

- **Decision**: new `readObject(path, size)` in `src/server/files/storage.ts`: `GET /object/authenticated/{bucket}/{path}`
  (the same route `readHead` uses with a Range header; in the pinned `storage_v0_openapi.json`), 30 s time-out, returns
  the bytes, `null` on 400/404, `StorageUnreachable` on a network error / 5xx. The bytes must be exactly the stored
  size (`files.size` / `email_uploads.size`) — anything else counts as "no longer there". All files are read one after
  the other before the Gmail call, never inside `sql.begin()`.
- **Type and name sent**: a record file is sent with `files.name` and `files.content_type` (FR-013); a computer file with
  the name and type the browser gave, the type checked by `uploadContentType(name)` (SF-116) when the browser gives
  none.

## §4 Recording the email, once, even with the Gmail sync running

- **Decision**: the sent email is stored in SF-118's own tables at send time — `email_threads` (`on conflict
  (connection_id, gmail_thread_id) do nothing`), `email_messages` (`direction = 'sent'`, the Gmail ids returned by the
  send, `on conflict (connection_id, gmail_message_id) do nothing`, then the existing row's id), `email_attachments`
  (name, type, size; only when the message row was new) — plus the new `email_links` rows, in **one** transaction
  (`recordSent`). The sync's `runOnce` already skips Gmail ids it has (`stored` set), and the settings count is
  `count(*) from email_threads`, so the email and its conversation are counted once (FR-016) with no change to the sync's
  copy rules. A sync that stored the message first (a fast push notice) is fine: `recordSent` adds only the links.
- **A ledger row before the Google call**: `email_sends` (one per user and `send_key`, a UUID the box makes when it
  opens). Inserted (`on conflict do nothing`) before anything is downloaded or sent: a second press, a resubmission or a
  second tab with the same box finds the row and sends nothing (FR-010). When the send fails before Gmail accepted it
  (Gmail unavailable, key refused, an attachment gone, Storage unreachable) the row is deleted, so `[ SEND ]` on the same
  box can try again.
- **"Sent but not recorded"** (spec edge case): right after Gmail's answer the CRM stores the Gmail ids on the ledger row
  (one small `update`, its own statement), then runs `recordSent`. When `recordSent` fails, the user still sees "Email
  sent to …", and `runAfterResponse` (SF-124 `soon.ts`) starts `syncConnection` for the connection. In the sync,
  `storeMessage`'s transaction calls the shared `completePendingSend(tx, connectionId, message)`: a `sending` ledger row
  of that connection with the same `gmail_message_id` (or, when even the id update failed, the same `rfc_message_id`,
  the CRM's own `Message-ID: <crm-<24 hex>@barnacle.ai>`) gets its links and Last contacted exactly like `recordSent`.
  The sync only copies messages with a CRM address (DECISIONS 2026-11-24), which is what the spec asks ("shows once on
  the timelines of the CRM people it went to"). Both paths lock the ledger row `for update` and use `on conflict do
  nothing`, so they can run in either order. Test hook: `onRecordSentForTests` (tests only), like `onSaveForTests`.
- **Alternatives**: recognise CRM mail in the sync by a custom header (leaks the record to recipients); an outbox table
  with the whole email (duplicates SF-118's tables).

## §5 Links and who sees an EMAIL entry

- **Decision**: `email_links` (one row per message and record): the record it was written from (`how = 'written_from'`,
  a deal, a person or an organisation) and each CRM person with any address in To/Cc/Bcc (`how = 'recipient'`; a
  person both written from and written to keeps one row, `written_from`). Recipients are found with `person_emails.email
  = any(<addresses, lower-cased>)` — every person, archived and private ones included (FR-015).
- **Timeline** (`readTimeline`, a third source next to done activities, SF-109 §3 pattern): deal → links to that deal;
  person → links to the person, or to a deal the person is linked to (main or other person) and the viewer can see;
  organisation → links to the organisation, or to its deals the viewer can see. Each message once
  (`exists (select 1 from email_links …)` on `email_messages m`). Ambassador latest updates do not show emails (they do
  not show activities either).
- **Visibility**: new `visibleEmail(db, viewer, alias = "m")` in `src/server/records/visibility.ts`: no link of the message
  to a deal the viewer cannot see (`visibleDeal`) and no link to a person the viewer cannot see (`visiblePerson`);
  organisations are never private. Every `email_links` / sent-email read for a viewer uses it (FR-018, DECISIONS
  2026-11-24). A deleted deal or person drops its links (`on delete cascade`): the email then shows on the remaining
  records.
- **Sender**: `email_messages.connection_id → gmail_connections.user_id → users.name` (a deactivated user keeps their
  name; "(deactivated)" follows the timeline's `authorActive` rule).

## §6 The box: where it opens and how it keeps what was typed

- **Decision**: the box opens from the page address, like SF-109's boxes: `?email=new` on `/deals/<id>`, `/people/<id>`,
  `/organisations/<id>` and on the board with the drawer open (`/deals?…&deal=<id>&email=new`). `[ WRITE EMAIL ]` is a
  plain link in the // TIMELINE heading (not on archived records). A server component `EmailOverlay.tsx` reads what the
  box needs (connection state, From, the To to fill, the record's files) and renders the client `EmailBox.tsx` (tall
  right-side panel over a dimmed page, design B). The send is a server action called from the client box with the
  whole state (addresses as lists, subject, text, record file ids, upload ids, `sendKey`); on refusal the box keeps
  everything (it is client state), on success the action sets the flash `email_sent` and the client goes to `back` (the
  same address without `email=`) and refreshes.
- **Rationale**: same shape as `ActivityOverlays` / `ActivityBox`; the drawer stays open behind the panel because `back`
  keeps `deal=<id>`. Pending state disables `[ SEND ]` in the browser; the ledger makes the server safe anyway.
- **Gmail not usable** (US4): the overlay shows the message and `[ GO TO SETTINGS ]` (`/settings`), no fields. When a send
  is refused for the key, the action marks the connection (as `sendGmail` does) and answers `needs_reconnect`; the box
  switches to the reconnect message and calls `router.refresh()` so the sidebar's Settings "!" appears (SF-118
  `settingsWarning`).

## §7 Addresses, limits, MIME

- **Addresses**: parsed by a pure `splitAddresses(text)` (commas, semicolons, spaces, new lines), trimmed, checked with
  the CRM's `isValidEmail` (records/rules.ts) **and** SF-118's header-safe address check (`ADDRESS` in gmail/rules.ts,
  exported as `isHeaderAddress`), kept as typed for display, compared lower-cased: a duplicate across To/Cc/Bcc is kept
  once, in the first field (To, then Cc, then Bcc). At most 100 after duplicates removed.
- **Limits** (spec): subject 1–250 code points, text ≤ 100,000 code points (counted like the campaign rules, in code
  points), attachments ≤ `MAX_FILE_BYTES` in total, CR/LF never in a header (subject: line breaks refused by the input,
  and `buildMime` throws `BadHeader` → "The email could not be sent…", never reached in practice).
- **MIME** (`buildMime` extended, pure): `From: "<name>" <address>` (display name RFC 2047-encoded when not plain
  ASCII), `Message-ID: <crm-…@barnacle.ai>`, text part `text/plain; charset="UTF-8"`, base64 (as today). With
  attachments: `multipart/mixed` with the text part then one part per file: `Content-Type: <type>; name="<ascii
  fallback>"`, `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded>`
  (RFC 2231), `Content-Transfer-Encoding: base64`, 76-character lines. No HTML part (plain text only, FR-006), no
  tracking.

## §8 Last contacted, notifications

- **Decision**: in `recordSent` / `completePendingSend`: `update persons set last_contacted_at = greatest(coalesce(…,
  '-infinity'), <send time>) where id = any(<recipient person ids>)` — the SF-109 statement. Only recipients (the
  clarification says "the CRM people it goes to"), not a person the email was written from without being written to.
  No notification, no `timeline_events` row, no change to the record (FR-020). Consent is never read nor changed
  (FR-007).

## §9 Seeding

- **Decision**: `src/seed/emails.ts` (registered after `gmail` and `files`): Ada Fake's fake Gmail sends one email from
  a fake deal to its main person through the real `sendFromRecord` path with a fixed `send_key`
  (`00000000-0000-4000-8000-000000000129`), so running the seed again finds the ledger row and sends nothing.
