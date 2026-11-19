// covers FR-025, FR-026, US3 scenarios 1, 2 and 4, SC-007
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { runSeeders } from "@/seed";
import { count, resetDb } from "./db-helpers";

beforeEach(resetDb);
afterAll(closeDb);

const FAKE_TEAM = [
  { email: "ada@barnacle.ai", name: "Ada Fake", role: "admin", status: "active" },
  { email: "alan@barnacle.ai", name: "Alan Fake", role: "user", status: "deactivated" },
  { email: "grace@barnacle.ai", name: "Grace Fake", role: "admin", status: "active" },
  { email: "linus@barnacle.ai", name: "Linus Fake", role: "user", status: "active" },
  { email: "margaret@barnacle.ai", name: "Margaret Fake", role: "user", status: "active" },
];

async function users() {
  return sql`select email, name, role, status from users order by email`;
}

function seedCommand(env: Record<string, string | undefined>) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "APP_ENV" && k !== "VERCEL_ENV"));
  for (const [k, v] of Object.entries(env)) if (v !== undefined) base[k] = v;
  return spawnSync("npx", ["tsx", "scripts/seed.ts"], { env: base as NodeJS.ProcessEnv, encoding: "utf8" });
}

describe("fake data", () => {
  it("creates the 5 fake users, and running it twice changes nothing", async () => {
    const first = await runSeeders(sql);
    expect(first.filter((l) => l.startsWith("created ")).length).toBe(5);
    expect(await users()).toEqual(FAKE_TEAM);
    expect(await count("user_changes")).toBe(5);
    const second = await runSeeders(sql);
    expect(second.every((l) => l.startsWith("already there "))).toBe(true);
    expect(await users()).toEqual(FAKE_TEAM);
    expect(await count("user_changes")).toBe(5);
  });

  it("the command prints the users it created and exits 0 in test", async () => {
    const run = seedCommand({ APP_ENV: "test" });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("created ada@barnacle.ai (admin, active)");
    expect(run.stdout).toContain("created alan@barnacle.ai (user, deactivated)");
    const again = seedCommand({ APP_ENV: "development" });
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("already there ada@barnacle.ai");
    expect(await count("users")).toBe(5);
  });

  it.each([
    { APP_ENV: "production" },
    { APP_ENV: "Development" },
    { APP_ENV: "" },
    { APP_ENV: undefined },
    { APP_ENV: "development", VERCEL_ENV: "production" },
    { APP_ENV: "development", VERCEL_ENV: "preview" },
    { APP_ENV: "test", VERCEL_ENV: "preview" },
  ])("is refused with %o, prints the message, exits 1 and changes nothing", async (env) => {
    const run = seedCommand(env);
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("Fake data can only be loaded when APP_ENV is development or test.");
    expect(await count("users")).toBe(0);
  });

  it("is refused before any database connection (works with no DATABASE_URL)", () => {
    const run = seedCommand({ APP_ENV: "production", DATABASE_URL: "" });
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("Fake data can only be loaded when APP_ENV is development or test.");
  });
});
