# Quickstart: validating Google Calendar two-way sync (SF-124)

## Prerequisites

- Local Postgres as in `README.md`. `npm run test:schemas` has downloaded `calendar-api.json` (with network access).
- Development: `.env.local` with `GMAIL_TOKEN_KEY` (any 32 bytes base64), no `GMAIL_PUBSUB_TOPIC` (fake Google), and
  `CALENDAR_SYNC=on`.
- Then `npm run db:migrate && npm run db:seed && npm run dev`.

## Automated

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run typecheck
```

Tests to write (Build). Each names what it covers (`// covers FR-…, US… scenario …`).

| File | Covers |
|---|---|
| `tests/unit/calendar-rules.test.ts` | `eventBody` (title, "✓ ", description and link, reminders 15 / 0 / none, private, transparent, no attendees), `eventTimes` across 29 Mar 2026 and 25 Oct 2026, `fromEvent` (New York offset, all-day ranges, 7 min → 5, 30 h → 1440, 45 kept), `subjectFromTitle` (prefix of own type only, empty → null, 250 → 200), `merge` (each side alone, both → later wins, 30 = null duration), `decideIncoming` (recurring, declined, `eventType`, CRM marker, before `since`, over, no guests, resource guests), `classifyCalendarError`, `newEventId` shape |
| `tests/unit/gmail-rules.test.ts` (extend) | `askedScopes` with Calendar on/off, `hasAllScopes` refusing a missing Calendar scope |
| `tests/unit/calendar-fake.test.ts` | the fake against `calendar-api.json`: 409, 410 on tokens, cancelled listing, non-organiser 403, scope 403, unreachable |
| `tests/integration/migrate.test.ts` (extend) | `0019`: columns, checks, RLS on `calendar_events` |
| `tests/integration/calendar-connect.test.ts` | US1 1-5: consent asks 3 scopes; unticked Calendar → `missing_scopes`, nothing stored; Gmail-only connection → card `missing`, `settingsWarning` = "calendar", Gmail sync still copies; reconnect → `reconnected`, events for planned activities due today or later only; Calendar off → 2 scopes, no line, no events |
| `tests/integration/calendar-push-out.test.ts` | US2 1-8: create / edit / reschedule / tick / untick / reassign (connected and not) / delete / record deletes (person, organisation, deal) / Pipedrive-style insert caught by the check; one event per activity across retried inserts (409); Google unreachable on save → saved, event after the check; `sendUpdates=none` and no attendees on every write; hidden from assignee → event removed |
| `tests/integration/calendar-pull.test.ts` | US3 1-6 and edge cases: move, all-day ↔ timed, rename, lost notice then check, notice twice, description/guest change ignored, delete in Google → `ended` and never again, both sides changed → later wins on both, archived link still moved, 410 catch-up |
| `tests/integration/calendar-incoming.test.ts` | US4 1-8: second address and case, teammates only, no guests, several CRM guests (first visible), private / archived guest, before connect / past, CRM's own event, guest added later, recurring, declined new and declined existing, organisation archived; Google-origin meeting edited in CRM (title without "Meeting · ", no description/reminders sent), deleted in CRM (event kept), non-organiser refusal |
| `tests/integration/calendar-push-route.test.ts` | `/calendar/push`: wrong token, unknown channel, other resource id, disconnected connection → 403 and nothing changes; `sync` → 204; a real notice → synced; Calendar off → 204 |
| `tests/integration/calendar-lifecycle.test.ts` | disconnect and deactivation (channel stopped, events left, no pushes; reconnect → exactly one event each); key refused → needs reconnect, saves still work, catch-up after reconnect; daily channel renewal in `runGmailCheck`; `no_calendar_access` → `missing` |
| `tests/integration/calendar-seed.test.ts` | FR-016: seeding twice gives Ada's events once and one Meeting from Google |

## Manual (development, the AI review)

1. Sign in as Ada Fake, then open **Settings**: the card shows "Calendar: Syncing your activities with your Google
   Calendar".
2. Open **`/dev/fake-calendar`**: Ada's seeded activities and the "Fake intro meeting" are there, and the meeting is
   on the Activities list.
3. Schedule a Call tomorrow at 10:00 for 30 minutes, with a note. Reload the fake calendar page: "Call · …" 10:00–10:30,
   the note and the link in the description, email and pop-up 15 minutes before, private, no guests.
4. On the fake page, move it to 11:00–12:00 with "deliver the notice": the activity shows 11:00 with a duration of
   1 hour.
5. Move it again without delivering, then press `[ RUN THE 15-MINUTE CHECK ]`: the CRM follows.
6. Create an event with a fake CRM person's second address (in capitals) as guest: a Meeting appears for that person
   and their organisation.
7. `[ MAKE GOOGLE UNREACHABLE ]`, edit an activity (no error), `[ MAKE GOOGLE REACHABLE ]`, run the check: the event
   matches.
8. Set `CALENDAR_SYNC=` (empty) and restart: no Calendar line, and connect asks only the Gmail permissions.
