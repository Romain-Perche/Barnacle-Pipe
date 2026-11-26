# Implementation Plan: Write an email from a deal or contact

**Branch**: `factory/sf-129-step-20-write-an-email-from-a-deal-or-co` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-129-step-20-write-an-email-from-a-deal-or-co/spec.md`

## Summary

`[ WRITE EMAIL ]` in the // TIMELINE heading of the deal page, the deal drawer, the person page and the organisation
page opens a tall right-side panel (design B, `?email=new`) to write a plain-text email with To/Cc/Bcc, a subject, the
text and attachments (the record's own files and files from the computer, 25 MB in total). `[ SEND ]` goes through
SF-118's single `sendGmail`, extended with attachments and sent through Gmail's media-upload endpoint (35 MiB limit).
Files from the computer go straight from the browser to Storage (as SF-116's `[ ADD FILE ]`), never through the app,
and are removed after sending. The sent email is stored at once in SF-118's `email_messages` (so the later Gmail sync
recognises it by its Gmail id and never shows or counts it twice), linked by a new `email_links` table to the record it
was written from and to every CRM person it went to, and read into `readTimeline` as a new EMAIL entry, hidden from
anyone who cannot see one of its linked records (`visibleEmail`). A small `email_sends` ledger, claimed before any
Google call, makes a double press send once and lets the sync finish the links if recording failed after Gmail
accepted the email. Recipients' Last contacted is raised to the send time.

## Technical Context

**Language/Version**: TypeScript 5 on Node (Next.js 16 App Router, React 19)

**Primary Dependencies**: `next`, `react`, `postgres` (postgres.js); no new package (see `dependencies.json`: `[]`)

**Storage**: Postgres (migration `0020_sent_email.sql`: `email_links`, `email_sends`, `email_uploads`); Supabase
Storage for attachments' bytes (record files, temporary computer uploads)

**Testing**: Vitest unit + integration on real Postgres; fake Gmail (`FakeGoogleMail`) and fake Storage
(`FakeStorage`) checked against the pinned schemas (`npm run test:schemas`)

**Target Platform**: Vercel (server actions, `maxDuration = 60` on the four pages that hold the box)

**Project Type**: web application (single Next.js project)

**Performance Goals**: a send with 25 MB of attachments finishes within the 60 s function budget: Storage reads
≤ 30 s each (sequential, total budget checked), Gmail upload ≤ 40 s; a text-only send is one Google token refresh
plus one upload

**Constraints**: no Storage or Google call inside `sql.begin()`; server action bodies ≤ 4 MB (so files never pass
through an action); Gmail upload ≤ 36,700,160 bytes; fixed messages only; plain text everywhere

**Scale/Scope**: a small team (≈10 users); one email at a time; ≤ 100 addresses, ≤ 25 MB per email

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so the gates are the repo's own rules
(`AGENTS.md` § Rules and § Tests, `docs/DECISIONS.md`):

| gate | status |
|---|---|
| Server components by default; client only where the browser is needed | PASS — `EmailOverlay` server; `EmailBox` client (chips, uploads, pending state) |
| Every page `requireUser()`; every action `requireUser()` first; no reliance on hidden links | PASS — `startEmailUpload`, `sendEmailFromRecord` re-check record visibility, archive state, files and Gmail at send time (FR-021) |
| User-facing text from `messages.ts`; nothing from the URL; redirects via `isSafeNext` | PASS — new `email_*` messages and templates; `back` checked |
| Migrations transaction-safe, RLS enabled after each `create table`, never at app start | PASS — `0020_sent_email.sql` |
| Fakes only for outside services, checked against their schemas | PASS — fake Gmail upload path checked against `gmail-api.json` `mediaUpload`; Storage GET against `storage_v0_openapi.json` |
| Fake data clearly fake; only when `isFakeAllowed()` | PASS — `src/seed/emails.ts` |
| No secrets; every setting in `.env.example` and README | PASS — no new setting |
| One visibility rule per table (`visible*()` in `visibility.ts`) | PASS — `visibleEmail()` |
| DECISIONS 2026-11-24: an email with someone the user cannot see is hidden entirely | PASS — `visibleEmail()` over every link |
| No Google call inside `sql.begin()` (SF-118/SF-124) | PASS — order in `contracts/routes.md` |

Post-design re-check: PASS, no violation (Complexity Tracking empty).

## Project Structure

### Documentation (this feature)

```text
specs/sf-129-step-20-write-an-email-from-a-deal-or-co/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── routes.md        # pages, address parameters, server actions
│   └── google.md        # Gmail media upload send, Storage object read
├── dependencies.json    # []
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
migrations/0020_sent_email.sql                    # email_links, email_sends, email_uploads (data-model.md)
src/server/email/rules.ts                         # NEW pure, client-safe: addresses, dedupe, limits, totals, preview
src/server/email/emails.ts                        # NEW emailBox, startEmailUpload, sendFromRecord, recordSent,
                                                  #     completePendingSend, onRecordSentForTests
src/server/gmail/rules.ts                         # buildMime: fromName, messageId, attachments (multipart/mixed);
                                                  #     export isHeaderAddress
src/server/gmail/google-api.ts                    # sendRawUpload (upload endpoint, message/rfc822, 40 s)
src/server/gmail/send.ts                          # SendInput + attachments/fromName/messageId; GmailTooLarge; upload path
src/server/gmail/sync.ts                          # storeMessage calls completePendingSend in its transaction
src/server/gmail/fake-gmail.ts                    # upload path, multipart/mixed attachments, sentMessages()
src/server/files/storage.ts                       # readObject(path, size)
src/server/files/fake-storage.ts                  # full GET (check; add if missing)
src/server/files/files.ts                         # sweepFileCleanup also drops email_uploads older than 24 h
src/server/records/visibility.ts                  # visibleEmail()
src/server/records/timeline.ts                    # "email" kind, TimelineEntry.email, sentEmails(), merged in selectEntries
src/server/records/timeline-view.ts               # EntryTag "EMAIL"
src/server/records/flash.ts                       # flash code email_sent
src/server/messages.ts                            # email_* messages and templates
src/app/(app)/records/RecordTimeline.tsx          # [ WRITE EMAIL ] in the heading; EMAIL entry with <details> [ SHOW ALL ]
src/app/(app)/records/EmailOverlay.tsx            # NEW server: ?email=new → the panel's data
src/app/(app)/records/EmailBox.tsx                # NEW client: the panel (design B)
src/app/(app)/records/email-actions.ts            # NEW startEmailUpload, sendEmailFromRecord
src/app/(app)/deals/[id]/page.tsx                 # overlay, maxDuration = 60
src/app/(app)/deals/page.tsx, deals/DealDrawer.tsx# drawer button + overlay over board, maxDuration = 60
src/app/(app)/people/[id]/page.tsx                # overlay, maxDuration = 60
src/app/(app)/organisations/[id]/page.tsx         # overlay, maxDuration = 60
src/app/globals.css                               # .sidepanel (right panel over dimmed page), .emailentry
src/seed/emails.ts, src/seed/index.ts             # one sent email on a fake deal, fixed send_key
tests/fakes/gmail.ts                              # check the upload request/answer against mediaUpload + Message
tests/support/reset.ts                            # empty the three new tables
tests/unit/…, tests/integration/…                 # Build writes them (quickstart.md lists what they prove)
AGENTS.md                                         # Layout: SF-129 lines (src/server/email, the panel, email_links)
```

**Structure Decision**: the single Next.js project as it is. Domain code in a new `src/server/email/` (sending from a
record and recording it, the base the later Inbox and replies build on); Gmail transport stays in `src/server/gmail/`;
the UI sits with the other shared record parts in `src/app/(app)/records/`.

## Implementation steps (for Build)

1. **Migration** `0020_sent_email.sql` exactly as `data-model.md` (checks, partial unique indexes, RLS on each table).
   Add the three tables to `tests/support/reset.ts`.
2. **Pure rules** `src/server/email/rules.ts`: `splitAddresses(text)` (split on `/[\s,;]+/`, drop empties),
   `normaliseRecipients({ to, cc, bcc })` (trim, dedupe by lower-case across fields, first kept, To > Cc > Bcc),
   `validateEmail(input)` → list of codes (data-model.md table; limits in code points via `[...s].length`), `totalBytes`,
   `emailPreview(text)` (first 140 code points, line breaks to spaces, "…" when cut). Constants `MAX_RECIPIENTS = 100`,
   `MAX_SUBJECT = 250`, `MAX_TEXT = 100_000`; size limit `MAX_FILE_BYTES` from `files/rules.ts`. No import of
   `@/server/db`.
3. **MIME** (`gmail/rules.ts`): `MimeInput` gains `fromName?`, `messageId?`, `attachments?: { name, contentType, bytes:
   Uint8Array }[]`; layout per `contracts/google.md`; `noBreak` on every header value, file names and types included;
   export `isHeaderAddress`. A call without the new fields builds the same text as today (no Message-ID unless given).
4. **Gmail send**: `google-api.ts` `sendRawUpload(access, mime: Buffer)` → `{ id, threadId }`, own 40 s time-out, same
   error mapping as `gmailJson`. `send.ts`: `SendInput` + `fromName`, `messageId`, `attachments`; build the bytes once;
   `> MAX_RAW_BYTES (36_700_160)` → `GmailTooLarge` before any Google call; no `threadId` → `sendRawUpload`, else the
   existing JSON call. The Settings test email keeps working through the upload path.
5. **Storage read**: `storage.ts` `readObject(path, size)` (contracts/google.md); fake Storage full GET.
6. **Visibility**: `visibleEmail(db, viewer, alias = "m")` = `not exists (select 1 from email_links vl join deals vd on
   vd.id = vl.deal_id where vl.message_id = m.id and not visibleDeal(vd)) and not exists (… persons vp … not
   visiblePerson(vp))`.
7. **Domain** `src/server/email/emails.ts`:
   - `emailBox(viewerId, target)`: `gmailConfig().mode === "off"` → `off`; connection state; record (visible, not
     archived, else null); To prefill = first `person_emails` row (by position, as "first email" elsewhere) of the
     person / the deal's main person when `visiblePerson`; record files = `listFiles(viewerId, target)` (own files
     only); a fresh `sendKey` (`randomUUID()`).
   - `startEmailUpload(actorId, file)` (research §2).
   - `sendFromRecord(actorId, input, now = new Date())` in the order of `contracts/routes.md`. Message-ID
     `<crm-${randomBytes(12).toString("hex")}@barnacle.ai>`; From name = `users.name`.
   - `recordSent(db, { send, connectionId, gmail ids, recipients, subject, text, attachments, at })` in one
     `sql.begin()`: lock the ledger row `for update`; thread and message `on conflict do nothing` (then select); the
     attachments when the message is new; link `written_from` then recipients (`person_emails.email = any(lower
     addresses)`, distinct persons, `on conflict do nothing`); raise `last_contacted_at` for recipient persons
     (SF-109 statement); ledger `state = 'sent'`, `message_id`. Calls `onRecordSentForTests` first (tests only).
   - `completePendingSend(db, connectionId, m)` for the sync: ledger row `sending` of that connection with
     `gmail_message_id = m.gmailMessageId` or `rfc_message_id = m.rfcMessageId`, `for update`; same links and Last
     contacted (time = the ledger's `created_at`); `sent`.
   - After a send: `update file_cleanup set due_at = now()` for the sent uploads, delete their `email_uploads` rows,
     `runAfterResponse(sweepFileCleanup)`.
8. **Sync**: `storeMessage` (gmail/sync.ts) calls `completePendingSend(db, connectionId, m)` inside its transaction
   after the message insert (also when the insert found the row: no-op unless a `sending` ledger row matches).
9. **Timeline**: `EventKind` + `"email"`; `TimelineEntry.email: { id, senderName, senderActive, to, cc, bcc, subject,
   text, preview, attachments: { name, size }[] } | null` (other kinds `null`; update every literal that builds a
   `TimelineEntry`, as SF-109 did for `activity`); `emailWhere(target)` per research §5; `sentEmails(viewerId, target,
   limit + 1)` with `visibleEmail`, ordered `received_at desc, id desc`; merged in `selectEntries` when
   `show.activitiesOf` is set (ambassador updates: not). `entryTag` → `"EMAIL"` for kind `email`.
10. **Messages and flash**: data-model.md table into `messages.ts` (`templates.email_address_invalid`,
   `templates.email_sent`), `email_box_footer`: "Sent from your Gmail. It shows on this record and on the CRM people it
   goes to.", button labels; flash code `email_sent` (`name` = the addresses joined, rendered by `templates.email_sent`
   with the 5-address cap).
11. **UI**: `RecordTimeline.tsx` heading link `[ WRITE EMAIL ]` (`href` = current address + `email=new`; hidden when
   archived; shown in the drawer too, `readOnly` still hides the note box only) and the EMAIL entry (routes.md);
   `EmailOverlay.tsx` + `EmailBox.tsx` (design B, `docs/DESIGN.md` look; uploads with progress reusing `AddFiles.tsx`'s
   `put`; a computer file over the remaining room refused at pick time with `email_attachments_too_large`; after
   `needs_reconnect` → `router.refresh()`); the four pages render the overlay and export `maxDuration = 60`;
   `globals.css` `.sidepanel`.
12. **Fake Gmail and its check**: upload path, multipart/mixed, attachments kept with bytes, `sentMessages(email)` for
   tests; `tests/fakes/gmail.ts` checks per contracts/google.md.
13. **Seed** `src/seed/emails.ts` (research §9), registered in `src/seed/index.ts` after `gmail` and `files`.
14. **Docs**: `AGENTS.md` Layout lines for SF-129 (`src/server/email/`, `email_links` / `email_sends` / `email_uploads`,
   `visibleEmail()`, the panel files, the upload send path); no `docs/DECISIONS.md` line (no blueprint exception).

## Outside services

- Gmail API, `users.messages.send` through the simple media upload (`/upload/gmail/v1/users/me/messages/send?uploadType=media`, `message/rfc822`), plus the unchanged token refresh: schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
- Supabase Storage (signed upload of computer files, whole-object read `GET /object/authenticated/{bucket}/{path}`, bulk delete): schema https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json
- Google OAuth 2.0 token endpoint (oauth2.googleapis.com/token, the refresh before sending; unchanged): no public schema found on GitHub (looked in github.com/googleapis/google-api-go-client oauth2/v1 and oauth2/v2, whose `oauth2-api.json` only describes userinfo and tokeninfo; the fake follows RFC 6749, as in SF-118)
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93, SF-102 and SF-118: only an OpenAPI file for Supavisor's own management API; this change only adds tables to the app's own database, and tests use a real local Postgres rather than a fake)

## Complexity Tracking

No constitution or repo-rule violation to justify.
