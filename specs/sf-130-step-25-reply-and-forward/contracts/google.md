# Contract: outside calls (SF-130)

Pinned schema: `gmail-api.json` @ googleapis/google-api-go-client 3f740bc (no new pin).

## Gmail `users.messages.send`, multipart upload (in the user's thread)

`resources.users.resources.messages.methods.send.mediaUpload`: `accept ["message/*"]`, `maxSize "36700160"`,
`protocols.simple { multipart: true, path: "/upload/gmail/v1/users/{userId}/messages/send" }`.

```
POST https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart
Authorization: Bearer <access token>
Content-Type: multipart/related; boundary="crm-<hex>"

--crm-<hex>
Content-Type: application/json; charset=UTF-8

{"threadId":"<the user's Gmail thread id>"}
--crm-<hex>
Content-Type: message/rfc822

<RFC 5322 bytes, CRLF line ends>
--crm-<hex>--
```

- `google-api.ts` `sendRawUpload(access, mime, threadId?)`: no `threadId` → SF-129's `uploadType=media` request,
  unchanged; with one → the request above. Same 40 s time-out and error mapping (401 / `invalid_grant` →
  `GoogleKeyRefused`; 400 / 413 / 429 / 5xx / time-out → `GoogleUnavailable`); 200 → `Message`, `id` and `threadId`
  read as strings, else `GoogleUnavailable(200, "bad_send")`.
- The RFC 5322 message (`buildMime`) is SF-129's, plus:
  ```
  In-Reply-To: <answered Message-ID>                (when any)
  References: <id1> <id2>                           (when any; folded at spaces, each line ≤ 998 octets)
   <id3>
  ```
- `sendGmail`: `SendInput` gains `inReplyTo?: string | null`, `references?: string[]`; the `getThreadMetadata` lookup is
  removed (research §2); `threadId` present → `sendRawUpload(access, bytes, threadId)`; the `> MAX_RAW_BYTES` check stays
  before any call. `sendRaw` (JSON) and `getThreadMetadata` are removed when nothing else uses them.

## Gmail `users.messages.get` + `users.messages.attachments.get` (forwarded attachments)

SF-127's `fetchAttachment` unchanged (`getMessage` → `attachmentParts(payload)[position]` → `body.data` or
`getAttachment`), 10 s per call. `attachmentAccess(viewerId, id, { preferConnectionId })` only reorders candidates.

## Fake (`FakeGoogleMail`) and its check (`tests/fakes/gmail.ts`)

- Fake: the upload route accepts `uploadType=multipart` with `multipart/related` (JSON part, then a `message/*`
  part), keeps the thread when the JSON names a thread of that mailbox (as the JSON send did), stores In-Reply-To /
  References with the other headers, answers `{ id, threadId, labelIds }`. `sentMessages(email)` adds `inReplyTo`,
  `references` (unfolded). `failAttachments` (or the existing unreachable switch) makes attachment reads fail, for
  US4 scenario 7.
- Check: `uploadType` ∈ {`media`, `multipart`}; for `multipart`, `protocols.simple.multipart === true`, path equals
  `protocols.simple.path`, part 1 is JSON whose keys are all properties of the `Message` schema, part 2 content type
  matches an `accept` entry, message size ≤ `maxSize`; the answer is checked against `Message`.

## Supabase Storage

SF-129's `readObject` for record and computer files, unchanged.
