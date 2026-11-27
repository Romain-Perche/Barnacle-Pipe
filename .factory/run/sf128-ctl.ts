// AI review helper (SF-128): steers the development fake Gmail (.fake-gmail/state.json, shared with the app on :3000).
// Run from the repo root:
//   APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev GMAIL_TOKEN_KEY=$(cat /tmp/gmail-token-key) \
//   APP_URL=http://localhost:3000 npx tsx .factory/run/sf128-ctl.ts <op> [args…]
// ops (output: one JSON line):
//   add <email> <json [{from,to,cc?,subject,text?,attachments?,labels?,daysAgo?|isoDate?}]>  one conversation, oldest
//        message first → {threadId, ids}
//   pad <email> <n>          n newsletter conversations (no CRM person), spread over the last 360 days
//   clear <email>            empties the user's fake mailbox
//   box <email>              the user's messages [{id, threadId, labels, date, addrs}]
import { fakeGmail } from "@/server/gmail/fake-gmail";

const DAY = 86_400_000;
const lower = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();

async function main() {
  const [op, a, b] = process.argv.slice(2);
  const fake = fakeGmail() as unknown as Record<string, any>;
  const now = fake.now() as number;
  let out: unknown;
  if (op === "add") {
    let threadId: string | null = null;
    const ids: string[] = [];
    for (const m of JSON.parse(b)) {
      const { daysAgo, isoDate, labels, ...rest } = m;
      const internalDate = isoDate ? new Date(isoDate) : new Date(now - (daysAgo ?? 0) * DAY);
      const lab = labels ?? (lower(rest.from) === a.toLowerCase() ? ["SENT"] : ["INBOX"]);
      const r = fake.addMessage(a, { text: "Fake text.", ...rest, labels: lab, internalDate, threadId });
      threadId = r.threadId;
      ids.push(r.id);
    }
    out = { threadId, ids };
  } else if (op === "pad") {
    for (let i = 0; i < Number(b); i++)
      fake.addMessage(a, { from: `Pad News <pad${i}@example.test>`, to: a, subject: `Pad ${i}`, text: "Fake pad.", labels: ["INBOX"], internalDate: new Date(now - (1 + ((i * 7) % 360)) * DAY), threadId: null });
    out = true;
  } else if (op === "clear") {
    out = fake.change((s: any) => {
      const box = s.mailboxes[a.toLowerCase()];
      if (box) box.messages = [];
      return true;
    });
  } else if (op === "box") {
    const h = (m: any, n: string) => m.payload.headers.filter((x: any) => x.name.toLowerCase() === n).map((x: any) => x.value).join(",");
    out = fake.mailbox(a).map((m: any) => ({
      id: m.id,
      threadId: m.threadId,
      labels: m.labelIds,
      date: Number(m.internalDate),
      addrs: ["from", "to", "cc", "bcc"].flatMap((n) => h(m, n).split(",")).filter(Boolean).map(lower),
    }));
  } else throw new Error("unknown op " + op);
  console.log(JSON.stringify(out));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
