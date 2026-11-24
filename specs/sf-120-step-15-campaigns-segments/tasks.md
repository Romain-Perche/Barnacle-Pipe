---

description: "Task list for SF-120 Campaigns — segments"
---

# Tasks: Campaigns — segments

**Input**: Design documents from `/specs/sf-120-step-15-campaigns-segments/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: included — AGENTS.md asks for Vitest tests naming what they cover (`// covers FR-009, US1 scenario 7`);
quickstart.md § Automated checks lists the files. Unit tests in `tests/unit/`, integration tests on the real local
Postgres in `tests/integration/` (`export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`).
Write each story's tests first and see them fail before the code.

**Outside services**: only Supabase Postgres, which has no public schema on GitHub (plan.md § Outside services);
it is never faked: tests use a real local PostgreSQL (T005). No blueprint entries (`blueprints.json` = `[]`), so
no blueprint tasks and no "Departs from blueprint" line.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1, US2, US3 (spec.md)

---

## Phase 1: Setup

- [ ] T001 Create `migrations/0012_segments.sql` exactly as data-model.md § Migration (check `migrations/` for the next free number first): table `segments` with `name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100)`, `who text not null check (who in ('everyone', 'pipeline', 'stage'))`, `pipeline_id bigint null`, `stage_id bigint null` (no foreign keys, research.md §2), `deal_status text null check (deal_status in ('open', 'won', 'lost', 'all'))`, `conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 20)`, `created_by`/`updated_by bigint not null references users (id)`, `created_at`/`updated_at timestamptz not null default now()`, `version int not null default 1`, the two checks `(who = 'everyone') = (pipeline_id is null and deal_status is null)` and `(who = 'stage') = (stage_id is not null)`; `alter table segments enable row level security`; `create unique index segments_name_key on segments (lower(name))`; `create index deals_stage_live_idx on deals (stage_id) where archived_at is null`
- [ ] T002 [P] Add `segments` to the truncate list in `tests/support/reset.ts` and in `.factory/run/reset-db.sh`
- [ ] T003 [P] Add every message and template of contracts/routes.md § Messages to `src/server/messages.ts` (exact wording: "Give the segment a name.", "A segment name can be at most 100 characters.", "There is already a segment called <name>.", "Choose a pipeline.", "Choose a stage.", "Someone else changed this segment. Open it again to see their changes.", "This segment no longer exists.", "Recipients are worked out when the campaign is sent, so this number can change.", "This segment refers to something that was deleted. Edit it before using it.", "Segment <name> deleted.", "Reaches <n> people now" / "Reaches 1 person now", "Left out: <a> archived · <b> unsubscribed · <c> with no email address", …) and flash codes `segment_deleted` (name from the database) and `segment_not_found` in `src/server/records/flash.ts`
- [ ] T004 [P] Extend `tests/unit/messages.test.ts`: every new `segment_*` message present, templates render the singular / plural and names as given (covers FR-011, FR-014)

---

## Phase 2: Foundational (blocking prerequisites)

- [ ] T005 Database checks for the one outside service, Supabase Postgres (no public schema on GitHub; no fake: a real local PostgreSQL 17, which follows Supabase's page https://supabase.com/docs/guides/database/connecting-to-postgres): extend `tests/integration/migrate.test.ts` so `0012` applies inside one transaction (transaction-mode pooler: no `create index concurrently`, no session state) and `tests/integration/rls.test.ts` so `segments` has row level security on with no policy; the new code keeps the copied limits — connections with `prepare: false`, `max: 5`, every multi-statement change in one `sql.begin()`, no `set` / `listen` / session locks (covers FR-007)
- [ ] T006 [P] Write `tests/unit/segment-rules.test.ts` for the pure core: `readConditions` drops elements that do not fit data-model.md § Condition; `validateSegmentForm` name rules (trimmed, empty → "Give the segment a name.", 101 characters → "A segment name can be at most 100 characters."), who / status defaults (unknown who → `everyone`, unknown status → `open`, `everyone` drops pipeline, stage and status), "Choose a pipeline." / "Choose a stage." (covers US1 scenarios 5 and 6, FR-005)
- [ ] T007 Create `src/server/segments/rules.ts`: `SEGMENT_WHO`, `DEAL_STATUS_CHOICES`, `MAX_NAME = 100`, `MAX_CONDITIONS = 20`, `MAX_VALUES = 100`, `MAX_TEXT = 200`, the `Condition` / `Definition` / `Reach` types of data-model.md, `readSegmentForm(fd)` (fields of contracts/routes.md § Form fields: `name`, `who`, `pipelineId`, `stageId`, `dealStatus`, `c.<n>.field`, repeated `c.<n>.value`, `c.<n>.from`, `c.<n>.to`, `id`, `version`, `intent`), `validateSegmentForm(input, options, stored?)` (data-model.md § Validation, in form order; ids kept only when among the options), `readConditions(json)`, `formToValues(def)`
- [ ] T008 Extract in `src/server/custom-fields/values.ts` the `exists (select 1 from custom_values cv where cv.field_id = … and cv.<col> = <alias>.id and …)` probe into exported `customProbe(db, field, alias, test)`; `customListParts` calls it with unchanged behaviour (research.md §4); existing `tests/integration/custom-lists.test.ts` stays green unchanged
- [ ] T009 Create `src/server/segments/reach.ts`: `reachWhere(db, viewerId, def, fields)` on `persons p` = `visiblePerson(db, viewerId, "p")` + "Who" (`everyone`: nothing; `pipeline` / `stage`: `exists (select 1 from deals d join stages s on s.id = d.stage_id where d.archived_at is null and visibleDeal(db, viewerId, "d") and s.pipeline_id = $pipeline [and d.stage_id = $stage] [and d.status = $status unless 'all'] and (d.person_id = p.id or exists (select 1 from deal_people dp where dp.deal_id = d.id and dp.person_id = p.id)))`) + every condition as research.md §4 (a condition on a custom field that is missing, not `kind = 'person'` or of another type → `false`); `countReach(viewerId, def, db = sql)` one query with `count(*) filter` for `archived` (`p.archived_at is not null`), `unsubscribed` (not archived, `consent = 'unsubscribed'`), `noEmail` (not archived, subscribed, no `person_emails` row), `reaches` (the rest); `reachedPeople(db, viewerId, def)` selecting `p.id` and the first email by `position`

**Checkpoint**: migration, messages, pure rules and the reach query exist; stories can start.

---

## Phase 3: User Story 1 - Save a segment and see how many people it reaches (Priority: P1) 🎯 MVP

**Goal**: Segments page in the sidebar; create a segment for everyone, a pipeline or a stage with a deal status; see
"Reaches <n> people now", what was left out and why, on the form, the segment page and the table.

**Independent Test**: with fake people and deals, save "Exec Dinner — all" and "Sales — Proposal"; each is listed
with the expected count; unsubscribed, archived and address-less people are left out under the right reason; a
person on two deals of the pipeline is counted once.

### Tests for User Story 1

- [ ] T010 [P] [US1] Write `tests/integration/segments-reach.test.ts` (Who part): US1 scenario 2 exactly (stage with 2 open deals — main contact + other linked person, main contact only — 1 won deal, 1 archived open deal → "Open deals" 3, "All deals" adds the won deal's people, the archived deal's never); pipeline vs stage; Won / Lost; reasons counted once each in the order archived → unsubscribed → no email (spec Edge "Left-out reasons"); a person on 2 deals and with 2 addresses counted once (US1 scenario 7, FR-009); nobody → 0; stage move lowers the count; privacy: Grace's private person makes her "Everyone" count 1 higher than Ada's and a private deal Ada cannot see adds none of its people to Ada's pipeline count (covers FR-002, FR-003, FR-008–FR-010, SC-002, SC-003)
- [ ] T011 [P] [US1] Write `tests/integration/segments.test.ts` (create part): `createSegment` saves name, who, ids, status `open` first, `created_by`/`updated_by`, `version = 1`; name exists ignoring case and outer spaces → "There is already a segment called <name>." (also under a race: unique violation `23505` caught); unknown pipeline / stage id on a new segment → "Choose a pipeline." / "Choose a stage."; `countDefinition` never writes; `listSegments` ordered by `lower(name), id` with summary ("Everyone in the CRM", "People on all deals of Exec Dinner", "People on open deals of Sales · Proposal + 3 conditions"), count and last changed by (covers US1 scenarios 1–6, FR-001, FR-005, FR-007)
- [ ] T012 [P] [US1] Extend `tests/unit/segment-rules.test.ts` with `describeSegment` summaries, WHO lines ("Deals: Open deals", "Pipeline · stage: Sales · Proposal", "Pipeline: Sales") and "+ 1 condition" / "+ <n> conditions" (covers US1 scenario 4)
- [ ] T013 [P] [US1] Extend `tests/unit/nav.test.ts`: `mainNav` has `{ href: "/segments", label: "Segments" }` right after Activities (covers FR-001)

### Implementation for User Story 1

- [ ] T014 [US1] Add `describeSegment(def, names)` to `src/server/segments/rules.ts` (summary, WHO and CONDITIONS lines, "(deleted)" for a missing name, `broken`) and format "Last changed by <user> · <d Mon yyyy HH:mm>" with the existing UK date helpers
- [ ] T015 [US1] Create `src/server/segments/segments.ts`: `segmentFormOptions(def | null)` (pipelines with stages in position order; lead sources and labels with `removed_at is null` or already in the segment; all organisations, archived marked; every user, deactivated marked; every `kind = 'person'` custom field with offered choices plus removed ones already in the segment — research.md §8), `createSegment(actorId, input)` (validate, `lower(name)` check, new ids must exist, insert in one `sql.begin()`), `countDefinition(viewerId, input)`, `getSegment(viewerId, id)`, `listSegments(viewerId)` (one `countReach` per segment in sequence; names for all segments loaded with a few `= any($ids)` queries)
- [ ] T016 [US1] Create `src/app/(app)/segments/ReachBlock.tsx` ("Reaches <n> people now", "Left out: <a> archived · <b> unsubscribed · <c> with no email address", the count note) and `src/app/(app)/segments/MultiPicker.tsx` (client: filters options by typed text, chosen values as removable chips, posts repeated `c.<n>.value`)
- [ ] T017 [US1] Create `src/app/(app)/segments/SegmentForm.tsx` (client, `useActionState(saveSegmentAction)`): name, Who radios ("Everyone in the CRM", "People on the deals of a pipeline", "People on the deals of a stage"), pipeline select, stage select filtered by pipeline, deal status select ("Open deals" first, "Won deals", "Lost deals", "All deals"), `[ SAVE ]` (`intent=save`), `[ COUNT AGAIN ]` (`intent=count`), `[ CANCEL ]`, errors at the top (`role="alert"`) and beside inputs, values kept after a refusal, `ReachBlock` under the inputs
- [ ] T018 [US1] Create `src/app/(app)/segments/actions.ts` (`"use server"`): `saveSegmentAction(prev, formData)` — `requireUser()` first; `intent=count` → `countDefinition` (no write); `intent=save` → `createSegment` / `updateSegment`, `revalidatePath("/segments")`, `redirect("/segments/<id>")` on success; fixed redirect paths only
- [ ] T019 [US1] Create `src/app/(app)/segments/page.tsx` (design C: "// CAMPAIGNS", "Segments", `[ NEW SEGMENT ]`, table Name link · Who · Reaches now · Last changed, `segments_none`, flash notice), `segments/new/page.tsx` (count of "Everyone in the CRM" on open), `segments/[id]/page.tsx` (name, last changed, count strip Reaches now · Archived · Unsubscribed · No email address, note, "// WHO", "// CONDITIONS", `[ EDIT ]`, `[ DELETE ]`), `segments/[id]/not-found.tsx` ("This segment no longer exists."); every page calls `requireUser()` first; `[id]` through `parseId`, unknown → `notFound()`; names as text nodes
- [ ] T020 [US1] Add `{ href: "/segments", label: "Segments" }` after Activities in `mainNav` of `src/app/(app)/nav.ts` with a `// SF-120` comment; CSS for the count strip, condition rows and chips in `src/app/globals.css` with existing tokens only (docs/DESIGN.md)

**Checkpoint**: US1 works on its own (MVP).

---

## Phase 4: User Story 2 - Filter by person fields (Priority: P1)

**Goal**: `[ ADD CONDITION ]` on any Who choice: lead source, label, organisation, owner, role and every people custom
field; a person must match all conditions.

**Independent Test**: "Inbound, labelled Hot, owned by a fake user" on "Everyone in the CRM" equals the People list
total with the same filters minus unsubscribed, archived and address-less people.

### Tests for User Story 2

- [ ] T021 [P] [US2] Extend `tests/integration/segments-reach.test.ts` (conditions): each field — lead source, label (any of the chosen), organisation (an archived organisation still counts its people), owner (a deactivated owner still matches), role (contains, ignoring case), custom text / long text (contains), number / money / date (from, to, both), single choice (ids, "Empty", both), multiple choice (has any), yes / no / empty; several conditions AND-ed; removed label / lead source / custom choice still match; a condition on a deleted custom field matches nobody, even "Empty" (covers US2 scenarios 1–2, FR-004, spec Edge "Removed things", "Archived organisations")
- [ ] T022 [P] [US2] Write `tests/integration/segments-people-list.test.ts`: the US2 independent test (segment count = `listPeople` total with the same filters minus left-out people) and the People list custom filters give the same results as before the `customProbe` extraction (covers US2, SC-002)
- [ ] T023 [P] [US2] Extend `tests/unit/segment-rules.test.ts` with condition validation: no value → "Lead source: choose at least one.", "<field>: type the text to look for.", "<field>: give a from or a to.", "<field>: choose Yes, No or Empty."; > 100 values → "<field>: choose at most 100."; text > 200 → "<field>: at most 200 characters."; bad number / amount / date → "<field>: <SF-115 message>" (`custom_number_invalid`, `custom_money_invalid`, `custom_date_invalid`); from after to → "<field>: the from must not be after the to."; > 20 conditions → "A segment can have at most 20 conditions."; a made-up id not among the options is dropped and never shown back (covers US2 scenarios 3–4, spec Edge "Unsafe input")

### Implementation for User Story 2

- [ ] T024 [US2] Complete condition handling in `src/server/segments/rules.ts` (`validateSegmentForm` per field type with the limits `MAX_CONDITIONS = 20`, `MAX_VALUES = 100`, `MAX_TEXT = 200`; reuse `parseNumber` / `canonicalNumber`, `parseMoney`, `parseDate`) and `describeSegment` CONDITIONS lines (values joined " or ", ranges "from … to …", "(removed)" / "(archived)" / "(deactivated)" marks)
- [ ] T025 [US2] Complete the condition SQL in `src/server/segments/reach.ts` (research.md §4 table: `p.lead_source_id = any($ids)`, label `exists … pl.label_id = any($ids)`, `p.organisation_id = any($ids)`, `p.owner_id = any($ids)`, `p.role ilike '%' || escapeLike(text) || '%'`, custom through `customProbe`: single choice `cv.choice_id = any($ids)` or with `empty` `or not exists (…)`, multiple choice `cv.choice_ids && $ids::bigint[]`)
- [ ] T026 [US2] Add the condition rows to `src/app/(app)/segments/SegmentForm.tsx`: `[ ADD CONDITION ]` (field select first: Lead source, Label, Organisation, Owner, Role, then people custom fields by position), the input fitting the field (`MultiPicker` for choice-like, text for role / text, two inputs for ranges with `type="date"` for dates, select Yes / No / Empty), `[ REMOVE ]` (rows renumbered), "Conditions — people must match all"

**Checkpoint**: US1 and US2 work.

---

## Phase 5: User Story 3 - Edit, rename and delete segments (Priority: P2)

**Goal**: anyone can edit, rename or delete any segment; concurrent edits refused; deleted segments handled.

**Independent Test**: as one user save a segment; as another rename it and change its stage → the Segments page shows
the new name, summary, count and "changed by"; delete it → gone for both.

### Tests for User Story 3

- [ ] T027 [P] [US3] Extend `tests/integration/segments.test.ts` (edit / delete): another user edits and renames (`updated_by` changes, `version + 1`); stale version → "Someone else changed this segment. Open it again to see their changes." and nothing saved; edit or delete of a deleted segment → "This segment no longer exists."; delete returns the name for "Segment <name> deleted."; a segment whose pipeline, stage, organisation or custom field was deleted is listed, shows "(deleted)", is `broken`, matches nobody through that part and can still be saved keeping the stored id (covers US3 scenarios 1–4, FR-006, FR-012, FR-013)

### Implementation for User Story 3

- [ ] T028 [US3] Add to `src/server/segments/segments.ts`: `updateSegment(actorId, id, version, input)` (`update segments set …, updated_by, updated_at = now(), version = version + 1 where id = $id and version = $v returning id`; no row → `segment_not_found` if gone else `segment_changed`; name check excludes the segment itself) and `deleteSegment(actorId, id)` (`delete … returning name`, no row → `segment_not_found`)
- [ ] T029 [US3] Add `deleteSegmentAction(formData)` to `src/app/(app)/segments/actions.ts` (`requireUser()` first; flash `segment_deleted` or `segment_not_found`; `redirect("/segments")`) and the `segment_not_found` / `segment_changed` paths of `saveSegmentAction`
- [ ] T030 [US3] Create `src/app/(app)/segments/[id]/edit/page.tsx` (`requireUser()`, "Edit segment", `SegmentForm` with `id`, `version` and the stored definition, its count) and `src/app/(app)/segments/SegmentDeleteConfirm.tsx` shown on `/segments/[id]?confirm=delete` ("Delete the segment <name>? It is deleted for the whole team.", confirm and cancel; same `.confirm` look as `records/DeleteConfirm.tsx`, open to every user); show `segment_broken` on the table row and the segment page

**Checkpoint**: all three stories work.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T031 [P] Create `src/seed/segments.ts` (data-model.md § Fake data: "Fake — everyone", "Fake — Exec Dinner, all deals", "Fake — Sales Proposal, open deals", "Fake — Inbound owned by Ada Fake"; idempotent by name; ids looked up by name; skipped quietly when missing) and register it last in `src/seed/index.ts`; extend `tests/integration/seed.test.ts` (four segments, re-runnable) (covers FR-015)
- [ ] T032 [P] Write `tests/integration/segments-perf.test.ts`: 50 segments over 10,000 people and 5,000 deals → `listSegments` under 2 s (covers SC-004)
- [ ] T033 Append to `docs/DECISIONS.md` the lines of plan.md Build step 10 (design C; Open / Won / Lost / All deals; once per person at the first address, archived → unsubscribed → no email; "(deleted)" and matches nobody; the factory's choices of spec.md § Clarifications marked "(SF-120, decided by the factory, to confirm)"); no "Departs from blueprint" line (no blueprint exception)
- [ ] T034 [P] Update `AGENTS.md` § Layout with `src/server/segments/` (`rules.ts`, `reach.ts`, `segments.ts`), `customProbe` in `custom-fields/values.ts`, `src/app/(app)/segments/`, and `segments` in the seeder list
- [ ] T035 Run `npm run test:schemas && npm test && npm run typecheck` and the by-hand checks of quickstart.md
- [ ] T036 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) and `## Schemas` (each schema's GitHub URL at its commit) — for this change: Supabase Postgres, no fake (real local PostgreSQL 17), no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres (`prepare: false`, `max: 5`, no session state); keep the existing Google Sign-In and Supabase Storage lines and their schemas

---

## Dependencies & Execution Order

- **Setup (T001–T004)** → **Foundational (T005–T009)** → stories.
- **US1 (T010–T020)** needs Foundational. **US2 (T021–T026)** needs US1's form (T017) and `segments.ts` (T015).
  **US3 (T027–T030)** needs US1 (T015, T018, T019); it does not need US2.
- **Polish (T031–T036)** after the stories; T036 is the last task.
- Within a story: tests first (they fail), then rules → reach / domain → actions → pages.

## Parallel Example: User Story 1

```text
T010 tests/integration/segments-reach.test.ts
T011 tests/integration/segments.test.ts
T012 tests/unit/segment-rules.test.ts
T013 tests/unit/nav.test.ts
```

Then T014 → T015 → (T016 ∥ T018) → T017 → T019 → T020.

## Implementation Strategy

1. MVP: Setup + Foundational + US1 → saved segments for everyone / pipeline / stage with their counts. Stop and check
   the US1 independent test.
2. Add US2 (conditions), check the People list parity test.
3. Add US3 (edit, concurrent edits, delete, deleted references).
4. Polish: fake data, performance, docs, test recipe.

## Notes

- Choices made here without asking: tests are included (AGENTS.md asks for them); US2 is ordered after US1 because
  its conditions live in US1's form.
- Every page and action starts with `requireUser()`; all text from `messages.ts`; nothing from the address shown back.
