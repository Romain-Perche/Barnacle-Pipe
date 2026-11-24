// Supabase Storage through plain fetch (SF-116 contracts/storage.md § Operations, research.md §1): five calls, no
// library. Settings come from storageConfig() at call time; in fake mode the calls go in process to fakeStorage().
// A network error, a 10 s time-out, a 5xx or no file store set up → StorageUnreachable ("Files can't be reached").
// Every address returned is absolute and for one object; read addresses last 60 seconds (FR-010).
import { randomUUID } from "node:crypto";
import { storageConfig } from "@/server/env";
import { fakeStorage } from "@/server/files/fake-storage";

export class StorageUnreachable extends Error {
  constructor(cause?: unknown) {
    super("Storage can't be reached", { cause });
    this.name = "StorageUnreachable";
  }
}

export const READ_SECONDS = 60;
const TIMEOUT_MS = 10_000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
let testFetch: Fetch | null = null;

// Tests only: every Storage call goes to `fn` (tests/fakes/storage.ts). Throws outside APP_ENV=test.
export function useStorageFetchForTests(fn: Fetch | null): void {
  if (process.env.APP_ENV !== "test") throw new Error("useStorageFetchForTests is for tests only.");
  testFetch = fn;
}

// A fresh path for one upload: never derived from the file name.
export function newStoragePath(): string {
  return `files/${randomUUID()}`;
}

function settings() {
  const c = storageConfig();
  if (c.mode === "off") throw new StorageUnreachable();
  const f: Fetch = testFetch ?? (c.mode === "fake" ? fakeStorage().fetch : fetch);
  return { ...c, fetch: f };
}

// One server call with the key; errors that mean "not reachable" become StorageUnreachable.
async function call(route: string, init: { method: string; body?: string; headers?: Record<string, string> }) {
  const c = settings();
  let res: Response;
  try {
    res = await c.fetch(`${c.baseUrl}${route}`, {
      method: init.method,
      body: init.body,
      headers: {
        authorization: `Bearer ${c.key}`,
        apikey: c.key,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // fetch rejects with a TypeError on a network error and a DOMException on a time-out; anything else is a bug.
    if (e instanceof TypeError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))) throw new StorageUnreachable(e);
    throw e;
  }
  if (res.status >= 500) throw new StorageUnreachable(res.status);
  return { res, baseUrl: c.baseUrl };
}

const bucketOf = () => {
  const c = storageConfig();
  if (c.mode === "off") throw new StorageUnreachable();
  return c.bucket;
};

// A write-only address for one new object at `path` (no upsert: it never replaces an object).
export async function createSignedUploadUrl(path: string): Promise<{ url: string }> {
  const { res, baseUrl } = await call(`/object/upload/sign/${bucketOf()}/${path}`, { method: "POST" });
  if (res.status !== 200) throw new StorageUnreachable(res.status);
  const body = (await res.json()) as { url?: unknown };
  if (typeof body.url !== "string") throw new StorageUnreachable("no url");
  return { url: `${baseUrl}${body.url}` };
}

// The stored object's size and type, or null when there is none.
export async function objectInfo(path: string): Promise<{ size: number; contentType: string } | null> {
  const { res } = await call(`/object/info/authenticated/${bucketOf()}/${path}`, { method: "GET" });
  if (res.status === 400 || res.status === 404) return null;
  if (res.status !== 200) throw new StorageUnreachable(res.status);
  const body = (await res.json()) as { size?: unknown; content_type?: unknown };
  if (typeof body.size !== "number") return null;
  return { size: body.size, contentType: typeof body.content_type === "string" ? body.content_type : "" };
}

// The first `n` bytes of the object (reads no more than that, then cancels the stream).
export async function readHead(path: string, n: number): Promise<Uint8Array> {
  const { res } = await call(`/object/authenticated/${bucketOf()}/${path}`, { method: "GET", headers: { range: `bytes=0-${n - 1}` } });
  if (res.status !== 200 && res.status !== 206) return new Uint8Array();
  const out = new Uint8Array(n);
  let got = 0;
  const reader = res.body?.getReader();
  if (!reader) return out.subarray(0, 0);
  try {
    while (got < n) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, n - got);
      out.set(take, got);
      got += take.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out.subarray(0, got);
}

// A 60-second read address for one object; with `download`, Storage answers it as an attachment under that name.
export async function signedUrl(path: string, opts: { download?: string } = {}): Promise<string> {
  const { res, baseUrl } = await call(`/object/sign/${bucketOf()}/${path}`, { method: "POST", body: JSON.stringify({ expiresIn: READ_SECONDS }) });
  if (res.status !== 200) throw new StorageUnreachable(res.status);
  const body = (await res.json()) as { signedURL?: unknown };
  if (typeof body.signedURL !== "string") throw new StorageUnreachable("no signedURL");
  const download = opts.download === undefined ? "" : `&download=${encodeURIComponent(opts.download)}`;
  return `${baseUrl}${body.signedURL}${download}`;
}

// Removes the objects (100 per call). Any 200 counts as done for every path: absent objects are already gone.
export async function removeObjects(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const prefixes = paths.slice(i, i + 100);
    const { res } = await call(`/object/${bucketOf()}`, { method: "DELETE", body: JSON.stringify({ prefixes }) });
    if (res.status !== 200) throw new StorageUnreachable(res.status);
    await res.body?.cancel();
  }
}

// The PUT the browser makes to a signed upload address, made by the server: the fake data (src/seed/files.ts) and the
// Pipedrive import's file copy (SF-122, with a 20-second time-out for files up to 25 MB).
export async function putSigned(url: string, bytes: Uint8Array<ArrayBuffer>, contentType: string, o: { timeoutMs?: number } = {}): Promise<boolean> {
  const c = settings();
  try {
    const res = await c.fetch(url, { method: "PUT", headers: { "content-type": contentType }, body: bytes, signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS) });
    await res.body?.cancel();
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}
