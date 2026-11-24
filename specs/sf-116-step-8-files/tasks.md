---

description: "Task list for SF-116 Files"
---

# Tasks: Files

**Input**: Design documents from `/specs/sf-116-step-8-files/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, contracts/storage.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-002, SC-004 to SC-006): Vitest unit tests and Vitest integration tests against a real local Postgres (`crm_test`) with the Storage fake. No browser tests (docs/DECISIONS.md, 2026-11-23): never start the app in a browser. Each test file names what it covers (`// covers FR-009, US3 scenario 2`). Write each story's tests first and see them fail before the code.

**Organization**: Tasks are grouped by user story. Exact message texts are in contracts/routes.md § Messages: use them verbatim, from `src/server/messages.ts` only. The migration, entities, state changes and fake data are in data-model.md. Pages, parameters, routes, actions and domain functions are in contracts/routes.md. Storage calls, settings, the bucket and the fake are in contracts/storage.md. Decisions are in research.md (§n below). No new dependency (`dependencies.json` is `[]`): do not add any package, and in particular no `@supabase/*`. No blueprint applies (`blueprints.json` is `[]`, no blueprint index in this run), so there are no blueprint tasks and no `Departs from blueprint` line. The four factory choices in spec.md § Clarifications were confirmed by a person at plan review and are built as written there. Outside services: Supabase Storage (schema; T014) and Supabase Postgres (no schema; T015); the recipe is T046, the last task. Fake users: Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users), Alan Fake (deactivated). Where the spec says "Bob Fake (an admin)", use Grace Fake.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)

---

## Phase 1: Setup

**Purpose**: The schema, the pure rules and the texts every story uses.

- [x] T001 Write `migrations/0011_files.sql` exactly as data-model.md § Migration.
  - **`files`**:
    - `name text not null check (char_length(name) between 1 and 255)`
    - `size bigint not null check (size between 1 and 26214400)`
    - `kind text not null check (kind in ('jpeg', 'png', 'gif', 'webp', 'pdf', 'other'))`
    - `storage_path text not null unique`
    - `added_by bigint not null references users (id)`
    - `added_at timestamptz not null default now()`
    - `deal_id` / `person_id` / `organisation_id`, each `bigint null references … on delete cascade`
    - `constraint files_one_record check (num_nonnulls(deal_id, person_id, organisation_id) = 1)`
    - the three partial indexes `files_deal_idx` / `files_person_idx` / `files_organisation_idx` on `(<col>, added_at desc, id desc) where <col> is not null`
  - **`file_uploads`**:
    - the same record columns, `name` and `size` checks
    - `content_type text not null`, `storage_path text not null unique`
    - `user_id bigint not null references users (id)`, `created_at timestamptz not null default now()`
    - `file_uploads_one_record`, `file_uploads_created_idx`
  - **`file_cleanup`**:
    - `storage_path text primary key`, `due_at timestamptz not null default now()`, `attempts int not null default 0`
    - `file_cleanup_due_idx`
  - **`alter table … enable row level security`** after each of the three `create table`, with no policies.
  - **`timeline_events`** gains:
    - `file_id bigint null references files (id) on delete set null`
    - `file_name text null check (char_length(file_name) between 1 and 255)`
    - `file_size bigint null`
    - `deleted_file_id bigint null` (no FK)
    - indexes `timeline_events_file_idx` and `timeline_events_deleted_file_idx` (partial, `is not null`)
    - `timeline_events_kind_check` replaced, keeping every kind of 0009 plus SF-115's `'custom_set', 'custom_changed', 'custom_cleared'` plus `'file_added', 'file_deleted'`
    - above it, the comment of data-model.md: the custom kinds belong to SF-115 (`0010_custom_fields.sql`), which rewrites the same constraint; both lists hold every kind of both steps so neither migration drops the other's, whichever merges first
    - `timeline_events_file_check` as data-model.md: file kinds ⇔ `file_name` set; `file_size` only on `file_added`; `file_id` only on `file_added`; `deleted_file_id` set ⇔ `file_deleted`; `actor_id` required on file kinds
  - First confirm the constraint name with `\d timeline_events` on a migrated database. No `begin`/`commit`/`concurrently`.
- [x] T002 [P] Add the messages and templates of contracts/routes.md § Messages to `src/server/messages.ts` under an `// SF-116` comment.
  - Codes: `file_added`, `file_deleted`, `file_not_found`, `file_gone`, `file_record_not_found`, `files_archived`, `files_unreachable`, `no_files`.
  - Templates: `file_too_large(name)`, `file_empty(name)`, `file_name_too_long(name)` (uses `shortName`), `file_upload_failed(name)`, `file_uploading(name, n)`, `file_delete_confirm(name)`.
- [x] T003 [P] Create the pure `src/server/files/rules.ts` (research.md §4, §9). Export:
  - `MAX_FILE_BYTES = 26_214_400` and `MAX_FILE_NAME = 255`.
  - `validateFile({ name, size })`: returns `file_name_too_long` when there are more than 255 code points, `file_empty` when `size === 0`, `file_too_large` when `size > 26214400`, else ok.
  - `uploadContentType(name)`: `.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png`, `.gif` → `image/gif`, `.webp` → `image/webp`, `.pdf` → `application/pdf` (any case), else `application/octet-stream`.
  - `fileKind({ head, name, storedType })`: a previewable kind only when the magic bytes, the extension and the stored type all agree; else `other`. Magic bytes: `FF D8 FF`; `89 50 4E 47 0D 0A 1A 0A`; `GIF87a`/`GIF89a`; `RIFF` + 4 bytes + `WEBP`; `%PDF-`.
  - `isPreviewable(kind)`.
  - `kindLabel(name, kind)`: `JPG`/`PNG`/`GIF`/`WEBP`/`PDF` for previewable kinds; else the extension in capitals when it is 1–5 letters or digits; else `FILE`.
  - `safeDownloadName(name)`: replaces `/ \ : * ? " < > |` and control characters with `_`, trims dots and spaces at both ends, and gives `file` when the result is empty.
  - `shortName(name)`: the first 40 characters + "…" when longer.
- [x] T004 [P] Add `formatFileSize(bytes)` to `src/server/format.ts` (research.md §10): `< 1024` → "<n> B"; `< 1 MiB` → "<n> KB" rounded on a 1,024 base; else one decimal "<n.n> MB", dropping ".0" ("25 MB").
- [x] T005 [P] Unit tests in `tests/unit/files-rules.test.ts` for every function of T003 (`// covers FR-001, FR-004, FR-005, edge cases "kind", "file names"`):
  - sizes 0, 1, 26214400 and 26214401;
  - names of 255 and 256 code points, including non-Latin names and emoji;
  - each magic number with a matching name and type, a text file named `fake.png`, `a.svg`, `a.html`, and a PNG stored as `application/octet-stream` (→ `other`);
  - `kindLabel` of `budget.xlsx`, `README`, `x.toolongext`;
  - `safeDownloadName` of `../a/b\\c.pdf`, a name with `\u0007`, and `...`.

  Extend `tests/unit/format.test.ts` with 500 B, 840 KB, 2.1 MB and exactly 25 MB.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Settings, the Storage client, the fake, the visibility rule and the timeline columns that every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 Add `storageConfig()` to `src/server/env.ts` (contracts/storage.md § Settings), read at call time. It reads `SUPABASE_URL` (trailing slash removed), `SUPABASE_SECRET_KEY` and `FILES_BUCKET` (default `crm-files`). It returns one of:
  - `{ mode: "supabase", baseUrl: <url>/storage/v1, key, bucket }`;
  - `{ mode: "fake", baseUrl: appBaseUrl() + "/dev/fake-storage", key: "fake-storage-key", bucket }` when the URL is empty and `isFakeAllowed()`;
  - `{ mode: "off" }` otherwise.

  Extend `tests/unit/env.test.ts`, covering: fake only with APP_ENV development/test and not on Vercel production/preview; `off` in production with no URL.
- [x] T007 Create `src/server/files/fake-storage.ts` (contracts/storage.md § The fake).
  - **API**: `class FakeStorage { constructor({ store, baseUrl, key, now? }); fetch(input, init): Promise<Response> }`, plus `MemoryStore`, and `DiskStore(dir = ".fake-storage")`, which keeps one file per object plus `<file>.json` holding the content type.
  - **Calls it implements**:
    - `POST /object/upload/sign/{bucket}/{*}` → `{ url, token }`.
    - `PUT /object/upload/sign/{bucket}/{*}?token=`:
      - refuses an existing object (409);
      - refuses a body over 26214400 bytes (413);
      - stores the body and its `content-type`;
      - answers `{ Key }`.
    - `GET /object/info/authenticated/{bucket}/{*}` → `{ size, content_type, … }`, or 404 `not_found`.
    - `GET /object/authenticated/{bucket}/{*}`, with `range: bytes=a-b` → 206.
    - `POST /object/sign/{bucket}/{*}` with `{ expiresIn }` → `{ signedURL }`.
    - `GET /object/sign/{bucket}/{*}?token=[&download=]`: stored bytes and content type, with `content-disposition: attachment; filename=…; filename*=UTF-8''…` when `download` is given.
    - `DELETE /object/{bucket}` with `{ prefixes }` → the array of removed objects.
  - **Rules**:
    - Server calls need `authorization: Bearer <key>` and `apikey`.
    - Tokens are HMAC-SHA256 over `{ url: "<bucket>/<path>", exp }` with a random per-process secret. They are valid for one path only. Download tokens expire after `expiresIn` seconds, upload tokens after 2 hours. A wrong or expired token gets a 400 `InvalidJWT`.
  - **Where it is used**: export a `fakeStorage()` singleton that uses `MemoryStore` when `APP_ENV=test` and `DiskStore` in development. It throws unless `isFakeAllowed()`.
- [x] T008 Create `src/server/files/storage.ts` (contracts/storage.md § Operations).
  - **Functions**: `createSignedUploadUrl(path) → { url }`, `objectInfo(path) → { size, contentType } | null`, `readHead(path, n) → Uint8Array`, `signedUrl(path, { download? }) → string` (`expiresIn: 60`, `download` URI-encoded), `removeObjects(paths)` (≤ 100 per call). Every returned URL is absolute.
  - **Errors**: `class StorageUnreachable extends Error`, thrown on a network error, a 10 s timeout (`AbortSignal.timeout(10_000)`), a `5xx`, or `mode: "off"`.
  - **Headers**: every server call sends `authorization: Bearer <key>` and `apikey: <key>`.
  - **Fetch**: `fetch` by default; `fakeStorage().fetch` in fake mode. A test-only `useStorageFetchForTests(fn | null)` throws unless `process.env.APP_ENV === "test"`.
  - **Paths**: `newStoragePath()` → `files/<crypto.randomUUID()>`.
- [x] T009 Create `src/app/dev/fake-storage/[...path]/route.ts`. It exports `GET`, `PUT`, `POST`, `DELETE` and `HEAD`, answers 404 unless `isFakeAllowed()` and `storageConfig().mode === "fake"`, and otherwise forwards the request (path after `/dev/fake-storage`) to `fakeStorage().fetch`. Add `/^\/dev\/fake-storage(\/|$)/` to `PUBLIC` in `src/proxy.ts`, and `.fake-storage/` to `.gitignore`.
- [x] T010 [P] Add `visibleFile(db, viewer, alias = "f")` to `src/server/records/visibility.ts` (research.md §6): `((f.deal_id is null or exists (select 1 from deals vfd where vfd.id = f.deal_id and visibleDeal(vfd))) and (f.person_id is null or exists (select 1 from persons vfp where vfp.id = f.person_id and visiblePerson(vfp))))`. Organisations are never private. Add a header comment: every `files` read uses it.
- [x] T011 Timeline columns in `src/server/records/timeline.ts`:
  - `EventKind` gains `"file_added" | "file_deleted"`.
  - `recordEvent` accepts `fileId`, `fileName`, `fileSize` and `deletedFileId`, written to the new columns.
  - `selectEntries` selects `e.file_id, e.file_name, e.file_size` and `f.kind` (`left join files f on f.id = e.file_id`).
  - `TimelineEntry` gains `file: { id: number | null; name: string; size: number | null; kind: FileKind | null } | null`: set for the two file kinds, `null` otherwise, and `null` on activity entries.
- [x] T012 [P] In `tests/support/reset.ts`, add `files, file_uploads, file_cleanup` to the `truncate` list. Do the same in `.factory/run/reset-db.sh` if it lists tables.
- [x] T013 Turn `scripts/fetch-schemas.mjs` into a list of `{ file, url, sha256 }` entries:
  - keep the Google entry unchanged;
  - add `storage_v0_openapi.json` from `https://raw.githubusercontent.com/supabase/supabase/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json`, sha256 `bd435bab4b3b2ef87e3e61f2e948092c30db204f881a4d72d4234a032a356311`;
  - each missing file is downloaded and checked, and present files are skipped.

  Update `tests/unit/fetch-schemas.test.ts` to the new shape.

**Checkpoint**: Foundation ready. User story work can begin.

---

## Phase 3: User Story 1 - Upload a file to a deal, person or organisation (Priority: P1) 🎯 MVP

**Goal**: `[ ADD FILE ]` uploads one or more files, each checked on its own, and lists them in `// FILES`.

**Independent Test**: As Ada Fake, upload a 2 MB PDF to a deal, a PNG to a person and an `.xlsx` to an organisation. Each is listed with its name, size, uploader and date. A 26 MB file and an empty file are refused and nothing is saved.

### Tests for User Story 1 ⚠️

- [x] T014 [US1] Download `storage_v0_openapi.json` from https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json at commit `aa0fb9e84b9d128342f0127c7650d8cc5b240202` into `.factory/schemas/` (`git init -q /tmp/supabase && git -C /tmp/supabase fetch -q --depth 1 https://github.com/supabase/supabase aa0fb9e84b9d128342f0127c7650d8cc5b240202 && git -C /tmp/supabase show FETCH_HEAD:apps/docs/spec/storage_v0_openapi.json > .factory/schemas/storage_v0_openapi.json`), and make the fake of Supabase Storage refuse a request that the schema refuses: a test sends a wrong field and must fail.
  - **The test fake**: `tests/fakes/storage.ts` (`StorageFake`) wraps a `FakeStorage` over a `MemoryStore` and installs it with `useStorageFetchForTests`.
  - **What it checks on every request**, against `.factory/schemas/storage_v0_openapi.json` (loaded like `tests/fakes/google.ts` does; a missing file throws, never skips):
    - the path matches a schema path (`{bucketName}`, `{*}`) and the method exists on it;
    - each query parameter is declared;
    - each JSON body property is declared with its type, and the required ones are present;
    - each `200` JSON response property is declared in the schema's `200` response.
  - **Switches**: `down()` (every call rejects as a network error), `failDeletes()`, `objects()`, `put(path, bytes, contentType)`.
  - **`tests/unit/storage-fake.test.ts`** (`// covers FR-015`) checks:
    - `POST /object/sign/…` with `{ "expiresIn": 60, "expires": 1 }` must fail;
    - `POST /object/sign/…` with `{}` (missing `expiresIn`) must fail;
    - `DELETE /object/{bucket}` with `{ "paths": [...] }` must fail;
    - an unknown query parameter on `GET /object/sign/…` must fail;
    - the happy path: sign upload → PUT → info → ranged read → sign → signed GET with `download` gives an attachment, the same bytes, and an expired token refused.
- [x] T015 [US1] Supabase Postgres has no public schema on GitHub. The tests use a real local PostgreSQL 17, and the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler). It copies these limits: no prepared statements (`prepare: false`, unchanged in `src/server/db.ts`), no session state (no `set`, `listen` or session advisory lock), every multi-statement change in one `sql.begin()`, at most 5 connections, and no network call inside a transaction. Extend `tests/integration/migrate.test.ts`:
  - scan `src/server/files/*.ts` for `set `/`listen`/`pg_advisory_lock` and fail on any;
  - check that `migrations/0011_files.sql` has no `begin`/`commit`/`concurrently`;
  - apply 0011 on a fresh database (0010 is SF-115's number; this branch may not have it);
  - check Postgres's own 23514/23502 refusals: a file on two records and on none, `size` 0 and 26214401, a 256-character name, `kind = 'svg'`, a `file_added` event without `file_name`, a `file_deleted` event without `deleted_file_id`, `file_size` on a `file_deleted`;
  - check that the kind check still accepts `'note'` and `'referrer_set'`, and accepts SF-115's `'custom_set'`, `'custom_changed'` and `'custom_cleared'`;
  - check that RLS is on for the three new tables.
- [x] T016 [US1] Integration tests in `tests/integration/files.test.ts` (`// covers FR-001, FR-002, US1 scenarios 1–6, SC-002, SC-005`), using `StorageFake` and helpers in a new `tests/integration/file-helpers.ts` (`uploadFile(actor, target, name, bytes, contentType?)` = start → fake PUT → finish):
  - a 2.1 MB PDF on a deal, a PNG on a person and an `.xlsx` on an organisation are each listed by `listFiles` with name, size, kind, uploader and date, newest first;
  - a second file with the same name keeps both;
  - `startFileUpload` refuses a 0-byte file (`file_empty`), 26214401 bytes (`file_too_large`) and a 256-character name (`file_name_too_long`), with no pending row; exactly 26214400 is accepted;
  - finish without the PUT → `file_upload_failed`, nothing listed, the path in `file_cleanup`;
  - a size different from the declared one → failed;
  - another user's `uploadId` → failed;
  - finish more than 2 hours after start → failed;
  - an archived record → `files_archived`;
  - a record that became archived between start and finish → refused, the path queued;
  - Storage `down()` at start or finish → `files_unreachable`;
  - the downloaded bytes (through `signedUrl` and the fake) are byte-for-byte the uploaded ones;
  - two concurrent uploads to one record both get listed.

### Implementation for User Story 1

- [x] T017 [US1] Create `src/server/files/files.ts` with `startFileUpload(actorId, target, { name, size })` and `finishFileUpload(actorId, uploadId)` (data-model.md § State changes). Each returns `{ status: "ok", … } | { status: <code> }`.
  - **Record**: lock the record like `lockRecord` in `src/server/records/notes.ts` (`visibleDeal`/`visiblePerson`, `for update`, `archived`).
  - **Storage calls** go outside `sql.begin()`: the read-back (`objectInfo` + `readHead(path, 16)`) comes before the transaction.
  - **The finish transaction**:
    - inserts `files` with `kind = fileKind(...)` and `added_at = now()`;
    - calls `recordEvent` with kind `file_added`, `fileId`, `fileName`, `fileSize`;
    - deletes the pending row.
  - **Refused uploads** move the pending row's path to `file_cleanup` (`on conflict do nothing`).
  - Also export `listFiles(viewerId, target)`: `visibleFile`, newest first (`added_at desc, id desc`), returning `{ id, name, kind, size, addedByName, addedByActive, addedAt }`.
  - Also export `sweepFileCleanup()` (research.md §8), called after start and finish, never failing them:
    1. moves pending uploads older than 2 hours into `file_cleanup`;
    2. claims up to 50 due rows `for update skip locked`, pushes `due_at` 10 minutes ahead and commits;
    3. calls `removeObjects`;
    4. on success deletes those rows, on failure increments `attempts`.
- [x] T018 [US1] Create `src/app/(app)/records/file-actions.ts` (`"use server"`), with `startFileUpload({ kind, id, name, size })` and `finishFileUpload({ uploadId })` per contracts/routes.md § Server actions.
  - Each calls `requireUser()` first and resolves the record with `noteTarget`.
  - Returns plain `{ uploadId, url, contentType }` / `{ ok: true }` or `{ error: code, name? }`.
  - Never returns text taken from the request.
- [x] T019 [US1] Create the client `src/app/(app)/records/AddFiles.tsx`.
  - **Picker**: `[ ADD FILE ]` opens a hidden `<input type="file" multiple>`.
  - **Each picked file, in turn**:
    - `validateFile` (refusals listed with their template);
    - `startFileUpload`;
    - an `XMLHttpRequest` `PUT` of the file to `url` with header `content-type: <contentType>`, showing `templates.file_uploading(name, n)` from `upload.onprogress`;
    - an error or non-2xx gives `file_upload_failed(name)`;
    - `finishFileUpload`.
  - **At the end**: `router.refresh()`, then `messages.file_added` if at least one file was listed, plus one line per refused file.
  - File names are rendered as text only.
- [x] T020 [US1] Create the server `src/app/(app)/records/FilesSection.tsx` (design A):
  - heading `// FILES (<n>)` with `<AddFiles>` (not on archived records);
  - a table with Name | Kind (`<span className="ft">{kindLabel}</span>`) | Size (`formatFileSize`) | Added by ("<name> (deactivated)" when inactive) | Added (`formatDate`) | actions;
  - "No files yet." when empty.

  Name and action links come in US2. In US1 the name is plain text and `[ DOWNLOAD ]` links to `/files/<id>/download`.
- [x] T021 [US1] Place `<FilesSection>` between `<NextActivities>` and `<RecordTimeline>` in `src/app/(app)/deals/[id]/page.tsx`, `src/app/(app)/people/[id]/page.tsx`, `src/app/(app)/organisations/[id]/page.tsx` and `src/app/(app)/deals/DealDrawer.tsx` (with `[ ADD FILE ]` in the drawer too, US2 scenario 6). Add the `.ft` chip and the `// FILES` table styles to `src/app/globals.css`, following `design-options.html` option A.

**Checkpoint**: Files can be uploaded and are listed.

---

## Phase 4: User Story 2 - See, preview and download a record's files (Priority: P1)

**Goal**: The full `// FILES` table, the image preview box, PDF preview in the browser, and download under the original name.

**Independent Test**: On a deal with a PNG, a PDF and a `.docx`: all three are listed newest first; the PNG opens in the box, the PDF opens in a new tab, and the `.docx` downloads with its own name and the same bytes.

### Tests for User Story 2 ⚠️

- [x] T022 [P] [US2] Integration tests in `tests/integration/files-download.test.ts` (`// covers FR-003, FR-004, FR-005, US2 scenarios 1–5`). They call the route handlers' exported `GET` directly, with a session cookie built like the other route tests:
  - `/files/<id>/download` answers 303 to a fake Storage address with `download=<safeDownloadName>`, and following it gives the uploaded bytes with `content-disposition: attachment`;
  - `Cache-Control: no-store` and `Referrer-Policy: no-referrer` are on every answer;
  - `/files/<id>/preview` on a PNG or PDF answers 303 without `download`;
  - `/files/<id>/preview` on a `.docx`, an SVG or a text file named `fake.png` answers 303 to `/files/<id>/download`;
  - the signed address is refused after 60 s (fake `now` moved on);
  - Storage `down()` → 303 `/files/unavailable?reason=unreachable`;
  - a non-numeric id → `reason=hidden`;
  - `pageFile(viewerId, idParam, target)` returns only a file of that record, and returns null for another record's file id.

### Implementation for User Story 2

- [x] T023 [US2] In `src/server/files/files.ts`, add:
  - `pageFile(viewerId, idParam, target)`: parses the id, then requires `visibleFile` and the file's record column to equal the target.
  - `fileAccess(viewerId, id)` → `{ status: "ok", file } | { status: "gone" } | { status: "hidden" }` (contracts/routes.md § Routes). `gone` when a `file_deleted` event with `deleted_file_id = id` is on a record the viewer can see.
- [x] T024 [US2] Create `src/app/(app)/files/[id]/download/route.ts` and `src/app/(app)/files/[id]/preview/route.ts` (research.md §3).
  - Call `requireUser()`, then `fileAccess`.
  - On `ok`: 303 to `signedUrl(path, { download: safeDownloadName(name) })`, or without `download` for a preview of a previewable kind.
  - A preview of another kind → 303 `/files/<id>/download`.
  - `hidden`/`gone`/`StorageUnreachable` → 303 `/files/unavailable?reason=hidden|gone|unreachable`.
  - Set `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on every answer.
- [x] T025 [P] [US2] Create `src/app/(app)/files/unavailable/page.tsx` (design B). It calls `requireUser()` and shows the fixed message for `reason` (`hidden` → `file_not_found`, `gone` → `file_gone`, `unreachable` → `files_unreachable`, anything else → `file_not_found`) with a link to `/`.
- [x] T026 [US2] Complete `FilesSection.tsx`.
  - **Name links** (plain `<a>`, never `next/link`):
    - an image → the current page with `file=<id>`, keeping the other parameters;
    - a PDF → `/files/<id>/preview` with `target="_blank" rel="noopener noreferrer"`;
    - other kinds → `/files/<id>/download`.
  - **Actions**: `[ PREVIEW ]` for previewable kinds only, with the same target as the name; `[ DOWNLOAD ]`.
- [x] T027 [US2] Create the server `src/app/(app)/records/FileOverlays.tsx` (built like `ActivityOverlays.tsx`).
  - It opens only for an image file of this record that the viewer can see (`pageFile`), from `?file=<id>`.
  - The box over the page shows: the header "<name> · <size>"; `[ DOWNLOAD ]`; `[ CLOSE ]` (a link to the page without `file`); and `<img src="/files/<id>/preview" alt={name}>`.
  - Wire it into the three record pages and the drawer's page (read `file` from `searchParams`).
  - In `globals.css`, reuse the activity box's dim/modal look with `img { max-width: 100%; max-height: 70vh; object-fit: contain }`.

**Checkpoint**: Files can be found, previewed and downloaded.

---

## Phase 5: User Story 3 - Files follow the record's private rules, also for direct links (Priority: P1)

**Goal**: A file on a hidden record does not exist for the viewer, through every page, count, timeline and address.

**Independent Test**: Ada Fake uploads `contract.pdf` to her private deal. For Grace Fake (admin) the file appears nowhere, and both addresses show "This file doesn't exist or you can't see it.". Signed out, both addresses go to sign-in. Once the deal is shared, Grace can download it.

### Tests for User Story 3 ⚠️

- [x] T028 [P] [US3] Integration tests in `tests/integration/files-private.test.ts` (`// covers FR-008, FR-009, FR-010, US3 scenarios 1–7, SC-004`):
  - **Ada's private deal and private person, as seen by Grace**:
    - `listFiles` is empty and the count is 0;
    - `fileAccess` gives `hidden`, the same as for an id that never existed;
    - the download/preview routes give 303 `reason=hidden` and no Storage call is made (check `StorageFake.requests`);
    - `startFileUpload` gives `file_record_not_found`;
    - `deleteFile` refuses and changes nothing;
    - no FILE entry appears on the deal's organisation or person timeline.
  - **Changes of privacy**:
    - after Ada makes the deal shared, Grace gets `ok`;
    - after it turns private again, Grace gets `hidden` at once;
    - after handing over a deactivated user's private deal and person (`handOverPrivateRecords`), the new owner gets `ok`.
  - **Signed addresses**: every one issued has `expiresIn` 60 (≤ 300) and names one path only.
  - **Signed out**: `src/proxy.ts` redirects `/files/1/download` to `/sign-in?next=%2Ffiles%2F1%2Fdownload`.

### Implementation for User Story 3

- [x] T029 [US3] Check every `files` query in `src/server/files/files.ts` (`listFiles`, `pageFile`, `fileAccess`, `startFileUpload`, `finishFileUpload`, `deleteFile`) for `visibleFile` or the visibility-checked `lockRecord`, and fix any gap the tests show. In `fileAccess`, make the `gone` branch check the event's record with `visibleDeal`/`visiblePerson` (organisations always visible), so a deleted file on a hidden record answers `hidden`.

**Checkpoint**: Privacy holds for files on every path.

---

## Phase 6: User Story 4 - Adding or deleting a file shows on the timeline (Priority: P2)

**Goal**: FILE entries "<name> added <file> (<size>)" and "<name> deleted <file>", also on the timelines of the deal's person and organisation.

**Independent Test**: Upload `proposal.pdf` to a deal, then delete it. The deal's timeline shows both entries with the FILE tag. The person and organisation timelines show them as the deal's entries.

### Tests for User Story 4 ⚠️

- [x] T030 [P] [US4] Integration tests in `tests/integration/files-timeline.test.ts` (`// covers FR-007, US4 scenarios 1–4, SC-006`):
  - each upload gives exactly one `file_added` and each delete exactly one `file_deleted`;
  - the `file_added` entry has `file.id` set while the file exists and `null` after the delete;
  - entries on a deal appear on its main person's, other linked person's and organisation's timelines with `deal` set;
  - none appear for a viewer who cannot see the deal;
  - `readAmbassadorUpdates` holds no file entries.
- [x] T031 [P] [US4] Extend `tests/unit/timeline-view.test.ts`: `entryTag` gives `FILE` for `file_added`/`file_deleted` on the record itself, `DEAL` when `deal` is set, and ACTIVITY/PERSON/NOTE/CHANGE unchanged (`// covers US4 scenario 3`).

### Implementation for User Story 4

- [x] T032 [US4] In `src/server/records/timeline-view.ts`, `EntryTag` gains `"FILE"`. `entryTag` returns ACTIVITY, PERSON and DEAL as today, then `FILE` for the two file kinds, then NOTE/CHANGE.
- [x] T033 [US4] In `src/app/(app)/records/Timeline.tsx` and `RecordTimeline.tsx`, render the two lines of data-model.md § Timeline event with `<span className="kd file">File</span>` (or the DEAL tag on a linked deal's entry):
  - "**<name>** added <file name> (<formatFileSize>)": the file name is a plain `<a>` while `file.id` is set (image → `?file=<id>` on the current page, PDF → `/files/<id>/preview` in a new tab, other → `/files/<id>/download`), and text otherwise;
  - "**<name>** deleted <file name>";
  - names are text nodes only;
  - add `.kd.file { color: var(--ink); background: var(--wash); border-color: var(--blue) }` to `globals.css`, using the nearest existing variables.
- [x] T034 [US4] In `src/server/records/ambassadors.ts`, add `and e.kind not in ('file_added', 'file_deleted')` to the `where` of `readAmbassadorUpdates` (SF-114 latest updates hold notes and changes only).

**Checkpoint**: Every file change is on the timeline.

---

## Phase 7: User Story 5 - Delete a file (Priority: P2)

**Goal**: `[ DELETE ]` with a confirmation removes the file, its contents and its addresses.

**Independent Test**: Delete a file from a person page and confirm. It is gone from `// FILES`, its download address shows "This file doesn't exist any more.", and the timeline shows the deleted entry.

### Tests for User Story 5 ⚠️

- [x] T035 [P] [US5] Integration tests in `tests/integration/files-delete.test.ts` (`// covers FR-006, FR-011, FR-012, US5 scenarios 1–3, edge cases`):
  - `deleteFile` removes the row, then the fake object; `fileAccess` gives `gone`;
  - with `failDeletes()`: still `ok`, the file not listed, the path left in `file_cleanup` and removed by the next `sweepFileCleanup()`;
  - two concurrent `deleteFile` calls on one file give one `ok` and one `file_gone`, with exactly one `file_deleted` event;
  - a file id that belongs to another record → `file_gone`;
  - an archived record refuses `deleteFile` and `startFileUpload` (`files_archived`) but still lists its files and downloads them;
  - a won/lost deal that is not archived accepts both;
  - deleting a deal, a person or an organisation for good (as an admin) removes their `files` and `file_uploads` rows, queues every path, and their old addresses give `hidden`;
  - a deactivated uploader is listed as "<name> (deactivated)".

### Implementation for User Story 5

- [x] T036 [US5] Add `deleteFile(actorId, target, fileId)` to `src/server/files/files.ts` (data-model.md § Delete a file).
  - In one transaction:
    1. `lockRecord` (`file_record_not_found` / `files_archived`);
    2. `delete from files f where f.id = $id and <record column> = <target id> returning storage_path, name` (no row → `file_gone`);
    3. insert into `file_cleanup`;
    4. `recordEvent` with kind `file_deleted`, `fileName` and `deletedFileId`.
  - After commit: try `removeObjects([path])` (deleting the cleanup row on success), then `sweepFileCleanup()`.
  - Return `ok` whatever Storage answered.
- [x] T037 [US5] Add `cleanupPathsFor(db, target)` to `src/server/files/files.ts`: `insert into file_cleanup (storage_path) select storage_path from files where <col> = $id union all select storage_path from file_uploads where <col> = $id on conflict do nothing`.
  - Call it inside the transactions of `deleteDeal` (`src/server/deals/deals.ts`), `deletePerson` (`src/server/records/people.ts`) and `deleteOrganisation` (`src/server/records/organisations.ts`), before their `delete`.
  - Call `sweepFileCleanup()` after each commit.
- [x] T038 [US5] Add `deleteFileAction` to `src/app/(app)/records/file-actions.ts`.
  - Inputs: `target`, `targetId`, `fileId`, `back`.
  - Calls `requireUser()` first and checks `back` with `isSafeNext`.
  - Redirects to `back` without `delete-file`, with the notice `file_deleted`, or with the error code.
  - A hidden record → its `listPath` with `file_not_found`.
  - Show the notices in `FilesSection` the way `NoteNotices.tsx` does.
- [x] T039 [US5] Add `[ DELETE ]` (a red link to `?delete-file=<id>`, not on archived records) to `FilesSection.tsx`. In `FileOverlays.tsx`, open the confirmation box from `?delete-file=<id>` (`pageFile`, record not archived): `templates.file_delete_confirm(name)`, `[ DELETE ]` (a form posting to `deleteFileAction`) and `[ CANCEL ]` (a link back).

**Checkpoint**: All stories work on their own.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T040 [P] Create `src/seed/files.ts` (data-model.md § Fake data) and register it in `src/seed/index.ts` after `notes`/`activities`.
  - It is idempotent: skip a file whose (record, name) already exists.
  - It makes generated bytes only: a small valid PNG, a minimal one-page PDF, a GIF, zip bytes for `budget.xlsx`, text bytes named `fake.png`.
  - Each file goes through the storage module into the fake, then the same insert and `recordEvent` as `finishFileUpload`.
  - `old-version.pdf` is made and then removed through `deleteFile`.
  - Files: on a shared deal, on Ada Fake's private deal (`contract.pdf`), on a private person (`cv-fake.pdf`), on an organisation, on an archived record (`old-brief.docx`), and on a shared person.

  Extend `tests/integration/seed.test.ts`: running it twice gives no duplicates, and the private files are hidden from Grace Fake (`// covers FR-016`).
- [x] T041 [P] Add `SUPABASE_URL=`, `SUPABASE_SECRET_KEY=` and `FILES_BUCKET=crm-files` to `.env.example`, with comments (the key is a secret; leave the URL empty locally to use the fake storage). In `README.md`:
  - add the three rows to the Settings table;
  - add a "Files" section with the bucket setup of contracts/storage.md: private, 25 MB file size limit, no Storage policies, secret key server-only;
  - say that the fake is used when `SUPABASE_URL` is empty with APP_ENV development/test, and that local contents go in `.fake-storage/`.
- [x] T042 [P] Update `AGENTS.md` § Layout:
  - `src/server/files/` (`rules.ts` pure, `storage.ts`, `fake-storage.ts`, `files.ts`);
  - `visibleFile()` in `records/visibility.ts`: every `files` read uses it;
  - `records/FilesSection.tsx`, `AddFiles.tsx`, `FileOverlays.tsx`, `file-actions.ts`;
  - `src/app/(app)/files/` and `src/app/dev/fake-storage/`;
  - `tests/fakes/storage.ts` (checked against `storage_v0_openapi.json`); `src/seed/files.ts` in the seeder registry list.
- [x] T043 [P] At the end of `docs/DECISIONS.md`, add the seven choices people made in the spec, one line each, exactly:
  - `- Files use design A: a "// FILES" table between "// NEXT ACTIVITIES" and "// TIMELINE" on record pages and the deal drawer, the image preview in a box over the page, FILE entries on the timeline (SF-116)`
  - `- Anyone who can see a record can delete its files, as with notes (SF-116)`
  - `- A person's or organisation's "// FILES" lists only their own files; their deals' files show only as FILE entries on the timeline (SF-116)`
  - `- A file upload goes straight from the browser to the file store through a write-only link valid for up to 2 hours; the app refuses to finish an upload started more than 2 hours ago, and every link that reads a file lasts 60 seconds (SF-116)`
  - `- A PDF preview opens in a new browser tab, in the browser's own PDF viewer (SF-116)`
  - `- The Kind column shows JPG, PNG, GIF, WEBP or PDF for files that can be previewed, otherwise the name's ending in capitals when it is 1 to 5 letters or digits, else FILE (SF-116)`
  - `- With no file store set up, every file action shows "Files can't be reached right now. Try again in a minute." and nothing is stored anywhere else (SF-116)`

  No blueprint line. Run `tests/unit/decisions.test.ts`.
- [x] T044 [P] Extend `tests/unit/messages.test.ts` with the SF-116 codes and templates (exact texts of contracts/routes.md § Messages), and `tests/unit/nav.test.ts` only if the sidebar changed (it should not).
- [x] T045 Run `npm run test:schemas`, `npm run typecheck` and `npm test` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`. Fix every failure and keep the full failure output when reporting. Then check quickstart.md § Automated checks is fully covered.
- [x] T046 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) and `## Schemas` (each schema's GitHub URL at its commit).
  - **Services**:
    - Supabase Storage: fake `src/server/files/fake-storage.ts`, wrapped by `tests/fakes/storage.ts` and checked against `storage_v0_openapi.json`. It copies 409 on an existing object, 413 over 26214400 bytes, `InvalidJWT` for an expired or wrong token, 60 s read addresses and 2 h upload addresses. In the running app it is reached at `/dev/fake-storage` when `SUPABASE_URL` is empty.
    - Supabase Postgres: keep the existing line and add SF-116's tables (`migrations/0011_files.sql`) and its pooler limits.
  - **Schemas**: keep `oauth2-api.json` and add `storage_v0_openapi.json`: https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T005 needs T003 and T004.
- **Foundational (Phase 2)**: needs T001 and blocks every story. T006 before T007 and T008; T007 before T008 and T009.
- **US1 (Phase 3)**: needs Phase 2. MVP. T014 is its first test task.
- **US2 (Phase 4)**: needs US1's upload (tests can upload through `file-helpers.ts`).
- **US3 (Phase 5)**: needs US1 and US2 (it checks their reads and routes).
- **US4 (Phase 6)**: needs US1 (`file_added`); its delete half needs US5's `deleteFile` (T036). The tests can be written first and fail until then.
- **US5 (Phase 7)**: needs US1 and US2 (`fileAccess` for `gone`).
- **Polish (Phase 8)**: after the stories. T046 is the last task.

### Within Each User Story

- Write the tests first and see them fail. Domain code (`src/server/…`) comes before pages. A story is done at its checkpoint.

### Parallel Opportunities

- Phase 1: T002, T003, T004 (T005 after T003/T004).
- Phase 2: T010, T012 beside T006–T009; T011 and T013 beside them.
- US1: T014 and T015 beside each other (different files); T016 after T014.
- US2: T022 and T025.
- US3: T028.
- US4: T030, T031.
- US5: T035.
- Polish: T040, T041, T042, T043, T044.

---

## Parallel Example: User Story 4

```bash
Task: "Integration tests in tests/integration/files-timeline.test.ts"
Task: "Extend tests/unit/timeline-view.test.ts with the FILE tag"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phases 1–2, then US1: files can be uploaded and listed (download link only).
2. Validate with T014–T016 and the US1 checkpoint.

### Incremental Delivery

1. US1 → US2 (preview and download) → US3 (privacy across them) → US4 (timeline) → US5 (delete) → Polish.
2. Run `npm test` at each checkpoint.

## Notes

- **Choices made here without asking**:
  - The Storage schema task (T014) and the Postgres task (T015) sit in US1, the first story that calls Storage and writes the new tables.
  - The record-delete clean-up (FR-012) sits in US5 with file deletion, because it shares `file_cleanup`.
  - The seed is in the Polish phase because it needs every story's code.
  - "Bob Fake" in the spec is Grace Fake, the second admin of the fake users.
- **The fake**: the only Storage fake is new and is checked against the schema (T014). No existing fake is extended without a schema check.

## Fix round 1 (AI review)

- [x] T047 [P] Write `tests/unit/proxy-matcher.test.ts` first (`// covers US1 scenario 3, SC-002`): with
  `unstable_doesMiddlewareMatch` from `next/experimental/testing/server` and `config` from `src/proxy.ts`, check that
  `/dev/fake-storage/object/upload/sign/files/<uuid>?token=x` and `/dev/fake-storage/object/sign/files/<uuid>` do not
  match, and that `/deals`, `/files/1/download`, `/sign-in` and `/dev/fake-google` still match. It fails now (the
  fake-storage paths match).
- [x] T048 Leave `dev/fake-storage` out of the matcher in `src/proxy.ts`, drop its now-dead `PUBLIC` entry and fix the
  head comment (plan.md § Fix round 1, item 1). T047 passes.
- [x] T049 [P] Extend `tests/integration/files-actions.test.ts` first, rendering `FileOverlays` as the
  `/files/unavailable` tests do and catching the `NEXT_REDIRECT` error (read its digest for the target):
  (a) `// covers US5 scenario 2`: after a file is deleted, `?delete-file=<its id>` on a non-archived record redirects to
  `back` with `error=file_gone`; a file of a hidden record and an id that never existed redirect with
  `error=file_not_found`; an archived record still renders nothing; (b) `// covers Edge case 8`: with the Storage
  fetch made to throw (`useStorageFetchForTests` with a fetch that rejects), `?file=<visible image id>` redirects to
  `back` with `error=files_unreachable` and renders no `<img>`; with the fake Storage, it renders the box with an
  `<img>` whose `src` is a signed Storage address of that file and `referrerpolicy="no-referrer"`. Both fail now.
- [x] T050 Change `src/app/(app)/records/FileOverlays.tsx` as plan.md § Fix round 1, items 2 and 3 say. T049 passes.
- [x] T051 Run `npm run typecheck` and `npm test` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`;
  fix every failure, keep the full failure output when reporting.
