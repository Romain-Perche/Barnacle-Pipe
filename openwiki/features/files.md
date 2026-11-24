---
type: feature
title: Files on records (SF-116)
description: Files on people, organisations and deals — limits, the two-step upload straight to Supabase Storage, download and preview through short-lived addresses, privacy, deletion and clean-up, and FILE timeline entries.
tags: [files, storage, supabase, records, timeline]
sources:
  - id: sf116-src-files
    resource: repo://src/server/files/files.ts
  - id: sf116-src-rules
    resource: repo://src/server/files/rules.ts
  - id: sf116-src-storage
    resource: repo://src/server/files/storage.ts
  - id: sf116-src-fake
    resource: repo://src/server/files/fake-storage.ts
  - id: sf116-src-route
    resource: repo://src/app/(app)/files/file-route.ts
  - id: sf116-src-env
    resource: repo://src/server/env.ts
  - id: sf116-src-migration
    resource: repo://migrations/0011_files.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T11:56:37.160Z
generated: { by: "claude-code", at: "2026-11-24T11:56:37.160Z" }
---

# Files on records

Staff can attach files to a person, an organisation or a deal. They appear under `// FILES` on the record page and
the deal drawer (`records/FilesSection.tsx`), and as FILE entries in the record's timeline. Tables are in
[Database schema](../data/database-schema.md); how data moves is in
[dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md). Settings are in
[Configuration and environments](../operations/configuration-and-environments.md).

## Code

- `src/server/files/rules.ts` is pure: a file must be 1 byte to 25 MB (26,214,400) with a name of at most 255
  characters (`validateFile`); `fileKind` decides `jpeg`, `png`, `gif`, `webp`, `pdf` or `other` from the first bytes,
  the name and the stored type; plus labels, safe download names and `fileHref`.
- `src/server/files/storage.ts` talks to Supabase Storage with plain `fetch`: a signed upload address, object info,
  the first bytes, a 60-second read address and bulk delete. A failure to reach Storage is a `StorageUnreachable`.
- `src/server/files/fake-storage.ts` is the stand-in used in tests and development; `storageConfig()` in
  `src/server/env.ts` picks Supabase, the fake or "off". The browser reaches the fake through
  `src/app/dev/fake-storage/[...path]/route.ts`, which answers 404 unless fakes are allowed and no `SUPABASE_URL` is set.
- `src/server/files/files.ts` holds `listFiles`, `pageFile`, `fileAccess`, `startFileUpload`, `finishFileUpload`,
  `deleteFile`, `cleanupPathsFor` and `sweepFileCleanup`. No Storage call is made inside a database transaction.
- `src/app/(app)/records/file-actions.ts` are the server actions; `AddFiles.tsx` is the client part (the PUT to
  Storage with progress); `FileOverlays.tsx` opens the image preview box (`?file=`) and the delete confirmation
  (`?delete-file=`); `FileLink.tsx` is a plain `<a>`, never `next/link`.

## Upload

1. `startFileUpload` checks the file and the record, adds a `file_uploads` row with a fresh random path and returns a
   write-only signed address.
2. The browser PUTs the contents straight to Storage; file bytes never pass through the app.
3. `finishFileUpload` reads the object back (size, type, first bytes). Only then, in one transaction that re-reads
   the record and claims the pending row, is the `files` row inserted together with a `file_added` timeline entry.
   A wrong size, an archived or missing record, or an upload older than the allowed hours is refused and its
   path goes to `file_cleanup`.

## Download and preview

`GET /files/<id>/download` and `/files/<id>/preview` (`file-route.ts`) require a session, check `fileAccess` (which
applies `visibleFile()` on every request), then answer a 303 to a Storage address valid for 60 seconds, with
`Cache-Control: no-store`. Otherwise they redirect to `/files/unavailable?reason=hidden|gone|unreachable`: `gone`
only when the file was deleted from a record the viewer can see. Previews of non-previewable kinds fall back to download.

## Privacy

Every `files` read goes through `visibleFile()` in `records/visibility.ts`, which follows the visibility of the
person or deal the file is on (private records hide their files).

## Delete and clean-up

`deleteFile` removes the row, queues the path in `file_cleanup` and records a `file_deleted` entry (name kept, with
`deleted_file_id`) in one transaction, then tries to remove the contents at once. Deleting a record for good calls
`cleanupPathsFor` for its files and pending uploads. `sweepFileCleanup` runs after every file action (no cron): it
queues stale pending uploads, claims up to 50 due paths and removes them from Storage, counting an attempt on failure.
It never throws. Archived records refuse new files and deletions.

## Seeding

`src/seed/files.ts` adds fake files through `insertFile` (see [Migrations and seeding](../operations/migrations-and-seeding.md)).
