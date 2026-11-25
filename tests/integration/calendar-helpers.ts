// SF-124 test helpers: connect a user with Calendar through the real start action, fake consent and callback (the
// gmail-helpers pattern), schedule and change activities through the domain functions, read the fake calendars and the
// links. The test file mocks next/headers, next/navigation and next/cache before importing this.
import { addDays } from "./calendar-days";
import { scheduleActivity } from "@/server/activities/activities";
import { ukToday, type ActivityForm } from "@/server/activities/rules";
import { afterResponseSettled } from "@/server/calendar/soon";
import { syncCalendar } from "@/server/calendar/sync";
import { sql } from "@/server/db";
import type { GmailFake } from "../fakes/gmail";
import * as h from "./gmail-helpers";

export { addDays };

// A UK day `n` days from today ("2026-11-27").
export const day = (n: number) => addDays(ukToday(new Date()), n);

export async function connectCalendar(jar: Map<string, string>, fake: GmailFake, userId: number, o: { scopes?: string[] } = {}): Promise<string> {
  await h.signInAs(jar, userId);
  const to = await h.connectGmail(fake, o);
  await afterResponseSettled();
  return to;
}

export async function connectionIdOf(userId: number): Promise<number> {
  const [row] = await sql<{ id: number }[]>`select id::int as id from gmail_connections where user_id = ${userId}`;
  return row.id;
}

export async function sync(userId: number, now?: Date) {
  return syncCalendar(await connectionIdOf(userId), now);
}

export function form(o: Partial<ActivityForm> = {}): ActivityForm {
  return {
    type: "call",
    subject: "Fake call",
    dueOn: day(7),
    dueTime: "10:00",
    duration: "30",
    assigneeId: "",
    note: "",
    dealId: "",
    personId: "",
    organisationId: "",
    ...o,
  };
}

export async function schedule(actorId: number, o: Partial<ActivityForm> = {}): Promise<number> {
  const r = await scheduleActivity(actorId, form(o));
  if (r.status !== "ok") throw new Error(`schedule: ${JSON.stringify(r)}`);
  return r.id;
}

export async function versionOf(id: number): Promise<number> {
  const [row] = await sql<{ version: number }[]>`select version from activities where id = ${id}`;
  return row.version;
}

export type ActivityRow = {
  id: number;
  type: string;
  subject: string;
  due_on: string;
  due_time: string | null;
  duration_minutes: number | null;
  note: string | null;
  done: boolean;
  assignee_id: number;
  person_id: number | null;
  organisation_id: number | null;
  deal_id: number | null;
  version: number;
};

export async function activity(id: number): Promise<ActivityRow | undefined> {
  const [row] = await sql<ActivityRow[]>`
    select id::int as id, type, subject, to_char(due_on, 'YYYY-MM-DD') as due_on, to_char(due_time, 'HH24:MI') as due_time,
           duration_minutes, note, done_at is not null as done, assignee_id::int as assignee_id, person_id::int as person_id,
           organisation_id::int as organisation_id, deal_id::int as deal_id, version
    from activities where id = ${id}`;
  return row;
}

export async function activitiesOf(userId: number): Promise<ActivityRow[]> {
  const rows = await sql<{ id: number }[]>`select id::int as id from activities where assignee_id = ${userId} order by id`;
  return Promise.all(rows.map(async (r) => (await activity(r.id))!));
}

export type LinkRow = { id: number; activity_id: number | null; connection_id: number; google_event_id: string; origin: string; state: string; dirty: boolean };

export async function linkOf(activityId: number): Promise<LinkRow | undefined> {
  const [row] = await sql<LinkRow[]>`
    select id::int as id, activity_id::int as activity_id, connection_id::int as connection_id, google_event_id, origin, state, dirty
    from calendar_events where activity_id = ${activityId}`;
  return row;
}

export async function links(): Promise<LinkRow[]> {
  return sql<LinkRow[]>`
    select id::int as id, activity_id::int as activity_id, connection_id::int as connection_id, google_event_id, origin, state, dirty
    from calendar_events order by id`;
}

// The events of a user's fake calendar that are not cancelled.
export const live = (fake: GmailFake, email: string) => fake.calendarEvents(email).filter((e) => e.status !== "cancelled");

export function eventOf(fake: GmailFake, email: string, id: string) {
  return fake.calendarEvents(email).find((e) => e.id === id);
}

// Every Calendar write the app sent to the fake (SC-004: sendUpdates=none, never attendees).
export function calendarWrites(fake: GmailFake) {
  return fake.requests.filter((r) => r.url.startsWith("https://www.googleapis.com/calendar/v3/") && r.method !== "GET" && !r.url.endsWith("/watch") && !r.url.endsWith("/channels/stop"));
}
