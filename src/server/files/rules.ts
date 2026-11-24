// Pure rules of files (SF-116 research.md §4, §9): limits, the kind of a stored file, its Kind label and a name
// that is safe to save under. No database, no network.

export const MAX_FILE_BYTES = 26_214_400; // 25 × 1,024 × 1,024
export const MAX_FILE_NAME = 255; // Unicode code points, as Postgres's char_length

export type FileKind = "jpeg" | "png" | "gif" | "webp" | "pdf" | "other";
export type FileRefusal = "file_name_too_long" | "file_empty" | "file_too_large";

const codePoints = (s: string) => [...s].length;

export function validateFile(f: { name: string; size: number }): { ok: true } | { ok: false; code: FileRefusal } {
  const n = codePoints(f.name);
  if (n === 0 || n > MAX_FILE_NAME) return { ok: false, code: "file_name_too_long" };
  if (!Number.isSafeInteger(f.size) || f.size <= 0) return { ok: false, code: "file_empty" };
  if (f.size > MAX_FILE_BYTES) return { ok: false, code: "file_too_large" };
  return { ok: true };
}

// The previewable kinds: their extensions and the one type Storage must have kept for them.
const KINDS: { kind: Exclude<FileKind, "other">; exts: string[]; type: string; magic: (h: Uint8Array) => boolean }[] = [
  { kind: "jpeg", exts: ["jpg", "jpeg"], type: "image/jpeg", magic: (h) => starts(h, [0xff, 0xd8, 0xff]) },
  { kind: "png", exts: ["png"], type: "image/png", magic: (h) => starts(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { kind: "gif", exts: ["gif"], type: "image/gif", magic: (h) => starts(h, ascii("GIF87a")) || starts(h, ascii("GIF89a")) },
  { kind: "webp", exts: ["webp"], type: "image/webp", magic: (h) => starts(h, ascii("RIFF")) && starts(h.subarray(8), ascii("WEBP")) },
  { kind: "pdf", exts: ["pdf"], type: "application/pdf", magic: (h) => starts(h, ascii("%PDF-")) },
];

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function starts(h: Uint8Array, prefix: number[]): boolean {
  return h.length >= prefix.length && prefix.every((b, i) => h[i] === b);
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1);
}

// The Content-Type the browser is told to send: one of the five previewable types by extension, else octet-stream.
export function uploadContentType(name: string): string {
  const ext = extension(name).toLowerCase();
  return KINDS.find((k) => k.exts.includes(ext))?.type ?? "application/octet-stream";
}

// A previewable kind only when the first bytes, the name's extension and the type Storage kept all agree.
export function fileKind(f: { head: Uint8Array; name: string; storedType: string }): FileKind {
  const ext = extension(f.name).toLowerCase();
  const type = f.storedType.split(";")[0].trim().toLowerCase();
  const k = KINDS.find((x) => x.exts.includes(ext));
  return k && k.type === type && k.magic(f.head) ? k.kind : "other";
}

export function isPreviewable(kind: FileKind): boolean {
  return kind !== "other";
}

export function isImage(kind: FileKind): boolean {
  return kind === "jpeg" || kind === "png" || kind === "gif" || kind === "webp";
}

// The Kind column: JPG/PNG/GIF/WEBP/PDF, else the extension in capitals when it is 1–5 letters or digits, else FILE.
export function kindLabel(name: string, kind: FileKind): string {
  if (kind === "jpeg") return "JPG";
  if (kind !== "other") return kind.toUpperCase();
  const ext = extension(name);
  return /^[\p{L}\p{N}]{1,5}$/u.test(ext) ? ext.toUpperCase() : "FILE";
}

// A name the browser can save under: no path separators, reserved or control characters; no dots or spaces at the
// ends (so never "..", never a hidden file); "file" when nothing is left.
export function safeDownloadName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f\u007f-\u009f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "");
  return cleaned === "" ? "file" : cleaned;
}

// The first 40 characters and "…" (the "name over 255 characters" message).
export function shortName(name: string): string {
  const chars = [...name];
  return chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : name;
}

// Where a file's name links (contracts/routes.md § Record pages): an image opens the preview box on `page` (file=<id>,
// keeping its other parameters), a PDF opens in a new tab, anything else downloads.
export function fileHref(file: { id: number; kind: FileKind }, page: string): { href: string; newTab: boolean } {
  if (isImage(file.kind)) {
    const hash = page.indexOf("#");
    const base = hash === -1 ? page : page.slice(0, hash);
    return { href: `${base}${base.includes("?") ? "&" : "?"}file=${file.id}`, newTab: false };
  }
  if (file.kind === "pdf") return { href: `/files/${file.id}/preview`, newTab: true };
  return { href: `/files/${file.id}/download`, newTab: false };
}
