---
type: testing
title: Testing
description: How the CRM is tested — Vitest unit and integration tests against a real local Postgres, Playwright browser tests against an isolated production build, the schema-checked Google fake, and the factory's scenario scripts.
tags: [testing, vitest, playwright, fakes, postgres]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-5e753d9d77984cb67aae1517
    resource: repo://playwright.config.ts
  - id: openwiki-source-6cb9a44eed6dfb64e213a540
    resource: repo://scripts/fetch-schemas.mjs
  - id: openwiki-source-2fa6732e30119a1eac077a99
    resource: repo://scripts/start-isolated.mjs
  - id: openwiki-source-7c4d0649a59b5ba22ce4e408
    resource: repo://tests/fakes/google.ts
  - id: openwiki-source-450b6a23d7e25100eadc359f
    resource: repo://tests/integration/global-setup.ts
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Testing

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run test:e2e && npm run typecheck
```

Both test commands refuse to run unless `APP_ENV=test` and `DATABASE_URL` are set; the test database is
emptied and reloaded, so never point it at data you care about. Each test names what it covers
(`// covers FR-003, US1 scenario 2`).

## Layers

| Layer | Where | Runs with | Notes |
|---|---|---|---|
| Unit | `tests/unit/` | Vitest | Pure code: `rules.test.ts` (sign-in rules, `isSafeNext`), `env.test.ts`, `preview.test.ts`, `format.test.ts`, `google.test.ts` (OAuth calls against the Google fake), `google-fake.test.ts` (the fake against its schema), `fetch-schemas.test.ts`. |
| Integration | `tests/integration/` | Vitest, real Postgres | `migrate`, `rls`, `seed`, `session`, `sign-in`, `users` tests. Global setup migrates the test DB; files run one after another (`fileParallelism: false`) because they share it. |
| Browser | `tests/e2e/` | Playwright, Chromium | `sign-in`, `users`, `layout`, `fake-data` specs. One worker; global setup migrates and reseeds. |

`vitest.config.ts` maps `@` to `src/` and includes both unit and integration folders.

## Browser test app

`playwright.config.ts` builds the app and starts it with `node scripts/start-isolated.mjs 3000`. That
script makes a temporary folder linking to `.next`, `node_modules` and the config but holding **no**
`.env*` file, and runs `next start` there, so the app sees only the test settings: `APP_ENV=test`,
the test `DATABASE_URL`, `FIRST_ADMIN_EMAIL=boss@barnacle.ai`, `APP_URL=http://localhost:3000` and an
empty `VERCEL_ENV`. Tests sign in through the [fake Google login](../auth/fake-google-login.md)
(`tests/e2e/helpers.ts`).

## Fakes

Only outside services are faked. Postgres is never faked.

- **Google Sign-In** — `tests/fakes/google.ts` is an in-process `fetch` for the token endpoint and
  userinfo v2. Userinfo's method, path, parameters and response properties are checked against
  Google's discovery document `.factory/schemas/oauth2-api.json`; the token endpoint follows RFC 6749
  and PKCE (RFC 7636), returning `invalid_grant`, `invalid_client` or `invalid_request` like Google.
- **Schema download** — `npm run test:schemas` (`scripts/fetch-schemas.mjs`, run as `pretest`) fetches
  that file once from a pinned commit of `googleapis/google-api-go-client` on GitHub and checks its
  SHA-256. It is git-ignored; the fake throws, never skips, when it is missing.

The running app never uses `tests/fakes/google.ts`; it uses `/dev/fake-google` instead.

## Factory scenario scripts

`.factory/test-env.md` and `.factory/run/` hold the AI review's recipe: scripts to install and start
Postgres 17, start the app on several ports with different settings (empty DB, no first admin,
preview, production, odd `APP_ENV` values), reset the database, and Playwright scenario scripts. They
are tooling for reviewers, not part of `npm test`.

How the factory itself works is on [Development process](../workflows/development-process.md).
