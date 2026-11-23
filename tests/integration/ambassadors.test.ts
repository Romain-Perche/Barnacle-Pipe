// covers SF-114 FR-001, FR-002, FR-003, US1 scenarios 1–5 (the Ambassador tick, its timeline lines, the Ambassadors
// page's rows, archived ambassadors listed but not offered, unticking keeps referrals)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { ambassadorOptions, listAmbassadors } from "@/server/records/ambassadors";
import { archivePerson, createPerson, getPerson, restorePerson, updatePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { events, makeAmbassador, refer, referral, setDeal } from "./ambassador-helpers";
import { leadSourceId, makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { emails, personForm, saved } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;
let stage: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
});
afterAll(closeDb);

async function edit(actorId: number, id: number, over: Parameters<typeof personForm>[0]) {
  const p = (await getPerson(actorId, id))!;
  const { personToForm } = await import("@/server/records/people");
  return updatePerson(actorId, id, p.version, { ...personToForm(p), ...over });
}

describe("the Ambassador tick", () => {
  it("on add: sets the flag and records 'Made an ambassador' by the user", async () => {
    const id = saved(await createPerson(ada.id, personForm({ firstName: "Cara", lastName: "Example", ambassador: true })));
    expect((await referral("person", id)).is_ambassador).toBe(true);
    expect((await events({ personId: id })).map((e) => [e.kind, e.actor_id])).toEqual([["added", ada.id], ["ambassador_added", ada.id]]);
    expect((await getPerson(ada.id, id))!.ambassador).toBe(true);
    const plain = saved(await createPerson(ada.id, personForm({ firstName: "Ben", lastName: "Sample" })));
    expect((await events({ personId: plain })).map((e) => e.kind)).toEqual(["added"]);
  });

  it("on edit: ticking then unticking records both lines, newest first on the timeline", async () => {
    const id = await makePerson({ firstName: "Cara", lastName: "Example", createdBy: ada.id });
    saved(await edit(linus.id, id, { ambassador: true }));
    expect((await referral("person", id)).is_ambassador).toBe(true);
    saved(await edit(ada.id, id, { ambassador: false }));
    const tl = await readTimeline(ada.id, { personId: id });
    expect(tl.entries.map((e) => [e.kind, e.actorName])).toEqual([["ambassador_removed", "Ada Fake"], ["ambassador_added", "Linus Fake"]]);
    // Saving again without a change writes nothing new.
    saved(await edit(ada.id, id, {}));
    expect((await events({ personId: id })).length).toBe(2);
  });

  it("changes nothing else about the person (FR-003): privacy, owner, consent and lead source stay", async () => {
    const source = await leadSourceId("Ambassador");
    const id = saved(
      await createPerson(linus.id, personForm({ firstName: "Cara", emails: emails("cara@example.com"), private: true, ownerId: String(linus.id), consent: "unsubscribed", leadSourceId: String(source) })),
    );
    saved(await edit(linus.id, id, { ambassador: true }));
    const p = (await getPerson(linus.id, id))!;
    expect(p).toMatchObject({ private: true, owner: { id: linus.id }, consent: "unsubscribed", leadSource: { id: source }, ambassador: true });
    expect(await getPerson(ada.id, id)).toBeNull();
    expect((await events({ personId: id })).map((e) => e.kind)).toEqual(["added", "ambassador_added"]);
  });

  it("unticking keeps what they referred, and takes them off the list and the options (US1 scenario 4)", async () => {
    const cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id });
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    const deal = await makeDeal({ title: "Fake referral · website", stageId: stage, createdBy: ada.id });
    await refer("person", ben, cara);
    await refer("deal", deal, cara);
    saved(await edit(ada.id, cara, { ambassador: false }));
    expect((await referral("person", ben)).referred_by_id).toBe(cara);
    expect((await referral("deal", deal)).referred_by_id).toBe(cara);
    expect(await listAmbassadors(ada.id)).toEqual([]);
    expect(await ambassadorOptions(sql, ada.id)).toEqual([]);
    expect((await getPerson(ada.id, ben))!.referredBy).toEqual({ id: cara, name: "Cara Example", ambassadorPage: true });
  });
});

describe("listAmbassadors (the Ambassadors page)", () => {
  it("lists every visible ambassador A–Z with organisation, counts, open and won totals and latest referral (US1 scenario 2)", async () => {
    const org = await makeOrganisation({ name: "Sample Studios Fake", ownerId: ada.id });
    const zed = await makeAmbassador({ firstName: "Zed", lastName: "Example", createdBy: ada.id });
    const cara = await makeAmbassador({ firstName: "cara", lastName: "Example", createdBy: ada.id, organisationId: org });
    await makePerson({ firstName: "Not", lastName: "Ambassador", createdBy: ada.id });
    const older = new Date(Date.now() - 5 * 86_400_000);
    const newest = new Date(Date.now() - 86_400_000);
    for (const [i, at] of [older, newest].entries()) {
      await refer("person", await makePerson({ firstName: `Ref${i}`, createdBy: ada.id }), cara, at);
    }
    const open = await makeDeal({ title: "Open", stageId: stage, createdBy: ada.id, valuePence: 450000 });
    const won = await makeDeal({ title: "Won", stageId: stage, createdBy: ada.id, valuePence: 400000 });
    const lost = await makeDeal({ title: "Lost", stageId: stage, createdBy: ada.id, valuePence: 150000 });
    const noValue = await makeDeal({ title: "No value", stageId: stage, createdBy: ada.id });
    for (const d of [open, won, lost, noValue]) await refer("deal", d, cara, older);
    await setDeal(won, "won");
    await setDeal(lost, "lost");
    const rows = await listAmbassadors(ada.id);
    expect(rows.map((r) => r.name)).toEqual(["cara Example", "Zed Example"]);
    expect(rows[0]).toMatchObject({
      id: cara, organisation: { id: org, name: "Sample Studios Fake" }, archived: false, people: 2, deals: 4,
      openPence: 450000, wonPence: 400000, lost: 1,
    });
    expect(rows[0].latestReferral?.getTime()).toBe(newest.getTime());
    expect(rows[1]).toMatchObject({ id: zed, organisation: null, people: 0, deals: 0, openPence: 0, wonPence: 0, lost: 0, latestReferral: null });
  });

  it("is empty when the user can see no ambassador (US1 scenario 3)", async () => {
    await makeAmbassador({ firstName: "Dora", createdBy: linus.id, private: true });
    expect(await listAmbassadors(ada.id)).toEqual([]);
  });

  it("lists an archived ambassador marked Archived, never offered until restored (US1 scenario 5)", async () => {
    const cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id, emails: ["cara.ambassador@example.com"] });
    await archivePerson(ada.id, cara);
    expect((await listAmbassadors(ada.id)).map((r) => [r.id, r.archived])).toEqual([[cara, true]]);
    expect(await ambassadorOptions(sql, ada.id)).toEqual([]);
    await restorePerson(ada.id, cara);
    expect(await ambassadorOptions(sql, ada.id)).toEqual([{ id: cara, name: "Cara Example", detail: "cara.ambassador@example.com" }]);
  });
});
