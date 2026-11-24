# Quickstart: validating Files (SF-116)

## Prerequisites

Local PostgreSQL as in the README; no Supabase account (the fake storage is used when `SUPABASE_URL` is empty and
`APP_ENV` is `development` or `test`).

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run test:schemas        # also downloads .factory/schemas/storage_v0_openapi.json (pinned, sha256-checked)
npm test && npm run typecheck
```

## Automated checks (Build writes them; each names what it covers)

Unit (`tests/unit/`):
- `files-rules.test.ts` — `validateFile` (0 bytes, 1 byte, exactly 26,214,400, 26,214,401; 255 / 256 code points,
  non-Latin names), `fileKind` (each magic number with matching name and type; text renamed `fake.png`; SVG; HTML; a
  PNG uploaded as `application/octet-stream`), `kindLabel`, `safeDownloadName` (`/`, `\`, control characters, `..`),
  `uploadContentType`, `shortName` (FR-001, FR-004, FR-005, edge cases).
- `format.test.ts` — `formatFileSize` (0.5 KB, 840 KB, 2.1 MB, exactly 25 MB).
- `messages.test.ts` — the new codes and templates; `timeline-view.test.ts` — FILE tag, DEAL kept on a linked deal.
- `storage-fake.test.ts` — the fake against the schema: upload, info, ranged read, signed read with `download`,
  expired token, wrong path, overwrite refused, delete (FR-015).

Integration (`tests/integration/`, real Postgres + `StorageFake`):
- `files.test.ts` — upload start/finish on a deal, a person and an organisation; listed newest first with uploader
  and date; same name twice → two files; finish without the object → failed and not listed; size mismatch → failed;
  downloaded bytes equal uploaded bytes (US1, US2, SC-002, SC-005).
- `files-private.test.ts` — Ada's private deal and private person: Bob (admin) gets no row, no count, no timeline
  entry, `fileAccess` = `hidden`, start/delete refused; after making the record shared Bob gets `ok`; after a
  hand-over the new owner gets `ok`; a record turned private after a link was made → `hidden` (US3, SC-004).
- `files-timeline.test.ts` — exactly one `file_added` / `file_deleted` per change; the added entry loses its link after
  delete; deal entries on the person's and organisation's timelines; none for a viewer who cannot see the deal (US4,
  SC-006).
- `files-delete.test.ts` — delete with Storage up (object gone) and down (still "ok", not listed, `gone`, clean-up row
  left, swept on the next call); two deletes at once → one event, the other `gone`; archived record refuses add and
  delete but lists and downloads; deleting a deal/person/organisation for good removes rows and queues contents
  (US5, FR-011, FR-012).
- `files-unreachable.test.ts` — Storage down: start/finish/download answer `files_unreachable`; `listFiles` still works.
- `migrate.test.ts` — 0010 on a fresh database; Postgres's own refusals: a file on two records, 0 bytes, over 25 MB,
  a 256-character name, a `file_added` without `file_name`, a `file_deleted` without `deleted_file_id`; the pooler scan
  still passes (no session state).
- `seed.test.ts` — the files seeder twice gives no duplicates; its private files are hidden from other users.

## Manual run (local, fake storage)

```bash
APP_ENV=development npm run db:migrate && npm run db:seed && npm run dev
```

1. Sign in as Ada Fake (fake login). Open the seeded shared deal: `// FILES (3)` between `// NEXT ACTIVITIES` and
   `// TIMELINE`; click `site-mockup.png` → box over the page with the image, `[ DOWNLOAD ]`, `[ CLOSE ]`.
2. `[ ADD FILE ]`, pick a PDF and an empty file: "Uploading proposal.pdf… n%", then "File added." and
   "<empty>.txt is empty."; the PDF's `[ PREVIEW ]` opens a new tab with the browser's PDF viewer.
3. `[ DELETE ]` → "Delete proposal.pdf? This can't be undone." → "File deleted."; the timeline shows the added and
   deleted entries with the FILE tag; the old download address shows "This file doesn't exist any more.".
4. Copy the download address of `contract.pdf` on Ada's private deal; sign in as Bob Fake in another browser:
   "This file doesn't exist or you can't see it."; signed out → sign-in page.
5. The archived seeded record lists `old-brief.docx` with `[ DOWNLOAD ]` only, no `[ ADD FILE ]`.
