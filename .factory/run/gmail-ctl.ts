// AI review helper (SF-118): steers the development fake Gmail (.fake-gmail/state.json, shared with the running app on
// :3000) for what the /dev/fake-gmail page has no button for, and calls sendGmail as a later feature would.
// Run from the repo root:
//   APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev GMAIL_TOKEN_KEY=$(cat /tmp/gmail-token-key) \
//   APP_URL=http://localhost:3000 npx tsx .factory/run/gmail-ctl.ts <op> [args…]
// ops (output: one JSON line):
//   notice <email>                    a Google-signed Pub/Sub push for the user's current history id {authorization, body}
//   badnotice <email>                 the same body signed by another key (no Google proof)
//   trash <email> <subject>           moves the user's message with that subject to the bin (labels TRASH)
//   send <userId> <json SendInput>    sendGmail(userId, input) → {ok, result} or {ok:false, error: <class name>}
//   sent <email>                      the user's mailbox messages labelled SENT: [{id, threadId, from, to, subject, inReplyTo}]
//   tokens <email>                    the status of every refresh token the fake gave the user
import { fakeGmail } from "@/server/gmail/fake-gmail";
import { sendGmail } from "@/server/gmail/send";
import { sql } from "@/server/db";

async function main() {
  const [op, a, b] = process.argv.slice(2);
  const fake = fakeGmail() as unknown as Record<string, any>;
  let out: unknown;
  if (op === "notice") out = fake.notice(a);
  else if (op === "badnotice") {
    const n = fake.notice(a);
    out = n && { ...n, authorization: `Bearer ${fake.signPushToken({}, {}, { otherKey: true })}` };
  } else if (op === "trash") {
    out = fake.change((s: any) => {
      const m = s.mailboxes[a.toLowerCase()].messages.find((x: any) => x.payload.headers.some((h: any) => h.name === "Subject" && h.value === b));
      if (!m) return false;
      m.labelIds = ["TRASH"];
      return true;
    });
  } else if (op === "send") {
    try {
      out = { ok: true, result: await sendGmail(Number(a), JSON.parse(b)) };
    } catch (e) {
      out = { ok: false, error: (e as Error).name };
    }
  } else if (op === "sent") {
    const h = (m: any, n: string) => m.payload.headers.find((x: any) => x.name.toLowerCase() === n)?.value ?? "";
    out = fake.mailbox(a).filter((m: any) => m.labelIds.includes("SENT")).map((m: any) => ({ id: m.id, threadId: m.threadId, from: h(m, "from"), to: h(m, "to"), subject: h(m, "subject"), inReplyTo: h(m, "in-reply-to") }));
  } else if (op === "tokens") out = fake.tokensOf(a).map((t: any) => t.status);
  else throw new Error("unknown op " + op);
  console.log(JSON.stringify(out));
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
