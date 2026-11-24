// Fake Gmail data (SF-118 data-model.md § Fake data, FR-019): Ada Fake (ada@barnacle.ai, the first fake user) gets a
// working connection made through the fake Google (a key the fake gives, sealed with GMAIL_TOKEN_KEY), and three
// conversations with fake CRM people put into her fake mailbox after the connection, then copied by syncConnection,
// the real path:
// - "Fake proposal": received, then sent; proposal-fake.pdf (250,880 bytes);
// - "Fake intro call": received; logo-fake.png (18,432 bytes) and notes-fake.txt (1,024 bytes);
// - "Fake follow-up": sent.
// Fake mode only (APP_ENV development/test, no GMAIL_PUBSUB_TOPIC, GMAIL_TOKEN_KEY set). Re-runnable: a connection
// that already has conversations is left as it is.
import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "@/server/db";
import { gmailConfig } from "@/server/env";
import { finishConnect } from "@/server/gmail/connections";
import { fakeGmail } from "@/server/gmail/fake-gmail";
import { callbackUrl, exchangeGmailCode, getProfile } from "@/server/gmail/google-api";
import { GMAIL_SCOPES } from "@/server/gmail/rules";
import { syncConnection } from "@/server/gmail/sync";

const ADA = "ada@barnacle.ai";

export async function seedGmail(sql: Sql): Promise<string[]> {
  const cfg = gmailConfig();
  if (cfg.mode === "real") return ["Gmail fake data skipped (real Gmail settings)."];
  if (cfg.mode === "off") return ["Gmail fake data skipped (GMAIL_TOKEN_KEY not set)."];
  const [ada] = await sql<{ id: number }[]>`select id::int as id from users where email = ${ADA} and status = 'active'`;
  if (!ada) return ["Gmail fake data skipped (no Ada Fake)."];
  const [existing] = await sql<{ id: number; state: string; n: number }[]>`
    select c.id::int as id, c.state, (select count(*)::int from email_threads t where t.connection_id = c.id) as n
    from gmail_connections c where c.user_id = ${ada.id}`;
  if (existing && existing.n > 0) return ["already there Gmail conversations"];
  const people = await sql<{ email: string; name: string }[]>`
    select distinct on (p.id) e.email, trim(p.first_name || ' ' || p.last_name) as name
    from persons p join person_emails e on e.person_id = p.id
    where not p.private and p.archived_at is null order by p.id, e.position limit 3`;
  if (people.length < 3) return ["Gmail fake data skipped (no fake people)."];

  const fake = fakeGmail();
  if (!existing || existing.state !== "working") {
    const verifier = randomBytes(32).toString("base64url");
    const code = fake.consent({
      email: ADA,
      scopes: [...GMAIL_SCOPES],
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      redirectUri: callbackUrl(cfg.appUrl),
      clientId: cfg.clientId,
      offline: true,
    });
    const tokens = await exchangeGmailCode(code, verifier);
    if (!tokens.refreshToken) return ["Gmail fake data skipped (the fake gave no key)."];
    await finishConnect(ada.id, { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, scope: tokens.scope, profile: await getProfile(tokens.accessToken) });
  }
  const [conn] = await sql<{ id: number }[]>`select id::int as id from gmail_connections where user_id = ${ada.id}`;
  const [p1, p2, p3] = people;
  const at = (minutes: number) => new Date(fake.now() + minutes * 60_000);
  const proposal = fake.addMessage(ADA, {
    from: `"${p1.name}" <${p1.email}>`,
    to: ADA,
    subject: "Fake proposal",
    text: "Hi Ada, here is our fake proposal.",
    html: "<p>Hi Ada, here is our <b>fake</b> proposal.</p>",
    attachments: [{ name: "proposal-fake.pdf", size: 250880, type: "application/pdf" }],
    internalDate: at(1),
  });
  fake.addMessage(ADA, { from: ADA, to: p1.email, subject: "Re: Fake proposal", text: "Thanks, we will read it.", labels: ["SENT"], threadId: proposal.threadId, internalDate: at(2) });
  fake.addMessage(ADA, {
    from: `"${p2.name}" <${p2.email}>`,
    to: ADA,
    subject: "Fake intro call",
    text: "Notes and our logo from the fake intro call.",
    attachments: [
      { name: "logo-fake.png", size: 18432, type: "image/png" },
      { name: "notes-fake.txt", size: 1024, type: "text/plain" },
    ],
    internalDate: at(3),
  });
  fake.addMessage(ADA, { from: ADA, to: p3.email, subject: "Fake follow-up", text: "Following up on our fake chat.", labels: ["SENT"], internalDate: at(4) });
  await syncConnection(conn.id, at(5));
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from email_threads where connection_id = ${conn.id}`;
  return [`added a fake Gmail connection for Ada Fake with ${n} conversations`];
}
