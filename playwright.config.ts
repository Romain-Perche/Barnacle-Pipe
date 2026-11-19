import { defineConfig, devices } from "@playwright/test";

// The app under test runs with APP_ENV=test against the test database (DATABASE_URL).
// FIRST_ADMIN_EMAIL is the fake first admin used by the "empty system" scenario.
export const E2E_FIRST_ADMIN = "boss@barnacle.ai";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "tests/e2e/global-setup.ts",
  // Tests change the shared database: one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The app reads its settings at runtime; it starts from a folder without the developer's .env* files
    // (scripts/start-isolated.mjs), so it sees only the env below.
    command: "npm run build && node scripts/start-isolated.mjs 3000",
    url: "http://localhost:3000/sign-in",
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      APP_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      FIRST_ADMIN_EMAIL: E2E_FIRST_ADMIN,
      APP_URL: "http://localhost:3000",
      VERCEL_ENV: "",
    },
  },
});
