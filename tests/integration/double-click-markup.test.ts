// covers FR-001, FR-004, FR-005, US1 scenarios 1-3
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { Board } from "@/app/(app)/deals/Board";
import { makeUser, resetDb } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";

beforeEach(resetDb);
afterAll(closeDb);

describe("board markup", () => {
  it("gives each card data-page with its deal page, keeps its href and draggable", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
    const p = await makePipeline("Sales", ["Lead in"], 1);
    const d = await makeDeal({ title: "Fake deal", stageId: p.stages[0], createdBy: ada.id });
    const board = (await deals.getBoard(ada.id, p.id))!;
    const html = renderToStaticMarkup(
      createElement(Board, { pipelineId: p.id, columns: board.columns, openId: null, now: Date.now() }),
    );
    expect(html).toContain(`data-page="/deals/${d}"`);
    expect(html).toContain(`href="/deals?`);
    expect(html).toContain("draggable");
    expect(html.match(/data-page=/g)).toHaveLength(1); // the "+" link has none
  });
});
