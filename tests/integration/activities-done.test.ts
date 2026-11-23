// covers SF-109 FR-004, FR-006, US2 scenarios 1, 3, 4, spec Edge Cases (concurrent ticks, past due dates, ticked early) (T027)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { tickActivity, untickActivity } from "@/server/activities/activities";
import { closeDb, sql } from "@/server/db";
import { activityRow, makeActivity } from "./activity-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;
let bob: TestUser;
let person: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  person = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
});
afterAll(closeDb);

async function lastContacted(id = person) {
  const [row] = await sql<{ at: Date | null; version: number }[]>`select last_contacted_at as at, version from persons where id = ${id}`;
  return row;
}

describe("tickActivity and untickActivity", () => {
  it("marks it done by the actor, now; unticking plans it again with its due date", async () => {
    const id = await makeActivity({ by: ada.id, dueOn: "2026-11-20" });
    const before = Date.now();
    expect(await tickActivity(bob.id, id)).toEqual({ status: "ok" });
    const done = await activityRow(id);
    expect(done).toMatchObject({ done_by: bob.id, version: 2 });
    expect(done.done_at!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await untickActivity(ada.id, id)).toEqual({ status: "ok" });
    expect(await activityRow(id)).toMatchObject({ done_at: null, done_by: null, version: 3, due_on: "2026-11-20" });
  });

  it("two ticks at the same moment leave one done, by the first", async () => {
    const id = await makeActivity({ by: ada.id });
    const results = await Promise.all([tickActivity(ada.id, id), tickActivity(bob.id, id)]);
    expect(results).toEqual([{ status: "ok" }, { status: "ok" }]);
    const row = await activityRow(id);
    expect(row.version).toBe(2);
    expect([ada.id, bob.id]).toContain(row.done_by);
    expect(await tickActivity(bob.id, id)).toEqual({ status: "ok" });
    expect((await activityRow(id)).done_by).toBe(row.done_by);
  });

  it("refuses while a linked record is archived, and when the activity is hidden", async () => {
    const org = await makeOrganisation({ name: "Old Fakeco", ownerId: ada.id, archived: true });
    const archived = await makeActivity({ by: ada.id, organisationId: org });
    expect(await tickActivity(ada.id, archived)).toEqual({ status: "archived" });
    const secret = await makePerson({ firstName: "Secret", createdBy: ada.id, private: true });
    const hidden = await makeActivity({ by: ada.id, personId: secret, doneAt: new Date() });
    expect(await untickActivity(bob.id, hidden)).toEqual({ status: "not_found" });
    expect(await tickActivity(bob.id, 999_999)).toEqual({ status: "not_found" });
    expect((await activityRow(archived)).done_at).toBeNull();
    expect((await activityRow(hidden)).done_at).not.toBeNull();
  });
});

describe("Last contacted (FR-006, US2 scenario 4)", () => {
  it("a call due in the past sets it to its due moment (the start of the UK day with no time)", async () => {
    await tickActivity(ada.id, await makeActivity({ by: ada.id, personId: person, dueOn: "2026-11-20" }));
    expect((await lastContacted()).at!.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    await tickActivity(ada.id, await makeActivity({ by: ada.id, personId: person, dueOn: "2026-11-21", dueTime: "10:00", type: "meeting" }));
    expect((await lastContacted()).at!.toISOString()).toBe("2026-11-21T10:00:00.000Z");
  });

  it("a call due in the future gives the moment it was ticked, never a future date", async () => {
    const id = await makeActivity({ by: ada.id, personId: person, dueOn: "2099-01-01" });
    await tickActivity(ada.id, id);
    const row = await activityRow(id);
    expect((await lastContacted()).at!.getTime()).toBe(row.done_at!.getTime());
  });

  it("keeps a newer value, ignores tasks, is not lowered by unticking, and leaves the person's version alone", async () => {
    await sql`update persons set last_contacted_at = '2026-11-22T09:00:00Z' where id = ${person}`;
    const old = await makeActivity({ by: ada.id, personId: person, dueOn: "2026-11-01" });
    await tickActivity(ada.id, old);
    expect((await lastContacted()).at!.toISOString()).toBe("2026-11-22T09:00:00.000Z");
    await sql`update persons set last_contacted_at = null where id = ${person}`;
    await tickActivity(ada.id, await makeActivity({ by: ada.id, personId: person, dueOn: "2026-11-01", type: "task" }));
    expect((await lastContacted()).at).toBeNull();
    const call = await makeActivity({ by: ada.id, personId: person, dueOn: "2026-11-02" });
    await tickActivity(ada.id, call);
    await untickActivity(ada.id, call);
    expect((await lastContacted()).at!.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect((await lastContacted()).version).toBe(1);
  });

  it("a call with no person changes nobody", async () => {
    const stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
    const deal = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id, personId: person });
    await tickActivity(ada.id, await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-01" }));
    expect((await lastContacted()).at).toBeNull();
  });
});
