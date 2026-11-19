// covers US4 scenario 3, FR-031 (fresh checkout: `npm run test:schemas` fetches the pinned Google schema once)
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "crm-schemas-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(): string {
  return execFileSync("npm", ["run", "--silent", "test:schemas"], { cwd: dir, encoding: "utf8", env: process.env });
}

describe("npm run test:schemas in a copy of the repo without .factory/schemas/", () => {
  mkdirSync(path.join(dir, "scripts"));
  copyFileSync("package.json", path.join(dir, "package.json"));
  copyFileSync("scripts/fetch-schemas.mjs", path.join(dir, "scripts/fetch-schemas.mjs"));
  const file = path.join(dir, ".factory/schemas/oauth2-api.json");

  it("downloads the pinned oauth2-api.json, with its Userinfo schema", () => {
    expect(existsSync(file)).toBe(false);
    run();
    const schema = JSON.parse(readFileSync(file, "utf8"));
    expect(schema.schemas.Userinfo.properties.email.type).toBe("string");
  }, 60_000);

  it("does nothing on a second run (no download)", () => {
    const before = statSync(file).mtimeMs;
    expect(run()).toMatch(/already there/);
    expect(statSync(file).mtimeMs).toBe(before);
  });
});
