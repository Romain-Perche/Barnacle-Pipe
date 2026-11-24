---
type: operations
title: Configuration and environments
description: The environment variables the CRM reads, how APP_ENV and VERCEL_ENV switch the fake login, fake data and sign-in on or off, and how local, test, preview and production runs differ.
tags: [configuration, environment, secrets, vercel, deployment]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T14:34:59.724Z
sources:
  - id: openwiki-source-5f5b95b3d6a215fa02ceb945
    resource: repo://.env.example
  - id: openwiki-source-47fb1d4b84dc3009a932e2d6
    resource: repo://src/server/env.ts
generated: { by: "claude-code", at: "2026-11-24T14:34:59.724Z" }
---

# Configuration and environments

All settings are environment variables, read at call time (never at import) by `src/server/env.ts`
and `src/server/db.ts`. `.env.example` lists every one with no secret values. Locally they go in
`.env.local` (git-ignored; Next.js and the `db:*` commands read it, and a variable set in the shell
wins). In production they are Vercel environment settings. Nothing secret is committed.

## Variables

| Name | Read by | Purpose |
|---|---|---|
| `APP_ENV` | `isFakeAllowed()` | `development`, `test` or `production`. Only exactly `development` or `test` enables the fake Google login and `db:seed`. |
| `VERCEL_ENV` | `isFakeAllowed()`, `isPreview()`, `vercel-build` | Set by Vercel. `preview` turns sign-in and the database off; `production` makes the build migrate. `production` or `preview` always refuses the fake login and fake data. |
| `DATABASE_URL` | `src/server/db.ts` | Postgres URL; Supabase's pooler URL in production. Secret. Not set on previews. |
| `FIRST_ADMIN_EMAIL` | `firstAdminEmail()` | barnacle.ai address whose first sign-in creates the first admin. Normalised; empty means none. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `googleConfig()` | Internal OAuth client of the barnacle.ai Workspace. The secret is sent only to Google's token endpoint. |
| `APP_URL` | `googleConfig()`, `appBaseUrl()` | Public base URL (trailing slash removed). Builds the redirect URI `${APP_URL}/auth/google/callback` and anchors `isSafeNext()`; defaults to `http://localhost:3000` for that check. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FILES_BUCKET` | `storageConfig()` in `src/server/env.ts` | Where file contents are kept (SF-116). With a URL and a key: Supabase Storage (`<url>/storage/v1`), bucket `FILES_BUCKET` (default `crm-files`). With an empty URL and fakes allowed: the fake storage under `/dev/fake-storage`. Otherwise "off": file actions answer that files can't be reached and the rest of the app works. The key is a server-only secret. See [Files on records](../features/files.md). |
| `PIPEDRIVE_URL`, `PIPEDRIVE_TOKEN_KEY` | `pipedriveConfig()` in `src/server/env.ts` | Pipedrive import (SF-117). `PIPEDRIVE_URL` empty: the in-process fake where fakes are allowed, else `https://api.pipedrive.com`. `PIPEDRIVE_TOKEN_KEY` is a server-only secret, 32 random bytes in base64, that seals saved tokens; there is no built-in key, and without a valid one the Settings page says Pipedrive isn't set up yet. Changing it makes saved tokens unreadable. See [Pipedrive import](../features/pipedrive-import.md). |

`googleConfig()` throws a message naming every missing Google setting; the start route turns that into
"Sign-in was cancelled or failed". There is no session secret (session tokens are random and only their
hash is stored).

## Environments

| Environment | Settings | Behaviour |
|---|---|---|
| Local development | `APP_ENV=development`, local `crm_dev` | Fake Google login and `db:seed` on; real Google optional. |
| Tests | `APP_ENV=test`, local `crm_test` | Same switches as development; browser tests start the app without any `.env*` file (see [Testing](../testing/testing.md)). |
| Vercel preview | `VERCEL_ENV=preview` | Only builds: no database, `requireUser()` and the Google routes send everyone to `/sign-in`, which says sign-in is off. |
| Vercel production | `VERCEL_ENV=production`, `APP_ENV=production` | `vercel-build` migrates then builds; fake login and fake data refused whatever `APP_ENV` says. |

`APP_ENV` is compared exactly: unset, empty or `Development` all count as "not development".

## Production checklist

1. Create an Internal OAuth client in the barnacle.ai Workspace with the redirect URI
   `${APP_URL}/auth/google/callback`; set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`.
2. Set `DATABASE_URL` to Supabase's pooler URL and `FIRST_ADMIN_EMAIL`.
3. Deploy; the build runs [migrations](./migrations-and-seeding.md). The first admin signs in once and
   adds the team on the [Users page](../features/user-management.md).
