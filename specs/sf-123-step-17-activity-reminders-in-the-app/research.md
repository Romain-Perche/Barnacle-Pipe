# Research: Activity reminders in the app (SF-123)

No NEEDS CLARIFICATION was left in the Technical Context: the spec's clarification fixed the lead times, and the rest
follows the SF-109 activities and SF-102/SF-109 notifications code already in the repo. Each choice below is a design
decision for Build.

## §1 Where a reminder lives: two columns on the activity row

- **Decision**: `activities.remind_at timestamptz null` (the reminder time; null = this activity has no reminder) and
  `activities.reminder_read_at timestamptz null`. No new table.
- **Rationale**: at most one reminder per activity, always for the current assignee (spec Key Entities). SF-109 already
  keeps the assignment notification on the activity row (`assigned_by`, `assigned_at`, `assignment_read_at`); the
  reminder follows the same pattern, so delete (direct, or a record delete that sets links to null) needs nothing more,
  and reassigning is one `update` of the same row inside the existing transaction.
- **Alternatives**: a `reminders` table (one row per activity) — a second place to keep in step with every change,
  for no gain; computing the reminder time at read from `due_on`/`due_time` only — cannot say "no reminder" for an
  activity saved after its due moment (FR-007) or for those already past at go-live, so a stored value is needed anyway.

## §2 The reminder time and the due moment (pure, `src/server/activities/rules.ts`)

- **Decision**: two new pure functions next to `ukInstant`:
  - `reminderAt(due: { dueOn; dueTime }): Date` — timed: `ukInstant(dueOn, dueTime) − 15 min` (15 real minutes, so across
    the clocks changing it is still 15 minutes: 02:10 on 29 Mar 2026 → 00:55 GMT, spec Edge Cases); untimed:
    `ukInstant(dueOn, "09:00")` (09:00 UK in winter and summer).
  - `dueMoment(due): Date` — timed: `ukInstant(dueOn, dueTime)` (its start; the duration does not move it); untimed: the
    start of the next UK day, `ukInstant(addDays(dueOn, 1), null)` (the moment SF-109 `activityState` turns an untimed
    activity overdue).
  - `reminderFor(due, now: Date): Date | null` — `dueMoment(due) > now ? reminderAt(due) : null` (FR-005, FR-007). A
    reminder time already past with a due moment still ahead is kept as is: the reminder shows at once (spec Edge Cases).
  - `REMINDER_LEAD_MINUTES = 15`, `UNTIMED_REMINDER_TIME = "09:00"` exported constants.
- **Rationale**: all UK time rules already live in `rules.ts` with `now` as a parameter (unit-testable across midnight and
  DST, SC-001). `ukInstant` already handles the autumn overlap (first, BST, reading) and the spring gap (refused by
  `validateActivity`).
- **Alternatives**: compute in SQL with `at time zone 'Europe/London'` everywhere — used once, only for the migration
  backfill (§6), because the app's other UK rules are in TypeScript and are tested there.
- The "due moment" of an untimed activity is a factory choice (recorded in spec Clarifications, to confirm).

## §3 One clock: the app's `now`, passed in

- **Decision**: every function that decides or shows reminders takes an optional `now: Date = new Date()` as its last
  parameter: `scheduleActivity`, `editActivity`, `untickActivity` (deciding `remind_at`), `listNotifications`,
  `unreadCount`, `openNotification`, `markAllRead` (showing: `a.remind_at <= ${now}`).
- **Rationale**: integration tests can then check "not before, at, after" the reminder time without waiting or changing
  the database clock (SC-001), like `src/server/activities/list.ts` already takes `now`. Callers in the app pass nothing.
- **Alternatives**: the database `now()` — untestable without sleeps or clock tricks.

## §4 How each activity change moves the reminder (FR-005, FR-006, US2)

| Change (in `src/server/activities/activities.ts`) | `remind_at` | `reminder_read_at` |
|---|---|---|
| `scheduleActivity` | `reminderFor(value, now)` | null |
| `editActivity`, due date or time changed, or assignee changed | `reminderFor(value, now)` | null |
| `editActivity`, only type / subject / note / duration / links changed | unchanged | unchanged |
| `tickActivity` | unchanged (hidden by `done_at is not null`) | unchanged |
| `untickActivity`, due moment still ahead | unchanged ("back as it was, read or unread") | unchanged |
| `untickActivity`, due moment passed | null (never comes back) | null |
| `deleteActivity`, or a record delete | row gone / row kept with links set to null: reminder kept, lands on the next link or `/activities` | — |

`editActivity` compares the new `dueOn`/`dueTime` with the locked row: `lockActivity` reads `due_on`, `due_time` too
(`to_char` text, as elsewhere). The untick update becomes
`set done_at = null, done_by = null, version = version + 1, remind_at = case when … then remind_at else null end` with the
due-moment check done in TypeScript from the row it locked (`dueMoment(row) <= now`).

Note: deleting a record sets the activity's link to null (`on delete set null`); SF-109 already deletes the activities of
a deleted record where its spec says so — the reminder goes with the row in every case, nothing to add.

## §5 Showing reminders (`src/server/notifications.ts`)

- **Decision**: a third kind beside `mention` and `assignment`:
  - `myReminders(db, userId, now)` fragment: `a.assignee_id = ${userId} and a.done_at is null and a.remind_at is not null
    and a.remind_at <= ${now} and ${visibleActivity(db, userId)}` (FR-002; no `assigned_by` condition: self-scheduled
    activities get reminders, FR-008).
  - `ReminderView = { kind: "reminder"; id; type; subject; dueOn; dueTime; durationMinutes; href; createdAt (= remind_at); read }`.
  - `listReminders(userId, limit, now)`: `order by a.remind_at desc, a.id desc limit ${limit}`; merged into
    `listNotifications` with the mentions and assignments (top `limit + 1` of each, sorted newest first; `Array.sort` is
    stable so equal times keep the per-kind order: same order on every reload).
  - `unreadCount`: `+ (select count(*) from activities a where a.reminder_read_at is null and ${myReminders(…)})`.
  - `openNotification(userId, { kind: "reminder", id }, now)` → `openReminder`: `update activities a set reminder_read_at =
    coalesce(a.reminder_read_at, ${now}) where a.id = ${id} and ${myReminders(…)} returning` the links → `href(row)`; else
    null (hidden, done, not yet due, someone else's: the same answer as any hidden notification, US3 scenario 1).
  - `markAllRead(userId, now)`: also `update activities set reminder_read_at = ${now} where assignee_id = ${userId} and
    done_at is null and remind_at <= ${now} and reminder_read_at is null` (reminders still to come stay unread, FR-004).
    Hidden ones may be marked too, as for mentions and assignments (harmless: neither shown nor counted).
- `NotificationRef.kind` gains `"reminder"`. `src/app/(app)/notifications/actions.ts` reads `kind` as `"assignment"`,
  `"reminder"`, else `"mention"`.
- **Rationale**: reuses the SF-109 assignment pattern line for line, so the visibility rule, the sidebar refresh (SF-108
  `currentSidebar`) and the page need no new mechanism.

## §6 Go-live: the migration backfill

- **Decision**: `migrations/0017_activity_reminders.sql` adds the two columns and fills `remind_at` only for planned
  activities whose due moment is still ahead at migration time (FR-007, spec Edge Cases):
  ```
  update activities set remind_at = case when due_time is null
      then (due_on + time '09:00') at time zone 'Europe/London'
      else ((due_on + due_time) at time zone 'Europe/London') - interval '15 minutes' end
  where done_at is null and case when due_time is null
      then ((due_on + 1)::timestamp at time zone 'Europe/London') > now()
      else ((due_on + due_time) at time zone 'Europe/London') > now() end;
  ```
  Postgres gives an ambiguous autumn-overlap wall time the offset before the change (BST), like `ukInstant`.
  `reminder_read_at` stays null. Only transaction-safe statements (AGENTS.md); no new table, so no RLS line.
- Index: `create index activities_reminder_idx on activities (assignee_id, remind_at desc) where done_at is null and
  remind_at is not null;` (the list order and the count, SC-004).

## §7 Text (FR-003, `src/server/messages.ts`)

- `templates.reminder_title(type: string, subject: string, time: string | null)` →
  `` `${type}: ${subject} at ${time}` `` or `` `${type}: ${subject}` `` with `type` the `TYPE_LABELS` value ("Call").
- The second line reuses `templates.activity_due(formatDue(n))` ("Due 25 Nov 2026 10:00–10:30"); the date is
  `formatDateTime(remind_at)`. React escapes the subject: `<b>Call</b> https://example.com` shows as typed, no link.
- Page row key/anchor `r-${id}` (mentions `n-`, assignments `a-`), also in the [ SHOW MORE ] anchor.

## §8 Fake data (FR-010, US4)

- `src/seed/activities.ts`: every seeded planned activity gets `remind_at = reminderFor(due, now)` at insert time, so the
  later ones ("Fake call: intro call", in 2 days) have a reminder still to come and the overdue ones none.
- Three more seeds for Ada Fake (same idempotence: found by exact subject):
  - "Fake call: reminder test call" — timed, due at the next 5-minute mark at least 5 minutes from now (UK day and time
    of that instant) on deal "Sample Gyms CRM": its reminder time has passed → shown, unread.
  - "Fake task: reminder test task" — untimed, due today when UK time is 09:00 or later, else yesterday: shown, unread.
  - "Fake meeting: reminder already seen" — timed, due yesterday 14:00, 30 min, `remind_at` 13:45 yesterday,
    `reminder_read_at` an hour after it: shown, read (a reminder stays listed after its due moment).
  These three set `remind_at` from `reminderAt(due)` directly (they stand for activities scheduled earlier).
- **Alternatives**: seed reminders with fixed far-future times — would not show without waiting a clock (US4).

## §9 Outside services and dependencies

None: reminders are rows in the app's own Postgres, shown on the app's own pages; no email, no push, no cron (FR-009,
"appears on the next page load"). No new package.
