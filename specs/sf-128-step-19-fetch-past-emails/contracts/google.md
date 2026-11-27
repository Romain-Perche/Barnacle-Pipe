# Contract: Gmail calls (SF-128)

Schema: `gmail-api.json` pinned by `scripts/fetch-schemas.mjs`
(https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json).
All calls go through `call()` / `gmail()` in `src/server/gmail/google-api.ts` (10 s time-out, `Authorization: Bearer`
with a fresh access token from `refreshAccessToken`, never logged).

## New calls

### `listThreads(access, q, pageToken?)` → `{ ids: string[]; nextPageToken: string | null }`

`GET https://gmail.googleapis.com/gmail/v1/users/me/threads?q=<q>&maxResults=100&includeSpamTrash=false[&pageToken=…]`
(`users.threads.list`). Reads `threads[].id` and `nextPageToken` (`ListThreadsResponse`). A **400** answer while a
`pageToken` was sent throws `PageTokenRefused` (the slice restarts); other failures as `failWith`.

### `getThreadMessages(access, threadId)` → `GmailMessage[] | null`

`GET …/users/me/threads/{id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc`
(`users.threads.get`). Reads `messages[].id`, `threadId`, `labelIds`, `internalDate`, `payload.headers`. **404** → null
(thread gone).

## Reused calls

- `getMessage(access, id)` (`users.messages.get?format=full`) for each message to store; `readMessage` builds what is
  stored, as in SF-118.
- `refreshAccessToken(refreshToken)` (`POST https://oauth2.googleapis.com/token`).

## Errors (`failWith`)

| Answer | Thrown | Fetch does |
|---|---|---|
| 429 | `GmailSlowDown(seconds)` (extends `GoogleUnavailable`) | `wait_until = now + seconds` |
| 403 with `error.errors[].reason` `rateLimitExceeded` / `userRateLimitExceeded` | `GmailSlowDown(seconds)` | same |
| 401, 403 `insufficientPermissions`, token `invalid_grant` | `GoogleKeyRefused` (unchanged) | connection → `needs_reconnect` |
| network, time-out, 5xx, other 4xx | `GoogleUnavailable` (unchanged) | `problem = 'unavailable'` |

`seconds` = `slowDownSeconds(res.headers.get("retry-after"))`: numeric `Retry-After` rounded up, else 30, within 1–300.

## Fake (`src/server/gmail/fake-gmail.ts`, checked by `tests/fakes/gmail.ts` against the schema)

- `GET users/me/threads`: `q` read for `after:<n>` / `before:<n>` (epoch seconds, on `internalDate`: a thread is listed
  when one of its messages is within); `includeSpamTrash` (default false: messages labelled `SPAM` / `TRASH` do not
  make a thread listed); `maxResults` (default 100, at most 500); numeric `pageToken` (an unknown or non-numeric token →
  400 `invalidArgument`); threads ordered by their newest message; answer `{ threads?: [{ id, snippet: "", historyId }],
  nextPageToken?, resultSizeEstimate }`.
- `GET users/me/threads/{id}`: `format` `minimal` (no payload), `metadata` (headers filtered by `metadataHeaders`, the
  current behaviour), `full` (whole payload); unknown thread → 404.
- `slowDown(seconds, calls = 1)`: the next `calls` Gmail API calls answer 429 `{ error: { code: 429, status:
  "RESOURCE_EXHAUSTED", errors: [{ reason: "rateLimitExceeded" }] } }` with `Retry-After: <seconds>`; kept in the
  fake's state so a dev server's routes all see it.
- `setUnreachable(on)` (existing): every call fails as a network error.
