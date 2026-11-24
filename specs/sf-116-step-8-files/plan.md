# Implementation Plan: Files

**Branch**: `factory/sf-116-step-8-files` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-116-step-8-files/spec.md`

## Summary

Files on deals, people and organisations. Contents live in a private Supabase Storage bucket, reached with plain
`fetch` calls (no library), as Google is today. Uploads go straight from the browser to Storage through a one-file
signed upload address that the app makes after its checks (Vercel refuses request bodies over 4.5 MB). The app lists a
file only after reading it back from Storage: size, stored type and first bytes, so the kind is decided from content,
name and type together. Downloads and previews go through `/files/<id>/download|preview`. These routes check the
private rules on every request (`visibleFile()`), then redirect to a Storage address valid for 60 seconds. A `// FILES`
table (design A) sits between `// NEXT ACTIVITIES` and `// TIMELINE` on the three record pages and the deal drawer, with
an image preview box and a delete confirmation opened from the page address. Two new timeline kinds, `file_added` and
`file_deleted`, are tagged FILE. One migration (`0011_files.sql`: `files`, `file_uploads`, `file_cleanup`, timeline
columns), one fake Storage shared by tests and local runs and checked against Supabase's OpenAPI file. No new
dependency.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions, route handlers), React 19.3, `postgres` 4.1, all
already in the repo. Storage via `fetch` (research.md §1). Nothing added (`dependencies.json` = `[]`).

**Storage**: PostgreSQL for the metadata (migration `0011_files.sql`, data-model.md); file contents in Supabase Storage,
private bucket `crm-files` (contracts/storage.md); a fake storage (memory in tests, `.fake-storage/` in development).

**Testing**: Vitest unit + integration on the real local Postgres, with `tests/fakes/storage.ts` checked against the
pinned Storage OpenAPI file. No browser tests (DECISIONS 2026-11-23).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers (XHR upload progress, built-in PDF
viewer).

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-002: 25 MB in under 30 s at 20 Mbit/s. The upload goes to Storage in one direct `PUT`, and
the app makes only two small calls per file. SC-003: preview under 3 s for 10 MB, one redirect and then Storage's CDN.
Listing is one indexed query per record (`files_<record>_idx`).

**Constraints**:
- 25 MB: request bodies through Vercel ≤ 4.5 MB, so the bytes never pass through the app.
- Contents never reachable without the app. Read addresses are valid for 60 s and made after the check (FR-010).
- Every message comes from `messages.ts`. File names are text nodes only.
- Pooler limits: no session state, and every change is one `sql.begin()` with no network call inside.

**Scale/Scope**: ≤ 10 users and a few thousand records, with files per record in the tens. 4 changed screens (deal page,
drawer, person page, organisation page), 1 new page (`/files/unavailable`), 2 new routes, 1 dev-only fake route.

No NEEDS CLARIFICATION left. The factory's choices were confirmed at plan review (spec.md § Clarifications,
2026-11-24), with one change: the migration is `0011_files.sql` and its kind check also lists SF-115's custom kinds.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so no gate can fail. The binding rules are
`docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | `FilesSection`, the preview box and the confirmation are server-rendered. One client part, `AddFiles.tsx`, because file picking and upload progress need the browser | ✅ |
| Every page `requireUser()`; every action `requireUser()` first; never rely on hidden links | Both routes, the unavailable page and the three actions call `requireUser()`. Domain functions re-check `visibleFile` / record visibility and archive state in their transaction | ✅ |
| Messages from `messages.ts`; never text from the URL; redirects via `isSafeNext` | contracts/routes.md § Messages. `reason` is a code looked up in a fixed list. `back` goes through `isSafeNext` | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0011`: three `create table`, each followed by `enable row level security`; only `alter`/`create index` otherwise | ✅ |
| Every outside service is reached through settings and has a fake; built and tested without real accounts (kickoff) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `FILES_BUCKET` are settings. `FakeStorage` serves development and tests, and the tests check it against the pinned schema | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/files.ts` is in the gated registry, with generated bytes and "…fake" names. The fake route answers 404 otherwise | ✅ |
| No secrets in the repo; every setting in `.env.example` and README | The three settings are added empty, and the key is marked as a secret | ✅ |
| Private contact or deal hidden from all but creator / owner, admins included (SF-92, SF-93) | `visibleFile()` is used on every read, count, box, route and action. Timeline entries follow their record | ✅ |
| Anyone can archive; only admins delete for good | Archived: files listed and downloadable, no add or delete. Record deletes queue their files' contents | ✅ |
| No long-running server; no Docker (SF-80) | No cron and no worker: the clean-up is swept by later file calls (research.md §8) | ✅ |
| Every table RLS on, no policies (SF-80) | The new tables follow the same rule, and so does the bucket (no Storage policies, private) | ✅ |
| Timeline design B (SF-102) | FILE tag `.kd.file`, the same day groups and `entryTag` order | ✅ |

**Post-design re-check**: still passes. No violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-116-step-8-files/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, state changes, fake data
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   ├── routes.md        # pages, query parameters, routes, actions, domain functions, messages
│   └── storage.md       # Supabase Storage calls, settings, bucket setup, the fake
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/0011_files.sql                          # data-model.md § Migration
scripts/fetch-schemas.mjs                          # + storage_v0_openapi.json (pinned, sha256)
src/proxy.ts                                       # /dev/fake-storage public
src/server/
├── env.ts                                         # storageConfig()
├── format.ts                                      # formatFileSize
├── messages.ts                                    # contracts/routes.md § Messages
├── files/
│   ├── rules.ts                                   # pure: limits, validateFile, fileKind, kindLabel, safeDownloadName…
│   ├── storage.ts                                 # the five Storage calls (fetch), StorageUnreachable
│   ├── fake-storage.ts                            # FakeStorage, MemoryStore, DiskStore
│   └── files.ts                                   # list, access, start/finish upload, delete, clean-up
├── records/visibility.ts                          # visibleFile()
├── records/timeline.ts, records/timeline-view.ts  # file kinds, `file` on entries, FILE tag
├── records/people.ts, records/organisations.ts    # deletes queue file contents
├── records/ambassadors.ts                         # latest updates leave out file kinds
└── deals/deals.ts                                 # deleteDeal queues file contents
src/app/
├── (app)/records/
│   ├── FilesSection.tsx                           # server: // FILES (design A)
│   ├── AddFiles.tsx                               # client: picker, progress, messages
│   ├── FileOverlays.tsx                           # server: ?file= preview box, ?delete-file= confirmation
│   ├── file-actions.ts                            # startFileUpload, finishFileUpload, deleteFileAction
│   ├── RecordTimeline.tsx, Timeline.tsx           # FILE entries
├── (app)/files/[id]/download/route.ts, (app)/files/[id]/preview/route.ts
├── (app)/files/unavailable/page.tsx
├── (app)/deals/[id]/page.tsx, (app)/deals/DealDrawer.tsx, (app)/people/[id]/page.tsx, (app)/organisations/[id]/page.tsx
├── dev/fake-storage/[...path]/route.ts
└── globals.css                                    # .ft, .kd.file, preview box image
src/seed/files.ts, src/seed/index.ts
tests/fakes/storage.ts, tests/support/reset.ts, tests/unit/…, tests/integration/…   # quickstart.md
.env.example, README.md, AGENTS.md, docs/DECISIONS.md, .gitignore (.fake-storage/)
```

**Structure Decision**: the same single Next.js project. File code gets its own `src/server/files/` folder because it
has its own outside service. Privacy stays in `records/visibility.ts`, and the UI sits in `records/` beside notes
because it is shared by the three record kinds and the drawer.

## Build steps (in order)

1. **Schema download**: in `scripts/fetch-schemas.mjs`, turn the single file into a list. Add
   `storage_v0_openapi.json` from `https://raw.githubusercontent.com/supabase/supabase/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json`,
   sha256 `bd435bab4b3b2ef87e3e61f2e948092c30db204f881a4d72d4234a032a356311`, and keep the Google entry unchanged.
   Update `tests/unit/fetch-schemas.test.ts` if it reads the constants.
2. **Migration** `migrations/0011_files.sql` exactly as in data-model.md. Add the three tables to
   `tests/support/reset.ts` (and `.factory/run/reset-db.sh` if it lists tables). Extend `migrate.test.ts`.
3. **Pure rules**: `src/server/files/rules.ts` (research.md §4, §9), `formatFileSize` (§10), messages and templates
   (contracts/routes.md). Add `"FILE"` to `EntryTag` and `entryTag`.
4. **Storage**: `storageConfig()` in `env.ts`, then `src/server/files/storage.ts` and `fake-storage.ts` as in
   contracts/storage.md. Add `src/app/dev/fake-storage/[...path]/route.ts` (all methods, `404` unless
   `isFakeAllowed()`), add the `PUBLIC` pattern in `src/proxy.ts`, and add `.fake-storage/` to `.gitignore`. Write
   `tests/fakes/storage.ts` with the schema checks.
5. **Visibility and domain**: `visibleFile()` in `visibility.ts` and `src/server/files/files.ts` (data-model.md § State
   changes, contracts/routes.md § Domain functions). Every `files` read uses `visibleFile`. No network call inside
   `sql.begin()`.
6. **Timeline**: `recordEvent` gets `fileId`, `fileName`, `fileSize`, `deletedFileId`. `selectEntries` reads them,
   with a left join to `files` for the kind. Add `TimelineEntry.file`. `Timeline.tsx` and `RecordTimeline.tsx` render
   the lines from data-model.md with `<span className="kd file">File</span>`. The file name links while `file.id` is
   set (image → `?file=<id>`, PDF → new tab, other → download). Ambassador latest updates exclude
   `file_added`/`file_deleted`.
7. **Record deletes**: `deleteDeal`, `deletePerson` and `deleteOrganisation` insert their files' and pending uploads'
   paths into `file_cleanup` in their transaction, then call `sweepFileCleanup()` after commit.
8. **UI**: `FilesSection`, `AddFiles`, `FileOverlays`, `file-actions.ts`, then the four screens (between
   `NextActivities` and `RecordTimeline`; in the drawer too, with `[ ADD FILE ]`). Add the two routes and
   `/files/unavailable`. CSS follows `design-options.html` option A: `.ft` mono capitals chip; `.kd.file { color:
   var(--ink); background: var(--wash); border-color: var(--blue) }` (use the existing variables nearest to these); the
   preview box reuses the activity box's dim/modal look, with `img { max-width: 100%; max-height: 70vh; object-fit:
   contain }`. Plain `<a>` for file links, never `next/link`.
9. **Fake data**: `src/seed/files.ts` as in data-model.md § Fake data. Make the files through the domain path
   (storage put through the fake, then the same insert and `recordEvent` as `finishFileUpload`). Make the
   `old-version.pdf` delete through `deleteFile`, so the event has a real `deleted_file_id`. Register it in
   `src/seed/index.ts`.
10. **Settings and docs**: add `SUPABASE_URL=`, `SUPABASE_SECRET_KEY=` and `FILES_BUCKET=crm-files` to
    `.env.example` with comments. In the README, add rows to the Settings table and a short "Files" section: the
    bucket setup from contracts/storage.md, and the fake used when `SUPABASE_URL` is empty in development/test. Update
    `AGENTS.md` § Layout (`src/server/files/`, `visibleFile()`: every `files` read uses it; the UI files;
    `tests/fakes/storage.ts`). Update `.factory/test-env.md` only through Build/AI review, as the factory says. At the
    end of `docs/DECISIONS.md`, add the seven choices people made in the spec, one line each (exact text in tasks.md T043):
    "Files use design A: a "// FILES" table between "// NEXT ACTIVITIES" and "// TIMELINE" on record pages and the deal
    drawer, the image preview in a box over the page, FILE entries on the timeline (SF-116)", "Anyone who can see a
    record can delete its files, as with notes (SF-116)" and "A person's or organisation's "// FILES" lists only their
    own files; their deals' files show only as FILE entries on the timeline (SF-116)", then the four choices confirmed at
    plan review (upload link up to 2 hours, PDF preview in a new tab, the Kind column, no file store set up). No blueprint exception (no blueprint
    index in this run), so no "Departs from blueprint" line.

## Outside services

- Supabase Storage: schema https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93 and SF-102: only an OpenAPI file for Supavisor's own management API; this change only adds tables and columns to the app's own database, and tests use a real local Postgres rather than a fake)

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.

## Fix round 1

AI review: 34 of 37 scenarios pass. Three fail.

1. **An upload over 10 MB fails in development and test (US1-3, SC-002).**
   - Cause: the `src/proxy.ts` matcher runs on `/dev/fake-storage/*`. Next's proxy reads the request body and cuts it at
     10 MB (`proxyClientMaxBodySize`), so the PUT of a 25 MB file to the fake Storage fails. Production uploads go
     straight to Supabase and are not affected. Build's tests call the fake in-process, so they miss it.
   - Fix: leave `dev/fake-storage` out of the matcher (add it to the negative lookahead beside `_next/static`). The
     path is already public and the fake checks its own tokens, so the proxy does nothing useful there. Drop the
     `/dev/fake-storage` entry of `PUBLIC` (dead once the matcher skips it) and update the file's head comment. No
     global body-size raise in `next.config.ts`: it would let every proxied request carry 25 MB for a dev-only need.
2. **`[ DELETE ]` on a file someone else already deleted shows nothing (US5-2).**
   - Cause: `FileOverlays` returns `null` when `pageFile` finds no file for `?delete-file=<id>`.
   - Fix: when the record is not archived and `pageFile` finds nothing, ask `fileAccess(viewerId, id)` and redirect to
     `back` with `error=file_gone` when it answers "gone", else `error=file_not_found` (hidden, never existed, or a file
     of another record). `FilesSection` already shows these notices from `?error=`. Archived records keep opening
     nothing (Edge case 1 passes as it is). A `?delete-file=` value that is not an id also gives `file_not_found`.
3. **With Storage unreachable, the image preview box opens with a broken image (Edge case 8).**
   - Cause: `FileOverlays` opens the box without calling Storage; only the `<img>` request to `/files/<id>/preview`
     meets the failure, and an image cannot show a message.
   - Fix: for `?file=<id>` of a visible image, make the 60-second read address in the overlay (`signedUrl`, no
     download name) before showing the box, and use it as the `<img src>` with `referrerPolicy="no-referrer"`. On
     `StorageUnreachable`, redirect to `back` with `error=files_unreachable` (the existing notice). The box shows only
     after the address was made. The `/files/<id>/preview` route is unchanged (PDF previews and timeline links use it).
     `?file=` of a missing or hidden file keeps opening nothing (no scenario asks otherwise).

Files to change: `src/proxy.ts`, `src/app/(app)/records/FileOverlays.tsx`; tests in `tests/unit/proxy-matcher.test.ts`
(new) and `tests/integration/files-actions.test.ts`. No new dependency, no migration, no new message, no spec change.
