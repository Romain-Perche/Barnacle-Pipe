// covers SF-117 FR-027, edge cases on signed-out and deactivated users: every Settings and import action refuses a
// signed-out or deactivated user and changes nothing; actions and parts act only on the user's own import; the import
// page of a user with no connection goes to /settings.
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

const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { runPart } = await import("@/server/pipedrive/imports");
const settings = await import("@/app/(app)/settings/actions");
const imports = await import("@/app/(app)/settings/pipedrive-import/actions");
const ImportPage = (await import("@/app/(app)/settings/pipedrive-import/page")).default;
const { installFakePipedrive, TEST_PIPEDRIVE_KEY } = await import("../fakes/pipedrive");
const { makeUser, resetDb } = await import("./db-helpers");
const { COMPANY, connect, fakeCompany, importRow, LINUS_TOKEN, MARGARET_TOKEN, start } = await import("./pipedrive-helpers");

let linus: { id: number }, margaret: { id: number }, alan: { id: number };

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake" });
  const fake = installFakePipedrive();
  fakeCompany(fake);
  fake.addCompany({ token: "test-token-alan", user: { id: 9, name: "Alan Pipedrive Fake", email: "alan@barnacle.ai" }, companyId: COMPANY, companyName: "Fakeco Pipedrive" });
  fake.addPerson(COMPANY, { first_name: "Some", last_name: "Fake", owner_id: 1 });
  await connect(linus.id, LINUS_TOKEN);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const as = async (id: number) => jar.set(SESSION_COOKIE, (await createSession(id)).token);
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
const state = async () => (await sql`
  select (select count(*)::int from pipedrive_connections) as connections, (select count(*)::int from pipedrive_imports) as imports,
         (select string_agg(state, ',' order by id) from pipedrive_imports) as states, (select count(*)::int from persons) as persons`)[0];

const ALL = () => [
  () => settings.saveTokenAction(form({ token: MARGARET_TOKEN })),
  () => settings.removeTokenAction(),
  () => imports.startPipedriveImportAction(form({ people: "on", organisations: "on", consent: "subscribed" })),
  () => imports.runPipedrivePartAction(1),
  () => imports.continuePipedriveImportAction(),
  () => imports.stopPipedriveImportAction(),
];

describe("a signed-out or deactivated user", () => {
  it("is refused by each of the six actions, and nothing changes", async () => {
    const id = await start(linus.id);
    const before = await state();
    for (const action of ALL()) expect(await redirectOf(action())).toMatch(/^\/auth\/end/);
    expect(await state()).toEqual(before);
    expect((await importRow(id)).state).toBe("running");
  });
  it("deactivated with an open import: refused by the actions and by runPart; the import does not move", async () => {
    await connect(alan.id, "test-token-alan");
    const id = await start(alan.id);
    await as(alan.id);
    await sql`update users set status = 'deactivated' where id = ${alan.id}`;
    const before = await state();
    for (const action of ALL()) expect(await redirectOf(action())).toMatch(/^\/auth\/end/);
    expect(await runPart(alan.id, id)).toEqual({ next: "stop" });
    expect(await state()).toEqual(before);
    expect((await importRow(id)).step).toBe("prepare");
  });
});

describe("another user's import", () => {
  it("cannot be moved on, continued or stopped by someone else", async () => {
    const id = await start(linus.id);
    await as(margaret.id);
    expect(await imports.runPipedrivePartAction(id)).toEqual({ next: "stop" });
    expect(await runPart(margaret.id, id)).toEqual({ next: "stop" });
    expect(await redirectOf(imports.stopPipedriveImportAction())).toBe("/settings/pipedrive-import");
    expect(await redirectOf(imports.continuePipedriveImportAction())).toBe("/settings/pipedrive-import");
    expect(await importRow(id)).toMatchObject({ state: "running", step: "prepare" });
    expect(await redirectOf(settings.removeTokenAction())).toBe("/settings?removed=1");
    expect(await sql`select 1 from pipedrive_connections where user_id = ${linus.id}`).toHaveLength(1);
  });
  it("is moved on by its own user through the action", async () => {
    const id = await start(linus.id);
    await as(linus.id);
    expect(await imports.runPipedrivePartAction(id)).toEqual({ next: "now" });
    expect((await importRow(id)).step).not.toBe("prepare");
    expect(await imports.runPipedrivePartAction(-1)).toEqual({ next: "stop" });
  });
});

describe("the import page and start action", () => {
  it("send a user with no connection to /settings", async () => {
    await as(margaret.id);
    expect(await redirectOf(ImportPage({ searchParams: Promise.resolve({}) }))).toBe("/settings");
    expect(await redirectOf(imports.startPipedriveImportAction(form({ organisations: "on" })))).toBe("/settings");
  });
  it("start, then going to the open import when starting again (US3-7)", async () => {
    await as(linus.id);
    expect(await redirectOf(imports.startPipedriveImportAction(form({ people: "on" })))).toBe("/settings/pipedrive-import?error=pipedrive_consent_required");
    expect(await redirectOf(imports.startPipedriveImportAction(form({})))).toBe("/settings/pipedrive-import?error=pipedrive_tick_something");
    expect(await redirectOf(imports.startPipedriveImportAction(form({ people: "on", consent: "subscribed" })))).toBe("/settings/pipedrive-import");
    expect(await redirectOf(imports.startPipedriveImportAction(form({ organisations: "on" })))).toBe("/settings/pipedrive-import");
    expect(await sql`select 1 from pipedrive_imports`).toHaveLength(1);
  });
});
