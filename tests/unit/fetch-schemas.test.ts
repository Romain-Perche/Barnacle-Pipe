// covers US4 scenario 3, FR-031 (fresh checkout: `npm run test:schemas` fetches the pinned Google schema once);
// SF-116 T013: and Supabase Storage's OpenAPI file
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
  const storage = path.join(dir, ".factory/schemas/storage_v0_openapi.json");

  it("downloads the pinned oauth2-api.json and storage_v0_openapi.json", () => {
    expect(existsSync(file)).toBe(false);
    expect(existsSync(storage)).toBe(false);
    run();
    const schema = JSON.parse(readFileSync(file, "utf8"));
    expect(schema.schemas.Userinfo.properties.email.type).toBe("string");
    const openapi = JSON.parse(readFileSync(storage, "utf8"));
    expect(Object.keys(openapi.paths)).toContain("/object/upload/sign/{bucketName}/{*}");
  }, 60_000);

  it("does nothing on a second run (no download)", () => {
    const before = [statSync(file).mtimeMs, statSync(storage).mtimeMs];
    expect(run().match(/already there/g)).toHaveLength(2);
    expect([statSync(file).mtimeMs, statSync(storage).mtimeMs]).toEqual(before);
  });

  it("downloads only the missing file", () => {
    rmSync(storage);
    const out = run();
    expect(out).toMatch(/oauth2-api.json is already there/);
    expect(out).toMatch(/Downloaded .*storage_v0_openapi.json/);
  }, 60_000);
});
