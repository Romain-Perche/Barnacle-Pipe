# Research: Email on the timeline (SF-127)

No item of the Technical Context was left as NEEDS CLARIFICATION; each choice below is settled.

## 1. One conversation across mailboxes

- **Decision**: new table `email_conversations`; `email_threads.conversation_id` points at it. When a message is
  stored, its thread's conversation is, in order: the thread's own (already set); else the conversation of any other
  thread holding a message with the same `rfc_message_id`; else a new one. When the thread already has a conversation
  and another conversation also holds that Message-ID, the two are merged into the older (smaller id): threads,
  addresses and links move, then the newer row is deleted.
- **Rationale**: Gmail thread ids are per mailbox; the Message-ID header is the email's own id and is the same in every
  copy (spec Assumptions). The merge covers copies that met only later.
- **Concurrency**: `processMessage` starts with `lock table email_conversations in share row exclusive mode` (the
  pattern of `organisations` / `person_emails` in imports): two mailboxes storing the same email at once cannot make
  two conversations. Volume is small (≤ 300 messages per run per mailbox).
- **Alternatives**: grouping on read by Message-ID with no table (no place for links and unlinks of "the conversation
  as a whole"); `References`/`In-Reply-To` headers (not stored by SF-118, and Gmail's own threading already did that
  inside each mailbox).

## 2. Showing each email once

- **Decision**: `email_messages.dedupe_key text generated always as (coalesce(rfc_message_id, 'g:' || connection_id ||
  ':' || gmail_message_id)) stored`. Reads take `distinct on (conversation_id, dedupe_key)` ordered by
  `(direction = 'sent') desc, id`: the sender's copy (shows its Bcc, FR-002), else the first stored.
- **Alternatives**: deleting duplicate rows (each mailbox's copy is needed to fetch attachments through it).

## 3. Processing after store, and the emails already copied

- **Decision**: `email_messages.linked_at timestamptz null`. `processMessage(db, id)` runs inside `storeMessage`'s
  transaction and sets it. `catchUpEmails(now)` (first thing in `runGmailCheck` after the mode check) takes up to 500
  messages `where linked_at is null` oldest first, each in its own transaction with the same function.
- **Rationale**: one code path for new and old emails, testable in integration tests (insert rows with `linked_at`
  null, run the check); AGENTS.md forbids running migrations at app start, and a SQL backfill would copy the linking
  rules a second time.
- **Alternatives**: a backfill in the migration (duplicated rules, untested); a one-off script (someone must run it).

## 4. Links and remembered unlinks

- **Decision**: `email_links (conversation_id, person_id | organisation_id | deal_id, how 'auto'|'manual', removed bool,
  changed_by, changed_at)`, a partial unique index per target kind. Automatic linking only ever does
  `insert … on conflict do nothing`: a removed row blocks it (FR-011, SC-005), an existing manual row is left as is.
  A hand link of a removed row sets `removed = false, how = 'manual'`; an unlink sets `removed = true`. Deleting a
  record deletes its rows (`on delete cascade`). Automatic links are never removed by the CRM (spec: they stay when
  the reason changes).
- **Merge of two conversations' links**: same target in both → a hand choice (manual, or removed) beats auto; two
  hand choices → the later `changed_at` wins (spec Clarifications, Plan 2026-11-26). Pure `mergeLinkChoice(a, b)`.
- **No CHANGE entry, no notification** for link changes (spec Assumptions).

## 5. Automatic linking rule (FR-007, FR-008)

- **Decision**: `autoLink(db, conversationIds)` in three set-based statements:
  1. people: every `person_emails.person_id` whose `email` is in `email_conversation_addresses` of the conversation →
     auto link (on conflict do nothing).
  2. organisations: for those people whose link row is not removed, their current `organisation_id`.
  3. deals: for those people (link not removed), the deals with `status = 'open' and archived_at is null` where they
     are `deals.person_id` or in `deal_people`; a person with exactly one such deal brings it. Deal privacy does not
     count (spec Clarifications A).
- Runs: after a stored email (its conversation), and `linkForPeople(db, personIds)` after a person is added or saved
  (all conversations having one of the person's addresses) and after CSV / Pipedrive people imports (their new
  people). Idempotent, so running it again changes nothing.
- Addresses compared lower-cased: `person_emails.email` and SF-118's parsed addresses are both stored lower-case.

## 6. Visibility (FR-012)

- **Decision**: `visibleConversation(db, viewer, alias = "c")`:
  `not exists (address of c → person_emails → persons not visiblePerson)`
  `and not exists (link of c, not removed, to a person not visiblePerson)`
  `and not exists (link of c, not removed, to a deal not visibleDeal)`. Organisations are never private.
- Hidden ⇒ every read answers as missing: no timeline entry, conversation page `notFound()`, attachment route 404,
  link actions `not_found`. A private person unlinked by hand still hides it (they are in its addresses, US5 AS6).
- Visibility follows current state (a person made shared shows it at once: US5 AS4); nothing stored.

## 7. Timeline entries

- **Decision**: email entries are read from the email tables and merged in `selectEntries` like done activities (each
  side reads `limit + 1`, merged newest first). Only conversations linked directly to the record (spec Assumption:
  no inheritance from a deal to its people and organisation). Time: `received_at` (Gmail's time, DECISIONS SF-118).
  Day groups and [ SHOW MORE ] are unchanged; the SHOW MORE anchor uses `email-<id>` for an email.
- **Preview**: `emailText(text_body, html_body)`: the text part, else `htmlToText(html)` (existing, pure, drops
  script/style), whitespace runs collapsed for the preview; first 200 code points then "…". No text → no line.
- **Recipients line** "Sender → To names (Cc …)": name, else bare address; teammates by name as written in the header.

## 8. Never rendering email HTML (FR-004, SC-003)

- **Decision**: the page receives only strings from `emailText`; React text nodes in a `white-space: pre-wrap` block.
  No `dangerouslySetInnerHTML`, no iframe (unlike the campaign preview, there is nothing to render). Links in the text
  are plain text. Tests assert the page HTML has no `<script`, `<img`, `<style` from an email body and that a body
  `<b>x</b>` appears escaped.

## 9. Fetching an attachment (FR-006)

- **Decision**: SF-118 stores only name, type, size and the part's position in `readMessage`'s walk. The download:
  1. `attachmentAccess(viewerId, id)` (visibleConversation) → the email's `dedupe_key`, `position`, `name`.
  2. candidates: every copy of that email (`same conversation and dedupe_key`) whose connection `state = 'working'`,
     the attachment's own copy first, then by id. No transaction held.
  3. per candidate: `loadKey` → `refreshAccessToken` → `getMessage(gmail_message_id)` → `attachmentParts(payload)[position]`;
     its name must equal the stored name (else treat as gone); bytes = `body.data` when inline, else
     `getAttachment(access, gmailMessageId, body.attachmentId)` (`attachmentId` is not stable across Gmail reads, so it
     is never stored). `GoogleKeyRefused` → `markNeedsReconnect` and next; `GoogleUnavailable` / 404 / missing part → next.
  4. none → 303 `/emails/<conversationId>?notice=attachment-unavailable#email-<messageId>`.
- **Response**: the decoded bytes in a `ReadableStream` (chunks of 1 MiB), `content-type: application/octet-stream`,
  `content-disposition: attachment; filename="<ascii>"; filename*=UTF-8''<percent-encoded safeDownloadName>`,
  `x-content-type-options: nosniff`, `content-security-policy: sandbox`, `cache-control: no-store`,
  `referrer-policy: no-referrer`. `maxDuration = 60`; `getAttachment` time-out 30 s (others stay 10 s).
- **Rationale**: Vercel's 4.5 MB body limit applies to buffered function responses; streamed responses are not held to
  it, so 25 MB Gmail attachments pass. If preview testing shows otherwise, the fallback is the SF-116 pattern (copy to
  Storage, 303 to a 60-second address) — noted, not built.
- **Alternatives**: storing the bytes at sync time (DECISIONS SF-118: never their contents); redirecting to Gmail (needs
  the user's own Google session and leaks nothing useful to teammates).

## 10. Back link and link pickers

- `?from=person-<id>|organisation-<id>|deal-<id>` → `parseFrom` (pure) → the record's name if the viewer can see it
  ("← ANA EXAMPLE"); else no back link. Never shown as typed.
- `?link=deal|person|organisation` opens the matching form in // LINKED TO (server-rendered, the existing
  `PersonPicker` with `name`/`label`, and `OrganisationPicker`), choices from `linkChoices(viewerId)`: visible, not
  archived (deals of any status). The action re-checks visibility and archived state in its transaction.

## 11. Layout (FR-015)

- `.recordcols { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); gap: 32px; align-items: start; }`,
  one column under 1000 px, details first. `.details` inside the left column is one column. The header
  ([ EDIT ] / [ ARCHIVE ]) stays above both. The note box leaves `RecordTimeline` for `TimelineNoteBox`, first in the
  right column, so the order is note box, // NEXT ACTIVITIES, // FILES, // TIMELINE. Note edit/delete stays in the
  timeline entries. The deal drawer keeps one column and no note box.
