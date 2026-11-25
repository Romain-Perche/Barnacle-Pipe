// Fake activities (SF-109 data-model.md § Fake data, FR-017). Clearly fake subjects, for the fake users, on records of
// src/seed/people.ts and src/seed/deals.ts. Dates are relative to the UK day the seed runs on, so there is always an
// overdue one, two due today and later ones; three done ones show on timelines (one raises "Last contacted"); one is
// on a private deal and one on a private person; each assignee can see every record its activity is linked to (FR-012);
// one assignment notification is unread (Ada → Grace), one read
// (Grace → Ada). Most open deals keep no planned activity ("⚠ No next activity" on their card).
// SF-123 (research.md §8): every planned one gets its reminder as when scheduled now (later ones: still to come; overdue
// ones: none), and three more for Ada Fake stand for activities scheduled earlier, their reminder already shown: a
// timed call due in a few minutes (unread), an untimed task due today, or yesterday before 09:00 (unread), and
// yesterday's meeting (read).
// Idempotent: an activity is found by its exact subject; nothing is added when it is there.
import { reminderAt, reminderFor, ukInstant, ukToday, type ActivityType } from "@/server/activities/rules";
import type { Sql } from "@/server/db";

type Seed = {
  subject: string;
  type: ActivityType;
  days: number; // from today (UK), negative in the past
  time?: string;
  minutes?: number;
  assignee: string;
  by?: string; // who scheduled it (assigned_by); default the assignee
  deal?: string;
  person?: [string, string];
  organisation?: string;
  linksFromDeal?: boolean; // also link the deal's main person and organisation
  doneDaysAgo?: number;
  read?: boolean;
  note?: string;
  // SF-123: "soon": due at the next 5-minute mark at least 5 minutes from now (`days` / `time` unused); "untimedShown":
  // no time, due today from 09:00 UK, else yesterday. `reminder`: the reminder already shown, unread or read.
  dueAt?: "soon" | "untimedShown";
  reminder?: "unread" | "read";
};

const SEEDS: Seed[] = [
  { subject: "Fake call: chase the signed proposal", type: "call", days: -4, assignee: "Ada Fake", deal: "Fakeco website", linksFromDeal: true },
  { subject: "Fake task: send the pricing sheet", type: "task", days: 0, time: "09:00", assignee: "Ada Fake", deal: "Sample Gyms CRM", linksFromDeal: true },
  { subject: "Fake meeting: kick-off", type: "meeting", days: 0, time: "15:00", minutes: 60, assignee: "Ada Fake", organisation: "Fakeco Ltd" },
  {
    subject: "Fake call: intro call", type: "call", days: 2, time: "10:00", assignee: "Ada Fake", by: "Grace Fake", deal: "Mock Labs audit",
    linksFromDeal: true, read: true,
  },
  { subject: "Fake task: write up the dinner notes", type: "task", days: 5, assignee: "Ada Fake" },
  { subject: "Fake meeting: quarterly review", type: "meeting", days: 1, time: "11:00", minutes: 30, assignee: "Grace Fake", by: "Ada Fake", organisation: "Fakeco Ltd" },
  { subject: "Fake task: check in after the trial", type: "task", days: 8, assignee: "Grace Fake", person: ["Bob", "Placeholder"] },
  {
    subject: "Fake call: discovery call", type: "call", days: -6, time: "14:00", assignee: "Ada Fake", deal: "Fakeco AI pilot", linksFromDeal: true,
    doneDaysAgo: 6, note: "Fake notes: they want a pilot.\nBudget to confirm.",
  },
  { subject: "Fake call: follow-up call", type: "call", days: -3, time: "16:30", assignee: "Linus Fake", deal: "Fakeco support contract", linksFromDeal: true, doneDaysAgo: 3 },
  { subject: "Fake meeting: demo", type: "meeting", days: -2, time: "10:00", minutes: 45, assignee: "Margaret Fake", organisation: "Fakeco Ltd", doneDaysAgo: 1 },
  { subject: "Fake call: secret project check-in", type: "call", days: 1, time: "09:30", assignee: "Ada Fake", deal: "Fake secret project" },
  { subject: "Fake task: private follow-up with Gus", type: "task", days: 3, assignee: "Ada Fake", person: ["Gus", "Lorem"] },
  {
    subject: "Fake call: reminder test call", type: "call", days: 0, dueAt: "soon", assignee: "Ada Fake", deal: "Sample Gyms CRM",
    linksFromDeal: true, reminder: "unread",
  },
  { subject: "Fake task: reminder test task", type: "task", days: 0, dueAt: "untimedShown", assignee: "Ada Fake", reminder: "unread" },
  {
    subject: "Fake meeting: reminder already seen", type: "meeting", days: -1, time: "14:00", minutes: 30, assignee: "Ada Fake",
    organisation: "Fakeco Ltd", reminder: "read",
  },
];

const FIVE_MINUTES = 5 * 60 * 1000;

// The UK day and time of a seed's due moment.
function dueOf(s: Seed, now: Date, today: string): { dueOn: string; dueTime: string | null } {
  if (s.dueAt === "soon") {
    const at = new Date(Math.ceil((now.getTime() + FIVE_MINUTES) / FIVE_MINUTES) * FIVE_MINUTES);
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(at).map((x) => [x.type, x.value]),
    );
    return { dueOn: ukToday(at), dueTime: `${p.hour}:${p.minute}` };
  }
  if (s.dueAt === "untimedShown") {
    return { dueOn: now.getTime() >= reminderAt({ dueOn: today, dueTime: null }).getTime() ? today : dayFrom(today, -1), dueTime: null };
  }
  return { dueOn: dayFrom(today, s.days), dueTime: s.time ?? null };
}

const DAY = 24 * 60 * 60 * 1000;

function dayFrom(today: string, n: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function seedActivities(sql: Sql): Promise<string[]> {
  const users = new Map((await sql<{ id: number; name: string }[]>`select id::int as id, name from users`).map((u) => [u.name, u.id]));
  if (!["Ada Fake", "Grace Fake", "Linus Fake", "Margaret Fake"].every((n) => users.has(n))) return ["already there activities (no fake users)"];
  const now = new Date();
  const today = ukToday(now);
  let added = 0;
  for (const s of SEEDS) {
    const done = await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const [there] = await db`select 1 from activities where subject = ${s.subject}`;
      if (there) return false;
      let dealId: number | null = null;
      let personId: number | null = null;
      let organisationId: number | null = null;
      if (s.deal) {
        const [d] = await db<{ id: number; person_id: number | null; organisation_id: number | null }[]>`
          select id::int as id, person_id::int as person_id, organisation_id::int as organisation_id from deals where title = ${s.deal} order by id limit 1`;
        if (!d) return false;
        dealId = d.id;
        if (s.linksFromDeal) [personId, organisationId] = [d.person_id, d.organisation_id];
      }
      if (s.person) {
        const [p] = await db<{ id: number }[]>`select id::int as id from persons where first_name = ${s.person[0]} and last_name = ${s.person[1]} order by id limit 1`;
        if (!p) return false;
        personId = p.id;
      }
      if (s.organisation) {
        const [o] = await db<{ id: number }[]>`select id::int as id from organisations where name = ${s.organisation} order by id limit 1`;
        if (!o) return false;
        organisationId = o.id;
      }
      const assignee = users.get(s.assignee)!;
      const by = users.get(s.by ?? s.assignee)!;
      const due = dueOf(s, now, today);
      const dueOn = due.dueOn;
      const doneAt = s.doneDaysAgo === undefined ? null : new Date(now.getTime() - s.doneDaysAgo * DAY);
      const assignedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const remindAt = doneAt ? null : s.reminder ? reminderAt(due) : reminderFor(due, now);
      const reminderReadAt = remindAt && s.reminder === "read" ? new Date(remindAt.getTime() + 60 * 60 * 1000) : null;
      await db`
        insert into activities (type, subject, due_on, due_time, duration_minutes, note, deal_id, person_id, organisation_id, assignee_id,
                                done_at, done_by, created_by, created_at, assigned_by, assigned_at, assignment_read_at, remind_at, reminder_read_at)
        values (${s.type}, ${s.subject}, ${dueOn}, ${due.dueTime}, ${s.minutes ?? null}, ${s.note ?? null}, ${dealId}, ${personId},
                ${organisationId}, ${assignee}, ${doneAt}, ${doneAt ? assignee : null}, ${by}, ${assignedAt}, ${by}, ${assignedAt},
                ${s.read ? new Date(assignedAt.getTime() + 60 * 60 * 1000) : null}, ${remindAt}, ${reminderReadAt})`;
      // A done call or meeting raises its person's "Last contacted", as ticking it would (research.md §8).
      if (doneAt && s.type !== "task" && personId !== null) {
        const dueInstant = ukInstant(dueOn, due.dueTime);
        const at = dueInstant.getTime() < doneAt.getTime() ? dueInstant : doneAt;
        await db`update persons set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'::timestamptz), ${at}::timestamptz) where id = ${personId}`;
      }
      return true;
    });
    if (done) added++;
  }
  return [added === 0 ? "already there activities" : `added ${added} fake activities`];
}
