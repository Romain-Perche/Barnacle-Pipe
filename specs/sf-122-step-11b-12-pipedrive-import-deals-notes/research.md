# Research: Pipedrive import — deals, notes, activities and files (SF-122)

Builds on SF-117 (`specs/sf-117-step-11a-pipedrive-import-connection-peo/research.md`): the same engine
(`src/server/pipedrive/imports.ts`), the same rules (calls outside `sql.begin()`, a page saved whole in one transaction
that also moves the cursor, `pipedrive_links` as the "never twice" key, 429 obeyed, paused after 30 seconds absent).
Only what is new is decided here.

## 1. Which Pipedrive calls

**Decision**: these calls, all `GET`, token in `x-api-token` only (contracts/pipedrive-api.md):

| Need | Call | Paging |
|---|---|---|
| pipelines | v2 `/api/v2/pipelines` | cursor, `limit=500` |
| stages | v2 `/api/v2/stages` | cursor, `limit=500` |
| deal custom fields, deal label names | v2 `/api/v2/dealFields` | cursor, `limit=500` |
| deals | v2 `/api/v2/deals` and `/api/v2/deals/archived`, `sort_by=id`, `include_fields=followers_count,participants_count` | cursor |
| followers of one deal | v2 `/api/v2/deals/{id}/followers` | cursor, `limit=500` |
| other people of one deal | v1 `/v1/deals/{id}/participants` | `start`, `limit=500` |
| activities | v2 `/api/v2/activities`, `sort_by=id` | cursor |
| activity type names | v1 `/v1/activityTypes` | none |
| notes | v1 `/v1/notes`, `sort=id ASC` | `start` / `limit` |
| files (metadata) | v1 `/v1/files`, `sort=id ASC` | `start` / `limit` |
| file contents | v1 `/v1/files/{id}/download` | none |

**Rationale**: v2 is used wherever the pinned v2 schema has the resource, as in SF-117. Notes, files, activity types,
deal participants and downloads exist only in v1. The followers and participants lists are not part of a deal answer
in either version. `include_fields=followers_count,participants_count` (declared in the v2 enum) lets the import skip
the per-deal call when there is nothing to fetch. It calls for followers only when `followers_count > 0`, and for
participants only when `participants_count` is more than the main person (`> 1` with a `person_id`, `> 0` without).

**Alternatives considered**: v1 `/v1/deals` for everything. That is the older API, and v2 is the one Pipedrive asks
integrations to move to. Reading every deal's followers through `/v1/deals/{id}`: same number of calls, more data. Not
importing followers: the spec requires them (FR-005).

## 2. The pinned v1 schema does not declare the new v1 paths

**Finding**: the v1 file pinned in SF-117 (`Zenika/zenpipe`, 53 paths) has `/notes`, `/files` and `/activityTypes`, but
not `/deals/{id}/participants` or `/files/{id}/download`. A fuller copy of Pipedrive's v1 `openapi.yaml` (178 paths,
a superset of Zenika's) is published at
`konfig-sdks/openapi-examples@161ab49c45e45825ca3832945c59a3ba904321ba/pipedrive/openapi.yaml`, with sha256
`24230787d0c71b1e528a2824e8aa6d3137db26aa57973e65f3819b1fce825665`.

**Decision**: pin that file as a third Pipedrive schema, `pipedrive_v1_full_openapi.yml`, in
`scripts/fetch-schemas.mjs`. The test wrapper checks a v1 call against the Zenika file when that file declares the
path, else against the full file. Calls that SF-117 checks therefore keep exactly the same check, and the two new
paths are checked too. No v1 path stays unchecked.

**Alternatives considered**: replacing the Zenika pin with the full file. That risks the shapes of existing answers
(`/users/me`) failing in tests that pass today, for no gain.

**Participants shape**: the full file declares a participants item as the person itself (`id` = the person). Pipedrive's
documentation shows `{ id, person_id: { value }, person, … }`. The app reads `person_id.value`, else `person_id` when it
is a number, else `id`. It works with either shape. The fake answers the declared shape.

## 3. Pages and time per part (SC-001)

**Decision**:
- Deals: 20 per part. One list call, plus at most 20 follower calls and 20 participant calls, made one after the other
  (no burst: Pipedrive's smallest plans allow about 20 calls per 2 seconds, and 429 is obeyed in any case).
- Notes: 200 per part (one call). Activities: 200 per part (one call).
- Files: 50 metadata per call. Within a part, files are copied one at a time. No new copy starts once the part has run
  15 seconds or has copied 25 MB, and the cursor keeps the position inside the page (`"<start>:<index>"`).
- Counting: 500 per call, as in SF-117.

**Rationale**: these are the spec's 3,000 people, 800 organisations, 2,000 deals, 10,000 notes, 8,000 activities and
300 files. That gives about 50 counting calls, then 38 + 100 + 50 + 40 parts, plus the file parts. At 1–5 s each plus
1 s between parts, that is about 30–35 minutes, under the 60 of SC-001. Each part stays well inside `maxDuration = 60`:
a file part is at most 15 s plus one copy of up to 20 s download and 20 s upload.

## 4. Pipelines and stages

**Decision**: a step `pipelines` after `people` and before `deals`. It makes no Pipedrive call: pipelines and stages
are read in `prepare` into the snapshot. It runs one transaction with
`lock table pipelines, stages in share row exclusive mode` and does this:
- It matches each active Pipedrive pipeline (`is_deleted` false, in `order_nr`, then `id` order) to the CRM pipeline
  with `lower(btrim(name))` equal. A missing one is created at `max(position)+1`.
- Within a matched pipeline, it matches each active stage by the same key. A missing stage is created at the end, in
  Pipedrive `order_nr` order.
- It stores `stageMap: { [pdStageId]: crmStageId | null }` and `pipelineNames` in the snapshot, with the report's
  "added" and "merged" lines.

A name of more than 100 characters, once trimmed, is not created. Its stages map to `null`, and its deals are not
imported (reason "Its pipeline '<name>' could not be created." / stage likewise). Two Pipedrive pipelines with the same
key map to one CRM pipeline and give one warning. The same goes for two stages within one pipeline. Nothing is renamed,
reordered or deleted: the step only inserts, and it uses the same tables as `src/server/deals/pipelines.ts`. It does
not call the admin functions, which check that the user is an admin. The exception is recorded in `docs/DECISIONS.md`
(spec Clarifications).

**Rationale**: creating all of them up front, empty ones included, matches the spec ("so the boards match
Pipedrive's"). The table lock and the unique indexes `pipelines_name_key` and `stages_name_key` mean two imports, or
an import and an admin, can never create the same name twice.

## 5. A deal's fields

**Decision** (pure `dealFromPipedrive` in `src/server/pipedrive/deal-rules.ts`):
- **Title**: through the deal form's rules (trimmed, 1–200). Otherwise the deal is not imported, with the form's message.
- **Value**:
  - Not GBP → left out, warning "Value in USD, not GBP: left out."
  - GBP → `parseMoney(String(value))` from `deals/rules.ts`.
  - Negative or over `MAX_PENCE` → left out, warning.
  - `0` / null → no value.
- **Expected close**: `parseDate(expected_close_date)`. Invalid → warning.
- **Date added**: `created_at` = `parseAddTime(add_time)` (else now).
- **Stage**: `stageMap[stage_id]`. Absent or null → not imported.
- **Stage time**: `stage_entered_at` = `stage_change_time ?? add_time`. One `deal_stage_periods` row with that
  `entered_at`, the CRM stage and pipeline names, and `moved_by` = the importer. For a won or lost deal, `left_at` =
  the closing time (days stop while closed, as `closeDeal` does).
- **Status**:
  - `won` → `closed_at` = `won_time ?? close_time ?? now`.
  - `lost` → `closed_at` = `lost_time ?? close_time ?? now`, and the reason through `validateLostReason`. An empty
    reason becomes "No reason given in Pipedrive.". One over 500 characters becomes "Lost reason too long to import
    from Pipedrive." with a warning.
  - else open.
- **Archived**: `/deals/archived` items (or `is_archived`) → `archived_at` = `update_time ?? now`.
- **Owner**: `ownerOf` as in SF-117 (the importer when there is no active CRM user, counted).
- **Privacy**: `visible_to = 1` → `private`, `created_by` = the CRM owner. Else shared, `created_by` = the importer.
- **Labels**: `label_ids` → names from the `label` deal field's options → `deal_labels` not removed (`lower(btrim)`).
  Unmatched names are counted once per name (`lists`, list `deal_label`).
- **Custom fields**: `planFields("deal", …)` and `readCustomValue`, unchanged rules. Inserted by `insertCustomValues`
  with target `deal_id`.
- **Person / organisation**: through their `pipedrive_links`. A missing link → not imported, "Its person '<name>' was
  not imported." / "Its organisation '<name>' was not imported." (`<name>` is the label stored in the report's
  `notImported` item for that Pipedrive id, else `#<id>`). A link whose CRM id is null → "Its person was deleted in the
  CRM." (and likewise for the organisation).
- **Participants**: the person ids of the participants call, the main person excepted, through links. A missing one
  gives the warning "Linked person '<name>' was not imported: left out." (name from the participants answer).
- **Followers**: the user ids of the followers call → `pdUsers[id].email` → an active CRM user. Others are dropped
  silently.

No `added`, `won`, `lost` or follower event: one `pipedrive_imported` event per deal (FR-008).

## 6. Notes

**Decision**:
- **Target**: `deal_id` if set, else `person_id`, else `org_id` (FR-009). If none of the three is set, the note is
  counted as on a lead (`lead_id`) or else on a project, in the `elsewhere` lines. A target with no link → not imported,
  "Its deal '<title>' was not imported." (person and organisation likewise). Never moved to another record.
- **Text**: `htmlToText` (pure, new `src/server/pipedrive/html.ts`, no dependency):
  - `<br>`, the end of `p` / `div` / `li` / `h1–h6` / `tr` → line break; `<li>` → "- ".
  - `<a href="u">t</a>` → `t`, plus ` (u)` when `u` differs from `t`; only `http(s):` and `mailto:` addresses are kept.
  - Every other tag is removed. Entities are decoded: named `amp lt gt quot apos nbsp` and numeric ones.
  - Three or more line breaks become two, and the text is trimmed.

  A Pipedrive mention is markup around "@Name", so it becomes "@Name". No `note_mentions` row is written, so nobody is
  notified and any "@[user:n]" text stays plain (notes-rules.ts shows a token only when a mention row exists).
- **Limits**: empty after conversion → "Empty once its formatting is removed."; over 100,000 characters (the column's
  limit, as the spec says) → "Longer than 100,000 characters.". See spec Clarifications for notes over the note box's
  10,000.
- **Author**: `user_id` → active CRM user by email, else the importer, counted in the owner lines. `created_at` =
  `add_time`.
- **Storage**: a `timeline_events` row of kind `note` with the target column, `body`, `actor_id` and `created_at`. It is
  editable and deletable like any note (SF-102).

## 7. Activities

**Decision** (pure `activityFromPipedrive`):
- **Type**: `call` / `meeting` / `task` as given. Anything else → `task`, counted per Pipedrive `type` key, named by the
  `/v1/activityTypes` name when known.
- **Subject**: through the activity form's rules (1–200). Otherwise not imported.
- **Due date and time**: no `due_date` → not imported. With `due_time` (UTC "HH:MM"): the UTC instant is converted to
  Europe/London date and time with `Intl.DateTimeFormat`. That can move the date across midnight; `ukInstant`
  round-trips it. Without a time, the date stays as given.
- **Duration**: "HH:MM" → minutes, rounded up to the next 5.
  - 0 or empty → none.
  - Over 1,440, or no due time (DB check) → left out, with a warning.
- **Note**: `htmlToText`. Over 10,000 → left out, with a warning.
- **Assignee**: `owner_id` (Pipedrive's assignee) → an active CRM user, else the importer, counted.
  `created_by` = the importer. `assigned_by` = the assignee itself, so the notification rule
  (`assignee_id <> assigned_by`) never fires (FR-013).
- **Done**: `done_at` = `marked_as_done_time ?? update_time ?? now`, and `done_by` = the assignee. After inserting, one
  bulk update raises `persons.last_contacted_at` by the SF-109 rule: `greatest(current, least(ukInstant(due), done_at))`,
  for calls and meetings with a person.
- **Links**: deal, person and organisation through links. Any of them set in Pipedrive but not brought in → the
  activity is not imported, with the reason. With none set, but a `lead_id` / `project_id` → counted in `elsewhere`.
  With nothing at all → imported unlinked.

## 8. Files: copying without half-stored files

**Decision**: per file, outside any transaction:
1. Eligibility from the metadata:
   - `active_flag` false → passed over silently (deleted).
   - `mail_message_id` set → counted in the email line (FR-020).
   - `remote_location` set → "A linked document, not an uploaded file.".
   - No deal / person / org → counted as on a lead (`lead_id`) or else elsewhere.
   - `file_size` 0 → "Empty file."; over `MAX_FILE_BYTES` → "Over 25 MB (26.1 MB)." (size in MB to one decimal,
     1 MB = 1,048,576 bytes).
   - Name over 255 → the SF-116 message.
   - Target not brought in → reason as for notes.
   - Already linked → already.
2. Download `/v1/files/{id}/download` with `redirect: "manual"`. On a 3xx, fetch the `Location` once, **without** the
   token header. Pipedrive serves files from its own storage hosts, and the token must never go there. 404 / 410 →
   "No longer in Pipedrive.". The body is read with a 25 MB + 1 byte cap (over → the size reason, nothing stored).
   20-second timeout.
3. `path = newStoragePath()`, then `insert into file_cleanup (storage_path, due_at) values (path, now() + interval
   '1 hour')` (committed). Then `createSignedUploadUrl(path)` and `putSigned(url, bytes, uploadContentType(name),
   { timeoutMs: 20_000 })`. Any failure → `StorageUnreachable` → the import pauses with `files_unreachable`.
4. One `sql.begin()`:
   - Lock the import row and check that the step, cursor and state are unchanged.
   - Lock `pipedrive_links` (`share row exclusive`), then re-check that the link is absent and that the target still
     exists.
   - Insert `files` (`added_at` = `add_time`, `added_by` = the uploader matched, `kind` from `fileKind` with the first
     16 bytes), the `file_added` timeline event (same `created_at`) and the link.
   - `delete from file_cleanup where storage_path = path`, then move the cursor past the file.

   A stale or duplicate file leaves the path in `file_cleanup` with `due_at = now()`.
5. `sweepFileCleanup()` at the end of the part.

**Rationale**: SF-116 forbids Storage calls inside a transaction. Queueing the path for clean-up before the upload
means a crash, a time-out or a lost race always ends with the object removed. The file is listed only in the same
commit that removes it from the queue. Nothing is half-stored, and nothing is listed without its contents (FR-015,
FR-017).

**Start check (FR-003)**: when Files is ticked, `startImport` refuses with `files_unreachable` if `storageConfig()`
is `off`. It also refuses if `objectInfo("files/pipedrive-import-check")` throws `StorageUnreachable` (a 404 / null
answer means reachable).

## 9. Visibility in the report (FR-021, SC-005)

**Decision**: report items keep CRM ids only (deal id, person id); names are loaded at display time:
- people through `visiblePerson()`, as in SF-117;
- deals through `visibleDeal()`. A hidden one → "a private deal".

The "private … of other owners" counts are worked out inside the page transaction. For deals: private and the owner is
not the importer. For notes, activities and files: the target deal or person is private, and neither its creator nor
its owner is the importer. Pipedrive labels (titles, subjects, note starts, file names) of records **not** imported are
Pipedrive data shown quoted, as in SF-117.

## 10. Progress, steps and state

**Decision**:
- **New columns** on `pipedrive_imports`: `want_deals`, `want_notes`, `want_activities`, `want_files`, and
  `<kind>_total` / `<kind>_done` for deals, notes, activities and files (data-model.md).
- **Steps in order**: `prepare`, `count_organisations`, `count_people`, `count_deals`, `count_archived_deals`,
  `count_notes`, `count_activities`, `count_files`, `organisations`, `people`, `pipelines`, `deals`, `archived_deals`,
  `notes`, `activities`, `files`, `done`.
- **Pause reason**: new `files_unreachable`.
- **`prepare`** also reads users, deal fields, pipelines and stages when Deals is ticked, and activity types when
  Activities is ticked. That is at most 7 calls, the one exception to "≤ 2 calls a part", as in SF-117.
- **FR-002**: `startImport` sets `people = organisations = true` whenever one of the four is ticked, so the server
  enforces it and the existing `check (not want_people or consent is not null)` keeps the consent required.

## 11. Dependencies

**Decision**: none added. The HTML → text conversion is about 40 lines and the set of tags is known. A library such
as `html-to-text` would be a runtime dependency for one function. `yaml` (already a devDependency) reads the new pinned
v1 file.

## 12. Outside services searched

- Pipedrive v2: the SF-117 pin (`soenneker/soenneker.pipedrive.openapiclient@77695f9…`) declares `/deals`,
  `/deals/archived`, `/deals/{id}/followers`, `/dealFields`, `/pipelines`, `/stages` and `/activities`, with the
  fields used (checked with a script on the pinned file).
- Pipedrive v1:
  - The Zenika pin declares `/notes`, `/files` and `/activityTypes` with the fields used.
  - The new full pin declares `/deals/{id}/participants` and `/files/{id}/download`.
  - GitHub's `pipedrive` organisation still publishes no spec (only generated clients, as found in SF-117).
  - `Budibase/openapi-rest-templates` has a 60-path copy without the two paths.
- Supabase Storage: the SF-116 pin (`storage_v0_openapi.json`) declares the sign-upload, upload, info and delete
  routes already used.
