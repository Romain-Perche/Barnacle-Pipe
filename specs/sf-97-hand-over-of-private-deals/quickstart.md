# Quickstart: validate the hand-over of private deals

## Prerequisites

Local Postgres and the setup in `README.md`.

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run test:schemas
```

## Automated checks

```bash
npm test               # unit (messages, flash) + integration (tests/integration/handover.test.ts)
npm run test:e2e       # tests/e2e/handover.spec.ts
npm run typecheck
```

Expected: all green; the integration tests show no private deal left owned by the deactivated user after a
hand-over (SC-001) and no change after any refusal (SC-004).

## By hand (development, fake data)

1. Run the fake data command (see `README.md`); it adds "Fake leaver deal" (open) and "Fake leaver old deal"
   (archived), private, created and owned by Alan Fake.
2. Sign in with the fake Google login as an admin, open Users: Alan Fake's row shows
   "2 private people · 2 private deals" and `[ HAND OVER ]`.
3. Press it, choose Margaret Fake: the question names both counts; the explanation ends "You will not see what they are."
4. Confirm: "2 private people and 2 private deals handed to Margaret Fake."; Alan's row shows no count.
5. Sign in as Margaret: the Sales board shows "Fake leaver deal" with the "Private" badge, Margaret as owner,
   Alan Fake (deactivated) as creator, and "// HISTORY" shows "Handed to Margaret Fake by <admin>".
6. Sign in as Linus Fake and as the admin: the card is not on the board, and column counts/totals exclude it.

See [contracts/routes.md](contracts/routes.md) for every message and [data-model.md](data-model.md) for the rules.
