# Tasks: Double-click to open a deal, person or organisation page

**Input**: `specs/sf-126-double-click-to-open-deal-person-page/` (plan.md, spec.md, research.md, contracts/ui.md)
**Outside services**: none. **Blueprints**: none (`blueprints.json` is `[]`). So no schema or fake tasks and no blueprint tasks.
**Tests**: each test names what it covers (`// covers FR-001, US1 scenario 1`). Run: `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test; npm test && npm run typecheck`.

## Phase 1: Setup

(none: no new dependency, no migration)

## Phase 2: Foundational (blocks all stories)

- [ ] T001 Write failing unit tests in `tests/unit/double-click.test.ts` for `pageToOpen` (covers FR-006, FR-009): a target inside an element with `data-page="/deals/5"` returns `/deals/5`; a target inside a stretched `.cell-link` anchor returns it; a target inside any other `a` (name, organisation, person link) inside the row returns null; no `data-page` ancestor returns null; an address not matching `^/(deals|people|organisations)/\d+$` (e.g. `/deals/x`, `//evil.com`, `/people/1/edit`) returns null; `null` target returns null. Use plain objects with a structural `closest()`, no DOM.
- [ ] T002 Create `src/server/records/double-click.ts` (pure, client-safe, no server imports) exporting `pageToOpen(target)` as in plan.md Design 1, until T001 passes.
- [ ] T003 Create `src/app/(app)/records/OpenOnDoubleClick.tsx` (`"use client"`, renders `null`): in `useEffect` add one `dblclick` listener on `document`, ignore events with ctrlKey/metaKey/shiftKey/altKey, call `pageToOpen(event.target)` and `router.push(address)` (`useRouter` from `next/navigation`); remove the listener on cleanup.

## Phase 3: User Story 1 - Deals board (P1) 🎯 MVP

**Goal**: double-click a card opens the deal page. **Independent test**: board markup carries `data-page="/deals/<id>"` per card.

- [ ] T004 [US1] Write test `tests/integration/double-click-markup.test.ts` (covers FR-001, FR-004, FR-005, US1 scenarios 1-3): the deals board for seeded deals renders each card with `data-page="/deals/<id>"`, the "+" link and column headers have none, cards keep their `href` to `?open=<id>` and `draggable`. Render the page/`Board` the way existing tests in `tests/integration` (e.g. `board.test.ts`, `deal-page.test.ts`) reach pages; if pages cannot be rendered there, render `Board` with `react-dom/server` `renderToStaticMarkup`.
- [ ] T005 [US1] Add `data-page={`/deals/${card.id}`}` to each card `Link` in `src/app/(app)/deals/Board.tsx`; render `<OpenOnDoubleClick />` once in `src/app/(app)/deals/page.tsx` beside the board.

## Phase 4: User Story 2 - Deal list (P2)

**Goal**: double-click a row of `/deals/list` opens the deal page; Back restores filters/sort/page.

- [ ] T006 [US2] Extend `tests/integration/double-click-markup.test.ts` (covers FR-002, FR-006, FR-008, US2 scenarios 1-3): each deal list row `tr` has `data-page="/deals/<id>"` (archived rows too, with "Show archived"); name link and organisation/person links unchanged; the `?open=` preview links keep their `scroll={false}` hrefs including the current filters.
- [ ] T007 [US2] Add `data-page={`/deals/${r.id}`}` to each `<tr>` in `src/app/(app)/deals/list/page.tsx` and render `<OpenOnDoubleClick />` once.

## Phase 5: User Story 3 - People list (P2)

- [ ] T008 [P] [US3] Extend `tests/integration/double-click-markup.test.ts` (covers FR-003, FR-007, US3 scenarios 1-2): each People row has `data-page="/people/<id>"`; a person private to another user is absent from the list so has no row (no `data-page` leaks).
- [ ] T009 [P] [US3] Add `data-page={`/people/${r.id}`}` to each `<tr>` in `src/app/(app)/people/page.tsx` and render `<OpenOnDoubleClick />` once.

## Phase 6: User Story 4 - Organisations list (P3)

- [ ] T010 [P] [US4] Extend `tests/integration/double-click-markup.test.ts` (covers FR-003a, US4 scenarios 1-2): each Organisations row has `data-page="/organisations/<id>"`.
- [ ] T011 [P] [US4] Add `data-page={`/organisations/${r.id}`}` to each `<tr>` in `src/app/(app)/organisations/page.tsx` and render `<OpenOnDoubleClick />` once.

## Phase 7: Polish

- [ ] T012 Check not-found paths still hold (covers FR-007, SC-004): add to `tests/integration/double-click-markup.test.ts` or an existing page test that `/deals/<deleted id>`, `/people/<private to other>` and `/organisations/<deleted id>` give their existing not-found result (follow how `deal-page.test.ts` checks it); no code change expected.
- [ ] T013 [P] Add one line at the end of `docs/DECISIONS.md`: single click opens the drawer, double-click opens the page (SF-126). Add a line under `records/` in `AGENTS.md` naming `OpenOnDoubleClick.tsx` and `src/server/records/double-click.ts` (SF-126).
- [ ] T014 Run `npm test && npm run typecheck`; fix failures; walk through `quickstart.md`.

## Dependencies

T001 → T002 → T003 → all stories. US1–US4 are independent after T003 (US1 first as MVP); T004/T006/T008/T010 share one test file, so edit it in order. T013, T014 last.
