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
    command: "npm run build && npm start -- -p 3000",
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
