// covers SF-102 FR-001–FR-003, US2 scenarios 1–7, SC-004, Edge Cases (main person also an other person, unlink and relink,
// "Linked Ada Example" once, organisation shows only its own deals)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { archiveDeal, deleteDeal, moveDeal } from "@/server/deals/deals";
import { linkPerson, unlinkPerson } from "@/server/deals/links";
import { addNote } from "@/server/records/notes";
import { readTimeline, recordEvent } from "@/server/records/timeline";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, boss: TestUser;
let stages: number[];
let org: number, other: number, adaP: number, bobP: number, cyP: number, deal: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  boss = await makeUser({ email: "boss@barnacle.ai", name: "Grace Fake", role: "admin" });
  stages = (await makePipeline("Sales", ["Qualified", "Proposal"])).stages;
  org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  other = await makeOrganisation({ name: "Other Fake", ownerId: ada.id });
  adaP = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, organisationId: org });
  bobP = await makePerson({ firstName: "Bob", lastName: "Placeholder", createdBy: ada.id, organisationId: org });
  cyP = await makePerson({ firstName: "Cy", lastName: "Nobody", createdBy: ada.id });
  deal = await makeDeal({ title: "Example Ltd Fake · website", stageId: stages[0], createdBy: ada.id, organisationId: org, personId: adaP });
  await recordEvent(sql, { dealId: deal, kind: "added", actorId: ada.id });
});
afterAll(closeDb);

const ids = async (target: Parameters<typeof readTimeline>[1], viewer = ada.id) => (await readTimeline(viewer, target)).entries.map((e) => e.id);
const dealEventIds = async () => (await sql<{ id: number }[]>`select id::int as id from timeline_events where deal_id = ${deal} order by created_at desc, id desc`).map((r) => r.id);

describe("deal entries on person and organisation timelines", () => {
  it("shows each note and change of the deal once on its main person, other people and organisation, and nowhere else (US2-2, US2-3, SC-004)", async () => {
    expect((await linkPerson(ada.id, deal, bobP)).status).toBe("ok");
    const note = await addNote(ada.id, { dealId: deal }, "Budget confirmed at £4,000.", []);
    expect(note.status).toBe("ok");
    const [d] = await sql<{ version: number }[]>`select version from deals where id = ${deal}`;
    expect((await moveDeal(ada.id, { dealId: deal, version: d.version, fromStageId: stages[0], toStageId: stages[1] })).status).toBe("moved");
    const own = await addNote(ada.id, { personId: adaP }, "Ada's own note", []);
    const all = await dealEventIds();
    expect(all).toHaveLength(4); // added, linked, note, moved
    for (const target of [{ personId: adaP }, { personId: bobP }, { organisationId: org }]) {
      const page = await readTimeline(ada.id, target);
      const fromDeal = page.entries.filter((e) => e.deal);
      expect(fromDeal.map((e) => e.id).sort()).toEqual([...all].sort());
      expect(new Set(page.entries.map((e) => e.id)).size).toBe(page.entries.length);
      expect(fromDeal.every((e) => e.deal?.id === deal && e.deal.title === "Example Ltd Fake · website" && !e.deal.archived)).toBe(true);
    }
    const adaPage = (await readTimeline(ada.id, { personId: adaP })).entries;
    expect(adaPage[0].id).toBe(own.status === "ok" ? own.id : 0);
    expect(adaPage[0].deal).toBeNull();
    expect(adaPage.find((e) => e.kind === "note" && e.deal)?.note?.segments).toEqual([{ text: "Budget confirmed at £4,000." }]);
    // "Linked Bob Placeholder" appears once on Bob's timeline, as the deal's entry.
    expect((await readTimeline(ada.id, { personId: bobP })).entries.filter((e) => e.kind === "person_linked")).toHaveLength(1);
    expect(await ids({ personId: cyP })).toEqual([]);
    expect(await ids({ organisationId: other })).toEqual([]);
    // The deal's own timeline has no deal marker.
    expect((await readTimeline(ada.id, { dealId: deal })).entries.every((e) => e.deal === null)).toBe(true);
  });

  it("shows the entries once when the main person is also in deal_people", async () => {
    await sql`insert into deal_people (deal_id, person_id, linked_by) values (${deal}, ${adaP}, ${ada.id})`;
    const entries = await ids({ personId: adaP });
    expect(entries).toEqual(await dealEventIds());
  });

  it("removes the entries on unlink or organisation change and brings all back on relink (US2-4, Edge)", async () => {
    await linkPerson(ada.id, deal, bobP);
    await addNote(ada.id, { dealId: deal }, "before", []);
    await unlinkPerson(ada.id, deal, bobP);
    expect(await ids({ personId: bobP })).toEqual([]);
    await addNote(ada.id, { dealId: deal }, "while unlinked", []);
    await linkPerson(ada.id, deal, bobP);
    expect(await ids({ personId: bobP })).toEqual(await dealEventIds());
    await sql`update deals set organisation_id = ${other} where id = ${deal}`;
    expect(await ids({ organisationId: org })).toEqual([]);
    expect(await ids({ organisationId: other })).toEqual(await dealEventIds());
  });

  it("keeps an archived deal's entries, marked archived; a deleted deal's entries are gone (US2-7)", async () => {
    await addNote(ada.id, { dealId: deal }, "n", []);
    await archiveDeal(ada.id, deal);
    const entries = (await readTimeline(ada.id, { organisationId: org })).entries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.deal?.archived === true)).toBe(true);
    await deleteDeal(boss.id, deal);
    expect(await ids({ organisationId: org })).toEqual([]);
    expect(await ids({ personId: adaP })).toEqual([]);
  });

  it("does not show deals of the organisation's people that are not its deals", async () => {
    await makeDeal({ title: "Ada's other deal", stageId: stages[0], createdBy: ada.id, personId: adaP });
    const otherDeal = await makeDeal({ title: "No org deal", stageId: stages[0], createdBy: ada.id, personId: bobP });
    await recordEvent(sql, { dealId: otherDeal, kind: "added", actorId: ada.id });
    expect(await ids({ organisationId: org })).toEqual(await dealEventIds());
  });

  it("a record with only its Added entry reads one entry (US2-6)", async () => {
    await recordEvent(sql, { personId: cyP, kind: "added", actorId: ada.id });
    const page = await readTimeline(ada.id, { personId: cyP });
    expect(page.entries.map((e) => e.kind)).toEqual(["added"]);
    expect(page.more).toBe(false);
  });
});

describe("paging (US2-5, FR-003)", () => {
  it("gives the newest 50, then 100, then all, in a stable order with no repeat or gap", async () => {
    const base = Date.parse("2026-11-01T10:00:00Z");
    // 119 more entries (the deal has its Added already): some at the same moment to check the id tie-break.
    for (let i = 0; i < 119; i++) {
      await sql`insert into timeline_events (deal_id, kind, actor_id, body, created_at)
                values (${deal}, 'note', ${ada.id}, ${`n${i}`}, ${new Date(base + Math.floor(i / 3) * 60_000)})`;
    }
    const all = await dealEventIds();
    expect(all).toHaveLength(120);
    for (const target of [{ dealId: deal }, { personId: adaP }, { organisationId: org }]) {
      const p50 = await readTimeline(ada.id, target, 50);
      expect(p50.entries.map((e) => e.id)).toEqual(all.slice(0, 50));
      expect(p50.more).toBe(true);
      const p100 = await readTimeline(ada.id, target, 100);
      expect(p100.entries.map((e) => e.id)).toEqual(all.slice(0, 100));
      const p150 = await readTimeline(ada.id, target, 150);
      expect(p150.entries.map((e) => e.id)).toEqual(all);
      expect(p150.more).toBe(false);
    }
  });
});
