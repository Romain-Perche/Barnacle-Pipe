// covers SF-114 FR-011, US5 scenarios 1–2: the "Referred by" filter on the People list and the Deal list, combined with
// the other filters, the deal list's count and total, and the filter options
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { dealFilterOptions, listDeals } from "@/server/deals/list";
import { knownDealsQuery, parseDealsQuery, parsePeopleQuery } from "@/server/records/list-query";
import { listPeople, peopleFilterOptions } from "@/server/records/people";
import { makeAmbassador, refer, setDeal } from "./ambassador-helpers";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
let stage: number;
let cara: number;
let ezra: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id });
  ezra = await makePerson({ firstName: "Ezra", lastName: "Formerfake", createdBy: ada.id });
});
afterAll(closeDb);

describe("the People list", () => {
  it("lists only the people the ambassador referred, with the other filters (US5 scenario 1)", async () => {
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id, ownerId: linus.id });
    const dee = await makePerson({ firstName: "Dee", createdBy: ada.id });
    const hidden = await makePerson({ firstName: "Hidden", createdBy: linus.id, private: true });
    await makePerson({ firstName: "Other", createdBy: ada.id });
    for (const p of [ben, dee, hidden]) await refer("person", p, cara);
    const names = async (params: Record<string, string>) => (await listPeople(ada.id, parsePeopleQuery(params))).rows.map((r) => r.name);
    expect(await names({ ref: String(cara) })).toEqual(["Ben Person", "Dee Person"]);
    expect(await names({ ref: String(cara), owner: String(linus.id) })).toEqual(["Ben Person"]);
    expect((await listPeople(ada.id, parsePeopleQuery({ ref: String(cara) }))).total).toBe(2);
  });
});

describe("the Deal list", () => {
  it("lists only the deals the ambassador referred; count and total follow (US5 scenario 1)", async () => {
    const a = await makeDeal({ title: "A", stageId: stage, createdBy: ada.id, valuePence: 1000 });
    const b = await makeDeal({ title: "B", stageId: stage, createdBy: ada.id, valuePence: 2000 });
    const won = await makeDeal({ title: "Won", stageId: stage, createdBy: ada.id, valuePence: 4000 });
    const hidden = await makeDeal({ title: "Hidden", stageId: stage, createdBy: linus.id, valuePence: 8000, private: true });
    await makeDeal({ title: "Other", stageId: stage, createdBy: ada.id, valuePence: 16000 });
    for (const d of [a, b, won, hidden]) await refer("deal", d, cara);
    await setDeal(won, "won");
    const list = await listDeals(ada.id, parseDealsQuery({ ref: String(cara) }));
    expect(list.rows.map((r) => r.title).sort()).toEqual(["A", "B"]);
    expect([list.total, list.totalPence]).toEqual([2, 3000]);
    const closed = await listDeals(ada.id, parseDealsQuery({ ref: String(cara), closed: "1" }));
    expect([closed.total, closed.totalPence]).toEqual([3, 7000]);
    expect((await listDeals(ada.id, parseDealsQuery({ ref: String(cara), q: "B" }))).rows.map((r) => r.title)).toEqual(["B"]);
  });
});

describe("the Referred by options (US5 scenario 2)", () => {
  it("lists visible ambassadors (archived too) and former ones who still referred a visible record, never a hidden one", async () => {
    const archived = await makeAmbassador({ firstName: "Archived", lastName: "Fake", createdBy: ada.id, archived: true });
    const dora = await makeAmbassador({ firstName: "Dora", lastName: "Privatefake", createdBy: linus.id, private: true });
    const fay = await makePerson({ firstName: "Fay", createdBy: ada.id });
    await refer("person", fay, ezra);
    const formerHidden = await makePerson({ firstName: "Gus", lastName: "Nobody", createdBy: ada.id });
    await refer("person", await makePerson({ firstName: "Secret", createdBy: linus.id, private: true }), formerHidden);
    const people = await peopleFilterOptions(ada.id, null);
    expect(people.referrers.map((o) => o.name)).toEqual(["Archived Fake", "Cara Example", "Ezra Formerfake"]);
    const dealOptions = await dealFilterOptions(ada.id, null);
    expect(dealOptions.referrers.map((o) => o.id)).toEqual([archived, cara, ezra]);
    expect(dealOptions.referrers.map((o) => o.id)).not.toContain(dora);
    // The deal list keeps only a known referrer.
    expect(knownDealsQuery(parseDealsQuery({ ref: String(dora) }), dealOptions).ref).toBeNull();
    expect(knownDealsQuery(parseDealsQuery({ ref: String(cara) }), dealOptions).ref).toBe(cara);
  });
});
