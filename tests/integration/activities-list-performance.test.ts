// covers SF-109 SC-003 (T035): the Activities list with 2,000 activities shows its first page, with any filter, in under 2 s
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActivities } from "@/server/activities/list";
import { closeDb, sql } from "@/server/db";
import { parseActivitiesQuery } from "@/server/records/list-query";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  const bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  const org = await makeOrganisation({ name: "Fakeco", ownerId: ada.id });
  const person = await makePerson({ createdBy: ada.id, organisationId: org });
  await sql`
    insert into activities (type, subject, due_on, due_time, person_id, organisation_id, assignee_id, created_by, assigned_by, done_at, done_by)
    select (array['call', 'meeting', 'task'])[1 + i % 3], 'Fake activity ' || i, date '2026-10-01' + (i % 120), case when i % 2 = 0 then time '10:00' end,
           case when i % 4 = 0 then ${person}::bigint end, ${org}::bigint, case when i % 2 = 0 then ${ada.id}::bigint else ${bob.id}::bigint end,
           ${ada.id}, ${ada.id}, case when i % 5 = 0 then now() end, case when i % 5 = 0 then ${ada.id}::bigint end
    from generate_series(1, 2000) i`;
  await sql`analyze activities`;
});
afterAll(closeDb);

describe("Activities list performance", () => {
  it("answers each quick filter, for everyone, in under 2 s", async () => {
    const now = new Date("2026-11-25T12:00:00Z");
    for (const when of ["overdue", "today", "week", "planned", "done"]) {
      for (const assignee of ["all", String(ada.id)]) {
        const start = Date.now();
        const r = await listActivities(ada.id, parseActivitiesQuery({ when, assignee }), now);
        expect(Date.now() - start, `${when} ${assignee}`).toBeLessThan(2000);
        expect(r.count).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
