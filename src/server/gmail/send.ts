// Sending an email from a user's own Gmail (SF-118 FR-013, research.md §10). The one way the CRM sends: later issues
// (writing, replies, campaigns) call sendGmail; here the Settings test email does. It refuses before any Google call
// when the user has no working connection, builds the RFC 5322 text with the pure buildMime (CR/LF refused), and in a
// conversation reads its last Message-ID and References first so Gmail keeps the thread.
import { sql } from "@/server/db";
import { loadKey, markNeedsReconnect } from "@/server/gmail/connections";
import { getThreadMetadata, GoogleKeyRefused, GoogleUnavailable, refreshAccessToken, sendRaw } from "@/server/gmail/google-api";
import { buildMime, type MimeInput } from "@/server/gmail/rules";

export class GmailNotConnected extends Error {
  constructor() {
    super("Gmail is not connected");
    this.name = "GmailNotConnected";
  }
}
export class GmailNeedsReconnect extends Error {
  constructor() {
    super("Gmail needs reconnecting");
    this.name = "GmailNeedsReconnect";
  }
}
export class GmailUnavailable extends Error {
  constructor() {
    super("Gmail can't be used right now");
    this.name = "GmailUnavailable";
  }
}

export type SendInput = { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string | null; threadId?: string | null };

const headerOf = (headers: { name: string; value: string }[], name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";

export async function sendGmail(userId: number, input: SendInput): Promise<{ messageId: string; threadId: string }> {
  const [row] = await sql<{ id: string; email: string; state: string }[]>`
    select id::text as id, email, state from gmail_connections where user_id = ${userId}`;
  if (!row || row.state === "disconnected") throw new GmailNotConnected();
  if (row.state !== "working") throw new GmailNeedsReconnect();
  const connectionId = Number(row.id);
  const base: MimeInput = { from: row.email, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.text, html: input.html };
  buildMime(base); // BadHeader before any Google call
  const key = await loadKey(connectionId);
  if (!key) {
    await markNeedsReconnect(connectionId);
    throw new GmailNeedsReconnect();
  }
  try {
    const access = await refreshAccessToken(key);
    let reply: Pick<MimeInput, "inReplyTo" | "references"> = {};
    if (input.threadId) {
      const messages = await getThreadMetadata(access, input.threadId);
      const last = messages[messages.length - 1] ?? [];
      const id = headerOf(last, "Message-ID");
      if (id && !/[\r\n]/.test(id)) {
        const refs = headerOf(last, "References").replace(/[\r\n]+/g, " ");
        reply = { inReplyTo: id, references: refs ? `${refs} ${id}` : id };
      }
    }
    const raw = Buffer.from(buildMime({ ...base, ...reply }), "utf8").toString("base64url");
    const sent = await sendRaw(access, raw, input.threadId ?? null);
    return { messageId: sent.id, threadId: sent.threadId };
  } catch (e) {
    if (e instanceof GoogleKeyRefused) {
      await markNeedsReconnect(connectionId);
      throw new GmailNeedsReconnect();
    }
    if (e instanceof GoogleUnavailable) throw new GmailUnavailable();
    throw e;
  }
}
