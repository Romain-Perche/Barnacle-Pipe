// Attachments of copied emails (SF-127 research.md §9, FR-006): never stored; fetched from Gmail when opened, through a
// working mailbox holding a copy of that email (the attachment's own copy first, then the others by id). No
// transaction is held while Gmail is called. A refused key marks that mailbox needs_reconnect; anything Gmail can't
// give (down, message or part gone) tries the next copy; none → "unavailable".
import { sql } from "@/server/db";
import { loadKey, markNeedsReconnect } from "@/server/gmail/connections";
import { getAttachment, getMessage, GoogleKeyRefused, GoogleUnavailable, refreshAccessToken } from "@/server/gmail/google-api";
import { attachmentName, attachmentParts } from "@/server/gmail/rules";
import { visibleConversation } from "@/server/records/visibility";

export type Candidate = { connectionId: number; gmailMessageId: string; position: number };
export type AttachmentAccess = {
  attachment: { id: number; name: string; size: number; messageId: number; conversationId: number };
  candidates: Candidate[];
};

// Null when the attachment does not exist or its conversation is hidden from the viewer (the same answer).
export async function attachmentAccess(viewerId: number, id: number): Promise<AttachmentAccess | null> {
  const [a] = await sql<{ id: number; name: string; size: number; message_id: number; conversation_id: number; dedupe_key: string; position: number }[]>`
    select a.id::int as id, a.name, a.size::float8 as size, a.message_id::int as message_id, c.id::int as conversation_id, m.dedupe_key, a.position
    from email_attachments a
    join email_messages m on m.id = a.message_id
    join email_threads t on t.id = m.thread_id
    join email_conversations c on c.id = t.conversation_id
    where a.id = ${id} and ${visibleConversation(sql, viewerId, "c")}`;
  if (!a) return null;
  // Every copy of the same email in the conversation with the same attachment, in a working mailbox of an active user.
  const rows = await sql<{ connection_id: number; gmail_message_id: string; position: number; own: boolean }[]>`
    select m.connection_id::int as connection_id, m.gmail_message_id, ca.position, m.id = ${a.message_id} as own
    from email_messages m
    join email_threads t on t.id = m.thread_id
    join gmail_connections g on g.id = m.connection_id
    join users u on u.id = g.user_id
    join email_attachments ca on ca.message_id = m.id and ca.name = ${a.name}
    where t.conversation_id = ${a.conversation_id} and m.dedupe_key = ${a.dedupe_key} and g.state = 'working' and u.status = 'active'
      and (m.id <> ${a.message_id} or ca.id = ${a.id})
    order by (m.id = ${a.message_id}) desc, m.id, ca.position`;
  const seen = new Set<number>();
  const candidates = rows.filter((r) => (seen.has(r.connection_id) ? false : (seen.add(r.connection_id), true)));
  return {
    attachment: { id: a.id, name: a.name, size: a.size, messageId: a.message_id, conversationId: a.conversation_id },
    candidates: candidates.map((r) => ({ connectionId: r.connection_id, gmailMessageId: r.gmail_message_id, position: r.position })),
  };
}

async function fromMailbox(c: Candidate, name: string): Promise<Uint8Array | null> {
  const key = await loadKey(c.connectionId);
  if (!key) return null;
  const access = await refreshAccessToken(key);
  const message = await getMessage(access, c.gmailMessageId);
  if (!message?.payload) return null;
  const part = attachmentParts(message.payload)[c.position];
  if (!part || attachmentName(part) !== name) return null;
  if (part.body?.attachmentId) return getAttachment(access, c.gmailMessageId, part.body.attachmentId);
  return typeof part.body?.data === "string" ? new Uint8Array(Buffer.from(part.body.data, "base64url")) : null;
}

export async function fetchAttachment(access: AttachmentAccess): Promise<{ bytes: Uint8Array } | "unavailable"> {
  for (const c of access.candidates) {
    try {
      const bytes = await fromMailbox(c, access.attachment.name);
      if (bytes) return { bytes };
    } catch (e) {
      if (e instanceof GoogleKeyRefused) await markNeedsReconnect(c.connectionId);
      else if (!(e instanceof GoogleUnavailable)) throw e;
    }
  }
  return "unavailable";
}
