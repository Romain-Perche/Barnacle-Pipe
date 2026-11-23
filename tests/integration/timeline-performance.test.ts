// covers SF-102 SC-003: a timeline with 1,000 entries (own and from deals) shows its first page in under 2 s
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { readTimeline } from "@/server/records/timeline";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb } from "./db-helpers";

let viewer: number, person: number, org: number;

beforeAll(async () => {
  await resetDb();
  const ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  const bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  viewer = bob.id;
  const stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  org = await makeOrganisation({ name: "Perf Fake Ltd", ownerId: ada.id });
  person = await makePerson({ firstName: "Perf", lastName: "Fake", createdBy: ada.id, organisationId: org });
  // Noise: other records with their own entries.
  for (let i = 0; i < 30; i++) {
    const p = await makePerson({ firstName: `Noise${i}`, createdBy: ada.id });
    await sql`insert into timeline_events (person_id, kind, actor_id, body) select ${p}, 'note', ${ada.id}, 'noise ' || g from generate_series(1, 100) g`;
  }
  await sql`insert into timeline_events (person_id, kind, actor_id, body, created_at)
            select ${person}, 'note', ${ada.id}, 'own ' || g, now() - g * interval '1 minute' from generate_series(1, 400) g`;
  await sql`insert into timeline_events (organisation_id, kind, actor_id, body, created_at)
            select ${org}, 'note', ${ada.id}, 'org ' || g, now() - g * interval '1 minute' from generate_series(1, 400) g`;
  for (let d = 0; d < 3; d++) {
    const deal = await makeDeal({ title: `Perf deal ${d}`, stageId: stage, createdBy: ada.id, personId: person, organisationId: org });
    await sql`insert into timeline_events (deal_id, kind, actor_id, body, created_at)
              select ${deal}, 'note', ${ada.id}, 'deal ' || g, now() - g * interval '1 minute' from generate_series(1, 200) g`;
  }
  await sql`analyze timeline_events`;
});
afterAll(closeDb);

describe("timeline performance", () => {
  it("reads the first 50 of 1,000 entries in under 2 s, for the person and the organisation", async () => {
    for (const target of [{ personId: person }, { organisationId: org }]) {
      const start = performance.now();
      const page = await readTimeline(viewer, target, 50);
      const ms = performance.now() - start;
      expect(page.entries).toHaveLength(50);
      expect(page.more).toBe(true);
      expect(ms).toBeLessThan(2000);
    }
  });
});
