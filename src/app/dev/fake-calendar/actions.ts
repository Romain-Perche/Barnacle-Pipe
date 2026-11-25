"use server";
// The fake calendar page's buttons (SF-124 research.md §17, FR-015), development and tests only: create, change,
// decline or delete an event in a user's fake primary calendar, each with or without delivering Google's notice
// (through the same receiveCalendarPush as /calendar/push), make the fake Google unreachable or reachable, expire sync
// tokens, run the 15-minute check. Times are typed as UK wall-clock times. Back to the page with a fixed code.
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { ukInstant } from "@/server/activities/rules";
import type { FakeEventChange } from "@/server/calendar/fake-calendar";
import { calendarConfig, gmailConfig, isFakeAllowed } from "@/server/env";
import { fakeGmail } from "@/server/gmail/fake-gmail";
import { runGmailCheck } from "@/server/gmail/sync";

const str = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function guard(form: FormData): string {
  if (!isFakeAllowed() || gmailConfig().mode !== "fake" || calendarConfig().mode === "off") notFound();
  return str(form, "user").toLowerCase();
}

function back(user: string, done: string): never {
  revalidatePath("/dev/fake-calendar");
  redirect(`/dev/fake-calendar?user=${encodeURIComponent(user)}&done=${done}`);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The event's times from the form: all-day from `date` to `endDate` (inclusive; the day itself when empty), else `date`
// `start`–`end` in UK time (an end before the start is on the next day). Null when unreadable.
function timesOf(form: FormData): { start: string; end: string; allDay: boolean } | null {
  const date = str(form, "date");
  if (!DAY.test(date)) return null;
  if (form.get("allDay") === "on") {
    const last = DAY.test(str(form, "endDate")) && str(form, "endDate") >= date ? str(form, "endDate") : date;
    return { start: date, end: addDays(last, 1), allDay: true };
  }
  const s = str(form, "start");
  const e = str(form, "end");
  if (!TIME.test(s) || !TIME.test(e)) return null;
  const start = ukInstant(date, s);
  const end = ukInstant(e > s ? date : addDays(date, 1), e);
  return { start: start.toISOString(), end: end.toISOString(), allDay: false };
}

const guests = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter((x) => x.includes("@"));

export async function addFakeCalendarEvent(form: FormData): Promise<void> {
  const user = guard(form);
  if (!user) back(user, "no_user");
  const t = timesOf(form);
  if (!t) back(user, "bad_times");
  await fakeGmail().addEvent(
    user,
    {
      summary: str(form, "title"),
      description: str(form, "description") || undefined,
      ...t,
      attendees: guests(str(form, "guests")),
      recurrence: form.get("recurring") === "on" ? ["RRULE:FREQ=WEEKLY"] : undefined,
      organizer: str(form, "organizer") || undefined,
    },
    { deliver: form.get("deliver") === "on" },
  );
  back(user, form.get("deliver") === "on" ? "added_delivered" : "added");
}

export async function changeFakeCalendarEvent(form: FormData): Promise<void> {
  const user = guard(form);
  const change: FakeEventChange = { summary: str(form, "title") };
  if (str(form, "date")) {
    const t = timesOf(form);
    if (!t) back(user, "bad_times");
    Object.assign(change, t);
  }
  await fakeGmail().changeEvent(user, str(form, "event"), change, { deliver: form.get("deliver") === "on" });
  back(user, form.get("deliver") === "on" ? "changed_delivered" : "changed");
}

export async function declineFakeCalendarEvent(form: FormData): Promise<void> {
  const user = guard(form);
  await fakeGmail().declineEvent(user, str(form, "event"), { deliver: form.get("deliver") === "on" });
  back(user, form.get("deliver") === "on" ? "declined_delivered" : "declined");
}

export async function deleteFakeCalendarEvent(form: FormData): Promise<void> {
  const user = guard(form);
  await fakeGmail().deleteEvent(user, str(form, "event"), { deliver: form.get("deliver") === "on" });
  back(user, form.get("deliver") === "on" ? "deleted_delivered" : "deleted");
}

export async function toggleFakeGoogleReachable(form: FormData): Promise<void> {
  const user = guard(form);
  const fake = fakeGmail();
  fake.setUnreachable(!fake.isUnreachable());
  back(user, fake.isUnreachable() ? "unreachable" : "reachable");
}

export async function expireFakeSyncTokens(form: FormData): Promise<void> {
  const user = guard(form);
  fakeGmail().expireCalendarTokens();
  back(user, "expired");
}

export async function runFakeCalendarCheck(form: FormData): Promise<void> {
  const user = guard(form);
  await runGmailCheck(new Date());
  back(user, "checked");
}
