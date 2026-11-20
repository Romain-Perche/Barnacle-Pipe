// covers SF-95 FR-017, US5 scenarios 3–4, Edge Cases (a removed deal label stays on its deals, in the list and the filter;
// it is offered on the edit form only of a deal that has it)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { dealFilterOptions, listDeals } from "@/server/deals/list";
import { addChoice, listChoices, removeChoice, renameChoice } from "@/server/records/choices";
import { parseDealsQuery } from "@/server/records/list-query";
import { personFormChoices } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { count, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealEvents, dealForm, labelDeal, makeDeal, makeDealLabel, makePipeline } from "./deal-helpers";

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

const dealLabels = async () => (await listChoices("deal_label")).map((c) => c.name);
const labelIdsOf = async (dealId: number) =>
  (await sql<{ label_id: number }[]>`select label_id::int as label_id from deal_label_links where deal_id = ${dealId} order by label_id`).map((r) => r.label_id);
const editForm = (labelIds: number[], over = {}) => dealForm({ ownerId: String(ada.id), labelIds: labelIds.map(String), ...over });

describe("the deal label list (admins)", () => {
  it("adds, renames and removes deal labels apart from people labels", async () => {
    expect(await addChoice(ada.id, "deal_label", "  Hot ")).toEqual({ ok: true });
    expect(await dealLabels()).toEqual(["Hot"]);
    expect((await listChoices("label")).length).toBe(0);
    const [{ id }] = await listChoices("deal_label");
    expect(await renameChoice(ada.id, "deal_label", id, "Very hot")).toEqual({ ok: true });
    expect(await dealLabels()).toEqual(["Very hot"]);
    expect(await removeChoice(ada.id, "deal_label", id)).toEqual({ ok: true });
    expect(await dealLabels()).toEqual([]);
    // Adding the name again brings the removed entry back.
    expect(await addChoice(ada.id, "deal_label", "very HOT")).toEqual({ ok: true });
    expect(await count("deal_labels")).toBe(1);
  });

  it("refuses a name another deal label has, ignoring case and spaces, with deal_label_exists", async () => {
    await addChoice(ada.id, "deal_label", "Hot");
    await addChoice(ada.id, "deal_label", "Warm");
    expect(await addChoice(ada.id, "deal_label", " hot ")).toEqual({ ok: false, code: "deal_label_exists" });
    const warm = (await listChoices("deal_label")).find((c) => c.name === "Warm")!;
    expect(await renameChoice(ada.id, "deal_label", warm.id, "HOT")).toEqual({ ok: false, code: "deal_label_exists" });
    // People labels keep their own message and may share a name with a deal label.
    expect(await addChoice(ada.id, "label", "Hot")).toEqual({ ok: true });
    expect(await addChoice(ada.id, "label", "hot")).toEqual({ ok: false, code: "choice_exists" });
    expect(await count("deal_labels")).toBe(2);
  });

  it("refuses a non-admin; nothing is saved", async () => {
    expect(await addChoice(linus.id, "deal_label", "Hot")).toEqual({ ok: false, code: "forbidden" });
    const hot = await makeDealLabel("Hot");
    expect(await renameChoice(linus.id, "deal_label", hot, "Cold")).toEqual({ ok: false, code: "forbidden" });
    expect(await removeChoice(linus.id, "deal_label", hot)).toEqual({ ok: false, code: "forbidden" });
    expect(await dealLabels()).toEqual(["Hot"]);
  });
});

describe("labels on deals", () => {
  it("are saved from the edit form and recorded as 'Labels'; the list shows and filters them", async () => {
    const hot = await makeDealLabel("Hot");
    const warm = await makeDealLabel("Warm");
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    expect((await deals.updateDeal(linus.id, id, 1, editForm([warm, hot]))).status).toBe("saved");
    expect(await labelIdsOf(id)).toEqual([hot, warm].sort((a, b) => a - b));
    expect((await dealEvents(id)).at(-1)).toMatchObject({ kind: "edited", fields: ["Labels"] });
    const [line] = await readTimeline(ada.id, { dealId: id });
    expect(line.fields).toEqual(["Labels"]);
    expect((await deals.getDeal(ada.id, id))!.labels.map((l) => l.name)).toEqual(["Hot", "Warm"]);
    const list = await listDeals(ada.id, parseDealsQuery({ label: String(hot) }));
    expect(list.rows.map((r) => [r.title, r.labels])).toEqual([["Fakeco website", ["Hot", "Warm"]]]);
    // An id that is no deal label is ignored.
    expect((await deals.updateDeal(ada.id, id, 2, editForm([hot, warm, 999999]))).status).toBe("saved");
    expect(await labelIdsOf(id)).toEqual([hot, warm].sort((a, b) => a - b));
  });

  it("the deal form offers deal labels only, and the person form people labels only", async () => {
    await makeDealLabel("Hot");
    await sql`insert into labels (name) values ('Investor')`;
    expect((await deals.dealFormChoices(ada.id, null)).labels.map((l) => l.name)).toEqual(["Hot"]);
    expect((await personFormChoices(ada.id, null)).labels.map((l) => l.name)).toEqual(["Investor"]);
  });

  it("a removed deal label stays on its deal, in its list row and the filter; offered only on that deal's form", async () => {
    const hot = await makeDealLabel("Hot");
    const a = await makeDeal({ title: "Deal A", stageId: sales.stages[0], createdBy: ada.id });
    const b = await makeDeal({ title: "Deal B", stageId: sales.stages[0], createdBy: ada.id });
    await labelDeal(a, hot);
    await removeChoice(ada.id, "deal_label", hot);

    expect((await deals.getDeal(linus.id, a))!.labels.map((l) => l.name)).toEqual(["Hot"]);
    expect((await listDeals(linus.id, parseDealsQuery({ label: String(hot) }))).rows.map((r) => [r.title, r.labels])).toEqual([["Deal A", ["Hot"]]]);
    expect((await dealFilterOptions(linus.id, null)).labels.map((l) => l.name)).toEqual(["Hot"]);

    const dealA = (await deals.getDeal(ada.id, a))!;
    const dealB = (await deals.getDeal(ada.id, b))!;
    expect((await deals.dealFormChoices(ada.id, dealA)).labels.map((l) => l.name)).toEqual(["Hot"]);
    expect((await deals.dealFormChoices(ada.id, dealB)).labels).toEqual([]);
    expect(deals.dealToForm(dealA).labelIds).toEqual([String(hot)]);

    // Saving deal A with "Hot" still ticked keeps it and records no "Labels".
    await deals.updateDeal(ada.id, a, 1, editForm([hot], { title: "Deal A2" }));
    expect(await labelIdsOf(a)).toEqual([hot]);
    expect((await dealEvents(a)).at(-1)).toMatchObject({ fields: ["Title"] });
    // Asking for it on deal B is ignored.
    await deals.updateDeal(ada.id, b, 1, editForm([hot], { title: "Deal B" }));
    expect(await labelIdsOf(b)).toEqual([]);
    // Unticking it on deal A removes it for good; then no visible deal has it, so the filter no longer offers it.
    await deals.updateDeal(ada.id, a, 2, editForm([], { title: "Deal A2" }));
    expect(await labelIdsOf(a)).toEqual([]);
    expect((await dealEvents(a)).at(-1)).toMatchObject({ fields: ["Labels"] });
    expect((await dealFilterOptions(linus.id, null)).labels).toEqual([]);
  });

  it("the filter does not offer a removed label that only a deal hidden from the viewer has", async () => {
    const hot = await makeDealLabel("Hot", true);
    const secret = await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true });
    await labelDeal(secret, hot);
    expect((await dealFilterOptions(linus.id, null)).labels).toEqual([]);
    expect((await dealFilterOptions(ada.id, null)).labels.map((l) => l.name)).toEqual(["Hot"]);
  });
});
