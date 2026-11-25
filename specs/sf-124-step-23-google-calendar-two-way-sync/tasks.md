---

description: "Task list for SF-124 Google Calendar: two-way sync"
---

# Tasks: Google Calendar: two-way sync

**Input**: Design documents from `/specs/sf-124-step-23-google-calendar-two-way-sync/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, contracts/google.md, quickstart.md

**Tests**: Required by the repo (AGENTS.md § Tests) and by the spec (SC-003 to SC-005).
- Tools: Vitest unit tests, and Vitest integration tests against a real local Postgres (`crm_test`) with the fake
  Google (Gmail + Calendar).
- No browser tests (docs/DECISIONS.md, 2026-11-23).
- Each test file names what it covers (`// covers FR-005, US2 scenario 1`).
- Write each story's tests first and see them fail before writing the code.

**Organization**: Tasks are grouped by user story. Where each detail lives:
- Message texts: contracts/routes.md § Messages, verbatim, from `src/server/messages.ts` only.
- Migration, entities, state changes, sync rules, fake data: data-model.md.
- Card, routes, actions, domain functions: contracts/routes.md.
- Calendar calls, scope, settings, Google Cloud setup, the fake and its checks: contracts/google.md.
- Decisions: research.md (§n below).

**Constraints and choices**:
- No new dependency (`dependencies.json` is `[]`): no `googleapis`. Use `fetch`, `node:crypto` and `after` from
  `next/server`.
- No blueprint applies: `blueprints.json` is `[]` and there is no blueprint index in this run. So there are no
  blueprint tasks and no "Departs from blueprint" line.
- The factory choices of spec.md § Clarifications › Plan 2026-11-25 are built as written there:
  - scope `calendar.events.owned`;
  - no Google reminder on an all-day event (decided by the person, 2026-11-25);
  - CRM events private, and all-day events free;
  - a meeting from Google is never deleted by the CRM, and only its title and times are sent;
  - a hidden activity's event is removed;
  - "(No title)";
  - no archived organisation on a new meeting.
- Outside services:
  - Google Calendar API: schema; T019.
  - Gmail API: schema; T020.
  - Google OAuth consent/token/revoke: no schema; T021.
  - Supabase Postgres: no schema; T022.
  - Google Calendar push notifications: no schema; T048.
  - The recipe is T058, the last task.
- Never put a Google call inside `sql.begin()`, and never use session state. Every Calendar write sends
  `sendUpdates=none` and never `attendees`.
- Fake users are Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users), and Alan Fake (deactivated);
  emails `<first name lower-case>@barnacle.ai`.
- Fake people used by tests are made in each test with "Fake" names, e.g. "Ana Fake" at "Fake Ltd" with
  `ana@example.test` and `ana.k@example.test`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: the user story the task belongs to (US1–US4)

---

## Phase 1: Setup

- [x] T001 Merge `origin/main` into the branch (SF-122: `migrations/0017_pipedrive_deals.sql`,
  `migrations/0018_pipedrive_fetched.sql`, Pipedrive activities inserted with their own ids). Resolve conflicts by
  keeping both sides, then run `npm test && npm run typecheck` green before going on.
  - If `migrations/0019_*.sql` already exists (SF-123), use the next free number for every later mention of
    `0019_calendar.sql`.
  - If `activities.updated_at` already exists, skip its `alter table` in T004 and keep the rest.
- [x] T002 [P] Add the `calendar-api.json` entry to `SCHEMAS` in `scripts/fetch-schemas.mjs`, exactly as in
  contracts/google.md § Schemas: url
  `https://raw.githubusercontent.com/googleapis/google-api-go-client/3f740bc15212818d4d0eb041b02c951457ff63fa/calendar/v3/calendar-api.json`,
  sha256 `eee07d697ad19b3d19c667ce6033a769c8f5bb37e33f5abf394bac47363395ec`.
  - Update the head comment ("… and Google Calendar's discovery file (SF-124, tests/fakes/gmail.ts)");
  - update the README command line;
  - update `tests/unit/fetch-schemas.test.ts` if it lists the files.
- [x] T003 [P] Add the setting `CALENDAR_SYNC`:
  - in `.env.example` after the Gmail block: `CALENDAR_SYNC=on` with the comment "on: sync activities with each
    user's Google Calendar (needs Gmail set up). Anything else: off.";
  - a row in README § Settings;
  - a "Google Calendar" README section with the 5 steps of contracts/google.md § Google Cloud setup and how to use
    `/dev/fake-calendar`;
  - in `vitest.config.ts` `test.env`: add `CALENDAR_SYNC: "on"`, with a comment naming SF-124.

---

## Phase 2: Foundational (blocking prerequisites)

- [x] T004 Write `migrations/0019_calendar.sql` exactly as data-model.md § Migration:
  - on `gmail_connections`: `calendar_connected_at timestamptz null`, `calendar_sync_token text null check
    (char_length(calendar_sync_token) <= 4096)`, `calendar_last_synced_at timestamptz null`, `calendar_channel_id text
    null check (char_length(calendar_channel_id) <= 64)`, `calendar_channel_resource_id text null check
    (char_length(calendar_channel_resource_id) <= 255)`, `calendar_channel_token_hash bytea null check
    (octet_length(calendar_channel_token_hash) = 32)`, `calendar_channel_expires_at`, `calendar_channel_renewed_at`,
    `calendar_lease_until` (timestamptz null) and `calendar_sync_again boolean not null default false`;
  - the constraints `gmail_connections_calendar_channel` (the channel id, resource id and token hash are null
    together) and `gmail_connections_calendar_off` (`state <> 'disconnected' or (calendar_channel_id is null and
    calendar_lease_until is null and calendar_sync_token is null)`);
  - the partial unique index `gmail_connections_calendar_channel_idx`;
  - `alter table activities add column updated_at timestamptz not null default now()`;
  - `create table calendar_events`, with:
    - `activity_id bigint null unique references activities (id) on delete set null`;
    - `connection_id bigint not null references gmail_connections (id) on delete cascade`;
    - `google_event_id text not null check (char_length(google_event_id) between 5 and 1024)`;
    - `origin text not null check (origin in ('crm', 'google'))`;
    - `state text not null check (state in ('creating', 'synced', 'ended'))`;
    - `base jsonb not null default '{}' check (jsonb_typeof(base) = 'object')`;
    - `synced_version int null`;
    - `sent_hash text null check (sent_hash ~ '^[0-9a-f]{64}$')`;
    - `google_updated_at timestamptz null`;
    - `dirty boolean not null default false`;
    - `created_at`, `updated_at`;
    - `unique (connection_id, google_event_id)`;
    - `check (state <> 'creating' or origin = 'crm')`;
    - `check (activity_id is not null or state = 'ended' or origin = 'crm')`;
  - then `alter table calendar_events enable row level security;` and the two indexes
    `calendar_events_connection_idx (connection_id, state)` and `calendar_events_orphan_idx (connection_id) where
    activity_id is null`.
- [x] T005 Add `calendar_events` to the `truncate` list of `tests/support/reset.ts` (before `activities` and
  `gmail_connections`), and to `.factory/run/reset-db.sh` if it lists tables.
- [x] T006 [P] Extend `tests/integration/migrate.test.ts` (`// covers SF-124 data-model.md § Migration`):
  - the new columns exist with their types;
  - RLS is enabled on `calendar_events`;
  - an insert breaking each check is refused: a 4-character event id, origin `other`, state `creating` with origin
    `google`, a 63-character `sent_hash`, a disconnected connection with a channel id, a channel id without a token
    hash;
  - deleting an activity sets `calendar_events.activity_id` to null.
- [x] T007 [P] Add `calendarConfig()` to `src/server/env.ts` (research.md §16): `{ mode: "off" }` unless
  `process.env.CALENDAR_SYNC === "on"` and `gmailConfig().mode !== "off"`; otherwise `{ mode: gmailConfig().mode,
  pushAddress: \`${appUrl}/calendar/push\` }`. Unit test in `tests/unit/env.test.ts` (or the existing env test): off
  when unset, `"ON"`, or Gmail off; fake with Gmail fake.
- [x] T008 [P] Add the messages and templates of contracts/routes.md § Messages to `src/server/messages.ts`, verbatim,
  and change `gmail_missing_scopes` to "Google needs all the permissions asked for. Try again and tick every box."
  Update the existing tests that assert the old text.
- [x] T009 [P] Export `ukWallClock(instant: Date): { day: string; time: string }` from
  `src/server/activities/rules.ts`, the existing `parts()` under a public name. Unit test in
  `tests/unit/activity-rules.test.ts`: 2026-03-29T01:30Z → `2026-03-29` `02:30`; 2026-12-04T15:00Z → `15:00`.
- [x] T010 [P] In `src/server/gmail/rules.ts`, add:
  - `CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned"`;
  - `askedScopes()`: `GMAIL_SCOPES` plus `CALENDAR_SCOPE` when `calendarConfig().mode !== "off"`;
  - `hasAllScopes(scope, asked = askedScopes())`;
  - `hasCalendarScope(scopes)`.

  Extend `tests/unit/gmail-rules.test.ts` (`// covers FR-001`): 3 scopes with Calendar on, 2 with it off; a grant
  without the Calendar scope fails `hasAllScopes` when on and passes when off.
- [x] T011 In `src/server/gmail/google-api.ts`:
  - export `call`, `readJson` and `settings` (no behaviour change);
  - make `consentUrl` ask `askedScopes().join(" ")`.
- [x] T012 [P] Create `src/server/calendar/rules.ts`, part 1 (pure, imports nothing server-only), per
  contracts/routes.md § Domain functions:
  - the types `SyncValues`, `ActivityForEvent`, `GoogleEvent`, `EventBody`;
  - `REMINDER_MINUTES_TIMED = 15`, `DEFAULT_EVENT_MINUTES = 30` (no all-day reminder constant);
  - `newEventId()`: `"crm"` + 32 characters of `0123456789abcdefghijklmnopqrstuv` from `randomBytes(20)`;
  - `classifyCalendarError(status, body, op)` exactly as research.md §13.

  Unit tests in `tests/unit/calendar-rules.test.ts` (`// covers research.md §13`):
  - `newEventId` matches `/^crm[0-9a-v]{32}$/`;
  - 401 → `key_refused`;
  - 403 `insufficientPermissions` → `no_calendar_access`;
  - 403 `rateLimitExceeded` / `userRateLimitExceeded` / `quotaExceeded` → `unavailable`;
  - 403 `forbiddenForNonOrganizer` → `event_refused`;
  - 410 on `list` → `sync_token_gone`;
  - 404/410 on `write` → `event_gone`;
  - 409 on `insert` → `exists`;
  - 429 and 503 → `unavailable`.
- [x] T013 Create `src/server/calendar/calendar-api.ts` (contracts/google.md § Calls): `listEvents`, `insertEvent`,
  `patchEvent`, `deleteEvent`, `watchEvents`, `stopChannel`.
  - Base `https://www.googleapis.com/calendar/v3`, calendar `primary`.
  - `sendUpdates=none` on insert, patch and delete.
  - Through T011's `call` and `readJson`; errors `GoogleKeyRefused`, `GoogleUnavailable`, and `CalendarRefused(kind)`
    with `kind` from `classifyCalendarError` (status and reason only, never Google's text).
- [x] T014 Create `src/server/calendar/fake-calendar.ts` and plug it into `FakeGoogleMail.fetch` in
  `src/server/gmail/fake-gmail.ts` for URLs starting `https://www.googleapis.com/calendar/v3/` (contracts/google.md
  § Fake).
  - New `FakeState` fields `calendars`, `channels`, `unreachable`, with defaults when an older state file has none.
  - Behaviour exactly as § Fake:
    - the scope check: 403 `insufficientPermissions` without `calendar.events.owned`, `calendar.events` or `calendar`;
    - base32hex ids of 5–1024 characters, else 400;
    - 409 on a duplicate id;
    - 404 on an unknown id; 410 on a patch or delete of a cancelled event;
    - 403 `forbiddenForNonOrganizer` when a non-organiser patches `summary`/`start`/`end`;
    - `updated` and `changedAt = ++seq` on every write; a delete → `cancelled`;
    - sync tokens `fake-sync-<seq>`, and 410 below `syncFloor`;
    - cancelled items listed only with `syncToken` or `showDeleted=true`;
    - `watch` records the channel, and `channels/stop` removes it;
    - `unreachable` makes every Google URL, the token endpoint included, throw `TypeError("fetch failed")`.
  - The tester API: `addEvent`, `changeEvent`, `declineEvent`, `deleteEvent` (each with `{ deliver }`),
    `calendarEvents`, `calendarNotice`, `setUnreachable`, `expireCalendarTokens`. `deliver: true` calls
    `receiveCalendarPush(calendarNotice(email))`; import it lazily to avoid a cycle.
  - Record `sendUpdates` and any `attendees` the app sends, in `requests`.
  - `consent()` grants the Calendar scope when it was asked and ticked.
- [x] T015 [P] Create `src/server/calendar/soon.ts`: `runAfterResponse(task)` calls `after(task)` from `next/server`.
  If that throws (outside a request scope), it runs `void task().catch(() => {})`. Errors are never rethrown.
- [x] T016 [P] In `src/server/activities/activities.ts`, set `updated_at = now()` in the `update activities` of
  `editActivity`, `tickActivity` and `untickActivity`. Integration test in `tests/integration/activities.test.ts`
  (or a new `tests/integration/activity-updated-at.test.ts`; `// covers FR-011`): each of the three moves
  `updated_at` forward, and a refused edit (version conflict) does not.
- [x] T017 Create `src/server/calendar/sync.ts`, the frame (research.md §12, §14):
  - `takeCalendarLease` / `releaseCalendarLease` (`calendar_lease_until` 2 minutes, `calendar_sync_again`; only rows
    `state = 'working'` whose `scopes` has the Calendar scope);
  - `syncCalendar(connectionId, now)`: lease → `loadKey` → `refreshAccessToken` → pull → push → release, again while
    `calendar_sync_again`, at most 5 rounds. Each step handles errors:
    - `GoogleKeyRefused` → `markNeedsReconnect`;
    - `CalendarRefused("no_calendar_access")` → remove `CALENDAR_SCOPE` from `scopes`;
    - `GoogleUnavailable` → `{ skipped: "unavailable" }` with the lease released;
  - `calendarAfterChange(activityIds)` (never throws);
  - `runCalendarCheck(connectionId, now)`.

  Pull and push are filled in by US2, US3 and US4.
- [x] T018 In `src/server/gmail/connections.ts`, make `markNeedsReconnect` also clear `calendar_lease_until` and
  `calendar_sync_again`. In `src/server/gmail/sync.ts` `runGmailCheck`, after each connection's Gmail part and watch
  renewal, call `runCalendarCheck(connectionId, now)` inside the same try, within the 240 s budget.

**Checkpoint**: migration applied, fake Calendar answering, `npm test && npm run typecheck` green.

---

## Phase 3: User Story 1 - Connect Google with Calendar access (Priority: P1) 🎯 MVP

**Goal**: connecting asks for Calendar too; Gmail-only connections show "Calendar access missing" and the "!" until a
reconnect; reconnecting starts calendar sync.

**Independent Test**: with the fake Google, connect a fake user and see the Calendar line on Settings. Load a Gmail-only
connection: the reconnect message and the "!" show, and Gmail copying still works. Reconnect: both go away, and the
planned activities due today or later are in the fake calendar.

### Tests for User Story 1

- [x] T019 [US1] Download `calendar-api.json` from
  `https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/calendar/v3/calendar-api.json`
  at commit `3f740bc15212818d4d0eb041b02c951457ff63fa` into `.factory/schemas/` (`git init -q
  /tmp/google-api-go-client && git -C /tmp/google-api-go-client fetch -q --depth 1
  https://github.com/googleapis/google-api-go-client 3f740bc15212818d4d0eb041b02c951457ff63fa && git -C
  /tmp/google-api-go-client show FETCH_HEAD:calendar/v3/calendar-api.json > .factory/schemas/calendar-api.json`), and
  make the fake of Google Calendar API refuse a request that the schema refuses: a test sends a wrong field and must
  fail.
  - In `tests/fakes/gmail.ts`, add the Calendar checks of contracts/google.md § Checks:
    - path and method among `resources.events` / `resources.channels`;
    - each query parameter declared for the method or among the top-level `parameters`;
    - JSON body properties declared in `Event` / `Channel`, recursively;
    - every answer's properties declared in `Event` / `Events` / `Channel` with their JSON types;
    - violations kept in `violations` and failing `afterEach`.
  - `tests/unit/calendar-fake.test.ts` (`// covers FR-015`) must show:
    - an insert body with `summery` instead of `summary` throws;
    - a list with the query `updatedSince` throws;
    - a patch body `reminders.overrides[0].minute` throws;
    - an answer with an undeclared property, made with the fake's `tamper`, throws;
    - and the fake's 409, 410 (token below `syncFloor` and patch of a cancelled event), 403 `insufficientPermissions`,
      403 `forbiddenForNonOrganizer` and `unreachable` behaviours.
- [x] T020 [P] [US1] Download `gmail-api.json` from
  `https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json`
  at commit `3f740bc15212818d4d0eb041b02c951457ff63fa` into `.factory/schemas/` (`git init -q
  /tmp/google-api-go-client && git -C /tmp/google-api-go-client fetch -q --depth 1
  https://github.com/googleapis/google-api-go-client 3f740bc15212818d4d0eb041b02c951457ff63fa && git -C
  /tmp/google-api-go-client show FETCH_HEAD:gmail/v1/gmail-api.json > .factory/schemas/gmail-api.json`), and make the
  fake of Gmail API refuse a request that the schema refuses: a test sends a wrong field and must fail.
  - In `tests/unit/gmail-fake-schema.test.ts`, a `watch` body with `topic` instead of `topicName` throws through
    `tests/fakes/gmail.ts`.
  - The connect flow of this issue (getProfile, watch) still passes the checks.
- [x] T021 [P] [US1] Google OAuth 2.0 consent, token and revoke endpoints have no public schema on GitHub. The fake
  (`src/server/gmail/fake-gmail.ts`, consent screen `/dev/fake-google/gmail`) follows Google's "Using OAuth 2.0 for Web
  Server Applications" page (developers.google.com/identity/protocols/oauth2/web-server), RFC 6749 §4.1 / §5.2 / §6 and
  RFC 7009. It copies:
  - `scope` in the token answer lists only the ticked scopes (granular consent), so the Calendar scope is missing when
    unticked;
  - codes work once, for 10 minutes, with PKCE S256 (else `invalid_grant`);
  - a refresh token only with `access_type=offline`;
  - `invalid_grant` for a revoked refresh token;
  - revoking kills its access tokens;
  - and now `unreachable`.

  Extend `tests/unit/gmail-fake-oauth.test.ts` (`// covers FR-001`):
  - the fake consent page lists the Calendar box when the Calendar scope is asked;
  - a grant with it unticked returns a `scope` without `calendar.events.owned`;
  - a reused code → `invalid_grant`;
  - `unreachable` → the token call throws `TypeError`.
- [x] T022 [P] [US1] Supabase Postgres has no public schema on GitHub: tests use the real local Postgres (`crm_test`),
  never a fake. The code follows Supabase's "Connect to your database" page (supabase.com/docs/guides/database/
  connecting-to-postgres, transaction-mode Supavisor pooler: no prepared-statement or session state across
  transactions). It copies these limits: one statement or one short `sql.begin()` per change, no `set`, `listen` or
  session advisory locks, no Google call inside a transaction.

  Add `tests/unit/calendar-no-session-state.test.ts` (`// covers plan.md Constraints`). It reads every file under
  `src/server/calendar/` and fails on `listen(`, `sql.unsafe(` with `set `, `pg_advisory_lock`, or a
  `calendar-api` call between `sql.begin(` and its closing (a simple scan of `sql.begin(` blocks for `insertEvent|
  patchEvent|deleteEvent|listEvents|watchEvents|stopChannel|refreshAccessToken`).
- [x] T023 [US1] Integration test `tests/integration/calendar-connect.test.ts` (`// covers FR-001, FR-002, FR-003,
  US1 scenarios 1-5, edge case "Calendar not set up"`), using the `gmail-helpers.ts` pattern:
  1. the consent address asks the 3 scopes; after allowing all, `gmailSettings().calendar === "syncing"`,
     `settingsWarning() === null`, a channel is stored (id, resource id, a 32-byte token hash, never the token);
  2. Calendar unticked (or a Gmail one) → outcome `missing_scopes`, no row change, message "Google needs all the
     permissions asked for. Try again and tick every box.";
  3. a connection seeded with only the two Gmail scopes → `calendar === "missing"`, `settingsWarning() ===
     "calendar"`, and a new message from a CRM person is still copied by `syncConnection`;
  4. reconnecting it with all scopes → outcome `reconnected`, warning null, and after `syncCalendar` the fake calendar
     holds exactly one event for each planned activity due today or later. None exists for one due yesterday or for a
     done one due tomorrow (edge case "Past and done activities on connect");
  5. a never-connected assignee → activities saved, no fake calendar has events;
  6. `CALENDAR_SYNC` stubbed `""` → consent asks 2 scopes, `calendar === "off"`, no "!" for Calendar, scheduling
     puts nothing in any fake calendar.
- [x] T024 [P] [US1] Unit test `tests/unit/gmail-card.test.ts` (`// covers FR-017, US1 scenarios 1 and 3`). It renders
  `GmailCard` with `renderToStaticMarkup` (as `tests/integration/gmail-send.test.ts` does).
  - `syncing`: heading "Gmail · connected", and the line "Calendar: Syncing your activities with your Google
    Calendar" after the SF-118 lines.
  - `missing`: "Reconnect Google to sync your activities with your calendar.", "Calendar: Not synced: Calendar access
    missing", `[ RECONNECT GMAIL ]`, `[ SEND ME A TEST EMAIL ]` and `[ DISCONNECT ]`.
  - `off` and `needs_reconnect`: no "Calendar:" text.

### Implementation for User Story 1

- [x] T025 [US1] In `src/server/gmail/connections.ts` (data-model.md § State changes, research.md §3):
  - `gmailSettings` returns `calendar: "off" | "syncing" | "missing"`;
  - add `settingsWarning(userId): Promise<"gmail" | "calendar" | null>`;
  - `finishConnect`:
    - sets `calendar_connected_at = now`, clears the sync token, channel and `calendar_last_synced_at`, and sets
      `dirty = true` on the connection's `synced` links. This happens when the granted scopes include Calendar and the
      row is new, disconnected, or `working` without the Calendar scope before;
    - keeps them for `needs_reconnect` → `working`;
    - returns `reconnected` also for "working without Calendar → with Calendar";
    - after commit, calls `renewCalendarChannel(id, now)` best effort;
    - exposes the connection id to the callback;
  - `connectFromCallback` uses `hasAllScopes(tokens.scope)` (asked scopes).
- [x] T026 [US1] In `src/server/calendar/sync.ts`, implement `renewCalendarChannel(connectionId, now)` (research.md
  §11):
  - `watchEvents` with `{ id: randomUUID(), type: "web_hook", address: calendarConfig().pushAddress, token:
    randomBytes(32).toString("base64url"), params: { ttl: "604800" } }`;
  - store id, `resourceId`, sha256(token), `expiration` and `calendar_channel_renewed_at = now`, only while the row is
    `working` with Calendar;
  - then `stopChannel` the old channel (best effort);
  - on `GoogleKeyRefused`, `markNeedsReconnect`.

  `runCalendarCheck` renews when `calendar_channel_renewed_at` is null or older than 20 h.
- [x] T027 [US1] In `src/server/calendar/sync.ts`, the first pull. With no `calendar_sync_token`: a full `listEvents`
  (`showDeleted=true`, paging), handling only items with `updated >= calendar_connected_at`, then storing
  `nextSyncToken` and `calendar_last_synced_at`. Item handling is filled in by US3 and US4.
- [x] T028 [US1] In `src/app/(app)/settings/gmail/callback/route.ts`, after `connected` / `reconnected` with Calendar
  granted, call `runAfterResponse(() => syncCalendar(connectionId))`.
- [x] T029 [US1] In `src/app/(app)/settings/GmailCard.tsx`, build design A per contracts/routes.md § Gmail card:
  - the Calendar `<li>` via `templates.calendar_line(...)`;
  - for `missing`: the `.err` message `messages.calendar_reconnect` above the lines, and the `[ RECONNECT GMAIL ]`
    form (`startGmailConnect`) before `[ SEND ME A TEST EMAIL ]`.

  Pass `gmail.calendar` from `src/app/(app)/settings/page.tsx`.
- [x] T030 [US1] Replace `gmailNeedsReconnect` with `settingsWarning` in `src/app/(app)/layout.tsx` and
  `currentSidebar()` in `src/app/(app)/notifications/actions.ts`. The footer Settings `SidebarLink` / `UnreadLink`
  gets `warn` when non-null, with `aria-label` `messages.gmail_settings_warn` or `messages.calendar_settings_warn`.
  Keep SF-108's client refresh working, and update its existing tests.
- [x] T031 [US1] On `/dev/fake-google/gmail` (`src/app/dev/fake-google/gmail/page.tsx`), show one tick box per asked
  scope, the Calendar one labelled "See, create, change and delete events on calendars you own". The answer route
  passes the ticked scopes to `consent()`. Extend `tests/integration/gmail-dev-fake.test.ts`: the box shows when
  Calendar is on, and unticking it gives `missing_scopes`.

**Checkpoint**: US1 tests green; Settings shows the Calendar line and the reconnect state.

---

## Phase 4: User Story 2 - My activities appear in my Google Calendar (Priority: P1)

**Goal**: every planned activity of a connected user has exactly one event, kept in step with every CRM change.

**Independent Test**: connect Ada, schedule a call tomorrow at 10:00 for 30 minutes and a task with no time; check her
fake calendar. Then edit, reschedule, tick, untick, reassign to Bob and delete, checking after each step.

### Tests for User Story 2

- [x] T032 [P] [US2] Unit tests in `tests/unit/calendar-rules.test.ts` (`// covers FR-005, FR-006, SC-005, US2
  scenarios 1-3, 5`):
  - `eventBody` for "Call Ada about the proposal", call, 2 Dec 2026 10:00, 30 min, note "Bring the price list", id 7:
    - summary `"Call · Call Ada about the proposal"`;
    - description `"Bring the price list\n\nOpen in Barnacle CRM: <appUrl>/activities?activity=7"`;
    - start `2026-12-02T10:00:00.000Z` and end `…10:30:00.000Z`, `timeZone` `Europe/London`;
    - reminders `{ useDefault: false, overrides: [{ method: "email", minutes: 15 }, { method: "popup", minutes: 15 }] }`;
    - `visibility: "private"`, `transparency: "opaque"`;
    - `extendedProperties.private.barnacleCrmActivity === "7"`;
    - no `attendees` key;
  - no duration → 30 minutes;
  - a task with no time on 3 Dec → `start.date "2026-12-03"`, `end.date "2026-12-04"`, reminders
    `{ useDefault: false, overrides: [] }`,
    `transparency: "transparent"`;
  - done → summary starts `"✓ "`, `overrides: []`;
  - 29 Mar 2026 00:30 for 120 min → start `2026-03-29T00:30:00.000Z`, end `2026-03-29T02:30:00.000Z` (03:30 BST);
  - 25 Oct 2026 01:30 → the first (BST) reading;
  - `googleEventBody` has only `summary`, `start`, `end`, with no "Meeting · " and no "✓ ";
  - `bodyHash` is stable under key order.
- [x] T033 [US2] Integration test `tests/integration/calendar-push-out.test.ts` (`// covers FR-004, FR-005, FR-006,
  FR-007, FR-013, SC-001, SC-003, SC-004, US2 scenarios 1-8, edge cases "Private records", "Deleted linked record"`).
  Call the domain functions, then `calendarAfterChange` / `syncCalendar` directly.
  - Schedule → one event with the values of T032.
  - Edit subject, type, note, date, time and duration → the same event id is changed (title, description, times,
    all-day or not, reminders); still one event.
  - Tick → "✓ " and no reminders; untick → back.
  - Reassign Ada → Bob (connected) → gone from Ada's calendar, one in Bob's. Reassign to Margaret (not connected) → in
    no calendar.
  - Delete the activity → event cancelled in the fake.
  - Delete the person, organisation, or deal it is linked to (`people.deletePerson`, `organisations.deleteOrganisation`,
    `deals.deleteDeal`) → event cancelled.
  - An activity inserted directly in SQL (as SF-122's Pipedrive import does) → event after `runGmailCheck`.
  - `setUnreachable(true)`, then edit → `editActivity` returns ok; after `setUnreachable(false)` and `runGmailCheck`,
    the event has the new values.
  - An insert retried after a lost answer (the fake drops the answer once) → 409 → patched, still one event.
  - Every recorded request has `sendUpdates=none` and no `attendees`.
  - An activity on a private person assigned to its owner → only in the owner's calendar, visibility private.
  - The person made private by another owner so the assignee cannot see it → event removed at the next sync.
  - A Google refusal (400) for one event → others still synced, and no retry until the next change.

### Implementation for User Story 2

- [x] T034 [US2] In `src/server/calendar/rules.ts`, implement `eventTimes`, `eventBody` and `googleEventBody`
  (research.md §4-§5), using `ukInstant`, `TYPE_LABELS`, `templates.calendar_title`,
  `templates.calendar_description`, `messages.calendar_done_mark`. Also `bodyHash` (sha256 hex of key-sorted JSON).
- [x] T035 [US2] In `src/server/calendar/sync.ts`, implement the push `pushConnection(conn, access, now)` exactly as
  research.md §7 steps 1–4, at most 200 Google writes per run (set `calendar_sync_again` when more remain):
  - gone, moved away or hidden (with `visibleActivity(db, userId)`): crm-origin `deleteEvent` then delete the row;
    google-origin → `state = 'ended'` with no Google call; crm-origin `ended` rows whose activity is null are deleted;
  - changed (`a.version <> synced_version or dirty`): `patchEvent`, then store `sent_hash`, `synced_version`, `base`,
    `google_updated_at` and `dirty = false`. `status: cancelled` or `event_gone` → `ended`;
  - missing planned activities with `due_on >= ukToday(now)`, visible to the user, and no row at all: insert a
    `creating` row (`newEventId()`, `on conflict (activity_id) do nothing`), then `insertEvent`. `exists` → `patchEvent`.
    Then `synced`. `creating` rows are retried;
  - `event_refused` → `synced_version = version`, `dirty = false` (a `creating` row is deleted).

  Every link write is conditional on the row's id, state and `activity_id`, and none is inside a Google call.
- [x] T036 [US2] In `src/server/calendar/sync.ts`, implement `calendarAfterChange(activityIds)`: the working
  Calendar connections of those activities' assignees and links, plus every connection with a link whose
  `activity_id is null`; `syncCalendar` each; errors swallowed.
- [x] T037 [US2] Call `runAfterResponse(() => calendarAfterChange(ids))` after each successful result:
  - in `src/app/(app)/activities/actions.ts`: schedule (and the follow-up schedule) with the new id, and edit, tick,
    untick and delete with `[id]`;
  - in `src/app/(app)/people/actions.ts` `deletePerson`, `src/app/(app)/organisations/actions.ts`
    `deleteOrganisation` and `src/app/(app)/deals/actions.ts` `deleteDeal`, with `[]`.

  Never before the domain call, and never when it refused.

**Checkpoint**: US2 tests green; the fake calendar mirrors every CRM change.

---

## Phase 5: User Story 3 - Changes made in Google come back to the CRM (Priority: P1)

**Goal**: moving or renaming a synced event in Google changes the activity, once, with the later change winning.

**Independent Test**: change a synced event's start, end and title in Ada's fake calendar. Deliver the notice for one
change and drop it for another, run the check, and confirm the activities show the new values once each.

### Tests for User Story 3

- [x] T038 [P] [US3] Unit tests in `tests/unit/calendar-rules.test.ts` (`// covers FR-008, FR-011, US3 scenarios 2-3,
  edge cases "Times Google allows but the CRM does not", "Title limits", "Activity on the clock change"`):
  - `fromEvent`:
    - `2026-12-04T10:00:00-05:00`–`11:00-05:00` → `2026-12-04` `15:00` 60;
    - 10:07–10:52 → `10:07` 45;
    - 10:00–10:07 → 5;
    - 30 h → 1440;
    - all-day 4–7 Dec (end exclusive) → `2026-12-04`, null, null;
    - all-day → timed 14:00–14:45 → `14:00` 45;
  - `subjectFromTitle`:
    - `"Call · Call Ada about the new price"` (call) → `"Call Ada about the new price"`;
    - `"✓ Call · X"` → `"X"`;
    - `"Meeting · X"` on a call → `"Meeting · X"`;
    - `""` / spaces → null;
    - 250 characters → the first 200;
  - `merge`:
    - Google only → Google;
    - CRM only → CRM, `dirty`;
    - both, CRM later → CRM;
    - both, Google later → Google;
    - a tie → Google;
    - null duration with a time equals 30;
  - `isCancelled`, `selfDeclined`.
- [x] T039 [US3] Integration test `tests/integration/calendar-pull.test.ts` (`// covers FR-008, FR-010, FR-011, FR-018,
  SC-002, US3 scenarios 1-6, edge cases "Both sides changed", "Archived records", "Times Google allows but the CRM does
  not", "Title limits", "Google no longer accepts the key"`):
  - move to 4 Dec 11:00–12:00 with `deliver: true` → the activity is `2026-12-04` `11:00` 60; `nextActivities`, the
    Activities list and the deal card line show it;
  - all-day ↔ timed;
  - rename;
  - a change without delivery is applied by `runGmailCheck`; delivering the same notice again changes nothing
    (`version` unchanged);
  - description, location or guest changes in Google leave the activity identical (all columns);
  - delete in Google → the activity is unchanged and the link `ended`; then edit, tick and reassign put no event in
    any fake calendar, and a change to the cancelled event never reaches it;
  - CRM 11:00 at 10:00, Google 14:00 at 10:05 (fake clock) → both 14:00; the reverse order → both 11:00;
  - a person archived → the move still applies, and `editActivity` is still refused with `archived`;
  - 10:00–10:07 in Google → the CRM shows 5 minutes and the fake event keeps 10:07;
  - an empty title leaves the subject; 250 characters → 200;
  - `expireCalendarTokens()` → the 410 catch-up applies changes made since the last sync;
  - key refused → `needs_reconnect`, saves still work; after reconnect and the check, both sides converge.

### Implementation for User Story 3

- [x] T040 [US3] In `src/server/calendar/rules.ts`, implement `fromEvent`, `subjectFromTitle`, `merge`, `isCancelled`
  and `selfDeclined` (research.md §5, §6, §9). `fromEvent` uses `ukWallClock`; durations are rounded down to a
  multiple of 5 and clamped to 5…1440.
- [x] T041 [US3] In `src/server/calendar/sync.ts`, implement the incremental pull: `listEvents` with
  `calendar_sync_token` and paging. On `sync_token_gone`, a full listing with `showDeleted=true` handling items with
  `updated >= calendar_last_synced_at − 1 hour`. Then store `nextSyncToken` and `calendar_last_synced_at = now`. The
  push runs after the pull in the same `syncCalendar`.
- [x] T042 [US3] In `src/server/calendar/sync.ts`, implement `applyLinkedChange(conn, link, item)` (research.md §9):
  - ignore `ended` rows, deleted, reassigned or hidden activities;
  - `isCancelled` (any origin), or `selfDeclined` (origin `google`) → `state = 'ended'`;
  - else, in one `sql.begin()` locking the link and the activity `for update`, merge the "when" and "subject" groups
    against `base` with `item.updated` vs `activities.updated_at`;
    - if anything came from Google, `update activities set subject, due_on, due_time, duration_minutes, version =
      version + 1, updated_at = now()` (never type, note, links, assignee or done state; archived links do not
      refuse);
    - the link gets `base`, `google_updated_at`, `synced_version` (unless `dirty`) and `dirty`.
- [x] T043 [US3] Wire the push route:
  - create `src/server/calendar/push.ts` `receiveCalendarPush(headers, now)` (research.md §11, contracts/routes.md
    § Routes);
  - create `src/app/calendar/push/route.ts` (`POST`, `dynamic = "force-dynamic"`, `maxDuration = 60`, empty bodies);
  - add `/^\/calendar\/push\/?$/` to `PUBLIC` in `src/proxy.ts`, and extend `tests/unit/proxy-matcher.test.ts`.

**Checkpoint**: US3 tests green; changes in the fake calendar come back once.

---

## Phase 6: User Story 4 - Meetings with CRM people come in from Google (Priority: P2)

**Goal**: an eligible new event with a visible CRM person as guest becomes a Meeting linked to that person and their
organisation; later changes come back.

**Independent Test**: put three events in Ada's fake calendar:
- (a) with `ana.k@example.test` as guest;
- (b) with teammates only;
- (c) with no guests.

Deliver the notices: there is exactly one Meeting, linked to Ana Fake and Fake Ltd. Move (a): it follows.

### Tests for User Story 4

- [x] T044 [P] [US4] Unit tests in `tests/unit/calendar-rules.test.ts` (`// covers FR-009, US4 scenarios 2, 6, 7,
  edge cases "Recurring events", "Event declined"`). `decideIncoming` returns null for:
  - a cancelled event;
  - `eventType` `outOfOffice` / `focusTime` / `workingLocation` / `birthday` / `fromGmail`;
  - an event with `recurrence` or `recurringEventId`;
  - an event with the `barnacleCrmActivity` marker;
  - `updated` before `since`;
  - an end before `now`;
  - the self attendee declined;
  - only self and `resource: true` guests.

  It returns the guests' addresses trimmed and lower-cased, in order, otherwise (`" ANA.K@example.test "` →
  `"ana.k@example.test"`).
- [x] T045 [US4] Integration test `tests/integration/calendar-incoming.test.ts` (`// covers FR-009, FR-018, SC-003,
  US4 scenarios 1-8, edge cases "Recurring events", "Event declined", clarifications "(No title)", "archived
  organisation", "meetings from Google"`):
  - "Intro with Ana" 8 Dec 2026 15:00–15:45 with guest `ANA.K@example.test` → one planned Meeting, due `2026-12-08`
    `15:00`, 45 minutes, assignee Ada, person Ana Fake, organisation Fake Ltd, no note. It is in Ana's and Fake Ltd's
    `nextActivities` and in Ada's Activities list; there is no assignment notification;
  - teammates only, unknown addresses, or no guests → nothing, also after `runGmailCheck`;
  - several CRM guests → linked to the first visible in guest order, listed once;
  - a private person Ada cannot see, or an archived one → nothing;
  - an event updated before the connection, or already over → nothing;
  - the CRM's own event's notice → still one activity;
  - a CRM guest added to an existing event → it comes in;
  - a weekly event → nothing;
  - declined when new → nothing. Declining a meeting that came in → the activity unchanged, the link `ended`;
  - an empty title → subject "(No title)";
  - the guest's organisation archived → only the person is linked;
  - moving it in Google moves the meeting;
  - editing its subject and time in the CRM → the fake event's summary is the subject (no "Meeting · "), with new
    times. Description, attendees, reminders and visibility are untouched, and ticking changes nothing in Google;
  - deleting it in the CRM → the fake event is still there and confirmed, and a later change to it creates no new
    activity;
  - an event organised by someone else, edited in the CRM → Google's 403 is handled: the CRM keeps its value, the
    event keeps Google's, and there is no error.

### Implementation for User Story 4

- [x] T046 [US4] In `src/server/calendar/rules.ts`, implement `decideIncoming(e, { since, now })` (research.md §10).
- [x] T047 [US4] In `src/server/calendar/sync.ts`, implement `importEvent(conn, item)` for unlinked items
  (research.md §10):
  1. one query finds the first guest address in order whose `person_emails` person has `archived_at is null` and
     `visiblePerson(db, userId)`;
  2. one `sql.begin()` inserts the Meeting: subject from `subjectFromTitle(…, "google", "meeting")` or
     `messages.calendar_untitled`; due from `fromEvent`; `organisation_id` = the person's organisation when not
     archived; `assignee_id = created_by = assigned_by = userId`;
  3. in the same transaction, the link: origin `google`, state `synced`, `base`, `synced_version = 1`, `sent_hash =
     bodyHash(googleEventBody(...))`, `google_updated_at`. Use `on conflict (connection_id, google_event_id) do
     nothing` (a concurrent run).

  Push for origin `google` uses `googleEventBody` and PATCH only, never deletes (T035), and treats `event_refused` as
  T035 does.

### Tests for the push notifications (first used here end to end)

- [x] T048 [US4] Google Calendar push notifications have no public schema on GitHub: the fake follows Google's "Push
  notifications" page (developers.google.com/calendar/api/guides/push). It copies:
  - a POST with no body and the headers `X-Goog-Channel-ID`, `X-Goog-Channel-Token`, `X-Goog-Channel-Expiration`,
    `X-Goog-Resource-ID`, `X-Goog-Resource-URI`, `X-Goog-Resource-State` (`sync` first, then `exists` /
    `not_exists`) and `X-Goog-Message-Number`;
  - notices only while the channel is active (none after `channels/stop` or after `expiration`);
  - a channel TTL of at most 7 days (`params.ttl` 604800).

  Test `tests/integration/calendar-push-route.test.ts` (`// covers FR-010, FR-013`):
  - POST `/calendar/push` through the route handler with:
    - a wrong token, an unknown channel id, another resource id, or a disconnected or Calendar-less connection → 403,
      empty body, no activity or fake event changed;
    - `X-Goog-Resource-State: sync` → 204 and no sync;
    - a real notice from `calendarNotice()` → 204 and the change applied;
    - Calendar off → 204;
  - the notices the fake delivers carry exactly the listed header names;
  - after `renewCalendarChannel`, the old channel is stopped in the fake and its notices are refused.

**Checkpoint**: US4 tests green; only meetings with visible CRM guests come in.

---

## Phase 7: Polish & cross-cutting concerns

- [x] T049 [P] Disconnect and deactivation (research.md §15) in `src/server/gmail/connections.ts`:
  - `forgetGmailInTx` also clears the calendar token, channel, lease and `calendar_connected_at`, and returns `{ token,
    channel }`;
  - `afterGmailForgotten(f)` first calls `stopChannel` (best effort), then the SF-118 steps.

  Update the callers `disconnect()`, `src/server/users.ts` `deactivate` and `src/app/(app)/admin/users/actions.ts`, and
  the existing tests that read the old return value.
- [x] T050 Integration test `tests/integration/calendar-lifecycle.test.ts` (`// covers FR-003, FR-007, FR-010, edge
  cases "Disconnect or deactivation", "Google no longer accepts the key"`):
  - after a disconnect or deactivation the fake channel is stopped, the events are left, and a reschedule leaves its
    event unchanged;
  - reconnecting gives exactly one event per planned activity due today or later (dirty links are patched, not
    duplicated);
  - `runGmailCheck` renews a channel older than 20 h and not a fresh one;
  - a 403 `insufficientPermissions` from the fake removes the Calendar scope → `calendar === "missing"` and the "!",
    while Gmail stays `working`;
  - two `syncCalendar` at once → one runs and the other sets `calendar_sync_again`; still one event each.
- [x] T051 Create `src/app/dev/fake-calendar/page.tsx` and `actions.ts` (research.md §17, FR-015). It gives 404 unless
  `isFakeAllowed()`, Gmail mode `fake` and Calendar on. It shows each fake user's events: title, start–end or all-day
  date, description, guests, reminders, private/free, declined. It has forms to:
  - create (title, date, start, end or all-day, guests, recurring tick), change, decline and delete, each with
    "deliver the notice";
  - `[ MAKE GOOGLE UNREACHABLE ]` / `[ MAKE GOOGLE REACHABLE ]`;
  - `[ EXPIRE SYNC TOKENS ]`;
  - `[ RUN THE 15-MINUTE CHECK ]` (`runGmailCheck`).

  Also:
  - add `/^\/dev\/fake-calendar\/?$/` to `PUBLIC` in `src/proxy.ts`;
  - every action revalidates the page;
  - texts are fake-page labels only.
- [x] T052 Integration test `tests/integration/calendar-dev-fake.test.ts` (`// covers FR-015`):
  - 404 outside fake mode and with Calendar off;
  - the page lists an event's fields;
  - each action changes the fake, and with "deliver" the CRM;
  - unreachable then reachable plus "run the check" converges.
- [x] T053 [P] Create `src/seed/calendar.ts` (data-model.md § Fake data, FR-016) and register it in `src/seed/index.ts`
  after `activities` and `gmail`. `src/seed/gmail.ts` asks `askedScopes()` and reconnects a Gmail-only Ada. Messages
  per the registry style ("already there calendar events" on a re-run).
- [x] T054 Extend `tests/integration/seed.test.ts` (`// covers FR-016`): seeding twice gives Ada the Calendar scope,
  one fake event per planned activity of hers due today or later, and exactly one Meeting from "Fake intro meeting"
  linked to a fake person. No duplicates on the second run.
- [x] T055 [P] Update `AGENTS.md` § Layout:
  - `src/server/calendar/`: `rules.ts` pure, `calendar-api.ts`, `fake-calendar.ts`, `sync.ts` (the reconcile, no
    Google call inside `sql.begin()`), `push.ts`, `soon.ts`;
  - `calendar_events`;
  - `/calendar/push`;
  - `/dev/fake-calendar`;
  - the `CALENDAR_SYNC` setting;
  - the seeder;
  - the Calendar checks in `tests/fakes/gmail.ts` against `calendar-api.json`.
- [x] T056 [P] Append to the end of `docs/DECISIONS.md` the six lines of plan.md § Build steps 11 (scope, no Google
  reminder for all-day activities, private/free events, meetings from Google, deleted or declined in Google ends sync, the
  15-minute job and after-response pushes), each ending "(SF-124)". There is no "Departs from blueprint" line (no
  blueprint).
- [x] T057 Run `npm test && npm run typecheck` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`.
  Everything must be green, with no `violations` left in the fake checks. Check every quickstart.md automated row has
  its test.
- [x] T058 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its
  schema) and `## Schemas` (each schema's GitHub URL at its commit).
  - Services: Google Calendar API (fake `src/server/calendar/fake-calendar.ts` via `FakeGoogleMail`, schema
    `calendar-api.json`); Google Calendar push notifications (no schema, the push guide); Gmail API (`gmail-api.json`);
    Google OAuth (no schema, RFC 6749 / 7009); Supabase Postgres (no schema, real local Postgres).
  - Schemas:
    `https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/calendar/v3/calendar-api.json`
    and the existing entries.
  - Keep the entries of the other features.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** first. T001 before everything.
- **Foundational (T004–T018)** blocks all stories. T004 → T005/T006. T010 → T011. T012 → T013 → T014. T017 → T018.
- **US1 (T019–T031)**: needs the foundation. T019 first (schema checks the other stories rely on).
- **US2 (T032–T037)**: needs US1's connect (T025–T027) for connected users.
- **US3 (T038–T043)**: needs US2's push (links exist).
- **US4 (T044–T048)**: needs US3's pull (T041).
- **Polish (T049–T058)**: after the stories. T058 last.

## Parallel examples

- Foundational: T006, T007, T008, T009, T010, T012, T015 and T016 touch different files.
- US1: T020, T021, T022 and T024 alongside T023.
- US2: T032 alongside T033's setup. US3: T038. US4: T044.
- Polish: T049, T053, T055 and T056.

## Implementation strategy

- **MVP**: Setup + Foundational + US1 + US2. Users connect with Calendar access, and their CRM activities appear and
  stay in step in Google Calendar (the reminder emails of DECISIONS 2026-11-24).
- Then US3 (Google → CRM), US4 (meetings in), then Polish.
- Commit after each checkpoint, with tests green at each.

## Notes

- **Task count**: 58.
  - Setup 3, Foundational 15.
  - US1 13, US2 6, US3 6, US4 5.
  - Polish 10.
- **Format check**: every task has a checkbox, an ID, a story label in story phases only, and file paths.
