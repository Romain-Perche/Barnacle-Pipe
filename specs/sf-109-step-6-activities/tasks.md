---

description: "Tasks for SF-109 Activities"
---

# Tasks: Activities

**Input**: Design documents from `/specs/sf-109-step-6-activities/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-003 to SC-006): Vitest unit tests, Vitest integration tests against a real local Postgres (`crm_test`). No browser tests: `docs/DECISIONS.md` says the repo has none (this replaces AGENTS.md § Tests on this point), so no Playwright file and no `npm run test:e2e`. What a browser test would check is covered by a unit or integration test where it can be (pure helpers for what the screens show, domain functions for what they read and write); the rest (layout, the box opening and closing, focus, colours) is left to the AI review in the running app. Each test file names what it covers (`// covers FR-009, US3 scenario 2`). Write each story's tests first and see them fail before the code. Every function that depends on the clock takes `now: Date` (default `new Date()`), so integration tests pass a fixed `now`.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. The migration, entity, state changes, notifications and fake data are in `data-model.md`; pages, address parameters, components, actions and domain functions in `contracts/routes.md`; decisions in `research.md` (§n below). No new dependency (`dependencies.json` is `[]`): do not add any package. No blueprint applies (`blueprints.json` is `[]` and this run has no blueprint index), so there are no blueprint tasks and no `Departs from blueprint` line. The choices "decided by the factory, to confirm" in spec.md § Clarifications are built as written there. The only outside service is Supabase Postgres (no public schema on GitHub): its task is T016, the recipe T062.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6 from spec.md
- Paths are from the repository root (single Next.js project, see plan.md § Project Structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The schema and the test plumbing.

- [x] T001 Create `migrations/0008_activities.sql` exactly as `data-model.md` § Migration (only statements allowed in a transaction; it must not touch `timeline_events`): `create table activities` with `id bigint generated always as identity primary key`, `type text not null check (type in ('call', 'meeting', 'task'))`, `subject text not null check (subject = btrim(subject) and subject <> '' and char_length(subject) <= 200)`, `due_on date not null`, `due_time time null`, `duration_minutes int null check (duration_minutes between 5 and 1440 and duration_minutes % 5 = 0)`, `note text null check (char_length(note) <= 10000)`, `deal_id bigint null references deals (id) on delete set null`, `person_id bigint null references persons (id) on delete set null`, `organisation_id bigint null references organisations (id) on delete set null`, `assignee_id bigint not null references users (id)`, `done_at timestamptz null`, `done_by bigint null references users (id)`, `created_by bigint not null references users (id)`, `created_at timestamptz not null default now()`, `version int not null default 1`, `assigned_by bigint not null references users (id)`, `assigned_at timestamptz not null default now()`, `assignment_read_at timestamptz null`, `check (duration_minutes is null or due_time is not null)`, `check ((done_at is null) = (done_by is null))`, `check (note is null or note <> '')`; then `alter table activities enable row level security`; indexes `activities_deal_id_idx (deal_id)`, `activities_person_id_idx (person_id)`, `activities_organisation_id_idx (organisation_id)`, `activities_assignee_due_idx (assignee_id, due_on, due_time) where done_at is null`, `activities_assignee_done_idx (assignee_id, done_at desc) where done_at is not null`, `activities_deal_next_idx (deal_id, due_on, due_time) where done_at is null`, `activities_assigned_idx (assignee_id, assigned_at desc) where assignee_id <> assigned_by`, `activities_assigned_unread_idx (assignee_id) where assignee_id <> assigned_by and assignment_read_at is null`
- [x] T002 [P] Extend `tests/support/reset.ts` (`resetAppTables`): add `activities` to the `truncate` list (before `deals`; restart identity cascade); keep the six starting lead sources
- [x] T003 [P] Extend `.factory/run/reset-db.sh` to truncate `activities` too
- [x] T004 [P] Add `activities` to the expected list in `tests/integration/rls.test.ts`; extend `tests/integration/migrate.test.ts` to check on a fresh database: a type `'email'` is refused, a subject `' x'`, `''` or 201 characters is refused, a duration without a time, a duration of 3 or 7 or 1445 minutes is refused, `done_at` without `done_by` is refused, an empty-string note is refused (all 23514); deleting a deal, person or organisation sets the activity's link to null (FK `on delete set null`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure rules, messages, query parsing and the visibility rule every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 [P] Unit tests first in `tests/unit/activities-rules.test.ts` (data-model.md § Entity, research.md §4): `validateActivity` — subject trimmed, `""`/spaces → `activity_subject_required`, 200 characters ok, 201 → `activity_subject_too_long`; no `dueOn` → `activity_due_required`; `dueTime` `"01:00"` and `"01:30"` on `2026-03-29` → `activity_time_not_in_uk` (the clocks jump from 01:00 to 02:00 UK), `"00:59"` and `"02:00"` that day accepted; `"01:30"` on `2026-10-25` accepted (first, BST); a duration with no time → `activity_duration_needs_time`; durations 4, 7, 1445 → `activity_duration_invalid`, 5 and 1440 ok; a note of 10,000 characters with CRLF line breaks counted once is ok and stored with LF, 10,001 → `activity_note_too_long`, a note of only spaces → null; type not in `call|meeting|task` → refused; link ids parsed as positive integers or null; errors in field order. `activityState(a, now)`: due yesterday untimed → `overdue`; due today untimed at 23:59 UK → `today`, and at 00:00 UK next day → `overdue`; due today 00:30 → `today` at 00:29 UK, `overdue` at 00:30; due today 10:00 + 30 min → `today` at 10:29, `overdue` at 10:30; checks at both clock changes (29 Mar 2026, 25 Oct 2026) and in summer (BST); done → `done`. `formatDue`: "25 Nov 2026", "25 Nov 2026 10:00", "25 Nov 2026 10:00–10:30"; `formatCardDue` "25 Nov"; `weekBounds(now)` gives Monday–Sunday in UK time (a Sunday 23:30 UTC in summer is already Monday UK); `durationOptions()` starts at 5, ends at 1440, step 5
- [x] T006 [P] Unit tests first in `tests/unit/list-query.test.ts` (contracts/routes.md § `/activities`): `parseActivitiesQuery` — `when` defaults to `planned`, unknown values → `planned`; `assignee` `all` → everyone, a positive integer → that id, absent/garbage → `null` (the viewer); `type` among `call|meeting|task` else all; `page` ≥ 1 else 1; `withParams("/activities", q, { when: "done" })` keeps the other filters and drops page. In `tests/unit/messages.test.ts`: every SF-109 code and template of contracts/routes.md § Messages with its exact text, `fieldMessage({ code: "assignee_cannot_see", name: "Bob Fake" })` → "Bob Fake can't see this record, so the activity can't be assigned to them."; in `tests/unit/flash.test.ts` the flash code `activity_deleted` → "Activity deleted."
- [x] T007 Implement `src/server/activities/rules.ts` (pure, no database): `ACTIVITY_TYPES`, `validateActivity`, `existsInUk`, `ukInstant`, `activityState`, `formatDue`, `formatCardDue`, `durationOptions`, `weekBounds`, `cardLine`, `afterTickPath` (contracts/routes.md § Domain functions), using `Intl.DateTimeFormat` with `timeZone: "Europe/London"` as `src/server/format.ts` does; T005 passes
- [x] T008 Implement `parseActivitiesQuery` (and its `ActivitiesQuery` type in the `AnyQuery` union for `withParams`) in `src/server/records/list-query.ts`; T006 query part passes
- [x] T009 [P] Add to `src/server/messages.ts` under a `// SF-109: activities` comment every code and template of contracts/routes.md § Messages (`activity_subject_required` "Give the activity a subject.", `activity_subject_too_long` "Keep the subject under 200 characters.", `activity_due_required` "Pick a due date.", `activity_time_not_in_uk` "Pick a time that exists in UK time.", `activity_duration_needs_time` "Pick a time before setting a duration.", `activity_duration_invalid` "Pick a duration between 5 minutes and 24 hours.", `activity_note_too_long` "Keep the note under 10,000 characters.", `activity_conflict` "Someone else changed this activity while you were editing. Reload to see their changes.", `activity_gone` "This activity doesn't exist any more.", `activity_not_found` "This activity doesn't exist or you can't see it.", `activity_record_archived` "Restore this record before changing its activities.", `activity_link_not_found`, `activity_delete_confirm` "Delete this activity? This can't be undone.", `activities_empty` "No activities here.", `activities_none_planned`, `no_next_activity` "⚠ No next activity", `followup_question` "Schedule a follow-up?", `overdue` "Overdue", `today` "Today"; templates `assignee_cannot_see`, `assigned_you(by, type, subject)` "<by> assigned you a <call|meeting|task>: <subject>", `activity_due`, `done_by`, `next_activity(day, type)` "Next: <day> · <Type>", `activity_deleted`); `fieldMessage` handles `assignee_cannot_see`; add `activity_deleted` to `CODES` in `src/server/records/flash.ts`; T006 message and flash parts pass
- [x] T010 Add `visibleActivity(db, viewer, alias = "a")` to `src/server/records/visibility.ts` (research.md §5): `(a.person_id is null or exists (select 1 from persons p where p.id = a.person_id and <visiblePerson>)) and (a.deal_id is null or exists (select 1 from deals d where d.id = a.deal_id and <visibleDeal>))`, `viewer` a user id or a fragment such as ``db`u.id` ``; update the file's header comment ("every `activities` read uses it")
- [x] T011 [P] Add the activity styles to `src/app/globals.css` per `design-options.html` design A (plan.md step 7): `--warn: #B45309` (dark `#FBBF24`) if missing, `tr.over td:first-child { box-shadow: inset 2px 0 0 var(--danger) }`, `.od` (red outlined mono uppercase mark), `.td` (blue outlined mark), `.warnline` (amber mono uppercase, thin top border), `.nextline` (muted mono, thin top border), the activity box over the page (8px radius, shadow, like `.lostbox`), type tabs (orange when chosen), `.box` done box (green `--ok` when done), `.arow` rows of "// NEXT ACTIVITIES"; long subjects `overflow-wrap: anywhere`, notes `white-space: pre-wrap`

**Checkpoint**: rules, messages, query parsing, visibility and styles ready.

---

## Phase 3: User Story 1 - Schedule an activity on a deal, person or organisation (Priority: P1) 🎯 MVP

**Goal**: `[ SCHEDULE ACTIVITY ]` on every non-archived record page and the deal drawer, a box over the page with pre-filled links, "// NEXT ACTIVITIES" above the timeline, edit with conflict check, delete with confirmation.

**Independent Test**: With the fake data loaded, schedule a call for tomorrow at 10:00 on a deal, a meeting on a person and a task with no time on an organisation; each shows in its record's "// NEXT ACTIVITIES" with type, subject, due date and time, and assignee; edit one, delete another and confirm after a reload.

### Tests for User Story 1

- [x] T012 [P] [US1] Integration tests in `tests/integration/activities.test.ts` (covers FR-001, FR-002, FR-003, FR-007, FR-011, FR-013, US1 scenarios 1–7): `scheduleActivity` stores every field and `created_by = assigned_by = actor`; defaults the assignee to the actor; refuses each validation case of T005 with nothing saved; refuses a deactivated or unknown assignee; `prefillLinks` from a deal gives the deal, its visible main person and its organisation, from a person the person and their organisation, from an organisation only it; `activityFormChoices` offers only open, non-archived, visible deals and non-archived people and organisations; a newly picked won deal or archived record is refused; `nextActivities` lists only planned activities of the record, ordered `due_on, due_time nulls last, id`; `editActivity` with an old version → `conflict`, on a deleted activity → `gone`, both change nothing; `deleteActivity` removes it (and an old version → `conflict`); any change while a linked record is archived → `archived` (and the archived record still lists its activities); a user who is not the creator or assignee can edit and delete
- [x] T013 [P] [US1] Integration tests in `tests/integration/activity-page.test.ts` (covers US1 scenarios 1, 2, 5, 6, 7, FR-016; replaces the browser test): `pageActivity(viewer, id, target)` returns the activity for an id linked to that deal, person or organisation and visible to the viewer, and `null` for an id linked elsewhere, hidden, deleted or not a number; after `scheduleActivity` from a deal with its `prefillLinks`, `nextActivities` of the deal, its person and its organisation each list it once with type, subject, `formatDue` "<date> 10:00" and the assignee name; a 30-minute meeting reads "<date> 10:00–10:30" and an untimed task "<date>"; after `editActivity` the new subject is read back; after `deleteActivity` it is gone from every record. In `tests/unit/activities-rules.test.ts`: a subject `<b>x</b>` and a note with a line break pass `validateActivity` unchanged (FR-015). The box opening, typed values kept on an error and hidden buttons on an archived record are left to the AI review
- [x] T014 [P] [US1] Extend `tests/integration/archive-delete.test.ts` (covers FR-014, spec Edge Cases): deleting a deal deletes its activities linked to nothing else and keeps one also linked to a person (now without the deal); same for deleting a person and an organisation; deleting a person who is private deletes every activity linked to them; an activity created with no link is never touched
- [x] T015 [P] [US1] Extend `tests/integration/handover.test.ts` (covers US5 scenario 4): after a hand-over of a deactivated user's private deal and person, the new owner sees their activities (`nextActivities`, `getActivity`) and each activity keeps its assignee
- [x] T016 [US1] Supabase Postgres has no public schema on GitHub, so there is no fake to check against a schema: the tests use a real local PostgreSQL 17, and the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler). It copies its limits: no prepared statements (`prepare: false`, unchanged in `src/server/db.ts`), no session state (no `set`, `listen` or session advisory lock), every multi-statement change in one `sql.begin()` transaction, at most 5 connections (`max: 5`). Extend the check in `tests/integration/migrate.test.ts` so it also scans `src/server/activities/activities.ts`, `src/server/activities/list.ts`, `src/server/records/timeline.ts`, `src/server/notifications.ts` and `src/server/deals/deals.ts` for `set `/`listen`/`pg_advisory_lock` and fails on any, and checks `migrations/0008_activities.sql` has no `begin`/`commit`/`concurrently`/`vacuum`, applies on a fresh database after 0007, and leaves `timeline_events_kind_check` unchanged

### Implementation for User Story 1

- [x] T017 [US1] Implement in `src/server/activities/activities.ts` (data-model.md § State changes 1, 2, 5; research.md §5, §6): `scheduleActivity`, `editActivity`, `deleteActivity`, `getActivity`, `nextActivities(viewerId, target, now)`, `activityFormChoices`, `prefillLinks`, `pageActivity`, `followupPrefill`; each change in one `sql.begin`, locking the activity (`for update`, `visibleActivity(actor)`, else `not_found`) and every current and newly picked linked row (`for update` through `visiblePerson`/`visibleDeal`; a missing new link → `activity_link_not_found`); any archived → `archived`; a newly picked deal must have `status = 'open'`; the assignee checked with `select … from users u where u.id = $a and u.status = 'active' and <visibleActivity for the new links with viewer u.id>` (else `assignee_cannot_see` with the name); on edit, when `assignee_id` changes set `assigned_by = actor, assigned_at = now(), assignment_read_at = null`; `version + 1` on edit; T012 passes
- [x] T018 [US1] Record deletes (research.md §9): in `deleteDeal` (`src/server/deals/deals.ts`), `deletePerson` (`src/server/records/people.ts`; when the person is private delete `where person_id = $id`) and `deleteOrganisation` (`src/server/records/organisations.ts`), before deleting the record row, run `delete from activities where <link> = $id and <the two other links> is null`; T014 passes
- [x] T019 [US1] Add optional `name` (default `personId`) and `label` (default "Person", also used for the placeholder "Type to find a …") props to `src/app/(app)/records/PersonPicker.tsx`; existing callers unchanged
- [x] T020 [US1] Server actions in `src/app/(app)/activities/actions.ts` (contracts/routes.md § Server actions): `scheduleActivity(prev, fd)`, `editActivity(prev, fd)` returning `FormState` on refusals (messages in the box, typed values kept) and on success `redirect(isSafeNext(back, appBaseUrl()))` with `back` defaulting to `/activities`; `deleteActivity(fd)` sets the flash `activity_deleted` and redirects to `back`, refusals redirect to `back` with `?error=<code>`; each starts with `requireUser()`
- [x] T021 [P] [US1] `src/app/(app)/activities/ActivityBits.tsx` (server): `TypeTag` ("CALL"/"MEETING"/"TASK"), `DueText` (`formatDue`), `StateMark` ("Overdue" `.od` / "Today" `.td` from `activityState`)
- [x] T022 [US1] `src/app/(app)/activities/ActivityBox.tsx` (client, `useActionState`) per contracts/routes.md § Components: overlay + dialog titled "Schedule activity" / "Edit activity" / "Schedule a follow-up?"; type radios as tabs; Subject (`maxLength` 200); Date; Time (step 300); Duration select from `durationOptions()`; Assigned to (offered users, the actor first by default); Deal / Person / Organisation with `PersonPicker` (`name` `dealId`/`personId`/`organisationId`); Note (`maxLength` 10000); hidden `id`, `version`, `back`; `[ SAVE ]` and `[ CANCEL ]` (or `[ NOT NOW ]` for the follow-up) as a link to the page without the box parameter
- [x] T023 [P] [US1] `src/app/(app)/activities/ActivityDeleteConfirm.tsx` (server): `activity_delete_confirm`, `[ DELETE ]` posting `id`, `version`, `back`, and `[ CANCEL ]`
- [x] T024 [US1] `src/app/(app)/activities/NextActivities.tsx` (server): "// NEXT ACTIVITIES" with `[ SCHEDULE ACTIVITY ]` (→ `?activity=new`, hidden when the record is archived), each row: done box slot (filled in US2), `TypeTag`, subject, `DueText`, assignee (with " (deactivated)"), `StateMark`, `[ EDIT ]` (`?activity=<id>`) and `[ DELETE ]` (`?delete-activity=<id>`) unless archived; none: `activities_none_planned`
- [x] T025 [US1] Wire the record pages: `src/app/(app)/deals/[id]/page.tsx`, `src/app/(app)/people/[id]/page.tsx`, `src/app/(app)/organisations/[id]/page.tsx` render `NextActivities` above `// TIMELINE`, read `activity=new|<id>` and `delete-activity=<id>` (through `pageActivity`: an id only when it is a visible activity linked to this record, else ignored) and render `ActivityBox` / `ActivityDeleteConfirm` with `back` = the page path; add `activity_not_found`, `activity_record_archived`, `activity_conflict`, `activity_gone` to each page's `PAGE_ERRORS`; read the flash `activity_deleted`
- [x] T026 [US1] The deal drawer: `src/app/(app)/deals/DealDrawer.tsx` shows `NextActivities` (and `[ SCHEDULE ACTIVITY ]` unless archived); `src/app/(app)/deals/page.tsx` and `src/app/(app)/deals/list/page.tsx` pass the drawer's `hereHref` as `back` and render `ActivityBox` / `ActivityDeleteConfirm` for `activity` / `delete-activity` on the open deal; T013 passes

**Checkpoint**: activities can be scheduled, edited and deleted on every record; MVP.

---

## Phase 4: User Story 2 - Mark an activity done and schedule the follow-up (Priority: P1)

**Goal**: Tick and untick on record pages, the drawer and (US3) the list; done activities on the timeline tagged ACTIVITY; "Schedule a follow-up?" after a tick; "Last contacted" from done calls and meetings.

**Independent Test**: On a deal with one planned call, tick it; it moves to the timeline tagged ACTIVITY with "Done by …" and the "Schedule a follow-up?" box opens with the deal, its person and organisation; save a follow-up task for next Monday and it is the deal's next activity.

### Tests for User Story 2

- [x] T027 [P] [US2] Integration tests in `tests/integration/activities-done.test.ts` (covers FR-004, FR-006, US2 scenarios 1, 3, 4, spec Edge Cases): `tickActivity` sets `done_at`, `done_by`, `version + 1`; two `tickActivity` calls at once (`Promise.all`, two users) leave one done with `done_by` = the first committed; `untickActivity` clears both; a tick on a call linked to a person whose `last_contacted_at` is older sets it to `ukInstant(due_on, due_time ?? 00:00)`, a call due in the future sets it to its `done_at` (never a future date), a newer value is kept, a task never changes it, untick never lowers it, and the person's `version` is unchanged; tick/untick refused with `archived` while a linked record is archived and `not_found` when not visible
- [x] T028 [P] [US2] Integration tests in `tests/integration/timeline-activities.test.ts` (covers FR-004, spec Edge Cases): `readTimeline` on a deal, person and organisation includes each done activity linked to it, kind `activity`, at `done_at`, with type, subject, note, done-by name ("(deactivated)" when so); a planned one is absent; an activity linked to a person and to their deal appears once on the person's timeline and once on the organisation's; paging with `limit` mixes events and activities in `created_at`/`done_at` order with `more` correct; unticking removes it
- [x] T029 [P] [US2] Integration tests in `tests/integration/activity-followup.test.ts` (covers US2 scenarios 1–3, FR-005; replaces the browser test): after `tickActivity`, `nextActivities` no longer lists it and `readTimeline` has it as `activity` with `done_by` "Ada Fake"; `followupPrefill` gives the same deal, person, organisation, assignee and type and no date; a follow-up task scheduled for next Monday is first in `nextActivities`; `untickActivity` puts the call back in `nextActivities`. Unit tests in `tests/unit/activities-rules.test.ts`: `afterTickPath("/deals/7", 12, true)` → `/deals/7?followup=12`, with `false` → `/deals/7`, a `back` with a query keeps it (`/deals?pipeline=1&deal=7` → `…&followup=12`). SC-002 (under 30 seconds) and the box in the drawer are left to the AI review

### Implementation for User Story 2

- [x] T030 [US2] Implement `tickActivity` and `untickActivity` in `src/server/activities/activities.ts` (data-model.md § State changes 3–4, research.md §8): `update activities set done_at = now(), done_by = $actor, version = version + 1 where id = $id and done_at is null returning …` (a done activity → `ok`, no change), then for `call`/`meeting` with `person_id`: `update persons set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'), least($due, $done_at)) where id = $person` (no version bump, no event); untick with `where done_at is not null`; T027 passes
- [x] T031 [US2] `readTimeline` in `src/server/records/timeline.ts` (research.md §3): `union all` of the done activities of the target (deal: `a.deal_id = $d`; person: `a.person_id = $p or a.deal_id in (<their visible deals as in targetWhere>)`; organisation: `a.organisation_id = $o or a.deal_id in (<its visible deals>)`) and `visibleActivity(viewer)`, ordered with the events by `created_at`/`done_at desc` and `limit + 1`; `EventKind` + `"activity"`, `TimelineEntry.activity` as data-model.md § Timeline entry; `entryTag` in `src/server/records/timeline-view.ts` → `ACTIVITY`; T028 passes
- [x] T032 [US2] `src/app/(app)/activities/DoneBox.tsx` (server form, works without JavaScript): one button styled `.box` (`.box.done` when done), `aria-label` "Mark done" / "Mark not done", hidden `id`, `back`, `followup` (`"1"` on record pages and the drawer); add `tickActivity(fd)` / `untickActivity(fd)` to `src/app/(app)/activities/actions.ts`, redirecting to `afterTickPath(back, id, followup)` after a tick, refusals as `?error=<code>`
- [x] T033 [US2] Put `DoneBox` in `NextActivities.tsx` rows (not when archived); render the ACTIVITY entry in `src/app/(app)/records/RecordTimeline.tsx` (key and anchor `activity-<id>`, tag ACTIVITY, `TypeTag`, bold subject, note as text with `pre-wrap`, `done_by` text, an untick `DoneBox` unless the record is archived or the timeline is read-only); the three record pages, `deals/page.tsx` and `deals/list/page.tsx` read `followup=<id>` (a visible activity linked to the record) and open `ActivityBox` in follow-up mode with its links and assignee, no date; T029 passes

**Checkpoint**: ticking, follow-ups, timeline entries and "Last contacted" work.

---

## Phase 5: User Story 3 - The Activities list: what's due and overdue (Priority: P1)

**Goal**: `/activities` in the sidebar: the viewer's planned activities by default, quick filters, assignee and type filters in the address, overdue first, 50 per page with a count, tick from the list, schedule with no link.

**Independent Test**: As Ada Fake open Activities: only her planned activities, overdue first in red; switch to Today, then assignee Everyone, then type Meeting and check rows and count; tick one done from the list.

### Tests for User Story 3

- [x] T034 [P] [US3] Integration tests in `tests/integration/activities-list.test.ts` with a fixed `now` (covers FR-008, FR-009, US3 scenarios 1–6, SC-006): default = planned, assigned to the viewer; order `overdue desc, due_on, due_time nulls last, id`; `overdue`, `today`, `week` (Monday–Sunday UK, overdue ones of the week included, done excluded), `planned`, `done` (by `done_at desc`) each give the right rows and count, checked at 23:59 and 00:01 UK and on both clock-change days; assignee id, `all` and a deactivated user; type filter; 50 per page with the total count; an activity with no link is listed; a linked archived record comes back marked archived; `activityFilterOptions` lists every user A–Z
- [x] T035 [P] [US3] Performance test in `tests/integration/activities-list-performance.test.ts` (covers SC-003): with 2,000 activities across users, `listActivities` + count for each `when` and assignee `all` returns in under 2 s
- [x] T036 [P] [US3] Unit tests (covers US3 scenarios 1, 2, 4, FR-016; replaces the browser test): in a new `tests/unit/nav.test.ts`, `mainNav` has "Activities" → `/activities` between "Organisations" and "Notifications"; in `tests/unit/list-query.test.ts`, the quick-filter, assignee and type links built with `withParams` read back the same filters through `parseActivitiesQuery` (the address keeps them on reload); in `tests/unit/activities-rules.test.ts`, a tick from the list (no `followup`) gives `afterTickPath(back, id, false)` = `back` (no follow-up box); `countLabel(1, "ACTIVITY", "ACTIVITIES")` → "// 1 ACTIVITY". Extend T034: an activity scheduled with no link is listed under Planned. The row marks and the empty state's look are left to the AI review

### Implementation for User Story 3

- [x] T037 [US3] Implement `src/server/activities/list.ts` (research.md §10): `listActivities(viewerId, query, now)` → `{ rows, count }` (one `Promise.all` of the page query and the count), with `visibleActivity(viewerId)`, the UK `today` and week from `${now}` (`(${now}::timestamptz at time zone 'Europe/London')::date`, `date_trunc('week', …)`), overdue as research.md §4, rows with deal / person / organisation (id, name, archived) and assignee name/status; `activityFilterOptions()`; T034 and T035 pass
- [x] T038 [US3] Page `src/app/(app)/activities/page.tsx` (server, `requireUser()`) per contracts/routes.md § `/activities`: header "Activities" + `[ SCHEDULE ACTIVITY ]` (`?activity=new`), quick-filter tabs as links via `withParams`, Assignee and Type selects with `AutoSubmit`, the count with `countLabel(n, "ACTIVITY", "ACTIVITIES")`, the table (DoneBox without `followup`, TYPE, SUBJECT with `[ EDIT ]`/`[ DELETE ]`, DUE with `StateMark`, ASSIGNEE, DEAL, PERSON · ORGANISATION as links, "Archived" badge, "—" when none), `tr.over` for overdue, done rows with "Done <date time> by <name>" and an untick box, `Pager`, `activities_empty`; `ActivityBox` / `ActivityDeleteConfirm` for `activity` / `delete-activity` with `back` = the current list address; `PAGE_ERRORS` with the activity codes; flash `activity_deleted`
- [x] T039 [US3] Add `{ href: "/activities", label: "Activities" }` to `mainNav` in `src/app/(app)/nav.ts` between "Organisations" and "Notifications"; T036 passes

**Checkpoint**: the start-of-day list works.

---

## Phase 6: User Story 5 - Private records keep their activities private (Priority: P1)

**Goal**: An activity linked to a hidden record is invisible and uncounted everywhere; the assignee must see every linked record.

**Independent Test**: As Ada Fake make a deal private and schedule a call on it for herself; as Bob Fake (admin) the call is in no list (Everyone), on no page, card or count.

### Tests for User Story 5

- [x] T040 [P] [US5] Integration tests in `tests/integration/activities-private.test.ts` (covers FR-012, US5 scenarios 1–3, SC-005): an activity on a private deal and one on a private person of Ada's are absent for Bob (admin) from `listActivities` (every `when`, assignee `all`) and its count, `nextActivities` of the linked organisation and of the deal's shared person, `readTimeline` of those records once done, `getActivity` (the board card and notification cases are in T043 and T047); a direct `editActivity` / `tickActivity` / `untickActivity` / `deleteActivity` by Bob → `not_found` with nothing changed; `activityFormChoices` for links to the private deal offers only its creator and owner as assignees; scheduling or editing with an assignee who cannot see a link → `assignee_cannot_see` with their name; making a deal private later hides its activity from its assignee who is neither creator nor owner (spec Clarifications)
- [x] T041 [P] [US5] Extend `tests/integration/activities-private.test.ts` (covers US5 scenarios 1–3; replaces the browser test): Bob's `listActivities` count with assignee `all` is the same before and after Ada schedules the call on her private deal; `pageActivity(Bob, id, <the deal's organisation>)` is `null`; `tickActivity(Bob, id)` → `not_found`, mapped by the action to `activity_not_found` "This activity doesn't exist or you can't see it."

### Implementation for User Story 5

- [x] T042 [US5] Check every `activities` read and change uses `visibleActivity` (`src/server/activities/activities.ts`, `src/server/activities/list.ts`, `src/server/records/timeline.ts`, `src/server/deals/deals.ts`, `src/server/notifications.ts`), that `activityFormChoices` limits assignees to active users passing `visibleActivity` for the pre-filled links (`viewer` ``sql`u.id` ``), and that the address parameters `activity` / `followup` / `delete-activity` ignore ids the viewer cannot see; fix any gap; T040 and T041 pass

**Checkpoint**: privacy holds across every surface built so far.

---

## Phase 7: User Story 4 - "No next activity" warning on deal cards (Priority: P2)

**Goal**: Each open deal card ends with "⚠ No next activity" or "Next: <date> · <type>" (with "Overdue"), counting only activities the viewer can see.

**Independent Test**: A deal with no activity shows "No next activity"; schedule a task from the drawer → its date; tick it → the warning is back.

### Tests for User Story 4

- [x] T043 [P] [US4] Integration tests in `tests/integration/board-next.test.ts` (covers FR-010, US4 scenarios 1, 2, 4, SC-004): `getBoard` gives `next: null` for an open deal with no planned activity and for one whose only planned activity is done or hidden from the viewer (linked to a private person of someone else); otherwise the earliest planned (`due_on, due_time nulls last, id`) with its type; a won, lost or archived deal is not on the board; extend `tests/integration/board-performance.test.ts`: 500 open deals with activities still under 2 s (SC-003)
- [x] T044 [P] [US4] Tests for the card's last line (covers US4 scenarios 1–3; replaces the browser test): unit tests in `tests/unit/activities-rules.test.ts` — `cardLine(null, now)` → warn "⚠ No next activity"; a task due 25 Nov 2026 → "Next: 25 Nov · Task", not overdue; a call due yesterday → overdue; an untimed task due today at 23:59 UK → not overdue; extend `tests/integration/board-next.test.ts`: schedule a task on a deal with none → its card `next` is the task; tick it → `next` is null again

### Implementation for User Story 4

- [x] T045 [US4] `getBoard` in `src/server/deals/deals.ts` (research.md §11): `left join lateral (select a.due_on, a.due_time, a.duration_minutes, a.type from activities a where a.deal_id = d.id and a.done_at is null and <visibleActivity(viewer)> order by a.due_on, a.due_time nulls last, a.id limit 1)`; `BoardCard.next: { dueOn, dueTime, durationMinutes, type } | null`; T043 passes
- [x] T046 [US4] `src/app/(app)/deals/Board.tsx`: each card ends with the line from `cardLine(next, now)`: `<span class="warnline">` "⚠ No next activity", or `<span class="nextline">` "Next: <d Mon> · <Type>" plus `StateMark` when overdue; T044 passes

**Checkpoint**: stalled deals are visible on the board.

---

## Phase 8: User Story 6 - Know when a teammate assigns you an activity (Priority: P2)

**Goal**: Scheduling or reassigning an activity to someone else gives them one unread notification beside their mentions; it goes away on reassignment or delete; opening it goes to the activity's record.

**Independent Test**: As Ada, schedule a call on a deal assigned to Bob; as Bob the sidebar shows "Notifications (1)" and the page lists "Ada Fake assigned you a call: <subject>" with its due date; opening it lands on the deal and the count goes back to 0.

### Tests for User Story 6

- [x] T047 [P] [US6] Integration tests in `tests/integration/activity-notifications.test.ts` (covers FR-018, US6 scenarios 1–5): Ada schedules for Bob → `unreadCount(Bob)` +1 and `listNotifications(Bob)` has an `assignment` item with `assigned_you("Ada Fake", "call", subject)`, the date assigned and the due text, newest first among his mentions; self-assignment → nothing; reassigning to Cy removes Bob's and gives Cy an unread one; editing other fields, ticking or unticking changes nothing (still unread or read); delete removes it; `openNotification(Bob, { kind: "assignment", id })` marks it read and returns the deal path, else person, else organisation, else `/activities`; `markAllRead(Bob)` marks mentions and assignments; an activity whose record becomes hidden from Bob is neither listed nor counted; mentions still work as before (`openNotification` with `kind: "mention"`)
- [x] T048 [P] [US6] Extend `tests/integration/activity-notifications.test.ts` (covers US6 scenarios 1, 3, 4; replaces the browser test): the count the sidebar shows (`unreadCount(Bob)`) is 1 after Ada schedules for him and 0 after `openNotification`; the assignment item carries the text "Ada Fake assigned you a call: <subject>" and the due text built by `formatDue`; after Ada reassigns another one from Bob to Cy, Bob's list no longer has it

### Implementation for User Story 6

- [x] T049 [US6] `src/server/notifications.ts` (research.md §7, data-model.md § Notification): `listNotifications` reads `note_mentions` (as now) `union all` assignments (`activities a where a.assignee_id = $me and a.assigned_by <> $me and <visibleActivity($me)>`) ordered by `created_at`/`assigned_at desc` with `limit + 1`, each item with `kind: "mention" | "assignment"`; `unreadCount` adds the unread assignments (`assignment_read_at is null`); `openNotification(userId, { kind, id })`; `markAllRead` also sets `assignment_read_at = now()` on the user's unread ones; T047 passes
- [x] T050 [US6] `src/app/(app)/notifications/page.tsx` renders assignment items (`assigned_you`, date, `activity_due(formatDue)`, unread style) and posts `kind` and `id`; `src/app/(app)/notifications/actions.ts` `openNotification` reads `kind` (`mention` when absent) and `id`, redirecting to the returned path (fixed paths built from numeric ids). If SF-108 (`UnreadLink`, `currentUnread`) is merged first, keep its code: the count still comes from `unreadCount`; T048 passes

**Checkpoint**: every story works on its own and together.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T051 [P] Fake data `src/seed/activities.ts` per data-model.md § Fake data (FR-017), idempotent (skip a subject already present), dates relative to the UK day it runs on; register `{ name: "activities", run: seedActivities }` after `notes` in `src/seed/index.ts`
- [x] T052 [P] Extend `tests/integration/seed.test.ts` (covers FR-017): after two seed runs there are no duplicate activities; there are overdue, today, later, timed and untimed, done, private-deal and private-person activities, read and unread assignment notifications, and an open deal on the first pipeline with no planned activity
- [x] T053 [P] Extend `tests/integration/seed.test.ts` (covers FR-017; replaces the browser test): right after the seed, Ada's `listActivities` has at least one row under `overdue` and one under `today` (with `now` = the seed time), and `getBoard` for Ada on the first pipeline has at least one card with `next: null` and one with a `next`
- [x] T054 [P] Unit test in `tests/unit/decisions.test.ts` (SF-109 block): `docs/DECISIONS.md` has lines ending "(SF-109)" recording design A for the Activities list, the card warning replacing the SF-93 choice, "Last contacted" from done calls and meetings (due date, or when marked done if later), and in-app assignment notifications
- [x] T055 Append to `docs/DECISIONS.md` the four lines of plan.md step 9, one line each ending "(SF-109)" (no "Departs from blueprint" line; the factory's "to confirm" choices are not added); T054 passes
- [x] T056 [P] Update `AGENTS.md` § Layout: `src/server/activities/` (`rules.ts` pure, `activities.ts`, `list.ts`), `visibleActivity` in `visibility.ts` ("every `activities` read uses it"), `src/app/(app)/activities/` (page, `ActivityBox`, `DoneBox`, `NextActivities`, `ActivityBits`, `ActivityDeleteConfirm`, actions), `src/seed/activities.ts`, and that notifications now include assignments
- [x] T057 [P] Build the accessibility of the new UI: `ActivityBox` has `role="dialog"`, `aria-modal`, a label from its title and focus on the subject; `DoneBox` buttons have `aria-label` "Mark done" / "Mark not done"; the quick filters mark the current one with `aria-current`; the Overdue/Today marks are text, not colour alone. No browser test: the AI review checks them on the screens
- [x] T058 [P] Subject and note are only ever rendered as text (FR-015): add to `tests/unit/activities-rules.test.ts` (or a new `tests/unit/plain-text.test.ts`) a check that reads `src/app/(app)/activities/*.tsx`, `src/app/(app)/records/RecordTimeline.tsx` and `src/app/(app)/notifications/page.tsx` and fails on `dangerouslySetInnerHTML`; extend T012 so a subject `<b>x</b>` and a note with a line break are stored and read back as typed (`getActivity`, `nextActivities`). How they look on screen is left to the AI review
- [x] T059 Run `npm run typecheck` and fix any error
- [x] T060 Run `npm test` (with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`) and fix failures without weakening tests
- [x] T061 Re-read spec.md § Edge Cases and confirm each has a test (archived records, several links shown once, won/lost deals keep activities, deletes, removed deal people keep links, deactivated assignee shown "(deactivated)" and not offered, UK time and the clock gap, past due dates tickable at once, concurrent ticks, plain-text note, unlinked activity only in the list, `[ SHOW MORE ]` day headings); add any missing case to the matching test file
- [x] T062 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — keep Google Sign-In as it is and extend the Supabase Postgres line: no fake, a real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres, and the SF-109 code (`src/server/activities/activities.ts`, `src/server/activities/list.ts`, `src/server/records/timeline.ts`, `src/server/notifications.ts`, `src/server/deals/deals.ts`) keeps to the same pooler limits with its table from `migrations/0008_activities.sql` (`activities`), applied on a fresh database by `tests/integration/migrate.test.ts` — and `## Schemas` (each schema's GitHub URL at its commit: oauth2-api.json unchanged, nothing added); also describe the new fake activities and assignment notifications in the `reset-db.sh` / seed line

---

## Dependencies & Execution Order

- **Setup (T001–T004)** → **Foundational (T005–T011)** → stories.
- **US1** (schedule, edit, delete, NEXT ACTIVITIES) needs Foundational. **US2** (tick, timeline, follow-up) needs US1's box, `NextActivities` and domain file. **US3** (list) needs US1 (box, actions) and US2 (`DoneBox`). **US5** (privacy) checks US1–US3 together, so it runs after them although it is P1; its board and notification cases complete in US4/US6. **US4** (cards) needs US1 (and US2 for the tick-in-drawer case). **US6** (notifications) needs US1 (assignment columns written by schedule/edit).
- Within each story: tests first (fail), then domain functions, then actions, then pages/components.
- T051 (seed) after US6 (it needs assignment notifications); T062 is the last task.

### Parallel opportunities

- Setup: T002, T003, T004 together after T001.
- Foundational: T005, T006, T009, T011 together; T007 after T005, T008 after T006; T010 beside them.
- Every story's test tasks marked [P] together (different files).
- US1: T021 and T023 together after T020; T018 beside T017. US4 and US6 can run in parallel once US2 is done (different files: `deals.ts`/`Board.tsx` vs `notifications.ts`/notifications page).
- Polish: T051–T054, T056–T058 together.

### Parallel example: User Story 1

```text
T012 tests/integration/activities.test.ts
T013 tests/integration/activity-page.test.ts
T014 tests/integration/archive-delete.test.ts
T015 tests/integration/handover.test.ts
```

### Parallel example: User Story 3

```text
T034 tests/integration/activities-list.test.ts
T035 tests/integration/activities-list-performance.test.ts
T036 tests/unit/nav.test.ts, tests/unit/list-query.test.ts
```

## Implementation Strategy

- **MVP**: Setup + Foundational + US1 (activities on every record, privacy already enforced by `visibleActivity` from T010), then US2 and US3, the other P1 stories that make activities useful day to day, then US5's cross-cutting privacy tests.
- Then US4 (P2 card warning) and US6 (P2 assignment notifications); each checkpoint is a working, tested increment.
- Choices made here without asking: US5 is placed after US3 because its scenarios check every surface built by US1–US3 (its board and notification cases are completed in US4 and US6 tests); the Supabase Postgres task (T016) sits in US1, the first story whose code writes the new table; the seed is in the Polish phase because it needs every story's tables and functions; the test recipe (T062) is the last task. After the person's reply on 2026-11-23, every browser test task became a unit or integration task with the same ID, the `npm run test:e2e` task and the walk-through of quickstart.md in the running app were removed (the AI review performs those scenarios), and the last two tasks were renumbered T061 and T062.
