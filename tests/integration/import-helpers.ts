// Uploading a file through the import's own entry points, as FileStep does: start, parts of 512 KiB, finish.
import { readFileSync } from "node:fs";
import type { ImportKind } from "@/server/imports/columns";
import { PART_BYTES } from "@/server/imports/csv";
import { finishUpload, startImport, uploadPart } from "@/server/imports/imports";

export const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/csv/${name}`));
export const utf8 = (text: string) => new TextEncoder().encode(text);

export async function upload(userId: number, kind: ImportKind, bytes: Uint8Array, fileName = "file.csv") {
  const started = await startImport(userId, kind, fileName, bytes.length);
  if ("error" in started) return { error: started.error };
  for (let index = 0, at = 0; at < bytes.length; index++, at += PART_BYTES) {
    const part = await uploadPart(userId, started.id, index, bytes.slice(at, at + PART_BYTES));
    if ("error" in part) return { error: part.error, id: started.id };
  }
  const done = await finishUpload(userId, started.id);
  return "error" in done ? { error: done.error, id: started.id } : { id: started.id };
}

export async function uploaded(userId: number, kind: ImportKind, bytes: Uint8Array, fileName = "file.csv"): Promise<number> {
  const r = await upload(userId, kind, bytes, fileName);
  if (!("id" in r) || "error" in r) throw new Error(`upload refused: ${JSON.stringify(r)}`);
  return r.id!;
}
