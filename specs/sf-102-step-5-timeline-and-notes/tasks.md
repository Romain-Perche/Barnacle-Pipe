---

description: "Tasks for SF-102 Timeline and notes"
---

# Tasks: Timeline and notes

**Input**: Design documents from `/specs/sf-102-step-5-timeline-and-notes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-003 to SC-006): Vitest unit tests, Vitest integration tests against a real local Postgres (`crm_test`), Playwright browser tests through the fake Google login. Each test file names what it covers (`// covers FR-005, US1 scenario 2`). Write each story's tests first and see them fail before the code.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. The migration, entities, state changes, validation and fake data are in `data-model.md`; pages, address parameters, actions and domain functions in `contracts/routes.md`; decisions in `research.md` (§n below). No new dependency (`dependencies.json` is `[]`): do not add any package. No blueprint applies (`blueprints.json` is `[]` and this run has no blueprint index), so there are no blueprint tasks and no `Departs from blueprint` line. The choices "decided by the factory, to confirm" in spec.md § Clarifications are built as written there. The only outside service is Supabase Postgres (no public schema on GitHub): its task is T014, the recipe T044.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4 from spec.md
- Paths are from the repository root (single Next.js project, see plan.md § Project Structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The schema and the test plumbing.

- [ ] T001 First run `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'timeline_events'::regclass` on a database migrated to 0005 (or to 0006 if SF-103 is merged) to confirm the kind check is named `timeline_events_kind_check`. Then create `migrations/0007_notes_mentions.sql` exactly as `data-model.md` § Migration: on `timeline_events` add `body text null check (char_length(body) <= 100000)`, `edited_by bigint null references users (id)`, `edited_at timestamptz null`, `version int not null default 1`; recreate `timeline_events_kind_check` as `check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved', 'won', 'lost', 'reopened', 'note', 'imported'))`; add `timeline_events_note_check check ((kind = 'note') = (body is not null) and (kind = 'note' or (edited_by is null and edited_at is null)))` and `timeline_events_note_author_check check (kind <> 'note' or actor_id is not null)`; create `note_mentions` (`event_id bigint not null references timeline_events (id) on delete cascade`, `user_id bigint not null references users (id)`, `mentioned_by bigint not null references users (id)`, `created_at timestamptz not null default now()`, `read_at timestamptz null`, `primary key (event_id, user_id)`), then `alter table note_mentions enable row level security`; keep `'imported'` in the kind list (SF-103's `0006_csv_imports.sql` adds it; the two migrations must work in either order); indexes `note_mentions_user_idx on note_mentions (user_id, created_at desc, event_id desc)` and `note_mentions_unread_idx on note_mentions (user_id) where read_at is null`. Only statements allowed in a transaction
- [ ] T002 [P] Extend `tests/support/reset.ts` (`resetAppTables`): truncate `note_mentions` with the other tables (restart identity cascade); keep the six starting lead sources
- [ ] T003 [P] Extend `.factory/run/reset-db.sh` to truncate `note_mentions` too (if it lists tables)
- [ ] T004 [P] Add `note_mentions` to the expected list in `tests/integration/rls.test.ts`; extend `tests/integration/migrate.test.ts` to check on a fresh database that a `note` event without `body` is refused, a non-note event with `body` is refused, a non-note event with `edited_by` is refused, a `note` event with `actor_id` null is refused (all 23514), a second `note_mentions` row for the same `(event_id, user_id)` is refused (23505), and deleting the note event removes its `note_mentions` rows

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure rules, messages, formatting, the visibility helpers and the timeline read every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 [P] Unit tests first in `tests/unit/notes-rules.test.ts` (data-model.md § Validation, research.md §3): `validateNoteText` trims; `""` and spaces only → `note_required`; inner line breaks kept; exactly 10,000 characters ok, 10,001 → `note_too_long`; `tokenizeMentions("Hi @Bob Fake and @Bob Fakeson", [{id:2,name:"Bob Fake"},{id:3,name:"Bob Fakeson"}])` gives `"Hi @[user:2] and @[user:3]"` and ids `[2,3]` (longest names first); an id whose `@name` is not in the text is dropped; "ada@example.fake" with no id stays as typed; `detokenize` reverses it with current names; `noteSegments` returns text and `{ mention: "Bob Fake" }` segments, and a token whose id is not in the names map stays text (`"@[user:9]"`); `notificationPreview` gives the visible text cut to 200 characters with "…" when longer, never cutting a surrogate pair; `parseShown` → 50 for `undefined`, `"abc"`, `"0"`, `"75"`, `"-50"`, `"999999"`; `"100"` → 100; `"5000"` → 5000; `"5050"` → 50
- [ ] T006 [P] Unit tests first in `tests/unit/format.test.ts` and `tests/unit/timeline-view.test.ts` (research.md §8): `formatTime` "10:14" in UK time (a summer date shows BST); `ukDayKey` uses Europe/London (23:30 UTC on 31 Oct 2026 is 31 Oct, 23:30 UTC on 30 Jun is 1 Jul); `formatDayHeading(date, now)` → "TODAY · 20 NOV 2026" for the same UK day, "19 NOV 2026" otherwise; `groupByDay` keeps the order, one group per UK day, no heading twice; tag of an entry: `NOTE` for a note of the page's record, `CHANGE` for another event of the record, `DEAL` when `deal` is set. In `tests/unit/messages.test.ts`: the codes `note_required`, `note_too_long`, `note_not_found`, `note_gone`, `note_edit_conflict`, `note_record_archived`, `note_delete_confirm`, `no_notifications` and the templates `mention_cannot_see`, `mentioned_you`, `edited_by`, `notifications_label`, `note_deleted` with their exact texts from contracts/routes.md § Messages
- [ ] T007 Implement `src/server/records/notes-rules.ts` (`validateNoteText` with max 10,000 visible characters after trim, `tokenizeMentions`, `detokenize`, `noteSegments`, `notificationPreview` (200 characters), `parseShown` (multiple of 50, 50–5,000, else 50)); T005 passes
- [ ] T008 Implement `ukDayKey`, `formatDayHeading`, `formatTime` in `src/server/format.ts` and `groupByDay`, `entryTag` in `src/server/records/timeline-view.ts` (pure); T006 format and view parts pass
- [ ] T009 [P] Add to `src/server/messages.ts`: `note_required` "Write something before adding the note.", `note_too_long` "Keep the note under 10,000 characters.", `note_not_found` "This note doesn't exist or you can't see it.", `note_gone` "This note doesn't exist any more.", `note_edit_conflict` "Someone else changed this note while you were editing. Reload to see their changes.", `note_record_archived` "Restore this record before changing its notes.", `note_delete_confirm` "Delete this note? This can't be undone.", `no_notifications` "No notifications yet."; templates `mention_cannot_see(name)` "<name> can't see this record, so they can't be mentioned.", `mentioned_you(name, record)` "<name> mentioned you in a note on <record>", `edited_by(name)` "edited by <name>", `notifications_label(n)` "Notifications (<n>)", `note_deleted(_name)` "Note deleted."; add `note_deleted` to `CODES` in `src/server/records/flash.ts` (with a unit case in `tests/unit/flash.test.ts`)
- [ ] T010 `visiblePerson(db, viewer, alias)` and `visibleDeal(db, viewer, alias)` in `src/server/records/visibility.ts` accept `viewer: number | Fragment` (a postgres.js fragment such as ``db`u.id` ``) — research.md §5; existing callers unchanged; a unit-free check: `npm run typecheck`
- [ ] T011 Timeline read in `src/server/records/timeline.ts` (research.md §6, data-model.md § Timeline entry): `EventKind` + `"note"`; `readTimeline(viewerId, target, limit = 50)` returns `{ entries, more }` ordered `e.created_at desc, e.id desc` with `limit + 1`; each entry adds `authorActive`, `deal: null` for now, and for a note `note: { segments, editedByName, version }` — the mentions of the notes on the page come from one query on `note_mentions` joined to `users` (current names), passed to `noteSegments`; editor shown with " (deactivated)" when so. Update the 5 callers (`src/app/(app)/deals/[id]/page.tsx`, `src/app/(app)/people/[id]/page.tsx`, `src/app/(app)/organisations/[id]/page.tsx`, `src/app/(app)/deals/page.tsx`, `src/app/(app)/deals/list/page.tsx`) to the new return shape; existing timeline tests still pass

**Checkpoint**: rules, messages, formatting, visibility and the timeline read ready.

---

## Phase 3: User Story 1 - Write notes on deals, people and organisations (Priority: P1) 🎯 MVP

**Goal**: A note box above the timeline on every record page; notes added, edited (with "edited by"), deleted (with confirmation), refused on archived records, refused for records the user cannot see, refused on a stale edit.

**Independent Test**: With the fake data loaded, add "Called Ada, wants a proposal by Friday" on a deal, a person and an organisation; each shows first under "// TODAY · <date>", tagged NOTE, with the author and time; edit one, delete another; reload and confirm.

### Tests for User Story 1

- [ ] T012 [P] [US1] Integration test `tests/integration/notes.test.ts` (covers FR-005–FR-009, US1 scenarios 1–8, SC-006, Edge Cases): `addNote` on a deal, a person and an organisation stores trimmed text with line breaks, author and date and the entry is first in `readTimeline`; empty → `note_required`, 10,001 characters → `note_too_long`, nothing stored; `editNote` by another user keeps author, `created_at` and place, sets `edited_by`/`edited_at`, `version + 1`, and a second editor replaces "edited by"; a stale `version` → `conflict`; a deleted note → `gone`; empty edit → `note_required`; `deleteNote` removes it; a note id posted with another record's target → `not_found`; on a private deal or person of someone else and on a deleted record → `not_found` for add, edit and delete; on an archived record → `archived` for add, edit and delete and the notes are still read; restoring makes them changeable again; deleting the record (admin delete) removes its notes; two notes added at the same moment are both kept; a note whose author is deactivated reads `authorActive: false` and can still be edited
- [ ] T013 [P] [US1] Playwright test `tests/e2e/notes.spec.ts` (covers US1 scenarios 1–5, 7, 8): on a deal page, a person page and an organisation page `[ ADD NOTE ]` with an empty box shows "Write something before adding the note."; a two-line note appears first under "// TODAY · <date>" with tag NOTE, "Ada Fake", the time, both lines, and the box empties; the textarea does not accept more than 10,000 characters; `[ EDIT ]` → change → `[ SAVE ]` shows the new text marked "edited by Ada Fake"; `[ CANCEL ]` keeps the old text; `[ DELETE ]` shows "Delete this note? This can't be undone.", confirming shows "Note deleted." and the note is gone after a reload; two pages editing the same note → the second save shows "Someone else changed this note while you were editing. Reload to see their changes."; an archived record shows its notes with no box and no `[ EDIT ]`/`[ DELETE ]`; `/deals/<id>?note=999999&delete-note=abc` shows the page normally
- [ ] T014 [US1] Supabase Postgres has no public schema on GitHub, so there is no fake to check against a schema: the tests use a real local PostgreSQL 17, and the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler). It copies its limits: no prepared statements (`prepare: false`, unchanged in `src/server/db.ts`), no session state (no `set`, `listen` or session advisory lock), every multi-statement change in one `sql.begin()` transaction, at most 5 connections (`max: 5`). Extend the check in `tests/integration/migrate.test.ts` so it also scans `src/server/records/notes.ts`, `src/server/records/timeline.ts` and `src/server/notifications.ts` for `set `/`listen`/`pg_advisory_lock` and fails on any, and checks `migrations/0007_notes_mentions.sql` has no `begin`/`commit`/`concurrently`/`vacuum`, applies on a fresh database, and that its kind check accepts both `'note'` and `'imported'`

### Implementation for User Story 1

- [ ] T015 [US1] Implement `addNote`, `editNote`, `deleteNote`, `noteForEdit` in `src/server/records/notes.ts` (contracts/routes.md § Domain functions, data-model.md § State changes, research.md §10): each in one `sql.begin()`; the record row locked `for update` with `visiblePerson`/`visibleDeal` for the actor (organisations: exists) and `archived_at is null` (else `archived`); text through `validateNoteText` (visible text, max 10,000 after trim) then `tokenizeMentions`; edit `update … where id = $note and version = $version and <the note's target equals the posted target>`, on no row re-read to answer `not_found` / `gone` / `conflict`; mention handling left as a `mentionIds` parameter that US3 fills in (store nothing for now, keep the signature); T012 passes
- [ ] T016 [US1] Server actions in `src/app/(app)/records/note-actions.ts` (contracts/routes.md § Server actions): `addNote(prev, form)`, `editNote(prev, form)`, `deleteNote(form)`; each calls `requireUser()` first; `target` only `deal|person|organisation`, ids via `parseId`, malformed → `note_not_found`; refusals return `FormState` (`src/app/(app)/records/form-state.ts`) with `errors.body` and the typed values; add revalidates the record path; edit redirects to the record page `#entry-<id>`; delete sets flash `note_deleted` and redirects to the record page, or `?error=note_not_found` / `?error=note_record_archived`
- [ ] T017 [P] [US1] Client component `src/app/(app)/records/NoteBox.tsx` (`"use client"`, contracts/routes.md § Client components): textarea `aria-label="Note"`, `maxLength={10000}`, `[ CANCEL ]` and `[ ADD NOTE ]` (add) or `[ SAVE ]` (edit, hidden `noteId` and `version`), hidden `target`/`targetId`; `useActionState`; the refusal shown with `FieldError`; empties after a successful add (key on `seq`). Leave a `candidates` prop (default `[]`) for US3
- [ ] T018 [P] [US1] Server component `src/app/(app)/records/NoteDeleteConfirm.tsx`: inline `.confirm` box with `messages.note_delete_confirm`, `[ DELETE ]` form posting to `deleteNote` (hidden target, targetId, noteId) and `[ CANCEL ]` link back to `#entry-<id>`
- [ ] T019 [US1] Server component `src/app/(app)/records/RecordTimeline.tsx` (contracts/routes.md § Pages, design B): `// TIMELINE` heading, the `NoteBox` when not `readOnly` and the record is not archived, then `groupByDay(entries, now)` with `.day` headings; each entry `id="entry-<id>"`, tag (`entryTag`), and for a note the author (" (deactivated)" when so), `formatTime`, `.notebody` with the segments as text nodes, `templates.edited_by(name)` when edited, and `[ EDIT ]` (`?note=<id>#entry-<id>`, `scroll={false}`) / `[ DELETE ]` (`?delete-note=<id>#entry-<id>`) only for notes of the page's own record when not archived; the note named by `?note=` (only if it is among those shown with `[ EDIT ]`) renders as `NoteBox` in edit mode pre-filled from `noteForEdit`; the note named by `?delete-note=` gets `NoteDeleteConfirm`; other entries reuse the change lines of `src/app/(app)/records/Timeline.tsx` (export `Line`)
- [ ] T020 [US1] Use `RecordTimeline` on `src/app/(app)/deals/[id]/page.tsx` (replacing `// HISTORY`), `src/app/(app)/people/[id]/page.tsx` and `src/app/(app)/organisations/[id]/page.tsx`: read `?note=` and `?delete-note=` with `parseId`; add `readFlash(["note_deleted"])` and show it; allow-list `note_not_found`, `note_record_archived` in each page's `?error=` handling
- [ ] T021 [US1] CSS in `src/app/globals.css` per `design-options.html` B: `.day` mono uppercase headings with an orange `//`; `.ent` rows (tag, body, time on the right); `.kd` tags (`note` orange, `deal` blue, change muted); `.notebody` with a 3px `var(--orange)` left border, `var(--note)` background (add `--note: rgba(255,66,0,.06)`, dark `rgba(255,66,0,.12)`), `white-space: pre-wrap`, `overflow-wrap: anywhere`; the note box textarea and its buttons right-aligned

**Checkpoint**: notes can be added, edited and deleted on every record page.

---

## Phase 4: User Story 2 - One timeline per record, including what happens on its deals (Priority: P1)

**Goal**: Person and organisation timelines also list their linked deals' notes and changes (tag DEAL, deal title linked, "Archived"), once each; 50 at a time with `[ SHOW MORE ]`; the deal drawer shows the timeline read-only.

**Independent Test**: Link "Ada Example" and "Example Ltd Fake" to a deal; add a note on the deal and move it; both entries appear on Ada's and Example Ltd Fake's timelines under the deal's title, among their own entries in date order.

### Tests for User Story 2

- [ ] T022 [P] [US2] Integration test `tests/integration/timeline-deal-entries.test.ts` (covers FR-001–FR-003, US2 scenarios 1–7, SC-004, Edge Cases): a deal's notes and changes appear on the timeline of its main person, of each other linked person and of its organisation, each exactly once, with `deal: { id, title, archived }`, merged with the record's own entries newest first, and on no other person's or organisation's timeline; a person who is both main person and in `deal_people` sees each entry once; unlinking (or changing the deal's organisation) removes them, relinking brings back all of them (before and after); the deal's "Linked Ada Example" appears once on Ada's timeline; an archived deal's entries stay with `archived: true`; a deleted deal's entries are gone everywhere; an organisation's timeline does not show deals of its people that are not its deals; 120 entries → `limit 50` gives 50 and `more: true`, `limit 100` gives the next 50 in order, no repeat or gap, `limit 150` gives 120 and `more: false`; a record with only "Added" reads one entry
- [ ] T023 [P] [US2] Integration test `tests/integration/timeline-performance.test.ts` (covers SC-003): a person with 400 own entries and 3 linked deals with 200 entries each (1,000 total) → `readTimeline(…, 50)` answers in under 2 s (and the organisation the same)
- [ ] T024 [P] [US2] Playwright test `tests/e2e/timeline.spec.ts` (covers US2 scenarios 1–5, 7): the deal page reads "// TIMELINE" (no "// HISTORY") with day headings and NOTE/CHANGE tags; after linking a person and an organisation to a deal, adding a note and moving the deal, the person's and organisation's pages show both entries tagged DEAL under the deal title (a link to `/deals/<id>`); after unlinking the person they leave the person's page; with > 50 entries `[ SHOW MORE ]` shows more without a day heading twice; an archived deal's entries show "Archived"; the board drawer shows the deal's timeline without a note box

### Implementation for User Story 2

- [ ] T025 [US2] Extend `readTimeline` in `src/server/records/timeline.ts` (research.md §6): person P → `e.person_id = P or e.deal_id in (select d.id from deals d where (d.person_id = P or exists (select 1 from deal_people dp where dp.deal_id = d.id and dp.person_id = P)) and visibleDeal(d))`; organisation O → `e.organisation_id = O or e.deal_id in (select d.id from deals d where d.organisation_id = O and visibleDeal(d))`; both keep `(e.related_person_id is null or visiblePerson(rp))`; left join `deals de on de.id = e.deal_id` to fill `deal: { id, title, archived }` when the page is a person or organisation; T022 and T023 pass
- [ ] T026 [US2] Paging in `RecordTimeline.tsx` and the three record pages: `?timeline=` through `parseShown`, passed as `limit`; `[ SHOW MORE ]` when `more`, a link to the same page with `timeline=<n+50>` and `#entry-<last shown id>`, `scroll={false}`; DEAL entries show the deal title as a link (`/deals/<id>`) with an "Archived" badge when archived, then the note box or the change line, and never `[ EDIT ]`/`[ DELETE ]` (spec Clarifications)
- [ ] T027 [US2] Deal drawer `src/app/(app)/deals/DealDrawer.tsx` (board and list): `<RecordTimeline readOnly>` with the newest 50 entries and no note box; when `more`, `[ SHOW MORE ]` links to `/deals/<id>?timeline=100`; remove the `heading` prop use of `Timeline` there; `src/app/(app)/records/Timeline.tsx` keeps only the change lines (`Line`), with the deal wording ("Linked <person> by <name>") chosen by the entry's record kind
- [ ] T028 [US2] CSS in `src/app/globals.css`: `.on-deal` deal title line above a DEAL entry, long titles wrap; `[ SHOW MORE ]` centred under the list

**Checkpoint**: every record shows one timeline with its deals' entries and paging.

---

## Phase 5: User Story 3 - @mention a teammate in a note (Priority: P2)

**Goal**: "@" in the note box offers active users who can see the record; saved mentions are highlighted with the current name; mentioned users get in-app notifications with a sidebar count and a Notifications page.

**Independent Test**: As Ada Fake, write a note on a deal mentioning "@Linus Fake"; as Linus Fake the sidebar shows "Notifications (1)", the page lists "Ada Fake mentioned you in a note on <deal title>" with the start of the note; opening it goes to the deal page and clears the count.

### Tests for User Story 3

- [ ] T029 [P] [US3] Integration test `tests/integration/notifications.test.ts` (covers FR-010–FR-013, US3 scenarios 1–7, Edge Cases): `mentionCandidates` lists active users (never deactivated) ordered by name; a note mentioning Linus creates one `note_mentions` row (`mentioned_by` = author) and `unreadCount(linus) = 1`; mentioning yourself or the same person twice gives no self-notification and one row per person; an edit adding Cy and keeping Linus inserts only Cy's row (`mentioned_by` = editor) and leaves Linus's `read_at` as it was; an edit removing Linus deletes his row; deleting the note removes its rows; deleting the record removes them; `listNotifications` newest first with `byName`, `recordName` (deal title / person name / organisation name), `href`, a 200-character `preview` with current names, `read`; 60 notifications → 50 and `more: true`; `openNotification` marks read and returns the record's href, and returns null for another user's notification; `markAllRead` clears the count; a renamed user's mention reads the new name; a deactivated mentioned user stays in the note as "@<name>"; a token typed by hand for a user not mentioned stays plain text
- [ ] T030 [P] [US3] Playwright test `tests/e2e/mentions.spec.ts` (covers US3 scenarios 1–4): as Ada Fake typing "@Li" in a deal's note box offers "Linus Fake" (`role="option"`), choosing puts "@Linus Fake" in the box; the saved note highlights "@Linus Fake" (`mark.mention`) and "ada@example.fake" in another note stays plain; signed in as Linus Fake the sidebar link has the accessible name "Notifications (1)"; `/notifications` lists "Ada Fake mentioned you in a note on <deal title>" with the date and start of the note; pressing it opens the deal page and the badge is gone; `[ MARK ALL AS READ ]` clears another unread one; with none, "No notifications yet."

### Implementation for User Story 3

- [ ] T031 [US3] Mentions in `src/server/records/notes.ts`: `mentionCandidates(viewerId, target)` = `users u` with `u.status = 'active'` passing `visiblePerson(db, db\`u.id\`, …)` / `visibleDeal(db, db\`u.id\`, …)` on the record (organisations: all active users), `[]` when the viewer cannot see the record; `addNote` / `editNote` resolve the posted `mentionIds` (de-duplicated) to current names, tokenize, and refuse a new id that is not an active user who can see the record with `{ status: "cannot_mention", name }` (nothing saved; an id already mentioned in the edited note is kept, research.md §5); insert `note_mentions` rows (`mentioned_by` = saver, self included), on edit delete rows no longer mentioned and insert new ones only; `noteForEdit` returns the mentions with current names
- [ ] T032 [US3] `src/server/notifications.ts` (contracts/routes.md, research.md §4): `listNotifications(userId, limit)`, `unreadCount(userId)`, `openNotification(userId, eventId)`, `markAllRead(userId)`; every read filters `m.user_id = $me and m.user_id <> m.mentioned_by` and the note's record visible to `$me` (join `timeline_events e`, left join `persons`/`deals`/`organisations` on its target, `visiblePerson`/`visibleDeal` for `$me`); order `m.created_at desc, m.event_id desc`; preview via `notificationPreview`; T029 passes
- [ ] T033 [US3] `NoteBox.tsx` mention picker: opens after "@" + letters at the caret, filters `candidates` whose name starts with or contains the letters (case-insensitive), `role="listbox"` / `role="option"`, arrow keys, Enter or click chooses, Escape closes; choosing replaces "@letters" with "@<name> " and adds a hidden `mention` input with the id; edit mode pre-fills the mentions; the record pages pass `mentionCandidates(user.id, target)`; `note-actions.ts` reads `form.getAll("mention")` (ids via `parseId`, at most 50) and shows `templates.mention_cannot_see(name)` on refusal
- [ ] T034 [US3] Highlighted mentions in `RecordTimeline.tsx`: mention segments render as `<mark className="mention">@{name}</mark>` (text nodes only, no link)
- [ ] T035 [US3] Notifications page `src/app/(app)/notifications/page.tsx` and actions `src/app/(app)/notifications/actions.ts` (contracts/routes.md § `/notifications`): `requireUser()`; `// NOTIFICATIONS` heading, `[ MARK ALL AS READ ]` when any unread; each notification a form button posting `openNotification` (hidden `eventId`) with `templates.mentioned_you(byName, recordName)`, `formatDateTime`, the preview and an "Unread" badge; `?shown=` via `parseShown` with `[ SHOW MORE ]`; empty → `messages.no_notifications`; `openNotification` action redirects to the returned href or `/notifications`; `markAllNotificationsRead` redirects to `/notifications`
- [ ] T036 [US3] Sidebar: add `{ href: "/notifications", label: "Notifications" }` after Organisations in `src/app/(app)/nav.ts`; `src/app/(app)/layout.tsx` reads `unreadCount(user.id)` and passes `count` to that link; `src/app/(app)/SidebarLink.tsx` shows `<span className="cnt">{count}</span>` and `aria-label={templates.notifications_label(count)}` when count ≥ 1; update `tests/e2e/layout.spec.ts` for the new link
- [ ] T037 [US3] CSS in `src/app/globals.css`: `mark.mention` (blue text on `var(--wash)`, no underline), the picker list under the textarea (bordered, current option `var(--wash)`), `.cnt` orange badge in the sidebar, notification rows (unread bold)

**Checkpoint**: mentions notify teammates in the app.

---

## Phase 6: User Story 4 - Private records keep their notes private (Priority: P1)

**Goal**: Notes on private people and deals are seen, counted, changed, mentioned and notified only for those allowed, on every timeline, list and direct request.

**Independent Test**: As Ada Fake, make a deal private and add a note; as Grace Fake (admin), open the deal's organisation and main person: no entry of the deal; Grace is not offered in Ada's mention list for that deal.

### Tests for User Story 4

- [ ] T038 [P] [US4] Integration test `tests/integration/notes-private.test.ts` (covers FR-015, US4 scenarios 1–5, SC-005): a private deal's notes and changes never appear on its person's or organisation's timeline for an admin it is hidden from, and the `more` flag and entry count are the same as without the deal; a private person's notes never appear for someone hidden from, and nothing about them on linked organisation or deal timelines; `mentionCandidates` on a private deal or person lists only its creator and owner (active); a direct `addNote`/`editNote` mentioning anyone else → `cannot_mention` with their name, nothing saved; a notification on a shared deal made private is not listed or counted for the hidden user and `openNotification` returns null; sharing again brings it back; after `handOverPrivateRecords` (SF-97) the new owner reads the deal's notes and can edit them
- [ ] T039 [P] [US4] Playwright test `tests/e2e/notes-private.spec.ts` (covers US4 scenarios 1, 3, 4): as Ada Fake make a deal private and add a note; as Grace Fake its organisation and main person pages show no entry of that deal; as Ada typing "@Gr" in that deal's box does not offer Grace Fake; a notification to Linus on a deal later made private is gone from his page and count

### Implementation for User Story 4

- [ ] T040 [US4] Fix any leak T038 finds in `src/server/records/timeline.ts`, `src/server/records/notes.ts` or `src/server/notifications.ts`, keeping the rule only in `visibility.ts` (no second copy of the private rule); T038 and T039 pass

**Checkpoint**: privacy holds everywhere notes appear.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T041 Fake data `src/seed/notes.ts` registered after `deals` in `src/seed/index.ts` (data-model.md § Fake data, FR-018): idempotent (a note is found by its record and exact body); 2 notes on deals, 2 on people (one on "Ada Example"), 1 on "Example Ltd Fake"; 2 notes mentioning fake users (one notification read, one unread); 1 note edited by another fake user (`edited_by`, `edited_at`, `version = 2`); 1 note on a private deal and 1 on "Pat Privatefake" (private person); clearly fake text only. Extend `tests/integration/seed.test.ts`: running the seed twice adds nothing the second time; notes on each record kind, a read and an unread notification, an edited note and notes on private records exist
- [ ] T042 [P] Docs: append to `docs/DECISIONS.md` the three people-made choices from spec Clarifications, one line each: "The timeline uses design B: entries grouped by day with a NOTE, DEAL or CHANGE tag and the time, notes in a box with an orange left edge, the note box above the timeline (SF-102)", "A teammate mentioned in a note is told in the app only: Notifications in the sidebar and a Notifications page, no email (SF-102)", "Anyone who can see a note can edit or delete it (SF-102)" (not the factory's "to confirm" choices; check `tests/unit/decisions.test.ts` still passes); README: notes, mentions, notifications and the new fake data; AGENTS.md § Layout: `notes.ts`, `notes-rules.ts`, `timeline-view.ts`, `src/server/notifications.ts`, `NoteBox.tsx`, `RecordTimeline.tsx`, `src/app/(app)/notifications/`
- [ ] T043 Run `quickstart.md` end to end: `npm run test:schemas && npm test && npm run test:e2e && npm run typecheck` green with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`; the SF-90 to SF-97 tests (history lines, drawers, hand-over) still pass after the `// HISTORY` → `// TIMELINE` change (update their expected heading only)
- [ ] T044 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — keep Google Sign-In as it is and extend the Supabase Postgres line: no fake, a real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres, and the SF-102 code (`src/server/records/notes.ts`, `timeline.ts`, `src/server/notifications.ts`) keeps to the same pooler limits with its table and columns from `migrations/0007_notes_mentions.sql` (timeline_events body/edited_by/edited_at/version and kind `note`, note_mentions), applied on a fresh database by `tests/integration/migrate.test.ts` — and `## Schemas` (each schema's GitHub URL at its commit: oauth2-api.json unchanged, nothing added); also describe the new fake notes and notifications in the `reset-db.sh` / seed line

---

## Dependencies & Execution Order

- **Setup (T001–T004)** → **Foundational (T005–T011)** → stories.
- **US1** (notes) needs Foundational. **US2** (deal entries, paging, drawer) needs US1's `RecordTimeline` (T019). **US3** (mentions) needs US1's `NoteBox`, `notes.ts` and actions. **US4** (privacy) checks US1–US3 together, so it runs last although it is P1: its scenarios 3–4 are about mentions and notifications.
- Within each story: tests first (fail), then domain functions, then actions, then pages/components.
- T041 (seed) after US3 (it needs mentions); T044 is the last task.

### Parallel opportunities

- Setup: T002, T003, T004 together after T001.
- Foundational: T005, T006, T009 together; T007 after T005, T008 after T006; T010 beside them; T011 after T007 and T010.
- Every story's test tasks marked [P] together (different files).
- US1: T017 and T018 together after T016. US2's T023 beside T022. US3: T029 and T030 together.

### Parallel example: User Story 1

```text
T012 tests/integration/notes.test.ts
T013 tests/e2e/notes.spec.ts
```

## Implementation Strategy

- **MVP**: Setup + Foundational + US1 (notes on every record page, with privacy already enforced by the visibility helpers), then US2 (one timeline with deal entries), the other P1 story that needs no mentions.
- Then US3 (P2 mentions and notifications) and US4 (privacy tests across everything); each checkpoint is a working, tested increment.
- Choices made here without asking: US4 is placed after US3 because half of its scenarios test mentions and notifications; the Supabase Postgres task (T014) sits in US1, the first story whose code writes the new columns; the seed is in the Polish phase because it needs every story's tables and functions; the test recipe (T044) is the last task.
