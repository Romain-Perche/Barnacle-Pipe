# Implementation Plan: Google Calendar: two-way sync

**Branch**: `factory/sf-124-step-23-google-calendar-two-way-sync` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-124-step-23-google-calendar-two-way-sync/spec.md`

## Summary

Activities sync both ways with each user's primary Google Calendar, through the SF-118 Google connection.

- **Connect**: when Calendar is set up (`CALENDAR_SYNC=on`), `[ CONNECT GMAIL ]` asks for `calendar.events.owned` on
  top of the two Gmail scopes, and refuses the connection unless every asked scope is granted. A working connection
  whose `scopes` lacks the Calendar scope is "Calendar access missing": a "Calendar" line, the reconnect message and
  the orange "!" on Settings, while Gmail copying goes on. No new connection table: the SF-118 row gains calendar
  columns.
- **CRM → Google**: a reconcile, not an outbox. A new table `calendar_events` links one activity to one event and
  records the activity `version` and the values last agreed. `syncCalendar(connection)` sends what differs:
  - creates events for planned activities due today or later that have no link;
  - patches linked ones whose activity version moved;
  - deletes events of deleted, reassigned or no-longer-visible activities.
  Event ids are chosen by the CRM before the insert, so a retry never makes a second event. Activity actions and
  record deletes call it through Next's `after()` once the response is sent: saving never waits on Google. The
  15-minute check catches everything else (Pipedrive imports, visibility changes, Google down).
- **Google → CRM**: `events.list` with a sync token (a 410 starts a new listing), triggered by Calendar push channels
  (`events.watch`, web hook `/calendar/push`, checked with a per-channel secret token) and by the existing 15-minute
  `/cron/gmail` job.
  - A changed linked event goes through a three-way merge (date/time group, subject) against the last agreed values;
    when both sides changed, the later one wins.
  - A cancelled CRM event, or a declined or cancelled Google meeting, ends its link for good.
  - A new eligible event with a visible CRM person as guest becomes a Meeting.
- **Fakes**: the SF-118 fake Google gains Calendar (events, sync tokens, channels, notices, unreachable switch). It is
  checked against Google's pinned `calendar-api.json`. A `/dev/fake-calendar` page lets testers see and change each
  user's fake events.
- One migration (`0019_calendar.sql`). No new dependency.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, route handlers, server actions, `after` from `next/server`),
React 19.3, `postgres` 4.1, `node:crypto` (sha256, random ids, `timingSafeEqual`). All Google calls use plain `fetch`
through the SF-118 helpers. Nothing added (`dependencies.json` = `[]`).

**Storage**: PostgreSQL. Migration `0019_calendar.sql`:
- calendar columns on `gmail_connections`;
- `updated_at` on `activities`;
- the new table `calendar_events`.
See data-model.md. The fake calendar's state lives in the SF-118 fake Google state (memory in tests,
`.fake-gmail/state.json` in development).

**Testing**: Vitest unit and integration tests on the real local Postgres. `tests/fakes/gmail.ts` also checks every
Calendar request and answer against `.factory/schemas/calendar-api.json` (pinned). No browser tests (DECISIONS
2026-11-23).

**Target Platform**: Vercel serverless (Node runtime, Pro plan: the existing 15-minute cron, functions up to 300 s),
desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**:
- SC-001: one `syncCalendar` per save, run after the response (10 s per Google call).
- SC-002: one sync per push notice (`maxDuration = 60`), else at the next check.
- At most 200 Google writes per connection per run; the rest is carried to the next run.

**Constraints**:
- No Google call inside `sql.begin()`.
- No secret in pages, logs or answers. The channel token is stored as a sha256 only.
- Messages and event texts come from `messages.ts`. Google's text is never shown as anything but an activity subject,
  as plain text.
- An event never has guests, and no Google write is sent without `sendUpdates=none`.
- Saving an activity never waits for Google.

**Scale/Scope**: ≤ 10 users and a few hundred planned activities each. No new signed-in page: one line and one message
on the Settings card, 1 machine route (`/calendar/push`), 1 dev-only page (`/dev/fake-calendar`), the extended cron.

No NEEDS CLARIFICATION is left. The factory's choices are in spec.md § Clarifications › Plan 2026-11-25 ("to confirm").
The all-day reminder was decided at plan review (2026-11-25): no Google reminder on events of activities with no time.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so no gate can fail. The binding rules are
`docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default | Card line and message are server-rendered; no new client part (the "!" uses SF-118's `SidebarLink`/`UnreadLink`) | ✅ |
| Every page `requireUser()`, every action first | Settings and activity actions unchanged in that respect. `/calendar/push` needs the channel's secret token; `/cron/gmail` its `CRON_SECRET`. `/dev/fake-calendar` is 404 outside fake mode | ✅ |
| Messages from `messages.ts`, no URL text shown | New messages in contracts/routes.md § Messages. Event titles and descriptions are built from `messages.ts` and the activity | ✅ |
| Migrations transaction-safe, RLS after every `create table` | `0019`: `alter table … add column`, 1 `create table` + `enable row level security`, indexes | ✅ |
| Outside service through settings, with a fake checked against a schema | `CALENDAR_SYNC` setting. Fake Calendar in `fake-gmail.ts` checked against `calendar-api.json` at a pinned commit | ✅ |
| No secrets in the repo; tokens sealed | Same sealed SF-118 refresh token. The channel token is random per channel, kept as sha256 | ✅ |
| Fake login/data only when `isFakeAllowed()`, fake names | Fake page and seeder gated; fake people and "…-fake" titles | ✅ |
| Every `activities` read through `visibleActivity()` | Push sends an activity only while `visibleActivity(assignee)` holds, and deletes the event otherwise. Import matches guests through `visiblePerson(user)` | ✅ |
| Only events with a CRM person as guest come in (DECISIONS 2026-11-24) | research.md §10 | ✅ |
| Reminders by email come from Google's event reminder; the CRM sends no email (DECISIONS 2026-11-24) | Email + pop-up overrides on the event, `sendUpdates=none` everywhere | ✅ |
| One 15-minute Vercel cron job (SF-118) | `runGmailCheck` also runs the calendar part. `vercel.json` unchanged | ✅ |
| One way to call Google; no Google call in `sql.begin()`; only `loadKey` reads `token_cipher` (SF-118) | Calendar calls reuse `gmail/google-api.ts`'s `call`/`settings`/`refreshAccessToken` and `loadKey` | ✅ |
| No long-running server | Push, cron and `after()` only; leases instead of workers | ✅ |

**Post-design re-check**: still passes, with no violations. A blueprint check is not possible:
`$WS/blueprints/INDEX.md` is missing in this run, so `blueprints.json` stays `[]` and there is no "Departs from
blueprint" line.

## Project Structure

### Documentation (this feature)

```text
specs/sf-124-step-23-google-calendar-two-way-sync/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, state changes, sync rules, fake data
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   ├── routes.md        # card, routes, actions, domain functions, messages
│   └── google.md        # Calendar calls, scope, settings, Google Cloud setup, the fake and its checks
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/0019_calendar.sql                       # data-model.md § Migration (0017/0018 are SF-122's, on origin/main)
scripts/fetch-schemas.mjs                          # + calendar-api.json (pinned, sha256)
src/proxy.ts                                       # PUBLIC: /calendar/push, /dev/fake-calendar
src/server/
├── env.ts                                         # calendarConfig()
├── messages.ts                                    # contracts/routes.md § Messages
├── activities/rules.ts                            # + ukWallClock(instant) (export of the existing parts())
├── activities/activities.ts                       # editActivity / tick / untick also set updated_at = now()
├── users.ts                                       # deactivate: forgetGmailInTx now returns { token, channel }
├── gmail/rules.ts                                 # askedScopes(), hasAllScopes(scope, asked)
├── gmail/google-api.ts                            # consentUrl uses askedScopes(); export call/readJson/settings for calendar
├── gmail/connections.ts                           # calendar state in gmailSettings, settingsWarning, finishConnect, forget
├── gmail/sync.ts                                  # runGmailCheck also syncs calendars and renews channels
├── gmail/fake-gmail.ts                            # routes Calendar URLs to the fake calendar; calendar scope on consent
└── calendar/
    ├── rules.ts                                   # pure: event body, hash, times both ways, titles, merge, import rule, errors
    ├── calendar-api.ts                            # events insert/patch/delete/list, watch, channels.stop
    ├── fake-calendar.ts                           # FakeCalendar: events, sync tokens, channels, notices (state in FakeState)
    ├── sync.ts                                    # syncCalendar (pull then push), renewCalendarChannel, calendarAfterChange
    ├── push.ts                                    # receiveCalendarPush (channel id + token check)
    └── soon.ts                                    # runAfterResponse(): next/server after(), or run now outside a request
src/app/
├── (app)/settings/GmailCard.tsx                   # Calendar line + reconnect message (design A)
├── (app)/settings/gmail/callback/route.ts         # runAfterResponse(syncCalendar) after a connect
├── (app)/settings/actions.ts                      # disconnectGmail: after-commit stop of the channel
├── (app)/layout.tsx, (app)/notifications/actions.ts   # "!" from settingsWarning()
├── (app)/activities/actions.ts                    # runAfterResponse(calendarAfterChange([id])) after each ok change
├── (app)/people|organisations|deals delete actions    # runAfterResponse(calendarAfterChange([]))
├── (app)/admin/users/actions.ts                   # afterGmailForgotten({ token, channel })
├── calendar/push/route.ts                         # POST, maxDuration 60
├── dev/fake-google/gmail/page.tsx                 # the Calendar tick box
└── dev/fake-calendar/page.tsx + actions.ts        # the fake calendar page (FR-015)
src/seed/calendar.ts, src/seed/gmail.ts, src/seed/index.ts
tests/fakes/gmail.ts, tests/support/reset.ts, tests/unit/…, tests/integration/…   # quickstart.md
vitest.config.ts                                   # env CALENDAR_SYNC=on
.env.example, README.md, AGENTS.md, docs/DECISIONS.md
```

**Structure Decision**: same single Next.js project. Calendar code gets `src/server/calendar/`, beside
`src/server/gmail/` whose connection, key and Google helpers it reuses. It does not duplicate them. Activities stay in
`src/server/activities/`, which knows nothing of Google. The only change there is that edits record `updated_at`.

## Build steps (in order)

0. **Merge `origin/main`** into the branch first (SF-122: `0017_pipedrive_deals.sql`, `0018_pipedrive_fetched.sql`,
   Pipedrive activities inserted with their own ids). Build on it.
   - If SF-123 (activity reminders) merges first and takes `0019`, use the next free number.
   - If SF-123 already added `activities.updated_at`, reuse its column.
1. **Schema download**: in `scripts/fetch-schemas.mjs`, add `calendar-api.json` (contracts/google.md § Schemas).
   Update the head comment, the README command line and any test that lists the files.
2. **Migration** `migrations/0019_calendar.sql`, exactly as in data-model.md § Migration.
   - Add `calendar_events` to the truncate list of `tests/support/reset.ts` (and `.factory/run/reset-db.sh` if it lists
     tables).
   - Extend `migrate.test.ts`.
3. **Settings**:
   - `calendarConfig()` in `env.ts` (research.md §16);
   - `.env.example`: `CALENDAR_SYNC=on` after the Gmail block, with a comment;
   - README § Settings row, and a "Google Calendar" section with the Google Cloud setup of contracts/google.md;
   - `vitest.config.ts` env: `CALENDAR_SYNC: "on"`.
4. **Pure code**:
   - `src/server/calendar/rules.ts` (research.md §4-§10, §13; contracts/routes.md § Domain functions);
   - `ukWallClock` export in `activities/rules.ts`;
   - `askedScopes()` and `hasAllScopes(scope, asked = askedScopes())` in `gmail/rules.ts`;
   - the messages.
5. **Google calls and the fake**:
   - `calendar-api.ts` (contracts/google.md § Calls), reusing SF-118's `call`, `readJson` and `settings` (export them
     from `gmail/google-api.ts`; no second fetch switch);
   - `consentUrl` asks `askedScopes()`;
   - `fake-calendar.ts` plugged into `FakeGoogleMail.fetch` and its consent (contracts/google.md § Fake);
   - Calendar checks in `tests/fakes/gmail.ts` (§ Checks).
6. **Domain**:
   - `gmail/connections.ts` (data-model.md § State changes): `gmailSettings` → `calendar`, `settingsWarning`,
     `finishConnect` calendar columns and the "reconnected" outcome, `forgetGmailInTx` → `{ token, channel }`,
     `afterGmailForgotten` stops the channel;
   - `calendar/sync.ts` (research.md §7-§12, §14);
   - `calendar/push.ts` (research.md §11);
   - `activities.ts`: `updated_at = now()` in `editActivity`, `tickActivity` and `untickActivity`;
   - `runGmailCheck` runs `syncCalendar` and `renewCalendarChannel` per connection (research.md §12).
7. **Routes and actions**:
   - `src/app/calendar/push/route.ts` (`POST`, `dynamic = "force-dynamic"`, `maxDuration = 60`);
   - the two `PUBLIC` patterns in `src/proxy.ts` (and the proxy test);
   - `runAfterResponse(() => calendarAfterChange(ids))` after every successful activity action (schedule, edit,
     tick, untick, delete, follow-up schedule) and after person, organisation and deal deletes. Use `([])`: it picks up
     orphaned links;
   - the Gmail callback route runs `runAfterResponse(() => syncCalendar(id))` after `connected` / `reconnected`.
8. **UI**: `GmailCard.tsx` per design A (contracts/routes.md § Gmail card); layout and `currentSidebar()` read
   `settingsWarning()`.
9. **Fake pages**:
   - the Calendar tick box on `/dev/fake-google/gmail`;
   - `/dev/fake-calendar` (research.md §17).
10. **Fake data**: `src/seed/calendar.ts` (data-model.md § Fake data), registered after `gmail` and `activities` in
    `src/seed/index.ts`. `src/seed/gmail.ts` asks `askedScopes()`.
11. **Docs**:
    - `AGENTS.md` § Layout: `src/server/calendar/` (no Google call inside `sql.begin()`; the reconcile;
      `calendar_events`), `/calendar/push`, `/dev/fake-calendar`, the seeder;
    - at the end of `docs/DECISIONS.md`, after the person confirms the factory choices at plan review, one line each:
      - "Google Calendar sync asks for calendar.events.owned and only uses the user's primary calendar (SF-124)";
      - "An activity with no time gets no Google reminder (Google cannot remind at 9:00 on an all-day event); the
        in-app reminder at 9:00 covers it; activities with a time get Google's email and pop-up 15 minutes before
        (SF-124)";
      - "Events the CRM puts in Google Calendar are private; tasks with no time are free time (SF-124)";
      - "Deleting in the CRM a meeting that came from Google leaves the Google event; the CRM changes only its title
        and times, never its guests, description or reminders (SF-124)";
      - "An event deleted in Google, or a meeting from Google that the user declines, ends its sync for good; the
        activity stays (SF-124)";
      - "Calendar sync runs in the 15-minute Gmail job; changes made in the CRM are sent after the response, never
        while saving (SF-124)".
    - `.factory/test-env.md` is written by Build and the AI review, not here.
    - No blueprint exception, so no "Departs from blueprint" line.

## Fix round 1

**Problem (AI review).** (1) Ada's Google key is refused ("needs reconnecting"). Her synced call is reassigned to Linus.
Linus's next sync runs push step 3 in `src/server/calendar/sync.ts`, which deletes every CRM link of the activity held by
another connection that is not `working` or lacks the Calendar scope. Ada's link is deleted, but her Google event is not.
When Ada reconnects, no link points at that event, so step 1 (gone, reassigned or hidden) never removes it: the old event
stays in her calendar for good. This breaks FR-006 ("reassigning MUST remove the event from the old assignee's
calendar"). The same happens when Ada's connection is `working` but has lost the Calendar scope, and when she is
disconnected and later connects again. (2) `applyLinkedChange` reads the activity inside its merge transaction
(`select … from activities a where a.id = … for update`) with no assignee or `visibleActivity()` check (AGENTS.md: every
`activities` read uses it). If the activity is reassigned or hidden between `mine()` and the transaction, a Google change
is written to an activity that is no longer the user's. Minor: making a person or deal private, and the deactivation
hand-over, do not call `calendarAfterChange`, so a hidden event stays up to 15 minutes; a reconnect after a disconnect
starts a new sync token, so Google changes made while disconnected are not read (no DECISIONS line says so).

**Cause.** Step 3 frees the activity for the new assignee by deleting the old link, the only record of the old event.
Step 1 removes a CRM event only through its link. The merge transaction re-reads the activity by id alone.

**Fix.**
1. Step 3 detaches instead of deleting: for a CRM link (`origin = 'crm'`, `state <> 'ended'`) of an activity now
   assigned to this user, held by another connection that is not syncing (`state <> 'working'` or no Calendar scope),
   `update calendar_events set activity_id = null, updated_at = now()`. The activity has no link any more (the
   `unique (activity_id)` slot is free), so the new assignee's event is created in the same run. The detached link
   keeps its `google_event_id` and `connection_id`. It is the same row a deleted activity leaves (`on delete set null`):
   step 1 of the old connection already deletes its Google event (404/410 accepted) and the link, the next time that
   connection syncs with Calendar access (reconnect from "needs reconnecting", Calendar scope given again, or connect
   after a disconnect). While the old connection is not syncing, its event stays unchanged, as the spec says for a
   disconnected user. No migration: `activity_id` is already nullable and a CRM link with no activity is allowed.
2. The merge transaction's activity read becomes
   `… where a.id = ${a.id} and a.assignee_id = ${conn.userId} and ${visibleActivity(db, conn.userId)} for update`;
   no row → no change, nothing written (the next push step 1 handles the link).
3. `updatePerson` (`src/app/(app)/people/actions.ts`), `updateDeal` (`src/app/(app)/deals/actions.ts`) and `handOver`
   (`src/app/(app)/admin/users/actions.ts`) call `runAfterResponse(() => calendarAfterChange([]))` after a successful
   save, as the delete actions already do, so events of activities that became hidden or changed hands leave Google
   right away.
4. One `docs/DECISIONS.md` line: "After a disconnect, Calendar sync starts again from the new connection: changes made
   in Google while disconnected are not read; the CRM's values are sent again (SF-124)". AGENTS.md's `calendar/` line
   gains "a reassigned activity's link on a connection that is not syncing is detached (activity_id null), never
   deleted, so its event is removed when that connection syncs again".

**Files.** `src/server/calendar/sync.ts`, `src/app/(app)/people/actions.ts`, `src/app/(app)/deals/actions.ts`,
`src/app/(app)/admin/users/actions.ts`, `docs/DECISIONS.md`, `AGENTS.md`, tests in
`tests/integration/calendar-lifecycle.test.ts` and `tests/integration/calendar-pull.test.ts`.

**Check.** T059 and T060 fail on the current code and pass once the fix is built. The spec gains the edge case
"Reassigned while needs reconnecting", which the AI review performs on the fake calendar page.

## Outside services

- Google Calendar API v3, scope `calendar.events.owned` (events.insert/patch/delete/list/watch, channels.stop): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/calendar/v3/calendar-api.json
- Google Calendar push notifications (Google's POST to `/calendar/push` with `X-Goog-Channel-ID`, `X-Goog-Channel-Token`, `X-Goog-Resource-State`, `X-Goog-Resource-ID` headers and no body): no public schema found on GitHub (looked in github.com/googleapis/google-api-go-client calendar/v3/calendar-api.json, which describes only the `Channel` sent to `events.watch` and `channels.stop`, not the notification request; the fake follows developers.google.com/calendar/api/guides/push)
- Gmail API (unchanged calls; the connect flow still calls users.getProfile and watch): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
- Google OAuth 2.0 consent, token and revoke endpoints (now asking for the Calendar scope too): no public schema found on GitHub (looked in github.com/googleapis/google-api-go-client oauth2/v1 and oauth2/v2, whose `oauth2-api.json` only describes userinfo and tokeninfo; the fake follows RFC 6749 and RFC 7009, as in SF-118)
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93, SF-102 and SF-118: only an OpenAPI file for Supavisor's own management API; this change only adds a table and columns to the app's own database, and tests use a real local Postgres rather than a fake)

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
