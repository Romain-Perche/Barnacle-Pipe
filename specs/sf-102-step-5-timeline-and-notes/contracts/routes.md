# Contracts: Timeline and notes (SF-102)

The app's interfaces are its pages, their query parameters, server actions and domain functions. Every page calls
`requireUser()`; every action calls `requireUser()` first (nothing here is admin-only, FR-014). Domain functions
re-check visibility, archived state and version inside their transaction.

## Pages

### Record pages: `/deals/[id]`, `/people/[id]`, `/organisations/[id]` (changed)

The `// HISTORY` / `// TIMELINE` section is replaced by `<RecordTimeline>` (design B):

```
// TIMELINE
[ note box ]                      ← not on archived records
           [ CANCEL ] [ ADD NOTE ]
// TODAY · 20 NOV 2026
NOTE   Ada Fake                                     10:14
       ┃ Spoke to Ada. @Bob Fake can you…  (orange left edge)
       edited by Bob Fake
       [ EDIT ] [ DELETE ]        ← own-record notes only, not archived
// 19 NOV 2026
DEAL   Example Ltd Fake · website [Archived]        16:02   ← person / organisation timelines only
       Moved from Qualified to Proposal by Bob Fake
CHANGE Edited by Ada Fake: Role                     11:45
[ SHOW MORE ]                      ← when more entries exist
```

| Query parameter | Meaning | Values |
|---|---|---|
| `timeline` | how many entries to show | multiple of 50, 50–5,000; anything else = 50 |
| `note` | id of the note shown as edit box | id of a note shown on this page with `[ EDIT ]`; else ignored |
| `delete-note` | id of the note showing the delete confirmation | same rule |

Existing parameters (`confirm`, `error`, `back`) are unchanged and kept on the `[ SHOW MORE ]` link only for
`timeline`. Each entry has `id="entry-<id>"`; `[ SHOW MORE ]`, `[ EDIT ]`, `[ DELETE ]` and `[ CANCEL ]` link with that
anchor and `scroll={false}`.

- Tags: `NOTE` (a note of this record), `CHANGE` (any other event of this record), `DEAL` (an entry of a linked deal on
  a person's or organisation's page; the deal title links to `/deals/<id>`, "Archived" badge when archived; a note's box
  or a change's line follows).
- A note entry: author's name (`(deactivated)` when so), the time, the text in `.notebody` (`white-space: pre-wrap`,
  `overflow-wrap: anywhere`, orange left edge, `--note` background), mentions in `<mark class="mention">@Name</mark>`,
  "edited by <name>" when edited.
- `[ EDIT ]` / `[ DELETE ]` only on notes of the page's own record and only when the record is not archived; DEAL
  entries are read-only (spec Clarifications: changed on the deal page).
- Deal drawer (board `/deals?deal=` and list `/deals/list?deal=`): shows the newest 50 entries of the deal read-only
  (`<RecordTimeline readOnly>`), with no note box; when there are more, `[ SHOW MORE ]` links to
  `/deals/<id>?timeline=100`.
- Flash on these pages: `note_deleted` ("Note deleted.") is added to each page's allowed codes.

### `/notifications` (new)

`// NOTIFICATIONS` header with `[ MARK ALL AS READ ]` (shown when any unread), then the user's notifications newest
first (`created_at desc, event_id desc`), 50 at a time (`?shown=` as `timeline`, `[ SHOW MORE ]`). Each row is a form
button (`openNotification`) reading:

- `templates.mentioned_you(name, recordName)`: "<name> mentioned you in a note on <record name>" (`name` =
  `mentioned_by`'s current name; `recordName` = deal title / person's name / organisation's name),
- the UK date and time, the first 200 characters of the note (`notificationPreview`), and an "Unread" badge when unread
  (bold row).

Empty: "No notifications yet." Rows whose record the user cannot see are neither shown nor counted.

### Sidebar (changed, every signed-in page)

`mainNav` gets `{ href: "/notifications", label: "Notifications" }` after Organisations. The link shows
`<span class="cnt">n</span>` when n ≥ 1 and has the accessible name "Notifications (n)" (`aria-label`); at 0 it reads
"Notifications".

## Server actions

All in `src/app/(app)/records/note-actions.ts` except the last two (`src/app/(app)/notifications/actions.ts`). Inputs
are form fields; ids parsed with `parseId`; anything malformed → `note_not_found`.

| Action | Fields | Success | Refusal |
|---|---|---|---|
| `addNote(prev, form)` | `target` (`deal`/`person`/`organisation`), `targetId`, `body`, `mention` (repeated ids) | `revalidatePath` of the record page, returns `{ ok, seq }` so the box empties | `FormState` with `errors.body` = code (`note_required`, `note_too_long`, `note_record_archived`, `note_not_found`) or the template `mention_cannot_see` with `name`; values kept |
| `editNote(prev, form)` | `target`, `targetId`, `noteId`, `version`, `body`, `mention` | redirect to the record page `#entry-<id>` (edit mode closed) | as add, plus `note_edit_conflict`, `note_gone` |
| `deleteNote(form)` | `target`, `targetId`, `noteId` | `setFlash({ code: "note_deleted" })`, redirect to the record page | redirect to the record page with `?error=note_not_found` / `note_record_archived` (allow-listed) |
| `openNotification(form)` | `eventId` | marks read, redirect to `/deals/<id>` / `/people/<id>` / `/organisations/<id>` | not the user's or not visible → redirect `/notifications` |
| `markAllNotificationsRead()` | — | redirect `/notifications` | — |

Redirect targets are built from numeric ids and fixed paths only.

## Domain functions

`src/server/records/notes.ts`

```ts
type NoteTarget = { dealId: number } | { personId: number } | { organisationId: number };
type NoteResult =
  | { status: "ok"; id: number }
  | { status: "invalid"; code: "note_required" | "note_too_long" }
  | { status: "cannot_mention"; name: string }
  | { status: "archived" } | { status: "not_found" } | { status: "gone" } | { status: "conflict" };

addNote(actorId: number, target: NoteTarget, text: string, mentionIds: number[]): Promise<NoteResult>
editNote(actorId: number, target: NoteTarget, noteId: number, version: number, text: string, mentionIds: number[]): Promise<NoteResult>
deleteNote(actorId: number, target: NoteTarget, noteId: number): Promise<{ status: "ok" | "archived" | "not_found" }>
mentionCandidates(viewerId: number, target: NoteTarget): Promise<{ id: number; name: string }[]>  // [] when the viewer can't see it
noteForEdit(viewerId: number, target: NoteTarget, noteId: number): Promise<{ text: string; mentions: { id: number; name: string }[]; version: number } | null>
```

`src/server/records/timeline.ts`

```ts
readTimeline(viewerId: number, target: NoteTarget, limit = 50): Promise<TimelinePage>   // research.md §6
```

`src/server/notifications.ts`

```ts
listNotifications(userId: number, limit = 50): Promise<{ items: NotificationView[]; more: boolean }>
unreadCount(userId: number): Promise<number>
openNotification(userId: number, eventId: number): Promise<{ href: string } | null>
markAllRead(userId: number): Promise<void>
type NotificationView = { eventId: number; byName: string; recordName: string; href: string; preview: string; createdAt: Date; read: boolean };
```

`src/server/records/visibility.ts`: `visiblePerson(db, viewer, alias)` / `visibleDeal(db, viewer, alias)` accept
`viewer: number | Fragment` (research.md §5).

## Client components

- `src/app/(app)/records/NoteBox.tsx` (`"use client"`): textarea (`maxLength={10000}`, `aria-label="Note"`), the
  mention list (`role="listbox"`, options `role="option"`; opens after "@" + letters, filters candidates whose name
  starts with or contains the letters, case-insensitive; arrow keys, Enter or click chooses, Escape closes; choosing
  replaces "@letters" with "@<name> " and adds a hidden `mention` input), `[ CANCEL ]` (empties the box, or leaves edit
  mode), `[ ADD NOTE ]` / `[ SAVE ]`. Uses `useActionState`; shows the refusal in `FieldError`; empties after a
  successful add.
- `SidebarLink.tsx`: optional `count` prop.

## Messages (`src/server/messages.ts`)

| Code | Text |
|---|---|
| `note_required` | Write something before adding the note. |
| `note_too_long` | Keep the note under 10,000 characters. |
| `note_not_found` | This note doesn't exist or you can't see it. |
| `note_gone` | This note doesn't exist any more. |
| `note_edit_conflict` | Someone else changed this note while you were editing. Reload to see their changes. |
| `note_record_archived` | Restore this record before changing its notes. |
| `note_delete_confirm` | Delete this note? This can't be undone. |
| `note_deleted` (flash) | Note deleted. |
| `no_notifications` | No notifications yet. |

| Template | Text |
|---|---|
| `mention_cannot_see(name)` | `<name> can't see this record, so they can't be mentioned.` |
| `mentioned_you(name, record)` | `<name> mentioned you in a note on <record>` |
| `edited_by(name)` | `edited by <name>` |
| `notifications_label(n)` | `Notifications (<n>)` |
