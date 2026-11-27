// Writing an email from a deal, person or organisation (SF-129 contracts/routes.md, research.md §1–§4, §6).
// - emailBox: what the email box needs (Gmail state, From, the To to fill, the record's own files, a fresh send key).
// - startEmailUpload: a file from the computer goes straight from the browser to Storage (as SF-116's [ ADD FILE ]);
//   its path is queued in file_cleanup for 24 hours at once (email_uploads, never a record file).
// - sendFromRecord: the checks, then the ledger claim (email_sends, one per user and send key: a second press sends
//   nothing), the attachments read from Storage, SF-118's sendGmail, then the sync's own storeMessage so SF-127 makes
//   the conversation, its automatic links and Last contacted; completePendingSend (run by storeMessage in its
//   transaction) adds the one hand link to the record written from. No Storage or Google call inside sql.begin().
// Consent is never read here: it is for campaigns only (PRODUCT §4); an Unsubscribed person can still be written to.
// SF-130: the steps from the ledger claim on (claim, Storage reads, forwarded attachments from Gmail, sendGmail, storing,
// upload clean-up) are one shared `deliver`, used by sendFromRecord and by reply.ts sendReply (a reply's ledger row
// names the answered email in reply_message_id and has no record: no hand link).
import { randomBytes, randomUUID } from "node:crypto";
import { sql, type Sql } from "@/server/db";
import { gmailConfig } from "@/server/env";
import { runAfterResponse } from "@/server/calendar/soon";
import {
  allAddresses, MAX_ATTACHMENT_BYTES, normaliseRecipients, sentNotice, totalBytes, validateCompose, type ComposeError,
} from "@/server/emails/compose-rules";
import { listFiles, sweepFileCleanup } from "@/server/files/files";
import { MAX_FILE_BYTES, uploadContentType, validateFile } from "@/server/files/rules";
import { createSignedUploadUrl, newStoragePath, readObject, StorageUnreachable } from "@/server/files/storage";
import { BadHeader, type MimeAttachment, type ReadMessage } from "@/server/gmail/rules";
import { GmailNeedsReconnect, GmailNotConnected, GmailTooLarge, GmailUnavailable, sendGmail } from "@/server/gmail/send";
import { storeMessage, syncConnection } from "@/server/gmail/sync";
import { fetchAttachment, type AttachmentAccess } from "@/server/emails/attachments";
import type { Target } from "@/server/records/timeline";
import { visibleDeal, visibleFile, visiblePerson } from "@/server/records/visibility";

export type ComposeKind = "deal" | "person" | "organisation";
export type ComposeTarget = { kind: ComposeKind; id: number };
export type GmailState = "ok" | "off" | "not_connected" | "needs_reconnect";
export type BoxFile = { id: number; name: string; size: number };
export type ReplyView = {
  mode: "reply" | "reply_all" | "forward";
  messageId: number;
  heading: string;
  subject: string;
  quote: string;
  forwarded: BoxFile[];
};
// SF-130 contracts/routes.md § replyBox → EmailBox props: Cc and the CRM names of the prefilled addresses (lower-cased
// address → name), a record that may be null (no record files then), the reply view, `missing` (email_not_found).
export type EmailBox = {
  gmail: GmailState;
  from: string | null;
  to: string[];
  cc: string[];
  names: Record<string, string>;
  files: BoxFile[];
  sendKey: string;
  record: { kind: ComposeKind; id: number; name: string } | null;
  reply: ReplyView | null;
  missing?: true;
};
export type SendInput = {
  target: ComposeTarget; sendKey: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string;
  fileIds: number[]; uploadIds: number[];
};
export type RefusalCode =
  | ComposeError["code"]
  | "compose_attachment_gone"
  | "compose_record_archived"
  | "compose_record_not_found"
  | "compose_send_failed"
  | "email_not_found"
  | "reply_forward_unavailable";
export type Refusal = { code: RefusalCode; address?: string };
export type SendResult =
  | { status: "sent"; notice: { name: string; count: number } }
  | { status: "refused"; errors: Refusal[] }
  | { status: "gmail"; state: Exclude<GmailState, "ok"> };
export type UploadResult =
  | { status: "ok"; id: number; url: string; contentType: string }
  | { status: "compose_attachments_too_large" | "file_empty" | "file_name_too_long" | "files_unreachable" };

const UPLOAD_HOURS = 24;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

export const toTarget = (t: ComposeTarget): Target =>
  t.kind === "deal" ? { dealId: t.id } : t.kind === "person" ? { personId: t.id } : { organisationId: t.id };
const column = (kind: ComposeKind) => (kind === "deal" ? "deal_id" : kind === "person" ? "person_id" : "organisation_id");

let beforeStoreHook: (() => Promise<void>) | null = null;
// Tests only: runs in sendFromRecord after Gmail accepted the email and before it is stored (to make storing fail, or
// let the Gmail sync store it first).
export function onRecordSentForTests(fn: (() => Promise<void>) | null): void {
  if (process.env.APP_ENV !== "test") throw new Error("onRecordSentForTests is for tests only.");
  beforeStoreHook = fn;
}

export type Connection = { id: number; email: string; state: string };

export async function connectionOf(userId: number): Promise<Connection | null> {
  const [row] = await sql<Connection[]>`select id::int as id, email, state from gmail_connections where user_id = ${userId}`;
  return row ?? null;
}

export function gmailState(c: Connection | null): GmailState {
  if (gmailConfig().mode === "off") return "off";
  if (!c || c.state === "disconnected") return "not_connected";
  return c.state === "working" ? "ok" : "needs_reconnect";
}

type RecordRow = { name: string; archived: boolean; personId: number | null };

// The record when the viewer can see it (organisations have no private rule).
export async function readRecord(db: Sql, viewerId: number, t: ComposeTarget): Promise<RecordRow | null> {
  const [row] =
    t.kind === "deal"
      ? await db<RecordRow[]>`
          select d.title as name, d.archived_at is not null as archived, d.person_id::int as "personId"
          from deals d where d.id = ${t.id} and ${visibleDeal(db, viewerId)}`
      : t.kind === "person"
        ? await db<RecordRow[]>`
            select btrim(p.first_name || ' ' || p.last_name) as name, p.archived_at is not null as archived, p.id::int as "personId"
            from persons p where p.id = ${t.id} and ${visiblePerson(db, viewerId)}`
        : await db<RecordRow[]>`
            select o.name, o.archived_at is not null as archived, null::int as "personId" from organisations o where o.id = ${t.id}`;
  return row ?? null;
}

// The box's data, or null when the record is gone, hidden or archived (nothing opens then).
export async function emailBox(viewerId: number, target: ComposeTarget): Promise<EmailBox | null> {
  const record = await readRecord(sql, viewerId, target);
  if (!record || record.archived) return null;
  const connection = await connectionOf(viewerId);
  // The first address (by position) of the person, or of the deal's main person when the viewer can see them.
  const [first] =
    record.personId === null
      ? []
      : await sql<{ email: string }[]>`
          select pe.email from person_emails pe join persons p on p.id = pe.person_id
          where p.id = ${record.personId} and ${visiblePerson(sql, viewerId)} order by pe.position limit 1`;
  const files = (await listFiles(viewerId, toTarget(target))).map((f) => ({ id: f.id, name: f.name, size: f.size }));
  return {
    gmail: gmailState(connection),
    from: connection?.email ?? null,
    to: first ? [first.email] : [],
    cc: [],
    names: {},
    files,
    sendKey: randomUUID(),
    record: { kind: target.kind, id: target.id, name: record.name },
    reply: null,
  };
}

// A file from the computer: checked as SF-116 does, then a signed upload address (Storage first), then its row and its
// clean-up in 24 hours in one transaction.
export async function startEmailUpload(actorId: number, file: { name: string; size: number; type?: string }): Promise<UploadResult> {
  if (file.size > MAX_FILE_BYTES) return { status: "compose_attachments_too_large" };
  const valid = validateFile(file);
  if (!valid.ok) return { status: valid.code === "file_too_large" ? "compose_attachments_too_large" : valid.code };
  const contentType = file.type && file.type.length <= 255 && CONTENT_TYPE.test(file.type) ? file.type : uploadContentType(file.name);
  const path = newStoragePath();
  let url: string;
  try {
    ({ url } = await createSignedUploadUrl(path));
  } catch (e) {
    if (e instanceof StorageUnreachable) return { status: "files_unreachable" };
    throw e;
  }
  const id = await sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [row] = await db<{ id: number }[]>`
      insert into email_uploads (user_id, storage_path, name, size, content_type)
      values (${actorId}, ${path}, ${file.name}, ${file.size}, ${contentType}) returning id::int as id`;
    await db`
      insert into file_cleanup (storage_path, due_at) values (${path}, now() + make_interval(hours => ${UPLOAD_HOURS}))
      on conflict (storage_path) do nothing`;
    return row.id;
  });
  return { status: "ok", id, url, contentType };
}

export type Named = { email: string; name: string | null };
export type NamedRecipients = { to: Named[]; cc: Named[]; bcc: Named[] };

// SF-130: each address (lower-cased) → the name of a person the sender can see (archived included) with that address;
// several → the lowest person id. Used for the headers and stored copy (nameRecipients) and the box's chips.
export async function namesFor(actorId: number, addresses: string[]): Promise<Record<string, string>> {
  const keys = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (keys.length === 0) return {};
  const rows = await sql<{ key: string; name: string }[]>`
    select distinct on (lower(pe.email)) lower(pe.email) as key, btrim(p.first_name || ' ' || p.last_name) as name
    from person_emails pe join persons p on p.id = pe.person_id
    where lower(pe.email) = any(${keys}::text[]) and ${visiblePerson(sql, actorId)}
    order by lower(pe.email), p.id`;
  return Object.fromEntries(rows.filter((row) => row.name !== "").map((row) => [row.key, row.name]));
}

// Each address named as namesFor gives; none → no name. A name an email header cannot hold (a line break) is dropped
// for that address.
export async function nameRecipients(actorId: number, r: { to: string[]; cc: string[]; bcc: string[] }): Promise<NamedRecipients> {
  const names = new Map(Object.entries(await namesFor(actorId, allAddresses(r))));
  const named = (list: string[]) =>
    list.map((email) => {
      const name = names.get(email.toLowerCase()) ?? "";
      return { email, name: name === "" || /[\r\n]/.test(name) ? null : name };
    });
  return { to: named(r.to), cc: named(r.cc), bcc: named(r.bcc) };
}

// SF-118's ReadMessage of what was sent (stored by storeMessage, processed by SF-127 like any copied email).
export function sentMessage(m: {
  gmailMessageId: string; gmailThreadId: string; rfcMessageId: string; from: { email: string; name: string };
  to: (string | Named)[]; cc: (string | Named)[]; bcc: (string | Named)[]; subject: string; text: string;
  attachments: { name: string; contentType: string; size: number }[]; now: Date;
}): ReadMessage {
  const list = (a: (string | Named)[]) => a.map((x) => (typeof x === "string" ? { email: x, name: null } : { email: x.email, name: x.name }));
  return {
    gmailMessageId: m.gmailMessageId,
    gmailThreadId: m.gmailThreadId,
    rfcMessageId: m.rfcMessageId,
    direction: "sent",
    from: { email: m.from.email, name: m.from.name },
    to: list(m.to),
    cc: list(m.cc),
    bcc: list(m.bcc),
    subject: m.subject,
    sentAt: m.now,
    receivedAt: m.now,
    textBody: m.text,
    htmlBody: null,
    attachments: m.attachments.map((a) => ({ name: a.name, contentType: a.contentType, size: a.size })),
    labelIds: ["SENT"],
    addresses: [m.from.email, ...[...m.to, ...m.cc, ...m.bcc].map((x) => (typeof x === "string" ? x : x.email))].map((a) => a.toLowerCase()),
  };
}

// Inside storeMessage's transaction, after SF-127's processMessage: when this message is one the CRM is sending from
// this connection, the hand link to the record it was written from (kept as it is when it exists) and the ledger
// `sent`. A ledger row of another connection, or already `sent`, is never touched.
export async function completePendingSend(db: Sql, connectionId: number, messageId: number): Promise<void> {
  const [send] = await db<{ id: number; user_id: number; deal_id: number | null; person_id: number | null; organisation_id: number | null }[]>`
    select s.id::int as id, s.user_id::int as user_id, s.deal_id::int as deal_id, s.person_id::int as person_id,
           s.organisation_id::int as organisation_id
    from email_sends s join email_messages m on m.id = ${messageId}
    where s.connection_id = ${connectionId} and s.state = 'sending'
      and (s.gmail_message_id = m.gmail_message_id or s.rfc_message_id = m.rfc_message_id)
    order by s.id limit 1
    for update of s`;
  if (!send) return;
  const [thread] = await db<{ conversation_id: number | null }[]>`
    select t.conversation_id::int as conversation_id from email_messages m join email_threads t on t.id = m.thread_id where m.id = ${messageId}`;
  if (thread?.conversation_id != null && (send.deal_id ?? send.person_id ?? send.organisation_id) !== null) {
    await db`
      insert into email_links (conversation_id, deal_id, person_id, organisation_id, how, changed_by)
      values (${thread.conversation_id}, ${send.deal_id}, ${send.person_id}, ${send.organisation_id}, 'manual', ${send.user_id})
      on conflict do nothing`;
  }
  await db`update email_sends set state = 'sent', message_id = ${messageId} where id = ${send.id}`;
}

export const refused = (...errors: Refusal[]): SendResult => ({ status: "refused", errors });
export const unique = (ids: number[]) => [...new Set(ids)];

export type Attached = { id: number; name: string; contentType: string; size: number; path: string };
export const isSendKey = (key: string) => UUID.test(key);

// SF-129 step 4 / SF-130 §8: the record's own visible files (when a record is given) and the user's own uploads, in box
// order (record files as chosen, then computer files); null when one of them is gone. A record file is sent with the
// type it was stored with (SF-116 stores uploadContentType(name)).
export async function readAttached(actorId: number, target: ComposeTarget | null, fileIds: number[], uploadIds: number[]): Promise<Attached[] | null> {
  if (fileIds.length > 0 && !target) return null;
  const files = fileIds.length
    ? await sql<Attached[]>`
        select f.id::int as id, f.name, f.size::float8 as size, f.storage_path as path, '' as "contentType" from files f
        where f.id = any(${fileIds}::bigint[]) and f.${sql(column(target!.kind))} = ${target!.id} and ${visibleFile(sql, actorId)}`
    : [];
  const uploads = uploadIds.length
    ? await sql<Attached[]>`
        select u.id::int as id, u.name, u.size::float8 as size, u.storage_path as path, u.content_type as "contentType" from email_uploads u
        where u.id = any(${uploadIds}::bigint[]) and u.user_id = ${actorId}`
    : [];
  if (files.length !== fileIds.length || uploads.length !== uploadIds.length) return null;
  const inOrder = (rows: Attached[], ids: number[]) => ids.map((id) => rows.find((row) => row.id === id)!);
  return [...inOrder(files, fileIds).map((f) => ({ ...f, contentType: uploadContentType(f.name) })), ...inOrder(uploads, uploadIds)];
}

export type Forwarded = { access: AttachmentAccess; contentType: string };
export type Delivery = {
  actorId: number;
  connection: Connection;
  sendKey: string;
  record: ComposeTarget | null;
  replyMessageId: number | null;
  named: NamedRecipients;
  notice: { name: string; count: number };
  subject: string;
  body: string;
  attached: Attached[];
  forwarded: Forwarded[];
  uploadIds: number[];
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  now: Date;
};

// SF-129 steps 5–9, shared with SF-130's replies: the ledger claim, the Storage reads, the forwarded attachments from
// Gmail, Gmail, storing, the upload clean-up. No Storage or Google call inside sql.begin().
export async function deliver(d: Delivery): Promise<SendResult> {
  const { actorId, connection, notice } = d;
  // 5. The ledger claim: a second press (same box, same key) sends nothing.
  const [user] = await sql<{ name: string }[]>`select name from users where id = ${actorId}`;
  const rfcMessageId = `<crm-${randomBytes(12).toString("hex")}@barnacle.ai>`;
  const recordId = (kind: ComposeKind) => (d.record?.kind === kind ? d.record.id : null);
  const [claim] = await sql<{ id: number }[]>`
    insert into email_sends (user_id, send_key, connection_id, deal_id, person_id, organisation_id, reply_message_id, rfc_message_id, state, upload_ids)
    values (${actorId}, ${d.sendKey}, ${connection.id}, ${recordId("deal")}, ${recordId("person")}, ${recordId("organisation")}, ${d.replyMessageId},
            ${rfcMessageId}, 'sending', ${d.uploadIds}::bigint[])
    on conflict (user_id, send_key) do nothing
    returning id::int as id`;
  if (!claim) return { status: "sent", notice };
  const unclaim = () => sql`delete from email_sends where id = ${claim.id}`;

  // 6. The attachments' bytes, one after the other: forwarded ones from Gmail (SF-130, the user's own mailbox first;
  // held in memory only), then the record and computer files from Storage.
  const mimeFiles: MimeAttachment[] = [];
  const stored: { name: string; contentType: string; size: number }[] = [];
  for (const f of d.forwarded) {
    let got: Awaited<ReturnType<typeof fetchAttachment>>;
    try {
      got = await fetchAttachment(f.access);
    } catch (e) {
      await unclaim();
      throw e;
    }
    if (got === "unavailable") {
      await unclaim();
      return refused({ code: "reply_forward_unavailable" });
    }
    mimeFiles.push({ name: f.access.attachment.name, contentType: f.contentType, bytes: got.bytes });
    stored.push({ name: f.access.attachment.name, contentType: f.contentType, size: got.bytes.length });
  }
  for (const a of d.attached) {
    let bytes: Uint8Array | null;
    try {
      bytes = await readObject(a.path, a.size);
    } catch (e) {
      await unclaim();
      if (e instanceof StorageUnreachable) return refused({ code: "compose_send_failed" });
      throw e;
    }
    if (!bytes) {
      await unclaim();
      return refused({ code: "compose_attachment_gone" });
    }
    mimeFiles.push({ name: a.name, contentType: a.contentType, bytes });
    stored.push(a);
  }

  // 7. Gmail.
  let sent: { messageId: string; threadId: string };
  try {
    sent = await sendGmail(actorId, {
      ...d.named, subject: d.subject, text: d.body, fromName: user?.name ?? null, messageId: rfcMessageId, attachments: mimeFiles, date: d.now,
      threadId: d.threadId, inReplyTo: d.inReplyTo, references: d.references,
    });
  } catch (e) {
    await unclaim();
    if (e instanceof GmailNotConnected) return { status: "gmail", state: "not_connected" };
    if (e instanceof GmailNeedsReconnect) return { status: "gmail", state: "needs_reconnect" };
    if (e instanceof GmailTooLarge) return refused({ code: "compose_attachments_too_large" });
    if (e instanceof GmailUnavailable || e instanceof BadHeader) return refused({ code: "compose_send_failed" });
    throw e;
  }

  // 8. Recorded at once (SF-127 processing + the hand link, or SF-130's placing in the answered conversation); a failure
  // here is caught up by the Gmail sync.
  try {
    await sql`update email_sends set gmail_message_id = ${sent.messageId}, gmail_thread_id = ${sent.threadId} where id = ${claim.id}`;
    if (beforeStoreHook) await beforeStoreHook();
    await storeMessage(
      connection.id,
      sentMessage({
        gmailMessageId: sent.messageId, gmailThreadId: sent.threadId, rfcMessageId, from: { email: connection.email, name: user?.name ?? "" },
        ...d.named, subject: d.subject, text: d.body, attachments: stored, now: d.now,
      }),
    );
  } catch (e) {
    console.error("SF-129: an email was sent but could not be recorded; the Gmail sync will catch up.", e instanceof Error ? e.name : "");
    const id = connection.id;
    runAfterResponse(() => syncConnection(id));
  }

  // 9. The computer files are no longer needed.
  if (d.uploadIds.length > 0) {
    await sql`update file_cleanup set due_at = now() where storage_path in (select storage_path from email_uploads where id = any(${d.uploadIds}::bigint[]))`;
    await sql`delete from email_uploads where id = any(${d.uploadIds}::bigint[])`;
    runAfterResponse(sweepFileCleanup);
  }
  return { status: "sent", notice };
}

// contracts/routes.md § sendEmailFromRecord, steps 1–9 (the action sets the flash).
export async function sendFromRecord(actorId: number, input: SendInput, now = new Date()): Promise<SendResult> {
  // 1. Gmail usable.
  const connection = await connectionOf(actorId);
  const state = gmailState(connection);
  if (state !== "ok") return { status: "gmail", state };
  if (!isSendKey(input.sendKey)) return refused({ code: "compose_send_failed" });
  // 2. The pure checks.
  const r = normaliseRecipients(input);
  const errors = validateCompose({ ...r, subject: input.subject, text: input.text });
  if (errors.length > 0) return refused(...errors);
  // 3. The record, as the user sees it now.
  const record = await readRecord(sql, actorId, input.target);
  if (!record) return refused({ code: "compose_record_not_found" });
  if (record.archived) return refused({ code: "compose_record_archived" });
  // 4. The attachments: the record's own visible files, the user's own uploads.
  const fileIds = unique(input.fileIds);
  const uploadIds = unique(input.uploadIds);
  const attached = await readAttached(actorId, input.target, fileIds, uploadIds);
  if (!attached) return refused({ code: "compose_attachment_gone" });
  if (totalBytes(attached.map((a) => a.size)) > MAX_ATTACHMENT_BYTES) return refused({ code: "compose_attachments_too_large" });

  // Recipients named as the sender's CRM people (fix round 1): the same names in the headers and the stored copy.
  const named = await nameRecipients(actorId, r);

  // 5–9. The ledger claim, the bytes, Gmail, storing, the clean-up.
  return deliver({
    actorId, connection: connection!, sendKey: input.sendKey, record: input.target, replyMessageId: null, named,
    notice: sentNotice(allAddresses(r)), subject: input.subject, body: input.text, attached, forwarded: [], uploadIds,
    threadId: null, inReplyTo: null, references: [], now,
  });
}
