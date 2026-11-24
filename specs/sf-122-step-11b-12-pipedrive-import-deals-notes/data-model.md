# Data model: Pipedrive import — deals, notes, activities and files (SF-122)

One migration, `migrations/0013_pipedrive_deals.sql`. It holds only statements allowed in a transaction, and adds no
new table, so no new RLS line is needed. Every other table it writes already exists (SF-93, SF-95, SF-102, SF-109,
SF-115, SF-116, SF-117).

## Migration

```sql
-- SF-122: the Pipedrive import also brings deals, notes, activities and files (specs/sf-122-…/data-model.md).
-- Statements allowed in a transaction only. No new table. The timeline kind check is unchanged: imported deals use
-- 'pipedrive_imported', notes 'note', files 'file_added'.

alter table pipedrive_imports add column want_deals boolean not null default false;
alter table pipedrive_imports add column want_notes boolean not null default false;
alter table pipedrive_imports add column want_activities boolean not null default false;
alter table pipedrive_imports add column want_files boolean not null default false;
alter table pipedrive_imports add column deals_total int null;
alter table pipedrive_imports add column notes_total int null;
alter table pipedrive_imports add column activities_total int null;
alter table pipedrive_imports add column files_total int null;
alter table pipedrive_imports add column deals_done int not null default 0;
alter table pipedrive_imports add column notes_done int not null default 0;
alter table pipedrive_imports add column activities_done int not null default 0;
alter table pipedrive_imports add column files_done int not null default 0;
-- FR-002: deals, notes, activities and files come only with people and organisations.
alter table pipedrive_imports add constraint pipedrive_imports_records_check
  check (not (want_deals or want_notes or want_activities or want_files) or (want_people and want_organisations));
alter table pipedrive_imports drop constraint pipedrive_imports_step_check;
alter table pipedrive_imports add constraint pipedrive_imports_step_check
  check (step in ('prepare', 'count_organisations', 'count_people', 'count_deals', 'count_archived_deals', 'count_notes',
                  'count_activities', 'count_files', 'organisations', 'people', 'pipelines', 'deals', 'archived_deals',
                  'notes', 'activities', 'files', 'done'));
alter table pipedrive_imports drop constraint pipedrive_imports_pause_reason_check;
alter table pipedrive_imports add constraint pipedrive_imports_pause_reason_check
  check (pause_reason in ('unreachable', 'token_refused', 'other_company', 'files_unreachable'));

-- Links for the new kinds. A link whose CRM record was deleted keeps its row (the id goes null), as in SF-117.
alter table pipedrive_links add column deal_id bigint null references deals (id) on delete set null;
alter table pipedrive_links add column note_id bigint null references timeline_events (id) on delete set null;
alter table pipedrive_links add column activity_id bigint null references activities (id) on delete set null;
alter table pipedrive_links add column file_id bigint null references files (id) on delete set null;
alter table pipedrive_links drop constraint pipedrive_links_kind_check;
alter table pipedrive_links add constraint pipedrive_links_kind_check
  check (kind in ('person', 'organisation', 'deal', 'note', 'activity', 'file'));
alter table pipedrive_links add constraint pipedrive_links_target_check
  check ((kind = 'deal' or deal_id is null) and (kind = 'note' or note_id is null)
         and (kind = 'activity' or activity_id is null) and (kind = 'file' or file_id is null)
         and (kind in ('person', 'organisation') or how = 'imported'));
create index pipedrive_links_deal_idx on pipedrive_links (deal_id) where deal_id is not null;
create index pipedrive_links_note_idx on pipedrive_links (note_id) where note_id is not null;
create index pipedrive_links_activity_idx on pipedrive_links (activity_id) where activity_id is not null;
create index pipedrive_links_file_idx on pipedrive_links (file_id) where file_id is not null;
```

The constraint names `pipedrive_imports_step_check`, `pipedrive_imports_pause_reason_check` and
`pipedrive_links_kind_check` are Postgres's default names for the column checks of 0012. Build confirms them with
`\d pipedrive_imports` before writing the file. The SF-117 checks `kind = 'person' or person_id is null` and
`kind = 'organisation' or organisation_id is null` stay as they are.

Test support: `tests/support/reset.ts` already empties these tables. `migrate.test.ts` gains the new columns and
constraints.

## Entities

### Pipedrive import (`pipedrive_imports`): as in SF-117, plus

| Column | Meaning |
|---|---|
| `want_deals`, `want_notes`, `want_activities`, `want_files` | what was ticked; any of them → `want_people` and `want_organisations` are true (server-enforced) |
| `<kind>_total` | counted in the `count_*` steps; deals = `/deals` + `/deals/archived` |
| `<kind>_done` | records read so far (deleted Pipedrive ones excepted), the "<done> of <total>" |
| `cursor` | v2 steps: Pipedrive `next_cursor`; `notes`: v1 `start` as text; `files`: `"<start>:<index>"` (the position inside the page of 50) |
| `fetched` | Fix round 1, migration 0014: `{ step, cursor, calls }`, the Pipedrive answers a part already got before Pipedrive asked to slow down; reused by the next part of the same step and cursor, cleared when they move; never the token |
| `snapshot` | SF-117's plus `dealFields`, `pipelines`, `stages`, `activityTypes` (read in `prepare`), then `stageMap` and `pipelineNames` (written in `pipelines`) |

**Steps** (a step whose kind is not ticked is skipped by `nextStep`): `prepare` → `count_organisations` →
`count_people` → `count_deals` → `count_archived_deals` → `count_notes` → `count_activities` → `count_files` →
`organisations` → `people` → `pipelines` → `deals` → `archived_deals` → `notes` → `activities` → `files` → `done`.

**States**: unchanged (`running`, `waiting`, `paused`, `stopped`, `finished`). New pause reason `files_unreachable`
(Storage failed in a file part). Its text is the SF-116 message, with `[ CONTINUE ]`.

### Pipedrive link (`pipedrive_links`)

Primary key `(company_id, kind, pipedrive_id)` as before. The new kinds `deal`, `note`, `activity` and `file` are
always `how = 'imported'`, with the matching CRM id column. A link is written in the same transaction as its record.
A record skipped for a missing target gets **no** link, so a later import can bring it in (US5 scenario 4).

### Records written per kind

| Pipedrive | CRM rows (one transaction per page / per file) |
|---|---|
| pipeline / stage | `pipelines` (`name`, `position` = max+1) / `stages` (`pipeline_id`, `name`, `position` = max+1) |
| deal | `deals` (title, value_pence, stage_id, stage_entered_at, organisation_id, person_id, owner_id, expected_close_on, private, created_by, created_at, status, closed_at, lost_reason, archived_at), `deal_stage_periods` (one, `moved_by` = importer, `left_at` = closed_at when closed), `deal_label_links`, `deal_people` (`linked_by` = importer), `deal_followers`, `custom_values` (deal_id), `timeline_events` (`pipedrive_imported`, deal_id, actor = importer), link |
| note | `timeline_events` (kind `note`, the target column, body, actor_id = author, created_at = add_time), link. No `note_mentions` |
| activity | `activities` (type, subject, due_on, due_time, duration_minutes, note, deal_id, person_id, organisation_id, assignee_id, done_at, done_by = assignee, created_by = importer, created_at = add_time, assigned_by = assignee, assigned_at = add_time), link; then `persons.last_contacted_at` raised for done calls and meetings |
| file | (Storage object), `files` (target, name, size, kind, storage_path, added_by, added_at = add_time), `timeline_events` (`file_added`, file_id, file_name, file_size, actor_id = uploader, created_at = add_time), link; the `file_cleanup` row of its path deleted |

`newIds()` in `src/server/imports/bulk.ts` widens to `"deals" | "timeline_events" | "activities"`, so each page bulk
inserts with known ids, as SF-117 does. `insertCustomValues` widens to kind `"deals"` (column `deal_id`).

## Validation (pure, unit-tested)

- Deal: research.md §5. Refused: empty or > 200 title, stage not mapped, person or organisation not brought in. Left
  out with a warning: non-GBP value, a value that `parseMoney` refuses (negative, over `MAX_PENCE`), an invalid
  expected close date, a lost reason over 500 characters (replaced by the fixed text), a missing participant.
- Note: research.md §6. Refused: empty after conversion, > 100,000 characters, target not brought in, on a lead or
  project (counted).
- Activity: research.md §7. Refused: empty or > 200 subject, no due date, a linked record not brought in, on a lead or
  project only (counted). Left out with a warning: a note > 10,000 characters, a duration > 24 h, a duration without
  a due time.
- File: research.md §8. Refused: > 25 MB, empty, name > 255, gone (404 / 410), a linked document, target not brought
  in. Counted, not listed: on an email, a lead or a project.

## Counts and report

```ts
type KindCounts = { imported: number; linked: number; already: number; notImported: number };
type Counts = { organisations; people; deals; notes; activities; files }; // each KindCounts (linked stays 0 for the new four)

type RecordKind = "person" | "organisation" | "deal" | "note" | "activity" | "file";
type ReportItem = { kind: RecordKind; pipedriveId: number; label: string; code: string; args?: Record<string, string | number> };
// label: deal title, note start (first 60 characters of the plain text, "…" when cut), activity subject, file name

type Report = SF117Report & {
  pipelinesAdded: { name: string; stages: number }[];
  stagesAdded: { pipeline: string; stage: string }[];
  merged: { kind: "pipeline" | "stage"; a: string; b: string }[];
  notCreated: { kind: "pipeline" | "stage"; name: string }[];
  activityTypes: { type: string; name: string; records: number }[];            // imported as tasks
  elsewhere: { kind: "note" | "activity" | "file"; on: "lead" | "project" | "email"; records: number }[];
  privateDeals: number;                                                      // private deals of other owners
  privateOn: { notes: number; activities: number; files: number };            // on private records of other owners
};
```

- `readReport` / `readCounts` fill in what an older row lacks, so an SF-117 report still reads.
- `ListMiss.list` gains `"deal_label"`.
- `FieldNotImported.kind` gains `"deal"`.
- `mergeReport` sums the new parts as it already does for owners and lists.
