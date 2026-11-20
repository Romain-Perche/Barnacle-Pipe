---

description: "Tasks for SF-103 CSV import of people and organisations"
---

# Tasks: CSV import of people and organisations

**Input**: Design documents from `/specs/sf-103-step-10-csv-import/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-003 to SC-007): Vitest unit tests, Vitest integration tests against a real local Postgres (`crm_test`), Playwright browser tests through the fake Google login. Each test file names what it covers (`// covers FR-009, US1 scenario 6`). Write each story's tests first and see them fail before the code.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. The migration, entities, states and row rules are in `data-model.md`; pages, route handlers, actions and domain functions in `contracts/routes.md`; decisions in `research.md` (§n below). No new dependency (`dependencies.json` is `[]`): do not add a CSV package. No blueprint applies (`blueprints.json` is `[]`), so there are no blueprint tasks and no `Departs from blueprint` line. The choices "decided by the factory, to confirm" in spec.md § Clarifications are built as written there.

**Outside services**: only Supabase Postgres, with no public schema on GitHub: no schema download, no fake; T014 (US1) holds its test task, T046 writes the test recipe.

**Environment for every test command**: `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US3 from spec.md
- Paths are from the repository root (single Next.js project, see plan.md § Project Structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The schema, the test plumbing and the fake test files.

- [ ] T001 First run `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'timeline_events'::regclass` on a database migrated to 0005 to confirm the kind check is named `timeline_events_kind_check`. Then create `migrations/0006_csv_imports.sql` exactly as `data-model.md` § Migration: table `csv_imports` with `id bigint generated always as identity primary key`, `user_id bigint not null references users (id)`, `kind text not null check (kind in ('people', 'organisations'))`, `file_name text not null check (char_length(file_name) between 1 and 255)`, `size_bytes int not null check (size_bytes between 1 and 5242880)`, `parts_received int not null default 0`, `content bytea null check (octet_length(content) <= 5242880)`, `status text not null default 'uploading' check (status in ('uploading', 'ready', 'done'))`, `row_count int null`, `mapping jsonb null`, `report jsonb null`, `created_at timestamptz not null default now()`, `imported_at timestamptz null`, `check ((status = 'done') = (report is not null and imported_at is not null))`, `check (status <> 'done' or content is null)`; `alter table csv_imports enable row level security` right after; indexes `csv_imports_user_idx (user_id)` and `csv_imports_created_at_idx (created_at)`; recreate `timeline_events_kind_check` as `check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved', 'won', 'lost', 'reopened', 'imported', 'note'))`. Only statements allowed in a transaction.
- [ ] T002 [P] Extend `tests/support/reset.ts` (`resetAppTables`): truncate `csv_imports` with the other tables (restart identity cascade)
- [ ] T003 [P] Extend `.factory/run/reset-db.sh` to truncate `csv_imports` too
- [ ] T004 [P] Add `csv_imports` to the expected list in `tests/integration/rls.test.ts`; extend `tests/integration/migrate.test.ts` to check on a fresh database that a `done` import without a report is refused, a `done` import with `content` is refused, a `content` of 5,242,881 bytes is refused, a `kind = 'deals'` is refused (23514), and a timeline event of kind `imported` is accepted
- [ ] T005 [P] Create fake CSV files in `tests/fixtures/csv/` (fake names only, `@fakeco.example` addresses, "Fakeco Ltd"-style organisations): `people-20.csv` (headings `First name,Last name,Email,Phone,Organisation,Job title,Lead source,Labels`, 20 rows, rows for 2 emails that tests put in the CRM first, 1 invalid email), the same people as `people-semicolon.csv` and `people-tab.csv`, `people-bom.csv` (UTF-8 with BOM, a "Zoë" and a "£"), `people-cp1252.csv` (the same bytes in Windows-1252), `people-quoted.csv` (quoted values with a comma, a semicolon, `""` and a line break), `organisations-10.csv` (`Name,Website,Sector,Size,Location`, one name an existing organisation in another case, `fakeco.example` website, sizes `11-50`, `35`, `1,200`, `medium`), `lists-owners-consent.csv` (US3 independent test), `empty.csv`, `headings-only.csv`, `not-csv.xlsx` (any small real `.xlsx`, starts with `PK\x03\x04`); the 5,000/5,001-row and 5 MB+ files are generated by the tests, not committed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Reading files, columns, row rules, messages and the timeline kind that every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T006 [P] Write unit tests `tests/unit/import-csv.test.ts` (covers FR-003, edge cases): `decodeUtf8` drops a leading BOM and returns `null` for Windows-1252 bytes of "Zoë"; `readFile` refuses a `PK\x03\x04` start or a NUL byte with `import_not_csv`, an unclosed quote at the end with `import_not_csv`, an empty file and a headings-only file with `import_no_rows`, 5,001 data rows with `import_too_many_rows`, accepts 5,000; `detectDelimiter` picks `,` `;` `\t` from the first line outside quotes (ties in that order, none → `,`); `parseCsv` keeps quoted commas, semicolons, `""` → `"` and line breaks inside quotes, accepts `\r\n`, `\n`, `\r`, adds no row for a final line end; the three files of the same people give the same headings and rows; rows carry their spreadsheet number (heading = 1, empty rows keep their number but are not returned) (research.md §1, §12)
- [ ] T007 [P] Write unit tests `tests/unit/import-columns.test.ts` (covers FR-004, FR-005): `headingKey` ("E-mail", "e mail" → `email`); `suggest` for `First name, Last name, Email, Phone, Organisation, Job title, Lead source, Labels` gives the matching fields with "Job title" → role; "Organization", "Company", "Mobile" (phone, personal) match; "Date added", "Last contacted", "Notes" → `skip`; a second "Lead source" column → `skip`; organisation headings `Name, Website, Sector, Size, Location`; `checkMapping` refuses two `lead_source` columns with `import_one_column`, accepts several `email`, `phone`, `labels`, refuses a people mapping with no first/last/full name (`import_person_name_column`) and an organisations mapping with no name (`import_organisation_name_column`); `columnLabel` gives "Column 3" for an empty heading; `exampleCsv("people")` starts with a BOM, has every people heading of research.md §10 and exactly two data rows with `@fakeco.example` addresses, and parses back with `readFile`
- [ ] T008 [P] Write unit tests `tests/unit/import-rows.test.ts` (covers FR-008, FR-014, edge cases): values trimmed (`  COO  ` → `COO`); more values than headings → `import_too_many_values`; fewer → empty; `splitFullName("Ada May Example")` → `Ada` / `May Example`, one word → first name; email and phone cells split on `,` and `;`, appended after earlier columns, the first is main; invalid email → `email_invalid`, same email twice → `email_twice`, invalid phone/LinkedIn/website → the form codes; `tooLong`: first or last name 101 characters, role 201, organisation name 201, sector 101, location 101 → `import_too_long` with that field and max; `parseConsent` maps `unsubscribed, no, false, opted out, opt out, optedout, n, 0` → unsubscribed, `subscribed, yes, true, opted in, opt in, optedin, y, 1` → subscribed, empty → none, `maybe` → `import_consent_unknown`; `parseSize`: `11–50`, `11-50`, `1000+`, `1,000+`, `35` → `11–50`, `1,200` → `1,000+`, `1000` → `201–1,000`, `0`, `medium` → not recognised; `=SUM(A1:A2)` and `@admin` kept as typed
- [ ] T009 Implement `src/server/imports/csv.ts` (pure): `MAX_BYTES = 5 * 1024 * 1024`, `MAX_ROWS = 5000`, `PART_BYTES = 512 * 1024`, `decodeUtf8` (`new TextDecoder("utf-8", { fatal: true })`), `detectDelimiter`, `parseCsv`, `readFile(bytes) → { ok: true, headings, rows: { number, values }[] } | { ok: false, code }` (research.md §1, §12); make T006 pass
- [ ] T010 [P] Implement `src/server/imports/columns.ts` (pure): `PERSON_IMPORT_FIELDS`, `ORGANISATION_IMPORT_FIELDS` (`{ key, label, multiple, aliases }`, the keys and aliases of research.md §4, field labels as the select shows them, e.g. "Role or job title"), `headingKey`, `suggest`, `checkMapping`, `columnLabel`, `exampleCsv(kind)`; type `ColumnMapping` as `data-model.md`; make T007 pass
- [ ] T011 [P] Implement `src/server/imports/rows.ts` (pure): `personFormFromRow`, `organisationFormFromRow` (build `PersonForm` / `OrganisationForm` and call the existing `validatePerson` / `validateOrganisation` from `src/server/records/rules.ts`), `splitFullName`, `splitMulti`, `parseConsent`, `parseSize`, `tooLong` (checked before the form validators, which cut silently) (research.md §5); make T008 pass
- [ ] T012 Add the fixed codes and templates of `contracts/routes.md` § Messages to `src/server/messages.ts` (`import_note`, `import_not_csv`, `import_not_utf8`, `import_no_rows`, `import_too_large`, `import_too_many_rows`, `import_upload_failed`, `import_person_name_column`, `import_organisation_name_column`, `import_consent_required`, `import_failed`, `import_too_many_values`, `import_skip`; templates `import_one_column`, `import_too_long`, `import_consent_unknown`, `import_duplicate_in_file`, `import_duplicate_in_file_org`, `import_lead_source_unknown`, `import_label_unknown`, `import_owner_unknown`, `import_size_unknown`, `import_organisation_archived`, `import_summary_people`, `import_summary_organisations`, `import_without_email`, `import_needs_consent`, `import_rows`, `imported_event`); extend `tests/unit/messages.test.ts`: singular/plural ("1 person imported.", "1 row not imported."), "(row 7)" vs "(rows 4, 9)", values only inside single quotes, `messageFor("import_one_column")` is undefined (templates not reachable from a code)
- [ ] T013 Add `"imported"` to `EventKind` in `src/server/records/timeline.ts`; in `src/app/(app)/records/Timeline.tsx` show `templates.imported_event(actor)` ("Imported from CSV by <name>") for it

**Checkpoint**: files are read, columns suggested and rows checked by pure, tested code.

---

## Phase 3: User Story 1 - Import people from a spreadsheet (Priority: P1) 🎯 MVP

**Goal**: From People, `[ IMPORT CSV ]` → file → columns → preview (with the consent choice) → `[ IMPORT ]` → report; people added with every value, organisations linked or added, duplicates and invalid rows reported.

**Independent Test**: Import `tests/fixtures/csv/people-20.csv` with 2 of its emails already in the CRM: 17 people added with every value, organisations linked or added, the report lists the 3 rows not imported with their reasons.

### Tests for User Story 1

- [ ] T014 [US1] Supabase Postgres has no public schema on GitHub, so there is no fake to check against a schema: the tests use a real local PostgreSQL 17, and the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler). It copies its limits: no prepared statements (`prepare: false`, unchanged in `src/server/db.ts`), no session state (no `set`, `listen` or session advisory lock in `src/server/imports/*.ts`; the import's `lock table … in share row exclusive mode` is transaction-level and allowed), every multi-statement change in one `sql.begin()` transaction, at most 5 connections (`max: 5`), each statement under the 65,535 bind-parameter limit (bulk inserts in chunks of 1,000 rows). Extend the existing check in `tests/integration/migrate.test.ts` so it also scans `src/server/imports/*.ts` for `set `/`listen`/`pg_advisory_lock` and fails on any, and applies `0006_csv_imports.sql` on a fresh database
- [ ] T015 [P] [US1] Write unit tests `tests/unit/import-plan.test.ts` for `planPeople` (covers FR-006, FR-009, FR-011, FR-012, FR-015, US1 scenarios 5–7): with lookups built in the test, an email of an existing person (any case, spaces, archived, private) → skipped `import_duplicate_email` with `personId` (no name in the plan); an email on an earlier imported row → `import_duplicate_in_file` with that row; a refused row does not "use" its email; "fakeco ltd" links the existing "Fakeco Ltd"; an archived one links with an `import_organisation_archived` warning; a new name used on three rows (cases and spaces differ) → one entry in `newOrganisations`, as first written; an organisation name of 201 characters → row skipped with `import_too_long`; lead source and label values matched ignoring case and surrounding spaces to non-removed entries only, unmatched → one warning per value with all its rows; `withoutEmail` and `needsConsent` counted; full name used only when no first or last name column is set; every add has `private: false`
- [ ] T016 [P] [US1] Write integration tests `tests/integration/imports-upload.test.ts` (covers FR-003, FR-017, FR-020): `startImport` refuses `size > 5,242,880` (`import_too_large`) and `0` (`import_no_rows`); `uploadPart` appends parts of 512 KiB in order, refuses a part out of order, a part over the declared size, another user's import, a `ready` import (and deletes the row); `finishUpload` on the cp1252, `.xlsx`, empty, headings-only and 5,001-row files gives the fixed codes and deletes the row; on `people-20.csv` sets `ready`, `row_count = 20` and the suggested mapping; `purgeImports` deletes the same user's other unfinished imports and any import older than 24 hours (`done` included) and keeps other users' recent ones; another user's import id is not found for `getImport`, `saveColumns`, `previewImport`, `runImport`
- [ ] T017 [P] [US1] Write integration tests `tests/integration/imports-people.test.ts` (covers FR-006 to FR-011, FR-015, FR-016, FR-018, FR-019, SC-003, SC-005, SC-006, SC-007, US1 scenarios 4–7): import `people-20.csv` with 2 emails already in the CRM → 17 people with every value (emails with kinds and order, phones, organisation, role, lead source, labels), 3 skipped with the right codes, `created_at` = import time, `last_contacted_at` null, `private = false`, `created_by` = importer, an `imported` event on each person and each new organisation, a `person_linked` event on the organisation for each linked person; the existing people unchanged (same `version`, emails, fields); a private duplicate of another user → the report page names nobody (`namesForReport` returns `duplicate_email_hidden`), a visible one → name and `/people/<id>`; `runImport` twice → the second returns `done`, counts unchanged; a failing statement forced inside the transaction (e.g. a test hook making the timeline insert fail) → nothing from the file left, import still `ready`; after the import `content` is null and `status = 'done'`; `runImport` with people needing consent and no consent → refused, nothing added; with `"unsubscribed"` → those people unsubscribed, rows with a file value keep it
- [ ] T018 [P] [US1] Write integration test `tests/integration/imports-concurrency.test.ts` (covers US1 edge case "another user adds a person with the same email", FR-016): preview a file, then add a person with one of its emails through `createPerson`, then `runImport` → that row in the report as a duplicate, not added; a `createPerson` started while `runImport` holds its lock waits and then gets `duplicate_email` (no unique-violation crash), and two `runImport` calls on the same import at once add the people once
- [ ] T019 [P] [US1] Write Playwright tests `tests/e2e/import-people.spec.ts` (covers US1 scenarios 1–7, FR-022, FR-023, edge cases): `[ IMPORT CSV ]` on People opens "Import people" on "1 FILE" with the note and `[ DOWNLOAD EXAMPLE FILE ]` (download is `people-example.csv`); `setInputFiles(people-20.csv)` → `[ NEXT ]` → "2 COLUMNS" with headings, first two values, "Job title" set to "Role or job title"; set "Job title" to "Don't import" → `[ PREVIEW ]` → "3 PREVIEW" counts, rows not imported, first 5 people without role → `[ BACK ]` keeps the choices → `[ PREVIEW ]` again; `[ IMPORT ]` refused until a consent is chosen → choose → "4 REPORT" with "17 people imported. … 3 rows not imported."; a person page shows the values and "Imported from CSV by <name>"; double-click `[ IMPORT ]` and reload the report → People count up once; the step bar marks done steps with ✓; the `.xlsx` and cp1252 files show "Save the file as CSV (UTF-8) and try again."; a first name `<a href="https://evil.example">Click</a>` shows as text with no link; signed out, `/people/import` shows the sign-in page

### Implementation for User Story 1

- [ ] T020 [US1] Implement `planPeople(rows, mapping, lookups)` and the types `ImportPlan`, `ImportReport`, `Skip`, `Warning` in `src/server/imports/plan.ts` (pure, research.md §6, `data-model.md` § Import plan); owners for now: the importer (US3 adds the owner column); consent from the file through `parseConsent`, empty → counted in `needsConsent`; make T015 pass
- [ ] T021 [US1] Implement in `src/server/imports/imports.ts`: `purgeImports(db, userId)`, `startImport`, `uploadPart` (append with `content = coalesce(content, ''::bytea) || $part` only when own, `uploading`, `index = parts_received`, total ≤ `size_bytes`), `finishUpload` (decode, `readFile`, `suggest`, `row_count`, status `ready`; a refusal deletes the row), `getImport(viewerId, id)`, `saveColumns` (`checkMapping`, then store) (research.md §2, §3); every query on `csv_imports` has `user_id = ${viewerId}`
- [ ] T022 [US1] Implement `loadLookups` (one query each: existing emails `where e.email = any(...)` with `visiblePerson()` as `visible`, organisations `where lower(name) = any(...)`, non-removed lead sources and labels, active users) and `previewImport(viewerId, id)` in `src/server/imports/imports.ts`; `namesForReport(viewerId, skipped)` loads names only through `visiblePerson()` (research.md §9)
- [ ] T023 [US1] Implement `runImport(viewerId, id, consent)` in `src/server/imports/imports.ts` exactly as research.md §8: one `sql.begin`; `select … for update` on the own import (`done` → `{ status: "done" }`, not `ready` → not found); `lock table organisations, person_emails in share row exclusive mode`; lookups and plan again; consent required when `needsConsent > 0`; ids from `select nextval(pg_get_serial_sequence('persons', 'id')) from generate_series(1, n)` (same for `organisations`) and inserts with `overriding system value`, in chunks of 1,000 rows: new organisations (owner and creator = importer), persons, `person_emails` (`position` in order), `person_phones`, `person_labels`, `timeline_events` (`imported` per person and new organisation, `person_linked` per linked organisation); then `status = 'done'`, `content = null`, `report`, `imported_at = now()`; make T016–T018 pass
- [ ] T024 [US1] Server actions in `src/app/(app)/records/import/actions.ts` (`"use server"`, each `requireUser()` first): `startImport`, `uploadPart`, `finishUpload`, `saveColumns`, `runImport` as `contracts/routes.md` § Server actions (redirects built from numeric ids and the fixed kind paths only; `revalidatePath("/people")` and `revalidatePath("/organisations")` after an import)
- [ ] T025 [P] [US1] Shared server components in `src/app/(app)/records/import/`: `StepBar.tsx` ("1 FILE · 2 COLUMNS · 3 PREVIEW · 4 REPORT", done steps with " ✓", current one `aria-current="step"`), `ImportHeader.tsx` ("← People" / "← Organisations" link, "Import people" / "Import organisations", file name as text and `import_rows(n)`)
- [ ] T026 [P] [US1] Client component `src/app/(app)/records/import/FileStep.tsx` (`"use client"`): file field (`accept=".csv,text/csv"`), size check in the browser (> 5 MB → `import_too_large`, nothing sent), `startImport`, parts of `PART_BYTES` sent in order with `uploadPart`, `finishUpload`, then `router.push(next)`; shows the action's error code through `messageFor`; `[ NEXT ]` disabled while sending; with `?id=` of an own `ready` import shows the chosen file and goes to its columns step
- [ ] T027 [US1] `ColumnsStep.tsx`, `PreviewStep.tsx` (three counts, `import_without_email`, "// ROWS NOT IMPORTED" table Row / From the row / Reason, "// WARNINGS", "// CONSENT" with two unchecked `required` radios and `import_needs_consent` when `needsConsent > 0`, first 5 records, `[ BACK ]` link, `[ IMPORT ]`), `ReportStep.tsx` (summary template, rows not imported with names from `namesForReport`, warnings, "Go to People") in `src/app/(app)/records/import/`; every value from the file as React text, `?error=` read through an allow-list of `import_*` fixed codes
- [ ] T028 [US1] People pages: `src/app/(app)/people/import/page.tsx`, `[id]/columns/page.tsx`, `[id]/preview/page.tsx`, `[id]/report/page.tsx` (each `requireUser()`, `notFound()` for another user's or unknown import, status redirects as `contracts/routes.md` § Pages) and `src/app/(app)/people/import/example/route.ts` (GET, `requireUser()`, `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="people-example.csv"`, body `exampleCsv("people")`; shared body in `src/app/(app)/records/import/example.ts`)
- [ ] T029 [US1] Add `[ IMPORT CSV ]` (outline `.btn`, link to `/people/import`) left of `[ ADD PERSON ]` in `src/app/(app)/people/page.tsx`
- [ ] T030 [US1] CSS in `src/app/globals.css` (tokens of `docs/DESIGN.md`): `.steps` as `design-options.html` B (equal flex cells, `--line` borders, mono uppercase, `.on` `--blue` background with white text, `.done` ink), the columns and report tables on the Users-table styles, count tiles, `overflow-wrap: anywhere` for long values; make T019 pass

**Checkpoint**: People can be imported end to end; MVP.

---

## Phase 4: User Story 2 - Import organisations (Priority: P2)

**Goal**: The same four steps from Organisations, with name, website, sector, size, location and owner.

**Independent Test**: Import `tests/fixtures/csv/organisations-10.csv`: 9 added with website, sector, size and location; the existing one listed as not imported.

### Tests for User Story 2

- [ ] T031 [P] [US2] Extend `tests/unit/import-plan.test.ts` for `planOrganisations` (covers FR-010, FR-014, US2 scenarios 3–4): a name existing in the CRM (any case, surrounding spaces, archived) → skipped `organisation_exists` with `organisationId`; a name on an earlier row → `import_duplicate_in_file_org`; `medium` → size empty and an `import_size_unknown` warning, the organisation still added; no `needsConsent`
- [ ] T032 [P] [US2] Write integration tests `tests/integration/imports-organisations.test.ts` (covers FR-010, FR-014, FR-019, US2 scenarios 2–4): import `organisations-10.csv` → 9 organisations with `https://fakeco.example`, sector, band sizes (`11–50`, `1,000+`), location, owner and creator = importer, an `imported` event each; the existing one unchanged (same `version`); report "9 organisations imported. 1 row not imported." with "Fakeco Ltd already exists."
- [ ] T033 [P] [US2] Write Playwright tests `tests/e2e/import-organisations.spec.ts` (covers US2 scenarios 1–4): `[ IMPORT CSV ]` on Organisations opens "Import organisations" with `organisations-example.csv`; the four steps; no "// CONSENT" on the preview; an organisation page shows the values and "Imported from CSV by <name>"; the warning "Size not recognised: 'medium'"

### Implementation for User Story 2

- [ ] T034 [US2] Implement `planOrganisations` in `src/server/imports/plan.ts` and the organisations branch of `loadLookups` and `runImport` in `src/server/imports/imports.ts` (lock `organisations` only; ids from `pg_get_serial_sequence('organisations', 'id')`); make T031–T032 pass
- [ ] T035 [US2] Organisations pages: `src/app/(app)/organisations/import/page.tsx`, `[id]/columns/page.tsx`, `[id]/preview/page.tsx`, `[id]/report/page.tsx`, `example/route.ts` (filename `organisations-example.csv`), all passing `kind = "organisations"` to the shared components; `[ IMPORT CSV ]` left of `[ ADD ORGANISATION ]` in `src/app/(app)/organisations/page.tsx`; make T033 pass

**Checkpoint**: Organisations can be imported on their own.

---

## Phase 5: User Story 3 - Lists, owners and consent in an import (Priority: P2)

**Goal**: Owners matched to active users, consent words in the file, warnings for lead sources, labels and owners not on the lists; unsubscribed never imported as subscribed.

**Independent Test**: Import `tests/fixtures/csv/lists-owners-consent.csv` ("referral", "Hot", "Cold", an active user's email as owner, "Unsubscribed" on some rows and nothing on others): matched values set, unmatched ones as warnings, consent as the file says or as chosen.

### Tests for User Story 3

- [ ] T036 [P] [US3] Extend `tests/unit/import-plan.test.ts` (covers FR-007, FR-012, FR-013, US3 scenarios 1–4): owner by active user's email or full name (ignoring case) → that user; a deactivated user, no match, or a name shared by two active users → importer and one `import_owner_unknown` warning per value with its rows; no owner column → importer; labels cell "Hot; Cold, hot" → Hot once, "Cold" warning; a removed lead source → warning, never brought back; consent words both ways; an unrecognised consent → row skipped `import_consent_unknown`
- [ ] T037 [P] [US3] Write integration tests `tests/integration/imports-lists.test.ts` (covers FR-007, FR-012, FR-013, SC-004, US3): import `lists-owners-consent.csv` choosing "Subscribed" → rows saying unsubscribed are unsubscribed, empty rows subscribed, no person unsubscribed in the file is subscribed; the lead source "Referral" set from "referral"; `labels` and `lead_sources` tables unchanged (no row added, renamed or un-removed); owners as matched; a lead source `Your account is locked` appears only in the warning "Lead source not on the list: 'Your account is locked' (row 2)"
- [ ] T038 [P] [US3] Extend `tests/e2e/import-people.spec.ts` (covers US3 scenarios 2, 5): the preview shows "4 people have no consent in the file." and both radios unchecked; the warnings "Label not on the list: 'Cold' (row 7)" and the owner warning on the report

### Implementation for User Story 3

- [ ] T039 [US3] Owner column in `planPeople` / `planOrganisations` (`src/server/imports/plan.ts`) and active users' email and name in `loadLookups` (`src/server/imports/imports.ts`), with the warnings of research.md §6; make T036–T038 pass

**Checkpoint**: All three stories work and are tested on their own.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T040 [P] Write integration test `tests/integration/imports-performance.test.ts` (covers SC-002): with 2,000 people in the CRM, a generated 5,000-row people file is previewed in < 60 s and imported in < 60 s
- [ ] T041 [P] Extend `tests/integration/imports-upload.test.ts` with a generated file of 5 MB + 1 byte refused by `startImport`'s size check and by `uploadPart`'s total check (covers FR-003)
- [ ] T042 [P] Update `README.md`: the CSV import, its limits (UTF-8, 5 MB, 5,000 rows, commas/semicolons/tabs) and the example files; how long uploads and reports are kept
- [ ] T043 [P] Update `AGENTS.md` § Layout: `src/server/imports/` (`csv.ts`, `columns.ts`, `rows.ts`, `plan.ts` pure; `imports.ts`), `src/app/(app)/records/import/`, `tests/fixtures/csv/`
- [ ] T044 Add to the end of `docs/DECISIONS.md` one line per clarification people made: "- The CSV import uses design B: one screen per step (file, columns, preview, report) with a step bar and [ BACK ] (SF-103)", "- A CSV row whose email address a person in the CRM already has is not imported; the existing person is left as it is and the report lists the row (SF-103)", "- People imported from CSV with no consent in the file get the consent the importing user chooses, with nothing chosen in advance (SF-103)"; the factory choices of spec.md § Clarifications (Plan 2026-11-20) only once the Plan Review confirms them; check `tests/unit/decisions.test.ts` still passes
- [ ] T045 Run `npm test && npm run test:e2e && npm run typecheck` and walk `quickstart.md` scenarios 1–14
- [ ] T046 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — keep Google Sign-In as it is and extend the Supabase Postgres line: no fake, a real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres, and the SF-103 code (`src/server/imports/imports.ts`) keeps to the same pooler limits (one `sql.begin()` per change, transaction-level `lock table` only, bulk inserts in chunks of 1,000) with its table from `migrations/0006_csv_imports.sql` — and `## Schemas` (each schema's GitHub URL at its commit: oauth2-api.json unchanged, nothing added); also mention the CSV fixtures in `tests/fixtures/csv/` and that `reset-db.sh` truncates `csv_imports`

---

## Dependencies & Execution Order

- **Setup (T001–T005)** → **Foundational (T006–T013)** → user stories.
- **US1 (T014–T030)** first: it builds the import table code, actions, shared UI and `runImport` that US2 and US3 extend.
- **US2 (T031–T035)** and **US3 (T036–T039)** both need US1; they touch different branches (`planOrganisations` vs the owner column) but the same files (`plan.ts`, `imports.ts`), so run them one after the other or merge carefully.
- **Polish (T040–T045, T046)** last; T046 is the last task of the feature.
- Within each story: tests first (see them fail), then `plan.ts`, then `imports.ts`, then actions, then pages and CSS.

### Parallel opportunities

- Setup: T002, T003, T004, T005 together after T001.
- Foundational: T006, T007, T008 together; then T010 and T011 together (T009 first is not required by them, but `readFile` is used by T007's example check).
- US1: T015–T019 together; T025 and T026 together.
- US2: T031–T033 together. US3: T036–T038 together.
- Polish: T040–T043 together.

### Parallel example: User Story 1

```text
T015 tests/unit/import-plan.test.ts
T016 tests/integration/imports-upload.test.ts
T017 tests/integration/imports-people.test.ts
T018 tests/integration/imports-concurrency.test.ts
T019 tests/e2e/import-people.spec.ts
```

## Implementation Strategy

- **MVP**: Setup + Foundational + US1: people imported end to end, with duplicates, organisations, lead sources, labels and the consent choice (the P1 story's independent test file has lead source and labels columns, so their matching is built in US1).
- Then US2 (organisations) and US3 (owners, consent words, warnings checked in depth); each checkpoint is a working, tested increment.
- Choices made here without asking: lead source and label matching sits in US1 because US1's test file uses them, and US3 adds the owner column and the deeper checks; the Supabase Postgres test task (T014) sits in US1, the first story whose code writes the new table; the test recipe task (T046) is the last task.
