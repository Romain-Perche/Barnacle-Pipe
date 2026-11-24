# Implementation Plan: Pipedrive import — deals, notes, activities and files

**Branch**: `factory/sf-122-step-11b-12-pipedrive-import-deals-notes` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-122-step-11b-12-pipedrive-import-deals-notes/spec.md`

## Summary

The SF-117 import engine (`src/server/pipedrive/imports.ts`) gains four kinds, run after people and organisations in
the order Deals, Notes, Activities, Files:
- **Pipelines and stages**: matched by name and created when missing (by any user) in one locked step, before any deal.
- **Deals**: 20 per part, through v2 `/deals` and `/deals/archived`, with a follower or participant call only when
  Pipedrive's counts say there is something to read.
- **Notes**: 200 per part through v1 `/notes`.
- **Activities**: 200 per part through v2 `/activities`.

Each of these pages is saved whole in one transaction that also moves the cursor, as in SF-117.

- **Files**: copied one at a time. Pipedrive download (redirect followed without the token) → path queued in
  `file_cleanup` → upload to Storage → one transaction lists the file and takes the path off the queue. Nothing is ever
  half-stored.
- **Never twice**: `pipedrive_links` gains the kinds deal, note, activity and file. A skipped record gets no link, so a
  later import can bring it in.
- **No notifications**: notes get no mention rows, and an activity's `assigned_by` is its assignee.
- **Notes as text**: note HTML becomes plain text through a small pure function.
- **Schema and dependencies**: one migration (`0013_pipedrive_deals.sql`), one more pinned Pipedrive schema (a full
  v1 file, for participants and downloads), no new dependency.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js ≥ 22.12 (unchanged)

**Primary Dependencies**: Next.js 16.4, React 19.3, `postgres` 4.1, all already present. Pipedrive and Supabase
Storage through `fetch`. No addition (dependencies.json `[]`; research.md §11).

**Storage**: PostgreSQL, migration `0013_pipedrive_deals.sql` (data-model.md). File contents go to Supabase Storage (the
SF-116 fake in development and tests).

**Testing**: Vitest unit and integration tests on the local Postgres. The fake Pipedrive is checked against the v2
pin, the v1 pin and the new full v1 pin. The fake Storage is checked against the Storage pin. No browser tests
(DECISIONS 2026-11-23).

**Target Platform**: Vercel serverless (Node runtime), `maxDuration = 60` on the import page (unchanged).

**Project Type**: Web application (single Next.js project).

**Performance Goals**: SC-001 (about 24,000 records in under 60 minutes). Expected about 30–35 minutes (research.md §3).

**Constraints**:
- No network call inside `sql.begin()`, Storage included.
- Every part well under 60 s: 15 s file budget, 20 s download and upload time-outs, 10 s JSON calls.
- 429 obeyed.
- The token never leaves for another host (manual redirect).
- Messages only from `messages.ts`; Pipedrive values as quoted text only.
- CRM names only through `visiblePerson()` / `visibleDeal()`.

**Scale/Scope**:
- ≤ 10 users, a few tens of thousands of Pipedrive records.
- No new page.
- One new client component (`KindChoice.tsx`).
- About 11 new Pipedrive calls, one migration and about 30 new messages.

No NEEDS CLARIFICATION left. The factory's own choices are in spec.md § Clarifications, marked "to confirm".

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so no gate can fail. The binding rules are
`docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default | Only `KindChoice.tsx` (ticking People and Organisations with the others) is a client part, and the server enforces the same rule | ✅ |
| `requireUser()` first in every action | Unchanged actions. `startPipedriveImportAction` only passes four more booleans | ✅ |
| Messages from `messages.ts`, no URL text, safe redirects | New codes and templates (contracts/routes.md). `?error=` takes fixed codes only | ✅ |
| Migrations transaction-safe, RLS after every `create table` | 0013 has `alter` / `create index` only, and no new table | ✅ |
| Only admins create pipelines and stages (SF-93) | Exception decided in the spec (Clarifications) and recorded in `docs/DECISIONS.md` (step 13). Nothing is ever renamed, reordered or deleted. Admin functions are unchanged | ✅ (documented exception) |
| Private deal / person visible to creator and owner only (SF-93, SF-92) | Owner-only deal → private with the owner as creator. Notes, activities and files are read only through `visibleDeal` / `visiblePerson` / `visibleActivity` / `visibleFile`. The report counts, never names | ✅ |
| Deal labels kept by admins (SF-95) | Matched only, never added | ✅ |
| Notes: anyone who sees one can edit or delete it (SF-102); mentions notify in app | Imported notes are plain `note` events, editable. No mention rows, so no notification (spec) | ✅ |
| Activities: assignment notifies (SF-109); Last contacted rule | `assigned_by = assignee`, so no notification (FR-013). Last contacted by the SF-109 formula, never lowered | ✅ |
| Files (SF-116): no Storage call in a transaction, 25 MB, "Files can't be reached…" | research.md §8: queue first, upload, then list in one commit; start check; pause reason | ✅ |
| One "imported" entry per record, no per-value entries (SF-115) | One `pipedrive_imported` per deal. Custom values bulk inserted | ✅ |
| Timeline kind check lists concurrent kinds (SF-115) | No kind added, so the check is unchanged | ✅ |
| No cron, no long server (SF-80) | Parts are moved on by the open page, as in SF-117 | ✅ |
| Outside services through settings with a fake, never a real Pipedrive token | Same `PIPEDRIVE_URL` / Storage settings. Fakes extended and schema-checked | ✅ |
| Fake data clearly fake | "… Fake" names, `@fake.example`, `*.invalid` hosts | ✅ |

**Post-design re-check**: still passes. The one rule departure (non-admin pipeline creation by import) is the spec's
own decision, documented, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-122-step-11b-12-pipedrive-import-deals-notes/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, report shape
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   ├── pipedrive-api.md # the new calls, the fake, the third schema
│   └── routes.md        # page changes, actions, domain functions, messages
├── dependencies.json    # []
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/0013_pipedrive_deals.sql                  # data-model.md § Migration
scripts/fetch-schemas.mjs                            # + pipedrive_v1_full_openapi.yml
src/server/
├── messages.ts                                      # contracts/routes.md § Messages
├── imports/bulk.ts                                  # newIds / insertCustomValues for deals, events, activities
├── files/storage.ts, files/files.ts                 # putSigned timeout option; insertFile addedAt
└── pipedrive/
    ├── api.ts                                       # the new calls (contracts/pipedrive-api.md)
    ├── fake-pipedrive.ts                            # deals, pipelines, stages, notes, activities, files, download
    ├── html.ts                                      # htmlToText (pure)
    ├── deal-rules.ts                                # deal / note / activity / file rules (pure)
    ├── records-page.ts                              # page plans for the new kinds (pure)
    ├── rules.ts                                     # planFields for "deal"
    ├── imports.ts                                   # steps, fetchers, savers, file copy, start check, view
    └── report.ts                                    # new counts, parts, lines, deal names via visibleDeal()
src/app/(app)/settings/pipedrive-import/
├── ChooseStep.tsx, KindChoice.tsx (client, new)     # six checkboxes, the emails note
├── ProgressStep.tsx, Counts.tsx, KindCounts.tsx     # six kinds
├── ReportStep.tsx                                   # pipelines block, new lines, Deals / Activities links
└── actions.ts                                       # four more booleans; files_unreachable
src/app/globals.css                                  # only if the six-line progress needs spacing (design B)
tests/fakes/pipedrive.ts, tests/fakes/pipedrive-schema.ts
tests/unit/…, tests/integration/…                    # quickstart.md
README.md, AGENTS.md, docs/DECISIONS.md
```

**Structure Decision**: the same single Next.js project and the same `src/server/pipedrive/` folder. The new pure
rules go in their own files (`html.ts`, `deal-rules.ts`, `records-page.ts`), so `rules.ts` and `page.ts` (people and
organisations) stay as they are.

## Build steps (in order)

1. **Schema pin**: in `scripts/fetch-schemas.mjs` add
   `{ file: "pipedrive_v1_full_openapi.yml", url: "https://raw.githubusercontent.com/konfig-sdks/openapi-examples/161ab49c45e45825ca3832945c59a3ba904321ba/pipedrive/openapi.yaml", sha256: "24230787d0c71b1e528a2824e8aa6d3137db26aa57973e65f3819b1fce825665" }`
   and update the head comment. Run `npm run test:schemas`. Then extend `tests/unit/fetch-schemas.test.ts`
   (contracts/pipedrive-api.md § Schemas).
2. **Migration** `migrations/0013_pipedrive_deals.sql` exactly as data-model.md. First confirm the 0012 constraint
   names. Extend `migrate.test.ts`.
3. **Shared helpers**:
   - `bulk.ts`: `newIds` accepts `deals | timeline_events | activities`; `insertCustomValues` accepts kind `deals`
     (target `deal_id`).
   - `storage.ts`: `putSigned(url, bytes, type, { timeoutMs = 10_000 })`.
   - `files.ts`: `insertFile(db, actor, target, { …, addedAt? })`, which sets `files.added_at` and the event's
     `created_at`.
4. **Calls and fake**:
   - `api.ts` functions and types (contracts/pipedrive-api.md). `downloadFile` uses `redirect: "manual"`, one redirect
     without the token, a byte cap and a 20 s time-out.
   - `fake-pipedrive.ts` additions, including `redirectDownloads`, and the development data set.
   - `tests/fakes/pipedrive.ts`: the v1 file choice (Zenika first, else full), non-JSON answers, and the redirect host
     check.
5. **Pure rules, unit tests first**: `html.ts`, `deal-rules.ts` (research.md §5–§8), `records-page.ts`, and
   `planFields("deal", …)` in `rules.ts`. They reuse `parseMoney`, `parseDate`, `validateLostReason` and `MAX_PENCE`
   (deals/rules.ts), `SUBJECT_MAX`, `ACTIVITY_NOTE_MAX` and `ukInstant` (activities/rules.ts), `validateFile`,
   `MAX_FILE_BYTES`, `fileKind` and `uploadContentType` (files/rules.ts), and `ownerOf` / `parseAddTime` from SF-117.
   `ownerOf` is exported from `page.ts`.
6. **Engine** (`imports.ts`):
   - **Start**: `startImport` takes the four flags. Any of them sets people and organisations. Files checks Storage
     first (research.md §8 start check) and returns `files_unreachable`.
   - **Steps**: the `Step` union, `ORDER` and `nextStep` per data-model.md.
   - **`prepare`**: also reads `dealFields`, `pipelines` and `stages` (Deals) and `activityTypes` (Activities) into the
     snapshot.
   - **Counting**: one `count_*` step per new kind, 500 per call (`count_files` / `count_notes` through `start`).
   - **`pipelines`**: no fetch. One transaction with `lock table pipelines, stages in share row exclusive mode`, then
     `planPipelines` and inserts. Writes `stageMap` into the snapshot and the report parts.
   - **`deals` / `archived_deals`**: fetch a page of 20, then for each deal the followers and participants calls when
     the counts ask for them, one after the other (outside the transaction). Then `save`: lock the row and check the
     step and cursor, lock `organisations, person_emails, pipedrive_links` as now, load the person, organisation and
     deal links, users, deal labels and CRM deal fields, then `planDealPage`. Bulk insert, in order: deals, periods,
     label links, deal_people, followers, custom values, `pipedrive_imported` events, links.
   - **`notes`**: page of 200 → `planNotePage` → bulk insert the `note` events (with `created_at`) and the links.
   - **`activities`**: page of 200 → `planActivityPage` → bulk insert the activities and the links, then the bulk
     Last contacted update.
   - **`files`**: per research.md §8, with the cursor `"<start>:<index>"`, a 15 s / 25 MB budget per part, and
     `StorageUnreachable` → `pause(…, "files_unreachable")`. `sweepFileCleanup()` runs after each file part.
   - **Visibility counts**: the private-of-others counts are computed in each save (research.md §9).
   - **View**: `getImportView` gives progress for the six kinds in order, and counts and totals over six kinds.
7. **Report** (`report.ts`):
   - `Counts` / `Report` widen per data-model.md, and `readCounts` / `readReport` stay compatible.
   - `mergeReport` handles the new parts.
   - `namesForReport` loads deal titles through `visibleDeal()` and people through `visiblePerson()` (hidden ones →
     `pipedrive_private_deal` / `pipedrive_private_person`).
   - `itemText` covers the new codes, `reportLines` gets the new lines in a fixed order, and a new `pipelineLines`.
8. **Messages**: every code of contracts/routes.md § Messages, and the six kinds in `PIPEDRIVE_KIND_WORDS`.
9. **UI** (design B, unchanged layout):
   - `ChooseStep.tsx` renders six checkboxes through `KindChoice.tsx` (client: ticking any of Deals, Notes, Activities
     or Files ticks and locks People and Organisations; a hidden `on` input posts them), plus the emails note.
   - `actions.ts` reads the four new booleans.
   - `ProgressStep`, `Counts` and `KindCounts` show the six kinds.
   - `ReportStep` adds "// PIPELINES" and the new lines, and links to `/deals` and `/activities`.
   - The paused state handles `files_unreachable`.
10. **Timeline**: check that a deal's `pipedrive_imported` event reads "Imported from Pipedrive by <name>" on the deal
    page, the drawer and the person's and organisation's timelines (the same `Timeline.tsx` / `RecordTimeline.tsx`
    line SF-117 added). Add the deal target if it is missing. Imported notes, done activities and files need no change.
11. **Tests**: quickstart.md § Automated checks, each naming what it covers.
12. **Docs**:
    - README "Pipedrive import" section: what is imported now, pipelines created by any import, files copied, emails
      not imported, the fake data set.
    - `AGENTS.md` § Layout, the `pipedrive/` line: the new files, the kinds and steps, the file copy rule (queue the
      path in `file_cleanup` before the upload; list it in the same commit that takes it off the queue), and the
      token never sent on a download redirect. The `tests/fakes/pipedrive.ts` line names the third schema.
13. **`docs/DECISIONS.md`**: add these lines at the end (the spec's decisions), plus any of the factory's
    Clarifications the Plan Review confirms:
    - `- Any user's Pipedrive import creates the pipelines and stages the CRM lacks (matched by name, never renaming, reordering or deleting one); the only exception to admins-only pipelines (SF-122)`
    - `- In the Pipedrive import, ticking Deals, Notes, Activities or Files ticks People and Organisations, which stay ticked (SF-122)`
    - `- Pipedrive activities of a type the CRM does not have come in as tasks, counted per Pipedrive type in the report (SF-122)`

    No blueprint index in this run, so no blueprint exception and no "Departs from blueprint" line.
    `.factory/test-env.md` is left to Build and the AI review.

## Fix round 1

The AI review failed on three points. All three are reproduced and traced in the code.

### Problem 1: files still listed after the token is removed or the user is deactivated (Edge case 15)

- **Problem**: with a file copy in progress, removing the token or deactivating the user does not stop the part.
  The file in progress and the next ones of the part are still listed in "// FILES". After a deactivation the row
  stays `files|running`.
- **Cause**: `runPart` checks the user's status and the token once, before the part. `lockRow` (used by every save
  and by each per-file commit of `runFilesPart`) checks only the import row (step, cursor, state). A file part runs
  up to 15 s, so a removal or deactivation in that window is not seen.
- **Fix**: `lockRow` also checks, in the same transaction, that the user is `active` (`select … from users … for
  share`) and that the user's `pipedrive_connections` row still exists for the import's company (`for share`). The
  `for share` locks make `removeToken` / `deactivate()` wait for a commit already under way, so a file is listed only
  when the copy ended before the removal. When a check fails, `lockRow` returns a reason: no token → the part ends
  as stale (the path in `file_cleanup` due now) and the import is paused `token_refused`; user not active → the part
  ends as stale and the import is paused (the row no longer stays `running`). Every step's `save` gets the same
  check, through `lockRow`.

### Problem 2: a private deal of another owner is named in the importer's report (US1 scenario 8, FR-021, SC-005)

- **Problem**: Linus imports a Margaret-only USD deal. His report's warnings show "Deal · SF122 Margaret secret USD
  Value in USD, not GBP: left out."
- **Cause**: `planDealPage` (`records-page.ts`) builds every deal warning with the Pipedrive title as its label,
  also for a deal that becomes private to another owner. The title is stored in the report and shown by
  `ReportStep`.
- **Fix**: in `planDealPage`, when the planned deal is private and its owner is not the importer, its warnings get no
  Pipedrive title: the stored label is empty and the item carries `args.privateDeal = 1`. `ReportStep` (and
  `itemText` / `warningLines`) show the label "a private deal" (`pipedrive_private_deal`) for such an item. The
  title of such a deal is never written into the report. The count line "N private deals of other owners imported."
  stays. Deals that are not imported are not CRM records, so their "// NOT IMPORTED" line keeps the Pipedrive title.

### Problem 3: the import never moves on when Pipedrive slows down every few calls (US5, SC-001)

- **Problem**: with the fake answering 429 on every 4th call, the deals step stays at "0 of 50" for 10 minutes. With
  a 429 on every 3rd call, the `prepare` step stalls.
- **Cause**: a part is repeated whole after a slow-down. A deals part needs the page call plus one call per deal with
  followers or participants (up to about 40). `prepare` needs 5 or more calls. When a part needs more calls than
  Pipedrive allows between two slow-downs, it never ends.
- **Fix**: a part keeps the answers it already got. `fetchStep` reads every Pipedrive call through a memo keyed by the
  call (for example `deals:<cursor>`, `followers:<dealId>`, `participants:<dealId>`, `fields:person:<cursor>`).
  When `PipedriveSlowDown` is thrown, `runPart` writes the memo to the import row (new column
  `pipedrive_imports.fetched jsonb`, with the step and cursor it belongs to) in the same update that sets `waiting`.
  The next part of the same step and cursor starts from that memo and calls only what is missing. `writeRow` clears
  `fetched` when the step or cursor moves. A stale memo (other step or cursor) is ignored. The memo holds Pipedrive
  data only for the time of one part, like the page it belongs to; it never holds the token. This applies to every
  step that `fetchStep` reads (prepare, counts, pipelines, deals, archived deals, notes, activities, organisations,
  people). The files step already commits each file, so only its page call goes through the memo.
- **Migration**: `migrations/0014_pipedrive_fetched.sql`: `alter table pipedrive_imports add column fetched jsonb;`
  (0013 is kept as it is, so a development database that has it stays valid).

### Files to change

- `src/server/pipedrive/imports.ts` (`lockRow`, `save`, `runFilesPart`, `runPart`, `fetchStep`, `writeRow`, `Row`).
- `src/server/pipedrive/records-page.ts` (`planDealPage` warnings of private deals of other owners).
- `src/server/pipedrive/report.ts` and `src/app/(app)/settings/pipedrive-import/ReportStep.tsx` (label of a private deal).
- `migrations/0014_pipedrive_fetched.sql`, `tests/integration/migrate.test.ts`, `tests/support/reset.ts` if needed.
- Tests: `tests/unit/pipedrive-records-page.test.ts` (or the deal-page unit test file in use),
  `tests/integration/pipedrive-resume-records.test.ts`, `tests/integration/pipedrive-files.test.ts` (or the file
  test in use).
- Docs: `AGENTS.md` (the `pipedrive/` line: a part keeps its answers across a slow-down in `fetched`; every save
  re-checks the user and the token), `data-model.md` (the new column).

## Outside services

- Pipedrive API v2 (deals, deals/archived, deals/{id}/followers, dealFields, pipelines, stages, activities): schema https://github.com/soenneker/soenneker.pipedrive.openapiclient/blob/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json
- Pipedrive API v1 (notes, files, activityTypes; users as before): schema https://github.com/Zenika/zenpipe/blob/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml
- Pipedrive API v1 (deals/{id}/participants, files/{id}/download): schema https://github.com/konfig-sdks/openapi-examples/blob/161ab49c45e45825ca3832945c59a3ba904321ba/pipedrive/openapi.yaml
- Supabase Storage (sign upload, upload, info, delete for the copied files): schema https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93, SF-102, SF-116 and SF-117: only an OpenAPI file for Supavisor's own management API; this change only alters the app's own tables, and tests use a real local Postgres rather than a fake)

Pipedrive's own GitHub organisation still publishes no OpenAPI file. The v1 copy in `konfig-sdks/openapi-examples` is
a superset of the Zenika copy. It is pinned as a third file because Zenika's lacks the two paths above (research.md
§2). A Pipedrive download may redirect to Pipedrive's file host. That address is a plain signed link with no schema;
the app follows it once, without the token.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
