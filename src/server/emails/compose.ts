// Writing an email from a deal, person or organisation (SF-129 contracts/routes.md, research.md §1–§4, §6).
// - emailBox: what the email box needs (Gmail state, From, the To to fill, the record's own files, a fresh send key).
// - startEmailUpload: a file from the computer goes straight from the browser to Storage (as SF-116's [ ADD FILE ]);
//   its path is queued in file_cleanup for 24 hours at once (email_uploads, never a record file).
// - sendFromRecord: the checks, then the ledger claim (email_sends, one per user and send key: a second press sends
//   nothing), the attachments read from Storage, SF-118's sendGmail, then the sync's own storeMessage so SF-127 makes
//   the conversation, its automatic links and Last contacted; completePendingSend (run by storeMessage in its
//   transaction) adds the one hand link to the record written from. No Storage or Google call inside sql.begin().
// Consent is never read here: it is for campaigns only (PRODUCT §4); an Unsubscribed person can still be written to.
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
import type { Target } from "@/server/records/timeline";
import { visibleDeal, visibleFile, visiblePerson } from "@/server/records/visibility";

export type ComposeKind = "deal" | "person" | "organisation";
export type ComposeTarget = { kind: ComposeKind; id: number };
export type GmailState = "ok" | "off" | "not_connected" | "needs_reconnect";
export type BoxFile = { id: number; name: string; size: number };
export type EmailBox = {
  gmail: GmailState;
  from: string | null;
  to: string[];
  files: BoxFile[];
  sendKey: string;
  record: { kind: ComposeKind; id: number; name: string };
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
  | "compose_send_failed";
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

type Connection = { id: number; email: string; state: string };

async function connectionOf(userId: number): Promise<Connection | null> {
  const [row] = await sql<Connection[]>`select id::int as id, email, state from gmail_connections where user_id = ${userId}`;
  return row ?? null;
}

function gmailState(c: Connection | null): GmailState {
  if (gmailConfig().mode === "off") return "off";
  if (!c || c.state === "disconnected") return "not_connected";
  return c.state === "working" ? "ok" : "needs_reconnect";
}

type RecordRow = { name: string; archived: boolean; personId: number | null };

// The record when the viewer can see it (organisations have no private rule).
async function readRecord(db: Sql, viewerId: number, t: ComposeTarget): Promise<RecordRow | null> {
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
    files,
    sendKey: randomUUID(),
    record: { kind: target.kind, id: target.id, name: record.name },
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
type NamedRecipients = { to: Named[]; cc: Named[]; bcc: Named[] };

// Each address named as a person the sender can see (archived included) with that address, ignoring case; several →
// the lowest person id; none → no name. A name an email header cannot hold (a line break) is dropped for that address.
async function nameRecipients(actorId: number, r: { to: string[]; cc: string[]; bcc: string[] }): Promise<NamedRecipients> {
  const keys = [...new Set(allAddresses(r).map((a) => a.toLowerCase()))];
  const rows = await sql<{ key: string; name: string }[]>`
    select distinct on (lower(pe.email)) lower(pe.email) as key, btrim(p.first_name || ' ' || p.last_name) as name
    from person_emails pe join persons p on p.id = pe.person_id
    where lower(pe.email) = any(${keys}::text[]) and ${visiblePerson(sql, actorId)}
    order by lower(pe.email), p.id`;
  const names = new Map(rows.map((row) => [row.key, row.name]));
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

const refused = (...errors: Refusal[]): SendResult => ({ status: "refused", errors });
const unique = (ids: number[]) => [...new Set(ids)];

type Attached = { id: number; name: string; contentType: string; size: number; path: string };

// contracts/routes.md § sendEmailFromRecord, steps 1–9 (the action sets the flash).
export async function sendFromRecord(actorId: number, input: SendInput, now = new Date()): Promise<SendResult> {
  // 1. Gmail usable.
  const connection = await connectionOf(actorId);
  const state = gmailState(connection);
  if (state !== "ok") return { status: "gmail", state };
  if (!UUID.test(input.sendKey)) return refused({ code: "compose_send_failed" });
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
  const files = fileIds.length
    ? await sql<Attached[]>`
        select f.id::int as id, f.name, f.size::float8 as size, f.storage_path as path, '' as "contentType" from files f
        where f.id = any(${fileIds}::bigint[]) and f.${sql(column(input.target.kind))} = ${input.target.id} and ${visibleFile(sql, actorId)}`
    : [];
  const uploads = uploadIds.length
    ? await sql<Attached[]>`
        select u.id::int as id, u.name, u.size::float8 as size, u.storage_path as path, u.content_type as "contentType" from email_uploads u
        where u.id = any(${uploadIds}::bigint[]) and u.user_id = ${actorId}`
    : [];
  if (files.length !== fileIds.length || uploads.length !== uploadIds.length) return refused({ code: "compose_attachment_gone" });
  // Box order: the record's files as chosen, then the computer files. A record file is sent with the type it was
  // stored with (SF-116 stores uploadContentType(name)).
  const inOrder = (rows: Attached[], ids: number[]) => ids.map((id) => rows.find((row) => row.id === id)!);
  const attached: Attached[] = [...inOrder(files, fileIds).map((f) => ({ ...f, contentType: uploadContentType(f.name) })), ...inOrder(uploads, uploadIds)];
  if (totalBytes(attached.map((a) => a.size)) > MAX_ATTACHMENT_BYTES) return refused({ code: "compose_attachments_too_large" });

  // Recipients named as the sender's CRM people (fix round 1): the same names in the headers and the stored copy.
  const named = await nameRecipients(actorId, r);

  // 5. The ledger claim: a second press (same box, same key) sends nothing.
  const [user] = await sql<{ name: string }[]>`select name from users where id = ${actorId}`;
  const rfcMessageId = `<crm-${randomBytes(12).toString("hex")}@barnacle.ai>`;
  const c = column(input.target.kind);
  const [claim] = await sql<{ id: number }[]>`
    insert into email_sends (user_id, send_key, connection_id, ${sql(c)}, rfc_message_id, state, upload_ids)
    values (${actorId}, ${input.sendKey}, ${connection!.id}, ${input.target.id}, ${rfcMessageId}, 'sending', ${uploadIds}::bigint[])
    on conflict (user_id, send_key) do nothing
    returning id::int as id`;
  const notice = sentNotice(allAddresses(r));
  if (!claim) return { status: "sent", notice };
  const unclaim = () => sql`delete from email_sends where id = ${claim.id}`;

  // 6. The attachments' bytes, one after the other.
  const mimeFiles: MimeAttachment[] = [];
  for (const a of attached) {
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
  }

  // 7. Gmail.
  let sent: { messageId: string; threadId: string };
  try {
    sent = await sendGmail(actorId, {
      ...named, subject: input.subject, text: input.text, fromName: user?.name ?? null, messageId: rfcMessageId, attachments: mimeFiles, date: now,
    });
  } catch (e) {
    await unclaim();
    if (e instanceof GmailNotConnected) return { status: "gmail", state: "not_connected" };
    if (e instanceof GmailNeedsReconnect) return { status: "gmail", state: "needs_reconnect" };
    if (e instanceof GmailTooLarge) return refused({ code: "compose_attachments_too_large" });
    if (e instanceof GmailUnavailable || e instanceof BadHeader) return refused({ code: "compose_send_failed" });
    throw e;
  }

  // 8. Recorded at once (SF-127 processing + the hand link); a failure here is caught up by the Gmail sync.
  try {
    await sql`update email_sends set gmail_message_id = ${sent.messageId}, gmail_thread_id = ${sent.threadId} where id = ${claim.id}`;
    if (beforeStoreHook) await beforeStoreHook();
    await storeMessage(
      connection!.id,
      sentMessage({
        gmailMessageId: sent.messageId, gmailThreadId: sent.threadId, rfcMessageId, from: { email: connection!.email, name: user?.name ?? "" },
        ...named, subject: input.subject, text: input.text, attachments: attached, now,
      }),
    );
  } catch (e) {
    console.error("SF-129: an email was sent but could not be recorded; the Gmail sync will catch up.", e instanceof Error ? e.name : "");
    const id = connection!.id;
    runAfterResponse(() => syncConnection(id));
  }

  // 9. The computer files are no longer needed.
  if (uploadIds.length > 0) {
    await sql`update file_cleanup set due_at = now() where storage_path in (select storage_path from email_uploads where id = any(${uploadIds}::bigint[]))`;
    await sql`delete from email_uploads where id = any(${uploadIds}::bigint[])`;
    runAfterResponse(sweepFileCleanup);
  }
  return { status: "sent", notice };
}
