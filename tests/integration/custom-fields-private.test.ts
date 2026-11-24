// covers FR-015, SC-004, US6 scenarios 1–3, edge case "hand-over"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { countValues, listShownFields } from "@/server/custom-fields/fields";
import { customFilterOptions, readCustomValues } from "@/server/custom-fields/values";
import { updateDeal } from "@/server/deals/deals";
import { listDeals } from "@/server/deals/list";
import { previewImport } from "@/server/imports/imports";
import { handOverPrivateRecords } from "@/server/records/handover";
import { knownCustomQuery, parseDealsQuery, parsePeopleQuery, type Params } from "@/server/records/list-query";
import { getPerson, listPeople, updatePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealForm, makeDeal, makePipeline } from "./deal-helpers";
import { makeField, setValue } from "./custom-helpers";
import { uploaded, utf8 } from "./import-helpers";
import { personForm } from "./record-helpers";

let ada: TestUser, grace: TestUser, linus: TestUser, margaret: TestUser;
let diet: Awaited<ReturnType<typeof makeField>>;
let nda: Awaited<ReturnType<typeof makeField>>;
let hiddenPerson: number, sharedPerson: number, hiddenDeal: number, org: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", inList: true, choices: ["Vegan", "Old"], removed: ["Old"] });
  nda = await makeField({ kind: "deal", name: "NDA", type: "yes_no", inList: true });
  org = await makeOrganisation({ name: "Fakeco", ownerId: ada.id });
  hiddenPerson = await makePerson({ createdBy: ada.id, firstName: "Hidden", private: true, emails: ["hidden@fakeco.example"], organisationId: org });
  sharedPerson = await makePerson({ createdBy: ada.id, firstName: "Shared", organisationId: org });
  await setValue(diet.id, { personId: hiddenPerson }, "choice_id", diet.choices.Old);
  const { stages } = await makePipeline("Sales", ["Lead"]);
  hiddenDeal = await makeDeal({ title: "Hidden deal", stageId: stages[0], createdBy: linus.id, private: true, valuePence: 5000, organisationId: org, personId: sharedPerson });
  await makeDeal({ title: "Shared deal", stageId: stages[0], createdBy: ada.id, valuePence: 100 });
  await setValue(nda.id, { dealId: hiddenDeal }, "bool_value", true);
  await sql`insert into timeline_events (deal_id, kind, actor_id, field_name, new_value) values (${hiddenDeal}, 'custom_set', ${linus.id}, 'NDA', 'Yes')`;
});
afterAll(closeDb);

const people = async (viewer: number, params: Params) => {
  const shown = await listShownFields("person");
  const r = await listPeople(viewer, knownCustomQuery(parsePeopleQuery(params), shown), shown);
  return { names: r.rows.map((x) => x.name), total: r.total };
};
const deals = async (viewer: number, params: Params) => {
  const shown = await listShownFields("deal");
  const r = await listDeals(viewer, knownCustomQuery(parseDealsQuery(params), shown), shown);
  return { titles: r.rows.map((x) => x.title), total: r.total, totalPence: r.totalPence };
};

describe("a hidden record's custom values", () => {
  it("are never read, listed, matched, sorted or counted for those it is hidden from (US6 scenarios 1 and 3)", async () => {
    for (const viewer of [grace, margaret]) {
      expect(await readCustomValues(sql, viewer.id, { personId: hiddenPerson })).toEqual([]);
      expect(await readCustomValues(sql, viewer.id, { dealId: hiddenDeal })).toEqual([]);
      for (const params of [{ [`cf${diet.id}`]: String(diet.choices.Old) }, { [`cf${diet.id}`]: "empty" }, { sort: `cf${diet.id}` }, { sort: `cf${diet.id}`, dir: "desc" }]) {
        const list = await people(viewer.id, params);
        expect(list.names.some((n) => n.startsWith("Hidden")), JSON.stringify(params)).toBe(false);
        expect(list.total).toBe(list.names.length);
      }
      for (const params of [{ [`cf${nda.id}`]: "yes" }, { [`cf${nda.id}`]: "empty" }, { sort: `cf${nda.id}` }]) {
        const list = await deals(viewer.id, params);
        expect(list.titles).not.toContain("Hidden deal");
        expect(list.totalPence).toBe(list.titles.includes("Shared deal") ? 100 : 0);
      }
      expect(await deals(viewer.id, { [`cf${nda.id}`]: "yes" })).toEqual({ titles: [], total: 0, totalPence: 0 });
    }
    // The owner sees them.
    expect((await people(ada.id, { [`cf${diet.id}`]: String(diet.choices.Old) })).names).toEqual(["Hidden Person"]);
    expect(await deals(linus.id, { [`cf${nda.id}`]: "yes" })).toEqual({ titles: ["Hidden deal"], total: 1, totalPence: 5000 });
  });

  it("never offer a removed choice only a hidden record has", async () => {
    const shown = await listShownFields("person");
    expect((await customFilterOptions(grace.id, "person", shown))[diet.id].map((c) => c.name)).toEqual(["Vegan"]);
    expect((await customFilterOptions(ada.id, "person", shown))[diet.id].map((c) => c.name)).toEqual(["Vegan", "Old"]);
  });

  it("cannot be changed by a direct request (US6 scenario 3)", async () => {
    const form = { shown: [diet.id], values: { [diet.id]: [String(diet.choices.Vegan)] } };
    expect(await updatePerson(grace.id, hiddenPerson, 1, personForm({ custom: form }))).toEqual({ status: "not_found" });
    const dealCustom = { shown: [nda.id], values: { [nda.id]: ["no"] } };
    expect(await updateDeal(margaret.id, hiddenDeal, 1, dealForm({ custom: dealCustom }))).toEqual({ status: "not_found" });
    expect(await sql`select choice_id::int as c from custom_values where person_id = ${hiddenPerson}`).toEqual([{ c: diet.choices.Old }]);
    expect(await sql`select bool_value from custom_values where deal_id = ${hiddenDeal}`).toEqual([{ bool_value: true }]);
  });

  it("do not show on a person's or an organisation's timeline through the hidden deal", async () => {
    for (const target of [{ personId: sharedPerson }, { organisationId: org }]) {
      const entries = (await readTimeline(grace.id, target)).entries;
      expect(entries.some((e) => e.kind === "custom_set")).toBe(false);
      expect((await readTimeline(linus.id, target)).entries.some((e) => e.kind === "custom_set")).toBe(true);
    }
  });

  it("are counted by number only in the delete confirmation (US6 scenario 2)", async () => {
    expect(await countValues(diet.id)).toBe(1);
    expect(await countValues(nda.id)).toBe(1);
  });

  it("name no hidden person in the CSV preview", async () => {
    const id = await uploaded(grace.id, "people", utf8("First name,Email,Diet\nNew,hidden@fakeco.example,Vegan\n"));
    const preview = await previewImport(grace.id, id);
    if (!("names" in preview)) throw new Error("no preview");
    expect(preview.names.people.size).toBe(0);
    expect(JSON.stringify(preview)).not.toContain("Hidden");
  });

  it("follow the record through a hand-over (edge case)", async () => {
    const alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
    const mine = await makePerson({ createdBy: alan.id, private: true, firstName: "Alans" });
    await setValue(diet.id, { personId: mine }, "choice_id", diet.choices.Vegan);
    expect(await readCustomValues(sql, margaret.id, { personId: mine })).toEqual([]);
    await handOverPrivateRecords(ada.id, alan.id, margaret.id);
    expect((await getPerson(margaret.id, mine))!.custom.map((d) => [d.field.name, d.text])).toEqual([["Diet", "Vegan"]]);
  });
});
