// Merge tags of campaign drafts (SF-119 research.md §3, §4, §6). Pure and client-safe: the editor imports it for the live
// preview and the server for the save, so both resolve a tag the same way. No database, no Next.js.
//
// A tag is `{{<name>}}` or `{{<name> | <if empty>}}`: `{{` + anything but braces + `}}`. The name is the text before the
// first `|`, the "If empty, show" text the rest, both trimmed. A name matches a field ignoring case and outer spaces.

export type MergeField = { key: string; name: string };
// Values of one person, by merge field key; null when the person's field is empty.
export type PreviewValues = Record<string, string | null>;
export type Tag = { raw: string; name: string; fallback: string; start: number; nameStart: number; nameEnd: number };
export type Segment = { text: string } | { tag: Tag };
// A custom field a draft's tags use, as stored (`merge_links`) and as shown (current name, or the last one when deleted).
// `last`: the field's name when it was deleted (set by `deleteField`), so a rename then a delete shows the latest name.
export type StoredLink = { field: number; name: string; last?: string };
export type Link = { field: number; name: string; live: boolean };
export type Resolved = MergeField | "unknown";

export const BUILT_IN_MERGE_FIELDS: readonly MergeField[] = [
  { key: "first_name", name: "First name" },
  { key: "last_name", name: "Last name" },
  { key: "full_name", name: "Full name" },
  { key: "email", name: "Email" },
  { key: "phone", name: "Phone" },
  { key: "organisation", name: "Organisation" },
  { key: "role", name: "Role" },
  { key: "lead_source", name: "Lead source" },
  { key: "linkedin", name: "LinkedIn" },
  { key: "owner", name: "Owner" },
  { key: "labels", name: "Labels" },
];

const TAG = /\{\{([^{}]*)\}\}/g;
const matchKey = (name: string) => name.trim().toLowerCase();
const customKey = (id: number) => `cf:${id}`;

// The built-ins, then every people custom field by its current name, in the admin's order.
export function mergeFields(custom: readonly { id: number; name: string }[]): MergeField[] {
  return [...BUILT_IN_MERGE_FIELDS, ...custom.map((c) => ({ key: customKey(c.id), name: c.name }))];
}

function tagAt(raw: string, inner: string, start: number): Tag {
  const pipe = inner.indexOf("|");
  const namePart = pipe < 0 ? inner : inner.slice(0, pipe);
  const name = namePart.trim();
  const nameStart = start + 2 + (namePart.length - namePart.trimStart().length);
  return { raw, name, fallback: pipe < 0 ? "" : inner.slice(pipe + 1).trim(), start, nameStart, nameEnd: nameStart + name.length };
}

export function parseTags(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ tag: tagAt(m[0], m[1], m.index) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function tagsIn(texts: readonly string[]): Tag[] {
  return texts.flatMap((t) => [...t.matchAll(TAG)].map((m) => tagAt(m[0], m[1], m.index)));
}

export function shownLinks(stored: readonly StoredLink[], custom: readonly { id: number; name: string }[]): Link[] {
  return stored.map((l) => {
    const field = custom.find((c) => c.id === l.field);
    return { field: l.field, name: field ? field.name : (l.last ?? l.name), live: Boolean(field) };
  });
}

// Each tag whose name is a stored link's saved name gets its name characters replaced by the link's shown name; every
// other character stays as it was (FR-009a, FR-012).
export function rewriteNames(text: string, stored: readonly StoredLink[], custom: readonly { id: number; name: string }[]): string {
  if (stored.length === 0 || !text.includes("{{")) return text;
  const shown = new Map<string, string>();
  for (const l of shownLinks(stored, custom)) {
    const saved = stored.find((s) => s.field === l.field)!.name;
    if (!shown.has(matchKey(saved))) shown.set(matchKey(saved), l.name);
  }
  return text.replace(TAG, (raw: string, inner: string) => {
    const tag = tagAt(raw, inner, 0);
    const name = shown.get(matchKey(tag.name));
    if (name === undefined || name === tag.name) return raw;
    return raw.slice(0, tag.nameStart) + name + raw.slice(tag.nameEnd);
  });
}

// link (by its shown name) → built-in → current people custom field → unknown. A dead link is unknown.
export function resolveTag(name: string, links: readonly Link[], fields: readonly MergeField[]): Resolved {
  return resolver(links, fields)(name);
}

// The same rule as resolveTag, with the lookups built once (the preview resolves every tag on each keystroke).
export function resolver(links: readonly Link[], fields: readonly MergeField[]): (name: string) => Resolved {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const byName = new Map<string, Resolved>();
  for (const f of [...fields].reverse()) byName.set(matchKey(f.name), f);
  for (const l of [...links].reverse()) byName.set(matchKey(l.name), l.live ? (byKey.get(customKey(l.field)) ?? "unknown") : "unknown");
  return (name: string) => {
    const key = matchKey(name);
    return key === "" ? "unknown" : (byName.get(key) ?? "unknown");
  };
}

// "Unknown merge tags: …": the tags as typed, first seen first, each once.
export function unknownTags(texts: readonly string[], links: readonly Link[], fields: readonly MergeField[]): string[] {
  const resolve = resolver(links, fields);
  const out: string[] = [];
  for (const t of tagsIn(texts)) if (resolve(t.name) === "unknown" && !out.includes(t.raw)) out.push(t.raw);
  return out;
}

// What a save writes to `merge_links`: the custom fields (live or dead) the tags resolve to, each with its shown name.
export function linksToStore(texts: readonly string[], links: readonly Link[], fields: readonly MergeField[]): StoredLink[] {
  const resolve = resolver(links, fields);
  const out: StoredLink[] = [];
  for (const t of tagsIn(texts)) {
    const key = matchKey(t.name);
    const link = links.find((l) => matchKey(l.name) === key);
    let entry: StoredLink | null = null;
    if (link) entry = { field: link.field, name: link.name };
    else {
      const r = resolve(t.name);
      if (r !== "unknown" && r.key.startsWith("cf:")) entry = { field: Number(r.key.slice(3)), name: r.name };
    }
    if (entry && !out.some((e) => e.field === entry.field)) out.push(entry);
  }
  return out;
}

// The tag the "Insert merge tag" list puts at the cursor. Braces would end the tag early, so they are left out.
export function insertTag(field: { name: string }, fallback: string): string {
  const text = fallback.replace(/[{}]/g, "").trim();
  return text ? `{{${field.name} | ${text}}}` : `{{${field.name}}}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// `values` null: no person chosen, a known tag shows "[<field name>]". `tint`: wrap a fallback in the orange tint (frame only).
export type FillContext = { resolve: (name: string) => Resolved; values: PreviewValues | null; tint?: boolean };
type Filled = { kind: "raw" } | { kind: "value"; text: string } | { kind: "fallback"; text: string } | { kind: "none" };

function fillOne(tag: Pick<Tag, "name" | "fallback">, ctx: FillContext): Filled {
  const field = ctx.resolve(tag.name);
  if (field === "unknown") return { kind: "raw" };
  if (ctx.values === null) return { kind: "value", text: `[${field.name}]` };
  const value = ctx.values[field.key];
  if (typeof value === "string" && value !== "") return { kind: "value", text: value };
  return tag.fallback ? { kind: "fallback", text: tag.fallback } : { kind: "none" };
}

// Plain texts (subject, preview text): shown as React text nodes.
export function fillText(text: string, ctx: FillContext): string {
  return text.replace(TAG, (raw: string, inner: string) => {
    const f = fillOne(tagAt(raw, inner, 0), ctx);
    return f.kind === "raw" ? raw : f.kind === "none" ? "" : f.text;
  });
}

const TINT = '<span style="background:#FFF1E6">';
// Is `pos` inside a tag's angle brackets (an attribute), where no markup may be added?
const insideMarkup = (html: string, pos: number) => html.lastIndexOf("<", pos) > html.lastIndexOf(">", pos);

// Pasted HTML: values (and the field-name placeholders) are HTML-escaped so markup in them shows as text, attributes
// included; the "If empty, show" text belongs to the pasted HTML and stays as written.
export function fillHtml(html: string, ctx: FillContext): string {
  return html.replace(TAG, (raw: string, inner: string, offset: number) => {
    const f = fillOne(tagAt(raw, inner, 0), ctx);
    if (f.kind === "raw") return raw;
    if (f.kind === "none") return "";
    if (f.kind === "value") return escapeHtml(f.text);
    return ctx.tint && !insideMarkup(html, offset) ? `${TINT}${f.text}</span>` : f.text;
  });
}

// Text typed in a layout block, as HTML: the typed text and every filled value or fallback escaped.
export type BlockFill = (text: string, inAttribute?: boolean) => string;

export function blockFill(ctx: FillContext): BlockFill {
  return (text, inAttribute = false) =>
    parseTags(text)
      .map((s) => {
        if ("text" in s) return escapeHtml(s.text);
        const f = fillOne(s.tag, ctx);
        if (f.kind === "raw") return escapeHtml(s.tag.raw);
        if (f.kind === "none") return "";
        if (f.kind === "fallback" && ctx.tint && !inAttribute) return `${TINT}${escapeHtml(f.text)}</span>`;
        return escapeHtml(f.text);
      })
      .join("");
}
