// Reply, reply all and forward (SF-130 research.md §5, §6, data-model.md § Prefill, § Headers). Pure and client-safe:
// no database, no network, no server-only import (the email box imports it). The quote is built from what the CRM
// stored, both for the box (shown read-only) and at send time; the client never sends it.
import { addressText, emailText, type EmailAddress } from "@/server/emails/rules";
import { formatDate, ukParts } from "@/server/format";
import { messages } from "@/server/messages";

export type ReplyMode = "reply" | "reply_all" | "forward";
export type EmailParam = { mode: "new" } | { mode: ReplyMode; messageId: number };
export type ReplyEmail = {
  from: EmailAddress | null; to: EmailAddress[]; cc: EmailAddress[]; subject: string; receivedAt: Date;
  textBody: string | null; htmlBody: string | null;
};

// A Message-ID as the CRM writes it back in In-Reply-To / References (RFC 5322 msg-id, no spaces, one line).
export const MESSAGE_ID = /^<[^<>\s]{1,996}>$/;

const PARAM = /^(new|reply|reply-all|forward)(?:-([1-9]\d{0,15}))?$/;

// `?email=` → what the box opens: `new` (SF-129) or a reply mode with the shown email's id; anything else null.
export function parseEmailParam(value: string | null | undefined): EmailParam | null {
  const m = PARAM.exec(value ?? "");
  if (!m) return null;
  if (m[1] === "new") return m[2] === undefined ? { mode: "new" } : null;
  if (m[2] === undefined) return null;
  const messageId = Number(m[2]);
  if (!Number.isSafeInteger(messageId)) return null;
  return { mode: m[1] === "reply-all" ? "reply_all" : (m[1] as "reply" | "forward"), messageId };
}

const key = (a: string) => a.trim().toLowerCase();

// FR-004 to FR-006: the To and Cc the box starts with (addresses as stored, compared lower-cased, first place kept).
export function prefill(mode: ReplyMode, email: Pick<ReplyEmail, "from" | "to" | "cc">, own: string | null): { to: string[]; cc: string[] } {
  if (mode === "forward") return { to: [], cc: [] };
  const mine = own ? key(own) : null;
  const fromSelf = email.from !== null && mine !== null && key(email.from.email) === mine;
  const reply = fromSelf ? email.to.map((a) => a.email) : email.from ? [email.from.email] : [];
  if (mode === "reply") return { to: once(reply, new Set()), cc: [] };
  const seen = new Set<string>(mine ? [mine] : []);
  const to = once([...reply, ...email.to.map((a) => a.email)], seen);
  const cc = once(email.cc.map((a) => a.email), seen);
  return { to, cc };
}

function once(list: string[], seen: Set<string>): string[] {
  const out: string[] = [];
  for (const a of list) {
    if (a.trim() === "" || seen.has(key(a))) continue;
    seen.add(key(a));
    out.push(a);
  }
  return out;
}

export function replySubject(subject: string): string {
  if (subject.trim() === "") return `Re: ${messages.email_no_subject}`;
  return /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function forwardSubject(subject: string): string {
  if (subject.trim() === "") return `Fwd: ${messages.email_no_subject}`;
  return /^\s*(fwd?|fw)\s*:/i.test(subject) ? subject : `Fwd: ${subject}`;
}

// "27 Nov 2026 at 14:05", UK time.
export function quoteDate(d: Date): string {
  const p = ukParts(d);
  return `${formatDate(d)} at ${p.hour}:${p.minute}`;
}

const who = (e: ReplyEmail) => (e.from ? addressText(e.from) : messages.email_unknown_sender);
const plain = (e: ReplyEmail) => emailText(e.textBody, e.htmlBody) ?? "";

export function replyQuote(e: ReplyEmail): string {
  const text = plain(e);
  const lines = text === "" ? [] : text.split("\n").map((l) => (l === "" ? ">" : `> ${l}`.trimEnd()));
  return [`On ${quoteDate(e.receivedAt)}, ${who(e)} wrote:`, ...lines].join("\n");
}

export function forwardQuote(e: ReplyEmail): string {
  const block = [
    "---------- Forwarded message ---------",
    `From: ${who(e)}`,
    `Date: ${quoteDate(e.receivedAt)}`,
    `Subject: ${e.subject}`,
    `To: ${e.to.map(addressText).join(", ")}`,
  ];
  const text = plain(e);
  return (text === "" ? block : [...block, "", text]).join("\n");
}

export const quoteFor = (mode: ReplyMode, e: ReplyEmail) => (mode === "forward" ? forwardQuote(e) : replyQuote(e));
export const subjectFor = (mode: ReplyMode, subject: string) => (mode === "forward" ? forwardSubject(subject) : replySubject(subject));

// FR-010: what is sent (and stored): the typed text, a blank line, the quote.
export function bodyWithQuote(text: string, quote: string): string {
  return `${text}\n\n${quote}`;
}

// FR-010: the References ids, oldest first, up to and including the answered one (`upTo` its index), valid and once.
export function referencesFor(ids: (string | null)[], upTo: number): string[] {
  const out: string[] = [];
  for (const id of ids.slice(0, upTo + 1)) if (id !== null && MESSAGE_ID.test(id) && !out.includes(id)) out.push(id);
  return out;
}
