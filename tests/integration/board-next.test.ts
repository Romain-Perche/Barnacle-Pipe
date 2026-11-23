// covers SF-109 FR-010, SC-004, US4 scenarios 1–4 (T043, T044; replaces the browser test of the card's last line)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { scheduleActivity, tickActivity } from "@/server/activities/activities";
import { cardLine } from "@/server/activities/rules";
import { closeDb, sql } from "@/server/db";
import { getBoard } from "@/server/deals/deals";
import { activityForm, makeActivity, okId } from "./activity-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, bob: TestUser;
let pipeline: { id: number; stages: number[] };

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake", role: "admin" });
  pipeline = await makePipeline("Sales", ["Lead in", "Proposal"]);
});
afterAll(closeDb);

async function card(viewer: number, dealId: number) {
  const board = (await getBoard(viewer, pipeline.id))!;
  return board.columns.flatMap((c) => c.cards).find((c) => c.id === dealId);
}

describe("the board card's next activity", () => {
  it("is null with no planned activity, or only done ones, or only ones hidden from the viewer", async () => {
    const none = await makeDeal({ title: "None", stageId: pipeline.stages[0], createdBy: ada.id });
    const doneOnly = await makeDeal({ title: "Done only", stageId: pipeline.stages[0], createdBy: ada.id });
    await makeActivity({ by: ada.id, dealId: doneOnly, doneAt: new Date() });
    const hiddenOnly = await makeDeal({ title: "Hidden only", stageId: pipeline.stages[1], createdBy: ada.id });
    const secret = await makePerson({ firstName: "Secret", createdBy: ada.id, private: true });
    await makeActivity({ by: ada.id, dealId: hiddenOnly, personId: secret });
    expect((await card(ada.id, none))!.next).toBeNull();
    expect((await card(ada.id, doneOnly))!.next).toBeNull();
    expect((await card(bob.id, hiddenOnly))!.next).toBeNull();
    expect((await card(ada.id, hiddenOnly))!.next).not.toBeNull();
    expect(cardLine((await card(bob.id, hiddenOnly))!.next, new Date())).toEqual({ kind: "warn", text: "⚠ No next activity" });
  });

  it("is the earliest planned one (untimed after timed on the same day), with its type", async () => {
    const deal = await makeDeal({ title: "Busy", stageId: pipeline.stages[0], createdBy: ada.id });
    await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-26", type: "meeting" });
    await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-25", type: "task" });
    await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-25", dueTime: "16:00", durationMinutes: 30, type: "call" });
    await makeActivity({ by: ada.id, dealId: deal, dueOn: "2026-11-01", doneAt: new Date() });
    const next = (await card(ada.id, deal))!.next;
    expect(next).toEqual({ dueOn: "2026-11-25", dueTime: "16:00", durationMinutes: 30, type: "call" });
    expect(cardLine(next, new Date("2026-11-23T12:00:00Z"))).toEqual({ kind: "next", text: "Next: 25 Nov · Call", overdue: false });
    expect(cardLine(next, new Date("2026-11-25T16:30:00Z"))).toMatchObject({ overdue: true });
  });

  it("shows no won, lost or archived deal", async () => {
    const won = await makeDeal({ title: "Won", stageId: pipeline.stages[0], createdBy: ada.id });
    await sql`update deals set status = 'won', closed_at = now() where id = ${won}`;
    const archived = await makeDeal({ title: "Archived", stageId: pipeline.stages[0], createdBy: ada.id, archived: true });
    expect(await card(ada.id, won)).toBeUndefined();
    expect(await card(ada.id, archived)).toBeUndefined();
  });

  it("follows scheduling and ticking: a task replaces the warning, ticking it brings it back", async () => {
    const deal = await makeDeal({ title: "Stalled", stageId: pipeline.stages[0], createdBy: ada.id });
    expect((await card(ada.id, deal))!.next).toBeNull();
    const id = okId(await scheduleActivity(ada.id, activityForm({ type: "task", dueOn: "2026-11-27", dealId: String(deal) })));
    expect((await card(ada.id, deal))!.next).toMatchObject({ dueOn: "2026-11-27", type: "task" });
    await tickActivity(ada.id, id);
    expect((await card(ada.id, deal))!.next).toBeNull();
  });
});
