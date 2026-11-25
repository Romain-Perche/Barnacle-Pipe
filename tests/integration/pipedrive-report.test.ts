// covers SF-122 FR-018, FR-019, FR-021, US5 scenarios 1–2, edge cases ("<a href…>" in a deal title, note, activity subject
// or file name shown as text; a private deal never named): the progress lines and paused text in kind order, and the
// rendered report: counts per kind, "// PIPELINES", "// NOT IMPORTED" for each kind, lines, links to Deals and Activities
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
  usePathname: () => "/settings",
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { safeDownloadName } = await import("@/server/files/rules");
const { getImportView, runPart } = await import("@/server/pipedrive/imports");
const ImportPage = (await import("@/app/(app)/settings/pipedrive-import/page")).default;
const { installFakePipedrive, TEST_PIPEDRIVE_KEY } = await import("../fakes/pipedrive");
const { StorageFake } = await import("../fakes/storage");
const { makeUser, resetDb } = await import("./db-helpers");
const { makePipeline } = await import("./deal-helpers");
const { PDF } = await import("./file-helpers");
const { COMPANY, connect, fakeCompany, linkTarget, LINUS_TOKEN, runToEnd, start } = await import("./pipedrive-helpers");

const EVIL = '<a href="https://evil.example">Click</a>';
const storage = new StorageFake();
beforeAll(() => void storage.install());
let linus: { id: number }, margaret: { id: number };
let ids: Record<string, number>;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  const fake = installFakePipedrive();
  fakeCompany(fake);
  const pipeline = fake.addPipeline(COMPANY, { name: "Fake Partners" });
  const stage = fake.addStage(COMPANY, { pipeline_id: pipeline, name: "Intro" });
  const noName = fake.addPerson(COMPANY, { first_name: "", last_name: "", name: "", owner_id: 1 });
  ids = {
    evilDeal: fake.addDeal(COMPANY, { title: EVIL, owner_id: 1, stage_id: stage, person_id: noName }),
    usdDeal: fake.addDeal(COMPANY, { title: EVIL, owner_id: 1, stage_id: stage, value: 5, currency: "USD" }),
    privateDeal: fake.addDeal(COMPANY, { title: "Margaret secret fake", owner_id: 2, stage_id: stage, visible_to: 1 }),
  };
  ids.emptyNote = fake.addNote(COMPANY, { content: "<p></p>", user_id: 1, deal_id: ids.privateDeal });
  ids.evilNote = fake.addNote(COMPANY, { content: `&lt;a href="https://evil.example"&gt;Click&lt;/a&gt;`, user_id: 1, deal_id: ids.usdDeal });
  ids.evilActivity = fake.addActivity(COMPANY, { subject: EVIL, owner_id: 1, due_date: null });
  ids.evilFile = fake.addFile(COMPANY, { name: `${EVIL}.pdf`, user_id: 1, deal_id: ids.usdDeal }, PDF);
  ids.linkFile = fake.addFile(COMPANY, { name: EVIL, user_id: 1, deal_id: ids.usdDeal, remote_location: "googledrive" });
  await connect(linus.id, LINUS_TOKEN);
  await makePipeline("Sales", ["Lead"]);
  jar.set(SESSION_COOKIE, (await createSession(linus.id)).token);
});
afterAll(async () => {
  storage.uninstall();
  vi.unstubAllEnvs();
  await closeDb();
});

const page = async (q: Record<string, string> = {}) => renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve(q) }));

describe("progress (FR-018, US5-1)", () => {
  it("lists the ticked kinds in order, with the paused text in the same order", async () => {
    const id = await start(linus.id, { deals: true, notes: true, activities: true, files: true });
    await runPart(linus.id, id);
    await sql`update pipedrive_imports set seen_at = now() - interval '1 minute' where id = ${id}`;
    const view = (await getImportView(linus.id))!;
    expect(view.progress.map((p) => p.kind)).toEqual(["organisations", "people", "deals", "notes", "activities", "files"]);
    expect(view.pausedText).toMatch(/^Import paused: Organisations 0 of 0, People 0 of 0, Deals 0 of 0, Notes 0 of 0, Activities 0 of 0, Files 0 of 0\.$/);
    const html = await page();
    for (const k of ["Organisations", "People", "Deals", "Notes", "Activities", "Files"]) expect(html).toContain(`${k} · 0 of 0`);
  });
});

describe("the report (FR-019, FR-021, US5-2)", () => {
  it("shows the counts per kind, pipelines, records not imported as text, lines, and links to Deals and Activities", async () => {
    const id = await start(linus.id, { deals: true, notes: true, activities: true, files: true });
    await runToEnd(linus.id, id);
    const html = await page();
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain("Deal · &lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt;");
    expect(html).toContain("Activity · &lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt;");
    expect(html).toContain("File · &lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt;");
    expect(html).toContain("</span> PIPELINES");
    expect(html).toContain("Pipeline &#x27;Fake Partners&#x27; added with 1 stage.");
    expect(html).toContain("Empty once its formatting is removed. (on a private deal)");
    expect(html).not.toContain("Margaret secret fake");
    expect(html).toContain("1 private deal of other owners imported.");
    for (const row of ["Deals", "Notes", "Activities", "Files"]) expect(html).toMatch(new RegExp(`<th scope="row">${row}</th><td>\\d+</td><td>—</td>`));
    expect(html).toContain('href="/deals"');
    expect(html).toContain('href="/activities"');
    // The imported note and file keep the Pipedrive text as text; the file downloads under a safe name.
    const noteId = (await linkTarget("note", ids.evilNote))!;
    expect((await sql`select body from timeline_events where id = ${noteId}`)[0].body).toBe(EVIL);
    const fileId = (await linkTarget("file", ids.evilFile))!;
    const [file] = await sql<{ name: string }[]>`select name from files where id = ${fileId}`;
    expect(file.name).toBe(`${EVIL}.pdf`);
    expect(safeDownloadName(file.name)).not.toMatch(/[<>"]/);
    void margaret;
  });
});
