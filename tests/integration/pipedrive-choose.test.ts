// covers SF-122 FR-001, FR-002, FR-003, US1 scenario 1, US4 scenario 5, edge case 1 (People and Organisations ticked by
// the server too): the six checkboxes and the emails note, the server-side rule, and Files refused while Storage is off
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { getImportView, startImport } = await import("@/server/pipedrive/imports");
const imports = await import("@/app/(app)/settings/pipedrive-import/actions");
const ImportPage = (await import("@/app/(app)/settings/pipedrive-import/page")).default;
const { ChooseStep } = await import("@/app/(app)/settings/pipedrive-import/ChooseStep");
const { installFakePipedrive, TEST_PIPEDRIVE_KEY } = await import("../fakes/pipedrive");
const { makeUser, resetDb } = await import("./db-helpers");
const { connect, fakeCompany, LINUS_TOKEN } = await import("./pipedrive-helpers");

let linus: { id: number };

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  vi.stubEnv("SUPABASE_URL", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  fakeCompany(installFakePipedrive());
  await connect(linus.id, LINUS_TOKEN);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { to: string }).to;
  }
  throw new Error("no redirect");
}

describe("1 CHOOSE (FR-001)", () => {
  it("shows six checkboxes in order, all unticked, and the emails note; no emails checkbox", () => {
    const html = renderToStaticMarkup(createElement(ChooseStep, { error: null }));
    const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((b) => b[0]);
    expect(boxes.map((b) => /name="([a-z]+)"/.exec(b)![1])).toEqual(["people", "organisations", "deals", "notes", "activities", "files"]);
    expect(boxes.every((b) => !/checked/.test(b) && !/disabled=""/.test(b))).toBe(true);
    expect(html).toContain("Pipedrive emails are not imported: they will come from Gmail.");
    expect(html).not.toMatch(/name="emails"/);
  });
});

describe("the server ticks People and Organisations (FR-002)", () => {
  it("stores them ticked when Deals is ticked alone, and asks for the consent choice when Notes is ticked without it", async () => {
    expect(await startImport(linus.id, { people: false, organisations: false, notes: true, consent: null })).toEqual({ error: "pipedrive_consent_required" });
    const r = await startImport(linus.id, { people: false, organisations: false, deals: true, consent: "unsubscribed" });
    expect(r).toMatchObject({ existing: false });
    const [row] = await sql`select want_people, want_organisations, want_deals, want_notes from pipedrive_imports`;
    expect(row).toEqual({ want_people: true, want_organisations: true, want_deals: true, want_notes: false });
    expect((await getImportView(linus.id))!.progress.map((p) => p.kind)).toEqual(["organisations", "people", "deals"]);
  });

  it("the action passes the four new kinds (a page sent without People still gets them)", async () => {
    jar.set(SESSION_COOKIE, (await createSession(linus.id)).token);
    expect(await redirectOf(imports.startPipedriveImportAction(form({ activities: "on", consent: "subscribed" })))).toBe("/settings/pipedrive-import");
    const [row] = await sql`select want_people, want_organisations, want_activities from pipedrive_imports`;
    expect(row).toEqual({ want_people: true, want_organisations: true, want_activities: true });
  });
});

describe("Files while the file store is not set up (FR-003, US4-5)", () => {
  it("redirects with files_unreachable and the page shows the SF-116 message; nothing starts", async () => {
    vi.stubEnv("SUPABASE_URL", "https://storage.fake.invalid");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    jar.set(SESSION_COOKIE, (await createSession(linus.id)).token);
    const to = await redirectOf(imports.startPipedriveImportAction(form({ files: "on", consent: "subscribed" })));
    expect(to).toBe("/settings/pipedrive-import?error=files_unreachable");
    expect(await sql`select 1 from pipedrive_imports`).toHaveLength(0);
    const html = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({ error: "files_unreachable" }) }));
    expect(html).toContain("Files can&#x27;t be reached right now. Try again in a minute.");
  });
});
