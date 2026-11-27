# Contract: outside calls (SF-129)

## Gmail — `users.messages.send`, simple media upload

Pinned schema: `gmail-api.json` @ googleapis/google-api-go-client 3f740bc (`resources.users.resources.messages.methods.send`:
`supportsMediaUpload: true`, `mediaUpload.accept: ["message/*"]`, `maxSize: "36700160"`, simple path
`/upload/gmail/v1/users/{userId}/messages/send`).

```
POST https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media
Authorization: Bearer <access token>
Content-Type: message/rfc822

<RFC 5322 message bytes, CRLF line ends>
```

- 200 → `Message` JSON; the CRM reads `id` and `threadId` (both strings, else `GoogleUnavailable(200, "bad_send")`).
- 401 / `invalid_grant` on the token refresh → `GoogleKeyRefused` → `markNeedsReconnect` (unchanged SF-118 mapping);
  413 / 400 → `GoogleUnavailable` (never expected: the CRM checks 36,700,160 bytes first); 429 / 5xx / time-out (40 s) →
  `GoogleUnavailable`.
- Used by `sendGmail` whenever `threadId` is absent (this issue and the Settings test email). With a `threadId` the
  existing `POST gmail/v1/users/me/messages/send` with `{ raw, threadId }` stays.

The message (`buildMime`):

```
From: Ada Fake <ada@barnacle.ai>
To: ana@example.test
Cc: …                      (when any)
Bcc: …                     (when any; Gmail removes it from what recipients get)
Subject: <RFC 2047 when not printable ASCII>
Date: <RFC 5322 date>
Message-ID: <crm-<24 hex>@barnacle.ai>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="crm-<hex>"     (with attachments; else the text part's headers directly)

--crm-<hex>
Content-Type: text/plain; charset="UTF-8"
Content-Transfer-Encoding: base64

<text, base64, 76-character lines>
--crm-<hex>
Content-Type: application/pdf; name="proposal.pdf"
Content-Disposition: attachment; filename="proposal.pdf"; filename*=UTF-8''proposal.pdf
Content-Transfer-Encoding: base64

<bytes, base64, 76-character lines>
--crm-<hex>--
```

The fake (`FakeGoogleMail`, `src/server/gmail/fake-gmail.ts`) answers the upload path too: it reads the body as the
message, parses `multipart/mixed` (and the nested parts it already reads), keeps each attachment part (SF-127 already keeps attachment bytes for `getAttachment`; reuse it) with its
`filename`, `mimeType`, `body.size` and `body.attachmentId` (bytes kept in its state, readable by tests through
`sentMessages(email)` → `{ to, cc, bcc, subject, text, attachments: { name, type, bytes } }`), removes `Bcc` from stored
headers, keeps a given `Message-ID`, labels SENT, and answers `{ id, threadId, labelIds }`. `tests/fakes/gmail.ts`
checks the upload request (path, `uploadType=media`, content type in `accept`, size ≤ `maxSize`) and the answer against
the discovery document's `mediaUpload` and `Message` schema. `failSend` / `refuseKey` switches cover FR-008 / FR-009.

## Supabase Storage — read a whole object

Pinned schema: `storage_v0_openapi.json` @ supabase/supabase aa0fb9e (`/object/authenticated/{bucketName}/{*}` GET).

```
GET <SUPABASE_URL>/storage/v1/object/authenticated/<bucket>/<path>
Authorization: Bearer <service key>        (as storage.ts's call())
```

- 200 → the bytes (`readObject(path, size)` returns them when their length is `size`, else `null`);
  400 / 404 → `null`; network error, time-out (30 s) or 5xx → `StorageUnreachable`.
- The signed upload (`POST /object/upload/sign/{bucket}/{*}`, then the browser's PUT) and the bulk delete are SF-116's,
  unchanged. `FakeStorage` already serves the GET without a Range header; Build checks it and adds it if not.
