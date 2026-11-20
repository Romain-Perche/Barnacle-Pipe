# Research: Timeline and notes (SF-102)

Every open point of the plan, with the decision taken. No NEEDS CLARIFICATION is left.

## 1. Dependencies

- **Decision**: nothing added. The @mention picker is a small client component (textarea + filtered list) written in
  the repo; day headings and times use the existing `Intl.DateTimeFormat` helpers in `src/server/format.ts`.
- **Rationale**: a team of ≤ 10 users; the candidate list is passed to the page whole and filtered in the browser. A
  mention/rich-text library (tiptap, react-mentions…) would bring a markup format the spec forbids (plain text only).
- **Alternatives considered**: `react-mentions` (unmaintained, adds its own markup format); contenteditable editors
  (rich text, out of scope).

## 2. Where notes are stored

- **Decision**: a note is a row of `timeline_events` with `kind = 'note'` and new columns `body`, `edited_by`,
  `edited_at`, `version`. The author is the existing `actor_id`, the date the existing `created_at`, the record the
  existing `person_id` / `organisation_id` / `deal_id` (exactly one, already checked).
- **Rationale**: FR-004 asks for one timeline later features add to; `timeline.ts` already says "Later features add
  kinds to the same table". One table means one ordered, paged query (`created_at desc, id desc`) with no union, and
  the existing `on delete cascade` from persons, organisations and deals removes notes with their record (FR-008, edge
  case "note on a deleted person"). The SF-97 hand-over changes the record's owner, not its events, so notes follow a
  handed-over private deal for free (US4 scenario 5).
- **Alternatives considered**: a separate `notes` table plus a union in the timeline query (two sources to page
  together, a second set of cascades); a `notes` table with a pointer row in `timeline_events` (two rows to keep in
  step).

## 3. How mentions are kept in the text

- **Decision**: the stored `body` holds a token `@[user:<id>]` for each mention; the rest is the text as typed (trimmed).
  A token is shown as "@<current name>" only when the note has a `note_mentions` row for that user; any other
  token-like text is shown as typed.
  - Saving: the form sends the visible text (with "@Bob Fake") and the ids chosen in the picker (`mention` fields).
    The server validates the visible text (required, ≤ 10,000 characters after trim), then, for each id, replaces
    every `@<that user's current name>` in the text with the token. An id whose `@name` is no longer in the text is
    dropped (the user deleted it). Longest names first, so "@Bob Fakeson" is not taken for "@Bob Fake".
  - Editing: the server turns tokens back into "@<current name>" for the textarea and pre-fills the ids.
  - Showing: `noteSegments(body, names)` splits into text and mention segments; React renders them as text nodes
    (FR-016: no link, markup or formatting), `white-space: pre-wrap` keeps line breaks.
- **Rationale**: renames show the current name (edge case) and an email "ada@example.fake" stays plain text (no id
  chosen). Requiring the `note_mentions` row means a user typing a token by hand cannot make a fake highlighted mention.
- **Alternatives considered**: storing names and offsets (breaks on rename and on every edit); storing only the visible
  text and guessing mentions from names (an email or a common first name would notify people).

## 4. Notifications

- **Decision**: one table `note_mentions (event_id, user_id, mentioned_by, created_at, read_at)`. A row exists for each
  user mentioned in a note (one per note: primary key). A notification is a row with `user_id <> mentioned_by`.
  - Add: insert a row per mentioned id, `mentioned_by` = the saver.
  - Edit: keep the rows of users still mentioned untouched (no new notification, read state kept), insert rows for new
    ones (`mentioned_by` = the editor, `created_at` = now), delete rows of users no longer mentioned.
  - Delete note: rows go by `on delete cascade`.
  - Shown and counted only while the note's record is visible to the user (`visiblePerson` / `visibleDeal`), so a deal
    made private hides it and sharing it again brings it back (US4 scenario 4) with no copy to keep in step.
- **Rationale**: one row answers "who is mentioned" (highlighting), "who is notified" and "read or not"; FR-011 rules
  become plain inserts and deletes.
- **Alternatives considered**: a separate `notifications` table (duplicates the mention, two tables to keep in step on
  edit and delete).

## 5. Who can be mentioned

- **Decision**: candidates = users with `status = 'active'` for whom the record passes the visibility rule. The rule
  stays in one place: `visiblePerson(db, viewer, alias)` and `visibleDeal(db, viewer, alias)` accept, as `viewer`,
  either a user id or a SQL fragment (`db\`u.id\``), so the same fragment answers "which users can see this record".
  On save, a new mention id that is not an active user who can see the record is refused with
  `templates.mention_cannot_see(name)` ("<name> can't see this record, so they can't be mentioned.") and nothing is
  saved. An id already mentioned in the note being edited is kept even if that user was since deactivated or lost
  sight of the record (their notification stays hidden while they cannot see it).
- **Rationale**: FR-010, FR-015, US4 scenario 3; editing an old note must not fail because a teammate left.
- **Alternatives considered**: a second visibility helper "for user column" (two rules that could drift).

## 6. Timeline query and deal entries

- **Decision**: `readTimeline(viewerId, target, limit)` returns `{ entries, more }`, newest first
  (`order by e.created_at desc, e.id desc limit limit + 1`).
  - Deal: `e.deal_id = D`, deal visible, events about a hidden person left out (as today).
  - Person P (page already checks P is visible): `e.person_id = P` **or** `e.deal_id in (select d.id from deals d where
    (d.person_id = P or exists (select 1 from deal_people dp where dp.deal_id = d.id and dp.person_id = P)) and
    visibleDeal(d))`; events with a hidden related person left out.
  - Organisation O: `e.organisation_id = O` **or** `e.deal_id in (select d.id from deals d where d.organisation_id = O and
    visibleDeal(d))`; same related-person filter.
  - Each entry carries `deal: { id, title, archived } | null` (set when the entry is a deal's on a person or
    organisation timeline) and, for a note, `note: { segments, editedByName, version }`.
- **Rationale**: a `where … or … in (…)` on event ids returns each event once, so a deal whose main person is also an
  "other person" (or reached twice) never shows twice (FR-002, edge cases). Only current links count, so unlinking
  hides and relinking brings back all the deal's entries. "Linked Ada Example" is only recorded on the deal today
  (`links.ts`), so it appears once on Ada's timeline as a DEAL entry; nothing is recorded twice.
- **Alternatives considered**: joins (duplicate rows when a person is linked twice over); copying deal events onto
  people and organisations (copies go stale when links change).

## 7. Paging (`[ SHOW MORE ]`)

- **Decision**: the page reads `?timeline=<n>` (a whole multiple of 50, 50 to 5,000; anything else = 50) and shows the
  newest `n` entries; `[ SHOW MORE ]` is a link to the same page with `timeline=n+50` and `#entry-<id of the last entry
  shown>`, `scroll={false}`. The Notifications page does the same with `?shown=<n>`.
- **Rationale**: the whole list is re-read in a stable order, so nothing repeats or is skipped even when entries arrive
  in between (FR-003), and the day headings are grouped once over the whole list (edge case "no day heading twice").
  Server-rendered, no client state.
- **Alternatives considered**: keyset cursor appended by a client component (needs client merging of day groups);
  offset pages (skip or repeat when entries are added).
- **Performance**: SC-003 (1,000 entries, first page < 2 s) relies on the existing indexes
  `timeline_events_person_idx`, `timeline_events_organisation_idx`, `timeline_events_deal_idx`, `deal_people_person_idx`,
  `deals_person_id_idx`, `deals_organisation_id_idx`; an integration test measures it.

## 8. Day headings and times

- **Decision**: pure helpers in `format.ts`: `ukDayKey(date)` ("2026-11-20", Europe/London), `formatDayHeading(date,
  now)` ("TODAY · 20 NOV 2026" or "19 NOV 2026"), `formatTime(date)` ("10:14"). `groupByDay(entries, now)` in
  `src/server/records/timeline-view.ts` (pure) returns `[{ heading, entries }]`.
- **Rationale**: design B; UK time as every other date in the app; testable without a browser.

## 9. Edit and delete on the page (no JavaScript dialog)

- **Decision**: as `DeleteConfirm` and `?confirm=lost`: `[ EDIT ]` links to `?note=<id>#entry-<id>` and that note is
  shown as an edit box (`[ CANCEL ]` link back, `[ SAVE ]`); `[ DELETE ]` links to `?delete-note=<id>#entry-<id>` and
  shows an inline confirm "Delete this note? This can't be undone." with `[ DELETE ]` (form) and `[ CANCEL ]` (link). The
  id in the address only picks which note is in edit/confirm mode among those shown; nothing from the address is
  displayed. After a delete, the action redirects to the record page with the one-shot flash `note_deleted` ("Note
  deleted.").
- **Rationale**: same pattern as the rest of the app; works without client JavaScript except the mention picker.

## 10. Errors and concurrency

- **Decision**: `addNote` and `editNote` are server actions used with `useActionState` (`FormState` pattern of
  `form-state.ts`) so the typed text stays in the box on a refusal. Edits post the note's `version`; the update is
  `… where id = $1 and version = $2 and <record visible and not archived>`. On no row: re-read — record not visible →
  `note_not_found` ("This note doesn't exist or you can't see it."); note gone while record visible → `note_gone`
  ("This note doesn't exist any more."); version changed → `note_edit_conflict`. The record target is posted with the
  note id and must match the note's own record, else `note_not_found`.
- **Archived records**: add / edit / delete re-check `archived_at is null` on the record inside the transaction and
  answer `note_record_archived` ("Restore this record before changing its notes."); the page shows no box or buttons.

## 11. Sidebar count

- **Decision**: `mainNav` gets `{ href: "/notifications", label: "Notifications" }`; the layout reads
  `unreadCount(user.id)` and `SidebarLink` gets an optional `count` shown as an orange badge (design B `.cnt`) with the
  accessible name "Notifications (n)"; no badge at 0.
- **Rationale**: SC-002, the count is right on the next page load, no polling.

## 12. Opening a notification

- **Decision**: each notification is a form posting to the server action `openNotification(id)`, which marks it read
  (only the user's own, only while visible) and redirects to `/deals/<id>`, `/people/<id>` or `/organisations/<id>`.
  `[ MARK ALL AS READ ]` posts `markAllNotificationsRead`.
- **Rationale**: a GET link that changes data would be marked read by link prefetching.

## 13. Outside services

Only the app's own database, Supabase Postgres through its pooler, as in every earlier feature: no public schema on GitHub, tests use a real local Postgres; the new code keeps the pooler limits (no `set`/`listen`/session advisory lock, every multi-statement change in one `sql.begin()`). Notifications are in the app only (spec Clarifications), no email. No new fake.
