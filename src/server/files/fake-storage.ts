// The fake Supabase Storage (SF-116 contracts/storage.md § The fake, research.md §5): the five server calls the app
// makes, plus the two the browser makes with a signed address, over a byte store. Used only when isFakeAllowed() and
// SUPABASE_URL is empty: the server calls it in process; the browser reaches it through /dev/fake-storage/...
// (src/app/dev/fake-storage/[...path]/route.ts). Tests wrap it in tests/fakes/storage.ts, which checks every request
// against Supabase's OpenAPI file. Like Storage: a signed token is for one path only and expires, an upload never
// replaces an object (409), a body over 25 MB is refused (413), `download` makes the answer an attachment.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { isFakeAllowed, storageConfig } from "@/server/env";
import { MAX_FILE_BYTES } from "@/server/files/rules";

export type StoredObject = { bytes: Uint8Array; contentType: string; createdAt: Date };

export interface ObjectStore {
  get(key: string): StoredObject | null;
  put(key: string, obj: StoredObject): void;
  delete(key: string): boolean;
  keys(): string[];
}

export class MemoryStore implements ObjectStore {
  private map = new Map<string, StoredObject>();
  get(key: string) {
    return this.map.get(key) ?? null;
  }
  put(key: string, obj: StoredObject) {
    this.map.set(key, obj);
  }
  delete(key: string) {
    return this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()];
  }
}

// One file per object (its key URI-encoded) plus `<file>.json` with its content type and date. Development only.
export class DiskStore implements ObjectStore {
  constructor(private dir = ".fake-storage") {}
  private file(key: string) {
    return path.join(this.dir, encodeURIComponent(key));
  }
  get(key: string) {
    const f = this.file(key);
    if (!existsSync(f) || !existsSync(`${f}.json`)) return null;
    const meta = JSON.parse(readFileSync(`${f}.json`, "utf8")) as { contentType: string; createdAt: string };
    return { bytes: new Uint8Array(readFileSync(f)), contentType: meta.contentType, createdAt: new Date(meta.createdAt) };
  }
  put(key: string, obj: StoredObject) {
    mkdirSync(this.dir, { recursive: true });
    const f = this.file(key);
    writeFileSync(f, obj.bytes);
    writeFileSync(`${f}.json`, JSON.stringify({ contentType: obj.contentType, createdAt: obj.createdAt.toISOString() }));
  }
  delete(key: string) {
    const f = this.file(key);
    if (!existsSync(f)) return false;
    rmSync(f, { force: true });
    rmSync(`${f}.json`, { force: true });
    return true;
  }
  keys() {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => !f.endsWith(".json")).map((f) => decodeURIComponent(f));
  }
}

const UPLOAD_SECONDS = 2 * 60 * 60;

type Claims = { url: string; exp: number; use: "upload" | "read"; upsert: false };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const storageError = (status: number, statusCode: string, error: string, message: string) => json(status, { statusCode, error, message });

// "attachment; filename="<ascii>"; filename*=UTF-8''<encoded>" (RFC 6266).
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export class FakeStorage {
  private readonly store: ObjectStore;
  private readonly base: URL;
  private readonly key: string;
  private readonly now: () => number;
  private readonly secret = randomBytes(32);

  constructor(opts: { store: ObjectStore; baseUrl: string; key: string; now?: () => number }) {
    this.store = opts.store;
    this.base = new URL(opts.baseUrl);
    this.key = opts.key;
    this.now = opts.now ?? Date.now;
    this.fetch = this.fetch.bind(this);
  }

  private sign(claims: Claims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const mac = createHmac("sha256", this.secret).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  private verify(token: string | null, url: string, use: Claims["use"]): boolean {
    if (!token) return false;
    const [body, mac] = token.split(".");
    if (!body || !mac) return false;
    const want = createHmac("sha256", this.secret).update(body).digest();
    const got = Buffer.from(mac, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
    try {
      const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
      return claims.url === url && claims.use === use && claims.exp * 1000 > this.now();
    } catch {
      return false;
    }
  }

  private authorised(req: Request): boolean {
    return req.headers.get("authorization") === `Bearer ${this.key}` && req.headers.get("apikey") === this.key;
  }

  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const req = input instanceof Request && init === undefined ? input : new Request(input, init);
    const url = new URL(req.url);
    const prefix = this.base.pathname.replace(/\/+$/, "");
    if (!url.pathname.startsWith(`${prefix}/`)) return storageError(400, "404", "not_found", "Route not found");
    const route = url.pathname.slice(prefix.length);
    const method = req.method.toUpperCase();
    const m = (re: RegExp) => route.match(re);

    // The two calls the browser makes with a signed address: no key, a token for one path.
    let r = m(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/);
    if (r && method === "PUT") return this.upload(req, `${r[1]}/${r[2]}`, url.searchParams.get("token"));
    r = m(/^\/object\/sign\/([^/]+)\/(.+)$/);
    if (r && method === "GET") return this.signedGet(`${r[1]}/${r[2]}`, url.searchParams);

    if (!this.authorised(req)) return storageError(400, "403", "Unauthorized", "Invalid key");

    if (r && method === "POST") {
      const body = (await req.json().catch(() => null)) as { expiresIn?: unknown } | null;
      const exp = body?.expiresIn;
      if (typeof exp !== "number" || !Number.isInteger(exp) || exp < 1) return storageError(400, "400", "InvalidRequest", "expiresIn is required");
      const key = `${r[1]}/${r[2]}`;
      if (!this.store.get(key)) return storageError(400, "404", "not_found", "Object not found");
      const token = this.sign({ url: key, exp: Math.floor(this.now() / 1000) + exp, use: "read", upsert: false });
      return json(200, { signedURL: `/object/sign/${key}?token=${token}` });
    }
    r = m(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/);
    if (r && method === "POST") {
      const key = `${r[1]}/${r[2]}`;
      if (this.store.get(key)) return storageError(400, "409", "Duplicate", "The resource already exists");
      const token = this.sign({ url: key, exp: Math.floor(this.now() / 1000) + UPLOAD_SECONDS, use: "upload", upsert: false });
      return json(200, { url: `/object/upload/sign/${key}?token=${token}`, token });
    }
    r = m(/^\/object\/info\/authenticated\/([^/]+)\/(.+)$/);
    if (r && method === "GET") {
      const obj = this.store.get(`${r[1]}/${r[2]}`);
      if (!obj) return storageError(404, "404", "not_found", "Object not found");
      return json(200, {
        id: `${r[1]}/${r[2]}`, name: r[2], bucket_id: r[1], version: "1", size: obj.bytes.length, content_type: obj.contentType,
        cache_control: "no-cache", etag: `"${obj.bytes.length}"`, metadata: {}, last_modified: obj.createdAt.toISOString(),
        created_at: obj.createdAt.toISOString(),
      });
    }
    r = m(/^\/object\/authenticated\/([^/]+)\/(.+)$/);
    if (r && method === "GET") {
      const obj = this.store.get(`${r[1]}/${r[2]}`);
      if (!obj) return storageError(400, "404", "not_found", "Object not found");
      const range = req.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] === "" ? obj.bytes.length - 1 : Number(range[2]), obj.bytes.length - 1);
        return new Response(obj.bytes.slice(start, end + 1), {
          status: 206,
          headers: { "content-type": obj.contentType, "content-range": `bytes ${start}-${end}/${obj.bytes.length}` },
        });
      }
      return new Response(obj.bytes.slice(), { status: 200, headers: { "content-type": obj.contentType } });
    }
    r = m(/^\/object\/([^/]+)$/);
    if (r && method === "DELETE") {
      const body = (await req.json().catch(() => null)) as { prefixes?: unknown } | null;
      const prefixes = body?.prefixes;
      if (!Array.isArray(prefixes) || prefixes.length === 0 || !prefixes.every((p) => typeof p === "string")) {
        return storageError(400, "400", "InvalidRequest", "prefixes is required");
      }
      const removed = (prefixes as string[]).filter((p) => this.store.delete(`${r![1]}/${p}`));
      return json(200, removed.map((name) => ({ name, bucket_id: r![1] })));
    }
    return storageError(400, "404", "not_found", "Route not found");
  }

  private async upload(req: Request, key: string, token: string | null): Promise<Response> {
    if (!this.verify(token, key, "upload")) return storageError(400, "400", "InvalidJWT", "invalid signature");
    if (this.store.get(key)) return storageError(409, "409", "Duplicate", "The resource already exists");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) return storageError(413, "413", "Payload too large", "The object exceeded the maximum allowed size");
    this.store.put(key, { bytes, contentType: req.headers.get("content-type") || "application/octet-stream", createdAt: new Date(this.now()) });
    return json(200, { Key: key });
  }

  private signedGet(key: string, params: URLSearchParams): Response {
    if (!this.verify(params.get("token"), key, "read")) return storageError(400, "400", "InvalidJWT", "jwt expired");
    const obj = this.store.get(key);
    if (!obj) return storageError(400, "404", "not_found", "Object not found");
    const headers: Record<string, string> = { "content-type": obj.contentType, "cache-control": "no-cache" };
    const download = params.get("download");
    if (download !== null) headers["content-disposition"] = attachment(download || key.split("/").pop()!);
    return new Response(obj.bytes.slice(), { status: 200, headers });
  }
}

const g = globalThis as unknown as { __crmFakeStorage?: FakeStorage };

// The one fake of this process: memory in tests, `.fake-storage/` in development. Never outside development/test.
export function fakeStorage(): FakeStorage {
  if (!isFakeAllowed()) throw new Error("The fake storage only runs with APP_ENV development or test.");
  if (!g.__crmFakeStorage) {
    const config = storageConfig();
    const baseUrl = config.mode === "off" ? "http://localhost:3000/dev/fake-storage" : config.baseUrl;
    const store = process.env.APP_ENV === "test" ? new MemoryStore() : new DiskStore();
    g.__crmFakeStorage = new FakeStorage({ store, baseUrl, key: "fake-storage-key" });
  }
  return g.__crmFakeStorage;
}
