// covers FR-006, FR-007, FR-008, FR-009, US2 scenarios 1–7, US4 scenario 5, edge cases "admin adds a field while a form is
// open", "0, £0 and No", "all ticks removed", "markup", "archived record", "money on a deal"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deleteField, renameFieldChoice, removeFieldChoice, updateField } from "@/server/custom-fields/fields";
import { formFields, readCustomValues } from "@/server/custom-fields/values";
import * as deals from "@/server/deals/deals";
import { listDeals } from "@/server/deals/list";
import { parseDealsQuery } from "@/server/records/list-query";
import { createOrganisation, getOrganisation, updateOrganisation } from "@/server/records/organisations";
import { archivePerson, createPerson, getPerson, updatePerson } from "@/server/records/people";
import type { CustomForm } from "@/server/records/rules";
import { readTimeline } from "@/server/records/timeline";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealForm, makeDeal, makePipeline } from "./deal-helpers";
import { customEvents, makeField, valueRows } from "./custom-helpers";
import { orgForm, personForm, saved } from "./record-helpers";

let ada: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
});
afterAll(closeDb);

const custom = (values: Record<number, string[]>, shown = Object.keys(values).map(Number)): CustomForm => ({ shown, values });
const texts = async (personId: number) => (await readCustomValues(sql, ada.id, { personId })).map((d) => [d.field.name, d.text]);
const version = async (id: number) => (await getPerson(ada.id, id))!.version;

describe("people", () => {
  it("saves every type and reads them formatted; '—' when empty (US2 scenarios 1 and 3)", async () => {
    const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["None", "Vegetarian", "Vegan"] });
    const topics = await makeField({ kind: "person", name: "Topics", type: "multiple_choice", choices: ["AI", "Events", "Hiring"] });
    const birthday = await makeField({ kind: "person", name: "Birthday", type: "date" });
    const head = await makeField({ kind: "person", name: "Head count", type: "number" });
    const budget = await makeField({ kind: "person", name: "Budget", type: "money" });
    const notes = await makeField({ kind: "person", name: "Notes", type: "long_text" });
    const nick = await makeField({ kind: "person", name: "Nickname", type: "text" });
    const nda = await makeField({ kind: "person", name: "NDA", type: "yes_no" });
    const id = saved(await createPerson(ada.id, personForm({
      custom: custom({
        [diet.id]: [String(diet.choices.Vegan)], [topics.id]: [String(topics.choices.Hiring), String(topics.choices.AI)],
        [birthday.id]: ["2026-11-24"], [head.id]: ["1,234.5"], [budget.id]: ["£4,000.50"], [notes.id]: ["line 1\r\nline 2"],
        [nick.id]: [""], [nda.id]: ["yes"],
      }),
    })));
    expect(await texts(id)).toEqual([
      ["Diet", "Vegan"], ["Topics", "AI, Hiring"], ["Birthday", "24 Nov 2026"], ["Head count", "1,234.5"], ["Budget", "£4,000.50"],
      ["Notes", "line 1\nline 2"], ["Nickname", "—"], ["NDA", "Yes"],
    ]);
    // The added event first, then one custom_set per value (long text: "changed" without the text).
    const kinds = (await readTimeline(ada.id, { personId: id })).entries.map((e) => e.kind).reverse();
    expect(kinds[0]).toBe("added");
    expect(await customEvents({ personId: id })).toHaveLength(7);
    expect((await customEvents({ personId: id })).find((e) => e.field_name === "Notes")).toMatchObject({ kind: "custom_changed", old_value: null, new_value: null });
  });

  it("refuses the whole save on an invalid value, naming the field (US2 scenario 2)", async () => {
    const birthday = await makeField({ kind: "person", name: "Birthday", type: "date" });
    const head = await makeField({ kind: "person", name: "Head count", type: "number" });
    const id = await makePerson({ createdBy: ada.id, firstName: "Grace" });
    const r = await updatePerson(ada.id, id, await version(id), personForm({ firstName: "Changed", custom: custom({ [birthday.id]: ["2026-02-30"], [head.id]: ["12"] }) }));
    expect(r).toEqual({ status: "invalid", errors: { [`cf.${birthday.id}`]: { code: "custom_date_invalid", name: "Birthday" } } });
    expect((await getPerson(ada.id, id))!.firstName).toBe("Grace");
    expect(await valueRows()).toBe(0);
    expect(await customEvents({ personId: id })).toEqual([]);
  });

  it("writes set / changed / cleared entries with the actor, none when nothing changed (US2 scenarios 4, 5 and 7)", async () => {
    const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["Vegetarian", "Vegan"] });
    const id = await makePerson({ createdBy: ada.id });
    const save = async (v: string[]) => saved(await updatePerson(ada.id, id, await version(id), personForm({ custom: custom({ [diet.id]: v }) })));
    await save([String(diet.choices.Vegan)]);
    await save([String(diet.choices.Vegan)]);
    await save([String(diet.choices.Vegetarian)]);
    // Renaming the field and the choice later does not rewrite the entries.
    await updateField(ada.id, diet.id, { name: "Food", inList: false });
    await renameFieldChoice(ada.id, diet.choices.Vegetarian, "Veggie");
    await save([]);
    expect(await customEvents({ personId: id })).toEqual([
      { kind: "custom_set", field_name: "Diet", old_value: null, new_value: "Vegan", actor_id: ada.id },
      { kind: "custom_changed", field_name: "Diet", old_value: "Vegan", new_value: "Vegetarian", actor_id: ada.id },
      { kind: "custom_cleared", field_name: "Food", old_value: null, new_value: null, actor_id: ada.id },
    ]);
    expect(await valueRows()).toBe(0);
    const timeline = (await readTimeline(ada.id, { personId: id })).entries.filter((e) => e.kind.startsWith("custom_"));
    expect(timeline.map((e) => [e.kind, e.fieldName, e.oldValue, e.newValue, e.actorName])).toEqual([
      ["custom_cleared", "Food", null, null, "Ada Fake"],
      ["custom_changed", "Diet", "Vegan", "Vegetarian", "Ada Fake"],
      ["custom_set", "Diet", null, "Vegan", "Ada Fake"],
    ]);
  });

  it("keeps a removed choice re-saved untouched, then stops offering it (US2 scenario 6)", async () => {
    const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["Vegan", "Pescatarian"] });
    const topics = await makeField({ kind: "person", name: "Topics", type: "multiple_choice", choices: ["AI", "Old"] });
    const id = await makePerson({ createdBy: ada.id });
    saved(await updatePerson(ada.id, id, await version(id), personForm({
      custom: custom({ [diet.id]: [String(diet.choices.Pescatarian)], [topics.id]: [String(topics.choices.Old)] }),
    })));
    await removeFieldChoice(ada.id, diet.choices.Pescatarian);
    await removeFieldChoice(ada.id, topics.choices.Old);
    const offered = async () => formFields(await readCustomValues(sql, ada.id, { personId: id })).map((f) => f.choices.map((c) => c.name));
    expect(await offered()).toEqual([["Vegan", "Pescatarian"], ["AI", "Old"]]);
    const p = (await getPerson(ada.id, id))!;
    // Saved untouched: kept, no entry.
    saved(await updatePerson(ada.id, id, p.version, personForm({ custom: custom({ [diet.id]: [String(diet.choices.Pescatarian)], [topics.id]: [String(topics.choices.AI), String(topics.choices.Old)] }) })));
    expect(await texts(id)).toEqual([["Diet", "Pescatarian"], ["Topics", "AI, Old"]]);
    saved(await updatePerson(ada.id, id, await version(id), personForm({ custom: custom({ [diet.id]: [String(diet.choices.Vegan)], [topics.id]: [String(topics.choices.AI)] }) })));
    expect(await offered()).toEqual([["Vegan"], ["AI"]]);
    const r = await updatePerson(ada.id, id, await version(id), personForm({ custom: custom({ [diet.id]: [String(diet.choices.Pescatarian)] }) }));
    expect(r).toEqual({ status: "invalid", errors: { [`cf.${diet.id}`]: { code: "custom_choice_invalid", name: "Diet" } } });
  });

  it("ignores a field the form did not show and a field deleted before the save (edge case, US4 scenario 5)", async () => {
    const diet = await makeField({ kind: "person", name: "Diet", type: "text" });
    const later = await makeField({ kind: "person", name: "Added later", type: "text" });
    const gone = await makeField({ kind: "person", name: "Gone", type: "text" });
    const id = await makePerson({ createdBy: ada.id });
    const form = custom({ [diet.id]: ["Vegan"], [later.id]: ["typed?"], [gone.id]: ["lost"] }, [diet.id, gone.id]);
    await deleteField(ada.id, gone.id);
    saved(await updatePerson(ada.id, id, await version(id), personForm({ custom: form })));
    expect(await texts(id)).toEqual([["Diet", "Vegan"], ["Added later", "—"]]);
  });

  it("stores 0, £0 and No as values; clearing every tick clears the value (edge cases)", async () => {
    const n = await makeField({ kind: "person", name: "N", type: "number" });
    const m = await makeField({ kind: "person", name: "M", type: "money" });
    const y = await makeField({ kind: "person", name: "Y", type: "yes_no" });
    const t = await makeField({ kind: "person", name: "Topics", type: "multiple_choice", choices: ["AI"] });
    const id = await makePerson({ createdBy: ada.id });
    saved(await updatePerson(ada.id, id, await version(id), personForm({ custom: custom({ [n.id]: ["0"], [m.id]: ["0"], [y.id]: ["no"], [t.id]: [String(t.choices.AI)] }) })));
    expect(await texts(id)).toEqual([["N", "0"], ["M", "£0"], ["Y", "No"], ["Topics", "AI"]]);
    saved(await updatePerson(ada.id, id, await version(id), personForm({ custom: custom({ [n.id]: ["0"], [m.id]: ["0"], [y.id]: ["no"], [t.id]: [] }) })));
    expect(await valueRows(t.id)).toBe(0);
    expect((await customEvents({ personId: id })).at(-1)).toMatchObject({ kind: "custom_cleared", field_name: "Topics" });
  });

  it("gives markup back as literal text (edge case)", async () => {
    const f = await makeField({ kind: "person", name: "<b>Fake</b>", type: "text" });
    const id = await makePerson({ createdBy: ada.id });
    saved(await updatePerson(ada.id, id, await version(id), personForm({ custom: custom({ [f.id]: ["<i>x</i>"] }) })));
    expect(await texts(id)).toEqual([["<b>Fake</b>", "<i>x</i>"]]);
    expect((await readTimeline(ada.id, { personId: id })).entries.find((e) => e.kind === "custom_set")).toMatchObject({ fieldName: "<b>Fake</b>", newValue: "<i>x</i>" });
  });

  it("an archived person: a custom change is refused, a save without one goes through (spec Clarifications)", async () => {
    const f = await makeField({ kind: "person", name: "Diet", type: "text" });
    const id = await makePerson({ createdBy: ada.id, firstName: "Grace" });
    saved(await updatePerson(ada.id, id, await version(id), personForm({ firstName: "Grace", custom: custom({ [f.id]: ["Vegan"] }) })));
    await archivePerson(ada.id, id);
    const refused = await updatePerson(ada.id, id, await version(id), personForm({ firstName: "Changed", custom: custom({ [f.id]: ["Vegetarian"] }) }));
    expect(refused).toEqual({ status: "invalid", errors: { form: { code: "custom_record_archived" } } });
    expect((await getPerson(ada.id, id))!.firstName).toBe("Grace");
    // The archived edit form shows no custom input, so it sends none.
    saved(await updatePerson(ada.id, id, await version(id), personForm({ firstName: "Changed" })));
    saved(await updatePerson(ada.id, id, await version(id), personForm({ firstName: "Again", custom: custom({ [f.id]: ["Vegan"] }) })));
    expect(await texts(id)).toEqual([["Diet", "Vegan"]]);
    expect((await getPerson(ada.id, id))!.custom.map((d) => d.text)).toEqual(["Vegan"]);
  });
});

describe("organisations and deals", () => {
  it("saves organisation values on add and edit", async () => {
    const code = await makeField({ kind: "organisation", name: "Account code", type: "text" });
    const id = saved(await createOrganisation(ada.id, orgForm({ custom: custom({ [code.id]: ["AC-1"] }) })));
    const org = (await getOrganisation(ada.id, id))!;
    expect(org.custom.map((d) => d.text)).toEqual(["AC-1"]);
    saved(await updateOrganisation(ada.id, id, org.version, orgForm({ custom: custom({ [code.id]: ["AC-2"] }) })));
    expect(await customEvents({ organisationId: id })).toMatchObject([
      { kind: "custom_set", new_value: "AC-1" }, { kind: "custom_changed", old_value: "AC-1", new_value: "AC-2" },
    ]);
    const bad = await updateOrganisation(ada.id, id, (await getOrganisation(ada.id, id))!.version, orgForm({ custom: custom({ [code.id]: ["x".repeat(256)] }) }));
    expect(bad).toEqual({ status: "invalid", errors: { [`cf.${code.id}`]: { code: "custom_text_too_long", name: "Account code" } } });
  });

  it("saves deal values; a money value never changes the board or list totals (edge case)", async () => {
    const { id: pipelineId, stages } = await makePipeline("Sales", ["Lead"]);
    const end = await makeField({ kind: "deal", name: "Contract end", type: "date" });
    const budget = await makeField({ kind: "deal", name: "Budget", type: "money" });
    const id = await makeDeal({ title: "Fakeco", stageId: stages[0], createdBy: ada.id, valuePence: 100000 });
    const boardBefore = (await deals.getBoard(ada.id, pipelineId))!.columns[0].totalPence;
    const listBefore = (await listDeals(ada.id, parseDealsQuery({}))).totalPence;
    const d = (await deals.getDeal(ada.id, id))!;
    const r = await deals.updateDeal(ada.id, id, d.version, { ...deals.dealToForm(d), custom: custom({ [end.id]: ["2027-03-31"], [budget.id]: ["50000"] }) });
    expect(r.status).toBe("saved");
    expect((await deals.getDeal(ada.id, id))!.custom.map((x) => x.text)).toEqual(["31 Mar 2027", "£50,000"]);
    expect((await deals.getBoard(ada.id, pipelineId))!.columns[0].totalPence).toBe(boardBefore);
    expect((await listDeals(ada.id, parseDealsQuery({}))).totalPence).toBe(listBefore);
    const added = await deals.createDeal(ada.id, dealForm({ stageId: String(stages[0]), custom: custom({ [end.id]: ["2027-01-01"] }) }));
    if (added.status !== "saved") throw new Error("not saved");
    expect(await customEvents({ dealId: added.id })).toMatchObject([{ kind: "custom_set", field_name: "Contract end", new_value: "01 Jan 2027" }]);
    // dealToForm gives the stored values back as the inputs hold them.
    expect(deals.dealToForm((await deals.getDeal(ada.id, id))!).custom).toEqual({ shown: [end.id, budget.id], values: { [end.id]: ["2027-03-31"], [budget.id]: ["50000"] } });
  });
});
