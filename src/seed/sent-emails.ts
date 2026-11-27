// Fake data of SF-129 (research.md §9): Ada Fake writes one email from a fake deal to its fake main person through the
// real path (sendFromRecord: her fake Gmail, then stored, linked by SF-127 and by hand to the deal). The fixed send key
// makes it re-runnable: a second run finds the ledger row and sends nothing. Fake Gmail only (APP_ENV development/test).
import type { Sql } from "@/server/db";
import { gmailConfig } from "@/server/env";
import { emailBox, sendFromRecord } from "@/server/emails/compose";

export const SEED_SEND_KEY = "00000000-0000-4000-8000-000000000129";
const ADA = "ada@barnacle.ai";

export async function seedSentEmails(sql: Sql): Promise<string[]> {
  if (gmailConfig().mode !== "fake") return ["Sent email fake data skipped (fake Gmail only)."];
  const [ada] = await sql<{ id: number }[]>`select id::int as id from users where email = ${ADA} and status = 'active'`;
  if (!ada) return ["Sent email fake data skipped (no Ada Fake)."];
  const [done] = await sql`select 1 from email_sends where user_id = ${ada.id} and send_key = ${SEED_SEND_KEY}`;
  if (done) return ["already there sent email"];
  const [deal] = await sql<{ id: number }[]>`
    select d.id::int as id from deals d join persons p on p.id = d.person_id
    where not d.private and d.archived_at is null and not p.private and p.archived_at is null
      and exists (select 1 from person_emails e where e.person_id = p.id)
    order by d.id limit 1`;
  if (!deal) return ["Sent email fake data skipped (no fake deal with a main person)."];
  const box = await emailBox(ada.id, { kind: "deal", id: deal.id });
  if (!box || box.gmail !== "ok") return ["Sent email fake data skipped (Ada Fake's fake Gmail is not connected)."];
  const result = await sendFromRecord(ada.id, {
    target: { kind: "deal", id: deal.id }, sendKey: SEED_SEND_KEY, to: box.to, cc: [], bcc: [], subject: "Fake next steps",
    text: "Hello,\n\nHere are the fake next steps we talked about.\n\nAda Fake", fileIds: [], uploadIds: [],
  });
  return result.status === "sent" ? [`1 sent email on the deal "${box.record.name}"`] : [`Sent email fake data skipped (${result.status}).`];
}
