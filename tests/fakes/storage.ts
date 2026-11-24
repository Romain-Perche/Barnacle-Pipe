// Fake of Supabase Storage for the tests (SF-116 contracts/storage.md): the app's own FakeStorage over a MemoryStore,
// installed as the storage module's fetch, with every request and response checked against Supabase's OpenAPI file
// (.factory/schemas/storage_v0_openapi.json, pinned in scripts/fetch-schemas.mjs): the path must be one of the
// schema's paths with that method, each query parameter declared, each JSON body property declared with its type and
// the required ones present, and each property of a 200 JSON answer declared in the schema's 200 answer.
// A request or answer the schema does not allow throws (the test fails; never a skip).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { storageConfig } from "@/server/env";
import { FakeStorage, MemoryStore } from "@/server/files/fake-storage";
import { useStorageFetchForTests } from "@/server/files/storage";

export const STORAGE_SCHEMA_PATH = path.join(process.cwd(), ".factory/schemas/storage_v0_openapi.json");

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; anyOf?: Schema[] };
type Op = {
  parameters?: { name: string; in: string }[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};
type OpenApi = { paths: Record<string, Record<string, Op>> };

export function loadStorageSchema(): OpenApi {
  if (!existsSync(STORAGE_SCHEMA_PATH)) throw new Error(`${STORAGE_SCHEMA_PATH} is missing: run "npm run test:schemas" to download it.`);
  const text = readFileSync(STORAGE_SCHEMA_PATH, "utf8");
  if (text.trim() === "") throw new Error(`${STORAGE_SCHEMA_PATH} is empty`);
  return JSON.parse(text) as OpenApi;
}

const schema = loadStorageSchema();
const routes = Object.entries(schema.paths).map(([p, ops]) => ({
  path: p,
  ops,
  re: new RegExp(`^${p.replace(/\{\*\}/g, "(.+)").replace(/\{[^}]+\}/g, "([^/]+)")}$`),
  literal: p.replace(/\{[^}]+\}/g, "").length,
}));

// The schema operation of a request: the most specific path (most literal characters) that has the method.
function operation(method: string, route: string): Op {
  const found = routes
    .filter((r) => r.re.test(route) && r.ops[method.toLowerCase()])
    .sort((a, b) => b.literal - a.literal)[0];
  if (!found) throw new Error(`Storage schema has no ${method} ${route}`);
  return found.ops[method.toLowerCase()];
}

function typeOk(value: unknown, s: Schema): boolean {
  if (s.anyOf) return s.anyOf.some((x) => typeOk(value, x));
  switch (s.type) {
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value) && (!s.items || value.every((v) => typeOk(v, s.items!)));
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function checkObject(where: string, value: unknown, s: Schema) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} must be an object`);
  const props = s.properties ?? {};
  for (const [k, v] of Object.entries(value)) {
    const p = props[k];
    if (!p) throw new Error(`${where} has no property "${k}" in storage_v0_openapi.json`);
    if (!typeOk(v, p)) throw new Error(`${where}.${k} must be ${p.type ?? "anyOf"}`);
  }
  for (const k of s.required ?? []) if (!(k in value)) throw new Error(`${where} needs "${k}"`);
}

export type StorageRequest = { method: string; route: string; query: Record<string, string>; body: unknown };

export class StorageFake {
  readonly store = new MemoryStore();
  readonly requests: StorageRequest[] = [];
  readonly baseUrl: string;
  readonly bucket: string;
  readonly storage: FakeStorage;
  private isDown = false;
  private deletesFail = false;
  private clock: number | null = null;

  constructor() {
    const c = storageConfig();
    if (c.mode !== "fake") throw new Error("StorageFake needs APP_ENV=test and no SUPABASE_URL");
    this.baseUrl = c.baseUrl;
    this.bucket = c.bucket;
    this.storage = new FakeStorage({ store: this.store, baseUrl: c.baseUrl, key: c.key, now: () => this.clock ?? Date.now() });
    this.fetch = this.fetch.bind(this);
  }

  install(): this {
    useStorageFetchForTests(this.fetch);
    return this;
  }

  uninstall() {
    useStorageFetchForTests(null);
  }

  // Every call rejects as a network error / is back.
  down(on = true) {
    this.isDown = on;
  }

  // Storage answers 500 to deletes.
  failDeletes(on = true) {
    this.deletesFail = on;
  }

  // Moves the fake's clock (token expiry) `ms` ahead of real time.
  advance(ms: number) {
    this.clock = Date.now() + ms;
  }

  objects(): Map<string, Uint8Array> {
    return new Map(this.store.keys().map((k) => [k, this.store.get(k)!.bytes]));
  }

  // An object put straight in the store (as if uploaded), at `<bucket>/<path>`.
  put(path: string, bytes: Uint8Array, contentType = "application/octet-stream") {
    this.store.put(`${this.bucket}/${path}`, { bytes, contentType, createdAt: new Date() });
  }

  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (this.isDown) throw new TypeError("fetch failed");
    const req = new Request(input, init);
    const url = new URL(req.url);
    const prefix = new URL(this.baseUrl).pathname;
    if (!url.pathname.startsWith(`${prefix}/`)) throw new Error(`not a Storage address: ${req.url}`);
    const route = url.pathname.slice(prefix.length);
    const op = operation(req.method, route);
    const declared = new Set((op.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name));
    for (const name of url.searchParams.keys()) {
      if (!declared.has(name)) throw new Error(`${req.method} ${route}: query parameter "${name}" is not in the schema`);
    }
    let body: unknown = undefined;
    const isJson = (req.headers.get("content-type") ?? "").startsWith("application/json");
    const bodySchema = op.requestBody?.content["application/json"]?.schema;
    if (bodySchema) {
      if (!isJson) throw new Error(`${req.method} ${route} needs a JSON body`);
      body = await req.clone().json();
      checkObject(`${req.method} ${route} body`, body, bodySchema);
    } else if (req.method !== "PUT" && req.body !== null && (await req.clone().arrayBuffer()).byteLength > 0) {
      throw new Error(`${req.method} ${route} takes no body in the schema`);
    }
    this.requests.push({ method: req.method, route, query: Object.fromEntries(url.searchParams), body });
    if (this.deletesFail && req.method === "DELETE") return new Response("{}", { status: 500 });
    const res = await this.storage.fetch(req);
    const resSchema = op.responses["200"]?.content?.["application/json"]?.schema;
    if (res.status === 200 && resSchema && (res.headers.get("content-type") ?? "").startsWith("application/json")) {
      const answer = await res.clone().json();
      if (resSchema.type === "array") {
        if (!Array.isArray(answer)) throw new Error(`${req.method} ${route} answer must be an array`);
        for (const item of answer) checkObject(`${req.method} ${route} answer item`, item, resSchema.items ?? {});
      } else {
        checkObject(`${req.method} ${route} answer`, answer, resSchema);
      }
    }
    return res;
  }
}
