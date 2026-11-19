// covers SC-003 (a board with 10 stages and 500 open deals shows in under 2 seconds), edge case "a stage holds 200
// deals: its header shows 200 deals and the total of all 200"
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { makePipeline } from "./deal-helpers";

let ada: TestUser;
let pipeline: { id: number; stages: number[] };

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  pipeline = await makePipeline("Big", Array.from({ length: 10 }, (_, i) => `Stage ${i + 1}`));
  // 200 deals in the first stage, 300 spread over the other nine; values 1..500 pounds.
  await sql`
    insert into deals (title, value_pence, stage_id, owner_id, created_by, stage_entered_at)
    select 'Fake deal ' || g, g * 100,
           case when g <= 200 then ${pipeline.stages[0]}::bigint else (${pipeline.stages.slice(1)}::bigint[])[1 + (g % 9)] end,
           ${ada.id}, ${ada.id}, now() - make_interval(mins => g)
    from generate_series(1, 500) g`;
  await sql`analyze deals`;
});
afterAll(closeDb);

describe("board performance", () => {
  it("reads 10 stages × 500 open deals well under 2 seconds, with full counts and totals", async () => {
    await deals.getBoard(ada.id, pipeline.id); // warm up the connection
    const start = performance.now();
    const board = (await deals.getBoard(ada.id, pipeline.id))!;
    const ms = performance.now() - start;
    expect(ms).toBeLessThan(500);
    expect(board.columns.length).toBe(10);
    expect(board.columns.reduce((n, c) => n + c.count, 0)).toBe(500);
    const first = board.columns[0];
    expect(first.count).toBe(200);
    expect(first.cards.length).toBe(200);
    expect(first.totalPence).toBe(((200 * 201) / 2) * 100);
  });
});
