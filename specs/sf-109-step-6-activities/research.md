# Research: Activities (SF-109)

Each point: Decision / Rationale / Alternatives considered. Source code and tests on `main` (after SF-102) are the
reference; nothing here needs a person except the points also listed in spec.md § Clarifications ("decided by the
factory, to confirm").

## §1 Dependencies

- **Decision**: nothing added. Dates and times with `Intl.DateTimeFormat` (Europe/London, already used by
  `src/server/format.ts`) and Postgres `timestamp … at time zone 'Europe/London'`; forms with React 19
  `useActionState`; pickers are the existing client picker.
- **Rationale**: every need (UK time, DST, overdue, paging) is a few lines over what the repo has.
- **Alternatives**: `date-fns-tz` / `Temporal` polyfill — rejected, `Intl` already answers "what UK date/time is this
  instant" and the round-trip check in §4 answers "does this UK time exist".

## §2 Storage: one `activities` table

- **Decision**: one table `activities` (data-model.md) with nullable `deal_id`, `person_id`, `organisation_id`
  (`on delete set null`), `type` (`call`/`meeting`/`task`), `subject`, `due_on date`, `due_time time null`,
  `duration_minutes int null`, `assignee_id`, `note`, `done_at`/`done_by`, `created_by`/`created_at`, `version`, and three
  assignment-notification columns (§7). Migration `migrations/0008_activities.sql`.
- **Rationale**: at most one link of each kind (spec Assumptions) fits three columns; a fixed type list fits a check
  constraint; a done activity is a state of the row, so ticking twice at once can only record one "done" (spec Edge
  Cases, "Done by <the first user's name>": `update … where done_at is null`).
- **Numbering**: `0006` is SF-103's `0006_csv_imports.sql` (open branch), `0007` is SF-102's. `0008` runs after both
  whatever order they merge in. This migration does **not** touch `timeline_events_kind_check` (§3), so it cannot
  clash with SF-103 replacing that constraint.
- **Alternatives**: a link table `activity_links(activity_id, kind, id)` — rejected (at most one per kind, harder
  privacy joins); writing `timeline_events` rows for done activities — see §3.

## §3 Done activities on the timeline: read, not copied

- **Decision**: `readTimeline` (`src/server/records/timeline.ts`) reads `timeline_events` **union all** the done
  activities of the record, ordered together by `created_at` / `done_at` desc, with the same `limit + 1` paging. An
  activity entry has `kind: "activity"` and an `activity` payload (type, subject, note, done by, done at). The person and
  organisation arms use the same "own link or one of their deals" rule as SF-102, written so each activity is read once
  (`a.person_id = $p or a.deal_id in (…)`), so an activity linked to both a person and their deal shows once (spec Edge
  Cases). Entries are keyed `activity-<id>` in `RecordTimeline` (`entry-<id>` stays for events) so ids never clash.
- **Rationale**: copying a done activity into `timeline_events` (one row per linked record) would duplicate it on a
  person's timeline that also reads their deal's entries, would go stale when the activity is edited, unticked or
  deleted, and would need its own privacy rule. Reading it live gives "unticking removes it from the timeline",
  "deleting removes it everywhere" and privacy for free.
- **Alternatives**: one `timeline_events` row with `kind = 'activity'` — rejected for the reasons above and because it
  would need a third replacement of `timeline_events_kind_check` racing SF-103.

## §4 Due date, time and duration in UK time

- **Decision**: store the UK wall-clock values (`due_on date`, `due_time time`), never an instant. Pure rules in
  `src/server/activities/rules.ts`:
  - `ukInstant(dueOn, time)` → the `Date` of that UK wall-clock time; `existsInUk(dueOn, time)` is false when
    formatting `ukInstant` back with `Intl` (Europe/London) does not give the same date and time (the spring gap,
    e.g. 29 Mar 2026 01:30) → "Pick a time that exists in UK time." In the autumn overlap (25 Oct 2026 01:30 happens
    twice) the first one (BST) is taken.
  - `activityState({ dueOn, dueTime, durationMinutes, done }, now)` → `"done" | "overdue" | "today" | "later"`, exactly
    spec FR-009: overdue when not done and `dueOn < today(UK)`, or `dueOn = today` with a time and
    `ukInstant(dueOn, dueTime) + duration` ≤ `now`; today when due today and not overdue. An untimed activity due today
    is never overdue before midnight UK.
  - In SQL the same rule, with `now` passed as a parameter (`${now}::timestamptz`), so tests can fix the clock:
    `today = (${now} at time zone 'Europe/London')::date`; end instant
    `((a.due_on + a.due_time) at time zone 'Europe/London') + make_interval(mins => coalesce(a.duration_minutes, 0))`.
    Postgres maps a non-existent local time forward; it never sees one because §4 refuses them on save.
  - "This week": Monday to Sunday of the UK week containing today (`date_trunc('week', today)`, ISO weeks start Monday).
- **Rationale**: an activity "due Tuesday at 10:00" stays at 10:00 across the clocks changing; SC-006 needs tests on
  both sides of midnight and of the change, so every function takes `now`.
- **Alternatives**: a `timestamptz due_at` + `has_time` flag — rejected: untimed activities have no instant, and the
  UK day would be recomputed everywhere.

## §5 Privacy: one more rule in `visibility.ts`

- **Decision**: `visibleActivity(db, viewer, alias = "a")` in `src/server/records/visibility.ts`:
  `(a.person_id is null or exists (select 1 from persons p where p.id = a.person_id and visiblePerson(p))) and
  (a.deal_id is null or exists (select 1 from deals d where d.id = a.deal_id and visibleDeal(d)))`. Organisations are
  never private. Every read of `activities` (record sections, timelines, the list, its count, board cards,
  notifications, every action) uses it; `viewer` may be `sql\`u.id\`` to ask which users may be assignees (SF-102 §5).
- **Assignee check**: on save, the assignee must be `status = 'active'` and pass `visibleActivity` for the new links
  (checked in SQL on the locked rows); else `assignee_cannot_see` with their name. Assignee choices offered = active
  users passing the same rule for the pre-filled links (the form re-validates on save).
- **Later loss of sight** (a deal made private after the activity was assigned to someone else): the activity stays
  assigned and is hidden from that assignee (list, card, notification), like a mention; nothing is reassigned
  automatically. Recorded in spec.md § Clarifications (to confirm).
- **Hand-over** (SF-92/SF-97): the new owner passes `visiblePerson`/`visibleDeal`, so they see the activities; the
  activities keep their assignee. No code in `handover.ts`.

## §6 Archived records

- **Decision**: every change (`schedule`, `edit`, `tick`, `untick`, `delete`) locks the linked rows (`for update`) and
  refuses with `activity_record_archived` when any current **or newly picked** linked record is archived. Pickers only
  offer non-archived records. Reads are unchanged (archived records keep their activities; the list marks the record
  "Archived").
- **Won/lost deals**: not archived, so their activities can still be changed; the deal picker only offers open,
  non-archived deals (US1 scenario 3), a deal already linked stays.

## §7 Assignment notifications: three columns on the activity

- **Decision**: `assigned_by bigint`, `assigned_at timestamptz`, `assignment_read_at timestamptz` on `activities`. A
  notification exists while `assignee_id <> assigned_by`. Schedule: `assigned_by = actor, assigned_at = now()`. Edit that
  changes the assignee: same, and `assignment_read_at = null` (the old assignee's notification is gone because it is the
  same row; the new one is unread). Any other edit, tick or untick leaves the three columns alone. Delete removes it.
  Opening marks `assignment_read_at`; `[ MARK ALL AS READ ]` updates both `note_mentions` and `activities`.
- **Rationale**: there is at most one live assignment notification per activity (spec US6 scenario 4), so a separate
  table would only copy the row's key and lifetime.
- **Notifications page**: `src/server/notifications.ts` reads mentions **union all** assignments (newest first, one
  `limit 51`), each item with a `kind` (`mention` | `assignment`). `unreadCount` adds both. `openNotification` takes
  `{ kind, id }`; the page's form posts `kind` and `id`. Assignment link: deal page, else person, else organisation, else
  `/activities` (US6 scenario 3). Visibility: `visibleActivity(userId)`.
- **SF-108** (open branch: `UnreadLink`, `currentUnread`) changes `layout.tsx`, `nav.ts` and
  `notifications/actions.ts`; whichever merges second keeps both: the count always comes from `unreadCount`.
- **Alternatives**: a table `activity_notifications` — rejected (same lifetime as the row); reusing `note_mentions` —
  rejected (its key is a timeline event).

## §8 "Last contacted"

- **Decision**: in the tick transaction, for a `call` or `meeting` with a `person_id`:
  `update persons set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'), $due) where id = $person`,
  `$due` = `ukInstant(due_on, due_time ?? 00:00)`. No `version` bump and no timeline event (not a user edit; a person
  edit open at the same time must not conflict). Unticking never moves it back (US2 scenario 4).

## §9 Deleting records

- **Decision**: FKs are `on delete set null`. Before deleting the row, `deleteDeal`, `deletePerson` and
  `deleteOrganisation` run `delete from activities where <link> = $id and <the two other links> is null` (an activity left
  with no link is deleted, FR-014); `deletePerson` of a person who is private deletes `where person_id = $id` entirely. An
  activity created with no link (Activities list) is never touched.

## §10 The Activities list query

- **Decision**: `src/server/activities/list.ts` — `listActivities(viewerId, query, now)` and `countActivities` in one
  `Promise.all`; filters from `parseActivitiesQuery` (`src/server/records/list-query.ts`, pure):
  `when` = `overdue | today | week | planned | done` (default `planned`), `assignee` = a user id, `all` (Everyone) or
  absent (the viewer), `type` = `call | meeting | task` or absent, `page` ≥ 1. Sorting: not done → `overdue desc,
  due_on, due_time nulls last, id`; done → `done_at desc, id desc`. 50 per page (`PAGE_SIZE`).
- **Indexes**: `activities_assignee_due_idx (assignee_id, due_on, due_time) where done_at is null`,
  `activities_assignee_done_idx (assignee_id, done_at desc) where done_at is not null`,
  `activities_deal_next_idx (deal_id, due_on, due_time) where done_at is null`, and plain indexes on `person_id`,
  `organisation_id`, `deal_id`. SC-003 (2,000 activities, < 2 s) is one indexed query plus a count.
- **Unknown assignee id** in the address: shown as the viewer's default (no text from the URL is shown).

## §11 Board card line

- **Decision**: `getBoard` adds a `left join lateral (select … from activities a where a.deal_id = d.id and
  a.done_at is null and visibleActivity(viewer) order by a.due_on, a.due_time nulls last, a.id limit 1)`; `BoardCard`
  gets `next: { dueOn, dueTime, durationMinutes, type } | null`. `Board.tsx` renders "⚠ No next activity" (amber) when
  null, else "Next: 25 Nov · Call" plus the red "Overdue" mark (`activityState`). `activities_deal_next_idx` keeps 500
  cards under SC-003.

## §12 Pages, boxes and return paths

- **Decision**: the activity form and "Schedule a follow-up?" are one client component `ActivityBox` (design A: a box
  over the page, like `LostBox`) opened by the address: `?activity=new`, `?activity=<id>` (edit),
  `?followup=<id>` (after a tick), `?delete-activity=<id>` (confirm). The pages render it server-side from those ids
  (only ids the viewer can see; anything else is ignored). Actions take a posted `back` path (the page the box is on)
  and redirect through `isSafeNext(back, appBaseUrl())` (AGENTS.md); errors come back through `useActionState`
  (`FormState`) so typed values stay.
- **Tick**: a tiny form per row (`<button aria-label="Mark done">` styled as the box), action `tickActivity` /
  `untickActivity`; works without JavaScript. On a record page or the deal drawer the redirect adds `followup=<id>`; on
  the Activities list it does not (US2 scenario 2 names record pages and the drawer).
- **Pickers**: `PersonPicker` gets optional `name` and `label` props (defaults keep today's `personId` / "Person") and is
  used for the deal, person and organisation of an activity; no "add new" for activities.

## §13 Fake data

- **Decision**: `src/seed/activities.ts`, registered after `notes` in `src/seed/index.ts`; idempotent by a fixed
  subject list (skip when a fake activity with that subject exists). Covers FR-017 (data-model.md § Fake data). Dates are
  relative to the day the seed runs (UK), so "overdue" and "today" are always true.
