// covers SF-120 SC-004: the Segments page's data (listSegments) for 50 segments over 10,000 people and 5,000 deals in
// under 2 seconds.
import { afterAll, beforeAll, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { listSegments } from "@/server/segments/segments";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeField } from "./custom-helpers";
import { makePipeline } from "./deal-helpers";

let ada: TestUser;

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai" });
  const grace = await makeUser({ email: "grace@barnacle.ai" });
  const pipelines = [await makePipeline("Sales", ["A", "B", "C", "D"]), await makePipeline("Exec Dinner", ["A", "B", "C", "D"])];
  const stages = pipelines.flatMap((p) => p.stages);
  const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["Vegan", "None"] });
  await sql`
    insert into persons (first_name, last_name, created_by, owner_id, private, archived_at, consent, lead_source_id, role)
    select 'P', 'N' || g, ${ada.id}, case when g % 7 = 0 then ${grace.id}::bigint else ${ada.id}::bigint end, g % 50 = 0,
           case when g % 40 = 0 then now() end, case when g % 13 = 0 then 'unsubscribed' else 'subscribed' end,
           (select id from lead_sources order by id limit 1 offset (g % 6)), case when g % 3 = 0 then 'Director' end
    from generate_series(1, 10000) g`;
  await sql`insert into person_emails (person_id, email, position) select id, 'p' || id || '@example.com', 0 from persons where id % 17 <> 0`;
  await sql`insert into custom_values (field_id, person_id, choice_id) select ${diet.id}, id, ${diet.choices.Vegan} from persons where id % 4 = 0`;
  await sql`
    insert into deals (title, stage_id, stage_entered_at, person_id, owner_id, created_by, private, archived_at, status, closed_at, lost_reason)
    select 'D' || g, (${stages}::bigint[])[1 + g % 8], now(), 1 + (g * 7919) % 10000, ${ada.id}, ${ada.id}, g % 30 = 0,
           case when g % 25 = 0 then now() end,
           (array['open', 'open', 'won', 'lost'])[1 + g % 4],
           case when g % 4 >= 2 then now() end, case when g % 4 = 3 then 'Too dear' end
    from generate_series(1, 5000) g`;
  await sql`insert into deal_people (deal_id, person_id) select id, 1 + (id * 104729) % 10000 from deals where id % 2 = 0 on conflict do nothing`;
  const statuses = ["open", "won", "lost", "all"];
  for (let i = 0; i < 50; i++) {
    const kind = i % 3;
    const p = pipelines[i % 2];
    const conditions = i % 5 === 0 ? [{ field: "custom", fieldId: diet.id, type: "single_choice", ids: [diet.choices.Vegan], empty: i % 10 === 0 }]
      : i % 5 === 1 ? [{ field: "role", text: "direct" }] : [];
    await sql`
      insert into segments (name, who, pipeline_id, stage_id, deal_status, conditions, created_by, updated_by)
      values (${`Segment ${i}`}, ${["everyone", "pipeline", "stage"][kind]}, ${kind === 0 ? null : p.id}, ${kind === 2 ? p.stages[i % 4] : null},
              ${kind === 0 ? null : statuses[i % 4]}, ${sql.json(conditions)}, ${ada.id}, ${ada.id})`;
  }
  await sql`analyze`;
}, 120_000);
afterAll(closeDb);

it("lists 50 segments with their counts in under 2 seconds", async () => {
  await listSegments(ada.id); // warm the connection and the plans' first run
  const start = performance.now();
  const rows = await listSegments(ada.id);
  const ms = performance.now() - start;
  expect(rows.length).toBe(50);
  expect(rows.some((r) => r.reaches > 1000)).toBe(true);
  expect(ms).toBeLessThan(2000);
});
