// covers SF-114 SC-003: an ambassador page with 200 referred records and 1,000 timeline entries reads its first screen
// (page data and latest updates) in under 2 s
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getAmbassadorPage, readAmbassadorUpdates } from "@/server/records/ambassadors";
import { makeAmbassador } from "./ambassador-helpers";
import { makePerson, makeUser, resetDb } from "./db-helpers";
import { makePipeline } from "./deal-helpers";

let viewer: number, cara: number;

beforeAll(async () => {
  await resetDb();
  const ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  viewer = (await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" })).id;
  const stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id });
  // Noise: other people and their entries.
  for (let i = 0; i < 20; i++) {
    const p = await makePerson({ firstName: `Noise${i}`, createdBy: ada.id });
    await sql`insert into timeline_events (person_id, kind, actor_id, body) select ${p}, 'note', ${ada.id}, 'noise ' || g from generate_series(1, 100) g`;
  }
  await sql`
    insert into persons (first_name, last_name, created_by, owner_id, referred_by_id, referred_at, private)
    select 'Ref', 'Fake ' || g, ${ada.id}, ${ada.id}, ${cara}, now(), g % 10 = 0 from generate_series(1, 100) g`;
  await sql`
    insert into deals (title, stage_id, owner_id, created_by, referred_by_id, referred_at, value_pence, private)
    select 'Deal ' || g, ${stage}, ${ada.id}, ${ada.id}, ${cara}, now(), g * 100, g % 10 = 0 from generate_series(1, 100) g`;
  await sql`
    insert into timeline_events (person_id, kind, actor_id, body, created_at)
    select p.id, 'note', ${ada.id}, 'person ' || g, now() - g * interval '1 minute'
    from persons p, generate_series(1, 4) g where p.referred_by_id = ${cara}`;
  await sql`
    insert into timeline_events (deal_id, kind, actor_id, body, created_at)
    select d.id, 'note', ${ada.id}, 'deal ' || g, now() - g * interval '1 minute'
    from deals d, generate_series(1, 5) g where d.referred_by_id = ${cara}`;
  await sql`insert into timeline_events (person_id, kind, actor_id, body) select ${cara}, 'note', ${ada.id}, 'own ' || g from generate_series(1, 100) g`;
  await sql`analyze persons`;
  await sql`analyze deals`;
  await sql`analyze timeline_events`;
});
afterAll(closeDb);

describe("ambassador page performance", () => {
  it("reads the page and the first 20 updates in under 2 s", async () => {
    const start = performance.now();
    const [page, updates] = await Promise.all([getAmbassadorPage(viewer, cara, { people: 50, deals: 50 }), readAmbassadorUpdates(viewer, cara, 20)]);
    const ms = performance.now() - start;
    expect(page!.summary.people).toBe(90);
    expect(page!.summary.deals).toBe(90);
    expect(page!.people.rows).toHaveLength(50);
    expect(updates.entries).toHaveLength(20);
    expect(updates.more).toBe(true);
    expect(ms).toBeLessThan(2000);
  });
});
