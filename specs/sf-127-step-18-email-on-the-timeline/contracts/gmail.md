# Contracts: Gmail calls and the fake (SF-127)

Schema: `.factory/schemas/gmail-api.json` (pinned by `scripts/fetch-schemas.mjs`, google-api-go-client
`3f740bc15212818d4d0eb041b02c951457ff63fa`). Scope: `gmail.modify` (already granted, SF-118) covers both calls.

## Calls

| Call | Method / path | Used by | Notes |
|---|---|---|---|
| messages.get | `GET /gmail/v1/users/me/messages/{id}?format=full` | download (existing `getMessage`) | 404 → `null` → next candidate |
| messages.attachments.get | `GET /gmail/v1/users/me/messages/{messageId}/attachments/{id}` | download (new `getAttachment`) | answer `MessagePartBody` `{ attachmentId?, size, data }`, `data` base64url; time-out 30 s; 404 → `null` |
| token refresh | `POST https://oauth2.googleapis.com/token` | download (existing `refreshAccessToken`) | `invalid_grant` → `GoogleKeyRefused` → `markNeedsReconnect`, next candidate |

`getAttachment(accessToken, messageId, attachmentId): Promise<Uint8Array | null>` in `google-api.ts`, through the
same `gmail()` helper (errors classified by `classifyGoogleError`). A missing or non-string `data` →
`GoogleUnavailable(200, "bad_attachment")`.

`attachmentParts(payload: GmailPart): GmailPart[]` in `gmail/rules.ts`: the parts `readMessage` counts as attachments,
in its walk order (filename not empty, or `body.attachmentId` set). `readMessage` is rewritten on top of it: stored
positions do not change.

## Fake (`src/server/gmail/fake-gmail.ts`)

- `NewMessage.attachments[]` gains optional `data?: string | Uint8Array` (default: `size` bytes of a fixed fake
  pattern) and `inline?: boolean` (bytes in `body.data`, no `attachmentId`, as Gmail does for small parts).
- The fake keeps each attachment's bytes by message and `attachmentId` (it may keep the id fixed; the CRM never
  stores it, since Gmail's can change between reads).
- New route `GET messages/{id}/attachments/{attachmentId}` → `200 { size, data }` (base64url), 404 Gmail error body
  when the message or attachment is unknown; same access-token checks and `down()` / unreachable behaviour as the
  other routes.
- `tests/fakes/gmail.ts` checks the new request against the schema like the others (`users.messages.attachments.get`).

The seed's existing attachments (`proposal-fake.pdf`, `logo-fake.png`, `notes-fake.txt`) get fake bytes, so the
download works in development.
