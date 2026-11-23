// Fake notes and mentions (SF-102 data-model.md § Fake data, FR-018). Clearly fake text, written by the fake users on
// records of src/seed/people.ts and src/seed/deals.ts: notes on deals, people and an organisation, two with mentions
// (one notification read, one unread), one edited by another user, one on a private deal and one on a private person.
// Idempotent: a note is found by its record and its exact body; nothing is added when it is there.
import type { Sql } from "@/server/db";

type Record = { dealId: number } | { personId: number } | { organisationId: number };
type Seed = {
  on: Record | null;
  author: string;
  // Mentions are written "@{Name}" here and stored as "@[user:<id>]" tokens.
  text: string;
  hoursAgo: number;
  editedBy?: string;
  read?: boolean;
};

const HOUR = 60 * 60 * 1000;

async function one(sql: Sql, query: Promise<{ id: number }[]>): Promise<number | null> {
  const [row] = await query;
  return row ? row.id : null;
}

export async function seedNotes(sql: Sql): Promise<string[]> {
  const users = new Map((await sql<{ id: number; name: string }[]>`select id::int as id, name from users`).map((u) => [u.name, u.id]));
  if (!["Ada Fake", "Grace Fake", "Linus Fake", "Margaret Fake"].every((n) => users.has(n))) return ["already there notes (no fake users)"];
  const deal = (title: string) => one(sql, sql<{ id: number }[]>`select id::int as id from deals where title = ${title} order by id limit 1`);
  const asDeal = (id: number | null): Record | null => (id === null ? null : { dealId: id });
  const asPerson = (id: number | null): Record | null => (id === null ? null : { personId: id });
  const shared = await sql<{ id: number }[]>`
    select id::int as id from persons where not private and archived_at is null order by id limit 2`;
  const pat = await one(sql, sql<{ id: number }[]>`select id::int as id from persons where first_name = 'Pat' and last_name = 'Privatefake'`);
  const fakeco = await one(sql, sql<{ id: number }[]>`select id::int as id from organisations where name = 'Fakeco Ltd'`);

  const seeds: Seed[] = [
    {
      on: asDeal(await deal("Fakeco website")),
      author: "Ada Fake",
      text: "Fake call notes: budget confirmed at £4,000.\n@{Linus Fake} can you send the fake pricing sheet?",
      hoursAgo: 3,
    },
    {
      on: asDeal(await deal("Fakeco AI pilot")),
      author: "Linus Fake",
      text: "Fake demo went well; next step a fake pilot plan by Friday.",
      hoursAgo: 30,
      editedBy: "Grace Fake",
    },
    {
      on: asPerson(shared[0]?.id ?? null),
      author: "Grace Fake",
      text: "Spoke to them about the fake renewal. @{Ada Fake} please follow up.",
      hoursAgo: 50,
      read: true,
    },
    { on: asPerson(shared[1]?.id ?? null), author: "Margaret Fake", text: "Prefers email to calls (fake note).\nAvailable on Tuesdays.", hoursAgo: 75 },
    { on: fakeco === null ? null : { organisationId: fakeco }, author: "Ada Fake", text: "Fakeco Ltd is a fake organisation for testing notes.", hoursAgo: 100 },
    { on: asDeal(await deal("Fake secret project")), author: "Ada Fake", text: "Fake secret: only the creator and owner can read this note.", hoursAgo: 5 },
    { on: asPerson(pat), author: "Ada Fake", text: "Private fake note about Pat Privatefake.", hoursAgo: 8 },
  ];

  let added = 0;
  for (const s of seeds) {
    if (!s.on) continue;
    const mentioned: number[] = [];
    const body = s.text.replace(/@\{([^}]+)\}/g, (_m, name: string) => {
      const id = users.get(name);
      if (id === undefined) return `@${name}`;
      mentioned.push(id);
      return `@[user:${id}]`;
    });
    const personId = "personId" in s.on ? s.on.personId : null;
    const organisationId = "organisationId" in s.on ? s.on.organisationId : null;
    const dealId = "dealId" in s.on ? s.on.dealId : null;
    const author = users.get(s.author)!;
    const editor = s.editedBy ? users.get(s.editedBy)! : null;
    const done = await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const [there] = await db`
        select 1 from timeline_events
        where kind = 'note' and body = ${body} and person_id is not distinct from ${personId}
          and organisation_id is not distinct from ${organisationId} and deal_id is not distinct from ${dealId}`;
      if (there) return false;
      const at = new Date(Date.now() - s.hoursAgo * HOUR);
      const [row] = await db<{ id: number }[]>`
        insert into timeline_events (person_id, organisation_id, deal_id, kind, actor_id, body, created_at, edited_by, edited_at, version)
        values (${personId}, ${organisationId}, ${dealId}, 'note', ${author}, ${body}, ${at}, ${editor},
                ${editor === null ? null : new Date(at.getTime() + HOUR)}, ${editor === null ? 1 : 2})
        returning id::int as id`;
      for (const id of mentioned) {
        await db`
          insert into note_mentions (event_id, user_id, mentioned_by, created_at, read_at)
          values (${row.id}, ${id}, ${author}, ${at}, ${s.read ? new Date(at.getTime() + HOUR) : null})`;
      }
      return true;
    });
    if (done) added++;
  }
  return [added === 0 ? "already there notes" : `added ${added} fake notes`];
}
