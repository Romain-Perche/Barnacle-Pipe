# Data model: Timeline and notes (SF-102)

## Migration `migrations/0006_notes_mentions.sql`

Only statements allowed in a transaction; RLS on (no policy) after the one `create table`.

```sql
-- SF-102: notes on the timeline, @mentions and their notifications (data-model.md).

-- A note is a timeline entry of kind 'note' (research.md §2).
alter table timeline_events add column body text null check (char_length(body) <= 100000);
alter table timeline_events add column edited_by bigint null references users (id);
alter table timeline_events add column edited_at timestamptz null;
alter table timeline_events add column version int not null default 1;
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note'));
alter table timeline_events add constraint timeline_events_note_check
  check ((kind = 'note') = (body is not null) and (kind = 'note' or (edited_by is null and edited_at is null)));
alter table timeline_events add constraint timeline_events_note_author_check
  check (kind <> 'note' or actor_id is not null);

-- Mentions; a mention of someone other than who saved it is a notification (research.md §4).
create table note_mentions (
  event_id bigint not null references timeline_events (id) on delete cascade,
  user_id bigint not null references users (id),
  mentioned_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  primary key (event_id, user_id)
);
alter table note_mentions enable row level security;
create index note_mentions_user_idx on note_mentions (user_id, created_at desc, event_id desc);
create index note_mentions_unread_idx on note_mentions (user_id) where read_at is null;
```

The body's DB limit (100,000) is only a guard: the 10,000-character rule applies to the visible text (with "@names")
in `rules.ts` before tokens replace names (research.md §3). Build first confirms on a migrated database that
`timeline_events_kind_check` is the current constraint name (it is since 0005).

`tests/support/reset.ts` (and `.factory/run/reset-db.sh` if it lists tables) empties `note_mentions`;
`tests/integration/rls.test.ts` gets `note_mentions`.

## Entities

### Note (`timeline_events` where `kind = 'note'`)

| Field | Column | Rule |
|---|---|---|
| id | `id` | |
| record | `person_id` / `organisation_id` / `deal_id` | exactly one (existing check); cascade on record delete |
| author | `actor_id` | the user who added it; shown "<name> (deactivated)" when deactivated |
| written at | `created_at` | never changes; fixes the note's place |
| text | `body` | trimmed visible text 1–10,000 characters; mentions as `@[user:<id>]` tokens |
| last editor | `edited_by`, `edited_at` | null until the first edit; "edited by <name>" |
| version | `version` | +1 on each edit; optimistic check (FR-006) |

### Mention / notification (`note_mentions`)

| Field | Rule |
|---|---|
| `event_id` | the note; cascade on note delete (and so on record delete) |
| `user_id` | the mentioned user; one row per note |
| `mentioned_by` | who saved the note with this mention (the author, or the editor who added it) |
| `created_at` | when the mention was added: the notification's date and order |
| `read_at` | null = unread |

A notification is a row with `user_id <> mentioned_by`, shown and counted only while the note's record passes
`visiblePerson` / `visibleDeal` for `user_id` (organisations: always) — research.md §4.

### Timeline entry (read model, `src/server/records/timeline.ts`)

```ts
type TimelineEntry = TimelineEvent & {          // TimelineEvent as today, kind now also "note"
  deal: { id: number; title: string; archived: boolean } | null; // set on a person's / organisation's timeline for a deal's entry
  note: {
    segments: ({ text: string } | { mention: string })[];        // noteSegments(); mention = current name
    editedByName: string | null;                                  // with " (deactivated)" when so
    version: number;
  } | null;
  authorActive: boolean;                                          // "(deactivated)" after the author's name
};
type TimelinePage = { entries: TimelineEntry[]; more: boolean };
```

## State changes

| Action | Checks (in one transaction) | Writes |
|---|---|---|
| add note | user active; record exists, visible, not archived; text valid; each mention id active and can see the record | insert event `kind='note'`, `actor_id`, `body`; insert `note_mentions` per id (`mentioned_by` = actor) |
| edit note | note exists on the posted record; record visible and not archived; `version` matches; text valid; new mention ids active and can see the record | update `body`, `edited_by`, `edited_at = now()`, `version + 1`; delete mentions no longer present; insert new ones (`mentioned_by` = editor) |
| delete note | note exists on the posted record; record visible and not archived | delete event (mentions cascade) |
| open notification | row is the user's own, not self, record visible | `read_at = coalesce(read_at, now())` |
| mark all read | — | `read_at = now()` for the user's unread rows (visible or not: harmless) |

Unchanged: record delete cascades to notes and mentions; SF-92's "events about a person private when deleted are
removed" deletes by `related_person_id`, notes have none; SF-97 hand-over changes `owner_id`, notes follow.

## Validation (`src/server/records/notes-rules.ts`, pure)

- `validateNoteText(raw)`: trim; empty → `note_required` ("Write something before adding the note."); > 10,000
  characters → `note_too_long` ("Keep the note under 10,000 characters."); returns the trimmed text.
- `tokenizeMentions(text, users: {id, name}[])`: replaces `@<name>` with `@[user:<id>]`, longest names first; returns
  `{ body, ids }` with only the ids actually found.
- `detokenize(body, names: Map<id, name>)`: back to visible text for the edit box.
- `noteSegments(body, names: Map<id, name>)`: segments; a token whose id is not in `names` (no mention row) stays text.
- `notificationPreview(body, names)`: visible text, first 200 characters (by code point, no cut surrogate pair),
  "…" appended when cut.
- `parseShown(value)`: `?timeline=` / `?shown=` → multiple of 50 in 50–5,000, else 50.

## Fake data (`src/seed/notes.ts`, registered after `deals` in `src/seed/index.ts`)

Idempotent: a note is identified by its record and its exact body; nothing is inserted when it exists.

- 2 notes on "Example Ltd Fake" deals, 2 on people (one "Ada Example"), 1 on an organisation ("Example Ltd Fake").
- 2 notes mentioning fake users (e.g. "@Bob Fake can you send the pricing sheet?"), one notification read, one unread.
- 1 note edited by another fake user (`edited_by`, `edited_at`, `version = 2`).
- 1 note on a private deal and 1 on a private person (seed's existing private records).
- Only clearly fake text; no real team names. Runs only through the gated seed command (`isFakeAllowed()`).
