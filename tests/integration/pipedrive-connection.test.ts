// covers SF-117 US1 scenarios 1–6, FR-001–FR-003, FR-027, SC-007, edge cases on the token (empty, spaces, over 200
// characters), deactivation and no key: a token is checked with Pipedrive before it is saved, sealed, never shown, and
// each user sees and uses only their own.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-pathname": "/settings" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { getConnection, removeToken, saveToken, tokenFor } = await import("@/server/pipedrive/connection");
const { deactivate } = await import("@/server/users");
const SettingsPage = (await import("@/app/(app)/settings/page")).default;
const actions = await import("@/app/(app)/settings/actions");
const { installFakePipedrive, TEST_PIPEDRIVE_KEY } = await import("../fakes/pipedrive");
const { makeUser, resetDb } = await import("./db-helpers");

const TOKEN = "test-token-linus-0123456789";
let linus: { id: number }, margaret: { id: number }, ada: { id: number };
let fake: ReturnType<typeof installFakePipedrive>;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  fake.addCompany({ token: TOKEN, user: { id: 1, name: "Fake Person", email: "linus@barnacle.ai" }, companyId: 1001, companyName: "Fakeco Pipedrive" });
  fake.addCompany({ token: "test-token-margaret", user: { id: 2, name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" }, companyId: 1002, companyName: "Otherco Pipedrive" });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const stored = async (userId: number) => (await sql<{ token: Buffer }[]>`select token from pipedrive_connections where user_id = ${userId}`)[0]?.token ?? null;
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
// The whole token, and every 6-character slice of its own part (after the shared "test-token-" prefix).
function expectNoPart(html: string) {
  expect(html).not.toContain(TOKEN);
  const own = TOKEN.slice("test-token-".length);
  for (let i = 0; i + 6 <= own.length; i++) expect(html, own.slice(i, i + 6)).not.toContain(own.slice(i, i + 6));
}
async function page(query: Record<string, string> = {}) {
  return renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve(query) }));
}

describe("saveToken", () => {
  it("checks the token with Pipedrive, then saves the user name, company and date (US1-2, FR-002)", async () => {
    expect(await saveToken(linus.id, TOKEN)).toEqual({ ok: true });
    const state = await getConnection(linus.id);
    expect(state).toMatchObject({ ready: true, connection: { userName: "Fake Person", companyName: "Fakeco Pipedrive", companyId: 1001 } });
    if (!state.ready || !state.connection) throw new Error("not connected");
    expect(Date.now() - state.connection.savedAt.getTime()).toBeLessThan(60_000);
    expect(Object.keys(state.connection)).not.toContain("token");
    expect(fake.requests.map((r) => r.path)).toEqual(["/v1/users/me"]);
  });
  it("stores the token sealed, never in plain text (SC-007)", async () => {
    await saveToken(linus.id, TOKEN);
    const bytes = (await stored(linus.id))!;
    expect(bytes.includes(Buffer.from(TOKEN))).toBe(false);
    expect(bytes.toString("latin1")).not.toContain(TOKEN.slice(0, 8));
    expect(await tokenFor(linus.id)).toEqual({ token: TOKEN, companyId: 1001 });
  });
  it("removes spaces around the token before checking it (edge case)", async () => {
    expect(await saveToken(linus.id, `   ${TOKEN}  `)).toEqual({ ok: true });
    expect((await tokenFor(linus.id))?.token).toBe(TOKEN);
  });
  it("refuses an empty token, and one over 200 characters without asking Pipedrive (edge case)", async () => {
    expect(await saveToken(linus.id, "   ")).toEqual({ error: "pipedrive_token_required" });
    expect(await saveToken(linus.id, "x".repeat(201))).toEqual({ error: "pipedrive_token_refused" });
    expect(fake.requests).toEqual([]);
    expect(await stored(linus.id)).toBeNull();
  });
  it("refused or unreachable: the message, and an earlier token kept unchanged (US1-3, US1-4)", async () => {
    await saveToken(linus.id, TOKEN);
    const before = await stored(linus.id);
    expect(await saveToken(linus.id, "test-token-wrong")).toEqual({ error: "pipedrive_token_refused" });
    fake.failNext("network");
    expect(await saveToken(linus.id, "test-token-margaret")).toEqual({ error: "pipedrive_unreachable" });
    fake.failNext(500);
    expect(await saveToken(linus.id, "test-token-margaret")).toEqual({ error: "pipedrive_unreachable" });
    fake.slowDownEvery(1, 5);
    expect(await saveToken(linus.id, "test-token-margaret")).toEqual({ error: "pipedrive_unreachable" });
    expect((await stored(linus.id))!.equals(before!)).toBe(true);
    expect((await tokenFor(linus.id))?.token).toBe(TOKEN);
  });
  it("replaces a token with another accepted one (REPLACE TOKEN)", async () => {
    await saveToken(linus.id, TOKEN);
    expect(await saveToken(linus.id, "test-token-margaret")).toEqual({ ok: true });
    expect(await getConnection(linus.id)).toMatchObject({ connection: { companyName: "Otherco Pipedrive" } });
  });
});

describe("removing and deactivating", () => {
  it("removeToken deletes the row (US1-5)", async () => {
    await saveToken(linus.id, TOKEN);
    await removeToken(linus.id);
    expect(await stored(linus.id)).toBeNull();
    expect(await getConnection(linus.id)).toEqual({ ready: true, connection: null });
    expect(await tokenFor(linus.id)).toBeNull();
  });
  it("deactivating a user deletes their token (FR-003, edge case)", async () => {
    await saveToken(linus.id, TOKEN);
    expect(await deactivate(ada.id, linus.id)).toEqual({ ok: true });
    expect(await stored(linus.id)).toBeNull();
  });
});

describe("two users", () => {
  it("each sees and uses only their own connection (US1-6)", async () => {
    await saveToken(linus.id, TOKEN);
    await saveToken(margaret.id, "test-token-margaret");
    expect(await getConnection(linus.id)).toMatchObject({ connection: { companyName: "Fakeco Pipedrive" } });
    expect(await getConnection(margaret.id)).toMatchObject({ connection: { companyName: "Otherco Pipedrive" } });
    expect(await getConnection(ada.id)).toEqual({ ready: true, connection: null });
    // A sealed token copied to another user's row does not open (bound to its user).
    await sql`insert into pipedrive_connections (user_id, token, pipedrive_user_id, pipedrive_user_name, company_id, company_name)
              select ${ada.id}, token, pipedrive_user_id, pipedrive_user_name, company_id, company_name from pipedrive_connections where user_id = ${linus.id}`;
    expect(await tokenFor(ada.id)).toBeNull();
  });
});

describe("no key set up", () => {
  it("reports not set up and saves nothing (Clarifications, edge case)", async () => {
    vi.stubEnv("PIPEDRIVE_TOKEN_KEY", "");
    expect(await getConnection(linus.id)).toEqual({ ready: false });
    expect(await saveToken(linus.id, TOKEN)).toEqual({ error: "pipedrive_not_set_up" });
    expect(fake.requests).toEqual([]);
    await as(linus.id);
    const html = await page();
    expect(html).toContain("The Pipedrive import isn&#x27;t set up yet.");
    expect(html).not.toContain('name="token"');
  });
});

describe("the Settings page and its actions", () => {
  it("shows // PIPEDRIVE with the token field, the note and [ SAVE TOKEN ] (US1-1)", async () => {
    await as(linus.id);
    const html = await page();
    expect(html).toContain("Settings");
    expect(html).toContain("PIPEDRIVE");
    expect(html).toMatch(/<input[^>]*type="password"[^>]*name="token"|<input[^>]*name="token"[^>]*type="password"/);
    expect(html).toMatch(/autocomplete="off"/i);
    expect(html).toContain("In Pipedrive: Personal preferences → API.");
    expect(html).toContain("[ SAVE TOKEN ]");
  });
  it("saves through the action and shows the connection, never any part of the token (US1-2, SC-007)", async () => {
    await as(linus.id);
    expect(await redirectOf(actions.saveTokenAction(form({ token: TOKEN })))).toBe("/settings?saved=1");
    const html = await page({ saved: "1" });
    expect(html).toContain("Connected to Pipedrive as Fake Person (Fakeco Pipedrive).");
    expect(html).toMatch(/Token saved on \d{1,2} [A-Z][a-z]{2} \d{4}\./);
    for (const b of ["[ REPLACE TOKEN ]", "[ REMOVE TOKEN ]", "[ IMPORT FROM PIPEDRIVE ]"]) expect(html).toContain(b);
    expect(html).toContain("Pipedrive token saved.");
    expectNoPart(html);
    expect(html).not.toContain('name="token"');
    // [ REPLACE TOKEN ] shows the empty form again.
    const replace = await page({ replace: "1" });
    expect(replace).toContain('name="token"');
    expectNoPart(replace);
  });
  it("shows a refused token's message from a fixed code, never text from the address (US1-3, FR-028)", async () => {
    await as(linus.id);
    expect(await redirectOf(actions.saveTokenAction(form({ token: "test-token-wrong" })))).toBe("/settings?error=pipedrive_token_refused");
    expect(await page({ error: "pipedrive_token_refused" })).toContain("Pipedrive did not accept this token. Copy it again from Pipedrive and try again.");
    const odd = await page({ error: "<b>Your account is locked</b>" });
    expect(odd).not.toContain("Your account is locked");
    expect(await page({ error: "pipedrive_connected" })).not.toContain("Connected to Pipedrive");
  });
  it("removes through the confirmation box and the action (US1-5)", async () => {
    await as(linus.id);
    await saveToken(linus.id, TOKEN);
    const box = await page({ "remove-token": "1" });
    expect(box).toContain("Remove your Pipedrive token?");
    expect(await redirectOf(actions.removeTokenAction())).toBe("/settings?removed=1");
    expect(await stored(linus.id)).toBeNull();
    const html = await page({ removed: "1" });
    expect(html).toContain("Pipedrive token removed.");
    expect(html).toContain('name="token"');
  });
  it("refuses a signed-out or deactivated user and saves nothing (FR-027, edge case)", async () => {
    expect(await redirectOf(actions.saveTokenAction(form({ token: TOKEN })))).toMatch(/^\/auth\/end/);
    const alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake" });
    await as(alan.id);
    await sql`update users set status = 'deactivated' where id = ${alan.id}`;
    expect(await redirectOf(actions.saveTokenAction(form({ token: TOKEN })))).toMatch(/^\/auth\/end/);
    expect(await redirectOf(page())).toMatch(/^\/auth\/end/);
    expect(await sql`select 1 from pipedrive_connections`).toHaveLength(0);
  });
});
