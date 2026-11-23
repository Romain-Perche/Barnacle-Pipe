# Data model: Activities (SF-109)

## Migration `migrations/0008_activities.sql`

Only statements allowed in a transaction; RLS on after the `create table` (no policy). Numbered 0008: 0006 is SF-103's,
0007 SF-102's (research.md §2). It does not change `timeline_events`.

```sql
-- SF-109: calls, meetings and tasks (specs/sf-109-step-6-activities/data-model.md).
create table activities (
  id bigint generated always as identity primary key,
  type text not null check (type in ('call', 'meeting', 'task')),
  subject text not null check (subject = btrim(subject) and subject <> '' and char_length(subject) <= 200),
  due_on date not null,
  due_time time null,
  duration_minutes int null check (duration_minutes between 5 and 1440 and duration_minutes % 5 = 0),
  note text null check (char_length(note) <= 10000),
  deal_id bigint null references deals (id) on delete set null,
  person_id bigint null references persons (id) on delete set null,
  organisation_id bigint null references organisations (id) on delete set null,
  assignee_id bigint not null references users (id),
  done_at timestamptz null,
  done_by bigint null references users (id),
  created_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  version int not null default 1,
  -- The assignment notification (research.md §7): live while assignee_id <> assigned_by.
  assigned_by bigint not null references users (id),
  assigned_at timestamptz not null default now(),
  assignment_read_at timestamptz null,
  check (duration_minutes is null or due_time is not null),
  check ((done_at is null) = (done_by is null)),
  check (note is null or note <> '')
);
alter table activities enable row level security;
create index activities_deal_id_idx on activities (deal_id);
create index activities_person_id_idx on activities (person_id);
create index activities_organisation_id_idx on activities (organisation_id);
create index activities_assignee_due_idx on activities (assignee_id, due_on, due_time) where done_at is null;
create index activities_assignee_done_idx on activities (assignee_id, done_at desc) where done_at is not null;
create index activities_deal_next_idx on activities (deal_id, due_on, due_time) where done_at is null;
create index activities_assigned_idx on activities (assignee_id, assigned_at desc) where assignee_id <> assigned_by;
create index activities_assigned_unread_idx on activities (assignee_id)
  where assignee_id <> assigned_by and assignment_read_at is null;
```

Also: `tests/support/reset.ts` and `.factory/run/reset-db.sh` add `activities` to their `truncate` (before `deals`);
`tests/integration/rls.test.ts` lists `activities`; `tests/integration/migrate.test.ts` sees 0008.

## Entity: Activity

| Field | Type | Rules |
|---|---|---|
| id | bigint | identity |
| type | `call` \| `meeting` \| `task` | required; shown "Call" / "Meeting" / "Task", tag "CALL" … |
| subject | text | trimmed; required (`activity_subject_required`); ≤ 200 (`activity_subject_too_long`) |
| due_on | date (UK) | required (`activity_due_required`); past dates allowed |
| due_time | time (UK) or null | must exist in UK time on `due_on` (`activity_time_not_in_uk`) |
| duration_minutes | int or null | only with a time (`activity_duration_needs_time`); 5–1440, step 5 (`activity_duration_invalid`) |
| note | text or null | CRLF/CR → LF, trimmed; empty → null; ≤ 10,000 (`activity_note_too_long`); shown as text, `pre-wrap` |
| deal_id / person_id / organisation_id | bigint or null | at most one each; visible to the actor; not archived when newly picked; a new deal must be open |
| assignee_id | user | active and can see every linked record (`assignee_cannot_see` with the name); default: the actor |
| done_at / done_by | timestamptz / user | both null (planned) or both set (done) |
| created_by / created_at | user / timestamptz | set on schedule |
| version | int | +1 on every edit, tick and untick; edit and delete compare it (`activity_conflict`) |
| assigned_by / assigned_at / assignment_read_at | user / timestamptz / timestamptz | research.md §7 |

Form values (posted, all strings): `type`, `subject`, `dueOn` (`YYYY-MM-DD`), `dueTime` (`HH:MM` or empty),
`duration` (minutes or empty), `assigneeId`, `note`, `dealId`, `personId`, `organisationId` (each empty or an id),
`back`; on edit also `id`, `version`. Pure validation: `validateActivity(form)` in `src/server/activities/rules.ts`,
returning `{ ok: true, value } | { ok: false, errors: FieldErrors }` (codes above), in field order. Subject and note length
counts characters after CRLF → LF (as SF-102 fix round 1).

### Derived: state (research.md §4)

`activityState(a, now)`: `done` | `overdue` | `today` | `later`. Marks: "Overdue" (red) and "Today" (blue), wherever an
activity is shown (list, record sections, drawer, card).

### Visibility (research.md §5)

Visible to a user ⇔ every linked person passes `visiblePerson` and the linked deal passes `visibleDeal`
(`visibleActivity` in `visibility.ts`). Not visible = does not exist for that user (pages, lists, counts, cards,
timelines, notifications, actions: `activity_not_found`).

## State changes (each one `sql.begin`, `src/server/activities/activities.ts`)

All start with: lock the activity `for update` where `visibleActivity(actor)` (else `not_found`); lock its linked rows and
the newly picked ones (`for update`), each through `visiblePerson` / `visibleDeal` (else `not_found` for the activity, or
`link_not_found` for a newly picked record); any archived → `archived`.

1. **schedule(actor, form)** → validate; links visible, not archived, new deal open; assignee active and passes
   `visibleActivity` on the new links (`users u`, `viewer = u.id`); insert with `created_by = assigned_by = actor`. Result
   `{ status: "ok", id }`.
2. **edit(actor, id, version, form)** → version differs → `conflict`; missing → `gone`; validate as 1; when `assignee_id`
   changes: `assigned_by = actor, assigned_at = now(), assignment_read_at = null`; `version + 1`. Done fields unchanged.
3. **tick(actor, id)** → `update activities set done_at = now(), done_by = actor, version = version + 1 where id = $id and
   done_at is null returning …`; when a row came back and type ∈ {call, meeting} and `person_id` set: "Last contacted"
   rule (research.md §8). Ticking a done activity is a no-op (`ok`), so two ticks at once give one done, by the first.
4. **untick(actor, id)** → `set done_at = null, done_by = null, version = version + 1 where done_at is not null`. "Last
   contacted" untouched.
5. **delete(actor, id, version)** → version differs → `conflict`; else delete (its notification goes with the row).
6. **Record deletes** (research.md §9): in `deleteDeal`, `deletePerson`, `deleteOrganisation`, before the record row:
   `delete from activities where deal_id = $id and person_id is null and organisation_id is null` (same for the others);
   for a private person, `delete from activities where person_id = $id`. The FK then sets the remaining links to null.
7. **Hand-over**: no change (visibility follows the owner, assignee kept).

State diagram: `planned --tick--> done --untick--> planned`; `planned|done --delete--> (gone)`.

## Notification (extends SF-102)

A notification is either a mention (`note_mentions` row, unchanged) or an **assignment**: an `activities` row with
`assignee_id = me`, `assigned_by <> me`, `visibleActivity(me)`. Shown: "<assigned_by name> assigned you a
<call|meeting|task>: <subject>", the date `assigned_at`, "Due <date> [<time>[–<end>]]"; read = `assignment_read_at is not
null`. Link: `/deals/<deal_id>`, else `/people/<person_id>`, else `/organisations/<organisation_id>`, else `/activities`.

## Timeline entry (extends SF-102)

`TimelineEntry.kind` gains `"activity"`; `activity: { id, type, subject, note, doneByName, doneByActive, dueOn, dueTime,
durationMinutes } | null`; `createdAt` = `done_at`. Tag ACTIVITY (`timeline-view.ts`), shown under its UK day like a note
(subject, note as text, "Done by <name>" with "(deactivated)" when needed). Paging (`?timeline=<n>`) unchanged.

## Person "Last contacted"

`persons.last_contacted_at` = max(current, least(UK instant of the due date and time (00:00 when no time), `done_at`))
when a call or meeting linked to the person is ticked; never lowered, never in the future (clarified 2026-11-23).

## Fake data (`src/seed/activities.ts`, FR-017)

Idempotent (skip a subject already present). Relative to the UK date the seed runs on, for the fake users (Ada Fake,
Bob Fake, …):

- Ada: a call overdue 4 days on a deal with its person and organisation; a task due today 09:00 (overdue once past) and a
  meeting today 15:00–16:00; a call in 2 days at 10:00; a task in 5 days with no time and no link.
- Bob: a meeting tomorrow on an organisation only; a task next week on a person.
- Done: two calls and one meeting done in the last week (on timelines; one updates "Last contacted").
- Private: one call on a private deal of Ada's, one task on a private person of Ada's (both assigned to Ada).
- Assignment notifications: one activity assigned by Ada to Bob (unread), one by Bob to Ada (read,
  `assignment_read_at` set).
- At least one open deal on the first pipeline keeps no planned activity (the "No next activity" card).
