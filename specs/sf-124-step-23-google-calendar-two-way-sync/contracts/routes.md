# Contract: card, routes, actions, domain functions, messages (SF-124)

## Pages

| Path | Who | What |
|---|---|---|
| `/settings` | any signed-in active user (`requireUser()`) | The SF-118 Gmail card gains the Calendar line and message (design A). Nothing else changes. |
| `/dev/fake-google/gmail` | public, 404 unless `isFakeAllowed()` and Gmail mode `fake` | SF-118's fake consent screen; one more tick box when the Calendar scope is asked. |
| `/dev/fake-calendar` | public, 404 unless `isFakeAllowed()`, Gmail mode `fake` and Calendar on | The fake calendar page (research.md §17). |

No activity screen changes (design A).

`src/proxy.ts` `PUBLIC` gains `/^\/calendar\/push\/?$/` and `/^\/dev\/fake-calendar\/?$/`.

### Gmail card (design A of `design-options.html`)

When Calendar is on (`calendarConfig().mode !== "off"`) and the connection is `working`:

| Calendar | Heading | Body | Heading buttons |
|---|---|---|---|
| `syncing` | green dot · `Gmail · connected` | the SF-118 lines, then "Calendar: Syncing your activities with your Google Calendar" | `[ SEND ME A TEST EMAIL ]`, `[ DISCONNECT ]` (red), as SF-118 |
| `missing` | green dot · `Gmail · connected` | first, in the warning style (`.err`, as SF-118's reconnect message): "Reconnect Google to sync your activities with your calendar."; then the SF-118 lines, then "Calendar: Not synced: Calendar access missing" | `[ RECONNECT GMAIL ]` (solid, the SF-118 `startGmailConnect` form), `[ SEND ME A TEST EMAIL ]`, `[ DISCONNECT ]` (red) |

- `needs_reconnect`, not connected, or Calendar off: exactly as SF-118, with no Calendar line.
- The line is one more `<li>` of `.gm-lines`, built from `templates.calendar_line(messages.calendar_syncing |
  messages.calendar_missing)`.
- `GmailSettings` gains `calendar: "off" | "syncing" | "missing"` (`"off"` also when not `working`).

### Settings notices

- `?gmail=missing_scopes` now shows "Google needs all the permissions asked for. Try again and tick every box."
  (`messages.gmail_missing_scopes`, text changed).
- `reconnected` (flash "Gmail reconnected.") is also used when a `working` connection without Calendar reconnects with
  it.

### Sidebar "!"

`settingsWarning(userId): Promise<"gmail" | "calendar" | null>` replaces `gmailNeedsReconnect` in `layout.tsx` and
`currentSidebar()`:
- `"gmail"` when `needs_reconnect`;
- `"calendar"` when Calendar is on, the connection is `working` and the Calendar scope is missing;
- else `null`.

`SidebarLink` gets `warn` when non-null. Its `aria-label` is `messages.gmail_settings_warn` (`"gmail"`) or
`messages.calendar_settings_warn` (`"calendar"`). `currentSidebar()` returns `{ unread, gmailWarn: boolean,
warnLabel: string | null }`, or the minimal change that keeps SF-108's client refresh working.

## Routes

| Route | Method | Proof | Answer |
|---|---|---|---|
| `/calendar/push` | POST | headers `X-Goog-Channel-ID` + `X-Goog-Channel-Token` (sha256 compared in constant time with the stored hash) + `X-Goog-Resource-ID`, for a `working` connection with Calendar | Calendar off → `204`. Bad or missing proof → `403`. `X-Goog-Resource-State: sync` → `204`. Otherwise `syncCalendar` then `204`. Empty bodies, never data. `dynamic = "force-dynamic"`, `maxDuration = 60`. |
| `/cron/gmail` | GET | unchanged (`CRON_SECRET`) | unchanged. `runGmailCheck` now also runs the calendar part (research.md §12). |
| `/settings/gmail/callback` | GET | unchanged | unchanged, plus `runAfterResponse(() => syncCalendar(connectionId))` after `connected` / `reconnected` when Calendar is granted. |

`vercel.json` unchanged.

## Server actions (each keeps its `requireUser()` / `assertAdminForAction()` first)

After a successful result, and only then, each of these calls `runAfterResponse(() => calendarAfterChange(ids))`:

| File | Actions | ids |
|---|---|---|
| `src/app/(app)/activities/actions.ts` | schedule (and the follow-up schedule), edit, tick, untick, delete | `[id]` (the new id for schedule) |
| `src/app/(app)/people/actions.ts` | `deletePerson` | `[]` (orphaned links are picked up) |
| `src/app/(app)/organisations/actions.ts` | `deleteOrganisation` | `[]` |
| `src/app/(app)/deals/actions.ts` | `deleteDeal` | `[]` |
| `src/app/(app)/settings/actions.ts` | `disconnectGmail` | none: `disconnect()` itself stops the channel after commit |
| `src/app/(app)/admin/users/actions.ts` | deactivate | none: `afterGmailForgotten({ token, channel })` |

## Domain functions

### `src/server/env.ts`

- `calendarConfig(): { mode: "off" } | { mode: "real" | "fake"; pushAddress: string }`. It is on when
  `CALENDAR_SYNC === "on"` and `gmailConfig().mode !== "off"`. `pushAddress = ${gmailConfig().appUrl}/calendar/push`.

### `src/server/gmail/rules.ts`

- `CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned"`;
- `askedScopes(): string[]`;
- `hasAllScopes(scope: string, asked = askedScopes()): boolean`;
- `hasCalendarScope(scopes: string): boolean`.

### `src/server/gmail/google-api.ts`

- `consentUrl` uses `askedScopes()`;
- exports `call`, `readJson` and `settings` for `calendar-api.ts`.

### `src/server/gmail/connections.ts`

- `gmailSettings(userId)` → adds `calendar`;
- `settingsWarning(userId)`;
- `finishConnect`: the calendar columns and outcome of data-model.md § State changes. It returns `{ outcome,
  connectionId }`, or keeps its return type and lets the callback look the id up. After commit it calls
  `renewCalendarChannel(id)` best effort;
- `forgetGmailInTx(db, userId): Promise<Forgotten | null>`, with `Forgotten = { token: string | null; channel: { id:
  string; resourceId: string } | null }`;
- `afterGmailForgotten(f: Forgotten | null)`: `channels.stop` (best effort), then the SF-118 Gmail stop and revoke;
- `markNeedsReconnect` also clears `calendar_lease_until` and `calendar_sync_again`.

### `src/server/calendar/rules.ts` (pure, no database, no network)

- `type SyncValues = { subject: string; dueOn: string; dueTime: string | null; durationMinutes: number | null }`;
- `type ActivityForEvent = SyncValues & { id: number; type: ActivityType; note: string | null; done: boolean }`;
- `eventBody(a: ActivityForEvent, appUrl: string): EventBody` (origin `crm`);
- `googleEventBody(a: SyncValues & { done: boolean }): EventBody` (origin `google`: summary, start, end only);
- `bodyHash(body): string` (sha256 hex of the key-sorted JSON);
- `eventTimes(v: SyncValues): { start; end }`;
- `fromEvent(e: GoogleEvent): Pick<SyncValues, "dueOn" | "dueTime" | "durationMinutes"> | null` (null when start is
  unreadable);
- `subjectFromTitle(summary: string | undefined, origin: "crm" | "google", type: ActivityType): string | null`;
- `merge(base, crm, google, crmChangedAt: Date, googleUpdatedAt: Date): { values: SyncValues; fromGoogle: boolean;
  dirty: boolean }`. Groups are "when" and "subject"; a null CRM duration with a time equals 30 (research.md §5);
- `decideIncoming(e: GoogleEvent, ctx: { since: Date; now: Date }): { guests: string[] } | null` (the eligible guests'
  addresses in order);
- `selfDeclined(e): boolean`, `isCancelled(e): boolean`;
- `classifyCalendarError(status: number, body: unknown, op: "list" | "insert" | "write"): "key_refused" |
  "no_calendar_access" | "unavailable" | "sync_token_gone" | "event_gone" | "exists" | "event_refused"`;
- `newEventId(): string` (`"crm"` + 32 base32hex characters);
- `REMINDER_MINUTES_TIMED = 15`, `REMINDER_MINUTES_ALL_DAY = 0`, `DEFAULT_EVENT_MINUTES = 30`.

### `src/server/activities/rules.ts`

- `ukWallClock(instant: Date): { day: string; time: string }`, exporting the existing `parts()`.

### `src/server/calendar/calendar-api.ts`

contracts/google.md § Calls. Errors: `GoogleKeyRefused`, `GoogleUnavailable`, and `CalendarRefused(kind)` with
`kind` from `classifyCalendarError` (never Google's text).

### `src/server/calendar/sync.ts`

- `syncCalendar(connectionId: number, now = new Date()): Promise<CalendarSyncResult>`, where `CalendarSyncResult = {
  pulled: number; created: number; changed: number; removed: number; imported: number } | { skipped: "busy" | "off" |
  "not_working" | "no_calendar" | "needs_reconnect" | "unavailable" }`;
- `renewCalendarChannel(connectionId, now = new Date()): Promise<"renewed" | "needs_reconnect" | "unavailable" |
  "off">`;
- `calendarAfterChange(activityIds: number[]): Promise<void>` (never throws);
- `runCalendarCheck(connectionId, now)`: used by `runGmailCheck` per connection (sync, then renewal when due).

### `src/server/calendar/push.ts`

- `receiveCalendarPush(headers: Headers, now = new Date()): Promise<{ status: 204 | 403 }>`.

### `src/server/calendar/soon.ts`

- `runAfterResponse(task: () => Promise<unknown>): void`. It calls `after(task)` from `next/server`; when that throws
  (outside a request scope) it runs `void task().catch(() => {})`. Tests await the domain functions directly.

### `src/server/calendar/fake-calendar.ts`

The tester API of research.md §17, used by `/dev/fake-calendar`, the seeder and the tests.

## Messages (`src/server/messages.ts`)

`messages`:
- `gmail_missing_scopes`: "Google needs all the permissions asked for. Try again and tick every box." (changed)
- `calendar_syncing`: "Syncing your activities with your Google Calendar"
- `calendar_missing`: "Not synced: Calendar access missing"
- `calendar_reconnect`: "Reconnect Google to sync your activities with your calendar."
- `calendar_settings_warn`: "Reconnect Google to sync your calendar"
- `calendar_untitled`: "(No title)"
- `calendar_done_mark`: "✓ "

`templates`:
- `calendar_line(state: string)` → `Calendar: ${state}`
- `calendar_title(typeLabel: string, subject: string)` → `${typeLabel} · ${subject}`
- `calendar_description(note: string | null, url: string)` → `${note ? `${note}\n\n` : ""}Open in Barnacle CRM: ${url}`

Fake page labels stay in the fake page (development only, as SF-118's fake mailbox page does).
