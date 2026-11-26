---

description: "Task list for SF-129 Write an email from a deal or contact"
---

# Tasks: Write an email from a deal or contact

**Input**: Design documents from `/specs/sf-129-step-20-write-an-email-from-a-deal-or-co/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, contracts/google.md, quickstart.md

**Tests**: Required by the repo (AGENTS.md § Tests) and by the spec (SC-002 to SC-006).
- Tools: Vitest unit tests, and Vitest integration tests against a real local Postgres (`crm_test`) with the fake Gmail
  (`tests/fakes/gmail.ts`) and the fake Storage (`tests/fakes/storage.ts`).
- No browser tests (docs/DECISIONS.md, 2026-11-23).
- Each test file names what it covers (`// covers FR-006, US1 scenario 2`).
- Write each story's tests first and see them fail before writing the code.

**Organization**: Tasks are grouped by user story. Where each detail lives:
- Message texts: data-model.md § Validation, verbatim, in `src/server/messages.ts` only.
- Migration, tables, checks, states: data-model.md.
- Pages, panel, timeline entry, actions and the send order: contracts/routes.md.
- Gmail upload send, MIME layout, Storage read, the fakes' checks: contracts/google.md.
- Decisions: research.md (§n below); build steps: plan.md § Implementation steps.

**Constraints and choices**:
- No new dependency (`dependencies.json` is `[]`): `fetch`, `node:crypto`, `after` (through SF-124 `soon.ts`).
- No blueprint applies: `blueprints.json` is `[]` and there is no blueprint index in this run. So there are no blueprint
  tasks and no "Departs from blueprint" line in `docs/DECISIONS.md`.
- The factory choices of spec.md § Clarifications are built as written there: computer files kept only for sending
  (24 h at most), From = "<CRM name> <address>", Last contacted raised for recipients only, "Email sent to" names 5
  addresses then "and <n> more".
- No Storage or Google call inside `sql.begin()`.
- Outside services (plan.md § Outside services):
  - Gmail API: schema; T014 (US1).
  - Google OAuth 2.0 token endpoint: no schema; T015 (US1).
  - Supabase Postgres: no schema, no fake (real local Postgres); T016 (US1).
  - Supabase Storage: schema; T030 (US3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks).
- **[Story]**: the user story of the task (US1–US5).

---

## Phase 1: Setup

- [ ] T001 Write `migrations/0020_sent_email.sql` exactly as data-model.md (only statements allowed in a transaction;
  `alter table … enable row level security` after each `create table`, no policies):
  - `email_links`: `message_id bigint not null references email_messages (id) on delete cascade`; `deal_id`,
    `person_id`, `organisation_id` bigint null references their tables `on delete cascade`; `how text not null check
    (how in ('written_from', 'recipient'))`; `created_at timestamptz not null default now()`;
    `check (num_nonnulls(deal_id, person_id, organisation_id) = 1)`; `check (how = 'written_from' or person_id is not
    null)`; unique indexes `(message_id, deal_id) where deal_id is not null`, `(message_id, person_id) where person_id
    is not null`, `(message_id, organisation_id) where organisation_id is not null`; indexes on `deal_id`, `person_id`,
    `organisation_id` (partial, not null).
  - `email_sends`: `user_id bigint not null references users (id)`; `send_key uuid not null`, `unique (user_id,
    send_key)`; `connection_id bigint not null references gmail_connections (id) on delete cascade`; `deal_id` /
    `person_id` / `organisation_id` null `on delete set null` with `check (num_nonnulls(deal_id, person_id,
    organisation_id) <= 1)`; `rfc_message_id text not null unique`; `gmail_message_id text null`; `gmail_thread_id
    text null`; `state text not null check (state in ('sending', 'sent'))`; `message_id bigint null references
    email_messages (id) on delete set null`; `upload_ids bigint[] not null default '{}'`; `created_at timestamptz not
    null default now()`; index `(connection_id, gmail_message_id) where state = 'sending'`.
  - `email_uploads`: `user_id bigint not null references users (id)`; `storage_path text not null unique`; `name text
    not null check (char_length(name) between 1 and 255)`; `size bigint not null check (size between 1 and
    26214400)`; `content_type text not null check (char_length(content_type) <= 255)`; `created_at timestamptz not
    null default now()`.
- [ ] T002 [P] Add `email_links`, `email_sends` and `email_uploads` to the tables emptied by `tests/support/reset.ts`
  (before `email_messages` / `gmail_connections`, so foreign keys allow it).
- [ ] T003 [P] Add the SF-129 messages to `src/server/messages.ts`, verbatim from data-model.md § Validation:
  `email_to_required`, `email_subject_required`, `email_too_many_addresses`, `email_subject_too_long`,
  `email_text_too_long`, `email_attachments_too_large`, `email_attachment_gone`, `email_record_archived`,
  `email_record_not_found`, `email_connect_gmail`, `email_reconnect_gmail`, `email_gmail_off`, `email_send_failed`;
  `templates.email_address_invalid(address)` ("<address> is not a valid email address."), `templates.email_sent(list)`
  ("Email sent to a, b." — the first 5 addresses in To, Cc, Bcc order, then " and <n> more"); labels `[ WRITE EMAIL ]`,
  `// NEW EMAIL`, `From`, `To`, `Cc`, `Bcc`, `Subject`, `Text`, `Attachments`, "Add an address", `[ ATTACH A DEAL FILE
  ▾ ]` / `PERSON` / `ORGANISATION`, `[ ATTACH FROM COMPUTER ]`, "<n> MB of 25 MB", `[ SEND ]`, `[ CANCEL ]`,
  `[ CLOSE ]`, `[ GO TO SETTINGS ]`, `[ SHOW ALL ]`, `email_box_footer` ("Sent from your Gmail. It shows on this record
  and on the CRM people it goes to."), and the entry's "sent an email" / "<n> file(s)".

---

## Phase 2: Foundational (blocking prerequisites)

- [ ] T004 [P] Write `tests/unit/email-rules.test.ts` (`// covers FR-004, FR-005, Edge Cases "Addresses" and
  "Required fields"`) for `src/server/email/rules.ts`:
  - `splitAddresses("a@example.test, b@example.test; c@example.test")` → three addresses; new lines and spaces split too;
  - `normaliseRecipients`: "Ana@Example.test" in To and "ana@example.test " in Cc → once, in To, as typed in To;
  - `validateEmail` codes: "ana@" → `email_address_invalid` with "ana@"; empty To → `email_to_required`; blank subject
    → `email_subject_required`; 101 distinct addresses → `email_too_many_addresses`; 251 code points of subject →
    `email_subject_too_long` (250 passes; an emoji counts 1); 100,001 code points of text → `email_text_too_long`;
    total 26,214,401 bytes → `email_attachments_too_large` (26,214,400 passes); an empty text with a subject passes;
  - an address with CR or LF, or `<`/`>`/`,` inside, is invalid (the header-safe check);
  - `emailPreview`: first 140 code points, line breaks as spaces, "…" only when cut.
- [ ] T005 Write `src/server/email/rules.ts` (pure, client-safe, no `@/server/db` import) to pass T004:
  `splitAddresses`, `normaliseRecipients`, `validateEmail`, `totalBytes`, `emailPreview`, `MAX_RECIPIENTS = 100`,
  `MAX_SUBJECT = 250`, `MAX_TEXT = 100_000`; size limit `MAX_FILE_BYTES` from `src/server/files/rules.ts`; address
  validity = `isValidEmail` (records/rules.ts) and `isHeaderAddress` (exported from `src/server/gmail/rules.ts`, the
  existing `ADDRESS` test).
- [ ] T006 [P] Write `tests/unit/gmail-mime.test.ts` additions (`// covers FR-006, FR-013, research §7`) for
  `buildMime`:
  - `fromName: "Zoë Fake"` → `From: =?UTF-8?B?…?= <zoe@barnacle.ai>`; `fromName: "Ada Fake"` → `From: Ada Fake
    <ada@barnacle.ai>` (quoted when it holds specials);
  - `messageId` → a `Message-ID:` header; none given → no header (the Settings test email unchanged);
  - attachments → `multipart/mixed`, the text part first (`text/plain; charset="UTF-8"`, base64), then each file with
    `Content-Type: <type>; name="…"`, `Content-Disposition: attachment; filename="…"; filename*=UTF-8''<percent-encoded>`,
    base64 in lines of at most 76 characters; decoding each part gives the exact bytes;
  - a file name or type holding CR/LF throws `BadHeader`.
- [ ] T007 Extend `buildMime` and `MimeInput` in `src/server/gmail/rules.ts` (`fromName?`, `messageId?`,
  `attachments?: { name, contentType, bytes: Uint8Array }[]`) to pass T006; export `isHeaderAddress`.
- [ ] T008 [P] Write `tests/integration/email-visibility.test.ts` (`// covers FR-018, SC-005`) for `visibleEmail`: a
  message linked to a private person the viewer cannot see, or to a private deal they cannot see, is not visible; the
  creator / owner sees it; a message with only an organisation link is visible to all.
- [ ] T009 Add `visibleEmail(db, viewer, alias = "m")` to `src/server/records/visibility.ts` (research §5: no link to a
  deal failing `visibleDeal`, no link to a person failing `visiblePerson`), with its header comment like the others.
- [ ] T010 [P] Add the flash code `email_sent` to `CODES` in `src/server/records/flash.ts`, rendered by
  `templates.email_sent` from `name` (the addresses joined by ", " by the server, never from the URL).
- [ ] T011 [P] Add `sendRawUpload(accessToken, mime: Buffer)` to `src/server/gmail/google-api.ts`: `POST
  https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media`, `content-type:
  message/rfc822`, `SEND_TIMEOUT_MS = 40_000`, the same error mapping as `gmailJson`, `{ id, threadId }` strings or
  `GoogleUnavailable(200, "bad_send")` (contracts/google.md).
- [ ] T012 Extend `sendGmail` in `src/server/gmail/send.ts`: `SendInput` gains `fromName?`, `messageId?`,
  `attachments?`; the MIME bytes built once; longer than `MAX_RAW_BYTES = 36_700_160` → `GmailTooLarge` (new class)
  before any Google call; no `threadId` → `sendRawUpload`, with `threadId` → the existing JSON call. Update the header
  comment.
- [ ] T013 Teach the fake Gmail (`src/server/gmail/fake-gmail.ts`) the upload path of contracts/google.md: route
  `/upload/gmail/v1/users/me/messages/send` with `uploadType=media` and a `message/rfc822` body (refuse another
  `uploadType` or type with 400 `invalidArgument`, a body over 36,700,160 bytes with 413); parse `multipart/mixed`
  (attachment parts with `filename` from `Content-Disposition`, `body.attachmentId`, bytes kept in the state); keep a
  given `Message-ID`; add `sentMessages(email)` → `{ id, threadId, to, cc, bcc, subject, text, attachments: { name,
  type, bytes }[] }`; the existing `failSend` / down / dead-token switches apply to it. Wire the route in
  `tests/fakes/gmail.ts` so its schema check (T014) sees it.

**Checkpoint**: migration applies, pure rules and MIME pass, `sendGmail` can send with attachments to the fake.

---

## Phase 3: User Story 1 - Write and send an email from a deal or a person (Priority: P1) 🎯 MVP

**Goal**: `[ WRITE EMAIL ]` opens the right panel with To filled; `[ SEND ]` sends through Gmail once; the email is on
the record's timeline at once.

**Independent test**: quickstart.md rows US1-1/2, US1-3/5, US1-6, FR-010, FR-009.

### Tests for User Story 1

- [ ] T014 [US1] Download `gmail-api.json` from
  `https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json`
  at commit `3f740bc15212818d4d0eb041b02c951457ff63fa` into `.factory/schemas/` (`git init -q /tmp/google-api-go-client
  && git -C /tmp/google-api-go-client fetch -q --depth 1 https://github.com/googleapis/google-api-go-client
  3f740bc15212818d4d0eb041b02c951457ff63fa && git -C /tmp/google-api-go-client show
  FETCH_HEAD:gmail/v1/gmail-api.json > .factory/schemas/gmail-api.json`), and make the fake of Gmail API refuse a
  request that the schema refuses: a test sends a wrong field and must fail.
  - In `tests/fakes/gmail.ts`, check an upload request against `users.messages.send`'s `mediaUpload`: the path equals
    `protocols.simple.path` with `{userId}` = `me`, `uploadType` is `media` (or `multipart`), the content type matches
    one of `accept` (`message/*`), the body is at most `maxSize` (36700160) bytes; the answer's properties are declared
    in `Message` with their JSON types. Violations fail the test (`afterEach`), as for the other Gmail calls.
  - `tests/unit/gmail-fake-schema.test.ts` (`// covers FR-023`) must show: an upload with `uploadType=raw` throws, an
    upload with `content-type: application/json` throws, an upload path `/upload/gmail/v1/users/me/messages/sendd`
    throws, a body of 36,700,161 bytes throws, and a valid upload with an attachment passes and its bytes are read back
    from `sentMessages`.
- [ ] T015 [P] [US1] Google OAuth 2.0 token endpoint (the refresh before each send) has no public schema on GitHub. The
  fake (`src/server/gmail/fake-gmail.ts`) keeps following Google's "Using OAuth 2.0 for Web Server Applications" page
  (developers.google.com/identity/protocols/oauth2/web-server, § Refreshing an access token) and RFC 6749 §6 / §5.2. It
  copies: `invalid_grant` for a revoked or unknown refresh token (→ `GmailNeedsReconnect`), 1-hour access tokens, and
  the `unreachable` switch (→ `GmailUnavailable`). Add to `tests/unit/gmail-fake-oauth.test.ts` (`// covers FR-008`) a
  refresh with a revoked token answering 400 `invalid_grant`.
- [ ] T016 [P] [US1] Supabase Postgres has no public schema on GitHub and no fake: the integration tests run on a real
  local Postgres (`crm_test`) with `0020_sent_email.sql` applied, following the PostgreSQL 16 documentation
  (postgresql.org/docs/16, § Constraints and § INSERT … ON CONFLICT). Add to `tests/integration/email-migration.test.ts`
  (`// covers FR-014, FR-015`): each check of T001 refuses a bad row (`how = 'other'`, two records on one link, a
  recipient link on a deal, a second `(user_id, send_key)`, an `email_uploads.size` of 26214401 or 0, an empty name).
- [ ] T017 [P] [US1] Write `tests/integration/email-send.test.ts` (`// covers US1 scenarios 1–7, FR-002, FR-003, FR-006,
  FR-010, FR-014, FR-020, SC-002`) with a connected fake user (`installGmailFake`):
  - `emailBox` on a deal whose main person Ana Fake has "ana@example.test" (first) and "ana.k@example.test" → To =
    ["ana@example.test"], From = the user's address, Cc / Bcc / subject / text / files empty, a UUID `sendKey`;
  - on Ana's person page → To = ["ana@example.test"]; on an organisation → To empty; a deal with no main person, a main
    person with no address, or a private main person the viewer cannot see → To empty;
  - `sendFromRecord` with subject "Next steps" and text "Hi Ana,\n\nHere is the plan." → `sent`; `sentMessages` has one
    message from the user's address ("<name> <address>"), To ana, that subject, that text with its line breaks, a
    `Message-ID` `<crm-…@barnacle.ai>`; `email_messages` has it with `direction = 'sent'` and the Gmail ids; the
    deal's `readTimeline` first entry is kind `email` with that subject;
  - To/Cc/Bcc changed to ben / cat / dan → exactly those in those fields, no link to Ana;
  - the same `sendKey` twice (and two concurrent calls) → one fake message, one `email_messages` row, one entry;
  - the fake Gmail down → `email_send_failed`, nothing recorded, no `email_sends` row left; then the same `sendKey`
    sends;
  - nothing in the record changes (owner, stage, version, consent) and no notification row is added;
  - "Bonjour Zoë,\n\n<b>prix</b> 🎉\nhttps://example.test" is in the fake's text exactly.
- [ ] T018 [P] [US1] Write `tests/integration/email-checks.test.ts` (`// covers FR-005, FR-021, Edge Cases
  "Archived records", "Record no longer visible", "Addresses", "Required fields", "Sending to oneself"`): every
  refusal of data-model.md § Validation returns its code and leaves the fake's Sent mail empty and no `email_sends` row;
  the record archived after `emailBox` → `email_record_archived`; deleted or made private → `email_record_not_found`;
  sending to "bob@barnacle.ai" (a teammate, not a CRM person) succeeds with only the source link.

### Implementation for User Story 1

- [ ] T019 [US1] Write `src/server/email/emails.ts` part 1 (plan.md step 7):
  - `emailBox(viewerId, target)` → `{ gmail: "ok" | "off" | "not_connected" | "needs_reconnect", from, to, files,
    sendKey, record: { kind, id, name } } | null` (null: record not visible or archived); To = the first `person_emails`
    row `order by position` of the person / the deal's main person when `visiblePerson`; files = `listFiles(viewerId,
    target)`;
  - `sendFromRecord(actorId, input, now = new Date())` in the order of contracts/routes.md § `sendEmailFromRecord`
    (steps 1–10; attachments may be empty here, US3 adds them); Message-ID
    `<crm-${randomBytes(12).toString("hex")}@barnacle.ai>`; `fromName` = `users.name`; the ledger claim `insert …
    on conflict (user_id, send_key) do nothing returning id`, deleted on every failure before Gmail accepted;
  - `recordSent(…)` in one `sql.begin()`: ledger row `for update`; `email_threads` and `email_messages` (`direction
    'sent'`, `from_address`, `from_name`, `to_list` / `cc_list` / `bcc_list` as `{ email, name: null }` arrays,
    `subject`, `sent_at` = `received_at` = `now`, `text_body`, `html_body` null) `on conflict do nothing` then select;
    the `written_from` link; ledger `state = 'sent'`, `message_id`. `onRecordSentForTests` (tests only) runs first.
- [ ] T020 [US1] Write `src/app/(app)/records/email-actions.ts`: `sendEmailFromRecord(input)` (`requireUser()` first,
  input shape checked, `back` through `isSafeNext`, then `sendFromRecord`, `setFlash({ code: "email_sent", … })` on
  `sent`).
- [ ] T021 [US1] Add the EMAIL entry to the timeline (plan.md step 9): `"email"` in `EventKind`; `TimelineEntry.email`
  (`{ id, senderName, senderActive, to, cc, bcc, subject, text, preview, attachments: { name, size }[] } | null`, `null`
  in every other entry literal of `src/server/records/timeline.ts` and the ambassador updates); `sentEmails(viewerId,
  target, limit + 1)` with `emailWhere` (deal: links to the deal; person and organisation: see T027) and
  `visibleEmail`, ordered `received_at desc, id desc`, merged in `selectEntries` when `show.activitiesOf` is set;
  `entryTag` → `"EMAIL"` in `src/server/records/timeline-view.ts` (and `EntryTag` type).
- [ ] T022 [US1] Write `src/app/(app)/records/EmailOverlay.tsx` (server: `?email=new` only; nothing on an archived or
  hidden record; `emailBox`) and `src/app/(app)/records/EmailBox.tsx` (client, design B of `design-options.html`: tall
  panel on the right over the dimmed page, heading `// NEW EMAIL · <RECORD NAME>`, From, To / Cc / Bcc chips with "Add
  an address" (Enter, comma, semicolon, space and paste add through `splitAddresses`; × removes), Subject, Text
  `<textarea>`, footer `email_box_footer`, `[ CANCEL ]` / `[ CLOSE ]` links to `back`, `[ SEND ]` disabled while
  pending; refusals listed with their fixed messages and every field kept; on `sent` → `router.push(back)` +
  `router.refresh()`). Text nodes only.
- [ ] T023 [US1] In `src/app/(app)/records/RecordTimeline.tsx`: `[ WRITE EMAIL ]` in the // TIMELINE heading (a link to
  the current address plus `email=new`; not on archived records; shown in the drawer too) and the EMAIL entry of
  contracts/routes.md (tag, `<sender> → <to, cc> · <n> file(s)`, `<subject> — <preview>`, `<details>` `[ SHOW ALL ]`
  with To / Cc / Bcc lines, the text in `white-space: pre-wrap`, attachments "name · size" in the // FILES size format;
  "(deactivated)" after a deactivated sender). Styles `.sidepanel` and `.emailentry` in `src/app/globals.css` (look of
  `docs/DESIGN.md`).
- [ ] T024 [US1] Render `EmailOverlay` and export `maxDuration = 60` in `src/app/(app)/deals/[id]/page.tsx`,
  `src/app/(app)/people/[id]/page.tsx`, `src/app/(app)/organisations/[id]/page.tsx` and `src/app/(app)/deals/page.tsx`
  (board with `deal=<id>`; `back` keeps `deal=<id>` so the drawer is open again after sending); the drawer's heading
  button in `src/app/(app)/deals/DealDrawer.tsx` through `RecordTimeline`.

**Checkpoint**: US1 tests green; an email can be written and sent from a deal, person, organisation or the drawer.

---

## Phase 4: User Story 2 - The sent email is on the timelines of the record and of the people it went to (Priority: P1)

**Goal**: one EMAIL entry on the source record and on every CRM recipient, hidden from users who cannot see a linked
record, once even after the Gmail sync; Last contacted raised.

**Independent test**: quickstart.md rows US2-1, US2-2, US2-5, US2-6, US2-7, "Sent but not recorded".

### Tests for User Story 2

- [ ] T025 [P] [US2] Write `tests/integration/email-timeline.test.ts` (`// covers US2 scenarios 1–4, 6, 7, FR-015,
  FR-017, FR-018, FR-019, Edge Cases "One CRM person with two addresses", "Deactivated sender"`):
  - from the deal to Ana (To) and Ben (Cc, on no deal) → one `email` entry each on the deal, Ana, Ben and the deal's
    organisation, with sender, to, cc, subject, text, attachments;
  - from Ana's page → not on her deal's timeline nor her organisation's;
  - from an organisation to "ana@example.test" → on the organisation and Ana, once each;
  - to an address of no CRM person → only the source link, no person created;
  - Ana's two addresses in To and Cc → one entry on Ana listing both;
  - a private recipient the teammate cannot see → the entry is on no timeline for that teammate;
  - Last contacted: raised to the send time for recipients only, never lowered (a later value stays), not raised for a
    person written from but not written to;
  - after the sender is deactivated, the entry still shows their name with "(deactivated)".
- [ ] T026 [P] [US2] Write `tests/integration/email-sync.test.ts` (`// covers US2 scenario 5, FR-016, SC-003, Edge
  Case "Sent but the CRM could not record it"`):
  - after a send, `syncConnection` → each timeline still one entry, `email_messages` one row, Settings
    `conversations` + 1 only;
  - a sync that stores the message before `recordSent` (run the sync from `onRecordSentForTests`) → still one entry,
    links complete;
  - `onRecordSentForTests` throws → result `sent` (the flash set); after `syncConnection` the email is on the CRM
    recipients' timelines and the source record once, the ledger `sent`, Last contacted raised.

### Implementation for User Story 2

- [ ] T027 [US2] Complete `emailWhere` in `src/server/records/timeline.ts` (research §5): person → links to the person,
  or to a deal the person is linked to (main or `deal_people`) and the viewer can see; organisation → links to the
  organisation, or to its deals the viewer can see; each message once.
- [ ] T028 [US2] In `recordSent` (`src/server/email/emails.ts`): recipient links (`person_emails.email = any(<lower-cased
  addresses>)`, distinct persons, archived and private included, `on conflict do nothing` after the `written_from`
  link) and `update persons set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'::timestamptz),
  <now>)` for recipient persons only.
- [ ] T029 [US2] Add `completePendingSend(db, connectionId, message)` to `src/server/email/emails.ts` (a `sending` ledger
  row of that connection with the same `gmail_message_id`, else the same `rfc_message_id`, `for update`; the same links
  and Last contacted at the ledger's `created_at`; `state = 'sent'`, `message_id`); call it inside `storeMessage`'s
  transaction in `src/server/gmail/sync.ts` (also when the message row already existed). In `sendFromRecord`, store
  the Gmail ids on the ledger right after Gmail's answer (own statement, errors caught) and, when `recordSent` fails,
  log it and `runAfterResponse(() => syncConnection(connectionId))`.

**Checkpoint**: US1 + US2 green: the MVP.

---

## Phase 5: User Story 3 - Attach files from the record or from the computer (Priority: P2)

**Goal**: attach the record's own files and computer files (through Storage), 25 MB in total, sent byte for byte.

**Independent test**: quickstart.md rows US3, US3-3, US3-5.

### Tests for User Story 3

- [ ] T030 [US3] Download `storage_v0_openapi.json` from
  `https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json`
  at commit `aa0fb9e84b9d128342f0127c7650d8cc5b240202` into `.factory/schemas/` (`git init -q /tmp/supabase && git -C
  /tmp/supabase fetch -q --depth 1 https://github.com/supabase/supabase aa0fb9e84b9d128342f0127c7650d8cc5b240202 &&
  git -C /tmp/supabase show FETCH_HEAD:apps/docs/spec/storage_v0_openapi.json > .factory/schemas/storage_v0_openapi.json`),
  and make the fake of Supabase Storage refuse a request that the schema refuses: a test sends a wrong field and must
  fail.
  - `tests/fakes/storage.ts` checks the whole-object `GET /object/authenticated/{bucketName}/{*}` (path and method in
    the schema, no undeclared query parameter).
  - `tests/unit/storage-fake.test.ts` (`// covers FR-013, FR-023`) must show: a GET on `/object/authenticated-x/…`
    throws, a GET with an undeclared query parameter `?raw=1` throws, and `readObject` of a stored file returns its
    exact bytes (a missing object → `null`, `down()` → `StorageUnreachable`).
- [ ] T031 [P] [US3] Write `tests/integration/email-attachments.test.ts` (`// covers US3 scenarios 1–6, FR-011, FR-012,
  FR-013, SC-002, Edge Case "Big files from the computer"`):
  - `emailBox` on a deal offers its files ("proposal.pdf", "logo.png") with names and sizes, none attached; a person
    / organisation offers only its own files;
  - `startEmailUpload` → an `email_uploads` row and a `file_cleanup` row due in 24 h; the PUT to the fake Storage;
  - sending "proposal.pdf" (record) + "notes.docx" (upload) → the fake message's attachments are byte-equal with the
    stored names and types; the entry lists both with sizes; `// FILES` unchanged; the upload's cleanup due now and its
    row deleted;
  - 24 MB + 2 MB → `email_attachments_too_large`, nothing sent, no ledger row; after removing it, sent;
  - `startEmailUpload` of 30 MB → `email_attachments_too_large`;
  - a record file deleted before sending → `email_attachment_gone`; another record's file id, or another user's
    upload id → `email_attachment_gone`; an upload whose stored bytes differ in size → `email_attachment_gone`;
  - Storage `down()` while sending → `email_send_failed`, the ledger row deleted;
  - `sweepFileCleanup` removes an unsent upload after 24 h and its `email_uploads` row.

### Implementation for User Story 3

- [ ] T032 [P] [US3] Add `readObject(path, size)` to `src/server/files/storage.ts` (contracts/google.md § Storage: GET
  `/object/authenticated/{bucket}/{path}`, 30 s time-out, bytes when their length is `size`, `null` on 400/404 or a
  different length, `StorageUnreachable` on a network error, time-out or 5xx); make `src/server/files/fake-storage.ts`
  serve a GET without `range` if it does not yet.
- [ ] T033 [US3] In `src/server/email/emails.ts`: `startEmailUpload(actorId, { name, size, type })` (`validateFile`,
  size ≤ `MAX_FILE_BYTES`, `newStoragePath()`, `createSignedUploadUrl`, `email_uploads` row and `file_cleanup` row
  `due_at = now() + interval '24 hours'` in one transaction after the Storage call; the type from the browser or
  `uploadContentType(name)`); in `sendFromRecord` steps 4 and 6 (record files with `visibleFile()` and `<record>_id` =
  the record; uploads of this user; total ≤ `MAX_FILE_BYTES`; bytes read one after the other with `readObject`;
  `GmailTooLarge` → `email_attachments_too_large`); `email_attachments` rows in `recordSent` (position in box order,
  name, type, size); after a send, the uploads' cleanup due now, their rows deleted, `runAfterResponse(sweepFileCleanup)`.
  In `src/server/files/files.ts`, `sweepFileCleanup` also deletes `email_uploads` rows older than 24 hours.
- [ ] T034 [US3] Add `startEmailUpload` to `src/app/(app)/records/email-actions.ts` (`requireUser()` first) and the
  attachments part of `EmailBox.tsx`: the list (name · size · ×), `[ ATTACH A <KIND> FILE ▾ ]` (the record's files not
  yet attached), `[ ATTACH FROM COMPUTER ]` (multiple; each file over the remaining room refused at once with
  `email_attachments_too_large`; the PUT with progress reusing `put` from `AddFiles.tsx`, moved to a shared module if
  needed), "<n> MB of 25 MB", `[ SEND ]` disabled while uploading; a refusal `email_attachment_gone` keeps everything.
- [ ] T035 [US3] In `src/app/(app)/records/RecordTimeline.tsx`, show the entry's file count (`<n> file(s)`) and the
  `[ SHOW ALL ]` attachments list "name · size" with the same size format as `src/app/(app)/records/FilesSection.tsx`
  (move that helper to a shared module if it is local), names as text nodes.

**Checkpoint**: attachments green.

---

## Phase 6: User Story 4 - Without a working Gmail connection, the button leads to Settings (Priority: P2)

**Goal**: the panel explains and links to Settings; nothing is sent; a refused key marks the connection.

**Independent test**: quickstart.md rows US4-1/2/4, US4-3.

### Tests for User Story 4

- [ ] T036 [P] [US4] Write `tests/integration/email-gmail-state.test.ts` (`// covers US4 scenarios 1–4, FR-008, SC-004,
  SC-006`):
  - never connected / disconnected → `emailBox.gmail = "not_connected"`; needs reconnecting → `"needs_reconnect"`;
    Gmail off → `"off"`;
  - `sendFromRecord` in each of these → the matching `gmail` answer and no request in the fake's `requests`;
  - a refused key at send time (`refuseKey`) → `gmail/needs_reconnect`, the connection `needs_reconnect`,
    `settingsWarning` = `"gmail"`, nothing recorded, no ledger row.

### Implementation for User Story 4

- [ ] T037 [US4] In `EmailOverlay.tsx` / `EmailBox.tsx`: the US4 message for each state (`email_connect_gmail`,
  `email_reconnect_gmail` with `[ GO TO SETTINGS ]` → `/settings`; `email_gmail_off` without the link), no fields and no
  `[ SEND ]`; on a `gmail` answer from `[ SEND ]` the box switches to that message, keeps the typed state in memory, and
  calls `router.refresh()` so the sidebar's Settings "!" shows.

---

## Phase 7: User Story 5 - Emailing an Unsubscribed person is allowed (Priority: P3)

**Goal**: consent never blocks nor changes.

**Independent test**: quickstart.md row US5.

- [ ] T038 [P] [US5] Write `tests/integration/email-unsubscribed.test.ts` (`// covers US5 scenarios 1–2, FR-007`): Ana
  Unsubscribed → `emailBox` fills To with her first address, `sendFromRecord` sends, her consent is still
  `unsubscribed`, no `consent_changed` event, her timeline has the entry.
- [ ] T039 [US5] Check that nothing in `src/server/email/` reads `persons.consent` (a comment in `emails.ts` says
  consent is for campaigns only, PRODUCT §4); fix if T038 fails.

---

## Phase 8: Polish & cross-cutting concerns

- [ ] T040 [P] Write `src/seed/emails.ts` (research §9: Ada Fake sends one email from a fake deal to its fake main
  person through `sendFromRecord` with `send_key` `00000000-0000-4000-8000-000000000129`; only when `isFakeAllowed()`)
  and register it in `src/seed/index.ts` after `gmail` and `files`; `tests/integration/seed.test.ts` (`// covers
  FR-024`): seeding twice leaves one such email.
- [ ] T041 [P] Write `tests/unit/email-messages.test.ts` (`// covers FR-022`): `templates.email_sent` with 7 addresses
  names 5 then "and 2 more"; every `email_*` code used in `src/server/email/` exists in `messages.ts`.
- [ ] T042 [P] Update `AGENTS.md` § Layout with the SF-129 lines (`src/server/email/rules.ts` / `emails.ts`, tables
  `email_links` / `email_sends` / `email_uploads`, `visibleEmail()`, `EmailOverlay.tsx` / `EmailBox.tsx` /
  `email-actions.ts`, `sendGmail` through the upload path, `completePendingSend` in the sync, `readObject`).
- [ ] T043 Run `npm run test:schemas && npm test && npm run typecheck` with `APP_ENV=test
  DATABASE_URL=postgres://postgres@localhost:5432/crm_test`; fix every failure; run quickstart.md § By hand.
- [ ] T044 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its
  schema) and `## Schemas` (each schema's GitHub URL at its commit).
  - Gmail API: extend the SF-118 line with the upload send (`/upload/gmail/v1/users/me/messages/send?uploadType=media`,
    checked against `mediaUpload` and `Message` of `gmail-api.json`), `multipart/mixed` attachments, `sentMessages`.
  - Supabase Storage: add the whole-object GET and the `email_uploads` cleanup.
  - Google OAuth 2.0 token endpoint: unchanged, no schema (Google's OAuth web-server page, RFC 6749).
  - Supabase Postgres: real local Postgres, no fake, no schema.
  - `## Schemas`: `gmail-api.json` at googleapis/google-api-go-client 3f740bc15212818d4d0eb041b02c951457ff63fa,
    `storage_v0_openapi.json` at supabase/supabase aa0fb9e84b9d128342f0127c7650d8cc5b240202 (already listed: keep them).

---

## Dependencies & Execution Order

- **Setup (T001–T003)** first; T001 before every integration test.
- **Foundational (T004–T013)** blocks all stories. T004 → T005; T006 → T007 → T012; T008 → T009; T011 → T012; T013
  after T012.
- **US1 (T014–T024)**: T014 first (the schema check the other stories rely on). Tests T015–T018, then T019 → T020 →
  T021 → T022 → T023 → T024.
- **US2 (T025–T029)**: needs US1's `recordSent` and timeline (T019, T021).
- **US3 (T030–T035)**: needs US1; T030 first. T032 → T033 → T034 → T035.
- **US4 (T036–T037)**: needs US1's box and action.
- **US5 (T038–T039)**: needs US1.
- **Polish (T040–T044)**: after the stories. T044 last.

## Parallel examples

- Setup: T002 and T003 alongside T001.
- Foundational: T004, T006, T008, T010 and T011 touch different files.
- US1: T015, T016, T017 and T018 alongside each other after T014.
- US2: T025 and T026. US3: T031 and T032. US4: T036 alongside US3. US5: T038 alongside US3/US4.
- Polish: T040, T041 and T042.

## Implementation strategy

- **MVP**: Setup + Foundational + US1 + US2: write and send from a deal, person, organisation or the drawer, shown on
  every linked timeline once.
- Then US3 (attachments), US4 (no Gmail), US5 (unsubscribed), then Polish.
- Commit after each checkpoint, with tests green at each.

## Notes

- **Task count**: 44 (T001–T044).
  - Setup 3, Foundational 10.
  - US1 11, US2 5, US3 6, US4 2, US5 2.
  - Polish 5.
- **Format check**: every task has a checkbox, an ID, a story label in story phases only, and file paths.
