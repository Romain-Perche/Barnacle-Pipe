// Fake Google Calendar data (SF-124 data-model.md § Fake data, FR-016), through the real paths: Ada Fake's fake Gmail
// connection gets the Calendar permission (reconnected through the fake consent when it was made without it), her
// planned activities due today or later go into her fake calendar (syncCalendar), then one event "Fake intro meeting",
// seven days ahead 15:00–15:45 UK time with the first fake person she can see as guest, comes in as a Meeting.
// Fake Gmail and CALENDAR_SYNC=on only. Re-runnable: a connection that already has a meeting from Google is left as it is.
import { ukInstant, ukToday } from "@/server/activities/rules";
import { syncCalendar } from "@/server/calendar/sync";
import type { Sql } from "@/server/db";
import { calendarConfig, gmailConfig } from "@/server/env";
import { fakeGmail } from "@/server/gmail/fake-gmail";
import { hasCalendarScope } from "@/server/gmail/rules";
import { visiblePerson } from "@/server/records/visibility";
import { connectAda } from "@/seed/gmail";

const ADA = "ada@barnacle.ai";

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function seedCalendar(sql: Sql): Promise<string[]> {
  const cfg = gmailConfig();
  if (cfg.mode === "real") return ["Calendar fake data skipped (real Gmail settings)."];
  if (cfg.mode === "off") return ["Calendar fake data skipped (GMAIL_TOKEN_KEY not set)."];
  if (calendarConfig().mode === "off") return ["Calendar fake data skipped (CALENDAR_SYNC is not on)."];
  const [ada] = await sql<{ id: number }[]>`select id::int as id from users where email = ${ADA} and status = 'active'`;
  if (!ada) return ["Calendar fake data skipped (no Ada Fake)."];
  const conn = async () =>
    (await sql<{ id: number; state: string; scopes: string }[]>`select id::int as id, state, scopes from gmail_connections where user_id = ${ada.id}`)[0];
  let c = await conn();
  if (!c || c.state !== "working") return ["Calendar fake data skipped (Ada Fake has no Gmail connection)."];
  const [done] = await sql`select 1 from calendar_events where connection_id = ${c.id} and origin = 'google' limit 1`;
  if (done) return ["already there calendar events"];
  if (!hasCalendarScope(c.scopes)) {
    if (!(await connectAda(ada.id, cfg.appUrl, cfg.clientId))) return ["Calendar fake data skipped (the fake gave no key)."];
    c = await conn();
  }
  const [guest] = await sql<{ email: string }[]>`
    select e.email from persons p join person_emails e on e.person_id = p.id
    where p.archived_at is null and ${visiblePerson(sql, ada.id)}
    order by p.id, e.position limit 1`;
  if (!guest) return ["Calendar fake data skipped (no fake people)."];
  await syncCalendar(c.id);
  const day = addDays(ukToday(new Date()), 7);
  await fakeGmail().addEvent(ADA, {
    summary: "Fake intro meeting",
    start: ukInstant(day, "15:00").toISOString(),
    end: ukInstant(day, "15:45").toISOString(),
    attendees: [guest.email],
  });
  await syncCalendar(c.id);
  const [{ crm, google }] = await sql<{ crm: number; google: number }[]>`
    select count(*) filter (where origin = 'crm')::int as crm, count(*) filter (where origin = 'google')::int as google
    from calendar_events where connection_id = ${c.id} and state = 'synced'`;
  return [`added ${crm} fake calendar events for Ada Fake's activities and ${google} meeting from her fake calendar`];
}
