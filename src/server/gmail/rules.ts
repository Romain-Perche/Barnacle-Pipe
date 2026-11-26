// Gmail rules (SF-118 research.md §2, §5, §9, §10; data-model.md § Copy rules). Pure: no database, no network.
// - the scopes asked for and the check of the scopes Google granted;
// - reading a Gmail message (format=full) into what is stored: addresses, subject, dates, text, HTML, and attachment
//   names, types and sizes (never their contents);
// - what is copied (decideCopy) and what a Google error means (classifyGoogleError);
// - the RFC 5322 text of a sent email (buildMime), refusing CR/LF in any header value.
import { randomBytes } from "node:crypto";
import { calendarConfig } from "@/server/env";
import { messages } from "@/server/messages";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send"] as const;
// SF-124 (research.md §2): events of the calendars the user owns, the primary one included; nothing else.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";

const scopeSet = (scope: string) => new Set((scope ?? "").split(/\s+/).filter(Boolean));

// What [ CONNECT GMAIL ] asks Google for: the two Gmail scopes, plus Calendar when Calendar sync is on (SF-124).
export function askedScopes(): string[] {
  return calendarConfig().mode === "off" ? [...GMAIL_SCOPES] : [...GMAIL_SCOPES, CALENDAR_SCOPE];
}

// Every asked scope must be in Google's space-separated `scope` answer (the user may untick a box: granular consent).
export function hasAllScopes(scope: string, asked: readonly string[] = askedScopes()): boolean {
  const granted = scopeSet(scope);
  return asked.every((s) => granted.has(s));
}

export function hasCalendarScope(scopes: string): boolean {
  return scopeSet(scopes).has(CALENDAR_SCOPE);
}

export type Address = { email: string; name: string | null };

const clean = (text: string) => text.replace(/\u0000/g, "");
const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+$/;

// RFC 2047 encoded words (=?charset?B|Q?text?=); whitespace between two encoded words is dropped.
export function decodeHeader(value: string): string {
  const word = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;
  const joined = (value ?? "").replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)/g, "$1");
  return clean(
    joined.replace(word, (all, charset: string, enc: string, text: string) => {
      try {
        const bytes =
          enc.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
                "latin1",
              );
        return decodeBytes(bytes, charset.replace(/\*.*$/, ""));
      } catch {
        return all;
      }
    }),
  );
}

function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// Splits an address-list at commas and group marks that are outside quotes, comments and angle brackets.
// Returns the mailbox texts; a group's display name ("Team:") is dropped.
function splitMailboxes(header: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let comment = 0;
  let angle = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (quoted) {
      cur += ch;
      if (ch === "\\" && i + 1 < header.length) cur += header[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (comment > 0) {
      cur += ch;
      if (ch === "\\" && i + 1 < header.length) cur += header[++i];
      else if (ch === "(") comment++;
      else if (ch === ")") comment--;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "(") comment = 1;
    else if (ch === "<") angle = true;
    else if (ch === ">") angle = false;
    else if (!angle && (ch === "," || ch === ";")) {
      out.push(cur);
      cur = "";
      continue;
    } else if (!angle && ch === ":") {
      cur = ""; // a group's name
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

// Takes the comments out of a mailbox text: [text without comments, the first comment's text].
function takeComments(text: string): [string, string | null] {
  let rest = "";
  let first: string | null = null;
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (depth === 0) {
      if (ch === '"') quoted = !quoted;
      if (!quoted && ch === "(") {
        depth = 1;
        current = "";
        continue;
      }
      rest += ch;
      if (quoted && ch === "\\" && i + 1 < text.length) rest += text[++i];
      continue;
    }
    if (ch === "\\" && i + 1 < text.length) current += text[++i];
    else if (ch === "(") (depth++, (current += ch));
    else if (ch === ")") {
      depth--;
      if (depth === 0) first ??= current.trim();
      else current += ch;
    } else current += ch;
  }
  return [rest, first];
}

const unquote = (s: string) => {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1).replace(/\\(.)/g, "$1") : t;
};

// RFC 5322 address-list → lower-cased, trimmed addresses with their display names (null when none). Display names are
// never used to decide anything; a name without an address is dropped.
export function parseAddressList(header: string | null | undefined): Address[] {
  if (!header) return [];
  const out: Address[] = [];
  for (const mailbox of splitMailboxes(header)) {
    const [text, comment] = takeComments(mailbox);
    const open = text.lastIndexOf("<");
    const close = text.lastIndexOf(">");
    let email: string;
    let name: string | null;
    if (open >= 0 && close > open) {
      email = text.slice(open + 1, close);
      name = unquote(text.slice(0, open)) || comment;
    } else {
      email = text;
      name = comment;
    }
    email = email.trim().toLowerCase();
    if (!ADDRESS.test(email)) continue;
    const decoded = name ? decodeHeader(name).trim() : "";
    out.push({ email, name: decoded === "" ? null : decoded });
  }
  return out;
}

// The parts of a Gmail message that are read (users.messages.get format=full).
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart };

export type Attachment = { name: string; contentType: string; size: number };
export type ReadMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  rfcMessageId: string | null;
  direction: "sent" | "received";
  from: Address | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  sentAt: Date | null;
  receivedAt: Date;
  textBody: string | null;
  htmlBody: string | null;
  attachments: Attachment[];
  labelIds: string[];
  // Every address of From / To / Cc / Bcc (what decideCopy matches against CRM people).
  addresses: string[];
};

const NAME_MAX = 255;

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string | null {
  const h = (headers ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

function charsetOf(part: GmailPart): string | null {
  const ct = headerValue(part.headers, "Content-Type") ?? "";
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(ct);
  return m ? m[1] : null;
}

// Gmail's internal date (ms since 1970, as a string); now when missing or unreadable.
function internalDateOf(m: GmailMessage): Date {
  const ms = Number(m.internalDate);
  return Number.isFinite(ms) && m.internalDate !== undefined && m.internalDate !== "" ? new Date(ms) : new Date(NaN);
}

export function readMessage(m: GmailMessage): ReadMessage {
  const headers = m.payload?.headers ?? [];
  let textBody: string | null = null;
  let htmlBody: string | null = null;
  const attachments: Attachment[] = [];
  const walk = (part: GmailPart) => {
    const isAttachment = (part.filename ?? "") !== "" || Boolean(part.body?.attachmentId);
    const type = (part.mimeType ?? "").toLowerCase();
    if (isAttachment) {
      attachments.push({
        name: clean(decodeHeader(part.filename ?? "")).slice(0, NAME_MAX) || "(no name)",
        contentType: (part.mimeType || "application/octet-stream").slice(0, NAME_MAX),
        size: Math.max(0, Number(part.body?.size ?? 0) || 0),
      });
    } else if (type === "text/plain" && textBody === null && part.body?.data !== undefined) {
      textBody = clean(decodeBytes(Buffer.from(part.body.data, "base64url"), charsetOf(part)));
    } else if (type === "text/html" && htmlBody === null && part.body?.data !== undefined) {
      htmlBody = clean(decodeBytes(Buffer.from(part.body.data, "base64url"), charsetOf(part)));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  if (m.payload) walk(m.payload);
  const from = parseAddressList(headerValue(headers, "From"))[0] ?? null;
  const to = parseAddressList(headerValue(headers, "To"));
  const cc = parseAddressList(headerValue(headers, "Cc"));
  const bcc = parseAddressList(headerValue(headers, "Bcc"));
  const rfc = headerValue(headers, "Message-ID")?.trim() ?? "";
  const date = headerValue(headers, "Date");
  const sent = date ? new Date(date) : null;
  const labelIds = m.labelIds ?? [];
  return {
    gmailMessageId: m.id,
    gmailThreadId: m.threadId,
    rfcMessageId: rfc === "" || rfc.length > 998 ? null : clean(rfc),
    direction: labelIds.includes("SENT") ? "sent" : "received",
    from,
    to,
    cc,
    bcc,
    subject: decodeHeader(headerValue(headers, "Subject") ?? ""),
    sentAt: sent && !Number.isNaN(sent.getTime()) ? sent : null,
    receivedAt: internalDateOf(m),
    textBody,
    htmlBody,
    attachments,
    labelIds,
    addresses: [...new Set([...(from ? [from] : []), ...to, ...cc, ...bcc].map((a) => a.email))],
  };
}

const SKIP_LABELS = ["DRAFT", "SPAM", "TRASH"];

// data-model.md § Copy rules: never drafts, spam or bin; never from before the connection (Gmail's own date); copied
// when its thread is already copied or one of its addresses is a CRM person's. "Not stored yet" is the unique index.
export function decideCopy(input: {
  labelIds: string[];
  internalDate: Date;
  connectedAt: Date;
  threadKnown: boolean;
  addresses: string[];
  crmAddresses: ReadonlySet<string>;
}): "copy" | "skip" {
  if (input.labelIds.some((l) => SKIP_LABELS.includes(l))) return "skip";
  if (!(input.internalDate.getTime() >= input.connectedAt.getTime())) return "skip";
  if (input.threadKnown) return "copy";
  return input.addresses.some((a) => input.crmAddresses.has(a)) ? "copy" : "skip";
}

// SF-128 (research.md §1, spec Clarifications): the 12 months of a past-email fetch, fixed at the press: from the
// same moment 12 calendar months earlier (UTC) to the press.
export function pastWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getTime());
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return { start, end: new Date(now.getTime()) };
}

// SF-128 data-model.md § Copy rule: the decision on one whole thread. Candidates are its messages that are not drafts,
// spam or bin and are dated (Gmail's own date) within the window; when one of them has a CRM address (addresses only,
// never display names), the candidates not stored yet are copied, oldest first; otherwise nothing.
export function planPastThread(input: {
  messages: { id: string; labelIds: string[]; internalDate: Date; addresses: string[] }[];
  windowStart: Date;
  windowEnd: Date;
  crmAddresses: ReadonlySet<string>;
  stored: ReadonlySet<string>;
}): string[] {
  const from = input.windowStart.getTime();
  const to = input.windowEnd.getTime();
  const candidates = input.messages.filter((m) => {
    const t = m.internalDate.getTime();
    return !m.labelIds.some((l) => SKIP_LABELS.includes(l)) && t >= from && t <= to;
  });
  if (!candidates.some((m) => m.addresses.some((a) => input.crmAddresses.has(a)))) return [];
  return candidates
    .filter((m) => !input.stored.has(m.id))
    .sort((a, b) => a.internalDate.getTime() - b.internalDate.getTime())
    .map((m) => m.id);
}

// SF-128 data-model.md § Card state: what the "// PAST EMAILS" part shows, from the fetch row (none before any press on
// this connection) and the connection's state.
export type PastFetchView =
  | { state: "none" }
  | { state: "running"; copied: number; paused: boolean; unreachable: boolean; waitSeconds: number }
  | { state: "ended"; copied: number; endedAt: Date };

export function pastFetchView(
  row: { state: string | null; copied: number | null; problem: string | null; wait_until: Date | null; ended_at: Date | null } | null,
  connectionState: string,
  now: Date,
): PastFetchView {
  if (!row?.state) return { state: "none" };
  if (row.state === "ended" && row.ended_at) return { state: "ended", copied: row.copied ?? 0, endedAt: row.ended_at };
  const wait = row.wait_until ? Math.max(0, Math.ceil((row.wait_until.getTime() - now.getTime()) / 1000)) : 0;
  return { state: "running", copied: row.copied ?? 0, paused: connectionState === "needs_reconnect", unreachable: row.problem === "unavailable", waitSeconds: wait };
}

// SF-128 contracts/google.md § Errors: how long Gmail asks to wait: a numeric Retry-After rounded up, else 30 seconds,
// within 1 to 300.
export function slowDownSeconds(header: string | null): number {
  const n = header !== null && /^\s*\d+(\.\d+)?\s*$/.test(header) ? Math.ceil(Number(header)) : 30;
  return Math.min(300, Math.max(1, n));
}

// What a refused Google call means (research.md §5): the key is no longer accepted, or Google can't be used right now.
export function classifyGoogleError(status: number, body: unknown): "key_refused" | "unavailable" {
  const b = (typeof body === "object" && body !== null ? body : {}) as { error?: unknown };
  if (typeof b.error === "string") {
    return status === 400 && b.error === "invalid_grant" ? "key_refused" : "unavailable";
  }
  if (status === 401) return "key_refused";
  if (status === 403) {
    const e = (typeof b.error === "object" && b.error !== null ? b.error : {}) as { errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] };
    const reasons = [...(e.errors ?? []), ...(e.details ?? [])].map((x) => x?.reason);
    if (reasons.some((r) => r === "insufficientPermissions" || r === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")) return "key_refused";
  }
  return "unavailable";
}

export class BadHeader extends Error {
  constructor() {
    super("An email header can't hold this value.");
    this.name = "BadHeader";
  }
}

export type MimeInput = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  date?: Date;
};

const noBreak = (v: string) => {
  if (/[\r\n]/.test(v)) throw new BadHeader();
  return v;
};
const address = (v: string) => {
  noBreak(v);
  if (!ADDRESS.test(v.trim())) throw new BadHeader();
  return v.trim();
};

// RFC 2047 for a subject that is not plain printable ASCII; encoded words of at most 45 bytes each.
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const words: string[] = [];
  let chunk = "";
  for (const ch of subject) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

const base64Lines = (text: string) => (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? [""]).join("\r\n");

// RFC 5322 date, e.g. "Tue, 24 Nov 2026 10:00:00 +0000".
function rfcDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

// The RFC 5322 text Gmail's messages.send takes (base64url-encoded by the caller). Gmail sets its own Message-ID.
export function buildMime(input: MimeInput): string {
  const to = input.to.map(address);
  if (to.length === 0) throw new BadHeader();
  const cc = (input.cc ?? []).map(address);
  const bcc = (input.bcc ?? []).map(address);
  const lines = [`From: ${address(input.from)}`, `To: ${to.join(", ")}`];
  if (cc.length) lines.push(`Cc: ${cc.join(", ")}`);
  if (bcc.length) lines.push(`Bcc: ${bcc.join(", ")}`);
  lines.push(`Subject: ${encodeSubject(noBreak(input.subject))}`, `Date: ${rfcDate(input.date ?? new Date())}`);
  if (input.inReplyTo) lines.push(`In-Reply-To: ${noBreak(input.inReplyTo)}`);
  if (input.references) lines.push(`References: ${noBreak(input.references)}`);
  lines.push("MIME-Version: 1.0");
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Lines(input.text)];
  if (!input.html) return [...lines, ...textPart].join("\r\n");
  const boundary = `crm-${randomBytes(12).toString("hex")}`;
  const htmlPart = ['Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Lines(input.html)];
  return [
    ...lines,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart,
    `--${boundary}`,
    ...htmlPart,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// The test email of Settings (FR-014): to the user's own address, with the fixed subject and text.
export function testEmail(address: string): { to: string[]; subject: string; text: string } {
  return { to: [address], subject: messages.gmail_test_subject, text: messages.gmail_test_text };
}
