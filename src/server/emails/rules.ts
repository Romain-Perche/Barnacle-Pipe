// Email on the timeline (SF-127 research.md §7, §8, §10; data-model.md § Merge). Pure: no database, no network, no
// server-only import. An email's text is only ever plain text: the text part, else its HTML turned into text by the
// one HTML reader of the repo (htmlToText, SF-122: scripts and styles dropped, entities decoded once).
import { safeDownloadName } from "@/server/files/rules";
import { messages } from "@/server/messages";
import { htmlToText } from "@/server/pipedrive/html";

export type EmailAddress = { email: string; name: string | null };

const PREVIEW_MAX = 200;

// The full plain text of an email (the conversation page); null when it has none (attachments only).
export function emailText(text: string | null, html: string | null): string | null {
  const t = text !== null && text.trim() !== "" ? text : html !== null ? htmlToText(html) : "";
  const trimmed = t.replace(/\r\n?/g, "\n").trim();
  return trimmed === "" ? null : trimmed;
}

// The start of an email on the timeline: whitespace runs made one space, at most 200 code points then "…".
export function emailPreview(text: string | null): string | null {
  if (text === null) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  const chars = [...flat];
  return chars.length > PREVIEW_MAX ? `${chars.slice(0, PREVIEW_MAX).join("")}…` : flat;
}

const nameOf = (a: EmailAddress) => (a.name && a.name.trim() !== "" ? a.name : a.email);

// "Ana Example → Ada Fake · Cc Ben Example · Bcc …" (names, else bare addresses; Bcc only when the copy has it).
export function recipientsLine(e: { from: EmailAddress | null; to: EmailAddress[]; cc: EmailAddress[]; bcc: EmailAddress[] }): string {
  const list = (xs: EmailAddress[]) => xs.map(nameOf).join(", ");
  let line = `${e.from ? nameOf(e.from) : messages.email_unknown_sender} → ${list(e.to)}`.trimEnd();
  if (e.cc.length > 0) line += ` · Cc ${list(e.cc)}`;
  if (e.bcc.length > 0) line += ` · Bcc ${list(e.bcc)}`;
  return line;
}

// "Ana Example <ana@example.test>", or the bare address.
export function addressText(a: EmailAddress): string {
  return a.name && a.name.trim() !== "" ? `${a.name} <${a.email}>` : a.email;
}

export function subjectOrDefault(subject: string): string {
  return subject.trim() === "" ? messages.email_no_subject : subject;
}

export type RecordKind = "person" | "organisation" | "deal";
export type FromRecord = { kind: RecordKind; id: number };

// `?from=person-12` → the record the conversation was opened from; anything else null (never shown as typed).
export function parseFrom(value: string | null | undefined): FromRecord | null {
  const m = /^(person|organisation|deal)-([1-9]\d{0,15})$/.exec(value ?? "");
  if (!m) return null;
  const id = Number(m[2]);
  return Number.isSafeInteger(id) ? { kind: m[1] as RecordKind, id } : null;
}

export function fromParam(from: FromRecord | null): string {
  return from ? `${from.kind}-${from.id}` : "";
}

export function parseLinkKind(value: string | null | undefined): RecordKind | null {
  return value === "deal" || value === "person" || value === "organisation" ? value : null;
}

export type LinkChoice = { how: "auto" | "manual"; removed: boolean; changedAt: Date };

// Two conversations found to be one hold a link to the same record: a hand choice (linked by hand, or unlinked) beats
// a plain automatic link; between two hand choices the later one wins; otherwise the first.
export function mergeLinkChoice<A extends LinkChoice, B extends LinkChoice>(a: A, b: B): A | B {
  const hand = (x: LinkChoice) => x.how === "manual" || x.removed;
  if (hand(a) !== hand(b)) return hand(a) ? a : b;
  if (hand(a) && b.changedAt.getTime() > a.changedAt.getTime()) return b;
  return a;
}

// Always a download (never shown in the browser), under the attachment's name with what a file system refuses
// replaced (SF-116 safeDownloadName); an ASCII fallback, and the UTF-8 name percent-encoded (RFC 6266 / 5987).
export function contentDisposition(name: string): string {
  const safe = safeDownloadName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
