# Data model: Activity reminders in the app (SF-123)

## Activity (SF-109 `activities`), two new columns — `migrations/0017_activity_reminders.sql`

| Column | Type | Meaning |
|---|---|---|
| `remind_at` | `timestamptz null` | The reminder time; null: this activity has no reminder (saved after its due moment, or past at go-live, or unticked after its due moment). |
| `reminder_read_at` | `timestamptz null` | When the assignee opened it or pressed [ MARK ALL AS READ ]; null: unread. |

No new check constraint (the values are set only by `activities.ts`, the seed and the backfill).
Index: `activities_reminder_idx on activities (assignee_id, remind_at desc) where done_at is null and remind_at is not null`.

## Reminder (derived, never a separate row)

A reminder **exists** when `remind_at is not null`. It is **shown and counted** to user U at instant `now` when all hold:

- `a.assignee_id = U` (the current assignee only; admins have no exception);
- `a.done_at is null` (planned);
- `a.remind_at <= now`;
- `visibleActivity(U)` (U sees every person and deal the activity is linked to; organisations are never private).

**Unread** when `reminder_read_at is null`. Listed with `createdAt = remind_at`; leads to the deal, else person, else
organisation, else `/activities` (the existing `href()`).

## Reminder time and due moment (pure, `src/server/activities/rules.ts`)

| Activity | Reminder time `reminderAt` | Due moment `dueMoment` |
|---|---|---|
| Timed (`dueTime` set) | `ukInstant(dueOn, dueTime) − 15 min` | `ukInstant(dueOn, dueTime)` |
| Untimed | `ukInstant(dueOn, "09:00")` | `ukInstant(dueOn + 1 day, null)` (start of next UK day) |

`reminderFor(due, now) = dueMoment(due) > now ? reminderAt(due) : null`.

## State changes

| Event | `remind_at` | `reminder_read_at` |
|---|---|---|
| Schedule | `reminderFor(due, now)` | null |
| Edit: due date/time changed, or assignee changed | `reminderFor(new due, now)` | null |
| Edit: anything else only | kept | kept |
| Tick done | kept (hidden by `done_at`) | kept |
| Untick, `dueMoment > now` | kept | kept |
| Untick, `dueMoment <= now` | null | null |
| Delete activity / record delete removing it | row deleted | — |
| Record delete keeping it (links set null) | kept | kept |
| Open (own, shown) | — | `coalesce(reminder_read_at, now)` |
| Mark all read | — | `now` for own planned rows with `remind_at <= now` and unread |
| Migration (go-live) | backfilled for planned rows with due moment > migration time | null |
| Hand-over of a deactivated user's private records | kept (assignee unchanged; shown only while visible to them) | kept |

## Types (`src/server/notifications.ts`)

```ts
export type ReminderView = {
  kind: "reminder"; id: number; type: ActivityType; subject: string; dueOn: string; dueTime: string | null;
  durationMinutes: number | null; href: string; createdAt: Date; read: boolean;
};
export type NotificationView = MentionView | AssignmentView | ReminderView;
export type NotificationRef = { kind: "mention" | "assignment" | "reminder"; id: number };
```

## Fake data (`src/seed/activities.ts`)

Every seeded planned activity: `remind_at = reminderFor(due, now)`. Plus for Ada Fake: "Fake call: reminder test call"
(shown, unread, timed), "Fake task: reminder test task" (shown, unread, untimed), "Fake meeting: reminder already seen"
(shown, read). See research.md §8.
