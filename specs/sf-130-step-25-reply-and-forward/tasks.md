---

description: "Task list for SF-130 Reply and forward"
---

# Tasks: Reply and forward

**Input**: Design documents from `/specs/sf-130-step-25-reply-and-forward/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, contracts/google.md, quickstart.md

**Tests**: included. `AGENTS.md` § Tests requires them, and the spec's SC-002 to SC-006 are test outcomes. Each test
names what it covers (`// covers FR-005, US3 scenario 3`). Integration tests run on real Postgres
(`APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`) with the fake Gmail (`FakeGoogleMail`
through `tests/fakes/gmail.ts`) and the fake Storage (`tests/fakes/storage.ts`). Reuse `tests/integration/compose-helpers.ts`
and `email-helpers.ts`.

**Organization**: by user story (spec.md). Blueprints: `blueprints.json` is `[]`, so there are no blueprint tasks
and no blueprint exception line.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [ ] T001 Create `migrations/0022_email_reply.sql` with exactly `alter table email_sends add column reply_message_id bigint null references email_messages (id) on delete set null;` and its comment (data-model.md § Migration); no `create table`, so no RLS line; check that `tests/support/reset.ts` already empties `email_sends` (no change expected)
- [ ] T002 [P] Add the fixed texts of data-model.md § New fixed texts to `src/server/messages.ts`: `reply_button` "[ REPLY ]", `reply_all_button` "[ REPLY ALL ]", `forward_button` "[ FORWARD ]", `reply_connect_gmail` "[ CONNECT GMAIL TO REPLY ]", `reply_reconnect_gmail` "[ RECONNECT GMAIL TO REPLY ]", `reply_heading` "// REPLY", `reply_all_heading` "// REPLY ALL", `forward_heading` "// FORWARD", `reply_footer` "Sent from your Gmail, in this conversation.", `reply_quote_label` "Quoted below your text", `reply_forwarded_label` "Forwarded", `reply_forward_unavailable` "One of the forwarded attachments can't be fetched from Gmail right now. Remove it or try again later." (`email_not_found` exists already)

---

## Phase 2: Foundational (blocks every story)

- [ ] T003 Refactor `src/server/emails/compose.ts`: move steps 5–9 of `sendFromRecord` (ledger claim, Storage reads, `sendGmail`, `storeMessage`, upload clean-up) into one internal `deliver({ actorId, connection, sendKey, record: {kind,id} | null, replyMessageId: number | null, named, subject, body, attached, forwarded: [], uploadIds, threadId: null, inReplyTo: null, references: [], now })`. The ledger insert writes the record column only when `record` is set, and writes `reply_message_id`. Export `nameRecipients` as `namesFor`. `sendFromRecord` keeps its exact behaviour: all `tests/integration/compose-*.test.ts` stay green
- [ ] T004 Extend the `EmailBox` type in `src/server/emails/compose.ts` as in contracts/routes.md § `replyBox` → `EmailBox` props: `cc: string[]`, `names: Record<string,string>`, `record` nullable, `reply: null | {mode, messageId, heading, subject, quote, forwarded}`, `missing?: true`. `emailBox` returns `cc: []`, `names: {}`, `reply: null`; update `src/app/(app)/records/EmailBox.tsx` so that it compiles with `record` possibly null (no record-file picker then)
- [ ] T005 Rename `RecordTimeline`'s `emailHref` prop to `emailBase` (the page address ending with `email=`; `[ WRITE EMAIL ]` → `${emailBase}new`) in `src/app/(app)/records/RecordTimeline.tsx` and every caller: `src/app/(app)/deals/[id]/page.tsx`, `src/app/(app)/deals/page.tsx`, `src/app/(app)/deals/DealDrawer.tsx`, `src/app/(app)/people/[id]/page.tsx`, `src/app/(app)/organisations/[id]/page.tsx` (the deal list drawer passes none)
- [ ] T006 [P] Create `src/server/emails/reply-rules.ts` (pure, client-safe: never `@/server/db`) with `parseEmailParam(v)`: regex `^(new|reply|reply-all|forward)(?:-([1-9]\d{0,15}))?$`; an id is required except for `new`, where it is forbidden. Returns `{ mode: "new" } | { mode: "reply" | "reply_all" | "forward"; messageId }` or null. Export `MESSAGE_ID = /^<[^<>\s]{1,996}>$/`
- [ ] T007 [P] Unit test `parseEmailParam` in `tests/unit/reply-rules.test.ts`: `new`, `reply-12`, `reply-all-12`, `forward-12`, and the refusals (`reply`, `reply-0`, `reply-x`, `new-3`, 17 digits)
- [ ] T008 Make `EmailOverlay` in `src/app/(app)/records/EmailOverlay.tsx` read `parseEmailParam` (`new` unchanged) and accept `target: Target | null` (null + `new` → nothing); reply modes are wired in US1

**Checkpoint**: SF-129 unchanged and green; the reply work can start.

---

## Phase 3: User Story 1 - Reply from the conversation or its timeline entry (P1) 🎯 MVP

**Goal**: `[ REPLY ]` on every EMAIL entry and conversation-page email opens the box prefilled (To, "Re:", read-only
quote). Sending goes from the user's Gmail with In-Reply-To / References and lands as the newest email of the
conversation.

**Independent Test**: spec US1 Independent Test (fake Gmail: Ana Fake's received email on a deal → `[ REPLY ]` → send → one
Sent message with "Re: <subject>", text + quote, In-Reply-To; the deal timeline and the conversation page show it).

### Tests for User Story 1

- [ ] T009 [US1] Download `gmail-api.json` from https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json at commit `3f740bc15212818d4d0eb041b02c951457ff63fa` into `.factory/schemas/` (`git init -q /tmp/google-api-go-client && git -C /tmp/google-api-go-client fetch -q --depth 1 https://github.com/googleapis/google-api-go-client 3f740bc15212818d4d0eb041b02c951457ff63fa && git -C /tmp/google-api-go-client show FETCH_HEAD:gmail/v1/gmail-api.json > .factory/schemas/gmail-api.json`; it is already pinned by sha256 in `scripts/fetch-schemas.mjs`: keep that entry). Make the fake of the Gmail API refuse a request that the schema refuses. In `tests/fakes/gmail.ts`, check `users.messages.send` with `uploadType=multipart` against `resources.users.resources.messages.methods.send.mediaUpload` (`protocols.simple.multipart === true`; path = `protocols.simple.path`; part 1 JSON whose every key is a property of the `Message` schema; part 2 content type matching `accept` `message/*`; size ≤ `maxSize` 36700160) and the answer against `Message`. In `tests/unit/gmail-fake-schema.test.ts`, a test sends a multipart send whose JSON part has a wrong field (`{"thread_id": "…"}`), and one with `uploadType=resumable` on the simple path; both must fail
- [ ] T010 [P] [US1] Google OAuth 2.0 token endpoint (no public schema): no new fake code. In `tests/integration/reply-send.test.ts`, use the existing fake that follows RFC 6749 §5.2 and Google's "Using OAuth 2.0 for Web Server Applications" page (developers.google.com/identity/protocols/oauth2/web-server, § Refreshing an access token). It copies `invalid_grant` (400) for a refused refresh token, which the CRM maps to `needs_reconnect`. A test refuses the key before a reply and expects nothing sent, the box answer `{ status: "gmail", state: "needs_reconnect" }` and the connection marked
- [ ] T011 [P] [US1] Supabase Postgres (no public schema): no fake. The reply tests run on the real local Postgres of `AGENTS.md` § Tests. Add `tests/integration/reply-migration.test.ts`: `email_sends.reply_message_id` exists, nullable, `on delete set null` (deleting the referenced `email_messages` row nulls it)
- [ ] T012 [P] [US1] Unit tests for reply prefill, subjects and quote in `tests/unit/reply-rules.test.ts`:
  - Reply of a received email → `[from]`; of an email whose sender is the own address (any case) → its To; to self only → own address in To; unknown sender → To empty (US1 scenarios 1 and 4, edge cases).
  - `replySubject`: "Pricing" → "Re: Pricing"; "RE: Pricing", "Re: Re: Pricing" unchanged; "" → "Re: (no subject)" (US1 scenario 5).
  - `quoteDate` → "27 Nov 2026 at 14:05" in UK time (BST and GMT dates).
  - `replyQuote`: "On 27 Nov 2026 at 14:05, Ana Fake <ana@example.test> wrote:", lines "> …", an empty line → ">", the address alone when there is no name, HTML-only text through `emailText`, "<b>prix</b> 🎉" kept as text, no text → the On line only.
  - `bodyWithQuote` = text + "\n\n" + quote.
  - `referencesFor`: oldest first, up to and including the answered one, duplicates and invalid ids dropped.
- [ ] T013 [P] [US1] Unit tests for `buildMime` in `tests/unit/gmail-mime.test.ts`: `In-Reply-To` written when it matches `MESSAGE_ID`, else left out; `References` from a list, joined by spaces, folded at spaces with every line ≤ 998 octets (200 ids), absent when the list is empty; a call without them builds the same text as before
- [ ] T014 [US1] Integration test `tests/integration/reply-send.test.ts` (US1 scenarios 2, 3, 6, 7; FR-010, FR-013, FR-014; edge cases "Double press", "Gmail slow or failing", "Long quotes", "Email with no Message-ID", "Conversation hidden or emptied while writing"):
  - A reply to Ana Fake's received "Pricing" (stored by the fake sync on a deal) → `fake.sentMessages(ada)` has exactly one message to ana@example.test, "Re: Pricing", body "Thanks Ana,\n\nAgreed.\n\nOn …, Ana Fake <ana@example.test> wrote:\n> …", In-Reply-To = Ana's Message-ID, References oldest first. The conversation id is unchanged, the reply is on the deal's `readTimeline` and on `getConversation`, the flash is `email_sent`, and the ledger row is `sent` with `reply_message_id` and no record ids.
  - The same send key twice sends once.
  - `failSend` → `compose_send_failed`, ledger row deleted.
  - A 150,000-character earlier text with a short reply sends (the limit counts the typed text only).
  - An earlier email without a Message-ID sends without In-Reply-To.
  - A conversation made hidden (person made private) between box and send → `email_not_found`, nothing sent.
- [ ] T015 [P] [US1] Component test `tests/unit/reply-box.test.tsx` (`// @vitest-environment happy-dom`, as `email-box-refused.test.tsx`): the real `EmailBox` with a `reply` box shows the heading "// REPLY · Pricing", the To chip "Ana Fake" (from `names`, with the address in `title`), Subject "Re: Pricing", an empty text area, and the quote as a read-only text node in `pre.quote`. `[ CANCEL ]` links to `back`. A mocked `sendEmailReply` answering `refused` keeps everything typed

### Implementation for User Story 1

- [ ] T016 [US1] Add `prefill` (reply mode), `replySubject`, `quoteDate` (via `formatDate` + `ukParts` of `src/server/format.ts`), `replyQuote`, `bodyWithQuote`, `referencesFor` to `src/server/emails/reply-rules.ts` per research.md §5 and data-model.md § Prefill
- [ ] T017 [US1] In `src/server/gmail/rules.ts`, make `MimeInput.references` a `string[]` written folded (≤ 998 octets per line) and write `In-Reply-To` only when it matches `MESSAGE_ID` (contracts/google.md)
- [ ] T018 [US1] In `src/server/gmail/google-api.ts`, add the `threadId?` argument to `sendRawUpload(access, mime, threadId?)`. With a thread id it sends `POST …/upload/gmail/v1/users/me/messages/send?uploadType=multipart`, `multipart/related; boundary="crm-<hex>"`, a JSON part `{"threadId":…}` then a `message/rfc822` part, with the same 40 s time-out and error mapping. In `src/server/gmail/send.ts`, `SendInput` gains `inReplyTo?: string | null` and `references?: string[]`; remove the `getThreadMetadata` lookup; `threadId` → the multipart upload; keep the `MAX_RAW_BYTES` check first. Delete `sendRaw` / `getThreadMetadata` when `grep` finds no other use
- [ ] T019 [US1] In `src/server/gmail/fake-gmail.ts`, answer `uploadType=multipart` on the upload route: parse `multipart/related`, keep the thread when the JSON names one of that mailbox (else a new one), store In-Reply-To / References with the headers, answer `{ id, threadId, labelIds }`. `SentMessage` gains `inReplyTo` and `references` (unfolded)
- [ ] T020 [US1] Create `src/server/emails/reply.ts`:
  - `replyState(viewerId)` → `"ok" | "connect" | "reconnect" | "off"` (`gmailConfig().mode`, connection state).
  - `answered(db, viewerId, messageId)`: the message, its conversation under `visibleConversation(db, viewerId, "c")`, its attachments by position, the conversation's shown `rfc_message_id`s (`distinct on (dedupe_key)` ordered `received_at, id` as `getConversation`) with this one's index.
  - `replyBox(viewerId, { mode, messageId }, target | null)`: missing or hidden → `{ missing: true }`; else Gmail state, From, `prefill`, `namesFor`, subject, quote, heading `<reply_heading> · <subjectOrDefault(subject)>`, record files only when the target is visible and not archived, a fresh `sendKey`.
  - `sendReply(actorId, input, now = new Date())` in the order of contracts/routes.md § Server action. Context record not visible or archived plus `fileIds` → `compose_attachment_gone`. Gmail usable, the pure checks on the typed text, `email_not_found` when the conversation is hidden or the email is gone, In-Reply-To / References from `referencesFor`, `threadId` null for now (US2), then `deliver` with `replyMessageId` and no record.
  - `placePendingReply(db, connectionId, threadRowId, m)` (research.md §1): this connection's `email_sends` row in state `sending` matching `gmail_message_id = m.gmailMessageId` or `rfc_message_id = m.rfcMessageId`, with `reply_message_id` not null. When the thread row's `conversation_id` is null, set it to the answered email's thread's conversation. Call it in `storeMessage` (`src/server/gmail/sync.ts`) after the thread row is read and before `processMessage`, for new messages only. Without it, US1's reply (no `threadId` yet) would start a new conversation.
- [ ] T021 [US1] Add the server action `sendEmailReply` to `src/app/(app)/records/email-actions.ts` (contracts/routes.md: `requireUser()` first; shape checks as `sendEmailFromRecord`, `forwardIds` ≤ 100 ids; flash `email_sent`; `revalidatePath`; `back` through `isSafeNext`)
- [ ] T022 [US1] Wire the reply modes in `src/app/(app)/records/EmailOverlay.tsx` (→ `replyBox`; `missing` → the box with `messages.email_not_found` and `[ CLOSE ]` only)
- [ ] T023 [US1] Add the reply view to `src/app/(app)/records/EmailBox.tsx`:
  - the heading from `reply.heading`, To and Cc prefilled, chips showing `names[address.toLowerCase()] ?? address` with `title` = the address;
  - Subject prefilled; the quote under the text area in `<pre className="quote">` labelled `reply_quote_label` (a text node, never sent back);
  - footer `reply_footer`; `[ SEND ]` calls `sendEmailReply` with `mode`, `messageId` and `record` (null when the box has none);
  - SF-129's `panelView`, the opened Gmail state and the double-press guard unchanged.
- [ ] T024 [US1] Create `src/app/(app)/records/ReplyButtons.tsx` (server: props `{ messageId, base, state }`; `ok` → three `next/link` `.btn` links `reply-`, `reply-all-`, `forward-<id>` with `scroll={false}`). Use it in `src/app/(app)/records/EmailEntry.tsx`, where the "sender → recipients" line becomes a `.eh` row with the buttons on the right. `RecordTimeline.tsx` passes `reply: { state, base: emailBase }` to `EmailEntry` when not archived and `emailBase` is set (`replyState` read once per timeline)
- [ ] T025 [US1] Conversation page `src/app/(app)/emails/[id]/page.tsx`:
  - export `maxDuration = 60`;
  - `replyState`; `EmailBody` (`src/app/(app)/emails/EmailBody.tsx`) gets a `.eh` row with the To line (empty when no To) and `ReplyButtons` with `base` = `/emails/<id>?` + (`from=<from>&` when shown) + `email=`;
  - `readFlash(["email_sent"])` shown as `.notice` under the heading;
  - `EmailOverlay` with target = the `?from=` record when visible and not archived (else null) and `back` = `/emails/<id>` (+ `?from=`).
- [ ] T026 [US1] Add `export const maxDuration = 60` where missing on the four record pages, and the CSS for `.eh` (flex, space-between), `.acts.mini .btn` (design B small framed button, DESIGN.md tokens) and `.quote` (pre-wrap, muted, left rule) in `src/app/globals.css`
- [ ] T027 [US1] Integration test `tests/integration/reply-pages.test.ts` (US1 scenario 8, scenario 1; FR-001, FR-003): for a connected user, each EMAIL entry of a deal timeline and each email of the conversation page renders the three buttons with the right `email=` addresses. The deal drawer's buttons keep `open=<id>`. An archived deal's timeline shows none. `?email=reply-<id>` opens the box. A hidden conversation's id shows `email_not_found` with no `[ SEND ]`

**Checkpoint**: US1 works alone; MVP.

---

## Phase 4: User Story 2 - Same conversation in the CRM and in Gmail (P1)

**Goal**: the reply joins the answered email's conversation even when it came only from a colleague's mailbox,
links stay as they are, the sync never duplicates it, and it uses the user's own Gmail thread when there is one.

**Independent Test**: spec US2 Independent Test (two fake users, Ada's mailbox only; Bob replies → same CRM conversation on the
deal and Ana's page, new Gmail thread for Bob with the headers; Ada replies → same Gmail thread).

### Tests for User Story 2

- [ ] T028 [P] [US2] Integration test `tests/integration/reply-conversation.test.ts` (US2 scenarios 1–6; FR-011, FR-014–FR-016; SC-003, SC-004):
  - Bob replies to Ada-only → same conversation id, on the deal's and Ana Fake's timelines, Bob's fake Sent message in a new thread with the headers.
  - Ada replies → `threadId` equals the conversation's thread in her fake mailbox.
  - A hand link to an organisation and a removed automatic link are unchanged after a reply.
  - A new CRM person in Cc gets an automatic link (with their organisation and their one open deal).
  - `fake` sync / `runGmailCheck` afterwards → still one entry per timeline and the SF-128 fetch's `copied` unchanged.
  - Ana's Last contacted = the send time unless already later.
- [ ] T029 [P] [US2] Integration test `tests/integration/reply-catch-up.test.ts` (edge case "Sent but the CRM could not record it"; FR-016): `onRecordSentForTests` throws. The sync then stores the reply in the same conversation once, and a forward to `ed@example.test` (no CRM address, new Gmail thread) is still copied because its ledger row is pending
- [ ] T030 [P] [US2] Unit test `decideCopy` `pendingSend` in `tests/unit/gmail-rules.test.ts`: pending → `copy` in an unknown thread without CRM addresses; label / date rules still skip first

### Implementation for User Story 2

- [ ] T031 [US2] Harden `placePendingReply` in `src/server/emails/reply.ts` for the sync storing first: match on `rfc_message_id` while the ledger's `gmail_message_id` is still null, and leave a thread row that already has another conversation as it is (SF-127's rule). Add the case to `tests/integration/reply-catch-up.test.ts` (the hook stores through `syncConnection` before the send path's update of the Gmail ids)
- [ ] T032 [US2] Add `pendingSend: boolean` to `decideCopy` in `src/server/gmail/rules.ts` (copy after the label and date rules). In `runOnce` (`src/server/gmail/sync.ts`), one query per batch reads this connection's `sending` ledger rows matching the batch's Gmail ids or Message-IDs. Update the other `decideCopy` callers (`pendingSend: false`)
- [ ] T033 [US2] Add `userThread(connectionId, conversationId, dedupeKey)` to `src/server/emails/reply.ts`: the user's `email_threads` row in the conversation holding a copy with the same `dedupe_key` first, else the one with the newest message, else null. `sendReply` passes its `gmail_thread_id` as `threadId` to `deliver` → `sendGmail`

**Checkpoint**: US1 + US2 give the full reply.

---

## Phase 5: User Story 3 - Reply all (P2)

**Goal**: `[ REPLY ALL ]` fills To and Cc with everyone but the user.

**Independent Test**: spec US3 Independent Test.

- [ ] T034 [P] [US3] Unit tests for `prefill` reply_all in `tests/unit/reply-rules.test.ts` (US3 scenarios 1–3; edge case "Reply all where only the user remains"):
  - Received from ana to own + ben, cc cat → To [ana, ben], Cc [cat].
  - Sent by own to ana, cc ben, bcc dan → To [ana], Cc [ben], dan nowhere.
  - Duplicates across To / Cc kept once at the first place; "Ada@Barnacle.ai" removed as own.
  - Received to own alone → To [sender], Cc []; sent to self alone → both empty.
- [ ] T035 [US3] Implement the reply_all branch of `prefill` in `src/server/emails/reply-rules.ts` (To = reply's To + email's To; Cc = email's Cc; own address removed in any case; each address once, To before Cc; never Bcc). Set the heading `reply_all_heading` in `replyBox` (`src/server/emails/reply.ts`)
- [ ] T036 [US3] Integration test `tests/integration/reply-all.test.ts` (US3 scenarios 1 and 4): `?email=reply-all-<id>` box values. After removing ben and sending, the fake Sent message has exactly the remaining recipients, named with CRM names in the headers (SF-129's `namesFor`)

---

## Phase 6: User Story 4 - Forward with attachments (P2)

**Goal**: `[ FORWARD ]` opens the box with "Fwd:", the forwarded block and the email's attachments (removable,
counted in 25 MB), fetched from Gmail at send time and sent byte for byte.

**Independent Test**: spec US4 Independent Test (quote.pdf 2 MB + plan.png 300 KB; remove plan.png; send to ed@example.test).

### Tests for User Story 4

- [ ] T037 [US4] Download `storage_v0_openapi.json` from https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json at commit `aa0fb9e84b9d128342f0127c7650d8cc5b240202` into `.factory/schemas/` (`git init -q /tmp/supabase && git -C /tmp/supabase fetch -q --depth 1 https://github.com/supabase/supabase aa0fb9e84b9d128342f0127c7650d8cc5b240202 && git -C /tmp/supabase show FETCH_HEAD:apps/docs/spec/storage_v0_openapi.json > .factory/schemas/storage_v0_openapi.json`; already pinned in `scripts/fetch-schemas.mjs`: keep it). Make the fake of Supabase Storage refuse a request that the schema refuses: in `tests/unit/storage-fake.test.ts`, a test reads an object through `GET /object/authenticated/{bucket}/{path}` with an undeclared query parameter (`?download_as=x`) through `tests/fakes/storage.ts` and must fail. The forward integration test (T040) runs with that checked fake installed, attaching a record file and a computer file next to the forwarded ones
- [ ] T038 [P] [US4] Gmail attachments (schema of T009): in `tests/unit/gmail-fake-schema.test.ts`, a test calls the fake's `users.messages.attachments.get` with a wrong path parameter name or an undeclared query parameter (`?attachment_id=…`) and must fail. The check in `tests/fakes/gmail.ts` covers `messages.get` / `messages.attachments.get` paths, parameters and the `MessagePartBody` answer (extend it if a case is missing)
- [ ] T039 [P] [US4] Unit tests for `forwardSubject` and `forwardQuote` in `tests/unit/reply-rules.test.ts`:
  - `forwardSubject`: "Pricing" → "Fwd: Pricing"; "FWD: x", "Fw: x", "fw: x" unchanged; "" → "Fwd: (no subject)" (US4 scenario 5).
  - `forwardQuote`: "---------- Forwarded message ---------", "From: Ana Fake <ana@example.test>", "Date: 27 Nov 2026 at 14:05", "Subject: Pricing", "To: …", an empty line, then the text without "> " (US4 scenario 2).
  - Forward prefill: To, Cc and Bcc empty.
- [ ] T040 [US4] Integration test `tests/integration/reply-forward.test.ts` (US4 scenarios 1–4, 6–8; FR-006, FR-012; SC-002):
  - The box lists quote.pdf and plan.png with sizes; the room shows "2.3 MB of 25 MB".
  - Remove plan.png, send to ed@example.test → `fake.sentMessages` has quote.pdf with name, type and bytes equal to the earlier email's, no plan.png, the forwarded block, In-Reply-To.
  - With a record file and a computer file also attached, all are sent; a total over 25 MB is refused with `compose_attachments_too_large`.
  - `failAttachments` (or the email no longer in any working mailbox) → `reply_forward_unavailable`, nothing sent, ledger row deleted.
  - The forward is listed in the same conversation with its links unchanged.
  - The candidate order puts the user's own mailbox first.
- [ ] T041 [P] [US4] Component test in `tests/unit/reply-box.test.tsx`: a forward box shows the forwarded chips (name · size, removable), the 25 MB message while over the limit, and `[ SEND ]` calls nothing until enough are removed (US4 scenario 6)

### Implementation for User Story 4

- [ ] T042 [US4] Add `forwardSubject`, `forwardQuote` and the forward branch of `prefill` to `src/server/emails/reply-rules.ts` (research.md §5)
- [ ] T043 [US4] Add `opts?: { preferConnectionId?: number }` to `attachmentAccess` in `src/server/emails/attachments.ts`: that connection's candidate goes first, otherwise the order is unchanged (the download route passes nothing)
- [ ] T044 [US4] In `src/server/emails/reply.ts` `replyBox`, fill `reply.forwarded` from the answered email's attachments (`id`, `name`, `size`) for forward, with heading `forward_heading`. In `sendReply`, check that the `forwardIds` belong to the answered message (else `compose_attachment_gone`), count their stored sizes in the 25 MB total, and build `forwarded` with `attachmentAccess(actorId, id, { preferConnectionId })` and the stored `content_type`. In `deliver` (`src/server/emails/compose.ts`), fetch the bytes with `fetchAttachment` after the Storage reads and before `sendGmail`; `"unavailable"` → unclaim and refuse `reply_forward_unavailable`. Bytes are held in memory only and never logged
- [ ] T045 [US4] In `src/server/gmail/fake-gmail.ts`, add a `failAttachments(on)` switch that makes `messages.attachments.get` / attachment reads answer 503
- [ ] T046 [US4] In `src/app/(app)/records/EmailBox.tsx`, show forwarded attachments as removable chips labelled `reply_forwarded_label`, counted in `used`, and send `forwardIds`

---

## Phase 7: User Story 5 - Without working Gmail, a link to Settings (P3)

**Goal**: no buttons that cannot work: "[ CONNECT GMAIL TO REPLY ]" / "[ RECONNECT GMAIL TO REPLY ]" in their place;
nothing when Gmail is off.

**Independent Test**: spec US5 Independent Test.

- [ ] T047 [P] [US5] Integration test `tests/integration/reply-gmail-state.test.ts` (US5 scenarios 1–5; FR-002; SC-005):
  - Never connected / disconnected → `[ CONNECT GMAIL TO REPLY ]` linking `/settings` on every EMAIL entry and conversation email, no reply buttons.
  - `needs_reconnect` → `[ RECONNECT GMAIL TO REPLY ]`.
  - Gmail off → neither.
  - A direct `?email=reply-<id>` while not connected → the box with `compose_connect_gmail` and `[ GO TO SETTINGS ]`, no `[ SEND ]`.
  - `sendReply` while not connected sends nothing.
  - A key refused at send keeps the form (SF-129's `panelView`) and marks the connection.
- [ ] T048 [US5] Render the `connect` / `reconnect` links (to `/settings`, `.btn` in the same place) and nothing for `off` in `src/app/(app)/records/ReplyButtons.tsx`

---

## Phase 8: Polish & cross-cutting

- [ ] T049 [P] Add one reply by Ada Fake to the newest email of her seeded "Fake proposal" conversation through `sendReply`, with a fixed send key (a second run is a no-op through `(user_id, send_key)`) in `src/seed/sent-emails.ts`, and check the seed test (FR-021)
- [ ] T050 [P] Make the fake mailbox page show `thread <threadId>` and, when present, `In-Reply-To` / `References` as text for each message, in `src/app/dev/fake-gmail/page.tsx` (FR-020); cover it in `tests/integration/gmail-dev-fake.test.ts`
- [ ] T051 [P] Add an SF-130 paragraph to the `AGENTS.md` Layout naming `reply-rules.ts`, `reply.ts` (`replyBox`, `replyState`, `sendReply`, `placePendingReply`), `deliver`, `email_sends.reply_message_id`, `decideCopy` `pendingSend`, the multipart upload with `threadId`, `ReplyButtons.tsx` and `emailBase`
- [ ] T052 [P] Append SF-130 lines at the end of `docs/DECISIONS.md`: design B buttons; a Settings link in place of the buttons without Gmail; the quote read-only and always sent; From (not Reply-To) is the reply address; the forwarded block lists From, Date, Subject and To; a reply or forward adds no hand link; References keeps all ids (folded); "Email sent to …" also on the conversation page; the conversation page offers the `?from=` record's files only when visible and not archived (no blueprint exception line: `blueprints.json` is `[]`)
- [ ] T053 Run `npm run test:schemas && npm test && npm run typecheck` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test` and fix failures; then walk quickstart.md § Manual run
- [ ] T054 Write the test recipe `.factory/test-env.md`:
  - a `## Services` line for each outside service (its fake, its schema): Gmail API (`FakeGoogleMail` through `tests/fakes/gmail.ts`, `gmail-api.json`, including the multipart upload and attachment reads); Supabase Storage (`FakeStorage` through `tests/fakes/storage.ts`, `storage_v0_openapi.json`); Google OAuth 2.0 token endpoint (fake following RFC 6749, no schema); Supabase Postgres (real local Postgres, no fake);
  - `## Schemas` (each schema's GitHub URL at its commit): gmail-api.json at google-api-go-client `3f740bc15212818d4d0eb041b02c951457ff63fa`, storage_v0_openapi.json at supabase `aa0fb9e84b9d128342f0127c7650d8cc5b240202`.

  Update the existing file, keeping the other services' lines.

---

## Dependencies & Execution Order

- Setup (T001–T002) → Foundational (T003–T008) → stories.
- US1 (T009–T027) is the MVP and is needed by every other story, because all of them use `reply-rules.ts`, `reply.ts`, the box and the buttons.
- US2 (T028–T033) depends on US1's send path. US3 (T034–T036) and US4 (T037–T046) depend on US1 only, and can run in parallel with US2.
- US5 (T047–T048) depends on US1's `ReplyButtons`.
- Polish after the stories; T054 is the last task.
- Within a story, write the tests first and see them fail; T009 comes before T018/T019.

## Parallel examples

- US1: T010, T011, T012, T013, T015 together (different files); then T016 ∥ T017 ∥ T019.
- US2: T028 ∥ T029 ∥ T030.
- US4: T038 ∥ T039 ∥ T041 after T037; T042 ∥ T043 ∥ T045.
- Polish: T049 ∥ T050 ∥ T051 ∥ T052.

## Implementation Strategy

1. MVP: Setup + Foundational + US1. A reply from a timeline or the conversation page, with headers, lands in the same
   conversation when the user's mailbox holds it.
2. US2: replies to colleagues' conversations, the same Gmail thread, catch-up by the sync.
3. US3, then US4 (reply all, forward), then US5 (the Settings link).
4. Polish: seed, fake mailbox page, docs, full test run, test recipe.
