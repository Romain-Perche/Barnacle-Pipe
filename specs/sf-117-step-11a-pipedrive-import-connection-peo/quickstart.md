# Quickstart: validating the Pipedrive import (SF-117 part a)

The real Pipedrive is never used: the factory has no token. Everything here runs against the fake
(contracts/pipedrive-api.md).

## Prerequisites

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
export PIPEDRIVE_TOKEN_KEY=$(openssl rand -base64 32)   # tests may also set their own in setup
npm install            # adds the devDependency yaml@2.9.1
npm run test:schemas   # downloads pipedrive_v2_openapi.json and pipedrive_v1_openapi.yml (pinned, sha256)
npm run db:migrate     # applies 0012_pipedrive.sql
```

## Automated checks

```bash
npm test && npm run typecheck
```

Each test names what it covers (`// covers FR-0xx, US<n> scenario <m>`). The tests to have:

| Area | Proves |
|---|---|
| unit `pipedrive-crypto` | seal/open round trip; another user id, another key or a changed byte fails; the stored bytes do not contain the token (SC-007) |
| unit `pipedrive-rules` | name split, email/phone kinds and order, the built-in field keys, consent, `visible_to`, size band, every custom type in FR-016 (match, mismatch, unsupported, GBP only, Yes/No), option matching, values left out but never cut |
| unit `pipedrive-page` | the plan of a page: already imported, linked by email/name, many people, same email on two Pipedrive people, archived organisation, owner fallback, private creator |
| unit `pipedrive-fake` | the fake answers only what the two schemas allow (a wrong parameter or property throws) |
| unit `fetch-schemas` | downloads the two Pipedrive files as well |
| integration `pipedrive-connection` | US1 1–6 and edge cases: accepted, refused, unreachable, > 200 characters, spaces, removal, two users, no key; no part of the token in the rendered settings HTML (SC-007); deactivation deletes it |
| integration `pipedrive-import` | US2 1–16 with the 30/10 data set of the spec's Independent Test (SC-008) |
| integration `pipedrive-private` | owner-only people visible to their owner only, not to the importer or a third user; report counts without naming (SC-006) |
| integration `pipedrive-consent` | no Subscribed without Pipedrive or the user; an existing Subscribed person becomes Unsubscribed with its timeline entry, never the reverse (SC-004, SC-005) |
| integration `pipedrive-resume` | 3,000 people + 800 organisations, a 429 every 7 calls, a network failure in the middle, the page "closed" (no parts) and continued, a stop; each Pipedrive record → exactly one CRM record, and the counts match (SC-002, SC-003) |
| integration `pipedrive-concurrency` | two users of the same company running parts interleaved and at once (`Promise.all`); two tabs running the same part → one CRM record per Pipedrive record |
| integration `pipedrive-access` | every action refuses a signed-out or deactivated user and acts only on the user's own import (FR-027) |
| integration `migrate`, `rls` | the three new tables, RLS on with no policy, the new timeline kinds |

## By hand (development)

```bash
export APP_ENV=development PIPEDRIVE_TOKEN_KEY=$(openssl rand -base64 32)   # in .env.local
npm run db:seed && npm run dev
```

1. Sign in with the fake Google login. Open **Settings** at the bottom of the sidebar.
2. Paste `wrong` → "Pipedrive did not accept this token. …". Paste `fake-pipedrive-token` → "Connected to Pipedrive as
   Fake Person (Fakeco Pipedrive)." View the page source: the token is not in it.
3. `[ IMPORT FROM PIPEDRIVE ]` → tick People and Organisations, choose a consent, `[ IMPORT ]`. The progress moves
   (organisations first, then people) and the report shows at the end.
4. Start again and close the tab half-way. Open Settings: "Import paused: …". `[ CONTINUE ]` carries on.
5. Run a second import: everything is counted as "already imported".
6. Open an imported person: their values, "// MORE DETAILS", and "Imported from Pipedrive by <you>" on the timeline.
