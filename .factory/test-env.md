# Test environment

## Services
- Google Sign-In (OAuth 2.0 token endpoint + userinfo v2): fake (tests/fakes/google.ts), an in-process `fetch`
  for `POST https://oauth2.googleapis.com/token` and `GET https://www.googleapis.com/oauth2/v2/userinfo`,
  checked against the schema `oauth2-api.json` (userinfo method, path, query parameters, `Userinfo`
  properties and types). The token endpoint follows RFC 6749 §4.1.3/§5.2 and PKCE RFC 7636 (not in the
  schema): copies `invalid_grant` for an unknown or reused code and a wrong `code_verifier`,
  `invalid_client` for a wrong secret, `invalid_request` for a missing parameter. In the running app the
  in-app fake Google login `/dev/fake-google` (APP_ENV=test or development) is used instead.
- Supabase Postgres (through the Supavisor pooler): no fake — a real local PostgreSQL 17. No public schema
  on GitHub; follows Supabase's docs (https://supabase.com/docs/guides/database/connecting-to-postgres):
  transaction-mode pooler copied by always connecting with `prepare: false` and taking only
  transaction-level advisory locks in migrations; connection limit copied by `max: 5`.

## Schemas
- oauth2-api.json: https://github.com/googleapis/google-api-go-client/blob/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json

## Docker images
- none (PostgreSQL comes from Debian's apt repository, see below)

## How to run the app
- PostgreSQL: `sudo apt-get install -y postgresql` (its post-install script may fail in the VM; the
  binaries in `/usr/lib/postgresql/17/bin` still work), then as the normal user:
  `initdb -D /tmp/pgdata -U postgres --auth=trust && pg_ctl -D /tmp/pgdata -o "-k /tmp -c listen_addresses=localhost" -l /tmp/pg.log start`
  and `psql -h localhost -U postgres -c "create database crm_test" -c "create database crm_dev"`.
- Schema: `.factory/schemas/oauth2-api.json` (download command in the test-recipe skill, commit above).
- Browsers: Playwright's Chromium 1254 is in `~/.cache/ms-playwright` (matches `@playwright/test` 1.65.0).
- Tests: `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`, then
  `npm test` and `npm run test:e2e` (builds, starts on port 3000 with `FIRST_ADMIN_EMAIL=boss@barnacle.ai`,
  migrates and seeds; the gating tests start extra servers on ports 3101–3104).
- Manual run: `npm run db:migrate && npm run db:seed && npm run build && npm start` with
  `APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev FIRST_ADMIN_EMAIL=ada@barnacle.ai`,
  then open http://localhost:3000 and use `[ FAKE GOOGLE LOGIN ]`.

## Smoke checks
1. test -s .factory/schemas/oauth2-api.json
2. pg_isready -h localhost -p 5432
3. curl -fs -o /dev/null http://localhost:3000/sign-in
