# Implementation Plan: Reply and forward

**Branch**: `factory/sf-130-step-25-reply-and-forward` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-130-step-25-reply-and-forward/spec.md`

## Summary

`[ REPLY ]`, `[ REPLY ALL ]` and `[ FORWARD ]` (design B: small framed buttons at the right of each email's top line)
on every EMAIL entry of a timeline and every email of SF-127's conversation page. Without a working Gmail connection,
a `[ CONNECT GMAIL TO REPLY ]` / `[ RECONNECT GMAIL TO REPLY ]` link to Settings takes their place. Each button opens
SF-129's right-side email box through a new `?email=reply-<id>` / `reply-all-<id>` / `forward-<id>` value. The box is
prefilled by pure rules (recipients, "Re:" / "Fwd:", a read-only plain-text quote) and, for a forward, with the
email's attachments, which are fetched from Gmail only at send time (SF-127's `fetchAttachment`).

Sending reuses SF-129's path (ledger, Storage reads, `sendGmail`, `storeMessage`), refactored into one shared
`deliver`. The changes:

- `sendGmail` takes explicit In-Reply-To / References built from the CRM's stored Message-IDs.
- When the user's own mailbox holds the conversation, the email goes in that Gmail thread, through Gmail's
  multipart upload (so 25 MB of attachments still fit).
- The ledger row names the answered email (`email_sends.reply_message_id`, migration 0022). Inside `storeMessage`, a
  reply that starts a new Gmail thread is placed in the answered email's conversation before SF-127's
  `processMessage` runs. Whoever stores it first, the send path or the sync, puts it in the same conversation with
  the same links.
- No hand link is added. The sync copies a pending send even when no CRM address is in it.

## Technical Context

**Language/Version**: TypeScript 5 on Node (Next.js 16 App Router, React 19)

**Primary Dependencies**: `next`, `react`, `postgres` (postgres.js); no new package (`dependencies.json`: `[]`)

**Storage**: Postgres. Migration `0022_email_reply.sql` adds one column, `email_sends.reply_message_id`. The SF-118 /
SF-127 / SF-129 tables are otherwise unchanged. Forwarded attachments are never stored.

**Testing**: Vitest unit + integration on real Postgres; fake Gmail (`FakeGoogleMail`) and fake Storage checked against
the pinned schemas (`npm run test:schemas`); `happy-dom` component tests (SF-129's setup) for the box and buttons

**Target Platform**: Vercel (server actions; `maxDuration = 60` on the four record pages and the conversation page)

**Project Type**: web application (single Next.js project)

**Performance Goals**: a reply without attachments = one token refresh + one upload, plus a few small reads. A forward
with 25 MB fits in 60 s: Gmail reads are 10 s per call, Storage reads 30 s each, the upload 40 s. The total time
budget is SF-129's.

**Constraints**: no Google or Storage call inside `sql.begin()`; fixed messages only; the quote and every address or
subject are text nodes; the quote is rebuilt on the server at send time (never taken from the client); Gmail upload
≤ 36,700,160 bytes; the 100,000-character limit counts the typed text only

**Scale/Scope**: a small team (≈10 users); conversations of tens of emails; ≤ 100 addresses, ≤ 25 MB per email

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so the gates are the repo's own rules (`AGENTS.md`
§ Rules and § Tests, `docs/DECISIONS.md`):

| gate | status |
|---|---|
| Server components by default; client only where the browser is needed | PASS — buttons and overlay are server; only SF-129's `EmailBox` (client) grows |
| Every page `requireUser()`; every action `requireUser()` first; no reliance on hidden links | PASS — `sendEmailReply` re-checks Gmail, the conversation's visibility, the answered email, the record and every attachment (FR-013, FR-018) |
| User-facing text from `messages.ts`; nothing from the URL; redirects via `isSafeNext` | PASS — new `reply_*` messages; `?email=` parsed to a mode and id only; `back` checked |
| Migrations transaction-safe, RLS after every `create table`, never at app start | PASS — `0022` is one `alter table … add column` |
| Fakes only for outside services, checked against their schemas | PASS — multipart upload checked against `gmail-api.json` `mediaUpload.protocols.simple` |
| Fake data clearly fake; only when `isFakeAllowed()` | PASS — one seeded reply by Ada Fake |
| No secrets; every setting in `.env.example` and README | PASS — no new setting |
| SF-127: every read of email tables for a viewer through `visibleConversation()` | PASS — `replyBox` and `sendReply` read the answered email joined to its conversation under `visibleConversation` |
| SF-127: automatic linking only `insert … on conflict do nothing`; hand choices never changed | PASS — no new link code; `processMessage` unchanged |
| No Google call inside `sql.begin()` | PASS — order in `contracts/routes.md` |

Post-design re-check: PASS, no violation (Complexity Tracking empty).

## Project Structure

### Documentation (this feature)

```text
specs/sf-130-step-25-reply-and-forward/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── routes.md        # buttons, ?email= values, the box's props, sendEmailReply
│   └── google.md        # Gmail multipart upload, headers, attachments, the fake's check
├── dependencies.json    # []
├── blueprints.json      # [] (from Specify; no blueprint index in this workspace)
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
migrations/0022_email_reply.sql                   # email_sends.reply_message_id
src/server/emails/reply-rules.ts                  # NEW pure, client-safe: parseEmailParam, prefill, subjects, quote,
                                                  #     quoteDate, references, bodyWithQuote
src/server/emails/reply.ts                        # NEW replyBox, replyState, sendReply, placePendingReply
src/server/emails/compose.ts                      # deliver (shared steps 5–9), EmailBox type (+cc, names, reply,
                                                  #     record nullable), namesFor exported
src/server/emails/attachments.ts                  # attachmentAccess(…, { preferConnectionId })
src/server/gmail/rules.ts                         # buildMime: References folding, references as list; decideCopy pendingSend
src/server/gmail/google-api.ts                    # sendRawUpload(access, mime, threadId?) multipart; drop sendRaw /
                                                  #     getThreadMetadata when unused
src/server/gmail/send.ts                          # SendInput inReplyTo / references; threadId → multipart upload
src/server/gmail/sync.ts                          # storeMessage → placePendingReply before processMessage; runOnce pendingSend
src/server/gmail/fake-gmail.ts                    # multipart upload, SentMessage inReplyTo / references, attachment failure switch
src/app/dev/fake-gmail/page.tsx                   # thread, In-Reply-To, References per message
src/server/messages.ts                            # reply_* texts
src/app/(app)/records/RecordTimeline.tsx          # emailHref → emailBase; reply state to EmailEntry
src/app/(app)/records/EmailEntry.tsx              # .eh row + ReplyButtons
src/app/(app)/records/ReplyButtons.tsx            # NEW server: three buttons / Settings link / nothing
src/app/(app)/records/EmailOverlay.tsx            # reply modes, target nullable
src/app/(app)/records/EmailBox.tsx                # reply view: heading, cc, names, quote, forwarded chips, sendEmailReply
src/app/(app)/records/email-actions.ts            # sendEmailReply
src/app/(app)/emails/EmailBody.tsx                # .eh row with To + ReplyButtons
src/app/(app)/emails/[id]/page.tsx                # flash, overlay, maxDuration = 60, reply state
src/app/(app)/deals/[id]/page.tsx, deals/page.tsx, deals/DealDrawer.tsx,
src/app/(app)/people/[id]/page.tsx, organisations/[id]/page.tsx   # emailBase instead of emailHref
src/app/globals.css                               # .eh, .acts.mini .btn, .quote
src/seed/sent-emails.ts                           # one reply, fixed send key
tests/fakes/gmail.ts                              # multipart request / answer check
tests/unit/…, tests/integration/…                 # Build writes them (quickstart.md lists what they prove)
AGENTS.md, docs/DECISIONS.md                      # SF-130 lines
```

**Structure Decision**: the single Next.js project as it is. Reply rules sit next to SF-129's `compose-rules.ts`
(pure, client-safe) and the reply domain next to `compose.ts` in `src/server/emails/`. The Gmail transport stays in
`src/server/gmail/`. The UI stays with the shared record parts in `src/app/(app)/records/`.

## Implementation steps (for Build)

0. **Base**: this branch is on `main` with SF-129 merged; no other merge needed.
1. **Migration** `0022_email_reply.sql` exactly as `data-model.md`.
2. **Pure rules** `src/server/emails/reply-rules.ts`. No import of `@/server/db` or anything server-only; it may
   import `emails/rules.ts` (`addressText`, `emailText`, `subjectOrDefault`), `format.ts` and `messages.ts`.
   - `parseEmailParam(v)` → `{ mode: "new" } | { mode: "reply" | "reply_all" | "forward"; messageId } | null`
     (regex `^(new|reply|reply-all|forward)(?:-([1-9]\d{0,15}))?$`, id required except for `new`).
   - `prefill(mode, email, own)` → `{ to, cc }` (data-model table; lower-case compare, first kept, own removed only in
     reply_all).
   - `replySubject`, `forwardSubject` (research §5).
   - `quoteDate(d)` → `"27 Nov 2026 at 14:05"` (UK time, `formatDate` + `ukParts`).
   - `replyQuote(email)`, `forwardQuote(email)`, `bodyWithQuote(text, quote)` = `text + "\n\n" + quote`.
   - `referencesFor(ids: (string | null)[], upTo: number)` → valid, deduplicated ids, oldest first, up to and
     including index `upTo`.
   - `MESSAGE_ID = /^<[^<>\s]{1,996}>$/`.
3. **MIME and Gmail** (`contracts/google.md`):
   - `gmail/rules.ts` `MimeInput.references` accepts `string[]`. It is written as `References:` folded at spaces with
     every line ≤ 998 octets and is absent when empty. `In-Reply-To` is written only when it matches `MESSAGE_ID`.
     Calls without them build the same text as today.
   - `google-api.ts` `sendRawUpload(access, mime, threadId?)` (multipart when `threadId`).
   - `send.ts`: `SendInput` gets `inReplyTo`, `references`; `threadId` → the multipart upload; remove the
     `getThreadMetadata` lookup; drop `sendRaw` / `getThreadMetadata` if no longer used (check `grep`).
   - `decideCopy` gains `pendingSend: boolean` (copy after the label/date rules). In `sync.ts` `runOnce`, one query
     per batch reads this connection's `email_sends` rows in state `sending` whose `gmail_message_id` or
     `rfc_message_id` is among the batch's ids. Those messages get `pendingSend: true`.
4. **Shared delivery** in `compose.ts`: move steps 5–9 of `sendFromRecord` into `deliver({ actorId, connection, sendKey,
   record | null, replyMessageId | null, named, subject, body, attached, forwarded, uploadIds, threadId, inReplyTo,
   references, now })`. `forwarded` is a list of `{ access: AttachmentAccess, contentType }`, fetched after the
   Storage reads; `"unavailable"` → unclaim, `reply_forward_unavailable`. The ledger insert also writes
   `reply_message_id`. `sendFromRecord` behaves exactly as before (its tests stay green). Export
   `nameRecipients` as `namesFor` (also used for the box's chips). `EmailBox` type as in `contracts/routes.md`
   (`emailBox` fills `cc: []`, `names: {}`, `reply: null`).
5. **Reply domain** `src/server/emails/reply.ts`:
   - `replyState(viewerId)` → `"ok" | "connect" | "reconnect" | "off"`.
   - `answered(db, viewerId, messageId)`: the message, its conversation (under `visibleConversation`), its
     attachments by position, and the conversation's shown `rfc_message_id`s with the index of this one (the same
     `distinct on (dedupe_key)` order as `getConversation`).
   - `userThread(connectionId, conversationId, dedupeKey)` (research §3).
   - `replyBox(viewerId, { mode, messageId }, target | null)`. The email is missing or hidden → `{ missing: true }`.
     Else: Gmail state and From (SF-129), prefill, `namesFor` of the prefill, subject, quote, forwarded (forward
     only), record files of the target when it is visible and not archived, a fresh `sendKey`.
   - `sendReply(actorId, input, now = new Date())` in the order of `contracts/routes.md`.
   - `placePendingReply(db, connectionId, threadRowId, m)` (research §1), called by `storeMessage` (step 6).
6. **Sync**: `storeMessage` calls `placePendingReply` right after the thread row is read and before the message insert's
   `processMessage` (new messages only). Comments in `sync.ts` / `compose.ts` gain an SF-130 sentence.
7. **Attachments**: `attachmentAccess(viewerId, id, opts?: { preferConnectionId?: number })` sorts that connection's
   candidate first. The download route is unchanged.
8. **Messages**: the `data-model.md` table into `messages.ts`.
9. **UI** (design B, `docs/DESIGN.md`):
   - `ReplyButtons.tsx` (server): props `{ messageId, base, state }`.
   - `EmailEntry` / `EmailBody` `.eh` rows.
   - `RecordTimeline` `emailBase` prop (all callers updated; the deal list drawer passes none). No reply on archived
     records.
   - `EmailOverlay` reply modes and nullable target.
   - `EmailBox` reply view: prefilled To/Cc with names; Subject prefilled; the quote in `<pre class="quote">` under
     the text area; forwarded attachments as chips (removable, counted in `used`); `forwardIds` sent; heading from
     `reply.heading`; footer `reply_footer`; the "attach a <kind> file" picker only when `record` is set.
   - Conversation page: `replyState`, buttons, flash, overlay, `maxDuration = 60`.
   - `globals.css`: `.eh`, `.acts.mini .btn`, `.quote`.
10. **Fake Gmail**: multipart upload, `SentMessage.inReplyTo` / `references`, an attachment-read failure switch for
    tests (`failAttachments`), the fake mailbox page lines. `tests/fakes/gmail.ts` checks the multipart request.
11. **Seed** (research §10).
12. **Docs**:
    - `AGENTS.md` Layout: an SF-130 paragraph naming `reply-rules.ts`, `reply.ts`, `deliver`, `reply_message_id` /
      `placePendingReply`, `pendingSend`, the multipart upload, `ReplyButtons.tsx` and `emailBase`.
    - `docs/DECISIONS.md` SF-130 lines: design B buttons; a Settings link in place of the buttons without Gmail; the
      quote read-only and always sent; From (not Reply-To) is the reply address; the forwarded block lists From, Date,
      Subject and To; a reply or forward adds no hand link; References keeps all ids (folded); "Email sent to …" also
      on the conversation page; the conversation page offers the `?from=` record's files only when that record is
      visible and not archived.
    - No blueprint line (no blueprint exception).

## Fix round 1

- **Problem:** the AI review failed US1 scenario 2 only: after a reply the deal page shows "Email sent to
  ana@example.test.", and the scenario asked for "Email sent to Ana Fake.".
- **Cause:** the spec contradicted itself. The scenario called the text "SF-129's notice", and FR-009 keeps SF-129's
  box unchanged; SF-129's notice (`sentNotice`) lists the addresses (SF-129 US1 scenario 2: "Email sent to
  ana@example.test."). The code does what SF-129 and FR-009 say, and `tests/integration/reply-send.test.ts` already
  checks "Email sent to ana@example.test." after a reply.
- **Fix:** correct US1 scenario 2 in `spec.md` to "Email sent to ana@example.test." (done in this round). No app code
  changes. Build re-runs the existing reply send test and the full suite to confirm.
- **Files:** `spec.md` only.

## Outside services

- Gmail API (`users.messages.send` through the simple media and **multipart** upload with `threadId`,
  `users.messages.get` and `users.messages.attachments.get` for forwarded attachments): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
- Supabase Storage (reading record files and computer uploads for the attachments, SF-129's `readObject`, unchanged): schema https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json
- Google OAuth 2.0 token endpoint (oauth2.googleapis.com/token, the refresh before sending and before reading attachments; unchanged): no public schema found on GitHub (looked in github.com/googleapis/google-api-go-client oauth2/v1 and oauth2/v2, whose `oauth2-api.json` only describes userinfo and tokeninfo; the fake follows RFC 6749, as in SF-118 and SF-129)
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93, SF-102, SF-118 and SF-129: only an OpenAPI file for Supavisor's own management API; this change adds one column to the app's own database, and tests use a real local Postgres rather than a fake)

## Complexity Tracking

No constitution or repo-rule violation to justify.
