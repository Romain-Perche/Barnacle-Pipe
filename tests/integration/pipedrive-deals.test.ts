// covers SF-122 FR-004–FR-008, US1 scenarios 2–11, SC-003, SC-005, edge cases (non-admin creates pipelines, private person,
// value and lost reason limits); T016: no Pipedrive call while an import transaction is open (Supabase pooler rule).
// The spec's Independent Test set: 3 pipelines (Sales with an extra stage, "exec dinner " matching "Exec Dinner", Fake
// Partners missing) and 40 deals over two pages and more, imported by Linus Fake (not an admin).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getBoard, getDeal, getStageSeconds } from "@/server/deals/deals";
import { addPipeline, addStage } from "@/server/deals/pipelines";
import type { FakePipedrive } from "@/server/pipedrive/fake-pipedrive";
import { getImportView, onSaveForTests } from "@/server/pipedrive/imports";
import { itemText, namesForReport, pipelineLines, reportLines, warningLines } from "@/server/pipedrive/report";
import { readTimeline } from "@/server/records/timeline";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makeField } from "./custom-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb } from "./db-helpers";
import { makeDealLabel, makePipeline } from "./deal-helpers";
import { COMPANY, connect, fakeCompany, linkTarget, LINUS_TOKEN, runToEnd, start } from "./pipedrive-helpers";

const BUDGET = "fake_deal_budget";
const REGION = "fake_deal_region";

// The deals set. Pipedrive users: 1 Fake Person (Linus), 2 Margaret Pipedrive Fake, 3 Jane Fake (no CRM user).
function seedDealsSet(fake: FakePipedrive) {
  fakeCompany(fake);
  fake.addField(COMPANY, "deal", { field_code: "label", field_name: "Label", field_type: "set", is_custom_field: false, options: [{ id: 1, label: "Hot" }, { id: 2, label: "VIP" }] });
  fake.addField(COMPANY, "deal", { field_code: BUDGET, field_name: "Budget", field_type: "double", is_custom_field: true });
  fake.addField(COMPANY, "deal", { field_code: REGION, field_name: "Region", field_type: "varchar", is_custom_field: true });
  const sales = fake.addPipeline(COMPANY, { name: "Sales", order_nr: 1 });
  const dinner = fake.addPipeline(COMPANY, { name: "exec dinner ", order_nr: 2 });
  const partners = fake.addPipeline(COMPANY, { name: "Fake Partners", order_nr: 3 });
  const stage = {
    lead: fake.addStage(COMPANY, { pipeline_id: sales, name: "lead", order_nr: 1 }),
    proposal: fake.addStage(COMPANY, { pipeline_id: sales, name: "Proposal", order_nr: 2 }),
    invited: fake.addStage(COMPANY, { pipeline_id: dinner, name: "Invited", order_nr: 1 }),
    partners: ["Intro", "Call", "Pilot", "Contract", "Live"].map((name, i) => fake.addStage(COMPANY, { pipeline_id: partners, name, order_nr: i + 1 })),
  };
  const org = fake.addOrganization(COMPANY, { name: "Fakeco Deals Ltd", owner_id: 1 });
  const e = (value: string) => [{ value, primary: true, label: "work" }];
  const person = {
    main: fake.addPerson(COMPANY, { first_name: "Mia", last_name: "Mainfake", owner_id: 1, org_id: org, emails: e("mia@fake.example") }),
    other: fake.addPerson(COMPANY, { first_name: "Otto", last_name: "Otherfake", owner_id: 1, emails: e("otto@fake.example") }),
    noName: fake.addPerson(COMPANY, { first_name: "", last_name: "", name: "", owner_id: 1, emails: e("no.name.fake@fake.example") }),
    existing: fake.addPerson(COMPANY, { first_name: "Ex", last_name: "Isting", owner_id: 1, emails: e("existing.private@fake.example") }),
  };
  const D = (o: Parameters<FakePipedrive["addDeal"]>[1], extra?: Parameters<FakePipedrive["addDeal"]>[2]) => fake.addDeal(COMPANY, o, extra);
  const deal = {
    full: D(
      {
        title: "  Fakeco renewal ", owner_id: 2, stage_id: stage.proposal, person_id: person.main, org_id: org, value: 1234.5, currency: "GBP",
        add_time: "2025-01-02 03:04:05", stage_change_time: "2025-03-01 10:00:00", expected_close_date: "2026-12-31", label_ids: [1, 2],
        custom_fields: { [BUDGET]: 5000, [REGION]: "North" },
      },
      { followers: [1, 3], participants: [person.main, person.other, person.noName] },
    ),
    won: D({ title: "Won fake deal", owner_id: 1, stage_id: stage.lead, status: "won", won_time: "2025-05-05 05:05:05", add_time: "2025-01-01 00:00:00" }),
    lostReason: D({ title: "Lost fake deal", owner_id: 1, stage_id: stage.lead, status: "lost", lost_time: "2025-04-04 04:04:04", lost_reason: "Too dear" }),
    lostNoReason: D({ title: "Lost no reason fake", owner_id: 1, stage_id: stage.lead, status: "lost", lost_time: "2025-04-04 04:04:04" }),
    lostLong: D({ title: "Lost long fake", owner_id: 1, stage_id: stage.lead, status: "lost", lost_time: "2025-04-04 04:04:04", lost_reason: "x".repeat(501) }),
    ownerOnlyMargaret: D({ title: "Margaret private fake", owner_id: 2, stage_id: stage.invited, visible_to: 1 }),
    ownerOnlyJane: D({ title: "Jane private fake", owner_id: 3, stage_id: stage.invited, visible_to: 1 }),
    usd: D({ title: "Dollar fake deal", owner_id: 1, stage_id: stage.lead, value: 99, currency: "USD" }),
    noNamePerson: D({ title: "No person fake deal", owner_id: 1, stage_id: stage.lead, person_id: person.noName }),
    archived: D({ title: "Archived fake deal", owner_id: 1, stage_id: stage.partners[1], is_archived: true, update_time: "2025-07-07 07:07:07" }),
    privatePerson: D({ title: "On private person fake", owner_id: 1, stage_id: stage.lead, person_id: person.existing }),
    filler: [] as number[],
  };
  for (let i = 1; deal.filler.length + 11 < 40; i++) {
    deal.filler.push(D({ title: `Filler fake deal ${i}`, owner_id: 1, stage_id: stage.partners[i % 5], value: i }));
  }
  return { stage, person, deal, org };
}

let linus: { id: number }, margaret: { id: number }, ada: { id: number };
let fake: FakePipedrive;
let set: ReturnType<typeof seedDealsSet>;
let salesId: number, budgetId: number, hotId: number;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  set = seedDealsSet(fake);
  await connect(linus.id, LINUS_TOKEN);
  salesId = (await makePipeline("Sales", ["Lead", "Won"])).id;
  await makePipeline("Exec Dinner", ["Invited"]);
  hotId = await makeDealLabel("Hot");
  budgetId = (await makeField({ kind: "deal", name: "Budget", type: "number" })).id;
  // A private CRM person of Margaret's with the email of a Pipedrive person: linked, not seen by Linus.
  await makePerson({ firstName: "Ex", lastName: "Isting", createdBy: margaret.id, private: true, emails: ["existing.private@fake.example"] });
});
afterEach(() => onSaveForTests(null));
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function importDeals() {
  const id = await start(linus.id, { deals: true, people: false, organisations: false });
  await runToEnd(linus.id, id);
  return (await getImportView(linus.id))!;
}
const dealOf = async (pdId: number) => {
  const id = await linkTarget("deal", pdId);
  if (typeof id !== "number") throw new Error(`deal ${pdId} not imported`);
  return id;
};

describe("pipelines and stages (US1-2, US1-3, FR-004)", () => {
  it("matches by name, adds a missing stage at the end and creates a missing pipeline, as a non-admin; admin pages still refuse him", async () => {
    const view = await importDeals();
    expect(view.state).toBe("finished");
    const pipelines = await sql<{ name: string; position: number }[]>`select name, position from pipelines order by position`;
    expect(pipelines).toEqual([{ name: "Sales", position: 1 }, { name: "Exec Dinner", position: 2 }, { name: "Fake Partners", position: 3 }]);
    const sales = await sql<{ name: string; position: number }[]>`select name, position from stages where pipeline_id = ${salesId} order by position`;
    expect(sales).toEqual([{ name: "Lead", position: 1 }, { name: "Won", position: 2 }, { name: "Proposal", position: 3 }]);
    const partners = await sql<{ name: string }[]>`
      select s.name from stages s join pipelines p on p.id = s.pipeline_id where p.name = 'Fake Partners' order by s.position`;
    expect(partners.map((s) => s.name)).toEqual(["Intro", "Call", "Pilot", "Contract", "Live"]);
    expect(pipelineLines(view.report).map((l) => l.text)).toEqual([
      "Pipeline 'Fake Partners' added with 5 stages.",
      "Stage 'Proposal' added to the pipeline Sales.",
    ]);
    expect(await addPipeline(linus.id, "Linus pipeline")).toEqual({ status: "forbidden" });
    expect(await addStage(linus.id, salesId, "Linus stage")).toEqual({ status: "forbidden" });
    // The boards: open deals in their columns.
    const board = (await getBoard(linus.id, salesId))!;
    expect(board.columns.find((c) => c.name === "Proposal")!.cards.map((c) => c.title)).toEqual(["Fakeco renewal"]);
  });
});

describe("deal values (US1-4 to US1-11, FR-005–FR-008)", () => {
  it("imports title, value, owner, person, organisation, dates, labels, followers, other people and custom fields", async () => {
    const view = await importDeals();
    const id = await dealOf(set.deal.full);
    const d = (await getDeal(linus.id, id))!;
    expect(d).toMatchObject({
      title: "Fakeco renewal", valuePence: 123450, stage: { name: "Proposal" }, owner: { id: margaret.id }, expectedClose: "2026-12-31",
      createdAt: new Date("2025-01-02T03:04:05Z"), status: "open", private: false, createdBy: linus.id,
    });
    expect(d.person?.name).toBe("Mia Mainfake");
    expect(d.organisation?.name).toBe("Fakeco Deals Ltd");
    expect(d.labels.map((l) => l.id)).toEqual([hotId]);
    expect(d.followers.map((f) => f.id)).toEqual([linus.id]);
    expect(d.otherPeople.map((p) => p.name)).toEqual(["Otto Otherfake"]);
    expect(d.custom.find((c) => c.field.id === budgetId)?.text).toBe("5,000");
    const names = await namesForReport(linus.id, view.report);
    const lines = reportLines(view.report, names).map((l) => l.text);
    expect(lines).toContain("No CRM field named 'Region'.");
    expect(lines).toContain("Deal label not on the list: 'VIP' (1 deal)");
    expect(lines).toContain("1 private deal of other owners imported.");
    expect(lines).toContain("Owner 'Jane Fake' (jane@fake.example) has no CRM user: 1 record given to you.");
    const warnings = warningLines(view.report, names).map((w) => `${w.label}: ${w.text}`);
    expect(warnings).toContain("Fakeco renewal: Linked person 'no.name.fake@fake.example' was not imported: left out.");
    expect(warnings).toContain("Dollar fake deal: Value in USD, not GBP: left out.");
    expect(warnings).toContain("Lost long fake: Lost reason too long to import from Pipedrive.");
    expect((await getDeal(linus.id, await dealOf(set.deal.usd)))!.valuePence).toBeNull();
  });

  it("won, lost and archived with Pipedrive's dates and reasons; the stage bar starts at the last stage change; one timeline entry", async () => {
    await importDeals();
    expect((await getDeal(linus.id, await dealOf(set.deal.won)))!).toMatchObject({ status: "won", closedAt: new Date("2025-05-05T05:05:05Z") });
    expect((await getDeal(linus.id, await dealOf(set.deal.lostReason)))!).toMatchObject({ status: "lost", lostReason: "Too dear", closedAt: new Date("2025-04-04T04:04:04Z") });
    expect((await getDeal(linus.id, await dealOf(set.deal.lostNoReason)))!.lostReason).toBe("No reason given in Pipedrive.");
    expect((await getDeal(linus.id, await dealOf(set.deal.lostLong)))!.lostReason).toBe("Lost reason too long to import from Pipedrive.");
    expect((await getDeal(linus.id, await dealOf(set.deal.archived)))!).toMatchObject({ archived: true, archivedAt: new Date("2025-07-07T07:07:07Z") });
    const full = await dealOf(set.deal.full);
    const seconds = await getStageSeconds(full, salesId);
    expect(seconds.find((s) => s.name === "Lead")!.seconds).toBe(0);
    const proposal = seconds.find((s) => s.name === "Proposal")!.seconds;
    expect(Math.abs(proposal - (Date.now() - Date.parse("2025-03-01T10:00:00Z")) / 1000)).toBeLessThan(120);
    const events = await sql<{ kind: string }[]>`select kind from timeline_events where deal_id = any(${await sql`select deal_id from pipedrive_links where kind = 'deal'`.then((r) => r.map((x) => x.deal_id))}::bigint[])`;
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set(["pipedrive_imported"]));
    expect(events).toHaveLength(39);
    const timeline = await readTimeline(linus.id, { dealId: full });
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]).toMatchObject({ kind: "pipedrive_imported", actorName: "Linus Fake" });
  });

  it("skips a deal whose person was not imported (listed), keeps one on a private linked person, and keeps owner-only deals private", async () => {
    const view = await importDeals();
    expect(await linkTarget("deal", set.deal.noNamePerson)).toBeUndefined();
    const names = await namesForReport(linus.id, view.report);
    const item = view.report.notImported.find((n) => n.kind === "deal" && n.pipedriveId === set.deal.noNamePerson)!;
    expect(item.label).toBe("No person fake deal");
    expect(itemText(item, names)).toBe("Its person 'no.name.fake@fake.example' was not imported.");
    expect(view.counts.deals).toEqual({ imported: 39, linked: 0, already: 0, notImported: 1 });
    const onPrivate = await dealOf(set.deal.privatePerson);
    expect((await getDeal(linus.id, onPrivate))!.person).toBeNull();
    const [row] = await sql<{ person_id: number }[]>`select person_id::int as person_id from deals where id = ${onPrivate}`;
    expect(row.person_id).not.toBeNull();
    const margaretDeal = await dealOf(set.deal.ownerOnlyMargaret);
    expect(await getDeal(linus.id, margaretDeal)).toBeNull();
    expect((await getDeal(margaret.id, margaretDeal))!).toMatchObject({ private: true, createdBy: margaret.id });
    expect(await getDeal(ada.id, margaretDeal)).toBeNull();
    expect((await getDeal(linus.id, await dealOf(set.deal.ownerOnlyJane)))!).toMatchObject({ private: true, createdBy: linus.id, owner: { id: linus.id } });
    expect(view.progress.map((p) => p.kind)).toEqual(["organisations", "people", "deals"]);
    expect(view.progress[2]).toEqual({ kind: "deals", done: 40, total: 40 });
  });

  it("a repeat counts every deal as already imported and adds nothing (FR-016)", async () => {
    await importDeals();
    const before = (await sql<{ n: number }[]>`select count(*)::int as n from deals`)[0].n;
    const view = await importDeals();
    expect((await sql<{ n: number }[]>`select count(*)::int as n from deals`)[0].n).toBe(before);
    expect(view.counts.deals).toMatchObject({ imported: 0, already: 39 });
    expect(view.report.pipelinesAdded).toEqual([]);
  });
});

describe("no outside call inside a transaction (T016, Supabase pooler rule)", () => {
  it("makes no Pipedrive call between the start and the end of any import transaction", async () => {
    let open = false;
    let seen = 0;
    onSaveForTests({
      before: () => {
        open = true;
        seen = fake.requests.length;
      },
      after: () => {
        expect(fake.requests.length).toBe(seen);
        open = false;
      },
    });
    await importDeals();
    expect(open).toBe(false);
    expect(fake.requests.some((r) => r.path.endsWith("/followers"))).toBe(true);
    expect(fake.requests.some((r) => r.path.endsWith("/participants"))).toBe(true);
  });
});

describe("existing CRM records", () => {
  it("puts a deal on an existing CRM organisation of the same name (linked)", async () => {
    const orgId = await makeOrganisation({ name: "Fakeco Deals Ltd", ownerId: margaret.id });
    await importDeals();
    const [row] = await sql<{ organisation_id: number }[]>`select organisation_id::int as organisation_id from deals where id = ${await dealOf(set.deal.full)}`;
    expect(row.organisation_id).toBe(orgId);
  });
});
