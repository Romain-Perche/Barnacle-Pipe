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
  `[ ATTACH FROM COMPUTER ]` (multiple), "<n> MB of 25 MB"; footer `compose_footer`, `[ CANCEL ]` (link to `back`),
  `[ SEND ]` (disabled while sending or uploading). Refusals are listed above the footer, each a fixed message.
- Gmail not usable: the US4 message, `[ GO TO SETTINGS ]` (`/settings`) except when Gmail is off, `[ CLOSE ]`; no fields.
- All text from the database or typed is rendered as text nodes.

### The EMAIL timeline entry

SF-127's `EmailEntry`, unchanged: tag `EMAIL`, `<sender> → <To> · Cc … · Bcc …`, the subject linking to
`/emails/<conversation>?from=<kind>-<id>`, the start of the text, the attachments "name · size"; the time on the right.
It shows on every record the conversation is linked to (the written-from record by hand; the people, their
organisation and their one open deal automatically), for viewers that `visibleConversation()` lets through.

## Server actions (`src/app/(app)/records/email-actions.ts`, each `requireUser()` first)

### `startEmailUpload({ name, size, type }) → { status: "ok", id, url, contentType } | { status: <refusal> }`

- `validateFile` (SF-116) and `size <= MAX_FILE_BYTES`; refusals `compose_attachments_too_large`, `file_empty`,
  `file_name_too_long`, `files_unreachable` (Storage off / unreachable).
- Creates the `email_uploads` row, queues the path in `file_cleanup` (+24 h), returns Storage's signed upload address.
  The browser PUTs the file there (progress shown), as `AddFiles.tsx`.

### `sendEmailFromRecord(input) → { status: "sent" } | { status: "refused", errors: Code[] } | { status: "gmail", state: "not_connected" | "needs_reconnect" | "off" }`

Input: `{ target: "deal" | "person" | "organisation", id: number, sendKey: uuid, to: string[], cc: string[], bcc: string[],
subject: string, text: string, fileIds: number[], uploadIds: number[], back: string }`. Unknown shapes are refused
(`compose_send_failed`); `back` through `isSafeNext`.

Order (no Storage or Google call inside `sql.begin()`):

1. Gmail mode off → `gmail/off`; connection none or disconnected → `gmail/not_connected`; `needs_reconnect` → `gmail/needs_reconnect`.
2. Pure checks (`validateCompose`) → `refused` with every failing code.
3. Record: visible to the user and exists, else `compose_record_not_found`; archived → `compose_record_archived`.
4. Attachments: each `fileIds` entry a `files` row of that record and `visibleFile()`; each `uploadIds` entry an
   `email_uploads` row of this user; total ≤ `MAX_FILE_BYTES` → else `compose_attachment_gone` / `compose_attachments_too_large`.
5. Claim the ledger row (`email_sends`, `on conflict (user_id, send_key) do nothing`). Not claimed (already pressed) →
   `sent` with no second send.
6. Read the attachments' bytes (`readObject`); missing or wrong size → delete the claim, `compose_attachment_gone`;
   Storage unreachable → delete the claim, `compose_send_failed`.
7. `sendGmail(userId, { to, cc, bcc, subject, text, fromName, messageId, attachments })`:
   `GmailNotConnected` / `GmailNeedsReconnect` → delete the claim → `gmail/...`; `GmailUnavailable`, `BadHeader` →
   delete the claim → `compose_send_failed`; `GmailTooLarge` → delete the claim → `compose_attachments_too_large`.
8. Store the Gmail ids on the claim; `storeMessage(connectionId, sentMessage(…))` (SF-118's one transaction: the message,
   SF-127's `processMessage`, then `completePendingSend`: the hand link to the record and the claim `sent`). A failure
   there is logged and followed by `runAfterResponse(() => syncConnection(connectionId))`, never shown.
9. The sent uploads' cleanup due now; `sweepFileCleanup()` after the response.
10. `setFlash({ code: "email_sent", name: <first addresses>, count: <all addresses> })`; `sent`. The client goes to `back` and refreshes.

The page then shows the flash notice once ("Email sent to …").

## Server functions

- `src/server/emails/compose-rules.ts` (pure, client-safe): `splitAddresses`, `normaliseRecipients` (dedupe across
  fields), `validateCompose`, `totalBytes`, `sentNotice`, limits `MAX_RECIPIENTS = 100`, `MAX_SUBJECT = 250`,
  `MAX_TEXT = 100_000`. The Message-ID is made in `compose.ts` (it needs `node:crypto`, server only).
- `src/server/emails/compose.ts`: `emailBox(viewerId, target)` (the overlay's data: Gmail state, From, To to fill,
  record files), `startEmailUpload`, `sendFromRecord(actorId, input, now = new Date())`, `sentMessage(…)` (the
  `ReadMessage` of what was sent), `completePendingSend(db, connectionId, messageId)` (called by `gmail/sync.ts`
  `storeMessage` in its transaction), `onRecordSentForTests`.
- `src/server/gmail/sync.ts` `storeMessage`: also for a message already stored (select its id, `processMessage`,
  `completePendingSend`); return value unchanged.
- No new timeline or visibility function: SF-127's `timelineEmails` and `visibleConversation()`.
