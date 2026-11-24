// A campaign draft's content (SF-119 research.md §5, §8, §9): layout blocks or pasted HTML, their checks, the blocks as
// email HTML and the document the sandboxed preview frame shows. Pure and client-safe: no database, no Next.js.
import { messages, templates } from "@/server/messages";
import { escapeHtml, type BlockFill } from "@/server/campaigns/merge";

export type Block =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "button"; label: string; url: string }
  | { type: "image"; src: string; alt: string; url: string }
  | { type: "divider" };
export type BlockType = Block["type"];
export type Content = null | { kind: "blocks"; blocks: Block[] } | { kind: "html"; html: string };
export type ContentErrors = Record<string, string>;

export const BLOCK_TYPES: readonly BlockType[] = ["heading", "text", "button", "image", "divider"];
export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: messages.campaign_block_heading,
  text: messages.campaign_block_text,
  button: messages.campaign_block_button,
  image: messages.campaign_block_image,
  divider: messages.campaign_block_divider,
};
export const CONTENT_LIMITS = { blocks: 50, heading: 200, text: 10_000, buttonLabel: 60, alt: 200, url: 2_000, html: 500_000 } as const;

export type LayoutKey = "blank" | "text" | "text_button" | "newsletter";
export const LAYOUTS: readonly { key: LayoutKey; label: string; blocks: readonly BlockType[] }[] = [
  { key: "blank", label: messages.campaign_layout_blank, blocks: ["text"] },
  { key: "text", label: messages.campaign_layout_text, blocks: ["heading", "text"] },
  { key: "text_button", label: messages.campaign_layout_text_button, blocks: ["heading", "text", "button"] },
  { key: "newsletter", label: messages.campaign_layout_newsletter, blocks: ["image", "heading", "text", "button", "divider", "text"] },
];

const KEYS: Record<BlockType, readonly string[]> = {
  heading: ["type", "text"],
  text: ["type", "text"],
  button: ["type", "label", "url"],
  image: ["type", "src", "alt", "url"],
  divider: ["type"],
};

export function newBlock(type: BlockType): Block {
  switch (type) {
    case "heading":
    case "text":
      return { type, text: "" };
    case "button":
      return { type, label: "", url: "" };
    case "image":
      return { type, src: "", alt: "", url: "" };
    default:
      return { type: "divider" };
  }
}

export function layoutBlocks(layout: LayoutKey): Block[] {
  return (LAYOUTS.find((l) => l.key === layout)?.blocks ?? []).map(newBlock);
}

const codePoints = (s: string) => Array.from(s).length;
const oneLine = (s: string) => s.replace(/\r\n|\r|\n/g, " ");

// An address typed in a block: empty in a draft, else one that parses and uses an allowed scheme.
function addressOk(value: string, schemes: readonly string[]): boolean {
  if (value === "") return true;
  try {
    return schemes.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
const LINK_SCHEMES = ["https:", "http:", "mailto:"];
const IMAGE_SCHEMES = ["https:"];

// A block as posted: exactly its type's keys, each a string. Anything else only comes from a tampered post.
function readBlock(raw: unknown): Block | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || !(BLOCK_TYPES as readonly string[]).includes(type)) return null;
  const keys = KEYS[type as BlockType];
  const own = Object.keys(obj);
  if (own.length !== keys.length || !keys.every((k) => typeof obj[k] === "string")) return null;
  const s = (k: string) => obj[k] as string;
  switch (type as BlockType) {
    case "heading":
      return { type: "heading", text: oneLine(s("text")) };
    case "text":
      return { type: "text", text: s("text") };
    case "button":
      return { type: "button", label: s("label"), url: s("url").trim() };
    case "image":
      return { type: "image", src: s("src").trim(), alt: s("alt"), url: s("url").trim() };
    default:
      return { type: "divider" };
  }
}

function blockError(b: Block): string | null {
  const label = BLOCK_LABELS[b.type];
  const tooLong = (v: string, max: number) => codePoints(v) > max;
  switch (b.type) {
    case "heading":
      return tooLong(b.text, CONTENT_LIMITS.heading) ? templates.campaign_block_too_long(label, CONTENT_LIMITS.heading) : null;
    case "text":
      return tooLong(b.text, CONTENT_LIMITS.text) ? templates.campaign_block_too_long(label, CONTENT_LIMITS.text) : null;
    case "button":
      if (tooLong(b.label, CONTENT_LIMITS.buttonLabel)) return templates.campaign_block_too_long(label, CONTENT_LIMITS.buttonLabel);
      if (tooLong(b.url, CONTENT_LIMITS.url)) return templates.campaign_block_too_long(label, CONTENT_LIMITS.url);
      return addressOk(b.url, LINK_SCHEMES) ? null : templates.campaign_button_url(label);
    case "image":
      if (tooLong(b.alt, CONTENT_LIMITS.alt)) return templates.campaign_block_too_long(label, CONTENT_LIMITS.alt);
      if (tooLong(b.src, CONTENT_LIMITS.url) || tooLong(b.url, CONTENT_LIMITS.url)) return templates.campaign_block_too_long(label, CONTENT_LIMITS.url);
      return addressOk(b.src, IMAGE_SCHEMES) && addressOk(b.url, LINK_SCHEMES) ? null : templates.campaign_image_url(label);
    default:
      return null;
  }
}

// `kind` is "none", "blocks" or "html" as the editor posts it; empty content (no blocks, blank HTML) becomes null.
// Errors: `content` for the whole content, `block.<n>` (from 0) for one block.
export function validateContent(kind: string, blocksJson: string, html: string): { ok: true; content: Content } | { ok: false; errors: ContentErrors } {
  const invalid = { ok: false as const, errors: { content: messages.campaign_content_invalid } };
  if (kind === "none" || kind === "") return { ok: true, content: null };
  if (kind === "html") {
    if (html.trim() === "") return { ok: true, content: null };
    if (codePoints(html) > CONTENT_LIMITS.html) return { ok: false, errors: { content: messages.campaign_html_too_long } };
    return { ok: true, content: { kind: "html", html } };
  }
  if (kind !== "blocks") return invalid;
  let raw: unknown;
  try {
    raw = JSON.parse(blocksJson);
  } catch {
    return invalid;
  }
  if (!Array.isArray(raw)) return invalid;
  if (raw.length === 0) return { ok: true, content: null };
  if (raw.length > CONTENT_LIMITS.blocks) return { ok: false, errors: { content: messages.campaign_blocks_limit } };
  const blocks: Block[] = [];
  for (const r of raw) {
    const b = readBlock(r);
    if (!b) return invalid;
    blocks.push(b);
  }
  const errors: ContentErrors = {};
  blocks.forEach((b, i) => {
    const e = blockError(b);
    if (e) errors[`block.${i}`] = e;
  });
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, content: { kind: "blocks", blocks } };
}

// "Still empty: Content": nothing, no blocks, or HTML that is only spaces.
export function isEmptyContent(content: Content | readonly Block[] | string): boolean {
  if (content === null) return true;
  if (typeof content === "string") return content.trim() === "";
  if (Array.isArray(content)) return content.length === 0;
  const c = content as Exclude<Content, null>;
  return c.kind === "html" ? c.html.trim() === "" : c.blocks.length === 0;
}

// The texts that may hold merge tags (never the addresses).
export function blockTexts(b: Block): string[] {
  switch (b.type) {
    case "heading":
    case "text":
      return [b.text];
    case "button":
      return [b.label];
    case "image":
      return [b.alt];
    default:
      return [];
  }
}

export function contentTexts(content: Content): string[] {
  if (content === null) return [];
  return content.kind === "html" ? [content.html] : content.blocks.flatMap(blockTexts);
}

// The same content with `f` applied to every tag-bearing text (a rename rewrite on open).
export function mapContentTexts(content: Content, f: (text: string) => string): Content {
  if (content === null) return null;
  if (content.kind === "html") return { kind: "html", html: f(content.html) };
  return {
    kind: "blocks",
    blocks: content.blocks.map((b): Block => {
      switch (b.type) {
        case "heading":
        case "text":
          return { ...b, text: f(b.text) };
        case "button":
          return { ...b, label: f(b.label) };
        case "image":
          return { ...b, alt: f(b.alt) };
        default:
          return b;
      }
    }),
  };
}

// Web addresses in (already escaped) text become links; trailing punctuation stays outside the link.
export function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (match) => {
    let url = match;
    let rest = "";
    for (;;) {
      const t = /(?:[.,;:!?)\]]|&quot;|&#39;|&gt;)$/.exec(url);
      if (!t) break;
      rest = t[0] + rest;
      url = url.slice(0, -t[0].length);
    }
    return url.length > "https://".length ? `<a href="${url}">${url}</a>${rest}` : match;
  });
}

// The blocks typed text, unfilled: the HTML a switch to "Paste HTML" starts with (tags left as typed, FR-013).
export const keepTags: BlockFill = (text) => escapeHtml(text);

const P = 'style="margin:0 0 16px"';
const breaks = (html: string) => html.replace(/\r\n|\r|\n/g, "<br>");

// Simple email HTML with inline styles: a 600 px centred column, a plain font stack.
export function blocksToHtml(blocks: readonly Block[], fill: BlockFill): string {
  const parts = blocks.map((b) => {
    switch (b.type) {
      case "heading":
        return `<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">${fill(b.text)}</h1>`;
      case "text":
        return `<p ${P}>${breaks(linkify(fill(b.text)))}</p>`;
      case "button": {
        const href = b.url ? ` href="${escapeHtml(b.url)}"` : "";
        return `<p ${P}><a${href} style="display:inline-block;background:#2b00ff;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:bold">${fill(b.label)}</a></p>`;
      }
      case "image": {
        if (!b.src) return "";
        const img = `<img src="${escapeHtml(b.src)}" alt="${fill(b.alt, true)}" style="display:block;max-width:100%;height:auto;border:0">`;
        return `<p ${P}>${b.url ? `<a href="${escapeHtml(b.url)}">${img}</a>` : img}</p>`;
      }
      default:
        return '<hr style="border:0;border-top:1px solid #d1d5db;margin:24px 0">';
    }
  });
  return `<div style="max-width:600px;margin:0 auto;font-family:Arial, Helvetica, sans-serif;font-size:16px;line-height:1.5;color:#111827">${parts.join("")}</div>`;
}

const FRAME_HEAD =
  `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:"><base target="_blank">`;
// The stand-in unsubscribe line every campaign email ends with: its link has no address and does nothing (research.md §9).
export const UNSUBSCRIBE_LINE = `<p style="max-width:600px;margin:32px auto 0;font-family:Arial, Helvetica, sans-serif;font-size:12px;color:#6b7280;text-align:center">${messages.campaign_unsubscribe_line} <a>${messages.campaign_unsubscribe}</a></p>`;

// The document of the sandboxed preview frame: the CSP (no script, frame, form or fetch; images, styles and fonts may
// load) and <base target="_blank"> come before the content, so the content cannot change them.
export function frameDocument(contentHtml: string, unsubscribeHtml: string = UNSUBSCRIBE_LINE): string {
  return FRAME_HEAD + contentHtml + unsubscribeHtml;
}
