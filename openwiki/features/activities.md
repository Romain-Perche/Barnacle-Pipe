---
type: feature
title: Activities (calls, meetings and tasks)
description: Scheduling, editing, ticking and deleting activities, the Activities list, next activities on records and the deals board, who can see an activity, assignment notifications and how done activities reach the timeline.
tags: [activities, calls, meetings, tasks, notifications, timeline]
sources:
  - id: sf109-src-activities
    resource: repo://src/server/activities/activities.ts
  - id: sf109-src-rules
    resource: repo://src/server/activities/rules.ts
  - id: sf109-src-list
    resource: repo://src/server/activities/list.ts
  - id: sf109-src-visibility
    resource: repo://src/server/records/visibility.ts
  - id: sf109-src-actions
    resource: repo://src/app/(app)/activities/actions.ts
  - id: sf109-src-migration
    resource: repo://migrations/0008_activities.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-23T16:50:25.265Z
generated: { by: "claude-code", at: "2026-11-23T16:50:25.265Z" }
---

# Activities (calls, meetings and tasks)

An activity is a call, a meeting or a task with a subject, a due day and an optional time and duration, an
assignee and an optional note. It can link to a deal, a person and an organisation. The table is described in
[Database schema](../data/database-schema.md); how data moves is in [dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md).

## Code

- `src/server/activities/rules.ts` is pure: validation (`validateActivity`), UK wall-clock time (`ukInstant`,
  `existsInUk`, `ukToday`), the state of an activity (`activityState`: done, overdue, today, later), due-date
  text, week bounds, the line on a board card (`cardLine`) and the path after a tick (`afterTickPath`). Every rule
  that needs the clock takes `now` as a parameter.
- `src/server/activities/activities.ts` schedules, edits, deletes, ticks and unticks activities, reads
  `nextActivities` for a record or deal, resolves the `?activity=` address id (`pageActivity`) and fills the form
  (`prefillLinks`, `activityFormChoices`). Edits and deletes use the row `version`.
- `src/server/activities/list.ts` reads the Activities list (`now` as a parameter) and its filter options.
- `src/app/(app)/activities/` holds the page, the server actions and the boxes that open over a page from
  `?activity=`, `?followup=` and `?delete-activity=` (`ActivityOverlays.tsx`, `ActivityBox.tsx`, `DoneBox.tsx`,
  `ActivityDeleteConfirm.tsx`). `NextActivities.tsx` is the "next activities" block of record pages and the deal
  drawer. The sidebar entry is in `src/app/(app)/nav.ts`.

## Rules worth knowing

- **Visibility.** Every read of `activities` goes through `visibleActivity()` in `src/server/records/visibility.ts`:
  a viewer sees an activity only if they can see every person and deal it links to (organisations are never
  private), so a hidden activity does not exist for them in pages, lists, counts or cards.
- **Who can change.** Anyone who can see an activity can change it.
- **Last contacted.** Ticking a call or a meeting done raises the linked person's `last_contacted_at`.
- **Timeline.** Done activities are read into `readTimeline` for the record; they are never copied into
  `timeline_events`.
- **Notifications.** An activity assigned to someone other than the assigner is a notification on the
  Notifications page and in the unread count, tracked by columns on the activity row (`assignment_read_at`).
  See [People and organisations](people-and-organisations.md) for mentions, which share that page.
- **Board.** The deals board shows each deal's next activity or a warning on its card.
- **Seed.** `src/seed/activities.ts` adds fake activities (see [Migrations and seeding](../operations/migrations-and-seeding.md)).
