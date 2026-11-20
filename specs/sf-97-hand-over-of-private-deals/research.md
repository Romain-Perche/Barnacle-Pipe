# Research: Hand-over of private deals

No NEEDS CLARIFICATION remained in Technical Context. The decisions below settle the open technical points.

## 1. One function, one transaction for people and deals

- **Decision**: widen `handOverPrivatePeople` into `handOverPrivateRecords` in `src/server/records/handover.ts`;
  both `update … returning` statements run in the existing `sql.begin` after the `for update` lock on the three
  user rows.
- **Rationale**: FR-004 requires all or nothing; the user-row lock already serialises two admins handing over the
  same user and a concurrent deactivation of the recipient (SF-92 tests cover the races).
- **Alternatives considered**: a separate `handOverPrivateDeals` called after the people one — two transactions,
  breaks FR-004; a database trigger — hides the rule from the domain code.

## 2. No stage move, no schema change

- **Decision**: a plain `update deals set owner_id, version = version + 1`; no `transferDeal`, no
  `deal_stage_periods` row, `stage_entered_at` untouched. The `handed_over` event uses the existing
  `timeline_events.deal_id` and kind (migration 0004 already allows it).
- **Rationale**: FR-004 (position on the board and stage history unchanged; the board orders by
  `stage_entered_at desc`). `Timeline.tsx` already renders `handed_over` for any target, giving
  "Handed to <owner> by <admin>" in the deal's "// HISTORY" (FR-005).
- **Alternatives considered**: a new event kind `deal_handed_over` — duplicates an existing kind and needs a migration.

## 3. Which deals count

- **Decision**: `private and owner_id = <deactivated user>`, archived included (FR-001). The Users page count uses
  the same predicate.
- **Rationale**: mirrors SF-92's people rule; creator kept, so an active creator keeps sight.
- **Alternatives considered**: also deals the user created but someone else owns — they are already visible to
  their active owner, nothing is lost.

## 4. Visibility of the count to the admin

- **Decision**: `listUsers()` counts with a subquery that returns only a number, without `visibleDeal()`.
- **Rationale**: the count is the feature (FR-002) and reveals no detail (SC-005); SF-92 does the same for people.
  The `visibleDeal()` rule applies to reads that show deals to a viewer; this read shows none.

## 5. Wording

- **Decision**: one helper joins the non-zero kinds: `" · "` on the row, `" and "` in the question and notice;
  "…has no private people or deals to hand over." in every "none" case; the explanation says "what they are" when
  deals are included and keeps SF-92's "who they are" when only people are (see spec Clarifications).
- **Rationale**: FR-002, FR-003, FR-006 and US2 scenario 3 (people-only wording unchanged).

## 6. Flash notice

- **Decision**: the `handed_over` flash cookie carries `count` (people) and `deals`, both validated as integers
  0..10 000 with a positive sum; the text is built from `templates`, the name is the server's copy.
- **Rationale**: keeps the rule "never show text taken from a URL/cookie" from `AGENTS.md`.

## 7. Fake data

- **Decision**: `src/seed/deals.ts` adds "Fake leaver deal" (open) and "Fake leaver old deal" (archived), both
  private, created and owned by Alan Fake, skipped by title when already there.
- **Rationale**: FR-010; the archived one lets the edge case "archived deal handed over too" be tried by hand.
