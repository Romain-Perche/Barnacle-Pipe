// covers SF-114 FR-006, FR-013 (research.md §5): readTimeline returns the referral kinds with their people and drops a
// referral event naming a private person hidden from the viewer
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { readTimeline } from "@/server/records/timeline";
import { makeAmbassador } from "./ambassador-helpers";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;
let grace: TestUser;
let linus: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

describe("referral events on a timeline", () => {
  it("names the new and previous referrer, with whether they have an ambassador page", async () => {
    const cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id });
    const plain = await makePerson({ firstName: "Plain", lastName: "Fake", createdBy: ada.id });
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    await sql`insert into timeline_events (person_id, kind, actor_id, related_person_id, created_at) values (${ben}, 'referrer_set', ${ada.id}, ${plain}, now() - interval '2 minutes')`;
    await sql`insert into timeline_events (person_id, kind, actor_id, related_person_id, from_person_id, created_at) values (${ben}, 'referrer_changed', ${ada.id}, ${cara}, ${plain}, now() - interval '1 minute')`;
    await sql`insert into timeline_events (person_id, kind, actor_id) values (${ben}, 'referrer_cleared', ${ada.id})`;
    const tl = await readTimeline(grace.id, { personId: ben });
    expect(tl.entries.map((e) => [e.kind, e.actorName, e.fromPerson, e.relatedPerson])).toEqual([
      ["referrer_cleared", "Ada Fake", null, null],
      ["referrer_changed", "Ada Fake", { id: plain, name: "Plain Fake", ambassadorPage: false }, { id: cara, name: "Cara Example", ambassadorPage: true }],
      ["referrer_set", "Ada Fake", null, { id: plain, name: "Plain Fake", ambassadorPage: false }],
    ]);
    expect(tl.entries.every((e) => e.person === null)).toBe(true);
  });

  it("leaves out a referral event naming a private person the viewer cannot see, as new or previous referrer", async () => {
    const dora = await makeAmbassador({ firstName: "Dora", createdBy: linus.id, private: true });
    const cara = await makeAmbassador({ firstName: "Cara", createdBy: ada.id });
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    await sql`insert into timeline_events (person_id, kind, actor_id, related_person_id) values (${ben}, 'referrer_set', ${linus.id}, ${dora})`;
    await sql`insert into timeline_events (person_id, kind, actor_id, related_person_id, from_person_id) values (${ben}, 'referrer_changed', ${linus.id}, ${cara}, ${dora})`;
    expect((await readTimeline(grace.id, { personId: ben })).entries).toEqual([]);
    expect((await readTimeline(linus.id, { personId: ben })).entries.map((e) => e.kind).sort()).toEqual(["referrer_changed", "referrer_set"]);
  });
});
