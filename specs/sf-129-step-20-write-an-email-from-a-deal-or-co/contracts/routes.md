# Contract: pages, address parameters and server actions (SF-129)

## Pages (all signed-in, `requireUser()`)

| page | change |
|---|---|
| `/deals/<id>` | `[ WRITE EMAIL ]` in the // TIMELINE heading (not when archived) → `?email=new`; `export const maxDuration = 60` |
| `/deals` (board, drawer open with `deal=<id>`) | `[ WRITE EMAIL ]` in the drawer's // TIMELINE heading → same address `&email=new`; the panel opens over the board and drawer; `maxDuration = 60` |
| `/people/<id>` | as the deal page; `maxDuration = 60` |
| `/organisations/<id>` | as the deal page; `maxDuration = 60` |

`email=new` is the only value read; anything else, an archived record or a record the viewer cannot see opens
nothing. Nothing from the address is shown. `back` = the same address without `email`.

### The panel (`EmailOverlay.tsx` server → `EmailBox.tsx` client), design B

- Heading `// NEW EMAIL · <RECORD NAME>` (deal title / person name / organisation name, from the database), `[ CLOSE ]`.
- Gmail usable: `From <address>` (text), To / Cc / Bcc (chips + "Add an address" input: Enter, comma, semicolon, space
  or paste adds; × removes), Subject (one line), Text (`<textarea>`, plain), Attachments: the list (name · size · ×),
  `[ ATTACH A <DEAL|PERSON|ORGANISATION> FILE ▾ ]` (the record's own visible files not yet attached, name and size),
  `[ ATTACH FROM COMPUTER ]` (multiple), "<n> MB of 25 MB"; footer `email_box_footer`, `[ CANCEL ]` (link to `back`),
  `[ SEND ]` (disabled while sending or uploading). Refusals are listed above the footer, each a fixed message.
- Gmail not usable: the US4 message, `[ GO TO SETTINGS ]` (`/settings`) except when Gmail is off, `[ CLOSE ]`; no fields.
- All text from the database or typed is rendered as text nodes.

### The EMAIL timeline entry (`RecordTimeline.tsx`, SF-102 design B)

Tag `EMAIL`; `<sender> → <to, cc addresses> · <n> file(s)`, then `<subject> — <start of text (preview)>` and
`[ SHOW ALL ]` (a `<details>`: "To", "Cc" and "Bcc" lines (Cc/Bcc only when any), the whole text in a
`white-space: pre-wrap` block, attachments "name · size"); the time on the right. No actions. Shown on the deal page,
the drawer, the person page and the organisation page.

## Server actions (`src/app/(app)/records/email-actions.ts`, each `requireUser()` first)

### `startEmailUpload({ name, size, type }) → { status: "ok", id, url, contentType } | { status: <refusal> }`

- `validateFile` (SF-116) and `size <= MAX_FILE_BYTES`; refusals `email_attachments_too_large`, `file_empty`,
  `file_name_too_long`, `files_unreachable` (Storage off / unreachable).
- Creates the `email_uploads` row, queues the path in `file_cleanup` (+24 h), returns Storage's signed upload address.
  The browser PUTs the file there (progress shown), as `AddFiles.tsx`.

### `sendEmailFromRecord(input) → { status: "sent" } | { status: "refused", errors: Code[] } | { status: "gmail", state: "not_connected" | "needs_reconnect" | "off" }`

Input: `{ target: "deal" | "person" | "organisation", id: number, sendKey: uuid, to: string[], cc: string[], bcc: string[],
subject: string, text: string, fileIds: number[], uploadIds: number[], back: string }`. Unknown shapes are refused
(`email_send_failed`); `back` through `isSafeNext`.

Order (no Storage or Google call inside `sql.begin()`):

1. Gmail mode off → `gmail/off`; connection none or disconnected → `gmail/not_connected`; `needs_reconnect` → `gmail/needs_reconnect`.
2. Pure checks (`validateEmail`) → `refused` with every failing code.
3. Record: visible to the user and exists, else `email_record_not_found`; archived → `email_record_archived`.
4. Attachments: each `fileIds` entry a `files` row of that record and `visibleFile()`; each `uploadIds` entry an
   `email_uploads` row of this user; total ≤ `MAX_FILE_BYTES` → else `email_attachment_gone` / `email_attachments_too_large`.
5. Claim the ledger row (`email_sends`, `on conflict (user_id, send_key) do nothing`). Not claimed (already pressed) →
   `sent` with no second send.
6. Read the attachments' bytes (`readObject`); missing or wrong size → delete the claim, `email_attachment_gone`;
   Storage unreachable → delete the claim, `email_send_failed`.
7. `sendGmail(userId, { to, cc, bcc, subject, text, fromName, messageId, attachments })`:
   `GmailNotConnected` / `GmailNeedsReconnect` → delete the claim → `gmail/...`; `GmailUnavailable`, `BadHeader` →
   delete the claim → `email_send_failed`; `GmailTooLarge` → delete the claim → `email_attachments_too_large`.
8. Store the Gmail ids on the claim; `recordSent` (one transaction); a failure there is logged and followed by
   `runAfterResponse(() => syncConnection(connectionId))`, never shown.
9. The sent uploads' cleanup due now; `sweepFileCleanup()` after the response.
10. `setFlash({ code: "email_sent", name: <addresses> })`; `sent`. The client goes to `back` and refreshes.

The page then shows the flash notice once ("Email sent to …").

## Server functions (`src/server/email/`)

- `rules.ts` (pure, client-safe): `splitAddresses`, `normaliseRecipients` (dedupe across fields), `validateEmail`,
  `totalBytes`, `emailPreview` (start of the text for the short entry), limits `MAX_RECIPIENTS = 100`,
  `MAX_SUBJECT = 250`, `MAX_TEXT = 100_000`. The Message-ID is made in `emails.ts` (it needs `node:crypto`, server only).
- `emails.ts`: `emailBox(viewerId, target)` (the overlay's data: Gmail state, From, To to fill, record files),
  `startEmailUpload`, `sendFromRecord(actorId, input, now = new Date())`, `recordSent(db, …)`,
  `completePendingSend(db, connectionId, message)` (called by `gmail/sync.ts` `storeMessage`), `onRecordSentForTests`.
- `src/server/records/timeline.ts`: `sentEmails(viewerId, target, limit)` merged in `selectEntries` with the done
  activities; `TimelineEntry.email`.
- `src/server/records/visibility.ts`: `visibleEmail(db, viewer, alias = "m")`.
