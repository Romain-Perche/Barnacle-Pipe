# Research: Campaigns — segments (SF-120)

No NEEDS CLARIFICATION was left in the Technical Context; each point below is a design choice made from the code
already in the repo. Spec choices the factory made are in `spec.md` § Clarifications ("decided by the factory").

## §1 Dependencies

- **Decision**: no new package. Next.js server actions + `useActionState`, `postgres` (plain SQL), plain CSS.
- **Rationale**: everything the feature needs (a form with rows added and removed, a count from SQL, jsonb) is in
  React, Postgres and the code of SF-115 (custom field filters) and SF-92/93 (visibility).
- **Alternatives**: a query-builder or a JSON-schema validator for the conditions — rejected, a 60-line pure
  validator in `rules.ts` does it and keeps the error messages in `messages.ts`.

## §2 How a segment is stored

- **Decision**: one table `segments` (data-model.md): `name`, `who` (`everyone` / `pipeline` / `stage`),
  `pipeline_id`, `stage_id`, `deal_status` (`open` / `won` / `lost` / `all`), `conditions jsonb` (an array, checked by
  `rules.ts` before every write), `created_by/at`, `updated_by/at`, `version`.
  `pipeline_id`, `stage_id` and every id inside `conditions` have **no foreign key**.
- **Rationale**: FR-007 stores the choice, never people. FR-013 needs a segment that still points at a deleted
  pipeline, stage, organisation or custom field so it can show "(deleted)" and match nobody: a foreign key would block
  the admin's delete (pipelines, organisations, custom fields are deleted by admins today) or `set null` would lose
  which part was deleted. A missing id is found at read time by a left join / lookup: "(deleted)".
  Conditions are a short ordered list (≤ 20) always read and written whole with the segment, so a jsonb column keeps
  one row per segment, one `version` and one `update … where version = $v` (FR-012).
- **Alternatives**: a `segment_conditions` table (one row per condition) — rejected: more writes, a second table to
  lock for the version check, and still no foreign keys possible for the same reason.

## §3 Working out the reach (FR-008 … FR-011)

- **Decision**: `src/server/segments/reach.ts` builds one SQL `where` on `persons p` from the definition:
  `visiblePerson(sql, viewer)` and the "Who" part and each condition, then one query returns four numbers with
  `count(*) filter (…)`:
  - `archived`: `p.archived_at is not null`;
  - `unsubscribed`: not archived and `p.consent = 'unsubscribed'`;
  - `noEmail`: not archived, subscribed, `not exists (select 1 from person_emails e where e.person_id = p.id)`;
  - `reaches`: not archived, subscribed, has an email.
  The reasons are taken in this order so each person is counted under one reason only (spec Edge Cases).
  A person is a row of `persons`, so a person matched through several deals or with several addresses is counted
  once (FR-009); their address is the first `person_emails` row by `position` — `reachedPeople()` exposes
  `(person_id, email)` for the later sending issue, the count does not need it.
- **"Who"**:
  - `everyone`: no extra condition;
  - `pipeline` / `stage`: `exists (select 1 from deals d join stages s on s.id = d.stage_id where d.archived_at is null
    and ${visibleDeal(sql, viewer)} and s.pipeline_id = $pipeline [and d.stage_id = $stage] [and d.status = $status]
    and (d.person_id = p.id or exists (select 1 from deal_people dp where dp.deal_id = d.id and dp.person_id = p.id)))`.
    Status `all` adds no status condition. A deleted pipeline or stage has no deals: nobody, naturally.
- **Privacy (FR-010, SC-003)**: `visiblePerson` on the person and `visibleDeal` on the deal, inside the same query;
  nothing is counted about hidden rows ("archived", "unsubscribed" and "no email" are counted among visible people
  only), so no number can reveal a hidden person or deal.
- **Rationale**: the same fragments as every other read (AGENTS.md), one round trip per segment.
- **Alternatives**: computing in TypeScript from a list of ids — rejected (10,000 people × 50 segments).

## §4 Conditions and their SQL

Each condition is one `and (…)` on `p`:

| Field | Stored | SQL |
|---|---|---|
| Lead source | `{ field: "lead_source", ids }` | `p.lead_source_id = any($ids)` |
| Label | `{ field: "label", ids }` | `exists (select 1 from person_labels pl where pl.person_id = p.id and pl.label_id = any($ids))` |
| Organisation | `{ field: "organisation", ids }` | `p.organisation_id = any($ids)` |
| Owner | `{ field: "owner", ids }` | `p.owner_id = any($ids)` |
| Role | `{ field: "role", text }` | `p.role ilike '%' || escapeLike(text) || '%'` |
| Custom (person) | `{ field: "custom", fieldId, … }` | `exists (select 1 from custom_values cv where cv.field_id = $f and cv.person_id = p.id and …)` |

Custom field tests are those of the People list filter (SF-115 `customListParts`): text / long text contains
(`ilike`, ignoring case); number, money, date `from`/`to` (either end may be empty, not both); single choice
`choices` (ids) plus optional `empty` — `cv.choice_id = any($ids)` or, with `empty`, `or not exists (…)`; multiple
choice `cv.choice_ids && $ids::bigint[]` (has any chosen choice); yes/no `yes` / `no` / `empty`.

- **Decision**: the custom-field probes are extracted from `customListParts` into one exported helper in
  `src/server/custom-fields/values.ts` — `customProbe(db, field, alias, test)` — used by both the People list and the
  segment reach, so the two can never disagree (US2 independent test: segment count = People list count minus left-out
  people). The People list keeps its single-value tests; the segment passes several choice ids.
- A condition whose custom field no longer exists (or is no longer a person field) is `false`: it matches nobody,
  even with "Empty" (FR-013). A deleted organisation id never equals `p.organisation_id`: nobody through that value.
  Removed labels, lead sources and custom choices keep their rows, so they keep matching (spec Edge Cases).
  A deactivated owner keeps owning their people, so they keep matching.

## §5 "Refers to something that was deleted"

- **Decision**: `segments.ts` loads, for the segments being shown, the ids that still exist (pipelines, stages with
  their pipeline, organisations, person custom fields and their choices) in a few `select id … where id = any($ids)`
  queries, and `rules.ts` `describeSegment(def, names)` returns the summary, the WHO and CONDITIONS lines and
  `broken: boolean`. Missing → "(deleted)" and `broken`. A stage whose pipeline is not the stored pipeline counts as
  deleted (stages cannot move between pipelines today; this only guards a hand-edited row).
- Labels, lead sources and custom choices are only ever soft-removed: they show their name (no "(deleted)"); a custom
  choice id missing because its whole field was deleted is covered by the field being deleted.

## §6 Concurrent edits (FR-012)

- **Decision**: the edit form carries `version`; `updateSegment` runs `update segments set … , version = version + 1
  where id = $id and version = $v returning id`. No row → `select 1 from segments where id = $id`: gone →
  `segment_not_found`, else `segment_changed`. Delete: `delete … where id = $id returning name`, no row →
  `segment_not_found` (US3 scenario 4). Same pattern as `updatePerson` / `updateDeal`.
- Name uniqueness: `create unique index segments_name_key on segments (lower(name))`; the action checks first for a
  friendly message and catches the unique violation (`23505`) for the race.

## §7 The form and COUNT AGAIN

- **Decision**: `/segments/new` and `/segments/[id]/edit` render a client `SegmentForm.tsx` (rows added and
  removed, the input depending on the chosen field, stage list depending on the pipeline: browser needed) with
  `useActionState(saveSegmentAction)`. Both buttons submit the same form: `[ SAVE ]` (`intent=save`) and
  `[ COUNT AGAIN ]` (`intent=count`). The action reads and validates the form the same way for both; `count` returns
  the count for the definition without saving; `save` saves and redirects to `/segments/<id>`. A refusal returns the
  form values (kept, US1-5) and the field errors. The count shown when the form opens is worked out on the server
  (existing segment: its definition; new: "Everyone in the CRM").
- Count with an invalid form: the errors are shown and no number (the number would not match what is on screen).
- **Alternatives**: a separate count route handler fetched as the user types — rejected (more code, a second entry
  point to protect; the spec asks for a button).

## §8 Option lists of the form (US2 scenario 4)

- Lead sources and labels: `removed_at is null` or id already in the segment (removed ones marked "(removed)").
- Organisations: all organisations (organisations are never private; the Organisations list shows archived ones with
  its archived switch), archived marked "(archived)"; plus deleted ids already in the segment shown "(deleted)" so they
  can be removed. A filtering multi-picker (`MultiPicker.tsx`, client) because there can be thousands.
- Owners: every user by name, active and deactivated (deactivated marked "(deactivated)"), as `ownerOptions` does for
  forms but without the "active only" rule.
- Pipelines and stages: all pipelines with their stages in position order (none is private).
- Custom fields: every `kind = 'person'` field in position order, shown in the list or not; choices: offered ones
  plus removed ones already in the segment.

## §9 Performance (SC-004)

- **Decision**: the Segments page computes each segment's count with one query each (`Promise.all` would contend
  for the pooled connections; run them in sequence on one reserved connection or plain sequence — ≤ 50 queries of a
  few ms each). Indexes used: `persons` primary key, `person_emails (person_id, position)` unique,
  `deal_people_person_idx`, `custom_values (field_id, person_id)` unique, plus one new partial index
  `deals_stage_live_idx on deals (stage_id) where archived_at is null` (the existing board index only covers open
  deals; won / lost / all segments need the others).
- An integration test seeds 10,000 people, 5,000 deals and 50 segments and checks `listSegments` < 2 s.

## §10 Page addresses and messages

- `/segments/[id]`: the id goes through `parseId`; unknown → `notFound()` → `not-found.tsx` "This segment no longer
  exists." Nothing from the address is shown back.
- Delete confirmation: `/segments/[id]?confirm=delete` (fixed value), the same `.confirm` look as `DeleteConfirm`
  but open to every user and with the segment wording. After delete → `/segments` with flash `segment_deleted`
  (name from the database row). Saving or deleting a segment that is gone → flash `segment_not_found` on `/segments`.
- All text in `messages.ts` / `templates` (contracts/routes.md § Messages); segment names rendered as text nodes.
