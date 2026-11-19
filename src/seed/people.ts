// Fake people and organisations (data-model.md § Fake data, FR-027, SC-007). Clearly fake names,
// example.com / example.net addresses, owners are the fake users. Idempotent: organisations and labels by
// name, people skipped when their first email address is already there.
import type { Sql } from "@/server/db";

const ORGANISATIONS = [
  { name: "Fakeco Ltd", website: "https://fakeco.example", sector: "Fitness", size: "201–1,000", location: "London", owner: "Ada Fake" },
  { name: "Example Gyms Fake", website: "https://examplegyms.example", sector: "Fitness", size: "1,000+", location: "Manchester", owner: "Grace Fake" },
  { name: "Sample Studios Fake", website: "https://samplestudios.example", sector: "Media", size: "11–50", location: "Bristol", owner: "Linus Fake" },
  { name: "Placeholder Partners Fake", website: null, sector: "Consulting", size: "1–10", location: "Leeds", owner: "Margaret Fake" },
  { name: "Testfield Health Fake", website: "https://testfield.example", sector: "Health", size: "51–200", location: "Glasgow", owner: "Ada Fake" },
  { name: "Dummy Leisure Fake", website: null, sector: "Fitness", size: "51–200", location: "Cardiff", owner: "Linus Fake" },
  { name: "Mockup Capital Fake", website: "https://mockupcapital.example", sector: "Finance", size: "11–50", location: "London", owner: "Grace Fake" },
  { name: "Lorem Logistics Fake", website: null, sector: "Logistics", size: "201–1,000", location: "Birmingham", owner: "Margaret Fake" },
  { name: "Old Fakeco Archive", website: null, sector: "Fitness", size: "1–10", location: "Leeds", owner: "Ada Fake", archived: true },
];
const LABELS = ["Hot", "Investor", "Partner"];
const SOURCES = ["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Event", "Ambassador", null];
const OWNERS = ["Ada Fake", "Grace Fake", "Linus Fake", "Margaret Fake"];
const FIRST = ["Abe", "Bob", "Cleo", "Dev", "Eve", "Finn", "Gail", "Hugo", "Iris", "Jack", "Kara", "Leo", "Mia", "Ned", "Ola", "Pip",
  "Quin", "Rae", "Sam", "Tess", "Uma", "Vic", "Wren", "Xan", "Yara", "Zed", "Bea", "Cal", "Dot", "Eli", "Fay", "Gus"];
const LAST = ["Example", "Placeholder", "Testperson", "Sample", "Dummy", "Fakename", "Mockup", "Lorem"];
const ROLES = ["COO", "CEO", "Head of Ops", "Site Manager", "CFO", null, "Marketing Lead", "CTO"];
const DAY = 24 * 60 * 60 * 1000;
// SF-92: private people seen by an owner who is not their creator, and private people left with deactivated
// Alan Fake for the Users page hand-over.
const PRIVATE_PEOPLE = [
  { first: "Pat", last: "Privatefake", email: "pat.privatefake@example.com", creator: "Ada Fake", owner: "Linus Fake", org: null },
  { first: "Robin", last: "Leftfake", email: "robin.leftfake@example.com", creator: "Alan Fake", owner: "Alan Fake", org: "Fakeco Ltd" },
  { first: "Sam", last: "Leftfake", email: "sam.leftfake@example.net", creator: "Alan Fake", owner: "Alan Fake", org: null },
];

export async function seedPeople(sql: Sql): Promise<string[]> {
  const users = new Map((await sql<{ id: number; name: string }[]>`select id::int as id, name from users`).map((u) => [u.name, u.id]));
  if (OWNERS.some((name) => !users.has(name))) return ["already there people and organisations (no fake users)"];
  const now = Date.now();
  let orgsAdded = 0;
  let peopleAdded = 0;

  await sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    for (const o of ORGANISATIONS) {
      const owner = users.get(o.owner)!;
      const [row] = await db<{ id: number }[]>`
        insert into organisations (name, website, sector, size, location, owner_id, created_by, created_at, archived_at)
        values (${o.name}, ${o.website}, ${o.sector}, ${o.size}, ${o.location}, ${owner}, ${owner},
                ${new Date(now - 90 * DAY + orgsAdded * DAY)}, ${o.archived ? new Date(now - DAY) : null})
        on conflict ((lower(name))) do nothing returning id::int as id`;
      if (row) {
        orgsAdded++;
        await db`insert into timeline_events (organisation_id, kind, actor_id) values (${row.id}, 'added', null)`;
      }
    }
    for (const name of LABELS) await db`insert into labels (name) values (${name}) on conflict ((lower(name))) do nothing`;

    const orgIds = await db<{ id: number; name: string }[]>`select id::int as id, name from organisations`;
    const orgId = (name: string) => orgIds.find((o) => o.name === name)?.id ?? null;
    const labelIds = await db<{ id: number; name: string }[]>`select id::int as id, name from labels`;
    const labelId = (name: string) => labelIds.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id;
    const sourceIds = await db<{ id: number; name: string }[]>`select id::int as id, name from lead_sources`;
    const sourceId = (name: string | null) => (name ? (sourceIds.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id ?? null) : null);

    for (let i = 0; i < FIRST.length; i++) {
      const first = FIRST[i];
      const last = LAST[i % LAST.length];
      const email = `${first}.${last}@${i % 2 ? "example.net" : "example.com"}`.toLowerCase();
      const taken = await db`select 1 from person_emails where email = ${email}`;
      if (taken.length > 0) continue;
      const owner = users.get(OWNERS[i % OWNERS.length])!;
      const isPrivate = i === FIRST.length - 1;
      const creator = isPrivate ? users.get("Ada Fake")! : owner;
      const org = i % 10 === 9 ? null : orgId(ORGANISATIONS[i % 10].name);
      const labels = [["Hot"], ["Investor"], ["Partner", "Hot"], []][i % 4];
      const [row] = await db<{ id: number }[]>`
        insert into persons (first_name, last_name, organisation_id, role, lead_source_id, owner_id, consent, private, created_by,
                             created_at, last_contacted_at, archived_at, linkedin_url)
        values (${first}, ${last}, ${org}, ${ROLES[i % ROLES.length]}, ${sourceId(SOURCES[i % SOURCES.length])}, ${owner},
                ${i % 5 === 4 ? "unsubscribed" : "subscribed"}, ${isPrivate}, ${creator},
                ${new Date(now - (i * 3 + 1) * DAY)}, ${i % 3 === 0 ? null : new Date(now - i * DAY)},
                ${i === FIRST.length - 2 ? new Date(now - DAY) : null},
                ${i % 3 === 1 ? `https://linkedin.com/in/${first}-${last}-fake`.toLowerCase() : null})
        returning id::int as id`;
      await db`insert into person_emails (person_id, email, kind, position) values (${row.id}, ${email}, 'work', 0)`;
      if (i % 5 === 0) {
        await db`insert into person_emails (person_id, email, kind, position)
                 values (${row.id}, ${`${first}.home@example.net`.toLowerCase()}, 'personal', 1)`;
      }
      if (i % 2 === 0) {
        await db`insert into person_phones (person_id, phone, kind, position)
                 values (${row.id}, ${`+44 20 7946 ${String(i).padStart(4, "0")}`}, 'work', 0)`;
      }
      if (i % 6 === 0) {
        await db`insert into person_phones (person_id, phone, kind, position)
                 values (${row.id}, ${`07700 900${String(i).padStart(3, "0")}`}, 'personal', 1)`;
      }
      for (const name of labels) {
        const id = labelId(name);
        if (id) await db`insert into person_labels (person_id, label_id) values (${row.id}, ${id})`;
      }
      await db`insert into timeline_events (person_id, kind, actor_id, created_at) values (${row.id}, 'added', null, ${new Date(now - (i * 3 + 1) * DAY)})`;
      peopleAdded++;
    }

    for (const [i, p] of PRIVATE_PEOPLE.entries()) {
      const creator = users.get(p.creator);
      const owner = users.get(p.owner);
      if (!creator || !owner) continue;
      const taken = await db`select 1 from person_emails where email = ${p.email}`;
      if (taken.length > 0) continue;
      const org = p.org ? orgId(p.org) : null;
      const created = new Date(now - (40 + i) * DAY);
      const [row] = await db<{ id: number }[]>`
        insert into persons (first_name, last_name, organisation_id, owner_id, private, created_by, created_at)
        values (${p.first}, ${p.last}, ${org}, ${owner}, true, ${creator}, ${created})
        returning id::int as id`;
      await db`insert into person_emails (person_id, email, kind, position) values (${row.id}, ${p.email}, 'work', 0)`;
      await db`insert into timeline_events (person_id, kind, actor_id, created_at) values (${row.id}, 'added', null, ${created})`;
      if (org !== null) {
        await db`insert into timeline_events (organisation_id, kind, actor_id, related_person_id, created_at)
                 values (${org}, 'person_linked', null, ${row.id}, ${created})`;
      }
      peopleAdded++;
    }
  });

  if (orgsAdded === 0 && peopleAdded === 0) return ["already there people and organisations"];
  return [`added ${peopleAdded} fake people and ${orgsAdded} fake organisations`];
}
