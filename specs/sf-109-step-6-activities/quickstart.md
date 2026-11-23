# Quickstart: validate Activities (SF-109)

Setup and commands are in `README.md`; the factory's test recipe is `.factory/test-env.md` (written by Build/AI review).

## Run

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run db:migrate          # applies 0008_activities.sql
npm run db:seed             # fake users, people, deals, notes, activities
npm test && npm run test:e2e && npm run typecheck
```

For a manual look: `APP_ENV=development npm run dev`, sign in with the fake Google login as Ada Fake.

## Scenarios (each maps to an automated test)

| # | Do | Expect | Spec |
|---|---|---|---|
| 1 | Deal page → `[ SCHEDULE ACTIVITY ]`, Call, "Call Ada about the proposal", tomorrow 10:00, `[ SAVE ]` | Box closes; "// NEXT ACTIVITIES" shows "CALL · Call Ada about the proposal · <date> 10:00 · Ada Fake"; the deal, its person and organisation were pre-filled | US1 1–2 |
| 2 | Save with an empty subject / no date / 29 Mar 2026 01:30 / duration with no time | The matching message; nothing saved | US1 4, Edge |
| 3 | Edit in two tabs, save both | Second gets "Someone else changed this activity…" | US1 5 |
| 4 | Tick the call on the deal page | Leaves NEXT ACTIVITIES; timeline shows ACTIVITY "Done by Ada Fake"; "Schedule a follow-up?" opens pre-filled; `[ NOT NOW ]` closes | US2 1–2 |
| 5 | Tick a call linked to a person whose Last contacted is older | Last contacted = the call's due date; untick leaves it | US2 4 |
| 6 | Activities (sidebar) | Ada's planned ones, overdue first in red; tabs, Assignee "Everyone", Type "Meeting" change rows and count; the address keeps the filters | US3 |
| 7 | Board | A deal with no planned activity ends "⚠ No next activity"; one with a task shows "Next: <d Mon> · Task"; ticking it in the drawer brings the warning back | US4 |
| 8 | As Ada, private deal + call; as Bob (admin) open Activities "Everyone", the deal's organisation, the board, `/notifications` | The call appears nowhere and changes no count; a direct tick of its id answers "This activity doesn't exist or you can't see it." | US5 |
| 9 | As Ada, schedule a call assigned to Bob; as Bob | "Notifications (1)"; item "Ada Fake assigned you a call: …", "Due …"; opening lands on the deal and the count drops; reassign to Cy removes Bob's | US6 |
| 10 | Archive the deal | Activities still shown, no buttons; a direct tick answers "Restore this record before changing its activities." | Edge |
| 11 | Delete (admin) a deal whose only link is the deal / a person with a deal-linked activity | The first activity is gone; the second stays on the person | FR-014 |

Clock-dependent checks (Overdue / Today around midnight and the clocks changing, SC-006) are unit tests on
`activityState` and integration tests passing a fixed `now` to `listActivities`; browser tests use dates relative to
today.
