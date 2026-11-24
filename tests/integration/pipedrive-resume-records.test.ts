// covers SF-122 FR-016, FR-017, FR-018, US5 scenarios 1, 3–5, SC-002, edge cases (deleted between parts, deleted in the
// CRM): the spec's large account scaled down (120 people, 40 organisations, 100 deals, 500 notes, 400 activities, 30
// files) with Pipedrive asking to slow down every 7 calls; stopped, continued, repeated, and two users at once: each
// Pipedrive deal, note, activity and file is in the CRM exactly once.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deleteDeal } from "@/server/deals/deals";
import { sweepFileCleanup } from "@/server/files/files";
import type { FakePipedrive } from "@/server/pipedrive/fake-pipedrive";
import { continueImport, getImportView, onSaveForTests, runPart } from "@/server/pipedrive/imports";
import { itemText, namesForReport } from "@/server/pipedrive/report";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { StorageFake } from "../fakes/storage";
import { makeUser, resetDb } from "./db-helpers";
import { makePipeline } from "./deal-helpers";
import { PDF } from "./file-helpers";
import { COMPANY, connect, fakeCompany, importRow, linkTarget, LINUS_TOKEN, MARGARET_TOKEN, runToEnd, skipWait, start } from "./pipedrive-helpers";

const storage = new StorageFake();
beforeAll(() => void storage.install());
afterAll(() => storage.uninstall());

function seedLarge(fake: FakePipedrive) {
  fakeCompany(fake);
  const pipeline = fake.addPipeline(COMPANY, { name: "Sales" });
  const stages = ["Lead", "Proposal"].map((name) => fake.addStage(COMPANY, { pipeline_id: pipeline, name }));
  const orgs = Array.from({ length: 40 }, (_, i) => fake.addOrganization(COMPANY, { name: `Large Org ${i} Fake`, owner_id: 1 }));
  const people = Array.from({ length: 120 }, (_, i) =>
    fake.addPerson(COMPANY, { first_name: `Large${i}`, last_name: "Fake", owner_id: 1, org_id: orgs[i % 40], emails: [{ value: `large${i}@fake.example`, primary: true, label: "work" }] }),
  );
  const deals = Array.from({ length: 100 }, (_, i) =>
    fake.addDeal(COMPANY, { title: `Large deal ${i} fake`, owner_id: i % 3 === 0 ? 2 : 1, stage_id: stages[i % 2], person_id: people[i], org_id: orgs[i % 40] }, i % 10 === 0 ? { followers: [1, 2], participants: [people[i], people[i + 1]] } : {}),
  );
  const notes = Array.from({ length: 500 }, (_, i) =>
    fake.addNote(COMPANY, { content: `<p>Large note ${i}</p>`, user_id: 1, ...(i % 3 === 0 ? { deal_id: deals[i % 100] } : i % 3 === 1 ? { person_id: people[i % 120] } : { org_id: orgs[i % 40] }) }),
  );
  const activities = Array.from({ length: 400 }, (_, i) =>
    fake.addActivity(COMPANY, { subject: `Large activity ${i}`, type: ["call", "meeting", "task"][i % 3], owner_id: 1, deal_id: deals[i % 100], due_date: "2026-12-01", done: i % 4 === 0 }),
  );
  const files = Array.from({ length: 30 }, (_, i) => fake.addFile(COMPANY, { name: `large-${i}.pdf`, user_id: 1, deal_id: deals[i] }, PDF));
  return { people, orgs, deals, notes, activities, files };
}

let linus: { id: number }, margaret: { id: number }, ada: { id: number };
let fake: FakePipedrive;
let set: ReturnType<typeof seedLarge>;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  storage.down(false);
  storage.store.keys().forEach((k) => storage.store.delete(k));
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  set = seedLarge(fake);
  await connect(linus.id, LINUS_TOKEN);
  await connect(margaret.id, MARGARET_TOKEN);
  await makePipeline("Sales", ["Lead", "Proposal"]);
});
afterEach(() => onSaveForTests(null));
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const ALL = { deals: true, notes: true, activities: true, files: true } as const;
const tally = async () => (await sql<{ deals: number; notes: number; activities: number; files: number; links: number }[]>`
  select (select count(*)::int from deals) as deals, (select count(*)::int from timeline_events where kind = 'note') as notes,
         (select count(*)::int from activities) as activities, (select count(*)::int from files) as files,
         (select count(*)::int from pipedrive_links where kind in ('deal', 'note', 'activity', 'file')) as links`)[0];
const FULL = { deals: 100, notes: 500, activities: 400, files: 30, links: 1030 };

describe("stop, continue, repeat (US5-1, US5-3, US5-5, FR-016–FR-018)", () => {
  it("closing half-way and continuing, with Pipedrive slowing down, leaves each record once; a repeat adds nothing", async () => {
    fake.slowDownEvery(7, 1);
    const id = await start(linus.id, ALL);
    for (let i = 0; i < 25; i++) {
      const r = await runPart(linus.id, id);
      if (r.next === "wait") await skipWait(id);
    }
    // The page was closed: the import shows as paused, then [ CONTINUE ].
    await sql`update pipedrive_imports set seen_at = now() - interval '1 minute', wait_until = null, state = 'running' where id = ${id}`;
    expect((await getImportView(linus.id))!.effectiveState).toBe("paused");
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    await continueImport(linus.id);
    const { waits } = await runToEnd(linus.id, id, 2000);
    expect(waits).toBeGreaterThan(0);
    expect(await tally()).toEqual(FULL);
    const view = (await getImportView(linus.id))!;
    expect(view.progress.map((p) => p.kind)).toEqual(["organisations", "people", "deals", "notes", "activities", "files"]);
    expect(view.progress.map((p) => [p.done, p.total])).toEqual([[40, 40], [120, 120], [100, 100], [500, 500], [400, 400], [30, 30]]);
    expect([view.counts.deals.imported, view.counts.notes.imported, view.counts.activities.imported, view.counts.files.imported]).toEqual([100, 500, 400, 30]);
    fake.slowDownEvery(null);
    const again = await start(linus.id, ALL);
    await runToEnd(linus.id, again, 2000);
    expect(await tally()).toEqual(FULL);
    const v2 = (await getImportView(linus.id))!;
    expect([v2.counts.deals.already, v2.counts.notes.already, v2.counts.activities.already, v2.counts.files.already]).toEqual([100, 500, 400, 30]);
    expect([v2.counts.deals.imported, v2.counts.notes.imported, v2.counts.activities.imported, v2.counts.files.imported]).toEqual([0, 0, 0, 0]);
    expect(storage.objects().size).toBe(30);
  });

  it("a page whose transaction fails saves nothing of it; continuing saves it once", async () => {
    const id = await start(linus.id, ALL);
    for (let i = 0; i < 200 && (await importRow(id)).step !== "notes"; i++) await runPart(linus.id, id);
    let fail = true;
    onSaveForTests({ after: () => { if (fail) throw new Error("forced failure"); } });
    await expect(runPart(linus.id, id)).rejects.toThrow("forced failure");
    expect((await importRow(id)).state).toBe("paused");
    expect((await tally()).notes).toBe(0);
    fail = false;
    await continueImport(linus.id);
    await runToEnd(linus.id, id, 2000);
    expect(await tally()).toEqual(FULL);
  });
});

describe("deleted records (edge cases)", () => {
  it("a deal deleted in Pipedrive between two parts is not imported and has no line", async () => {
    const id = await start(linus.id, { deals: true });
    for (let i = 0; i < 200 && (await importRow(id)).step !== "deals"; i++) await runPart(linus.id, id);
    fake.deleteDeal(COMPANY, set.deals[99]);
    await runToEnd(linus.id, id);
    expect(await linkTarget("deal", set.deals[99])).toBeUndefined();
    const view = (await getImportView(linus.id))!;
    expect(view.counts.deals).toMatchObject({ imported: 99, notImported: 0 });
    expect(view.report.notImported.some((n) => n.pipedriveId === set.deals[99])).toBe(false);
  });

  it("a deal deleted in the CRM is not added back; its new notes are listed as on a deleted deal", async () => {
    const first = await start(linus.id, { deals: true, notes: true });
    await runToEnd(linus.id, first, 2000);
    const crmDeal = (await linkTarget("deal", set.deals[0]))!;
    expect((await deleteDeal(ada.id, crmDeal)).status).toBe("deleted");
    const note = fake.addNote(COMPANY, { content: "New note on a deleted deal", user_id: 1, deal_id: set.deals[0] });
    const again = await start(linus.id, { deals: true, notes: true });
    await runToEnd(linus.id, again, 2000);
    expect(await linkTarget("deal", set.deals[0])).toBeNull();
    expect((await tally()).deals).toBe(99);
    const view = (await getImportView(linus.id))!;
    const item = view.report.notImported.find((n) => n.kind === "note" && n.pipedriveId === note)!;
    expect(itemText(item, await namesForReport(linus.id, view.report))).toBe("Its deal was deleted in the CRM.");
  });
});

describe("two users of one company at once (FR-016, SC-002)", () => {
  it("interleaved parts leave one CRM deal, note, activity and file per Pipedrive one, and one set of pipelines", async () => {
    await sql`delete from stages`;
    await sql`delete from pipelines`;
    const a = await start(linus.id, ALL);
    const b = await start(margaret.id, ALL);
    let doneA = false;
    let doneB = false;
    for (let i = 0; i < 2000 && !(doneA && doneB); i++) {
      if (!doneA) doneA = (await runPart(linus.id, a)).next === "stop";
      if (!doneB) doneB = (await runPart(margaret.id, b)).next === "stop";
    }
    expect(doneA && doneB).toBe(true);
    expect(await tally()).toEqual(FULL);
    expect(await sql`select name from pipelines`).toEqual([{ name: "Sales" }]);
    expect((await sql`select 1 from stages`).length).toBe(2);
    const va = (await getImportView(linus.id))!;
    const vb = (await getImportView(margaret.id))!;
    for (const k of ["deals", "notes", "activities", "files"] as const) expect(va.counts[k].imported + vb.counts[k].imported).toBe(FULL[k]);
    await sql`update file_cleanup set due_at = now() - interval '1 second'`;
    await sweepFileCleanup();
    const listed = new Set((await sql<{ storage_path: string }[]>`select storage_path from files`).map((r) => `${storage.bucket}/${r.storage_path}`));
    expect([...storage.objects().keys()].filter((k) => !listed.has(k))).toEqual([]);
  });
});
