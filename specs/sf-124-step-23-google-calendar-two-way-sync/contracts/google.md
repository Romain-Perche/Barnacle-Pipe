# Contract: Google Calendar calls, settings, setup, the fake (SF-124)

## Schemas

Add to `SCHEMAS` in `scripts/fetch-schemas.mjs`:

```js
{
  file: "calendar-api.json",
  url: "https://raw.githubusercontent.com/googleapis/google-api-go-client/3f740bc15212818d4d0eb041b02c951457ff63fa/calendar/v3/calendar-api.json",
  sha256: "eee07d697ad19b3d19c667ce6033a769c8f5bb37e33f5abf394bac47363395ec",
},
```

This is the same commit as SF-118's Gmail and Pub/Sub files: `rootUrl` `https://www.googleapis.com/`, `servicePath`
`calendar/v3/`, revision 20261030. The sha256 was checked on 2026-11-25.

## Scope

`https://www.googleapis.com/auth/calendar.events.owned`: "See, create, change, and delete events on Google calendars
you own". Every method below lists it in its discovery `scopes`.

## Calls (`src/server/calendar/calendar-api.ts`)

Base `https://www.googleapis.com/calendar/v3`. Each call has `Authorization: Bearer <access token>` and a 10 s
time-out, through SF-118's `call`. JSON bodies have `content-type: application/json`.

| Function | Request | Answer used |
|---|---|---|
| `listEvents(access, { syncToken?, pageToken?, full })` | `GET /calendars/primary/events`. Query: `maxResults=2500`, plus `syncToken` (incremental) or `showDeleted=true` (full); `pageToken` when paging | `Events`: `items[]`, `nextPageToken`, `nextSyncToken`. 410 → `sync_token_gone` |
| `insertEvent(access, body)` | `POST /calendars/primary/events?sendUpdates=none`. Body `Event` with `id` | `Event` (`id`, `updated`, `status`). 409 → `exists` |
| `patchEvent(access, id, body)` | `PATCH /calendars/primary/events/{id}?sendUpdates=none` | `Event`. 404/410 → `event_gone` |
| `deleteEvent(access, id)` | `DELETE /calendars/primary/events/{id}?sendUpdates=none` | 204. 404/410 count as done |
| `watchEvents(access, channel)` | `POST /calendars/primary/events/watch`. Body `Channel` `{ id, type: "web_hook", address, token, params: { ttl: "604800" } }` | `Channel`: `id`, `resourceId`, `expiration` (ms as string) |
| `stopChannel(access, { id, resourceId })` | `POST /channels/stop`. Body `Channel` `{ id, resourceId }` | 204 |

`Event` fields read: `id`, `status`, `summary`, `start{date,dateTime,timeZone}`, `end{…}`, `updated`, `recurrence`,
`recurringEventId`, `eventType`, `attendees[]{email,self,resource,responseStatus}`, `extendedProperties.private`.

`Event` fields written (research.md §4):
- origin `crm`: `id` (insert only), `summary`, `description`, `start`, `end`, `reminders{useDefault,overrides[]{method,
  minutes}}`, `visibility`, `transparency`, `guestsCanInviteOthers`, `extendedProperties{private}`;
- origin `google`: `summary`, `start`, `end`.

Never `attendees`.

Errors (`classifyCalendarError`, research.md §13). Nothing from Google's body is kept but the status and the reason
code.

### Push notifications (no public schema: plan.md § Outside services)

Google POSTs to `pushAddress` with no body and the headers `X-Goog-Channel-ID`, `X-Goog-Channel-Token`,
`X-Goog-Channel-Expiration`, `X-Goog-Resource-ID`, `X-Goog-Resource-URI`, `X-Goog-Resource-State` (`sync` | `exists` |
`not_exists`) and `X-Goog-Message-Number`. Handled per research.md §11.

## Settings

| Setting | Where | Meaning |
|---|---|---|
| `CALENDAR_SYNC` | `.env.example`, README, Vercel | `on` turns Google Calendar sync on (it needs Gmail set up, SF-118). Anything else: off. Connect asks only the Gmail permissions and nothing syncs. |

No other new setting. Calendar uses SF-118's `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `APP_URL` /
`GMAIL_TOKEN_KEY` / `CRON_SECRET`.

## Google Cloud setup (README "Google Calendar" section)

1. In the same Google Cloud project as sign-in and Gmail, enable the **Google Calendar API**.
2. On the OAuth consent screen (Internal app), add the scope `.../auth/calendar.events.owned`.
3. The push address is `${APP_URL}/calendar/push`. It must be HTTPS with a valid certificate (Vercel's is).
   - If `events.watch` is refused for the domain, verify the domain in Google Search Console for the project.
   - Until then sync still works through the 15-minute check.
4. Set `CALENDAR_SYNC=on` in Vercel (Production; Preview only with real settings).
5. Every user connected before this goes live sees the "!" and reconnects once (US1).

## Fake (`src/server/calendar/fake-calendar.ts`)

`FakeGoogleMail.fetch` sends URLs starting `https://www.googleapis.com/calendar/v3/` to `fakeCalendarFetch(state,
req, now)`. State lives in `FakeState`:

```ts
calendars: Record<string, {           // by user email
  seq: number;                        // change counter; a sync token is "fake-sync-<seq>"
  syncFloor: number;                  // tokens below it answer 410
  events: FakeEvent[];                // Event fields of § Calls plus organizer, created, updated, changedAt (seq)
}>;
channels: { id: string; token: string; address: string; resourceId: string; email: string; expiration: number }[];
unreachable: boolean;
```

Behaviour (as Google):
- the access token's scopes must include `calendar.events.owned` (or the broader `calendar.events` / `calendar`),
  else 403 `insufficientPermissions`;
- ids must be base32hex, 5–1024 characters, else 400;
- a duplicate id → 409;
- `sendUpdates` other than `none` is recorded, and a test fails on it (SC-004). Attendees sent by the app are recorded;
  a test fails on them too;
- a patch from a non-organiser on `summary`/`start`/`end` → 403 `forbiddenForNonOrganizer`;
- a patch or delete of a cancelled event → 410; an unknown id → 404;
- every write sets `updated` (fake clock: `Date.now() + offsetMs`) and `changedAt = ++seq`;
- a delete makes the event `cancelled`;
- the listing follows § Calls, with cancelled items only with `syncToken` or `showDeleted=true`;
- `unreachable` makes every Google URL (token endpoint included) throw `TypeError("fetch failed")`.

Tester API (methods of `FakeGoogleMail`, used by the page, the seeder and tests):
- `addEvent(email, { summary, start, end | allDay, attendees?, recurrence?, organizer?, eventType? }, { deliver })`;
- `changeEvent(email, id, patch, { deliver })`;
- `declineEvent(email, id, { deliver })`;
- `deleteEvent(email, id, { deliver })`;
- `calendarEvents(email)`;
- `calendarNotice(email): Headers | null`;
- `setUnreachable(on)`;
- `expireCalendarTokens(email?)`.

`deliver: true` calls `receiveCalendarPush(calendarNotice(email))` in process, as the SF-118 fake delivers Gmail
notices.

## Checks (`tests/fakes/gmail.ts`)

Same pattern as the SF-118 Gmail checks, over `.factory/schemas/calendar-api.json`:
- every Calendar request: the path and HTTP method are among `resources.events` / `resources.channels` methods; each
  query parameter is declared for that method (or among the discovery's top-level `parameters`); each JSON body
  property is declared in `Event` / `Channel`, recursively (`EventDateTime`, `EventReminder`, `EventAttendee`,
  extended properties as string maps);
- every answer's properties are declared in `Event`, `Events` or `Channel` with their JSON types;
- push notices the fake delivers carry exactly the header names of § Push notifications;
- violations are kept in `violations` and fail the test in `afterEach`, as for Gmail.
