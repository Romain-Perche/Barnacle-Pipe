---
type: feature
title: Fake Google login
description: The development and test-only account chooser at /dev/fake-google that stands in for Google and signs people in through the same completeSignIn() rules as real Google.
tags: [auth, fake, development, testing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-5cc25e7a6a7857b45cadeced
    resource: repo://src/app/dev/fake-google/actions.ts
  - id: openwiki-source-053609139883aed9b16c6341
    resource: repo://src/app/dev/fake-google/page.tsx
  - id: openwiki-source-47fb1d4b84dc3009a932e2d6
    resource: repo://src/server/env.ts
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Fake Google login

`/dev/fake-google` lets developers and the browser tests sign in without a Google account. It lives in
`src/app/dev/fake-google/` (a server-rendered page plus two server actions).

## When it is available

Both the page and its actions call `isFakeAllowed()` (`src/server/env.ts`) and answer *not found*
otherwise. `isFakeAllowed()` is true only when `APP_ENV` is exactly `development` or `test` **and**
`VERCEL_ENV` is neither `production` nor `preview`. An unset or differently cased `APP_ENV`
(`Development`) turns it off. The sign-in page shows the `[ FAKE GOOGLE LOGIN ]` link only when the
same check passes (`src/server/sign-in-page.ts`). The same switch gates `npm run db:seed`; see
[Configuration and environments](../operations/configuration-and-environments.md).

The proxy treats `/dev/fake-google` as a public path, so it is reachable without a session cookie.

## What it shows

- One button per row of the `users` table (active users first, then by name), each posting that user's
  email and name.
- A free-form email and name form, so tests can try any address (non-barnacle domains, unknown users…).
- A `[ CANCEL ]` button that sends the browser to `/sign-in?error=cancelled`, like a cancelled Google
  consent.

The `next` return path from the query string is passed through `isSafeNext()` before it is placed in
the forms, and again in the action.

## Same rules as Google

`fakeSignIn` builds an identity `{ email, name, emailVerified: true, hd: null }` and calls
`completeSignIn()` from `src/server/auth/sign-in.ts` — the exact function the real Google callback
uses. Domain checks, the first-admin rule, deactivated users and "not allowed yet" refusals therefore
behave the same; a refusal redirects to `/sign-in?error=<code>`. On success it sets the session cookie
with `setSessionCookie()` and redirects to the safe `next` path. See
[Google sign-in flow](./google-sign-in.md).

## Tests

The e2e suite signs in through this page (`tests/e2e/helpers.ts`), and the gating is covered by
`tests/unit/env.test.ts` and the e2e environment scenarios. See [Testing](../testing/testing.md).
