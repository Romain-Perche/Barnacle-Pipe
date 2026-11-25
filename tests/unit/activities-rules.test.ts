// covers SF-109 FR-001, FR-009, FR-010, FR-015, SC-006, US1 scenarios 4 and 7, US2 scenario 2, US3 scenario 2,
// US4 scenarios 1–2, spec Edge Cases (UK time, clocks changing, duration only with a time)
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activityState, afterTickPath, cardLine, dueMoment, durationOptions, existsInUk, formatCardDue, formatDue, REMINDER_LEAD_MINUTES, reminderAt,
  reminderFor, ukInstant, UNTIMED_REMINDER_TIME, validateActivity, weekBounds,
  type ActivityForm,
} from "@/server/activities/rules";
import { countLabel } from "@/server/format";

const form = (over: Partial<ActivityForm> = {}): ActivityForm => ({
  type: "call", subject: "Call Ada", dueOn: "2026-11-25", dueTime: "", duration: "", assigneeId: "", note: "",
  dealId: "", personId: "", organisationId: "", ...over,
});
const codes = (f: Partial<ActivityForm>) => {
  const r = validateActivity(form(f));
  return r.ok ? {} : Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [k, v.code]));
};
const value = (f: Partial<ActivityForm>) => {
  const r = validateActivity(form(f));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

describe("validateActivity", () => {
  it("trims the subject and refuses an empty or too long one", () => {
    expect(value({ subject: "  Call Ada  " }).subject).toBe("Call Ada");
    expect(codes({ subject: "" })).toEqual({ subject: "activity_subject_required" });
    expect(codes({ subject: "   " })).toEqual({ subject: "activity_subject_required" });
    expect(value({ subject: "x".repeat(200) }).subject).toHaveLength(200);
    expect(codes({ subject: "x".repeat(201) })).toEqual({ subject: "activity_subject_too_long" });
  });

  it("needs a due date", () => {
    expect(codes({ dueOn: "" })).toEqual({ dueOn: "activity_due_required" });
    expect(codes({ dueOn: "2026-02-30" })).toEqual({ dueOn: "activity_due_required" });
    expect(value({ dueOn: "2020-01-01" }).dueOn).toBe("2020-01-01");
  });

  it("refuses a time that does not exist in UK time (the clocks jump from 01:00 to 02:00 on 29 Mar 2026)", () => {
    expect(codes({ dueOn: "2026-03-29", dueTime: "01:00" })).toEqual({ dueTime: "activity_time_not_in_uk" });
    expect(codes({ dueOn: "2026-03-29", dueTime: "01:30" })).toEqual({ dueTime: "activity_time_not_in_uk" });
    expect(value({ dueOn: "2026-03-29", dueTime: "00:59" }).dueTime).toBe("00:59");
    expect(value({ dueOn: "2026-03-29", dueTime: "02:00" }).dueTime).toBe("02:00");
    expect(value({ dueOn: "2026-10-25", dueTime: "01:30" }).dueTime).toBe("01:30");
    expect(codes({ dueTime: "25:00" })).toEqual({ dueTime: "activity_time_not_in_uk" });
  });

  it("only takes a duration with a time, from 5 minutes to 24 hours in steps of 5", () => {
    expect(codes({ duration: "30" })).toEqual({ duration: "activity_duration_needs_time" });
    for (const d of ["4", "7", "1445", "x"]) expect(codes({ dueTime: "10:00", duration: d }), d).toEqual({ duration: "activity_duration_invalid" });
    expect(value({ dueTime: "10:00", duration: "5" }).durationMinutes).toBe(5);
    expect(value({ dueTime: "10:00", duration: "1440" }).durationMinutes).toBe(1440);
    expect(value({ dueTime: "10:00" }).durationMinutes).toBeNull();
  });

  it("counts a CRLF line break once in the note, stores LF, an empty note is null", () => {
    const note = `${"a".repeat(4999)}\r\n${"b".repeat(5000)}`;
    expect(value({ note }).note).toBe(`${"a".repeat(4999)}\n${"b".repeat(5000)}`);
    expect(codes({ note: "x".repeat(10_001) })).toEqual({ note: "activity_note_too_long" });
    expect(value({ note: "   " }).note).toBeNull();
    expect(value({ note: "" }).note).toBeNull();
  });

  it("refuses a type outside call, meeting and task", () => {
    expect(codes({ type: "email" })).toEqual({ type: "activity_type_invalid" });
    expect(value({ type: "meeting" }).type).toBe("meeting");
  });

  it("reads link and assignee ids as positive integers or null", () => {
    const v = value({ dealId: "7", personId: "", organisationId: "-1", assigneeId: "3" });
    expect([v.dealId, v.personId, v.organisationId, v.assigneeId]).toEqual([7, null, null, 3]);
  });

  it("gives the errors in field order", () => {
    const r = validateActivity(form({ type: "x", subject: "", dueOn: "", duration: "30", note: "x".repeat(10_001) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["type", "subject", "dueOn", "duration", "note"]);
  });

  // covers FR-015, T013: subject and note are kept as typed, never turned into markup
  it("keeps a subject with markup and a note with a line break as typed", () => {
    const v = value({ subject: "<b>x</b>", note: "line one\nline two" });
    expect(v.subject).toBe("<b>x</b>");
    expect(v.note).toBe("line one\nline two");
  });
});

describe("UK time", () => {
  it("gives the instant of a UK wall-clock time, in winter and summer, the first one in the autumn overlap", () => {
    expect(ukInstant("2026-11-25", "10:00").toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(ukInstant("2026-07-01", "10:00").toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(ukInstant("2026-10-25", "01:30").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(ukInstant("2026-07-01", null).toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(existsInUk("2026-03-29", "01:30")).toBe(false);
    expect(existsInUk("2026-03-29", "02:00")).toBe(true);
  });
});

describe("activityState", () => {
  const a = (dueOn: string, dueTime: string | null = null, durationMinutes: number | null = null, done = false) => ({ dueOn, dueTime, durationMinutes, done });
  it("untimed: today until midnight UK, overdue after", () => {
    expect(activityState(a("2026-11-22"), new Date("2026-11-23T12:00:00Z"))).toBe("overdue");
    expect(activityState(a("2026-11-23"), new Date("2026-11-23T23:59:00Z"))).toBe("today");
    expect(activityState(a("2026-11-23"), new Date("2026-11-24T00:00:00Z"))).toBe("overdue");
    expect(activityState(a("2026-11-24"), new Date("2026-11-23T23:59:00Z"))).toBe("later");
  });
  it("timed: overdue once the time (plus duration) has passed", () => {
    expect(activityState(a("2026-11-23", "00:30"), new Date("2026-11-23T00:29:00Z"))).toBe("today");
    expect(activityState(a("2026-11-23", "00:30"), new Date("2026-11-23T00:30:00Z"))).toBe("overdue");
    expect(activityState(a("2026-11-23", "10:00", 30), new Date("2026-11-23T10:29:00Z"))).toBe("today");
    expect(activityState(a("2026-11-23", "10:00", 30), new Date("2026-11-23T10:30:00Z"))).toBe("overdue");
  });
  it("in summer (BST) an untimed activity is today from 23:00 UTC the day before", () => {
    expect(activityState(a("2026-07-02"), new Date("2026-07-01T22:59:00Z"))).toBe("later");
    expect(activityState(a("2026-07-02"), new Date("2026-07-01T23:00:00Z"))).toBe("today");
    expect(activityState(a("2026-07-01", "10:00"), new Date("2026-07-01T09:00:00Z"))).toBe("overdue");
    expect(activityState(a("2026-07-01", "10:00"), new Date("2026-07-01T08:59:00Z"))).toBe("today");
  });
  it("on the days the clocks change", () => {
    // 29 Mar 2026: 01:00 GMT becomes 02:00 BST. 03:00 BST is 02:00 UTC.
    expect(activityState(a("2026-03-29", "03:00"), new Date("2026-03-29T01:59:00Z"))).toBe("today");
    expect(activityState(a("2026-03-29", "03:00"), new Date("2026-03-29T02:00:00Z"))).toBe("overdue");
    expect(activityState(a("2026-03-29"), new Date("2026-03-29T22:59:00Z"))).toBe("today");
    expect(activityState(a("2026-03-29"), new Date("2026-03-29T23:00:00Z"))).toBe("overdue");
    // 25 Oct 2026: 02:00 BST becomes 01:00 GMT. The first 01:30 is 00:30 UTC.
    expect(activityState(a("2026-10-25", "01:30"), new Date("2026-10-25T00:29:00Z"))).toBe("today");
    expect(activityState(a("2026-10-25", "01:30"), new Date("2026-10-25T00:30:00Z"))).toBe("overdue");
    expect(activityState(a("2026-10-25"), new Date("2026-10-25T23:59:00Z"))).toBe("today");
    expect(activityState(a("2026-10-25"), new Date("2026-10-24T23:00:00Z"))).toBe("today");
  });
  it("done is done", () => {
    expect(activityState(a("2026-11-01", null, null, true), new Date("2026-11-23T12:00:00Z"))).toBe("done");
  });
});

describe("formatting", () => {
  it("formats the due date, time and range", () => {
    expect(formatDue({ dueOn: "2026-11-25", dueTime: null, durationMinutes: null })).toBe("25 Nov 2026");
    expect(formatDue({ dueOn: "2026-11-25", dueTime: "10:00", durationMinutes: null })).toBe("25 Nov 2026 10:00");
    expect(formatDue({ dueOn: "2026-11-25", dueTime: "10:00", durationMinutes: 30 })).toBe("25 Nov 2026 10:00–10:30");
    expect(formatDue({ dueOn: "2026-11-25", dueTime: "23:30", durationMinutes: 60 })).toBe("25 Nov 2026 23:30–00:30");
    expect(formatCardDue("2026-11-25")).toBe("25 Nov");
  });
  it("offers durations from 5 minutes to 24 hours in steps of 5", () => {
    const d = durationOptions();
    expect(d[0]).toEqual({ minutes: 5, label: "5 min" });
    expect(d.at(-1)).toEqual({ minutes: 1440, label: "24 h" });
    expect(d).toHaveLength(288);
    expect(d.find((o) => o.minutes === 60)?.label).toBe("1 h");
    expect(d.find((o) => o.minutes === 90)?.label).toBe("1 h 30 min");
  });
  it("gives the UK week, Monday to Sunday", () => {
    expect(weekBounds(new Date("2026-11-25T12:00:00Z"))).toEqual({ start: "2026-11-23", end: "2026-11-29" });
    expect(weekBounds(new Date("2026-11-29T23:59:00Z"))).toEqual({ start: "2026-11-23", end: "2026-11-29" });
    // Sunday 23:30 UTC in summer is already Monday in the UK.
    expect(weekBounds(new Date("2026-07-05T23:30:00Z"))).toEqual({ start: "2026-07-06", end: "2026-07-12" });
  });
  it("counts activities in the list header", () => {
    expect(countLabel(1, "ACTIVITY", "ACTIVITIES")).toBe("1 ACTIVITY");
    expect(countLabel(12, "ACTIVITY", "ACTIVITIES")).toBe("12 ACTIVITIES");
  });
});

// covers FR-010, US4 scenarios 1–2 (T044)
describe("cardLine", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  it("warns when there is no next activity", () => {
    expect(cardLine(null, now)).toEqual({ kind: "warn", text: "⚠ No next activity" });
  });
  it("shows the next activity's day and type, overdue when it is", () => {
    expect(cardLine({ dueOn: "2026-11-25", dueTime: null, durationMinutes: null, type: "task" }, now)).toEqual({ kind: "next", text: "Next: 25 Nov · Task", overdue: false });
    expect(cardLine({ dueOn: "2026-11-22", dueTime: "10:00", durationMinutes: null, type: "call" }, now)).toEqual({ kind: "next", text: "Next: 22 Nov · Call", overdue: true });
    expect(cardLine({ dueOn: "2026-11-23", dueTime: null, durationMinutes: null, type: "task" }, new Date("2026-11-23T23:59:00Z"))).toMatchObject({ overdue: false });
  });
});

// covers FR-005, US2 scenario 2, US3 (no follow-up from the list) (T029, T036)
describe("afterTickPath", () => {
  it("adds the follow-up only when asked", () => {
    expect(afterTickPath("/deals/7", 12, true)).toBe("/deals/7?followup=12");
    expect(afterTickPath("/deals/7", 12, false)).toBe("/deals/7");
    expect(afterTickPath("/deals?pipeline=1&open=7", 12, true)).toBe("/deals?pipeline=1&open=7&followup=12");
    expect(afterTickPath("/activities?when=today", 12, false)).toBe("/activities?when=today");
  });
});

// covers FR-015 (T058): subject and note are only ever rendered as text
describe("plain text only", () => {
  it("never uses dangerouslySetInnerHTML in the activity screens, the timeline or the notifications", () => {
    const files = [
      ...readdirSync("src/app/(app)/activities").filter((f) => f.endsWith(".tsx")).map((f) => `src/app/(app)/activities/${f}`),
      "src/app/(app)/records/RecordTimeline.tsx",
      "src/app/(app)/notifications/page.tsx",
    ];
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

// covers SF-123 FR-001, FR-007, SC-001, spec Edge Cases (UK time, clocks changing)
describe("activity reminders", () => {
  const at = (iso: string) => new Date(iso);
  it("reminds 15 minutes before a timed activity and at 09:00 UK on the due date of an untimed one", () => {
    expect(REMINDER_LEAD_MINUTES).toBe(15);
    expect(UNTIMED_REMINDER_TIME).toBe("09:00");
    expect(reminderAt({ dueOn: "2026-11-25", dueTime: "10:00" }).toISOString()).toBe("2026-11-25T09:45:00.000Z");
    expect(reminderAt({ dueOn: "2026-01-15", dueTime: null }).toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(reminderAt({ dueOn: "2026-07-15", dueTime: null }).toISOString()).toBe("2026-07-15T08:00:00.000Z");
    expect(reminderAt({ dueOn: "2026-11-26", dueTime: "00:10" }).toISOString()).toBe("2026-11-25T23:55:00.000Z");
  });

  it("counts 15 real minutes across the clocks changing", () => {
    expect(reminderAt({ dueOn: "2026-03-29", dueTime: "02:10" }).toISOString()).toBe("2026-03-29T00:55:00.000Z");
    // 01:30 on 25 Oct 2026 happens twice: the BST reading (00:30Z) is taken.
    expect(reminderAt({ dueOn: "2026-10-25", dueTime: "01:30" }).toISOString()).toBe("2026-10-25T00:15:00.000Z");
  });

  it("is due at the start time (duration ignored), or at the end of the UK day without a time", () => {
    expect(dueMoment({ dueOn: "2026-11-25", dueTime: "10:00" }).toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(dueMoment({ dueOn: "2026-11-25", dueTime: null }).toISOString()).toBe("2026-11-26T00:00:00.000Z");
    expect(dueMoment({ dueOn: "2026-07-15", dueTime: null }).toISOString()).toBe("2026-07-15T23:00:00.000Z");
  });

  it("gives a reminder only while the due moment is ahead, even when the reminder time has passed", () => {
    const call = { dueOn: "2026-11-25", dueTime: "10:00" };
    expect(reminderFor(call, at("2026-11-25T09:00:00Z"))?.toISOString()).toBe("2026-11-25T09:45:00.000Z");
    expect(reminderFor(call, at("2026-11-25T09:50:00Z"))?.toISOString()).toBe("2026-11-25T09:45:00.000Z");
    expect(reminderFor(call, at("2026-11-25T10:00:00Z"))).toBeNull();
    expect(reminderFor(call, at("2026-11-25T11:00:00Z"))).toBeNull();
    const task = { dueOn: "2026-11-25", dueTime: null };
    expect(reminderFor(task, at("2026-11-25T09:30:00Z"))?.toISOString()).toBe("2026-11-25T09:00:00.000Z");
    expect(reminderFor(task, at("2026-11-25T23:59:00Z"))?.toISOString()).toBe("2026-11-25T09:00:00.000Z");
    expect(reminderFor(task, at("2026-11-26T00:00:00Z"))).toBeNull();
  });
});
