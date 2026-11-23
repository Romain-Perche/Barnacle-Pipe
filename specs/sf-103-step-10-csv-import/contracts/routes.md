# Contracts: CSV import routes, actions, domain functions and messages (SF-103)

`<kind>` is `people` or `organisations`; every path below exists under both `/people/import` and
`/organisations/import`. "Not found" = the shared "Page not found." page (`notFound()`).

## Pages (all call `requireUser()` first)

| Path | Step | Shows |
|---|---|---|
| `/<kind>/import` | 1 FILE | "← People", "Import people", step bar, note "A CSV file saved as UTF-8, with column headings on the first row, up to 5,000 rows.", file field, `[ DOWNLOAD EXAMPLE FILE ]`, `[ NEXT ]`. `?error=<code>` shows an allow-listed `import_*` message. `?id=<id>` (an own `ready` import, from `[ BACK ]`) shows the chosen file name and row count with `[ NEXT ]` to its columns step. |
| `/<kind>/import/[id]/columns` | 2 COLUMNS | Header with file name and row count; one row per column: heading (or "Column n"), first two values, a field `<select>` (+ Work/Personal/Other for email and phone), "Don't import"; `[ BACK ]`, `[ PREVIEW ]`; `?error=` allow-listed. |
| `/<kind>/import/[id]/preview` | 3 PREVIEW | Three counts (people/organisations to add; new organisations with names; rows not imported), people without email ("12 people have no email address and cannot be checked for duplicates."), "// ROWS NOT IMPORTED" table (Row, From the row, Reason), "// WARNINGS", "// CONSENT" (people, when `needsConsent > 0`: two unchecked radios), first 5 records as saved, `[ BACK ]`, `[ IMPORT ]`. |
| `/<kind>/import/[id]/report` | 4 REPORT | "17 people imported. 2 organisations added. 3 rows not imported.", rows not imported, warnings, link "Go to People" / "Go to Organisations". |

The import must be the viewer's own, else not found. Status rules: `columns`/`preview` need `ready` (a `done` import
redirects to `report`); `report` needs `done` (a `ready` one redirects to `preview`). No sidebar entry; the People and
Organisations lists get `[ IMPORT CSV ]` (link to `/<kind>/import`) beside their add button.

## Route handlers

| Method, path | Answer |
|---|---|
| `GET /<kind>/import/example` | `requireUser()`; `200 text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<kind>-example.csv"`, BOM + headings + two fake rows (research.md §10). |

## Server actions (`src/app/(app)/records/import/actions.ts`, each `requireUser()` first)

| Action | Input | Result |
|---|---|---|
| `startImport(kind, fileName, size)` | called by `FileStep` | purges (research.md §3), refuses `size > 5 MB` (`import_too_large`) or `size = 0` (`import_no_rows`), creates the row → `{ id }` or `{ error }` |
| `uploadPart(formData)` | `id`, `index`, `part` (Blob ≤ 512 KiB) | appends when own, `uploading`, `index = parts_received`, total ≤ `size_bytes` ≤ 5 MB → `{ ok }`; else deletes the row → `{ error: "import_upload_failed" }` |
| `finishUpload(formData)` | `id` | decodes, parses, checks (`import_not_utf8`, `import_not_csv`, `import_no_rows`, `import_too_many_rows`), suggests the mapping, `ready` → `{ next: "/<kind>/import/<id>/columns" }`; a refusal deletes the row → `{ error }` |
| `saveColumns(formData)` | `id`, `field.<index>`, `kind.<index>` | `checkMapping`; refusal → redirect `columns?error=<code>&field=<key>` (field key from the fixed list only); ok → saves `mapping`, redirect `preview` |
| `runImport(formData)` | `id`, `consent` | people with `needsConsent > 0` and no valid `consent` → redirect `preview?error=import_consent_required`; `{ status: "done" }` → redirect `report` (also when already done); failure → redirect `preview?error=import_failed`; then `revalidatePath("/people")`, `revalidatePath("/organisations")` |

`[ BACK ]` buttons are plain links: columns → `/<kind>/import?id=<id>`, preview → `/<kind>/import/<id>/columns`.

## Domain (`src/server/imports/`)

| File | Exports |
|---|---|
| `csv.ts` (pure) | `MAX_BYTES = 5 * 1024 * 1024`, `MAX_ROWS = 5000`, `PART_BYTES = 512 * 1024`, `decodeUtf8`, `detectDelimiter`, `parseCsv`, `readFile(bytes) → { ok, headings, rows: { number, values }[] } \| { ok: false, code }` |
| `columns.ts` (pure) | `PERSON_IMPORT_FIELDS`, `ORGANISATION_IMPORT_FIELDS`, `headingKey`, `suggest`, `checkMapping`, `columnLabel`, `exampleCsv(kind)` |
| `rows.ts` (pure) | `personFormFromRow`, `organisationFormFromRow`, `splitFullName`, `splitMulti`, `parseConsent`, `parseSize`, `tooLong` |
| `plan.ts` (pure) | `planPeople(rows, mapping, lookups)`, `planOrganisations(rows, mapping, lookups)`, types `ImportPlan`, `ImportReport`, `Skip`, `Warning` |
| `imports.ts` (database) | `purgeImports`, `startImport`, `uploadPart`, `finishUpload`, `getImport(viewerId, id)`, `saveColumns`, `previewImport(viewerId, id)`, `runImport(viewerId, id, consent)`, `namesForReport(viewerId, skipped)` |

Every function taking an import id checks `user_id = viewerId` in its query. `previewImport` and `runImport` load the
lookups (research.md §6) with `visiblePerson()` for the existing-person flag.

## Messages (`src/server/messages.ts`)

Fixed (`messages`):

| Code | Text |
|---|---|
| `import_note` | A CSV file saved as UTF-8, with column headings on the first row, up to 5,000 rows. |
| `import_not_csv` | Save the file as CSV (UTF-8) and try again. |
| `import_not_utf8` | Save the file as CSV (UTF-8) and try again. |
| `import_no_rows` | The file has no rows to import. |
| `import_too_large` | The file is larger than 5 MB. |
| `import_too_many_rows` | The file has more than 5,000 rows. Split it into smaller files. |
| `import_upload_failed` | The file could not be uploaded. Try again. |
| `import_person_name_column` | Choose the column with each person's name. |
| `import_organisation_name_column` | Choose the column with each organisation's name. |
| `import_consent_required` | Choose Subscribed or Unsubscribed for the people with no consent in the file. |
| `import_failed` | The import failed. Nothing was imported. Try again. |
| `import_too_many_values` | This row has more values than the file has headings. |
| `import_skip` | Don't import |

Templates (`templates`, values from the file only inside quotes):

| Code | Text |
|---|---|
| `import_one_column(field)` | Only one column can be set to `${field}`. (field label from the fixed list) |
| `import_too_long(field, max)` | Keep the `${field}` under `${max}` characters. |
| `import_consent_unknown(value)` | Consent not recognised: '`${value}`'. Use Subscribed or Unsubscribed. |
| `import_duplicate_in_file(row)` | Row `${row}` has the same email address. |
| `import_duplicate_in_file_org(row)` | Row `${row}` has the same name. |
| `import_lead_source_unknown(value, rows)` | Lead source not on the list: '`${value}`' (row 7 / rows 4, 9) |
| `import_label_unknown(value, rows)` | Label not on the list: '`${value}`' (rows …) |
| `import_owner_unknown(value, rows)` | Owner not found: '`${value}`' (rows …). You are the owner. |
| `import_size_unknown(value, rows)` | Size not recognised: '`${value}`' (rows …) |
| `import_organisation_archived(name, rows)` | `${name}` is archived. (rows …) (name from the database) |
| `import_summary_people(n, orgs, skipped)` | 17 people imported. 2 organisations added. 3 rows not imported. (singulars: "1 person", "1 organisation", "1 row") |
| `import_summary_organisations(n, skipped)` | 9 organisations imported. 1 row not imported. |
| `import_without_email(n)` | 12 people have no email address and cannot be checked for duplicates. |
| `import_needs_consent(n)` | 4 people have no consent in the file. |
| `import_rows(n)` | 20 rows |
| `imported_event(name)` | Imported from CSV by `${name}` |

Existing, reused: `duplicate_email` ("Ada Example already has this email address."), `duplicate_email_hidden`,
`organisation_exists` ("Fakeco Ltd already exists."), and the form messages of research.md §5.
`?error=` codes are looked up in an allow-list per page (`import_*` fixed codes only); templates are never reachable
from a URL.
