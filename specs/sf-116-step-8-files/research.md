# Research: Files (SF-116)

Each section: Decision, Rationale, Alternatives considered. Nothing is left as NEEDS CLARIFICATION; choices a person
should confirm are in spec.md § Clarifications ("decided by the factory, to confirm").

## 1. Talking to Supabase Storage: plain `fetch`, no library

- **Decision**: a small module `src/server/files/storage.ts` calls the Storage REST API (`<SUPABASE_URL>/storage/v1`)
  with `fetch`, five operations only (contracts/storage.md). No `@supabase/supabase-js` / `@supabase/storage-js`.
- **Rationale**: the repo already reaches Google the same way (`src/server/auth/google.ts`: "No library: two fetch
  calls"), and takes an injectable `fetch` so a fake can stand in. Five JSON calls do not need a client library; the
  library would also bring its own auth/session code the app does not use (the CRM has its own sign-in, not Supabase
  Auth, DECISIONS SF-80). The Storage OpenAPI file pins every path and field we use (§ Outside services in plan.md).
- **Alternatives**: `@supabase/storage-js` (adds a dependency and a second way of reaching an outside service);
  S3-compatible endpoint with an AWS SDK (much larger, needs S3 keys as well).

## 2. Uploading 25 MB on Vercel: straight from the browser through a signed upload address

- **Decision**: the browser asks the app for an upload (server action `startFileUpload`); the app checks the user, the
  record (visible, not archived), the name and the size, writes a pending `file_uploads` row with a fresh random
  storage path (`files/<uuid>`; the file name is never part of the path), and asks Storage for a signed upload address
  for that path only (`POST /object/upload/sign/{bucket}/{path}`, no `x-upsert`). The browser `PUT`s the file to it
  with `XMLHttpRequest` (for the "<n>%" progress). Then `finishFileUpload` makes the app read the stored object's size
  and type and its first 16 bytes from Storage, and only then lists the file (one transaction: `files` row + `file_added`
  event, pending row removed).
- **Rationale**: a Vercel function refuses request bodies over 4.5 MB, so a 25 MB file cannot pass through the app in
  one request. The CSV import (SF-103) sends 512 KiB parts to the app because its file (≤ 5 MB) is kept in the database;
  files must never be kept in the database (FR-015), and reassembling 25 MB server-side would need exactly that. A
  signed upload address is Supabase's own way for this. It is made only after the app's checks, is for one new object
  at an unguessable path, cannot overwrite (upsert off; a second `PUT` answers 409) and never gives read access. The
  file is listed only once the app has read it back from Storage (FR-002, SC-005).
- **Lifetime**: Supabase decides how long a signed upload address lasts (self-hosted default 60 s,
  `UPLOAD_SIGNED_URL_EXPIRATION_TIME`; up to 2 hours on hosted projects); the API takes no `expiresIn` for it. The app
  accepts `finishFileUpload` only within 2 hours of `startFileUpload`; older pending uploads are swept (§8). This is
  a write-only address, so FR-010's "contents never reachable without the app" holds; its lifetime is a choice to
  confirm (spec Clarifications).
- **Alternatives**: parts through the app (needs DB staging of up to 25 MB, against FR-015); Supabase resumable (TUS)
  uploads from the browser (needs a 6 MB-chunk client library and a TUS fake for little gain at 25 MB).

## 3. Preview and download: a check on every request, then a 60-second signed address

- **Decision**: two route handlers, `GET /files/<id>/download` and `GET /files/<id>/preview`. Each time: the session
  (`requireUser()`; signed out → sign-in with `next`, via `src/proxy.ts`), the file read through `visibleFile()`, then
  `POST /object/sign/{bucket}/{path}` with `expiresIn: 60` and a `303` to the absolute signed address (download: with
  `download=<safe name>` so Storage answers `Content-Disposition: attachment`). Responses carry
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Failure → `303` to `/files/unavailable?reason=<code>`.
- **Rationale**: the check is made on every request, never when a link is drawn (FR-009); a copied app address gives
  nothing to someone who cannot see the record, now or after it turns private (US3 §2, §4). The only address that
  reaches Storage is for one file, made after the check, and dies in 60 s (FR-010: ≤ 5 min). Vercel's response limit
  (4.5 MB) rules out streaming 25 MB through a function.
- **Alternatives**: streaming through the app (Vercel response limit, double transfer); long-lived signed links in the
  page (would outlive a privacy change).

## 4. What a file "is": sniffed bytes + name + stored type

- **Decision**: pure `fileKind({ head, name, storedType })` in `src/server/files/rules.ts`: `jpeg` / `png` / `gif` /
  `webp` / `pdf` only when the magic bytes (`FF D8 FF`; `89 50 4E 47 0D 0A 1A 0A`; `GIF87a`/`GIF89a`; `RIFF....WEBP`;
  `%PDF-`) **and** the extension (`.jpg/.jpeg`, `.png`, `.gif`, `.webp`, `.pdf`, any case) **and** the type Storage
  kept (`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`) all agree; else `other`. Only those
  five are previewable. The browser is told which `Content-Type` to send (`uploadContentType(name)`: the five above by
  extension, else `application/octet-stream`); a user who sends another type just gets `other`.
- **Rationale**: spec edge case (a text file renamed "fake.png" → no preview, downloaded); SVG/HTML never previewed
  (they would be served as `octet-stream`, and only `other` anyway). Requiring the stored type to match means Storage
  never serves a previewed file as anything but an image or a PDF.
- **Kind column**: `kindLabel(name, kind)`: `JPG`/`PNG`/`GIF`/`WEBP`/`PDF` for previewable kinds, else the name's
  extension in capitals when it is 1–5 letters or digits (`XLSX`, `DOCX`, `CSV`), else `FILE`.

## 5. Where the fake lives (tests and local runs)

- **Decision**: one fake of the five Storage operations, `src/server/files/fake-storage.ts` (`FakeStorage`: a
  `fetch(Request) → Response` over a byte store; memory when `APP_ENV=test`, a folder `.fake-storage/` — git-ignored —
  when `APP_ENV=development`). It is used only when `isFakeAllowed()` and `SUPABASE_URL` is empty. The server calls it
  in process; the browser reaches it through `src/app/dev/fake-storage/[...path]/route.ts` (public in `src/proxy.ts`
  like `/dev/fake-google`, `404` unless `isFakeAllowed()`), so signed addresses point at
  `<APP_URL>/dev/fake-storage/object/...` and behave like Supabase's (token for one path, expiry, upsert off, `download`
  → attachment). `tests/fakes/storage.ts` wraps it for tests: every request and response is checked against the
  pinned OpenAPI file (method, path, query and body properties), plus switches to make Storage unreachable or fail a
  delete. `scripts/fetch-schemas.mjs` also downloads that file (pinned commit, sha256).
- **Rationale**: DECISIONS kickoff/FR-015: every outside service has a fake and works without real accounts; the
  Google precedent (in-app `/dev/fake-google` + `tests/fakes/google.ts` checked against a pinned schema). One fake for
  both avoids two behaviours drifting apart.
- **Alternatives**: real local Supabase in Docker (needs the Supabase stack; the repo runs no Docker for the app);
  a fake only in tests (local runs would have no files).

## 6. Privacy: `visibleFile()` beside the other rules

- **Decision**: `visibleFile(db, viewer, alias = "f")` in `src/server/records/visibility.ts`: `(f.deal_id is null or
  exists(deal d … visibleDeal)) and (f.person_id is null or exists(person p … visiblePerson))`; organisations are never
  private. Every `files` read uses it (list, count, preview box, delete, download, preview). Timeline FILE entries
  already follow their record's visibility (`targetWhere`). Hand-over needs nothing: visibility follows the owner.
- **Rationale**: the same one-rule pattern as `visibleActivity()` (SF-109); a hidden file does not exist for the viewer,
  so "doesn't exist or you can't see it" is the same answer for both (US3 §2).

## 7. Changes: one transaction per change, the record row locked

- **Decision**: like notes (SF-102 `lockRecord`): `finishFileUpload` and `deleteFile` lock the record row `for update`
  through the visibility rule and refuse an archived record (`files_archived`). Storage calls are made outside the
  transaction (read-back before it, delete after it), so no transaction waits on the network.
- Concurrent deletes: the second finds no row → "This file doesn't exist any more."; one `file_deleted` event only.
  Concurrent uploads: two rows, two events.

## 8. Leftover contents: a clean-up list swept "later"

- **Decision**: table `file_cleanup (storage_path, due_at, attempts)`. Every path whose contents must go is inserted
  in the same transaction that removes the app's row: `deleteFile`, `deleteDeal`, `deletePerson`,
  `deleteOrganisation` (their files and pending uploads), refused or failed finishes. After the commit the app tries
  `DELETE /object/{bucket}` with those paths; rows it removed go, rows that failed get `due_at = now() + 10 min`.
  `sweepFileCleanup()` (up to 50 due rows, claimed with `for update skip locked` and pushed back before the network
  call) runs after every upload start, finish and delete, and also moves pending uploads older than 2 hours into the
  list. No cron: the app has no long-running server (DECISIONS SF-80); with a 10-user team, files are touched often.
- **Rationale**: spec edge case "the leftover contents are removed later"; the user still sees "File deleted.".

## 9. Size and name limits

- 1 byte to 26,214,400 bytes (25 × 1,024 × 1,024), checked in the browser (instant message), in `startFileUpload`,
  against the size Storage reports at finish (must equal the declared size), by a database check, and by the bucket's
  own `file_size_limit` (set to 25 MB at setup). Names: 1–255 characters (counted as Unicode code points, as
  `char_length`), kept as given; `safeDownloadName(name)` replaces `/ \ : * ? " < > |` and control characters with `_`
  and trims dots and spaces at the ends (empty → `file`). Shortened name in the "over 255" message: first 40 characters
  + "…".

## 10. Sizes shown

- `formatFileSize(bytes)` in `src/server/format.ts`: `< 1,024` → "<n> B"; `< 1 MiB` → "<n> KB" (rounded, 1,024 base);
  else "<n.n> MB" (one decimal, "25 MB" for exactly 25 MiB: drop ".0"). Matches the design ("840 KB", "2.1 MB").

## 11. Page pieces

- `// FILES` is a server component (`FilesSection.tsx`) with one small client part (`AddFiles.tsx`: the hidden
  `<input type="file" multiple>`, the progress rows, the per-file messages, then `router.refresh()`). The image preview
  and the delete confirmation open from the page address (`?file=<id>`, `?delete-file=<id>`) as server-rendered boxes,
  the way `ActivityOverlays` does (SF-109): no client state, `[ CLOSE ]` / `[ CANCEL ]` are links back. Names are text
  nodes only; links use plain `<a>` (never `next/link`, which would prefetch the download route).
- PDF: name and `[ PREVIEW ]` open `/files/<id>/preview` in a new tab (`target="_blank" rel="noopener noreferrer"`),
  where the browser's own viewer shows it (choice to confirm, spec Clarifications).
