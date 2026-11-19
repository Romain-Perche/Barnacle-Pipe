// `npm run test:schemas` (also run before `npm test`): downloads the Google userinfo schema the test fake
// of Google Sign-In is checked against, pinned to one commit and checked by sha256. Does nothing when the
// file is already there. The file stays out of git (.factory/schemas/ is ignored).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(".factory", "schemas", "oauth2-api.json");
const URL =
  "https://raw.githubusercontent.com/googleapis/google-api-go-client/fb095823b5150e5301d201e7f19a5119edbbbdfd/oauth2/v2/oauth2-api.json";
const SHA256 = "d6330cace87bdbc615005e4b1a0d08f68258dafcd441f97f4ef492a507be3a98";

if (existsSync(FILE)) {
  console.log(`${FILE} is already there.`);
  process.exit(0);
}
try {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(body).digest("hex");
  if (sha !== SHA256) throw new Error(`sha256 ${sha}, expected ${SHA256}`);
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, body);
  console.log(`Downloaded ${FILE}.`);
} catch (e) {
  console.error(`${FILE} is missing and could not be downloaded (${e.message}): run "npm run test:schemas" with network access.`);
  process.exit(1);
}
