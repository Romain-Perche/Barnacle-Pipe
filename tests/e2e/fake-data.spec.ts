import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { closeDb, expectSignInPage, resetAndSeed, sidebar, signInAs, signInTyped } from "./helpers";

test.afterAll(closeDb);

test.describe("with fake data (APP_ENV=test)", () => {
  test.beforeEach(resetAndSeed);

  // covers US3 scenario 3, FR-024
  test("the fake chooser lists the seeded users", async ({ page }) => {
    await page.goto("/dev/fake-google");
    for (const [name, email] of [
      ["Ada Fake", "ada@barnacle.ai"],
      ["Grace Fake", "grace@barnacle.ai"],
      ["Linus Fake", "linus@barnacle.ai"],
      ["Margaret Fake", "margaret@barnacle.ai"],
      ["Alan Fake", "alan@barnacle.ai"],
    ]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${name}.*${email}`) })).toBeVisible();
    }
  });

  // covers US3 scenario 1
  test("a fake admin sees the 5 fake users on the Users page", async ({ page }) => {
    await signInAs(page, "Ada Fake", "/admin/users");
    await expect(page.locator("tbody tr")).toHaveCount(5);
  });

  // covers US3 scenario 3 (roles)
  test("a fake user has no Admin group", async ({ page }) => {
    await signInAs(page, "Linus Fake");
    await expect(page.getByRole("heading", { name: "Hello, Linus" })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Users" })).toHaveCount(0);
  });

  // covers US3 scenario 3 (same messages as real sign-in)
  test("the deactivated fake user and an unlisted address get the real messages", async ({ page }) => {
    await signInAs(page, "Alan Fake");
    await expect(page.getByText("Your access has been removed. Ask an admin if this is a mistake.")).toBeVisible();
    await signInTyped(page, "nobody@barnacle.ai", "No Body");
    await expect(page.getByText("This account doesn't have access yet. Ask an admin to add you.")).toBeVisible();
  });
});

// covers US3 scenario 4, FR-026, FR-028, SC-007, edge case "APP_ENV=development but VERCEL_ENV=preview"
const gated: { title: string; port: number; env: Record<string, string> }[] = [
  { title: "APP_ENV=production", port: 3101, env: { APP_ENV: "production", DATABASE_URL: process.env.DATABASE_URL ?? "" } },
  { title: "APP_ENV unset", port: 3102, env: { DATABASE_URL: process.env.DATABASE_URL ?? "" } },
  { title: "APP_ENV=development with VERCEL_ENV=production", port: 3103, env: { APP_ENV: "development", VERCEL_ENV: "production", DATABASE_URL: process.env.DATABASE_URL ?? "" } },
  { title: "APP_ENV=development with VERCEL_ENV=preview, no database", port: 3104, env: { APP_ENV: "development", VERCEL_ENV: "preview" } },
];

async function startApp(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !["APP_ENV", "VERCEL_ENV", "DATABASE_URL", "FIRST_ADMIN_EMAIL"].includes(k)),
  );
  // Started without the developer's .env* files (scripts/start-isolated.mjs).
  const child = spawn("node", ["scripts/start-isolated.mjs", String(port)], { env: { ...clean, ...env } as NodeJS.ProcessEnv, stdio: "ignore", detached: true });
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/sign-in`);
      if (res.status < 500) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`app on port ${port} did not start`);
}

// covers US4 scenario 3, FR-031: a developer's .env.local (from the README: APP_ENV=development) must not
// change what the gated servers see. Written while each gated server starts, then put back as it was.
const ENV_LOCAL = ".env.local";
function writeDeveloperEnvLocal(): () => void {
  const saved = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL) : undefined;
  writeFileSync(ENV_LOCAL, "APP_ENV=development\nVERCEL_ENV=\nFIRST_ADMIN_EMAIL=ada@barnacle.ai\n");
  return () => (saved === undefined ? rmSync(ENV_LOCAL, { force: true }) : writeFileSync(ENV_LOCAL, saved));
}

for (const g of gated) {
  test.describe(`gated: ${g.title}`, () => {
    let app: ChildProcess;
    let restoreEnvLocal: (() => void) | undefined;
    test.beforeAll(async () => {
      await resetAndSeed();
      restoreEnvLocal = writeDeveloperEnvLocal();
      app = await startApp(g.port, g.env);
    });
    test.afterAll(() => {
      if (app?.pid) process.kill(-app.pid, "SIGTERM");
      restoreEnvLocal?.();
    });

    test("no fake login link, and the fake login address shows Page not found.", async ({ page }) => {
      await page.goto(`http://localhost:${g.port}/sign-in`);
      await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
      await expect(page.getByRole("link", { name: "[ FAKE GOOGLE LOGIN ]" })).toHaveCount(0);
      const res = await page.goto(`http://localhost:${g.port}/dev/fake-google`);
      expect(res?.status()).toBe(404);
      await expect(page.getByText("Page not found.")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Ada Fake/ })).toHaveCount(0);
    });

    if (g.env.VERCEL_ENV === "preview") {
      // covers FR-028, edge case "preview deployment"
      test("the preview shows the preview notice and no sign-in button", async ({ page }) => {
        await page.goto(`http://localhost:${g.port}/`);
        await expect(page).toHaveURL(/\/sign-in/);
        await expect(page.getByText("Sign-in is turned off on preview deployments.")).toBeVisible();
        await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveCount(0);
      });
    } else {
      test("the real sign-in button is still there", async ({ page }) => {
        await page.goto(`http://localhost:${g.port}/`);
        await expectSignInPage(page);
      });
    }
  });
}
