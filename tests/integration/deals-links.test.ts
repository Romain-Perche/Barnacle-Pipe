// covers SF-95 FR-016, FR-018, FR-020, US5 scenarios 1, 2, 5, 6, Edge Cases (archived linked person; deleted linked
// person; deactivated follower; main person set to someone already linked)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { followDeal, linkPerson, unfollowDeal, unlinkPerson } from "@/server/deals/links";
import { deletePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealEvents, dealForm, makeDeal, makePipeline } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
let sales: { id: number; stages: number[] };

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified"]);
});
afterAll(closeDb);

const linked = async (dealId: number) =>
  (await sql<{ person_id: number }[]>`select person_id::int as person_id from deal_people where deal_id = ${dealId} order by person_id`).map((r) => r.person_id);

describe("linkPerson / unlinkPerson", () => {
  it("links a visible person, records 'person_linked'; unlink records 'person_unlinked'", async () => {
    const main = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, personId: main });
    expect(await linkPerson(linus.id, id, bob)).toEqual({ status: "ok" });
    expect((await deals.getDeal(linus.id, id))!.otherPeople).toEqual([{ id: bob, name: "Bob Example", archived: false }]);
    const [line] = (await readTimeline(linus.id, { dealId: id })).entries;
    expect(line).toMatchObject({ kind: "person_linked", actorName: "Linus Fake", relatedPerson: { id: bob, name: "Bob Example" } });
    expect(await unlinkPerson(linus.id, id, bob)).toEqual({ status: "ok" });
    expect(await linked(id)).toEqual([]);
    expect((await dealEvents(id)).map((e) => e.kind)).toEqual(["person_linked", "person_unlinked"]);
    expect(await unlinkPerson(linus.id, id, bob)).toEqual({ status: "not_linked" });
  });

  it("refuses the main person or someone already linked; nothing changes", async () => {
    const main = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, personId: main });
    expect(await linkPerson(ada.id, id, main)).toEqual({ status: "already_linked" });
    await linkPerson(ada.id, id, bob);
    expect(await linkPerson(ada.id, id, bob)).toEqual({ status: "already_linked" });
    expect(await linked(id)).toEqual([bob]);
    expect((await dealEvents(id)).length).toBe(1);
  });

  it("refuses an archived person, a person hidden from the actor, and links on an archived or hidden deal", async () => {
    const archived = await makePerson({ firstName: "Fay", lastName: "Mockup", createdBy: ada.id, archived: true });
    const hidden = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true });
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    expect(await linkPerson(linus.id, id, archived)).toEqual({ status: "not_allowed" });
    expect(await linkPerson(linus.id, id, hidden)).toEqual({ status: "not_allowed" });
    expect(await linkPerson(linus.id, id, 999999)).toEqual({ status: "not_allowed" });
    const archivedDeal = await makeDeal({ title: "Archived deal", stageId: sales.stages[0], createdBy: ada.id, archived: true });
    expect(await linkPerson(linus.id, archivedDeal, bob)).toEqual({ status: "not_allowed" });
    const priv = await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true });
    expect(await linkPerson(linus.id, priv, bob)).toEqual({ status: "not_found" });
    expect(await linked(id)).toEqual([]);
  });

  it("works on a closed deal", async () => {
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    await deals.markWon(ada.id, id, 1);
    expect(await linkPerson(ada.id, id, bob)).toEqual({ status: "ok" });
  });

  it("never shows or names a linked person private to someone else; an archived one stays, marked", async () => {
    const hidden = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true });
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    expect(await linkPerson(ada.id, id, hidden)).toEqual({ status: "ok" });
    expect(await linkPerson(ada.id, id, bob)).toEqual({ status: "ok" });
    await sql`update persons set archived_at = now() where id = ${bob}`;
    expect((await deals.getDeal(linus.id, id))!.otherPeople).toEqual([{ id: bob, name: "Bob Example", archived: true }]);
    expect(((await readTimeline(linus.id, { dealId: id })).entries).map((e) => e.relatedPerson?.name)).toEqual(["Bob Example"]);
    // Linus cannot unlink (or learn about) Gus.
    expect(await unlinkPerson(linus.id, id, hidden)).toEqual({ status: "not_linked" });
    expect(await linked(id)).toEqual([hidden, bob].sort((a, b) => a - b));
  });

  it("a deleted linked person leaves the deal; the history keeps 'A deleted person was linked'", async () => {
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    await linkPerson(ada.id, id, bob);
    expect((await deletePerson(ada.id, bob)).status).toBe("deleted");
    expect(await linked(id)).toEqual([]);
    const [line] = (await readTimeline(ada.id, { dealId: id })).entries;
    expect(line).toMatchObject({ kind: "person_linked", relatedPerson: null });
  });

  it("making someone in Other people the main person removes their link row (a person is linked once)", async () => {
    const main = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
    const bob = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id, personId: main });
    await linkPerson(ada.id, id, bob);
    const r = await deals.updateDeal(ada.id, id, 1, dealForm({ personId: String(bob), ownerId: String(ada.id) }));
    expect(r.status).toBe("saved");
    expect(await linked(id)).toEqual([]);
    const d = (await deals.getDeal(ada.id, id))!;
    expect(d.person?.id).toBe(bob);
    expect(d.otherPeople).toEqual([]);
    expect((await dealEvents(id)).at(-1)).toMatchObject({ kind: "edited", fields: ["Person"] });
  });
});

describe("followDeal / unfollowDeal", () => {
  it("follows once (no history line), unfollows; a deactivated follower stays listed", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    expect(await followDeal(linus.id, id)).toEqual({ status: "ok" });
    expect(await followDeal(linus.id, id)).toEqual({ status: "ok" });
    expect(await followDeal(ada.id, id)).toEqual({ status: "ok" });
    expect((await deals.getDeal(linus.id, id))!).toMatchObject({ followedByViewer: true });
    expect(await dealEvents(id)).toEqual([]);
    await sql`update users set status = 'deactivated' where id = ${linus.id}`;
    expect((await deals.getDeal(ada.id, id))!.followers).toEqual([
      { id: ada.id, name: "Ada Fake", active: true },
      { id: linus.id, name: "Linus Fake", active: false },
    ]);
    expect(await unfollowDeal(ada.id, id)).toEqual({ status: "ok" });
    expect((await deals.getDeal(ada.id, id))!.followers.map((f) => f.name)).toEqual(["Linus Fake"]);
  });

  it("is not found for a hidden or archived deal", async () => {
    const priv = await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true });
    expect(await followDeal(linus.id, priv)).toEqual({ status: "not_found" });
    const archived = await makeDeal({ title: "Archived deal", stageId: sales.stages[0], createdBy: ada.id, archived: true });
    expect(await followDeal(linus.id, archived)).toEqual({ status: "not_found" });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from deal_followers`;
    expect(n).toBe(0);
  });
});
