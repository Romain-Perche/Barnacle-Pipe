// Writing an email from a record (SF-129 data-model.md § Validation, research.md §7): pure and client-safe (the email
// box imports it), never `@/server/db`. Addresses are split on commas, semicolons, spaces and new lines, kept as typed,
// compared lower-cased: a duplicate across To / Cc / Bcc is kept once, in the first field (To, then Cc, then Bcc).
// Limits are counted in code points (an emoji counts 1), as the campaign rules do.
import { isHeaderAddress } from "@/server/gmail/address";
import { MAX_FILE_BYTES } from "@/server/files/rules";
import { isValidEmail } from "@/server/records/rules";

export const MAX_RECIPIENTS = 100;
export const MAX_SUBJECT = 250;
export const MAX_TEXT = 100_000;
export const MAX_ATTACHMENT_BYTES = MAX_FILE_BYTES;
// The flash notice's name holds at most 300 characters (src/server/records/flash.ts).
const NOTICE_CHARS = 300;
const NOTICE_ADDRESSES = 5;

export type Recipients = { to: string[]; cc: string[]; bcc: string[] };
export type ComposeCode =
  | "compose_address_invalid"
  | "compose_to_required"
  | "compose_subject_required"
  | "compose_too_many_addresses"
  | "compose_subject_too_long"
  | "compose_text_too_long"
  | "compose_attachments_too_large";
export type ComposeError = { code: ComposeCode; address?: string };

const codePoints = (s: string) => [...s].length;

export function splitAddresses(text: string): string[] {
  return text.split(/[\s,;]+/).filter((a) => a !== "");
}

export function isSendableAddress(address: string): boolean {
  return isValidEmail(address) && isHeaderAddress(address);
}

export function normaliseRecipients(r: Recipients): Recipients {
  const seen = new Set<string>();
  const keep = (list: string[]) =>
    list
      .map((a) => a.trim())
      .filter((a) => {
        const key = a.toLowerCase();
        if (a === "" || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  const to = keep(r.to);
  const cc = keep(r.cc);
  const bcc = keep(r.bcc);
  return { to, cc, bcc };
}

export const allAddresses = (r: Recipients) => [...r.to, ...r.cc, ...r.bcc];

export function totalBytes(sizes: number[]): number {
  return sizes.reduce((sum, n) => sum + n, 0);
}

// Every refusal of the form, in the form's order. `recipients` already normalised.
export function validateCompose(input: Recipients & { subject: string; text: string; attachmentBytes?: number }): ComposeError[] {
  const errors: ComposeError[] = [];
  const all = allAddresses(input);
  for (const address of all) if (!isSendableAddress(address)) errors.push({ code: "compose_address_invalid", address });
  if (input.to.length === 0) errors.push({ code: "compose_to_required" });
  if (all.length > MAX_RECIPIENTS) errors.push({ code: "compose_too_many_addresses" });
  if (input.subject.trim() === "") errors.push({ code: "compose_subject_required" });
  else if (codePoints(input.subject) > MAX_SUBJECT) errors.push({ code: "compose_subject_too_long" });
  if (codePoints(input.text) > MAX_TEXT) errors.push({ code: "compose_text_too_long" });
  if ((input.attachmentBytes ?? 0) > MAX_ATTACHMENT_BYTES) errors.push({ code: "compose_attachments_too_large" });
  return errors;
}

// "Email sent to …": the first 5 addresses (fewer when they do not fit in 300 characters) and the count of all.
export function sentNotice(addresses: string[]): { name: string; count: number } {
  const shown: string[] = [];
  for (const a of addresses.slice(0, NOTICE_ADDRESSES)) {
    if ([...shown, a].join(", ").length > NOTICE_CHARS) break;
    shown.push(a);
  }
  return { name: shown.join(", "), count: addresses.length };
}
