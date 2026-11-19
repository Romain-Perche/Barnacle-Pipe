// Runs once before `npm test`: refuses anything but a test database, then brings it up to date.
import { execFileSync } from "node:child_process";

export default async function setup() {
  if (process.env.APP_ENV !== "test" || !process.env.DATABASE_URL) {
    throw new Error("npm test needs APP_ENV=test and DATABASE_URL pointing at a local test database (e.g. crm_test).");
  }
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", env: process.env });
}
