// covers FR-009, FR-010, FR-011, FR-012, FR-013, SC-004, SC-005, US3 scenarios 1, 3–7 (SF-92): handing a
// deactivated user's private people to an active user
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { parsePeopleQuery } from "@/server/records/list-query";
import { handOverPrivatePeople } from "@/server/records/handover";
import { createPerson, getPerson, listPeople, updatePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { listUsers } from "@/server/users";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { emails, personForm } from "./record-helpers";

let ada: TestUser; // admin
let grace: TestUser; // admin
let linus: TestUser;
let margaret: TestUser;
let alan: TestUser; // deactivated, owns private people
let robin: number; // private, created and owned by Alan, archived
let sam: number; // private, created and owned by Alan
let pat: number; // private, created by Linus, owned by Alan
let kept: number; // private, created by Alan, owned by Linus: not touched
let shared: number; // shared, owned by Alan: not touched
let own: number; // private, Margaret's own

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
  const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
  robin = await makePerson({ firstName: "Robin", lastName: "Leftfake", createdBy: alan.id, private: true, archived: true, organisationId: org, emails: ["robin.leftfake@example.com"] });
  sam = await makePerson({ firstName: "Sam", lastName: "Leftfake", createdBy: alan.id, private: true, emails: ["sam.leftfake@example.net"] });
  pat = await makePerson({ firstName: "Pat", lastName: "Linusfake", createdBy: linus.id, ownerId: alan.id, private: true });
  kept = await makePerson({ firstName: "Kept", lastName: "Fake", createdBy: alan.id, ownerId: linus.id, private: true });
  shared = await makePerson({ firstName: "Shared", lastName: "Fake", createdBy: alan.id, private: false });
  own = await makePerson({ firstName: "Active", lastName: "Owned", createdBy: margaret.id, private: true });
});
afterAll(closeDb);

async function snapshot() {
  const persons = await sql`select * from persons order by id`;
  const events = await sql`select * from timeline_events order by id`;
  return { persons, events };
}

async function privatePeopleByUser() {
  return Object.fromEntries((await listUsers()).map((u) => [u.id, u.private_people]));
}

describe("listUsers private_people", () => {
  it("counts private people, archived included, owned by deactivated users only (US3 scenario 1)", async () => {
    expect(await privatePeopleByUser()).toEqual({ [ada.id]: 0, [grace.id]: 0, [linus.id]: 0, [margaret.id]: 0, [alan.id]: 3 });
  });
});

describe("handOverPrivatePeople", () => {
  it("moves every private person Alan owns to Margaret, with a handed_over event each (US3 scenarios 1, 3, 4)", async () => {
    const before = await sql`select id::int as id, created_by, archived_at, version from persons where id in ${sql([robin, sam, pat])} order by id`;
    expect(await handOverPrivatePeople(ada.id, alan.id, margaret.id)).toEqual({ status: "handed", count: 3, toName: "Margaret Fake" });
    const after = await sql`select id::int as id, owner_id::int as owner_id, private, created_by, archived_at, version from persons where id in ${sql([robin, sam, pat])} order by id`;
    for (const [i, p] of after.entries()) {
      expect(p).toMatchObject({ owner_id: margaret.id, private: true, created_by: before[i].created_by, archived_at: before[i].archived_at, version: before[i].version + 1 });
    }
    const events = await sql`select person_id::int as person_id, kind, actor_id::int as actor_id, related_user_id::int as related_user_id from timeline_events where kind = 'handed_over' order by person_id`;
    expect(events).toEqual([robin, sam, pat].sort((a, b) => a - b).map((id) => ({ person_id: id, kind: "handed_over", actor_id: ada.id, related_user_id: margaret.id })));
    expect((await readTimeline(margaret.id, { personId: sam }))[0]).toMatchObject({ kind: "handed_over", actorName: "Ada Fake", relatedUserName: "Margaret Fake" });

    const mine = await listPeople(margaret.id, parsePeopleQuery({ owner: String(margaret.id), archived: "1" }));
    expect(mine.rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([robin, sam, pat, own].sort((a, b) => a - b));
    expect((await getPerson(margaret.id, robin))!.owner.id).toBe(margaret.id);
    // Pat's creator still sees them; untouched people stay as they were.
    expect(await getPerson(linus.id, pat)).not.toBeNull();
    const untouched = await sql`select id::int as id, owner_id::int as owner_id, version from persons where id in ${sql([kept, shared])} order by id`;
    expect(untouched).toEqual([{ id: kept, owner_id: linus.id, version: 1 }, { id: shared, owner_id: alan.id, version: 1 }].sort((a, b) => a.id - b.id));
    // The admin still sees none of them.
    expect(await getPerson(ada.id, sam)).toBeNull();

    expect(await handOverPrivatePeople(ada.id, alan.id, margaret.id)).toEqual({ status: "none", fromName: "Alan Fake" });
    expect((await privatePeopleByUser())[alan.id]).toBe(0);
  });

  it("lets the new owner see the addresses in duplicate messages and free them (US3 scenarios 5, 6)", async () => {
    await handOverPrivatePeople(ada.id, alan.id, margaret.id);
    expect(await createPerson(margaret.id, personForm({ emails: emails("sam.leftfake@example.net") }))).toEqual({
      status: "invalid",
      errors: { "emails.0": { code: "duplicate_email", name: "Sam Leftfake", href: `/people/${sam}` } },
    });
    expect(await createPerson(linus.id, personForm({ emails: emails("sam.leftfake@example.net") }))).toEqual({
      status: "invalid",
      errors: { "emails.0": { code: "duplicate_email_hidden" } },
    });
    const v = (await getPerson(margaret.id, sam))!.version;
    expect((await updatePerson(margaret.id, sam, v, personForm({ firstName: "Sam", lastName: "Leftfake", private: true, ownerId: String(margaret.id) }))).status).toBe("saved");
    expect((await createPerson(linus.id, personForm({ emails: emails("sam.leftfake@example.net") }))).status).toBe("saved");
  });

  it("allows handing over to the acting admin", async () => {
    expect(await handOverPrivatePeople(ada.id, alan.id, ada.id)).toEqual({ status: "handed", count: 3, toName: "Ada Fake" });
    expect(await getPerson(ada.id, sam)).not.toBeNull();
  });
});

// covers FR-012, SC-005, spec Edge Cases (SF-92)
describe("handOverPrivatePeople refusals and races", () => {
  it("refuses and changes nothing", async () => {
    const deactivatedAdmin = await makeUser({ email: "old@barnacle.ai", name: "Old Admin", role: "admin", status: "deactivated" });
    const before = await snapshot();
    expect(await handOverPrivatePeople(linus.id, alan.id, margaret.id)).toEqual({ status: "forbidden" });
    expect(await handOverPrivatePeople(deactivatedAdmin.id, alan.id, margaret.id)).toEqual({ status: "forbidden" });
    expect(await handOverPrivatePeople(ada.id, linus.id, margaret.id)).toEqual({ status: "not_deactivated" });
    expect(await handOverPrivatePeople(ada.id, 999_999, margaret.id)).toEqual({ status: "not_deactivated" });
    expect(await handOverPrivatePeople(ada.id, alan.id, deactivatedAdmin.id)).toEqual({ status: "choose_user" });
    expect(await handOverPrivatePeople(ada.id, alan.id, 999_999)).toEqual({ status: "choose_user" });
    expect(await handOverPrivatePeople(ada.id, alan.id, alan.id)).toEqual({ status: "choose_user" });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses when the recipient is deactivated by a transaction running at the same time", async () => {
    const before = await snapshot();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let updated!: () => void;
    const didUpdate = new Promise<void>((r) => (updated = r));
    const other = sql.begin(async (tx) => {
      await tx`update users set status = 'deactivated' where id = ${margaret.id}`;
      updated();
      await gate;
    });
    await didUpdate;
    const handover = handOverPrivatePeople(ada.id, alan.id, margaret.id);
    await new Promise((r) => setTimeout(r, 150));
    release();
    await other;
    expect(await handover).toEqual({ status: "choose_user" });
    const after = await snapshot();
    expect(after.persons).toEqual(before.persons);
    expect(after.events).toEqual(before.events);
  });

  it("lets only one of two admins handing over at once move the people", async () => {
    const results = await Promise.all([handOverPrivatePeople(ada.id, alan.id, margaret.id), handOverPrivatePeople(grace.id, alan.id, linus.id)]);
    const handed = results.filter((r) => r.status === "handed");
    expect(handed).toHaveLength(1);
    expect(handed[0]).toMatchObject({ count: 3 });
    expect(results.filter((r) => r.status === "none")).toHaveLength(1);
    const [{ n }] = await sql`select count(*)::int as n from timeline_events where kind = 'handed_over'`;
    expect(n).toBe(3);
  });

  it("refuses a save from an edit form opened before the hand-over (edit_conflict)", async () => {
    const opened = (await getPerson(linus.id, pat))!;
    await handOverPrivatePeople(ada.id, alan.id, margaret.id);
    expect(await updatePerson(linus.id, pat, opened.version, personForm({ firstName: "Pat", lastName: "Linusfake", private: true, ownerId: String(alan.id) }))).toEqual({
      status: "invalid",
      errors: { form: { code: "edit_conflict" } },
    });
  });
});
