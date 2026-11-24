# Implementation Plan: Pipedrive import — connection, people and organisations

**Branch**: `factory/sf-117-step-11a-pipedrive-import-connection-peo` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-117-step-11a-pipedrive-import-connection-peo/spec.md`

## Summary

Users connect Pipedrive from a new Settings page, then import people and organisations in resumable parts. The
token is checked with `GET /v1/users/me` before it is saved. It is stored with AES-256-GCM under a key from the
settings (`PIPEDRIVE_TOKEN_KEY`), and it is never sent to the browser.

The import lives on its own page (design B: 1 CHOOSE · 2 IMPORTING · 3 REPORT). A client component calls one server
action per part while the page is open. A part makes at most two Pipedrive calls, always outside any transaction
(v2 cursor pages of 100, `sort_by=id`). It then saves the page in one transaction that also moves the cursor, so a
record is saved whole or not at all, and a resumed or repeated part never saves twice. A new `pipedrive_links` table
(primary key company + kind + Pipedrive id) gives "never twice", including two users importing at once. The same
table locks as the CSV import serialise the parts.

Matching (a person by email, an organisation by name), the field mapping, owners, privacy, consent and custom fields
are pure rules that reuse the form and CSV-import helpers. When Pipedrive says 429, the import waits for
`Retry-After`. When no page has been seen for 30 seconds, the import shows as paused.

Pipedrive is reached with plain `fetch` through a new `PIPEDRIVE_URL` setting. A fake runs in process in development
and tests, and is checked against Pipedrive's pinned v2 and v1 OpenAPI files. There is one migration
(`0012_pipedrive.sql`) and one new devDependency (`yaml`, to read the v1 YAML schema in tests).

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js ≥ 22.12 (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions), React 19.3, `postgres` 4.1, `node:crypto`
(AES-256-GCM), all already present. Pipedrive is reached with `fetch` (research.md §1). The only addition is
devDependency `yaml@2.9.1` (research.md §9, dependencies.json).

**Storage**: PostgreSQL, migration `0012_pipedrive.sql` (data-model.md): `pipedrive_connections`,
`pipedrive_imports`, `pipedrive_links`, and two timeline kinds.

**Testing**: Vitest unit and integration tests on the real local Postgres. `tests/fakes/pipedrive.ts` wraps the
app's `FakePipedrive` and checks it against the two pinned schemas. No browser tests (DECISIONS 2026-11-23).

**Target Platform**: Vercel serverless functions (Node runtime), with `maxDuration = 60` on the import page; desktop
browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-002 is 3,000 people and 800 organisations in under 30 minutes. That takes about 50 parts of
at most 2 calls and ≤ 100 records each, about 1–3 seconds each, with 1 second between parts. The progress screen
refreshes after every part (well within 10 seconds).

**Constraints**:
- One request must stay inside Vercel's time limit: 10-second Pipedrive timeouts and ≤ 100 records per part.
- There is no network call inside `sql.begin()`.
- Pipedrive's rate limits: ≤ 2 calls per part, ≥ 1 second between parts, and 429 obeyed (research.md §5).
- The token never reaches a page, a log or a URL (FR-003, SC-007).
- Every message comes from `messages.ts`, and Pipedrive values appear only as quoted text (FR-028).
- Pooler limits: no session state; every change is one `sql.begin()`.

**Scale/Scope**: ≤ 10 users and a few thousand Pipedrive records. Two new pages (`/settings`,
`/settings/pipedrive-import`), one sidebar link, six server actions, one migration, and two new timeline lines.

No NEEDS CLARIFICATION left. The factory's choices that a person should confirm are in spec.md § Clarifications.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so no gate can fail. The binding rules are
`docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Both pages are server-rendered. The only client part is `ImportRunner.tsx` (the part loop and countdown). The consent radios show through CSS `:has()` | ✅ |
| Every page `requireUser()`; every action `requireUser()` first | Both pages and all six actions call it. Domain functions take `userId` and touch only that user's connection and import (FR-027) | ✅ |
| Messages from `messages.ts`; no text from the URL; safe redirects | `?error=` / `?saved=` are codes looked up in a fixed list. Redirects go to fixed paths only | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0012` has three `create table`, each followed by `enable row level security`; otherwise `create index` / `alter` only | ✅ |
| Every outside service through settings, with a fake; never a real Pipedrive token (kickoff) | `PIPEDRIVE_URL` and `PIPEDRIVE_TOKEN_KEY`. `FakePipedrive` is used in development and tests, checked against the pinned schemas | ✅ |
| Token stored encrypted, never shown again (kickoff) | AES-256-GCM, user-bound AAD, key outside the database and repo. Pages get only the name, company and date | ✅ |
| Any user can import; each record keeps its Pipedrive ID; never a copy; a match is linked, never copied; an existing record is left as it is; unmatched custom fields are reported (kickoff) | `pipedrive_links` primary key; matching per research.md §6; report per data-model.md | ✅ |
| A person's unsubscribed status always comes with them (kickoff) | FR-014 / FR-018 rule, including existing people. Never the other way | ✅ |
| Private person visible only to creator and owner, admins included (SF-92) | Owner-only → `private`, `created_by = owner`. The report names people only through `visiblePerson()` | ✅ |
| Lists kept by admins (SF-90); no consent guessed (SF-103) | Lists are matched only, never added to. The user chooses the consent with nothing chosen in advance | ✅ |
| No per-value timeline entries on import (SF-115) | Custom values are bulk inserted, with only `pipedrive_imported` | ✅ |
| Migration kind check lists kinds of features planned at the same time (SF-115) | The list keeps every current kind and adds the two new ones. No other feature is in flight | ✅ |
| No long-running server, no cron (SF-80) | Parts are moved on by the open page. Paused otherwise | ✅ |
| Users never deleted; deactivation | `deactivate()` deletes the token. Parts need an active user | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | The fake Pipedrive is used only when `isFakeAllowed()` and `PIPEDRIVE_URL` is empty. Names are "… Fake", `@fake.example` | ✅ |
| No secrets in the repo; settings in `.env.example` and README | Both settings are added empty. The key is marked secret, with how to generate it | ✅ |

**Post-design re-check**: still passes. No violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-117-step-11a-pipedrive-import-connection-peo/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, states, report
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   ├── pipedrive-api.md # the six Pipedrive calls, settings, the fake, the schemas
│   └── routes.md        # pages, actions, domain functions, messages
├── dependencies.json    # yaml@2.9.1 (devDependency)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/0012_pipedrive.sql                       # data-model.md § Migration
scripts/fetch-schemas.mjs                           # + pipedrive_v2_openapi.json, pipedrive_v1_openapi.yml
package.json, package-lock.json                     # devDependency yaml 2.9.1
src/server/
├── env.ts                                          # pipedriveConfig()
├── messages.ts                                     # contracts/routes.md § Messages
├── users.ts                                        # deactivate() deletes the Pipedrive connection
├── pipedrive/
│   ├── crypto.ts                                   # sealToken / openToken (AES-256-GCM)
│   ├── api.ts                                      # the six calls (fetch), errors, usePipedriveFetchForTests
│   ├── fake-pipedrive.ts                           # FakePipedrive, fakePipedrive()
│   ├── connection.ts                               # get / save / remove token
│   ├── rules.ts                                    # pure: field mapping, custom types, consent, privacy, retry
│   ├── page.ts                                     # pure: plan of one page (match, link, add, skip, warn)
│   ├── imports.ts                                  # start, runPart, continue, stop, view
│   └── report.ts                                   # report lines, names through visiblePerson()
├── records/timeline.ts, records/timeline-view.ts   # pipedrive_imported, pipedrive_unsubscribed
└── records/ambassadors.ts                          # latest updates: treat the new kinds like 'imported'
src/app/(app)/
├── nav.ts, layout.tsx                              # footerNav "Settings" above [ SIGN OUT ]
├── settings/page.tsx, settings/actions.ts, settings/PipedriveSection.tsx, settings/RemoveTokenConfirm.tsx
├── settings/pipedrive-import/page.tsx, actions.ts, ChooseStep.tsx, ProgressStep.tsx, ReportStep.tsx,
│   ImportRunner.tsx (client), StopConfirm.tsx
├── records/import/StepBar.tsx                      # `steps` prop (default: the CSV steps)
├── records/Timeline.tsx, records/RecordTimeline.tsx  # the two new lines
└── globals.css                                     # progress bars, counts (design B in design-options.html)
tests/fakes/pipedrive.ts, tests/support/reset.ts, tests/unit/…, tests/integration/…   # quickstart.md
.env.example, README.md, AGENTS.md
```

**Structure Decision**: the same single Next.js project. Pipedrive code gets its own `src/server/pipedrive/` folder
because it has its own outside service, as `files/` does. Settings is a new top-level signed-in page, and the import is
its child route.

## Build steps (in order)

1. **Schemas and dependency**: `npm install --save-dev --save-exact yaml@2.9.1`. In `scripts/fetch-schemas.mjs`, add
   the two entries of contracts/pipedrive-api.md § Schemas (file, url, sha256) and update the head comment. Extend
   `tests/unit/fetch-schemas.test.ts`: v2 has `paths["/persons"]`, and v1 (parsed with `yaml`) has
   `paths["/users/me"]`.
2. **Migration** `migrations/0012_pipedrive.sql` exactly as in data-model.md. Add the three tables to
   `tests/support/reset.ts` (and `.factory/run/reset-db.sh` if it lists tables). Extend `migrate.test.ts` and
   `rls.test.ts`.
3. **Settings and crypto**: `pipedriveConfig()` in `env.ts` (contracts/pipedrive-api.md § Settings) and
   `src/server/pipedrive/crypto.ts` (research.md §3: version byte 1, 12-byte IV, 16-byte tag, AAD
   `pipedrive-token:<userId>`).
4. **Calls and fake**: `api.ts` (header `x-api-token`, `AbortSignal.timeout(10_000)`, the error classes,
   `retrySeconds` from `Retry-After` / `x-ratelimit-reset` / 10, kept within 1–300), `fake-pipedrive.ts`, and
   `tests/fakes/pipedrive.ts` with the schema checks.
5. **Connection** (US1): `connection.ts`, the messages, `deactivate()` deleting the row, the `/settings` page,
   `PipedriveSection`, the remove confirmation, `saveTokenAction` / `removeTokenAction`, and `footerNav` "Settings" in
   `nav.ts` rendered in `layout.tsx` above `[ SIGN OUT ]`.
6. **Pure mapping**: `rules.ts` and `page.ts` (research.md §6–§7), reusing `splitFullName`, `parseSize`,
   `validatePerson`, `validateOrganisation`, the normalisers and the custom-field `readValue`. Unit tests come first.
7. **Import engine**: `imports.ts`. Steps, cursors and states per data-model.md. The fetch happens outside the
   transaction. Then `sql.begin()`: `select … for update` on the import row, check the step and cursor are unchanged,
   `lock table organisations, person_emails, pipedrive_links in share row exclusive mode`, load lookups for the page,
   plan, then bulk insert (reuse or extract the CSV `newIds` / `inChunks` / `insertCustomValues` helpers from
   `imports/imports.ts` into a shared module rather than copying them). Then insert the links and timeline events,
   apply the unsubscribes, and update the cursor, counts and report. `seen_at = now()` on every part. One open import
   per user (partial unique index), and older finished imports are deleted when starting.
8. **Timeline**: `EventKind` gains `pipedrive_imported` and `pipedrive_unsubscribed`. Their lines are "Imported from
   Pipedrive by <name>" and "Unsubscribed by the Pipedrive import of <name>", tagged CHANGE. Ambassador latest updates
   handle them like `imported`.
9. **Import UI** (US2, US3): `/settings/pipedrive-import` with the steps of contracts/routes.md, `StepBar` with a
   `steps` prop, `ImportRunner.tsx` (calls `runPipedrivePartAction`, then `router.refresh()`, then the next part after
   1 second, or after `seconds` with a countdown; it stops on `stop`), the stop confirmation, and `maxDuration = 60`.
   CSS follows design B of `design-options.html`: three count tiles, "// PROGRESS" bars (`<progress>` styled with the
   existing variables), and the state chip.
10. **Report**: `report.ts` lines, with names only through `visiblePerson()` (FR-019) and quoted Pipedrive values as
    text nodes. The latest report stays until the next start.
11. **Tests**: quickstart.md § Automated checks, each naming what it covers.
12. **Settings and docs**: in `.env.example`, add `PIPEDRIVE_TOKEN_KEY=` (secret, with how to generate it) and
    `PIPEDRIVE_URL=` (empty → the fake in development and test). In the README: Settings table rows, a short
    "Pipedrive import" section (the token, parts and pause, what is imported and linked, the fake tokens
    `fake-pipedrive-token` / `fake-pipedrive-other`), `/settings` and `/settings/pipedrive-import` rows in the pages
    table, and the `test:schemas` line naming the Pipedrive schemas. In `AGENTS.md` § Layout, describe
    `src/server/pipedrive/` (where the token is opened: only `connection.ts`; no network call inside `sql.begin()`;
    `pipedrive_links` is the "never twice" key), the UI files, and `tests/fakes/pipedrive.ts`. At the end of
    `docs/DECISIONS.md`, add the three choices people made in the spec (design B; owner-only → only its owner sees it;
    a Subscribed CRM person unsubscribed in Pipedrive becomes Unsubscribed), each `(SF-117)`, plus any of the
    factory's Clarifications that the Plan Review confirms. There is no blueprint exception (no blueprint index in this
    run), so no "Departs from blueprint" line. `.factory/test-env.md` is left to Build and the AI review.

## Outside services

- Pipedrive API v2 (persons, organizations, personFields, organizationFields): schema https://github.com/soenneker/soenneker.pipedrive.openapiclient/blob/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json
- Pipedrive API v1 (users/me, users): schema https://github.com/Zenika/zenpipe/blob/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93, SF-102 and SF-116: only an OpenAPI file for Supavisor's own management API; this change only adds tables to the app's own database, and tests use a real local Postgres rather than a fake)

Pipedrive does not publish its OpenAPI files in its own GitHub organisation (`github.com/pipedrive`: only generated
clients, `client-nodejs` and `client-php`, without the spec). The two files above are unmodified copies of
Pipedrive's published `openapi-v2.yaml` (as JSON, refreshed daily by its owner) and `openapi.yaml` (v1), pinned at a
commit and by sha256.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
