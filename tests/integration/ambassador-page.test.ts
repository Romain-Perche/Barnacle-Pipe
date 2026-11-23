// covers SF-114 FR-008, FR-010, SC-004, US3 scenarios 1–3, 6–7, edge cases (archived, null value, lost, won then
// reopened, a deal and its main person, a referred ambassador, a deleted referred record, more than 50, markup)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { getAmbassadorPage, listAmbassadors, readAmbassadorUpdates } from "@/server/records/ambassadors";
import { deletePerson } from "@/server/records/people";
import { makeAmbassador, refer, setDeal } from "./ambassador-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
let stages: number[];
let cara: number;
const SHOWN = { people: 50, deals: 50 };
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  stages = (await makePipeline("Sales", ["Lead in", "Proposal"])).stages;
  cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id, role: "Partnerships lead", emails: ["cara@example.com"] });
});
afterAll(closeDb);

const page = (viewer = ada.id, id = cara, shown = SHOWN) => getAmbassadorPage(viewer, id, shown);

describe("getAmbassadorPage", () => {
  it("has the person, the summary and both lists (US3 scenarios 1–3)", async () => {
    const org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
    const bob = await makePerson({ firstName: "Bob", lastName: "Sample", createdBy: ada.id, ownerId: linus.id, organisationId: org, createdAt: new Date(Date.now() - 2 * DAY) });
    const dee = await makePerson({ firstName: "Dee", lastName: "Example", createdBy: ada.id, createdAt: new Date(Date.now() - DAY) });
    for (const p of [bob, dee]) await refer("person", p, cara);
    const open = await makeDeal({ title: "Website", stageId: stages[1], createdBy: ada.id, valuePence: 450000 });
    const won = await makeDeal({ title: "Pilot", stageId: stages[1], createdBy: ada.id, valuePence: 400000 });
    for (const d of [open, won]) await refer("deal", d, cara);
    await setDeal(won, "won");
    const p = (await page())!;
    expect(p.person).toMatchObject({ id: cara, name: "Cara Example", role: "Partnerships lead", ambassador: true });
    expect(p.former).toBe(false);
    expect(p.summary).toEqual({ people: 2, deals: 2, openPence: 450000, wonPence: 400000, lost: 0 });
    expect(p.people.rows.map((r) => r.name)).toEqual(["Dee Example", "Bob Sample"]);
    expect(p.people.rows[1]).toMatchObject({ organisation: { id: org, name: "Example Ltd Fake" }, owner: { id: linus.id }, archived: false });
    expect(p.deals.rows.map((r) => [r.title, r.pipeline, r.stage, r.valuePence, r.status])).toEqual([
      ["Website", "Sales", "Proposal", 450000, "open"],
      ["Pilot", "Sales", "Proposal", 400000, "won"],
    ]);
    expect(p.people.more || p.deals.more).toBe(false);
  });

  it("counts archived records, a null value as £0, lost only in Lost, a reopened deal back in Open (edge cases, SC-004)", async () => {
    const archivedOpen = await makeDeal({ title: "Archived open", stageId: stages[0], createdBy: ada.id, valuePence: 100000, archived: true });
    const archivedWon = await makeDeal({ title: "Archived won", stageId: stages[0], createdBy: ada.id, valuePence: 20000, archived: true });
    const noValue = await makeDeal({ title: "No value", stageId: stages[0], createdBy: ada.id });
    const lost = await makeDeal({ title: "Lost", stageId: stages[0], createdBy: ada.id, valuePence: 150000 });
    const reopened = await makeDeal({ title: "Reopened", stageId: stages[0], createdBy: ada.id, valuePence: 5000 });
    for (const d of [archivedOpen, archivedWon, noValue, lost, reopened]) await refer("deal", d, cara);
    await setDeal(archivedWon, "won");
    await setDeal(lost, "lost");
    await deals.markWon(ada.id, reopened, 1);
    const v = (await deals.getDeal(ada.id, reopened))!.version;
    expect((await deals.reopenDeal(ada.id, reopened, v)).status).toBe("ok");
    const archivedPerson = await makePerson({ firstName: "Old", createdBy: ada.id, archived: true });
    await refer("person", archivedPerson, cara);
    const p = (await page())!;
    expect(p.summary).toEqual({ people: 1, deals: 5, openPence: 105000, wonPence: 20000, lost: 1 });
    expect(p.people.rows[0]).toMatchObject({ id: archivedPerson, archived: true });
    expect(p.deals.rows.find((r) => r.id === reopened)!.status).toBe("open");
    expect(p.deals.rows.find((r) => r.id === archivedOpen)!.archived).toBe(true);
    // The Ambassadors page row says the same.
    expect((await listAmbassadors(ada.id))[0]).toMatchObject({ people: 1, deals: 5, openPence: 105000, wonPence: 20000, lost: 1 });
  });

  it("counts a deal and its main person once each; a referred ambassador's own referrals are not listed (edge cases)", async () => {
    const ben = await makeAmbassador({ firstName: "Ben", createdBy: ada.id });
    const d = await makeDeal({ title: "Ben's deal", stageId: stages[0], createdBy: ada.id, personId: ben });
    await refer("person", ben, cara);
    await refer("deal", d, cara);
    const grand = await makePerson({ firstName: "Grand", createdBy: ada.id });
    await refer("person", grand, ben);
    const p = (await page())!;
    expect(p.summary).toMatchObject({ people: 1, deals: 1 });
    expect(p.people.rows.map((r) => r.id)).toEqual([ben]);
    expect(p.deals.rows.map((r) => r.id)).toEqual([d]);
  });

  it("orders deals open first, then by most recent change, then newest id (research.md §9)", async () => {
    const a = await makeDeal({ title: "A", stageId: stages[0], createdBy: ada.id });
    const b = await makeDeal({ title: "B", stageId: stages[0], createdBy: ada.id });
    const c = await makeDeal({ title: "C won", stageId: stages[0], createdBy: ada.id });
    for (const d of [a, b, c]) await refer("deal", d, cara);
    await setDeal(c, "won");
    await sql`update deals set created_at = now() - interval '10 days' where id in ${sql([a, b, c])}`;
    await sql`insert into timeline_events (deal_id, kind, actor_id, created_at) values (${a}, 'edited', ${ada.id}, now() - interval '1 day')`;
    await sql`insert into timeline_events (deal_id, kind, actor_id, created_at) values (${c}, 'won', ${ada.id}, now())`;
    expect((await page())!.deals.rows.map((r) => r.title)).toEqual(["A", "B", "C won"]);
  });

  it("shows 50 rows then more; 100 shows the next 50 with no repeat or skip (FR-010)", async () => {
    await sql`
      insert into persons (first_name, last_name, created_by, owner_id, referred_by_id, referred_at, created_at)
      select 'Ref', 'Fake ' || g, ${ada.id}, ${ada.id}, ${cara}, now(), now() - (g % 7) * interval '1 day' from generate_series(1, 120) g`;
    await sql`
      insert into deals (title, stage_id, owner_id, created_by, referred_by_id, referred_at)
      select 'Deal ' || g, ${stages[0]}, ${ada.id}, ${ada.id}, ${cara}, now() from generate_series(1, 120) g`;
    const first = (await page(ada.id, cara, { people: 50, deals: 50 }))!;
    expect(first.people.rows).toHaveLength(50);
    expect(first.people.more).toBe(true);
    expect(first.deals.more).toBe(true);
    const second = (await page(ada.id, cara, { people: 100, deals: 100 }))!;
    expect(second.people.rows.slice(0, 50).map((r) => r.id)).toEqual(first.people.rows.map((r) => r.id));
    expect(second.deals.rows.slice(0, 50).map((r) => r.id)).toEqual(first.deals.rows.map((r) => r.id));
    expect(new Set(second.people.rows.map((r) => r.id)).size).toBe(100);
    const all = (await page(ada.id, cara, { people: 150, deals: 150 }))!;
    expect(all.people.rows).toHaveLength(120);
    expect(all.people.more).toBe(false);
    expect(all.people.rows.slice(0, 100).map((r) => r.id)).toEqual(second.people.rows.map((r) => r.id));
  });

  it("drops a deleted referred record from the lists and totals (edge case)", async () => {
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    await refer("person", ben, cara);
    const d = await makeDeal({ title: "Gone", stageId: stages[0], createdBy: ada.id, valuePence: 1000 });
    await refer("deal", d, cara);
    await deletePerson(ada.id, ben);
    await deals.deleteDeal(ada.id, d);
    const p = (await page())!;
    expect(p.summary).toEqual({ people: 0, deals: 0, openPence: 0, wonPence: 0, lost: 0 });
    expect(p.people.rows).toEqual([]);
    expect(p.deals.rows).toEqual([]);
  });

  it("is null for a person who never was an ambassador; a former one with referrals is 'former' (US3 scenarios 6–7)", async () => {
    const plain = await makePerson({ firstName: "Plain", createdBy: ada.id });
    expect(await page(ada.id, plain)).toBeNull();
    expect(await page(ada.id, 999999)).toBeNull();
    expect((await page())!.summary).toEqual({ people: 0, deals: 0, openPence: 0, wonPence: 0, lost: 0 });
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    await refer("person", ben, cara);
    await sql`update persons set is_ambassador = false where id = ${cara}`;
    expect((await page())!.former).toBe(true);
    await refer("person", ben, null);
    expect(await page()).toBeNull();
  });

  it("returns names with markup as plain text (edge case 'markup')", async () => {
    const b = await makePerson({ firstName: "<b>Fake</b>", lastName: "", createdBy: ada.id });
    await refer("person", b, cara);
    const d = await makeDeal({ title: "<b>Fake</b> deal", stageId: stages[0], createdBy: ada.id });
    await refer("deal", d, cara);
    await sql`insert into timeline_events (person_id, kind, actor_id) values (${b}, 'edited', ${ada.id})`;
    const p = (await page())!;
    expect(p.people.rows[0].name).toBe("<b>Fake</b>");
    expect(p.deals.rows[0].title).toBe("<b>Fake</b> deal");
    const updates = await readAmbassadorUpdates(ada.id, cara, 20);
    expect(updates.entries.find((e) => e.person)!.person!.name).toBe("<b>Fake</b>");
  });
});
