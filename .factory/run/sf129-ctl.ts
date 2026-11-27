// AI review helper (SF-129): a user's fake Gmail Sent mail as recipients read it (FakeGoogleMail.sentMessages), with each
// attachment's size and sha256 (first 16 hex) instead of its bytes.
//   APP_ENV=development GMAIL_TOKEN_KEY=$(cat /tmp/gmail-token-key) npx tsx .factory/run/sf129-ctl.ts sent <email>
import { createHash } from "node:crypto";
import { fakeGmail } from "@/server/gmail/fake-gmail";
const [op, a] = process.argv.slice(2);
if (op !== "sent") throw new Error("unknown op " + op);
const out = fakeGmail().sentMessages(a).map((m) => ({
  ...m, attachments: m.attachments.map((x) => ({ name: x.name, type: x.type, size: x.bytes.length, sha: createHash("sha256").update(x.bytes).digest("hex").slice(0, 16) })),
}));
console.log(JSON.stringify(out));
