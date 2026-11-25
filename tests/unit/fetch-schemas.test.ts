// covers US4 scenario 3, FR-031 (fresh checkout: `npm run test:schemas` fetches the pinned Google schema once);
// SF-116 T013: and Supabase Storage's OpenAPI file
// SF-117: and the two Pipedrive schemas
// SF-118 T004: and Gmail's and Pub/Sub's discovery files
// SF-122: the full Pipedrive v1 schema
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

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
  const pipedriveV2 = path.join(dir, ".factory/schemas/pipedrive_v2_openapi.json");
  const pipedriveV1 = path.join(dir, ".factory/schemas/pipedrive_v1_openapi.yml");
  const pipedriveV1Full = path.join(dir, ".factory/schemas/pipedrive_v1_full_openapi.yml");
  const gmail = path.join(dir, ".factory/schemas/gmail-api.json");
  const pubsub = path.join(dir, ".factory/schemas/pubsub-api.json");

  it("downloads the pinned oauth2-api.json and storage_v0_openapi.json", () => {
    expect(existsSync(file)).toBe(false);
    expect(existsSync(storage)).toBe(false);
    run();
    const schema = JSON.parse(readFileSync(file, "utf8"));
    expect(schema.schemas.Userinfo.properties.email.type).toBe("string");
    const openapi = JSON.parse(readFileSync(storage, "utf8"));
    expect(Object.keys(openapi.paths)).toContain("/object/upload/sign/{bucketName}/{*}");
    const v2 = JSON.parse(readFileSync(pipedriveV2, "utf8"));
    for (const p of ["/persons", "/organizations", "/personFields", "/organizationFields"]) {
      expect(Object.keys(v2.paths)).toContain(p);
    }
    const v1 = parse(readFileSync(pipedriveV1, "utf8"));
    expect(Object.keys(v1.paths)).toContain("/users/me");
    expect(Object.keys(v1.paths)).toContain("/users");
    // SF-122: the full v1 copy has the paths the Zenika copy lacks, and the v1 paths the import reads.
    const full = parse(readFileSync(pipedriveV1Full, "utf8"));
    for (const p of ["/deals/{id}/participants", "/files/{id}/download", "/notes", "/files", "/activityTypes"]) {
      expect(Object.keys(full.paths)).toContain(p);
    }
    expect(JSON.parse(readFileSync(gmail, "utf8")).schemas.Profile.properties.emailAddress.type).toBe("string");
    expect(Object.keys(JSON.parse(readFileSync(pubsub, "utf8")).schemas.PubsubMessage.properties)).toContain("data");
  }, 60_000);

  it("does nothing on a second run (no download)", () => {
    const before = [statSync(file).mtimeMs, statSync(storage).mtimeMs];
    expect(run().match(/already there/g)).toHaveLength(7);
    expect([statSync(file).mtimeMs, statSync(storage).mtimeMs]).toEqual(before);
  });

  it("downloads only the missing file", () => {
    rmSync(storage);
    const out = run();
    expect(out).toMatch(/oauth2-api.json is already there/);
    expect(out).toMatch(/Downloaded .*storage_v0_openapi.json/);
  }, 60_000);
});
