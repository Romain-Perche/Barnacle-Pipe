// The fake Google Calendar (SF-124 research.md §17, FR-015), development and tests only: pick a user and see the events
// of their fake primary calendar (title, start–end or all-day days, description, guests, reminders, private/free, whether
// the user declined, cancelled ones); create, change, decline or delete an event with or without delivering Google's
// notice; make the fake Google unreachable and reachable again; expire sync tokens; run the 15-minute check.
// 404 unless fakes are allowed, Gmail runs on the fake and Calendar sync is on. Times shown and typed in UK time.
import { notFound } from "next/navigation";
import { ukWallClock } from "@/server/activities/rules";
import type { FakeEvent } from "@/server/calendar/fake-calendar";
import { sql } from "@/server/db";
import { calendarConfig, gmailConfig, isFakeAllowed } from "@/server/env";
import { fakeGmail } from "@/server/gmail/fake-gmail";
import {
  addFakeCalendarEvent,
  changeFakeCalendarEvent,
  declineFakeCalendarEvent,
  deleteFakeCalendarEvent,
  expireFakeSyncTokens,
  runFakeCalendarCheck,
  toggleFakeGoogleReachable,
} from "./actions";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const DONE: Record<string, string> = {
  added: "Event created; its notice was dropped.",
  added_delivered: "Event created and its notice delivered.",
  changed: "Event changed; its notice was dropped.",
  changed_delivered: "Event changed and its notice delivered.",
  declined: "Event declined; its notice was dropped.",
  declined_delivered: "Event declined and its notice delivered.",
  deleted: "Event deleted; its notice was dropped.",
  deleted_delivered: "Event deleted and its notice delivered.",
  unreachable: "Google is now unreachable.",
  reachable: "Google is reachable again.",
  expired: "Sync tokens expired: the next sync lists again.",
  checked: "The 15-minute check ran.",
  bad_times: "Give a date (YYYY-MM-DD) and start and end times (HH:MM), or tick all-day.",
  no_user: "Pick a user first.",
};

function when(e: FakeEvent): string {
  if (e.start.date) {
    const [y, m, d] = (e.end.date ?? e.start.date).split("-").map(Number);
    const last = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    return last > e.start.date ? `All day ${e.start.date} to ${last}` : `All day ${e.start.date}`;
  }
  const s = ukWallClock(new Date(e.start.dateTime ?? ""));
  const t = ukWallClock(new Date(e.end.dateTime ?? ""));
  return `${s.day} ${s.time}–${t.day === s.day ? "" : `${t.day} `}${t.time} (UK)`;
}

function reminders(e: FakeEvent): string {
  if (!e.reminders || e.reminders.useDefault) return "the calendar's defaults";
  const list = e.reminders.overrides ?? [];
  return list.length ? list.map((r) => `${r.method} ${r.minutes} min before`).join(", ") : "none";
}

export default async function FakeCalendarPage({ searchParams }: Props) {
  if (!isFakeAllowed() || gmailConfig().mode !== "fake" || calendarConfig().mode === "off") notFound();
  const q = await searchParams;
  const users = await sql<{ email: string; name: string }[]>`select email, name from users order by lower(name)`;
  const user = users.find((u) => u.email === one(q.user).toLowerCase())?.email ?? "";
  const fake = fakeGmail();
  const events = user ? fake.calendarEvents(user) : [];
  const channel = user ? fake.calendarChannel(user) : null;
  const userField = <input type="hidden" name="user" value={user} />;
  const deliver = (
    <label className="check">
      <input type="checkbox" name="deliver" defaultChecked /> Deliver the notice
    </label>
  );
  return (
    <main className="main" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div className="label">
        <span className="c">//</span> FAKE GOOGLE CALENDAR · DEVELOPMENT AND TEST ONLY
      </div>
      <h1>Fake calendar</h1>
      {DONE[one(q.done)] && <p className="notice">{DONE[one(q.done)]}</p>}
      <form method="get" className="form-acts">
        <select className="input" name="user" defaultValue={user}>
          <option value="">Pick a user</option>
          {users.map((u) => (
            <option key={u.email} value={u.email}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        <button className="btn" type="submit">
          [ OPEN ]
        </button>
      </form>
      <p className="hint">
        Google: {fake.isUnreachable() ? "unreachable" : "reachable"}
        {user && ` · Notices: ${channel ? `channel active until ${new Date(channel.expiration).toISOString()}` : "no channel"}`}
      </p>
      <div className="form-acts">
        <form action={toggleFakeGoogleReachable}>
          {userField}
          <button className="btn" type="submit">
            {fake.isUnreachable() ? "[ MAKE GOOGLE REACHABLE ]" : "[ MAKE GOOGLE UNREACHABLE ]"}
          </button>
        </form>
        <form action={expireFakeSyncTokens}>
          {userField}
          <button className="btn" type="submit">
            [ EXPIRE SYNC TOKENS ]
          </button>
        </form>
        <form action={runFakeCalendarCheck}>
          {userField}
          <button className="btn solid" type="submit">
            [ RUN THE 15-MINUTE CHECK ]
          </button>
        </form>
      </div>
      {user && (
        <>
          <h2>Events</h2>
          {events.length === 0 && <p className="hint">No events.</p>}
          {events.map((e) => {
            const self = e.attendees?.find((a) => a.self);
            const others = (e.attendees ?? []).filter((a) => !a.self).map((a) => a.email);
            return (
              <section key={e.id} className="gm-card" aria-label={e.summary ?? e.id} style={{ marginBottom: 16 }}>
                <h3>
                  {e.status === "cancelled" ? "[cancelled] " : ""}
                  {e.summary || "(No title)"}
                </h3>
                <ul className="gm-lines">
                  <li>When: {when(e)}</li>
                  <li>Description: {e.description ?? "—"}</li>
                  <li>Guests: {others.length ? others.join(", ") : "none"}</li>
                  <li>Reminders: {reminders(e)}</li>
                  <li>
                    {e.visibility === "private" ? "Private" : "Default visibility"} · {e.transparency === "transparent" ? "Free" : "Busy"}
                  </li>
                  <li>Organiser: {e.organizer}</li>
                  {self?.responseStatus === "declined" && <li>Declined by {user}</li>}
                  {e.recurrence && <li>Recurring: {e.recurrence.join(" ")}</li>}
                  <li>Id: {e.id}</li>
                </ul>
                {e.status !== "cancelled" && (
                  <div className="form-acts">
                    <form action={changeFakeCalendarEvent} className="form-acts">
                      {userField}
                      <input type="hidden" name="event" value={e.id} />
                      <input className="input" name="title" defaultValue={e.summary ?? ""} aria-label="Title" />
                      <input className="input" name="date" placeholder="YYYY-MM-DD" aria-label="Date" />
                      <input className="input" name="start" placeholder="HH:MM" aria-label="Start" />
                      <input className="input" name="end" placeholder="HH:MM" aria-label="End" />
                      <label className="check">
                        <input type="checkbox" name="allDay" /> All day
                      </label>
                      {deliver}
                      <button className="btn" type="submit">
                        [ CHANGE ]
                      </button>
                    </form>
                    <form action={declineFakeCalendarEvent}>
                      {userField}
                      <input type="hidden" name="event" value={e.id} />
                      {deliver}
                      <button className="btn" type="submit">
                        [ DECLINE ]
                      </button>
                    </form>
                    <form action={deleteFakeCalendarEvent}>
                      {userField}
                      <input type="hidden" name="event" value={e.id} />
                      {deliver}
                      <button className="btn red" type="submit">
                        [ DELETE ]
                      </button>
                    </form>
                  </div>
                )}
              </section>
            );
          })}
          <h2>Create an event</h2>
          <form action={addFakeCalendarEvent} className="stack">
            {userField}
            <label className="field">
              <span>Title</span>
              <input className="input" name="title" type="text" autoComplete="off" />
            </label>
            <label className="field">
              <span>Date (YYYY-MM-DD)</span>
              <input className="input" name="date" type="text" autoComplete="off" />
            </label>
            <label className="field">
              <span>Start and end (HH:MM, UK time)</span>
              <span className="form-acts">
                <input className="input" name="start" type="text" placeholder="15:00" aria-label="Start" />
                <input className="input" name="end" type="text" placeholder="15:45" aria-label="End" />
              </span>
            </label>
            <label className="check">
              <input type="checkbox" name="allDay" /> All day, until (YYYY-MM-DD, optional)
              <input className="input" name="endDate" type="text" aria-label="Last day" />
            </label>
            <label className="field">
              <span>Guests (addresses, separated by commas)</span>
              <input className="input" name="guests" type="text" autoComplete="off" />
            </label>
            <label className="field">
              <span>Organiser (empty: the user; another address: an invitation)</span>
              <input className="input" name="organizer" type="text" autoComplete="off" />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea className="input" name="description" rows={2} />
            </label>
            <label className="check">
              <input type="checkbox" name="recurring" /> Recurring (weekly)
            </label>
            {deliver}
            <button className="btn solid" type="submit">
              [ CREATE ]
            </button>
          </form>
        </>
      )}
    </main>
  );
}
