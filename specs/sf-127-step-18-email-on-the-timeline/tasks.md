---
description: "Tasks for SF-127 Email on the timeline"
---

# Tasks: Email on the timeline

**Input**: Design documents from `/specs/sf-127-step-18-email-on-the-timeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, contracts/gmail.md, quickstart.md

**Tests**: included (AGENTS.md: each test names what it covers, e.g. `// covers FR-012, US5 scenario 2`; Vitest unit +
integration on real Postgres; Gmail only through `FakeGoogleMail` installed by `tests/fakes/gmail.ts`, every request
checked against its schema). Write each story's tests first and see them fail.

**Run while working**: `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test` then
`npx vitest run <the files of the task>`; the whole `npm test && npm run typecheck` before handing over.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US7 of spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the database structure and the texts every story uses.

- [x] T001 Write `migrations/0020_email_timeline.sql` exactly as data-model.md § Migration: `create table email_conversations (id bigint generated always as identity primary key, created_at timestamptz not null default now())`; `alter table email_threads add column conversation_id bigint null references email_conversations (id)` + `create index email_threads_conversation_idx on email_threads (conversation_id)`; `alter table email_messages add column linked_at timestamptz null, add column dedupe_key text generated always as (coalesce(rfc_message_id, 'g:' || connection_id::text || ':' || gmail_message_id)) stored` + `create index email_messages_unlinked_idx on email_messages (id) where linked_at is null` + `create index email_messages_dedupe_idx on email_messages (dedupe_key)`; `create table email_conversation_addresses (conversation_id bigint not null references email_conversations (id) on delete cascade, email text not null check (email = lower(btrim(email)) and email <> '' and char_length(email) <= 254), primary key (conversation_id, email))` + index on `(email)`; `create table email_links (id bigint generated always as identity primary key, conversation_id bigint not null references email_conversations (id) on delete cascade, person_id bigint null references persons (id) on delete cascade, organisation_id bigint null references organisations (id) on delete cascade, deal_id bigint null references deals (id) on delete cascade, how text not null check (how in ('auto', 'manual')), removed boolean not null default false, changed_by bigint null references users (id), changed_at timestamptz not null default now(), check (num_nonnulls(person_id, organisation_id, deal_id) = 1))` + three partial unique indexes `(conversation_id, person_id) where person_id is not null` (same for organisation_id, deal_id) + indexes on `person_id`, `organisation_id`, `deal_id`; `alter table … enable row level security` after each `create table`; only statements allowed in a transaction; no data backfill
- [x] T002 [P] Add `email_links, email_conversation_addresses, email_conversations` to the truncate list in `tests/support/reset.ts` (before `email_attachments, email_messages, email_threads`)
- [x] T003 [P] Add the keys of contracts/routes.md § Messages to `src/server/messages.ts`: `email_no_subject` "(no subject)", `email_attachment_unavailable`, `email_not_found`, `email_linked`, `email_unlinked`, `email_link_refused`, `email_no_links`, and `templates.conversation_count(n)` ("CONVERSATION · 1 EMAIL" / "CONVERSATION · n EMAILS")

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: one conversation per email across mailboxes, processing after store, automatic links, the privacy
fragment, and the timeline entry type: every story reads these.

**⚠️ CRITICAL**: no user story work before this phase is done.

- [x] T004 [P] Unit tests in `tests/unit/emails-rules.test.ts` (covers FR-002, FR-004, FR-011) for the pure functions of T005: `emailText` (text part wins; HTML only → `htmlToText`, no `<script>`/`<style>` content, entities decoded once so `&lt;b&gt;` stays `<b>` as text), `emailPreview` (whitespace runs collapsed, at most 200 code points then "…", `null` when no text), `recipientsLine` (name else bare address; To, then "Cc …", Bcc only when given), `subjectOrDefault` ("" → messages.email_no_subject), `parseFrom` (`person-12` / `organisation-3` / `deal-5` → target; anything else → null), `mergeLinkChoice` (manual or removed beats auto; two hand choices → later `changed_at`), `contentDisposition(name)` (`attachment; filename="<ascii>"; filename*=UTF-8''<percent-encoded safeDownloadName>`, quotes and CR/LF never in the header)
- [x] T005 [P] Write `src/server/emails/rules.ts` (pure, no `@/server/db`): the functions of T004, using `htmlToText` from `src/server/pipedrive/html.ts` and `safeDownloadName` from `src/server/files/rules.ts`
- [x] T006 [P] Add `attachmentParts(payload: GmailPart): GmailPart[]` to `src/server/gmail/rules.ts` (parts with a non-empty `filename` or a `body.attachmentId`, in the existing walk order) and rewrite `readMessage` on top of it; extend `tests/unit/gmail-rules.test.ts` (covers FR-006): positions of a nested multipart with an inline image and two files are the same as before the change
- [x] T007 Add `visibleConversation(db, viewer, alias = "c")` to `src/server/records/visibility.ts` per data-model.md § Visibility (no address of `c` belongs to a person not `visiblePerson`; no link of `c` with `removed = false` to a person not `visiblePerson` or a deal not `visibleDeal`); comment that every read of the email tables for a viewer uses it
- [x] T008 Write `src/server/emails/process.ts`: `processMessage(db, messageId)` per data-model.md § Processing (1 `lock table email_conversations in share row exclusive mode`; 2 thread's conversation: own → another thread with a message of the same `rfc_message_id` → new; two conversations → merge into the smaller id: threads moved, addresses `on conflict do nothing`, links merged by `mergeLinkChoice`, the other row deleted; 3 addresses From/To/Cc/Bcc into `email_conversation_addresses`; 4 `autoLink`; 5 `update persons set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'::timestamptz), received_at)` for every person with one of the email's addresses; 6 `linked_at = now()`), `autoLink(db, conversationIds)` per research.md §5 (people by address; their current organisation; the one open (`status = 'open' and archived_at is null`) deal where they are `deals.person_id` or in `deal_people`, only for people whose link is not `removed`; all `insert … on conflict do nothing`, `how = 'auto'`), `linkForPeople(db, personIds)` (conversations with an address of those people → `autoLink`), `catchUpEmails(now)` (≤ 500 messages `where linked_at is null order by id`, one `sql.begin()` each)
- [x] T009 Call `processMessage(db, msg.id)` at the end of `storeMessage`'s transaction in `src/server/gmail/sync.ts`, and `await catchUpEmails(now)` in `runGmailCheck` right after the `mode === "off"` return (inside a try so a failure never stops the check)
- [x] T010 Extend `src/server/records/timeline.ts`: `EventKind` gains `"email"`, `TimelineEntry` gains `email: TimelineEmail | null` (contracts/routes.md § Server functions; every existing entry builder sets `email: null`), and `src/server/records/timeline-view.ts` `entryTag` returns `"EMAIL"` for kind `email` (`EntryTag` gains it); update `tests/unit` timeline-view tests for the tag

**Checkpoint**: emails copied by the sync are grouped, linked and raise Last contacted; nothing shows yet.

---

## Phase 3: User Story 1 - See a contact's emails on their timeline (Priority: P1) 🎯 MVP

**Goal**: an EMAIL entry per email on the timelines of linked people, organisations and deals, and in the deal drawer.

**Independent Test**: connect Ada with the fake Gmail, deliver Ana's message with figures.pdf (240 KB), sync, and see
one EMAIL entry on Ana's, Example Ltd's and the deal's page and in the drawer.

### Tests for User Story 1

- [x] T011 [US1] Download `gmail-api.json` from `https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json` at commit `3f740bc15212818d4d0eb041b02c951457ff63fa` into `.factory/schemas/` (`git init -q /tmp/google-api-go-client && git -C /tmp/google-api-go-client fetch -q --depth 1 https://github.com/googleapis/google-api-go-client 3f740bc15212818d4d0eb041b02c951457ff63fa && git -C /tmp/google-api-go-client show FETCH_HEAD:gmail/v1/gmail-api.json > .factory/schemas/gmail-api.json`), and make the fake of Gmail API refuse a request that the schema refuses: a test sends a wrong field and must fail — in `tests/unit/gmail-fake-schema.test.ts`, a `messages.get` with an undeclared query parameter (e.g. `formatt=full`) and an answer whose `payload.parts[].body` carries an undeclared property (through the existing "change the next answer" hook) must both throw from `tests/fakes/gmail.ts`
- [x] T012 [P] [US1] Google OAuth 2.0 token endpoint (no schema on GitHub): the fake in `src/server/gmail/fake-gmail.ts` follows Google's documentation "Using OAuth 2.0 for Web Server Applications — Refreshing an access token" (https://developers.google.com/identity/protocols/oauth2/web-server#offline) and RFC 6749 §6 / §5.2: it copies `400 invalid_grant` for a revoked or unknown refresh token, `401 invalid_client` for a wrong client, `400 invalid_request` for a missing parameter, a form body required, and access tokens that expire after 3600 s; add to `tests/unit/gmail-fake-oauth.test.ts` a refresh with `refresh_tokn=` (wrong field name) that must get `invalid_request`, so the download's refresh (US2) is covered
- [x] T013 [P] [US1] Integration test `tests/integration/emails-timeline.test.ts` (covers FR-001, FR-002, FR-003, FR-004, US1 scenarios 1–7, SC-001, SC-007) using `tests/integration/gmail-helpers.ts`: Ana (ana@example.test) at Example Ltd, main person of one open deal; a message Ana → Ada "Proposal", text "Hi Ada, here are the figures we discussed last week…", figures.pdf 240 KB; after `syncConnection`, `readTimeline` for Ana, Example Ltd and the deal each holds one entry of kind `email` with tag EMAIL, `received_at` time, sender/recipients, subject, preview, attachment; Ada's reply comes newest first; Ben (Other Co) in Cc → on Ben's and Other Co's timelines too; the same message in Ada's and Bob's mailboxes → one entry each timeline; an HTML-only message → preview has no markup; entries page with notes and activities (`limit` and `more`)

### Implementation for User Story 1

- [x] T014 [US1] Write `src/server/emails/timeline.ts` `timelineEmails(viewerId, target, limit)`: conversations linked directly (`email_links.removed = false`, the target's column) and `visibleConversation`; the shown copy per `distinct on (t.conversation_id, m.dedupe_key)` ordered `(m.direction = 'sent') desc, m.id`; then `received_at desc, id desc`, `limit + 1`; attachments of those messages in one query (`position` order); entries with `createdAt = received_at`, `preview = emailPreview(...)`
- [x] T015 [US1] Merge `timelineEmails` into `selectEntries` in `src/server/records/timeline.ts` when `show.activitiesOf` is set (record timelines and drawer; not the ambassador's latest updates), sorted with events and activities, page = first `limit`
- [x] T016 [P] [US1] Write `src/app/(app)/records/EmailEntry.tsx` (server): `<li id="email-<messageId>">`, tag `.kd.email`, the recipients line, a box `.emailbody` with the subject linking to `/emails/<conversationId>?from=<kind>-<id>#email-<messageId>`, the preview, `name · formatFileSize(size)` per attachment; text nodes only
- [x] T017 [US1] Render `EmailEntry` for `e.email` in `src/app/(app)/records/RecordTimeline.tsx`, and make [ SHOW MORE ]'s anchor `email-<id>` when the last entry is an email
- [x] T018 [P] [US1] CSS in `src/app/globals.css`: `.kd.email { background: var(--blue); color: #fff; border-color: var(--blue); }`, `.emailbody` like `.notebody` with `border-left: 3px solid var(--blue)` and `background: var(--wash)`, `.emailatt` line

**Checkpoint**: US1 works with the fake Gmail.

---

## Phase 4: User Story 2 - Read the whole conversation and its attachments (Priority: P1)

**Goal**: the conversation page (design B) and attachment downloads through Gmail.

**Independent Test**: a three-message conversation (one HTML-only with script and image, one with an attachment):
opened oldest first as plain text; the download returns the fake's bytes under its name.

### Tests for User Story 2

- [x] T019 [US2] Add `GET messages/{id}/attachments/{attachmentId}` to the Gmail fake in `src/server/gmail/fake-gmail.ts` per contracts/gmail.md (`NewMessage.attachments[].data` / `inline`, bytes kept per message and attachment id, `200 { size, data }` base64url, Gmail 404 error body when unknown, same token checks and `down()`) AND make `tests/fakes/gmail.ts` check it against `users.messages.attachments.get` of `.factory/schemas/gmail-api.json` (path, query parameters, `MessagePartBody` answer properties `attachmentId`, `size`, `data` and their types); in `tests/unit/gmail-fake-schema.test.ts` a request with an undeclared query parameter and an answer with an undeclared property (`dataa`) must both throw
- [x] T020 [P] [US2] Integration test `tests/integration/emails-conversation.test.ts` (covers FR-004, FR-005, US2 scenarios 1, 2, 5, SC-003, SC-004): `getConversation` returns the emails oldest first, once each across two mailboxes, To/Cc (Bcc only on the sent copy), full text; render the page server component output and assert no `<script`, `<img`, `<style` from the email and `&lt;b&gt;` escaped; count template "CONVERSATION · 3 EMAILS"; back link from `?from=person-<id>` only when visible
- [x] T021 [P] [US2] Integration test `tests/integration/emails-attachments.test.ts` (covers FR-006, US2 scenarios 3–4): the route `GET /emails/attachments/<id>/download` returns 200 with the fake's bytes, `content-type: application/octet-stream`, `content-disposition: attachment; filename*=UTF-8''figures.pdf`, `x-content-type-options: nosniff`, `content-security-policy: sandbox`, `cache-control: no-store`; inline small part served without an attachments.get call; own mailbox disconnected / `needs_reconnect` / fake `down()` / message deleted from the fake → 303 to `/emails/<cid>?notice=attachment-unavailable#email-<mid>`; the same email also in Bob's working mailbox → 200 through Bob's; a refused key marks that connection `needs_reconnect`

### Implementation for User Story 2

- [x] T022 [P] [US2] Add `getAttachment(accessToken, messageId, attachmentId): Promise<Uint8Array | null>` to `src/server/gmail/google-api.ts` (through `gmail()`, 30 s time-out for this call only, 404 → null, missing `data` → `GoogleUnavailable(200, "bad_attachment")`)
- [x] T023 [US2] Write `src/server/emails/conversations.ts` `getConversation(viewerId, id)` (null unless `visibleConversation`; subject of the oldest shown email; emails oldest first `received_at asc, id asc` one per `dedupe_key`, with `emailText` full text and attachments; links not removed with kind, name, archived)
- [x] T024 [US2] Write `src/server/emails/attachments.ts`: `attachmentAccess(viewerId, id)` (attachment, its email's conversation visible, candidates = copies of the same `dedupe_key` in the conversation whose connection `state = 'working'`, own first then by id) and `fetchAttachment(access)` (per candidate, no transaction: `loadKey` → `refreshAccessToken` → `getMessage` → `attachmentParts(payload)[position]` with the same decoded name → `body.data` or `getAttachment`; `GoogleKeyRefused` → `markNeedsReconnect`, next; `GoogleUnavailable` / null → next; none → `"unavailable"`)
- [x] T025 [US2] Write the route `src/app/(app)/emails/attachments/[id]/download/route.ts` (`export const maxDuration = 60`; `requireUser()`; hidden or missing → 404; bytes as a `ReadableStream` in 1 MiB chunks with the headers of contracts/routes.md; unavailable → 303 with `cache-control: no-store`)
- [x] T026 [P] [US2] Write `src/app/(app)/emails/EmailBody.tsx` (one `<article id="email-<id>">`: sender name and address, date and time `formatDateTime`, To / Cc / Bcc lines, text in a `white-space: pre-wrap` block, attachments `name · size` with [ DOWNLOAD ] as a plain `<a>`)
- [x] T027 [US2] Write `src/app/(app)/emails/[id]/page.tsx` and `not-found.tsx` (design B: `requireUser()`, `parseId`, `getConversation` else `notFound()`; back link from `parseFrom` when the record is visible, name in capitals; "CONVERSATION · N EMAILS"; subject h1; `.recordcols` with // LINKED TO (read-only list for now) and // EMAILS · OLDEST FIRST; `?notice=` mapped to fixed messages only) and the `.conv*` CSS in `src/app/globals.css`

**Checkpoint**: entries open their conversation; attachments download.

---

## Phase 5: User Story 3 - Conversations link themselves (Priority: P1)

**Goal**: every linking case of FR-007 to FR-009, including people added later and conversations met in two mailboxes.

**Independent Test**: one conversation per linking case through the fake Gmail; check which timelines show it.

### Tests for User Story 3

- [x] T028 [P] [US3] Integration test `tests/integration/emails-linking.test.ts` (covers FR-007, FR-008, FR-009, US3 scenarios 1–9): second address of Ana; main and linked person of one open deal; two open deals → none; only Won/Lost/archived → none; Ana and Ben with one deal each → both; person added later with the address (`createPerson`) and address added to an existing person (`updatePerson`) → linked with organisation and deal; a later email adds a CRM person in Cc; Ana's only open deal private to Ada → linked, Ada sees it, Bob does not; CSV import and Pipedrive import of a person with the address → linked; a removed person link brings no deal
- [x] T029 [P] [US3] Integration test `tests/integration/emails-processing.test.ts` (covers FR-003, research.md §1–3): two mailboxes' threads that are separate conversations, then one shared Message-ID arrives → merged into the smaller id with the links by `mergeLinkChoice`; rows inserted with `linked_at` null then `runGmailCheck` → processed (emails copied before SF-127); a second `processMessage` changes nothing

### Implementation for User Story 3

- [x] T030 [US3] Call `linkForPeople(db, [row.id])` at the end of `createPerson` and `linkForPeople(db, [id])` at the end of `updatePerson` transactions in `src/server/records/people.ts`
- [x] T031 [P] [US3] Call `linkForPeople(db, <new person ids>)` at the end of the people `runImport` transaction in `src/server/imports/imports.ts`
- [x] T032 [P] [US3] Call `linkForPeople(db, <people added in the page>)` in the people page transaction of `src/server/pipedrive/imports.ts`

**Checkpoint**: all P1 stories work.

---

## Phase 6: User Story 5 - Private people and deals keep their conversations hidden (Priority: P1)

**Goal**: FR-012 everywhere: timelines, the conversation page, attachments, link actions.

**Independent Test**: Pia private to Ada in a conversation with Ana: Ada sees it everywhere, Bob nowhere, including by
address.

- [x] T033 [US5] Integration test `tests/integration/emails-privacy.test.ts` (covers FR-012, US5 scenarios 1–6, SC-002): Bob gets no entry on Ana's, Pia's or the organisations' timelines, `getConversation` null, the page `notFound()`, the attachment route 404 with no subject or name in the body; linking to Ada's private deal hides it from Bob; Pia made shared → Bob sees it; unlinked Pia still hides it; Bob sees a conversation from Ada's mailbox when he can see everyone in it; admins follow the same rule
- [x] T034 [US5] Make every read in `src/server/emails/*.ts` go through `visibleConversation` (review `timeline.ts`, `conversations.ts`, `attachments.ts` against T033) and fix any read that does not

---

## Phase 7: User Story 4 - Link or unlink a conversation by hand (Priority: P2)

**Goal**: // LINKED TO with [ UNLINK ], [ LINK DEAL ] / [ LINK PERSON ] / [ LINK ORGANISATION ]; hand choices stay.

**Independent Test**: unlink the automatic deal, link another deal, a person and an organisation; a new email keeps
the links as set.

- [x] T035 [P] [US4] Integration test `tests/integration/emails-manual-links.test.ts` (covers FR-010, FR-011, FR-013, US4 scenarios 1–6, SC-005): `linkRecord` to a visible deal / person / organisation shows on its timeline; archived or hidden target → `refused`; hidden conversation → `not_found`; `unlinkRecord` removes it from the timeline; a new email and `linkForPeople` never put it back; linking a removed row again works; `linkChoices` offers only visible, not archived records (deals of any status)
- [x] T036 [US4] Add `linkChoices`, `linkRecord(actorId, input)` and `unlinkRecord(actorId, input)` to `src/server/emails/conversations.ts` per data-model.md § State changes (conversation row `for update` + `visibleConversation`; target visible and not archived; `how = 'manual'`, `removed`, `changed_by`, `changed_at`)
- [x] T037 [US4] Write `src/app/(app)/emails/actions.ts` (`"use server"`; `requireUser()` first; `linkRecord`, `unlinkRecord`; `revalidatePath`; redirect to `/emails/<id>?from=…&notice=linked|unlinked|link-refused`, `from` re-parsed with `parseFrom`)
- [x] T038 [US4] Write `src/app/(app)/emails/[id]/LinkedTo.tsx` (kind tag PERSON / ORG / DEAL, name link, Archived badge, [ UNLINK ] form; `messages.email_no_links` when empty; [ LINK DEAL ] / [ LINK PERSON ] / [ LINK ORGANISATION ] links to `?link=…`; the form for `?link=` with `PersonPicker` (`name="dealId"`, `label="Deal"` for deals; `personId`) or `OrganisationPicker`, [ LINK ] and [ CANCEL ]) and use it in `src/app/(app)/emails/[id]/page.tsx`

---

## Phase 8: User Story 6 - Email raises Last contacted (Priority: P2)

**Goal**: FR-014 (built in T008); proved here.

- [x] T039 [US6] Integration test `tests/integration/emails-last-contacted.test.ts` (covers FR-014, US6 scenarios 1–4, SC-006): 20 Nov → email 25 Nov 14:05 raises it; 25 Nov → email of 22 Nov leaves it; Bcc person raised; private person raised; a person with two of their addresses in one email raised once to the same value; a done call later than the email still wins

---

## Phase 9: User Story 7 - Details on the left, timeline on the right (Priority: P2)

**Goal**: FR-015 on the person, organisation and deal pages.

- [x] T040 [US7] Write `src/app/(app)/records/TimelineNoteBox.tsx` (the note box and its mention candidates, as `RecordTimeline` did) and remove the note box from `src/app/(app)/records/RecordTimeline.tsx` (note edit / delete stay in the entries)
- [x] T041 [US7] Two columns in `src/app/(app)/people/[id]/page.tsx`, `src/app/(app)/organisations/[id]/page.tsx` and `src/app/(app)/deals/[id]/page.tsx`: header and notices above; `.recordcols` left = // DETAILS (+ deal stage bar, value, linked people), // MORE DETAILS, Referred by; right = `TimelineNoteBox` (not archived), // NEXT ACTIVITIES, // FILES, // TIMELINE; the deal drawer unchanged
- [x] T042 [P] [US7] CSS in `src/app/globals.css`: `.recordcols { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); gap: 32px; align-items: start; }`, `.recordcols .details { grid-template-columns: 1fr; }`, under `max-width: 1000px` one column
- [x] T043 [US7] Integration/page test `tests/integration/record-layout.test.ts` (covers FR-015, US7 scenarios 1, 3): rendered person, organisation and deal pages have the details inside the left column and, in order, note box, NEXT ACTIVITIES, FILES, TIMELINE in the right one; existing note, activity, file and Won tests still pass

---

## Phase 10: Polish & Cross-Cutting Concerns

- [x] T044 [P] Seed: give the attachments of `src/seed/gmail.ts` fake bytes (`data`) so [ DOWNLOAD ] works in development; check the seeded conversations show on their people's timelines after `npm run db:seed`
- [x] T045 [P] Update `AGENTS.md` § Layout: `src/server/emails/` (rules, process, conversations, timeline, attachments), `visibleConversation()` in `records/visibility.ts`, `src/app/(app)/emails/` (page, LinkedTo, EmailBody, actions, the download route), `TimelineNoteBox.tsx`, `EmailEntry.tsx`, the new tables; and `README.md` if a command or setting changed (none expected)
- [x] T046 Run `npm test && npm run typecheck` and walk quickstart.md § By hand with the fake Gmail
- [x] T047 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) and `## Schemas` (each schema's GitHub URL at its commit) — update the existing file: Gmail API (`FakeGoogleMail` via `tests/fakes/gmail.ts`, now also `users.messages.attachments.get`, schema `gmail-api.json` https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json) and Google OAuth 2.0 token endpoint (same fake, no schema: Google's "Using OAuth 2.0 for Web Server Applications" and RFC 6749, the errors it copies)

---

## Fix round 1

- [x] T048 Write the tests first (they fail now): in `tests/integration/emails-attachments.test.ts` (fake Gmail):
  (1) an email with two attachments of the same name, copied into two mailboxes, the viewer's own mailbox disconnected:
  downloading the second attachment gives the second part's bytes, not the first's; (2) the download with
  `?from=person-<id>` when no working mailbox holds the email: the 303 `location` is
  `/emails/<conv>?from=person-<id>&notice=attachment-unavailable#email-<m>`; with `?from=<junk>` it has no `from`; and
  a check (unit test, reading `docs/DECISIONS.md`) that it has an SF-127 line on each of: Message-ID matching, deal
  conversations not shown on the deal's people or organisation, no CHANGE entry or notification for linking, automatic
  links staying when their reason changes. Name what each covers (`// covers Fix round 1, FR-006, Edge Cases`)
- [x] T049 Add the four lines of plan.md § Fix round 1 step 1 to `docs/DECISIONS.md`
- [x] T050 Keep `from` on the attachment download: `EmailBody.tsx` link `?from=`, the page passes it, the route puts
  `fromParam(parseFrom(...))` back in the 303 (plan.md § Fix round 1 step 2)
- [x] T051 Match the fallback copy's attachment by position and name in `attachmentAccess` (plan.md § Fix round 1 step 3)
- [x] T052 Run `npm test && npm run typecheck` (T048 → T049–T051 → T052)

## Dependencies & Execution Order

- Setup (T001–T003) → Foundational (T004–T010) → stories.
- US1 (T011–T018) first: the timeline entry is the MVP. US2 needs T010 and the page CSS of T018 only; US3 needs
  Foundational only; US5 needs US1 and US2 code to check; US4 needs US2's page; US6 needs Foundational only; US7 is
  independent of email code except T017 (both edit `RecordTimeline.tsx`: do T017 before T040).
- T047 is the last task.

## Parallel Example: User Story 1

```text
T012 token endpoint fake test   ┐
T013 emails-timeline test       ├ together after T011
T016 EmailEntry.tsx             │
T018 CSS                        ┘
```

Also in parallel: T020 / T021 / T022 / T026 (US2), T028 / T029 / T031 / T032 (US3), T039 (US6), T042 (US7).

## Implementation Strategy

1. MVP: Setup + Foundational + US1 → emails on timelines with the fake Gmail.
2. US2 + US3 + US5 → all P1: reading, attachments, linking cases, privacy proven.
3. US4, US6, US7 → manual links, Last contacted proven, the two-column pages.
4. Polish, then the test recipe (T047) last.

## Notes

- No Google call inside `sql.begin()`; email HTML never in the page (no `dangerouslySetInnerHTML`, no iframe).
- `blueprints.json` is `[]` (no blueprint index in this run): no blueprint test task and no `docs/DECISIONS.md` line.
- No new dependency (`dependencies.json` `[]`).
