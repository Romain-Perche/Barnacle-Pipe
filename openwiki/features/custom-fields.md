---
type: feature
title: Custom fields (SF-115)
description: Admin-defined fields on people, organisations and deals, their eight types, how values are saved, shown, filtered and imported, and the timeline events they raise.
tags: [custom-fields, admin, records, csv-import, timeline]
sources:
  - id: sf115-src-rules
    resource: repo://src/server/custom-fields/rules.ts
  - id: sf115-src-fields
    resource: repo://src/server/custom-fields/fields.ts
  - id: sf115-src-values
    resource: repo://src/server/custom-fields/values.ts
  - id: sf115-src-actions
    resource: repo://src/app/(app)/admin/custom-fields/actions.ts
  - id: sf115-src-migration
    resource: repo://migrations/0010_custom_fields.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T11:28:51.796Z
generated: { by: "claude-code", at: "2026-11-24T11:28:51.796Z" }
---

# Custom fields

Admins define extra fields for people, organisations or deals. Every user then fills them in on the record
forms, sees them under `// MORE DETAILS` on record pages and the deal drawer, and can filter, sort and show them
as columns in the lists. Tables are in [Database schema](../data/database-schema.md); how data moves is in
[dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md).

## Code

- `src/server/custom-fields/rules.ts` is pure: the eight types (text, long text, number, money, date, single
  choice, multiple choice, yes/no), limits (50 fields per kind, 100 choices, 8 list columns, 60-character names),
  the built-in names a custom field cannot take, field and value checks, display text and the CSV cell reader.
- `src/server/custom-fields/fields.ts` is the admin side: add, edit, move and delete fields and choices (choices
  are removed softly). Admin rights are re-checked inside each transaction.
- `src/server/custom-fields/values.ts` reads values together with the record's visibility, saves them inside the
  record's own save, and builds the list parts: columns, filter options and `sort=cf<id>`.
- `src/app/(app)/admin/custom-fields/` is the admin page (a tab per kind); `records/MoreDetails.tsx`,
  `records/CustomInputs.tsx` and `records/CustomFilters.tsx` are the shared record UI. The sidebar link is in
  `nav.ts`.

## Values and the timeline

A value is one `custom_values` row per field and record; an empty field has no row. Setting, changing or clearing
a value writes a `custom_set`, `custom_changed` or `custom_cleared` timeline event that stores the field name and
the old and new values as text of the time, so later renames do not rewrite history.

## Import and seed

The CSV import maps custom field columns and checks each cell with the field's rules (`src/server/imports/`); an
unknown part of a multiple-choice cell is skipped with a warning. `src/seed/custom-fields.ts` adds fake fields
and values.
