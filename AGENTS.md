# AGENTS.md

How to work on this repo. Setup, commands and settings are in `README.md`. Product rules are in
`docs/PRODUCT.md`, the look in `docs/DESIGN.md`, team choices in `docs/DECISIONS.md`: follow them.

## Stack

Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript, Postgres through `postgres` (postgres.js,
plain SQL, no ORM), plain CSS (`src/app/globals.css`), fonts from `geist`. No auth library: own Google
OAuth code flow and database sessions.

## Layout

- `src/app/(app)/` — every signed-in page (design B sidebar layout). `nav.ts` is the sidebar registry.
- `src/app/sign-in`, `src/app/auth/*`, `src/app/dev/fake-google` — public sign-in pages and routes.
- `src/server/` — domain code, tested without the UI: `auth/rules.ts` (pure rules), `auth/session.ts`
  (`requireUser`, `requireAdmin`, `assertAdminForAction`), `auth/sign-in.ts`, `auth/google.ts`,
  `users.ts`, `env.ts` (`isFakeAllowed`, `isPreview`), `messages.ts` (every user-facing message; `templates` for
  messages built from a database name). `records/`: people, organisations, lead sources and labels —
  `rules.ts` and `list-query.ts` (pure), `visibility.ts` (the one private rule — creator or owner: every `persons` read uses
  `visiblePerson()`; `visibleDeal()` beside it: every `deals` read uses it), `handover.ts` (hand a deactivated user's private people and private deals, archived included, to an active user), `people.ts`, `organisations.ts`, `choices.ts`, `timeline.ts` (one paged read per record: `readTimeline` → `{ entries, more }`; people and organisations add their linked deals' entries), `flash.ts` (one-shot notice after a delete, a hand-over, a note delete or losing sight of a person or deal; `src/proxy.ts` drops its cookie on the next page load), `form-data.ts`.
  SF-102 notes: `notes-rules.ts` (pure: note text, `@[user:<id>]` mention tokens, segments, preview, `parseShown`),
  `timeline-view.ts` (pure: day groups, NOTE/DEAL/CHANGE tags), `notes.ts` (add/edit/delete notes, mention candidates;
  notes are `timeline_events` of kind `note`, mentions `note_mentions` rows). `src/server/notifications.ts`: a user's
  mentions as notifications (list, unread count, open, mark all read), shown only while the record is visible.
  `deals/`: pipelines, stages and deals — `rules.ts` (pure: money in pence, validation, board address, stage bar, lost
  reason, `back`), `deals.ts` (board of open deals, deal, add/edit/move/archive/restore/delete, Won/Lost/Reopen, stage
  seconds; `transferDeal` records every stage move), `list.ts` (the deal list: rows, count and total, filter options),
  `links.ts` (other linked people, followers), `pipelines.ts` (admin changes).
  `activities/` (SF-109): `rules.ts` (pure: validation, UK time `ukInstant`/`existsInUk`, `activityState` Overdue/Today,
  `formatDue`, week bounds, the board card line `cardLine`, `afterTickPath`), `activities.ts` (schedule/edit/tick/untick/delete,
  `nextActivities`, `pageActivity` for the address ids, `prefillLinks`, `activityFormChoices`; a done call or meeting raises
  the person's Last contacted), `list.ts` (the Activities list, `now` as a parameter). `visibleActivity()` in
  `records/visibility.ts`: every `activities` read uses it. Done activities are read into `readTimeline` (never copied);
  `notifications.ts` also lists activities assigned by someone else (columns on the activity row).
  SF-114 ambassadors: `records/ambassadors.ts` (the Ambassadors page `listAmbassadors`, the ambassador page
  `getAmbassadorPage` and its updates `readAmbassadorUpdates`, the "Referred by" options `ambassadorOptions` /
  `referrerOptions`, the check `isOfferedAmbassador`, `referrerOf`; counts through one shared summary fragment) and
  `records/referral-rules.ts` (pure: `parseReferredBy`, `decideReferrer`, `referralEvent`); `people.ts` holds
  `resolveReferrer` / `recordReferral`, shared with `deals.ts`. `hasAmbassadorPage()` sits in `visibility.ts`.
- `src/server/files/` — files on deals, people and organisations (SF-116): `rules.ts` (pure: 25 MB / 255-character
  limits `validateFile`, `uploadContentType`, `fileKind` from bytes + name + stored type, `kindLabel`, `safeDownloadName`,
  `fileHref`), `storage.ts` (Supabase Storage through plain `fetch`: signed upload address, info, first bytes, 60-second
  read address, bulk delete; `StorageUnreachable`; `useStorageFetchForTests`), `fake-storage.ts` (`FakeStorage` over
  `MemoryStore` in tests / `DiskStore` `.fake-storage/` in development; `storageConfig()` in `env.ts` picks Supabase, the
  fake or "off"), `files.ts` (`listFiles`, `pageFile`, `fileAccess`, `startFileUpload` / `finishFileUpload` (table
  `file_uploads`), `deleteFile`, `cleanupPathsFor` (used by the three record deletes), `sweepFileCleanup` (table
  `file_cleanup`, swept after every file action: no cron)). No Storage call inside a transaction. `visibleFile()` in
  `records/visibility.ts`: every `files` read uses it. FILE timeline entries: kinds `file_added` / `file_deleted`.
- SF-121 unsubscribe: `src/server/records/unsubscribe-rules.ts` (pure: `isTokenShape`, `unsubscribeLinks`, `isOneClickBody`)
  and `src/server/records/unsubscribe.ts` (`unsubscribeByToken`, `unsubscribePageState`, `unsubscribeLinksFor` — the one
  function campaign sending uses — and `listUnsubscribeLinks`; the only `persons` reads without `visiblePerson()`: the
  token is the authority). Public pages: `src/app/unsubscribe/[token]/` (the page, `confirm/` and `one-click/` route
  handlers, listed in `PUBLIC` in `src/proxy.ts`) and `src/app/dev/unsubscribe-links/` (development and test only).
  Timeline kinds `unsubscribed_link`, `unsubscribed_mail_app` (no actor) and `consent_changed` (a teammate's Consent edit;
  the person form sends `consentShown` and a save changes Consent only when the field was changed on that form).
- `src/app/(app)/records/` — UI shared by people, organisations and deals (forms, pickers, drawer, timeline, filter row).
  `records/import/`: the CSV import screens shared by `/people/import` and `/organisations/import` (`ImportPages.tsx`:
  the four steps; `FileStep.tsx`: the only client part, sends the file in 512 KiB parts; `actions.ts`; `example.ts`).
  SF-102: `RecordTimeline.tsx` (the // TIMELINE of every record page and the deal drawer, design B), `NoteBox.tsx`
  (client: the note box and the @ picker), `NoteDeleteConfirm.tsx`, `note-actions.ts`, `note-target.ts` (the record a note form posts to, its page and its kind's list), `NoteNotices.tsx` (the note notices of a record page); `Timeline.tsx` keeps the change
  lines. `src/app/(app)/notifications/` — the Notifications page and its actions. SF-108: the sidebar count starts from `layout.tsx` and `UnreadLink.tsx` (client) asks it again (`currentUnread`) after every client navigation; `RefreshOnHistory.tsx` refreshes the page on back/forward.
  `src/app/(app)/activities/` (SF-109) — the Activities list (`page.tsx`), `actions.ts`, `ActivityBox.tsx` (client: the form
  and "Schedule a follow-up?" in a box over the page), `ActivityOverlays.tsx` (opens the box or the delete confirmation from
  `?activity=` / `?followup=` / `?delete-activity=`), `NextActivities.tsx` ("// NEXT ACTIVITIES" of record pages and the
  drawer), `DoneBox.tsx`, `ActivityBits.tsx`, `ActivityDeleteConfirm.tsx`, `ActivityNotices.tsx`.
  SF-116 files: `records/FilesSection.tsx` ("// FILES" of record pages and the drawer, design A, with its notices),
  `records/AddFiles.tsx` (client: [ ADD FILE ], the PUT straight to Storage with progress), `records/FileOverlays.tsx`
  (`?file=` image preview box, `?delete-file=` confirmation), `records/FileLink.tsx` (plain `<a>`, never `next/link`),
  `records/file-actions.ts`. `src/app/(app)/files/` — `[id]/download` and `[id]/preview` routes (`file-route.ts`: check,
  then a 303 to a 60-second Storage address) and `unavailable/`. `src/app/dev/fake-storage/` — the fake Storage as the
  browser reaches it (404 unless `isFakeAllowed()` and no `SUPABASE_URL`).
  SF-115 custom fields: `src/server/custom-fields/` — `rules.ts` (pure: types, built-in names, limits, field and value
  checks `validateFieldForm` / `validateCustomValues`, `formatValue` / `listText`, `customEvent`, CSV cells `readImportCell`),
  `fields.ts` (admin: fields and choices, `countValues`; admin re-checked in each transaction), `values.ts` (record values:
  `readCustomValues` with the record's visibility in the same query, `saveCustomValues` inside the record's save, list parts
  `customListParts`, columns `customColumns`, filter options `customFilterOptions`). Values are `custom_values` rows (one per
  field and record); changes are `custom_set` / `custom_changed` / `custom_cleared` timeline events with the field name and
  values as text of the time. `list-query.ts` reads `cf<id>` filters and `sort=cf<id>` (`knownCustomQuery`).
- `src/app/(app)/admin/custom-fields/` (SF-115) — the Custom fields page (design B: a tab per kind, a table), `FieldBox.tsx`
  (client: the add / edit box), `ChoiceRows.tsx`, `FieldDeleteConfirm.tsx`, `actions.ts`. `records/MoreDetails.tsx` ("// MORE
  DETAILS" of record pages and the deal drawer), `records/CustomInputs.tsx` (the inputs of the three forms, `cf.<id>` and
  `cfShown`), `records/CustomFilters.tsx` (list filters, sort options, columns).
- `src/app/(app)/ambassadors/` — the Ambassadors page and `[id]/` the ambassador page (design B, `LatestUpdates.tsx`,
  `not-found.tsx`). `records/ReferrerPicker.tsx` (client: the "Referred by" picker of the person and deal forms) and
  `records/ReferredBy.tsx` (the "Referred by" line of the person page, deal page and drawer).
- `src/app/(app)/deals/` — the board (`Board.tsx`: native drag and drop), deal drawer and forms, `list/` (the deal
  list), `[id]/` (the deal page: `StageBar.tsx`, `LostBox.tsx`, `not-found.tsx`), `ViewSwitch.tsx` (Board / List);
  `src/app/(app)/admin/pipelines/` — the Pipelines admin pages.
- `src/server/imports/` — CSV import (SF-103): `csv.ts` (reading the file), `columns.ts` (fields, suggestions, mapping
  checks, example files), `rows.ts` (a row through `validatePerson`/`validateOrganisation`), `plan.ts` (what an import
  will do: duplicates, organisations, lists, owners, consent), `text.ts` (reasons and warnings) are pure; `imports.ts`
  (table `csv_imports`: upload in parts, columns, preview, `runImport` in one transaction locking `organisations` and
  `person_emails`, bulk inserts through `bulk.ts`: `newIds`, `inChunks`, `col`, `insertCustomValues`, shared with the
  Pipedrive import).
- `src/server/pipedrive/` — the Pipedrive import (SF-117): `crypto.ts` (`sealToken` / `openToken`: AES-256-GCM, key
  `PIPEDRIVE_TOKEN_KEY` from `pipedriveConfig()` in `env.ts`, bound to the user), `api.ts` (the six GET calls by plain
  `fetch`, token in the `x-api-token` header only, 10 s time-out, `PipedriveRefused` / `PipedriveSlowDown` /
  `PipedriveBadRequest` / `PipedriveUnreachable`, `retrySeconds`, `usePipedriveFetchForTests`), `fake-pipedrive.ts`
  (`FakePipedrive`, `fakePipedrive()` the development instance: tokens `fake-pipedrive-token` / `fake-pipedrive-other`),
  `connection.ts` (`getConnection`, `saveToken`, `removeToken`, `deleteConnection` used by `deactivate()`; `tokenFor` is
  the ONLY place a token is opened, for `imports.ts`), `rules.ts` and `page.ts` (pure: field mapping, custom types,
  consent, privacy; the plan of one page: already / linked / added / not imported), `imports.ts` (`startImport`,
  `runPart`, `continueImport`, `stopImport`, `getImportView`: the Pipedrive calls of a part come BEFORE its
  `sql.begin()`, never inside; each page transaction locks the row `for update`, checks the step and cursor, then
  `lock table organisations, person_emails, pipedrive_links in share row exclusive mode`), `report.ts` (`mergeReport`,
  `reportLines`, `namesForReport` through `visiblePerson()`). `pipedrive_links` (company + kind + Pipedrive id) is the
  "never twice" key; `pipedrive_imports` holds one run per user (one open at a time), `pipedrive_connections` one sealed
  token per user. Timeline kinds `pipedrive_imported` / `pipedrive_unsubscribed`.
- `src/app/(app)/settings/` (SF-117) — Settings (`page.tsx`, `PipedriveSection.tsx`, `RemoveTokenConfirm.tsx`,
  `actions.ts`), linked by `footerNav` in `nav.ts` at the bottom of the sidebar; `settings/pipedrive-import/` — the import
  page (`page.tsx`, `maxDuration = 60`; `ChooseStep.tsx`, `ProgressStep.tsx`, `ReportStep.tsx`, `Counts.tsx`,
  `StopConfirm.tsx`, `actions.ts`) and `ImportRunner.tsx` (client: one part, `router.refresh()`, the next part a second
  later or after Pipedrive's wait). `records/import/StepBar.tsx` takes a `steps` prop.
- `src/seed/` — fake data; `index.ts` is the seeder registry (users, people, deals, notes, activities, ambassadors,
  files, custom fields: `custom-fields.ts`). The fake Pipedrive needs no seeding.
- `migrations/` — numbered SQL files, applied by `scripts/migrate.ts`.
- `scripts/fetch-schemas.mjs` (`npm run test:schemas`, before `npm test`: pinned Google, Supabase Storage and Pipedrive
  v2 / v1 schemas).
- `tests/unit`, `tests/integration` (Vitest, real Postgres), `tests/fakes` (outside services only), `tests/fixtures/csv` (fake CSV files),
  `tests/support/reset.ts` (empties every app table; lead sources back to the six starting ones).

## Rules

- Server components by default; a client component only where the browser is needed.
- Every signed-in page calls `requireUser()`/`requireAdmin()`; every server action calls `requireUser()` or
  `assertAdminForAction()` first. Never rely on hidden links alone.
- User-facing text comes from `src/server/messages.ts`; never show text taken from a URL. Redirect
  targets go through `isSafeNext(next, appBaseUrl())`.
- Migrations: only statements allowed in a transaction; `alter table … enable row level security` after
  every `create table` (no policies). Never run migrations at app start.
- The fake Google login and fake data only work when `isFakeAllowed()` is true. Fake data uses
  clearly fake names, never the real team.
- No secrets in the repo; every setting is listed in `.env.example` and the README.

## Tests

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run typecheck
```

Each test names what it covers (`// covers FR-003, US1 scenario 2`). Fakes only for outside services
(Google Sign-In: `tests/fakes/google.ts`; Supabase Storage: `tests/fakes/storage.ts`, checked against
`storage_v0_openapi.json`; Pipedrive: `tests/fakes/pipedrive.ts` (`installFakePipedrive`), checked against
`pipedrive_v2_openapi.json` and `pipedrive_v1_openapi.yml` by `tests/fakes/pipedrive-schema.ts`; each checked against
its schema; see `.factory/test-env.md`).

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Do not enumerate, preload, or search wikis at task start. Use retrieval when the user asks for it, when unfamiliar architecture or dependency behavior materially affects the task, or when source inspection leaves an important uncertainty. Stop once the question is grounded.
- When those conditions apply and OpenWiki retrieval tools are available, use `openwiki_search` for just-in-time context and `openwiki_read` for the relevant complete sections. If search returns `workspace_required`, ask which listed workspace to use and retry with its ID.
- Use `openwiki_list_workspaces` or `openwiki_list_wikis` when workspace membership itself needs to be discovered.
- If the retrieval tools are unavailable, read `openwiki/quickstart.md` and follow its links to the relevant pages.
- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

Use the repository's documented maintenance process to refresh generated pages after source changes. Check its configuration and completed runs before relying on automatic updates. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
