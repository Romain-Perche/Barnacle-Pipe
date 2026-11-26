// The conversation page and its links (SF-127 contracts/routes.md § conversation page, § Server actions; data-model.md
// § State changes). Every read goes through visibleConversation(): a hidden conversation answers as a missing one.
// Link changes make no timeline entry and no notification (spec Assumptions).
import { sql, type Sql } from "@/server/db";
import { emailText, subjectOrDefault, type EmailAddress, type FromRecord, type RecordKind } from "@/server/emails/rules";
import { visibleConversation, visibleDeal, visiblePerson } from "@/server/records/visibility";

export type ConversationEmail = {
  id: number;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  receivedAt: Date;
  text: string | null;
  attachments: { id: number; name: string; size: number }[];
};
export type ConversationLink = { id: number; kind: RecordKind; recordId: number; name: string; archived: boolean };
export type Conversation = { id: number; subject: string; emails: ConversationEmail[]; links: ConversationLink[] };

const addresses = (xs: unknown): EmailAddress[] =>
  (Array.isArray(xs) ? xs : [])
    .filter((x): x is { email: string; name?: unknown } => typeof x?.email === "string")
    .map((x) => ({ email: x.email, name: typeof x.name === "string" && x.name !== "" ? x.name : null }));

const visibleRow = (viewerId: number, id: number, db: Sql = sql) =>
  db<{ id: number }[]>`select c.id::int as id from email_conversations c where c.id = ${id} and ${visibleConversation(db, viewerId, "c")}`;

export async function getConversation(viewerId: number, id: number): Promise<Conversation | null> {
  const [c] = await visibleRow(viewerId, id);
  if (!c) return null;
  // One shown copy per email (the sender's, else the first stored), oldest first.
  const rows = await sql<
    { id: number; from_address: string | null; from_name: string | null; to_list: unknown; cc_list: unknown; bcc_list: unknown; subject: string;
      received_at: Date; text_body: string | null; html_body: string | null }[]
  >`
    select * from (
      select distinct on (m.dedupe_key) m.id::int as id, m.from_address, m.from_name, m.to_list, m.cc_list, m.bcc_list, m.subject, m.received_at,
             m.text_body, m.html_body
      from email_messages m join email_threads t on t.id = m.thread_id
      where t.conversation_id = ${id}
      order by m.dedupe_key, (m.direction = 'sent') desc, m.id
    ) shown
    order by received_at asc, id asc`;
  const atts = rows.length === 0 ? [] : await sql<{ id: number; message_id: number; name: string; size: number }[]>`
    select id::int as id, message_id::int as message_id, name, size::float8 as size
    from email_attachments where message_id in ${sql(rows.map((r) => r.id))} order by message_id, position`;
  const links = await sql<{ id: number; kind: RecordKind; record_id: number; name: string; archived: boolean }[]>`
    select l.id::int as id,
           case when l.person_id is not null then 'person' when l.organisation_id is not null then 'organisation' else 'deal' end as kind,
           coalesce(l.person_id, l.organisation_id, l.deal_id)::int as record_id,
           coalesce(btrim(p.first_name || ' ' || p.last_name), o.name, d.title) as name,
           coalesce(p.archived_at, o.archived_at, d.archived_at) is not null as archived
    from email_links l
    left join persons p on p.id = l.person_id
    left join organisations o on o.id = l.organisation_id
    left join deals d on d.id = l.deal_id
    where l.conversation_id = ${id} and not l.removed
    order by case when l.person_id is not null then 0 when l.organisation_id is not null then 1 else 2 end, l.id`;
  return {
    id,
    subject: subjectOrDefault(rows[0]?.subject ?? ""),
    emails: rows.map((r) => ({
      id: r.id,
      from: r.from_address ? { email: r.from_address, name: r.from_name } : null,
      to: addresses(r.to_list),
      cc: addresses(r.cc_list),
      bcc: addresses(r.bcc_list),
      receivedAt: r.received_at,
      text: emailText(r.text_body, r.html_body),
      attachments: atts.filter((a) => a.message_id === r.id).map((a) => ({ id: a.id, name: a.name, size: a.size })),
    })),
    links: links.map((l) => ({ id: l.id, kind: l.kind, recordId: l.record_id, name: l.name, archived: l.archived })),
  };
}

// The record a conversation was opened from (?from=), by name, when the viewer can see it.
export async function fromRecordName(viewerId: number, from: FromRecord | null): Promise<string | null> {
  if (!from) return null;
  const [row] =
    from.kind === "person"
      ? await sql<{ name: string }[]>`select btrim(p.first_name || ' ' || p.last_name) as name from persons p where p.id = ${from.id} and ${visiblePerson(sql, viewerId)}`
      : from.kind === "deal"
        ? await sql<{ name: string }[]>`select d.title as name from deals d where d.id = ${from.id} and ${visibleDeal(sql, viewerId)}`
        : await sql<{ name: string }[]>`select o.name from organisations o where o.id = ${from.id}`;
  return row?.name ?? null;
}

type Choice = { id: number; name: string; archived: boolean };

// What the link forms offer (FR-013): records the viewer can see, not archived (deals of any status).
export async function linkChoices(viewerId: number): Promise<{ deals: Choice[]; people: Choice[]; organisations: Choice[] }> {
  const [deals, people, organisations] = await Promise.all([
    sql<Choice[]>`select d.id::int as id, d.title as name, false as archived from deals d where d.archived_at is null and ${visibleDeal(sql, viewerId)} order by lower(d.title), d.id`,
    sql<Choice[]>`
      select p.id::int as id, btrim(p.first_name || ' ' || p.last_name) as name, false as archived from persons p
      where p.archived_at is null and ${visiblePerson(sql, viewerId)} order by lower(btrim(p.first_name || ' ' || p.last_name)), p.id`,
    sql<Choice[]>`select o.id::int as id, o.name, false as archived from organisations o where o.archived_at is null order by lower(o.name), o.id`,
  ]);
  return { deals, people, organisations };
}

export type LinkResult = { status: "ok" | "not_found" | "refused" };

// Links a conversation to a record by hand (data-model.md § State changes): a new row, or a removed one linked again.
export async function linkRecord(actorId: number, input: { conversationId: number; kind: RecordKind; recordId: number }): Promise<LinkResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    // Waits for an email being processed (a merge may delete this conversation row).
    await db`lock table email_conversations in row exclusive mode`;
    const [c] = await db<{ id: number }[]>`
      select c.id::int as id from email_conversations c where c.id = ${input.conversationId} and ${visibleConversation(db, actorId, "c")} for update`;
    if (!c) return { status: "not_found" as const };
    const [target] =
      input.kind === "person"
        ? await db`select 1 from persons p where p.id = ${input.recordId} and p.archived_at is null and ${visiblePerson(db, actorId)}`
        : input.kind === "deal"
          ? await db`select 1 from deals d where d.id = ${input.recordId} and d.archived_at is null and ${visibleDeal(db, actorId)}`
          : await db`select 1 from organisations o where o.id = ${input.recordId} and o.archived_at is null`;
    if (!target) return { status: "refused" as const };
    const column = db(input.kind === "person" ? "person_id" : input.kind === "deal" ? "deal_id" : "organisation_id");
    const [existing] = await db<{ id: number }[]>`
      select id::int as id from email_links where conversation_id = ${c.id} and ${column} = ${input.recordId} for update`;
    if (existing) {
      await db`
        update email_links set how = 'manual', removed = false, changed_by = ${actorId}, changed_at = now()
        where id = ${existing.id} and removed`;
    } else {
      await db`
        insert into email_links (conversation_id, ${column}, how, changed_by) values (${c.id}, ${input.recordId}, 'manual', ${actorId})`;
    }
    return { status: "ok" as const };
  });
}

// Unlinks by hand: remembered (removed), so automatic linking never adds it back (FR-011).
export async function unlinkRecord(actorId: number, input: { conversationId: number; linkId: number }): Promise<LinkResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    await db`lock table email_conversations in row exclusive mode`;
    const [c] = await db<{ id: number }[]>`
      select c.id::int as id from email_conversations c where c.id = ${input.conversationId} and ${visibleConversation(db, actorId, "c")} for update`;
    if (!c) return { status: "not_found" as const };
    const [row] = await db`
      update email_links set removed = true, changed_by = ${actorId}, changed_at = now()
      where id = ${input.linkId} and conversation_id = ${c.id} and not removed returning id`;
    return { status: row ? ("ok" as const) : ("not_found" as const) };
  });
}
