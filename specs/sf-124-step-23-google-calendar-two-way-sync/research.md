# Research: Google Calendar: two-way sync (SF-124)

Each section: Decision, Rationale, Alternatives considered. References to Google's API are to `calendar-api.json`
(googleapis/google-api-go-client @ `3f740bc15212818d4d0eb041b02c951457ff63fa`, revision 20261030) and Google's
"Push notifications" and "Synchronize resources efficiently" guides.

## §1 Calling Google

- **Decision**: `src/server/calendar/calendar-api.ts` makes each Calendar call with the SF-118 helpers of
  `gmail/google-api.ts`:
  - `call` (10 s time-out; `fetch` from `settings()`: test fetch, fake or real);
  - `readJson`;
  - `refreshAccessToken` (a fresh access token per run, never stored);
  - the error classes `GoogleKeyRefused` / `GoogleUnavailable`.

  Those helpers are exported, not copied. Base URL `https://www.googleapis.com/calendar/v3`, calendar id `primary`.
- **Rationale**: one way to reach Google, one test switch (`useGmailFetchForTests`), one fake. Same connection, same key.
- **Alternatives**: the `googleapis` npm package (a large dependency for six calls; the repo uses plain `fetch`
  everywhere); a second fetch switch for Calendar (two fakes to keep in step).

## §2 Scope and consent

- **Decision**: scope `https://www.googleapis.com/auth/calendar.events.owned`. `askedScopes()` = `GMAIL_SCOPES`, plus
  that scope when `calendarConfig().mode !== "off"`. `consentUrl` asks `askedScopes()`.
  `hasAllScopes(scope, asked = askedScopes())` must find every asked scope in Google's answer, or the connection is
  refused with nothing stored (US1 scenario 2). `messages.gmail_missing_scopes` becomes "Google needs all the
  permissions asked for. Try again and tick every box."
- **Rationale**: `events.insert/patch/delete/list/watch` and `channels.stop` all accept `calendar.events.owned`
  (discovery `scopes` of each method). It is limited to calendars the user owns; the primary calendar is one. It cannot
  read other calendars, share calendars or change settings. Narrowest is safest (spec § Clarifications).
- **Alternatives**: `calendar.events` (every calendar the user can see); `calendar` (full); `calendar.app.created`
  (only calendars the app creates, not the primary one).

## §3 Connection states

- **Decision**: the Calendar state of a connection is derived, not stored as a state:
  - Calendar off (`calendarConfig().mode === "off"`): no Calendar line, no Calendar "!", no sync;
  - connection `working` and `scopes` has the Calendar scope: "Syncing your activities with your Google Calendar";
  - connection `working` without it: "Not synced: Calendar access missing", the reconnect message,
    `[ RECONNECT GMAIL ]` beside `[ SEND ME A TEST EMAIL ]` and `[ DISCONNECT ]`, and the "!";
  - `needs_reconnect`: the SF-118 card unchanged, with no Calendar line (nothing syncs; the SF-118 "!" is already
    there).

  `calendar_connected_at` marks when calendar sync (re)started. In `finishConnect`, when the granted scopes include
  Calendar:
  - (a) a new connection, one coming back from `disconnected`, or a `working` one that lacked the Calendar scope:
    `calendar_connected_at = now`, sync token, channel and `calendar_last_synced_at` cleared. All `synced` links of
    the connection get `dirty = true`: the CRM's values are sent again, since nothing was synced while off;
  - (b) `needs_reconnect` → `working` with Calendar already granted before: everything kept, so the next sync carries
    on from the stored token (or a catch-up, §8).

  The outcome is `reconnected` for (b) and for the "lacked Calendar" case, so Settings shows "Gmail reconnected."
  (US1 scenario 4).
- **Rationale**: one connection, one key (spec Assumptions). Deriving the state from `scopes` cannot drift.
- **Alternatives**: a separate `calendar_state` column (one more state to keep consistent with `scopes`).

## §4 The event the CRM writes

- **Decision**: `eventBody(activity, appUrl)` (pure) gives, for an activity of origin `crm`:
  - `summary`: `"<Type> · <subject>"`, prefixed by `"✓ "` when done;
  - `description`: the note (if any), a blank line, then `"Open in Barnacle CRM: <appUrl>/activities?activity=<id>"`
    (`templates.calendar_description`);
  - `start`/`end`: §5;
  - `reminders`: `{ useDefault: false, overrides: [{ method: "email", minutes: M }, { method: "popup", minutes: M }] }`.
    M = 15 with a time, 0 without (§19). Done: `{ useDefault: false, overrides: [] }`;
  - `visibility: "private"`;
  - `transparency`: `"transparent"` for all-day, `"opaque"` with a time;
  - `extendedProperties.private`: `{ barnacleCrmActivity: "<id>" }`;
  - no `attendees`, `guestsCanInviteOthers: false`.

  Every write sends `sendUpdates=none`. `insert` also sends the CRM-chosen `id` (§7).

  For origin `google` (a meeting that came in), `googleEventBody` gives only `summary` (the subject, no type prefix,
  no "✓ ") and `start`/`end`, sent as a PATCH. Description, guests, reminders and visibility are never sent (spec
  § Clarifications). `hash(body)` = sha256 hex of the JSON with sorted keys. It is stored as `sent_hash`, for tests and
  for skipping a write that would change nothing.
- **Rationale**: FR-005 and the clarifications. Private and transparent avoid leaking or blocking. The extended
  property lets a sync recognise the CRM's own event before its link row is saved (US4 scenario 7).
- **Alternatives**: PUT for full updates (it would erase fields Google or the user set, such as colour); a public
  event (it shows private people's activities to calendar viewers).

## §5 Times, both ways (UK time)

- **Decision**:
  - **CRM → Google, with a time**: `start.dateTime = ukInstant(dueOn, dueTime).toISOString()`, `timeZone:
    "Europe/London"`. `end` = start + (duration ?? 30) minutes of real time, so 00:30 + 2 h on 29 Mar 2026 ends at
    03:30 BST.
  - **CRM → Google, no time**: `start.date = dueOn`, `end.date = dueOn + 1 day` (exclusive end).
  - **Google → CRM** (`fromEvent`, pure):
    - `start.date` (all-day): `dueOn = start.date`, no time, no duration, whatever the end (4–6 Dec → 4 Dec);
    - `start.dateTime` (any offset; New York 10:00 → 15:00 GMT): `dueOn`/`dueTime` = `ukWallClock(start)` (minutes,
      seconds dropped);
    - duration = whole minutes between start and end, rounded down to a multiple of 5, clamped to 5…1440. So 45 → 45,
      7 → 5, 30 h → 1440. The `activities` check allows only multiples of 5 within 5…1440.

    The values read from Google become the new "agreed" base. The push then finds nothing to send, and the event keeps
    the times set in Google (edge case "Times Google allows but the CRM does not").
  - The CRM's "no duration" with a time maps to a 30-minute event (US2 scenario 2). Reading it back gives 30, not null:
    if the CRM-side value is null and Google's is 30, that counts as no change.
- **Rationale**: `ukInstant` and the `Intl` UK parts already exist in `activities/rules.ts`; a UK wall clock read from
  an instant is never inside the spring gap.
- **Alternatives**: sending local times with `timeZone` only (correct too, but the instant form is what tests compare).

## §6 Titles from Google

- **Decision**: `subjectFromTitle(summary, origin, type)` (pure):
  1. trim; remove one leading `"✓ "`;
  2. for origin `crm`, remove a leading `"<label of the activity's own type> · "`; for origin `google`, remove a
     leading `"Meeting · "`;
  3. trim again;
  4. empty → no change to the subject;
  5. keep the first 200 code points, then trim (subject checks: trimmed, non-empty, ≤ 200).

  A title that starts with another type's label becomes the whole subject; the type never changes (US3 scenario 3).
  A new meeting with an empty title gets `messages.calendar_untitled` = "(No title)".
- **Rationale**: US3 scenario 3, edge case "Title limits".

## §7 CRM → Google: a reconcile per connection

- **Decision**: `pushConnection(conn)` runs under the connection's calendar lease (§14). It works out what Google
  should have, compares it with `calendar_events`, and acts in this order, with at most 200 writes per run:
  1. **Gone or moved away**: link rows of this connection whose activity is deleted (`activity_id is null`), assigned to
     someone else, or no longer `visibleActivity(user)`:
     - state `synced`/`creating`, origin `crm`: `events.delete` (404/410 count as done), then delete the row;
     - origin `google`: no Google call; the event stays (clarification). The row becomes `state = 'ended'` and is
       kept, even once `activity_id` is null: the event id stays known, so a later change to that event in Google is
       ignored and never imported again (§9). A reassigned or hidden meeting from Google is not given a CRM event in
       the new assignee's calendar either (its `ended` row blocks it);
     - state `ended`, origin `crm`, with `activity_id is null`: delete the row (its event is gone or never comes back:
       it carries the CRM's marker, §10).
  2. **Changed**: `synced` rows whose `a.version <> synced_version` or `dirty`. Build the body (§4); patch when its hash
     differs from `sent_hash`.
     - On success: `sent_hash`, `synced_version = a.version`, `base`, `google_updated_at = answer.updated`,
       `dirty = false`.
     - If the answer has `status: "cancelled"`, or Google says 404/410: the event was deleted in Google, so
       `state = 'ended'` (FR-018).
  3. **Missing**: activities with `assignee_id = user`, `done_at is null`, `due_on >= ukToday(now)`, visible to the
     user, with no `calendar_events` row at all (an `ended` row blocks them for good). For each:
     - insert a row `state = 'creating'`, `google_event_id = newEventId()` (`"crm"` + 32 base32hex characters from
       20 random bytes; allowed characters a–v, 0–9, length 5–1024), `on conflict (activity_id) do nothing`;
     - call `events.insert` with that id;
     - a 409 (the id already exists: a retried insert) is handled as success through `events.patch`;
     - then `state = 'synced'` and the same fields as in step 2.

     `creating` rows left by a failed run are retried the same way.
  4. A write Google refuses for that one event (400, or 403 `forbiddenForNonOrganizer` and other non-quota 403 reasons,
     §13): `synced_version = a.version`, `dirty = false`, `sent_hash` unchanged. It is tried again only after the next
     CRM change (no retry loop).
     - For a `creating` row refused on insert: delete the row.
- **Rationale**:
  - A desired-state comparison catches every way an activity changes without hooking each one: SF-122's Pipedrive
    import (inserts with ids), the record deletes (`deals.ts`, `people.ts`, `organisations.ts` delete activities
    directly), visibility changes and reassignments.
  - Client-chosen event ids make "exactly one event" (FR-004, SC-003) hold across retries and concurrent runs.
  - `version` is bumped by every activity change (SF-109), and the link remembers the version it sent.
- **Alternatives**: an outbox table written by every activity change (every writer must remember it; misses
  visibility changes); database triggers (the repo has none; hidden behaviour).

## §8 Google → CRM: incremental listing

- **Decision**: `pullConnection(conn)`:
  - with `calendar_sync_token`: `events.list(primary, syncToken, maxResults=2500, pageToken…)` until `nextSyncToken`.
    Deleted events always come back, as `status: "cancelled"`;
  - without a token (first sync after connecting) or after a **410** (token expired): a full listing
    (`maxResults=2500`, `showDeleted=true`, no time filter, so Google returns a `nextSyncToken`). Only items with
    `updated >= since` are handled:
    - first sync: since = `calendar_connected_at`, so earlier events never come in (US4 scenario 6);
    - catch-up: since = `calendar_last_synced_at` − 1 hour (the SF-118 margin).

    This is the one place the time filter applies. `timeMin` / `updatedMin` cannot be combined with sync tokens
    (discovery `syncToken` description).
  - every handled item goes through §9 (linked) or §10 (new). Then `calendar_sync_token = nextSyncToken` and
    `calendar_last_synced_at = now`, and the push runs (§7).

  Applying a change twice is harmless: the merge compares with the agreed base, so a repeated notice changes nothing
  (US3 scenario 4).
- **Rationale**: Google's documented sync pattern. One code path for the first sync, a catch-up and a normal sync.
- **Alternatives**: `updatedMin` polling (no deletions, clock skew); fetching each linked event by id (n calls, no new
  events).

## §9 Merge and "the later change wins"

- **Decision**: for an item whose `(connection_id, google_event_id)` has a link:
  - `ended` → ignore;
  - the activity is deleted, assigned to someone else or hidden from the user → ignore (the push removes the link);
  - `status: "cancelled"`, or origin `google` with the user's own attendee (`self: true`) `responseStatus: "declined"`
    → `state = 'ended'`; the activity is unchanged (FR-018);
  - otherwise, in one transaction (link and activity locked `for update`):
    - `g = fromEvent(item)` and the subject from §6;
    - `c` = the activity's current values; `b` = `base`;
    - for each group — **when** (`dueOn`, `dueTime`, `durationMinutes`) and **subject**:
      - Google changed (g ≠ b) and the CRM did not (c = b) → take g;
      - only the CRM changed → keep c and set `dirty`;
      - both changed → the later wins: `item.updated` vs `activities.updated_at`. Ties go to Google;
    - when anything is taken from Google:
      `update activities set … , version = version + 1, updated_at = now()`;
    - the link gets: `base` = the merged values, `google_updated_at = item.updated`, and
      `synced_version = new version` unless `dirty`;
    - nothing else of the event is read: no note, links, assignee, done state or type (FR-008, US3 scenario 5).

  The change is not refused for archived links: a move in Google still moves the activity (edge case "Archived
  records").
- **Rationale**: a three-way merge against the last agreed values is the only way to tell who changed what. With
  `updated_at` it gives FR-011 ("both show 14:00").
- **Alternatives**: last-writer-wins on the whole activity (Google would overwrite a CRM note change through an
  unrelated move); always-Google or always-CRM wins.

## §10 Events that come in (US4)

- **Decision**: `decideIncoming(item, { since, now, crmEventMarker })` (pure). It says "consider" only when:
  - the item is not cancelled;
  - `eventType` is absent or `"default"`;
  - it has no `recurrence` and no `recurringEventId`;
  - it has no `extendedProperties.private.barnacleCrmActivity` (the CRM's own, US4 scenario 7);
  - `updated >= calendar_connected_at`;
  - its end is after `now`;
  - the user's own attendee (`self: true`) has not declined;
  - it has at least one guest that is not the user (`self`) and not a room or resource (`resource: true`).

  The guests' addresses (trimmed, lower-cased) keep the event's order. One query finds the first address belonging to
  a person with `archived_at is null` and `visiblePerson(user)` through `person_emails` (stored lower-case, SF-90);
  ties go by guest order.

  The insert happens in one transaction:
  - `insert into activities (type 'meeting', subject from §6 or "(No title)", due from §5, note null, person_id,
    organisation_id = the person's organisation when it is not archived, assignee_id = created_by = assigned_by = user)`.
    `assigned_by = assignee`, so no assignment notification;
  - a link row: origin `google`, state `synced`, the event's id, `base` = the values, `synced_version` = 1,
    `sent_hash` = hash of `googleEventBody`, so nothing is sent back.

  A later change to the event goes through §9. An event that does not qualify now may qualify later (a CRM guest
  added, US4 scenario 8): every change of an unlinked event is considered again.
- **Rationale**: FR-009 and DECISIONS 2026-11-24 ("only events with a CRM person as a guest"). The visibility rule
  keeps private people out (US4 scenario 5).

## §11 Push notifications (Google → `/calendar/push`)

- **Decision**:
  - **Watch**: `events.watch(primary)` with body `{ id: randomUUID(), type: "web_hook", address:
    calendarConfig().pushAddress, token: <32 random bytes, base64url>, params: { ttl: "604800" } }`. Store
    `calendar_channel_id`, `calendar_channel_resource_id` (from the answer), `calendar_channel_token_hash` (sha256 of
    the token, never the token) and `calendar_channel_expires_at` (the answer's `expiration`, ms).
  - **Renewal**, in the 15-minute check when `calendar_channel_renewed_at` is null or older than 20 h: watch again,
    store the new channel, then `channels.stop` the old one after commit (best effort).
  - **`POST /calendar/push`** → `receiveCalendarPush(headers)`:
    - Calendar off → 204;
    - find the connection with `calendar_channel_id = X-Goog-Channel-ID`, `state = 'working'` and the Calendar scope.
      It must have `timingSafeEqual(sha256(X-Goog-Channel-Token), calendar_channel_token_hash)` and `X-Goog-Resource-ID
      = calendar_channel_resource_id`. Otherwise **403** (edge case "Notices not from Google");
    - `X-Goog-Resource-State: sync` → 204 (the channel's first message);
    - otherwise `syncCalendar(connection)` (errors swallowed: the check catches up) → 204.

    Empty bodies always.
- **Rationale**: Calendar web-hook notices carry no signature. Google's guide says to authenticate them with the
  channel token the app sets. A per-channel random token, compared in constant time and stored hashed, is the proof.
- **Alternatives**: the Gmail Pub/Sub path (Calendar cannot publish to Pub/Sub); accepting any notice for a known
  channel id (ids are not secret).

## §12 When syncs run

- **Decision**: `syncCalendar(connectionId)` = lease → pull (§8) → push (§7) → release. It runs again while
  `calendar_sync_again` was set during the run, at most 5 rounds (the SF-118 pattern). It is called by:
  - **after a CRM change**: `calendarAfterChange(activityIds)` finds the connections concerned: the assignees' working
    connections, the connections of the activities' links, and any connection with a link whose `activity_id is null`.
    It calls `syncCalendar` on each. Activity actions and record delete actions call it through
    `runAfterResponse(fn)` (`src/server/calendar/soon.ts`), which wraps `after` from `next/server` so the work runs
    once the response is sent. Outside a request (tests, the seeder, scripts) it runs `fn()` at once. Errors are
    swallowed;
  - **the push route** (§11);
  - **the 15-minute check**: in `runGmailCheck`, for each working connection with the Calendar scope, after its Gmail
    part: `syncCalendar`, then `renewCalendarChannel` when due. It shares the same 240 s budget;
  - **the connect callback**: `runAfterResponse(() => syncCalendar(id))` after `connected` / `reconnected`. That gives
    the first listing (token only) and the events of planned activities due today or later (US1 scenario 4).
- **Rationale**: FR-007 (saving never waits) and SC-001 (≤ 1 minute when Google answers). `after()` is Next's
  supported way (Vercel `waitUntil`).
- **Alternatives**: awaiting Google in the action (up to 10 s × calls on every save); a queue service (not in the
  stack).

## §13 Google's errors for Calendar

- **Decision**: `classifyCalendarError(status, body)` (pure) →
  - `key_refused`: 401;
  - `no_calendar_access`: 403 with reason `insufficientPermissions`, or `error.status = "PERMISSION_DENIED"` with
    details `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. The Calendar scope is removed from `scopes`, so the card shows
    "Calendar access missing" and the "!". Gmail is not touched;
  - `unavailable`: 403 with reason `rateLimitExceeded`, `userRateLimitExceeded` or `quotaExceeded`; 429; 5xx;
    network; time-out;
  - `sync_token_gone`: 410 on a listing with a token → §8 catch-up;
  - `event_gone`: 404 / 410 on an event write → §7 / §9;
  - `exists`: 409 on insert → §7;
  - `event_refused`: any other 4xx on an event write.

  A refused refresh token (`invalid_grant`) is already `GoogleKeyRefused` from `refreshAccessToken`. It goes to
  `markNeedsReconnect` (SF-118).
- **Rationale**: SF-118's `classifyGoogleError` treats a Gmail 403 as "key refused". For Calendar, 403 also means
  "not the organiser" or "slow down", which must not break the user's whole connection.

## §14 Concurrency

- **Decision**: a calendar lease on the connection row (`calendar_lease_until`, 2 minutes; `calendar_sync_again`),
  separate from Gmail's so the two never wait on each other. Every database write is one statement or one short
  `sql.begin()` with no Google call inside. Link writes are conditional
  (`where id = … and state = … and activity_id = …`), so a row changed meanwhile is left for the next run.
  `on conflict (activity_id) do nothing` and the client-chosen event id make concurrent creators harmless.
- **Rationale**: the SF-118 pooler rules (no session state, no locks across network calls).

## §15 Disconnect and deactivation

- **Decision**:
  - `forgetGmailInTx` also clears the channel, token, lease and `calendar_connected_at` columns. It returns
    `{ token, channel: { id, resourceId } | null }`, so `afterGmailForgotten` can `channels.stop` before revoking the
    key (FR-003);
  - links are kept, and events in Google stay unchanged (edge case "Disconnect"). Nothing is pushed while the
    connection is not `working`;
  - on a new connection, §3(a) marks the kept links dirty: the CRM's values are sent and no event is made twice.
- **Rationale**: same as SF-118 (copied data is kept), and "exactly one event" after reconnecting.

## §16 Settings

- **Decision**: `calendarConfig()` in `env.ts` → `{ mode: "off" } | { mode: "real" | "fake"; pushAddress: string }`.
  It is on when `CALENDAR_SYNC === "on"` and `gmailConfig().mode !== "off"`. `pushAddress = ${appUrl}/calendar/push`
  (in fake mode the same address; the fake delivers in process). One new setting, `CALENDAR_SYNC`, in `.env.example`
  and the README. `vitest.config.ts` sets it to `on`; tests of edge case "Calendar not set up" stub it to `""`.
- **Rationale**: FR-015 ("reached through settings") and the edge case "Calendar not set up" need a switch. Everything
  else is the Gmail setup.

## §17 The fake Google Calendar

- **Decision**: `src/server/calendar/fake-calendar.ts`, plugged into `FakeGoogleMail.fetch` for URLs under
  `https://www.googleapis.com/calendar/v3/`. It shares `FakeState` (new `calendars`, `channels`, `unreachable` fields)
  and the fake's access tokens (scopes checked: `calendar.events.owned` needed, else 403 `insufficientPermissions`).
  Like Google:
  - **events**:
    - ids are given or made;
    - an insert with an existing id → 409;
    - every write bumps `updated` (the fake's clock with `offsetMs`) and the calendar's change sequence;
    - a delete makes the event `cancelled`;
    - a patch of a cancelled event → 410;
  - **listing**: a sync token is the change sequence. Tokens older than `syncFloor` → 410
    (`expireCalendarTokens()`). A full listing gives everything except cancelled items, which come back only with
    `showDeleted=true`;
  - **channels**: a watch records `{ id, token, address, resourceId, expiration }`; `channels.stop` removes it. A notice
    is the headers of Google's POST for the active channel;
  - **`unreachable`**: every Google call (token endpoint included) gets a network error, which the app reads as
    `GoogleUnavailable`;
  - **non-organiser**: events made by `addEvent({ organizer: other })` refuse start/end/summary patches with 403
    `forbiddenForNonOrganizer`.

  The tester API covers: `addEvent`, `changeEvent`, `declineEvent`, `deleteEvent` (each with or without
  `deliver: true`), `events(email)`, `calendarNotice(email)`, `setUnreachable(bool)` and `expireCalendarTokens()`.

  The page **`/dev/fake-calendar`** is 404 unless `isFakeAllowed()` and Gmail mode `fake` and Calendar on. It shows,
  per fake user:
  - the events: title, start–end or all-day date, description, guests, reminders, private/free, and whether the user
    declined;
  - forms to create (title, date, start, end or all-day, guests, recurring tick), change, decline and delete an event,
    each with a "deliver the notice" tick;
  - `[ MAKE GOOGLE UNREACHABLE ]` / `[ MAKE GOOGLE REACHABLE ]`;
  - `[ EXPIRE SYNC TOKENS ]`;
  - `[ RUN THE 15-MINUTE CHECK ]` (`runGmailCheck`).

  The fake consent screen `/dev/fake-google/gmail` shows one tick box per asked scope, the Calendar one labelled "See,
  create, change and delete events on calendars you own".
- **Rationale**: FR-015, and the spec's edge cases all read from this page. One fake Google for Gmail and Calendar,
  because one key and one token endpoint serve both.

## §18 Fake data

- **Decision**: `src/seed/calendar.ts` (fake mode and Calendar on only):
  1. Ada Fake's connection gets the Calendar scope. `seedGmail` already connects her through the fake consent with
     `askedScopes()`; a connection seeded before this issue is reconnected the same way;
  2. `syncCalendar` puts her planned activities due today or later into her fake calendar;
  3. one event "Fake intro meeting" seven days ahead, 15:00–15:45 UK time, with the first visible non-archived fake
     person's address as guest, is added to her fake calendar after the connection, then `syncCalendar` brings it in
     as a Meeting.

  Re-runnable: it skips when the connection already has a `calendar_events` row of origin `google`.
- **Rationale**: FR-016, through the real paths (as the SF-118 seeder).

## §19 Reminder of an activity with no time

- **Decision**: overrides `email` and `popup` at **0 minutes** (the start of the all-day event: midnight in the user's
  Google Calendar time zone). Recorded in spec § Clarifications and `docs/DECISIONS.md`.
- **Rationale**: `EventReminder.minutes` is "minutes before the start", 0 to 40,320 (discovery). An all-day event
  starts at midnight, so 9:00 on the day would be −540 and Google refuses it. 0 is the allowed value closest to 9:00
  on the day. The alternative, 900 (9:00 the day before), is 24 hours off.
- **Alternatives**: making the event timed at 9:00 (the spec asks for an all-day event); no reminder.

## §20 Dependencies

- **Decision**: none added. `after` ships with Next 16; everything else is `fetch` and `node:crypto`.
