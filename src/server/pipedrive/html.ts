// Pipedrive note HTML → the plain text of a CRM note (SF-122 research.md §6, FR-010). Pure, no dependency: the set of
// tags is known. Line breaks for <br> and the end of blocks, "- " for list items, a link's text plus its address when
// they differ (http, https and mailto only), every other tag removed (script and style with their contents), entities
// decoded once at the end so that escaped markup stays text, three or more line breaks made two, trimmed. A Pipedrive
// mention is markup around "@Name", so it becomes "@Name" (no note_mentions row is ever written: nobody is notified).

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMED[code.toLowerCase()] ?? all;
  });
}

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
};

export function htmlToText(html: string): string {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Source line breaks mean nothing in HTML; blocks and <br> make the text's lines.
  s = s.replace(/\n/g, " ");
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_all, attrs: string, inner: string) => {
    const label = inner.replace(/<[^>]*>/g, "");
    const href = decode(attr(attrs, "href")).trim();
    const keep = /^(https?:|mailto:)/i.test(href);
    return keep && decode(label).trim() !== href ? `${label} (${href.replace(/</g, "&lt;")})` : label;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "- ");
  s = s.replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, "\n");
  s = s.replace(/<[^>]*>/g, "");
  s = decode(s);
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
