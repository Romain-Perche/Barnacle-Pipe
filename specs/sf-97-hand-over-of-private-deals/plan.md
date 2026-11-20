# Implementation Plan: Hand-over of private deals

**Branch**: `factory/sf-97-hand-over-of-private-deals` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/sf-97-hand-over-of-private-deals/spec.md`

## Summary

SF-92's hand-over (`handOverPrivatePeople`) moves a deactivated user's private people to an active user. This
change widens the same single transaction to also move every private deal (archived included) whose `owner_id`
is the deactivated user, recording one `handed_over` timeline event per deal. The Users page counts private
deals next to private people, shows `[ HAND OVER ]` when either count is non-zero, and every text (row, question,
explanation, success notice, "nothing to hand over", "not deactivated" refusal) names both kinds. No migration:
`timeline_events` already accepts `deal_id` with kind `handed_over` (migration 0004), and the deal "// HISTORY"
already renders `handed_over` through `Timeline.tsx`. The fake data adds two private deals created and owned by
Alan Fake (one open, one archived).

## Technical Context

**Language/Version**: TypeScript, Node (as in `package.json`), Next.js 16 App Router, React 19

**Primary Dependencies**: `postgres` (postgres.js, plain SQL); nothing new

**Storage**: Postgres; tables `users`, `persons`, `deals`, `timeline_events` (no schema change)

**Testing**: Vitest unit + integration (real Postgres, `tests/support/reset.ts`), Playwright e2e

**Target Platform**: Web app (server-rendered pages, server actions)

**Project Type**: Web application (single Next.js project)

**Performance Goals**: hand-over is one transaction of two `update … returning` statements plus one insert per
record; a user owns at most a few hundred records, so no batching is needed

**Constraints**: all or nothing (FR-004); the admin never receives a deal id, title or any detail (SC-005)

**Scale/Scope**: small team CRM (tens of users)

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template, so the gates are the repo rules in `AGENTS.md`:

| Gate | Status |
|------|--------|
| Every server action calls `requireUser()`/`assertAdminForAction()` first | PASS: `handOver` keeps `assertAdminForAction()`; the domain function re-checks admin on the locked row |
| User-facing text only from `src/server/messages.ts`; nothing from the URL | PASS: new templates in `templates`; flash counts validated as integers, name read from the database |
| Every `deals` read for a viewer uses `visibleDeal()` | PASS: no new viewer read; the admin count query is an admin-only aggregate that returns numbers only (same as SF-92's people count) |
| Migrations: transaction-safe, RLS after create table | PASS: no migration |
| Fake data only when `isFakeAllowed()`; clearly fake names | PASS: seeding goes through the existing gated `src/seed/index.ts`; titles say "fake" |
| Tests name what they cover | PASS: required in the steps below |

Re-checked after Phase 1 design: still PASS, no violation to justify.

## Project Structure

### Documentation (this feature)

```text
specs/sf-97-hand-over-of-private-deals/
├── plan.md            # this file
├── research.md        # Phase 0
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
├── contracts/routes.md
├── dependencies.json  # []
└── blueprints.json    # [] (no blueprint applies)
```

### Source Code (files this change touches)

```text
src/server/records/handover.ts        # handOverPrivateRecords (renamed from handOverPrivatePeople)
src/server/users.ts                    # UserRow.private_deals, counted in listUsers()
src/server/messages.ts                 # wording for both kinds
src/server/records/flash.ts            # handed_over flash carries people + deals counts
src/app/(app)/admin/users/actions.ts   # call the new function, revalidate /deals, new flash fields
src/app/(app)/admin/users/page.tsx     # row counts, [ HAND OVER ] when either count > 0, panel props
src/app/(app)/admin/users/HandOverPanel.tsx  # question/explanation with both counts
src/seed/deals.ts                      # two private deals of Alan Fake
docs/DECISIONS.md                      # FR-009 line
tests/unit/messages.test.ts, tests/unit/flash.test.ts, tests/integration/handover.test.ts,
tests/e2e/handover.spec.ts             # updated / extended by Build
```

**Structure Decision**: extend SF-92's files in place; no new module, page, panel or table.

## Implementation steps (for Build)

1. **`src/server/records/handover.ts`**
   - Rename `handOverPrivatePeople` to `handOverPrivateRecords` (update the one caller in `actions.ts` and the
     integration test). Same signature `(actorId, fromUserId, toUserId)`.
   - `HandOverResult` `"handed"` becomes `{ status: "handed"; people: number; deals: number; toName: string }`.
   - Inside the existing `sql.begin`, after the user-row lock and the three refusals (unchanged order):
     ```sql
     update persons set owner_id = $to, version = version + 1 where private and owner_id = $from returning id
     update deals   set owner_id = $to, version = version + 1 where private and owner_id = $from returning id
     ```
     Do not touch `created_by`, `stage_id`, `stage_entered_at`, `archived_at`, or `deal_stage_periods`: no
     `transferDeal`, no `moved` event (FR-004). `version + 1` makes an edit form opened before the hand-over get
     the existing stale/edit-conflict answer, as for people.
   - If both lists are empty → `{ status: "none", fromName }`.
   - For each moved deal: `recordEvent(db, { dealId: id, kind: "handed_over", actorId, relatedUserId: to.id })`.
   - Return only counts and `to.name`; never ids or titles (SC-005).
2. **`src/server/users.ts`**: add `private_deals: number` to `UserRow`; in `listUsers()` add
   `case when status = 'deactivated' then (select count(*)::int from deals d where d.private and d.owner_id = users.id) else 0 end as private_deals`
   (archived included, FR-001). Update the comment.
3. **`src/server/messages.ts`**
   - `messages.handover_not_deactivated` → `"Only a deactivated user's private records can be handed over."`.
   - Add `privateDeals = (n) => n === 1 ? "1 private deal" : \`${n} private deals\``.
   - `templates.private_records(people, deals)` → the non-zero labels joined by `" · "` (row, FR-002).
   - `recordsPhrase(people, deals)` (not exported, or exported for tests) → non-zero labels joined by `" and "`.
   - `templates.handover_question(from, people, deals, to)` → `` `Hand ${from}'s ${recordsPhrase} to ${to}?` ``.
   - `templates.handed_over(name, people, deals)` → `` `${recordsPhrase} handed to ${name}.` ``.
   - `templates.handover_none(name)` → `` `${name} has no private people or deals to hand over.` `` (FR-006, every case).
   - Explanation: `templates.handover_explain(to, deals)` → "…You will not see what they are." when
     `deals > 0`, SF-92's "…You will not see who they are." when only people; same rule for the unchosen text
     (`messages.handover_explain_unchosen` stays for people only; add `messages.handover_explain_unchosen_records`
     with "what they are"). See spec Clarifications.
   - Keep `templates.private_people` only if still used; otherwise remove it.
4. **`src/server/records/flash.ts`**: `Flash` gets `deals?: number`; cookie stores `{ code, name, count, deals }`
   with `count` = people. In `render` for `handed_over`: both `count` and `deals` must be integers 0..10 000
   (`deals` missing → 0), with `count + deals >= 1`; else `undefined`. Call `templates.handed_over(name, count, deals)`.
5. **`src/app/(app)/admin/users/actions.ts`**: call `handOverPrivateRecords`; `setFlash({ code: "handed_over",
   name: result.toName, count: result.people, deals: result.deals })`; add `revalidatePath("/deals")` next to
   `/people`. Refusal redirects unchanged.
6. **`src/app/(app)/admin/users/page.tsx`**: a user "has records" when `private_people + private_deals > 0`. Use
   that for `from`, for the row's `[ HAND OVER ]` link and for the count span, which shows
   `templates.private_records(u.private_people, u.private_deals)`. Pass `people` and `deals` to the panel.
7. **`HandOverPanel.tsx`**: props `people`, `deals` instead of `count`; question/explanation from step 3.
8. **`src/seed/deals.ts`**: after the main loop, inside the same transaction, when user "Alan Fake" exists, add
   (skip by title when already there) two deals in Sales, created by and owned by Alan, `private = true`:
   "Fake leaver deal" (open, with an `added` event) and "Fake leaver old deal" (archived yesterday, `added` +
   `archived` events, actor null), each with its open `deal_stage_periods` row like the other seeded deals.
   Count them in `dealsAdded` (FR-010).
9. **`docs/DECISIONS.md`**: append
   `- Handing over a deactivated user's private people also hands over the private deals they own, archived ones included, so a private deal is never left visible to nobody (SF-97)`.
10. **Tests (Build writes them)**, each naming what it covers:
    - unit `messages.test.ts`: every wording of row, question, explanation, success and none (US1 sc.1–3, US2 sc.1–3).
    - unit `flash.test.ts`: two counts, missing `deals`, invalid/zero counts ignored.
    - integration `handover.test.ts`: deals moved with creator/stage/position/archived kept, a `handed_over`
      event per deal and no `moved` event or stage period; deals created by Alan but owned by others and shared
      deals untouched; deals-only user; "none" after a concurrent hand-over or a deal made shared; refusals change
      no deal (SC-001, SC-004); `listUsers().private_deals`; visibility afterwards via `visibleDeal` (Margaret
      sees, Linus and admin do not; Alan after reactivation sees only deals they created).
    - e2e `handover.spec.ts`: US1 independent test end to end (row text, panel question, notice, Margaret's board
      card with "Private" badge and column count/total, drawer owner and "// HISTORY" line, admin and Linus do
      not see the card) and US2.

## Complexity Tracking

No violations.
