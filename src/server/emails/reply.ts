// Reply, reply all and forward (SF-130 research.md §1, §3, §4, §7, §8; contracts/routes.md).
// - replyState: what each email shows to the viewer: the three buttons (ok), a Settings link (connect / reconnect), or
//   nothing (Gmail off).
// - replyBox: the email box filled for one shown email (prefill, subject, quote, forwarded attachments), read through
//   visibleConversation(); a hidden or missing email gives the `missing` view.
// - sendReply: the checks again at send time (Gmail, the typed text, the conversation still visible and the email still
//   in it, the record's files, the forwarded ids), the quote rebuilt from the database, In-Reply-To / References from
//   the conversation's stored Message-IDs, the user's own Gmail thread when they hold the conversation, then SF-129's
//   deliver with reply_message_id and no record (no hand link, FR-015).
// - placePendingReply: inside storeMessage's transaction, before processMessage: a message the CRM is sending as a reply
//   (ledger row pending with reply_message_id) whose thread row has no conversation yet joins the answered email's
//   conversation, whoever stores it first (the send path or the sync).
import { randomUUID } from "node:crypto";
import { sql, type Sql } from "@/server/db";
import { attachmentAccess } from "@/server/emails/attachments";
import {
  connectionOf, deliver, gmailState, isSendKey, nameRecipients, namesFor, readAttached, readRecord, refused, toTarget, unique,
  type ComposeTarget, type EmailBox, type Forwarded, type SendResult,
} from "@/server/emails/compose";
import { allAddresses, MAX_ATTACHMENT_BYTES, normaliseRecipients, sentNotice, totalBytes, validateCompose } from "@/server/emails/compose-rules";
import {
  bodyWithQuote, MESSAGE_ID, prefill, quoteFor, referencesFor, subjectFor, type ReplyEmail, type ReplyMode,
} from "@/server/emails/reply-rules";
import { subjectOrDefault, type EmailAddress } from "@/server/emails/rules";
import { listFiles } from "@/server/files/files";
import type { ReadMessage } from "@/server/gmail/rules";
import { messages } from "@/server/messages";
import { visibleConversation } from "@/server/records/visibility";

export type ReplyState = "ok" | "connect" | "reconnect" | "off";
export type ReplyInput = {
  mode: ReplyMode; messageId: number; record: ComposeTarget | null; sendKey: string; to: string[]; cc: string[]; bcc: string[];
  subject: string; text: string; fileIds: number[]; uploadIds: number[]; forwardIds: number[];
};

const HEADING: Record<ReplyMode, string> = { reply: messages.reply_heading, reply_all: messages.reply_all_heading, forward: messages.forward_heading };
const CONTENT_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

export async function replyState(viewerId: number): Promise<ReplyState> {
  const s = gmailState(await connectionOf(viewerId));
  return s === "ok" ? "ok" : s === "off" ? "off" : s === "not_connected" ? "connect" : "reconnect";
}

type Answered = ReplyEmail & {
  id: number; conversationId: number; dedupeKey: string; rfcMessageId: string | null; references: string[];
  attachments: { id: number; name: string; size: number; contentType: string }[];
};

const addresses = (xs: unknown): EmailAddress[] =>
  (Array.isArray(xs) ? xs : [])
    .filter((x): x is { email: string; name?: unknown } => typeof x?.email === "string")
    .map((x) => ({ email: x.email, name: typeof x.name === "string" && x.name !== "" ? x.name : null }));

// The answered email in a conversation the viewer can see (null otherwise: the same answer for missing and hidden), its
// attachments by position, and the References ids: the conversation's shown emails (one per dedupe_key, as
// getConversation) oldest first, up to and including this one.
async function answered(db: Sql, viewerId: number, messageId: number): Promise<Answered | null> {
  const [m] = await db<
    { id: number; conversation_id: number; dedupe_key: string; rfc_message_id: string | null; from_address: string | null; from_name: string | null;
      to_list: unknown; cc_list: unknown; subject: string; received_at: Date; text_body: string | null; html_body: string | null }[]
  >`
    select m.id::int as id, c.id::int as conversation_id, m.dedupe_key, m.rfc_message_id, m.from_address, m.from_name, m.to_list, m.cc_list,
           m.subject, m.received_at, m.text_body, m.html_body
    from email_messages m
    join email_threads t on t.id = m.thread_id
    join email_conversations c on c.id = t.conversation_id
    where m.id = ${messageId} and ${visibleConversation(db, viewerId, "c")}`;
  if (!m) return null;
  const attachments = await db<{ id: number; name: string; size: number; contentType: string }[]>`
    select id::int as id, name, size::float8 as size, content_type as "contentType" from email_attachments where message_id = ${m.id} order by position`;
  const shown = await db<{ rfc_message_id: string | null; dedupe_key: string }[]>`
    select rfc_message_id, dedupe_key from (
      select distinct on (m.dedupe_key) m.id, m.rfc_message_id, m.dedupe_key, m.received_at
      from email_messages m join email_threads t on t.id = m.thread_id
      where t.conversation_id = ${m.conversation_id}
      order by m.dedupe_key, (m.direction = 'sent') desc, m.id
    ) shown
    order by received_at asc, id asc`;
  const at = shown.findIndex((s) => s.dedupe_key === m.dedupe_key);
  const ids = shown.map((s) => s.rfc_message_id);
  const references = at < 0 ? referencesFor([...ids, m.rfc_message_id], ids.length) : referencesFor(ids, at);
  return {
    id: m.id,
    conversationId: m.conversation_id,
    dedupeKey: m.dedupe_key,
    rfcMessageId: m.rfc_message_id,
    references,
    from: m.from_address ? { email: m.from_address, name: m.from_name } : null,
    to: addresses(m.to_list),
    cc: addresses(m.cc_list),
    subject: m.subject,
    receivedAt: m.received_at,
    textBody: m.text_body,
    htmlBody: m.html_body,
    attachments,
  };
}

// research.md §3: the user's own Gmail thread in that conversation: the one holding a copy of the answered email first,
// else the one with the newest message; none → a new Gmail thread.
export async function userThread(connectionId: number, conversationId: number, dedupeKey: string): Promise<string | null> {
  const [t] = await sql<{ gmail_thread_id: string }[]>`
    select t.gmail_thread_id from email_threads t
    where t.connection_id = ${connectionId} and t.conversation_id = ${conversationId}
    order by exists (select 1 from email_messages m where m.thread_id = t.id and m.dedupe_key = ${dedupeKey}) desc,
             (select max(m.received_at) from email_messages m where m.thread_id = t.id) desc nulls last, t.id
    limit 1`;
  return t?.gmail_thread_id ?? null;
}

// The record the box was opened from, when the viewer can see it and it is not archived (its files are offered then).
async function usableRecord(viewerId: number, target: ComposeTarget | null) {
  if (!target) return null;
  const r = await readRecord(sql, viewerId, target);
  return r && !r.archived ? { kind: target.kind, id: target.id, name: r.name } : null;
}

export async function replyBox(viewerId: number, ask: { mode: ReplyMode; messageId: number }, target: ComposeTarget | null): Promise<EmailBox> {
  const connection = await connectionOf(viewerId);
  const base = { gmail: gmailState(connection), from: connection?.email ?? null, sendKey: randomUUID() };
  const a = await answered(sql, viewerId, ask.messageId);
  if (!a) return { ...base, to: [], cc: [], names: {}, files: [], record: null, reply: null, missing: true };
  const { to, cc } = prefill(ask.mode, a, connection?.email ?? null);
  const record = await usableRecord(viewerId, target);
  const files = record ? (await listFiles(viewerId, toTarget(record))).map((f) => ({ id: f.id, name: f.name, size: f.size })) : [];
  return {
    ...base,
    to,
    cc,
    names: await namesFor(viewerId, [...to, ...cc]),
    files,
    record,
    reply: {
      mode: ask.mode,
      messageId: a.id,
      heading: `${HEADING[ask.mode]} · ${subjectOrDefault(a.subject)}`,
      subject: subjectFor(ask.mode, a.subject),
      quote: quoteFor(ask.mode, a),
      forwarded: ask.mode === "forward" ? a.attachments.map((x) => ({ id: x.id, name: x.name, size: x.size })) : [],
    },
  };
}

// contracts/routes.md § Server action, steps 1–7 (the action sets the flash).
export async function sendReply(actorId: number, input: ReplyInput, now = new Date()): Promise<SendResult> {
  // 1. Gmail usable; a send key.
  const connection = await connectionOf(actorId);
  const state = gmailState(connection);
  if (state !== "ok" || !connection) return { status: "gmail", state: state === "ok" ? "not_connected" : state };
  if (!isSendKey(input.sendKey)) return refused({ code: "compose_send_failed" });
  // 2. The pure checks, on the typed text only (the quote is not counted).
  const r = normaliseRecipients(input);
  const errors = validateCompose({ ...r, subject: input.subject, text: input.text });
  if (errors.length > 0) return refused(...errors);
  // 3. The answered email, still in a conversation the user can see (FR-013).
  const a = await answered(sql, actorId, input.messageId);
  if (!a) return refused({ code: "email_not_found" });
  // 4–5. The record's files (only while the record is visible and not archived), the uploads, the forwarded ones.
  const fileIds = unique(input.fileIds);
  const uploadIds = unique(input.uploadIds);
  const forwardIds = unique(input.forwardIds);
  const record = await usableRecord(actorId, input.record);
  const attached = await readAttached(actorId, record, fileIds, uploadIds);
  if (!attached) return refused({ code: "compose_attachment_gone" });
  const chosen = forwardIds.map((id) => a.attachments.find((x) => x.id === id));
  if (chosen.some((x) => x === undefined) || (forwardIds.length > 0 && input.mode !== "forward")) return refused({ code: "compose_attachment_gone" });
  const own = chosen as Answered["attachments"];
  if (totalBytes([...own.map((x) => x.size), ...attached.map((x) => x.size)]) > MAX_ATTACHMENT_BYTES) return refused({ code: "compose_attachments_too_large" });
  const forwarded: Forwarded[] = [];
  for (const x of own) {
    const access = await attachmentAccess(actorId, x.id, { preferConnectionId: connection.id });
    if (!access) return refused({ code: "compose_attachment_gone" });
    forwarded.push({ access, contentType: CONTENT_TYPE.test(x.contentType) ? x.contentType : "application/octet-stream" });
  }
  // 6. Names, quote, headers, thread.
  const named = await nameRecipients(actorId, r);
  const threadId = await userThread(connection.id, a.conversationId, a.dedupeKey);
  // 7. The shared delivery: no record (no hand link), the answered email named in the ledger.
  return deliver({
    actorId, connection, sendKey: input.sendKey, record: null, replyMessageId: a.id, named, notice: sentNotice(allAddresses(r)),
    subject: input.subject, body: bodyWithQuote(input.text, quoteFor(input.mode, a)), attached, forwarded, uploadIds, threadId,
    inReplyTo: a.rfcMessageId !== null && MESSAGE_ID.test(a.rfcMessageId) ? a.rfcMessageId : null, references: a.references, now,
  });
}

// research.md §1: runs in storeMessage's transaction for a new message, before processMessage. A pending reply of this
// connection (matched on its Gmail id, or on the CRM's own Message-ID while the Gmail ids are not saved yet) whose thread
// row has no conversation yet is placed in the answered email's conversation; a thread already in a conversation keeps
// it (SF-127's rule).
export async function placePendingReply(db: Sql, connectionId: number, threadRowId: number, m: Pick<ReadMessage, "gmailMessageId" | "rfcMessageId">): Promise<void> {
  const [send] = await db<{ reply_message_id: number }[]>`
    select s.reply_message_id::int as reply_message_id from email_sends s
    where s.connection_id = ${connectionId} and s.state = 'sending' and s.reply_message_id is not null
      and (s.gmail_message_id = ${m.gmailMessageId} or s.rfc_message_id = ${m.rfcMessageId})
    order by s.id limit 1`;
  if (!send) return;
  // As processMessage: no conversation is merged away while it is read.
  await db`lock table email_conversations in share row exclusive mode`;
  await db`
    update email_threads set conversation_id = (
      select t.conversation_id from email_messages am join email_threads t on t.id = am.thread_id where am.id = ${send.reply_message_id})
    where id = ${threadRowId} and conversation_id is null
      and exists (select 1 from email_messages am join email_threads t on t.id = am.thread_id
                  where am.id = ${send.reply_message_id} and t.conversation_id is not null)`;
}
