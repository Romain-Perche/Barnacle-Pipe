// covers FR-010, FR-011, US3 scenarios 1–3, edge case "lists with no custom field shown look as today"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { listShownFields } from "@/server/custom-fields/fields";
import type { RecordKind } from "@/server/custom-fields/rules";
import { customColumns } from "@/server/custom-fields/values";
import { listDeals } from "@/server/deals/list";
import { knownCustomQuery, parseDealsQuery, parseOrganisationsQuery, parsePeopleQuery, type Params } from "@/server/records/list-query";
import { listOrganisations } from "@/server/records/organisations";
import { listPeople } from "@/server/records/people";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeField, setValue } from "./custom-helpers";

let ada: TestUser;
let linus: TestUser;
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

const people = async (params: Params) => {
  const shown = await listShownFields("person");
  const r = await listPeople(ada.id, knownCustomQuery(parsePeopleQuery(params), shown), shown);
  return { names: r.rows.map((x) => x.name), total: r.total, ids: r.rows.map((x) => x.id) };
};

describe("people list", () => {
  it("adds columns for shown fields only, in order, formatted; long text cut at 80 (US3 scenario 1)", async () => {
    const notes = await makeField({ kind: "person", name: "Notes", type: "long_text", inList: true });
    await makeField({ kind: "person", name: "Hidden", type: "text" });
    const budget = await makeField({ kind: "person", name: "Budget", type: "money", inList: true });
    const a = await makePerson({ createdBy: ada.id, firstName: "A" });
    const b = await makePerson({ createdBy: ada.id, firstName: "B" });
    await setValue(notes.id, { personId: a }, "text_value", "x".repeat(100));
    await setValue(budget.id, { personId: a }, "money_pence", 400050);
    const shown = await listShownFields("person");
    expect(shown.map((f) => f.name)).toEqual(["Notes", "Budget"]);
    const cells = await customColumns("person", shown, [a, b]);
    expect(cells.get(a)).toEqual({ [notes.id]: `${"x".repeat(80)}…`, [budget.id]: "£4,000.50" });
    expect(cells.get(b)).toEqual({});
  });

  it("sorts by each sortable type, empty values last both ways (US3 scenario 2, FR-011)", async () => {
    const t = await makeField({ kind: "person", name: "T", type: "text", inList: true });
    const n = await makeField({ kind: "person", name: "N", type: "number", inList: true });
    const m = await makeField({ kind: "person", name: "M", type: "money", inList: true });
    const d = await makeField({ kind: "person", name: "D", type: "date", inList: true });
    const c = await makeField({ kind: "person", name: "C", type: "single_choice", inList: true, choices: ["Zed", "Alpha"] });
    const y = await makeField({ kind: "person", name: "Y", type: "yes_no", inList: true });
    const p1 = await makePerson({ createdBy: ada.id, firstName: "One" });
    const p2 = await makePerson({ createdBy: ada.id, firstName: "Two" });
    await makePerson({ createdBy: ada.id, firstName: "Zero" });
    await setValue(t.id, { personId: p1 }, "text_value", "banana");
    await setValue(t.id, { personId: p2 }, "text_value", "Apple");
    await setValue(n.id, { personId: p1 }, "number_value", "10");
    await setValue(n.id, { personId: p2 }, "number_value", "-2.5");
    await setValue(m.id, { personId: p1 }, "money_pence", 0);
    await setValue(m.id, { personId: p2 }, "money_pence", 100);
    await setValue(d.id, { personId: p1 }, "date_value", "2026-01-02");
    await setValue(d.id, { personId: p2 }, "date_value", "2025-12-31");
    await setValue(c.id, { personId: p1 }, "choice_id", c.choices.Alpha);
    await setValue(c.id, { personId: p2 }, "choice_id", c.choices.Zed);
    await setValue(y.id, { personId: p1 }, "bool_value", true);
    await setValue(y.id, { personId: p2 }, "bool_value", false);
    const order = async (id: number, dir: string) => (await people({ sort: `cf${id}`, dir })).names.map((x) => x.split(" ")[0]);
    expect(await order(t.id, "asc")).toEqual(["Two", "One", "Zero"]);
    expect(await order(t.id, "desc")).toEqual(["One", "Two", "Zero"]);
    expect(await order(n.id, "asc")).toEqual(["Two", "One", "Zero"]);
    expect(await order(n.id, "desc")).toEqual(["One", "Two", "Zero"]);
    expect(await order(m.id, "asc")).toEqual(["One", "Two", "Zero"]);
    expect(await order(d.id, "asc")).toEqual(["Two", "One", "Zero"]);
    expect(await order(d.id, "desc")).toEqual(["One", "Two", "Zero"]);
    // Choices sort by the admin's order: Zed before Alpha.
    expect(await order(c.id, "asc")).toEqual(["Two", "One", "Zero"]);
    expect(await order(y.id, "asc")).toEqual(["Two", "One", "Zero"]);
    expect(await order(y.id, "desc")).toEqual(["One", "Two", "Zero"]);
  });

  it("filters by each type, combined with owner and search (US3 scenario 3)", async () => {
    const t = await makeField({ kind: "person", name: "T", type: "long_text", inList: true });
    const n = await makeField({ kind: "person", name: "N", type: "number", inList: true });
    const m = await makeField({ kind: "person", name: "M", type: "money", inList: true });
    const d = await makeField({ kind: "person", name: "D", type: "date", inList: true });
    const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", inList: true, choices: ["Vegan", "Other"] });
    const topics = await makeField({ kind: "person", name: "Topics", type: "multiple_choice", inList: true, choices: ["AI", "Events"] });
    const y = await makeField({ kind: "person", name: "Y", type: "yes_no", inList: true });
    const p1 = await makePerson({ createdBy: ada.id, firstName: "One" });
    const p2 = await makePerson({ createdBy: ada.id, ownerId: linus.id, firstName: "Two" });
    await makePerson({ createdBy: ada.id, firstName: "Zero" });
    await setValue(t.id, { personId: p1 }, "text_value", "Likes 100% cotton_wool");
    await setValue(t.id, { personId: p2 }, "text_value", "likes 1000 cottons");
    await setValue(n.id, { personId: p1 }, "number_value", "0");
    await setValue(n.id, { personId: p2 }, "number_value", "1234.5");
    await setValue(m.id, { personId: p1 }, "money_pence", 0);
    await setValue(m.id, { personId: p2 }, "money_pence", 400000);
    await setValue(d.id, { personId: p1 }, "date_value", "2026-01-01");
    await setValue(d.id, { personId: p2 }, "date_value", "2026-06-30");
    await setValue(diet.id, { personId: p1 }, "choice_id", diet.choices.Vegan);
    await setValue(diet.id, { personId: p2 }, "choice_id", diet.choices.Vegan);
    await setValue(topics.id, { personId: p1 }, "choice_ids", [topics.choices.AI, topics.choices.Events]);
    await setValue(topics.id, { personId: p2 }, "choice_ids", [topics.choices.Events]);
    await setValue(y.id, { personId: p1 }, "bool_value", false);
    const first = async (params: Params) => (await people(params)).names.map((x) => x.split(" ")[0]);
    expect(await first({ [`cf${t.id}`]: "LIKES" })).toEqual(["One", "Two"]);
    expect(await first({ [`cf${t.id}`]: "100%" })).toEqual(["One"]);
    expect(await first({ [`cf${t.id}`]: "n_w" })).toEqual(["One"]);
    expect(await first({ [`cf${n.id}_from`]: "0", [`cf${n.id}_to`]: "0" })).toEqual(["One"]);
    expect(await first({ [`cf${n.id}_from`]: "1,234.5" })).toEqual(["Two"]);
    expect(await first({ [`cf${m.id}_to`]: "0" })).toEqual(["One"]);
    expect(await first({ [`cf${m.id}_from`]: "£4,000" })).toEqual(["Two"]);
    expect(await first({ [`cf${d.id}_from`]: "2026-01-01", [`cf${d.id}_to`]: "2026-06-29" })).toEqual(["One"]);
    expect(await first({ [`cf${diet.id}`]: String(diet.choices.Vegan) })).toEqual(["One", "Two"]);
    expect(await first({ [`cf${diet.id}`]: "empty" })).toEqual(["Zero"]);
    expect(await first({ [`cf${topics.id}`]: String(topics.choices.AI) })).toEqual(["One"]);
    expect(await first({ [`cf${y.id}`]: "no" })).toEqual(["One"]);
    expect(await first({ [`cf${y.id}`]: "yes" })).toEqual([]);
    expect(await first({ [`cf${y.id}`]: "empty" })).toEqual(["Two", "Zero"]);
    // Combined with the built-in filters.
    expect(await first({ [`cf${diet.id}`]: String(diet.choices.Vegan), owner: String(linus.id) })).toEqual(["Two"]);
    expect(await first({ [`cf${diet.id}`]: String(diet.choices.Vegan), q: "one" })).toEqual(["One"]);
    expect((await people({ [`cf${diet.id}`]: String(diet.choices.Vegan) })).total).toBe(2);
  });

  it("with no shown field, the list is as before (edge case)", async () => {
    for (const n of ["A", "B"]) await makePerson({ createdBy: ada.id, firstName: n });
    const plain = await listPeople(ada.id, parsePeopleQuery({}));
    const hidden = await makeField({ kind: "person", name: "Hidden", type: "text" });
    expect(await people({ [`cf${hidden.id}`]: "x", sort: `cf${hidden.id}` })).toMatchObject({ total: plain.total, names: plain.rows.map((r) => r.name) });
  });
});

describe("organisations and deals lists", () => {
  const shown = (kind: RecordKind) => listShownFields(kind);
  it("filter and sort the organisations list", async () => {
    const code = await makeField({ kind: "organisation", name: "Code", type: "text", inList: true });
    const a = await makeOrganisation({ name: "Alpha Fake", ownerId: ada.id });
    const b = await makeOrganisation({ name: "Beta Fake", ownerId: ada.id });
    await setValue(code.id, { organisationId: a }, "text_value", "ZZ");
    await setValue(code.id, { organisationId: b }, "text_value", "AA");
    const f = await shown("organisation");
    const list = async (params: Params) => (await listOrganisations(ada.id, knownCustomQuery(parseOrganisationsQuery(params), f), f)).rows.map((r) => r.name);
    expect(await list({ sort: `cf${code.id}` })).toEqual(["Beta Fake", "Alpha Fake"]);
    expect(await list({ [`cf${code.id}`]: "z" })).toEqual(["Alpha Fake"]);
  });

  it("the deal list's count and total follow a custom filter (US3 scenario 3)", async () => {
    const { stages } = await makePipeline("Sales", ["Lead"]);
    const nda = await makeField({ kind: "deal", name: "NDA", type: "yes_no", inList: true });
    const a = await makeDeal({ title: "A", stageId: stages[0], createdBy: ada.id, valuePence: 1000 });
    await makeDeal({ title: "B", stageId: stages[0], createdBy: ada.id, valuePence: 2000 });
    await setValue(nda.id, { dealId: a }, "bool_value", true);
    const f = await shown("deal");
    const list = await listDeals(ada.id, knownCustomQuery(parseDealsQuery({ [`cf${nda.id}`]: "yes" }), f), f);
    expect(list).toMatchObject({ total: 1, totalPence: 1000 });
    expect(list.rows.map((r) => r.title)).toEqual(["A"]);
    const sorted = await listDeals(ada.id, knownCustomQuery(parseDealsQuery({ sort: `cf${nda.id}`, dir: "desc" }), f), f);
    expect(sorted.rows.map((r) => r.title)).toEqual(["A", "B"]);
  });
});
