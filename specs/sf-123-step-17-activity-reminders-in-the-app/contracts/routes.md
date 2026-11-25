# Contracts: Activity reminders in the app (SF-123)

No new route or page. Changes to existing ones:

## `/notifications` (page, `src/app/(app)/notifications/page.tsx`)

- Lists, among mentions and assignments, the user's shown reminders (data-model.md § Reminder), newest first by
  reminder time, 50 at a time (`?shown=`), as one `<li id="r-<activityId>">`:
  - title: `templates.reminder_title(TYPE_LABELS[type], subject, dueTime)` → "Call: intro call with Bob Example at 10:00"
    or "Task: send the pricing sheet";
  - `Unread` badge while unread;
  - date: `formatDateTime(remind_at)` ("29 Mar 2026, 00:55");
  - second line: `templates.activity_due(formatDue(…))` → "Due 25 Nov 2026 10:00–10:30".
  - form posting `kind=reminder`, `id=<activityId>` to `openNotification`.
- [ SHOW MORE ] anchor `#r-<id>` when the last line is a reminder.

## Server action `openNotification(form)` (`src/app/(app)/notifications/actions.ts`)

- `kind`: `"assignment"` | `"reminder"` | anything else → `"mention"`; `id` a positive integer.
- `reminder`: marks read only the reminder of an activity the caller is assignee of, planned, with `remind_at <= now`
  and visible to them; redirects to the deal / person / organisation / `/activities`. Otherwise redirects to
  `/notifications` and changes nothing (same as any hidden notification). Never marks the assignment line.

## Server action `markAllNotificationsRead()`

Also marks the caller's shown reminders read; reminders still to come stay unread.

## Sidebar count (`layout.tsx`, `currentSidebar()`)

`unreadCount` adds the caller's shown unread reminders. Unchanged call sites.

## Server functions (domain contracts)

```ts
// src/server/activities/rules.ts (pure)
export const REMINDER_LEAD_MINUTES = 15;
export const UNTIMED_REMINDER_TIME = "09:00";
export function reminderAt(due: { dueOn: string; dueTime: string | null }): Date;
export function dueMoment(due: { dueOn: string; dueTime: string | null }): Date;
export function reminderFor(due: { dueOn: string; dueTime: string | null }, now: Date): Date | null;

// src/server/activities/activities.ts — new optional last parameter `now = new Date()`
scheduleActivity(actorId, form, now?); editActivity(actorId, id, version, form, now?); untickActivity(actorId, id, now?);

// src/server/notifications.ts — new optional last parameter `now = new Date()`
listNotifications(userId, limit?, now?); unreadCount(userId, now?);
openNotification(userId, ref, now?); markAllRead(userId, now?);

// src/server/messages.ts
templates.reminder_title(type: string, subject: string, time: string | null): string;
```

No email, no outside call (FR-009).
