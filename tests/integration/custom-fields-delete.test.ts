// covers FR-004, SC-005, US4 scenarios 1–4, US6 scenario 2, edge case "record deleted"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { countValues, deleteField, listFields } from "@/server/custom-fields/fields";
import { deleteDeal } from "@/server/deals/deals";
import { templates } from "@/server/messages";
import { deleteOrganisation } from "@/server/records/organisations";
import { deletePerson } from "@/server/records/people";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeField, setValue, valueRows } from "./custom-helpers";

let ada: TestUser;
let linus: TestUser;
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

describe("the delete confirmation's count", () => {
  it("counts shared, private (hidden from the admin) and archived records; 0 when none (US4 scenario 1, US6 scenario 2)", async () => {
    const diet = await makeField({ kind: "person", name: "Diet", type: "text" });
    expect(await countValues(diet.id)).toBe(0);
    const shared = await makePerson({ createdBy: ada.id });
    const hidden = await makePerson({ createdBy: linus.id, private: true });
    const archived = await makePerson({ createdBy: ada.id, archived: true });
    await makePerson({ createdBy: ada.id });
    for (const id of [shared, hidden, archived]) await setValue(diet.id, { personId: id }, "text_value", "Vegan");
    expect(await countValues(diet.id)).toBe(3);
  });

  it("drops by one when a person, organisation or deal is deleted (edge case)", async () => {
    const pf = await makeField({ kind: "person", name: "P", type: "yes_no" });
    const of = await makeField({ kind: "organisation", name: "O", type: "number" });
    const df = await makeField({ kind: "deal", name: "D", type: "date" });
    const { stages } = await makePipeline("Sales", ["Lead"]);
    const p = await makePerson({ createdBy: ada.id });
    const o = await makeOrganisation({ name: "Fakeco", ownerId: ada.id });
    const d = await makeDeal({ title: "Deal", stageId: stages[0], createdBy: ada.id });
    await setValue(pf.id, { personId: p }, "bool_value", false);
    await setValue(pf.id, { personId: await makePerson({ createdBy: ada.id }) }, "bool_value", true);
    await setValue(of.id, { organisationId: o }, "number_value", "0");
    await setValue(df.id, { dealId: d }, "date_value", "2026-01-01");
    expect(await countValues(pf.id)).toBe(2);
    await deletePerson(ada.id, p);
    await deleteOrganisation(ada.id, o);
    await deleteDeal(ada.id, d);
    expect([await countValues(pf.id), await countValues(of.id), await countValues(df.id)]).toEqual([1, 0, 0]);
  });

  it("says how many records of the kind have a value", () => {
    expect(templates.custom_delete_count(3, "person", "Diet")).toBe("3 people have a value in Diet. Deleting the field deletes these values for good.");
    expect(templates.custom_delete_count(1, "person", "Diet")).toBe("1 person has a value in Diet. Deleting the field deletes these values for good.");
    expect(templates.custom_delete_count(1, "organisation", "Code")).toMatch(/^1 organisation has a value in Code\./);
    expect(templates.custom_delete_count(2, "organisation", "Code")).toMatch(/^2 organisations have/);
    expect(templates.custom_delete_count(1, "deal", "NDA")).toMatch(/^1 deal has/);
    expect(templates.custom_delete_count(5, "deal", "NDA")).toMatch(/^5 deals have/);
    expect(templates.custom_delete_none("Diet")).toBe("No record has a value in Diet.");
    expect(templates.custom_field_deleted("Diet")).toBe("Diet deleted.");
  });
});

describe("deleteField", () => {
  it("deletes the field, its choices and values; renumbers; writes no entry; keeps earlier entries (US4 scenarios 2 and 4)", async () => {
    const a = await makeField({ kind: "person", name: "A", type: "text" });
    const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["Vegan"] });
    await makeField({ kind: "person", name: "C", type: "text" });
    const p = await makePerson({ createdBy: ada.id });
    await setValue(diet.id, { personId: p }, "choice_id", diet.choices.Vegan);
    await setValue(a.id, { personId: p }, "text_value", "keep");
    await sql`insert into timeline_events (person_id, kind, actor_id, field_name, new_value) values (${p}, 'custom_set', ${ada.id}, 'Diet', 'Vegan')`;
    const events = await sql`select count(*)::int as n from timeline_events`;
    expect(await deleteField(ada.id, diet.id)).toMatchObject({ ok: true, name: "Diet", kind: "person" });
    expect((await listFields("person")).map((f) => [f.name, f.position])).toEqual([["A", 1], ["C", 2]]);
    expect(await valueRows(diet.id)).toBe(0);
    expect(await valueRows()).toBe(1);
    expect((await sql`select count(*)::int as n from custom_field_choices`)[0].n).toBe(0);
    expect(await sql`select count(*)::int as n from timeline_events`).toEqual(events);
    expect((await sql`select field_name, new_value from timeline_events where kind = 'custom_set'`)[0]).toEqual({ field_name: "Diet", new_value: "Vegan" });
  });

  it("is refused for a user who is not an admin, with nothing deleted", async () => {
    const f = await makeField({ kind: "deal", name: "NDA", type: "yes_no" });
    expect(await deleteField(linus.id, f.id)).toEqual({ ok: false, code: "forbidden" });
    expect(await deleteField(ada.id, 999999)).toMatchObject({ ok: false, code: "not_found" });
    expect(await listFields("deal")).toHaveLength(1);
  });
});
