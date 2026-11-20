# Quickstart: validate the deal list and deal page

## Prerequisites

Local Postgres and the app as in `README.md`; then:

```bash
export APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev
npm run db:migrate       # applies migrations/0005_deal_page.sql
npm run db:seed          # fake users, people, pipelines, deals (now with won/lost, labels, links, followers)
npm run dev
```

Sign in through the fake Google login as "Ada Fake" (admin) or "Grace Fake" (not admin).

## Scenarios

1. **Deal page (US1)** — `/deals`, open a card, press `[ OPEN DEAL PAGE ]`: the page shows title, the arrow stage bar
   with days per stage (current stage highlighted, later stages without a count), the strip (value, owner, expected
   close, status "Open"), // DETAILS and // HISTORY newest first. `← Sales board` goes back. Press a later stage on
   the bar: the deal moves, the history gains "Moved from … to … by Ada Fake". Open `/deals/999999`: "This deal doesn't
   exist or you can't see it.".
2. **Won / Lost / Reopen (US2)** — note the stage's "<n> deals · £total" on the board; `[ WON ]` on the deal page: "Won ·
   <today>", history "Marked as won by Ada Fake"; the board column count and total dropped. Another deal: `[ LOST ]`,
   save empty → "Enter why this deal was lost."; type "Went with a competitor" → "Lost" with the reason. `[ REOPEN ]`
   both: back in their columns. Two tabs on one deal: Won in one, then Lost in the other → "Someone else changed this
   deal while you were editing. Reload to see their changes.".
3. **List (US3)** — `[ LIST ]` on the board: `/deals/list`, newest first, "<n> deals · £total". Filter Pipeline "Sales",
   Owner "Ada Fake", sort Value descending; reload: same list. Tick "Show closed deals": won and lost deals appear with
   their badge; Status "Lost" narrows them. `/deals/list?stage=abc&sort=evil&page=999` shows the last page, no
   error text.
4. **Restore (US4)** — archive a deal from the board drawer; on the list tick "Show archived deals", open it, its page
   reads "Archived" with only `[ RESTORE ]` (and `[ DELETE ]` for admins); restore: back in its column.
5. **People, labels, followers (US5)** — as admin, add deal label "Hot" under "Deal labels" on `/admin/lead-sources-and-labels`
   (adding "hot " again → "This name is already used."). Edit a deal, tick "Hot": history "Edited by Ada Fake: Labels";
   the list's Label filter finds it. Link a person under "Other people" (linking the main person → "This person is
   already linked to this deal."), unlink; `[ FOLLOW ]` → listed under Followers, button becomes `[ UNFOLLOW ]`.
6. **Privacy** — as Grace Fake, "Fake secret project" (private, Ada's) is absent from the list, its count and total,
   and `/deals/<its id>` says the deal doesn't exist or can't be seen.

## Automated

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run test:schemas && npm test && npm run test:e2e && npm run typecheck
```

Expected: unit (stage bar, lost reason, deals query, labels in changed fields, messages), integration (won/lost/reopen
with stage periods and board counts SC-005, stage days vs periods for every seeded deal SC-004, list filters/sorts/
count/total and privacy SC-006, non-admin delete SC-007, deal labels admin, links and followers, list performance with
2,000 deals SC-003, seed idempotent, RLS on the 4 new tables, migrate) and Playwright (US1–US5) all pass.
