# Data model: Custom fields (SF-115)

One migration, `migrations/0010_custom_fields.sql`: three new tables and new columns and kinds on `timeline_events`.
Only statements allowed in a transaction; `enable row level security` (no policy) after every `create table`.

## Migration

```sql
-- SF-115: custom fields on people, organisations and deals (specs/sf-115-step-7-custom-fields/data-model.md).
create table custom_fields (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('person', 'organisation', 'deal')),
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 60),
  type text not null check (type in ('text', 'long_text', 'number', 'money', 'date', 'single_choice', 'multiple_choice', 'yes_no')),
  position int not null,
  in_list boolean not null default false,
  created_by bigint null references users (id),
  created_at timestamptz not null default now()
);
alter table custom_fields enable row level security;
create unique index custom_fields_name_key on custom_fields (kind, lower(name));
create index custom_fields_kind_position_idx on custom_fields (kind, position);

create table custom_field_choices (
  id bigint generated always as identity primary key,
  field_id bigint not null references custom_fields (id) on delete cascade,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 60),
  position int not null,
  removed_at timestamptz null
);
alter table custom_field_choices enable row level security;
create unique index custom_field_choices_name_key on custom_field_choices (field_id, lower(name));
create index custom_field_choices_field_idx on custom_field_choices (field_id, position);

-- One row per (field, record) that has a value; an empty field has no row.
create table custom_values (
  id bigint generated always as identity primary key,
  field_id bigint not null references custom_fields (id) on delete cascade,
  person_id bigint null references persons (id) on delete cascade,
  organisation_id bigint null references organisations (id) on delete cascade,
  deal_id bigint null references deals (id) on delete cascade,
  text_value text null check (text_value <> '' and char_length(text_value) <= 10000),
  number_value numeric(17, 4) null check (number_value between -1000000000000 and 1000000000000),
  money_pence bigint null check (money_pence between 0 and 999999999999),
  date_value date null,
  choice_id bigint null references custom_field_choices (id),
  choice_ids bigint[] null check (cardinality(choice_ids) between 1 and 100),
  bool_value boolean null,
  updated_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id, deal_id) = 1),
  check (num_nonnulls(text_value, number_value, money_pence, date_value, choice_id, choice_ids, bool_value) = 1)
);
alter table custom_values enable row level security;
create unique index custom_values_person_key on custom_values (field_id, person_id) where person_id is not null;
create unique index custom_values_organisation_key on custom_values (field_id, organisation_id) where organisation_id is not null;
create unique index custom_values_deal_key on custom_values (field_id, deal_id) where deal_id is not null;
create index custom_values_person_idx on custom_values (person_id) where person_id is not null;
create index custom_values_organisation_idx on custom_values (organisation_id) where organisation_id is not null;
create index custom_values_deal_idx on custom_values (deal_id) where deal_id is not null;
create index custom_values_choice_idx on custom_values (choice_id) where choice_id is not null;
create index custom_values_choice_ids_idx on custom_values using gin (choice_ids) where choice_ids is not null;

-- Timeline: a custom value set, changed or cleared, with the field's name and the values as shown at the time.
alter table timeline_events add column field_name text null check (char_length(field_name) <= 60);
alter table timeline_events add column old_value text null check (char_length(old_value) <= 10000);
alter table timeline_events add column new_value text null check (char_length(new_value) <= 10000);
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared',
                  'custom_set', 'custom_changed', 'custom_cleared'));
alter table timeline_events add constraint timeline_events_custom_check
  check ((kind in ('custom_set', 'custom_changed', 'custom_cleared')) = (field_name is not null)
         and (kind in ('custom_set', 'custom_changed', 'custom_cleared') or (old_value is null and new_value is null)));
```

Build: check the kind list against `0009_ambassadors.sql` (the last one to set it) before copying. No foreign key from
`timeline_events` to `custom_fields`: an entry keeps its text after a rename or a delete (FR-009). `tests/support/reset.ts`
adds `custom_values, custom_field_choices, custom_fields` to its `truncate`; `rls.test.ts` finds the three tables by itself
(check); `migrate.test.ts` covers 0010.

## Entities

### Custom field (`custom_fields`)

| Field | Rule |
|---|---|
| `kind` | `person` / `organisation` / `deal`. Address and UI words: `people` / `organisations` / `deals` (`KIND_OF_TAB`). |
| `name` | trimmed, 1–60 characters; unique within the kind ignoring case (index) **and** not a built-in name of the kind (`BUILT_IN_NAMES`, compared with `lower(btrim())`). |
| `type` | one of the eight; never updated after insert (no action changes it; `updateField` does not touch it). |
| `position` | 1..n within the kind; renumbered under `for update` of the kind's rows (as `pipelines.ts` `renumber`). New field: last. |
| `in_list` | at most 8 `true` per kind, checked in the transaction after locking the kind's rows. |
| limits | at most 50 fields per kind (`custom_fields_limit`). |

`BUILT_IN_NAMES` (in `src/server/custom-fields/rules.ts`, lower case):
- person: first name, last name, name, full name, email, email address, email addresses, phone, phone number, phone numbers,
  organisation, role, lead source, linkedin, owner, labels, consent, email consent, private, ambassador, referred by,
  last contacted, added, date added.
- organisation: name, website, sector, size, location, owner, people, added, date added.
- deal: title, value, organisation, person, main person, other people, labels, owner, expected close date, private,
  pipeline, stage, status, referred by, followers, lost reason, added, date added.

### Choice (`custom_field_choices`)

Only on `single_choice` / `multiple_choice` fields. Name trimmed 1–60, unique within the field ignoring case (removed
ones included: adding the name of a removed choice brings it back at the end, as `choices.ts` does for labels; renaming
to a removed choice's name is refused with `custom_choice_removed_exists`). At most 100 per field (removed included). At
least one offered (`removed_at is null`) choice at all times: removing the last one is refused (`custom_choice_last`).
Removing sets `removed_at`; never deleted except with its field.

### Custom value (`custom_values`)

At most one row per (field, record) — the partial unique indexes. The column used depends on the field type:

| Type | Column | Stored as | Form input (`cf.<id>`) | Shown |
|---|---|---|---|---|
| text | `text_value` | trimmed, 1–255 | `<input>` | as is |
| long_text | `text_value` | line ends `\r\n`→`\n`, trimmed at both ends, 1–10,000 | `<textarea>` | as is, `white-space: pre-wrap`; list: first 80 characters + "…" |
| number | `number_value` | `-?\d+(\.\d{1,4})?` after removing thousands commas and spaces; \|n\| ≤ 1e12 | `<input inputMode="decimal">` | `formatNumber`: thousands commas, trailing zeros of the decimals dropped ("1,234.5", "0", "-12") — from the string postgres.js returns, never through a float |
| money | `money_pence` | `parseMoney` of `deals/rules.ts` (same rules as the deal value; never negative) | `<input>` with "£" | `formatMoney` ("£4,000", "£4,000.50", "£0") |
| date | `date_value` | `parseDate` of `deals/rules.ts` (YYYY-MM-DD, a real day) | `<input type="date">` | `formatDay`: "24 Nov 2026" (from the `YYYY-MM-DD` text, no time zone) |
| single_choice | `choice_id` | an offered choice, or the record's current one | `<select>` with an empty option | the choice's current name |
| multiple_choice | `choice_ids` | sorted by choice position; offered ones, or ones the record already has | one checkbox per choice | names in choice order joined by ", " |
| yes_no | `bool_value` | `yes` → true, `no` → false | `<select>`: empty, Yes, No | "Yes" / "No" |

Empty input (or no ticked box) = no row. 0, £0 and No are values. Read with `::text` for `number_value` and
`to_char(date_value, 'YYYY-MM-DD')` for dates; `money_pence::bigint` cast to number (≤ 999,999,999,999 is safe).

## State changes

### Admin changes (`src/server/custom-fields/fields.ts`, each in one transaction, `isActiveAdmin` first)

| Function | Effect |
|---|---|
| `addField(actor, kind, form)` | validate (name, type, choices for choice types, in-list); lock the kind's fields `for update`; count ≤ 50; name not taken (custom or built-in); in-list count ≤ 8; insert at `position = n + 1`; insert choices at positions 1..k. |
| `updateField(actor, id, form)` | name + in_list only. Lock the kind's fields; same name and 8-in-list rules (the field itself excluded). |
| `moveField(actor, id, "up" \| "down")` | swap with the neighbour, renumber 1..n. |
| `deleteField(actor, id)` | lock the field `for update`, delete it (values and choices go by cascade), renumber the kind; returns `{ name }` for the notice. No timeline row. |
| `addFieldChoice / renameFieldChoice / moveFieldChoice / removeFieldChoice` | as labels (`choices.ts`), within one field; lock the field row `for update` first. |
| `countValues(id)` | `select count(*) from custom_values where field_id = $1` — every record, private and archived included (FR-004, US6-2). Only the number leaves the function. |

### Record saves (`src/server/custom-fields/values.ts`, inside the existing save transaction)

`saveCustomValues(db, actorId, target, kind, raw, opts)` is called by `createPerson`, `updatePerson`,
`createOrganisation`, `updateOrganisation`, `createDeal`, `updateDeal` after the record is locked and loaded:

1. `select … from custom_fields where kind = $1 for share` (+ their choices): a concurrent `deleteField` waits, or has
   already run and the field is simply absent (US4-5: its value is ignored).
2. Only fields whose id is in the form's `cfShown` list are considered (a field added after the form opened keeps no
   value; spec Edge Cases). Unknown ids are dropped.
3. `validateCustomValues(fields, raw, current)` (pure, `rules.ts`): an error per field under the key `cf.<id>`, code +
   `name` = field name (template). On any error the whole save refuses (existing `refuse(...)`), nothing written.
4. Archived record (update only): if any shown field's value would change, refuse with `{ form: { code:
   "custom_record_archived" } }`; else nothing to write (spec Clarifications). The edit form of an archived record does not
   show "// MORE DETAILS" inputs, so a normal save never trips this.
5. For each field whose value differs from `current`: upsert / delete the row (`insert … on conflict (field_id, person_id)
   where person_id is not null do update`), then one timeline row:
   - none → value: `custom_set`, `new_value` = shown text; long text: `custom_changed` with no values.
   - value → other value: `custom_changed`, `old_value`, `new_value`; long text: no values.
   - value → none: `custom_cleared`.
   `field_name` = the field's name now. Values are written as shown (`formatValue`), so later renames of fields or
   choices do not rewrite history (spec Clarifications).
6. New record: same, with `current` empty; the "added" event comes first, then the `custom_set` entries.

`readCustomValues(db, viewerId, target, kind)`: the record is read through `visiblePerson` / `visibleDeal` in the
same query (`exists (select 1 from persons p where p.id = $id and visiblePerson(p))`), so a hidden record gives
nothing (US6-3). Returns every field of the kind in order with `{ id, name, type, value, shown }`.

Deleting a record: values go by cascade. Hand-over: values untouched (they follow the record).

## Timeline event (new kinds)

| Kind | Columns | Line (`Timeline.tsx`, text nodes only) | Tag |
|---|---|---|---|
| `custom_set` | `field_name`, `new_value` | `templates.custom_set_event(field, value)` "Diet set to Vegan" + " by Ada Fake" | CHANGE |
| `custom_changed` | `field_name`, `old_value`, `new_value` (both null for long text) | "Diet changed from Vegan to Vegetarian" / "Notes changed" | CHANGE |
| `custom_cleared` | `field_name` | "Diet cleared" | CHANGE |

`TimelineEvent` gains `fieldName`, `oldValue`, `newValue`; `selectEntries` reads them; `recordEvent` accepts them.
`entryTag` already gives CHANGE to any kind that is not a note, an activity, or another record's entry.

## Lists

`query.custom`: validated custom filters of the list (`Record<string, string>`, keys `cf<id>`, `cf<id>_from`, `cf<id>_to`);
`query.sort` may be `cf<id>`. `customListParts(db, kind, alias, fields, query)` builds:

- **filters** (`and …`, one `exists` per filter on `custom_values cv` with `cv.field_id = $id and cv.<target> = <alias>.id`):
  text/long text `cv.text_value ilike %escapeLike(words)%`; number `number_value >= / <=`; money `money_pence >= / <=`; date
  `date_value >= / <=`; single choice `cv.choice_id = $c`; multiple choice `cv.choice_ids @> array[$c]::bigint[]`; yes/no
  `cv.bool_value = true/false`; "empty" → `not exists (…)`. These run inside the list's `where`, after
  `visiblePerson` / `visibleDeal`, so hidden records are never matched, counted or summed (US6-1). The deal list's count and
  total use the same `where`.
- **sort**: `left join custom_values cs on cs.field_id = $id and cs.<target> = <alias>.id` (+ `left join
  custom_field_choices cc on cc.id = cs.choice_id` for single choice) and `order by <col> <dir> nulls last, <list's default
  tie-break>`; column: `text_value` (lower), `number_value`, `money_pence`, `date_value`, `cc.position`, `bool_value`.
- **columns**: after the page's rows are read, one query `select field_id, <target>, … from custom_values where field_id
  in (shown) and <target> in (row ids)` (rows are already visible), formatted with `formatValue` / `listText`.

## Fake data (`src/seed/custom-fields.ts`, registered last in `src/seed/index.ts`)

Re-runnable: fields matched by `(kind, lower(name))`, choices by `(field_id, lower(name))`, values by the unique
indexes (`on conflict do nothing`), timeline rows only when the value was inserted. Clearly fake names:

| Kind | Field | Type | In list | Choices |
|---|---|---|---|---|
| person | Diet (fake) | single choice | yes | None, Vegetarian, Vegan, Pescatarian (removed) |
| person | Birthday (fake) | date | no | |
| person | Newsletter topics (fake) | multiple choice | yes | AI, Events, Hiring |
| person | Head count met (fake) | number | no | |
| person | Notes (fake) | long text | no | |
| organisation | Account code (fake) | text | yes | |
| organisation | Annual budget (fake) | money | yes | |
| deal | Contract end (fake) | date | yes | |
| deal | Signed NDA (fake) | yes/no | yes | |

Values on a few fake people and deals, including one private person and one private deal of the seeded fake users, and
one person keeping the removed choice "Pescatarian"; a `custom_set` timeline row per value inserted.
