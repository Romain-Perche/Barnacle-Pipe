# Research: Custom fields (SF-115)

Each section: Decision, Rationale, Alternatives considered. No NEEDS CLARIFICATION is left; the choices a person
should confirm are in spec.md § Clarifications ("decided by the factory, to confirm").

## 1. No new dependency

- **Decision**: nothing added. Parsing and formatting of numbers, money and dates reuse `parseMoney` / `parseDate`
  (`src/server/deals/rules.ts`), `formatMoney` (`src/server/format.ts`) and a few lines of new pure code.
- **Rationale**: every need is a small pure function; the repo has no form, table or validation library and adds none.
- **Alternatives**: a decimal library for numbers — rejected: Postgres `numeric` does the arithmetic and the comparisons,
  the app only reads and writes strings.

## 2. Storage: typed value table, not JSONB on the record

- **Decision**: `custom_fields`, `custom_field_choices`, `custom_values` (one row per field and record, one typed column
  per type, partial unique indexes per target). Data-model.md § Migration.
- **Rationale**: typed columns make filters and sorts plain SQL (`>=`, `ilike`, `@>`), keep checks in the database, delete
  with the field or the record by cascade (FR-004, Edge Cases), and give the delete confirmation an exact count with one
  `count(*)` (SC-005). The value is only reachable through its record, so privacy stays on `visiblePerson` /
  `visibleDeal` (FR-015).
- **Alternatives**: a `jsonb custom` column on `persons`, `organisations`, `deals` — rejected: deleting a field means
  rewriting every record, counts need a scan, casts in every filter, no foreign key to choices. One table per kind —
  rejected: three copies of the same code.

## 3. Multiple choice as an array of choice ids

- **Decision**: `choice_ids bigint[]` (GIN index), single choice `choice_id` with a foreign key.
- **Rationale**: choices are never deleted except with their field (removed ones keep `removed_at`), so an array cannot
  point at a missing choice; "has choice X" is `choice_ids @> array[X]`. One row per value keeps "a value is one row"
  for counts, upserts and timeline diffs.
- **Alternatives**: a `custom_value_choices` link table — rejected: more joins, more code, no gain.

## 4. Field type fixed; choices behave like labels

- **Decision**: the type is set once (spec Clarifications). Choices follow `choices.ts`: removing sets `removed_at`; a
  removed choice stays on records and in list filters and is offered on the edit form only to a record that has it;
  adding a removed choice's name brings it back; renaming to a removed choice's name is refused
  (`custom_choice_removed_exists`), as for labels (SF-95).
- **Rationale**: same behaviour the team already chose for labels (DECISIONS SF-95).

## 5. Admin page: one route, URL-driven box (design B)

- **Decision**: `/admin/custom-fields?kind=people|organisations|deals` (default `people`), `&field=new` opens the add box,
  `&field=<id>` the edit box, `&delete=<id>` the delete confirmation, `&error=<code>` / `&notice=deleted` from actions.
  The box sits over the page like the activity box (`ActivityBox.tsx` look: `.overlay` + box). Only the add/edit box is a
  client component (`FieldBox.tsx`: shows the choices textarea only for the two choice types); choice rows in the edit
  box are small server-action forms (`[ RENAME ]`, ↑ ↓, `[ REMOVE ]`, `[ ADD ]`) that redirect back to the same box.
- **Rationale**: matches design B and the repo's way of opening boxes from the address (SF-109 `ActivityOverlays`), and the
  pipelines admin's per-row forms. No client state to lose.
- **Alternatives**: one big client form posting the whole choice list — rejected: needs diffing of choice lists and
  client state; renames would be harder to keep stable ids for.
- The deleted field's name for the notice is put in the flash cookie (`flash.ts`), not the address (FR-016).

## 6. Names: unique within the kind, built-ins included

- **Decision**: `lower(btrim(name))` against the kind's other custom fields (unique index) and `BUILT_IN_NAMES[kind]`
  (data-model.md). Message `templates.custom_field_exists(name)`, the typed name trimmed (it is the user's own input on
  the same form, not text from the address).
- **Rationale**: US1-2 and Edge Cases; a field called "Owner" would be ambiguous in list columns and the import mapping.

## 7. Form wire format

- **Decision**: each custom input is named `cf.<fieldId>` (multiple choice: one `cf.<id>` per ticked box). The form also
  posts `cfShown` = the comma-joined field ids it showed. `form-data.ts` reads `custom: { shown: number[]; values:
  Record<number, string[]> }` (at most 50 fields, 100 values each, each value cut at 10,001 characters so an over-long
  value still fails the check). `PersonForm`, `OrganisationForm`, `DealForm` types gain `custom`.
- **Rationale**: a field added after the form opened is not in `cfShown` and is left alone (Edge Case "admin adds a field
  while a user has a form open"); a deleted field is simply not found (US4-5). Values typed are sent back in
  `FormState.values` on a refusal so the form keeps them (US2-2).

## 8. Validation messages name the field

- **Decision**: errors keyed `cf.<id>` with `{ code, name: field.name }`; codes are templates in `messages.ts` taking the
  name: `custom_text_too_long`, `custom_long_text_too_long`, `custom_number_invalid`, `custom_number_decimals`,
  `custom_number_range`, `custom_money_invalid`, `custom_date_invalid`, `custom_choice_invalid`. `FieldError` already
  carries `name`, and `messageFor` already calls `templates[code](name)`.
- **Rationale**: FR-007, FR-016: field names come from the database; nothing from the address.

## 9. Timeline: values stored as text at the time

- **Decision**: three kinds `custom_set`, `custom_changed`, `custom_cleared` with `field_name`, `old_value`, `new_value`
  copied as shown at save time; long text writes no values ("Notes changed"); cleared long text writes `custom_cleared`.
- **Rationale**: FR-009 and US2-7: renaming or deleting a field must not rewrite entries; storing ids would make old
  entries follow renames or vanish with the field. Entries live on the record's own timeline, so the existing
  `targetWhere` visibility covers them (and a person's / organisation's timeline shows a visible deal's entries as today).
- **Alternatives**: one "edited" event listing custom field names in `fields` — rejected: US2-4 wants old and new values.
- **Shared kind check** (person, 2026-11-24): the rewritten `timeline_events_kind_check` also lists `file_added` and
  `file_deleted`. SF-116 (Files) is planned at the same time and rewrites the same check in `0011_files.sql`, listing these
  three custom kinds too, so whichever pull request merges first, neither migration drops the other's kinds. A SQL comment
  in `0010_custom_fields.sql` says so.

## 10. List addresses for custom filters and sorts

- **Decision**: parameters `cf<id>` (text words, choice id, `empty`, `yes`, `no`), `cf<id>_from`, `cf<id>_to` (number,
  money, date), and `sort=cf<id>`. `parse*Query` collects at most 24 such raw entries (values cut to 200 characters) into
  `query.custom`; the page then calls the pure `knownCustomQuery(query, shownFields)` (in `list-query.ts`), which keeps
  only entries for a field of the kind shown in the list, with a value valid for its type (a choice id of that field,
  removed ones included; a number, money or date that parses), and drops a `sort=cf<id>` that is unknown, not shown or of a
  non-sortable type (falls back to the list's default sort). `withParams` writes `custom` entries after the built-in keys,
  sorted by key. `hasFilters` / `hasDealFilters` count `custom`.
- **Rationale**: FR-010, FR-012; same "unknown is absent" rule as `knownDealsQuery` / `knownPeopleQuery`. Text filter
  words go back only into the filter's own `<input defaultValue>`, like `q` today, never as message text.

## 11. List columns and performance (SC-003)

- **Decision**: the row query is unchanged except for the optional sort join; custom columns are read for the page's ≤ 50
  ids in one extra query over the `(field_id, <target>)` unique indexes. Filters are `exists` probes on the same
  indexes. Integration test: 5,000 fake people, 8 shown fields with values, a custom filter and a custom sort: first page
  under 2 s (as `lists-performance.test.ts`).

## 12. Filter options and privacy

- **Decision**: choice filters offer the field's offered choices plus removed choices that a record visible to the viewer
  still has (as labels in `peopleFilterOptions`), plus "Empty"; yes/no offers Yes, No, Empty. Options never come from a
  hidden record (FR-015).
- **Rationale**: the labels rule (SF-95) and FR-015: a removed choice used only by a private record hidden from the viewer
  is not offered.

## 13. Delete confirmation count

- **Decision**: `countValues(fieldId)` counts every row of the field, so private (hidden) and archived records count;
  only the number is shown, with the kind word ("3 people", "1 organisation", "2 deals"). Confirming deletes the field
  (cascade) in one statement after `for update` on its row.
- **Rationale**: FR-004, US6-2, SC-005.

## 14. CSV import

- **Decision**: mapping values `custom:<id>` (stored in `csv_imports.mapping` with `customName` = the field name at
  mapping time). `columns.ts` gets the kind's custom fields as a parameter (`fieldsFor(kind, custom)`), offers them after
  the built-in fields, and `suggest` maps a heading whose `headingKey` equals the field name's `headingKey` (checked
  before the built-in aliases, so a custom field named like an alias, e.g. "Source", wins); a custom field takes at most
  one column (`import_one_column`). `rows.ts` reads each mapped cell with the pure `readImportCell(field, cell)`:
  choices by name ignoring case (multiple: split on `,` / `;`), yes/no words, numbers, money (with or without £ and
  commas), dates `24/11/2026`, `24 Nov 2026`, `2026-11-24`; an unreadable value is left out with a warning
  `import_custom_unreadable` (field name, value, rows); text over 255 / long text over 10,000 refuses the row with the
  existing `import_too_long` (field name as `field`). `runImport` reloads the kind's fields `for share` inside its
  transaction; a mapped field gone by then is ignored and the report gets `import_custom_field_gone(name)`. Values are
  bulk-inserted after the records; the import writes only its "imported" event per record (spec Clarifications).
- **Rationale**: FR-013, US5. Same warning shape as unknown labels (code, value, rows).

## 15. Archived records

- **Decision**: the edit form of an archived record hides "// MORE DETAILS" inputs; the record page still shows the
  values. A direct save that would change a custom value of an archived record is refused with `custom_record_archived`
  ("Restore this record before changing its custom fields.") and nothing is saved (spec Clarifications; the spec's
  "cannot be edited as today" — today an archived person or deal can still be edited, so this is applied to custom
  values only, like the SF-114 rule for the Ambassador tick).

## 16. Money on deals

- **Decision**: money custom values live only in `custom_values`; board totals, deal list total and summary strips keep
  reading `deals.value_pence` only. Test asserts totals unchanged.

## Outside services

Only the app's own Postgres (Supabase in production), through the existing `postgres` client: see plan.md § Outside
services.
