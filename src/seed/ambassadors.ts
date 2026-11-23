// Fake ambassadors and referrals (SF-114 data-model.md § Fake data, FR-017). Clearly fake names, example.com addresses,
// owned by the fake users: a shared ambassador (Cara Example) with three referred people and four referred deals (open,
// won, lost, and a private open one of Linus Fake), a private ambassador (Dora Privatefake, Linus Fake's) who referred a
// shared person, a former ambassador (Ezra Formerfake) with two referred people, and two notes on referred records.
// Idempotent: people are found by email, deals by title, notes by record and body; events only when the row is created.
import type { Sql } from "@/server/db";

type Who = {
  key: string;
  first: string;
  last: string;
  email: string;
  creator: string;
  owner?: string;
  ambassador?: "yes" | "former";
  private?: boolean;
  role?: string;
  organisation?: string;
  referredBy?: string;
};

const PEOPLE: Who[] = [
  { key: "cara", first: "Cara", last: "Example", email: "cara.ambassador@example.com", creator: "Ada Fake", ambassador: "yes", role: "Partnerships lead", organisation: "Sample Studios Fake" },
  { key: "dora", first: "Dora", last: "Privatefake", email: "dora.ambassador@example.com", creator: "Linus Fake", ambassador: "yes", private: true },
  { key: "ezra", first: "Ezra", last: "Formerfake", email: "ezra.formerambassador@example.com", creator: "Grace Fake", ambassador: "former" },
  { key: "ben", first: "Ben", last: "Referredfake", email: "ben.referredfake@example.com", creator: "Ada Fake", referredBy: "cara" },
  { key: "dee", first: "Dee", last: "Referredfake", email: "dee.referredfake@example.com", creator: "Margaret Fake", referredBy: "cara" },
  { key: "eli", first: "Eli", last: "Referredfake", email: "eli.referredfake@example.com", creator: "Ada Fake", owner: "Linus Fake", referredBy: "cara" },
  { key: "fay", first: "Fay", last: "Referredfake", email: "fay.referredfake@example.com", creator: "Grace Fake", referredBy: "ezra" },
  { key: "gus", first: "Gus", last: "Referredfake", email: "gus.referredfake@example.com", creator: "Grace Fake", referredBy: "ezra" },
  { key: "hal", first: "Hal", last: "Referredfake", email: "hal.referredfake@example.com", creator: "Linus Fake", referredBy: "dora" },
];

type DealSeed = { title: string; pence: number; status: "open" | "won" | "lost"; stage: string; creator: string; person?: string; private?: boolean; reason?: string };
const DEALS: DealSeed[] = [
  { title: "Fake referral · website", pence: 450000, status: "open", stage: "Proposal", creator: "Ada Fake", person: "ben" },
  { title: "Fake referral · pilot", pence: 400000, status: "won", stage: "Negotiation", creator: "Ada Fake", person: "dee" },
  { title: "Fake referral · app", pence: 150000, status: "lost", stage: "Qualified", creator: "Margaret Fake", reason: "Fake: chose another supplier" },
  { title: "Fake referral · audit", pence: 200000, status: "open", stage: "Lead in", creator: "Linus Fake", private: true },
];

const NOTES = [
  { deal: "Fake referral · website", text: "Fake note: Cara Example says they will decide after Christmas." },
  { person: "dee", text: "Fake note: Dee Referredfake met Cara Example at a fake conference." },
];

const DAY = 86_400_000;

export async function seedAmbassadors(sql: Sql): Promise<string[]> {
  const users = new Map((await sql<{ id: number; name: string }[]>`select id::int as id, name from users`).map((u) => [u.name, u.id]));
  if (!["Ada Fake", "Grace Fake", "Linus Fake", "Margaret Fake"].every((n) => users.has(n))) return ["already there ambassadors (no fake users)"];
  const user = (name: string) => users.get(name)!;
  let people = 0;
  let deals = 0;
  let notes = 0;

  await sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const ids = new Map<string, number>();
    for (const [i, p] of PEOPLE.entries()) {
      const [found] = await db<{ id: number }[]>`select person_id::int as id from person_emails where email = ${p.email}`;
      if (found) {
        ids.set(p.key, found.id);
        continue;
      }
      const [org] = p.organisation ? await db<{ id: number }[]>`select id::int as id from organisations where name = ${p.organisation}` : [];
      const creator = user(p.creator);
      const referrer = p.referredBy ? (ids.get(p.referredBy) ?? null) : null;
      const at = new Date(Date.now() - (20 - i) * DAY);
      const [row] = await db<{ id: number }[]>`
        insert into persons (first_name, last_name, created_by, owner_id, organisation_id, role, private, is_ambassador,
                             referred_by_id, referred_at, created_at)
        values (${p.first}, ${p.last}, ${creator}, ${user(p.owner ?? p.creator)}, ${org?.id ?? null}, ${p.role ?? null},
                ${p.private ?? false}, ${p.ambassador === "yes"}, ${referrer}, ${referrer === null ? null : at}, ${at})
        returning id::int as id`;
      await db`insert into person_emails (person_id, email, kind, position) values (${row.id}, ${p.email}, 'work', 0)`;
      await db`insert into timeline_events (person_id, kind, actor_id, created_at) values (${row.id}, 'added', ${creator}, ${at})`;
      if (p.ambassador) await db`insert into timeline_events (person_id, kind, actor_id, created_at) values (${row.id}, 'ambassador_added', ${creator}, ${at})`;
      if (p.ambassador === "former") {
        await db`insert into timeline_events (person_id, kind, actor_id, created_at) values (${row.id}, 'ambassador_removed', ${creator}, ${new Date(Date.now() - 2 * DAY)})`;
      }
      if (referrer !== null) {
        await db`insert into timeline_events (person_id, kind, actor_id, related_person_id, created_at) values (${row.id}, 'referrer_set', ${creator}, ${referrer}, ${at})`;
      }
      ids.set(p.key, row.id);
      people++;
    }

    const cara = ids.get("cara")!;
    for (const [i, d] of DEALS.entries()) {
      const taken = await db`select 1 from deals where title = ${d.title}`;
      if (taken.length > 0) continue;
      const [stage] = await db<{ id: number; name: string }[]>`
        select s.id::int as id, s.name from stages s join pipelines p on p.id = s.pipeline_id where p.name = 'Sales' and s.name = ${d.stage}`;
      if (!stage) continue;
      const creator = user(d.creator);
      const at = new Date(Date.now() - (10 - i) * DAY);
      const closed = d.status === "open" ? null : new Date(at.getTime() + 3 * DAY);
      const person = d.person ? (ids.get(d.person) ?? null) : null;
      const [row] = await db<{ id: number }[]>`
        insert into deals (title, value_pence, stage_id, stage_entered_at, person_id, owner_id, private, created_by, created_at,
                           status, closed_at, lost_reason, referred_by_id, referred_at)
        values (${d.title}, ${d.pence}, ${stage.id}, ${at}, ${person}, ${creator}, ${d.private ?? false}, ${creator}, ${at},
                ${d.status}, ${closed}, ${d.reason ?? null}, ${cara}, ${at})
        returning id::int as id`;
      await db`
        insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, entered_at, left_at)
        values (${row.id}, ${stage.id}, ${stage.name}, 'Sales', ${at}, ${closed})`;
      await db`insert into timeline_events (deal_id, kind, actor_id, created_at) values (${row.id}, 'added', ${creator}, ${at})`;
      await db`insert into timeline_events (deal_id, kind, actor_id, related_person_id, created_at) values (${row.id}, 'referrer_set', ${creator}, ${cara}, ${at})`;
      if (closed) {
        await db`insert into timeline_events (deal_id, kind, actor_id, reason, created_at) values (${row.id}, ${d.status}, ${creator}, ${d.reason ?? null}, ${closed})`;
      }
      deals++;
    }

    const ada = user("Ada Fake");
    for (const [i, n] of NOTES.entries()) {
      const [deal] = n.deal ? await db<{ id: number }[]>`select id::int as id from deals where title = ${n.deal} order by id limit 1` : [];
      const personId = n.person ? (ids.get(n.person) ?? null) : null;
      const dealId = deal?.id ?? null;
      if (personId === null && dealId === null) continue;
      const [there] = await db`
        select 1 from timeline_events where kind = 'note' and body = ${n.text}
          and person_id is not distinct from ${personId} and deal_id is not distinct from ${dealId}`;
      if (there) continue;
      await db`
        insert into timeline_events (person_id, deal_id, kind, actor_id, body, created_at)
        values (${personId}, ${dealId}, 'note', ${ada}, ${n.text}, ${new Date(Date.now() - (i + 1) * 2 * 3_600_000)})`;
      notes++;
    }
  });
  return [people + deals + notes === 0 ? "already there ambassadors" : `added ${people} fake ambassador people, ${deals} referred deals, ${notes} notes`];
}
