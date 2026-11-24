# Contracts: pages, addresses, actions, domain functions, messages (SF-116)

Every page, route and action calls `requireUser()` first (nothing admin-only, FR-008). Ids from the address or a form
are parsed to positive safe integers; anything else is "not found". No text from the address is ever shown.

## Record pages (changed)

`/deals/<id>`, `/people/<id>`, `/organisations/<id>` and the deal drawer on the board show `<FilesSection>` between
`<NextActivities>` and `<RecordTimeline>` (design A):

- Heading `// FILES (<n>)` (n = files the viewer can see on that record) and `[ ADD FILE ]` (not on archived records).
- `<table>` Name | Kind | Size | Added by | Added | actions, newest first. Name: `<a>` (image → `?file=<id>` on the same
  page, keeping the other query parameters; PDF → `/files/<id>/preview` in a new tab; other → `/files/<id>/download`).
  Kind: `<span className="ft">` with `kindLabel`. Size: `formatFileSize`. Added by: name, "<name> (deactivated)" when
  deactivated. Added: `formatDate`. Actions: `[ PREVIEW ]` (previewable kinds only, same target as the name),
  `[ DOWNLOAD ]` (`/files/<id>/download`), `[ DELETE ]` (`?delete-file=<id>`, not on archived records; red link).
- No files: "No files yet." and `[ ADD FILE ]` (when not archived).
- Notices above the table: `file_added` / `file_deleted` / an error code, the way `NoteNotices` reads its codes.

### Query parameters (record pages and the board's drawer address)

| Parameter | Opens | Ignored when |
|---|---|---|
| `file=<id>` | the image preview box: header "<name> · <size>", `[ DOWNLOAD ]`, `[ CLOSE ]` (link to the page without `file`); body `<img src="/files/<id>/preview" alt="<name>">` scaled to fit | not an image file on this record that the viewer can see |
| `delete-file=<id>` | the confirmation box "Delete <file name>? This can't be undone." with `[ DELETE ]` (form → `deleteFileAction`) and `[ CANCEL ]` (link back) | not a file on this record the viewer can see, or the record is archived |

## Routes (new)

| Route | Answer |
|---|---|
| `GET /files/<id>/download` | `fileAccess(user.id, id)`: `ok` → `303` to a Storage address valid 60 s with `download=<safeDownloadName(name)>`; `hidden` → `303 /files/unavailable?reason=hidden`; `gone` → `?reason=gone`; Storage unreachable → `?reason=unreachable`. Headers on every answer: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. Signed out: `src/proxy.ts` sends to `/sign-in?next=/files/<id>/download`. |
| `GET /files/<id>/preview` | as download, without `download`; a non-previewable kind → `303 /files/<id>/download`. |
| `GET /files/unavailable?reason=hidden\|gone\|unreachable` | design-B page with the fixed message for the code (`file_not_found` / `file_gone` / `files_unreachable`; unknown code → `file_not_found`) and a link to `/`. |
| `/dev/fake-storage/...` (PUT, GET, POST, DELETE) | the fake Storage (contracts/storage.md); `404` unless `isFakeAllowed()`; public in `src/proxy.ts` (`/^\/dev\/fake-storage(\/|$)/`). |

`fileAccess(viewerId, id)`:
- `ok` with the file when a `files` row with this id passes `visibleFile`;
- `gone` ("This file doesn't exist any more.") when there is none, but a `file_deleted` event with
  `deleted_file_id = id` is on a record the viewer can see (deal → `visibleDeal`, person → `visiblePerson`,
  organisation → always);
- `hidden` ("This file doesn't exist or you can't see it.") otherwise: never existed, or its record is hidden, or the
  record was deleted for good (its events went with it). Same answer, same timing class, no file byte (US3 §2).

## Server actions (new, `src/app/(app)/records/file-actions.ts`)

| Action | Input | Answer |
|---|---|---|
| `startFileUpload({ kind, id, name, size })` | record kind `deal`/`person`/`organisation` (via `noteTarget`) | `{ uploadId, url, contentType }` or `{ error: code, name? }` |
| `finishFileUpload({ uploadId })` | | `{ ok: true }` or `{ error: code, name? }` |
| `deleteFileAction(formData: target, targetId, fileId, back)` | `back` through `isSafeNext` | redirect to `back` (without `delete-file`) with notice `file_deleted`, or the error code; a hidden record → its kind's list (`listPath`) with `file_not_found` |

The browser (`AddFiles.tsx`), for each picked file in turn: local `validateFile` (same pure function) → message, skip;
`startFileUpload` → `XMLHttpRequest` `PUT url` with header `content-type: <contentType>` and the `File` as body,
showing "Uploading <name>… <n>%" from `upload.onprogress`; network error / non-2xx → `file_upload_failed`;
`finishFileUpload`. When all are done: `router.refresh()`, "File added." if at least one was listed, and each refusal
as its own line.

## Domain functions (new, `src/server/files/`)

`rules.ts` (pure): `MAX_FILE_BYTES = 26_214_400`, `MAX_FILE_NAME = 255`, `validateFile`, `uploadContentType`,
`fileKind`, `isPreviewable`, `kindLabel`, `safeDownloadName`, `shortName`.
`files.ts`: `listFiles(viewerId, target) → FileRow[]` (`{ id, name, kind, size, addedByName, addedByActive, addedAt }`),
`pageFile(viewerId, idParam, target)` (for the boxes), `fileAccess(viewerId, id)`, `startFileUpload`,
`finishFileUpload`, `deleteFile`, `cleanupPathsFor(db, target)` (used by the three record deletes), `sweepFileCleanup()`.
`storage.ts`: contracts/storage.md. `src/server/records/visibility.ts`: `visibleFile`. `src/server/format.ts`:
`formatFileSize`.

## Messages (`src/server/messages.ts`)

`messages`:

| Code | Text |
|---|---|
| `file_added` | File added. |
| `file_deleted` | File deleted. |
| `file_not_found` | This file doesn't exist or you can't see it. |
| `file_gone` | This file doesn't exist any more. |
| `file_record_not_found` | This record doesn't exist or you can't see it. |
| `files_archived` | Restore this record before changing its files. |
| `files_unreachable` | Files can't be reached right now. Try again in a minute. |
| `no_files` | No files yet. |

`templates`:

| Code | Text |
|---|---|
| `file_too_large(name)` | `${name} is over 25 MB, the most a file can be.` |
| `file_empty(name)` | `${name} is empty.` |
| `file_name_too_long(name)` | `${shortName(name)} has a name over 255 characters.` |
| `file_upload_failed(name)` | `${name} couldn't be uploaded. Try again.` |
| `file_uploading(name, n)` | `Uploading ${name}… ${n}%` |
| `file_delete_confirm(name)` | `Delete ${name}? This can't be undone.` |
