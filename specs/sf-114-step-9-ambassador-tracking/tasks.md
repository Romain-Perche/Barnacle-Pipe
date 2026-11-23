---

description: "Task list for SF-114 Ambassador tracking"
---

# Tasks: Ambassador tracking

**Input**: Design documents from `/specs/sf-114-step-9-ambassador-tracking/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-003 to SC-006): Vitest unit tests and Vitest integration tests against a real local Postgres (`crm_test`). No browser tests (docs/DECISIONS.md, 2026-11-23): never start the app in a browser. Each test file names what it covers (`// covers FR-005, US2 scenario 4`). Write each story's tests first and see them fail before the code.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. The migration, entities, state changes, validation and fake data are in `data-model.md`; pages, parameters, actions and domain functions in `contracts/routes.md`; decisions in `research.md` (§n below). No new dependency (`dependencies.json` is `[]`): do not add any package. No blueprint applies (`blueprints.json` is `[]`, no blueprint index in this run), so there are no blueprint tasks and no `Departs from blueprint` line. The choices "decided by the factory, to confirm" in spec.md § Clarifications are built as written there. The only outside service is Supabase Postgres (no public schema on GitHub): its task is T012, the recipe T055. Fake users: Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users), Alan Fake (deactivated); where the spec says "Bob Fake (an admin)", use Grace Fake.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)

---

## Phase 1: Setup

**Purpose**: The schema and the pure building blocks every story uses.

- [x] T001 Write `migrations/0008_ambassadors.sql` exactly as data-model.md § Migration: `persons.is_ambassador boolean not null default false`, `persons.referred_by_id bigint null references persons (id) on delete set null`, `persons.referred_at timestamptz null`, `constraint persons_referrer_not_self check (referred_by_id <> id)`, partial indexes `persons_referred_by_idx` (`where referred_by_id is not null`) and `persons_ambassador_idx` (`where is_ambassador`); `deals.referred_by_id` (same FK) and `deals.referred_at`, `deals_referred_by_idx`; `timeline_events.from_person_id bigint null references persons (id) on delete set null` with `timeline_events_from_person_idx`; replace `timeline_events_kind_check` keeping every kind of 0007 (including `'imported'`) plus `'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared'`; add `timeline_events_from_person_check check (from_person_id is null or kind = 'referrer_changed')`; replace `timeline_events_cause_check` with `cause in ('stage_deleted', 'pipeline_deleted', 'person_deleted')`. First confirm both constraint names with `\d timeline_events` on a migrated database. Only `alter table` / `create index`: no `begin`/`commit`/`concurrently`, no new table (so no RLS line), no check tying `referred_at` to `referred_by_id`
- [x] T002 [P] Add the messages and templates of contracts/routes.md § Messages to `src/server/messages.ts` under an `// SF-114` comment: codes `ambassadors_empty`, `ambassador_not_found`, `referrer_self`, `referrer_invalid`, `no_people_referred`, `no_deals_referred`, `no_longer_ambassador`, `referred_by_private`, `referrer_cleared_deleted`; templates `referred_by(name)`, `referrer_set_event(name)`, `referrer_changed_event(from, to)`; add the field-error codes `referrer_self` and `referrer_invalid` wherever `FieldError` maps codes to messages
- [x] T003 [P] Create the pure `src/server/records/referral-rules.ts` per data-model.md § Validation: `parseReferredBy(raw)` (`""` → `{ id: null }`, `"keep"` → `{ keep: true }`, a positive id via `toId` → `{ id }`, else `{ invalid: true }`); `decideReferrer(requested, currentId, selfId)` → `keep` (keep, or id equals current), `none`, `check` (id), `refuse` (`referrer_self` when id equals selfId, `referrer_invalid` when invalid); `referralEvent(beforeId, afterId)` → `null` / `referrer_set` / `referrer_changed` / `referrer_cleared`
- [x] T004 [P] Add `parseShownBy(value, step)` to `src/server/records/notes-rules.ts` (multiples of `step` from `step` to 5000, else `step`) and make `parseShown(v)` return `parseShownBy(v, 50)` with unchanged results

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Timeline kinds, form fields and the visibility-checked lookups that every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 [P] Unit tests in `tests/unit/referral-rules.test.ts` for every branch of `parseReferredBy`, `decideReferrer` and `referralEvent` (`// covers FR-005, FR-006, US2 scenarios 4, 5, 7`), and in `tests/unit/notes-rules.test.ts` for `parseShownBy(v, 20)` (`"40"` → 40, `"30"` → 20, `"0"`, `"abc"`, `"5020"` → 20) and that `parseShown` is unchanged (`// covers FR-009, FR-010`)
- [x] T006 Extend `src/server/records/timeline.ts`: `EventKind` + the five new kinds; `recordEvent` accepts `fromPersonId` (written to `from_person_id`); `TimelineEvent` gains `fromPerson: { id; name } | null`; join `persons fp on fp.id = e.from_person_id` and add `and (e.from_person_id is null or ${visiblePerson(sql, viewerId, "fp")})` beside the existing related-person filter (research.md §5); extract an internal `selectEntries(viewerId, where, limit, own)` used by `readTimeline` (same output as today) and later by `readAmbassadorUpdates`; `TimelineEntry` gains `person: { id: number; name: string; archived: boolean } | null` (always `null` from `readTimeline`)
- [x] T007 [P] `src/server/records/timeline-view.ts`: `EntryTag` + `"PERSON"`; `entryTag` returns `"PERSON"` when `person` is set, `"DEAL"` when `deal` is set, else NOTE / CHANGE; extend `tests/unit/timeline-view.test.ts` (`// covers US3 scenario 4`)
- [x] T008 `src/app/(app)/records/Timeline.tsx` `Line` for the new kinds (data-model.md § Timeline event): "Made an ambassador by <user>", "No longer an ambassador by <user>", `templates.referrer_set_event`, `templates.referrer_changed_event`, "Referred by cleared by <user>", `messages.referrer_cleared_deleted` + " by <user>" when `cause === "person_deleted"`; a person removed later reads "a deleted person"; each name a text node inside `<Link href="/ambassadors/<id>">`
- [x] T009 [P] Form data and types: `PersonForm` gains `ambassador: boolean` and `referredBy: string`, `PersonFields` gains `ambassador` and `referredById` in `src/server/records/rules.ts` (not added to `PERSON_FIELDS`); `DealForm` gains `referredBy: string`, `DealFields` gains `referredById` in `src/server/deals/rules.ts` (not in `DEAL_FIELDS`); `personFormFromData` / `dealFormFromData` in `src/server/records/form-data.ts` read the checkbox `ambassador` (`"on"`) and `referredBy`; extend `tests/unit/form-data.test.ts`
- [x] T010 Create `src/server/records/ambassadors.ts` with the lookups used by the forms: `type Referrer = { id: number; name: string; ambassadorPage: boolean } | "hidden" | null`; `referrerOf(db, viewerId, referredById)` (`"hidden"` when the person exists but `visiblePerson` is false for the viewer; `ambassadorPage` per research.md §7); `ambassadorOptions(db, viewerId, excludeId?)` = persons with `is_ambassador and archived_at is null and visiblePerson`, ordered by name, id, each `{ id, name, detail }` with `detail` = "<organisation> · <first email>" (parts omitted when missing); `isOfferedAmbassador(db, actorId, id)` with the same rule
- [x] T011 Create the client `src/app/(app)/records/ReferrerPicker.tsx` built like `PersonPicker.tsx` (research.md §12): type to filter options by name, up to 8 matches each showing name and `detail`, `[ CLEAR ]`; props `options`, `current` (`{ id, name } | "hidden" | null`, shown even when not among the options; `"hidden"` shows `messages.referred_by_private`), `initialId` or controlled `value` / `onChange`; posts hidden `referredBy` = `""`, the id, or `"keep"` while a hidden current referrer is untouched; `aria-label="Referred by"`; and the server `src/app/(app)/records/ReferredBy.tsx` that renders a `Referrer` as a link to `/ambassadors/<id>` (or `/people/<id>` when `ambassadorPage` is false), `messages.referred_by_private`, or "—"

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Mark a person as an ambassador (Priority: P1) 🎯 MVP

**Goal**: The "Ambassador" tick, its timeline lines, the badge and the Ambassadors page.

**Independent Test**: Tick "Ambassador" on a person, save; the person page shows the badge and `[ AMBASSADOR PAGE ]`, the timeline says "Made an ambassador by …", `/ambassadors` lists them; untick → gone from the list and pickers.

### Tests for User Story 1 ⚠️

- [x] T012 [US1] Supabase Postgres has no public schema on GitHub, so there is no fake to check against a schema: the tests use a real local PostgreSQL 17, and the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler). It copies its limits: no prepared statements (`prepare: false`, unchanged in `src/server/db.ts`), no session state (no `set`, `listen` or session advisory lock), every multi-statement change in one `sql.begin()` transaction, at most 5 connections (`max: 5`). Extend `tests/integration/migrate.test.ts` so it also scans `src/server/records/ambassadors.ts` for `set `/`listen`/`pg_advisory_lock` and fails on any, checks `migrations/0008_ambassadors.sql` has no `begin`/`commit`/`concurrently`/`vacuum`, applies it on a fresh database, and checks Postgres's own 23514 refusals: a person referred by themselves, a `referrer_set` event with a `from_person_id`, a `cause = 'person_deleted'` accepted and `'other'` refused, the kind check still accepting `'note'` and `'imported'`
- [x] T013 [P] [US1] Integration tests in `tests/integration/ambassadors.test.ts` (`// covers FR-001, FR-002, FR-003, US1 scenarios 1–5`): tick on add and on edit sets `is_ambassador` and writes `ambassador_added`; untick writes `ambassador_removed`, leaves the person's and deal's `referred_by_id` in place, removes them from `listAmbassadors` and `ambassadorOptions`; `listAmbassadors` returns name, organisation, counts, open and won totals, latest referral, archived ambassadors included and marked, ordered by name; an archived ambassador is not in `ambassadorOptions` until restored; ticking changes nothing else (private, owner, consent, lead source unchanged)

### Implementation for User Story 1

- [x] T014 [US1] `src/server/records/people.ts`: `getPerson` returns `ambassador` and `referredBy` (via `referrerOf`); `createPerson` inserts `is_ambassador` and writes `ambassador_added` when ticked; `updatePerson` sets it and writes `ambassador_added` / `ambassador_removed` when it changes (data-model.md § State changes); `personToForm` fills `ambassador`
- [x] T015 [US1] `listAmbassadors(viewerId)` in `src/server/records/ambassadors.ts`: visible persons with `is_ambassador` (archived included), each with the summary of data-model.md § Ambassador summary computed through one shared fragment `summaryFragments(db, viewerId, ambassadorAlias)` (people count, deals count, open and won totals, lost count, latest referral = `greatest(max(r.referred_at), max(d.referred_at))` over visible referred records, archived ones included), ordered by `lower(name), id`
- [x] T016 [US1] Person form `src/app/(app)/records/PersonForm.tsx`: an "Ambassador" checkbox under Lead source (`name="ambassador"`); person page `src/app/(app)/people/[id]/page.tsx`: `<span className="badge amb">Ambassador</span>` next to the name and `[ AMBASSADOR PAGE ]` → `/ambassadors/<id>` when `person.ambassador` (pass through `RecordHeader` or beside it)
- [x] T017 [US1] The Ambassadors page `src/app/(app)/ambassadors/page.tsx`: `requireUser()`, `// CONTACTS` label, h1 "Ambassadors", design C table like the People list (`ListBits` cells): Name (link `/ambassadors/<id>`, "Archived" badge), Organisation, People, Deals, Open (`formatMoney`), Won (`formatMoney`), Latest referral (`formatDate` or "—"); empty: `messages.ambassadors_empty`; add `{ href: "/ambassadors", label: "Ambassadors" }` after Organisations in `src/app/(app)/nav.ts`
- [x] T018 [P] [US1] CSS in `src/app/globals.css`: `.badge.amb` (per `design-options.html` option B), `.kd.person` coloured like `.kd.deal`

**Checkpoint**: Ambassadors can be marked, listed and unmarked.

---

## Phase 4: User Story 2 - Record who referred a person or a deal (Priority: P1)

**Goal**: "Referred by" on person and deal forms, pages and the drawer, with timeline lines and the add-deal pre-fill.

**Independent Test**: Set "Referred by: Cara Example" on a person and a deal; both pages show "Referred by Cara Example", both timelines record it, self and non-ambassador requests are refused with nothing saved.

### Tests for User Story 2 ⚠️

- [x] T019 [P] [US2] Integration tests in `tests/integration/referrals.test.ts` (`// covers FR-004–FR-007, SC-006, US2 scenarios 1–7`): set / change / clear on a person and on a deal write `referrer_set` (`related_person_id` new), `referrer_changed` (`from_person_id` old, `related_person_id` new), `referrer_cleared`, with the actor, and set / null `referred_at`; on add, a referrer writes `referrer_set`; a person as their own referrer → `referredBy` error `referrer_self`, nothing saved (version unchanged, no event); a non-ambassador, an archived ambassador, a private ambassador hidden from the actor, an unknown id and `"abc"` → `referrer_invalid`, nothing saved; an unchanged referrer who has since been unticked or archived is kept on save, and so is `"keep"`; `ambassadorOptions` on a person's form leaves the person out; `dealFormChoices` returns `ambassadors` and `people[].referredById` only when that referrer is offered; updating a deal whose main person changes never changes its referrer
- [x] T020 [P] [US2] Extend `tests/integration/timeline-deal-entries.test.ts` or add `tests/integration/referral-timeline.test.ts`: `readTimeline` returns the new kinds with `relatedPerson` / `fromPerson`, and drops a referral event naming a private person hidden from the viewer (`// covers FR-006, FR-013`)

### Implementation for User Story 2

- [x] T021 [US2] `createPerson` / `updatePerson` in `src/server/records/people.ts`: `parseReferredBy` + `decideReferrer(requested, current, id)` + `isOfferedAmbassador` inside the transaction; refusal → `Refused({ referredBy: { code } })`; write `referred_by_id` and `referred_at` (`now()` when changed to a person, `null` when cleared, unchanged otherwise); write the event from `referralEvent` with `relatedPersonId` / `fromPersonId`; `personFormChoices` returns `ambassadors` (excluding the person) and `personToForm` fills `referredBy`
- [x] T022 [US2] `src/server/deals/deals.ts`: `getDeal` returns `referredBy`; `dealFormChoices` returns `ambassadors` and, on each `people` entry, `referredById` only when that referrer is among the offered ambassadors; `dealToForm` fills `referredBy`; `createDeal` / `updateDeal` apply the same referrer rule without the self check, write `referred_by_id` / `referred_at` and the referral event on the deal
- [x] T023 [US2] Person form `src/app/(app)/records/PersonForm.tsx`: "Referred by" `ReferrerPicker` with `options` = `choices.ambassadors`, `current` from the person, error under it (`FieldError` for `errors.referredBy`); person page `src/app/(app)/people/[id]/page.tsx`: a "Referred by" detail rendered by `ReferredBy`; `src/app/(app)/people/new/page.tsx` initial `ambassador: false, referredBy: ""`
- [x] T024 [US2] `src/app/(app)/records/PersonPicker.tsx`: optional `onChange(personId: number | null)` called when the linked person changes; `src/app/(app)/deals/DealForm.tsx`: a controlled `ReferrerPicker` (state from `initial.referredBy`), and on add only (`withStage`) set it from the newly linked main person's `referredById` (research.md §11), changeable before saving; `src/app/(app)/deals/new/page.tsx` initial `referredBy: ""`
- [x] T025 [US2] "Referred by" via `ReferredBy` on the deal page `src/app/(app)/deals/[id]/page.tsx` and in the drawer `src/app/(app)/deals/DealDrawer.tsx`

**Checkpoint**: Referrals can be set, changed, cleared and shown everywhere.

---

## Phase 5: User Story 3 - The ambassador page (Priority: P1)

**Goal**: `/ambassadors/<id>`: header, details, summary strip, people and deals referred, latest updates.

**Independent Test**: For an ambassador with three people and two deals referred (one open, one won), the page shows the counts, totals, both lists, and a note just added on a referred deal first under latest updates.

### Tests for User Story 3 ⚠️

- [x] T026 [P] [US3] Integration tests in `tests/integration/ambassador-page.test.ts` (`// covers FR-008–FR-010, SC-004, US3 scenarios 1–7, edge cases`): `getAmbassadorPage` summary (people, deals, open £, won £, lost) with archived referred records counted, a null value adding 0, a lost deal only in Lost, a won-then-reopened deal back in Open; an ambassador who referred a deal and its main person counts 1 and 1; a referred ambassador's own referrals not listed under the referrer; people newest first by `created_at desc, id desc`; deals open first then by newest timeline event, then `id desc`; 50 rows then `more`, 100 rows with no repeat or skip; a deleted referred record leaves the lists and totals; `null` for a person who is not and never was an ambassador and has no referrals; a former ambassador with referrals returns `former: true`
- [x] T027 [P] [US3] Integration tests in `tests/integration/ambassador-updates.test.ts` (`// covers FR-009, US3 scenarios 4–6`): `readAmbassadorUpdates` merges the ambassador's own entries and those of referred people (`person` set) and deals (`deal` set), newest first, each once; entries of deals the ambassador is only linked to as contact are not included; 20 then `more`, 40 without repeat or skip; notes carry their segments; with nothing referred only the ambassador's own entries
- [x] T028 [P] [US3] Performance test `tests/integration/ambassador-performance.test.ts` (`// covers SC-003`): 200 referred records and 1,000 timeline entries; `getAmbassadorPage` + `readAmbassadorUpdates` together under 2 s, built like `timeline-performance.test.ts`

### Implementation for User Story 3

- [x] T029 [US3] `getAmbassadorPage(viewerId, id, shown)` in `src/server/records/ambassadors.ts` (research.md §7–§9): `getPerson` for the viewer; `null` unless `is_ambassador` or at least one visible referred person or deal; `former = !is_ambassador`; summary through `summaryFragments`; people referred (name, organisation, owner, `created_at`, archived) and deals referred (title, pipeline · stage, value, status, owner, archived) through `visiblePerson` / `visibleDeal`, `limit shown + 1`
- [x] T030 [US3] `readAmbassadorUpdates(viewerId, id, limit)` in `src/server/records/ambassadors.ts` via `selectEntries` (research.md §10): `e.person_id = $id or e.person_id in (visible referred people) or e.deal_id in (visible referred deals)`, `order by e.created_at desc, e.id desc`, `limit + 1`; `person` set for entries of a referred person, `deal` for those of a referred deal
- [x] T031 [US3] Export `NoteText` from `src/app/(app)/records/RecordTimeline.tsx` and create the server `src/app/(app)/ambassadors/[id]/LatestUpdates.tsx`: `// LATEST UPDATES`, `groupByDay`, a `.kd` tag per `entryTag`, the record name linking to `/people/<id>` or `/deals/<id>` with "Archived", note text (read-only, no edit or delete) or `Line`, `formatTime`; `[ SHOW MORE ]` → `?updates=<n+20>` keeping `people` and `deals`, anchor `#entry-<last id>`, `scroll={false}`
- [x] T032 [US3] The ambassador page `src/app/(app)/ambassadors/[id]/page.tsx` per contracts/routes.md § Pages and `design-options.html` option B: `requireUser()`, `parseId`, `parseShown` for `people` / `deals`, `parseShownBy(updates, 20)`; `notFound()` when `getAmbassadorPage` is null; head with kind "AMBASSADOR", name, "<role> at <organisation>", badges "Archived" / `messages.no_longer_ambassador` / "Private", `[ PERSON PAGE ]`; emails, phones, owner; summary strip like the deal page's (Won in `--green`, Lost in `--red`); `// PEOPLE REFERRED` and `// DEALS REFERRED` tables with empty messages `messages.no_people_referred` / `messages.no_deals_referred` and `[ SHOW MORE ]` (`?people=` / `?deals=`, anchors `#person-<id>` / `#deal-<id>`); every name a text node; and `src/app/(app)/ambassadors/[id]/not-found.tsx` showing `messages.ambassador_not_found` with `[ AMBASSADORS ]` → `/ambassadors`

**Checkpoint**: Every ambassador has a page with what they brought in and their latest updates.

---

## Phase 6: User Story 4 - Private records stay private (Priority: P1)

**Goal**: The private rules hold on every list, count, option, page, filter and save.

**Independent Test**: As Ada Fake, make a referred deal private; as Grace Fake (admin) the ambassador page and Ambassadors page neither list nor count it, and none of its notes are in latest updates.

### Tests for User Story 4 ⚠️

- [x] T033 [P] [US4] Integration tests in `tests/integration/ambassadors-private.test.ts` (`// covers FR-013, SC-004, SC-005, US4 scenarios 1–4`): a private referred person and a private referred deal are not listed, counted (people, deals, open, won, lost, latest referral), nor in updates for an admin they are hidden from, and the Ambassadors row agrees with the page; a private ambassador is not in `listAmbassadors`, `ambassadorOptions`, `referrerOptions`, and `getAmbassadorPage` returns `null`, for an admin they are hidden from; a shared person referred by a hidden private ambassador has `referredBy: "hidden"` and keeps the referrer when saved with `"keep"`; after `handOverPrivateRecords` the new owner opens the private ambassador's page and sees the private referred records listed and counted
- [x] T034 [P] [US4] Delete cases in `tests/integration/archive-delete.test.ts` (`// covers FR-014, edge case "An admin deletes an ambassador"`): deleting a shared ambassador clears `referred_by_id` and `referred_at` on what they referred and writes `referrer_cleared` with `cause = 'person_deleted'` on each, and earlier `referrer_set` events show no name; deleting a private ambassador writes no event and removes the events with `related_person_id` or `from_person_id` = them

### Implementation for User Story 4

- [x] T035 [US4] `deletePerson` in `src/server/records/people.ts` (research.md §6): in its transaction, before the delete, when not private insert `referrer_cleared` with `cause: "person_deleted"` and the admin as actor on every person and deal with `referred_by_id = $id`; when private extend the existing removal to `where related_person_id = $id or from_person_id = $id`; then `update persons set referred_by_id = null, referred_at = null where referred_by_id = $id` and the same on `deals`; `recordEvent` accepts `cause` on person and deal targets
- [x] T036 [US4] Review every new query in `src/server/records/ambassadors.ts`, `people.ts` and `deals.ts` against FR-013: each read of `persons` uses `visiblePerson` and each read of `deals` uses `visibleDeal` for the viewer; fix any that does not

**Checkpoint**: Nothing private leaks through ambassadors or referrals.

---

## Phase 7: User Story 5 - Find people and deals by ambassador (Priority: P2)

**Goal**: A "Referred by" filter on the People list and the Deal list.

**Independent Test**: `/people?ref=<Cara>` lists only Cara's referred people, combined with other filters and kept in the address; the deal list's count and total follow the filter.

### Tests for User Story 5 ⚠️

- [x] T037 [P] [US5] Unit tests in `tests/unit/list-query.test.ts` (`// covers FR-011`): `ref` parsed by `parsePeopleQuery` and `parseDealsQuery`, kept by `withParams`, counted by `hasFilters` / `hasDealFilters`, dropped by `knownDealsQuery` when not among `referrers`
- [x] T038 [P] [US5] Integration tests in `tests/integration/lists.test.ts` and `tests/integration/deals-list.test.ts` (`// covers FR-011, US5 scenarios 1–2`): `listPeople` / `listDeals` with `ref` combined with another filter; the deal list's count and total follow it; `referrerOptions` lists visible ambassadors (archived included) plus a former ambassador who still referred a visible record, and no private ambassador hidden from the viewer

### Implementation for User Story 5

- [x] T039 [US5] `src/server/records/list-query.ts`: `ref: number | null` on `PeopleQuery` and `DealsQuery` (`parseId(first(params, "ref"))`), in `withParams`, `hasFilters`, `hasDealFilters`; `knownDealsQuery` options gain `referrers`
- [x] T040 [US5] `referrerOptions(viewerId)` in `src/server/records/ambassadors.ts` (research.md §13); `listPeople` adds `and p.referred_by_id = ${query.ref}` and `peopleFilterOptions` returns `referrers` in `src/server/records/people.ts`; `listDeals` adds `and d.referred_by_id = ${query.ref}` and `dealFilterOptions` returns `referrers` in `src/server/deals/list.ts`
- [x] T041 [US5] A "Referred by" `Select` (`ref`) in the filter rows of `src/app/(app)/people/page.tsx` and `src/app/(app)/deals/list/page.tsx`

**Checkpoint**: All user stories work on their own.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T042 [P] Extend `tests/unit/messages.test.ts` with the SF-114 codes and templates (`// covers FR-015`)
- [x] T043 [P] Escape check: an integration or render test that a referred person named "<b>Fake</b>" comes back as the literal text in `listAmbassadors`, `getAmbassadorPage` and `readAmbassadorUpdates`, and that the pages render names only as React text nodes (no `dangerouslySetInnerHTML` in `src/app/(app)/ambassadors/`) (`// covers edge case "markup"`)
- [x] T044 [P] Same-name ambassadors: `ambassadorOptions` details differ for two "Cara Example" with different organisations / emails (`tests/integration/referrals.test.ts`)
- [x] T045 Write the fake data `src/seed/ambassadors.ts` per data-model.md § Fake data (Cara Example, Dora Privatefake, Ezra Formerfake, Ben / Dee / Eli / Fay / Gus / Hal Referredfake, the four "Fake referral · …" deals with their `deal_stage_periods` row like `src/seed/deals.ts`, two notes by Ada Fake), idempotent (people by email, deals by title, notes by record and body; events only when the row is created), and register `{ name: "ambassadors", run: seedAmbassadors }` after `notes` in `src/seed/index.ts`
- [x] T046 Extend `tests/integration/seed.test.ts` (`// covers FR-017`): after seeding, at least one shared and one private ambassador, a former ambassador with referrals, a private referred deal, open, won and lost referred deals, notes on referred records; a second run adds no row
- [x] T047 [P] Check that the existing suites still pass with the new columns and kinds: `tests/integration/handover.test.ts`, `imports-people.test.ts` (CSV-imported people take `is_ambassador = false`, no referrer), `notes.test.ts`, `timeline-deal-entries.test.ts`
- [x] T048 Append to `docs/DECISIONS.md` the two choices people made in the spec, one line each: "- An ambassador is a person with the Ambassador tick on their form; only ticked people can be chosen as Referred by (SF-114)" and "- The ambassador page uses design B: its own one-column page with [ PERSON PAGE ], a summary strip, people referred, deals referred, then latest updates grouped by day (SF-114)"; not the factory's "to confirm" choices; no "Departs from blueprint" line
- [x] T049 [P] Extend `tests/unit/decisions.test.ts` with an SF-114 block checking both lines of T048
- [x] T050 [P] Update `AGENTS.md` § Layout: `src/server/records/ambassadors.ts` (Ambassadors page, ambassador page, updates, options, referrer checks), `referral-rules.ts` (pure), `ReferrerPicker.tsx` (client), `ReferredBy.tsx`, `src/app/(app)/ambassadors/`, `src/seed/ambassadors.ts`
- [x] T051 Run `npm run typecheck` and fix every error
- [x] T052 Run `npm test` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test` and fix every failure; keep the full failure output when reporting
- [x] T053 Walk through `quickstart.md` § Automated checks and confirm each listed test file exists and names what it covers
- [x] T054 Check `design-options.html` option B against the new pages' markup and CSS classes (strip, tables, day groups, tags) without starting a browser; fix differences in `src/app/(app)/ambassadors/` and `src/app/globals.css`
- [x] T055 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — keep Google Sign-In as it is and extend the Supabase Postgres line: no fake, a real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres, and the SF-114 code (`src/server/records/ambassadors.ts`, the referral and delete changes in `people.ts` and `deals.ts`) keeps to the same pooler limits (no `set`/`listen`/session advisory lock, one `sql.begin()` per change) with its columns and kinds from `migrations/0008_ambassadors.sql`, applied on a fresh database by `tests/integration/migrate.test.ts` — and `## Schemas` (each schema's GitHub URL at its commit: oauth2-api.json unchanged, nothing added); also describe the new fake ambassadors in the seed line

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; T002–T004 in parallel after or beside T001.
- **Foundational (Phase 2)**: needs Phase 1; blocks every story. T006 before T008; T010 before T011.
- **US1 (Phase 3)**: needs Phase 2. MVP.
- **US2 (Phase 4)**: needs Phase 2; uses the `ambassador` flag of T014 to have options (test fixtures can set it directly).
- **US3 (Phase 5)**: needs Phase 2 and the referrer columns written by US2 (tests can set `referred_by_id` directly); `summaryFragments` from T015.
- **US4 (Phase 6)**: needs US1–US3 (it tests their reads).
- **US5 (Phase 7)**: needs Phase 2; independent of US3/US4.
- **Polish (Phase 8)**: after the stories; T055 is the last task.

### Within Each User Story

- Tests first, see them fail; domain code (`src/server/…`) before pages; a story is done at its checkpoint.

### Parallel Opportunities

- Phase 1: T002, T003, T004.
- Phase 2: T005, T007, T009 beside T006.
- US1: T013 beside T012; T018 beside T014–T017.
- US2: T019, T020.
- US3: T026, T027, T028.
- US4: T033, T034.
- US5: T037, T038; and US5 as a whole beside US3.
- Polish: T042, T043, T044, T047, T049, T050.

---

## Parallel Example: User Story 3

```bash
Task: "Integration tests in tests/integration/ambassador-page.test.ts"
Task: "Integration tests in tests/integration/ambassador-updates.test.ts"
Task: "Performance test tests/integration/ambassador-performance.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phases 1–2, then US1: ambassadors can be marked and listed.
2. Validate with T012, T013 and the US1 checkpoint.

### Incremental Delivery

1. US1 → US2 (referrals) → US3 (ambassador page) → US4 (privacy checks across them) → US5 (filters) → Polish.
2. Each story adds value without breaking the earlier ones; run `npm test` at each checkpoint.

## Notes

- Choices made here without asking: the Supabase Postgres task (T012) sits in US1, the first story whose code writes the new columns; the privacy story US4 comes after US3 because it checks the pages US1–US3 build; the delete clean-up (FR-014) sits in US4 because its rule is the SF-92 privacy rule; the seed is in the Polish phase because it needs every story's code; the test recipe (T055) is the last task.
- No outside-service fake is added or extended: the only outside service is the database, tested for real.

---

## Fix round 1: People list "Referred by" privacy (FR-013)

- [ ] T056 Write the tests first; they fail now. (a) Unit test, beside the `knownDealsQuery` tests: `knownPeopleQuery(parsePeopleQuery({ ref: "37", owner: "2", q: "x" }), { referrers: [] })` gives `ref: null` and keeps `owner` and `q`; with `referrers: [{ id: 37, name: "Dora Fake" }]` it keeps `ref: 37`. (b) In `tests/integration/referral-filters.test.ts`: Linus Fake makes a private ambassador Dora and refers a person Hal (visible to Ada Fake) to her; for Ada, `peopleFilterOptions(ada.id, null).referrers` has no Dora, and `listPeople(ada.id, knownPeopleQuery(parsePeopleQuery({ ref: String(dora) }), options))` lists the same rows and total as with no `ref`. Name it `// covers SF-114 FR-013, edge case "address names a hidden referrer"`
- [ ] T057 Add `knownPeopleQuery` to `src/server/records/list-query.ts` (keeps `ref` only when it is in `referrers`, as `knownDealsQuery` does); in `src/app/(app)/people/page.tsx` read `peopleFilterOptions` first, then call `listPeople` and build every link and the filter row from the known query
- [ ] T058 [P] In `src/server/records/ambassadors.ts`, `referrerOptions`: return the rows without the needless array spread around one query
- [ ] T059 Run `npm run typecheck`, `npm test` (with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`) and `npm run test:e2e`; fix every failure and keep the full failure output when reporting
