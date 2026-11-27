# Research: Reply and forward (SF-130)

All open points of the Technical Context are settled below. Base: `main` with SF-118, SF-127, SF-128 and SF-129 merged.

## §1 Same CRM conversation, whichever mailbox the conversation came from

- **Finding**: SF-127's `processMessage` puts a stored message in a conversation only through (a) its `email_threads`
  row's `conversation_id`, or (b) another mailbox's copy of the **same** Message-ID. A reply has a new Message-ID. When
  the user's own mailbox holds the conversation, the reply is sent with that `threadId` (§3), so (a) already works. When
  the conversation was copied only from a colleague's mailbox, Gmail starts a new thread in the user's mailbox. Its
  `email_threads` row is new (`conversation_id` null), so SF-127 would create a **new** conversation. That breaks FR-014.
- **Decision**: the SF-129 ledger row of the send names the email answered: new column
  `email_sends.reply_message_id` (→ `email_messages.id`, `on delete set null`). In `gmail/sync.ts` `storeMessage`,
  right after the thread row is found and **before** `processMessage`, a new `placePendingReply(db, connectionId,
  threadRowId, m)` (in `emails/reply.ts`) runs. It looks for the ledger row of this connection in state `sending`
  matching `gmail_message_id = m.gmailMessageId` or `rfc_message_id = m.rfcMessageId`, with `reply_message_id` not
  null. When it finds one and the thread row has no conversation yet, it sets
  `email_threads.conversation_id` = the conversation of the answered email's thread. `processMessage` then keeps that
  conversation (its "own" conversation), adds the reply's addresses and runs `autoLink`. The sync storing the email
  first (send path failed after Gmail accepted) goes through the same `storeMessage`, so it gives the same result. The
  ledger row is matched by `rfc_message_id`, which the CRM sets before any Google call.
- **Catch-up by the sync** (edge case "Sent but the CRM could not record it"): SF-118's `decideCopy` skips a message
  in an unknown thread with no CRM address. A forward to "ed@example.test" in a new Gmail thread would then never be
  copied. `decideCopy` gains `pendingSend: boolean` (true → `"copy"`, after the label and date rules). `runOnce` sets
  it for a fetched message whose Gmail id or Message-ID matches an `email_sends` row of this connection in state
  `sending`. The same holds for SF-129's own sends.
- Thread row already in another conversation: never happens through the CRM (the reply then uses that thread, §3).
  If it does, the thread's own conversation is kept, as SF-127 does.
- Answered email deleted between the send and storing (its mailbox forgotten): `reply_message_id` is null, so SF-127's
  usual rule applies (a new conversation). FR-013 has already re-checked just before sending.
- **Alternatives**: store In-Reply-To / References on every message and join through them in `processMessage`. That
  changes SF-127 for every copied email and needs a migration of the 0016 table plus a backfill, so it was not chosen.
  Merging conversations after the fact was not chosen either: links would be merged by `mergeLinkChoice`, which is
  more change than needed.

## §2 Threading headers from the CRM's own data

- **Decision**: In-Reply-To = the answered email's `rfc_message_id` (left out when null). References = the
  `rfc_message_id`s of the conversation's shown emails (one per `dedupe_key`, as `getConversation`), ordered by
  `received_at, id`, up to and including the answered one, without duplicates, keeping only values that match
  `^<[^<>\s]{1,996}>$`. When that list is empty, the header is left out (FR-010).
- The ids are written separated by single spaces. `buildMime` folds the References value at the spaces (`CRLF` + one
  space) so that no line is over 998 octets. A long conversation is never cut: FR-010 asks for all of them. The fake's
  MIME reader already unfolds continuation lines (`fake-gmail.ts` `readPart`).
- SF-118's `sendGmail` used to read the thread's last Message-ID from Gmail (`getThreadMetadata`) when a `threadId` was
  given. No caller passes a `threadId` today. `SendInput` gains explicit `inReplyTo` / `references`, and the Gmail
  lookup is removed (with `getThreadMetadata` / `sendRaw` in `google-api.ts` when nothing else uses them). The headers
  are the same whichever mailbox holds the conversation, which FR-010 asks for.

## §3 Same Gmail thread for the user (FR-011), with large attachments

- **Decision**: the user's Gmail thread = the user's own `email_threads` row in the answered email's conversation.
  It is the one holding a copy of the answered email (same `dedupe_key`) first, else the user's thread of that
  conversation with the newest message. None → no `threadId`.
- Sending with a `threadId` and attachments up to 25 MB: SF-129 found the JSON `{ raw, threadId }` call limited to a
  few MB. The pinned `gmail-api.json` says `mediaUpload.protocols.simple.multipart: true` on
  `/upload/gmail/v1/users/{userId}/messages/send`. So with a `threadId`, the send is a **multipart upload**:
  `?uploadType=multipart`, `Content-Type: multipart/related; boundary=…`. The first part is `application/json;
  charset=UTF-8` `{"threadId":"…"}` (the `Message` schema's `threadId`), the second part is `message/rfc822` (the
  RFC 5322 bytes). The size limit (`maxSize` 36,700,160) is checked on the RFC 5322 bytes before any call, as SF-129
  does. Without a `threadId`, SF-129's simple `uploadType=media` call is unchanged.
- **Alternatives**: the JSON `raw` call for replies (refused above a few MB: forwards with attachments would fail);
  resumable upload (two requests, nothing gained at this size).

## §4 Forwarded attachments (FR-006, FR-012)

- **Decision**: the box lists the answered email's `email_attachments` rows (name, size from SF-118's stored size).
  The send input carries `forwardIds` (attachment ids of that email). At send time each is checked to belong to the
  answered message, then fetched with SF-127's `attachmentAccess` + `fetchAttachment` (a working mailbox holding a
  copy, then the others). FR-012 says "the user's own first", so `attachmentAccess` gains an optional
  `preferConnectionId` that puts that connection's candidate first; the attachment page's order is unchanged
  otherwise. Bytes are held in memory only for the send; nothing is stored or logged.
- Sent with the stored `name` and `content_type`. The 25 MB check counts the stored sizes together with record and
  computer files (`MAX_ATTACHMENT_BYTES`).
- A fetch giving `"unavailable"` → the ledger claim is deleted and the answer is the refusal `reply_forward_unavailable`
  (fixed text of US4 scenario 7); the box keeps everything (SF-129's box behaviour).
- Order of a send: the checks → ledger claim → Storage reads (record files, uploads) → Gmail attachment fetches → the
  send → storing. No Google or Storage call inside `sql.begin()`. Time: Gmail calls keep the 10 s time-out of
  `google-api.ts` per call, and the four pages plus the conversation page export `maxDuration = 60`.

## §5 Filling the box (pure, `src/server/emails/reply-rules.ts`)

- **Own address**: the user's `gmail_connections.email`, compared lower-cased.
- **Reply** (FR-004): when `from` equals the own address → the email's To addresses; else `[from]` (none when there is
  no sender: "Unknown sender" edge case). The own address is **not** removed here (edge case "sent only to
  themselves").
- **Reply all** (FR-005): To = Reply's list followed by the email's To; Cc = the email's Cc. Then the own address is
  removed (any case), and each address is kept once at its first place (To before Cc). Bcc never.
- **Subjects** (FR-007): `replySubject(s)`: `/^\s*re\s*:/i` → `s` unchanged; empty → `"Re: (no subject)"`; else
  `"Re: " + s`. `forwardSubject(s)`: `/^\s*(fwd?|fw)\s*:/i` → unchanged; empty → `"Fwd: (no subject)"`; else
  `"Fwd: " + s`.
- **Quote** (FR-008): the text is SF-127's `emailText(text_body, html_body)` ('' when null), with line ends normalised
  to `\n`. Reply: `On <date>, <who> wrote:` then each line as `> ` + line (an empty line gives `>`, trailing space
  trimmed). Forward: `---------- Forwarded message ---------`, `From: <who>`, `Date: <date>`, `Subject: <subject as
  stored>`, `To: <To list as addressText, comma separated>`, an empty line, then the text unchanged. `<who>` =
  `addressText(from)` ("Ana Fake <ana@example.test>", or the address alone); no sender → `Unknown sender`
  (`messages.email_unknown_sender`). `<date>` = UK time `27 Nov 2026 at 14:05` (`formatDate` + `at` + `HH:MM` from
  `ukParts`, the answered email's `received_at`).
- **Body sent** (FR-010): `text + "\n\n" + quote`. The 100,000 limit is checked on `text` alone (edge case "Long
  quotes"). Stored copy: `textBody` = the whole body sent, as the sync would read it.
- The quote is built on the server from the database both for the box (shown read-only) and at send time; the client
  never sends it.

## §6 Address of the box (`?email=`)

- **Decision**: SF-129's `?email=new` gains `reply-<id>`, `reply-all-<id>`, `forward-<id>`, where `<id>` is the
  `email_messages.id` that the timeline entry / conversation page shows (the shown copy). The pure parser
  `parseEmailParam(v)` in `reply-rules.ts` returns `{ mode: "new" } | { mode: "reply" | "reply_all" | "forward";
  messageId }` or null. Ids as `parseId`.
- Pages: deal page, board with drawer, person page, organisation page (SF-129's `EmailOverlay`) and the conversation
  page `/emails/[id]` (new: `EmailOverlay` with no record target, or with the `?from=` record when the viewer can see
  it). `back` = the page's own address without `email` (on the conversation page: `/emails/<id>` plus `?from=` when
  shown). After sending, the box goes to `back` (SF-129), so the drawer stays open.
- `RecordTimeline`'s `emailHref` prop becomes `emailBase` (the page address ending with `email=`), and the timeline
  builds `${emailBase}new` and `${emailBase}reply-<id>` etc. All callers of `emailHref` change with it.

## §7 Who sees the buttons (FR-001, FR-002)

- `replyState(viewerId)` → `"ok" | "connect" | "reconnect" | "off"`, from `gmailConfig().mode` and the connection
  state (SF-129's `gmailState`: off / not_connected / needs_reconnect / ok), read once per page.
- Timeline: `EmailEntry` gets `reply: { state, base } | null`. It is null when the record is archived or there is no
  `emailBase` (the deal list's drawer); `off` shows nothing. The entries only exist for conversations the viewer can
  see (SF-127), so no extra check is needed. Conversation page: the same, for every email, whenever the page shows
  (it is shown only when visible).
- Opening an address directly: the overlay checks the conversation through `visibleConversation()`. Hidden or missing
  → the box opens with SF-127's message `email_not_found` and no `[ SEND ]` (edge case "Who sees the buttons"). A
  record page whose record is archived or hidden opens nothing (SF-129).

## §8 Sending (`sendReply` in `emails/reply.ts`, sharing SF-129's steps)

- `compose.ts`'s steps 5–9 (claim, Storage reads, `sendGmail`, store, upload clean-up) are moved into one shared
  internal `deliver(…)`, used by `sendFromRecord` (unchanged behaviour) and by `sendReply`. `deliver` gains
  `replyMessageId`, `threadId`, `inReplyTo`, `references`, `forwarded` (fetched after the Storage reads) and a
  `record` that may be null (no hand link: the ledger's three record columns null). `completePendingSend` already
  skips the link when they are all null, which gives FR-015.
- `sendReply` order: Gmail usable → send key shape → pure checks (`validateCompose` on the typed text) → the answered
  email in a conversation the viewer can see (`visibleConversation`), else `email_not_found` (FR-013) → the context
  record (when given: visible, not archived, else its files are refused `compose_attachment_gone`; the reply itself
  is not refused) → record files and uploads as SF-129 → forwarded ids ⊆ the answered email's attachments, else
  `compose_attachment_gone` → total ≤ 25 MB → recipient names (SF-129's `nameRecipients`) → quote, headers, thread →
  `deliver`.
- The sent notice and flash are SF-129's (`email_sent`). The conversation page now also reads the flash
  (`readFlash(["email_sent"])`) so that "Email sent to …" shows there too (decided by the factory, see spec).

## §9 Fake Gmail and its check (FR-020)

- `fake-gmail.ts`: the upload route also answers `uploadType=multipart` (`multipart/related`: a JSON part with an
  optional `threadId`, then a `message/*` part). The thread is kept when it exists in that mailbox, as the JSON send
  does today. In-Reply-To and References are already kept in the stored headers. `SentMessage` gains `inReplyTo`,
  `references` (unfolded) and `threadId` (already there). The fake mailbox page lists, for each message, its thread
  id and, when present, In-Reply-To and References as text.
- `tests/fakes/gmail.ts` checks the multipart request: path = `mediaUpload.protocols.simple.path`,
  `protocols.simple.multipart === true`, first part JSON whose keys are all `Message` properties, second part type
  in `accept`, size ≤ `maxSize`. The answer is checked against `Message` as for the media upload.

## §10 Seed (FR-021)

- `src/seed/sent-emails.ts` gains one reply by Ada Fake to the received "Thanks, we will read it." conversation's
  newest email, through `sendReply` with a fixed send key (as SF-129's seed). Run again: the ledger's
  `(user_id, send_key)` makes it a no-op, so there are no duplicates.

## §11 Outside schemas

- Gmail API: pinned `gmail-api.json` (google-api-go-client 3f740bc) covers `messages.send` (simple media and multipart
  upload), `messages.get`, `messages.attachments.get`. No new pin.
- Supabase Storage: SF-129's object read, unchanged, pinned `storage_v0_openapi.json`.
- Google OAuth token endpoint and Supabase Postgres: as SF-129 (no public schema).

## §12 Dependencies

None. Multipart bodies, header folding and quoting are a few lines each; `dependencies.json` is `[]`.
