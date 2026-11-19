---
type: workflow
title: Google sign-in flow
description: How a barnacle.ai user signs in with Google — OAuth 2.0 code flow with PKCE and a state cookie, the token and userinfo calls, the sign-in rules, first-admin creation and session creation.
tags: [auth, google, oauth, pkce, sign-in]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-9b6c84164bd093f6dfe8789e
    resource: repo://src/app/auth/google/callback/route.ts
  - id: openwiki-source-abcfeed198165a51fb3851dc
    resource: repo://src/app/auth/google/start/route.ts
  - id: openwiki-source-3f2ee2fb46e0ca6c15612d12
    resource: repo://src/server/auth/google.ts
  - id: openwiki-source-8452a1b4f6f0b132b119bc96
    resource: repo://src/server/auth/rules.ts
  - id: openwiki-source-a5f85cf0ccc64d56b16f76bc
    resource: repo://src/server/auth/sign-in.ts
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Google sign-in flow

Sign-in is Google only, through an Internal OAuth app in the barnacle.ai Workspace. The app implements
the flow itself with two `fetch` calls, no library (`src/server/auth/google.ts`). The rules that decide
who may enter are pure functions in `src/server/auth/rules.ts`; the database side is
`completeSignIn()` in `src/server/auth/sign-in.ts`, shared with the
[fake Google login](./fake-google-login.md).

## Steps

1. **Sign-in page.** `/sign-in` shows `Sign in with Google`, linking to `/auth/google/start?next=…`.
2. **Start** (`src/app/auth/google/start/route.ts`). Refuses on previews (back to `/sign-in`). Cleans
   `next` with `isSafeNext()`, makes a random `state` and a PKCE verifier/challenge (S256), and stores
   `{ state, verifier, next }` as JSON in the `crm_oauth` cookie (httpOnly, `SameSite=Lax`,
   path `/auth/google`, 10 minutes). Redirects to Google's authorization URL with
   `scope=openid email profile`, `hd=barnacle.ai` and `prompt=select_account`. If
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` or `APP_URL` is missing, `googleConfig()` throws; the
   route logs it and redirects to `/sign-in?error=cancelled`.
3. **Callback** (`src/app/auth/google/callback/route.ts`, redirect URI
   `${APP_URL}/auth/google/callback`). Every exit clears the `crm_oauth` cookie. It refuses
   (→ `error=cancelled`) when the cookie is missing or unreadable, Google returned `error`, there is no
   `code`, or `state` does not match.
4. **Token and profile.** `signInWithGoogleCode()` posts the code, verifier and client secret to
   `https://oauth2.googleapis.com/token`, then reads `https://www.googleapis.com/oauth2/v2/userinfo`
   with the access token. Any failure on Google's side becomes `cancelled`.
5. **Rules and session.** `completeSignIn()` decides and, on success, returns a new session token.
   The callback sets it as the `crm_session` cookie and redirects to the saved `next` path.
   A refusal redirects to `/sign-in?error=<code>`.

## Sign-in rules

`decideSignIn(identity, existingUser, firstAdminEmail)` in `rules.ts`:

| Situation | Result | Message on `/sign-in` |
|---|---|---|
| Email not verified, not `…@barnacle.ai`, or Google `hd` set to another domain | `domain` | Only barnacle.ai Google accounts can sign in. |
| User row exists and is active | `ok` | — |
| User row exists and is deactivated | `removed` | Your access has been removed… |
| No row, email equals `FIRST_ADMIN_EMAIL` | `create_first_admin` | — |
| No row otherwise | `not_allowed` | This account doesn't have access yet… |

Emails are trimmed and lower-cased before any comparison. Only people an admin added on the
[Users page](../features/user-management.md), plus the first admin named in settings, can enter.

## What `completeSignIn()` writes

All in one transaction:

- For `create_first_admin`: inserts the user as an active `admin` (`on conflict do nothing`) and a
  `user_changes` row with action `added` and no actor. If a concurrent first sign-in already created the
  row, it re-applies the rules to that row instead.
- Updates the user's `name` (Google's name, else the part of the email before `@`) and
  `last_sign_in_at`.
- Deletes that user's expired or revoked sessions.
- Creates a session (see [Sessions and access control](./sessions-and-access-control.md)).

## Security notes

- PKCE plus a `state` checked against an httpOnly cookie scoped to `/auth/google` protects the callback.
- `next` is checked with `isSafeNext()` at start and again when read back from the cookie, so the
  final redirect is always an in-app path and never under `/auth`.
- Messages come from codes in `src/server/messages.ts`; no text from the URL is shown.

## Tests

`tests/unit/google.test.ts` drives the token and userinfo calls against the Google fake
(`tests/fakes/google.ts`), `tests/unit/rules.test.ts` covers the rules, and
`tests/integration/sign-in.test.ts` covers `completeSignIn()` on a real database. See
[Testing](../testing/testing.md).
