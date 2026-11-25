---

description: "Tasks for SF-123: activity reminders in the app"
---

# Tasks: Activity reminders in the app

**Input**: Design documents from `specs/sf-123-step-17-activity-reminders-in-the-app/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested (spec SC-001–SC-004 are "in automated tests"; AGENTS.md: unit + integration, no browser tests).
Each test names what it covers (`// covers FR-003, US1 scenario 1`). Integration tests use real Postgres
(`tests/support/reset.ts`) and pass an explicit `now` (research.md §3); no sleeps, no clock tricks.

**Outside services**: none (plan.md has no `## Outside services` section): no schema download, no fake.
**Blueprints**: `blueprints.json` is `[]`: no blueprint tasks, no `docs/DECISIONS.md` exception line.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Create `migrations/0017_activity_reminders.sql` (research.md §6, data-model.md): `alter table activities add column remind_at timestamptz null, add column reminder_read_at timestamptz null;` then the backfill `update activities set remind_at = case when due_time is null then (due_on + time '09:00') at time zone 'Europe/London' else ((due_on + due_time) at time zone 'Europe/London') - interval '15 minutes' end where done_at is null and case when due_time is null then ((due_on + 1)::timestamp at time zone 'Europe/London') > now() else ((due_on + due_time) at time zone 'Europe/London') > now() end;` then `create index activities_reminder_idx on activities (assignee_id, remind_at desc) where done_at is null and remind_at is not null;`. A header comment (SF-123, `remind_at` null = no reminder). Only transaction-safe statements; no new table so no RLS line; no check constraint. Apply it to the dev and test databases (`npm run db:migrate`).

---

## Phase 2: Foundational (blocks every story)

- [x] T002 [P] Unit tests in `tests/unit/activities-rules.test.ts` (covers FR-001, FR-007, SC-001, spec Edge Cases): `reminderAt` timed `{dueOn:"2026-11-25", dueTime:"10:00"}` → `2026-11-25T09:45:00Z`; untimed 09:00 UK in January (`09:00Z`) and July (`08:00Z`); `{dueOn:"2026-03-29", dueTime:"02:10"}` → `2026-03-29T00:55:00Z` (clocks forward); 25 Oct 2026 `01:30` overlap takes the BST reading (`00:15Z` reminder); a call at `00:10` reminds `23:55` the day before; `dueMoment` timed = start (duration ignored), untimed = start of the next UK day; `reminderFor` returns the reminder time when saved 10 minutes before the due moment (reminder already past, kept), null at or after the due moment, untimed saved at 09:30 on its due date → 09:00 that day, untimed saved the next day → null.
- [x] T003 Add to `src/server/activities/rules.ts` (research.md §2, contracts/routes.md): `export const REMINDER_LEAD_MINUTES = 15`, `export const UNTIMED_REMINDER_TIME = "09:00"`, `reminderAt(due: { dueOn: string; dueTime: string | null }): Date` (timed: `ukInstant(dueOn, dueTime) − 15 min` in real minutes; untimed: `ukInstant(dueOn, "09:00")`), `dueMoment(due): Date` (timed: `ukInstant(dueOn, dueTime)`; untimed: `ukInstant(addDays(dueOn, 1), null)`), `reminderFor(due, now: Date): Date | null` (`dueMoment(due) > now ? reminderAt(due) : null`). Pure, no database import. Makes T002 pass.
- [x] T004 [P] Add `templates.reminder_title(type: string, subject: string, time: string | null)` to `src/server/messages.ts` under the SF-109 activity lines: `` `${type}: ${subject} at ${time}` `` or `` `${type}: ${subject}` `` when `time` is null.
- [x] T005 In `src/server/notifications.ts` add the reminder kind (research.md §5, data-model.md § Types): `ReminderView = { kind: "reminder"; id; type; subject; dueOn; dueTime; durationMinutes; href; createdAt; read }`, `NotificationView` union + `ReminderView`, `NotificationRef.kind` `"mention" | "assignment" | "reminder"`; fragment `myReminders(db, userId, now)` = `a.assignee_id = ${userId} and a.done_at is null and a.remind_at is not null and a.remind_at <= ${now} and ${visibleActivity(db, userId)}` (no `assigned_by` condition). Add `now: Date = new Date()` as the last parameter of `listNotifications`, `unreadCount`, `openNotification`, `markAllRead` (unused by the mention/assignment parts). Update the header comment (SF-123).

**Checkpoint**: rules, text and types exist; nothing writes `remind_at` yet except the migration.

---

## Phase 3: User Story 1 — Be reminded before a planned activity is due (P1) 🎯 MVP

**Goal**: a planned activity's assignee sees and counts its reminder from its reminder time, opens it to the record.

**Independent Test**: schedule a call for yourself due 20 minutes after `now`; `listNotifications`/`unreadCount` at `now`, `now + 4 min` show nothing; at `now + 5 min` one unread "Call: … at HH:MM"; open it → deal href, count − 1.

### Tests for User Story 1

- [x] T006 [P] [US1] Create `tests/integration/activity-reminders.test.ts` with US1 tests (covers FR-001–FR-004, FR-008, US1 scenarios 1–6, SC-001, SC-005): scheduled via `scheduleActivity(actor, form, now)` and read with explicit `now`: (1) timed call due at 10:00, nothing at 09:44, at 09:45 listed as `kind: "reminder"`, `createdAt` = 09:45 instant, counted unread, rendered title `templates.reminder_title("Call", subject, "10:00")`; (2) untimed task listed from 09:00 UK on its due date, not at 08:59; (3) none before; (4) `openNotification(user, { kind: "reminder", id }, now)` returns the deal href, else person, else organisation, else `/activities`, marks read, count − 1; `markAllRead(user, now)` marks shown reminders read and leaves a reminder still to come unread (it shows Unread when its time comes); (5) self-scheduled activity gets a reminder; (6) Ada assigns to Bob: Bob has an assignment and a reminder line, opening the reminder leaves the assignment unread. Edge cases: scheduled with due moment < 15 min ahead → shown at once; due moment already past → no reminder ever, count unchanged; two reminders with the same time listed by activity id desc, same order twice; archived linked deal → listed, opens `/deals/<id>`; a reminder stays listed after the due moment (exactly one line for the activity); 29 Mar 2026 02:10 call (clocks forward): not listed at `2026-03-29T00:50:00Z`, listed at `2026-03-29T00:55:00Z` with date `formatDateTime` "29 Mar 2026, 00:55".
- [x] T007 [P] [US1] Add to `tests/integration/activity-reminders.test.ts` the action test (covers FR-004, contracts/routes.md): posting `kind=reminder` and an id to `openNotification` in `src/app/(app)/notifications/actions.ts` (as the existing notifications action tests do) marks the reminder read and redirects to the record; an unknown `kind` is treated as a mention; another user's reminder id redirects to `/notifications` and changes nothing.

### Implementation for User Story 1

- [x] T008 [US1] In `src/server/activities/activities.ts` `scheduleActivity(actorId, form, now = new Date())`: insert `remind_at = ${reminderFor(value, now)}` (`reminder_read_at` left null). Callers pass nothing.
- [x] T009 [US1] In `src/server/notifications.ts` add `listReminders(userId, limit, now)` (select `a.id`, `a.type`, `a.subject`, `to_char(a.due_on,'YYYY-MM-DD')`, `to_char(a.due_time,'HH24:MI')`, `a.duration_minutes`, the three link ids, `a.remind_at`, `a.reminder_read_at is not null as read` from `activities a where ${myReminders(sql, userId, now)} order by a.remind_at desc, a.id desc limit ${limit}`; `href(r)`, `createdAt: remind_at`) and merge it into `listNotifications` beside `listAssignments(userId, limit + 1)` (stable sort newest first). `unreadCount`: add `+ (select count(*) from activities a where a.reminder_read_at is null and ${myReminders(sql, userId, now)})::int`. `openNotification`: `kind === "reminder"` → `openReminder(userId, id, now)`: `update activities a set reminder_read_at = coalesce(a.reminder_read_at, ${now}) where a.id = ${id} and ${myReminders(sql, userId, now)} returning` the link ids → `{ href: href(row) }`, else null. `markAllRead`: third update in the same transaction `update activities set reminder_read_at = ${now} where assignee_id = ${userId} and done_at is null and remind_at <= ${now} and reminder_read_at is null`.
- [x] T010 [US1] In `src/app/(app)/notifications/actions.ts` `openNotification`: `kind` = `"assignment"` or `"reminder"` when the posted value is exactly that, else `"mention"`; update the comment.
- [x] T011 [US1] In `src/app/(app)/notifications/page.tsx`: a helper `anchorOf(n)` → `n-<eventId>` / `a-<id>` / `r-<id>` used for the `<li>` key/id and the [ SHOW MORE ] anchor; a reminder line's title `templates.reminder_title(TYPE_LABELS[n.type], n.subject, n.dueTime)` (import `TYPE_LABELS` from `@/server/activities/rules`), its second line `templates.activity_due(formatDue(n))`, the hidden `id` input `n.id`; update the page comment (SF-123). No `dangerouslySetInnerHTML`: the subject shows exactly as typed.

**Checkpoint**: US1 tests pass; a new activity reminds its assignee.

---

## Phase 4: User Story 2 — The reminder follows the activity (P1)

**Goal**: move, reassign, tick, untick, delete and other edits keep the reminder matching the activity.

**Independent Test**: with a shown reminder, `editActivity` to tomorrow → gone now, unread tomorrow at the new time; reassign to Bob → Ada's gone, Bob's at the reminder time; tick → gone; untick before due → back as it was.

### Tests for User Story 2

- [x] T012 [P] [US2] Add US2 tests to `tests/integration/activity-reminders.test.ts` (covers FR-005, FR-006, FR-007, US2 scenarios 1–6, SC-002): (1) due time moved → old reminder gone, new unread at the new time; moved so the new reminder time is past but the due moment is not → shown at once, unread even if the old one was read; (2) moved to a due moment already past → no reminder; (3) reassigned Ada → Bob: Ada's list/count drop it, Bob's shows it unread at the reminder time (at once when past, due ahead); (4) tick → not listed or counted; untick before the due moment → back with its read state (read stays read, unread stays unread); untick after the due moment → none, and none after a later edit of the subject only; (5) `deleteActivity` → gone; deleting the linked deal / person / organisation (via the existing record deletes that delete the activity) → gone; a record delete that keeps the activity (link set null) → reminder kept, href falls to the next link; (6) edit of subject / type / note / duration / links only → same `createdAt` and read state, new type and subject in the title.

### Implementation for User Story 2

- [x] T013 [US2] In `src/server/activities/activities.ts`: `lockActivity` also selects `to_char(a.due_on,'YYYY-MM-DD') as due_on, to_char(a.due_time,'HH24:MI') as due_time` (add to `Locked`); `editActivity(actorId, id, version, form, now = new Date())`: when `value.dueOn !== cur.due_on || value.dueTime !== cur.due_time || reassigned`, the update also sets `remind_at = ${reminderFor(value, now)}, reminder_read_at = null`; otherwise both columns untouched.
- [x] T014 [US2] In `src/server/activities/activities.ts` `untickActivity(actorId, id, now = new Date())`: read the locked row's due (from `lockActivity`, T013) and, when `dueMoment(due) <= now`, the update also sets `remind_at = null, reminder_read_at = null`; otherwise leaves them. Add comments on `tickActivity` (the reminder is hidden by `done_at`, kept for an untick) and `deleteActivity` (the reminder goes with the row).

**Checkpoint**: US1 + US2 tests pass.

---

## Phase 5: User Story 3 — Reminders stay private like the activity (P2)

**Goal**: only the assignee, only while they can see every linked record.

**Independent Test**: Bob's shown reminder on Ada's deal; Ada makes the deal private → Bob neither sees nor counts it, cannot open it; shared again → back with its read state.

### Tests for User Story 3

- [x] T015 [P] [US3] Add US3 tests to `tests/integration/activity-reminders.test.ts` (covers FR-002, US3 scenarios 1–3, SC-003, spec Edge Cases): deal made private (Bob not creator/owner) → not listed, not counted, `openNotification(bob, { kind: "reminder", id })` → null and read state unchanged; made shared again → back unread/read as before; same with a private linked person; an admin and any other user never list someone else's reminder; assignee deactivated → no other user lists it, reassigned to an active user → listed for them as US2 scenario 3; hand-over of a deactivated user's private deal (`src/server/records/handover.ts`): the activity's assignee keeps the reminder only while they can see the deal, the new owner does not get it.

### Implementation for User Story 3

- [x] T016 [US3] Check that every reminder read and write in `src/server/notifications.ts` goes through `myReminders` (with `visibleActivity`), including `openReminder`; fix any that do not. No other code expected (T005, T009 already apply the rule).

**Checkpoint**: US1–US3 tests pass.

---

## Phase 6: User Story 4 — Try reminders with the fake data (P3)

**Goal**: reminders visible after `npm run db:seed`, without waiting.

**Independent Test**: seed twice; Ada Fake has a shown unread timed reminder, a shown unread untimed one, a read one, and one still to come; no duplicates.

### Tests for User Story 4

- [x] T017 [P] [US4] Extend `tests/integration/seed.test.ts` (covers FR-010, US4 scenario 1): after two seed runs, `listNotifications(ada)` has an unread reminder with a time, an unread one without, a read one; Ada has a planned activity with `remind_at > now()`; each reminder subject appears once; overdue seeded activities ("Fake call: chase the signed proposal") have no reminder.

### Implementation for User Story 4

- [x] T018 [US4] In `src/seed/activities.ts` (research.md §8): planned seeds insert `remind_at = reminderFor({ dueOn, dueTime }, now)` (done ones null); add for Ada Fake, found by exact subject as the others: "Fake call: reminder test call" (call, due at the next 5-minute mark at least 5 minutes after `now`, as UK day and time of that instant; deal "Sample Gyms CRM" with `linksFromDeal`; `remind_at = reminderAt(due)`, unread), "Fake task: reminder test task" (task, no time, due today when UK time is 09:00 or later, else yesterday; `remind_at = reminderAt(due)`, unread), "Fake meeting: reminder already seen" (meeting, yesterday 14:00, 30 min, organisation "Fakeco Ltd", `remind_at = reminderAt(due)`, `reminder_read_at` one hour after it). Extend the `Seed` type (e.g. `reminder?: "unread" | "read"`, `dueAt?: "soon" | "untimedShown"`) and the header comment.

**Checkpoint**: all stories pass.

---

## Phase 7: Polish & cross-cutting

- [x] T019 [P] Performance test in `tests/integration/activity-reminders.test.ts` (covers SC-004), shaped like `tests/integration/lists-performance.test.ts`: one user with 500 planned activities (half with shown reminders) and 200 notifications (mentions and assignments); `listNotifications` and `unreadCount` each under 1 s.
- [x] T020 Run the existing suites touched by reminders — `tests/integration/notifications.test.ts`, `tests/integration/activity-notifications.test.ts`, `tests/integration/notes-private.test.ts`, `tests/integration/unsubscribe.test.ts`, the activities tests — and where they now also see a reminder (an activity due soon for the user), adjust their due dates or expected counts, never the reminder rule.
- [x] T021 [P] Update `AGENTS.md` Layout: in the `activities/` lines, `reminderAt` / `dueMoment` / `reminderFor` in `rules.ts` and the `remind_at` / `reminder_read_at` columns set by schedule / edit / untick (SF-123); in the `notifications.ts` line, reminders as the third kind (shown from `remind_at` while planned, through `visibleActivity()`).
- [x] T022 Run `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test; npm test && npm run typecheck` and the manual check of `specs/sf-123-step-17-activity-reminders-in-the-app/quickstart.md`; fix failures.
- [x] T023 Write the test recipe `.factory/test-env.md`: this feature adds no outside service and no schema, so keep the existing `## Services` and `## Schemas` lines as they are and add only what the reminder tests need (an explicit `now`, no fake, no new setting).

---

## Dependencies & execution order

- Phase 1 (T001) → Phase 2 (T002–T005) → stories.
- US1 (T006–T011) first: US2–US4 read reminders through its `listReminders` / `unreadCount` / `openReminder`.
- US2 (T012–T014) after US1. US3 (T015–T016) after US1 (independent of US2). US4 (T017–T018) after US1 (uses `reminderFor`, T003).
- Polish after the stories; T023 last.
- Within a story: tests first (they fail), then implementation.

## Parallel opportunities

- T002 ∥ T004 (different files); T003 after T002; T005 after T004 only by convention (different file, can run in parallel).
- US1: T006 ∥ T007 (same file, separate `describe` blocks: write in one go if one agent), then T008 ∥ T010 ∥ T011, T009 after T005.
- After US1: US3 (T015–T016) ∥ US4 (T017–T018) ∥ US2 (T012–T014) — different files except the shared test file (separate `describe` blocks).
- T019 ∥ T021.

## Implementation strategy

- **MVP**: Phases 1–3 (US1): new activities remind their assignee, shown, counted, opened, marked read.
- Then US2 (no stale reminders: needed before release, P1 too), US3 (privacy tests), US4 (fake data), polish.
- Commit after each phase; the factory commits at the end of the session.
