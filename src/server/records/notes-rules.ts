// Pure rules of notes and mentions (SF-102 data-model.md § Validation, research.md §3, §7).
// A stored note keeps each mention as a token "@[user:<id>]"; it is shown as "@<current name>" only for the users the
// note has a mention row for (the `names` map), so a token typed by hand stays plain text.

export const NOTE_MAX = 10_000;
const PREVIEW_MAX = 200;
const TOKEN = /@\[user:(\d{1,18})\]/g;

export type NoteSegment = { text: string } | { mention: string };

export function validateNoteText(raw: string): { ok: true; text: string } | { ok: false; code: "note_required" | "note_too_long" } {
  const text = raw.trim();
  if (text === "") return { ok: false, code: "note_required" };
  if (text.length > NOTE_MAX) return { ok: false, code: "note_too_long" };
  return { ok: true, text };
}

// Replaces "@<name>" of each chosen user with its token, longest names first ("@Bob Fakeson" before "@Bob Fake").
// Only the ids actually found in the text are returned.
export function tokenizeMentions(text: string, users: { id: number; name: string }[]): { body: string; ids: number[] } {
  const ordered = [...users].filter((u) => u.name !== "").sort((a, b) => b.name.length - a.name.length);
  let body = text;
  const ids: number[] = [];
  for (const u of ordered) {
    const needle = `@${u.name}`;
    if (!body.includes(needle)) continue;
    body = body.split(needle).join(`@[user:${u.id}]`);
    if (!ids.includes(u.id)) ids.push(u.id);
  }
  return { body, ids: [...ids].sort((a, b) => users.findIndex((u) => u.id === a) - users.findIndex((u) => u.id === b)) };
}

export function noteSegments(body: string, names: Map<number, string>): NoteSegment[] {
  const segments: NoteSegment[] = [];
  let text = "";
  let at = 0;
  for (const m of body.matchAll(TOKEN)) {
    const name = names.get(Number(m[1]));
    if (name === undefined) continue;
    text += body.slice(at, m.index);
    if (text) segments.push({ text });
    text = "";
    segments.push({ mention: name });
    at = m.index + m[0].length;
  }
  text += body.slice(at);
  if (text) segments.push({ text });
  return segments;
}

// The visible text: tokens back to "@<current name>" (the edit box, the notification preview).
export function detokenize(body: string, names: Map<number, string>): string {
  return noteSegments(body, names)
    .map((s) => ("mention" in s ? `@${s.mention}` : s.text))
    .join("");
}

// The first 200 characters of the visible text, "…" when cut; counted by code point so no surrogate pair is cut.
export function notificationPreview(body: string, names: Map<number, string>): string {
  const chars = Array.from(detokenize(body, names));
  return chars.length > PREVIEW_MAX ? `${chars.slice(0, PREVIEW_MAX).join("")}…` : chars.join("");
}

// `?timeline=` / `?shown=`: how many entries to show, a multiple of 50 from 50 to 5,000; anything else 50.
export function parseShown(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !/^\d{1,4}$/.test(v)) return 50;
  const n = Number(v);
  return n >= 50 && n <= 5000 && n % 50 === 0 ? n : 50;
}
