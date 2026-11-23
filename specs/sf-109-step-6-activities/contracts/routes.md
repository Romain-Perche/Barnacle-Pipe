# Contracts: Activities (SF-109)

Pages, address parameters, server actions, domain functions and messages. Every page calls `requireUser()`; every
action calls `requireUser()` first (nothing admin-only, FR-011). Ids from the address only select among what the viewer
can see; nothing from the address is shown (FR-015).

## Pages

### `/activities` — the Activities list (new; design A)

`src/app/(app)/activities/page.tsx` (server). Sidebar: `nav.ts` gets `{ href: "/activities", label: "Activities" }`
between "Organisations" and "Notifications".

Query (parsed by `parseActivitiesQuery` in `src/server/records/list-query.ts`, pure):

| Param | Values | Default |
|---|---|---|
| `when` | `overdue` \| `today` \| `week` \| `planned` \| `done` | `planned` |
| `assignee` | user id \| `all` | the viewer (an unknown id falls back to it) |
| `type` | `call` \| `meeting` \| `task` | all |
| `page` | integer ≥ 1 | 1 |
| `activity` | `new` \| activity id | opens `ActivityBox` (schedule with no link / edit) |
| `delete-activity` | activity id | opens the delete confirmation |

Shows: header "Activities" + `[ SCHEDULE ACTIVITY ]` (→ `?activity=new`); filter row: quick-filter tabs (links built
with `withParams`), "Assignee" select (every user A–Z, deactivated ones "(deactivated)", plus "Everyone"), "Type" select
(All / Call / Meeting / Task), auto-submitting like the People filters (`AutoSubmit`); "// <n> ACTIVITIES"
(`countLabel(n, "ACTIVITY", "ACTIVITIES")`); table: done box, TYPE, SUBJECT (with `[ EDIT ]` `[ DELETE ]` links), DUE
(date, time / range, mark), ASSIGNEE, DEAL, PERSON · ORGANISATION (links; "Archived" badge on an archived record; "—"
when none). Overdue rows: class `over` (2px red left edge). Empty: `activities_empty` + `[ SCHEDULE ACTIVITY ]`. `Pager`
50 per page. Done rows (Done filter): ticked box (untick), "Done <date time> by <name>".

### Record pages (changed)

`/deals/[id]`, `/people/[id]`, `/organisations/[id]` and the deal drawer (board `/deals?deal=<id>` and list
`/deals/list?deal=<id>`): a `NextActivities` section (server, `src/app/(app)/activities/NextActivities.tsx`) above
`// TIMELINE`: "// NEXT ACTIVITIES" + `[ SCHEDULE ACTIVITY ]` (not when archived), then the planned activities linked to
the record, earliest first (`a.due_on, a.due_time nulls last, a.id`): done box, TYPE, subject, due, assignee, mark,
`[ EDIT ]` `[ DELETE ]` (not when archived); none: `activities_none_planned`. The drawer shows the same rows.

New query params on these pages: `activity=new|<id>`, `followup=<id>`, `delete-activity=<id>` (each id must be an
activity linked to this record and visible; else ignored). `?activity=new` pre-fills links (US1 scenarios 2–3):

- deal: the deal, its main person (when visible) and its organisation;
- person: the person and their organisation;
- organisation: the organisation;
- Activities list: none.

`?followup=<id>` opens the same box titled "Schedule a follow-up?" with the ticked activity's links and assignee, no
date, type Call, empty subject, and `[ NOT NOW ]` (= close link) instead of `[ CANCEL ]`.

### `/notifications` (changed)

Lists mentions and assignments together, newest first. An assignment item: `assigned_you(by, type, subject)` ("Ada Fake
assigned you a call: Call Ada about the proposal"), the date assigned, `activity_due(when)` ("Due 25 Nov 2026 10:00").
Unread styling as mentions. Its open form posts `kind=assignment&id=<activity id>`; a mention posts `kind=mention&id=<event id>`.

### Board (changed)

`Board.tsx`: each card ends with `<span class="warnline">⚠ No next activity</span>` (amber, `--warn`) or
`<span class="nextline">Next: 25 Nov · Call</span>` + `<span class="od">Overdue</span>` when overdue.

## Components

- `src/app/(app)/activities/ActivityBox.tsx` (client, `useActionState`): overlay + dialog (`role="dialog"`,
  `aria-modal`, labelled by its title "Schedule activity" / "Edit activity" / "Schedule a follow-up?"). Fields: type as 3
  radio buttons styled as tabs (Call / Meeting / Task), Subject, Date (`type="date"`), Time (`type="time"`, step 300),
  Duration (select: none, 5 min … 24 h in steps; labels "15 min", "1 h", "1 h 30 min"), Assigned to (select of the
  offered users), Deal / Person / Organisation (`PersonPicker` with `name`/`label`), Note (textarea, `maxLength` 10000).
  Hidden: `id`, `version`, `back`. Messages under their fields (`FieldError`), typed values kept.
- `src/app/(app)/activities/ActivityDeleteConfirm.tsx` (server): `activity_delete_confirm`, `[ DELETE ]` / `[ CANCEL ]`.
- `src/app/(app)/activities/DoneBox.tsx` (server): a form with one button (the box), `aria-label` "Mark done" /
  "Mark not done", hidden `id`, `back`, `followup` ("1" on record pages and the drawer).
- `src/app/(app)/activities/ActivityBits.tsx` (server): `TypeTag`, `DueText`, `StateMark` (Overdue / Today), shared by
  the list, `NextActivities`, the timeline entry and the card.
- `src/app/(app)/records/PersonPicker.tsx`: optional `name` (default `personId`) and `label` (default "Person"),
  `placeholder` from the label.
- `src/app/(app)/records/RecordTimeline.tsx`: an `activity` entry (tag ACTIVITY, key/anchor `activity-<id>`): type,
  subject (bold), note (text, `pre-wrap`), "Done by <name>".

## Server actions — `src/app/(app)/activities/actions.ts`

Each: `requireUser()` → domain function → on success `redirect(isSafeNext(back, appBaseUrl()))` (adding
`followup=<id>` after a tick when posted); refusals as below. `back` defaults to `/activities`.

| Action | Form fields | Result |
|---|---|---|
| `scheduleActivity(prev, fd)` | form values (data-model.md), `back` | `FormState` errors / redirect to `back` (box closed) |
| `editActivity(prev, fd)` | + `id`, `version` | errors; `conflict` → `activity_conflict`, `gone` → `activity_gone` (in the box) |
| `tickActivity(fd)` | `id`, `back`, `followup` | redirect `back` (+ `followup=<id>`) |
| `untickActivity(fd)` | `id`, `back` | redirect `back` |
| `deleteActivity(fd)` | `id`, `version`, `back` | flash `activity_deleted`, redirect `back` |

Tick / untick / delete refusals redirect to `back` with `?error=activity_not_found | activity_record_archived |
activity_conflict | activity_gone`; each page adds these codes to its `PAGE_ERRORS` allow-list. When `back` is a record
page the actor can no longer see, they land on its not-found page as today.

`src/app/(app)/notifications/actions.ts`: `openNotification` reads `kind` (`mention` default) and `id`.

## Domain functions

`src/server/activities/rules.ts` (pure): `ACTIVITY_TYPES`, `validateActivity(form)`, `existsInUk(dueOn, time)`,
`ukInstant(dueOn, time)`, `activityState(a, now)`, `formatDue(a)` ("25 Nov 2026", "25 Nov 2026 10:00",
"25 Nov 2026 10:00–10:30"), `formatCardDue(dueOn)` ("25 Nov"), `durationOptions()`, `weekBounds(now)`,
`cardLine(next, now)` (the board card's last line: `{ kind: "warn", text: "⚠ No next activity" }` or
`{ kind: "next", text: "Next: 25 Nov · Call", overdue }`), `afterTickPath(back, id, followup)` (the address after a tick:
`back` plus `followup=<id>` only when `followup` was posted). Board.tsx and the actions use them, so unit tests cover
what the screens show.

`src/server/activities/activities.ts`:

- `scheduleActivity(actorId, form)`, `editActivity(actorId, id, version, form)` →
  `{ status: "ok"; id } | { status: "invalid"; errors } | { status: "assignee_cannot_see"; name } | { status: "archived" }
  | { status: "not_found" } | { status: "gone" } | { status: "conflict" }`
- `tickActivity(actorId, id)`, `untickActivity(actorId, id)` → `{ status: "ok" | "archived" | "not_found" }`
- `deleteActivity(actorId, id, version)` → `{ status: "ok" | "archived" | "not_found" | "conflict" }`
- `getActivity(viewerId, id)` → `ActivityView | null` (for the box)
- `nextActivities(viewerId, target, now)` → `ActivityRow[]` (planned, earliest first)
- `activityFormChoices(viewerId, links)` → `{ assignees, deals, people, organisations }` (assignees: active users who can
  see the links; deals: open, non-archived, visible; people: `linkablePeople`; organisations: non-archived)
- `prefillLinks(viewerId, target)` → the US1 pre-fill.
- `pageActivity(viewerId, id, target)` → `ActivityView | null`: the activity named by `activity`, `followup` or
  `delete-activity` in a page address, only when the viewer can see it and it is linked to that record (else the page
  ignores the parameter); `followupPrefill(activity)` → its links and assignee, type kept, no date.

`src/server/activities/list.ts`: `listActivities(viewerId, query, now)` → `{ rows, count }`; `activityFilterOptions()`.

`src/server/records/visibility.ts`: `visibleActivity(db, viewer, alias = "a")`.

`src/server/records/timeline.ts`: `readTimeline` adds done activities (research.md §3).

`src/server/notifications.ts`: `listNotifications`, `unreadCount`, `openNotification(userId, { kind, id })`,
`markAllRead` cover assignments (research.md §7).

`src/server/deals/deals.ts`: `getBoard` adds `next` to each card; `deleteDeal` deletes the activities left with no link.
`src/server/records/people.ts` `deletePerson`, `src/server/records/organisations.ts` `deleteOrganisation`: same.

## Messages (`src/server/messages.ts`, "// SF-109: activities")

`messages`:

| Code | Text |
|---|---|
| `activity_subject_required` | Give the activity a subject. |
| `activity_subject_too_long` | Keep the subject under 200 characters. |
| `activity_due_required` | Pick a due date. |
| `activity_time_not_in_uk` | Pick a time that exists in UK time. |
| `activity_duration_needs_time` | Pick a time before setting a duration. |
| `activity_duration_invalid` | Pick a duration between 5 minutes and 24 hours. |
| `activity_note_too_long` | Keep the note under 10,000 characters. |
| `activity_conflict` | Someone else changed this activity while you were editing. Reload to see their changes. |
| `activity_gone` | This activity doesn't exist any more. |
| `activity_not_found` | This activity doesn't exist or you can't see it. |
| `activity_record_archived` | Restore this record before changing its activities. |
| `activity_link_not_found` | This record doesn't exist or you can't see it. |
| `activity_delete_confirm` | Delete this activity? This can't be undone. |
| `activities_empty` | No activities here. |
| `activities_none_planned` | No next activity. |
| `no_next_activity` | ⚠ No next activity |
| `followup_question` | Schedule a follow-up? |
| `overdue` / `today` | Overdue / Today |

`templates`: `assignee_cannot_see(name)` → "<name> can't see this record, so the activity can't be assigned to them.";
`assigned_you(by, type, subject)` → "<by> assigned you a <type>: <subject>"; `activity_due(text)` → "Due <text>";
`done_by(name)` → "Done by <name>"; `next_activity(day, type)` → "Next: <day> · <Type>"; `activity_deleted(_)` → "Activity
deleted." (flash code `activity_deleted` added to `flash.ts` CODES and read by the pages that can be `back`).
`fieldMessage` handles `assignee_cannot_see`.
