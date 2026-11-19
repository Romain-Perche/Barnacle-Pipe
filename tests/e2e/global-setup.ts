// Before the browser tests: test database only, migrated, with the fake data loaded.
import { execFileSync } from "node:child_process";
import { closeDb, resetAndSeed } from "./helpers";

export default async function globalSetup() {
  if (process.env.APP_ENV !== "test" || !process.env.DATABASE_URL) {
    throw new Error("npm run test:e2e needs APP_ENV=test and DATABASE_URL pointing at a local test database (e.g. crm_test).");
  }
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", env: process.env });
  await resetAndSeed();
  await closeDb();
}
