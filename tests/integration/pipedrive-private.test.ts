// covers SF-117 US2 scenario 9, FR-013, FR-019, SC-006: an owner-only Pipedrive person is private in the CRM and only
// its CRM owner (also its creator) sees it, not the importing user nor a third user; the report counts it without
// naming it, and neither do the rendered progress and report pages. Organisations come in shared, counted.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
const { getImportView, runPart } = await import("@/server/pipedrive/imports");
const { namesForReport, reportLines } = await import("@/server/pipedrive/report");
const { listPeople } = await import("@/server/records/people");
const { parsePeopleQuery } = await import("@/server/records/list-query");
const ImportPage = (await import("@/app/(app)/settings/pipedrive-import/page")).default;
const { installFakePipedrive, TEST_PIPEDRIVE_KEY } = await import("../fakes/pipedrive");
const { makeUser, resetDb } = await import("./db-helpers");
const { COMPANY, connect, fakeCompany, LINUS_TOKEN, runToEnd, start } = await import("./pipedrive-helpers");

let linus: { id: number }, margaret: { id: number }, ada: { id: number };
let pd: { margaretOnly: number; janeOnly: number; shared: number; orgOnly: number };

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  const fake = installFakePipedrive();
  fakeCompany(fake);
  pd = {
    orgOnly: fake.addOrganization(COMPANY, { name: "Hidden Org Fake", owner_id: 2, visible_to: 1 }),
    margaretOnly: fake.addPerson(COMPANY, { first_name: "Priya", last_name: "Secretfake", owner_id: 2, visible_to: 1, emails: [{ value: "priya@fake.example", primary: true, label: "work" }] }),
    janeOnly: fake.addPerson(COMPANY, { first_name: "Jo", last_name: "Janeonlyfake", owner_id: 3, visible_to: 1 }),
    shared: fake.addPerson(COMPANY, { first_name: "Sam", last_name: "Groupfake", owner_id: 2, visible_to: 5 }),
  };
  await connect(linus.id, LINUS_TOKEN);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const personOf = async (pipedriveId: number) =>
  (await sql<{ id: number; private: boolean; owner_id: number; created_by: number }[]>`
    select p.id::int as id, p.private, p.owner_id::int as owner_id, p.created_by::int as created_by
    from pipedrive_links l join persons p on p.id = l.person_id where l.kind = 'person' and l.pipedrive_id = ${pipedriveId}`)[0];
const finds = async (viewerId: number, q: string) => (await listPeople(viewerId, parsePeopleQuery({ q }))).rows.length > 0;
const as = async (id: number) => jar.set(SESSION_COOKIE, (await createSession(id)).token);

describe("owner-only people", () => {
  it("are private with Margaret as owner and creator; only Margaret finds them (US2-9, SC-006)", async () => {
    await runToEnd(linus.id, await start(linus.id));
    expect(await personOf(pd.margaretOnly)).toMatchObject({ private: true, owner_id: margaret.id, created_by: margaret.id });
    expect(await finds(margaret.id, "Secretfake")).toBe(true);
    expect(await finds(linus.id, "Secretfake")).toBe(false);
    expect(await finds(ada.id, "Secretfake")).toBe(false);
    expect(await finds(linus.id, "priya@fake.example")).toBe(false);
    expect(await finds(linus.id, "")).toBe(true);
    expect((await listPeople(linus.id, parsePeopleQuery({}))).rows.map((r) => r.name)).not.toContain("Priya Secretfake");
  });
  it("of an owner with no CRM user go to the importer as owner and creator, seen by them alone", async () => {
    await runToEnd(linus.id, await start(linus.id));
    expect(await personOf(pd.janeOnly)).toMatchObject({ private: true, owner_id: linus.id, created_by: linus.id });
    expect(await finds(linus.id, "Janeonlyfake")).toBe(true);
    expect(await finds(margaret.id, "Janeonlyfake")).toBe(false);
    expect(await finds(ada.id, "Janeonlyfake")).toBe(false);
  });
  it("visible to a group in Pipedrive are shared, created by the importer", async () => {
    await runToEnd(linus.id, await start(linus.id));
    expect(await personOf(pd.shared)).toMatchObject({ private: false, owner_id: margaret.id, created_by: linus.id });
    expect(await finds(ada.id, "Groupfake")).toBe(true);
  });
  it("are counted, never named, in the report and on the rendered progress and report pages (FR-019)", async () => {
    const id = await start(linus.id);
    await as(linus.id);
    await runPart(linus.id, id);
    const progress = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({}) }));
    expect(progress).toContain("2 IMPORTING");
    expect(progress).not.toContain("Secretfake");
    await runToEnd(linus.id, id);
    const view = (await getImportView(linus.id))!;
    const lines = reportLines(view.report, await namesForReport(linus.id, view.report)).map((l) => l.text);
    expect(lines).toContain("1 private person of other owners imported.");
    expect(lines).toContain("1 owner-only organisation imported as shared.");
    expect(JSON.stringify(view.report)).not.toContain("Secretfake");
    const report = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({}) }));
    expect(report).toContain("1 private person of other owners imported.");
    expect(report).not.toContain("Secretfake");
    expect(report).not.toContain("priya@");
  });
});

describe("owner-only organisations", () => {
  it("come in shared and are counted (FR-013)", async () => {
    await runToEnd(linus.id, await start(linus.id));
    const [org] = await sql`select o.owner_id::int as owner from pipedrive_links l join organisations o on o.id = l.organisation_id where l.kind = 'organisation' and l.pipedrive_id = ${pd.orgOnly}`;
    expect(org.owner).toBe(margaret.id);
    expect((await getImportView(linus.id))!.report.ownerOnlyOrganisations).toBe(1);
  });
});
