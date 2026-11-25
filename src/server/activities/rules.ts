// Activities (SF-109 data-model.md § Entity, research.md §4): pure rules, no database. Due dates and times are UK
// wall-clock values ("2026-11-25", "10:00"), never instants; every rule that needs the clock takes `now`.
import { messages, templates } from "@/server/messages";
import type { FieldErrors } from "@/server/records/rules";
import { toId } from "@/server/records/rules";

export const ACTIVITY_TYPES = ["call", "meeting", "task"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const TYPE_LABELS: Record<ActivityType, string> = { call: "Call", meeting: "Meeting", task: "Task" };

export const SUBJECT_MAX = 200;
export const ACTIVITY_NOTE_MAX = 10_000;

// What the activity form posts, as typed (also sent back to the form on a refusal).
export type ActivityForm = {
  type: string;
  subject: string;
  dueOn: string;
  dueTime: string;
  duration: string;
  assigneeId: string;
  note: string;
  dealId: string;
  personId: string;
  organisationId: string;
};

export type ActivityValue = {
  type: ActivityType;
  subject: string;
  dueOn: string;
  dueTime: string | null;
  durationMinutes: number | null;
  // null: the actor.
  assigneeId: number | null;
  note: string | null;
  dealId: number | null;
  personId: number | null;
  organisationId: number | null;
};

export type Due = { dueOn: string; dueTime: string | null; durationMinutes: number | null };
export type ActivityState = "done" | "overdue" | "today" | "later";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const ukParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function parts(date: Date) {
  const p = Object.fromEntries(ukParts.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// The UK day of an instant: "2026-11-23".
export function ukToday(now: Date): string {
  return parts(now).day;
}

function isDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// "2026-11-25" + n days.
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The instant of a UK wall-clock time (00:00 when no time). The UK is UTC+1 (BST) or UTC+0 (GMT): the first candidate
// that reads back as the same day and time wins, so the autumn overlap takes the first (BST) one. A time in the spring
// gap has none; it gets the GMT reading (never stored: validateActivity refuses it).
export function ukInstant(dueOn: string, time: string | null): Date {
  const [y, m, d] = dueOn.split("-").map(Number);
  const [h, mi] = (time ?? "00:00").split(":").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  for (const offset of [3_600_000, 0]) {
    const at = new Date(asUtc - offset);
    const p = parts(at);
    if (p.day === dueOn && p.time === (time ?? "00:00").slice(0, 5)) return at;
  }
  return new Date(asUtc);
}

export function existsInUk(dueOn: string, time: string): boolean {
  const p = parts(ukInstant(dueOn, time));
  return p.day === dueOn && p.time === time;
}

const cut = (value: string) => value.replace(/\r\n?/g, "\n").trim();

export function validateActivity(form: ActivityForm): { ok: true; value: ActivityValue } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const type = (ACTIVITY_TYPES as readonly string[]).includes(form.type) ? (form.type as ActivityType) : null;
  if (type === null) errors.type = { code: "activity_type_invalid" };
  const subject = cut(form.subject ?? "");
  if (subject === "") errors.subject = { code: "activity_subject_required" };
  else if ([...subject].length > SUBJECT_MAX) errors.subject = { code: "activity_subject_too_long" };
  const dueOn = (form.dueOn ?? "").trim();
  if (!isDay(dueOn)) errors.dueOn = { code: "activity_due_required" };
  const rawTime = (form.dueTime ?? "").trim().slice(0, 5);
  const dueTime = rawTime === "" ? null : rawTime;
  if (dueTime !== null && (!TIME.test(dueTime) || (isDay(dueOn) && !existsInUk(dueOn, dueTime)))) {
    errors.dueTime = { code: "activity_time_not_in_uk" };
  }
  const rawDuration = (form.duration ?? "").trim();
  let durationMinutes: number | null = null;
  if (rawDuration !== "") {
    const n = Number(rawDuration);
    if (dueTime === null) errors.duration = { code: "activity_duration_needs_time" };
    else if (!/^\d{1,4}$/.test(rawDuration) || n < 5 || n > 1440 || n % 5 !== 0) errors.duration = { code: "activity_duration_invalid" };
    else durationMinutes = n;
  }
  const noteText = cut(form.note ?? "");
  if ([...noteText].length > ACTIVITY_NOTE_MAX) errors.note = { code: "activity_note_too_long" };
  if (Object.keys(errors).length > 0 || type === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      type,
      subject,
      dueOn,
      dueTime,
      durationMinutes,
      assigneeId: toId(form.assigneeId ?? ""),
      note: noteText === "" ? null : noteText,
      dealId: toId(form.dealId ?? ""),
      personId: toId(form.personId ?? ""),
      organisationId: toId(form.organisationId ?? ""),
    },
  };
}

// FR-009: overdue when not done and due before today (UK), or due today with a time (plus duration) that has passed.
export function activityState(a: Due & { done: boolean }, now: Date): ActivityState {
  if (a.done) return "done";
  const today = ukToday(now);
  if (a.dueOn < today) return "overdue";
  if (a.dueOn > today) return "later";
  if (a.dueTime !== null && endOf(a).getTime() <= now.getTime()) return "overdue";
  return "today";
}

function endOf(a: Due): Date {
  return new Date(ukInstant(a.dueOn, a.dueTime).getTime() + (a.durationMinutes ?? 0) * 60_000);
}

function dayText(dueOn: string): string {
  const [y, m, d] = dueOn.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

// "25 Nov 2026", "25 Nov 2026 10:00", "25 Nov 2026 10:00–10:30".
export function formatDue(a: Due): string {
  if (a.dueTime === null) return dayText(a.dueOn);
  const start = `${dayText(a.dueOn)} ${a.dueTime.slice(0, 5)}`;
  if (a.durationMinutes === null) return start;
  return `${start}–${parts(endOf(a)).time}`;
}

// The board card's day: "25 Nov".
export function formatCardDue(dueOn: string): string {
  const [, m, d] = dueOn.split("-");
  return `${d} ${MONTHS[Number(m) - 1]}`;
}

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function durationOptions(): { minutes: number; label: string }[] {
  return Array.from({ length: 288 }, (_, i) => (i + 1) * 5).map((minutes) => ({ minutes, label: durationLabel(minutes) }));
}

// Monday to Sunday of the UK week holding `now`.
export function weekBounds(now: Date): { start: string; end: string } {
  const today = ukToday(now);
  const [y, m, d] = today.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday 0
  const start = addDays(today, -weekday);
  return { start, end: addDays(start, 6) };
}

export type CardNext = Due & { type: ActivityType };
export type CardLine = { kind: "warn"; text: string } | { kind: "next"; text: string; overdue: boolean };

// The last line of a board card (FR-010).
export function cardLine(next: CardNext | null, now: Date): CardLine {
  if (next === null) return { kind: "warn", text: messages.no_next_activity };
  return {
    kind: "next",
    text: templates.next_activity(formatCardDue(next.dueOn), TYPE_LABELS[next.type]),
    overdue: activityState({ ...next, done: false }, now) === "overdue",
  };
}

// `path` (an in-app address, maybe with a query) with one more parameter; any "#…" is dropped.
export function addParam(path: string, key: string, value: string | number): string {
  const hash = path.indexOf("#");
  const base = hash === -1 ? path : path.slice(0, hash);
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(String(value))}`;
}

// The address after a tick: `back`, plus `followup=<id>` only when the follow-up box was asked for (record pages, the drawer).
export function afterTickPath(back: string, id: number, followup: boolean): string {
  return followup ? addParam(back, "followup", id) : back;
}

// SF-123 (research.md §2): one in-app reminder per planned activity, for its assignee.
export const REMINDER_LEAD_MINUTES = 15;
export const UNTIMED_REMINDER_TIME = "09:00";
type DueAt = { dueOn: string; dueTime: string | null };

// 15 real minutes before a timed activity; 09:00 UK time on the due date of an untimed one.
export function reminderAt(due: DueAt): Date {
  if (due.dueTime === null) return ukInstant(due.dueOn, UNTIMED_REMINDER_TIME);
  return new Date(ukInstant(due.dueOn, due.dueTime).getTime() - REMINDER_LEAD_MINUTES * 60_000);
}

// After this, no reminder: a timed activity's start (its duration does not extend it); untimed: the end of its UK day.
export function dueMoment(due: DueAt): Date {
  return due.dueTime === null ? ukInstant(addDays(due.dueOn, 1), null) : ukInstant(due.dueOn, due.dueTime);
}

// The reminder time of an activity saved at `now`; null once its due moment has come (FR-007).
export function reminderFor(due: DueAt, now: Date): Date | null {
  return dueMoment(due).getTime() > now.getTime() ? reminderAt(due) : null;
}
