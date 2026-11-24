# Contract: Google calls, settings, Google Cloud setup and the fake (SF-118)

## Schemas (pinned in `scripts/fetch-schemas.mjs`, downloaded to `.factory/schemas/`)

| File | URL | sha256 |
|---|---|---|
| `gmail-api.json` | https://raw.githubusercontent.com/googleapis/google-api-go-client/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json | `839b7963df95481f3cd2ba7aa1e906f1fc67c4ae89719d09bb7305040e99f0fb` |
| `pubsub-api.json` | https://raw.githubusercontent.com/googleapis/google-api-go-client/3f740bc15212818d4d0eb041b02c951457ff63fa/pubsub/v1/pubsub-api.json | `df690a6912844276487a3dae9db3346e65b19aa5434ab0ae024fc89dcffffc17` |

The existing `oauth2-api.json` entry is unchanged.

## Calls (all with a 10 s time-out; Gmail calls with `authorization: Bearer <access token>`, `userId = me`)

| Purpose | Method and URL | Body / query | Used fields of the answer |
|---|---|---|---|
| Exchange code | `POST https://oauth2.googleapis.com/token` | form: `grant_type=authorization_code`, `code`, `redirect_uri=${APP_URL}/settings/gmail/callback`, `client_id`, `client_secret`, `code_verifier` | `access_token`, `refresh_token`, `scope`, `expires_in` |
| Refresh | same URL | form: `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret` | `access_token`; error `invalid_grant` = key refused |
| Revoke | `POST https://oauth2.googleapis.com/revoke` | form: `token` | status only |
| Signing keys | `GET https://www.googleapis.com/oauth2/v3/certs` | — | `keys[]` (`kid`, `kty`, `n`, `e`, `alg`); `cache-control: max-age` |
| Profile | `GET https://gmail.googleapis.com/gmail/v1/users/me/profile` | — | `emailAddress`, `historyId` |
| Watch | `POST …/gmail/v1/users/me/watch` | `{ topicName: GMAIL_PUBSUB_TOPIC }` (all labels) | `historyId`, `expiration` |
| Stop | `POST …/gmail/v1/users/me/stop` | — | status only |
| History | `GET …/gmail/v1/users/me/history` | `startHistoryId`, `historyTypes=messageAdded`, `maxResults=500`, `pageToken` | `history[].messagesAdded[].message.id`, `historyId`, `nextPageToken`; `404` = history gone |
| List (catch-up) | `GET …/gmail/v1/users/me/messages` | `q=after:<unix s>`, `maxResults=500`, `includeSpamTrash=false`, `pageToken` | `messages[].id`, `nextPageToken` |
| Get message | `GET …/gmail/v1/users/me/messages/{id}` | `format=full` | `id`, `threadId`, `labelIds`, `internalDate`, `payload` (`headers`, `mimeType`, `filename`, `body.size`, `body.data`, `body.attachmentId`, `parts`) |
| Thread headers | `GET …/gmail/v1/users/me/threads/{id}` | `format=metadata`, `metadataHeaders=Message-ID`, `References`, `Subject` | `messages[].payload.headers` |
| Send | `POST …/gmail/v1/users/me/messages/send` | `{ raw, threadId? }` | `id`, `threadId` |

Push (Google → app): `POST ${APP_URL}/gmail/push`, `Authorization: Bearer <OIDC JWT>`, body
`{ "message": { "data": base64(JSON { "emailAddress", "historyId" }), "messageId", "publishTime", "attributes"? }, "subscription" }`.

## Settings (`.env.example` and README § Settings)

| Name | Needed | Meaning |
|---|---|---|
| `GMAIL_PUBSUB_TOPIC` | production (Gmail) | `projects/<project>/topics/<topic>`. When empty with `APP_ENV` development/test, the fake Gmail is used. When empty otherwise, Gmail can't be connected (the rest of the app works). |
| `GMAIL_TOKEN_KEY` | with `GMAIL_PUBSUB_TOPIC` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the stored Gmail keys (separate from `PIPEDRIVE_TOKEN_KEY`; never the same value). Secret. Changing it forces every user to reconnect. No built-in value: without it Gmail is off, in development too. |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | with `GMAIL_PUBSUB_TOPIC` | The service account email the push subscription signs with. |
| `GMAIL_PUSH_AUDIENCE` | optional | The push token's audience. Default `${APP_URL}/gmail/push`. |
| `GMAIL_PUSH_SUBSCRIPTION` | optional | `projects/<project>/subscriptions/<name>`. When set, other subscriptions are refused. |
| `CRON_SECRET` | production | Vercel sends it to `/cron/gmail` as `Authorization: Bearer …`. Secret, at least 16 characters. |

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_URL` are re-used (same Internal app).

## Google Cloud setup before go-live (README § Gmail)

1. In the Internal OAuth app's project: enable the Gmail API and the Cloud Pub/Sub API. Add the scopes `gmail.modify` and
   `gmail.send` to the consent screen. Add the redirect URI `${APP_URL}/settings/gmail/callback`.
2. Create the topic and grant `gmail-api-push@system.gserviceaccount.com` the Pub/Sub Publisher role on it.
3. Create a service account for push (no keys needed). Create a push subscription to `${APP_URL}/gmail/push` with
   authentication on that service account, audience = `GMAIL_PUSH_AUDIENCE`, and an acknowledgement deadline of 60 s.
4. Set the settings above in Vercel. `vercel.json` schedules `/cron/gmail` every 15 minutes (Vercel Pro).

## Fake (`src/server/gmail/fake-gmail.ts`, `tests/fakes/gmail.ts`)

**Behaviour copied from Google**:
- **Codes**: one use only, 10 minutes. `invalid_grant` for an unknown, used or expired code, or a wrong `code_verifier`
  (RFC 7636). `invalid_client` for a wrong secret.
- **Scopes**: the `scope` answer lists only the ticked scopes.
- **Refresh tokens**: valid until revoked or refused (`invalid_grant`). Access tokens last 1 hour, and a revoked
  refresh token takes its access tokens with it (`401`). `revoke` answers `200`, or `400 invalid_token` for an unknown
  token.
- **History**: ids rise. `history.list` with a `startHistoryId` older than the kept window (switch `forgetHistory()`)
  answers `404`. Messages are listed newest first. `q=after:` is in seconds.
- **Watch**: `expiration` is 7 days ahead, in ms, as a string. `stop` cancels it. A notice for a user is only sent while
  a watch is active.
- **Gmail `403`** with reason `insufficientPermissions` for a call outside the token's scopes.
- **Push**: the JWT is signed RS256 by the fake's key and served at the certs URL. Claims: `iss`, `aud`, `email`,
  `email_verified`, `iat`, `exp`, `sub`.

**Switches**: `down()` (network error), `refuseKey(email)`, `failWatch(on)`, `forgetHistory()`, `advance(ms)`,
`deliver(email)` / `dropNotice()`, `requests`, `mailbox(email)`, `sent(email)`, `tokenStatus(token)`.

**Checks (tests)**:
- Every Gmail request: path and method among `gmail-api.json` methods, query parameters declared for that method,
  JSON body properties declared in `WatchRequest` / `Message`.
- Every Gmail answer's properties are declared in its response schema (`Profile`, `WatchResponse`,
  `ListHistoryResponse` → `History` → `HistoryMessageAdded` → `Message`, `ListMessagesResponse`, `Message` →
  `MessagePart` → `MessagePartHeader`, `MessagePartBody`, `Thread`), with the declared JSON types (`int64` and
  `uint64` as strings).
- Every push body's `message` properties are declared in `PubsubMessage` (`pubsub-api.json`), with `data` base64.
- The token, revoke and certs answers follow RFC 6749 §5.1/§5.2 and §6, RFC 7009 §2.2 and RFC 7517 §5. They are not
  in a schema: see plan.md § Outside services.
- A request or answer outside these schemas makes the test fail.
