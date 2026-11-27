# Implementation Plan: Write an email from a deal or contact

**Branch**: `factory/sf-129-step-20-write-an-email-from-a-deal-or-co` | **Date**: 2026-11-27 (re-planned on SF-127) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-129-step-20-write-an-email-from-a-deal-or-co/spec.md`

## Summary

`[ WRITE EMAIL ]` in the // TIMELINE heading of the deal page, the deal drawer, the person page and the organisation
page opens a tall right-side panel (design B, `?email=new`) to write a plain-text email with To/Cc/Bcc, a subject, the
text and attachments (the record's own files and files from the computer, 25 MB in total). `[ SEND ]` goes through
SF-118's single `sendGmail`, extended with attachments and sent through Gmail's media-upload endpoint (35 MiB limit).
Files from the computer go straight from the browser to Storage (as SF-116's `[ ADD FILE ]`), never through the app,
and are removed after sending.

Re-planned on SF-127 (Email on the timeline, now on main; the person's answer of 2026-11-27): the sent email is stored at
once through the sync's own `storeMessage` (SF-118 tables), whose transaction already runs SF-127's `processMessage`
(conversation, addresses, automatic links to the people in it, their organisation and their one open deal, Last
contacted). The only addition there is one link **by hand** (`email_links.how = 'manual'`, SF-127's table) to the record
the email was written from. The timeline needs no change: SF-127's `timelineEmails` / `EmailEntry` show it, hidden by
`visibleConversation()`. The later Gmail sync finds the message by its Gmail id and neither shows nor counts it twice.
A small `email_sends` ledger, claimed before any Google call, makes a double press send once and lets the sync add the
hand link when storing failed after Gmail accepted the email.

## Technical Context

**Language/Version**: TypeScript 5 on Node (Next.js 16 App Router, React 19)

**Primary Dependencies**: `next`, `react`, `postgres` (postgres.js); no new package (see `dependencies.json`: `[]`)

**Storage**: Postgres (migration `0021_email_send.sql`: `email_sends`, `email_uploads`; SF-118 / SF-127 email tables
reused unchanged); Supabase Storage for attachments' bytes (record files, temporary computer uploads)

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
| User-facing text from `messages.ts`; nothing from the URL; redirects via `isSafeNext` | PASS — new `compose_*` messages and templates; `back` checked |
| Migrations transaction-safe, RLS enabled after each `create table`, never at app start | PASS — `0021_email_send.sql` |
| Fakes only for outside services, checked against their schemas | PASS — fake Gmail upload path checked against `gmail-api.json` `mediaUpload`; Storage GET against `storage_v0_openapi.json` |
| Fake data clearly fake; only when `isFakeAllowed()` | PASS — `src/seed/sent-emails.ts` |
| No secrets; every setting in `.env.example` and README | PASS — no new setting |
| SF-127: every read of the email tables for a viewer uses `visibleConversation()` | PASS — no new read of them for a viewer: timelines and the conversation page are SF-127's |
| SF-127: automatic linking only ever `insert … on conflict do nothing`; a hand choice is never changed | PASS — the written-from link is one more hand link, inserted `on conflict do nothing` |
| No Google call inside `sql.begin()` (SF-118/SF-124/SF-127) | PASS — order in `contracts/routes.md` |

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
migrations/0021_email_send.sql                    # email_sends, email_uploads (data-model.md)
src/server/emails/compose-rules.ts                # NEW pure, client-safe: addresses, dedupe, limits, totals, sent notice
src/server/emails/compose.ts                      # NEW emailBox, startEmailUpload, sendFromRecord, sentMessage,
                                                  #     completePendingSend, onRecordSentForTests
src/server/gmail/rules.ts                         # buildMime: fromName, messageId, attachments (multipart/mixed);
                                                  #     export isHeaderAddress
src/server/gmail/google-api.ts                    # sendRawUpload (upload endpoint, message/rfc822, 40 s)
src/server/gmail/send.ts                          # SendInput + attachments/fromName/messageId; GmailTooLarge; upload path
src/server/gmail/sync.ts                          # storeMessage: also for a message already stored, then
                                                  #     completePendingSend in the same transaction
src/server/gmail/fake-gmail.ts                    # upload path, multipart/mixed attachments, sentMessages()
src/server/files/storage.ts                       # readObject(path, size)
src/server/files/fake-storage.ts                  # full GET (check; add if missing)
src/server/files/files.ts                         # sweepFileCleanup also drops email_uploads older than 24 h
src/server/records/flash.ts                       # flash code email_sent
src/server/messages.ts                            # compose_* messages and templates
src/app/(app)/records/RecordTimeline.tsx          # [ WRITE EMAIL ] in the // TIMELINE heading (EMAIL entries: SF-127, unchanged)
src/app/(app)/records/EmailOverlay.tsx            # NEW server: ?email=new → the panel's data
src/app/(app)/records/EmailBox.tsx                # NEW client: the panel (design B)
src/app/(app)/records/email-actions.ts            # NEW startEmailUpload, sendEmailFromRecord
src/app/(app)/deals/[id]/page.tsx                 # overlay, maxDuration = 60
src/app/(app)/deals/page.tsx, deals/DealDrawer.tsx# drawer button + overlay over board, maxDuration = 60
src/app/(app)/people/[id]/page.tsx                # overlay, maxDuration = 60
src/app/(app)/organisations/[id]/page.tsx         # overlay, maxDuration = 60
src/app/globals.css                               # .sidepanel (right panel over dimmed page)
src/seed/sent-emails.ts, src/seed/index.ts        # one sent email on a fake deal, fixed send_key
tests/fakes/gmail.ts                              # check the upload request/answer against mediaUpload + Message
tests/support/reset.ts                            # empty the two new tables
tests/unit/…, tests/integration/…                 # Build writes them (quickstart.md lists what they prove)
AGENTS.md                                         # Layout: SF-129 lines
```

Not changed (SF-127 does it already): `email_links`, `processMessage` / `autoLink`, `timelineEmails`, `EmailEntry.tsx`,
the conversation page, `visibleConversation()`, Last contacted.

**Structure Decision**: the single Next.js project as it is. Domain code next to SF-127's in `src/server/emails/`
(`compose-rules.ts` pure, `compose.ts`); Gmail transport stays in `src/server/gmail/`; the UI sits with the other shared
record parts in `src/app/(app)/records/`.

## Implementation steps (for Build)

0. **Base**: merge `origin/main` (SF-127, SF-128, SF-126) into this branch first; this plan is written against it.
1. **Migration** `0021_email_send.sql` exactly as `data-model.md` (checks, indexes, RLS on each table). Add the two
   tables to `tests/support/reset.ts`.
2. **Pure rules** `src/server/emails/compose-rules.ts`: `splitAddresses(text)` (split on `/[\s,;]+/`, drop empties),
   `normaliseRecipients({ to, cc, bcc })` (trim, dedupe by lower-case across fields, first kept, To > Cc > Bcc),
   `validateCompose(input)` → list of codes (data-model.md table; limits in code points via `[...s].length`),
   `totalBytes`, `sentNotice(addresses)` (first 5, then "and <n> more"). Constants `MAX_RECIPIENTS = 100`,
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
6. **Storing the sent email** (research §4):
   - `sentMessage(...)` (pure) builds SF-118's `ReadMessage` from what was sent: Gmail ids, `rfcMessageId` = the
     CRM's Message-ID, `direction 'sent'`, `from { email: connection address, name: users.name }`, To/Cc/Bcc as
     `{ email, name: null }`, subject, `sentAt = receivedAt = now`, `textBody` = the text, `htmlBody` null, attachments
     name/type/size, `labelIds ['SENT']`, `addresses`.
   - `gmail/sync.ts` `storeMessage`: when the message insert finds the row already there, it no longer returns at
     once: it selects that row's id and still calls `processMessage` (a no-op for a processed message) and then
     `completePendingSend(db, connectionId, messageId)`; for a new message, `completePendingSend` after
     `processMessage`. Return value unchanged (true only when new).
   - `completePendingSend(db, connectionId, messageId)` (`compose.ts`): the `email_sends` row of that connection in state
     `sending` with the message's `gmail_message_id` or `rfc_message_id`, `for update`; none → return. Else: the
     message's `email_threads.conversation_id`; insert the hand link `email_links (conversation_id, <deal|person|
     organisation>_id, how 'manual', changed_by = user_id)` `on conflict do nothing` (skipped when the record was
     deleted: all three ids null); ledger `state = 'sent'`, `message_id`. Calls `onRecordSentForTests` first (tests only).
   - The send path calls `storeMessage(connectionId, sentMessage(...))` right after Gmail's answer.
7. **Domain** `src/server/emails/compose.ts`:
   - `emailBox(viewerId, target)`: `gmailConfig().mode === "off"` → `off`; connection state; record (visible, not
     archived, else null); To prefill = first `person_emails` row (by position, as "first email" elsewhere) of the
     person / the deal's main person when `visiblePerson`; record files = `listFiles(viewerId, target)` (own files
     only); a fresh `sendKey` (`randomUUID()`).
   - `startEmailUpload(actorId, file)` (research §2).
   - `sendFromRecord(actorId, input, now = new Date())` in the order of `contracts/routes.md`. Message-ID
     `<crm-${randomBytes(12).toString("hex")}@barnacle.ai>`; From name = `users.name`.
   - After a send: `update file_cleanup set due_at = now()` for the sent uploads, delete their `email_uploads` rows,
     `runAfterResponse(sweepFileCleanup)`.
8. **Messages and flash**: data-model.md table into `messages.ts` (`templates.compose_address_invalid`,
   `templates.email_sent`), `compose_footer`: "Sent from your Gmail. It shows on this record and on the CRM people it
   goes to.", button labels; flash code `email_sent` (`name` = the first addresses that fit in the flash's 300
   characters, at most 5; `count` = all addresses; rendered by `templates.email_sent`).
9. **UI**: `RecordTimeline.tsx` heading link `[ WRITE EMAIL ]` (`href` = current address + `email=new`; hidden when
   archived; shown in the drawer too); `EmailOverlay.tsx` + `EmailBox.tsx` (design B, `docs/DESIGN.md` look; uploads
   with progress reusing `AddFiles.tsx`'s `put`; a computer file over the remaining room refused at pick time with
   `compose_attachments_too_large`; after `needs_reconnect` → `router.refresh()`); the four pages render the overlay and
   export `maxDuration = 60`; `globals.css` `.sidepanel`. The EMAIL entry is SF-127's `EmailEntry`, unchanged.
10. **Fake Gmail and its check**: upload path, multipart/mixed, attachments kept with bytes (as SF-127's attachment
   bytes), `sentMessages(email)` for tests; `tests/fakes/gmail.ts` checks per contracts/google.md.
11. **Seed** `src/seed/sent-emails.ts` (research §9), registered in `src/seed/index.ts` after `gmail` and `files`.
12. **Docs**: `AGENTS.md` Layout lines for SF-129 (`compose-rules.ts` / `compose.ts`, `email_sends` / `email_uploads`,
   the hand link to the written-from record, the panel files, the upload send path); no `docs/DECISIONS.md` line (no
   blueprint exception).

## Fix round 1

The AI review (2026-11-27) found four problems: three are the build not doing what `spec.md` says, one is a missing docs line.

1. **Recipient names on the EMAIL entry** (US2 scenario 1). *Problem*: the entry reads "Ada Fake → ana@example.test · Cc
   ben@example.test" instead of "Ada Fake → Ana Fake · Cc Ben Fake". *Cause*: this plan (§7) had `sentMessage` store
   To / Cc / Bcc with `name: null`, and `buildMime` writes bare addresses; SF-127's `recipientsLine` shows a recipient's
   name only when the stored address has one. *Fix*: in `sendFromRecord`, after the checks and before the ledger claim,
   one query names each normalised address: the `persons.name` of a person the sender can see (`visiblePerson(actorId)`,
   archived people included) with a `person_emails` row equal to it ignoring case; several such people → the lowest
   person id; none → no name. The names go both into the email's headers (`To` / `Cc` / `Bcc` written as
   `mailbox(name, address)`, the RFC 2047 path that `From` already uses: `MimeInput.to` / `cc` / `bcc` also accept
   `{ email, name }`) and into `sentMessage`'s stored copy, so the sync's copy (edge case "The sync stored it first") and
   the CRM's copy say the same. A name the header cannot hold (`BadHeader`) is dropped for that address, never a refusal.
   A private person of another user is never named (not visible to the sender). The "Email sent to …" notice keeps
   listing addresses.
2. **Over 25 MB** (US3 scenario 3, FR-012). *Problem*: a computer file that would take the total over 25 MB is dropped
   at once (so `[ SEND ]` then sends without it), and a record file that takes the total over shows no message until
   `[ SEND ]`. *Cause*: `EmailBox.attachFromComputer` refuses any file larger than the room left; the message is only set
   from a send answer. *Fix*: a computer file is refused at pick time only when it alone is over 25 MB (edge case "Big
   files from the computer", unchanged); any other file is uploaded and listed. The box shows
   `compose_attachments_too_large` for as long as the attached total (record and computer files) is over 25 MB, derived
   from the list (not a one-shot error), and `[ SEND ]` while over shows it again and calls nothing (the server check
   stays). Pure, client-safe helpers in `compose-rules.ts`: `refusedOnPick(size)` and `overAttachmentLimit(total)`.
3. **Key refused at send time** (US4 scenario 3, FR-008, SC-006). *Problem*: the box shows the reconnect message but
   the To, Subject and text fields disappear. *Cause*: a `gmail` answer sets the box's Gmail state, and the box renders
   either the message or the form. *Fix*: the box keeps two states: the Gmail state it opened with (not `ok` → message
   only, as US4 scenarios 1, 2 and 4) and a refusal from a send answer (→ the form stays, with every address, the subject,
   the text and the attachments, the reconnect message and `[ GO TO SETTINGS ]` above it, and no `[ SEND ]`). Pure
   `panelView(opened, refused)` → `"message" | "form" | "form-refused"` in `compose-rules.ts`. `router.refresh()` stays
   (the sidebar "!"); it does not remount the box.
4. **No SF-129 line in `docs/DECISIONS.md`** (code review 1). *Cause*: §12 above said none was needed; the repo records
   each issue's design and clarified choices there. *Fix*: SF-129 lines for: design B right-side panel; sending raises
   Last contacted (through SF-127); computer files go only in the email, deleted after sending or 24 hours after being
   chosen; an organisation starts with an empty To; the sender's CRM name with their Gmail address, and recipients named
   as the sender's CRM people; subject required, 100 addresses, 250 / 100,000 characters; "Email sent to" names 5
   addresses then "and n more"; the 25 MB is counted on the files' own sizes; each email starts a new conversation; Bcc
   shows on the entry as the sender's copy holds it (SF-127).

Files: `src/server/emails/compose.ts`, `src/server/emails/compose-rules.ts`, `src/server/gmail/rules.ts` (`MimeInput`,
`buildMime`), `src/app/(app)/records/EmailBox.tsx`, `docs/DECISIONS.md`, `AGENTS.md` (one clause: recipient names),
the tests of T045. No migration, no new dependency (fix round 2 adds `happy-dom`, tests only), no new outside service.

## Fix round 2

The AI review (2026-11-27, after fix round 1) found one problem: US4 scenario 3 (FR-008, SC-006) still fails.

- *Problem*: when Google refuses the Gmail key at send time, the box shows the reconnect message and the Settings link,
  but the To, Subject and text fields and the attachments disappear. What the user typed is no longer shown.
- *Cause*: fix round 1 made the pure `panelView(opened, refused)` right, but `EmailBox` passes `box.gmail` (the prop) as
  `opened`. After a `gmail` answer, `router.refresh()` (kept for the sidebar "!") re-renders the page, the server now reads
  the connection as `needs_reconnect`, and the new `box` prop gives `panelView("needs_reconnect", "needs_reconnect")` =
  "message". The integration test mocks `router.refresh()` as a no-op, so the prop never changed in the tests.
- *Fix*: `EmailBox` keeps the Gmail state it opened with in client state: `const [opened] = useState(box.gmail)`, and uses
  `opened` (never `box.gmail`) for `panelView` and for the message (`refusedBy ?? opened`). A later prop change does not
  change the view: a box that opened with a working connection keeps its form until it closes. The `sendKey` and the
  offered files already come from the first render's state or are unchanged by the refresh; no other prop decides the view.
  `router.refresh()` stays. No spec change: US4 scenario 3 already says what the user gets.
- *Test*: a component test that renders the real `EmailBox` in a browser-like DOM (`happy-dom`, dev dependency, set for
  that one test file only with `// @vitest-environment happy-dom`; the other tests stay on `node`). The mocked
  `sendEmailFromRecord` answers `{ status: "gmail", state: "needs_reconnect" }`, and the mocked `router.refresh()`
  re-renders the box with `box.gmail = "needs_reconnect"`, as the real refresh does. It fails on the current code (the
  subject input is gone) and passes after the fix.

Files: `src/app/(app)/records/EmailBox.tsx`, `tests/unit/email-box-refused.test.tsx` (new), `package.json` /
`package-lock.json` (`happy-dom` dev dependency), `vitest.config.ts` (`include` also takes `tests/unit/**/*.test.tsx`). No
migration, no new outside service.

## Outside services

- Gmail API, `users.messages.send` through the simple media upload (`/upload/gmail/v1/users/me/messages/send?uploadType=media`, `message/rfc822`), plus the unchanged token refresh: schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
- Supabase Storage (signed upload of computer files, whole-object read `GET /object/authenticated/{bucket}/{path}`, bulk delete): schema https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json
- Google OAuth 2.0 token endpoint (oauth2.googleapis.com/token, the refresh before sending; unchanged): no public schema found on GitHub (looked in github.com/googleapis/google-api-go-client oauth2/v1 and oauth2/v2, whose `oauth2-api.json` only describes userinfo and tokeninfo; the fake follows RFC 6749, as in SF-118)
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93, SF-102 and SF-118: only an OpenAPI file for Supavisor's own management API; this change only adds tables to the app's own database, and tests use a real local Postgres rather than a fake)

## Complexity Tracking

No constitution or repo-rule violation to justify.
