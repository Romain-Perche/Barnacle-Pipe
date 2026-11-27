// AI review helper (SF-130 reply and forward). Run from the repo root:
//   APP_ENV=development GMAIL_TOKEN_KEY=$(cat /tmp/gmail-token-key) npx tsx .factory/run/sf130-ctl.ts <op> [args]
// ops (one JSON line): sent <email>            the user's Sent mail (FakeGoogleMail.sentMessages) with threadId, In-Reply-To,
//                                              References and each attachment's name/type/size/sha256 (16 hex)
//                      box <email>             every mailbox message: id, threadId, subject, Message-ID, labels
//                      att <email> <subject>   the attachments of the mailbox message with that subject (name/type/size/sha)
//                      failatt on|off          messages.attachments.get answers 503 (failAttachments)
import { createHash } from "node:crypto";
import { fakeGmail } from "@/server/gmail/fake-gmail";
const [op, a, b] = process.argv.slice(2);
const f = fakeGmail() as any;
const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex").slice(0, 16);
const h = (m: any, n: string) => m.payload.headers.find((x: any) => x.name.toLowerCase() === n)?.value ?? "";
let out: unknown;
if (op === "sent") out = f.sentMessages(a).map((m: any) => ({ ...m, attachments: m.attachments.map((x: any) => ({ name: x.name, type: x.type, size: x.bytes.length, sha: sha(x.bytes) })) }));
else if (op === "box") out = f.mailbox(a).map((m: any) => ({ id: m.id, threadId: m.threadId, subject: h(m, "subject"), mid: h(m, "message-id"), labels: m.labelIds }));
else if (op === "att") {
  const s = f.state();
  const m = f.mailbox(a).find((x: any) => h(x, "subject") === b);
  const leaves: any[] = [];
  (function walk(p: any) { if (p.parts) p.parts.forEach(walk); else leaves.push(p); })(m.payload);
  out = leaves.filter((p) => p.filename).map((p) => { const bytes = Buffer.from(s.attachmentData?.[`${m.id}/${p.body?.attachmentId}`] ?? "", "base64url"); return { name: p.filename, type: p.mimeType, size: bytes.length, sha: sha(bytes) }; });
} else if (op === "failatt") { f.failAttachments(a === "on"); out = a === "on"; }
else throw new Error("unknown op " + op);
console.log(JSON.stringify(out));
