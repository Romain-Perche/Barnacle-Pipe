// covers SF-95 FR-009–FR-013, FR-020, SC-006, US3 scenarios 1–5, Edge Cases (page past the last; stage not in the
// pipeline; empty values sort last either way; a private deal or person never listed or counted)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { dealFilterOptions, listDeals } from "@/server/deals/list";
import { parseDealsQuery } from "@/server/records/list-query";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { labelDeal, makeDeal, makeDealLabel, makePipeline } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
let sales: { id: number; stages: number[] };
let partners: { id: number; stages: number[] };
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal"]);
  partners = await makePipeline("Partners", ["Intro", "Talking"]);
});
afterAll(closeDb);

async function added(id: number, daysAgo: number) {
  await sql`update deals set created_at = ${new Date(Date.now() - daysAgo * DAY)} where id = ${id}`;
}
const list = (viewerId: number, params: Record<string, string> = {}) => listDeals(viewerId, parseDealsQuery(params));
const titles = async (viewerId: number, params: Record<string, string> = {}) => (await list(viewerId, params)).rows.map((r) => r.title);

describe("listDeals", () => {
  it("lists open, non-archived visible deals newest first, with every column, count and total", async () => {
    const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
    const person = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
    const a = await makeDeal({ title: "Fakeco website", stageId: sales.stages[1], createdBy: ada.id, ownerId: linus.id, valuePence: 400000, organisationId: org, personId: person });
    await sql`update deals set expected_close_on = '2026-12-19' where id = ${a}`;
    await added(a, 2);
    const b = await makeDeal({ title: "Mock Labs audit", stageId: partners.stages[0], createdBy: ada.id, valuePence: 150050 });
    await added(b, 1);
    await makeDeal({ title: "Archived deal", stageId: sales.stages[0], createdBy: ada.id, valuePence: 999, archived: true });
    const won = await makeDeal({ title: "Won deal", stageId: sales.stages[0], createdBy: ada.id, valuePence: 999 });
    await deals.markWon(ada.id, won, 1);
    await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true, valuePence: 123400 });

    const r = await list(linus.id);
    expect(r.rows.map((x) => x.title)).toEqual(["Mock Labs audit", "Fakeco website"]);
    expect(r).toMatchObject({ total: 2, totalPence: 550050, page: 1, pages: 1 });
    expect(r.rows[1]).toMatchObject({
      id: a,
      title: "Fakeco website",
      valuePence: 400000,
      organisation: { id: org, name: "Fakeco Ltd" },
      person: { id: person, name: "Ada Example" },
      pipeline: { id: sales.id, name: "Sales" },
      stage: { id: sales.stages[1], name: "Qualified" },
      owner: { id: linus.id, name: "Linus Fake", active: true },
      expectedClose: "2026-12-19",
      status: "open",
      archived: false,
      private: false,
      labels: [],
    });
    // Ada created the private deal: she sees and counts it (admins see no more than anyone else otherwise).
    expect(await list(ada.id)).toMatchObject({ total: 3, totalPence: 673450 });
  });

  it("pages by 50 and shows the last page for a page past it; count and total cover every match", async () => {
    for (let i = 0; i < 53; i++) await makeDeal({ title: `Deal ${String(i).padStart(2, "0")}`, stageId: sales.stages[0], createdBy: ada.id, valuePence: 100 });
    const first = await list(ada.id, { sort: "title", dir: "asc" });
    expect(first.rows.length).toBe(50);
    expect(first).toMatchObject({ total: 53, totalPence: 5300, page: 1, pages: 2 });
    const last = await list(ada.id, { sort: "title", dir: "asc", page: "999" });
    expect(last.page).toBe(2);
    expect(last.rows.map((x) => x.title)).toEqual(["Deal 50", "Deal 51", "Deal 52"]);
  });

  it("filters by title text, pipeline, stage in the pipeline, owner and label, alone and together", async () => {
    const hot = await makeDealLabel("Hot");
    const a = await makeDeal({ title: "Fakeco website", stageId: sales.stages[1], createdBy: ada.id });
    const b = await makeDeal({ title: "Fakeco app", stageId: sales.stages[2], createdBy: ada.id, ownerId: linus.id });
    await makeDeal({ title: "Mock 100% deal_x", stageId: partners.stages[0], createdBy: ada.id, ownerId: linus.id });
    await labelDeal(a, hot);
    await labelDeal(b, hot);
    const sorted = async (p: Record<string, string>) => (await titles(ada.id, p)).sort();
    expect(await sorted({ q: "fakeco" })).toEqual(["Fakeco app", "Fakeco website"]);
    expect(await sorted({ q: "100%" })).toEqual(["Mock 100% deal_x"]);
    expect(await sorted({ q: "%" })).toEqual(["Mock 100% deal_x"]);
    expect(await sorted({ pipeline: String(partners.id) })).toEqual(["Mock 100% deal_x"]);
    expect(await sorted({ pipeline: String(sales.id), stage: String(sales.stages[2]) })).toEqual(["Fakeco app"]);
    // A stage not in the chosen pipeline is ignored.
    expect(await sorted({ pipeline: String(partners.id), stage: String(sales.stages[2]) })).toEqual(["Mock 100% deal_x"]);
    // Without a pipeline, a stage filters nothing.
    expect((await sorted({ stage: String(sales.stages[2]) })).length).toBe(3);
    expect(await sorted({ owner: String(linus.id) })).toEqual(["Fakeco app", "Mock 100% deal_x"]);
    expect(await sorted({ label: String(hot) })).toEqual(["Fakeco app", "Fakeco website"]);
    expect(await sorted({ label: String(hot), owner: String(linus.id), q: "app", pipeline: String(sales.id) })).toEqual(["Fakeco app"]);
    expect(await list(ada.id, { label: String(hot), owner: String(linus.id) })).toMatchObject({ total: 1 });
    expect((await list(ada.id, { label: String(hot) })).rows[0].labels).toEqual(["Hot"]);
  });

  it("sorts by every column both ways; empty value, organisation and expected close last either way", async () => {
    const zed = await makeOrganisation({ name: "Zed Fake", ownerId: ada.id });
    const abc = await makeOrganisation({ name: "abc Fake", ownerId: ada.id });
    const grace = await makeUser({ email: "grace@barnacle.ai", name: "grace Fake" });
    const d1 = await makeDeal({ title: "b deal", stageId: sales.stages[2], createdBy: ada.id, valuePence: 300, organisationId: zed, ownerId: linus.id });
    const d2 = await makeDeal({ title: "A deal", stageId: sales.stages[0], createdBy: ada.id, valuePence: 100, organisationId: abc, ownerId: grace.id });
    const d3 = await makeDeal({ title: "c deal", stageId: partners.stages[0], createdBy: ada.id, valuePence: null });
    await sql`update deals set expected_close_on = '2026-12-01' where id = ${d1}`;
    await sql`update deals set expected_close_on = '2027-01-01' where id = ${d2}`;
    await added(d1, 3);
    await added(d2, 2);
    await added(d3, 1);
    const t = (sort: string, dir: string) => titles(ada.id, { sort, dir });
    expect(await t("title", "asc")).toEqual(["A deal", "b deal", "c deal"]);
    expect(await t("title", "desc")).toEqual(["c deal", "b deal", "A deal"]);
    expect(await t("value", "asc")).toEqual(["A deal", "b deal", "c deal"]);
    expect(await t("value", "desc")).toEqual(["b deal", "A deal", "c deal"]);
    expect(await t("organisation", "asc")).toEqual(["A deal", "b deal", "c deal"]);
    expect(await t("organisation", "desc")).toEqual(["b deal", "A deal", "c deal"]);
    expect(await t("close", "asc")).toEqual(["b deal", "A deal", "c deal"]);
    expect(await t("close", "desc")).toEqual(["A deal", "b deal", "c deal"]);
    expect(await t("stage", "asc")).toEqual(["A deal", "b deal", "c deal"]);
    expect(await t("stage", "desc")).toEqual(["c deal", "b deal", "A deal"]);
    expect(await t("owner", "asc")).toEqual(["c deal", "A deal", "b deal"]);
    expect(await t("owner", "desc")).toEqual(["b deal", "A deal", "c deal"]);
    expect(await t("added", "desc")).toEqual(["c deal", "A deal", "b deal"]);
    expect(await t("added", "asc")).toEqual(["b deal", "A deal", "c deal"]);
  });

  it("adds won and lost deals with closed=1; status narrows only when closed or archived is on", async () => {
    await makeDeal({ title: "Open deal", stageId: sales.stages[0], createdBy: ada.id, valuePence: 100 });
    const won = await makeDeal({ title: "Won deal", stageId: sales.stages[0], createdBy: ada.id, valuePence: 200 });
    const lost = await makeDeal({ title: "Lost deal", stageId: sales.stages[0], createdBy: ada.id, valuePence: 400 });
    await deals.markWon(ada.id, won, 1);
    await deals.markLost(ada.id, lost, 1, "Fake budget cut");
    const sorted = async (p: Record<string, string>) => (await titles(ada.id, p)).sort();
    expect(await sorted({})).toEqual(["Open deal"]);
    expect(await sorted({ status: "won" })).toEqual(["Open deal"]);
    expect(await sorted({ closed: "1" })).toEqual(["Lost deal", "Open deal", "Won deal"]);
    expect(await list(ada.id, { closed: "1" })).toMatchObject({ total: 3, totalPence: 700 });
    expect(await sorted({ closed: "1", status: "lost" })).toEqual(["Lost deal"]);
    const rows = (await list(ada.id, { closed: "1" })).rows;
    expect(Object.fromEntries(rows.map((r) => [r.title, r.status]))).toEqual({ "Open deal": "open", "Won deal": "won", "Lost deal": "lost" });
  });

  it("never lists, counts or totals a private deal of someone else; never names a hidden main person", async () => {
    const hidden = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: ada.id, private: true });
    await makeDeal({ title: "Visible deal", stageId: sales.stages[0], createdBy: ada.id, personId: hidden, valuePence: 100 });
    await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true, valuePence: 5000 });
    await makeDeal({ title: "Owned secret", stageId: sales.stages[0], createdBy: ada.id, ownerId: linus.id, private: true, valuePence: 10 });
    const r = await list(linus.id, { closed: "1" });
    expect(r.rows.map((x) => x.title).sort()).toEqual(["Owned secret", "Visible deal"]);
    expect(r).toMatchObject({ total: 2, totalPence: 110 });
    expect(r.rows.find((x) => x.title === "Visible deal")!.person).toBeNull();
    expect(await titles(linus.id, { q: "secret project" })).toEqual([]);
    expect((await list(ada.id)).rows.find((x) => x.title === "Visible deal")!.person).toMatchObject({ name: "Gus Lorem" });
  });
});

describe("dealFilterOptions", () => {
  it("offers pipelines, the chosen pipeline's stages, owners and labels (removed ones only while a visible deal has them)", async () => {
    const hot = await makeDealLabel("Hot", true);
    const old = await makeDealLabel("Old", true);
    await makeDealLabel("Warm");
    const deal = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    const secret = await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true });
    await labelDeal(deal, hot);
    await labelDeal(secret, old);
    const o = await dealFilterOptions(linus.id, sales.id);
    expect(o.pipelines.map((p) => p.name)).toEqual(["Sales", "Partners"]);
    expect(o.stages.map((s) => s.name)).toEqual(["Lead in", "Qualified", "Proposal"]);
    expect(o.owners.map((u) => u.name)).toEqual(["Ada Fake", "Linus Fake"]);
    expect(o.labels.map((l) => l.name)).toEqual(["Hot", "Warm"]);
    expect((await dealFilterOptions(ada.id, null)).stages).toEqual([]);
    expect((await dealFilterOptions(ada.id, null)).labels.map((l) => l.name)).toEqual(["Hot", "Old", "Warm"]);
  });
});
