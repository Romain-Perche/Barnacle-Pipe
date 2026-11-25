// The fake Google Calendar (SF-124 research.md §17, contracts/google.md § Fake): the Calendar calls the app makes,
// answered at their real URLs by FakeGoogleMail.fetch (src/server/gmail/fake-gmail.ts), over fake primary calendars kept
// in the same FakeState (memory in tests, `.fake-gmail/state.json` in development) and the same fake access tokens.
// Like Google:
// - the access token needs calendar.events.owned (or calendar.events / calendar), else 403 insufficientPermissions;
// - event ids are base32hex, 5–1024 characters (400 otherwise); an existing id answers 409; an unknown one 404;
// - every write sets `updated` (the fake's clock) and the calendar's change counter; a delete makes the event cancelled,
//   and a patch or delete of a cancelled event answers 410;
// - a patch of the title or times by someone who did not organise the event answers 403 forbiddenForNonOrganizer;
// - a sync token is "fake-sync-<counter>"; one below the calendar's floor (expireCalendarTokens) answers 410; cancelled
//   events are listed only with a sync token or showDeleted=true;
// - events.watch records a channel (at most 7 days) and channels.stop removes it; notices only while it is active.
// The functions here change a FakeState given to them; FakeGoogleMail saves it.
import { randomBytes, randomUUID } from "node:crypto";
import type { EventAttendee, EventDateTime } from "@/server/calendar/rules";
import type { FakeState } from "@/server/gmail/fake-gmail";

export const CALENDAR_ROOT = "https://www.googleapis.com/calendar/v3/";
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar",
];
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const ID = /^[a-v0-9]{5,1024}$/;

export type FakeEvent = {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: EventAttendee[];
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] };
  visibility?: string;
  transparency?: string;
  guestsCanInviteOthers?: boolean;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  recurrence?: string[];
  eventType?: string;
  organizer: string;
  created: string;
  updated: string;
  changedAt: number;
  sequence: number;
};
export type FakeCalendar = { seq: number; syncFloor: number; events: FakeEvent[] };
export type FakeChannel = { id: string; token: string; address: string; resourceId: string; email: string; expiration: number; messages: number };
export type CalendarState = { calendars: Record<string, FakeCalendar>; channels: FakeChannel[]; unreachable: boolean };

// What a tester (the fake page, the seeder, tests) puts in a calendar. Times: ISO instants, or days ("2026-12-04") with
// allDay (end exclusive, as Google).
export type NewFakeEvent = {
  summary?: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
  attendees?: string[];
  recurrence?: string[];
  organizer?: string;
  eventType?: string;
};
export type FakeEventChange = Partial<Pick<NewFakeEvent, "summary" | "description" | "location" | "start" | "end" | "allDay" | "attendees">>;

export function ensureCalendarState(s: FakeState): void {
  s.calendars ??= {};
  s.channels ??= [];
  s.unreachable ??= false;
}

export function calendarOf(s: FakeState, email: string): FakeCalendar {
  ensureCalendarState(s);
  const key = email.trim().toLowerCase();
  s.calendars[key] ??= { seq: 1, syncFloor: 0, events: [] };
  return s.calendars[key];
}

const iso = (ms: number) => new Date(ms).toISOString();

function touch(cal: FakeCalendar, e: FakeEvent, now: number) {
  cal.seq += 1;
  e.changedAt = cal.seq;
  // Google's `updated` always moves forward, even within the same millisecond.
  e.updated = iso(Math.max(now, new Date(e.updated).getTime() + 1));
  e.sequence += 1;
}

function times(start: string, end: string, allDay?: boolean): { start: EventDateTime; end: EventDateTime } {
  if (allDay) return { start: { date: start.slice(0, 10) }, end: { date: end.slice(0, 10) } };
  return { start: { dateTime: new Date(start).toISOString(), timeZone: "Europe/London" }, end: { dateTime: new Date(end).toISOString(), timeZone: "Europe/London" } };
}

function guests(owner: string, organizer: string, list: string[] | undefined, before?: EventAttendee[]): EventAttendee[] | undefined {
  if (!list || list.length === 0) return undefined;
  const self = before?.find((a) => a.self);
  const me: EventAttendee = self ?? { email: owner, self: true, ...(organizer === owner ? { organizer: true } : {}), responseStatus: organizer === owner ? "accepted" : "needsAction" };
  return [me, ...list.map((email) => before?.find((a) => !a.self && a.email === email) ?? { email, responseStatus: "needsAction" })];
}

// A fake event id as Google makes them (base32hex).
const googleId = () => randomBytes(13).toString("hex").replace(/[w-z]/g, "a");

export function addFakeEvent(s: FakeState, now: number, email: string, input: NewFakeEvent): FakeEvent {
  const owner = email.trim().toLowerCase();
  const cal = calendarOf(s, owner);
  const organizer = (input.organizer ?? owner).trim().toLowerCase();
  const e: FakeEvent = {
    id: googleId(),
    status: "confirmed",
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...times(input.start, input.end, input.allDay),
    ...(guests(owner, organizer, input.attendees) ? { attendees: guests(owner, organizer, input.attendees) } : {}),
    ...(input.recurrence?.length ? { recurrence: input.recurrence } : {}),
    ...(input.eventType ? { eventType: input.eventType } : {}),
    reminders: { useDefault: true },
    organizer,
    created: iso(now),
    updated: iso(now - 1),
    changedAt: 0,
    sequence: -1,
  };
  cal.events.push(e);
  touch(cal, e, now);
  return e;
}

function find(s: FakeState, email: string, id: string): { cal: FakeCalendar; e: FakeEvent } {
  const cal = calendarOf(s, email);
  const e = cal.events.find((x) => x.id === id);
  if (!e) throw new Error(`No fake event ${id} in ${email}'s calendar`);
  return { cal, e };
}

export function changeFakeEvent(s: FakeState, now: number, email: string, id: string, change: FakeEventChange): void {
  const { cal, e } = find(s, email, id);
  if (change.summary !== undefined) e.summary = change.summary;
  if (change.description !== undefined) e.description = change.description;
  if (change.location !== undefined) e.location = change.location;
  if (change.start !== undefined || change.end !== undefined || change.allDay !== undefined) {
    const allDay = change.allDay ?? e.start.date !== undefined;
    const start = change.start ?? e.start.dateTime ?? e.start.date!;
    const end = change.end ?? e.end.dateTime ?? e.end.date!;
    Object.assign(e, times(start, end, allDay));
  }
  if (change.attendees !== undefined) {
    const list = guests(email.trim().toLowerCase(), e.organizer, change.attendees, e.attendees);
    if (list) e.attendees = list;
    else delete e.attendees;
  }
  touch(cal, e, now);
}

export function declineFakeEvent(s: FakeState, now: number, email: string, id: string): void {
  const { cal, e } = find(s, email, id);
  const owner = email.trim().toLowerCase();
  const self = e.attendees?.find((a) => a.self);
  if (self) self.responseStatus = "declined";
  else e.attendees = [{ email: owner, self: true, responseStatus: "declined" }, ...(e.attendees ?? [])];
  touch(cal, e, now);
}

export function deleteFakeEvent(s: FakeState, now: number, email: string, id: string): void {
  const { cal, e } = find(s, email, id);
  e.status = "cancelled";
  touch(cal, e, now);
}

// Sync tokens given before now answer 410 (Google's "full sync required").
export function expireTokens(s: FakeState, email?: string): void {
  ensureCalendarState(s);
  for (const [who, cal] of Object.entries(s.calendars)) {
    if (email && who !== email.trim().toLowerCase()) continue;
    cal.seq += 1;
    cal.syncFloor = cal.seq;
  }
}

export function activeChannel(s: FakeState, email: string, now: number): FakeChannel | null {
  ensureCalendarState(s);
  const who = email.trim().toLowerCase();
  const mine = s.channels.filter((c) => c.email === who && c.expiration > now);
  return mine.length ? mine[mine.length - 1] : null;
}

// The headers of Google's POST to the channel's address for a change in this calendar (no body), or null when the
// calendar has no active channel. `state`: "sync" for a new channel's first message, else "exists".
export function noticeHeaders(s: FakeState, email: string, now: number, state: "sync" | "exists" = "exists"): Headers | null {
  const c = activeChannel(s, email, now);
  if (!c) return null;
  const n = c.messages;
  c.messages += 1;
  return new Headers({
    "X-Goog-Channel-ID": c.id,
    "X-Goog-Channel-Token": c.token,
    "X-Goog-Channel-Expiration": new Date(c.expiration).toUTCString(),
    "X-Goog-Resource-ID": c.resourceId,
    "X-Goog-Resource-URI": `${CALENDAR_ROOT}calendars/primary/events?alt=json`,
    "X-Goog-Resource-State": state,
    "X-Goog-Message-Number": String(n),
  });
}

// ---- the Calendar API ------------------------------------------------------------------------------------------------

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=UTF-8" } });
}
const calError = (code: number, reason: string, message: string, extra: Record<string, unknown> = {}) =>
  json(code, { error: { errors: [{ domain: extra.domain ?? "global", reason, message }], code, message } });

function view(owner: string, e: FakeEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {
    kind: "calendar#event",
    etag: `"${e.changedAt}${e.sequence}"`,
    id: e.id,
    status: e.status,
    htmlLink: `https://www.google.com/calendar/event?eid=${Buffer.from(`${e.id} ${owner}`).toString("base64url")}`,
    created: e.created,
    updated: e.updated,
    creator: { email: e.organizer, ...(e.organizer === owner ? { self: true } : {}) },
    organizer: { email: e.organizer, ...(e.organizer === owner ? { self: true } : {}) },
    start: e.start,
    end: e.end,
    iCalUID: `${e.id}@google.com`,
    sequence: Math.max(0, e.sequence),
    eventType: e.eventType ?? "default",
  };
  for (const k of ["summary", "description", "location", "attendees", "reminders", "visibility", "transparency", "guestsCanInviteOthers", "extendedProperties", "recurrence"] as const) {
    if (e[k] !== undefined) out[k] = e[k];
  }
  return out;
}

const WRITABLE = ["summary", "description", "location", "start", "end", "attendees", "reminders", "visibility", "transparency", "guestsCanInviteOthers", "extendedProperties", "recurrence"] as const;

function applyBody(e: FakeEvent, body: Record<string, unknown>) {
  for (const k of WRITABLE) if (body[k] !== undefined) (e as Record<string, unknown>)[k] = structuredClone(body[k]);
}

// One Calendar request (the URL starts with CALENDAR_ROOT). `scopes`/`email` are those of the access token (null: no
// valid token).
export function calendarApi(s: FakeState, now: number, req: { method: string; url: URL; body: unknown }, token: { email: string; scopes: string[] } | null): Response {
  ensureCalendarState(s);
  if (!token) return json(401, { error: { errors: [{ domain: "global", reason: "authError", message: "Invalid Credentials", locationType: "header", location: "Authorization" }], code: 401, message: "Invalid Credentials" } });
  if (!token.scopes.some((x) => CALENDAR_SCOPES.includes(x))) {
    return json(403, {
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        errors: [{ message: "Insufficient Permission", domain: "global", reason: "insufficientPermissions" }],
        status: "PERMISSION_DENIED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", domain: "googleapis.com" }],
      },
    });
  }
  const path = req.url.pathname.replace(/^\/calendar\/v3\//, "");
  const q = req.url.searchParams;
  const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const owner = token.email;
  if (req.method === "POST" && path === "channels/stop") {
    const i = s.channels.findIndex((c) => c.id === body.id && c.resourceId === body.resourceId);
    if (i < 0) return calError(404, "notFound", `Channel '${String(body.id)}' not found for project`);
    s.channels.splice(i, 1);
    return new Response(null, { status: 204 });
  }
  const m = /^calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
  if (!m) return calError(404, "notFound", "Not Found");
  if (decodeURIComponent(m[1]) !== "primary" && decodeURIComponent(m[1]) !== owner) return calError(404, "notFound", "Not Found");
  const cal = calendarOf(s, owner);
  const sub = m[2] === undefined ? null : decodeURIComponent(m[2]);

  if (req.method === "POST" && sub === "watch") {
    if (body.type !== "web_hook" || typeof body.address !== "string" || typeof body.id !== "string") return calError(400, "invalid", "Invalid channel");
    const ttl = Math.min(Number((body.params as { ttl?: string } | undefined)?.ttl ?? MAX_TTL_SECONDS) || MAX_TTL_SECONDS, MAX_TTL_SECONDS);
    if (s.channels.some((c) => c.id === body.id)) return calError(400, "channelIdNotUnique", "Channel id not unique");
    const c: FakeChannel = { id: body.id, token: typeof body.token === "string" ? body.token : "", address: body.address, resourceId: randomUUID().replace(/-/g, ""), email: owner, expiration: now + ttl * 1000, messages: 1 };
    s.channels.push(c);
    return json(200, { kind: "api#channel", id: c.id, resourceId: c.resourceId, resourceUri: `${CALENDAR_ROOT}calendars/primary/events?alt=json`, ...(c.token ? { token: c.token } : {}), expiration: String(c.expiration) });
  }

  if (req.method === "GET" && sub === null) {
    const max = Math.min(Number(q.get("maxResults") ?? 250) || 250, 2500);
    const syncToken = q.get("syncToken");
    let list: FakeEvent[];
    if (syncToken !== null) {
      const from = /^fake-sync-(\d+)$/.exec(syncToken);
      if (!from || Number(from[1]) < cal.syncFloor) return calError(410, "fullSyncRequired", "Sync token is no longer valid, a full sync is required.");
      list = cal.events.filter((e) => e.changedAt > Number(from[1]));
    } else {
      list = cal.events.filter((e) => e.status !== "cancelled" || q.get("showDeleted") === "true");
    }
    list = [...list].sort((a, b) => a.changedAt - b.changedAt);
    const offset = Number(q.get("pageToken") ?? 0) || 0;
    const page = list.slice(offset, offset + max);
    const more = offset + max < list.length;
    return json(200, {
      kind: "calendar#events",
      etag: `"${cal.seq}"`,
      summary: owner,
      updated: iso(now),
      timeZone: "Europe/London",
      accessRole: "owner",
      defaultReminders: [{ method: "popup", minutes: 10 }],
      items: page.map((e) => view(owner, e)),
      ...(more ? { nextPageToken: String(offset + max) } : { nextSyncToken: `fake-sync-${cal.seq}` }),
    });
  }

  if (req.method === "POST" && sub === null) {
    const id = typeof body.id === "string" ? body.id : googleId();
    if (!ID.test(id)) return calError(400, "invalid", "Invalid resource id value.");
    if (cal.events.some((e) => e.id === id)) return calError(409, "duplicate", "The requested identifier already exists.");
    const start = body.start as EventDateTime | undefined;
    const end = body.end as EventDateTime | undefined;
    if (!start || !end || (!start.date && !start.dateTime) || (!end.date && !end.dateTime)) return calError(400, "required", "Missing end time.");
    const e: FakeEvent = { id, status: "confirmed", start, end, organizer: owner, created: iso(now), updated: iso(now - 1), changedAt: 0, sequence: -1 };
    applyBody(e, body);
    cal.events.push(e);
    touch(cal, e, now);
    return json(200, view(owner, e));
  }

  if (sub === null || sub === "watch") return calError(404, "notFound", "Not Found");
  const e = cal.events.find((x) => x.id === sub);
  if (!e) return calError(404, "notFound", "Not Found");
  if (req.method === "GET") return json(200, view(owner, e));
  if (e.status === "cancelled" && (req.method === "PATCH" || req.method === "DELETE")) return calError(410, "deleted", "Resource has been deleted");
  if (req.method === "PATCH") {
    if (e.organizer !== owner && ["summary", "start", "end"].some((k) => body[k] !== undefined)) {
      return calError(403, "forbiddenForNonOrganizer", "Shared properties can only be changed by the organizer of the event.");
    }
    applyBody(e, body);
    touch(cal, e, now);
    return json(200, view(owner, e));
  }
  if (req.method === "DELETE") {
    e.status = "cancelled";
    touch(cal, e, now);
    return new Response(null, { status: 204 });
  }
  return calError(404, "notFound", "Not Found");
}
