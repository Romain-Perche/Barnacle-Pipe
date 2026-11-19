# Quickstart: validate Pipelines, deals and the board

## Prerequisites

Local Postgres and the setup in `README.md`. Then:

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run db:migrate          # applies 0003_pipelines_deals.sql
npm run db:seed             # users, people, then pipelines and deals
npm run db:seed             # again: prints "already there" lines, adds nothing (FR-021)
```

## Automated checks

```bash
npm test && npm run test:e2e && npm run typecheck
```

Expected: all green. The suites cover (see `contracts/routes.md`, `data-model.md`):

- unit: `parseMoney` / `formatMoney` (edge cases "£4,000.50", " 4000.5 ", "-1", "4.001", "abc", "£4,000" vs
  "£4,000.50"), deal validation, `changedDealFields`, pipeline/stage name rules, `deal_count`.
- integration (real Postgres): column counts and totals after add/edit/move/archive/delete (SC-004); a
  private deal invisible and uncounted for other users and admins, and their changes refused (SC-005);
  non-admin deal delete and every pipeline/stage change refused, including direct calls (SC-006); deal count
  unchanged after stage and pipeline deletes, with history lines and periods (SC-007); stale moves and edit
  conflicts; stage periods (one open per deal); RLS on the four new tables; seed idempotent; a board of 10
  stages × 500 deals read in well under 2 s (SC-003).
- e2e (Playwright, fake Google login): US1–US6, including a real drag from "Qualified" to "Proposal" and a
  reload, and the drawer "Move to" form.

## Manual walk-through

1. `npm run dev`, sign in through the fake Google login as Ada Fake (admin).
2. Sidebar shows "Deals"; "// Admin" shows "Pipelines".
3. Deals → the Sales board: columns Lead in … Closing; "Closing" reads "0 deals · £0" and "No deals in this
   stage.". Pick "Ambassadors" in the picker: the address becomes `/deals?pipeline=<id>`; reload keeps it.
4. `+` on Sales "Qualified" → form with Sales / Qualified set. Add "Fakeco website", `£4,000`, organisation
   "Fakeco Ltd", a person → card at the top of Qualified; count and total go up.
5. Drag it to "Proposal": moves at once; reload → still there. Open it: "// HISTORY" shows "Moved from
   Qualified to Proposal by Ada Fake".
6. In the drawer, "Move to" Negotiation + `[ MOVE ]` (keyboard only) → same result.
7. `[ EDIT ]`, value 5000 → card, total and "Edited by Ada Fake: Value".
8. Tick Private on a deal; sign in as Grace Fake (another tab/profile): the card is gone and totals exclude it;
   its `?open=` address shows the board with no drawer.
9. As Grace (non-admin): no `[ DELETE ]`, no Pipelines link, `/admin/pipelines` shows "You don't have access
   to this page.".
10. As Ada: Pipelines → add "Partners", stages Intro, Talking, Signed; rename, reorder, delete "Intro";
    delete a stage with deals → asked where to move them; the deals' history says "(stage deleted)".
