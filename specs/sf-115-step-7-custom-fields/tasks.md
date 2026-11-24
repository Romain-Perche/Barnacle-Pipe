---

description: "Task list for SF-115 Custom fields"
---

# Tasks: Custom fields

**Input**: Design documents from `/specs/sf-115-step-7-custom-fields/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-003 to SC-007): Vitest unit tests and Vitest integration tests against a real local Postgres (`crm_test`). No browser tests (docs/DECISIONS.md, 2026-11-23): never start the app in a browser. Each test file names what it covers (`// covers FR-007, US2 scenario 2`). Write each story's tests first and see them fail before the code.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. The migration, entities, value storage, state changes, list parts and fake data are in `data-model.md`; pages, parameters, actions and domain functions in `contracts/routes.md`; decisions in `research.md` (§n below). No new dependency (`dependencies.json` is `[]`): do not add any package. No blueprint applies (`blueprints.json` is `[]`, no blueprint index in this run), so there are no blueprint tasks and no `Departs from blueprint` line. Every choice in spec.md § Clarifications is confirmed by a person (2026-11-24); build it as written there. The only outside service is Supabase Postgres (no public schema on GitHub): its task is T013, the recipe T054. Fake users: Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users), Alan Fake (deactivated); where the spec says "Bob Fake (admin)", use Grace Fake.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)

---

## Phase 1: Setup

**Purpose**: The schema and the pure building blocks every story uses.

- [X] T001 Write `migrations/0010_custom_fields.sql` exactly as data-model.md § Migration: tables `custom_fields` (`kind text not null check (kind in ('person', 'organisation', 'deal'))`, `name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 60)`, `type text not null check (type in ('text', 'long_text', 'number', 'money', 'date', 'single_choice', 'multiple_choice', 'yes_no'))`, `position int not null`, `in_list boolean not null default false`, `created_by`, `created_at`; unique index `custom_fields_name_key on (kind, lower(name))`), `custom_field_choices` (`field_id … on delete cascade`, name 1–60 trimmed, `position`, `removed_at`; unique `(field_id, lower(name))`) and `custom_values` (`field_id … on delete cascade`, `person_id` / `organisation_id` / `deal_id` each `on delete cascade` with `check (num_nonnulls(person_id, organisation_id, deal_id) = 1)`; `text_value` `<> ''` and `<= 10000`, `number_value numeric(17, 4)` between ±1000000000000, `money_pence bigint` between 0 and 999999999999, `date_value date`, `choice_id` FK to choices, `choice_ids bigint[]` with `cardinality between 1 and 100`, `bool_value boolean`, `check (num_nonnulls(text_value, number_value, money_pence, date_value, choice_id, choice_ids, bool_value) = 1)`; the three partial unique indexes `(field_id, <target>) where <target> is not null`, the per-target indexes, `custom_values_choice_idx`, GIN `custom_values_choice_ids_idx`); `alter table … enable row level security` after each `create table`; `timeline_events` gains `field_name text null check (char_length(field_name) <= 60)`, `old_value` / `new_value text null check (char_length(...) <= 10000)`; replace `timeline_events_kind_check` with every kind of `0009_ambassadors.sql` plus `'custom_set', 'custom_changed', 'custom_cleared'` and SF-116's `'file_added', 'file_deleted'`, with a SQL comment above the check saying the file kinds are there because SF-116's `0011_files.sql` rewrites the same check and lists the custom kinds too, so neither migration drops the other's kinds whichever merges first (confirm the list and constraint name with `\d timeline_events` first); add `timeline_events_custom_check`. No `begin`/`commit`/`concurrently`
- [X] T002 Add `custom_values, custom_field_choices, custom_fields` to the `truncate` in `tests/support/reset.ts`
- [X] T003 [P] Add every message and template of contracts/routes.md § Messages to `src/server/messages.ts` under an `// SF-115` comment (codes `custom_field_name_required` … `custom_record_archived`; templates `custom_field_exists(name)` … `import_custom_field_gone(name)`, `custom_delete_count(n, kind, name)` with "1 person has" / "3 people have", organisations, deals); add `custom_field_deleted` to the flash codes in `src/server/records/flash.ts`
- [X] T004 [P] Create the pure `src/server/custom-fields/rules.ts` constants and types (contracts/routes.md § Domain functions): `CUSTOM_TYPES`, `TYPE_LABELS` ("Text", "Long text", "Number", "Money (£)", "Date", "Single choice", "Multiple choice", "Yes/No"), `type RecordKind = "person" | "organisation" | "deal"`, `KIND_OF_TAB` (`people` → person, `organisations` → organisation, `deals` → deal), `BUILT_IN_NAMES` exactly as data-model.md § Custom field, `SORTABLE_TYPES` (all but `long_text` and `multiple_choice`), `MAX_FIELDS = 50`, `MAX_CHOICES = 100`, `MAX_IN_LIST = 8`, `MAX_NAME = 60`, `MAX_TEXT = 255`, `MAX_LONG_TEXT = 10000`; types `CustomField = { id, kind, name, type, position, inList, choices: { id, name, position, removed: boolean }[] }` and `CustomValue` (string | number | boolean | number[] | null per type)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Pure parsing/formatting of values, the timeline kinds, and reading the fields — used by every story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Unit tests in `tests/unit/custom-fields-rules.test.ts` for T006 (`// covers FR-001, FR-003, FR-007, US1 scenarios 2–3, US2 scenario 2`): names (empty → `custom_field_name_required`, 61 characters → `custom_field_name_too_long`, " Email address " for person / "Website" for organisation / "Title" for deal → `custom_field_exists`, case and end spaces ignored); choices (none for a choice type → `custom_choices_required`, two equal ignoring case → `custom_choice_twice`, 61 characters → `custom_choice_name_too_long`, 101 → `custom_choices_limit`); values per type: text 255 ok / 256 `custom_text_too_long`; long text 10,000 ok / 10,001 `custom_long_text_too_long`, `\r\n` → `\n`; number "1,234.5", "-12", "0" ok, "abc" `custom_number_invalid`, "1.23456" `custom_number_decimals`, "1000000000001" `custom_number_range`; money "£4,000.50" → 400050, "0" → 0, "-1" `custom_money_invalid`; date "2026-02-30" `custom_date_invalid`; choice not offered `custom_choice_invalid`, removed choice the record already has accepted; multiple choice stored sorted by choice position; yes/no "yes"/"no"/""; every error keyed `cf.<id>` with `name` = the field's name
- [X] T006 Implement in `src/server/custom-fields/rules.ts`: `validateFieldForm(kind, form)` (name trimmed 1–60, not in `BUILT_IN_NAMES[kind]` compared with `lower(btrim())`; type one of `CUSTOM_TYPES` else `custom_field_type_required`; choices one per line, trimmed, empty lines dropped, required for the two choice types, ≤ 60 each, unique ignoring case, ≤ 100; `inList` boolean), `validateChoiceName(raw)`, `parseNumber(raw)` (remove spaces and thousands commas; `^-?\d+(\.\d{1,4})?$`; |n| ≤ 1e12 compared as strings/BigInt, never through a float), `validateCustomValues(fields, raw, current)` using `parseMoney` / `parseDate` from `src/server/deals/rules.ts` (research.md §7–8)
- [X] T007 [P] Unit tests for formatting in `tests/unit/custom-fields-rules.test.ts` (`// covers US2 scenario 3, US3 scenario 1, FR-009`): `formatNumber("1234.5000")` → "1,234.5", `"0.0000"` → "0", `"-12.0000"` → "-12"; `formatDay("2026-11-24")` → "24 Nov 2026"; money → `formatMoney` ("£4,000", "£4,000.50", "£0"); multiple choices in choice order joined ", " with current names; yes/no "Yes"/"No"; empty → "—"; `listText` of long text cuts at 80 characters + "…"; `customEvent(field, before, after)` → `null` when equal, `custom_set` with `newValue`, `custom_changed` with `oldValue`/`newValue`, `custom_cleared`; long text: set and change → `custom_changed` with no values, clear → `custom_cleared`
- [X] T008 Implement `formatNumber`, `formatDay`, `formatValue(field, value)`, `listText(field, value)`, `customEvent(field, before, after)` in `src/server/custom-fields/rules.ts`
- [X] T009 Extend `src/server/records/timeline.ts`: `EventKind` + `"custom_set" | "custom_changed" | "custom_cleared"`; `recordEvent` accepts `fieldName`, `oldValue`, `newValue` (written to `field_name`, `old_value`, `new_value`); `TimelineEvent` gains `fieldName`, `oldValue`, `newValue`; `selectEntries` selects them; `doneActivities` sets them to `null`
- [X] T010 [P] `src/app/(app)/records/Timeline.tsx` `Line` for the three kinds as text nodes: `templates.custom_set_event(field, value)`, `templates.custom_changed_event(field, old, new)` or `templates.custom_changed_plain(field)` when both values are null, `templates.custom_cleared_event(field)`, each followed by " by <user>"; extend `tests/unit/timeline-view.test.ts` so `entryTag` gives "CHANGE" for the three kinds
- [X] T011 Create `src/server/custom-fields/fields.ts` read functions: `listFields(kind)` (ordered by `position, id`, with choices ordered by `position, id`, removed ones flagged), `fieldCounts()` (per kind), `getField(id)`
- [X] T012 [P] Form types and wire format (research.md §7): `PersonForm`, `OrganisationForm` (`src/server/records/rules.ts`) and `DealForm` (`src/server/deals/rules.ts`) gain `custom: { shown: number[]; values: Record<number, string[]> }`; `personFormFromData`, `organisationFormFromData`, `dealFormFromData` in `src/server/records/form-data.ts` read `cfShown` (comma-joined ids, at most 50, via `toId`) and every `cf.<id>` (`fd.getAll`, at most 100 values each, each cut at 10,001 characters); `personFormFromRow` / `organisationFormFromRow` and `personToForm` / `organisationToForm` / `dealToForm` pass an empty `custom`; extend `tests/unit/form-data.test.ts`

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Admins manage custom fields (Priority: P1) 🎯 MVP

**Goal**: The Custom fields admin page (design B): tabs, table, add/edit box, choices, order, "Show in list".

**Independent Test**: As Ada Fake add the people field "Dietary needs" (single choice: None, Vegetarian, Vegan), rename it "Diet", move it up; as Linus Fake the page is not in the sidebar and every action is refused with nothing changed.

### Tests for User Story 1 ⚠️

- [X] T013 [US1] Supabase Postgres has no public schema on GitHub, so there is no fake to check against a schema: the tests use a real local PostgreSQL 17, and the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler). It copies its limits: no prepared statements (`prepare: false`, unchanged in `src/server/db.ts`), no session state (no `set`, `listen` or session advisory lock), every multi-statement change in one `sql.begin()` transaction, at most 5 connections (`max: 5`). Extend `tests/integration/migrate.test.ts` so it scans `src/server/custom-fields/*.ts` for `set `/`listen`/`pg_advisory_lock` and fails on any, checks `migrations/0010_custom_fields.sql` has no `begin`/`commit`/`concurrently`/`vacuum`, applies it on a fresh database, and checks Postgres's own refusals: 23514 for a field name of 61 characters, a type `'colour'`, a value row with two value columns or two targets, a `custom_set` event without `field_name`, an `edited` event with `old_value`; 23505 for a second "diet" field of kind person and a second value row for the same field and person; the kind check still accepting `'note'`, `'imported'` and `'referrer_changed'`, and accepting `'file_added'` and `'file_deleted'` (SF-116); and extend `tests/integration/rls.test.ts` if it lists tables by name, so the three new tables must have RLS on
- [X] T014 [P] [US1] Integration tests in `tests/integration/custom-fields-admin.test.ts` (`// covers FR-001, FR-002, FR-003, FR-005, FR-014, US1 scenarios 1–8, US3 scenario 5`): add each of the eight types (last position, counts per kind); name rules incl. built-in and other custom names; type never changes on `updateField`; rename; `moveField` up/down renumbers 1..n with no gap; in-list: the 9th refused with `custom_list_limit` and stays off; 51st field `custom_fields_limit`; choices add/rename/move/remove, removing the last offered choice → `custom_choice_last`, re-adding a removed choice's name brings it back, renaming to a removed choice's name → `custom_choice_removed_exists`, 101st → `custom_choices_limit`; every function called by Linus Fake (not admin) or by a deactivated admin returns `forbidden` and nothing changes; two `updateField` calls one after another: the last name wins, the field listed once, positions still 1..n

### Implementation for User Story 1

- [X] T015 [US1] Admin changes in `src/server/custom-fields/fields.ts` (data-model.md § Admin changes), each in one `sql.begin()` with `isActiveAdmin(db, actorId)` first and results `{ ok: true } | { ok: false; code }` like `src/server/records/choices.ts`: `addField`, `updateField` (name and `in_list` only), `moveField`, `addFieldChoice`, `renameFieldChoice`, `moveFieldChoice`, `removeFieldChoice`; lock the kind's fields `for update` (order `position, id`) before counting or renumbering (as `renumber` in `src/server/deals/pipelines.ts`); map the unique-index violations `custom_fields_name_key` / `custom_field_choices_name_key` to `custom_field_exists` / `custom_choice_exists`
- [X] T016 [US1] Server actions `src/app/(app)/admin/custom-fields/actions.ts` (`"use server"`, `assertAdminForAction()` first): `addCustomField`, `updateCustomField` (for `useActionState`: return `FormState` with errors and the typed values, redirect to `/admin/custom-fields?kind=<tab>` on success), `moveCustomField`, `addCustomChoice`, `renameCustomChoice`, `moveCustomChoice`, `removeCustomChoice` (redirect back to `?kind=<tab>&field=<id>`, `&error=<code>` on a refusal); `revalidatePath` of the admin page and `/people`, `/organisations`, `/deals`
- [X] T017 [US1] The page `src/app/(app)/admin/custom-fields/page.tsx` (`requireAdmin()`), design B per `design-options.html` option B and contracts/routes.md § Pages: `// ADMIN` label, h1 "Custom fields", `[ ADD FIELD ]` → `?kind=<tab>&field=new`; tabs "People · n", "Organisations · n", "Deals · n"; table Order (↑ ↓ forms), Name, Type (`TYPE_LABELS`), Choices (offered names joined ", " or "—"), In list (Yes/No), `[ EDIT ]`, `[ DELETE ]`; empty tab `messages.custom_fields_empty`; `?error=` shown only for known codes; `kind`, `field`, `delete` parsed to fixed words / ids (nothing from the address shown)
- [X] T018 [US1] The client box `src/app/(app)/admin/custom-fields/FieldBox.tsx` (overlay look of `src/app/(app)/activities/ActivityBox.tsx`): add mode "ADD <KIND> FIELD" with Name, Type select, "Choices, one per line" textarea shown only for Single choice / Multiple choice, ☐ "Show in the <Kind> list", `[ SAVE ]`, `[ CANCEL ]`; edit mode "EDIT <KIND> FIELD <name>" with Name, Type as text + " (can't be changed)" and no type input, the tick, `[ SAVE ]`, `[ CANCEL ]`; errors under each input; and the server `src/app/(app)/admin/custom-fields/ChoiceRows.tsx` shown in edit mode for choice fields: each offered choice with ↑ ↓, a name input + `[ RENAME ]`, `[ REMOVE ]`, then "New choice" + `[ ADD ]`
- [X] T019 [P] [US1] Add `{ href: "/admin/custom-fields", label: "Custom fields" }` last in `adminNav` in `src/app/(app)/nav.ts`; extend `tests/unit/nav.test.ts`; CSS for the tabs and the field table in `src/app/globals.css` with existing tokens only

**Checkpoint**: Admins can manage fields and choices; nothing shows on records yet.

---

## Phase 4: User Story 2 - Fill in and see custom fields on records (Priority: P1)

**Goal**: Inputs on the add/edit forms, "// MORE DETAILS" on pages and the drawer, CHANGE entries on the timeline.

**Independent Test**: With the people field "Diet" (single choice) and the deal field "Contract end" (date), edit a person and a deal; both pages show the values and each timeline shows the change with who and when.

### Tests for User Story 2 ⚠️

- [X] T020 [P] [US2] Integration tests in `tests/integration/custom-values.test.ts` (`// covers FR-006, FR-007, FR-008, FR-009, US2 scenarios 1–7, US4 scenario 5, edge cases`): `createPerson` / `updatePerson`, `createOrganisation` / `updateOrganisation`, `createDeal` / `updateDeal` with each type save the values and `readCustomValues` returns them formatted; an invalid value refuses the whole save (record and values unchanged) with the error under `cf.<id>`; timeline rows "Diet set to Vegan", "Diet changed from Vegan to Vegetarian", "Diet cleared", "Notes changed" for long text, with actor; no custom row when nothing changed; a removed choice kept when re-saved untouched, then not offered once changed; after renaming the field, old entries keep the old name and old choice names; a field added after the form opened (not in `cfShown`) keeps no value; a field deleted before the save is ignored and the rest saves; 0, £0 and No are stored and shown as "0", "£0", "No"; all ticks removed on a multiple choice → row deleted and "<Field> cleared"; markup in a value comes back as the literal text; archived record: a save changing a custom value refused with `custom_record_archived` and nothing saved, a save not changing one goes through; a money custom value on a deal leaves `getBoard` column totals and `listDeals` `totalPence` unchanged

### Implementation for User Story 2

- [X] T021 [US2] `src/server/custom-fields/values.ts`: `formFields(kind, current)` (fields in order; choices offered, plus removed ones the record has); `readCustomValues(db, viewerId, target)` (one query over `custom_values` joined to the visible record — `visiblePerson` / `visibleDeal` from `src/server/records/visibility.ts` in the same query; organisations are never private); `saveCustomValues(db, actorId, target, raw, { current, archived })` per data-model.md § Record saves: fields `for share`, only ids in `cfShown`, `validateCustomValues`, archived rule, upsert (`insert … on conflict (field_id, <target>) where <target> is not null do update`, `updated_at = now()`) or delete, one `recordEvent` per change from `customEvent` with the field's current name and the values as `formatValue` text
- [X] T022 [US2] Call `saveCustomValues` inside the existing transactions of `createPerson` / `updatePerson` (`src/server/records/people.ts`), `createOrganisation` / `updateOrganisation` (`src/server/records/organisations.ts`), `createDeal` / `updateDeal` (`src/server/deals/deals.ts`) after the record is locked and loaded (create: after the "added" event); errors through the existing `refuse(...)`; `getPerson` / `getOrganisation` / `getDeal` gain `custom` (from `readCustomValues`) and `*ToForm` fills `custom` from it
- [X] T023 [US2] The form part `src/app/(app)/records/CustomInputs.tsx` (no state; data-model.md § Custom value inputs: `<input>`, `<textarea>`, `inputMode="decimal"`, "£" input, `type="date"`, select with empty option, one checkbox per choice, Yes/No select with empty option), names `cf.<id>`, hidden `cfShown`, error under each via `FieldError` key `cf.<id>`, under a `// MORE DETAILS` heading; used in `src/app/(app)/records/PersonForm.tsx`, `src/app/(app)/records/OrganisationForm.tsx`, `src/app/(app)/deals/DealForm.tsx` after the built-in fields, not rendered when `archived` or when the kind has no field; the new/edit pages of people, organisations and deals pass `formFields(...)`; typed values come back on a refusal through `FormState.values`
- [X] T024 [US2] The section `src/app/(app)/records/MoreDetails.tsx` (server): `// MORE DETAILS` below `// DETAILS`, same two-column `dl` look, every field in order with `formatValue` or "—", long text with `white-space: pre-wrap`; nothing when the kind has no field; used in `src/app/(app)/people/[id]/page.tsx`, `src/app/(app)/organisations/[id]/page.tsx`, `src/app/(app)/deals/[id]/page.tsx` and `src/app/(app)/deals/DealDrawer.tsx`

**Checkpoint**: Custom values can be filled in, seen and followed on the timeline.

---

## Phase 5: User Story 3 - Custom fields in the People, Organisations and Deals lists (Priority: P2)

**Goal**: Columns, sorts and filters for fields marked "Show in list", kept in the address.

**Independent Test**: Mark "Diet" "Show in list"; the People list has a "Diet" column and filter; "Vegan" with an Owner filter lists only vegan people of that owner.

### Tests for User Story 3 ⚠️

- [X] T025 [P] [US3] Unit tests in `tests/unit/list-query.test.ts` (`// covers FR-010, FR-012, US3 scenario 4`): `parsePeopleQuery` / `parseOrganisationsQuery` / `parseDealsQuery` collect `cf<id>`, `cf<id>_from`, `cf<id>_to` (at most 24 entries, values cut at 200) into `custom` and accept `sort=cf<id>`; `knownCustomQuery` keeps only shown fields of the kind with a valid value (a choice id of that field — removed ones included —, `empty`, `yes`/`no`, a parsable number, money or date) and drops the rest; drops `sort=cf<id>` for an unknown, hidden, long text or multiple choice field (back to the list's default); `withParams` writes `custom` after the built-in keys, sorted by key, and resets the page; `hasFilters` / `hasDealFilters` count `custom`
- [X] T026 [P] [US3] Integration tests in `tests/integration/custom-lists.test.ts` (`// covers FR-010, FR-011, US3 scenarios 1–3`): columns only for shown fields, in order, formatted, "—" when empty, long text cut at 80 + "…"; sort by each sortable type, asc and desc, empty values last both ways; filters: text/long text contains (ignoring case, `%` and `_` literal), number and money from/to inclusive, date from/to inclusive, single choice and "Empty", multiple choice has the choice, yes/no Yes/No/Empty; combined with Owner and `q`; the deal list's count and `totalPence` follow; with no shown field the queries return the same rows as before
- [X] T027 [P] [US3] Performance test `tests/integration/custom-lists-performance.test.ts` (`// covers SC-003`): 5,000 people, 8 shown fields with values, one custom filter and a custom sort: `listPeople` plus `customColumns` for the first page under 2 s

### Implementation for User Story 3

- [X] T028 [US3] `src/server/records/list-query.ts`: `custom: Record<string, string>` on `PeopleQuery`, `OrganisationsQuery`, `DealsQuery`; sort types widened with `` `cf${number}` ``; `knownCustomQuery(query, shownFields)` (pure); `withParams`, `hasFilters`, `hasDealFilters` as tested in T025
- [X] T029 [US3] `src/server/custom-fields/values.ts`: `customListParts(db, kind, alias, fields, query)` → `{ where, join, order }` per data-model.md § Lists (one `exists` per filter, `not exists` for "empty", `escapeLike` for words; sort join with `nulls last` and the list's own tie-break); `customColumns(kind, fields, ids)` (one query for the page's ids, values through `listText`); `customFilterOptions(viewerId, kind, fields)` (offered choices plus removed ones a visible record still has, research.md §12)
- [X] T030 [US3] `listPeople` (`src/server/records/people.ts`), `listOrganisations` (`src/server/records/organisations.ts`) and `listDeals` (`src/server/deals/list.ts`) take the shown fields and add the parts to their `where` (after the visibility fragment) and `order`; the deal list's count and total use the same `where`
- [X] T031 [US3] Pages `src/app/(app)/people/page.tsx`, `src/app/(app)/organisations/page.tsx`, `src/app/(app)/deals/list/page.tsx`: load the kind's shown fields, apply `knownCustomQuery` before listing and building links, add the columns (sort links for sortable types) after the built-in columns, and the filter controls `src/app/(app)/records/CustomFilters.tsx` (server: text input; from/to inputs; select "Any <name>" + choices + "Empty"; Yes/No/Empty select) in the filter row in the look of the built-in filters (`ListBits.tsx`, `AutoSubmit`); text words only as the input's `defaultValue`

**Checkpoint**: Lists show, sort and filter by custom fields.

---

## Phase 6: User Story 4 - Delete a custom field with a clear warning (Priority: P2)

**Goal**: The delete confirmation with an exact count, and the delete itself.

**Independent Test**: With "Diet" on 3 people (one private to Linus Fake), `[ DELETE ]` as Ada Fake says "3 people have a value in Diet. …"; cancel changes nothing; confirm removes the field and its values and shows "Diet deleted.".

### Tests for User Story 4 ⚠️

- [X] T032 [P] [US4] Integration tests in `tests/integration/custom-fields-delete.test.ts` (`// covers FR-004, SC-005, US4 scenarios 1–4, edge case "record deleted"`): `countValues` equals the rows for shared, private (hidden from the admin) and archived records, 0 when none; `deleteField` removes the field, its choices and values (no row left), renumbers the kind, writes no timeline row, keeps earlier `custom_*` entries with their name; non-admin refused; deleting a person, organisation or deal removes its values and the count drops by one; `templates.custom_delete_count` / `custom_delete_none` texts for 1 and n of each kind

### Implementation for User Story 4

- [X] T033 [US4] `countValues(id)` and `deleteField(actorId, id)` in `src/server/custom-fields/fields.ts` (admin re-checked; `for update` on the field, delete by cascade, renumber; returns the field's name)
- [X] T034 [US4] `src/app/(app)/admin/custom-fields/FieldDeleteConfirm.tsx` (server box: count text or "No record has a value in <name>.", `[ DELETE FIELD ]` form, `[ CANCEL ]` → the tab) opened by `?delete=<id>` on the page; action `deleteCustomField` in `actions.ts` (`assertAdminForAction()`, `setFlash({ code: "custom_field_deleted", name })`, redirect to the tab); the page shows the flash notice

**Checkpoint**: Fields can be deleted safely.

---

## Phase 7: User Story 5 - Map CSV columns to custom fields (Priority: P2)

**Goal**: Custom fields as CSV import targets with value reading and warnings.

**Independent Test**: With the people field "Diet" and a CSV with a "Diet" column, the column is suggested, the preview shows values, imported people have them; "Pescatarian" is warned about and left empty.

### Tests for User Story 5 ⚠️

- [X] T035 [P] [US5] Unit tests in `tests/unit/import-columns.test.ts`, `tests/unit/import-rows.test.ts`, `tests/unit/import-plan.test.ts` (`// covers FR-013, US5 scenarios 1–4`): custom targets `custom:<id>` offered after the built-in fields; `suggest` maps a heading equal to a field name ignoring case, spaces and punctuation, before the built-in aliases (a people field "Source"); a custom field mapped from two columns → `import_one_column`; `readImportCell`: choices by name ignoring case, multiple split on `,`/`;`, yes/y/true/1 and no/n/false/0, money with or without £ and commas, dates `24/11/2026`, `24 Nov 2026`, `2026-11-24`, numbers; unreadable → left out and a warning `import_custom_unreadable` with field name, value and row list; text over 255 / long text over 10,000 → row refused with `import_too_long`
- [X] T036 [P] [US5] Integration tests in `tests/integration/imports-custom.test.ts` (`// covers FR-013, SC-007, US5 scenarios 1–5`): people and organisation imports with three custom columns import every readable value (1,000 rows); the report lists unreadable values with their row counts; a field deleted between preview and run is ignored and the report has `import_custom_field_gone`; imported records get only their "imported" timeline entry

### Implementation for User Story 5

- [X] T037 [US5] `src/server/imports/columns.ts`: `fieldsFor(kind, custom)`, `toField(kind, value, custom)` accepting `custom:<id>` of the given fields, `suggest(kind, headings, custom)`, `checkMapping` with custom fields one column each; `MappedColumn` keeps `customName`
- [X] T038 [US5] `readImportCell(field, cell)`, `parseImportDate`, `parseYesNo` in `src/server/custom-fields/rules.ts`; `src/server/imports/rows.ts` reads mapped custom cells (too long → row refused), `src/server/imports/plan.ts` carries values per add and adds warnings keyed by code + field + value (`Warning` gains `field?: string`), `src/server/imports/text.ts` renders them
- [X] T039 [US5] `src/server/imports/imports.ts`: load the kind's fields for columns and preview; in `runImport` read them `for share` inside the transaction, drop gone fields and record them in the report, bulk-insert values after the records; `src/app/(app)/records/import/ImportPages.tsx` shows custom targets (group "Custom fields"), preview values, warnings and the "field gone" line

**Checkpoint**: CSV imports fill custom fields.

---

## Phase 8: User Story 6 - Custom values follow the record's private rules (Priority: P1)

**Goal**: Prove no private record leaks through any custom-field path built in US1–US5.

**Independent Test**: As Ada Fake set "Diet: Vegan" on a person private to Ada; as Grace Fake (admin) filter by "Diet: Vegan": not listed or counted; the delete confirmation shows a number only.

### Tests for User Story 6 ⚠️

- [X] T040 [P] [US6] Integration tests in `tests/integration/custom-fields-private.test.ts` (`// covers FR-015, SC-004, US6 scenarios 1–3, edge case "hand-over"`): for a person private to Ada and a deal private to Linus, for Grace and Margaret: `readCustomValues` gives nothing; `listPeople` / `listDeals` with each custom filter, `empty`, and each custom sort never list or count them and the deal total excludes them; `customColumns` is only called with visible ids; `customFilterOptions` does not offer a removed choice used only by the hidden record; `updatePerson` / `updateDeal` on them → `not_found`, nothing changed; a person's and an organisation's timeline do not show the hidden deal's `custom_*` entries; the CSV preview and report name no hidden person; `countValues` counts them (number only); after `handOverPrivateRecords` the new owner reads the same values

### Implementation for User Story 6

- [X] T041 [US6] Fix every leak T040 finds in `src/server/custom-fields/values.ts`, `src/server/records/people.ts`, `src/server/deals/list.ts`, `src/server/deals/deals.ts` or `src/server/imports/imports.ts`, keeping all reads of `persons` through `visiblePerson()` and of `deals` through `visibleDeal()`

**Checkpoint**: Privacy holds across pages, forms, lists, filters, sorts, counts, import and direct requests.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T042 [P] Escape check: field names, choice names and values containing "<b>Fake</b>" come back as literal text from `listFields`, `readCustomValues`, `customColumns` and the timeline, and no `dangerouslySetInnerHTML` is used in `src/app/(app)/admin/custom-fields/` or the new `records/` components (`// covers edge case "markup"`)
- [X] T043 Write the fake data `src/seed/custom-fields.ts` per data-model.md § Fake data (nine "(fake)" fields across the three kinds, some shown in lists, "Pescatarian" removed but kept on one person, values on a few people and deals including a private person and a private deal, a `custom_set` timeline row per value inserted), idempotent (fields by `(kind, lower(name))`, choices by `(field_id, lower(name))`, values `on conflict do nothing`), registered `{ name: "custom-fields", run: seedCustomFields }` after `ambassadors` in `src/seed/index.ts`
- [X] T044 Extend `tests/integration/seed.test.ts` (`// covers FR-018`): every type present, at least one field in a list per kind, one removed choice still on a record, values on a private person and a private deal; a second run adds no row
- [X] T045 [P] Check the existing suites still pass with the new columns, kinds and form fields: `tests/integration/people.test.ts`, `organisations.test.ts`, `deals.test.ts`, `deals-list.test.ts`, `lists.test.ts`, `imports-people.test.ts`, `imports-organisations.test.ts`, `handover.test.ts`, `timeline-deal-entries.test.ts`
- [X] T046 Append to `docs/DECISIONS.md` the three choices people made in the spec, one line each: "- Custom fields use design B: a Custom fields admin page with a tab per kind and a table, the add and edit form and the delete confirmation in a box over the page; values in their own // MORE DETAILS section (SF-115)", "- An admin ticks \"Show in list\" on a custom field; it is the same for every user, at most 8 per list (SF-115)", "- A custom field's type cannot be changed: to change it, delete the field and add a new one (SF-115)", then the six choices the person confirmed on 2026-11-24, one line each: "- An archived person or deal keeps its custom values on its page, but its edit form hides them and a change to them is refused until it is restored (SF-115)", "- Renaming or deleting a custom field or a choice does not change earlier timeline entries: they keep the names of the time (SF-115)", "- A custom field's list filter offers the current choices, plus a removed choice only while a record the viewer can see still has it (SF-115)", "- A CSV import adds no timeline entry per custom value: an imported record gets only its \"imported\" entry (SF-115)", "- A CSV column heading that matches a custom field name is suggested for the custom field before a built-in field (SF-115)", "- The timeline kind check of each migration also lists the kinds of features planned at the same time (SF-115 lists SF-116's file_added and file_deleted), so whichever merges first drops none (SF-115)"; no "Departs from blueprint" line
- [X] T047 [P] Extend `tests/unit/decisions.test.ts` with an SF-115 block checking the three lines of T046
- [X] T048 [P] Update `AGENTS.md` § Layout: `src/server/custom-fields/` (`rules.ts` pure, `fields.ts` admin, `values.ts` record values, list parts, columns, options), `src/app/(app)/admin/custom-fields/`, `records/MoreDetails.tsx`, `records/CustomInputs.tsx`, `records/CustomFilters.tsx`, `src/seed/custom-fields.ts`
- [X] T049 [P] Extend `tests/unit/messages.test.ts` for the new codes and templates (every code used in `src/server/custom-fields/` exists in `messages.ts`)
- [X] T050 Run `npm run typecheck` and fix every error
- [X] T051 Run `npm test` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test` and fix every failure; keep the full failure output when reporting
- [X] T052 Walk through `quickstart.md` § Automated checks and confirm each listed test file exists and names what it covers
- [X] T053 Check `design-options.html` option B against the new admin page, boxes and "// MORE DETAILS" markup and CSS classes without starting a browser; fix differences in `src/app/(app)/admin/custom-fields/`, `src/app/(app)/records/` and `src/app/globals.css`
- [X] T054 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — keep Google Sign-In as it is and extend the Supabase Postgres line: no fake, a real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres, and the SF-115 code (`src/server/custom-fields/`, the value saves in `people.ts`, `organisations.ts`, `deals.ts` and `imports.ts`) keeps to the same pooler limits (no `set`/`listen`/session advisory lock, one `sql.begin()` per change) with its tables, columns and kinds from `migrations/0010_custom_fields.sql`, applied on a fresh database by `tests/integration/migrate.test.ts` — and `## Schemas` (each schema's GitHub URL at its commit: oauth2-api.json unchanged, nothing added); also describe the new fake custom fields in the seed line

---

## Fix round 1 (AI review)

- [ ] T055 Write the failing tests first. Unit, `tests/unit/list-query.test.ts` (`// covers SF-115 US3 scenario 3, FR-012`): `knownCustomQuery` keeps `cf<id>=empty` for a Text and a Long text field as text, keeps it for Single choice and Yes/No, and drops it for Number, Money, Date and Multiple choice. Integration, `tests/integration/custom-lists.test.ts`: with a Text field shown in the list and three people — text "Empty shell", text "Full", no value — the filter `empty` (and `EMPTY`) lists only "Empty shell"; a Single choice and a Yes/No filter `empty` still list only the person with no value. Unit, `tests/unit/custom-fields-rules.test.ts` (`// covers SF-115 US5 scenario 2`): replace the "AI, Cooking" → unreadable expectation: `readImportCell(topics, "AI, Cooking")` sets AI and reports "Cooking" as unknown; "Cooking; Baking" sets nothing and reports both; Single choice "Pescatarian" (removed) sets nothing and reports "Pescatarian". Integration, `tests/integration/imports-custom.test.ts`: a CSV with a Topics column, rows "AI, Nope" and "Nope; Hiring" imports AI on the first person and Hiring on the second, and the report has one warning `Topics: "Nope" is not one of its choices and was not set.` with both row numbers. These tests fail on the current code.
- [ ] T056 `src/server/custom-fields/values.ts` (`customListParts`) and `src/server/records/list-query.ts` (`knownCustomQuery`): read `"empty"` as "no value" only for Single choice and Yes/No; for Text and Long text it is the text to look for; for other types it is dropped. Update the comment above `knownCustomQuery`.
- [ ] T057 `src/server/custom-fields/rules.ts` (`readImportCell`): a choice cell returns the current choices it names (Multiple choice in choice order) and its unknown parts; `src/server/imports/rows.ts` (`customFromRow`) keeps the value and reports each unknown part on its own; `src/server/imports/plan.ts` adds the new warning `import_custom_choice_unknown` per unknown choice value; `src/server/messages.ts` adds `import_custom_choice_unknown: (field, value, rows) => `${field}: "${value}" is not one of its choices and was not set. ${rowsNote(rows)}``; `src/server/imports/text.ts` maps it. Number, Money, Date and Yes/No keep `import_custom_unreadable`.
- [ ] T058 Run `npm test && npm run typecheck`; all pass.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first (T002 needs its tables); T003, T004 in parallel.
- **Foundational (Phase 2)**: needs Phase 1; blocks every story. T005 before T006, T007 before T008; T009 before T010.
- **US1 (Phase 3)**: needs Phase 2. MVP (fields exist).
- **US2 (Phase 4)**: needs Phase 2; tests can insert fields directly, the page flow needs US1.
- **US3 (Phase 5)**: needs US2's `values.ts` and the `in_list` flag of US1.
- **US4 (Phase 6)**: needs US1 (page) and US2 (values to count).
- **US5 (Phase 7)**: needs Phase 2 and the value storage of US2; independent of US3/US4.
- **US6 (Phase 8)**: needs US2–US5 (it tests their reads).
- **Polish (Phase 9)**: after the stories; T054 is the last task.

### Within Each User Story

- Tests first, see them fail; domain code (`src/server/…`) before pages; a story is done at its checkpoint.

### Parallel Opportunities

- Phase 1: T003, T004.
- Phase 2: T005, T007, T012 beside T009–T011; T010 beside T011.
- US1: T014 beside T013; T019 beside T015–T018.
- US2: T020 beside T021.
- US3: T025, T026, T027.
- US4: T032.
- US5: T035, T036; US5 as a whole beside US3 and US4.
- Polish: T042, T045, T047, T048, T049.

---

## Parallel Example: User Story 3

```bash
Task: "Unit tests for cf<id> parsing and knownCustomQuery in tests/unit/list-query.test.ts"
Task: "Integration tests in tests/integration/custom-lists.test.ts"
Task: "Performance test tests/integration/custom-lists-performance.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1, then 2)

1. Phases 1–2, then US1: admins can define fields.
2. US2 right after: the fields become useful on records. Validate with T013, T014, T020 and the checkpoints.

### Incremental Delivery

1. US1 → US2 → US3 (lists) → US4 (delete) → US5 (import) → US6 (privacy checks across all of them) → Polish.
2. Each story adds value without breaking the earlier ones; run `npm test` at each checkpoint.

## Notes

- Choices made here without asking: the privacy story US6 (P1) comes last among the stories because it checks the reads US2–US5 build, while each of those already reads through `visiblePerson` / `visibleDeal`; the Supabase Postgres task (T013) sits in US1, the first story whose code writes the new tables; the seed is in the Polish phase because it needs every story's code; the test recipe T054 is the last task.
- No outside-service fake is added or extended: the only outside service is the database, tested for real.
