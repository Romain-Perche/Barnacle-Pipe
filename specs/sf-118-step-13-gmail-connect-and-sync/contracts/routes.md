# Contract: pages, routes, actions, domain functions, messages (SF-118)

## Pages

| Path | Who | What |
|---|---|---|
| `/settings` | any signed-in active user (`requireUser()`) | SF-117's existing page (head `// YOU` / "Settings", then `// PIPEDRIVE`). SF-118 adds the Gmail card (design B) after the Pipedrive section. The user's own connection only. |
| `/dev/fake-google/gmail` | public, 404 unless `isFakeAllowed()` and Gmail mode `fake` | The fake consent screen (research.md §14). |
| `/dev/fake-gmail` | public, same 404 rule | The fake mailbox page (FR-018). |

`src/proxy.ts`: add `/^\/dev\/fake-google\/gmail\/?$/`, `/^\/dev\/fake-gmail\/?$/`, `/^\/gmail\/push\/?$/` and
`/^\/cron\/gmail\/?$/` to `PUBLIC`. These routes check their own proof. `/settings/gmail/callback` stays protected.

### `/settings` query parameters (all looked up in fixed lists; anything else is ignored)
- SF-117's own parameters (`error`, `saved`, `removed`, `replace`, `remove-token`) are unchanged and only touch the
  Pipedrive section; the Gmail card reads only `gmail` and `disconnect`.
- `gmail=<code>`: a notice code from § Messages (`connected`, `reconnected`, `not_connected`, `wrong_account`,
  `missing_scopes`, `disconnected`, `test_sent`, `test_failed`, `unavailable`). The `connected`, `reconnected`,
  `disconnected` and `test_sent` notices are shown once. They come from the flash cookie (`records/flash.ts`, as in
  SF-102), not from `?gmail=`, so a reload does not show them again. Errors are shown from `?gmail=`.
- `disconnect=1`: opens the confirmation box "Disconnect Gmail? …" with `[ DISCONNECT ]` (red) and `[ CANCEL ]`.

### Gmail card (design B, `design-options.html` option B)
| State | Heading | Body | Heading buttons |
|---|---|---|---|
| mode `off`, no working row | `Gmail` | "Gmail can't be connected right now." | none |
| no row / `disconnected` | `Gmail` | "Gmail is not connected." | `[ CONNECT GMAIL ]` (solid) |
| `working` | green dot · `Gmail · connected` | "Connected as <email>", "Last sync: <time or Not synced yet>", "<n> conversation(s) copied", "Copying since <connected_at>" | `[ SEND ME A TEST EMAIL ]`, `[ DISCONNECT ]` (red) |
| `needs_reconnect` | red dot · `Gmail · needs reconnecting` | the `needs_reconnect` message with <email>, then the last sync, count and copying-since lines as they were | `[ RECONNECT GMAIL ]` (solid), `[ DISCONNECT ]` (red) |

Times are shown with `src/server/format.ts`, in UK time like the rest of the app.

### Sidebar
No new nav entry: SF-117's `footerNav` already holds `{ href: "/settings", label: "Settings" }`, rendered at the
bottom of the sidebar above `[ SIGN OUT ]`. `SidebarLink` gets `warn?: boolean` and that footer link gets it. The layout and `currentSidebar()` give `warn` = `gmailNeedsReconnect(user.id)`.

## Routes

| Route | Method | Proof | Answer |
|---|---|---|---|
| `/settings/gmail/callback` | GET | session (`requireUser()`) + cookie `crm_gmail_oauth` (state, verifier, userId) | 303 to `/settings` with the flash or `?gmail=<code>`. The cookie is always cleared. |
| `/gmail/push` | POST | Google OIDC JWT (research.md §6) | `403` bad proof · `400` bad body · `204` otherwise. Empty bodies, never data. `export const maxDuration = 60`. |
| `/cron/gmail` | GET | `Authorization: Bearer ${CRON_SECRET}`, constant-time | `401` without it · `204` after `runGmailCheck`. Empty body. `export const maxDuration = 300`. |

`vercel.json` (new): `{ "crons": [{ "path": "/cron/gmail", "schedule": "*/15 * * * *" }] }`.

## Server actions (added to SF-117's `src/app/(app)/settings/actions.ts`, each `requireUser()` first)

| Action | Does |
|---|---|
| `startGmailConnect()` | Refuses with `unavailable` when mode is `off`. Sets the `crm_gmail_oauth` cookie and `redirect(consentUrl)`. Used by CONNECT and RECONNECT. |
| `disconnectGmail()` | `disconnect(user.id)`, then flash `disconnected` and redirect `/settings`. |
| `sendTestEmail()` | `sendGmail(user.id, test email)`: flash `test_sent`, or `?gmail=test_failed`, or `needs_reconnect` (redirect only, the card shows the state). |

## Domain functions (`src/server/gmail/`)

- `env.ts` → `gmailConfig(): { mode: "real" | "fake"; clientId; clientSecret; appUrl; tokenKey: Buffer; topic;
  pushAudience; pushServiceAccount; pushSubscription | null; cronSecret } | { mode: "off" }`.
- `rules.ts` (pure):
  - `GMAIL_SCOPES`;
  - `hasAllScopes(scope)`;
  - `parseAddressList(header)` → `{ email, name }[]`;
  - `decodeHeader(value)` (RFC 2047);
  - `readMessage(gmailMessage)` → the stored shape (research.md §9);
  - `decideCopy({ labelIds, internalDate, connectedAt, threadKnown, addresses, crmAddresses })` → `"copy" | "skip"`;
  - `buildMime(input)` (research.md §10, throws `BadHeader` on CR/LF);
  - `testEmail(address)`;
  - `classifyGoogleError(status, body)` → `"key_refused" | "unavailable"`.
- `src/server/crypto/seal.ts` (shared with Pipedrive, replaces `pipedrive/crypto.ts`): `sealToken(key, purpose, userId, token)` /
  `openToken(key, purpose, userId, sealed)`, `TokenUnreadable`; purposes `"pipedrive-token"` and `"gmail-token"`.
  `env.ts` `readTokenKey(raw)`: 32 bytes from base64, else null (used by `pipedriveConfig()` and `gmailConfig()`).
- `google-api.ts`:
  - `consentUrl({ state, codeChallenge, loginHint })`;
  - `exchangeGmailCode(code, verifier)` → `{ refreshToken | null, accessToken, scope }`;
  - `refreshAccessToken(refreshToken)`;
  - `revokeToken(token)`;
  - `getProfile`, `watch`, `stopWatch`, `listHistory`, `listMessages`, `getMessage`, `getThreadMetadata`, `sendRaw`;
  - errors `GoogleKeyRefused`, `GoogleUnavailable`, `HistoryGone`;
  - `useGmailFetchForTests(fn)`.
- `push.ts`: `verifyPushToken(authorization, cfg)`, `receiveGmailPush(authorization, body)` →
  `{ status: 204 | 400 | 403 }`.
- `connections.ts`:
  - `gmailSettings(userId)` → `{ mode, state, email, lastSyncedAt, connectedAt, conversations }`, never the cipher;
  - `gmailNeedsReconnect(userId)`;
  - `finishConnect(userId, { refreshToken, scope, profile })` → `"connected" | "reconnected"`;
  - `disconnect(userId)`;
  - `forgetGmailInTx(db, userId)` and `afterGmailForgotten(token)` (used by `users.deactivate`);
  - `markNeedsReconnect(connectionId)`;
  - `loadKey(connectionId)` (the only reader of `token_cipher`).
- `sync.ts`: `syncConnection(connectionId, now)` → `{ copied: number } | { skipped: "busy" | "not_working" }`;
  `runGmailCheck(now)`.
- `send.ts`: `sendGmail(userId, { to, cc?, bcc?, subject, text, html?, threadId? })` → `{ messageId, threadId }`.
  Throws `GmailNotConnected`, `GmailNeedsReconnect` or `GmailUnavailable`, and never sends in those cases.
- `fake-gmail.ts`: `FakeGoogleMail`, `fakeGmail()` (contracts/google.md § Fake).

## Messages (`src/server/messages.ts`)

`messages`:
- `gmail_not_connected`: "Gmail is not connected."
- `gmail_unavailable`: "Gmail can't be connected right now."
- `gmail_connected`: "Gmail connected."
- `gmail_reconnected`: "Gmail reconnected."
- `gmail_cancelled`: "Gmail was not connected."
- `gmail_missing_scopes`: "Gmail needs all the permissions asked for. Try again and tick every box."
- `gmail_disconnected`: "Gmail disconnected."
- `gmail_disconnect_confirm`: "Disconnect Gmail? New email will stop being copied. Emails already copied stay in the CRM."
- `gmail_test_failed`: "The test email could not be sent. Try again in a minute."
- `gmail_not_synced`: "Not synced yet"
- `gmail_test_subject`: "Barnacle CRM test email"
- `gmail_test_text`: "This is a test email from Barnacle CRM. If you can read it, the CRM can send email from your Gmail."
- `gmail_settings_warn`: "Gmail needs reconnecting"

`templates` (built only from the user's own address or numbers from the database):
- `gmail_connected_as(email)` → `Connected as ${email}`
- `gmail_wrong_account(email)` → `Connect the Gmail account you sign in with (${email}).`
- `gmail_needs_reconnect(email)` → `Google no longer accepts the CRM's access to ${email}. Reconnect to carry on copying email.`
- `gmail_test_sent(email)` → `Test email sent to ${email}. Check your inbox.`
- `gmail_conversations(n)` → `${n} ${n === 1 ? "conversation" : "conversations"} copied`
- `gmail_last_sync(time)` → `Last sync: ${time}`
- `gmail_copying_since(time)` → `Copying since ${time}`

Buttons: `[ CONNECT GMAIL ]`, `[ RECONNECT GMAIL ]`, `[ SEND ME A TEST EMAIL ]`, `[ DISCONNECT ]`, `[ CANCEL ]`.
