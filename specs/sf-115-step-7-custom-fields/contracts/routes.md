# Contracts: pages, actions, domain functions, messages (SF-115)

Everything is server-rendered unless marked client. Every page calls `requireUser()` (admin pages `requireAdmin()`);
every action calls `requireUser()` or `assertAdminForAction()` first; every domain function re-checks admin rights or
record visibility inside its own transaction. Nothing from the page address is shown as text (FR-016): query values are
parsed to ids, fixed words or numbers and only select among options; text filter words go back only into their own input.

## Pages

| Route | File | Shows |
|---|---|---|
| `/admin/custom-fields` | `src/app/(app)/admin/custom-fields/page.tsx` (new, `requireAdmin()`) | Design B. Head: `// ADMIN` label, h1 "Custom fields", `[ ADD FIELD ]` → `?kind=<tab>&field=new`. Tabs "People · n", "Organisations · n", "Deals · n" (links `?kind=…`, current one marked). Table: Order (↑ ↓ forms, disabled at the ends), Name, Type (`TYPE_LABELS`), Choices (offered names joined ", ", or "—"), In list (Yes/No), `[ EDIT ]` → `&field=<id>`, `[ DELETE ]` → `&delete=<id>`. Empty tab: `messages.custom_fields_empty`. Error line from `?error=<code>` (known codes only, `messageFor`). Flash notice after a delete. |
| same, `field=new` | `FieldBox.tsx` (client) in an overlay | "ADD <KIND> FIELD": Name, Type (8 options, `TYPE_LABELS`), "Choices, one per line" textarea (only shown for the two choice types), ☐ "Show in the <Kind> list", `[ SAVE ]`, `[ CANCEL ]` → tab. Errors under each input; typed values kept (`useActionState`, `FormState`). |
| same, `field=<id>` | `FieldBox.tsx` + `ChoiceRows.tsx` (server) | "EDIT <KIND> FIELD <name>": Name, Type as text + " (can't be changed)", no type input; for choice fields the offered choices with ↑ ↓, a name input + `[ RENAME ]`, `[ REMOVE ]`, and "New choice" + `[ ADD ]` (each its own form, back to the same box); ☐ "Show in the <Kind> list"; `[ SAVE ]`, `[ CANCEL ]`. Unknown id / other kind: no box. |
| same, `delete=<id>` | `FieldDeleteConfirm.tsx` (server) | Box: `templates.custom_delete_count(n, kind, name)` or `templates.custom_delete_none(name)`, `[ DELETE FIELD ]` (form), `[ CANCEL ]` → tab. |
| `/people/[id]`, `/organisations/[id]`, `/deals/[id]`, deal drawer | `records/MoreDetails.tsx` (new, server) used by each | `// MORE DETAILS` below `// DETAILS`, same two-column `dl` look; every field of the kind in order, value text or "—"; long text `white-space: pre-wrap`. Not rendered when the kind has no field. |
| `/people/new`, `/people/[id]/edit`, organisations, deals | `records/CustomInputs.tsx` (new, client-safe, no state) used by `PersonForm`, `OrganisationForm`, `DealForm` | `// MORE DETAILS` heading after the built-in fields; one input per field (data-model.md § Custom value), named `cf.<id>`, error under it (`FieldError` key `cf.<id>`), plus hidden `cfShown`. Not rendered on an archived record's edit form, nor when the kind has no field. |
| `/people`, `/organisations`, `/deals/list` | changed | Columns for shown fields after the built-in ones (header a sort link when sortable); filter row gets one control per shown field (`records/CustomFilters.tsx`, server): text input "Diet contains"; from/to inputs; select "Any <name>" + choices (+ "Empty"); yes/no select. The deal list's count and total follow. |
| `/people/import`, `/organisations/import` columns, preview and report steps | changed | Custom fields as targets after the built-in fields (group label "Custom fields"); preview shows the values; warnings and the "field gone" line in the report. |
| Sidebar | `nav.ts` | `{ href: "/admin/custom-fields", label: "Custom fields" }` last in `adminNav`. |

### Query parameters

| Page | Param | Parse | Meaning |
|---|---|---|---|
| `/admin/custom-fields` | `kind` | `people` / `organisations` / `deals`, else `people` | tab |
| | `field` | `new` or `parseId` | add / edit box |
| | `delete` | `parseId` | delete confirmation |
| | `error` | one of the known `custom_*` codes, else ignored | message |
| `/people`, `/organisations`, `/deals/list` | `cf<id>` | raw ≤ 200 chars → `knownCustomQuery` | text words, choice id, `empty`, `yes`, `no` |
| | `cf<id>_from`, `cf<id>_to` | → `knownCustomQuery` | number / money / date range |
| | `sort=cf<id>` | → `knownCustomQuery` | sort by a sortable shown field |

## Server actions

`src/app/(app)/admin/custom-fields/actions.ts` (new; `assertAdminForAction()` first; redirect back to
`/admin/custom-fields?kind=<tab>` with `&field=<id>` for choice changes and `&error=<code>` on a refusal):
`addCustomField` (useActionState: returns `FormState` with errors and values), `updateCustomField` (same),
`moveCustomField` (`id`, `dir` up/down), `deleteCustomField` (`id`; on success `setFlash({ code: "custom_field_deleted",
name })`), `addCustomChoice` (`fieldId`, `name`), `renameCustomChoice` (`id`, `name`), `moveCustomChoice` (`id`, `dir`),
`removeCustomChoice` (`id`). `revalidatePath` of the admin page and of `/people`, `/organisations`, `/deals` layouts.

Changed: `createPerson` / `updatePerson`, `createOrganisation` / `updateOrganisation`, `createDeal` / `updateDeal`: the
`*FormFromData` functions read `custom` (research.md §7); refusals return errors under `cf.<id>` and the typed values.

CSV import actions: `saveColumns` accepts `custom:<id>` targets (`toField(kind, value, customFields)`).

## Domain functions

`src/server/custom-fields/rules.ts` (pure):
- `CUSTOM_TYPES`, `TYPE_LABELS` ("Text", "Long text", "Number", "Money (£)", "Date", "Single choice", "Multiple choice",
  "Yes/No"), `KIND_OF_TAB`, `BUILT_IN_NAMES`, `SORTABLE_TYPES`, limits (`MAX_FIELDS = 50`, `MAX_CHOICES = 100`,
  `MAX_IN_LIST = 8`, `MAX_NAME = 60`, `MAX_TEXT = 255`, `MAX_LONG_TEXT = 10000`).
- `validateFieldForm(kind, form)` → `{ name, type, choices: string[], inList }` or errors (`name`, `type`, `choices`).
- `validateChoiceName(raw)`.
- `parseNumber(raw)`, `formatNumber(text)`, `formatDay("YYYY-MM-DD")`.
- `validateCustomValues(fields, raw, current)` → typed values or `FieldErrors` keyed `cf.<id>`.
- `formatValue(field, value)` (record page, timeline text), `listText(field, value)` (long text cut at 80 + "…").
- `readImportCell(field, cell)` → `{ value, unknown? } | { unreadable } | { tooLong }` (`unknown`: the parts of a Multiple choice cell naming no current choice); `parseImportDate`, `parseYesNo`.
- `customEvent(field, before, after)` → the timeline row to write, or null.

`src/server/custom-fields/fields.ts`: `listFields(kind)` (with offered and removed choices), `fieldCounts()`,
`getField(id)`, `addField`, `updateField`, `moveField`, `deleteField`, `countValues`, `addFieldChoice`,
`renameFieldChoice`, `moveFieldChoice`, `removeFieldChoice` — admin re-checked inside each transaction
(`isActiveAdmin`), result `{ ok: true } | { ok: false, code }` like `choices.ts`.

`src/server/custom-fields/values.ts`: `formFields(kind, current)` (fields for a form: offered choices plus the record's
own removed ones), `readCustomValues(db, viewerId, target)`, `saveCustomValues(db, actorId, target, raw, { current,
archived })`, `customListParts(db, kind, alias, fields, query)`, `customColumns(kind, fields, ids)`,
`customFilterOptions(viewerId, kind, fields)`.

## Messages (`src/server/messages.ts`)

`messages`:
- `custom_field_name_required`: "Give the field a name."
- `custom_field_name_too_long`: "A field name can be at most 60 characters."
- `custom_field_type_required`: "Choose a type."
- `custom_choices_required`: "Add at least one choice."
- `custom_choice_name_required`: "Give the choice a name."
- `custom_choice_name_too_long`: "A choice name can be at most 60 characters."
- `custom_choice_twice`: "Two choices have the same name."
- `custom_choice_last`: "A choice field needs at least one choice."
- `custom_choice_removed_exists`: "A removed choice has this name. Add it again to bring it back."
- `custom_fields_limit`: "A kind can have at most 50 custom fields."
- `custom_choices_limit`: "A field can have at most 100 choices."
- `custom_list_limit`: "At most 8 custom fields can be shown in a list."
- `custom_fields_empty`: "No custom fields yet."
- `custom_record_archived`: "Restore this record before changing its custom fields."

`templates`:
- `custom_field_exists(name)`: "There is already a field called <name>."
- `custom_choice_exists(name)`: "There is already a choice called <name>."
- `custom_text_too_long(name)`: "<name>: at most 255 characters."
- `custom_long_text_too_long(name)`: "<name>: at most 10,000 characters."
- `custom_number_invalid(name)`: "<name>: enter a number."
- `custom_number_decimals(name)`: "<name>: at most 4 decimal places."
- `custom_number_range(name)`: "<name>: enter a number between -1,000,000,000,000 and 1,000,000,000,000."
- `custom_money_invalid(name)`: "<name>: enter an amount in pounds, for example 4000 or 4000.50."
- `custom_date_invalid(name)`: "<name>: enter a real date."
- `custom_choice_invalid(name)`: "<name>: choose one of the choices."
- `custom_delete_count(n, kind, name)`: "3 people have a value in Diet. Deleting the field deletes these values for good."
  (1 person / n people, 1 organisation / n organisations, 1 deal / n deals; "1 person has").
- `custom_delete_none(name)`: "No record has a value in <name>."
- `custom_field_deleted(name)` (flash): "<name> deleted."
- `custom_set_event(field, value)`: "<field> set to <value>"
- `custom_changed_event(field, old, new)`: "<field> changed from <old> to <new>"
- `custom_changed_plain(field)`: "<field> changed"
- `custom_cleared_event(field)`: "<field> cleared"
- `import_custom_choice_unknown(field, value, rows)`: "<field>: \"<value>\" is not one of its choices and was not set. <rows note>" (Single and Multiple choice, one per unknown value)
- `import_custom_unreadable(field, value, rows)`: "<field>: \"<value>\" could not be read and was left empty. <rows note>"
- `import_custom_field_gone(name)`: "<name> was deleted before the import ran: its column was not imported."

`Timeline.tsx` splits templates around `\u0000` placeholders (as for `referrer_changed_event`) only when it needs
elements; these lines are plain text nodes. Every field, choice and value text is rendered as a React text node (markup
shown as text, Edge Cases).
