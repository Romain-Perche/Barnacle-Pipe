# Contract: pages, actions, domain functions, messages (SF-122)

There are no new routes. The pages and actions of SF-117 (`specs/sf-117-…/contracts/routes.md`) change as below.

## `/settings/pipedrive-import` (design B, unchanged layout: FR-022)

**Step 1 CHOOSE**
- "What to import" offers six checkboxes, all unticked, in this order: People, Organisations, Deals, Notes,
  Activities, Files.
- Under them sits the note "Pipedrive emails are not imported: they will come from Gmail.".
- The consent radios show while People is ticked (existing CSS `:has()`).
- `KindChoice.tsx` (new, **client**) is the only new client part. Ticking Deals, Notes, Activities or Files ticks People
  and Organisations and makes them unchangeable (`aria-disabled`, plus a hidden input with the value `on`, because a
  `disabled` box is not posted). Unticking all four lets the user change them again. It is rendered inside the
  server-rendered form, and without JavaScript the server still enforces the rule.
- `?error=files_unreachable` shows "Files can't be reached right now. Try again in a minute.".

**Step 2 IMPORTING**
- "// PROGRESS" has one bar and line per ticked kind, in this order: Organisations, People, Deals, Notes, Activities,
  Files ("Deals · 1,200 of 2,000").
- The paused message lists the kinds in the same order.
- Pause reason `files_unreachable` shows the `files_unreachable` message with `[ CONTINUE ]`.

**Step 3 REPORT**
- "// COUNTS" (`KindCounts.tsx`) has rows for the new kinds (Linked shows "—" for them).
- "// NOT IMPORTED" lists the deals, notes, activities and files too. The Kind column reads Deal / Note / Activity /
  File; the label is quoted data.
- A "// PIPELINES" block lists the pipelines and stages added, the merges and the names not created.
- The lines (owners, private counts, lists, fields, choices, activity types as tasks, leads / projects / emails,
  linked, unsubscribed) and the warnings.
- Links to People, Organisations, the Deals board (`/deals`) and the Activities list (`/activities`).
- Every Pipedrive value is a text node inside quotes. A CRM person or deal is named only through `visiblePerson()` /
  `visibleDeal()`.

## Server actions (all call `requireUser()` first)

| Action | Change |
|---|---|
| `startPipedriveImportAction(form)` | reads `deals`, `notes`, `activities` and `files` (`=== "on"`) and passes them to `startImport`. It still redirects only to fixed paths. New error `files_unreachable` → `?error=files_unreachable` |
| `runPipedrivePartAction`, `continuePipedriveImportAction`, `stopPipedriveImportAction` | unchanged |

## Domain functions (`src/server/pipedrive/`)

| File | New or changed |
|---|---|
| `api.ts` | the calls of contracts/pipedrive-api.md |
| `html.ts` (pure, new) | `htmlToText(html): string` (research.md §6) |
| `deal-rules.ts` (pure, new) | `dealFromPipedrive(d, ctx)`, `activityFromPipedrive(a, ctx)`, `noteFromPipedrive(n)`, `fileCheck(f)`, `ukFromUtc(date, time)`, `durationMinutes(text)`, `targetOf({ dealId, personId, orgId, leadId, projectId })`, `formatMb(bytes)`, `notePreview(text)` |
| `records-page.ts` (pure, new) | `planPipelines(pdPipelines, pdStages, crm)`, `planDealPage`, `planNotePage`, `planActivityPage`, `planFileItem`. Each returns adds, already, not imported, warnings and counters, like `page.ts` |
| `imports.ts` | `startImport(userId, { people, organisations, deals, notes, activities, files, consent })`: the four force people and organisations, and Files checks Storage. New steps, fetchers and savers. `getImportView` returns the six progress kinds and the new counts |
| `report.ts` | new report parts, `namesForReport` also loads deal titles through `visibleDeal()`, new `reportLines` and `pipelineLines` |
| `rules.ts` | `planFields` accepts kind `"deal"`, with the `label` field's options as deal label names |

Outside the folder:
- `src/server/imports/bulk.ts`: `newIds` accepts `"deals" | "timeline_events" | "activities"`, and
  `insertCustomValues` accepts kind `"deals"`.
- `src/server/files/storage.ts`: `putSigned(url, bytes, type, { timeoutMs })`, whose comment now names the import.
- `src/server/files/files.ts`: `insertFile` takes an optional `addedAt`, used for both the row and its event.

## Messages (`src/server/messages.ts`)

Fixed:

| Code | Text |
|---|---|
| `pipedrive_emails_note` | Pipedrive emails are not imported: they will come from Gmail. |
| `pipedrive_no_lost_reason` | No reason given in Pipedrive. |
| `pipedrive_lost_reason_too_long` | Lost reason too long to import from Pipedrive. |
| `pipedrive_note_empty` | Empty once its formatting is removed. |
| `pipedrive_note_too_long` | Longer than 100,000 characters. |
| `pipedrive_no_due_date` | No due date. |
| `pipedrive_file_gone` | No longer in Pipedrive. |
| `pipedrive_file_link` | A linked document, not an uploaded file. |
| `pipedrive_file_empty` | Empty file. |
| `pipedrive_stage_missing` | Its stage is not in Pipedrive any more. |
| `pipedrive_private_deal` | a private deal |
| `pipedrive_private_person` | a private person |

Reused: `files_unreachable`, the deal form's title messages, the activity form's subject messages, and the SF-116
`file_name_too_long`.

Templates (arguments that come from Pipedrive are quoted):

| Code | Text |
|---|---|
| `pipedrive_pipeline_added(name, n)` | Pipeline '<name>' added with <n> stage(s). |
| `pipedrive_stage_added(stage, pipeline)` | Stage '<stage>' added to the pipeline <pipeline>. |
| `pipedrive_pipelines_merged(a, b)` | Pipedrive pipelines '<a>' and '<b>' were imported into one pipeline. |
| `pipedrive_stages_merged(a, b)` | Pipedrive stages '<a>' and '<b>' were imported into one stage. |
| `pipedrive_name_not_created(kind, name)` | <Pipeline/Stage> name '<name>' is longer than 100 characters: not created. |
| `pipedrive_pipeline_not_created(name)` | Its pipeline '<name>' could not be created. |
| `pipedrive_person_not_imported(name)` | Its person '<name>' was not imported. |
| `pipedrive_organisation_not_imported(name)` | Its organisation '<name>' was not imported. |
| `pipedrive_deal_not_imported(title)` | Its deal '<title>' was not imported. |
| `pipedrive_target_deleted(kind)` | Its <deal/person/organisation> was deleted in the CRM. |
| `pipedrive_deal_currency(currency)` | Value in <currency>, not GBP: left out. |
| `pipedrive_participant_left_out(name)` | Linked person '<name>' was not imported: left out. |
| `pipedrive_private_deals(n)` | <n> private deal(s) of other owners imported. |
| `pipedrive_private_on(kind, n)` | <n> note(s) / activity(ies) / file(s) on private records of other owners imported. |
| `pipedrive_types_as_tasks(type, n)` | <n> '<type>' activit(y/ies) imported as tasks. |
| `pipedrive_elsewhere(kind, on, n)` | <n> note(s) / activit(y/ies) / file(s) on Pipedrive leads / projects / emails: not imported. |
| `pipedrive_file_too_large(mb)` | Over 25 MB (<mb> MB). |
| `pipedrive_duration_left_out(text)` | Duration '<text>' is not between 5 minutes and 24 hours: left out. |
| `pipedrive_progress` / `pipedrive_paused` | `PIPEDRIVE_KIND_WORDS` gains Deals, Notes, Activities, Files |

The existing `pipedrive_value_invalid` and `pipedrive_value_too_long` cover the deal's value, the expected close date
and the activity's note.
