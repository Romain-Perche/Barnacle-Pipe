// Pure rules of campaign drafts (SF-119 data-model.md § Entities, research.md §10): field limits counted in code points
// (as Postgres's char_length), "Still empty" and the copy's name. Client-safe: no database, no Next.js.
import { isEmptyContent, type Content } from "@/server/campaigns/content";
import { BUILT_IN_MERGE_FIELDS, resolver, tagsIn, type Link, type MergeField } from "@/server/campaigns/merge";
import { messages, templates } from "@/server/messages";
import { isValidEmail, normaliseEmail } from "@/server/records/rules";

export const CAMPAIGN_LIMITS = {
  name: 100, senderName: 100, replyTo: 254, subject: 255, previewText: 255, fallback: 100, html: 500_000, blocks: 50,
  heading: 200, text: 10_000, buttonLabel: 60, alt: 200, url: 2_000,
} as const;

export const codePoints = (s: string) => Array.from(s).length;

export type DraftForm = { name: string; senderName: string; replyTo: string; subject: string; previewText: string };
// `contentTexts`: the content's tag-bearing texts, for the "If empty, show" limit.
export type DraftInput = DraftForm & { contentTexts?: readonly string[] };
export type DraftErrors = Partial<Record<keyof DraftForm | "fallback", string>>;

// Every error at once, in the order of the form. The "If empty, show" limit applies only to tags that name a merge field
// (a long `{{…}}` from another tool's HTML is an unknown tag, never refused).
export function validateDraft(
  form: DraftInput,
  fields: readonly MergeField[] = BUILT_IN_MERGE_FIELDS,
  links: readonly Link[] = [],
): { ok: true; value: DraftForm } | { ok: false; errors: DraftErrors } {
  const value: DraftForm = {
    name: form.name.trim(),
    senderName: form.senderName.trim(),
    replyTo: normaliseEmail(form.replyTo),
    subject: form.subject.trim(),
    previewText: form.previewText.trim(),
  };
  const errors: DraftErrors = {};
  if (value.name === "") errors.name = messages.campaign_name_required;
  else if (codePoints(value.name) > CAMPAIGN_LIMITS.name) errors.name = messages.campaign_name_too_long;
  if (codePoints(value.senderName) > CAMPAIGN_LIMITS.senderName) errors.senderName = messages.campaign_sender_too_long;
  if (value.replyTo !== "" && !isValidEmail(value.replyTo)) errors.replyTo = messages.campaign_reply_to_invalid;
  if (codePoints(value.subject) > CAMPAIGN_LIMITS.subject) errors.subject = messages.campaign_subject_too_long;
  if (codePoints(value.previewText) > CAMPAIGN_LIMITS.previewText) errors.previewText = messages.campaign_preview_text_too_long;
  const resolve = resolver(links, fields);
  const texts = [value.subject, value.previewText, ...(form.contentTexts ?? [])];
  if (tagsIn(texts).some((t) => codePoints(t.fallback) > CAMPAIGN_LIMITS.fallback && resolve(t.name) !== "unknown")) {
    errors.fallback = messages.campaign_fallback_too_long;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

// "Still empty: Subject, Content": what a draft still lacks, in this order.
export function stillEmpty(draft: { senderName: string; subject: string; content: Content }): string[] {
  const out: string[] = [];
  if (draft.senderName.trim() === "") out.push(messages.campaign_field_sender);
  if (draft.subject.trim() === "") out.push(messages.campaign_field_subject);
  if (isEmptyContent(draft.content)) out.push(messages.campaign_field_content);
  return out;
}

// "Copy of <name>", cut to 100 code points, then trimmed.
export function copyName(name: string): string {
  return Array.from(templates.campaign_copy_name(name)).slice(0, CAMPAIGN_LIMITS.name).join("").trim();
}
