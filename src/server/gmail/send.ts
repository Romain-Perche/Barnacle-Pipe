// Sending an email from a user's own Gmail (SF-118 FR-013, research.md §10). The one way the CRM sends: later issues
// (writing, replies, campaigns) call sendGmail; here the Settings test email does. It refuses before any Google call
// when the user has no working connection, builds the RFC 5322 text with the pure buildMime (CR/LF refused), and in a
// conversation sends with the threadId. SF-129: the sender's name, the CRM's own Message-ID and attachments; the message
// is built once and checked against Gmail's 35 MiB upload limit (GmailTooLarge) before any Google call, then goes
// through the upload endpoint (message/rfc822). SF-130 (research.md §2, §3): the caller gives In-Reply-To and References
// from the CRM's own data (no Gmail lookup); with a threadId the upload is multipart.
import { sql } from "@/server/db";
import { loadKey, markNeedsReconnect } from "@/server/gmail/connections";
import { GoogleKeyRefused, GoogleUnavailable, refreshAccessToken, sendRawUpload } from "@/server/gmail/google-api";
import { buildMime, type MimeAttachment, type MimeInput, type MimeRecipient } from "@/server/gmail/rules";

// users.messages.send mediaUpload.maxSize in the pinned gmail-api.json (35 MiB).
export const MAX_RAW_BYTES = 36_700_160;

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

export class GmailTooLarge extends Error {
  constructor() {
    super("The email is larger than Gmail accepts");
    this.name = "GmailTooLarge";
  }
}

export type SendInput = {
  to: MimeRecipient[]; cc?: MimeRecipient[]; bcc?: MimeRecipient[]; subject: string; text: string; html?: string | null; threadId?: string | null;
  fromName?: string | null; messageId?: string | null; attachments?: MimeAttachment[]; date?: Date;
  inReplyTo?: string | null; references?: string[];
};

export async function sendGmail(userId: number, input: SendInput): Promise<{ messageId: string; threadId: string }> {
  const [row] = await sql<{ id: string; email: string; state: string }[]>`
    select id::text as id, email, state from gmail_connections where user_id = ${userId}`;
  if (!row || row.state === "disconnected") throw new GmailNotConnected();
  if (row.state !== "working") throw new GmailNeedsReconnect();
  const connectionId = Number(row.id);
  const base: MimeInput = {
    from: row.email, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.text, html: input.html,
    fromName: input.fromName, messageId: input.messageId, attachments: input.attachments, date: input.date ?? new Date(),
    inReplyTo: input.inReplyTo, references: input.references,
  };
  // BadHeader and GmailTooLarge before any Google call.
  const first = Buffer.from(buildMime(base), "utf8");
  if (first.length > MAX_RAW_BYTES) throw new GmailTooLarge();
  const key = await loadKey(connectionId);
  if (!key) {
    await markNeedsReconnect(connectionId);
    throw new GmailNeedsReconnect();
  }
  try {
    const access = await refreshAccessToken(key);
    const sent = await sendRawUpload(access, new Uint8Array(first.buffer, first.byteOffset, first.byteLength) as Uint8Array<ArrayBuffer>, input.threadId);
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
