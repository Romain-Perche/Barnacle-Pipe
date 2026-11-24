# Data model: Files (SF-116)

## Migration `migrations/0010_files.sql`

Only statements allowed in a transaction; RLS on after every `create table` (no policies). Check the current name of
`timeline_events_kind_check` before dropping it (0009 recreated it under that name).

```sql
-- SF-116: files on deals, people and organisations; contents in Supabase Storage (specs/sf-116-step-8-files/data-model.md).
create table files (
  id bigint generated always as identity primary key,
  deal_id bigint null references deals (id) on delete cascade,
  person_id bigint null references persons (id) on delete cascade,
  organisation_id bigint null references organisations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  size bigint not null check (size between 1 and 26214400),
  kind text not null check (kind in ('jpeg', 'png', 'gif', 'webp', 'pdf', 'other')),
  storage_path text not null unique,
  added_by bigint not null references users (id),
  added_at timestamptz not null default now(),
  constraint files_one_record check (num_nonnulls(deal_id, person_id, organisation_id) = 1)
);
alter table files enable row level security;
create index files_deal_idx on files (deal_id, added_at desc, id desc) where deal_id is not null;
create index files_person_idx on files (person_id, added_at desc, id desc) where person_id is not null;
create index files_organisation_idx on files (organisation_id, added_at desc, id desc) where organisation_id is not null;

-- An upload asked for but not yet read back from Storage: never listed (FR-002).
create table file_uploads (
  id bigint generated always as identity primary key,
  deal_id bigint null references deals (id) on delete cascade,
  person_id bigint null references persons (id) on delete cascade,
  organisation_id bigint null references organisations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  size bigint not null check (size between 1 and 26214400),
  content_type text not null,
  storage_path text not null unique,
  user_id bigint not null references users (id),
  created_at timestamptz not null default now(),
  constraint file_uploads_one_record check (num_nonnulls(deal_id, person_id, organisation_id) = 1)
);
alter table file_uploads enable row level security;
create index file_uploads_created_idx on file_uploads (created_at);

-- Contents to remove from Storage (research.md §8).
create table file_cleanup (
  storage_path text primary key,
  due_at timestamptz not null default now(),
  attempts int not null default 0
);
alter table file_cleanup enable row level security;
create index file_cleanup_due_idx on file_cleanup (due_at);

-- FILE entries on the timeline: the name and size are kept so the entry still reads after the file is deleted.
alter table timeline_events add column file_id bigint null references files (id) on delete set null;
alter table timeline_events add column file_name text null check (char_length(file_name) between 1 and 255);
alter table timeline_events add column file_size bigint null;
-- The id of the file a file_deleted entry is about (no FK: the row is gone); lets an old address answer "doesn't exist any more".
alter table timeline_events add column deleted_file_id bigint null;
create index timeline_events_file_idx on timeline_events (file_id) where file_id is not null;
create index timeline_events_deleted_file_idx on timeline_events (deleted_file_id) where deleted_file_id is not null;
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared',
                  'file_added', 'file_deleted'));
alter table timeline_events add constraint timeline_events_file_check
  check ((kind in ('file_added', 'file_deleted')) = (file_name is not null)
         and (file_size is null or kind = 'file_added')
         and (file_id is null or kind = 'file_added')
         and ((kind = 'file_deleted') = (deleted_file_id is not null))
         and (kind not in ('file_added', 'file_deleted') or actor_id is not null));
```

`tests/support/reset.ts`: add `files, file_uploads, file_cleanup` to the `truncate` list (and to
`.factory/run/reset-db.sh` if it lists tables). `rls.test.ts` covers the three new tables automatically if it scans
all tables; otherwise add them.

## Entities

### File (`files`)

| Field | Rule |
|---|---|
| record | exactly one of `deal_id`, `person_id`, `organisation_id`; cascades when the record is deleted for good (FR-012; the delete function first copies the paths into `file_cleanup`) |
| name | as given, 1–255 characters; shown as text only |
| size | bytes as stored in Storage, 1 – 26,214,400 |
| kind | `jpeg`/`png`/`gif`/`webp`/`pdf` (previewable) or `other` (research.md §4) |
| storage_path | `files/<uuid v4>`; never derived from the name |
| added_by / added_at | the user who finished the upload, when it was listed |

Visibility: `visibleFile()` (research.md §6). Read order: `added_at desc, id desc`.

### Pending upload (`file_uploads`)

Made by `startFileUpload`, removed by `finishFileUpload` (listed or refused) or by the sweep after 2 hours (its path
goes to `file_cleanup`). Only its `user_id` can finish it.

### Clean-up row (`file_cleanup`)

A path whose contents must leave Storage. Removed once Storage answered the delete (a path already absent counts as
done); otherwise `due_at = now() + interval '10 minutes'`, `attempts + 1`.

### Timeline event (existing `timeline_events`)

| kind | on | fields | line (design B, tag FILE; DEAL on a person's or organisation's timeline for a deal's entry) |
|---|---|---|---|
| `file_added` | the file's record | `actor_id`, `file_id` (null once deleted), `file_name`, `file_size` | "**<name>** added <file name> (<size>)" — file name a link while `file_id` is set (preview box / PDF tab / download by kind) |
| `file_deleted` | the file's record | `actor_id`, `file_name`, `deleted_file_id` | "**<name>** deleted <file name>" |

`readTimeline` / `selectEntries` read `e.file_id, e.file_name, e.file_size` and `f.kind` (left join `files f on f.id =
e.file_id`); `TimelineEntry` gains `file: { id: number | null; name: string; size: number | null; kind: FileKind | null } | null`.
`EntryTag` gains `"FILE"`: `entryTag` returns ACTIVITY, PERSON, DEAL as today, then FILE for `file_added` /
`file_deleted`, then NOTE / CHANGE. The ambassador's latest updates (SF-114) keep notes and changes only: their `where`
leaves out the two file kinds.

## State changes

### Start an upload — `startFileUpload(actorId, target, { name, size })`

1. `validateFile({ name, size })` (pure): `file_name_too_long` | `file_empty` | `file_too_large` → refused, naming the
   file.
2. Record visible to the actor (else `record_not_found`) and not archived (else `files_archived`) — plain read.
3. Insert `file_uploads` (path `files/<randomUUID()>`, `content_type = uploadContentType(name)`).
4. Storage `createSignedUploadUrl(path)`; failure → delete the pending row, `files_unreachable`.
5. Return `{ uploadId, url, contentType }`. Then `sweepFileCleanup()` (never fails the call).

### Finish an upload — `finishFileUpload(actorId, uploadId)`

1. Read the pending row of this actor, made < 2 hours ago (else `file_upload_failed`).
2. Storage `objectInfo(path)` and `readHead(path, 16)`. Unreachable → `files_unreachable` (the row stays; the user can
   press finish again by retrying the upload). Object missing, or its size ≠ declared size or > 25 MB →
   `file_upload_failed` (pending row → `file_cleanup`).
3. Transaction: lock the record (visible, else `record_not_found`; not archived, else `files_archived`; either way the
   pending row → `file_cleanup`); `kind = fileKind(...)`; insert `files` (`added_at = now()`); `recordEvent` kind
   `file_added` with `fileId`, `fileName`, `fileSize`; delete the pending row.
4. `sweepFileCleanup()`.

### Delete a file — `deleteFile(actorId, target, fileId)`

Transaction: lock the record (`record_not_found` / `files_archived`); `delete from files f where f.id = $id and
<f's record column> = <target id> returning storage_path, name` — no row → `file_gone`; insert into `file_cleanup`;
`recordEvent` `file_deleted` with `deletedFileId`. After commit: try the Storage delete, then `sweepFileCleanup()`. Result `ok` whatever
Storage answered.

### Delete a record for good (changed)

`deleteDeal`, `deletePerson`, `deleteOrganisation`: before the `delete`, in the same transaction,
`insert into file_cleanup (storage_path) select storage_path from files where <col> = $id union all select
storage_path from file_uploads where <col> = $id on conflict do nothing`; after commit, `sweepFileCleanup()`.
The rows themselves go by cascade; FILE entries on the deal go with the deal's other entries (cascade on
`timeline_events.deal_id`).

### Archive / restore / hand-over

Nothing changes: archived records keep their files (listed, previewable, downloadable; no add or delete).

## Fake data — `src/seed/files.ts`

Registered in `src/seed/index.ts` after `notes` (and after `activities` if that is the order). Idempotent: skips a file
whose (record, name) already exists. Writes the bytes through the storage module (the fake in development/test), then
the `files` row and a `file_added` event by the record's creator. Small generated contents, no real documents:

| Record | Files |
|---|---|
| a shared deal | `site-mockup.png` (a generated 1×1–64×64 PNG), `proposal.pdf` (a minimal one-page PDF), `budget.xlsx` (bytes of a tiny zip, kind `other`) |
| a private deal (owner Ada Fake) | `contract.pdf` |
| a private person | `cv-fake.pdf` |
| an organisation | `brand-guide.pdf`, `logo.gif` |
| an archived record | `old-brief.docx` (kind `other`) |
| one shared person | `notes.txt` renamed `fake.png` content (text bytes, name `fake.png` → kind `other`) |

Plus one `file_deleted` event (`old-version.pdf`) on the shared deal so the timeline shows both kinds.
