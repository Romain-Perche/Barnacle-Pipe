// covers SF-122 FR-011, FR-012, US3 scenarios 1–2, edge cases (subject, due date, duration, note)
import { describe, expect, it } from "vitest";
import type { PdActivity } from "@/server/pipedrive/api";
import { activityFromPipedrive, durationMinutes, ukFromUtc, type ActivityCtx } from "@/server/pipedrive/deal-rules";

const NOW = new Date("2026-11-24T12:00:00Z");
const act = (a: Partial<PdActivity> = {}): PdActivity => ({
  id: 9, subject: "Call Ada", type: "call", ownerId: 2, deleted: false, addTime: "2026-10-01 08:00:00", updateTime: "2026-10-02 08:00:00", dealId: null,
  leadId: "", personId: null, orgId: null, projectId: null, dueDate: "2026-12-01", dueTime: "", duration: "", done: false, doneTime: "", note: "", ...a,
});
const ctx = (): ActivityCtx => ({
  importerId: 100,
  users: new Map([["margaret@barnacle.ai", 102]]),
  pdUsers: { "2": { name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" }, "3": { name: "Jane Fake", email: "jane@fake.example" } },
  owners: {},
  types: { deadline: { name: "Deadline", custom: false }, site_visit_7: { name: "Site visit", custom: true } },
  now: NOW,
});
const ok = (a: PdActivity, c = ctx()) => {
  const r = activityFromPipedrive(a, c);
  if (!r.ok) throw new Error(r.problem.code);
  return r;
};

describe("ukFromUtc", () => {
  it("converts Pipedrive's UTC due time to UK time (GMT, BST, across midnight)", () => {
    expect(ukFromUtc("2026-01-15", "09:30")).toEqual({ dueOn: "2026-01-15", dueTime: "09:30" });
    expect(ukFromUtc("2026-07-15", "09:30")).toEqual({ dueOn: "2026-07-15", dueTime: "10:30" });
    expect(ukFromUtc("2026-07-15", "23:30")).toEqual({ dueOn: "2026-07-16", dueTime: "00:30" });
    expect(ukFromUtc("2026-07-15", "23:30:00")).toEqual({ dueOn: "2026-07-16", dueTime: "00:30" });
  });
});

describe("durationMinutes", () => {
  it("rounds up to the next 5 minutes within 5 minutes–24 hours, else a warning", () => {
    expect(durationMinutes("00:07")).toEqual({ minutes: 10 });
    expect(durationMinutes("01:00")).toEqual({ minutes: 60 });
    expect(durationMinutes("24:00")).toEqual({ minutes: 1440 });
    expect(durationMinutes("")).toEqual({ minutes: null });
    expect(durationMinutes("00:00")).toEqual({ minutes: null });
    expect(durationMinutes("24:05")).toEqual({ warning: { code: "pipedrive_duration_left_out", args: { text: "24:05" } } });
    expect(durationMinutes("soon")).toEqual({ warning: { code: "pipedrive_duration_left_out", args: { text: "soon" } } });
  });
});

describe("activityFromPipedrive", () => {
  it("keeps call, meeting and task; makes any other type a task and says which", () => {
    expect(ok(act({ type: "meeting" })).value.type).toBe("meeting");
    const d = ok(act({ type: "deadline" }));
    expect(d.value.type).toBe("task");
    expect(d.otherType).toEqual({ type: "deadline", name: "deadline" });
    expect(ok(act({ type: "site_visit_7" })).otherType).toEqual({ type: "site_visit_7", name: "Site visit" });
    expect(ok(act({ type: "lunch" })).otherType).toEqual({ type: "lunch", name: "lunch" });
  });
  it("refuses an empty or too long subject with the form's messages, and no due date", () => {
    expect(activityFromPipedrive(act({ subject: " " }), ctx())).toMatchObject({ ok: false, label: "#9", problem: { code: "activity_subject_required" } });
    expect(activityFromPipedrive(act({ subject: "x".repeat(201) }), ctx())).toMatchObject({ ok: false, problem: { code: "activity_subject_too_long" } });
    expect(activityFromPipedrive(act({ dueDate: "" }), ctx())).toMatchObject({ ok: false, problem: { code: "pipedrive_no_due_date" } });
  });
  it("due date and time in UK time, duration only with a time", () => {
    expect(ok(act({ dueDate: "2026-07-15", dueTime: "09:30", duration: "00:45" })).value).toMatchObject({ dueOn: "2026-07-15", dueTime: "10:30", durationMinutes: 45 });
    const noTime = ok(act({ duration: "00:30" }));
    expect(noTime.value).toMatchObject({ dueTime: null, durationMinutes: null });
    expect(noTime.warnings).toEqual([{ code: "pipedrive_duration_left_out", args: { text: "00:30" } }]);
  });
  it("note as plain text; over 10,000 characters left out with a warning", () => {
    expect(ok(act({ note: "<p>Bring <b>slides</b></p>" })).value.note).toBe("Bring slides");
    const long = ok(act({ note: "x".repeat(10_001) }));
    expect(long.value.note).toBeNull();
    expect(long.warnings).toEqual([{ code: "pipedrive_value_too_long", args: { field: "note", max: 10_000 } }]);
  });
  it("assignee matched by email, else the importer (counted); assigned by the assignee; done at Pipedrive's time by the assignee", () => {
    const r = ok(act({ done: true, doneTime: "2026-10-05 10:00:00" }));
    expect(r.value).toMatchObject({ assigneeId: 102, doneAt: new Date("2026-10-05T10:00:00Z"), createdAt: new Date("2026-10-01T08:00:00Z") });
    const c = ctx();
    expect(ok(act({ ownerId: 3 }), c).value.assigneeId).toBe(100);
    expect(c.owners["3"].records).toBe(1);
    expect(ok(act({ done: true })).value.doneAt).toEqual(new Date("2026-10-02T08:00:00Z"));
    expect(ok(act()).value.doneAt).toBeNull();
  });
});
