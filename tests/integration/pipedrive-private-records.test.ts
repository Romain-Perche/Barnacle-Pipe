// covers SF-122 US1 scenario 8, Edge case 8, Edge case 9, FR-021, SC-005 (fix round 1): Margaret's owner-only records
// (a USD deal, a person with a warning, and a note, an activity and a file on that deal, each not imported) are never
// named in Linus's report — stored, listed, warned or rendered — only "a private deal / person / note / activity /
// file"; Margaret's own import of the same data names them.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-pathname": "/settings/pipedrive-import" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
  useRouter: () => ({ refresh: () => {} }),
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { getImportView } = await import("@/server/pipedrive/imports");
const { itemLabel, itemText, namesForReport, reportLines, warningLines } = await import("@/server/pipedrive/report");
const ImportPage = (await import("@/app/(app)/settings/pipedrive-import/page")).default;
const { installFakePipedrive, TEST_PIPEDRIVE_KEY } = await import("../fakes/pipedrive");
const { StorageFake } = await import("../fakes/storage");
const { makeUser, resetDb } = await import("./db-helpers");
const { makePipeline } = await import("./deal-helpers");
const { PDF } = await import("./file-helpers");
const { COMPANY, connect, fakeCompany, LINUS_TOKEN, MARGARET_TOKEN, runToEnd, start } = await import("./pipedrive-helpers");

const SECRET = "SF122 Margaret secret";
const storage = new StorageFake();
beforeAll(() => void storage.install());

let linus: { id: number }, margaret: { id: number };

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  const fake = installFakePipedrive();
  fakeCompany(fake);
  const pipeline = fake.addPipeline(COMPANY, { name: "Sales" });
  const stage = fake.addStage(COMPANY, { pipeline_id: pipeline, name: "Lead" });
  const longOrg = fake.addOrganization(COMPANY, { name: `Long Org Fake ${"o".repeat(210)}`, owner_id: 1 });
  fake.addPerson(COMPANY, { first_name: SECRET, last_name: "Person", owner_id: 2, visible_to: 1, org_id: longOrg });
  const deal = fake.addDeal(COMPANY, { title: `${SECRET} USD`, owner_id: 2, stage_id: stage, visible_to: 1, value: 10, currency: "USD" });
  fake.addNote(COMPANY, { content: `${SECRET} note ${"x".repeat(100_001)}`, user_id: 2, deal_id: deal });
  fake.addActivity(COMPANY, { subject: `${SECRET} ${"s".repeat(200)}`, type: "call", owner_id: 2, deal_id: deal, due_date: "2026-12-01" });
  fake.addFile(COMPANY, { name: `${SECRET} video.mp4`, user_id: 2, deal_id: deal, file_size: 27_000_000 }, PDF);
  await makePipeline("Sales", ["Lead"]);
});
afterAll(async () => {
  storage.uninstall();
  vi.unstubAllEnvs();
  await closeDb();
});

async function reportText(userId: number, token: string) {
  await connect(userId, token);
  await runToEnd(userId, await start(userId, { deals: true, notes: true, activities: true, files: true }));
  const view = (await getImportView(userId))!;
  const names = await namesForReport(userId, view.report);
  const [stored] = await sql<{ report: unknown }[]>`select report from pipedrive_imports where user_id = ${userId}`;
  jar.set(SESSION_COOKIE, (await createSession(userId)).token);
  const page = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({}) }));
  return [
    ...reportLines(view.report, names).map((l) => l.text),
    ...warningLines(view.report, names).map((w) => `${w.label}: ${w.text}`),
    ...view.report.notImported.map((n) => `${itemLabel(n)}: ${itemText(n, names)}`),
    JSON.stringify(stored.report),
    page,
  ].join("\n");
}

describe("records private to another owner in the importer's report", () => {
  it("are never named, only 'a private …' (US1-8, FR-021, SC-005)", async () => {
    const text = await reportText(linus.id, LINUS_TOKEN);
    expect(text).not.toContain(SECRET);
    for (const label of ["a private deal: Value in USD, not GBP: left out.", "a private person", "a private note", "a private activity", "a private file: Over 25 MB"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("1 private deal of other owners imported.");
  });

  it("are named in their owner's own report", async () => {
    const text = await reportText(margaret.id, MARGARET_TOKEN);
    expect(text).toContain(`${SECRET} USD`);
    expect(text).toContain(`${SECRET} Person`);
    expect(text).toContain(`${SECRET} video.mp4`);
    expect(text).not.toContain("a private deal");
  });
});
