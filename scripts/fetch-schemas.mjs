// `npm run test:schemas` (also run before `npm test`): downloads the schemas the test fakes of outside services are
// checked against, each pinned to one commit and checked by sha256: Google's userinfo (tests/fakes/google.ts) and
// Supabase Storage's OpenAPI file (SF-116, tests/fakes/storage.ts) and Pipedrive's v2 (JSON) and v1 (YAML) OpenAPI
// files (SF-117, tests/fakes/pipedrive.ts), plus a fuller v1 copy (SF-122) that tests/fakes/pipedrive.ts uses for the v1
// paths the Zenika file lacks (deal participants, file downloads). A file already there is skipped. The files stay
// out of git (.factory/schemas/ is ignored).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCHEMAS = [
  {
    file: "oauth2-api.json",
    url: "https://raw.githubusercontent.com/googleapis/google-api-go-client/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json",
    sha256: "d6330cace87bdbc615005e4b1a0d08f68258dafcd441f97f4ef492a507be3a98",
  },
  {
    file: "storage_v0_openapi.json",
    url: "https://raw.githubusercontent.com/supabase/supabase/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json",
    sha256: "bd435bab4b3b2ef87e3e61f2e948092c30db204f881a4d72d4234a032a356311",
  },
  {
    file: "pipedrive_v2_openapi.json",
    url: "https://raw.githubusercontent.com/soenneker/soenneker.pipedrive.openapiclient/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json",
    sha256: "0974486d220a6462ea2e7f03acc440f5e6cba215ec875551544c83de685807c2",
  },
  {
    file: "pipedrive_v1_openapi.yml",
    url: "https://raw.githubusercontent.com/Zenika/zenpipe/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml",
    sha256: "9d309b9bf5f520b5f4d5ca95baad2660cd8705404b8940b20ab9d6bbba662e01",
  },
  {
    file: "pipedrive_v1_full_openapi.yml",
    url: "https://raw.githubusercontent.com/konfig-sdks/openapi-examples/161ab49c45e45825ca3832945c59a3ba904321ba/pipedrive/openapi.yaml",
    sha256: "24230787d0c71b1e528a2824e8aa6d3137db26aa57973e65f3819b1fce825665",
  },
];

let failed = false;
for (const { file, url, sha256 } of SCHEMAS) {
  const target = path.join(".factory", "schemas", file);
  if (existsSync(target)) {
    console.log(`${target} is already there.`);
    continue;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const sha = createHash("sha256").update(body).digest("hex");
    if (sha !== sha256) throw new Error(`sha256 ${sha}, expected ${sha256}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
    console.log(`Downloaded ${target}.`);
  } catch (e) {
    console.error(`${target} is missing and could not be downloaded (${e.message}): run "npm run test:schemas" with network access.`);
    failed = true;
  }
}
if (failed) process.exit(1);
