# Quickstart: Activity reminders in the app (SF-123)

## Prerequisites

Setup as in `README.md` (local Postgres, `.env`), then:

```bash
npm run db:migrate          # applies migrations/0017_activity_reminders.sql
npm run db:seed             # twice: the second run adds nothing
npm run db:seed
```

## Automated checks

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npx vitest run tests/unit/activities-rules.test.ts tests/integration/activity-reminders.test.ts \
  tests/integration/notifications.test.ts tests/integration/activity-notifications.test.ts tests/integration/seed.test.ts
npm test && npm run typecheck
```

Expected: pure tests of `reminderAt` / `dueMoment` / `reminderFor` (timed, untimed, midnight, 29 Mar 2026 02:10 → 00:55,
25 Oct 2026 overlap, 09:00 in winter and summer); integration tests of US1–US3 scenarios with an explicit `now`
(before / at / after the reminder time), move / reassign / tick / untick / delete, privacy, mark all read, the seed
(SC-001–SC-003, FR-010); a performance check at 500 planned activities and 200 notifications under 1 s (SC-004).

## Manual check (fake sign-in)

1. Sign in as Ada Fake (`/dev/fake-google`). The sidebar shows "Notifications (n)" including the seeded reminders.
2. `/notifications`: "Call: Fake call: reminder test call at HH:MM" (Unread), "Task: Fake task: reminder test task"
   (Unread), "Meeting: Fake meeting: reminder already seen at 14:00" (read), each with "Due …".
3. Open the call reminder: lands on the "Sample Gyms CRM" deal page; the count goes down by 1.
4. Schedule a call on a deal for yourself 20 minutes ahead: no reminder now; after 5 minutes, reload: it is listed and counted.
5. Move it to tomorrow: the reminder is gone. Reassign it to Grace Fake: as Grace, it comes 15 minutes before. Tick it
   done: gone for Grace; untick: back.
6. As Ada, make the deal private (Grace not owner): as Grace, the reminder is neither shown nor counted.
