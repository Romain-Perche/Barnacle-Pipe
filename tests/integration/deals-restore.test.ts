// covers SF-95 FR-011, FR-014, FR-015, SC-005, SC-007, US4 scenarios 1–5
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { listDeals } from "@/server/deals/list";
import * as pipelines from "@/server/deals/pipelines";
import { parseDealsQuery } from "@/server/records/list-query";
import { readTimeline } from "@/server/records/timeline";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealRow, makeDeal, makePipeline } from "./deal-helpers";

let ada: TestUser;
let linus: TestUser;
let sales: { id: number; stages: number[] };

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal"]);
});
afterAll(closeDb);

const titles = async (viewerId: number, params: Record<string, string>) =>
  (await listDeals(viewerId, parseDealsQuery(params))).rows.map((r) => r.title).sort();
const boardTitles = async (viewerId: number, stageId: number) =>
  (await deals.getBoard(viewerId, sales.id))!.columns.find((c) => c.id === stageId)!.cards.map((c) => c.title);

describe("Show archived deals", () => {
  it("lists only archived deals, of every status, still respecting the other filters", async () => {
    const open = await makeDeal({ title: "Open archived", stageId: sales.stages[0], createdBy: ada.id });
    const won = await makeDeal({ title: "Won archived", stageId: sales.stages[1], createdBy: ada.id });
    await makeDeal({ title: "Not archived", stageId: sales.stages[0], createdBy: ada.id });
    await deals.markWon(ada.id, won, 1);
    await deals.archiveDeal(ada.id, open);
    await deals.archiveDeal(ada.id, won);
    expect(await titles(linus.id, { archived: "1" })).toEqual(["Open archived", "Won archived"]);
    expect(await titles(linus.id, { archived: "1", closed: "1" })).toEqual(["Open archived", "Won archived"]);
    expect(await titles(linus.id, { archived: "1", stage: String(sales.stages[1]), pipeline: String(sales.id) })).toEqual(["Won archived"]);
    expect(await titles(linus.id, { archived: "1", status: "open" })).toEqual(["Open archived"]);
    expect(await titles(linus.id, {})).toEqual(["Not archived"]);
  });
});

describe("restoreDeal", () => {
  it("puts an open deal back on its board stage and records 'restored'", async () => {
    const stage = sales.stages[1];
    const id = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id });
    await deals.archiveDeal(ada.id, id);
    expect(await boardTitles(ada.id, stage)).toEqual([]);
    expect(await deals.restoreDeal(linus.id, id)).toEqual({ status: "ok" });
    expect(await dealRow(id)).toMatchObject({ archived: false, stage_id: stage, version: 3 });
    expect(await boardTitles(ada.id, stage)).toEqual(["Fakeco website"]);
    const [line] = (await readTimeline(ada.id, { dealId: id })).entries;
    expect(line).toMatchObject({ kind: "restored", actorName: "Linus Fake" });
  });

  it("keeps a won deal won and off the board", async () => {
    const stage = sales.stages[0];
    const id = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id });
    await deals.markWon(ada.id, id, 1);
    await deals.archiveDeal(ada.id, id);
    expect(await deals.restoreDeal(ada.id, id)).toEqual({ status: "ok" });
    const [r] = await sql<{ status: string }[]>`select status from deals where id = ${id}`;
    expect(r.status).toBe("won");
    expect(await boardTitles(ada.id, stage)).toEqual([]);
  });

  it("restores into the stage its deals were moved to when its stage was deleted while archived", async () => {
    const [leadIn, qualified] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: leadIn, createdBy: ada.id });
    await deals.archiveDeal(ada.id, id);
    expect(await pipelines.deleteStage(ada.id, leadIn, qualified)).toMatchObject({ status: "ok" });
    await deals.restoreDeal(ada.id, id);
    expect((await dealRow(id))!.stage_id).toBe(qualified);
    expect(await boardTitles(ada.id, qualified)).toEqual(["Fakeco website"]);
  });

  it("changes nothing on a deal that is not archived; not found for a missing deal or one private to someone else", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    expect(await deals.restoreDeal(ada.id, id)).toEqual({ status: "ok" });
    expect(await dealRow(id)).toMatchObject({ version: 1 });
    expect((await readTimeline(ada.id, { dealId: id })).entries).toEqual([]);
    expect(await deals.restoreDeal(ada.id, 999999)).toEqual({ status: "not_found" });
    const priv = await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true, archived: true });
    expect(await deals.restoreDeal(linus.id, priv)).toEqual({ status: "not_found" });
    expect((await dealRow(priv))!.archived).toBe(true);
  });
});

describe("deleteDeal (SC-007)", () => {
  it("refuses a non-admin, including a direct call; an admin deletes", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: linus.id, archived: true });
    expect(await deals.deleteDeal(linus.id, id)).toEqual({ status: "forbidden" });
    expect(await dealRow(id)).toBeDefined();
    expect(await deals.deleteDeal(ada.id, id)).toMatchObject({ status: "deleted", name: "Fakeco website" });
    expect(await dealRow(id)).toBeUndefined();
  });
});
