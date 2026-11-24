// SF-116: files for the integration tests, through the real upload path (start → PUT to the fake Storage → finish),
// and small generated contents of each kind.
import { finishFileUpload, startFileUpload, type FileTarget } from "@/server/files/files";
import type { StorageFake } from "../fakes/storage";

const enc = (s: string) => new TextEncoder().encode(s);

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
export const GIF = enc("GIF89a\u0001\u0000\u0001\u0000fake");
export const PDF = enc("%PDF-1.4\n% fake one-page pdf\n%%EOF\n");
export const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
export const TEXT = enc("Just some notes, not an image.");

// `size` bytes starting with `head`, the rest a repeating pattern.
export function sized(head: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + 7) % 251;
  out.set(head.subarray(0, Math.min(head.length, size)));
  return out;
}

// start → PUT the bytes to the signed address → finish; returns the file id.
export async function uploadFile(
  fake: StorageFake, actorId: number, target: FileTarget, name: string, bytes: Uint8Array<ArrayBuffer>, contentType?: string,
): Promise<number> {
  const start = await startFileUpload(actorId, target, { name, size: bytes.length });
  if (start.status !== "ok") throw new Error(`start: ${start.status}`);
  const put = await fake.fetch(start.url, { method: "PUT", headers: { "content-type": contentType ?? start.contentType }, body: bytes });
  if (put.status !== 200) throw new Error(`PUT: ${put.status}`);
  const finish = await finishFileUpload(actorId, start.uploadId);
  if (finish.status !== "ok") throw new Error(`finish: ${finish.status}`);
  return finish.id;
}
