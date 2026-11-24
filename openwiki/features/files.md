---
type: feature
title: Files on deals, people and organisations
description: Adding, previewing, downloading and deleting files on records, with contents in Supabase Storage, the fake Storage for development, visibility and timeline entries.
tags: [files, storage, supabase, timeline]
sources:
  - id: sf116-src-files
    resource: repo://src/server/files/files.ts
  - id: sf116-src-rules
    resource: repo://src/server/files/rules.ts
  - id: sf116-src-storage
    resource: repo://src/server/files/storage.ts
  - id: sf116-src-fake
    resource: repo://src/server/files/fake-storage.ts
  - id: sf116-src-env
    resource: repo://src/server/env.ts
  - id: sf116-src-route
    resource: repo://src/app/(app)/files/file-route.ts
  - id: sf116-src-migration
    resource: repo://migrations/0011_files.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T11:23:52.677Z
generated: { by: "claude-code", at: "2026-11-24T11:23:52.677Z" }
---

# Files on deals, people and organisations

A signed-in user can add files to a deal, a person or an organisation. The record page and the deal drawer show a
"// FILES" section (`records/FilesSection.tsx`). Tables are in [Database schema](../data/database-schema.md); how data
moves is in [dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md); the Storage settings are in
[Configuration](../operations/configuration-and-environments.md).

## Rules

`src/server/files/rules.ts` (pure) allows at most 25 MB (26,214,400 bytes) and 255 characters of name, refuses empty
files, and works out the file `kind` (`jpeg`, `png`, `gif`, `webp`, `pdf`, `other`) from the first bytes, the name and
the stored type. Images and PDFs open in a preview; other kinds download.

## Upload

1. `startFileUpload` validates and writes a `file_uploads` row, then asks Storage for a signed upload address.
2. The browser (`records/AddFiles.tsx`) sends the bytes straight to Storage with a PUT, showing progress.
3. `finishFileUpload` reads the object's info and first bytes back from Storage, then inserts the `files` row and a
   `file_added` timeline entry. An upload not finished is never listed.

No Storage call happens inside a database transaction.

## Download, preview and delete

`/files/[id]/download` and `/files/[id]/preview` (`files/file-route.ts`) check that the viewer can see the file, then
answer 303 to a Storage address valid for 60 seconds. If Storage cannot be reached they go to `/files/unavailable`.
`deleteFile` removes the row, writes a `file_deleted` entry (name and size are kept on the entry) and queues the
path in `file_cleanup`. `sweepFileCleanup` removes queued contents from Storage after every file action; there is no
cron. The three record deletes use `cleanupPathsFor` for their files.

## Visibility

`visibleFile()` in `src/server/records/visibility.ts` is the one rule: every read of `files` uses it, so a file of a
private person or deal is visible only to someone who can see that record.

## Storage back ends

`storageConfig()` picks Supabase Storage, the fake Storage or "off" (see Configuration). The fake
(`src/server/files/fake-storage.ts`, served by `src/app/dev/fake-storage/`) keeps contents in memory in tests and in
`.fake-storage/` in development; its route answers 404 unless fakes are allowed and `SUPABASE_URL` is empty.
