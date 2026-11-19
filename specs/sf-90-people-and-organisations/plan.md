# Implementation Plan: People and organisations

**Branch**: `factory/sf-90-people-and-organisations` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-90-people-and-organisations/spec.md`

## Summary

Add people and organisations to the CRM: two lists (design C: search + filter row above a Users-style
table, a preview drawer opened from the page address), one-column record pages (header, `// DETAILS`,
`// PEOPLE` for organisations, `// TIMELINE`), add/edit forms, archive/restore for everyone, delete for
admins, private people visible only to their creator, duplicate detection by email address, and an admin
page for lead sources and labels. Everything is plain SQL on the existing Postgres (one new migration),
domain code in `src/server/` (pure rules unit-tested, data functions integration-tested), thin server
pages, and three small client components (the two record forms, which need field-level errors without
losing typed values, and the organisation picker). One SQL visibility rule (`not private or created_by =
viewer`) is used by every query that reads people, so a private person cannot leak through lists, search,
counts, filters, organisation pages, timelines, drawers or duplicate messages. No new dependency.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions, `useActionState`), React 19.3, `postgres` 4.1 — all already in the repo. Nothing added (research.md §1).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). New migration `migrations/0002_people_organisations.sql`: `organisations`, `persons`, `person_emails`, `person_phones`, `lead_sources`, `labels`, `person_labels`, `timeline_events`; RLS enabled on each, no policies; the six starting lead sources inserted by the migration (data-model.md).

**Testing**: Vitest (unit: validation/normalisation, list-query parsing, change detection; integration against real Postgres: visibility, duplicates, concurrency, archive/delete, admin checks, seed), Playwright (the user stories through the fake Google login).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-002/SC-003: first list page < 2 s with 2,000 people and 500 organisations. One count query + one page query per list view, indexed foreign keys; a sequential `ilike` scan of 2,000 rows is a few milliseconds, so no trigram index or search engine (research.md §5).

**Constraints**: Private people never visible to anyone but their creator (FR-019, SC-005); email addresses unique across all people, enforced by the database (SC-004); every action checks the user first, delete and list changes check admin rights in the same transaction (SC-006); every message from `messages.ts`; list state in the page address (FR-014).

**Scale/Scope**: ≤ 10 users, ~2,000 people, ~500 organisations; 9 new screens (2 lists, 2 record pages, 4 forms, 1 admin page).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, so no
constitution gate can fail. The binding rules are `docs/DECISIONS.md` and `AGENTS.md`; the plan is checked
against them:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Lists, pages, drawer, filters, delete confirmation are server-rendered (plain links and GET forms). Client: `PersonForm`, `OrganisationForm`, `OrganisationPicker`, `AutoSubmit` (submits the filter form on change; a `[ APPLY ]` button works without JS) | ✅ |
| Every signed-in page calls `requireUser()`/`requireAdmin()`; every action `requireUser()`/`assertAdminForAction()` first | Listed per route in contracts/routes.md; domain functions re-check rights/visibility inside their transaction | ✅ |
| Messages only from `messages.ts`; never text from the URL | New codes in contracts/routes.md § Messages; `?error=`/`?notice=` take codes only; the deleted person's name comes from a server-set flash cookie, not the URL (research.md §8) | ✅ |
| Redirect targets through `isSafeNext` | Actions redirect to fixed paths built from numeric ids; any `returnTo` list address passes `isSafeNext(…, appBaseUrl())` | ✅ |
| Migrations: transaction-safe statements only, RLS after every `create table`, never at app start | `0002_people_organisations.sql`: plain DDL + inserts, `enable row level security` on all 8 tables; the existing RLS test covers them | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | New seeder `src/seed/people.ts` registered in `src/seed/index.ts` (the command is already gated); "Fakeco"-style names, `example.com`/`example.net` addresses, owners are the fake users | ✅ |
| Anyone archives a person/organisation; only an admin deletes (kickoff) | `archive`/`restore` for any user who can see the record; `delete*` via `assertAdminForAction()` + re-check in the transaction | ✅ |
| A private contact hides it from everyone but its creator, admins included (kickoff) | One visibility predicate in every people query, incl. org timeline events about a person and the duplicate message | ✅ |
| Pipedrive import links people by email, organisations by name (kickoff) | Unique `person_emails.email` (lowercase) and unique `lower(organisations.name)` give the import its match keys | ✅ |
| Users are deactivated, never deleted (SF-80) | Owner/creator/actor FKs to `users` without cascade; deactivated owners shown "(deactivated)" | ✅ |
| Design B shell, design C for these lists (spec Clarifications) | Pages inside `(app)`; sidebar entries via `nav.ts` | ✅ |
| Every outside service has a fake | No new outside service (only the existing Postgres) | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-90-people-and-organisations/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: tables, rules, visibility, state changes
├── quickstart.md        # Phase 1: how to validate end-to-end
├── contracts/
│   ├── routes.md        # Pages, query parameters, server actions, messages
│   └── list-query.md    # People/Organisations list address format, filters, sort, paging
├── dependencies.json    # Direct dependencies this change adds ([])
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0002_people_organisations.sql   # 8 tables, indexes, RLS, the six starting lead sources

src/
├── app/(app)/
│   ├── nav.ts                       # + People, Organisations (main); + Lead sources and labels (admin)
│   ├── people/
│   │   ├── page.tsx                 # list: search, filter row, table, paging, drawer (?open=)
│   │   ├── new/page.tsx             # add form
│   │   ├── [id]/page.tsx            # record page (header, // DETAILS, // TIMELINE, delete confirm)
│   │   ├── [id]/edit/page.tsx       # edit form
│   │   └── actions.ts               # createPerson, updatePerson, archive/restore/deletePerson
│   ├── organisations/
│   │   ├── page.tsx, new/page.tsx, [id]/page.tsx, [id]/edit/page.tsx
│   │   └── actions.ts               # createOrganisation, updateOrganisation, archive/restore/deleteOrganisation
│   ├── admin/lead-sources-and-labels/
│   │   ├── page.tsx                 # two lists, add field each, rename/remove per row
│   │   └── actions.ts               # add/rename/remove for lead sources and labels
│   └── records/                     # shared UI for both record types
│       ├── PersonForm.tsx           # 'use client' (useActionState, repeatable email/phone rows)
│       ├── OrganisationForm.tsx     # 'use client'
│       ├── OrganisationPicker.tsx   # 'use client' (filters an embedded list, "Add organisation 'X'")
│       ├── AutoSubmit.tsx           # 'use client' (submits the filter form on change)
│       ├── FilterRow.tsx, Pager.tsx, Drawer.tsx, Timeline.tsx, RecordHeader.tsx, DeleteConfirm.tsx
├── server/
│   ├── records/
│   │   ├── rules.ts                 # PURE: normalise/validate names, emails, phones, website, LinkedIn,
│   │   │                            #   sizes, list names; changedFields(); escapeLike()
│   │   ├── list-query.ts            # PURE: searchParams -> validated query (contracts/list-query.md)
│   │   ├── visibility.ts            # the one SQL fragment: visible people for a viewer
│   │   ├── people.ts                # list, get, create, update, archive, restore, delete, duplicate check
│   │   ├── organisations.ts         # list, get, create, update, archive, restore, delete, picker list
│   │   ├── choices.ts               # lead sources and labels: list, add, rename, remove (admin re-check)
│   │   ├── timeline.ts              # record events, read a record's timeline (visibility-filtered)
│   │   └── flash.ts                 # one-shot notice cookie ("Ada Example was deleted.")
│   ├── format.ts                    # + formatDate ("19 Nov 2026"), formatDateTime (existing format)
│   └── messages.ts                  # + new codes (contracts/routes.md § Messages)
├── seed/
│   ├── index.ts                     # + { name: "people", run: seedPeople }
│   └── people.ts                    # ≥ 30 fake people, ≥ 8 fake organisations, labels; idempotent
└── app/globals.css                  # + filter row, drawer, record page, badges, form rows

tests/
├── unit/                            # records/rules, list-query, changedFields, format
├── integration/                     # people, organisations, choices, visibility (SC-005), duplicates
│                                    #   (SC-004), admin checks (SC-006), concurrency, seed (SC-007), RLS
└── e2e/                             # US1–US6 through the fake Google login
```

**Structure Decision**: same single Next.js project. People and organisations share their domain code in
`src/server/records/` (pages stay thin, rules are tested without the UI) and their UI pieces in
`src/app/(app)/records/`. Later features (notes, emails, deals) add event kinds to `timeline_events` and
rows to the same timeline component.

Docs Build also updates: `docs/DECISIONS.md` gets the three choices from the spec's Clarifications (design
C for people/organisation lists and pages; hand-added people are Subscribed; only admins keep the lead
source and label lists) plus any factory choice the Plan Review confirms; README lists the new pages and
fake data.

## Fix round 1

AI review failed (2 must-fix, 3 minor).

**Problem 1 — address text shown on the Organisations list.** `/organisations?sector=<any text>` puts that
text into the Sector filter as an option and selects it, so text from the address shows on the page
(breaks FR-025, AGENTS.md, `contracts/list-query.md`: unknown values are ignored).
**Cause:** `src/app/(app)/organisations/page.tsx` appends an unknown `query.sector` to the sector options.
**Fix:** the page (or a pure helper next to `parseOrganisationsQuery`) matches `query.sector` against the
sectors in use (case-insensitive); an unknown value becomes `null` before it is used, both for the select
and for `listOrganisations` (an unknown sector filters nothing, it is not shown back). Remove the append.

**Problem 2 — the organisation picker drops typed text.** Typing a name in the person form's organisation
field clears the choice; unless an option is clicked, both hidden fields post empty, so the person is saved
with no organisation and no message (on edit, the existing link is silently removed). Enter picks the first
*partial* match, so a new name that starts like an existing one cannot be added from the keyboard.
**Cause:** `src/app/(app)/records/OrganisationPicker.tsx` only posts `newOrganisationName` after an explicit
"Add organisation" choice, and Enter takes `matches[0]`.
**Fix (what you see is what is saved):** when the text is not empty and no option is chosen, the picker
posts the existing non-archived organisation whose name matches exactly (case-insensitive, trimmed), else
posts the typed text as `newOrganisationName` and shows the hint "A new organisation "<text>" will be
added." The server already resolves `newOrganisationName` against all organisations (exact non-archived →
that organisation; exact archived → "<name> already exists." with a link, nothing saved; research.md §7),
so no server change is needed beyond keeping that. Enter picks only an exact match, else the typed text as
a new name; partial matches stay clickable/tabbable buttons. Empty text (or `[ CLEAR ]`) posts no
organisation.

**Minor (fixed in the same round):**
- `src/app/(app)/records/DeleteConfirm.tsx` hard-codes "Delete {name} for good? This can't be undone." and
  small labels: move them to `src/server/messages.ts` (`templates.delete_confirm(name)` and fixed messages).
- The "<name> was deleted." notice survives a reload (60 s cookie): `src/proxy.ts` deletes the `crm_flash`
  cookie on the response of the GET page load that carries it (the page still reads it from that request),
  so the notice shows once.
- Renaming a lead source or label to a removed entry's name shows "This name is already on the list.":
  `src/server/records/choices.ts` returns a new message `choice_removed_exists` ("A removed entry already has
  this name. Add it again to bring it back.") in that case; nothing is saved (adding keeps restoring it,
  Clarification Q4).

**Files:** `src/app/(app)/organisations/page.tsx`, `src/server/records/list-query.ts` (if the helper goes
there), `src/app/(app)/records/OrganisationPicker.tsx`, `src/app/(app)/records/DeleteConfirm.tsx`,
`src/server/messages.ts`, `src/proxy.ts`, `src/server/records/choices.ts`; tests in `tests/unit/list-query.test.ts`,
`tests/integration/choices.test.ts`, `tests/e2e/lists.spec.ts`, `tests/e2e/people.spec.ts`,
`tests/e2e/archive-delete.spec.ts`. No new dependency, no migration, no new outside service.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supabase and github.com/supabase/supavisor; the app speaks the standard Postgres protocol, the new code only adds tables to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: website and LinkedIn addresses are only shown as links; the server never fetches them.

## Complexity Tracking

No constitution violations to justify.
