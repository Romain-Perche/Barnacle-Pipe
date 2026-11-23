// covers SF-114 FR-013, SC-004, SC-005, US4 scenarios 1–4: private ambassadors and referred records are never listed,
// counted, offered or in latest updates for anyone the rules hide them from (Grace Fake: an admin they are hidden from)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { dealFilterOptions } from "@/server/deals/list";
import { ambassadorOptions, getAmbassadorPage, listAmbassadors, readAmbassadorUpdates, referrerOptions } from "@/server/records/ambassadors";
import { handOverPrivateRecords } from "@/server/records/handover";
import { addNote } from "@/server/records/notes";
import { getPerson, peopleFilterOptions, personFormChoices, personToForm, updatePerson } from "@/server/records/people";
import { makeAmbassador, refer, referral, setDeal } from "./ambassador-helpers";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { saved } from "./record-helpers";

let ada: TestUser;
let grace: TestUser;
let linus: TestUser;
let stage: number;
let cara: number;
const SHOWN = { people: 50, deals: 50 };

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id });
});
afterAll(closeDb);

describe("private referred records (US4 scenario 1)", () => {
  it("are not listed, counted or in updates for an admin they are hidden from; the list row agrees with the page", async () => {
    const shared = await makePerson({ firstName: "Shared", createdBy: ada.id });
    const hiddenPerson = await makePerson({ firstName: "Hidden", createdBy: ada.id, private: true });
    const open = await makeDeal({ title: "Open", stageId: stage, createdBy: ada.id, valuePence: 1000 });
    const hiddenOpen = await makeDeal({ title: "Private open", stageId: stage, createdBy: ada.id, valuePence: 2000, private: true });
    const hiddenWon = await makeDeal({ title: "Private won", stageId: stage, createdBy: ada.id, valuePence: 3000, private: true });
    const hiddenLost = await makeDeal({ title: "Private lost", stageId: stage, createdBy: ada.id, private: true });
    for (const p of [shared, hiddenPerson]) await refer("person", p, cara, new Date(Date.now() - 86_400_000));
    await refer("deal", open, cara, new Date(Date.now() - 86_400_000));
    for (const d of [hiddenOpen, hiddenWon, hiddenLost]) await refer("deal", d, cara, new Date());
    await setDeal(hiddenWon, "won");
    await setDeal(hiddenLost, "lost");
    await addNote(ada.id, { dealId: hiddenOpen }, "Secret fake note", []);
    await addNote(ada.id, { personId: hiddenPerson }, "Secret person note", []);

    const forGrace = (await getAmbassadorPage(grace.id, cara, SHOWN))!;
    expect(forGrace.summary).toEqual({ people: 1, deals: 1, openPence: 1000, wonPence: 0, lost: 0 });
    expect(forGrace.people.rows.map((r) => r.id)).toEqual([shared]);
    expect(forGrace.deals.rows.map((r) => r.id)).toEqual([open]);
    const [row] = await listAmbassadors(grace.id);
    expect(row).toMatchObject({ people: 1, deals: 1, openPence: 1000, wonPence: 0, lost: 0 });
    expect(row.latestReferral!.getTime()).toBeLessThan(Date.now() - 3_600_000);
    const updates = await readAmbassadorUpdates(grace.id, cara, 100);
    expect(updates.entries.some((e) => e.deal?.id === hiddenOpen || e.person?.id === hiddenPerson)).toBe(false);

    const forAda = (await getAmbassadorPage(ada.id, cara, SHOWN))!;
    expect(forAda.summary).toEqual({ people: 2, deals: 4, openPence: 3000, wonPence: 3000, lost: 1 });
    expect((await readAmbassadorUpdates(ada.id, cara, 100)).entries.map((e) => e.note?.segments[0])).toEqual(
      expect.arrayContaining([{ text: "Secret fake note" }, { text: "Secret person note" }]),
    );
  });

  it("a former ambassador whose only referrals are hidden has no page for that viewer (research.md §7)", async () => {
    const hidden = await makePerson({ firstName: "Hidden", createdBy: ada.id, private: true });
    await refer("person", hidden, cara);
    await sql`update persons set is_ambassador = false where id = ${cara}`;
    expect(await getAmbassadorPage(grace.id, cara, SHOWN)).toBeNull();
    expect(await getAmbassadorPage(ada.id, cara, SHOWN)).not.toBeNull();
    expect((await referrerOptions(grace.id)).map((o) => o.id)).toEqual([]);
  });
});

describe("a private ambassador (US4 scenario 2)", () => {
  it("is not listed, offered, a filter option or a page for an admin they are hidden from", async () => {
    const dora = await makeAmbassador({ firstName: "Dora", lastName: "Privatefake", createdBy: linus.id, private: true });
    const hal = await makePerson({ firstName: "Hal", createdBy: linus.id });
    await refer("person", hal, dora);
    expect((await listAmbassadors(grace.id)).map((r) => r.id)).toEqual([cara]);
    expect((await ambassadorOptions(sql, grace.id)).map((o) => o.id)).toEqual([cara]);
    expect((await referrerOptions(grace.id)).map((o) => o.id)).toEqual([cara]);
    expect((await peopleFilterOptions(grace.id, null)).referrers.map((o) => o.id)).toEqual([cara]);
    expect((await dealFilterOptions(grace.id, null)).referrers.map((o) => o.id)).toEqual([cara]);
    expect((await deals.dealFormChoices(grace.id, null)).ambassadors.map((o) => o.id)).toEqual([cara]);
    expect(await getAmbassadorPage(grace.id, dora, SHOWN)).toBeNull();
    expect((await readAmbassadorUpdates(grace.id, dora, 20)).entries).toEqual([]);
    // Linus, their creator, sees them everywhere.
    expect((await listAmbassadors(linus.id)).map((r) => r.id)).toEqual([cara, dora]);
    expect(await getAmbassadorPage(linus.id, dora, SHOWN)).not.toBeNull();
  });
});

describe("a shared record referred by a hidden private ambassador (US4 scenario 3)", () => {
  it("shows 'hidden', posts 'keep', and keeps the referrer on save", async () => {
    const dora = await makeAmbassador({ firstName: "Dora", createdBy: linus.id, private: true });
    const hal = await makePerson({ firstName: "Hal", createdBy: linus.id });
    const deal = await makeDeal({ title: "Hal's deal", stageId: stage, createdBy: linus.id });
    await refer("person", hal, dora);
    await refer("deal", deal, dora);
    const p = (await getPerson(grace.id, hal))!;
    expect(p.referredBy).toBe("hidden");
    expect(personToForm(p).referredBy).toBe("keep");
    saved(await updatePerson(grace.id, hal, p.version, { ...personToForm(p), role: "Changed" }));
    expect((await referral("person", hal)).referred_by_id).toBe(dora);
    const d = (await deals.getDeal(grace.id, deal))!;
    expect(d.referredBy).toBe("hidden");
    expect(deals.dealToForm(d).referredBy).toBe("keep");
    saved(await deals.updateDeal(grace.id, deal, d.version, { ...deals.dealToForm(d), title: "Changed" }));
    expect((await referral("deal", deal)).referred_by_id).toBe(dora);
    // The form's options never hold the hidden id.
    expect((await personFormChoices(grace.id, p)).ambassadors.map((a) => a.id)).not.toContain(dora);
  });
});

describe("after a hand-over (US4 scenario 4)", () => {
  it("the new owner opens the private ambassador's page and sees the private referred records counted", async () => {
    const alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake" });
    const margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
    const dora = await makeAmbassador({ firstName: "Dora", createdBy: alan.id, private: true });
    const secret = await makePerson({ firstName: "Secret", createdBy: alan.id, private: true });
    const deal = await makeDeal({ title: "Secret deal", stageId: stage, createdBy: alan.id, private: true, valuePence: 7000 });
    await refer("person", secret, dora);
    await refer("deal", deal, dora);
    await sql`update users set status = 'deactivated' where id = ${alan.id}`;
    expect(await getAmbassadorPage(margaret.id, dora, SHOWN)).toBeNull();
    expect((await handOverPrivateRecords(ada.id, alan.id, margaret.id)).status).toBe("handed");
    const page = (await getAmbassadorPage(margaret.id, dora, SHOWN))!;
    expect(page.summary).toEqual({ people: 1, deals: 1, openPence: 7000, wonPence: 0, lost: 0 });
    expect(page.people.rows.map((r) => r.id)).toEqual([secret]);
    expect((await listAmbassadors(margaret.id)).map((r) => r.id)).toContain(dora);
  });
});
