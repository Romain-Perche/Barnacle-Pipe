# Data model: CSV import (SF-103)

## Migration `migrations/0006_csv_imports.sql`

Only statements allowed in a transaction; RLS on the new table, no policy. Confirm the constraint name
`timeline_events_kind_check` on a migrated database first (it was re-created by 0003, 0004 and 0005).

```sql
-- SF-103: CSV imports of people and organisations, and the "imported" timeline event.
create table csv_imports (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  kind text not null check (kind in ('people', 'organisations')),
  file_name text not null check (char_length(file_name) between 1 and 255),
  size_bytes int not null check (size_bytes between 1 and 5242880),
  parts_received int not null default 0,
  content bytea null check (octet_length(content) <= 5242880),
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'done')),
  row_count int null,
  mapping jsonb null,
  report jsonb null,
  created_at timestamptz not null default now(),
  imported_at timestamptz null,
  check ((status = 'done') = (report is not null and imported_at is not null)),
  check (status <> 'done' or content is null)
);
alter table csv_imports enable row level security;
create index csv_imports_user_idx on csv_imports (user_id);
create index csv_imports_created_at_idx on csv_imports (created_at);

alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'imported'));
```

No change to `persons`, `organisations` or their child tables: imported records are ordinary records
(`private = false`, `created_by` = importer, `created_at` = transaction time, `last_contacted_at` null, FR-015).

Also: `tests/support/reset.ts` and `.factory/run/reset-db.sh` truncate `csv_imports`; `tests/integration/rls.test.ts`
lists it.

## Entities

### CSV import (`csv_imports`)

| Field | Meaning |
|---|---|
| `user_id` | The user who started it; the only one who can open its steps. |
| `kind` | `people` or `organisations` (deals are never imported, FR-001). |
| `file_name`, `size_bytes` | As the browser gave them; the name is shown in the header as text only. |
| `parts_received`, `content` | Upload in 512 KiB parts, appended in order (research.md §2). `null` once done. |
| `row_count` | Data rows (non-empty), set when the upload is finished; shown in the header. |
| `mapping` | `ColumnMapping` (below), suggested at `finishUpload`, replaced by `saveColumns`. |
| `report` | `ImportReport` (below), written by the import. |

**States**: `uploading` → (`finishUpload` ok) `ready` → (`runImport` ok) `done`. A refused upload, a newer import by
the same user, or age > 24 h deletes the row (`purgeImports`, research.md §3). `done` is final: a repeated import
answers with the stored report.

### Column mapping (jsonb, `ColumnMapping`)

```ts
type ColumnMapping = { columns: { index: number; heading: string; field: ImportField | "skip"; kind?: "work" | "personal" | "other" }[] };
```

`heading` is the file's heading ("" → shown as "Column <index + 1>"). `kind` only for `email` / `phone`.
Validation (`checkMapping`, research.md §4): single-value fields at most once; a name column required; unknown field
keys read as `skip`.

### Import plan (in memory, `ImportPlan`)

Built by the pure `planPeople` / `planOrganisations` for the preview and again inside the import transaction.

```ts
type RowRef = { row: number; label: string };            // spreadsheet row number, name or email from the row
type Skip = RowRef & { code: string; args?: Record<string, string | number>; personId?: number; organisationId?: number };
type Warning = { code: string; value?: string; rows: number[]; organisationId?: number };
type ImportPlan = {
  adds: PersonToAdd[] | OrganisationToAdd[];             // validated fields + resolved ids (owner, lead source, labels, org key)
  newOrganisations: string[];                             // names as first written, one per lower(btrim(name))
  skipped: Skip[];                                        // in row order
  warnings: Warning[];                                    // one per (code, value)
  withoutEmail: number;                                   // people adds with no email address
  needsConsent: number;                                   // people adds with no consent in the file
};
```

### Import report (jsonb, `ImportReport`)

```ts
type ImportReport = { imported: number; organisationsAdded: number; organisationsAddedNames: string[]; skipped: Skip[]; warnings: Warning[] };
```

Only ids for existing records (`personId`, `organisationId`); names are loaded when the page is shown, through
`visiblePerson()` for people (research.md §9).

### Timeline event: `imported`

Written instead of `added` on every person and organisation an import adds (`actor_id` = importer). Shown as
"Imported from CSV by <name>" with the date and time. Each person linked to an organisation also writes
`person_linked` on that organisation (`related_person_id` = the person), as the person form does.

## Validation rules (per row)

| Rule | Message (code) |
|---|---|
| more values than headings | `import_too_many_values` |
| no first or last name (people) | `name_required` (form) |
| invalid email / same email twice on the row | `email_invalid` / `email_twice` (form) |
| invalid phone / LinkedIn / website | `phone_invalid` / `linkedin_invalid` / `website_invalid` (form) |
| no name (organisations) | `organisation_name_required` (form) |
| first or last name > 100, role > 200, organisation name > 200, sector > 100, location > 100 | `import_too_long` (template: field, max) |
| consent value not recognised | `import_consent_unknown` (template: value) |
| email already in the CRM | `import_duplicate_email` (named if visible) or `duplicate_email_hidden` |
| email already on an earlier row | `import_duplicate_in_file` (template: earlier row) |
| organisation name already in the CRM / earlier row (organisation import) | `organisation_exists` (template: name) / `import_duplicate_in_file_org` |

Warnings (row still imported): lead source / label not on the list, owner not matched, size not recognised,
organisation archived.

## Fake data

No change to `src/seed/`: imports are made from files. Test files (fake names only, `@fakeco.example` addresses)
live in `tests/fixtures/csv/` (Build writes them): people with commas, semicolons, tabs, BOM, Windows-1252, quoted
values, an `.xlsx`, 5,000 rows.
