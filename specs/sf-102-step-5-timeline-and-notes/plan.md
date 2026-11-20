# Implementation Plan: Timeline and notes

**Branch**: `factory/sf-102-step-5-timeline-and-notes` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-102-step-5-timeline-and-notes/spec.md`

## Summary

One `// TIMELINE` (design B: grouped by UK day, NOTE / DEAL / CHANGE tags, notes in an orange-edged box, the note box
above) on deal, person and organisation pages; person and organisation timelines also read the entries of their
currently linked deals. Notes are plain text, stored as `timeline_events` rows of a new kind `note` (author, date,
last editor, version), so the timeline stays one ordered, paged query. @mentions are tokens `@[user:<id>]` in the
text, shown with the user's current name; one new table `note_mentions` holds each mention and doubles as the
in-app notification (read/unread), shown and counted only while the note's record is visible to the user. A
"Notifications" sidebar link with an unread count and a `/notifications` page. One migration
(`0006_notes_mentions.sql`), domain code in `src/server/records/` and `src/server/notifications.ts`, one new client
component (`NoteBox`, the mention picker). No new dependency; the only outside service is the app's own Supabase Postgres, as before.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions), React 19.3 (`useActionState`), `postgres` 4.1 —
all already in the repo. Nothing added (research.md §1).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). New migration
`migrations/0006_notes_mentions.sql`: 4 columns and 2 constraints on `timeline_events`, new table `note_mentions`
(data-model.md).

**Testing**: Vitest (unit: note rules, mention tokens, segments, preview, day grouping, `parseShown`, messages;
integration against real Postgres: notes, timelines with deal entries, privacy, notifications, cascade, hand-over,
performance, seed, RLS, migrate), Playwright (US1–US4 through the fake Google login).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-003 a timeline with 1,000 entries shows its first page in < 2 s: one query with `limit 51`
over existing indexes (research.md §7) plus one query for the mentions of the notes shown. Sidebar count: one indexed
query per page load (`note_mentions_unread_idx`).

**Constraints**: private people and deals hide their notes, deal entries, mention lists and notifications from
everyone the rules hide them from (SC-005, FR-015); edits/deletes re-checked on every request (SC-006); note text only
as text nodes (FR-016); every message from `messages.ts`; nothing from the address shown.

**Scale/Scope**: ≤ 10 users, a few thousand records and timeline entries; 1 new page (`/notifications`), 3 changed
record pages, 2 changed drawers, the sidebar.

No NEEDS CLARIFICATION left: research.md resolves each open point; choices a person should confirm are in spec.md
§ Clarifications ("decided by the factory, to confirm").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail. The binding
rules are `docs/DECISIONS.md` and `AGENTS.md`; the plan is checked against them:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Timeline, day groups, edit/delete confirm, notifications page are server-rendered. One new client component: `NoteBox` (the @ picker needs the browser); `SidebarLink` (already client) gets a `count` prop | ✅ |
| Every page `requireUser()`; every action `requireUser()` first | Per route in contracts/routes.md; domain functions re-check visibility, archived state and version in the transaction | ✅ |
| Messages only from `messages.ts`; never text from the URL; redirects via `isSafeNext` or fixed paths | New codes and templates in contracts/routes.md § Messages; `?note=`/`?delete-note=` only select among shown ids; `?timeline=`/`?shown=` parsed to numbers; redirects built from numeric ids | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0006_notes_mentions.sql`: DDL only, `note_mentions` RLS on, added to `rls.test.ts` | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/notes.ts` registered in `src/seed/index.ts` (command already gated); fake users and fake text only | ✅ |
| A private contact or deal hides its notes from everyone but those allowed, admins included (kickoff, SF-92, SF-93) | `visiblePerson` / `visibleDeal` on every timeline, note action, mention candidate and notification query; the helpers accept a user column so the same rule answers "who can see" (research.md §5) | ✅ |
| Hand-over carries private deals (SF-97) | Notes are events of the deal: they follow the owner change; integration test | ✅ |
| Events about a deleted person (SF-92) | Unchanged; notes cascade with their record | ✅ |
| Users deactivated, never deleted | Author / editor / mention shown with current name, "(deactivated)" for author and editor; deactivated users never offered | ✅ |
| Every outside service has a fake | Only Supabase Postgres, tested on a real local Postgres as before (§ Outside services); notifications are in-app, no email | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-102-step-5-timeline-and-notes/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, state changes, validation, fake data
├── quickstart.md        # Phase 1: how to validate end-to-end
├── contracts/
│   └── routes.md        # Pages, query parameters, server actions, domain functions, messages
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0006_notes_mentions.sql            # data-model.md § Migration

src/
├── app/(app)/
│   ├── layout.tsx                     # reads unreadCount(user.id), passes count to the Notifications link
│   ├── nav.ts                         # + { href: "/notifications", label: "Notifications" }
│   ├── SidebarLink.tsx                # + optional count badge and aria-label
│   ├── notifications/
│   │   ├── page.tsx                   # the Notifications page
│   │   └── actions.ts                 # openNotification, markAllNotificationsRead
│   ├── records/
│   │   ├── RecordTimeline.tsx         # server: note box slot, day groups, entries, edit/confirm modes, [ SHOW MORE ]
│   │   ├── Timeline.tsx               # keeps the change lines (Line), used by RecordTimeline for CHANGE/DEAL entries
│   │   ├── NoteBox.tsx                # client: textarea + @ picker (add and edit)
│   │   ├── NoteDeleteConfirm.tsx      # server: inline confirm
│   │   └── note-actions.ts            # addNote, editNote, deleteNote
│   ├── deals/[id]/page.tsx            # // HISTORY → <RecordTimeline>; ?timeline, ?note, ?delete-note; flash note_deleted
│   ├── deals/DealDrawer.tsx           # <RecordTimeline readOnly>, link to the deal page for more
│   ├── deals/page.tsx, deals/list/page.tsx  # readTimeline(..., 50) page shape
│   ├── people/[id]/page.tsx           # <RecordTimeline>
│   └── organisations/[id]/page.tsx    # <RecordTimeline>
├── server/
│   ├── records/
│   │   ├── timeline.ts                # kind "note"; readTimeline with deal entries, limit, mentions (research.md §6)
│   │   ├── timeline-view.ts           # pure: groupByDay, tag of an entry
│   │   ├── notes-rules.ts             # pure: validateNoteText, tokenizeMentions, detokenize, noteSegments, notificationPreview, parseShown
│   │   ├── notes.ts                   # addNote, editNote, deleteNote, mentionCandidates, noteForEdit
│   │   ├── visibility.ts              # viewer: number | Fragment
│   │   └── flash.ts                   # + code note_deleted
│   ├── notifications.ts               # listNotifications, unreadCount, openNotification, markAllRead
│   ├── format.ts                      # + ukDayKey, formatDayHeading, formatTime
│   └── messages.ts                    # + codes and templates (contracts/routes.md § Messages)
├── seed/
│   ├── notes.ts                       # data-model.md § Fake data
│   └── index.ts                       # + { name: "notes", run: seedNotes } after deals
└── app/globals.css                    # day headings, tags, note box, mention mark, picker, .cnt badge

tests/
├── unit/                              # notes-rules, timeline-view, format (day/time), messages
├── integration/                       # notes, timeline-deal-entries, notes-private, notifications, timeline-performance,
│                                      #   + seed, rls (+note_mentions), migrate, reset, handover (notes follow)
└── e2e/                               # notes.spec.ts, timeline.spec.ts, mentions.spec.ts, notes-private.spec.ts
```

**Structure Decision**: same single Next.js project. Notes live beside the timeline in `src/server/records/` because a
note is a timeline entry of any record kind; notifications get their own `src/server/notifications.ts` (they belong to
the user, not a record). Privacy stays in `visibility.ts`.

## Build steps (in order)

1. **Migration** `migrations/0006_notes_mentions.sql` exactly as data-model.md (confirm the constraint name
   `timeline_events_kind_check` on a migrated database first). `tests/support/reset.ts` (and
   `.factory/run/reset-db.sh` if it lists tables) empties `note_mentions`; `rls.test.ts` + `note_mentions`.
2. **Pure rules** (`notes-rules.ts`, `timeline-view.ts`, `format.ts`): as data-model.md § Validation and research.md
   §3, §7, §8. Day headings in Europe/London: "TODAY · 20 NOV 2026" when the entry's UK day is today's, else
   "19 NOV 2026"; times "10:14". Messages and templates as contracts/routes.md.
3. **Visibility**: `visiblePerson` / `visibleDeal` accept `viewer: number | Fragment`; existing callers unchanged.
4. **Timeline read** (`timeline.ts`): `EventKind` + `"note"`; `readTimeline(viewerId, target, limit)` per research.md
   §6 returning `{ entries, more }`; for the notes on the page, one query on `note_mentions` join `users` for names;
   `segments` via `noteSegments`; deal title/archived for entries whose `deal_id` is not the page's own record.
   Update the 5 callers (deal page, people page, organisations page, board and list drawers).
5. **Notes domain** (`notes.ts`): `addNote` / `editNote` / `deleteNote` per data-model.md § State changes, each in
   `sql.begin`, record row locked `for update` with `visible…` and `archived_at is null` checks; mention ids
   de-duplicated, the saver's own id stored but never a notification (row with `user_id = mentioned_by`);
   `mentionCandidates` = active users passing the record's visibility rule (organisations: all active users), ordered
   by name; `noteForEdit` detokenizes.
6. **Notifications** (`notifications.ts`): queries filter `m.user_id = $me and m.user_id <> m.mentioned_by` and the
   record's visibility for `$me` (join `timeline_events e`, left join `persons`/`deals`/`organisations` on the event's
   target, `visiblePerson`/`visibleDeal` with the viewer); `unreadCount` adds `read_at is null`.
7. **UI**: `RecordTimeline` (contracts/routes.md § Pages), `NoteBox`, `NoteDeleteConfirm`, `note-actions.ts`, the
   three record pages and the drawer; `/notifications` page and actions; nav entry and count. CSS per
   `design-options.html` B: `.day` mono uppercase headings with orange `//`, `.kd` tags (`note` orange, `deal` blue,
   change muted), `.notebody` with a 3px `--orange` left border and `--note` background, `white-space: pre-wrap`,
   `overflow-wrap: anywhere`; `mark.mention` blue text on `--wash`, no link; picker as a bordered list under the
   textarea; `.cnt` orange badge in the sidebar. Long deal titles wrap.
8. **Fake data** (`src/seed/notes.ts`, data-model.md § Fake data), idempotent, registered after `deals`.
9. **Docs**: append to `docs/DECISIONS.md` the three choices people made in the spec, one line each:
   "The timeline uses design B: entries grouped by day with a NOTE, DEAL or CHANGE tag and the time, notes in a box
   with an orange left edge, the note box above the timeline (SF-102)",
   "A teammate mentioned in a note is told in the app only: Notifications in the sidebar and a Notifications page, no
   email (SF-102)",
   "Anyone who can see a note can edit or delete it (SF-102)". The factory's own choices (spec Clarifications "to
   confirm") are not added until a person confirms them. No blueprint exception (no blueprint index in this run), so
   no "Departs from blueprint" line. Update `AGENTS.md` § Layout with `notes.ts`, `notes-rules.ts`,
   `timeline-view.ts`, `notifications.ts`, `NoteBox.tsx`, `RecordTimeline.tsx`, `/notifications`.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor at commit e59909dc629230a4c07af3df16957ef22a184774, which only has an OpenAPI test for its own management API, and github.com/supabase/supabase, during SF-90 and SF-93; the app speaks the standard Postgres protocol, the new code only adds a table and columns to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: notes, mentions and notifications run in the app and its database; no email is sent.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
