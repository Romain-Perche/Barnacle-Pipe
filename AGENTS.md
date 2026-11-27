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
  SF-123 reminders: `rules.ts` `reminderAt` (15 min before; 09:00 UK untimed) / `dueMoment` / `reminderFor(due, now)`; columns
  `remind_at` / `reminder_read_at` on the activity row, set by schedule, edit (new due or assignee: new unread one) and untick
  (none after the due moment); `scheduleActivity` / `editActivity` / `untickActivity` take `now` last. `notifications.ts`:
  reminders are the third kind (`r-<id>`), for the assignee (themselves included) from `remind_at` while planned, through
  `myReminders` (`visibleActivity()`); its functions take `now` last. In the app only, no email.
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
  SF-126: `records/OpenOnDoubleClick.tsx` (client, renders nothing: one `dblclick` listener; cards and rows carry `data-page`) and `src/server/records/double-click.ts` (pure `pageToOpen`).
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
- `src/server/campaigns/` — campaign drafts (SF-119), shared by the whole team (no visibility rule): `merge.ts` (pure and
  client-safe: the tag grammar `{{<name> | <if empty>}}`, the 11 built-in merge fields then people custom fields `cf:<id>`,
  `resolveTag` link → built-in → custom → unknown, `rewriteNames` (custom field tags follow renames through `merge_links`),
  `unknownTags`, `linksToStore`, `fillText` / `fillHtml` / `blockFill` with values HTML-escaped), `content.ts` (pure and
  client-safe: blocks, `LAYOUTS`, `validateContent`, `blocksToHtml`, `frameDocument`: the preview's CSP and `<base
  target="_blank">` first), `rules.ts` (pure and client-safe: limits in code points, `validateDraft`, `stillEmpty`,
  `copyName`), `campaigns.ts` (list, open with renamed tags, create, save with the version check, duplicate, delete),
  `preview.ts` (the picker search and a person's merge values, through `visiblePerson` / `getPerson`, never archived).
  The pure files never import `@/server/db` or anything server-only: the editor imports them.
- `src/app/(app)/campaigns/` (SF-119) — the Campaigns page (`page.tsx`, design A table, `?new=1` `NewCampaignBox.tsx`,
  `?delete=<id>` `CampaignDeleteConfirm.tsx`), `[id]/` the edit page (`?delete=1`, `not-found.tsx`), `actions.ts`, and the
  client parts: `CampaignEditor.tsx` (details, content, the live preview's filling), `BlockList.tsx`, `MergeTagMenu.tsx`,
  `PreviewPersonPicker.tsx`, `CampaignPreview.tsx` (the email only inside `<iframe sandbox="allow-popups
  allow-popups-to-escape-sandbox" srcDoc>`; never `dangerouslySetInnerHTML`). `next.config.ts` raises the server action
  body limit to 4 MB for pasted HTML.
- `src/server/segments/` (SF-120) — saved segments, shared by the whole team: `rules.ts` (pure: `Condition` / `Definition` /
  `Reach` types, `readSegmentForm`, `validateSegmentForm` (ids kept only when among the form options), `readConditions`,
  `describeSegment` (summary, // WHO and // CONDITIONS lines, "(deleted)", `broken`), `formToValues`), `reach.ts` (`reachWhere` on
  `persons p` with `visiblePerson` and the deals through `visibleDeal`, archived deals never; `countReach`: one query, left out
  archived → unsubscribed → no email; `reachedPeople`: person and first email, for the later campaign issue), `segments.ts`
  (`listSegments`, `getSegment`, `segmentFormOptions`, `createSegment` / `updateSegment` (version check) / `deleteSegment`,
  `countDefinition`). Table `segments` (conditions as jsonb, no foreign keys to things that can be deleted). Counts are worked
  out at each read, never stored. `customProbe` in `custom-fields/values.ts` is the custom value test shared by the People
  list filters and the segment reach.
- `src/app/(app)/segments/` (SF-120) — the Segments table (`page.tsx`), `[id]/` the segment page (count strip, // WHO,
  // CONDITIONS, `?confirm=delete` → `SegmentDeleteConfirm.tsx`), `new/` and `[id]/edit/` (the form on its own page),
  `SegmentForm.tsx` (client: who, condition rows, [ COUNT AGAIN ]), `MultiPicker.tsx` (client: filtering multi-select with
  chips), `ReachBlock.tsx`, `actions.ts`.
- `src/server/imports/` — CSV import (SF-103): `csv.ts` (reading the file), `columns.ts` (fields, suggestions, mapping
  checks, example files), `rows.ts` (a row through `validatePerson`/`validateOrganisation`), `plan.ts` (what an import
  will do: duplicates, organisations, lists, owners, consent), `text.ts` (reasons and warnings) are pure; `imports.ts`
  (table `csv_imports`: upload in parts, columns, preview, `runImport` in one transaction locking `organisations` and
  `person_emails`, bulk inserts through `bulk.ts`: `newIds`, `inChunks`, `col`, `insertCustomValues`, shared with the
  Pipedrive import).
- `src/server/crypto/seal.ts` — the one sealing of saved tokens of outside services (SF-117, shared since SF-118):
  `sealToken(key, purpose, userId, token)` / `openToken(…)`, `TokenUnreadable`; AES-256-GCM, version 1 ‖ IV ‖ tag ‖
  cipher, additional data `"<purpose>:<userId>"` (purposes `pipedrive-token`, `gmail-token`); one key per service
  (`PIPEDRIVE_TOKEN_KEY`, `GMAIL_TOKEN_KEY`), each decoded by `readTokenKey()` in `env.ts`.
- `src/server/pipedrive/` — the Pipedrive import (SF-117): tokens sealed by `crypto/seal.ts` with
  `PIPEDRIVE_TOKEN_KEY` from `pipedriveConfig()` in `env.ts`, bound to the user; `api.ts` (the six GET calls by plain
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
  token per user. Timeline kinds `pipedrive_imported` / `pipedrive_unsubscribed`. Imported planned activities get `remind_at` (SF-123)
  only while their reminder time is still to come: an import shows no reminder at once.
  SF-122 deals, notes, activities and files: `html.ts` (pure `htmlToText`: note HTML → plain text), `deal-rules.ts` (pure:
  `dealFromPipedrive`, `activityFromPipedrive`, `noteFromPipedrive`, `fileCheck`, `targetOf` deal > person > organisation,
  `ukFromUtc`, `durationMinutes`, `formatMb`, `notePreview`), `records-page.ts` (pure: `planPipelines`, `planDealPage`,
  `planNotePage`, `planActivityPage`, `planFileItem`). Steps after `people`: `pipelines` (read, then matched or created in
  one transaction holding `pipelines, stages`; inserts only, by any user), `deals` / `archived_deals` (20 a part;
  followers and participants read one after the other before the transaction), `notes`, `activities` (200 a part), `files`
  (one copy at a time, cursor `"<start>:<index>"`, no new copy after 15 s or 25 MB). The file copy rule: download → the path
  queued in `file_cleanup` (committed) → Storage upload → one transaction lists the file and deletes its `file_cleanup`
  row; a stale or duplicate copy leaves its path due now. A download redirect (Pipedrive's file host) is followed once
  WITHOUT the token. `pipedrive_links` also covers kinds deal, note, activity and file (always `how = 'imported'`, ids
  `deal_id` / `note_id` / `activity_id` / `file_id`); a record skipped for a missing target gets no link. An import notifies
  nobody (no `note_mentions`; an activity's `assigned_by` is its assignee). `onSaveForTests` (tests only) hooks every import
  transaction. A part keeps the Pipedrive answers it already got across a slow-down (`pipedrive_imports.fetched`, with its
  step and cursor; cleared when they move), and every save re-checks under lock that the user is active and still holds
  the token (`lockRow`; else paused, nothing saved). A record private to another owner, or put on a record the importer
  cannot see, is never named in the report (`privateItem`: empty label, `args.privateKind`, shown "a private …").
- `src/server/gmail/` — Gmail connect and sync (SF-118; SF-127: `attachmentParts` / `attachmentName` in `rules.ts`, `getAttachment`
  in `google-api.ts`, the fake's attachment bytes and `deleteMessage`); settings from `gmailConfig()` in `env.ts` (real / fake / off).
  `rules.ts` (pure: `GMAIL_SCOPES` = `gmail.modify` + `gmail.send`, `hasAllScopes`, `parseAddressList`, `decodeHeader`,
  `readMessage`, `decideCopy`, `classifyGoogleError`, `buildMime` (`BadHeader` on CR/LF), `testEmail`), `google-api.ts`
  (every Google call by plain `fetch`, 10 s: consent address, token, revoke, certs, Gmail; `GoogleKeyRefused` /
  `GoogleUnavailable` / `HistoryGone`; `useGmailFetchForTests`), `push.ts` (`verifyPushToken`: Google's OIDC token with
  node:crypto, keys cached by max-age; `receiveGmailPush`), `connections.ts` (`gmailSettings`, `gmailNeedsReconnect`,
  `connectFromCallback`, `finishConnect`, `disconnect`, `forgetGmailInTx` + `afterGmailForgotten` used by
  `users.deactivate`, `markNeedsReconnect`; `loadKey` is the ONLY reader of `token_cipher`), `sync.ts` (`syncConnection`:
  a lease column, history since `history_id` or a listing when it is gone, at most 300 `messages.get` per run, one
  `sql.begin()` per stored message; `renewWatch`; `runGmailCheck` the 15-minute job), `send.ts` (`sendGmail`, the one
  way to send: `GmailNotConnected` / `GmailNeedsReconnect` / `GmailUnavailable`), `fake-gmail.ts` (`FakeGoogleMail`,
  `fakeGmail()`: `MemoryStore` in tests, `.fake-gmail/state.json` in development). No Google call inside `sql.begin()`.
  Tables `gmail_connections` (one per user, kept after disconnect), `email_threads`, `email_messages`, `email_attachments`
  (names and sizes only).
- `src/app/(app)/settings/` (SF-117) — Settings (`page.tsx`, `PipedriveSection.tsx`, `RemoveTokenConfirm.tsx`,
  `actions.ts`; SF-118: `GmailCard.tsx`, `GmailDisconnectConfirm.tsx`, the actions `startGmailConnect`, `disconnectGmail`,
  `sendTestEmail`, and `gmail/callback/route.ts`), linked by `footerNav` in `nav.ts` at the bottom of the sidebar (SF-118:
  `SettingsLink` in `UnreadLink.tsx` shows the orange "!" while Gmail needs reconnecting; `currentSidebar()` in
  `notifications/actions.ts` refreshes it with the unread count); `settings/pipedrive-import/` — the import
  page (`page.tsx`, `maxDuration = 60`; `ChooseStep.tsx`, `ProgressStep.tsx`, `ReportStep.tsx`, `Counts.tsx`,
  `StopConfirm.tsx`, `actions.ts`, SF-122 `KindChoice.tsx`: client, the six checkboxes, Deals / Notes / Activities / Files
  tick and lock People and Organisations) and `ImportRunner.tsx` (client: one part, `router.refresh()`, the next part a second
  later or after Pipedrive's wait). `records/import/StepBar.tsx` takes a `steps` prop.
- `src/app/gmail/push/route.ts` (Pub/Sub push, Google's token) and `src/app/cron/gmail/route.ts` (the 15-minute check,
  `CRON_SECRET`), scheduled by `vercel.json` (SF-118); `src/app/dev/fake-google/gmail` (the fake consent screen; its buttons post a plain form to `answer/route.ts`, a 303 to the callback) and
  `src/app/dev/fake-gmail` (the fake mailbox page), 404 unless the Gmail mode is `fake`.
- `src/server/emails/` — email on the timeline (SF-127), on SF-118's copied emails: `rules.ts` (pure: `emailText` (text part, else
  the HTML through `pipedrive/html.ts` `htmlToText`), `emailPreview` (200 code points), `recipientsLine`, `addressText`,
  `subjectOrDefault`, `parseFrom` / `fromParam` (`?from=person-12`), `parseLinkKind`, `mergeLinkChoice`, `contentDisposition`),
  `process.ts` (`processMessage(db, id)`: inside `storeMessage`'s transaction, `lock table email_conversations`, Last contacted
  raised (never lowered), the conversation across mailboxes by Message-ID (two found to be one are merged into the smaller id),
  its addresses, `autoLink`; `autoLink` (people by address, their organisation, their one open deal; only `insert … on
  conflict do nothing`, so a hand choice is never changed); `linkForPeople` (called by `createPerson`, `updatePerson` for the
  addresses a save added, CSV `runImport` and the Pipedrive people page); `catchUpEmails` (emails with `linked_at` null, first
  thing of `runGmailCheck`)), `timeline.ts` (`timelineEmails`: EMAIL entries merged by `selectEntries` like done activities,
  one per email: the sender's copy, else the first stored, by `dedupe_key`), `conversations.ts` (`getConversation`,
  `fromRecordName`, `linkChoices`, `linkRecord` / `unlinkRecord`), `attachments.ts` (`attachmentAccess`, `fetchAttachment`:
  `getMessage` → `attachmentParts(payload)[position]` → `body.data` or `getAttachment`, through a working mailbox holding the
  email, its own first; no Google call inside `sql.begin()`). `visibleConversation()` in `records/visibility.ts`: every read of
  the email tables for a viewer uses it (a person in its emails or a linked person or deal the viewer cannot see hides it).
  Tables `email_conversations`, `email_conversation_addresses`, `email_links` (`how` auto / manual, `removed` = unlinked by
  hand); columns `email_threads.conversation_id`, `email_messages.linked_at` / `dedupe_key`. No email HTML is ever rendered.
- `src/app/(app)/emails/` (SF-127) — the conversation page `[id]/page.tsx` (design B: `← <RECORD>`, // LINKED TO
  `LinkedTo.tsx` with `?link=deal|person|organisation` forms, // EMAILS · OLDEST FIRST `EmailBody.tsx` as plain text,
  `?notice=` fixed texts, `not-found.tsx`), `actions.ts` (`linkRecord`, `unlinkRecord`) and
  `attachments/[id]/download/route.ts` (the bytes from Gmail as `application/octet-stream` + `Content-Disposition: attachment`,
  or a 303 back with `?notice=attachment-unavailable`). `records/EmailEntry.tsx`: the EMAIL entry of `RecordTimeline`;
  `records/TimelineNoteBox.tsx`: the note box, first in the right column. The person, organisation and deal pages have two
  columns (`.recordcols`: details left; note box, // NEXT ACTIVITIES, // FILES, // TIMELINE right); the deal drawer has one.
- SF-128 fetch past emails: `src/server/gmail/past.ts` (`startPastFetch`: one transaction holding the connection row and a
  conditional upsert, never two at once; `runPastFetchPart`: a lease column, the 12-month window walked backwards in 7-day
  slices with `threads.list`, each thread read as metadata and decided by the pure `planPastThread` in `rules.ts`, each new
  message stored by `sync.ts` `storeMessage(…, { fetchId })`, which adds 1 to the fetch's `copied` in the same transaction
  when it creates the conversation; the cursor saved after every thread; `runPastFetchPartFor` the Settings page's part
  (`PastFetchRunner.tsx`), `runPastFetches` the 15-minute check's, after its connections; `GmailSlowDown` → `wait_until`),
  `fake-past-mailbox.ts` (`putPastMailbox`: the 100 conversations of the tests and `/dev/fake-gmail`). Table
  `past_email_fetches` (one per connection: running or ended; deleted by `forgetGmailInTx`). No Google call inside `sql.begin()`.
- `src/server/calendar/` — Google Calendar two-way sync (SF-124), on SF-118's connection, key and Google helpers (`call`,
  `readJson`, `settings`, `refreshAccessToken`, `loadKey`); settings from `calendarConfig()` in `env.ts` (`CALENDAR_SYNC=on`
  and Gmail set up). `rules.ts` (pure: `eventBody` / `googleEventBody`, `bodyHash`, `eventTimes`, `fromEvent`, `subjectFromTitle`,
  `merge` (three-way, the later change wins), `decideIncoming`, `classifyCalendarError`, `newEventId`), `calendar-api.ts`
  (events insert/patch/delete/list/watch and channels.stop by plain `fetch`, `sendUpdates=none`, never attendees;
  `CalendarRefused(kind)`), `fake-calendar.ts` (the fake Calendar inside `FakeGoogleMail`: events, sync tokens, channels,
  notices, unreachable), `sync.ts` (`syncCalendar`: a calendar lease, pull (sync token, 410 → listing) then push, a
  reconcile of `calendar_events` against the activities: no outbox; `renewCalendarChannel`, `runCalendarCheck` called by
  `runGmailCheck`, `calendarAfterChange`, `calendarAfterVisibilityChange` after person / deal saves and hand-overs; a
  reassigned activity's link on a connection that is not syncing is detached (activity_id null), never deleted, so its
  event is removed when that connection syncs again; `beforeMergeForTests` tests only; a move from Google and a meeting from Google set SF-123's `remind_at` through `reminderFor`, as CRM edits do), `push.ts` (`receiveCalendarPush`: channel id + token sha256 + resource id),
  `soon.ts` (`runAfterResponse`: `after()` from `next/server`; activity actions and record deletes use it, so saving never
  waits on Google). No Google call inside `sql.begin()`. Table `calendar_events` (one link per activity: origin `crm` /
  `google`, state `creating` / `synced` / `ended`, the agreed `base`); calendar columns on `gmail_connections`;
  `activities.updated_at`. A connection's Calendar state (`syncing` / `missing`) is derived from its `scopes`;
  `settingsWarning()` gives the sidebar "!". Routes: `src/app/calendar/push/route.ts` (public, `maxDuration = 60`) and
  `src/app/dev/fake-calendar/` (the fake calendar page, 404 unless fake Gmail and Calendar on).
- `src/seed/` — fake data; `index.ts` is the seeder registry (users, people, deals, gmail (SF-118: Ada Fake's fake Gmail
  connection and three conversations), notes, activities, calendar (SF-124: Ada Fake's fake calendar and one meeting
  from Google: `calendar.ts`), ambassadors, files, custom fields: `custom-fields.ts`,
  campaigns: `campaigns.ts`, segments: `segments.ts`). The fake Pipedrive needs no seeding.
- `migrations/` — numbered SQL files, applied by `scripts/migrate.ts`.
- `scripts/fetch-schemas.mjs` (`npm run test:schemas`, before `npm test`: pinned Google, Supabase Storage, Pipedrive
  v2 / v1 (plus the full Pipedrive v1 copy `pipedrive_v1_full_openapi.yml`), Gmail, Pub/Sub and Google Calendar schemas).
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
`storage_v0_openapi.json`; Gmail, Pub/Sub and Google Calendar: `tests/fakes/gmail.ts`, checked against `gmail-api.json`,
`pubsub-api.json` and `calendar-api.json`; `vitest.config.ts` sets a test `GMAIL_TOKEN_KEY` and `CALENDAR_SYNC=on`; Pipedrive: `tests/fakes/pipedrive.ts` (`installFakePipedrive`), checked against
`pipedrive_v2_openapi.json` and `pipedrive_v1_openapi.yml` (a v1 path that file lacks: `pipedrive_v1_full_openapi.yml`;
downloads checked for their content type only; the fake file host refuses the token) by `tests/fakes/pipedrive-schema.ts`; each checked against
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
