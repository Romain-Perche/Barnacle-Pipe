// covers SF-124 research.md §4-§6, §9, §10, §13: the pure Calendar rules.
// - FR-005, FR-006, SC-004, SC-005, US2 scenarios 1-3 and 5: the event the CRM writes (eventBody, googleEventBody);
// - FR-008, FR-011, US3 scenarios 2-3, edge cases "Times Google allows but the CRM does not", "Title limits",
//   "Activity on the clock change": what comes back from Google (fromEvent, subjectFromTitle, merge);
// - FR-009, US4 scenarios 2, 6, 7, edge cases "Recurring events", "Event declined": which events come in (decideIncoming);
// - Google's errors (classifyCalendarError) and the CRM-chosen event ids (newEventId).
import { describe, expect, it } from "vitest";
import {
  bodyHash,
  classifyCalendarError,
  decideIncoming,
  DEFAULT_EVENT_MINUTES,
  eventBody,
  fromEvent,
  googleEventBody,
  isCancelled,
  merge,
  newEventId,
  REMINDER_MINUTES_TIMED,
  selfDeclined,
  subjectFromTitle,
  type ActivityForEvent,
  type GoogleEvent,
} from "@/server/calendar/rules";

const APP = "https://crm.example.test";
const call: ActivityForEvent = {
  id: 7,
  type: "call",
  subject: "Call Ada about the proposal",
  dueOn: "2026-12-02",
  dueTime: "10:00",
  durationMinutes: 30,
  note: "Bring the price list",
  done: false,
};

describe("newEventId", () => {
  it("is crm + 32 base32hex characters, different each time", () => {
    const a = newEventId();
    expect(a).toMatch(/^crm[0-9a-v]{32}$/);
    expect(newEventId()).not.toBe(a);
  });
});

describe("classifyCalendarError (research.md §13)", () => {
  const reason = (r: string) => ({ error: { code: 403, errors: [{ reason: r, domain: "global" }], message: "x" } });
  it("reads Google's statuses and reasons", () => {
    expect(classifyCalendarError(401, {}, "write")).toBe("key_refused");
    expect(classifyCalendarError(403, reason("insufficientPermissions"), "list")).toBe("no_calendar_access");
    expect(
      classifyCalendarError(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }, "write"),
    ).toBe("no_calendar_access");
    for (const r of ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]) expect(classifyCalendarError(403, reason(r), "write")).toBe("unavailable");
    expect(classifyCalendarError(403, reason("forbiddenForNonOrganizer"), "write")).toBe("event_refused");
    expect(classifyCalendarError(410, {}, "list")).toBe("sync_token_gone");
    expect(classifyCalendarError(404, {}, "write")).toBe("event_gone");
    expect(classifyCalendarError(410, {}, "write")).toBe("event_gone");
    expect(classifyCalendarError(409, {}, "insert")).toBe("exists");
    expect(classifyCalendarError(400, {}, "insert")).toBe("event_refused");
    expect(classifyCalendarError(429, {}, "write")).toBe("unavailable");
    expect(classifyCalendarError(503, {}, "list")).toBe("unavailable");
    expect(classifyCalendarError(400, {}, "list")).toBe("unavailable");
  });
});

describe("eventBody (research.md §4-§5, FR-005)", () => {
  it("US2 scenario 1: a call at 10:00 for 30 minutes, with its note and link, reminders 15 minutes before, private, no guests", () => {
    const b = eventBody(call, APP);
    expect(b).toEqual({
      summary: "Call · Call Ada about the proposal",
      description: `Bring the price list\n\nOpen in Barnacle CRM: ${APP}/activities?activity=7`,
      start: { dateTime: "2026-12-02T10:00:00.000Z", timeZone: "Europe/London" },
      end: { dateTime: "2026-12-02T10:30:00.000Z", timeZone: "Europe/London" },
      reminders: { useDefault: false, overrides: [{ method: "email", minutes: 15 }, { method: "popup", minutes: 15 }] },
      visibility: "private",
      transparency: "opaque",
      guestsCanInviteOthers: false,
      extendedProperties: { private: { barnacleCrmActivity: "7" } },
    });
    expect("attendees" in b).toBe(false);
    expect(REMINDER_MINUTES_TIMED).toBe(15);
  });
  it("US2 scenario 2: a time but no duration lasts 30 minutes", () => {
    expect(DEFAULT_EVENT_MINUTES).toBe(30);
    expect(eventBody({ ...call, durationMinutes: null }, APP).end).toEqual({ dateTime: "2026-12-02T10:30:00.000Z", timeZone: "Europe/London" });
  });
  it("US2 scenario 3: a task with no time is an all-day event, free, with no reminder at all; no note → only the link", () => {
    const b = eventBody({ ...call, type: "task", subject: "Send contract", dueOn: "2026-12-03", dueTime: null, durationMinutes: null, note: null }, APP);
    expect(b.summary).toBe("Task · Send contract");
    expect(b.start).toEqual({ date: "2026-12-03" });
    expect(b.end).toEqual({ date: "2026-12-04" });
    expect(b.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(b.transparency).toBe("transparent");
    expect(b.description).toBe(`Open in Barnacle CRM: ${APP}/activities?activity=7`);
    expect(eventBody({ ...call, dueOn: "2026-12-31", dueTime: null, durationMinutes: null }, APP).end).toEqual({ date: "2027-01-01" });
  });
  it("US2 scenario 5: done → \"✓ \" first and no reminders", () => {
    const b = eventBody({ ...call, done: true }, APP);
    expect(b.summary).toBe("✓ Call · Call Ada about the proposal");
    expect(b.reminders).toEqual({ useDefault: false, overrides: [] });
  });
  it("SC-005: UK time either side of the clock change", () => {
    const spring = eventBody({ ...call, dueOn: "2026-03-29", dueTime: "00:30", durationMinutes: 120 }, APP);
    expect(spring.start.dateTime).toBe("2026-03-29T00:30:00.000Z");
    expect(spring.end.dateTime).toBe("2026-03-29T02:30:00.000Z"); // 03:30 BST
    expect(eventBody({ ...call, dueOn: "2026-10-25", dueTime: "01:30" }, APP).start.dateTime).toBe("2026-10-25T00:30:00.000Z");
    expect(eventBody({ ...call, dueOn: "2026-07-01", dueTime: "23:45", durationMinutes: 30 }, APP).end.dateTime).toBe("2026-07-01T23:15:00.000Z");
  });
  it("googleEventBody: a meeting from Google gets only its title and times, never \"Meeting · \" or \"✓ \"", () => {
    const b = googleEventBody({ subject: "Intro with Ana", dueOn: "2026-12-08", dueTime: "15:00", durationMinutes: 45, done: true });
    expect(b).toEqual({
      summary: "Intro with Ana",
      start: { dateTime: "2026-12-08T15:00:00.000Z", timeZone: "Europe/London" },
      end: { dateTime: "2026-12-08T15:45:00.000Z", timeZone: "Europe/London" },
    });
  });
  it("bodyHash is a sha256 hex, the same whatever the key order", () => {
    const h = bodyHash({ a: 1, b: { c: [1, { d: 2, e: 3 }] } });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(bodyHash({ b: { c: [1, { e: 3, d: 2 }] }, a: 1 })).toBe(h);
    expect(bodyHash({ a: 2, b: { c: [1, { d: 2, e: 3 }] } })).not.toBe(h);
  });
});

describe("fromEvent (research.md §5)", () => {
  const timed = (start: string, end: string): GoogleEvent => ({ start: { dateTime: start }, end: { dateTime: end } });
  it("reads any offset as UK time: 10:00 New York on 4 Dec is 15:00", () => {
    expect(fromEvent(timed("2026-12-04T10:00:00-05:00", "2026-12-04T11:00:00-05:00"))).toEqual({ dueOn: "2026-12-04", dueTime: "15:00", durationMinutes: 60 });
  });
  it("keeps odd minutes on the start, rounds the duration down to 5 minutes within 5…1440", () => {
    expect(fromEvent(timed("2026-12-04T10:07:00Z", "2026-12-04T10:52:00Z"))).toEqual({ dueOn: "2026-12-04", dueTime: "10:07", durationMinutes: 45 });
    expect(fromEvent(timed("2026-12-04T10:00:00Z", "2026-12-04T10:07:00Z"))?.durationMinutes).toBe(5);
    expect(fromEvent(timed("2026-12-04T10:00:00Z", "2026-12-04T10:02:00Z"))?.durationMinutes).toBe(5);
    expect(fromEvent(timed("2026-12-04T10:00:00Z", "2026-12-05T16:00:00Z"))?.durationMinutes).toBe(1440);
  });
  it("an all-day event over several days is due its first day, with no time", () => {
    expect(fromEvent({ start: { date: "2026-12-04" }, end: { date: "2026-12-07" } })).toEqual({ dueOn: "2026-12-04", dueTime: null, durationMinutes: null });
  });
  it("timed 14:00–14:45 UK in winter and in summer", () => {
    expect(fromEvent(timed("2026-12-05T14:00:00Z", "2026-12-05T14:45:00Z"))).toEqual({ dueOn: "2026-12-05", dueTime: "14:00", durationMinutes: 45 });
    expect(fromEvent(timed("2026-03-29T01:30:00Z", "2026-03-29T02:00:00Z"))).toEqual({ dueOn: "2026-03-29", dueTime: "02:30", durationMinutes: 30 });
  });
  it("an unreadable start gives null", () => {
    expect(fromEvent({})).toBeNull();
    expect(fromEvent({ start: { dateTime: "not a date" }, end: { dateTime: "2026-12-05T14:45:00Z" } })).toBeNull();
    expect(fromEvent({ start: { date: "2026-02-30" } })).toBeNull();
  });
});

describe("subjectFromTitle (research.md §6)", () => {
  it("drops the activity's own type label and the done mark", () => {
    expect(subjectFromTitle("Call · Call Ada about the new price", "crm", "call")).toBe("Call Ada about the new price");
    expect(subjectFromTitle("✓ Call · X", "crm", "call")).toBe("X");
    expect(subjectFromTitle("  Task · Send it  ", "crm", "task")).toBe("Send it");
  });
  it("a title starting with another type's label is the whole subject", () => {
    expect(subjectFromTitle("Meeting · X", "crm", "call")).toBe("Meeting · X");
    expect(subjectFromTitle("New price", "crm", "call")).toBe("New price");
  });
  it("a meeting from Google drops a leading \"Meeting · \"", () => {
    expect(subjectFromTitle("Meeting · Intro", "google", "meeting")).toBe("Intro");
    expect(subjectFromTitle("Intro with Ana", "google", "meeting")).toBe("Intro with Ana");
  });
  it("edge case \"Title limits\": empty → no change, 250 characters → the first 200", () => {
    expect(subjectFromTitle("", "crm", "call")).toBeNull();
    expect(subjectFromTitle("   ", "crm", "call")).toBeNull();
    expect(subjectFromTitle(undefined, "crm", "call")).toBeNull();
    expect(subjectFromTitle("Call · ", "crm", "call")).toBeNull();
    const long = "é".repeat(250);
    expect(subjectFromTitle(long, "crm", "call")).toBe("é".repeat(200));
    expect(subjectFromTitle(`${"a".repeat(199)} b`, "crm", "call")).toBe("a".repeat(199));
  });
});

describe("merge (research.md §9, FR-011)", () => {
  const base = { subject: "Call Ada", dueOn: "2026-12-02", dueTime: "10:00", durationMinutes: 30 };
  const early = new Date("2026-11-25T10:00:00Z");
  const late = new Date("2026-11-25T10:05:00Z");
  it("Google only → Google's values", () => {
    const g = { ...base, dueTime: "14:00" };
    expect(merge(base, base, g, early, late)).toEqual({ values: g, fromGoogle: true, dirty: false });
  });
  it("CRM only → the CRM's values, to be sent again", () => {
    const c = { ...base, subject: "Call Ada again" };
    expect(merge(base, c, base, early, late)).toEqual({ values: c, fromGoogle: false, dirty: true });
  });
  it("both changed: the later wins, a tie goes to Google", () => {
    const c = { ...base, dueTime: "11:00" };
    const g = { ...base, dueTime: "14:00" };
    expect(merge(base, c, g, early, late)).toEqual({ values: g, fromGoogle: true, dirty: false });
    expect(merge(base, c, g, late, early)).toEqual({ values: c, fromGoogle: false, dirty: true });
    expect(merge(base, c, g, late, late)).toEqual({ values: g, fromGoogle: true, dirty: false });
  });
  it("groups are separate: Google's time and the CRM's subject both stay", () => {
    const c = { ...base, subject: "New subject" };
    const g = { ...base, dueOn: "2026-12-04" };
    expect(merge(base, c, g, early, late)).toEqual({ values: { ...base, subject: "New subject", dueOn: "2026-12-04" }, fromGoogle: true, dirty: true });
  });
  it("a null duration with a time equals 30; an empty Google title (null) is no change", () => {
    const c = { ...base, durationMinutes: null };
    expect(merge(c, c, { ...base, durationMinutes: 30 }, early, late)).toEqual({ values: c, fromGoogle: false, dirty: false });
    expect(merge(base, base, { ...base, subject: null }, early, late)).toEqual({ values: base, fromGoogle: false, dirty: false });
  });
  it("the same change on both sides is no change", () => {
    const v = { ...base, dueTime: "14:00" };
    expect(merge(base, v, v, early, late)).toEqual({ values: v, fromGoogle: false, dirty: false });
  });
});

describe("isCancelled, selfDeclined", () => {
  it("reads the event's status and the user's own answer", () => {
    expect(isCancelled({ status: "cancelled" })).toBe(true);
    expect(isCancelled({ status: "confirmed" })).toBe(false);
    expect(selfDeclined({ attendees: [{ email: "ada@barnacle.ai", self: true, responseStatus: "declined" }] })).toBe(true);
    expect(selfDeclined({ attendees: [{ email: "ada@barnacle.ai", self: true, responseStatus: "accepted" }, { email: "x@example.test", responseStatus: "declined" }] })).toBe(false);
    expect(selfDeclined({})).toBe(false);
  });
});

describe("decideIncoming (research.md §10, FR-009)", () => {
  const since = new Date("2026-11-25T09:00:00Z");
  const now = new Date("2026-11-25T10:00:00Z");
  const ok: GoogleEvent = {
    id: "ev1",
    status: "confirmed",
    summary: "Intro with Ana",
    updated: "2026-11-25T09:30:00.000Z",
    start: { dateTime: "2026-12-08T15:00:00Z" },
    end: { dateTime: "2026-12-08T15:45:00Z" },
    attendees: [
      { email: "ada@barnacle.ai", self: true, responseStatus: "accepted" },
      { email: "room-1@resource.calendar.google.com", resource: true },
      { email: " ANA.K@example.test " },
      { email: "Bob@Example.test" },
    ],
  };
  it("gives the guests' addresses (not self, not rooms), trimmed and lower-cased, in order", () => {
    expect(decideIncoming(ok, { since, now })).toEqual({ guests: ["ana.k@example.test", "bob@example.test"] });
    expect(decideIncoming({ ...ok, eventType: "default" }, { since, now })).not.toBeNull();
  });
  it.each<[string, GoogleEvent]>([
    ["cancelled", { ...ok, status: "cancelled" }],
    ["out of office", { ...ok, eventType: "outOfOffice" }],
    ["focus time", { ...ok, eventType: "focusTime" }],
    ["working location", { ...ok, eventType: "workingLocation" }],
    ["birthday", { ...ok, eventType: "birthday" }],
    ["from Gmail", { ...ok, eventType: "fromGmail" }],
    ["recurring", { ...ok, recurrence: ["RRULE:FREQ=WEEKLY"] }],
    ["an instance of a recurring event", { ...ok, recurringEventId: "base" }],
    ["the CRM's own event", { ...ok, extendedProperties: { private: { barnacleCrmActivity: "7" } } }],
    ["updated before the connection", { ...ok, updated: "2026-11-25T08:59:59.000Z" }],
    ["already over", { ...ok, start: { dateTime: "2026-11-25T08:00:00Z" }, end: { dateTime: "2026-11-25T09:00:00Z" } }],
    ["an all-day event that is over", { ...ok, start: { date: "2026-11-24" }, end: { date: "2026-11-25" } }],
    ["declined by the user", { ...ok, attendees: [{ email: "ada@barnacle.ai", self: true, responseStatus: "declined" }, { email: "ana@example.test" }] }],
    ["only self and rooms", { ...ok, attendees: [{ email: "ada@barnacle.ai", self: true }, { email: "r@resource.calendar.google.com", resource: true }] }],
    ["no guests", { ...ok, attendees: undefined }],
    ["no updated time", { ...ok, updated: undefined }],
  ])("does not consider an event: %s", (_name, e) => {
    expect(decideIncoming(e, { since, now })).toBeNull();
  });
  it("an all-day event today still counts (it ends tomorrow)", () => {
    expect(decideIncoming({ ...ok, start: { date: "2026-11-25" }, end: { date: "2026-11-26" } }, { since, now })).not.toBeNull();
  });
});
