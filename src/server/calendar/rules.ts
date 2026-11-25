// Google Calendar rules (SF-124 research.md §4-§6, §9, §10, §13). Pure: no database, no network.
// - the event the CRM writes for an activity (eventBody), or only the title and times of a meeting that came in from
//   Google (googleEventBody), and its hash;
// - UK times both ways: an activity's due day, time and duration ↔ an event's start and end (eventTimes, fromEvent);
// - an event title back into a subject (subjectFromTitle) and the three-way merge where the later change wins (merge);
// - which new events come in as meetings (decideIncoming);
// - what Google's errors mean for Calendar (classifyCalendarError);
// - the event ids the CRM chooses before inserting (newEventId), so a retry never makes a second event.
import { createHash, randomBytes } from "node:crypto";
import { TYPE_LABELS, ukInstant, ukWallClock, type ActivityType } from "@/server/activities/rules";
import { messages, templates } from "@/server/messages";

export const REMINDER_MINUTES_TIMED = 15;
export const DEFAULT_EVENT_MINUTES = 30;
const SUBJECT_MAX = 200;
export const CRM_MARKER = "barnacleCrmActivity";
const TIME_ZONE = "Europe/London";

export type SyncValues = { subject: string; dueOn: string; dueTime: string | null; durationMinutes: number | null };
export type When = Omit<SyncValues, "subject">;
export type ActivityForEvent = SyncValues & { id: number; type: ActivityType; note: string | null; done: boolean };

export type EventDateTime = { date?: string; dateTime?: string; timeZone?: string };
export type EventAttendee = { email?: string; self?: boolean; resource?: boolean; responseStatus?: string; organizer?: boolean };
export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: EventDateTime;
  end?: EventDateTime;
  updated?: string;
  recurrence?: string[];
  recurringEventId?: string;
  eventType?: string;
  attendees?: EventAttendee[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
};
export type EventBody = {
  summary: string;
  start: EventDateTime;
  end: EventDateTime;
  description?: string;
  reminders?: { useDefault: boolean; overrides: { method: "email" | "popup"; minutes: number }[] };
  visibility?: "private";
  transparency?: "opaque" | "transparent";
  guestsCanInviteOthers?: false;
  extendedProperties?: { private: Record<string, string> };
};

// "crm" + 32 base32hex characters (a–v, 0–9) of 20 random bytes: a valid Google event id, chosen before the insert.
export function newEventId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "crm";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function isDay(value: string | undefined): value is string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// The event's start and end: UK instants for an activity with a time (30 minutes when it has no duration; real time, so
// 00:30 + 2 h on 29 Mar 2026 ends at 03:30 BST), or an all-day event on its day (exclusive end).
export function eventTimes(v: When): { start: EventDateTime; end: EventDateTime } {
  if (v.dueTime === null) return { start: { date: v.dueOn }, end: { date: addDays(v.dueOn, 1) } };
  const start = ukInstant(v.dueOn, v.dueTime);
  const end = new Date(start.getTime() + (v.durationMinutes ?? DEFAULT_EVENT_MINUTES) * 60_000);
  return { start: { dateTime: start.toISOString(), timeZone: TIME_ZONE }, end: { dateTime: end.toISOString(), timeZone: TIME_ZONE } };
}

// The whole event of an activity the CRM made (research.md §4): private, no guests, Google's reminders 15 minutes before
// an activity with a time and none at all for one with no time or done (never the calendar's default ones either).
export function eventBody(a: ActivityForEvent, appUrl: string): EventBody {
  const timed = a.dueTime !== null;
  const title = templates.calendar_title(TYPE_LABELS[a.type], a.subject);
  return {
    summary: a.done ? `${messages.calendar_done_mark}${title}` : title,
    description: templates.calendar_description(a.note, `${appUrl}/activities?activity=${a.id}`),
    ...eventTimes(a),
    reminders: {
      useDefault: false,
      overrides:
        timed && !a.done
          ? [
              { method: "email", minutes: REMINDER_MINUTES_TIMED },
              { method: "popup", minutes: REMINDER_MINUTES_TIMED },
            ]
          : [],
    },
    visibility: "private",
    transparency: timed ? "opaque" : "transparent",
    guestsCanInviteOthers: false,
    extendedProperties: { private: { [CRM_MARKER]: String(a.id) } },
  };
}

// A meeting that came in from Google: only its title (the subject as it is) and its times are ever sent.
export function googleEventBody(a: SyncValues & { done: boolean }): EventBody {
  return { summary: a.subject, ...eventTimes(a) };
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function bodyHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(sorted(body))).digest("hex");
}

// An event's start and end in CRM terms (research.md §5): all-day → its first day, no time; timed → the UK day and time
// of its start, the duration in whole minutes rounded down to 5, within 5…1440. Null when the start can't be read.
export function fromEvent(e: GoogleEvent): When | null {
  if (e.start?.date !== undefined) return isDay(e.start.date) ? { dueOn: e.start.date, dueTime: null, durationMinutes: null } : null;
  const start = new Date(e.start?.dateTime ?? "");
  if (!e.start?.dateTime || Number.isNaN(start.getTime())) return null;
  const end = new Date(e.end?.dateTime ?? "");
  const minutes = Number.isNaN(end.getTime()) ? DEFAULT_EVENT_MINUTES : Math.floor((end.getTime() - start.getTime()) / 60_000);
  const wall = ukWallClock(start);
  return { dueOn: wall.day, dueTime: wall.time, durationMinutes: Math.min(1440, Math.max(5, Math.floor(minutes / 5) * 5)) };
}

// An event's title as a subject (research.md §6); null when nothing is left (the subject is then left as it is).
export function subjectFromTitle(summary: string | undefined, origin: "crm" | "google", type: ActivityType): string | null {
  let t = (summary ?? "").trim();
  if (t.startsWith(messages.calendar_done_mark)) t = t.slice(messages.calendar_done_mark.length);
  t = t.trim();
  const prefix = templates.calendar_title(origin === "crm" ? TYPE_LABELS[type] : TYPE_LABELS.meeting, "");
  if (t.startsWith(prefix)) t = t.slice(prefix.length);
  else if (t === prefix.trim()) t = "";
  t = [...t.trim()].slice(0, SUBJECT_MAX).join("").trim();
  return t === "" ? null : t;
}

const whenKey = (v: When) => JSON.stringify([v.dueOn, v.dueTime, v.dueTime === null ? null : (v.durationMinutes ?? DEFAULT_EVENT_MINUTES)]);

// The three-way merge (research.md §9): per group ("when", subject), a side that alone moved from the agreed base wins;
// when both moved to different values the later change wins, a tie going to Google. `dirty`: the CRM won a group that
// Google does not have, so it must be sent again. A null Google subject (empty title) is no change.
export function merge(
  base: SyncValues,
  crm: SyncValues,
  google: When & { subject: string | null },
  crmChangedAt: Date,
  googleUpdatedAt: Date,
): { values: SyncValues; fromGoogle: boolean; dirty: boolean } {
  let fromGoogle = false;
  let dirty = false;
  const pick = <T>(b: T, c: T, g: T, same: (x: T, y: T) => boolean): T => {
    const gMoved = !same(g, b);
    const cMoved = !same(c, b);
    if (!gMoved || same(g, c)) {
      if (cMoved && !same(g, c)) dirty = true;
      return c;
    }
    if (!cMoved || googleUpdatedAt.getTime() >= crmChangedAt.getTime()) {
      fromGoogle = true;
      return g;
    }
    dirty = true;
    return c;
  };
  const when = pick<When>(base, crm, google, (x, y) => whenKey(x) === whenKey(y));
  const subject = pick(base.subject, crm.subject, google.subject ?? base.subject, (x, y) => x === y);
  return { values: { subject, dueOn: when.dueOn, dueTime: when.dueTime, durationMinutes: when.durationMinutes }, fromGoogle, dirty };
}

export const isCancelled = (e: GoogleEvent) => e.status === "cancelled";
export const selfDeclined = (e: GoogleEvent) => (e.attendees ?? []).some((a) => a.self === true && a.responseStatus === "declined");

function endInstant(e: GoogleEvent): Date | null {
  if (e.end?.date !== undefined) return isDay(e.end.date) ? ukInstant(e.end.date, null) : null;
  if (e.start?.date !== undefined) return isDay(e.start.date) ? ukInstant(addDays(e.start.date, 1), null) : null;
  const end = new Date(e.end?.dateTime ?? e.start?.dateTime ?? "");
  return Number.isNaN(end.getTime()) ? null : end;
}

// Whether a new event may come in as a meeting (research.md §10): a single, plain, live event, changed since the
// calendar was connected and not over, not the CRM's own, not declined by the user, with guests other than the user and
// rooms. Gives those guests' addresses (trimmed, lower-cased) in the event's order; the caller looks them up.
export function decideIncoming(e: GoogleEvent, ctx: { since: Date; now: Date }): { guests: string[] } | null {
  if (isCancelled(e)) return null;
  if (e.eventType !== undefined && e.eventType !== "default") return null;
  if ((e.recurrence?.length ?? 0) > 0 || e.recurringEventId) return null;
  if (e.extendedProperties?.private?.[CRM_MARKER] !== undefined) return null;
  const updated = new Date(e.updated ?? "");
  if (Number.isNaN(updated.getTime()) || updated.getTime() < ctx.since.getTime()) return null;
  const end = endInstant(e);
  if (!end || end.getTime() <= ctx.now.getTime() || fromEvent(e) === null) return null;
  if (selfDeclined(e)) return null;
  const guests = (e.attendees ?? [])
    .filter((a) => a.self !== true && a.resource !== true)
    .map((a) => (a.email ?? "").trim().toLowerCase())
    .filter((x) => x !== "");
  return guests.length > 0 ? { guests } : null;
}

export type CalendarErrorKind = "key_refused" | "no_calendar_access" | "unavailable" | "sync_token_gone" | "event_gone" | "exists" | "event_refused";

const SLOW_DOWN = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]);

// What a Calendar error answer means (research.md §13). Only the status and the reason codes are read.
export function classifyCalendarError(status: number, body: unknown, op: "list" | "insert" | "write"): CalendarErrorKind {
  const err = (typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null) ?? {};
  const e = (typeof err === "object" ? err : {}) as { status?: unknown; errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] };
  const reasons = [...(Array.isArray(e.errors) ? e.errors : []), ...(Array.isArray(e.details) ? e.details : [])].map((x) => x?.reason);
  if (status === 401) return "key_refused";
  if (status === 403) {
    if (reasons.includes("insufficientPermissions") || reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) return "no_calendar_access";
    if (reasons.some((r) => typeof r === "string" && SLOW_DOWN.has(r))) return "unavailable";
  }
  if (status === 429 || status >= 500) return "unavailable";
  if (op === "list") return status === 410 ? "sync_token_gone" : "unavailable";
  if (status === 404 || status === 410) return "event_gone";
  if (status === 409 && op === "insert") return "exists";
  return status >= 400 && status < 500 ? "event_refused" : "unavailable";
}
