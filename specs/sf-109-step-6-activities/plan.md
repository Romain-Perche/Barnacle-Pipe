# Implementation Plan: Activities

**Branch**: `factory/sf-109-step-6-activities` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-109-step-6-activities/spec.md`

## Summary

Calls, meetings and tasks as one new table `activities` (type, subject, UK due date, optional time and duration,
assignee, note, done by/at, at most one deal, one person and one organisation, version) in
`migrations/0008_activities.sql`. One new privacy rule `visibleActivity` (every linked person and deal visible) used by
every read and action. Done activities are read into the existing timeline query (`union all`), never copied. A
"// NEXT ACTIVITIES" section on deal, person and organisation pages and the deal drawer; the activity form and "Schedule
a follow-up?" in a box over the page (design A); an `/activities` list like the People list with quick filters in the
address; a last line on each board card ("⚠ No next activity" or "Next: 25 Nov · Call"). Assignment notifications are
three columns on the activity, listed and counted beside SF-102's mentions. A done call or meeting raises the person's
"Last contacted". No new dependency; the only outside service is the app's own Supabase Postgres.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions), React 19.3 (`useActionState`), `postgres` 4.1 —
already in the repo; nothing added (research.md §1).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). New migration
`migrations/0008_activities.sql`: table `activities` + 8 indexes (data-model.md). No change to `timeline_events`.

**Testing**: Vitest unit (validation, UK time existence, `activityState` around midnight and both clock changes,
`formatDue`, `parseActivitiesQuery`, messages), Vitest integration on real Postgres (schedule/edit/tick/untick/delete,
concurrency of ticks, conflicts, privacy everywhere, archived, record deletes, hand-over, Last contacted, list filters
with a fixed `now`, board `next`, notifications, timeline union, address parameters, follow-up pre-fill, performance,
seed, RLS, migrate). No browser tests: `docs/DECISIONS.md` says the repo has none (this replaces AGENTS.md § Tests on
this point). What a browser test would check is moved into unit and integration tests where it can be (card line,
address after a tick, sidebar order, which address ids a page accepts, plain-text subject and note); the AI review
checks the screens (layout, box opening and closing, focus, colours) in the running app.

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-003: Activities list with 2,000 activities, first page < 2 s (one indexed query + one count);
board with 500 open deals < 2 s (one lateral join on `activities_deal_next_idx`).

**Constraints**: private people and deals hide their activities everywhere (SC-005, FR-012); UK time for all dates,
across the clocks changing (SC-006); every message from `messages.ts`; subject and note as text only; redirects through
`isSafeNext`.

**Scale/Scope**: ≤ 10 users, a few thousand activities; 1 new page (`/activities`), 3 changed record pages, 2 drawers,
the board, the Notifications page, the sidebar.

No NEEDS CLARIFICATION left: research.md resolves each open point; choices a person should confirm are in spec.md
§ Clarifications ("decided by the factory, to confirm").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail. The binding
rules are `docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Pages, list, `NextActivities`, `DoneBox` (plain form), delete confirm are server-rendered. One new client component: `ActivityBox` (form state + pickers) | ✅ |
| Every page `requireUser()`; every action `requireUser()` first | contracts/routes.md; domain functions re-check visibility, archived state and version inside the transaction | ✅ |
| Messages only from `messages.ts`; never text from the URL; redirects via `isSafeNext` | New codes/templates in contracts/routes.md § Messages; address ids only select visible activities; `back` through `isSafeNext(back, appBaseUrl())` | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0008_activities.sql`: DDL only, RLS on, added to `rls.test.ts` | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/activities.ts` registered in `src/seed/index.ts` (command already gated) | ✅ |
| A private contact or deal is hidden from everyone but those allowed, admins included (kickoff, SF-92, SF-93) | `visibleActivity` on every read, count, card, timeline, notification and action; assignee must pass it | ✅ |
| Hand-over carries private people and deals (SF-92, SF-97) | Activities follow by visibility; assignee kept; integration test | ✅ |
| Events about a deleted person; private person's events removed (SF-92) | Activities left with no link deleted; a private person's activities deleted with them | ✅ |
| Users deactivated, never deleted | Assignee shown "(deactivated)", never offered | ✅ |
| Deal cards show no "No next activity" warning until activities exist (SF-93) | Activities now exist: the warning is added (FR-010); a DECISIONS line records it | ✅ |
| A teammate is told in the app only (SF-102) | Assignment notifications in-app only, no email | ✅ |
| Every outside service has a fake | Only Supabase Postgres, tested on a real local Postgres (§ Outside services); Google Calendar comes later | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-109-step-6-activities/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entity, state changes, notifications, fake data
├── quickstart.md        # Phase 1: how to validate end-to-end
├── contracts/
│   └── routes.md        # Pages, params, components, actions, domain functions, messages
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0008_activities.sql                    # data-model.md § Migration

src/
├── app/(app)/
│   ├── nav.ts                             # + { href: "/activities", label: "Activities" } before Notifications
│   ├── activities/
│   │   ├── page.tsx                       # the Activities list (design A)
│   │   ├── actions.ts                     # schedule, edit, tick, untick, delete
│   │   ├── ActivityBox.tsx                # client: the form / "Schedule a follow-up?" box over the page
│   │   ├── ActivityDeleteConfirm.tsx      # server: confirm box
│   │   ├── DoneBox.tsx                    # server: the tick form
│   │   ├── NextActivities.tsx             # server: "// NEXT ACTIVITIES" for record pages and the drawer
│   │   └── ActivityBits.tsx               # TypeTag, DueText, StateMark
│   ├── deals/[id]/page.tsx, people/[id]/page.tsx, organisations/[id]/page.tsx
│   │                                      # + NextActivities, ?activity / ?followup / ?delete-activity, PAGE_ERRORS, flash
│   ├── deals/DealDrawer.tsx, deals/page.tsx, deals/list/page.tsx  # + NextActivities and the box in the drawer
│   ├── deals/Board.tsx                    # card last line
│   ├── notifications/page.tsx, actions.ts # assignment items; open by { kind, id }
│   └── records/
│       ├── PersonPicker.tsx               # + optional name, label
│       └── RecordTimeline.tsx             # + ACTIVITY entry
├── server/
│   ├── activities/
│   │   ├── rules.ts                       # pure: validation, UK time, state, formatting, week bounds
│   │   ├── activities.ts                  # schedule/edit/tick/untick/delete, getActivity, nextActivities, choices, prefill
│   │   └── list.ts                        # listActivities, activityFilterOptions
│   ├── records/
│   │   ├── visibility.ts                  # + visibleActivity
│   │   ├── timeline.ts                    # + done activities in readTimeline
│   │   ├── timeline-view.ts               # + ACTIVITY tag
│   │   ├── list-query.ts                  # + parseActivitiesQuery
│   │   ├── flash.ts                       # + activity_deleted
│   │   ├── people.ts, organisations.ts    # delete: activities left with no link
│   ├── deals/deals.ts                     # getBoard next; deleteDeal activities
│   ├── notifications.ts                   # mentions + assignments
│   └── messages.ts                        # SF-109 codes and templates
├── seed/
│   ├── activities.ts                      # data-model.md § Fake data
│   └── index.ts                           # + { name: "activities", run: seedActivities } after notes
└── app/globals.css                        # list rows, marks, card lines, box, done box

tests/
├── unit/          # activities-rules, list-query (+activities), timeline-view, messages
├── integration/   # activities, activities-private, activities-list (+performance), board-next, activity-notifications,
│                  #   timeline-activities, activity-page, last-contacted, + archive-delete, handover, seed, rls, migrate
tests/support/reset.ts, .factory/run/reset-db.sh   # + activities in the truncate
```

**Structure Decision**: same single Next.js project. Activities get `src/server/activities/` (like `deals/`) because
they have their own list, rules and actions; privacy stays in `visibility.ts`, timeline reading in `timeline.ts`,
notifications in `notifications.ts`.

## Build steps (in order)

1. **Migration** `migrations/0008_activities.sql` exactly as data-model.md. `tests/support/reset.ts` and
   `.factory/run/reset-db.sh`: add `activities` to the `truncate`. `rls.test.ts`: + `activities`.
2. **Pure rules** `src/server/activities/rules.ts` (research.md §4, data-model.md § Entity): `validateActivity` (CRLF →
   LF, trim, codes in field order), `existsInUk`, `ukInstant`, `activityState(a, now)`, `formatDue`, `formatCardDue`,
   `durationOptions` (5 min … 24 h step 5), `weekBounds(now)` (UK Monday–Sunday), `cardLine(next, now)`,
   `afterTickPath(back, id, followup)` (contracts/routes.md). `parseActivitiesQuery` in
   `list-query.ts` (defaults: `when=planned`, assignee = viewer). Messages and templates as contracts/routes.md.
3. **Visibility**: `visibleActivity(db, viewer, alias = "a")` in `visibility.ts` (research.md §5); update its header
   comment and AGENTS.md ("every `activities` read uses it").
4. **Domain** `src/server/activities/activities.ts` per data-model.md § State changes: one `sql.begin` each; lock the
   activity and every current and newly picked linked row `for update` through the visibility rules; archived → refuse;
   assignee: `select … from users u where u.id = $a and u.status = 'active' and <visibleActivity for the new links with
   viewer u.id>`; tick with `where done_at is null` + Last contacted (research.md §8); untick; delete with version; `pageActivity` and
   `followupPrefill` for the address parameters.
5. **Record deletes**: `deleteDeal`, `deletePerson` (private: all its activities), `deleteOrganisation` delete the
   activities left with no link, before the record row (research.md §9).
6. **Reads**: `nextActivities`, `listActivities` + count (research.md §10, `now` parameter), `getBoard` lateral `next`
   (§11), `readTimeline` union of done activities (§3; person/org arm "own link or one of their visible deals", each
   activity once, `visibleActivity(viewer)`), notifications union (§7).
7. **UI**: `/activities` page, `ActivityBox`, `DoneBox`, `ActivityDeleteConfirm`, `NextActivities`, `ActivityBits`;
   record pages, drawer (board and list), board card line, RecordTimeline ACTIVITY entry, Notifications page and
   `openNotification({ kind, id })`; `PersonPicker` `name`/`label` props; nav entry. CSS per `design-options.html` A:
   `tr.over td:first-child { box-shadow: inset 2px 0 0 var(--danger) }`, `.od` (red mono uppercase outline mark), `.td`
   (blue mark), `.warnline` (amber `--warn`, mono uppercase, thin top border), `.nextline` (muted mono), the box as
   `.overlay` + `.lostbox`-like panel (8px radius, shadow), type tabs (orange when on), `.box` done box (green when done).
   Add `--warn: #B45309` (dark: `#FBBF24`) to `globals.css` if missing. Long subjects wrap (`overflow-wrap: anywhere`),
   notes `white-space: pre-wrap`.
8. **Fake data** `src/seed/activities.ts` (data-model.md § Fake data), idempotent, registered after `notes`.
9. **Docs**: append to `docs/DECISIONS.md` the choices people made in the spec, one line each, ending "(SF-109)":
   "The Activities list uses design A: a table like the People list with quick filters Overdue / Today / This week /
   Planned / Done, the activity form and "Schedule a follow-up?" in a box over the page, and a last line on each board
   card",
   "Deal cards show "⚠ No next activity" when the viewer can see no planned activity on the deal, else its next date; this
   replaces the SF-93 choice",
   "A done call or meeting sets the linked person's Last contacted to its due date, or the moment it was marked done when the due date is later, never lowering it; a task never does",
   "A teammate assigned an activity by someone else is told in the app only, on the Notifications page, like a mention".
   The factory's own choices (spec Clarifications "to confirm") are not added until a person confirms them. No blueprint
   index in this run, so no "Departs from blueprint" line. Update `AGENTS.md` § Layout with `src/server/activities/`,
   `visibleActivity`, `src/app/(app)/activities/`, `src/seed/activities.ts`.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor at commit e59909dc629230a4c07af3df16957ef22a184774, which only has an OpenAPI test for its own management API, and github.com/supabase/supabase, during SF-90 and SF-93; the app speaks the standard Postgres protocol, the new code only adds a table to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: activities, the list, the card line and assignment notifications run in the app and its
database; nothing is sent by email and Google Calendar sync comes in a later issue.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
