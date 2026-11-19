// covers FR-002..FR-005, FR-008, SC-002, US1 scenarios 2–5, edge cases (case, first admin deactivated, new Google name)
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeSignIn } from "@/server/auth/sign-in";
import { closeDb, sql } from "@/server/db";
import { count, getUser, makeUser, resetDb } from "./db-helpers";

const id = (email: string, name: string | null = "Some Name", extra: Partial<{ emailVerified: boolean; hd: string | null }> = {}) => ({
  email,
  name,
  emailVerified: true,
  hd: null,
  ...extra,
});

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("FIRST_ADMIN_EMAIL", "boss@barnacle.ai");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(closeDb);

describe("completeSignIn", () => {
  it("lets a listed active user in: session created, name and last sign-in updated (US1-2, FR-008)", async () => {
    await makeUser({ email: "mikey@barnacle.ai", name: "mikey" });
    const result = await completeSignIn(id("Mikey@Barnacle.ai", "Mikey Fake"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const user = await getUser("mikey@barnacle.ai");
    expect(user.name).toBe("Mikey Fake");
    expect(user.last_sign_in_at).toBeInstanceOf(Date);
    expect(await count("sessions")).toBe(1);
  });

  it("replaces the stored name with a new Google name (edge case)", async () => {
    await makeUser({ email: "jd@barnacle.ai", name: "JD" });
    await completeSignIn(id("jd@barnacle.ai", "John Doe"));
    expect((await getUser("jd@barnacle.ai")).name).toBe("John Doe");
  });

  it("refuses an unlisted barnacle.ai account with not_allowed and no session (US1-4)", async () => {
    expect(await completeSignIn(id("someone@barnacle.ai"))).toEqual({ ok: false, code: "not_allowed" });
    expect(await count("sessions")).toBe(0);
    expect(await count("users")).toBe(0);
  });

  it("refuses a gmail account with domain (US1-5)", async () => {
    expect(await completeSignIn(id("me@gmail.com"))).toEqual({ ok: false, code: "domain" });
    expect(await count("sessions")).toBe(0);
  });

  it("refuses an unverified barnacle.ai email with domain", async () => {
    await makeUser({ email: "ada@barnacle.ai" });
    expect(await completeSignIn(id("ada@barnacle.ai", "Ada", { emailVerified: false }))).toEqual({ ok: false, code: "domain" });
    expect(await count("sessions")).toBe(0);
  });

  it("refuses a deactivated user with removed (US2-6)", async () => {
    await makeUser({ email: "alan@barnacle.ai", status: "deactivated" });
    expect(await completeSignIn(id("alan@barnacle.ai"))).toEqual({ ok: false, code: "removed" });
    expect(await count("sessions")).toBe(0);
  });

  it("creates the first admin on an empty system with an 'added' change by nobody (US1-3, FR-004)", async () => {
    const result = await completeSignIn(id("Boss@Barnacle.ai", "Boss Fake"));
    expect(result.ok).toBe(true);
    const boss = await getUser("boss@barnacle.ai");
    expect(boss).toMatchObject({ role: "admin", status: "active", name: "Boss Fake", added_by: null });
    const changes = await sql`select user_id::int as user_id, actor_id, action from user_changes`;
    expect(changes).toEqual([{ user_id: boss.id, actor_id: null, action: "added" }]);
  });

  it("creates only one first admin when two first sign-ins race", async () => {
    const [a, b] = await Promise.all([completeSignIn(id("boss@barnacle.ai", "Boss")), completeSignIn(id("boss@barnacle.ai", "Boss"))]);
    expect(a.ok && b.ok).toBe(true);
    expect(await count("users")).toBe(1);
    expect(await count("user_changes")).toBe(1);
    expect(await count("sessions")).toBe(2);
  });

  it("refuses the first admin once deactivated (edge case)", async () => {
    await makeUser({ email: "boss@barnacle.ai", role: "admin", status: "deactivated" });
    expect(await completeSignIn(id("boss@barnacle.ai"))).toEqual({ ok: false, code: "removed" });
  });

  it("does not create a first admin when FIRST_ADMIN_EMAIL is empty", async () => {
    vi.stubEnv("FIRST_ADMIN_EMAIL", "");
    expect(await completeSignIn(id("boss@barnacle.ai"))).toEqual({ ok: false, code: "not_allowed" });
  });

  it("clears the user's expired and revoked sessions on sign-in", async () => {
    const u = await makeUser({ email: "ada@barnacle.ai" });
    await sql`insert into sessions (token_hash, user_id, expires_at) values ('\\x01', ${u.id}, now() - interval '1 day')`;
    await sql`insert into sessions (token_hash, user_id, expires_at, revoked_at) values ('\\x02', ${u.id}, now() + interval '1 day', now())`;
    await completeSignIn(id("ada@barnacle.ai"));
    expect(await count("sessions")).toBe(1);
  });
});
