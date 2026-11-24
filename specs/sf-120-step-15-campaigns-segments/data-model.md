# Data model: Campaigns — segments (SF-120)

## Migration `migrations/0012_segments.sql`

Only statements allowed in a transaction; RLS on (no policies) after the `create table`. Never run at app start.

```sql
-- SF-120: saved segments, shared by the whole team (specs/sf-120-step-15-campaigns-segments/data-model.md).
-- A segment stores the choice of recipients, never people (FR-007). pipeline_id, stage_id and the ids inside
-- conditions have no foreign key on purpose: a deleted pipeline, stage, organisation or custom field stays in the
-- segment, shown as "(deleted)" and matching nobody (FR-013, research.md §2).
create table segments (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100),
  who text not null check (who in ('everyone', 'pipeline', 'stage')),
  pipeline_id bigint null,
  stage_id bigint null,
  deal_status text null check (deal_status in ('open', 'won', 'lost', 'all')),
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 20),
  created_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  updated_by bigint not null references users (id),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  check ((who = 'everyone') = (pipeline_id is null and deal_status is null)),
  check ((who = 'stage') = (stage_id is not null))
);
alter table segments enable row level security;
create unique index segments_name_key on segments (lower(name));

-- Pipeline / stage segments of won, lost or all deals (the board index only covers open deals), research.md §9.
create index deals_stage_live_idx on deals (stage_id) where archived_at is null;
```

`tests/support/reset.ts` and `.factory/run/reset-db.sh`: add `segments` to the `truncate` list.
Users are never deleted (they are deactivated), so `created_by` / `updated_by` need no `on delete`.

## Entities

### Segment (`segments` row)

| Field | Type | Rule |
|---|---|---|
| `id` | bigint | identity |
| `name` | text | trimmed, 1–100 characters (FR-005); unique ignoring case (`segments_name_key`) |
| `who` | `everyone` \| `pipeline` \| `stage` | FR-002 |
| `pipeline_id` | bigint? | set for `pipeline` and `stage`; may point at a deleted pipeline |
| `stage_id` | bigint? | set for `stage` only; may point at a deleted stage |
| `deal_status` | `open` \| `won` \| `lost` \| `all` ? | set for `pipeline` and `stage`; the form picks `open` first |
| `conditions` | jsonb array, ≤ 20 | `Condition[]` below, in the order the user added them |
| `created_by`, `created_at` | user, time | set on insert |
| `updated_by`, `updated_at` | user, time | "Last changed by <user> · <date time>"; set on insert and every save |
| `version` | int | +1 on every save; the form posts it (FR-012) |

### Condition (one element of `conditions`)

TypeScript type in `src/server/segments/rules.ts` (validated by `validateSegmentForm` before every write, and read
back with `readConditions(json)` which drops any element that does not fit — a hand-edited row never breaks a page):

```ts
type Condition =
  | { field: "lead_source" | "label" | "organisation" | "owner"; ids: number[] }        // 1–100 ids, match any
  | { field: "role"; text: string }                                                      // 1–200 chars, contains, ignoring case
  | { field: "custom"; fieldId: number; type: "text" | "long_text"; text: string }        // 1–200 chars, contains
  | { field: "custom"; fieldId: number; type: "number" | "money" | "date"; from: string | null; to: string | null }
        // at least one end; number canonical text (parseNumber), money pence as text (parseMoney), date YYYY-MM-DD (parseDate)
  | { field: "custom"; fieldId: number; type: "single_choice"; ids: number[]; empty: boolean }  // ≥ 1 id or empty
  | { field: "custom"; fieldId: number; type: "multiple_choice"; ids: number[] }               // 1–100 ids, has any
  | { field: "custom"; fieldId: number; type: "yes_no"; value: "yes" | "no" | "empty" };
```

The custom field's `type` is stored with the condition (a field's type cannot change, SF-115); at count time a
condition whose field is gone, is not `kind = 'person'`, or has another type matches nobody.
The same field may appear in two conditions (e.g. a date "from" and another "to"); both must match.

### Reach (worked out, never stored)

`{ reaches: number; archived: number; unsubscribed: number; noEmail: number }` for (viewer, definition, now):
the visible people matching "Who" and every condition, each counted once, under the first reason that applies in the
order archived → unsubscribed → no email address; `reaches` = the rest (research.md §3).

### Definition (what the form edits and the count reads)

`{ who; pipelineId: number | null; stageId: number | null; dealStatus: DealStatus | null; conditions: Condition[] }`
— a segment without name / version. `COUNT AGAIN` counts a definition that is not saved.

## Validation (`validateSegmentForm`, pure)

Input: the raw form (contracts/routes.md § Form fields). Output: `{ ok: true, name, definition }` or
`{ ok: false, errors }` with one message per problem, in form order:

1. Name: trimmed; empty → `segment_name_required`; > 100 → `segment_name_too_long`. (Uniqueness is checked by
   `segments.ts` in the transaction → `templates.segment_name_exists(name)`.)
2. Who: not one of the three → treated as `everyone`. `pipeline` / `stage` with no pipeline id →
   `segment_pipeline_required`; `stage` with no stage id → `segment_stage_required`. Status not one of the four →
   `open`. For an edit, an id that no longer exists is accepted only when it is the segment's stored one (so a
   broken segment can be saved after other changes); a new id must exist (`segments.ts` checks, else the same
   "Choose a pipeline." / "Choose a stage." message). For `everyone`, pipeline / stage / status are dropped.
3. Conditions (≤ 20, else `segment_conditions_limit`): rows with no field chosen are dropped. Per row, by field:
   no value → `templates.segment_condition_required(fieldName)` ("Lead source: choose at least one." for choice-like
   fields, "<field>: type the text to look for." for text, "<field>: give a from or a to." for ranges,
   "<field>: choose Yes, No or Empty." for yes/no); > 100 values → `templates.segment_condition_too_many(fieldName)`;
   text > 200 → `templates.segment_condition_too_long(fieldName)`; a number, amount or date that does not read →
   `templates.segment_condition_invalid(fieldName, messageFor(code))` with the SF-115 codes
   (`custom_number_invalid`, `custom_money_invalid`, `custom_date_invalid`, …); `from` after `to` →
   `templates.segment_condition_range(fieldName)`. Ids are kept only when they are one of the options offered to this
   form (research.md §8), so a made-up id in a post is dropped, never shown back; a row left with no value is then
   refused as "no value".

## State changes

| Action | Effect | Refusals |
|---|---|---|
| Create | insert, `version = 1`, `created_* = updated_* = actor, now()` | invalid form; name exists |
| Edit | update name, who, ids, status, conditions; `updated_* = actor, now()`; `version + 1` | invalid form; name exists (another segment); `segment_changed`; `segment_not_found` |
| Delete | delete row | `segment_not_found` |

No timeline entries, notifications or flashes other than `segment_deleted` / `segment_not_found`.
Deleting a pipeline, stage, organisation, custom field or user changes no segment row.

## Fake data `src/seed/segments.ts` (FR-015)

Registered last in `src/seed/index.ts` (after `custom-fields`). Idempotent: a segment is inserted only when no segment
of that name exists; ids looked up by name from the seeded pipelines, stages, lead sources, labels, users and person
custom fields (skipped quietly when one is missing). Created and last changed by the first fake user.

| Name | Who | Conditions |
|---|---|---|
| Fake — everyone | Everyone in the CRM | — |
| Fake — Exec Dinner, all deals | Pipeline Exec Dinner, All deals | — |
| Fake — Sales Proposal, open deals | Stage Sales · Proposal, Open deals | Lead source Inbound or Event |
| Fake — Inbound owned by Ada Fake | Everyone in the CRM | Lead source Inbound; Owner Ada Fake; a person custom field condition from the SF-115 seed |
