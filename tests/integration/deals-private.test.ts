// covers FR-015, FR-016, SC-005, US6 scenarios 1–6, edge cases "deactivated creator of a private deal",
// "owner changed again (A → B → C)"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import * as deals from "@/server/deals/deals";
import { readTimeline } from "@/server/records/timeline";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { dealCount, dealForm, dealRow, makeDeal, makePipeline } from "./deal-helpers";

let a: TestUser; // creator
let b: TestUser; // owner
let c: TestUser; // neither
let admin: TestUser; // an admin who is neither
let sales: { id: number; stages: number[] };

beforeEach(async () => {
  await resetDb();
  a = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  b = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  c = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  admin = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified"]);
});
afterAll(closeDb);

async function sees(viewer: TestUser, dealId: number): Promise<boolean> {
  const board = (await deals.getBoard(viewer.id, sales.id))!;
  const onBoard = board.columns.some((col) => col.cards.some((card) => card.id === dealId));
  const drawer = (await deals.getDeal(viewer.id, dealId)) !== null;
  expect(onBoard).toBe(drawer);
  return drawer;
}

async function total(viewer: TestUser): Promise<[number, number]> {
  const col = (await deals.getBoard(viewer.id, sales.id))!.columns[0];
  return [col.count, col.totalPence];
}

describe("private deals", () => {
  it("are seen and counted only by their creator and their owner, admins included (SC-005)", async () => {
    await makeDeal({ title: "Open deal", stageId: sales.stages[0], createdBy: c.id, valuePence: 100 });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: a.id, ownerId: b.id, valuePence: 400000, private: true });
    expect(await sees(a, id)).toBe(true);
    expect(await sees(b, id)).toBe(true);
    expect(await sees(c, id)).toBe(false);
    expect(await sees(admin, id)).toBe(false);
    expect(await total(a)).toEqual([2, 400100]);
    expect(await total(b)).toEqual([2, 400100]);
    expect(await total(c)).toEqual([1, 100]);
    expect(await total(admin)).toEqual([1, 100]);
    expect((await deals.getBoard(b.id, sales.id))!.columns[0].cards.find((x) => x.id === id)!.private).toBe(true);
    expect(((await readTimeline(a.id, { dealId: id })).entries).length).toBe(0); // made by a direct insert: no event
    await sql`insert into timeline_events (deal_id, kind, actor_id) values (${id}, 'added', ${a.id})`;
    expect(((await readTimeline(b.id, { dealId: id })).entries).length).toBe(1);
    expect((await readTimeline(c.id, { dealId: id })).entries).toEqual([]);
    expect((await readTimeline(admin.id, { dealId: id })).entries).toEqual([]);
  });

  it("refuse every change from anyone else, admins included, and nothing changes", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: a.id, ownerId: b.id, private: true });
    for (const u of [c, admin]) {
      expect(await deals.updateDeal(u.id, id, 1, dealForm({ title: "Hacked" }))).toEqual({ status: "not_found" });
      expect(await deals.moveDeal(u.id, { dealId: id, version: 1, fromStageId: null, toStageId: sales.stages[1] })).toEqual({ status: "stale" });
      expect(await deals.archiveDeal(u.id, id)).toEqual({ status: "not_found" });
    }
    expect(await deals.deleteDeal(admin.id, id)).toEqual({ status: "not_found" });
    expect(await dealRow(id)).toMatchObject({ title: "Fakeco website", stage_id: sales.stages[0], archived: false, version: 1 });
    expect(await dealCount()).toBe(1);
  });

  it("let only the creator and the current owner change Private", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: a.id, ownerId: b.id });
    // C edits a shared deal and sends private=on: ignored.
    let d = (await deals.getDeal(c.id, id))!;
    await deals.updateDeal(c.id, id, d.version, { ...deals.dealToForm(d), private: true });
    expect((await dealRow(id))!.private).toBe(false);
    // The owner (not the creator) can.
    d = (await deals.getDeal(b.id, id))!;
    expect((await deals.updateDeal(b.id, id, d.version, { ...deals.dealToForm(d), private: true })).status).toBe("saved");
    expect((await dealRow(id))!.private).toBe(true);
    // The creator can untick it.
    d = (await deals.getDeal(a.id, id))!;
    await deals.updateDeal(a.id, id, d.version, { ...deals.dealToForm(d), private: false });
    expect((await dealRow(id))!.private).toBe(false);
  });

  it("let the owner see, edit, move and archive it (US6 scenario 5)", async () => {
    const r = await deals.createDeal(a.id, dealForm({ stageId: String(sales.stages[0]), ownerId: String(b.id), private: true, value: "10" }));
    if (r.status !== "saved") throw new Error(JSON.stringify(r));
    const id = r.id;
    expect(await sees(b, id)).toBe(true);
    let d = (await deals.getDeal(b.id, id))!;
    expect((await deals.updateDeal(b.id, id, d.version, { ...deals.dealToForm(d), value: "20" })).status).toBe("saved");
    d = (await deals.getDeal(b.id, id))!;
    expect((await deals.moveDeal(b.id, { dealId: id, version: d.version, fromStageId: d.stage.id, toStageId: sales.stages[1] })).status).toBe("moved");
    expect(await deals.archiveDeal(b.id, id)).toEqual({ status: "archived", pipelineId: sales.id });
    expect(await sees(c, id)).toBe(false);
  });

  it("tell an owner who hands a private deal on that they can no longer see it (US6 scenario 6)", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: a.id, ownerId: b.id, private: true });
    const d = (await deals.getDeal(b.id, id))!;
    expect(await deals.updateDeal(b.id, id, d.version, { ...deals.dealToForm(d), ownerId: String(c.id) })).toEqual({
      status: "no_longer_visible",
      title: "Fakeco website",
      pipelineId: sales.id,
    });
    expect(await sees(b, id)).toBe(false);
    expect(await sees(a, id)).toBe(true);
    expect(await sees(c, id)).toBe(true);
    expect(await sees(admin, id)).toBe(false);
  });

  it("A → B → C owners: B no longer sees it", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: a.id, private: true });
    let d = (await deals.getDeal(a.id, id))!;
    expect((await deals.updateDeal(a.id, id, d.version, { ...deals.dealToForm(d), ownerId: String(b.id) })).status).toBe("saved");
    d = (await deals.getDeal(a.id, id))!;
    expect((await deals.updateDeal(a.id, id, d.version, { ...deals.dealToForm(d), ownerId: String(c.id) })).status).toBe("saved");
    expect([await sees(a, id), await sees(b, id), await sees(c, id)]).toEqual([true, false, true]);
  });

  it("never names a main person who is private to someone else (US6 scenario 4)", async () => {
    const gus = await makePerson({ firstName: "Gus", lastName: "Lorem", createdBy: a.id, private: true });
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: a.id, personId: gus });
    expect((await deals.getDeal(b.id, id))!.person).toBe(null);
    expect((await deals.getBoard(b.id, sales.id))!.columns[0].cards[0].person).toBe(null);
    expect((await deals.getDeal(a.id, id))!.person).toMatchObject({ id: gus, name: "Gus Lorem" });
    expect((await deals.dealFormChoices(b.id, await deals.getDeal(b.id, id))).people.map((p) => p.id)).not.toContain(gus);
  });

  it("stay with an active owner when the creator is deactivated; nobody sees them when both are", async () => {
    const id = await makeDeal({ title: "Fakeco website", stageId: sales.stages[0], createdBy: a.id, ownerId: b.id, private: true });
    await sql`update users set status = 'deactivated' where id = ${a.id}`;
    expect(await sees(b, id)).toBe(true);
    expect(await sees(admin, id)).toBe(false);
    await sql`update users set status = 'deactivated' where id = ${b.id}`;
    // A deactivated user cannot sign in, so nobody who can sign in sees it; it stays saved.
    expect(await sees(c, id)).toBe(false);
    expect(await sees(admin, id)).toBe(false);
    expect(await dealCount()).toBe(1);
    await sql`update users set status = 'active' where id = ${b.id}`;
    expect(await sees(b, id)).toBe(true);
  });
});
