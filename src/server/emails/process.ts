// After an email is copied (SF-127 data-model.md § Processing an email, research.md §1, §3, §5): its conversation
// across mailboxes, the addresses met in it, the automatic links and the Last contacted of the people in it. One code
// path for new emails (storeMessage calls processMessage in its own transaction) and for emails copied before SF-127
// (linked_at null: catchUpEmails, first thing of the 15-minute Gmail check). No network call here.
import { sql, type Sql } from "@/server/db";
import { mergeLinkChoice } from "@/server/emails/rules";

type Addr = { email?: unknown };

const usable = (e: unknown): e is string => typeof e === "string" && e.trim() !== "" && e.trim().length <= 254;

// Runs inside the caller's transaction. Returns the conversation id. A message already processed is left as it is.
export async function processMessage(db: Sql, messageId: number): Promise<number> {
  // Two mailboxes storing the same email at once cannot make two conversations.
  await db`lock table email_conversations in share row exclusive mode`;
  const [m] = await db<
    { thread_id: string; rfc_message_id: string | null; conversation_id: string | null; linked_at: Date | null; received_at: Date;
      from_address: string | null; to_list: Addr[]; cc_list: Addr[]; bcc_list: Addr[] }[]
  >`
    select m.thread_id::text as thread_id, m.rfc_message_id, t.conversation_id::text as conversation_id, m.linked_at, m.received_at,
           m.from_address, m.to_list, m.cc_list, m.bcc_list
    from email_messages m join email_threads t on t.id = m.thread_id
    where m.id = ${messageId}`;
  if (!m) throw new Error(`email message ${messageId} not found`);
  if (m.linked_at !== null && m.conversation_id !== null) return Number(m.conversation_id);

  const addresses = [
    ...new Set(
      [m.from_address, ...[...m.to_list, ...m.cc_list, ...m.bcc_list].map((a) => a?.email)]
        .filter(usable)
        .map((e) => e.trim().toLowerCase()),
    ),
  ];

  // Last contacted first (FR-014): raised, never lowered, private and archived people included. Before the merge so
  // that a person row is never waited for while a conversation row is being deleted.
  if (addresses.length > 0) {
    await db`
      update persons p set last_contacted_at = ${m.received_at}
      where p.id in (select pe.person_id from person_emails pe where pe.email = any(${addresses}))
        and (p.last_contacted_at is null or p.last_contacted_at < ${m.received_at})`;
  }

  // The thread's conversation: its own, else that of another mailbox's thread holding the same email; two or more →
  // merged into the oldest (smallest id).
  const found = new Set<number>();
  if (m.conversation_id !== null) found.add(Number(m.conversation_id));
  if (m.rfc_message_id !== null) {
    const others = await db<{ id: string }[]>`
      select distinct t.conversation_id::text as id
      from email_messages o join email_threads t on t.id = o.thread_id
      where o.rfc_message_id = ${m.rfc_message_id} and o.thread_id <> ${m.thread_id} and t.conversation_id is not null`;
    for (const o of others) found.add(Number(o.id));
  }
  let conversationId: number;
  if (found.size === 0) {
    const [c] = await db<{ id: string }[]>`insert into email_conversations default values returning id::text as id`;
    conversationId = Number(c.id);
  } else {
    const ids = [...found].sort((a, b) => a - b);
    conversationId = ids[0];
    for (const other of ids.slice(1)) await mergeConversation(db, other, conversationId);
  }
  if (m.conversation_id === null || Number(m.conversation_id) !== conversationId) {
    await db`update email_threads set conversation_id = ${conversationId} where id = ${m.thread_id}`;
  }

  if (addresses.length > 0) {
    await db`
      insert into email_conversation_addresses (conversation_id, email)
      select ${conversationId}, x from unnest(${addresses}::text[]) as x
      on conflict do nothing`;
  }
  await autoLink(db, [conversationId]);
  await db`update email_messages set linked_at = now() where id = ${messageId}`;
  return conversationId;
}

type LinkRow = { id: string; person_id: string | null; organisation_id: string | null; deal_id: string | null; how: "auto" | "manual"; removed: boolean; changed_by: string | null; changed_at: Date };

const targetKey = (l: LinkRow) => (l.person_id ? `p${l.person_id}` : l.organisation_id ? `o${l.organisation_id}` : `d${l.deal_id}`);

// Two conversations found to be one (research.md §1, §4): threads, addresses and links move into `into`; for a record
// linked in both, mergeLinkChoice keeps the hand choice, or the later of two hand choices.
async function mergeConversation(db: Sql, from: number, into: number): Promise<void> {
  await db`update email_threads set conversation_id = ${into} where conversation_id = ${from}`;
  await db`
    insert into email_conversation_addresses (conversation_id, email)
    select ${into}, email from email_conversation_addresses where conversation_id = ${from}
    on conflict do nothing`;
  const select = (id: number) => db<LinkRow[]>`
    select id::text as id, person_id::text as person_id, organisation_id::text as organisation_id, deal_id::text as deal_id,
           how, removed, changed_by::text as changed_by, changed_at
    from email_links where conversation_id = ${id}`;
  const kept = new Map((await select(into)).map((l) => [targetKey(l), l]));
  for (const l of await select(from)) {
    const mine = kept.get(targetKey(l));
    if (!mine) {
      await db`update email_links set conversation_id = ${into} where id = ${l.id}`;
      continue;
    }
    const win = mergeLinkChoice({ ...mine, changedAt: mine.changed_at }, { ...l, changedAt: l.changed_at });
    if (win.id !== mine.id) {
      await db`
        update email_links set how = ${l.how}, removed = ${l.removed}, changed_by = ${l.changed_by}, changed_at = ${l.changed_at}
        where id = ${mine.id}`;
    }
  }
  await db`delete from email_conversations where id = ${from}`;
}

// Automatic linking (FR-007, FR-008, research.md §5), set-based and idempotent: every person with an address of the
// conversation; for those whose link was not removed by hand, their organisation and the one open deal (open, not
// archived; main or linked person; privacy does not count) when they have exactly one. Only ever `insert … on
// conflict do nothing`: a hand choice (linked, or removed) is never changed (FR-011).
export async function autoLink(db: Sql, conversationIds: number[]): Promise<void> {
  if (conversationIds.length === 0) return;
  await db`
    insert into email_links (conversation_id, person_id, how)
    select distinct a.conversation_id, pe.person_id, 'auto'
    from email_conversation_addresses a join person_emails pe on pe.email = a.email
    where a.conversation_id = any(${conversationIds}::bigint[])
    on conflict do nothing`;
  await db`
    insert into email_links (conversation_id, organisation_id, how)
    select distinct a.conversation_id, p.organisation_id, 'auto'
    from email_conversation_addresses a
    join person_emails pe on pe.email = a.email
    join persons p on p.id = pe.person_id
    join email_links l on l.conversation_id = a.conversation_id and l.person_id = p.id and not l.removed
    where a.conversation_id = any(${conversationIds}::bigint[]) and p.organisation_id is not null
    on conflict do nothing`;
  await db`
    with people as (
      select distinct a.conversation_id, pe.person_id
      from email_conversation_addresses a
      join person_emails pe on pe.email = a.email
      join email_links l on l.conversation_id = a.conversation_id and l.person_id = pe.person_id and not l.removed
      where a.conversation_id = any(${conversationIds}::bigint[])
    ), open_deals as (
      select distinct people.conversation_id, people.person_id, d.id as deal_id
      from people join deals d on d.status = 'open' and d.archived_at is null
        and (d.person_id = people.person_id or exists (select 1 from deal_people dp where dp.deal_id = d.id and dp.person_id = people.person_id))
    ), one_deal as (
      select conversation_id, min(deal_id) as deal_id from open_deals group by conversation_id, person_id having count(*) = 1
    )
    insert into email_links (conversation_id, deal_id, how)
    select distinct conversation_id, deal_id, 'auto' from one_deal
    on conflict do nothing`;
}

// A person added or given a new address, or people imported (FR-009): the conversations already copied that hold one
// of their addresses (only `onlyEmails` when given: the addresses a save added) are linked by the same rule. Runs inside
// the caller's transaction.
export async function linkForPeople(db: Sql, personIds: number[], onlyEmails?: string[]): Promise<void> {
  if (personIds.length === 0 || onlyEmails?.length === 0) return;
  const rows = await db<{ id: string }[]>`
    select distinct a.conversation_id::text as id
    from email_conversation_addresses a join person_emails pe on pe.email = a.email
    where pe.person_id = any(${personIds}::bigint[])
      ${onlyEmails ? db`and pe.email = any(${onlyEmails.map((e) => e.toLowerCase())}::text[])` : db``}`;
  await autoLink(db, rows.map((r) => Number(r.id)));
}

const CATCH_UP_MAX = 500;

// Emails copied before SF-127 (or whose processing failed): at most 500 per run, oldest first, one transaction each.
export async function catchUpEmails(max = CATCH_UP_MAX): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    select id::text as id from email_messages where linked_at is null order by id limit ${max}`;
  let done = 0;
  for (const r of rows) {
    try {
      await sql.begin((tx) => processMessage(tx as unknown as Sql, Number(r.id)));
      done += 1;
    } catch {
      // One email's failure never stops the others; the next check tries it again.
    }
  }
  return done;
}
