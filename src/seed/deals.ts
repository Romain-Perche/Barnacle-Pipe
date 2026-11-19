// Fake pipelines and deals (SF-93 data-model.md § Fake data, FR-021). Clearly fake titles, owners are the fake
// users, people and organisations come from src/seed/people.ts. Idempotent: pipelines by name (stages only for a
// pipeline just added), deals skipped when a deal with the same title is already there.
import type { Sql } from "@/server/db";

const PIPELINES: { name: string; stages: string[] }[] = [
  { name: "Sales", stages: ["Lead in", "Qualified", "Proposal", "Negotiation", "Closing"] },
  { name: "Ambassadors", stages: ["Introduced", "Talking", "Active"] },
  { name: "Fractional CTO", stages: ["Lead in", "Scoping", "Proposal", "Signed"] },
  { name: "Exec Dinner", stages: ["Invited", "Confirmed", "Attended", "Follow up"] },
  { name: "Ada Fake's pipeline", stages: ["To contact", "Contacted", "Meeting", "Proposal"] },
];

const TITLES = [
  "Fakeco website", "Sample Gyms CRM", "Intro call", "Demo Studios rebuild", "Mock Labs audit", "Placeholder app refresh",
  "Testfield Health portal", "Dummy Leisure booking app", "Mockup Capital data room", "Lorem Logistics tracking", "Fakeco AI pilot",
  "Sample Studios chatbot", "Example Gyms loyalty app", "Fake retainer renewal", "Placeholder Partners intro", "Mock pricing workshop",
  "Testfield Health discovery", "Dummy Leisure analytics", "Fakeco support contract", "Example Gyms phase 2",
  "Sample ambassador intro", "Fake referral (Leeds)", "Mock ambassador lunch", "Placeholder podcast guest", "Lorem ambassador event",
  "Fake CTO for Fakeco", "Sample CTO advisory", "Mock CTO 3 months", "Dummy CTO review", "Placeholder CTO scoping",
  "Fake dinner guest (London)", "Sample dinner guest (Bristol)", "Mock dinner sponsor", "Dummy dinner speaker", "Lorem dinner follow-up",
  "Ada's fake prospect 1", "Ada's fake prospect 2", "Ada's fake prospect 3", "Ada's fake prospect 4", "Mockup Capital intro",
  "Fakeco training day", "Sample Gyms hardware", "Old fake opportunity", "Fake secret project",
];
const OWNERS = ["Ada Fake", "Grace Fake", "Linus Fake", "Margaret Fake"];
// Pipeline (index into PIPELINES) of each title, in blocks: Sales, Ambassadors, Fractional CTO, Exec Dinner, Ada's.
const PIPELINE_OF = (i: number) => (i < 20 ? 0 : i < 25 ? 1 : i < 30 ? 2 : i < 35 ? 3 : i < 40 ? 4 : 0);
const DAY = 24 * 60 * 60 * 1000;

export async function seedDeals(sql: Sql): Promise<string[]> {
  const users = new Map((await sql<{ id: number; name: string }[]>`select id::int as id, name from users`).map((u) => [u.name, u.id]));
  if (OWNERS.some((name) => !users.has(name))) return ["already there pipelines and deals (no fake users)"];
  const now = Date.now();
  let pipelinesAdded = 0;
  let dealsAdded = 0;

  await sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    for (const p of PIPELINES) {
      const [row] = await db<{ id: number }[]>`
        insert into pipelines (name, position) values (${p.name}, (select coalesce(max(position), 0) + 1 from pipelines))
        on conflict ((lower(name))) do nothing returning id::int as id`;
      if (!row) continue;
      pipelinesAdded++;
      for (const [i, s] of p.stages.entries()) await db`insert into stages (pipeline_id, name, position) values (${row.id}, ${s}, ${i + 1})`;
    }

    const stages = await db<{ id: number; name: string; pipeline: string; position: number }[]>`
      select s.id::int as id, s.name, p.name as pipeline, s.position from stages s join pipelines p on p.id = s.pipeline_id
      order by p.position, s.position`;
    const people = await db<{ id: number; organisation_id: number | null }[]>`
      select id::int as id, organisation_id::int as organisation_id from persons order by id`;
    const orgs = await db<{ id: number }[]>`select id::int as id from organisations where archived_at is null order by id`;

    for (const [i, title] of TITLES.entries()) {
      const taken = await db`select 1 from deals where title = ${title}`;
      if (taken.length > 0) continue;
      const pipeline = PIPELINES[PIPELINE_OF(i)];
      // Sales "Closing" stays empty: Sales deals use its first four stages only.
      const usable = stages.filter((s) => s.pipeline === pipeline.name && !(pipeline.name === "Sales" && s.name === "Closing"));
      if (usable.length === 0) continue; // the pipeline was there before, without these stages
      const stage = usable[i % usable.length];
      const ownerName = pipeline.name === "Ada Fake's pipeline" ? "Ada Fake" : OWNERS[i % OWNERS.length];
      const owner = users.get(ownerName)!;
      const isPrivate = title === "Fake secret project" || title === "Ada's fake prospect 2";
      const creator = isPrivate ? users.get("Ada Fake")! : owner;
      const person = i % 3 === 2 || people.length === 0 ? null : people[(i * 7) % people.length];
      const organisationId = i % 5 === 4 || orgs.length === 0 ? null : (person?.organisation_id ?? orgs[i % orgs.length].id);
      const value = i % 6 === 5 ? null : ((i * 3700) % 25000) * 100 + 100000;
      const added = new Date(now - (60 - i) * DAY);
      // Every third deal (not in a first stage) was moved there from the stage before.
      const previous = i % 3 === 0 && stage.position > 1 ? usable.find((s) => s.position === stage.position - 1) : undefined;
      const entered = previous ? new Date(added.getTime() + 5 * DAY) : added;
      const [deal] = await db<{ id: number }[]>`
        insert into deals (title, value_pence, stage_id, stage_entered_at, organisation_id, person_id, owner_id, expected_close_on,
                           private, created_by, created_at, archived_at)
        values (${title}, ${value}, ${stage.id}, ${entered}, ${organisationId}, ${person?.id ?? null}, ${owner},
                ${i % 4 === 1 ? new Date(now + (20 + i) * DAY).toISOString().slice(0, 10) : null}, ${isPrivate}, ${creator},
                ${added}, ${title === "Old fake opportunity" ? new Date(now - DAY) : null})
        returning id::int as id`;
      await db`insert into timeline_events (deal_id, kind, actor_id, created_at) values (${deal.id}, 'added', null, ${added})`;
      if (previous) {
        await db`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, entered_at, left_at)
                 values (${deal.id}, ${previous.id}, ${previous.name}, ${pipeline.name}, ${added}, ${entered})`;
        await db`insert into timeline_events (deal_id, kind, actor_id, from_stage, to_stage, created_at)
                 values (${deal.id}, 'moved', ${owner}, ${previous.name}, ${stage.name}, ${entered})`;
      }
      await db`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, entered_at)
               values (${deal.id}, ${stage.id}, ${stage.name}, ${pipeline.name}, ${entered})`;
      if (title === "Old fake opportunity") {
        await db`insert into timeline_events (deal_id, kind, actor_id, created_at) values (${deal.id}, 'archived', ${owner}, ${new Date(now - DAY)})`;
      }
      dealsAdded++;
    }
  });

  if (pipelinesAdded === 0 && dealsAdded === 0) return ["already there pipelines and deals"];
  return [`added ${pipelinesAdded} fake pipelines and ${dealsAdded} fake deals`];
}
