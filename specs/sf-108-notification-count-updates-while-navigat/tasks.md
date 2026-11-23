---

description: "Tasks for SF-108 Notification count updates while navigating"
---

# Tasks: Notification count updates while navigating

**Input**: Design documents from `/specs/sf-108-notification-count-updates-while-navigat/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/sidebar.md, quickstart.md

**Tests**: Requested by the spec (FR-007: a browser test) and the repo (AGENTS.md § Tests). Playwright through the fake Google login, two browser contexts (Bob Fake and Ada Fake). Each test names what it covers (`// covers SF-108 FR-001, US1 scenario 2`). Write each story's tests first and see them fail before the code. "No full reload" is proven by a marker set on `window` before the navigation (`await page.evaluate(() => ((window as any).__noReload = 1))`) that must still be there after (`expect(await page.evaluate(() => (window as any).__noReload)).toBe(1)`).

**Organization**: Grouped by user story. No new dependency (`dependencies.json` is `[]`): add no package. No migration. No blueprint applies (`blueprints.json` is `[]`, this run has no blueprint index): no blueprint tasks and no `Departs from blueprint` line. The choice "decided by the factory, to confirm" in spec.md § Clarifications (back/forward refetches the whole page) is built as written. The only outside service is Supabase Postgres (no public schema on GitHub): its task is T004, the recipe T021. Label and badge texts are unchanged from SF-102 (`templates.notifications_label(n)` in `src/server/messages.ts`); add no new text.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US3 from spec.md
- Paths are from the repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Test helpers for two sessions.

- [ ] T001 Create `tests/e2e/notification-count-helpers.ts` with: `markNoReload(page)` (sets `window.__noReload = 1`), `expectNoReload(page)` (asserts it is still `1`), `notificationsLink(page)` (= `sidebar(page).getByRole("link", { name: /^Notifications( \(\d+\))?$/ })`), and `mention(byName, forName, record)` that inserts a note mentioning `forName` straight in the database via `db()` (a `timeline_events` row of kind `note` with `body` containing `@[user:<id>]`, plus its `note_mentions` row, as `src/server/records/notes.ts` writes them — read that file for the exact columns) so tests do not drive Ada's UI where `tests/e2e/mentions.spec.ts` already covers it. Reuse `db`, `sidebar`, `signInAs`, `resetAndSeed` from `tests/e2e/helpers.ts`, `insertDeal` from `tests/e2e/deals.ts`, `userId` from `tests/e2e/notes-helpers.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Move the Notifications link out of the shared layout into the `@unread` slot (plan.md § Implementation steps 1–3, research.md §2). Every story needs it.

- [ ] T002 Create `src/app/(app)/UnreadLink.tsx` (server component, no `"use client"`): `export async function UnreadLink()` calls `requireUser()` then `unreadCount(user.id)` (`src/server/notifications.ts`, unchanged) and returns `<SidebarLink href={item.href} label={item.label} count={n} />`, `item` being the `mainNav` entry with `href === "/notifications"` from `src/app/(app)/nav.ts`
- [ ] T003 Create the slot `src/app/(app)/@unread/page.tsx`, `src/app/(app)/@unread/[...path]/page.tsx` and `src/app/(app)/@unread/default.tsx`, each `export default function …() { return <UnreadLink />; }`; the catch-all never reads its `params`. Then edit `src/app/(app)/layout.tsx`: props `{ children, unread }: { children: React.ReactNode; unread: React.ReactNode }`; remove the `unreadCount` import and call; in `mainNav.map` render `<Fragment key={item.href}>{unread}</Fragment>` for `item.href === "/notifications"` and `<SidebarLink key={item.href} {...item} />` otherwise; keep `export const dynamic = "force-dynamic"`, the link order, the admin group and the `.me` block unchanged (FR-005). Update the SF-102 comment in `src/app/(app)/nav.ts`: the Notifications link and its count are rendered by the `@unread` slot (`UnreadLink.tsx`) so the count is fresh on every navigation (SF-108)
- [ ] T004 Supabase Postgres has no public schema on GitHub and no fake: tests use the real local PostgreSQL (`crm_test`). The new code follows Supabase's docs (https://supabase.com/docs/guides/database/connecting-to-postgres) as the rest of the app does: it only runs the existing read-only `unreadCount` query (no `set`, `listen` or session advisory lock — transaction-mode pooler; no new connection — limit `max: 5` in `src/server/db.ts`). Run `npx vitest run tests/integration/migrate.test.ts` (its scan of session-state statements must still pass) and `npx vitest run tests/integration` for the existing `unreadCount` tests; no new fake, no change to an existing fake

**Checkpoint**: `npm run typecheck` passes; `tests/e2e/mentions.spec.ts` and `tests/e2e/layout.spec.ts` (sidebar highlight, admin links, name, sign out, count on full load) still pass.

---

## Phase 3: User Story 1 - The count is right after clicking around the app (Priority: P1) 🎯 MVP

**Goal**: After someone else mentions Bob, any page Bob opens by a link shows the new count, with no reload.

**Independent Test**: Bob on `/deals` with no unread; mention Bob from the database; Bob clicks "People": `Notifications (1)`, no reload.

### Tests for User Story 1 ⚠️

- [ ] T005 [P] [US1] In `tests/e2e/notification-count.spec.ts` (`// covers SF-108 FR-001, FR-002, FR-006, FR-007, SC-001–SC-003, US1 scenarios 1–3`; `beforeEach`: `resetAndSeed()` then `delete from note_mentions`): Bob signs in on `/deals`, sees `Notifications` (no badge); `markNoReload`; `mention("Ada Fake", "Bob Fake", deal)`; Bob clicks sidebar "People" → link named `Notifications (1)` with badge `.cnt` "1", "People" has `aria-current="page"`, `expectNoReload`. Then a second mention; Bob clicks "People" again (same page) → `Notifications (2)`. Then Bob clicks "Deals" then at once "Organisations" after a third mention → the Organisations page shows `Notifications (3)`
- [ ] T006 [P] [US1] In `tests/e2e/notification-count.spec.ts` (`// covers SF-108 US1 scenario 2`): from the people list Bob clicks a person row link, from the board a deal card, from a deal page a linked record, from the organisations list an organisation; after a mention before each click, each page shows the current count; `expectNoReload` each time
- [ ] T007 [P] [US1] In `tests/e2e/notification-count.spec.ts` (`// covers SF-108 US1 scenarios 4–5, FR-002, Edge Cases "never 0", "13", "deleted deal", "signed out"`): Bob with 2 mentions shown; delete one note (`delete from timeline_events where id = …`, mentions cascade) → after a sidebar link `Notifications (1)`; make the other mention's deal private to Ada (`update deals set private = true …` — use the column name from `migrations/0004_pipelines_deals.sql`) → after a link, link named `Notifications` and no `.cnt` (never "0"); insert 13 mentions → badge "13"; delete a deal whose card Bob has on screen then click it → the deal not-found page inside the layout with the current count; delete Bob's `sessions` rows then click a sidebar link → the sign-in page with no sidebar

### Implementation for User Story 1

- [ ] T008 [US1] Make T005–T007 pass with the Phase 2 code. If the same-page click (T005) keeps the old count, add to `src/app/(app)/SidebarLink.tsx` an `onClick` that calls `useRouter().refresh()` when the link is the current page (research.md §2 risk) and note it in `specs/sf-108-notification-count-updates-while-navigat/research.md` §2. If the not-found case keeps the old count, check that `src/app/(app)/@unread/[...path]/page.tsx` matches the address and fix the slot, not the pages

**Checkpoint**: US1 complete — MVP.

---

## Phase 4: User Story 2 - The count is right after Bob's own changes (Priority: P2)

**Goal**: Opening a notification, `[ MARK ALL AS READ ]` and Bob's own form results show the new count.

**Independent Test**: Bob with 2 unread opens one → record page `Notifications (1)`; marks all read → no badge.

### Tests for User Story 2 ⚠️

- [ ] T009 [P] [US2] In `tests/e2e/notification-count.spec.ts` (`// covers SF-108 US2 scenarios 1–2, FR-004`): Bob with 2 mentions opens a page then the Notifications page; opening one notification → the record page shows `Notifications (1)`; visiting other pages does not change the count (opening a page marks nothing read); `[ MARK ALL AS READ ]` → `Notifications`, no badge; `expectNoReload` after each step
- [ ] T010 [P] [US2] In `tests/e2e/notification-count.spec.ts` (`// covers SF-108 US2 scenario 3, FR-001 "result of a form"`): Bob on a deal page with `Notifications (1)`; another mention is inserted; Bob adds a note with `addNote(page, "Call back")` (`tests/e2e/notes-helpers.ts`) → the page after the save shows `Notifications (2)`, `expectNoReload`

### Implementation for User Story 2

- [ ] T011 [US2] Make T009–T010 pass. Keep `revalidatePath("/", "layout")` in `src/app/(app)/notifications/actions.ts` and `src/app/(app)/records/note-actions.ts` as they are; change them only if a test shows a stale count, and say why in a comment

**Checkpoint**: US1 and US2 pass.

---

## Phase 5: User Story 3 - The count is right after going back or forward (Priority: P3)

**Goal**: Back and forward show the current count (research.md §3; spec Clarification: the whole page is fetched again after it is restored).

**Independent Test**: Bob opens People, then a person; a mention is inserted; Back → the people list shows `Notifications (1)`.

### Tests for User Story 3 ⚠️

- [ ] T012 [P] [US3] In `tests/e2e/notification-count.spec.ts` (`// covers SF-108 US3 scenario 1, FR-001 "back and forward", SC-001`): Bob opens `/people` (sidebar link) then a person; `markNoReload`; mention inserted; `page.goBack()` → `/people` shows `Notifications (1)` (allow the refresh: `await expect(link).toHaveAccessibleName("Notifications (1)")`); another mention; `page.goForward()` → the person page shows `Notifications (2)`; `expectNoReload`; the scroll position of the people list is kept (scroll it down before leaving, check `window.scrollY > 0` after back)

### Implementation for User Story 3

- [ ] T013 [US3] Create `src/app/(app)/RefreshOnHistory.tsx` (`"use client"`): `const router = useRouter()` (`next/navigation`); `useEffect(() => { const on = () => router.refresh(); window.addEventListener("popstate", on); return () => window.removeEventListener("popstate", on); }, [router])`; returns `null`. Render `<RefreshOnHistory />` once inside `.shell` in `src/app/(app)/layout.tsx`

**Checkpoint**: all three stories pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T014 [P] Run `npx playwright test tests/e2e/mentions.spec.ts tests/e2e/layout.spec.ts tests/e2e/notes.spec.ts tests/e2e/notes-private.spec.ts` to confirm SF-102's count, sidebar and notes still behave (FR-005); fix only the new code
- [ ] T015 [P] Update `AGENTS.md` § Layout: after the `src/app/(app)/notifications/` sentence, say the sidebar count is rendered by the `@unread` slot (`UnreadLink.tsx`) on every navigation and `RefreshOnHistory.tsx` refreshes the page on back/forward (SF-108); remove "(sidebar count in `layout.tsx`)"
- [ ] T016 [P] Check `npm run build` succeeds (the parallel route builds with the `(app)` group, `/[...missing]` and `/`), and that no page under `src/app/(app)/` became static
- [ ] T017 Run the whole suite as in AGENTS.md: `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test && npm test && npm run test:e2e && npm run typecheck`; keep full failure output if anything fails
- [ ] T018 [P] Follow `specs/sf-108-notification-count-updates-while-navigat/quickstart.md` manual check once in the running app (two browsers) and fix any gap
- [ ] T019 [P] Update `.factory/run/` scripts only if they list app routes or files this change moved (the layout no longer imports `unreadCount`); otherwise leave them
- [ ] T020 Mark every task done in this file and note in `specs/sf-108-notification-count-updates-while-navigat/research.md` any decision that changed during Build
- [ ] T021 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) and `## Schemas` (each schema's GitHub URL at its commit). For SF-108: append to the Supabase Postgres line of `## Services` that the sidebar count (SF-108, `src/app/(app)/UnreadLink.tsx`) runs the same read-only `unreadCount` query on every navigation, no fake, real local PostgreSQL, no public schema on GitHub, same pooler limits; keep the Google Sign-In line and the existing `## Schemas` entries as they are (SF-108 adds no schema)

---

## Dependencies & Execution Order

- Phase 1 (T001) and Phase 2 (T002 → T003; T004 after T003) before any story.
- US1 (T005–T008) is the MVP. US2 (T009–T011) and US3 (T012–T013) depend only on Phase 2; US3's code (T013) is independent of US1/US2.
- Polish after the stories; T021 last.

### Parallel opportunities

- T005, T006, T007 (same file, but separate `test(...)` blocks — write them together, run in parallel with Playwright workers if the spec file is not `serial`).
- After Phase 2: US2 tests (T009, T010) and US3 (T012, T013) can be written alongside US1.
- Polish: T014, T015, T016, T018, T019 in parallel.

```text
# After T004:
T005 + T006 + T007   (US1 tests)
T009 + T010          (US2 tests)
T012 then T013       (US3)
```

## Implementation Strategy

1. MVP: Phase 1 + Phase 2 + US1 → the reported defect is fixed for every link click.
2. Add US2 (mostly tests: Bob's own actions already revalidate), then US3 (`RefreshOnHistory`).
3. Polish, full suite, recipe last.
