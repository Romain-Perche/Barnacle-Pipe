# Implementation Plan: CSV import of people and organisations

**Branch**: `factory/sf-103-step-10-csv-import` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-103-step-10-csv-import/spec.md`

## Summary

Import people (and organisations) from a CSV file in four screens (design B: 1 FILE, 2 COLUMNS, 3 PREVIEW, 4 REPORT)
started by `[ IMPORT CSV ]` on the People and Organisations lists. The browser sends the file in 512 KiB parts into a
short-lived `csv_imports` row (Vercel refuses request bodies above 4.5 MB); the server decodes it (strict UTF-8, BOM
dropped), reads it with a small in-repo CSV parser (commas, semicolons or tabs, quoted values), suggests a field per
column, and builds a plan with the forms' own validators (`validatePerson`, `validateOrganisation`) and one lookup
query per kind (existing emails through `visiblePerson()`, organisations, lists, active users). The preview shows the
plan and asks for the consent of rows without one; `[ IMPORT ]` runs the plan again inside one transaction with the
tables locked against concurrent adds, bulk-inserts the records with an `imported` timeline event, stores the report
and drops the file. One migration (`0006_csv_imports.sql`), domain code in `src/server/imports/` (pure modules
unit-tested, database module integration-tested), server pages, one client component. No new dependency.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions, route handlers), React 19.3, `postgres` 4.1 — all
already in the repo. CSV parsing in-repo (research.md §1); `TextDecoder` with `fatal: true` for UTF-8.

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). New migration
`migrations/0006_csv_imports.sql`: table `csv_imports`, timeline kind `imported` (data-model.md).

**Testing**: Vitest unit (`csv.ts`: delimiters, quotes, BOM, line ends, invalid UTF-8, xlsx header; `columns.ts`:
suggestions, mapping checks, example file; `rows.ts`: full name, splitting, consent, size, lengths; `plan.ts`:
duplicates in CRM and in file, organisations, lists, owners, privacy flags; messages), Vitest integration against real
Postgres (upload parts and limits, purge, preview, import counts and values, timeline events, idempotency, rollback
on failure, lock against a concurrent add, private duplicates, 5,000-row performance, RLS, migrate, reset),
Playwright (US1–US3 through the fake Google login, `setInputFiles` with fixtures in `tests/fixtures/csv/`).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-002 — 5,000 rows previewed and imported, each < 60 s with 2,000 people in the CRM: parse
in memory (< 1 s), 5–6 lookup queries, bulk inserts in chunks of 1,000 (~30 statements) (research.md §8).

**Constraints**: request bodies ≤ 512 KiB per part (Vercel 4.5 MB, server actions 1 MB); file ≤ 5 MB, ≤ 5,000 rows;
all-or-nothing import, at most once per upload (FR-016); the file deleted after the import or within 24 h (FR-017);
no private person the importer cannot see is named (SC-007); unsubscribed never imported as subscribed (SC-004);
every message from `messages.ts`, file values only as text or inside quotes (FR-018, FR-021).

**Scale/Scope**: ≤ 10 users, a few thousand contacts; 4 new screens × 2 kinds (shared components), 2 changed lists.

No NEEDS CLARIFICATION left: research.md resolves each open point; the person-facing choices are in spec.md
§ Clarifications, marked "decided by the factory, to confirm".

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail. The binding
rules are `docs/DECISIONS.md` and `AGENTS.md`; the plan is checked against them:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Steps 2–4 are server pages with plain forms; only `FileStep.tsx` is a client component (reading the file and sending it in parts needs the browser) | ✅ |
| Every page `requireUser()`; every action `requireUser()` first | All import pages, the example route handlers and the five actions; the domain re-checks `user_id` on every import id | ✅ |
| Messages only from `messages.ts`; never text from the URL | New codes in contracts/routes.md § Messages; `?error=` allow-listed; file values only as React text or quoted inside templates | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0006_csv_imports.sql`: DDL only, RLS on `csv_imports`, added to `rls.test.ts` | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | No seeder change; example file and test fixtures use `@fakeco.example` and "Example" names | ✅ |
| A private person: creator and owner only (SF-92) | Duplicates found across all people but named only through `visiblePerson()` at display time (research.md §9); imported people are not private (FR-015) | ✅ |
| Only admins add, rename and remove lead sources and labels (SF-90) | The import only matches non-removed entries; never adds or brings back (FR-012) | ✅ |
| A person added by hand is Subscribed (SF-90) | Imported people get the file's consent or the user's explicit choice, no default (spec Clarifications) | ✅ |
| A record matching one already in the CRM is never copied; left as it is, reported (kickoff, Pipedrive) | Same for CSV rows: email for people, name for organisations | ✅ |
| Any user can import (kickoff) | `requireUser()`, not admin | ✅ |
| Users deactivated, never deleted | Owners matched to active users only; `csv_imports.user_id` references users | ✅ |
| Every outside service has a fake | No new outside service | ✅ |
| People and organisation lists use design C (SF-90) | Lists unchanged except `[ IMPORT CSV ]` in the page head | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-103-step-10-csv-import/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, states, validation
├── quickstart.md        # Phase 1: how to validate end-to-end
├── contracts/
│   └── routes.md        # Pages, route handlers, server actions, domain functions, messages
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0006_csv_imports.sql                    # data-model.md § Migration

src/
├── server/
│   ├── imports/
│   │   ├── csv.ts                          # pure: limits, decodeUtf8, detectDelimiter, parseCsv, readFile
│   │   ├── columns.ts                      # pure: import fields, aliases, suggest, checkMapping, exampleCsv
│   │   ├── rows.ts                         # pure: row → PersonForm / OrganisationForm, consent, size, lengths
│   │   ├── plan.ts                         # pure: planPeople, planOrganisations, report types
│   │   └── imports.ts                      # database: purge, start, upload parts, finish, columns, preview, run, report names
│   ├── records/timeline.ts                 # + kind "imported"
│   └── messages.ts                         # + import codes and templates (contracts/routes.md § Messages)
├── app/(app)/
│   ├── records/
│   │   ├── import/
│   │   │   ├── actions.ts                  # startImport, uploadPart, finishUpload, saveColumns, runImport
│   │   │   ├── FileStep.tsx                # "use client": file field, size check, parts upload, errors
│   │   │   ├── StepBar.tsx                 # 1 FILE · 2 COLUMNS · 3 PREVIEW · 4 REPORT
│   │   │   ├── ImportHeader.tsx            # ← People / ← Organisations, title, file name and row count
│   │   │   ├── ColumnsStep.tsx, PreviewStep.tsx, ReportStep.tsx
│   │   │   └── example.ts                  # shared GET handler body for the example files
│   │   └── Timeline.tsx                    # + "Imported from CSV by <name>"
│   ├── people/
│   │   ├── page.tsx                        # + [ IMPORT CSV ]
│   │   └── import/{page.tsx, example/route.ts, [id]/columns/page.tsx, [id]/preview/page.tsx, [id]/report/page.tsx}
│   └── organisations/
│       ├── page.tsx                        # + [ IMPORT CSV ]
│       └── import/… (same five files, kind "organisations")
└── app/globals.css                         # + .steps, import tables, count tiles

tests/
├── fixtures/csv/                           # fake files (data-model.md § Fake data)
├── unit/                                   # import-csv, import-columns, import-rows, import-plan, messages
├── integration/                            # imports-upload, imports-people, imports-organisations, imports-concurrency,
│                                           #   imports-performance, + rls, migrate, reset
└── e2e/                                    # import-people.spec.ts, import-organisations.spec.ts
```

**Structure Decision**: same single Next.js project. Imports get their own domain folder `src/server/imports/`
(pure parts apart from the database part, as `records/rules.ts` and `deals/rules.ts`); the row checks call the
existing `validatePerson` / `validateOrganisation` so the rules stay in one place. The import UI is shared in
`records/import/` and mounted under `/people/import` and `/organisations/import`, so the back links and lists stay
where users expect them.

## Build steps (in order)

1. **Migration** `migrations/0006_csv_imports.sql` exactly as data-model.md (check `timeline_events_kind_check` is the
   current name first). `csv_imports` in `tests/integration/rls.test.ts`, `tests/support/reset.ts` and
   `.factory/run/reset-db.sh`.
2. **Pure modules** (`csv.ts`, `columns.ts`, `rows.ts`, `plan.ts`) as research.md §1, §4–§7, §12, with unit tests
   from the spec's examples. `rows.ts` builds `PersonForm` / `OrganisationForm` and calls `validatePerson` /
   `validateOrganisation`; lengths are checked before (`tooLong`), because the forms cut silently.
3. **Messages**: the fixed codes and templates of contracts/routes.md; `messages.test.ts` covers the new templates
   (singular/plural, quoting).
4. **Timeline**: `EventKind` + `"imported"`; `Timeline.tsx` line "Imported from CSV by <name>".
5. **Database module** `imports.ts`: purge (research.md §3), parts upload (§2), finish (decode, parse, limits,
   suggest), `saveColumns`, `previewImport` (lookups §6, plan, names through `visiblePerson()` §9), `runImport` (§8:
   `for update` on the import, `lock table organisations, person_emails in share row exclusive mode`, plan again,
   ids from `nextval(pg_get_serial_sequence(...))` + `overriding system value`, chunks of 1,000, events, report,
   `content = null`).
6. **Actions and pages**: `records/import/*`, the five pages × 2 kinds, the example route handlers (no `.csv` in the
   path, research.md §10), `[ IMPORT CSV ]` on both lists. `[ BACK ]` as links (contracts/routes.md).
7. **CSS** (`globals.css`, `docs/DESIGN.md` tokens): `.steps` as `design-options.html` B (equal flex cells, `--line`
   borders, mono uppercase, current `--blue` background with white text, done steps ink with " ✓"); tables reuse the
   Users-table styles; long values wrap (`overflow-wrap: anywhere`).
8. **Tests**: integration and e2e per Testing above; fixtures fake only.
9. **Docs**: `docs/DECISIONS.md` gets one line per spec clarification people made — "The CSV import uses design B: one
   screen per step (file, columns, preview, report) with a step bar and [ BACK ] (SF-103)", "A CSV row whose email
   address a person in the CRM already has is not imported; the existing person is left as it is and the report lists
   the row (SF-103)", "People imported from CSV with no consent in the file get the consent the importing user chooses,
   with nothing chosen in advance (SF-103)" — plus the factory choices in spec.md § Clarifications once the Plan Review
   confirms them. README: the import, its limits and the example file. AGENTS.md § Layout: `src/server/imports/`,
   `src/app/(app)/records/import/`, `tests/fixtures/csv/`.

No blueprint index exists for this run (`$WS/blueprints/INDEX.md` is missing), so no blueprint applies, there is no
blueprint exception and no `Departs from blueprint` line for `docs/DECISIONS.md`.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor at commit e59909dc629230a4c07af3df16957ef22a184774, which only has an OpenAPI test for its own management API, and github.com/supabase/supabase, during SF-90, SF-93 and SF-95; the app speaks the standard Postgres protocol, the new code only adds a table and a timeline kind to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: the CSV file comes from the user's browser and is read in the app; nothing is sent to a
third party.

## Complexity Tracking

No constitution violations to justify.
