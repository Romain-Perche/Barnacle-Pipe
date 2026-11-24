# Quickstart: validating Custom fields (SF-115)

## Setup

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run db:migrate          # applies migrations/0010_custom_fields.sql
npm run db:seed             # adds the fake custom fields and values (data-model.md § Fake data)
```

## Automated checks

```bash
npm test && npm run typecheck
```

While working, run only the changed tests, e.g. `npx vitest run tests/unit/custom-fields-rules.test.ts`.

| Test file | Covers |
|---|---|
| `tests/unit/custom-fields-rules.test.ts` | names (empty, 61 chars, built-in, case/space), types, choices (none, twice, > 60), value checks per type (text 255/256, long text 10,000/10,001, number decimals/range/0, money as deal value, real dates, offered/removed choices, yes/no), `formatValue`, `listText`, `formatNumber`, `customEvent` (set/changed/cleared, long text "changed") — FR-001…FR-007, FR-009, US2-2..4 |
| `tests/unit/list-query.test.ts` (extended) | `cf<id>` parsing, `knownCustomQuery` drops unknown/hidden/invalid filters and sorts, `withParams` keeps `custom` — FR-012, US3-4 |
| `tests/unit/import-columns.test.ts`, `import-rows.test.ts`, `import-plan.test.ts` (extended) | custom targets, suggestion by name, one column each, `readImportCell` (choices, multi split, yes/no words, money, three date forms, too long), warnings with row counts — US5 |
| `tests/unit/messages.test.ts`, `nav.test.ts` (extended) | new codes and templates; "Custom fields" last in `adminNav` |
| `tests/integration/custom-fields-admin.test.ts` | add/rename/reorder/in-list/limits (50, 100, 8)/choices add-rename-move-remove-restore; non-admin refused, nothing changed — US1, FR-014 |
| `tests/integration/custom-values.test.ts` | save on people, organisations, deals; refusal keeps nothing; timeline entries with name at the time; no entry when unchanged; removed choice kept; field added while form open; deleted field ignored on save; archived refusal; money custom value leaves deal totals unchanged — US2, US4-5, Edge Cases |
| `tests/integration/custom-lists.test.ts` | columns, sorts (empty last both ways), every filter type, deal list count and total, combined with built-in filters — US3 |
| `tests/integration/custom-fields-private.test.ts` | private person/deal: not listed, matched, sorted, counted, shown on pages/forms/drawer/import for others; direct read/save refused; delete count includes hidden records, number only; hand-over keeps values — US6, SC-004 |
| `tests/integration/custom-fields-delete.test.ts` | count for shared, private, archived records; confirm deletes field and values; timeline entries kept; record delete removes its values — US4, SC-005 |
| `tests/integration/imports-custom.test.ts` | people and organisation import with custom columns, warnings, too long refusal, field deleted between preview and run — US5, SC-007 |
| `tests/integration/custom-lists-performance.test.ts` | 5,000 people, 8 shown fields, filter and sort, first page < 2 s — SC-003 |
| `tests/integration/migrate.test.ts`, `rls.test.ts`, `seed.test.ts` (extended) | 0010 applies, RLS on the 3 tables, seed re-runnable with no duplicates — FR-018 |

## Manual walk-through (fake data, `npm run dev`, fake Google login)

1. As an admin, sidebar "// Admin" → "Custom fields": tabs show counts; add the people field "Diet" (single choice:
   None, Vegetarian, Vegan); rename it, move it, tick "Show in the People list".
2. Edit a person: "// MORE DETAILS" shows the inputs; save "Vegan"; the person page shows it and the timeline says
   "Diet set to Vegan by …".
3. People list: "Diet" column and filter; choose Vegan with an Owner filter.
4. `[ DELETE ]` on "Diet": the box gives the count; cancel changes nothing; confirm shows "Diet deleted.".
5. As a non-admin: no "Custom fields" link; `/admin/custom-fields` shows the forbidden page.
