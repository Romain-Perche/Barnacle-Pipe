# Implementation Plan: Ambassador tracking

**Branch**: `factory/sf-114-step-9-ambassador-tracking` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-114-step-9-ambassador-tracking/spec.md`

## Summary

An ambassador is a person with a new `is_ambassador` flag, set by an "Ambassador" tick on the person form. People and
deals get an optional `referred_by_id` (a person) and `referred_at`, chosen with a new `ReferrerPicker` on their forms
(pre-filled on the add deal form from the main person). Five new timeline event kinds record ticking, unticking and
referrer changes. A sidebar "Ambassadors" page lists the ambassadors the user can see with counts and totals, and
`/ambassadors/<personId>` (design B) shows the summary strip, people and deals referred, and "// LATEST UPDATES" (the
timeline entries of the ambassador and of what they referred, 20 at a time). Every count, list, picker and filter goes
through the existing `visiblePerson` / `visibleDeal` rules. One migration (`0008_ambassadors.sql`), one new domain file
(`src/server/records/ambassadors.ts`) plus pure rules, no new dependency, no new outside service.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions), React 19.3, `postgres` 4.1 — all already in the
repo. Nothing added (research.md §1).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). Migration
`migrations/0008_ambassadors.sql`: columns on `persons`, `deals`, `timeline_events`; new kinds and checks; no new table
(data-model.md).

**Testing**: Vitest only (unit: referral rules, `parseShownBy`, tags, list query, messages; integration on the real
local Postgres: ambassadors, referrals, ambassador page, privacy, delete, filters, hand-over, performance, migrate,
seed). No browser tests (DECISIONS 2026-11-23).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-003 — ambassador page with 200 referred records and 1,000 timeline entries < 2 s: six small
queries over partial indexes on `referred_by_id` and the existing timeline indexes (research.md §15).

**Constraints**: private ambassadors and referred records never shown, counted, offered or accepted for anyone the
rules hide them from (FR-013, SC-005); referrer re-checked inside every save transaction (SC-006); messages only from
`messages.ts`; names as text nodes only.

**Scale/Scope**: ≤ 10 users, tens of ambassadors, a few thousand records. 2 new pages, 7 changed screens (person
page and form, deal page, drawer and form, people list, deal list), the sidebar.

No NEEDS CLARIFICATION left: research.md resolves each open point; choices a person should confirm are in spec.md
§ Clarifications ("decided by the factory, to confirm").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail. The binding
rules are `docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Both new pages server-rendered. One new client component `ReferrerPicker` (type-to-find needs the browser); `PersonPicker` gets an optional `onChange`; `DealForm` / `PersonForm` are already client | ✅ |
| Every page `requireUser()`; every action `requireUser()` first; never rely on hidden links | New pages call `requireUser()`; existing actions unchanged in that respect; domain functions re-check visibility and "offered ambassador" in the transaction | ✅ |
| Messages from `messages.ts`; never text from the URL | contracts/routes.md § Messages; `people`/`deals`/`updates`/`ref` parsed to numbers and only select | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0008` has only `alter table` / `create index`; no new table | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/ambassadors.ts` in the gated seeder registry; "…fake" names, example.com addresses | ✅ |
| Ambassadors are contacts, not users: never sign in (kickoff) | A flag on `persons`; nothing touches `users` or sign-in | ✅ |
| Private contact or deal hidden from everyone but creator / owner, admins included (kickoff, SF-92, SF-93) | `visiblePerson` / `visibleDeal` on every new read, count, option and check; referral events naming a hidden person are dropped like other events about hidden people | ✅ |
| Events about a deleted person kept without the name; removed when the person was private (SF-92) | `deletePerson` writes "cleared (a deleted person)" or nothing, and removes `from_person_id` events of a private person (research.md §6) | ✅ |
| Hand-over carries private people and deals (SF-92, SF-97) | Unchanged; visibility follows the owner, test added | ✅ |
| Money in GBP only | `formatMoney` (pence) everywhere | ✅ |
| Anyone can archive; only admins delete | Unchanged; archived ambassadors listed but not offered | ✅ |
| Lists design C, timeline design B (SF-90, SF-102) | Ambassadors page = People-list table; latest updates = day groups and tags of `RecordTimeline` | ✅ |
| Every outside service has a fake | No new outside service (§ Outside services) | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-114-step-9-ambassador-tracking/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, state changes, validation, fake data
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
└── 0008_ambassadors.sql                 # data-model.md § Migration

src/
├── app/(app)/
│   ├── nav.ts                           # + Ambassadors after Organisations
│   ├── ambassadors/
│   │   ├── page.tsx                     # the Ambassadors page
│   │   └── [id]/
│   │       ├── page.tsx                 # the ambassador page (design B)
│   │       ├── LatestUpdates.tsx        # // LATEST UPDATES (server)
│   │       └── not-found.tsx
│   ├── records/
│   │   ├── ReferrerPicker.tsx           # client: "Referred by" picker
│   │   ├── ReferredBy.tsx               # server: "Referred by <link>" / private / —
│   │   ├── PersonForm.tsx               # + Ambassador tick, ReferrerPicker
│   │   ├── PersonPicker.tsx             # + optional onChange
│   │   ├── RecordTimeline.tsx           # export NoteText for LatestUpdates
│   │   └── Timeline.tsx                 # Line for the five new kinds
│   ├── people/[id]/page.tsx, people/page.tsx, people/actions.ts
│   └── deals/DealForm.tsx, DealDrawer.tsx, [id]/page.tsx, list/page.tsx, new/page.tsx, actions.ts
├── server/
│   ├── records/
│   │   ├── ambassadors.ts               # new: list, page, summary, updates, options, checks
│   │   ├── referral-rules.ts            # new, pure
│   │   ├── people.ts, timeline.ts, timeline-view.ts, list-query.ts, form-data.ts, rules.ts, notes-rules.ts
│   ├── deals/deals.ts, deals/list.ts, deals/rules.ts
│   └── messages.ts
├── seed/ambassadors.ts, seed/index.ts
└── app/globals.css                      # .badge.amb, .kd.person, summary strip reuse

tests/unit/, tests/integration/          # quickstart.md § Automated checks
```

**Structure Decision**: same single Next.js project. Ambassador code sits in `src/server/records/` beside people,
because an ambassador is a person and a referral is a field of people and deals; privacy stays in `visibility.ts`.

## Build steps (in order)

1. **Migration** `migrations/0008_ambassadors.sql` exactly as data-model.md (check the two constraint names first).
   No new table, so `tests/support/reset.ts` and `rls.test.ts` need nothing; `migrate.test.ts` covers 0008.
2. **Pure rules**: `referral-rules.ts` (`parseReferredBy`, `decideReferrer`, `referralEvent`), `parseShownBy` in
   `notes-rules.ts` (`parseShown` = `parseShownBy(v, 50)`), `EntryTag` + `"PERSON"` in `timeline-view.ts` (`entryTag`:
   `person` set → PERSON, `deal` set → DEAL), `ref` in `list-query.ts`, messages and templates (contracts/routes.md).
   `form-data.ts`: `ambassador` and `referredBy` on the person form, `referredBy` on the deal form.
3. **Timeline** (`timeline.ts`, `Timeline.tsx`): five kinds; `recordEvent({ fromPersonId })`; read `from_person_id`
   joined to `persons fp` with `(e.from_person_id is null or visiblePerson(fp))`; extract `selectEntries` (research.md
   §10) so `readTimeline` keeps its exact output and adds `person: null`. Lines as data-model.md § Timeline event; a
   referrer name links to `/ambassadors/<id>`.
4. **People** (`people.ts`): `getPerson` + `ambassador`, `referredBy` (via `referrerOf`); create / update per
   data-model.md § State changes, referrer error under `referredBy`; `deletePerson` clean-up (research.md §6);
   `listPeople` `ref`; `peopleFilterOptions` + `referrers`; `personFormChoices` + `ambassadors` (excluding the person).
5. **Deals** (`deals.ts`, `list.ts`, `rules.ts`): `getDeal` + `referredBy`; `dealFormChoices` + `ambassadors`,
   `people[].referredById` (only offered ones); create / update with the referrer rule and events; `listDeals` `ref`;
   `dealFilterOptions` + `referrers`; `knownDealsQuery` keeps a known `ref`.
6. **Ambassadors domain** (`ambassadors.ts`): functions in contracts/routes.md, SQL per data-model.md § Ambassador
   summary and research.md §7–§10, §13; one shared fragment for the summary so the list and the page agree.
7. **UI**: `ReferrerPicker` (research.md §12), `ReferredBy`, forms (Ambassador tick under Lead source; "Referred by"
   next to it), person page badge `<span className="badge amb">Ambassador</span>` + `[ AMBASSADOR PAGE ]`, deal page and
   drawer, list filters, `/ambassadors` and `/ambassadors/[id]` per `design-options.html` option B (summary strip as the
   deal page's, Won value `--green`, Lost `--red`; tables as the People list; latest updates in the `.daygroup` / `.kd`
   look, `.kd.person` coloured like `.kd.deal`), nav entry. `DealForm`: referrer state, pre-fill on add when the main
   person changes.
8. **Fake data**: `src/seed/ambassadors.ts` (data-model.md § Fake data), registered after `notes` in `src/seed/index.ts`.
9. **Docs**: append to `docs/DECISIONS.md` the two choices people made in the spec, one line each:
   "An ambassador is a person with the Ambassador tick on their form; only ticked people can be chosen as Referred by
   (SF-114)" and "The ambassador page uses design B: its own one-column page with [ PERSON PAGE ], a summary strip,
   people referred, deals referred, then latest updates grouped by day (SF-114)". The factory's choices (spec
   Clarifications "to confirm") are not added until a person confirms them. No blueprint exception (no blueprint index
   in this run), so no "Departs from blueprint" line. Update `AGENTS.md` § Layout with `ambassadors.ts`,
   `referral-rules.ts`, `ReferrerPicker.tsx`, `ReferredBy.tsx`, `/ambassadors`.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93 and SF-102: only an OpenAPI file for Supavisor's own management API; the app speaks the standard Postgres protocol, this change only adds columns to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: ambassadors, referrals and their pages run in the app and its database.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
