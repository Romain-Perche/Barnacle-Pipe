# Tasks: Hand-over of private deals

**Input**: Design documents from `specs/sf-97-hand-over-of-private-deals/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: included: `AGENTS.md` requires tests, each naming what it covers (`// covers FR-004, US1 scenario 4`).

**Outside services / blueprints**: none (`plan.md` has no `## Outside services`; `blueprints.json` is `[]`), so
there is no schema download task, no blueprint task and no `.factory/test-env.md` services task.

**Environment for every test command**:
`export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 = combined hand-over (people + deals), US2 = user with only private deals

---

## Phase 1: Setup

No setup: no new package (`dependencies.json` is `[]`), no migration (`timeline_events` already accepts
`deal_id` with kind `handed_over`, migration `0004_pipelines_deals.sql`).

---

## Phase 2: Foundational (blocks both stories)

- [x] T001 [P] In `src/server/messages.ts`: change `messages.handover_not_deactivated` to "Only a deactivated user's private records can be handed over."; add `messages.handover_explain_unchosen_records` = "They stay private. The user you choose becomes their owner and can see them. You will not see what they are."; add a `privateDeals(n)` helper ("1 private deal" / "N private deals") beside `privatePeople`; add a `recordsPhrase(people, deals)` helper joining the non-zero labels with " and "; in `templates` add `private_records(people, deals)` (non-zero labels joined by " · "), change `handover_question(from, people, deals, to)` to `` `Hand ${from}'s ${recordsPhrase} to ${to}?` ``, `handover_explain(to, deals)` to end "You will not see what they are." when `deals > 0` and keep SF-92's "You will not see who they are." when `deals === 0`, `handed_over(name, people, deals)` to `` `${recordsPhrase} handed to ${name}.` ``, `handover_none(name)` to `` `${name} has no private people or deals to hand over.` ``; remove `templates.private_people` if nothing uses it any more
- [x] T002 [P] In `src/server/users.ts`: add `private_deals: number` to `UserRow` and to `listUsers()` as `case when status = 'deactivated' then (select count(*)::int from deals d where d.private and d.owner_id = users.id) else 0 end as private_deals` (archived deals included, FR-001); update the comment above the field
- [x] T003 In `src/server/records/handover.ts`: rename `handOverPrivatePeople` to `handOverPrivateRecords` (same arguments); change the `"handed"` result to `{ status: "handed"; people: number; deals: number; toName: string }`; inside the existing `sql.begin`, after the unchanged user-row lock and refusals, run `update deals set owner_id = ${to.id}, version = version + 1 where private and owner_id = ${from.id} returning id::int as id` next to the persons update; return `{ status: "none", fromName }` only when both lists are empty; call `recordEvent(db, { dealId: id, kind: "handed_over", actorId, relatedUserId: to.id })` for each moved deal; do not touch `created_by`, `stage_id`, `stage_entered_at`, `archived_at` or `deal_stage_periods` and never call `transferDeal` (FR-004); return no id or title (SC-005); update the header comment
- [x] T004 [P] In `src/server/records/flash.ts`: add `deals?: number` to `Flash` and store it in the cookie JSON next to `count` (people); in `render` for `handed_over` accept only integers 0..10 000 for `count` and `deals` (`deals` missing = 0) with `count + deals >= 1`, else return `undefined`; build the text with `templates.handed_over(name, count, deals)`; update the header comment example
- [x] T005 In `src/app/(app)/admin/users/actions.ts`: import and call `handOverPrivateRecords`; on `"handed"` call `setFlash({ code: "handed_over", name: result.toName, count: result.people, deals: result.deals })`; add `revalidatePath("/deals")` after `revalidatePath("/people")`; keep every refusal redirect unchanged (contracts/routes.md); update the comment (depends on T003, T004)
- [x] T006 Update callers of the renamed function and changed templates so `npm run typecheck` passes: `tests/integration/handover.test.ts` (`handOverPrivateRecords`, `result.people` instead of `result.count`), `tests/unit/messages.test.ts` and `tests/unit/flash.test.ts` (new signatures and the new "not deactivated" and "none" texts) (depends on T001–T005)

**Checkpoint**: `npm run typecheck` passes; existing SF-92 tests pass with the new wording.

---

## Phase 3: User Story 1 - The hand-over also hands over private deals (Priority: P1) 🎯 MVP

**Goal**: one admin action hands a deactivated user's private people and private deals to an active user.

**Independent Test**: Alan Fake creates 1 private person and 2 private deals (1 archived), is deactivated; an
admin hands over to Margaret Fake; Margaret sees the open deal on her board ("Private" badge, owner Margaret,
history line), the archived one is hers too; Linus and the admin see neither.

### Tests for User Story 1

- [x] T007 [P] [US1] In `tests/unit/messages.test.ts` add tests (`// covers FR-002, FR-003, FR-006, US1 scenarios 1–3`): `templates.private_records(2, 1)` = "2 private people · 1 private deal", `(1, 2)` = "1 private person · 2 private deals"; `handover_question("Alan Fake", 2, 1, "Margaret Fake")` = "Hand Alan Fake's 2 private people and 1 private deal to Margaret Fake?"; `handover_explain("Margaret Fake", 1)` = "They stay private. Margaret Fake becomes their owner and can see them. You will not see what they are."; `handed_over("Margaret Fake", 2, 1)` = "2 private people and 1 private deal handed to Margaret Fake."; `handover_none("Alan Fake")` = "Alan Fake has no private people or deals to hand over."; `messageFor("handover_not_deactivated")` = "Only a deactivated user's private records can be handed over."
- [x] T008 [P] [US1] In `tests/unit/flash.test.ts` add tests (`// covers FR-006`): `setFlash({ code: "handed_over", name: "Margaret Fake", count: 2, deals: 1 })` reads back "2 private people and 1 private deal handed to Margaret Fake."; a cookie without `deals` still reads "2 private people handed to Margaret Fake."; `count: 0, deals: 0`, a negative, a fraction or 10 001 give `undefined`
- [x] T009 [US1] In `tests/integration/handover.test.ts` add tests for `handOverPrivateRecords` (`// covers FR-001, FR-004, FR-005, FR-007, SC-001, US1 scenarios 3–6`): Alan owns 2 private people and 2 private deals (1 archived); after the hand-over to Margaret both deals have `owner_id` Margaret, `private` true, the same `created_by`, `stage_id`, `stage_entered_at`, `value_pence`, `organisation_id`, `person_id`, `expected_close_on`, `archived_at`, `version + 1`; each has exactly one new `timeline_events` row (`kind 'handed_over'`, `actor_id` admin, `related_user_id` Margaret) and no new `moved` event or `deal_stage_periods` row; `readTimeline(margaret, { dealId })` returns it with `relatedUserName` "Margaret Fake"; the result is `{ status: "handed", people: 2, deals: 2, toName: "Margaret Fake" }`; no private deal owned by Alan is left
- [x] T010 [US1] In `tests/integration/handover.test.ts` add edge-case tests (`// covers FR-001, FR-007, spec Edge Cases`): a private deal created by Alan but owned by active B keeps owner B and is not counted; a private deal created by active A and owned by Alan goes to Margaret and both A and Margaret see it through `visibleDeal`; a shared deal owned by Alan keeps owner Alan and is not counted; after the hand-over Linus and the admin do not see the handed deals (board query and deal read return nothing); after reactivating Alan, Alan sees the private deals Alan created and not those Alan only owned; handing over to the acting admin makes the admin the owner
- [x] T011 [US1] In `tests/integration/handover.test.ts` add refusal and race tests (`// covers FR-008, SC-004, spec Edge Cases`): non-admin actor, inactive or same recipient, active "from" user each leave every deal's owner and version unchanged; a second admin's hand-over after the first returns `{ status: "none" }`; Alan's only private deal made shared by its active creator before confirming, with no private people, returns `"none"` and the deal keeps owner Alan; two concurrent hand-overs move each deal once (one `handed_over` event per deal); a deal edit with the pre-hand-over `version` is refused as stale
- [x] T012 [US1] In `tests/integration/handover.test.ts` extend the `listUsers` tests (`// covers FR-002, US1 scenario 1`): `private_deals` counts private deals, archived included, owned by deactivated users only, 0 for active users and not counting shared deals or deals they only created
- [x] T013 [US1] In `tests/e2e/handover.spec.ts` add a browser test (`// covers US1 independent test, scenarios 1–6, SC-003, SC-005`): set up Alan's 1 private person and 2 private deals (1 archived) as in the existing test; as admin the row shows "1 private person · 2 private deals" and no deal title appears anywhere on the Users page; the panel question and explanation match contracts/routes.md; after confirming the notice reads "1 private person and 2 private deals handed to Margaret Fake." and the row shows no count or `[ HAND OVER ]`; as Margaret the board card has the "Private" badge and is in its column count and total, the drawer shows owner Margaret Fake, creator "Alan Fake (deactivated)" and "// HISTORY" line "Handed to Margaret Fake by <admin>"; as Linus and as the admin the card is absent and the column count excludes it; also the cancel case (panel closes, counts unchanged)

### Implementation for User Story 1

- [x] T014 [US1] In `src/app/(app)/admin/users/page.tsx`: treat a user as having records when `u.private_people + u.private_deals > 0`; use it for `from` (the panel opens only for such a deactivated user), for the row's `[ HAND OVER ]` link and for the count span, which shows `templates.private_records(u.private_people, u.private_deals)`; pass `people={from.private_people}` and `deals={from.private_deals}` to `HandOverPanel`; update the header comment (depends on T001, T002)
- [x] T015 [US1] In `src/app/(app)/admin/users/HandOverPanel.tsx`: replace the `count` prop with `people` and `deals`; the question is `templates.handover_question(fromName, people, deals, chosen)`; the explanation is `templates.handover_explain(chosen, deals)` when chosen, else `messages.handover_explain_unchosen_records` when `deals > 0` and `messages.handover_explain_unchosen` otherwise; never show a deal detail (depends on T001)
- [x] T016 [P] [US1] In `src/seed/deals.ts`: after the main loop, in the same transaction, when user "Alan Fake" exists, add (skipped when a deal with the same title is there) two Sales deals with `private = true`, `created_by` and `owner_id` Alan Fake: "Fake leaver deal" (open, `added` event, open `deal_stage_periods` row) and "Fake leaver old deal" (`archived_at` yesterday, `added` and `archived` events, open `deal_stage_periods` row); count them in `dealsAdded` (FR-010); update the header comment
- [x] T017 [P] [US1] Append to `docs/DECISIONS.md`: `- Handing over a deactivated user's private people also hands over the private deals they own, archived ones included, so a private deal is never left visible to nobody (SF-97)` (FR-009)

**Checkpoint**: T007–T013 pass; quickstart.md "By hand" steps 1–6 work.

---

## Phase 4: User Story 2 - A deactivated user with only private deals can be handed over (Priority: P1)

**Goal**: the row, panel and notice work when the user owns private deals and no private people; people-only
wording stays SF-92's.

**Independent Test**: Alan owns 1 private deal and no private people; the admin sees "1 private deal" and
`[ HAND OVER ]`, hands over to Margaret, sees "1 private deal handed to Margaret Fake." and Margaret sees the card.

### Tests for User Story 2

- [x] T018 [P] [US2] In `tests/unit/messages.test.ts` add tests (`// covers FR-002, FR-003, FR-006, US2 scenarios 1–3`): `private_records(0, 1)` = "1 private deal"; `private_records(2, 0)` = "2 private people"; `handover_question("Alan Fake", 0, 1, "Margaret Fake")` = "Hand Alan Fake's 1 private deal to Margaret Fake?"; `handover_question("Alan Fake", 2, 0, "Margaret Fake")` = "Hand Alan Fake's 2 private people to Margaret Fake?"; `handover_explain("Margaret Fake", 0)` keeps "…You will not see who they are."; `handed_over("Margaret Fake", 0, 1)` = "1 private deal handed to Margaret Fake."; `handed_over("Margaret Fake", 2, 0)` = "2 private people handed to Margaret Fake."
- [x] T019 [US2] In `tests/integration/handover.test.ts` add a test (`// covers US2 scenarios 1–2, FR-002`): Alan owns 1 private deal and no private people; `listUsers()` gives `private_people` 0 and `private_deals` 1; `handOverPrivateRecords` returns `{ status: "handed", people: 0, deals: 1, toName: "Margaret Fake" }` and the deal's owner is Margaret
- [x] T020 [US2] In `tests/e2e/handover.spec.ts` add a browser test (`// covers US2 independent test, scenarios 1–3`): Alan with only 1 private deal shows "1 private deal" and `[ HAND OVER ]`; `/admin/users?handover=<alan>` opens the panel; the question reads "Hand Alan Fake's 1 private deal to Margaret Fake?"; the notice reads "1 private deal handed to Margaret Fake."; Margaret's board shows the card; update the existing "panel opens only for a deactivated user with private people" test so it opens for private people or private deals and stays closed for a user with neither

### Implementation for User Story 2

- [x] T021 [US2] Check `src/app/(app)/admin/users/page.tsx` and `HandOverPanel.tsx` (from T014–T015) handle `private_people = 0`: the row shows only "1 private deal", the panel opens via `?handover=<id>`, and the people-only path still uses SF-92's wording; fix any branch still keyed on `private_people > 0` alone

**Checkpoint**: T018–T020 pass along with the US1 tests.

---

## Phase 5: Polish & cross-cutting

- [x] T022 [P] Update the `src/server/records/handover.ts` and `flash.ts` mentions in `AGENTS.md` (Layout: `handover.ts` hands over a deactivated user's private people and private deals)
- [x] T023 Run `npm run test:schemas && npm test && npm run test:e2e && npm run typecheck` with the test environment above and fix any failure
- [x] T024 Walk through `specs/sf-97-hand-over-of-private-deals/quickstart.md` "By hand" with the fake data (run the fake data command twice to check no duplicate "Fake leaver" deals)

---

## Dependencies & execution order

- Phase 2: T001, T002, T004 in parallel → T003 → T005 → T006.
- US1 (Phase 3) after Phase 2. Tests T007, T008 in parallel; T009–T012 share one file, in order; T013 after T014–T015. T016, T017 any time after Phase 2.
- US2 (Phase 4) after T014–T015 (same page and panel); T018 can start right after Phase 2.
- Polish after both stories.

## Parallel examples

```text
Phase 2:  T001 (messages.ts) | T002 (users.ts) | T004 (flash.ts)
US1:      T007 (messages.test.ts) | T008 (flash.test.ts) | T016 (seed/deals.ts) | T017 (DECISIONS.md)
US2:      T018 (messages.test.ts) while T019 (handover.test.ts) is written
```

## Implementation strategy

- **MVP**: Phase 2 + US1. That already covers "never visible to nobody" for every user with private people.
- **Then** US2, which mostly checks the zero-people branches of the same page and panel.
- Commit nothing during the session: the factory commits.
