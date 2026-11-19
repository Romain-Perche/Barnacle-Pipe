---
type: concept
title: Sessions and access control
description: How signed-in state works — random session tokens stored as SHA-256 in Postgres, the crm_session cookie, the proxy cookie gate, requireUser/requireAdmin/assertAdminForAction, /auth/end, sign-out and safe return paths.
tags: [auth, sessions, cookies, authorization, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-2fb1a00055b4cfa5ee51a546
    resource: repo://src/app/(app)/actions.ts
  - id: openwiki-source-c0760b4a2d4e87e67c0e673a
    resource: repo://src/app/auth/end/route.ts
  - id: openwiki-source-f34ac1e549d94dc3ac475ae4
    resource: repo://src/proxy.ts
  - id: openwiki-source-a695492dfede49d0883f5a36
    resource: repo://src/server/auth/cookie.ts
  - id: openwiki-source-8452a1b4f6f0b132b119bc96
    resource: repo://src/server/auth/rules.ts
  - id: openwiki-source-263124bfd29ff09eabb33461
    resource: repo://src/server/auth/session.ts
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Sessions and access control

Sessions live in the `sessions` table (`src/server/auth/session.ts`). There is no session secret: the
browser holds a random token, the database stores only its SHA-256.

## Session lifecycle

| Step | Where | What happens |
|---|---|---|
| Create | `createSession()` (called by `completeSignIn()`) | 32 random bytes (base64url) become the token; the row stores `sha256(token)`, the user and `expires_at = now() + 30 days`. |
| Cookie | callback route / `setSessionCookie()` | `crm_session`: httpOnly, `SameSite=Lax`, path `/`, `Secure` on HTTPS (from the URL or `x-forwarded-proto`), max-age 30 days (`src/server/auth/cookie.ts`). |
| Keep alive | `src/proxy.ts` | On every GET of a protected page, the proxy sets the cookie again with a fresh max-age. |
| Check | `lookupSession()` | Joins `sessions` and `users` by token hash. Missing or expired → `expired`; revoked or user not active → `removed`. If `last_seen_at` is over an hour old, it moves `last_seen_at` and pushes `expires_at` to 30 days from now (sliding expiry). |
| Revoke | `revokeAllSessions()` | Sets `revoked_at` on every live session of a user; used when an admin deactivates someone. |
| End | `endSession()` | Deletes the row; used by sign-out and `/auth/end`. Expired/revoked rows of a user are also deleted at their next sign-in. |

## Guards

- **Proxy** (`src/proxy.ts`): public paths are `/sign-in`, `/auth/*` and `/dev/fake-google`. On any
  other path without the cookie it redirects to `/sign-in?next=<path+query>` (no `next` for a bare `/`).
  It does not touch the database (it cannot import database code), and it copies the path into the
  `x-pathname` request header. Static assets are excluded by its `matcher`.
- **`requireUser()`**: every signed-in page and server action calls it first. On a preview deployment it
  redirects to `/sign-in`. With no cookie, or an expired session, it redirects to
  `/auth/end?next=<current path>`; a revoked session or deactivated user goes to
  `/auth/end?reason=removed`. Role and status are read fresh each request (one lookup per request,
  memoised with React `cache`).
- **`requireAdmin()`**: for pages; returns `{ user, isAdmin }` so the page can show the
  [Forbidden](../features/signed-in-layout-and-pages.md) message inside the shell to non-admins.
- **`assertAdminForAction()`**: for admin server actions; a non-admin is redirected to `/admin/users`,
  which then shows the forbidden message. Domain code re-checks admin rights inside its own
  transaction (see [User management](../features/user-management.md)).

Hidden links are never the only protection: the sidebar hides the admin group from non-admins, but the
page and actions check again.

## `/auth/end` and sign-out

`GET /auth/end` (`src/app/auth/end/route.ts`) cleans up an ended session: if the cookie's session is
still valid it simply redirects to `next` (no sign-out by link); otherwise it deletes the row, deletes
the cookie and redirects to `/sign-in` with `error=removed` or the `next` path.

`[ Sign out ]` in the sidebar posts the `signOut` server action (`src/app/(app)/actions.ts`): it deletes
this browser's session only, deletes the cookie and redirects to `/sign-in`. Other browsers stay signed in.

The sign-in page itself redirects a visitor whose session is still valid straight to their `next` path.

## Safe return paths

`isSafeNext(next, appBaseUrl())` in `src/server/auth/rules.ts` is applied to every redirect target
taken from a URL, form or cookie. It returns `/` unless the value starts with a single `/`, contains no
control characters or backslashes, parses against `APP_URL` to the same origin, and does not resolve to
`//…` or to an `/auth` path. It returns the **parsed** path, query and hash, so the redirect is exactly
what was checked.

## Tests

`tests/integration/session.test.ts` (sessions on a real database), `tests/unit/rules.test.ts`
(`isSafeNext`), and `tests/e2e/sign-in.spec.ts` (cookie gate, sign-out, removed users). See
[Testing](../testing/testing.md). Sign-in itself is on [Google sign-in flow](./google-sign-in.md).
