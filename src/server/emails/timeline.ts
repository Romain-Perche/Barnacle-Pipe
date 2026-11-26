// EMAIL entries of a record's timeline (SF-127 research.md §2, §7): one per shown email of each conversation linked
// directly to the record (link not removed) that the viewer can see (visibleConversation). Read from the email tables,
// never copied into timeline_events; merged by selectEntries like done activities. The shown copy of an email copied
// into several mailboxes is the sender's, else the first stored.
import { sql } from "@/server/db";
import { emailPreview, emailText, type EmailAddress } from "@/server/emails/rules";
import type { Target, TimelineEntry } from "@/server/records/timeline";
import { visibleConversation } from "@/server/records/visibility";

const linkColumn = (target: Target) =>
  "personId" in target
    ? sql`l.person_id = ${target.personId}`
    : "organisationId" in target
      ? sql`l.organisation_id = ${target.organisationId}`
      : sql`l.deal_id = ${target.dealId}`;

type Row = {
  id: number; conversation_id: number; from_address: string | null; from_name: string | null; to_list: EmailAddress[];
  cc_list: EmailAddress[]; bcc_list: EmailAddress[]; subject: string; received_at: Date; text_body: string | null; html_body: string | null;
};

const addresses = (xs: unknown): EmailAddress[] =>
  (Array.isArray(xs) ? xs : [])
    .filter((x): x is { email: string; name?: unknown } => typeof x?.email === "string")
    .map((x) => ({ email: x.email, name: typeof x.name === "string" && x.name !== "" ? x.name : null }));

// Newest first, at most `limit`.
export async function timelineEmails(viewerId: number, target: Target, limit: number): Promise<TimelineEntry[]> {
  const rows = await sql<Row[]>`
    with convs as (
      select distinct l.conversation_id as id
      from email_links l join email_conversations c on c.id = l.conversation_id
      where ${linkColumn(target)} and not l.removed and ${visibleConversation(sql, viewerId, "c")}
    ), shown as (
      select distinct on (t.conversation_id, m.dedupe_key) m.id, t.conversation_id, m.from_address, m.from_name, m.to_list, m.cc_list,
             m.bcc_list, m.subject, m.received_at, m.text_body, m.html_body
      from email_messages m join email_threads t on t.id = m.thread_id
      where t.conversation_id in (select id from convs)
      order by t.conversation_id, m.dedupe_key, (m.direction = 'sent') desc, m.id
    )
    select id::int as id, conversation_id::int as conversation_id, from_address, from_name, to_list, cc_list, bcc_list, subject,
           received_at, text_body, html_body
    from shown order by received_at desc, id desc
    limit ${limit}`;
  if (rows.length === 0) return [];
  const atts = await sql<{ id: number; message_id: number; name: string; size: number }[]>`
    select id::int as id, message_id::int as message_id, name, size::float8 as size
    from email_attachments where message_id in ${sql(rows.map((r) => r.id))} order by message_id, position`;
  const byMessage = new Map<number, { id: number; name: string; size: number }[]>();
  for (const a of atts) {
    if (!byMessage.has(a.message_id)) byMessage.set(a.message_id, []);
    byMessage.get(a.message_id)!.push({ id: a.id, name: a.name, size: a.size });
  }
  return rows.map((r) => ({
    id: r.id, kind: "email" as const, actorName: null, fields: null, relatedPerson: null, fromPerson: null, relatedUserName: null,
    fromStage: null, toStage: null, cause: null, reason: null, fieldName: null, oldValue: null, newValue: null, createdAt: r.received_at,
    authorActive: true, deal: null, person: null, note: null, activity: null, file: null,
    email: {
      messageId: r.id,
      conversationId: r.conversation_id,
      from: r.from_address ? { email: r.from_address, name: r.from_name } : null,
      to: addresses(r.to_list),
      cc: addresses(r.cc_list),
      bcc: addresses(r.bcc_list),
      subject: r.subject,
      preview: emailPreview(emailText(r.text_body, r.html_body)),
      attachments: byMessage.get(r.id) ?? [],
    },
  }));
}
