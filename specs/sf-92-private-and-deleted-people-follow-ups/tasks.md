---

description: "Tasks for SF-92 Private and deleted people: follow-ups"
---

# Tasks: Private and deleted people: follow-ups

**Input**: Design documents from `/specs/sf-92-private-and-deleted-people-follow-ups/`

**Prerequisites**: plan.md (§ Build steps), spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-001, SC-002, SC-004, SC-005): Vitest unit tests, Vitest integration tests against a real local Postgres (`crm_test`), Playwright browser tests through the fake Google login. Each test file (or new `describe`) starts with what it covers (`// covers FR-001, US1 scenario 2`). Within each story, write the tests first and see them fail.

**Organization**: Tasks are grouped by user story. Exact message texts are in `contracts/routes.md` § Messages; use them verbatim, from `src/server/messages.ts` only. No new dependency (`dependencies.json` is `[]`): add no package. No blueprint applies (`blueprints.json` is `[]`), so there are no blueprint tasks and no "Departs from blueprint" line.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US3 from spec.md
- Paths are from the repository root (single Next.js project, see plan.md § Project Structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The schema change. No new table, so `tests/support/reset.ts`, `tests/integration/db-helpers.ts` `resetDb()` and `.factory/run/reset-db.sh` need no change (they already truncate `timeline_events` and `persons`).

- [x] T001 Create `migrations/0003_private_owner_handover.sql` exactly as `data-model.md` § Migration, only transaction-safe statements: drop and re-add `timeline_events_related_person_id_fkey` as `foreign key (related_person_id) references persons (id) on delete set null`; drop and re-add `timeline_events_kind_check` as `check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over'))`; `alter table timeline_events add column related_user_id bigint null references users (id)`; `add constraint timeline_events_related_user_check check ((kind = 'handed_over') = (related_user_id is not null))`; `create index persons_private_owner_idx on persons (owner_id) where private` (no `concurrently`)
- [x] T002 Extend `tests/integration/migrate.test.ts` (`// covers FR-005, FR-011`): on a fresh database after all migrations, deleting a person sets `related_person_id` to null on an organisation event instead of deleting it; inserting kind `handed_over` without `related_user_id`, or `edited` with one, fails with a check violation (23514); the index `persons_private_owner_idx` exists. The existing RLS test still passes (no new table)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Messages, flash codes, timeline reading and the one visibility rule every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 [P] Unit tests in `tests/unit/messages.test.ts` (`// covers FR-016`) for the new codes and templates of `contracts/routes.md` § Messages: exact texts; `templates.private_people(1)` = "1 private person", `(2)` = "2 private people"; `handover_question("Alan Fake", 2, "Margaret Fake")` = "Hand Alan Fake's 2 private people to Margaret Fake?" and the singular form for 1; `handed_over("Margaret Fake", 2)` = "2 private people handed to Margaret Fake."; `person_no_longer_visible("Ada Example")` = "You can no longer see Ada Example: only their creator and owner can."; `messageFor("handover_choose_user")` = "Choose an active user."; templates are not reachable through `messageFor`
- [x] T004 Add to `src/server/messages.ts` every message and template listed in `contracts/routes.md` § Messages (`private_label`, `deleted_person_linked`, `deleted_person_unlinked`, `handover_choose`, `handover_choose_user`, `handover_not_deactivated`, `handover_explain_unchosen`, `handover_button`, `handover_cancel`, `handover_to_label`; templates `private_people`, `handover_question`, `handover_explain`, `handed_over`, `handover_none`, `handed_over_event`, `person_no_longer_visible`), exact texts
- [x] T005 [P] Unit test in `tests/unit/flash.test.ts` (mock `next/headers` cookies) (`// covers FR-003, FR-011`): `readFlash` returns the text only for the allowed codes passed in; `handed_over` needs an integer `count` 1–10,000 (0, -1, 1.5, "2", missing → nothing shown); names longer than 300 chars ignored; invalid JSON ignored
- [x] T006 Extend `src/server/records/flash.ts`: codes `person_deleted`, `organisation_deleted`, `person_no_longer_visible`, `handed_over`, `handover_none`; `setFlash({ code, name, count? })` stores `{code, name, count}`; `readFlash(allowed: FlashCode[])` checks the code is in `allowed` and renders through `templates` (count rules as T005); update the existing callers in `src/app/(app)/people/page.tsx` and `src/app/(app)/organisations/page.tsx` to the array form
- [x] T007 Change `src/server/records/visibility.ts` to `(not p.private or p.created_by = $viewer or p.owner_id = $viewer)` and its comment ("seen only by their creator and their owner, admins included"); update the header comment of `src/server/records/people.ts`
- [x] T008 Extend `src/server/records/timeline.ts`: `EventKind` + `"handed_over"`; `recordEvent` accepts `relatedUserId` and writes `related_user_id`; `readTimeline` adds `left join users ru on ru.id = e.related_user_id` and returns `relatedUserName: string | null`; the organisation branch keeps `e.related_person_id is null or visiblePerson(rp)` (a null related person on a linked/unlinked event = a deleted person)
- [x] T009 Update `src/app/(app)/records/Timeline.tsx`: `person_linked`/`person_unlinked` with `relatedPerson === null` render `messages.deleted_person_linked` / `messages.deleted_person_unlinked` + `by(actor)` as plain text (no link; replaces "Someone"); `handed_over` renders `templates.handed_over_event(relatedUserName ?? "")` + `by(actor)`

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - The owner of a private person sees them (Priority: P1) 🎯 MVP

**Goal**: A private person is visible to their creator and their current owner, nobody else; either can change "Private"; a user who saves themselves out of sight lands on the People list with a notice.

**Independent Test**: As A add a private person owned by B; B finds them in People, search, organisation page and count, drawer and page; C and an admin do not; B edits, unticks Private, or gives the person to C and loses sight of them.

### Tests for User Story 1

- [x] T010 [P] [US1] Outside service — Supabase Postgres has no public schema on GitHub and no fake: integration tests use a real local PostgreSQL 17 (as `.factory/test-env.md` says). Follow Supabase's docs (https://supabase.com/docs/guides/database/connecting-to-postgres) as SF-90 does: the new code keeps to the transaction-mode pooler limits (no session state, no session advisory locks; every multi-statement change — `updatePerson`'s visibility re-check, `deletePerson`, `handOverPrivatePeople` — in one `sql.begin()` transaction; connection limit `max: 5` unchanged). The existing `tests/integration/migrate.test.ts` check (T002) is the check that `0003` applies on a fresh PostgreSQL; the errors copied are Postgres's own (23505 unique, 23514 check, 23503 foreign key) since the database is real
- [x] T011 [P] [US1] Integration tests in `tests/integration/private.test.ts` (`// covers FR-001, SC-001, US1 scenarios 1–2`): a private person created by A and owned by B is returned to B (and A) by `listPeople` (list, search, owner filter, counts), `peopleFilterOptions`, `getPerson`, `peopleOf` and the organisation people count, `readTimeline` on the person, and organisation timeline events about them; returned to nobody else, including an active admin who is neither (`not found` on `getPerson`, excluded from every count)
- [x] T012 [P] [US1] Integration tests in `tests/integration/private.test.ts` (`// covers FR-002, FR-003, US1 scenarios 3, 4, 6`): owner B edits the role → saved, event "edited" with fields `Role`; owner B unticks private → person visible to C, event fields include `Private`; a user who is neither creator nor owner (shared person) sends `private: true` → ignored, stays shared; owner B changes the owner to C on a private person → result `{ status: "saved", visible: false, name: "Ada Example" }`, then B cannot get her, A and C can; the creator changing the owner keeps `visible` true
- [x] T013 [P] [US1] Integration tests in `tests/integration/duplicates.test.ts` (`// covers FR-004, US1 scenario 5`): B (owner, not creator) adding a person with private Ada's address gets `duplicate_email` with Ada's name and link; C gets `duplicate_email_hidden` with no name
- [x] T014 [P] [US1] Playwright tests in `tests/e2e/private.spec.ts` (`// covers US1 scenarios 1, 2, 4, 6`): as Ada Fake add a private person with owner Linus Fake; as Linus see them in the People list with the "Private" badge, in search and on the organisation page; the edit form shows "Private (only the creator and the owner can see this person)"; change the owner to Margaret Fake → People list shows "You can no longer see <name>: only their creator and owner can." and the person is gone; as Grace Fake (admin, neither) the page address shows "Page not found."

### Implementation for User Story 1

- [x] T015 [US1] In `src/server/records/people.ts` `updatePerson`: `private: current.createdBy === actorId || current.owner.id === actorId ? value.private : current.private` (owner as before the save); comment "creator or owner (FR-002)"; at the end of the transaction re-select `persons p where p.id = $id and visiblePerson(db, actorId)`; if none, return `{ status: "saved", id, visible: false, name }` (name from the database, `NAME()`)
- [x] T016 [US1] In `src/server/records/common.ts` widen `SaveResult`'s saved variant to `{ status: "saved"; id: number; visible?: false; name?: string }`
- [x] T017 [US1] In `src/app/(app)/people/actions.ts` `answer()`: when saved with `visible === false`, `await setFlash({ code: "person_no_longer_visible", name })`, revalidate `/people` and `/organisations`, redirect `/people`
- [x] T018 [US1] In `src/app/(app)/people/page.tsx` read `readFlash(["person_deleted", "person_no_longer_visible"])` and show it in the existing notice spot
- [x] T019 [P] [US1] In `src/app/(app)/people/[id]/edit/page.tsx` set `canSetPrivate={person.createdBy === user.id || person.owner.id === user.id}`; in `src/app/(app)/records/PersonForm.tsx` use `messages.private_label` for the checkbox text

**Checkpoint**: US1 works on its own; the MVP.

---

## Phase 4: User Story 2 - Deleting a person keeps the history on other records (Priority: P2)

**Goal**: Deleting a person keeps organisation linked/unlinked events with user and time, shown as "A deleted person …"; events about a person private when deleted are removed.

**Independent Test**: Link Ada to Fakeco Ltd as Linus, delete Ada as an admin; Fakeco Ltd's timeline shows "A deleted person was linked by Linus Fake" at the original time, no link, no name.

### Tests for User Story 2

- [x] T020 [P] [US2] Integration tests in `tests/integration/archive-delete.test.ts` (`// covers FR-005, FR-006, FR-007, SC-002, US2 scenarios 1–4`): link then unlink Ada from an organisation, delete her → `readTimeline` on the organisation still returns both events in original order with actor and `created_at`, `relatedPerson` null; no row anywhere still holds her id, name, email or phone (`timeline_events.related_person_id` null, `person_emails`/`person_phones`/`person_labels` empty for her); deleting a person still linked adds no "unlinked" event; deleting a private person (as an admin who is her owner, so she is visible) removes every event with her `related_person_id`, and nobody — former creator and owner included — sees an event about her; deleting a person never linked leaves other records' events unchanged
- [x] T021 [P] [US2] Playwright test in `tests/e2e/archive-delete.spec.ts` (`// covers US2 scenario 1`): as Linus Fake link a new person to Fakeco Ltd; as Ada Fake (admin) delete the person; Fakeco Ltd's page timeline shows "A deleted person was linked by Linus Fake" as plain text (no link) with a date and time, and the person's name appears nowhere on the page

### Implementation for User Story 2

- [x] T022 [US2] In `src/server/records/people.ts` `deletePerson`: after the admin check, `select p.private from persons p where p.id = $id and visiblePerson(db, actorId) for update` (none → `not_found`); if private, `delete from timeline_events where related_person_id = $id`; then delete the person as today (FK nulls the rest; no "unlinked" event). Update the comment above it (data-model.md § Deleting a person)

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 - An admin hands a deactivated user's private people to someone else (Priority: P2)

**Goal**: The Users page shows "N private people" and `[ HAND OVER ]` on deactivated users who own private people; the design-B panel hands all of them to one active user in one all-or-nothing step, never showing who they are.

**Independent Test**: Alan Fake (deactivated) owns two private people; as an admin hand them to Margaret Fake; Margaret sees both, private, owner Margaret, timeline "Handed to Margaret Fake by <admin>", and a duplicate address names them.

### Tests for User Story 3

- [x] T023 [P] [US3] Integration tests in new `tests/integration/handover.test.ts` (`// covers FR-009–FR-013, SC-004, SC-005, US3 scenarios 1, 3–7`) for `src/server/records/handover.ts`: `privatePeopleCounts()` counts private people (archived included) owned by deactivated users only (no entry for active users, none for shared people); `handOverPrivatePeople(admin, alan, margaret)` → `{status: "handed", count: 2, toName: "Margaret Fake"}`, both persons now `owner_id` Margaret, still private, `created_by` and `archived_at` unchanged, `version` +1, one `handed_over` event each with `actor_id` admin and `related_user_id` Margaret; Margaret's `listPeople` (owner filter) and `getPerson` return them; adding a person with one of their addresses as Margaret gives `duplicate_email` with the name; after Margaret removes the address, Linus can add it; a private person created by Alan but owned by an active user is not touched; one created by an active user and owned by Alan is handed over and its creator still sees it; second call → `{status: "none", fromName: "Alan Fake"}`
- [x] T024 [P] [US3] Refusal and race tests in `tests/integration/handover.test.ts` (`// covers FR-012, SC-005, spec Edge Cases`): non-admin actor and a deactivated admin → `forbidden`; from user active → `not_deactivated`; to user deactivated, missing, or equal to from → `choose_user`; in every refusal no `persons` row and no `timeline_events` row changes; handing over to the acting admin is allowed; recipient deactivated in a concurrent transaction before the handover commits → `choose_user`, nothing changed; two admins handing over at once → one `handed` (count 2), the other `none`; an edit form opened before the handover then saved by the old creator gets `edit_conflict`
- [x] T025 [P] [US3] Integration test in `tests/integration/users.test.ts` (`// covers FR-009`): `listUsers()` returns `private_people` = count for deactivated users and 0 for active users even when they own private people
- [x] T026 [P] [US3] Playwright tests in new `tests/e2e/handover.spec.ts` (`// covers US3 scenarios 1–4, 6, 7, SC-003`): seed Alan Fake's private people through the fake data or direct inserts; as Ada Fake (admin) the Users page shows "2 private people" and `[ HAND OVER ]` only on Alan's row (not on active users); `[ HAND OVER ]` opens the panel with "They stay private. …"; Alan not among the choices; `[ HAND OVER ]` with no choice → "Choose an active user."; `[ CANCEL ]` closes it with nothing changed; choose Margaret Fake → "Hand Alan Fake's 2 private people to Margaret Fake?" → confirm → "2 private people handed to Margaret Fake." and the row has no count or `[ HAND OVER ]`; the panel never shows the people's names; as Margaret both appear under owner Margaret Fake, "Private" badge, timeline "Handed to Margaret Fake by Ada Fake"; as Linus Fake posting the handover form directly → "You don't have access to this page." and nothing changes

### Implementation for User Story 3

- [x] T027 [US3] Create `src/server/records/handover.ts`: `privatePeopleCounts(db = sql): Promise<Map<number, number>>` (`select p.owner_id::int, count(*)::int from persons p join users u on u.id = p.owner_id where p.private and u.status = 'deactivated' group by p.owner_id`); `handOverPrivatePeople(actorId, fromUserId, toUserId)` in one `sql.begin()` following data-model.md § Handover steps 1–8 exactly (lock `users` rows `where id in (actor, from, to) order by id for update`; actor active admin else `forbidden`; from `deactivated` else `not_deactivated`; to `active` and ≠ from else `choose_user`; `update persons set owner_id = $to, version = version + 1 where private and owner_id = $from returning id`; 0 → `{status: "none", fromName}`; one `recordEvent(db, { personId, kind: "handed_over", actorId, relatedUserId: to })` each; → `{status: "handed", count, toName}`); it never returns person ids or names
- [x] T028 [US3] In `src/server/users.ts` `listUsers()` add `private_people` (`case when status = 'deactivated' then (select count(*)::int from persons p where p.private and p.owner_id = users.id) else 0 end`) to `UserRow`
- [x] T029 [US3] Add `handOver(formData)` to `src/app/(app)/admin/users/actions.ts` per contracts/routes.md § `handOver`: `assertAdminForAction()` first; parse `userId`, `toUserId` (invalid/empty → redirect `/admin/users?handover=<userId>&error=handover_choose_user`); call `handOverPrivatePeople`; map `handed` → `setFlash({ code: "handed_over", name: toName, count })`, `none` → `setFlash({ code: "handover_none", name: fromName })`, `choose_user` → `?handover=<userId>&error=handover_choose_user`, `not_deactivated` → `?error=handover_not_deactivated`, `forbidden` → `/admin/users`; `revalidatePath("/admin/users")` and `revalidatePath("/people")`
- [x] T030 [P] [US3] Create `src/app/(app)/admin/users/HandOverPanel.tsx` (`'use client'`): props `fromUserId`, `fromName`, `count`, `users: { id: number; name: string }[]`, `error?: string`, `action`; a `<form action={action}>` with hidden `userId`, `<select name="toUserId" aria-label={messages.handover_to_label}>` first option `messages.handover_choose` (value ""), `[ HAND OVER ]` submit (`btn solid`, `messages.handover_button`), `[ CANCEL ]` link to `/admin/users` (`messages.handover_cancel`); question line `templates.handover_question(fromName, count, chosen)` once chosen (empty before); explanation `templates.handover_explain(chosen)` or `messages.handover_explain_unchosen`; `error` shown with `role="alert"` inside the panel
- [x] T031 [US3] Update `src/app/(app)/admin/users/page.tsx`: accept `searchParams.handover` (only `^[1-9][0-9]{0,15}$`); add `handover_choose_user` and `handover_not_deactivated` to `PAGE_ERRORS` (the first shown inside the panel when it is open, else above the table); on a deactivated row with `private_people > 0` show `<span className="pp">{templates.private_people(n)}</span>` after the Deactivated badge and a `[ HAND OVER ]` link to `/admin/users?handover=<id>` before `[ REACTIVATE ]`; when `handover` is a deactivated user with > 0, render `HandOverPanel` above the add row with active users except that user, sorted by name (the admin included); show `readFlash(["handed_over", "handover_none"])` above the table
- [x] T032 [P] [US3] Add to `src/app/globals.css` the `.handover` panel (same look as the delete confirmation from `DeleteConfirm`) and `.pp`, copied from option B in `specs/sf-92-private-and-deleted-people-follow-ups/design-options.html`

**Checkpoint**: All three stories work independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T033 [P] Extend `src/seed/people.ts` per data-model.md § Fake data: after the existing loop, add once (skip when the email is taken) Pat Privatefake (`pat.privatefake@example.com`, created by Ada Fake, owned by Linus Fake), Robin Leftfake (`robin.leftfake@example.com`, created and owned by Alan Fake, linked to Fakeco Ltd with a `person_linked` event, actor null) and Sam Leftfake (`sam.leftfake@example.net`, created and owned by Alan Fake), all `private = true`, each with an `added` event (actor null) (FR-015)
- [x] T034 [P] Update `tests/integration/seed.test.ts` (`// covers FR-015`): after seeding there is ≥ 1 private person whose `owner_id <> created_by` and ≥ 1 private person owned by Alan Fake; a second run adds nothing (row counts unchanged)
- [x] T035 [P] Append to `docs/DECISIONS.md` the three lines from plan.md § Build steps 15 (FR-014), plus a line for each factory choice in spec.md Clarifications that the Plan Review confirmed
- [x] T036 [P] Update `README.md`: the Users page's hand-over for deactivated users' private people, and the new fake private people (Pat Privatefake for Linus Fake; Robin and Sam Leftfake for Alan Fake)
- [x] T037 Run `npm test && npm run test:e2e && npm run typecheck` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test` and walk through `specs/sf-92-private-and-deleted-people-follow-ups/quickstart.md` § Manual scenarios
- [x] T038 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) and `## Schemas` (each schema's GitHub URL at its commit). Keep the existing Google Sign-In and Supabase Postgres lines; the Postgres line (no fake, real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres) now also names `migrations/0003_private_owner_handover.sql` and `handOverPrivatePeople`'s single transaction; `## Schemas` keeps `oauth2-api.json` at its commit (this feature adds no schema)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: after Setup; blocks every story (messages, flash, visibility, timeline).
- **US1 (Phase 3)**: after Foundational. The MVP.
- **US2 (Phase 4)**: after Foundational; independent of US1 (uses only the timeline change from T008/T009).
- **US3 (Phase 5)**: after Foundational; its acceptance scenario 4 (the new owner sees the people) relies on the visibility change T007 (Foundational), not on US1's form changes.
- **Polish (Phase 6)**: after the stories it documents; T038 is the last task.

### Within Each User Story

- Tests first, see them fail; then domain code (`src/server/…`), then actions, then pages/components.
- T015 and T016 touch the same result type: do T016 before or with T015. T022 and T015 both edit `people.ts`: not in parallel.

### Parallel Opportunities

- T003 and T005 (unit tests) in parallel; T004 and T006 after their tests.
- Within US1: T010–T014 in parallel (different files or `describe` blocks); T019 in parallel with T015–T018.
- Within US3: T023–T026 in parallel; T030 and T032 in parallel with T027–T029.
- US2 and US3 can be built in parallel by different people once Phase 2 is done.
- Polish T033–T036 in parallel.

---

## Parallel Example: User Story 3

```bash
# Tests together:
Task: "Integration tests in tests/integration/handover.test.ts (rules and outcomes)"
Task: "Integration test in tests/integration/users.test.ts (private_people)"
Task: "Playwright tests in tests/e2e/handover.spec.ts"

# Then, in parallel with the domain code:
Task: "Create src/app/(app)/admin/users/HandOverPanel.tsx"
Task: "Add .handover and .pp to src/app/globals.css"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (migration) and Phase 2 (messages, flash, visibility, timeline).
2. Phase 3 (US1): owners see private people. Stop and validate: `npm test`, `tests/e2e/private.spec.ts`.

### Incremental Delivery

1. + US2 (anonymous events after delete) → validate `archive-delete` tests.
2. + US3 (hand-over) → validate `handover` tests.
3. Polish: seed, docs, full test run, test recipe.

## Notes

- Never show text from the URL: `?handover=` is a numeric id, `?error=` an allow-listed code; names come from the database through `crm_flash`.
- The admin must never see a handed-over person's name or details: the domain function returns only a count and the recipient's name.
- Commit nothing: the factory commits.
