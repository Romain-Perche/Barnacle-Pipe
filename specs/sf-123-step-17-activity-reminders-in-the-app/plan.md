# Implementation Plan: Activity reminders in the app

**Branch**: `factory/sf-123-step-17-activity-reminders-in-the-app` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/sf-123-step-17-activity-reminders-in-the-app/spec.md`

## Summary

Every planned activity gets one in-app reminder for its current assignee: 15 minutes before a timed activity, 09:00 UK
time on the due date of an untimed one. The reminder is two columns on the `activities` row (`remind_at`,
`reminder_read_at`), set by the existing activity changes (schedule, edit, untick) from pure UK-time rules, and shown by
`src/server/notifications.ts` as a third notification kind beside mentions and assignments, through `visibleActivity()`.
No new page, no email, no cron, no outside service: a reminder simply starts to count once `remind_at <= now`, on the
next page load or navigation (SF-108 sidebar refresh).

## Technical Context

**Language/Version**: TypeScript 5, Node (Next.js 16 App Router, React 19)

**Primary Dependencies**: `postgres` (postgres.js, plain SQL); nothing new

**Storage**: Postgres — two columns and one partial index on `activities` (migration `0017_activity_reminders.sql`)

**Testing**: Vitest unit (pure rules) and integration (real Postgres, `tests/support/reset.ts`)

**Target Platform**: Vercel (server components, server actions)

**Project Type**: web application (single Next.js project)

**Performance Goals**: Notifications page and sidebar count < 1 s with 500 planned activities and 200 notifications (SC-004)

**Constraints**: UK time (Europe/London) across DST; reminders only from their reminder time; privacy through
`visibleActivity()`; all text from `src/server/messages.ts`

**Scale/Scope**: a small team; ~8 changed source files, 1 migration, tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template (no principles). The gates are the project rules of
`AGENTS.md` and `docs/DECISIONS.md`:

| Gate | Status |
|---|---|
| Server components by default; no new client component | Pass (page change only, server component) |
| Every server action calls `requireUser()` first | Pass (`openNotification`, `markAllNotificationsRead` unchanged in that respect) |
| User-facing text from `messages.ts`; nothing from a URL | Pass (`templates.reminder_title`; `kind` mapped to a fixed set) |
| Migrations: transaction-safe statements only; RLS after every `create table` | Pass (`alter table add column`, `update`, `create index`; no table) |
| Every `activities` read through `visibleActivity()` | Pass (`myReminders` fragment) |
| Fake data clearly fake, idempotent | Pass ("Fake …" subjects, found by subject) |
| Reminders in the app only, the CRM sends no email (DECISIONS 2026-11-24) | Pass (FR-009) |
| No browser tests (DECISIONS) | Pass (unit + integration) |

Re-check after Phase 1 design: unchanged, all pass. No complexity to justify.

## Project Structure

### Documentation (this feature)

```text
specs/sf-123-step-17-activity-reminders-in-the-app/
├── plan.md              # this file
├── research.md          # Phase 0: decisions §1–§9
├── data-model.md        # Phase 1: columns, derived reminder, state changes
├── quickstart.md        # Phase 1: how to check it
├── contracts/routes.md  # Phase 1: page, actions, server functions
├── dependencies.json    # [] — no new package
├── blueprints.json      # [] — unchanged (no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
migrations/0017_activity_reminders.sql            # NEW: columns, backfill, index
src/server/activities/rules.ts                    # + reminderAt, dueMoment, reminderFor, constants
src/server/activities/activities.ts               # schedule / edit / untick set remind_at; `now` parameter
src/server/notifications.ts                       # ReminderView, myReminders, listReminders, count, open, mark all
src/server/messages.ts                            # + templates.reminder_title
src/app/(app)/notifications/page.tsx              # third kind of line (r-<id>)
src/app/(app)/notifications/actions.ts            # kind "reminder"
src/seed/activities.ts                            # remind_at on seeds + three reminder seeds
AGENTS.md                                         # one line under SF-109/notifications: reminders (SF-123)
tests/unit/activities-rules.test.ts               # reminder rules
tests/integration/activity-reminders.test.ts      # NEW: US1–US3, edge cases, performance
tests/integration/seed.test.ts                    # FR-010
```

**Structure Decision**: the existing single Next.js project; reminders extend the SF-109 activity row and the SF-102/SF-109
notifications module rather than adding a module (research.md §1, §5).

## Implementation steps (for Build)

1. **Migration** `migrations/0017_activity_reminders.sql` (research.md §6): `alter table activities add column remind_at
   timestamptz null, add column reminder_read_at timestamptz null;` the backfill `update` for planned activities whose
   due moment is after `now()`; `create index activities_reminder_idx on activities (assignee_id, remind_at desc) where
   done_at is null and remind_at is not null;`. Nothing else; never run at app start.
2. **Pure rules** in `src/server/activities/rules.ts` (research.md §2): `REMINDER_LEAD_MINUTES = 15`,
   `UNTIMED_REMINDER_TIME = "09:00"`, `reminderAt`, `dueMoment` (untimed: start of the next UK day via the existing
   `addDays` + `ukInstant`), `reminderFor(due, now)`. Unit tests: timed / untimed; saved 10 min before (shown at once),
   after the due moment (null); untimed saved at 09:30 on its due date (reminder 09:00, kept); 29 Mar 2026 02:10 →
   2026-03-29T00:55Z; 25 Oct 2026 01:30 (overlap, BST reading); 09:00 untimed in January (09:00Z) and July (08:00Z).
3. **Activity changes** in `src/server/activities/activities.ts` (research.md §3–§4): add `now: Date = new Date()` as the
   last parameter of `scheduleActivity`, `editActivity`, `untickActivity`.
   - `scheduleActivity`: insert `remind_at = reminderFor(value, now)`.
   - `lockActivity` also returns `due_on`/`due_time` (`to_char`) so `editActivity` can tell a due change; when the due
     date, due time or assignee changes, the update adds `remind_at = ${reminderFor(value, now)}, reminder_read_at = null`;
     otherwise both columns are left alone.
   - `untickActivity`: read the row's due; when `dueMoment(due) <= now` also set `remind_at = null, reminder_read_at = null`.
   - `tickActivity`, `deleteActivity`, record deletes: no change (comment that the reminder goes with/hides with the row).
   - Callers (server actions in `src/app/(app)/activities/actions.ts` etc.) pass nothing.
4. **Notifications** in `src/server/notifications.ts` (research.md §5): `ReminderView`, `NotificationRef.kind` +
   `"reminder"`, `myReminders(db, userId, now)`, `listReminders(userId, limit, now)` ordered `remind_at desc, id desc`,
   merged in `listNotifications(userId, limit = 50, now = new Date())`; `unreadCount(userId, now)` third sum;
   `openNotification(userId, ref, now)` → `openReminder`; `markAllRead(userId, now)` third update limited to
   `done_at is null and remind_at <= now`. Update the header comment (SF-123).
5. **Text**: `templates.reminder_title(type, subject, time)` in `src/server/messages.ts` under the SF-109 activity lines.
6. **Page** `src/app/(app)/notifications/page.tsx`: key/anchor `r-${id}`; title `templates.reminder_title(TYPE_LABELS[n.type],
   n.subject, n.dueTime)`; second line `templates.activity_due(formatDue(n))`; the [ SHOW MORE ] anchor handles the third
   kind (a small `anchorOf(n)` helper). Update the page comment.
7. **Action** `src/app/(app)/notifications/actions.ts`: `kind` = `"assignment"` | `"reminder"` | `"mention"` from the
   posted value (fixed set; anything else is a mention).
8. **Fake data** `src/seed/activities.ts` (research.md §8): seeds get `remind_at = reminderFor(due, now)`; add the three
   reminder seeds for Ada Fake with an optional `remindRead` / explicit reminder in the `Seed` type; header comment.
9. **AGENTS.md**: in the `activities/` / `notifications.ts` Layout lines, note the reminder (SF-123): columns
   `remind_at` / `reminder_read_at` on the activity row, `reminderFor` in `rules.ts`, the third notification kind.
10. **Tests** (each names what it covers, `// covers FR-…, US… scenario …`): `tests/integration/activity-reminders.test.ts`
    with an explicit `now` for US1 1–6, US2 1–6, US3 1–3 and the edge cases (self-assigned, past due at save, archived
    link lands on the archived record, deactivated assignee, hand-over, equal reminder times order, subject shown as
    typed), and SC-004 (500 planned activities + 200 notifications, list and count < 1 s, as in
    `tests/integration/lists-performance.test.ts`); extend `tests/integration/seed.test.ts` (FR-010: two seed runs, no
    duplicate, the three reminder kinds and one still to come). Existing tests that schedule activities for a user and
    then assert `unreadCount` / `listNotifications` may now also see a reminder: adjust their expectations (or their
    due dates) rather than the rule.

## Fix round 1

**Problem** (AI review): the lead time people chose in the spec's clarification (15 minutes before a timed activity,
09:00 UK time on the due date for an activity with no time) is not in `docs/DECISIONS.md`, the team's record of
choices.

**Cause**: the plan's Constitution Check only checked the existing reminders line (2026-11-24) and no task updated
`docs/DECISIONS.md`. The code is right; only the record of the choice is missing.

**Fix**: extend the existing reminders line of `docs/DECISIONS.md` (the one starting "Activity reminders are in the
app", dated 2026-11-24): keep its text and add the lead time and the choice from the plan review (2026-11-25, option A),
and end it with `(SF-123)` instead of the date. Text to use:

`- Activity reminders are in the app (the Notifications page and the sidebar count, like assignments) and by email,
which Google Calendar sends from the email reminder the CRM puts on the synced event; the CRM sends no reminder email
itself. A reminder comes 15 minutes before a timed activity and at 09:00 UK time on the due date of an activity with
no time (at once when it is scheduled later that day) (SF-123)`

Reply (2026-11-25, alexis@barnacle.ai): option A, without the Calendar sentence. Google Calendar reminds only 15 minutes
before timed activities, and SF-124 (Google Calendar two-way sync) records its own line for its email reminders; the
line says nothing about the Calendar issue's timing, and the spec's Assumptions no longer ask for it.

One line, not a second one: the reminders rule stays in one place. No code change, no spec change (the user gets the
same app).

**Files**: `tests/unit/decisions.test.ts` (new `describe` for SF-123), `docs/DECISIONS.md`.

## Complexity Tracking

No constitution or project-rule violation to justify.
