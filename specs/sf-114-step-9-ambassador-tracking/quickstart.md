# Quickstart: validating ambassador tracking (SF-114)

## Prerequisites

Local Postgres as in `README.md`; no outside account.

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run db:migrate          # applies 0008_ambassadors.sql
npm test && npm run typecheck
```

No browser tests (DECISIONS 2026-11-23): Build writes unit and integration tests; the AI review checks the screens.
The fake users are Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users), Alan Fake (deactivated);
where the spec says "Bob Fake (an admin)" the tests use Grace Fake.

## Automated checks (what must pass)

| Area | Test file (Build) | Proves |
|---|---|---|
| Pure rules | `tests/unit/referral-rules.test.ts`, `notes-rules.test.ts` (`parseShownBy`), `timeline-view.test.ts` (PERSON tag), `list-query.test.ts` (`ref`), `messages.test.ts` | FR-005 decisions, events, paging counts |
| Marking ambassadors | `tests/integration/ambassadors.test.ts` | US1 1–5: flag, events, list, archived listed but not offered, untick keeps referrals |
| Referrals | `tests/integration/referrals.test.ts` | US2 1–7: set / change / clear events, self and invalid refused with nothing saved, unchanged hidden or former referrer kept, deal pre-fill data (`people[].referredById`) |
| Ambassador page | `tests/integration/ambassador-page.test.ts` | US3 1–7, edge cases: counts, totals, won→reopened, lost, null value, archived, order, 50/20 paging without repeat or skip, not-found rule, former ambassador |
| Privacy | `tests/integration/ambassadors-private.test.ts` | US4 1–4, SC-005: private ambassador / referred person / deal never listed, counted, offered or in updates; "hidden" referrer kept on save; hand-over gives the new owner the page and counts |
| Delete | `tests/integration/archive-delete.test.ts` (+ cases) | FR-014: "cleared (a deleted person)" events; private ambassador leaves no event |
| Filters | `tests/integration/lists.test.ts`, `deals-list.test.ts` (+ cases) | US5 1–2: `ref` filter, count and total, options incl. former / archived |
| Performance | `tests/integration/ambassador-performance.test.ts` | SC-003: 200 referred records, 1,000 events, page data < 2 s |
| Migration, seed | `migrate.test.ts`, `seed.test.ts` | 0008 applies; seed re-run adds nothing (FR-017) |

## Manual walk-through (fake data)

```bash
APP_ENV=development npm run db:seed && APP_ENV=development npm run dev
```

1. Sign in as Ada Fake (fake Google login). Sidebar: "Ambassadors" after "Organisations". The page lists Cara Example
   (not Dora Privatefake, who is Linus Fake's private person; not Ezra Formerfake, a former ambassador).
2. Open Cara Example: AMBASSADOR header, `[ PERSON PAGE ]`, strip People 3 · Deals 3 · Open £4,500 · Won £4,000 ·
   Lost 1 (the private "Fake referral · audit" is not counted for Ada). Lists and `// LATEST UPDATES` grouped by day.
3. Sign in as Linus Fake: Cara's page shows Deals 4 and Open £6,500; Dora Privatefake is on the Ambassadors page.
4. Edit a person: tick "Ambassador", save → badge, `[ AMBASSADOR PAGE ]`, timeline "Made an ambassador by Ada Fake".
5. Add a deal, pick Dee Referredfake as person → "Referred by" shows Cara Example; clear it or change it; save.
6. `/people?ref=<Cara's id>` lists Ben, Dee and Eli Referredfake; `/deals/list?ref=<id>&closed=1` lists Cara's deals
   with matching count and total.
7. `/ambassadors/<a non-ambassador's id>` → "This ambassador doesn't exist or you can't see them."
