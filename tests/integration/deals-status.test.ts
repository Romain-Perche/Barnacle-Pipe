// covers SF-95 FR-005–FR-008, SC-005, US2 scenarios 1–6, Edge Cases (stage days stop while closed; Won/Lost keep value,
// owner and stage; a closed deal cannot move; a stage delete moves a closed deal without restarting its count)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import * as pipelines from "@/server/deals/pipelines";
import { stageBar } from "@/server/deals/rules";
import { readTimeline } from "@/server/records/timeline";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealRow, makeDeal, makePipeline, periods, setPeriods } from "./deal-helpers";

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

async function status(id: number) {
  const [r] = await sql<{ status: string; closed: boolean; lost_reason: string | null }[]>`
    select status, closed_at is not null as closed, lost_reason from deals where id = ${id}`;
  return r;
}
async function onBoard(viewerId: number, stageId: number) {
  const board = (await deals.getBoard(viewerId, sales.id))!;
  const col = board.columns.find((c) => c.id === stageId)!;
  return { titles: col.cards.map((c) => c.title), count: col.count, totalPence: col.totalPence };
}
// Moves every period of a deal `days` into the past (as if that time had gone by).
async function age(id: number, days: number) {
  await sql`update deal_stage_periods set entered_at = entered_at - ${days} * interval '1 day',
            left_at = left_at - ${days} * interval '1 day' where deal_id = ${id}`;
}

describe("Won", () => {
  it("closes the deal: status, date, the open period closed, a 'won' event; it leaves the board and its totals", async () => {
    const stage = sales.stages[1];
    const id = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id, valuePence: 400000 });
    await makeDeal({ title: "Other deal", stageId: stage, createdBy: ada.id, valuePence: 100000 });
    expect(await onBoard(linus.id, stage)).toEqual({ titles: ["Other deal", "Fakeco website"], count: 2, totalPence: 500000 });

    expect(await deals.markWon(linus.id, id, 1)).toEqual({ status: "ok" });
    expect(await status(id)).toEqual({ status: "won", closed: true, lost_reason: null });
    expect(await dealRow(id)).toMatchObject({ stage_id: stage, value_pence: 400000, owner_id: ada.id, version: 2 });
    expect((await periods(id)).map((p) => p.open)).toEqual([false]);
    expect(await onBoard(linus.id, stage)).toEqual({ titles: ["Other deal"], count: 1, totalPence: 100000 });
    const [line] = (await readTimeline(ada.id, { dealId: id })).entries;
    expect(line).toMatchObject({ kind: "won", actorName: "Linus Fake", reason: null });
    const d = (await deals.getDeal(ada.id, id))!;
    expect(d.status).toBe("won");
    expect(d.closedAt).toBeInstanceOf(Date);
  });

  it("is refused as a conflict with an old version, on a closed deal and on an archived deal; nothing changes", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    expect(await deals.markWon(ada.id, id, 7)).toEqual({ status: "conflict" });
    expect((await status(id)).status).toBe("open");
    expect(await deals.markWon(ada.id, id, 1)).toEqual({ status: "ok" });
    expect(await deals.markWon(ada.id, id, 2)).toEqual({ status: "conflict" });
    expect(await deals.markLost(ada.id, id, 2, "Too late")).toEqual({ status: "conflict" });
    const archived = await makeDeal({ title: "Archived deal", stageId: sales.stages[0], createdBy: ada.id, archived: true });
    expect(await deals.markWon(ada.id, archived, 1)).toEqual({ status: "conflict" });
    expect((await status(archived)).status).toBe("open");
  });

  it("is not found for a private deal of someone else or a missing deal", async () => {
    const priv = await makeDeal({ title: "Fake secret project", stageId: sales.stages[0], createdBy: ada.id, private: true });
    expect(await deals.markWon(linus.id, priv, 1)).toEqual({ status: "not_found" });
    expect(await deals.markLost(linus.id, priv, 1, "x")).toEqual({ status: "not_found" });
    expect(await deals.reopenDeal(linus.id, priv, 1)).toEqual({ status: "not_found" });
    expect(await deals.markWon(linus.id, 999999, 1)).toEqual({ status: "not_found" });
    expect((await status(priv)).status).toBe("open");
  });
});

describe("Lost", () => {
  it("stores the trimmed reason and a 'lost' event with it; the deal leaves the board", async () => {
    const stage = sales.stages[2];
    const id = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id, valuePence: 400000 });
    expect(await deals.markLost(linus.id, id, 1, "  Went with a competitor  ")).toEqual({ status: "ok" });
    expect(await status(id)).toEqual({ status: "lost", closed: true, lost_reason: "Went with a competitor" });
    const [line] = (await readTimeline(ada.id, { dealId: id })).entries;
    expect(line).toMatchObject({ kind: "lost", actorName: "Linus Fake", reason: "Went with a competitor" });
    expect((await deals.getDeal(ada.id, id))!.lostReason).toBe("Went with a competitor");
    expect(await onBoard(ada.id, stage)).toEqual({ titles: [], count: 0, totalPence: 0 });
    expect(await dealRow(id)).toMatchObject({ stage_id: stage, value_pence: 400000, owner_id: ada.id });
  });

  it("refuses an empty or too long reason; the deal stays open", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: ada.id });
    expect(await deals.markLost(ada.id, id, 1, "   ")).toEqual({ status: "invalid", code: "lost_reason_required" });
    expect(await deals.markLost(ada.id, id, 1, "x".repeat(501))).toEqual({ status: "invalid", code: "lost_reason_too_long" });
    expect(await status(id)).toEqual({ status: "open", closed: false, lost_reason: null });
    expect(await deals.markLost(ada.id, id, 1, "x".repeat(500))).toEqual({ status: "ok" });
  });
});

describe("Reopen", () => {
  it("clears the date and reason, opens a period in the same stage, records 'reopened', back on the board", async () => {
    const stage = sales.stages[1];
    const id = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id });
    await deals.markLost(ada.id, id, 1, "Went with a competitor");
    expect(await deals.reopenDeal(linus.id, id, 2)).toEqual({ status: "ok" });
    expect(await status(id)).toEqual({ status: "open", closed: false, lost_reason: null });
    expect((await periods(id)).map((p) => [p.stage_id, p.open])).toEqual([[stage, false], [stage, true]]);
    expect((await onBoard(ada.id, stage)).titles).toEqual(["Fakeco website"]);
    const lines = (await readTimeline(ada.id, { dealId: id })).entries;
    expect(lines.map((e) => e.kind)).toEqual(["reopened", "lost"]);
    // The history keeps what was said when it was lost.
    expect(lines[1].reason).toBe("Went with a competitor");
    expect(await deals.reopenDeal(linus.id, id, 3)).toEqual({ status: "conflict" });
  });

  it("stops the stage's day count while closed and goes on after reopening", async () => {
    const stage = sales.stages[2];
    const id = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id });
    await setPeriods(id, [[stage, 4]]);
    await deals.markWon(ada.id, id, 1);
    await age(id, 7);
    const days = async () => stageBar(await deals.getStageSeconds(id, sales.id), stage).find((s) => s.id === stage)!.days;
    expect(await days()).toBe(4);
    await deals.reopenDeal(ada.id, id, 2);
    await age(id, 2);
    expect(await days()).toBe(6);
  });
});

describe("closed deals and moves", () => {
  it("a closed deal does not move until reopened", async () => {
    const [leadIn, qualified] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: leadIn, createdBy: ada.id });
    await deals.markWon(ada.id, id, 1);
    expect(await deals.moveDeal(ada.id, { dealId: id, version: 2, fromStageId: leadIn, toStageId: qualified })).toEqual({ status: "stale" });
    expect((await dealRow(id))!.stage_id).toBe(leadIn);
  });

  it("a stage delete moves a closed deal with a closed period, so its count does not start again", async () => {
    const [leadIn, qualified] = sales.stages;
    const id = await makeDeal({ title: "Fakeco website", stageId: leadIn, createdBy: ada.id });
    await deals.markWon(ada.id, id, 1);
    const r = await pipelines.deleteStage(ada.id, leadIn, qualified);
    expect(r).toMatchObject({ status: "ok" });
    expect((await dealRow(id))!.stage_id).toBe(qualified);
    expect((await periods(id)).every((p) => !p.open)).toBe(true);
    expect((await status(id)).status).toBe("won");
    expect((await onBoard(ada.id, qualified)).titles).toEqual([]);
  });
});
