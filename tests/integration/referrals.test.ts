// covers SF-114 FR-004–FR-007, SC-006, US2 scenarios 1–7, US4 scenario 3, edge cases "two ambassadors with the same
// name", "lead source Ambassador without the tick", "an archived person or deal"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { ambassadorOptions } from "@/server/records/ambassadors";
import { archivePerson, createPerson, getPerson, personFormChoices, personToForm, updatePerson } from "@/server/records/people";
import type { PersonForm } from "@/server/records/rules";
import { events, makeAmbassador, refer, referral } from "./ambassador-helpers";
import { count, leadSourceId, makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealForm, makeDeal, makePipeline } from "./deal-helpers";
import { personForm, saved } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;
let stage: number;
let pipeline: number;
let cara: number;
let dora: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  const p = await makePipeline("Sales", ["Lead in"]);
  stage = p.stages[0];
  pipeline = p.id;
  cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id });
  dora = await makeAmbassador({ firstName: "Dora", lastName: "Example", createdBy: ada.id });
});
afterAll(closeDb);

async function editPerson(actorId: number, id: number, over: Partial<PersonForm>) {
  const p = (await getPerson(actorId, id))!;
  return updatePerson(actorId, id, p.version, { ...personToForm(p), ...over });
}
async function editDeal(actorId: number, id: number, over: Partial<ReturnType<typeof dealForm>>) {
  const d = (await deals.getDeal(actorId, id))!;
  return deals.updateDeal(actorId, id, d.version, { ...deals.dealToForm(d), ...over });
}
const refused = (code: string) => ({ status: "invalid", errors: { referredBy: { code } } });

describe("Referred by on a person", () => {
  it("records set, changed and cleared with who, and sets / clears referred_at (US2 scenario 3)", async () => {
    const ben = saved(await createPerson(linus.id, personForm({ firstName: "Ben", referredBy: String(cara) })));
    const set = await referral("person", ben);
    expect(set.referred_by_id).toBe(cara);
    expect(set.referred_at).not.toBeNull();
    saved(await editPerson(ada.id, ben, { referredBy: String(dora) }));
    const changed = await referral("person", ben);
    expect(changed.referred_by_id).toBe(dora);
    expect(changed.referred_at!.getTime()).toBeGreaterThanOrEqual(set.referred_at!.getTime());
    saved(await editPerson(ada.id, ben, { referredBy: "" }));
    expect(await referral("person", ben)).toMatchObject({ referred_by_id: null, referred_at: null });
    expect((await events({ personId: ben })).map((e) => [e.kind, e.actor_id, e.from_person_id, e.related_person_id])).toEqual([
      ["added", linus.id, null, null],
      ["referrer_set", linus.id, null, cara],
      ["referrer_changed", ada.id, cara, dora],
      ["referrer_cleared", ada.id, null, null],
    ]);
    const p = (await getPerson(ada.id, ben))!;
    expect(p.referredBy).toBeNull();
  });

  it("shows Referred by with a link to the ambassador page (US2 scenario 2)", async () => {
    const ben = saved(await createPerson(ada.id, personForm({ firstName: "Ben", referredBy: String(cara) })));
    expect((await getPerson(ada.id, ben))!.referredBy).toEqual({ id: cara, name: "Cara Example", ambassadorPage: true });
    expect(personToForm((await getPerson(ada.id, ben))!).referredBy).toBe(String(cara));
  });

  it("refuses the person as their own referrer, nothing saved (US2 scenario 4)", async () => {
    const before = await referral("person", cara);
    const n = await count("timeline_events");
    expect(await editPerson(ada.id, cara, { referredBy: String(cara), role: "Changed" })).toEqual(refused("referrer_self"));
    expect(await referral("person", cara)).toEqual(before);
    expect(await count("timeline_events")).toBe(n);
    const choices = await personFormChoices(ada.id, (await getPerson(ada.id, cara))!);
    expect(choices.ambassadors.map((a) => a.id)).toEqual([dora]);
  });

  it("refuses a non-ambassador, an archived or hidden ambassador, an unknown id and junk, nothing saved (US2 scenario 5, SC-006)", async () => {
    const plain = await makePerson({ firstName: "Plain", createdBy: ada.id, leadSourceId: await leadSourceId("Ambassador") });
    const archived = await makeAmbassador({ firstName: "Archived", createdBy: ada.id, archived: true });
    const hidden = await makeAmbassador({ firstName: "Hidden", createdBy: linus.id, private: true });
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    const persons = await count("persons");
    for (const bad of [String(plain), String(archived), String(hidden), "999999", "abc"]) {
      expect(await createPerson(ada.id, personForm({ firstName: "New", referredBy: bad })), bad).toEqual(refused("referrer_invalid"));
      const before = await referral("person", ben);
      expect(await editPerson(ada.id, ben, { referredBy: bad, role: "x" }), bad).toEqual(refused("referrer_invalid"));
      expect(await referral("person", ben)).toEqual(before);
    }
    expect(await count("persons")).toBe(persons);
    expect((await events({ personId: ben })).length).toBe(0);
  });

  it("keeps an unchanged referrer who was unticked or archived since, and 'keep' (US2 scenario 7)", async () => {
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    const eli = await makePerson({ firstName: "Eli", createdBy: ada.id });
    await refer("person", ben, cara);
    await refer("person", eli, dora);
    await sql`update persons set is_ambassador = false where id = ${cara}`;
    await archivePerson(ada.id, dora);
    saved(await editPerson(ada.id, ben, { role: "Changed" }));
    saved(await editPerson(ada.id, eli, { referredBy: "keep", role: "Changed" }));
    expect((await referral("person", ben)).referred_by_id).toBe(cara);
    expect((await referral("person", eli)).referred_by_id).toBe(dora);
    expect((await events({ personId: ben })).map((e) => e.kind)).toEqual(["edited"]);
  });

  it("an archived person's tick and referrer cannot be changed (edge case 'an archived person or deal')", async () => {
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id, archived: true });
    saved(await editPerson(ada.id, ben, { referredBy: String(cara), ambassador: true }));
    expect(await referral("person", ben)).toMatchObject({ referred_by_id: null, is_ambassador: false });
  });

  it("leaves the lead source as it was (edge case 'lead source Ambassador')", async () => {
    const ben = saved(await createPerson(ada.id, personForm({ firstName: "Ben", referredBy: String(cara) })));
    expect((await getPerson(ada.id, ben))!.leadSource).toBeNull();
  });
});

describe("Referred by on a deal", () => {
  it("records set on add, changed and cleared on edit (US2 scenarios 1–3)", async () => {
    const r = await deals.createDeal(linus.id, dealForm({ pipelineId: String(pipeline), stageId: String(stage), referredBy: String(cara) }));
    if (r.status !== "saved") throw new Error(JSON.stringify(r));
    expect((await deals.getDeal(ada.id, r.id))!.referredBy).toEqual({ id: cara, name: "Cara Example", ambassadorPage: true });
    saved(await editDeal(ada.id, r.id, { referredBy: String(dora) }));
    saved(await editDeal(ada.id, r.id, { referredBy: "" }));
    expect(await referral("deal", r.id)).toMatchObject({ referred_by_id: null, referred_at: null });
    expect((await events({ dealId: r.id })).map((e) => [e.kind, e.actor_id, e.from_person_id, e.related_person_id])).toEqual([
      ["added", linus.id, null, null],
      ["referrer_set", linus.id, null, cara],
      ["referrer_changed", ada.id, cara, dora],
      ["referrer_cleared", ada.id, null, null],
    ]);
  });

  it("refuses a non-ambassador and junk, nothing saved (SC-006)", async () => {
    const plain = await makePerson({ firstName: "Plain", createdBy: ada.id });
    const d = await makeDeal({ title: "Fake deal", stageId: stage, createdBy: ada.id });
    const before = await referral("deal", d);
    for (const bad of [String(plain), "abc"]) {
      expect(await editDeal(ada.id, d, { referredBy: bad, title: "Changed" })).toEqual(refused("referrer_invalid"));
      expect(await deals.createDeal(ada.id, dealForm({ pipelineId: String(pipeline), stageId: String(stage), referredBy: bad }))).toEqual(refused("referrer_invalid"));
    }
    expect(await referral("deal", d)).toEqual(before);
  });

  it("never changes the referrer when the main person changes (US2 scenario 6)", async () => {
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    await refer("person", ben, dora);
    const d = await makeDeal({ title: "Fake deal", stageId: stage, createdBy: ada.id });
    await refer("deal", d, cara);
    saved(await editDeal(ada.id, d, { personId: String(ben) }));
    expect((await referral("deal", d)).referred_by_id).toBe(cara);
  });

  it("offers the ambassadors and each person's offered referrer to pre-fill the add form (US2 scenario 6, FR-007)", async () => {
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    const eli = await makePerson({ firstName: "Eli", createdBy: ada.id });
    const fay = await makePerson({ firstName: "Fay", createdBy: ada.id });
    const hidden = await makeAmbassador({ firstName: "Hidden", createdBy: linus.id, private: true });
    await refer("person", ben, cara);
    await refer("person", eli, hidden);
    await refer("person", fay, dora);
    await archivePerson(ada.id, dora);
    const choices = await deals.dealFormChoices(ada.id, null);
    expect(choices.ambassadors.map((a) => a.id)).toEqual([cara]);
    const by = Object.fromEntries(choices.people.map((p) => [p.id, p.referredById]));
    expect(by[ben]).toBe(cara);
    expect(by[eli]).toBeNull();
    expect(by[fay]).toBeNull();
  });
});

describe("ambassadorOptions", () => {
  it("tells two same-name ambassadors apart by organisation and first email (edge case)", async () => {
    await sql`update persons set is_ambassador = false`;
    const a = await makeOrganisation({ name: "Sample Studios Fake", ownerId: ada.id });
    const b = await makeOrganisation({ name: "Other Fake Ltd", ownerId: ada.id });
    const one = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id, organisationId: a, emails: ["cara1@example.com", "x@example.com"] });
    const two = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id, organisationId: b, emails: ["cara2@example.com"] });
    expect(await ambassadorOptions(sql, ada.id)).toEqual([
      { id: one, name: "Cara Example", detail: "Sample Studios Fake · cara1@example.com" },
      { id: two, name: "Cara Example", detail: "Other Fake Ltd · cara2@example.com" },
    ]);
  });
});
