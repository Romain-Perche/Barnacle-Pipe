---

description: "Tasks for SF-90 People and organisations"
---

# Tasks: People and organisations

**Input**: Design documents from `/specs/sf-90-people-and-organisations/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, contracts/list-query.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-004, SC-005, SC-006, SC-007): Vitest unit tests, Vitest integration tests against a real local Postgres (`crm_test`), Playwright browser tests through the fake Google login. Each test file starts with what it covers (`// covers FR-004, US1 scenario 5`). Within each story, write the tests first and see them fail.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. Visibility, validation and events are in `data-model.md`; list addresses in `contracts/list-query.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6 from spec.md
- Paths are from the repository root (single Next.js project, see plan.md § Project Structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The schema and the test plumbing. No new dependency (`dependencies.json` is `[]`): do not add any package.

- [ ] T001 Create `migrations/0002_people_organisations.sql` exactly as `data-model.md` § Tables: `organisations` (name `check (name = btrim(name) and name <> '')`, ≤ 200 chars, unique index on `lower(name)`; `size check (size in ('1–10','11–50','51–200','201–1,000','1,000+'))`; `owner_id`/`created_by` → users not null; `created_at`, `archived_at`, `version int not null default 1`), `lead_sources` and `labels` (name trimmed, non-empty, ≤ 100, unique index on `lower(name)` over all rows, `removed_at`), `persons` (`first_name`/`last_name text not null default ''` with `check (first_name <> '' or last_name <> '')`, `organisation_id` → organisations `on delete set null`, `lead_source_id` → lead_sources, `consent text not null default 'subscribed' check (consent in ('subscribed','unsubscribed'))`, `private boolean not null default false`, `created_by`, `owner_id`, `created_at`, `last_contacted_at`, `archived_at`, `version`), `person_emails` (`email text not null unique check (email = lower(btrim(email)))`, `kind in ('work','personal','other')` default `'work'`, `position int not null`, `unique (person_id, position)`, `on delete cascade`), `person_phones` (same, `phone text not null`, not unique), `person_labels` (pk `(person_id, label_id)`, cascade on person), `timeline_events` (`check (num_nonnulls(person_id, organisation_id) = 1)`, `kind in ('added','edited','archived','restored','person_linked','person_unlinked')`, `actor_id` → users null, `fields text[]`, `related_person_id` → persons `on delete cascade`); the indexes listed in data-model.md; `alter table … enable row level security` after every `create table` (8 tables, no policies); insert the lead sources Duncan's LinkedIn, Referral, Exec dinner, Inbound, Event, Ambassador. Only transaction-safe statements.
- [ ] T002 [P] Extend `tests/integration/db-helpers.ts`: `resetDb()` also truncates `timeline_events, person_labels, person_emails, person_phones, persons, organisations, labels` (restart identity cascade) and restores `lead_sources` to the six starting rows (not removed, original names); add helpers `makePerson()`, `makeOrganisation()`, `makeLabel()` that insert directly; widen `count()` to the new tables
- [ ] T003 [P] Extend `.factory/run/reset-db.sh` to truncate the new tables too and reset `lead_sources` to the six starting rows, so the AI review's scenario scripts start clean

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure rules, visibility, messages, formatting, timeline and navigation every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 [P] Unit tests in `tests/unit/records-rules.test.ts` for `src/server/records/rules.ts` (research.md §13, data-model.md § Validation): names (`name_required` when both empty after trim); emails (` Ada@Example.COM ` → `ada@example.com`, invalid → `email_invalid`, > 254 chars refused, `a@x.com` + `A@x.com ` → `email_twice`, empty rows dropped); phones (`+44 20 7946 0000` kept as typed without surrounding spaces, letters → `phone_invalid`, no digit refused, > 40 chars refused); website (`fakeco.example` → `https://fakeco.example`, `not a site` and `javascript:alert(1)` → `website_invalid`, `ftp://x.example` refused); LinkedIn (`linkedin.com/in/ada-example` → `https://linkedin.com/in/ada-example`, `www.linkedin.com/…` accepted, `https://example.com/ada` and `javascript:alert(1)` → `linkedin_invalid`); `escapeLike('50%_\\')` escapes all three; `changedFields(before, after)` returns human names in form order (data-model.md § State changes), counts a reorder or kind change of emails/phones as a change, and returns `[]` when nothing changed
- [ ] T005 [P] Unit tests in `tests/unit/list-query.test.ts` for `src/server/records/list-query.ts` covering every parameter of `contracts/list-query.md` for both lists: defaults (`sort=name`, `dir=asc`, `page=1`), invalid values ignored (`sort=drop`, `page=-1`, `owner=abc`, `consent=maybe`), `q` trimmed and cut at 200 chars, `page` kept as asked (clamping happens after counting), and `withParams()` resetting `page` and removing `open` when a filter, search, sort or `archived` changes
- [ ] T006 Implement `src/server/records/rules.ts` (pure, no DB, no Next.js) to pass T004
- [ ] T007 Implement `src/server/records/list-query.ts` (pure) with `parsePeopleQuery`, `parseOrganisationsQuery`, `withParams` to pass T005
- [ ] T008 [P] Add `formatDate(date)` ("19 Nov 2026", UK time) and `formatDateTime(date)` (same output as `formatLastSignIn` for non-null) to `src/server/format.ts`, with cases in `tests/unit/format.test.ts`
- [ ] T009 [P] Add every new message of `contracts/routes.md` § Messages to `src/server/messages.ts`: fixed texts as codes; the three templates (`duplicate_email`, `organisation_exists`, `person_deleted`/`organisation_deleted`) as functions taking the name from the database, kept apart from `messageFor()` so a URL code can never produce them; extend `tests/unit` with a test that `messageFor()` returns undefined for the template codes
- [ ] T010 Implement `src/server/records/visibility.ts`: `visiblePerson(sql, viewerId, alias = "p")` returning the postgres.js fragment `(not p.private or p.created_by = viewerId)` (research.md §2); every later query reading `persons` must use it
- [ ] T011 Implement `src/server/records/timeline.ts`: `recordEvent(tx, {personId | organisationId, kind, actorId, fields?, relatedPersonId?})` and `readTimeline(viewerId, {personId | organisationId})` returning events newest first with the actor's name, hiding organisation events whose `related_person_id` is not visible to the viewer (data-model.md § Visibility)
- [ ] T012 Implement `src/server/records/flash.ts`: `setFlash({code, name})` (cookie `crm_flash`, httpOnly, sameSite lax, path `/`, max-age 60, value JSON with only an allowed code and the name from the database) and `readFlash()` returning `{text}` built from the message template, or undefined for anything else (research.md §8)
- [ ] T013 [P] Shared UI in `src/app/(app)/records/`: `RecordHeader.tsx` (name, "Archived"/"Private" badges, `[ EDIT ]`, `[ ARCHIVE ]`/`[ RESTORE ]` forms, `[ DELETE ]` link to `?confirm=delete` for admins only), `DeleteConfirm.tsx` ("Delete <name> for good? This can't be undone.", `[ DELETE FOR GOOD ]` form, `[ CANCEL ]` link), `Timeline.tsx` (`// TIMELINE`, "Added by <name>", "Edited by <name>: <fields joined by ', '>", "Archived by <name>", "Restored by <name>", "<person> linked by <name>", "<person> unlinked by <name>", each with `formatDateTime`; an event with no actor reads "Added")
- [ ] T014 [P] Add the record, list, filter row, drawer, badge and form-row styles to `src/app/globals.css` following `docs/DESIGN.md` and design C in `specs/sf-90-people-and-organisations/design-options.html` (filter row above a Users-style table, drawer on the right, one-column record page with `// DETAILS` in two columns)
- [ ] T015 Add `{ href: "/people", label: "People" }` and `{ href: "/organisations", label: "Organisations" }` to `mainNav` and `{ href: "/admin/lead-sources-and-labels", label: "Lead sources and labels" }` to `adminNav` in `src/app/(app)/nav.ts` (FR-024)
- [ ] T016 Outside service — Supabase Postgres (no public schema on GitHub, plan.md § Outside services): no fake; integration tests run on a real local PostgreSQL 17 following Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres. Copy its transaction-mode pooler limits in the new code: every query goes through the existing `sql` client (`prepare: false`, `max: 5`), no session-level state (no `set`, no session advisory locks, no `listen`), multi-statement changes in one `sql.begin()` transaction. Add a check to `tests/integration/migrate.test.ts` that `0002_people_organisations.sql` applies on a fresh database and a second run is a no-op, and extend `tests/integration/rls.test.ts`'s expected table list with the 8 new tables

**Checkpoint**: rules, visibility, timeline, messages and navigation ready.

---

## Phase 3: User Story 1 - Add a person and find them again (Priority: P1) 🎯 MVP

**Goal**: add, view, edit and search people, with duplicate detection by email.

**Independent Test**: sign in, add a person with two email addresses and one phone, find them by searching the second address, open their page.

### Tests for User Story 1

- [ ] T017 [P] [US1] Integration tests in `tests/integration/people.test.ts` (covers FR-001–FR-006, US1): create with all fields (owner defaults to the actor, consent `subscribed`, `created_at` set, `last_contacted_at` null, `added` event); email stored lowercase/trimmed; positions kept in order (first = main); update replaces emails/phones/labels and records one `edited` event with exactly `Role, Email addresses, Phone numbers` for US1 scenario 3; no event when nothing changed; consent change recorded as "Consent" (FR-006); owner must be an active user (a deactivated user id is refused/ignored), a current deactivated owner is kept on edit; removed lead source/label ids refused for new choices but kept when the person already has them
- [ ] T018 [P] [US1] Integration tests in `tests/integration/duplicates.test.ts` (covers FR-004, SC-004, US1 scenario 5, edge cases): another person with `ADA@example.com`, ` ada@example.com `, `Ada@Example.COM` is refused with `duplicate_email` naming and linking the first person; same when the first is archived; when the first is private and the actor is not its creator → `duplicate_email_hidden` without the name or id; editing a person to take another's address refused; two concurrent creates with the same address → exactly one saved, the other gets the duplicate message (unique-index path); after deleting the first person, the address can be reused
- [ ] T019 [P] [US1] Integration tests in `tests/integration/people-concurrency.test.ts` (covers edge case "two users edit the same person"): two updates from the same `version` → second returns `edit_conflict`, the first one's values stay
- [ ] T020 [P] [US1] Integration test in `tests/integration/people-search.test.ts` (covers US1 scenario 2, edge case `50%`): search by part of first name, "Last First" order, any of several emails, organisation name; `50%` matches only a literal `50%`; `_` and `'` are literal; archived hidden unless `archived`
- [ ] T021 [P] [US1] Playwright test `tests/e2e/people.spec.ts` (covers US1 scenarios 1–5): add Ada Example with the values of scenario 1, see them on her page with "Subscribed", today's date and "Last contacted: Never"; search the People list for `ada.home@example.net` and open her page; edit (role, add phone, remove email) and see "Edited by <name>: Role, Email addresses, Phone numbers" at the top of the timeline; field errors "Enter a first or last name.", "Enter a valid email address.", "Enter a LinkedIn profile link (linkedin.com/…)." next to their fields with typed values kept; duplicate `ADA@example.com` shows "Ada Example already has this email address." with a link

### Implementation for User Story 1

- [ ] T022 [US1] Implement `src/server/records/people.ts` (all queries with `visiblePerson`): `getPerson(viewerId, id)` (fields, ordered emails/phones with kinds, organisation with archived flag, lead source, labels, owner with status, creator, version), `createPerson(actorId, input)` and `updatePerson(actorId, id, version, input)` — one transaction each: validate with `rules.ts`, look up conflicting emails (visible → `{code: "duplicate_email", name, href}`, else `duplicate_email_hidden`), resolve the organisation (`organisationId` or `newOrganisationName`, see T031), version-guarded update (`edit_conflict`), replace child rows, record `added`/`edited` (+ organisation `person_linked`/`person_unlinked`), map a `23505` on `person_emails_email_key` to the duplicate result; `private` accepted only from `created_by`; `choicesForForm()` (active users, non-removed lead sources and labels plus the person's current ones, non-archived organisations `id, name`)
- [ ] T023 [US1] Implement `listPeople(viewerId, query)` in `src/server/records/people.ts`: count + page query (50 per page, page clamped to the last), search as research.md §5 with `escapeLike`, default sort name A–Z (`lower(first_name || ' ' || last_name)`, tie-break id), rows with main email, organisation, role, owner, labels, lead source, consent, last contacted; archived hidden unless `archived`
- [ ] T024 [US1] Server actions `createPerson`, `updatePerson` in `src/app/(app)/people/actions.ts`: `requireUser()` first, parse `FormData` (`emails[i].value/kind`, `phones[i].value/kind`, `labelIds[]`, …), return `{errors, values}` on refusal, `revalidatePath` and `redirect` to `/people/<id>` on success; an invisible/missing id → `notFound()`
- [ ] T025 [US1] Client component `src/app/(app)/records/PersonForm.tsx` (`'use client'`, `useActionState`): first/last name, repeatable email and phone rows (value, kind Work/Personal/Other, add, remove, move up/down; first = main), organisation (via `OrganisationPicker`, T032; until then a plain select), role, lead source select, LinkedIn, owner select (active users; current deactivated owner shown "(deactivated)"), labels (checkboxes), consent (Subscribed/Unsubscribed), "Private" only when allowed, hidden `version`; each error message next to its field, the duplicate messages with their link; no "Date added"/"Last contacted" fields
- [ ] T026 [US1] Pages `src/app/(app)/people/new/page.tsx` and `src/app/(app)/people/[id]/edit/page.tsx` (`requireUser()`, `notFound()` for a bad/invisible id) rendering `PersonForm` with `choicesForForm()`
- [ ] T027 [US1] Page `src/app/(app)/people/[id]/page.tsx` (`requireUser()`; id must match `^[1-9][0-9]{0,15}$`, else `notFound()`): `RecordHeader`, `// DETAILS` in two columns as `contracts/routes.md` (emails with kind, LinkedIn link with `rel="noopener noreferrer" target="_blank"`, owner "(deactivated)", "Date added" via `formatDate`, "Last contacted: Never"), `Timeline`, `?error=` allow-list
- [ ] T028 [US1] Page `src/app/(app)/people/page.tsx`, first version: head (`// CONTACTS`, "People", `// N PEOPLE` via `countLabel`, `[ ADD PERSON ]`), search field (GET, `q` shown back only in the field), table with the columns of `contracts/list-query.md` and name links, "No people match these filters." with `[ CLEAR FILTERS ]`, `Pager.tsx` (previous/next, page n of m)

**Checkpoint**: US1 works on its own (MVP).

---

## Phase 4: User Story 2 - Organisations and the people who work there (Priority: P1)

**Goal**: add/edit organisations, link people, organisation page with its people.

**Independent Test**: add an organisation, link two people, see both on its page with roles; find it in the Organisations list.

### Tests for User Story 2

- [ ] T029 [P] [US2] Integration tests in `tests/integration/organisations.test.ts` (covers FR-007–FR-009, US2): create with all fields (website normalised to `https://fakeco.example`, owner default actor, `added` event); ` fakeco ltd ` refused with `organisation_exists` naming "Fakeco Ltd" (archived ones too); size outside the five bands refused; linking a person records `person_linked`, clearing records `person_unlinked`; creating a person with `newOrganisationName` "New Org" creates it owned by the actor in the same transaction, and with the name of an existing or archived organisation is refused with `organisation_exists`; organisation page people = visible, non-archived, with role and main email; version conflict → `edit_conflict_organisation`
- [ ] T030 [P] [US2] Playwright test `tests/e2e/organisations.spec.ts` (covers US2 scenarios 1–5): add Fakeco Ltd and see the website link and "No people yet."; link two people and see them with roles; type "New Org" in the person form, choose "Add organisation 'New Org'", save; " fakeco ltd " shows "Fakeco Ltd already exists." with a link; clear a person's organisation and see them gone from the organisation page; person page ↔ organisation page links

### Implementation for User Story 2

- [ ] T031 [US2] Implement `src/server/records/organisations.ts`: `getOrganisation`, `createOrganisation`, `updateOrganisation` (validate, `organisation_exists` with name/href via `lower(name)` lookup and the `23505` fallback, version guard, events), `peopleOf(viewerId, orgId)` (visible, non-archived), `resolveOrganisation(tx, actorId, {organisationId, newOrganisationName})` used by `people.ts` (an archived `organisationId` is accepted only if it is the person's current one)
- [ ] T032 [P] [US2] Client component `src/app/(app)/records/OrganisationPicker.tsx` (research.md §7): text input filtering the embedded non-archived organisations, a list of matches, and "Add organisation '<typed>'" when no exact match (ignoring case and surrounding spaces); submits hidden `organisationId` or `newOrganisationName`; a "clear" control; keyboard usable; wire it into `PersonForm.tsx`
- [ ] T033 [P] [US2] Client component `src/app/(app)/records/OrganisationForm.tsx` (`useActionState`): name, website, sector, size select (not set + five bands), location, owner select, hidden `version`; messages next to fields
- [ ] T034 [US2] Server actions `createOrganisation`, `updateOrganisation` in `src/app/(app)/organisations/actions.ts` (`requireUser()` first) and pages `src/app/(app)/organisations/new/page.tsx`, `src/app/(app)/organisations/[id]/edit/page.tsx`
- [ ] T035 [US2] Page `src/app/(app)/organisations/[id]/page.tsx`: `RecordHeader` (no Private), `// DETAILS` (website as a link `rel="noopener noreferrer" target="_blank"`, sector, size, location, owner, date added), `// PEOPLE` (name link, role, main email, or "No people yet."), `Timeline`; person page shows the organisation link marked "Archived" when archived
- [ ] T036 [US2] Page `src/app/(app)/organisations/page.tsx`, first version: head (`// CONTACTS`, "Organisations", `// N ORGANISATIONS`, `[ ADD ORGANISATION ]`), search by name or website, table (name, website host, sector, size, location, owner, number of visible non-archived people), empty message, pager; `listOrganisations(viewerId, query)` in `organisations.ts`

**Checkpoint**: US1 + US2 work together; organisations usable on their own.

---

## Phase 5: User Story 3 - Browse, sort and filter the lists (Priority: P2)

**Goal**: filters, sorting, paging, "Show archived" and the preview drawer on both lists, all in the address.

**Independent Test**: with fake data, filter People by lead source "Exec dinner" and owner "Ada Fake", sort by date added; check rows and order; same for organisations by sector.

### Tests for User Story 3

- [ ] T037 [P] [US3] Integration tests in `tests/integration/lists.test.ts` (covers FR-012–FR-015, US3 scenarios 1–5, edge cases on paging): each people filter (owner, label, lead source, organisation, consent) and their combination; each sort (`name`, `organisation`, `added`, `contacted`) both directions with nulls last; 51 matches → 50 rows + total 51 + page 2 has 1; `page=999` → last page; archived hidden unless `archived`; filter options include removed lead sources/labels still used by a visible person; organisations: owner, sector, size filters, sort by `name`, `people`, `added`
- [ ] T038 [P] [US3] Playwright test `tests/e2e/lists.spec.ts` (covers US3 scenarios 1–8, FR-014): seeded data; filter row above the table; filters + sort change rows and count; copying the address into a new page shows the same view; "No people match these filters." + `[ CLEAR FILTERS ]`; "Show archived" shows rows marked "Archived"; selecting a row (not the name) highlights it and opens the drawer with the fields of scenario 6; `[ OPEN PAGE ]` opens the page; `[ CLOSE ]` keeps filters and sort; reload keeps the drawer; same drawer checks on Organisations

### Implementation for User Story 3

- [ ] T039 [US3] Add filters, sorts and filter-option queries to `listPeople` / `listOrganisations` and a `peopleFilterOptions(viewerId)` / `organisationFilterOptions(viewerId)` per `contracts/list-query.md` in `src/server/records/people.ts` and `src/server/records/organisations.ts`
- [ ] T040 [P] [US3] `src/app/(app)/records/FilterRow.tsx` (server: GET form with search, selects, "Show archived" checkbox, `[ APPLY ]`) and `src/app/(app)/records/AutoSubmit.tsx` (`'use client'`, submits the closest form on change); sortable column headers as links built with `withParams`
- [ ] T041 [P] [US3] `src/app/(app)/records/Drawer.tsx` (server: right-hand panel, `[ OPEN PAGE ]`, `[ CLOSE ]` link to the address without `open`) and the stretched row link (visually hidden "Preview <name>", the name link above it), selected row highlighted
- [ ] T042 [US3] Wire filters, sorting, "Show archived" (rows marked "Archived") and the drawer into `src/app/(app)/people/page.tsx` (person drawer: name, organisation and role, main email, main phone, lead source, consent; only for a visible person, FR-028) and `src/app/(app)/organisations/page.tsx` (drawer: name, website, sector, size, location, owner, number of people)

**Checkpoint**: lists complete.

---

## Phase 6: User Story 4 - Archive, restore and delete (Priority: P2)

**Goal**: anyone archives/restores; only admins delete, after confirming.

**Independent Test**: as a user archive a person (gone from list, page shows "Archived" + `[ RESTORE ]`); as an admin delete them ("Page not found." afterwards).

### Tests for User Story 4

- [ ] T043 [P] [US4] Integration tests in `tests/integration/archive-delete.test.ts` (covers FR-016, FR-017, SC-006, US4): archive/restore by a non-admin records `archived`/`restored` (no duplicate event when already in that state); `deletePerson`/`deleteOrganisation` called with a non-admin actor (and with a deactivated admin) refuse and delete nothing; admin delete of a person removes emails, phones, labels, its events and organisation events about it; admin delete of an organisation leaves its people with no organisation
- [ ] T044 [P] [US4] Playwright test `tests/e2e/archive-delete.spec.ts` (covers US4 scenarios 1–6): as Linus Fake archive → badge, `[ RESTORE ]`, "Archived by Linus Fake", not in list or search; restore → "Restored by …"; no `[ DELETE ]` for Linus; a direct delete action request as Linus (replaying the admin's form post) shows "You don't have access to this page." and deletes nothing; as Ada confirm "Delete Ada Example for good? This can't be undone." → "Ada Example was deleted." on the list, old address "Page not found."; delete an organisation with people → people stay without organisation; archived organisation shown "Archived" on a linked person's page

### Implementation for User Story 4

- [ ] T045 [US4] `archivePerson`, `restorePerson`, `deletePerson` in `src/server/records/people.ts` and the same for organisations in `src/server/records/organisations.ts`: one transaction; visibility check; delete re-checks `users.role = 'admin' and status = 'active'` for the actor and returns the deleted name
- [ ] T046 [US4] Server actions in `src/app/(app)/people/actions.ts` and `src/app/(app)/organisations/actions.ts`: archive/restore with `requireUser()`; delete with `assertAdminForAction()` first, then `setFlash({code, name})`, `revalidatePath`, redirect to the list; record pages render `DeleteConfirm` for `?confirm=delete` (admins only) and the lists show `readFlash()`

**Checkpoint**: archive/restore/delete complete.

---

## Phase 7: User Story 5 - Private people (Priority: P2)

**Goal**: a private person is visible only to their creator, admins included.

**Independent Test**: as A add a private person; as B and as an admin they are absent everywhere and their address shows "Page not found.".

### Tests for User Story 5

- [ ] T047 [P] [US5] Integration tests in `tests/integration/private.test.ts` (covers FR-018, FR-019, FR-028, SC-005, US5, edge case "creator deactivated"): with a private person P created by A, call every read function as B and as an admin — `listPeople` (with and without search, every filter, `archived`), counts, filter options, `getPerson`, `peopleOf` and the organisation's people count, `readTimeline` of the organisation (no linked/unlinked event about P), the drawer data — and assert P never appears; `updatePerson`, `archivePerson`, `restorePerson`, `deletePerson` on P as B/admin change nothing and return not found; `private` sent by a non-creator on edit is ignored; still hidden after A is deactivated; A sees P everywhere with the private flag
- [ ] T048 [P] [US5] Playwright test `tests/e2e/private.spec.ts` (covers US5 scenarios 1–4): as Linus tick "Private" → "Private" badge, still in his list; as Ada (admin) not in list, search, organisation page or its count, address "Page not found.", `?open=<id>` shows no drawer; Ada editing another of Linus's (non-private) people sees no "Private" option; adding `secret@example.com` as Ada shows "Another person already has this email address."

### Implementation for User Story 5

- [ ] T049 [US5] Audit and complete privacy in `src/server/records/people.ts`, `organisations.ts`, `timeline.ts`: every `persons` read uses `visiblePerson`, organisation people counts and filter options included; "Private" checkbox on `PersonForm` only for the creator (create: always); "Private" badge in `RecordHeader`

**Checkpoint**: privacy enforced everywhere.

---

## Phase 8: User Story 6 - Admins keep the lead source and label lists (Priority: P3)

**Goal**: admin page to add, rename and remove lead sources and labels.

**Independent Test**: as admin rename Event → Events, add label Hot, remove Inbound; as user see the effects on people, pickers and filters.

### Tests for User Story 6

- [ ] T050 [P] [US6] Integration tests in `tests/integration/choices.test.ts` (covers FR-020–FR-022, SC-006, US6): fresh database lists the six lead sources and no labels; add (trimmed) / rename / remove for both lists; ` event ` / `EVENT` refused with `choice_exists`; empty name → `choice_name_required`; adding the name of a removed entry brings it back; rename shows on every person; removed entries kept by people, not offered by `choicesForForm()`, still offered in filters while used; every change by a non-admin or deactivated admin refused with nothing changed
- [ ] T051 [P] [US6] Playwright test `tests/e2e/choices.spec.ts` (covers US6 scenarios 1–5): the admin flow of the Independent Test; as Linus the page shows "You don't have access to this page.", no sidebar link, and a replayed form post changes nothing

### Implementation for User Story 6

- [ ] T052 [US6] Implement `src/server/records/choices.ts`: `listChoices(kind)`, `addChoice`, `renameChoice`, `removeChoice` for `kind ∈ {lead_source, label}`, each in one transaction that re-checks the actor is an active admin (research.md §11); names trimmed, ≤ 100
- [ ] T053 [US6] Page `src/app/(app)/admin/lead-sources-and-labels/page.tsx` (`requireAdmin()`, Forbidden for non-admins) and actions `src/app/(app)/admin/lead-sources-and-labels/actions.ts` (`assertAdminForAction()` first, redirect with `?error=choice_exists|choice_name_required`) per `contracts/routes.md`

**Checkpoint**: all stories complete.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T054 [P] Fake data `src/seed/people.ts` per data-model.md § Fake data (≥ 8 organisations, labels Hot/Investor/Partner, ≥ 30 people, every lead source, label, consent, size band, active fake owner; archived person and organisation; private person created by Ada Fake; varied `created_at`/`last_contacted_at`; idempotent), registered after users in `src/seed/index.ts`; extend `tests/integration/seed.test.ts` (covers FR-027, SC-007): run twice → same counts, every filter and sort option of both lists returns ≥ 1 row
- [ ] T055 [P] Performance check in `tests/integration/lists-performance.test.ts` (covers SC-002, SC-003): insert 2,000 people and 500 organisations, each list's first page with a search, several filters and each sort returns in < 2 s
- [ ] T056 [P] Playwright test in `tests/e2e/layout.spec.ts`: sidebar shows People and Organisations to everyone, "Lead sources and labels" only to admins; `/people/abc` and `/organisations/999999` show "Page not found." inside the shell (FR-024, edge case)
- [ ] T057 [P] Update `README.md` (new pages, fake data contents) and `docs/DECISIONS.md` with one line each `(SF-90)`: design C for people and organisation lists and pages; people added by hand are Subscribed; only admins keep the lead source and label lists; plus each "decided by the factory" choice in spec.md § Clarifications once confirmed in Plan Review
- [ ] T058 Run `npm test && npm run test:e2e && npm run typecheck` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test` and walk through `quickstart.md`; fix any failure
- [ ] T059 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — Google Sign-In (unchanged: `tests/fakes/google.ts`, `oauth2-api.json`) and Supabase Postgres (no fake, real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres) — and `## Schemas` (each schema's GitHub URL at its commit: `oauth2-api.json` at https://github.com/googleapis/google-api-go-client/blob/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json); update the scripts notes for the new tables and seed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks every story.
- **US1 (Phase 3)**: after Foundational. MVP.
- **US2 (Phase 4)**: after Foundational; T031 `resolveOrganisation` is used by `people.ts` (T022) — until then `people.ts` accepts only `organisationId`. T032 wires into `PersonForm` (T025).
- **US3 (Phase 5)**: after US1 and US2 (extends both lists).
- **US4 (Phase 6)**: after US1 and US2 (record pages).
- **US5 (Phase 7)**: after US1 (visibility already built in Phase 2; this phase tests and completes it); best after US2–US4 so every read/write path is covered.
- **US6 (Phase 8)**: after Foundational; independent of the other stories (uses `choicesForForm()` effects only in its e2e test, so after US1).
- **Polish (Phase 9)**: after the stories; T059 is the last task.

### Within Each User Story

Tests first (they must fail), then domain code in `src/server/records/`, then actions, then pages/components.

### Parallel Opportunities

- T002, T003 in parallel with T001's review.
- T004, T005, T008, T009, T013, T014 in parallel.
- All test tasks marked [P] within a story in parallel.
- T032 and T033; T040 and T041 in parallel.
- US6 (Phase 8) in parallel with US3/US4 once US1 is done.
- T054, T055, T056, T057 in parallel.

---

## Parallel Example: User Story 1

```bash
# Tests together:
Task: "T017 Integration tests in tests/integration/people.test.ts"
Task: "T018 Integration tests in tests/integration/duplicates.test.ts"
Task: "T019 Integration tests in tests/integration/people-concurrency.test.ts"
Task: "T020 Integration test in tests/integration/people-search.test.ts"
Task: "T021 Playwright test tests/e2e/people.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2.
2. Phase 3 (US1): add, edit, find people with duplicate detection.
3. Stop and validate with quickstart.md scenarios 1–3.

### Incremental Delivery

US1 → US2 (organisations) → US3 (lists) → US4 (archive/delete) → US5 (private) → US6 (admin lists) → Polish. Each phase ends at a checkpoint where all tests so far pass.

## Notes

- No new dependency; do not add packages.
- Every page calls `requireUser()`/`requireAdmin()`; every action `requireUser()`/`assertAdminForAction()` first.
- Never show text from the address as a message; `q` is shown only inside the search field.
- Fake data uses clearly fake names and `example.com`/`example.net` addresses.
