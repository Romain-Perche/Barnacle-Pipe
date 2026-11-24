# Implementation Plan: Custom fields

**Branch**: `factory/sf-115-step-7-custom-fields` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-115-step-7-custom-fields/spec.md`

## Summary

Admins define custom fields per record kind (person, organisation, deal) on a new `/admin/custom-fields` page (design B:
a tab per kind, a table, the add/edit form and the delete confirmation in a box over the page). Three new tables hold
fields, choices and typed values (one row per field and record). Values are filled in under "// MORE DETAILS" on the
add and edit forms, shown in a "// MORE DETAILS" section of record pages and the deal drawer, and every change writes a
CHANGE timeline entry carrying the field name and values as text of the time. Fields marked "Show in list" (max 8) add
columns, sorts and filters to the People, Organisations and Deals lists through `cf<id>` address parameters checked
against the kind's shown fields. The CSV import maps columns to custom fields. Values are reached only through their
record, so `visiblePerson` / `visibleDeal` keep private records hidden everywhere. One migration
(`0010_custom_fields.sql`), a new domain folder `src/server/custom-fields/`, no new dependency, no new outside service.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions), React 19.3, `postgres` 4.1 — all already in the
repo. Nothing added (research.md §1).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). Migration
`migrations/0010_custom_fields.sql`: tables `custom_fields`, `custom_field_choices`, `custom_values`; columns
`field_name`, `old_value`, `new_value` and kinds `custom_set` / `custom_changed` / `custom_cleared` on `timeline_events`
(data-model.md).

**Testing**: Vitest only — unit (pure rules, list query, import columns/rows/plan, messages, nav) and integration on the
real local Postgres (admin, values, lists, privacy, delete, import, performance, migrate, RLS, seed). No browser tests
(DECISIONS 2026-11-23). quickstart.md lists the files.

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-003 — People list of 5,000 with 8 custom columns and a custom filter, first page < 2 s:
`exists` probes and an optional sort join on `(field_id, <target>)` unique indexes, columns read for the ≤ 50 shown ids in
one query (research.md §11).

**Constraints**: private records' values never shown, matched, sorted, counted or accepted for anyone the rules hide them
from (FR-015, SC-004); admin re-checked in every admin transaction (FR-014); messages only from `messages.ts`, names as
text nodes; unknown or invalid `cf…` address parts ignored (FR-012).

**Scale/Scope**: ≤ 10 users, a few thousand records, ≤ 50 fields per kind. 1 new admin page with 3 boxes; 3 record
pages, the deal drawer, 3 forms, 3 lists and the 2 import flows changed; the sidebar.

No NEEDS CLARIFICATION left: research.md resolves each open point; the choices a person should confirm are in spec.md
§ Clarifications ("decided by the factory, to confirm").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail. The binding
rules are `docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Pages, record sections, filters, choice rows, delete box: server. Client: `FieldBox.tsx` (shows the choices textarea by type, `useActionState`); `CustomInputs.tsx` is rendered inside the existing client forms with no state of its own | ✅ |
| Every signed-in page `requireUser()` / `requireAdmin()`; every action `requireUser()` / `assertAdminForAction()` first; never rely on hidden links | Admin page `requireAdmin()`; admin actions `assertAdminForAction()`; `fields.ts` re-checks `isActiveAdmin` in each transaction (FR-014) | ✅ |
| Messages from `messages.ts`; never text from the URL; redirects via `isSafeNext` | contracts/routes.md § Messages; `kind`, `field`, `delete`, `error`, `cf…` parsed to fixed words / ids / numbers; deleted name via the flash cookie; admin redirects are fixed paths | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0010` only `create table` / `create index` / `alter table`; RLS on all three tables | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/custom-fields.ts` in the gated registry, "(fake)" field names | ✅ |
| Private contact or deal hidden from everyone but creator / owner, admins included (kickoff, SF-92, SF-93) | Values only read joined to a visible record; filters and sorts inside the list's visible `where`; filter options only from visible records; delete count is a number only (FR-004 says hidden records count) | ✅ |
| Only admins manage lists of choices (SF-90, SF-93 pattern) | Fields and choices admin-only; filling values open to anyone who can edit the record | ✅ |
| Removed label stays on records and filters, not offered (SF-95) | Same for removed choices (research.md §4) | ✅ |
| Money in GBP only | Money type = pence, `parseMoney` / `formatMoney`; never added to deal totals | ✅ |
| Anyone can archive; only admins delete | Unchanged; record delete cascades its values | ✅ |
| Lists design C, timeline design B, deal page design C | Columns and filters in the existing filter row and table; CHANGE entries in the existing day groups; "// MORE DETAILS" in the `// DETAILS` look | ✅ |
| CSV import design B (SF-103); duplicates rule unchanged | Custom fields only add targets, warnings and values | ✅ |
| Hand-over carries private people and deals (SF-92, SF-97) | Values follow the record; test added | ✅ |
| Every outside service has a fake | No new outside service (§ Outside services) | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-115-step-7-custom-fields/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, state changes, lists, fake data
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   └── routes.md        # Pages, query parameters, actions, domain functions, messages
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0010_custom_fields.sql                     # data-model.md § Migration

src/
├── server/
│   ├── custom-fields/                          # new
│   │   ├── rules.ts                            # pure: names, types, values, formats, import cells, events
│   │   ├── fields.ts                           # admin: fields and choices, counts
│   │   └── values.ts                           # record values: read, save (+ timeline), list parts, columns, options
│   ├── records/
│   │   ├── people.ts, organisations.ts         # get/create/update call values.ts; lists use customListParts
│   │   ├── list-query.ts                       # custom, cf<id> sorts, knownCustomQuery, withParams, hasFilters
│   │   ├── form-data.ts, rules.ts              # `custom` on the three forms
│   │   ├── timeline.ts                         # 3 kinds, fieldName / oldValue / newValue
│   │   └── flash.ts                            # custom_field_deleted
│   ├── deals/deals.ts, deals/list.ts, deals/rules.ts
│   ├── imports/columns.ts, rows.ts, plan.ts, imports.ts, text.ts
│   └── messages.ts
├── app/(app)/
│   ├── nav.ts                                  # + Custom fields (last admin entry)
│   ├── admin/custom-fields/                    # new
│   │   ├── page.tsx, actions.ts
│   │   ├── FieldBox.tsx                        # client: add / edit box
│   │   ├── ChoiceRows.tsx                      # server: choice forms in the edit box
│   │   └── FieldDeleteConfirm.tsx              # server
│   ├── records/
│   │   ├── MoreDetails.tsx                     # new: // MORE DETAILS on pages and the drawer
│   │   ├── CustomInputs.tsx                    # new: inputs in the forms
│   │   ├── CustomFilters.tsx                   # new: list filter controls
│   │   ├── PersonForm.tsx, OrganisationForm.tsx, Timeline.tsx, ListBits.tsx
│   │   └── import/ImportPages.tsx
│   ├── people/, organisations/, deals/ (pages, [id] pages, edit/new pages, list, DealDrawer, DealForm, actions)
├── seed/custom-fields.ts, seed/index.ts
└── app/globals.css                             # tabs, pre-wrap value, filter range inputs (existing tokens only)

tests/support/reset.ts                          # truncate the 3 new tables
tests/unit/, tests/integration/                 # quickstart.md § Automated checks
```

**Structure Decision**: same single Next.js project. Custom fields get their own domain folder
`src/server/custom-fields/` (like `deals/` and `activities/`), since they span all three record kinds; privacy stays in
`records/visibility.ts`, used by `values.ts`.

## Build steps (in order)

1. **Migration** `migrations/0010_custom_fields.sql` exactly as data-model.md (check the kind list against 0009 first).
   `tests/support/reset.ts` truncates `custom_values, custom_field_choices, custom_fields`.
2. **Pure rules** `src/server/custom-fields/rules.ts` (contracts/routes.md § Domain functions); messages and templates;
   `formatNumber` / `formatDay` there (or `format.ts` if shared). Reuse `parseMoney`, `parseDate`, `escapeLike`.
3. **Admin domain** `fields.ts`: transactions as `choices.ts` / `pipelines.ts` (`isActiveAdmin`, `for update` of the kind's
   rows, renumber 1..n), limits 50 / 100 / 8, built-in names, delete by cascade, `countValues`.
4. **Admin page** `/admin/custom-fields` (design B, `design-options.html` option B): tabs, table, `FieldBox`,
   `ChoiceRows`, `FieldDeleteConfirm`, actions, flash `custom_field_deleted`; `nav.ts` entry last in `adminNav`.
5. **Values** `values.ts`: `formFields`, `readCustomValues` (visibility in the same query), `saveCustomValues` (fields
   `for share`, `cfShown`, validate, archived rule, upsert/delete, timeline rows). Call it from `createPerson` /
   `updatePerson`, `createOrganisation` / `updateOrganisation`, `createDeal` / `updateDeal` inside their transactions,
   after the record is locked; errors through the existing `refuse(...)`.
6. **Timeline**: `recordEvent` + `selectEntries` read/write `field_name`, `old_value`, `new_value`; `Timeline.tsx` lines
   for the three kinds (templates, text nodes).
7. **Forms and pages**: `form-data.ts` reads `custom`; `CustomInputs` in `PersonForm`, `OrganisationForm`, `DealForm`
   (hidden on an archived record), values kept on refusal; `MoreDetails` on the person, organisation and deal pages and
   in `DealDrawer`.
8. **Lists**: `list-query.ts` (`custom`, `cf<id>` sort, `knownCustomQuery`, `withParams`, `hasFilters`,
   `hasDealFilters`); `listPeople`, `listOrganisations`, `listDeals` take the shown fields and add `customListParts`;
   columns via `customColumns`; filter controls via `CustomFilters` and `customFilterOptions`; the deal list's count and
   total use the same `where`.
9. **CSV import**: `columns.ts` (`custom:<id>` targets, suggestions, one column each), `rows.ts` (`readImportCell`),
   `plan.ts` (values per add, `import_custom_unreadable` warnings with field name), `imports.ts` (load fields; `for
   share` in `runImport`; gone fields in the report; bulk insert of values), `text.ts`, `ImportPages.tsx`.
10. **Fake data** `src/seed/custom-fields.ts` (data-model.md § Fake data), registered after `ambassadors`.
11. **Docs**: append to `docs/DECISIONS.md` the choices people made in the spec, one line each:
    "Custom fields use design B: a Custom fields admin page with a tab per kind and a table, the add and edit form and the
    delete confirmation in a box over the page; values in their own // MORE DETAILS section (SF-115)",
    "An admin ticks "Show in list" on a custom field; it is the same for every user, at most 8 per list (SF-115)" and
    "A custom field's type cannot be changed: to change it, delete the field and add a new one (SF-115)". The factory's
    choices (spec Clarifications "to confirm") are not added until a person confirms them. No blueprint exception (no
    blueprint index in this run), so no "Departs from blueprint" line. Update `AGENTS.md` § Layout with
    `src/server/custom-fields/`, `admin/custom-fields/`, `MoreDetails.tsx`, `CustomInputs.tsx`, `CustomFilters.tsx`.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93 and SF-102: only an OpenAPI file for Supavisor's own management API; the app speaks the standard Postgres protocol, this change only adds tables and columns to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: custom fields, values, lists and the CSV import run in the app and its database.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
