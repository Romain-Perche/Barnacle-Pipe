# Quickstart: validate the CSV import (SF-103)

Setup, commands and settings are in `README.md`; the test recipe is `.factory/test-env.md` (Build and the AI review
keep it up to date). Fake data only: `@fakeco.example` addresses, "Fakeco Ltd"-style names.

## Prerequisites

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run db:migrate          # applies 0006_csv_imports.sql
npm test && npm run test:e2e && npm run typecheck
```

For a manual run: `APP_ENV=development`, `npm run db:migrate && npm run db:seed && npm run dev`, sign in with the fake
Google login.

## Scenarios

| # | Do | Expect | Covers |
|---|---|---|---|
| 1 | People → `[ IMPORT CSV ]` | "Import people", step bar on "1 FILE", the note, `[ DOWNLOAD EXAMPLE FILE ]` gives `people-example.csv` with every heading and two fake rows | US1-1, FR-002 |
| 2 | Choose a file with `First name, Last name, Email, Phone, Organisation, Job title, Lead source, Labels` → `[ NEXT ]` | "2 COLUMNS"; each column with its first two values and its field chosen ("Job title" → "Role or job title") | US1-2, FR-004 |
| 3 | Set "Job title" to "Don't import" → `[ PREVIEW ]` → `[ BACK ]` → `[ PREVIEW ]` | Choices kept; first 5 people without role; People count unchanged | US1-3, FR-023 |
| 4 | 20-row file (2 emails already in the CRM, 1 invalid) → choose consent → `[ IMPORT ]` | "17 people imported. … 3 rows not imported."; reasons as the form; each person page has all values and "Imported from CSV by …" | US1-4, US1-6, US1-7, FR-019 |
| 5 | Row with "fakeco ltd" while "Fakeco Ltd" exists; two rows naming a new organisation | Linked to "Fakeco Ltd"; one new organisation owned by the importer | US1-5, FR-011 |
| 6 | Duplicate email belonging to a private person of another user | "Another person already has this email address.", no name, no link | US1-6, SC-007 |
| 7 | Organisations → import 10 rows, one name existing in another case; `fakeco.example` website; sizes "11-50", "35", "medium" | 9 added, `https://fakeco.example`, bands set, "Size not recognised: 'medium'" warning, "Fakeco Ltd already exists." | US2 |
| 8 | Lead source "referral", labels "Hot; Cold", owner email of an active user, consent "no" / empty | Matched values set; "Label not on the list: 'Cold' (row 7)"; consent as file / as chosen; `[ IMPORT ]` refused until chosen | US3, FR-007 |
| 9 | Same people as commas, semicolons, tabs; BOM file; Windows-1252 file; `.xlsx`; empty; 5 MB+; 5,001 rows | Same columns for the three; BOM not in the first heading; the fixed messages for the others, nothing imported | FR-003, edge cases |
| 10 | Press `[ IMPORT ]` twice / reload the report | Count up once; one person per email | FR-016, SC-006 |
| 11 | Make the database fail during the import (integration test: a failing statement in the transaction) | "The import failed. Nothing was imported. Try again."; no record left | FR-016 |
| 12 | `<a href=…>Click</a>` first name, `Your account is locked` lead source | Shown as text; the lead source only inside quotes in a warning | FR-018, FR-021 |
| 13 | Signed out, open `/people/import/1/preview`; post `runImport` without a session | Sign-in page; nobody added | FR-020 |
| 14 | 5,000-row file with 2,000 people in the CRM | Preview and import each < 60 s | SC-002 |

Each automated test names what it covers (`// covers FR-009, US1 scenario 6`).
