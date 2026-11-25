// covers SF-122 US5 scenario 5, SC-001 (fix round 1): with Pipedrive slowing down every 3rd or 4th call, the import still
// ends, because a part keeps the answers it already got (pipedrive_imports.fetched) and the next part asks only what is
// missing: every deal is imported once with its followers and other linked people, and no follower or participant call
// is answered twice.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import type { FakePipedrive } from "@/server/pipedrive/fake-pipedrive";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makeUser, resetDb } from "./db-helpers";
import { COMPANY, connect, fakeCompany, importRow, LINUS_TOKEN, runToEnd, start } from "./pipedrive-helpers";

let linus: { id: number };
let fake: FakePipedrive;
let deals: number[];

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  fakeCompany(fake);
  const pipeline = fake.addPipeline(COMPANY, { name: "Sales" });
  const stage = fake.addStage(COMPANY, { pipeline_id: pipeline, name: "Lead" });
  const people = Array.from({ length: 21 }, (_, i) =>
    fake.addPerson(COMPANY, { first_name: `Slow${i}`, last_name: "Fake", owner_id: 1, emails: [{ value: `slow${i}@fake.example`, primary: true, label: "work" }] }),
  );
  deals = Array.from({ length: 20 }, (_, i) =>
    fake.addDeal(COMPANY, { title: `Slow deal ${i} fake`, owner_id: 1, stage_id: stage, person_id: people[i] }, { followers: [1, 2], participants: [people[i], people[i + 1]] }),
  );
  await connect(linus.id, LINUS_TOKEN);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("Pipedrive slowing down every few calls", () => {
  for (const every of [4, 3]) {
    it(`still ends with a 429 every ${every} calls, each deal once with its followers and people`, async () => {
      const id = await start(linus.id, { deals: true });
      fake.slowDownEvery(every, 1);
      const run = await runToEnd(linus.id, id, 500);
      expect(run.waits).toBeGreaterThan(0);
      expect(await importRow(id)).toMatchObject({ state: "finished" });
      const rows = await sql<{ pd: string; followers: number; people: number }[]>`
        select l.pipedrive_id::text as pd,
               (select count(*)::int from deal_followers f where f.deal_id = l.deal_id) as followers,
               (select count(*)::int from deal_people p where p.deal_id = l.deal_id) as people
        from pipedrive_links l where l.kind = 'deal'`;
      expect(rows.map((r) => Number(r.pd)).sort((a, b) => a - b)).toEqual(deals);
      expect(rows.every((r) => r.followers === 2 && r.people === 1)).toBe(true);
      // Each call asked at most twice: once answered 429, once answered.
      for (const d of deals) {
        expect(fake.requests.filter((r) => r.path === `/api/v2/deals/${d}/followers`).length).toBeLessThanOrEqual(2);
        expect(fake.requests.filter((r) => r.path === `/v1/deals/${d}/participants`).length).toBeLessThanOrEqual(2);
      }
      expect((await sql`select fetched from pipedrive_imports where id = ${id}`)[0].fetched).toBeNull();
    });
  }
});
