# Data model: Pipelines, deals and the board

One new migration, `migrations/0003_pipelines_deals.sql`. Only statements allowed in a transaction;
`alter table … enable row level security` (no policy) after every `create table`. Add the four new tables to
the list in `tests/integration/rls.test.ts`.

## Tables

### `pipelines`

| Column | Type | Rules |
|---|---|---|
| `id` | `bigint generated always as identity primary key` | |
| `name` | `text not null` | `check (name = btrim(name) and name <> '' and char_length(name) <= 100)`; `unique index pipelines_name_key on pipelines (lower(name))` (FR-001) |
| `position` | `int not null` | pipeline order, 1..n; renumbered on every add/reorder/delete |
| `created_at` | `timestamptz not null default now()` | |

### `stages`

| Column | Type | Rules |
|---|---|---|
| `id` | `bigint generated always as identity primary key` | |
| `pipeline_id` | `bigint not null references pipelines (id) on delete cascade` | a pipeline is only deleted once it has no deals, so cascade only removes empty stages |
| `name` | `text not null` | same check as pipelines; `unique index stages_name_key on stages (pipeline_id, lower(name))` (FR-002) |
| `position` | `int not null` | order within the pipeline, 1..n |

Index: `stages (pipeline_id, position)`.

### `deals`

| Column | Type | Rules |
|---|---|---|
| `id` | `bigint generated always as identity primary key` | |
| `title` | `text not null` | `check (title = btrim(title) and title <> '' and char_length(title) <= 200)` |
| `value_pence` | `bigint null` | `check (value_pence between 0 and 999999999999)`; null = no value (shows "—", counts £0) |
| `stage_id` | `bigint not null references stages (id)` | **no cascade**: the database refuses to drop a stage that still holds a deal (SC-007). The pipeline is the stage's pipeline (no separate column) |
| `stage_entered_at` | `timestamptz not null default now()` | copy of the open stage period's `entered_at`; card order |
| `organisation_id` | `bigint null references organisations (id) on delete set null` | |
| `person_id` | `bigint null references persons (id) on delete set null` | main person |
| `owner_id` | `bigint not null references users (id)` | active user when set; kept when deactivated |
| `expected_close_on` | `date null` | |
| `private` | `boolean not null default false` | changed only by `created_by` |
| `created_by` | `bigint not null references users (id)` | |
| `created_at` | `timestamptz not null default now()` | "Date added" |
| `archived_at` | `timestamptz null` | archived deals stay in their stage, never shown or counted on the board |
| `version` | `int not null default 1` | +1 on every edit, move, archive (optimistic lock, research.md §4) |

Indexes: `deals (stage_id, stage_entered_at desc) where archived_at is null` (board);
`deals (stage_id)` (deletes, moves of archived deals); `deals (organisation_id)`; `deals (person_id)`;
`deals (owner_id)`; `deals (created_by) where private`.

### `deal_stage_periods` (stage history, FR-007)

| Column | Type | Rules |
|---|---|---|
| `id` | `bigint generated always as identity primary key` | |
| `deal_id` | `bigint not null references deals (id) on delete cascade` | |
| `stage_id` | `bigint null references stages (id) on delete set null` | null once the stage is deleted |
| `stage_name` | `text not null` | copied at entry |
| `pipeline_name` | `text not null` | copied at entry |
| `entered_at` | `timestamptz not null default now()` | |
| `left_at` | `timestamptz null` | null = the deal is in this stage now |
| `moved_by` | `bigint null references users (id)` | null for fake data |

`unique index deal_stage_periods_open_key on deal_stage_periods (deal_id) where left_at is null` (one open
period per deal); index `(deal_id, entered_at)`.

### `timeline_events` (changed)

```sql
alter table timeline_events add column deal_id bigint null references deals (id) on delete cascade;
alter table timeline_events add column from_stage text null;
alter table timeline_events add column to_stage text null;
alter table timeline_events add column cause text null check (cause in ('stage_deleted', 'pipeline_deleted'));
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'moved'));
alter table timeline_events drop constraint timeline_events_check;   -- num_nonnulls(person_id, organisation_id) = 1
alter table timeline_events add constraint timeline_events_target_check
  check (num_nonnulls(person_id, organisation_id, deal_id) = 1);
create index timeline_events_deal_idx on timeline_events (deal_id, created_at desc);
```

The two dropped constraint names are Postgres's defaults for the unnamed checks in `0002`; Build confirms them
(`select conname from pg_constraint where conrelid = 'timeline_events'::regclass`) before writing the file.

`moved` events: `from_stage` / `to_stage` hold the names shown ("Qualified", or "Sales · Qualified" when the
pipeline changes), `cause` the reason for admin-driven moves. `edited` events on deals list field labels in
`fields`: `Title`, `Value`, `Organisation`, `Person`, `Owner`, `Expected close date`, `Private`.

## Visibility (FR-016)

`visibleDeal(db, viewerId, alias = "d")` → `(not d.private or d.created_by = viewerId)`, in
`src/server/records/visibility.ts`. Used by every query that reads `deals` (cards, column counts and totals,
drawer, edit form, timeline of a deal, every change). Person names on deals always come through
`left join persons p on p.id = d.person_id and <visiblePerson(p)>`. Organisations are always shared.

## Validation (pure, `src/server/deals/rules.ts`)

| Field | Rule | Message code |
|---|---|---|
| title | trimmed, 1–200 chars | `deal_title_required` (empty), `deal_title_too_long` |
| value | `parseMoney` (research.md §2) | `deal_value_invalid` |
| stage | an existing stage (create; the form's pipeline must be the stage's pipeline) | `deal_stage_required` |
| organisation | `resolveOrganisation` (existing) | `organisation_exists` (archived name) |
| person | visible, non-archived person, or the current one; a hidden current person is kept when the field is empty | — (anything else is ignored → no person) |
| owner | `resolveOwner` (existing) | — |
| expected close | empty or `YYYY-MM-DD`, a real date | `deal_close_date_invalid` |
| private | only from the creator | — |
| pipeline / stage name | trimmed, 1–100 chars, unique ignoring case (stage: within its pipeline) | `pipeline_name_required`, `pipeline_name_exists` |

`changedDealFields(before, after)` returns the field labels above (`Value`, …) for the history line.

## State changes

| Change | Who | Effect (one transaction) |
|---|---|---|
| add deal | any user | insert deal (owner default = actor, `created_by` = actor); open period; event `added` |
| edit deal | any user who sees it | `version` check; update; `version + 1`; event `edited` (fields) if anything changed |
| move deal (drag or "Move to") | any user who sees it, not archived | `version` + `stage_id` check; close open period (`left_at = now()`), open new period, `stage_id`, `stage_entered_at = now()`, `version + 1`; event `moved`. Same stage → nothing |
| archive deal | any user who sees it | `archived_at = now()`, `version + 1`; event `archived` (stage kept) |
| delete deal | active admin who sees it | delete row (periods and events cascade); flash "<title> was deleted." |
| add / rename / reorder pipeline or stage | active admin | as above; names unique |
| delete stage | active admin | every deal of the stage (archived included) moves to the chosen stage of the same pipeline with event `moved` (`cause = 'stage_deleted'`) and new period; delete stage; renumber |
| delete pipeline | active admin | every deal moves to the chosen stage of another pipeline (`cause = 'pipeline_deleted'`); delete pipeline (stages cascade); renumber |

Deleting a person or organisation sets the deal's link to null (FK), never deletes the deal.

## Fake data (`src/seed/deals.ts`, FR-021)

Pipelines (in order): Sales (Lead in, Qualified, Proposal, Negotiation, Closing), Ambassadors (Introduced,
Talking, Active), Fractional CTO (Lead in, Scoping, Proposal, Signed), Exec Dinner (Invited, Confirmed,
Attended, Follow up), "Ada Fake's pipeline" (To contact, Contacted, Meeting, Proposal). ≥ 40 deals with
clearly fake titles ("Fakeco website", "Sample Gyms CRM", …), spread over the four fake owners, with and
without value / organisation / person (people and organisations from `src/seed/people.ts`), Sales "Closing"
left empty, ≥ 1 archived deal, ≥ 1 private deal created by Ada Fake. Each deal gets its stage periods and an
`added` event (some also `moved`). Idempotent as research.md §10.
