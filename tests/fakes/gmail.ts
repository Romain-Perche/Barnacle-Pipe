// Fake of Google Mail for the tests (SF-118 contracts/google.md § Fake › Checks): the app's own FakeGoogleMail over a
// MemoryStore, installed as the Gmail code's fetch (useGmailFetchForTests), with
// - every Gmail request checked against Gmail's discovery file (.factory/schemas/gmail-api.json, pinned in
//   scripts/fetch-schemas.mjs): path and method among `resources.users` methods, each query parameter declared for that
//   method, each JSON body property declared in the method's request schema (WatchRequest, Message);
// - every Gmail answer's properties declared in its response schema (Profile, WatchResponse, ListHistoryResponse →
//   History → HistoryMessageAdded → Message, ListMessagesResponse, Message → MessagePart → MessagePartHeader /
//   MessagePartBody, Thread), with the declared JSON types (int64/uint64 as strings);
// - every push body it delivers checked against PubsubMessage in .factory/schemas/pubsub-api.json, `data` base64.
// The token, revoke and certs endpoints have no public schema (plan.md § Outside services): the fake copies RFC 6749,
// 7009 and 7517, checked by tests/unit/gmail-fake-oauth.test.ts. A request or answer the schemas refuse throws, and is
// also kept in `violations`, which fails the test in afterEach even when the app code swallowed the error.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import { gmailConfig } from "@/server/env";
import { FakeGoogleMail, MemoryStore, type PushNotice } from "@/server/gmail/fake-gmail";
import { useGmailFetchForTests } from "@/server/gmail/google-api";
import { receiveGmailPush } from "@/server/gmail/push";

export const GMAIL_SCHEMA_PATH = path.join(process.cwd(), ".factory/schemas/gmail-api.json");
export const PUBSUB_SCHEMA_PATH = path.join(process.cwd(), ".factory/schemas/pubsub-api.json");
// A test key for GMAIL_TOKEN_KEY (32 bytes, base64): set by the Gmail tests, never used outside them.
export const TEST_GMAIL_KEY = Buffer.alloc(32, 0x5a).toString("base64");

type Prop = { type?: string; format?: string; $ref?: string; items?: Prop; additionalProperties?: Prop; properties?: Record<string, Prop> };
type Schema = { id: string; type: string; properties: Record<string, Prop> };
type Method = { httpMethod: string; path: string; parameters?: Record<string, { location: string }>; request?: { $ref: string }; response?: { $ref: string } };
type Resource = { methods?: Record<string, Method>; resources?: Record<string, Resource> };
type Discovery = { rootUrl: string; servicePath: string; schemas: Record<string, Schema>; resources: Record<string, Resource> };

function load(file: string): Discovery {
  if (!existsSync(file)) throw new Error(`${file} is missing: run "npm run test:schemas" to download it.`);
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") throw new Error(`${file} is empty`);
  return JSON.parse(text) as Discovery;
}

export const gmailSchema = load(GMAIL_SCHEMA_PATH);
export const pubsubSchema = load(PUBSUB_SCHEMA_PATH);

const methods: (Method & { name: string; re: RegExp; pathParams: string[] })[] = [];
(function walk(r: Resource, prefix: string) {
  for (const [name, m] of Object.entries(r.methods ?? {})) {
    const pathParams = [...m.path.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]);
    const re = new RegExp(`^/${m.path.replace(/\{[^}]+\}/g, "([^/]+)")}$`);
    methods.push({ ...m, name: `${prefix}${name}`, re, pathParams });
  }
  for (const [name, child] of Object.entries(r.resources ?? {})) walk(child, `${prefix}${name}.`);
})(gmailSchema.resources.users, "users.");

function methodOf(httpMethod: string, pathname: string) {
  const found = methods.find((m) => m.httpMethod === httpMethod && m.re.test(pathname));
  if (!found) throw new Error(`gmail-api.json has no ${httpMethod} ${pathname}`);
  return found;
}

function checkValue(where: string, value: unknown, p: Prop, schemas: Record<string, Schema>, file: string) {
  if (p.$ref) return checkObject(where, value, schemas[p.$ref], schemas, file);
  switch (p.type) {
    case "string":
      if (typeof value !== "string") throw new Error(`${where} must be a string (${p.format ?? "string"}) in ${file}`);
      if ((p.format === "int64" || p.format === "uint64") && !/^-?\d+$/.test(value)) throw new Error(`${where} must be an ${p.format} string`);
      if (p.format === "byte" && !/^[A-Za-z0-9+/_-]*={0,2}$/.test(value)) throw new Error(`${where} must be base64`);
      return;
    case "integer":
      if (!Number.isInteger(value)) throw new Error(`${where} must be an integer in ${file}`);
      return;
    case "number":
      if (typeof value !== "number") throw new Error(`${where} must be a number in ${file}`);
      return;
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${where} must be a boolean in ${file}`);
      return;
    case "array":
      if (!Array.isArray(value)) throw new Error(`${where} must be an array in ${file}`);
      value.forEach((v, i) => checkValue(`${where}[${i}]`, v, p.items ?? {}, schemas, file));
      return;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} must be an object in ${file}`);
      if (p.additionalProperties) for (const [k, v] of Object.entries(value)) checkValue(`${where}.${k}`, v, p.additionalProperties, schemas, file);
      return;
  }
}

function checkObject(where: string, value: unknown, s: Schema, schemas: Record<string, Schema>, file: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} must be a ${s.id} object`);
  for (const [k, v] of Object.entries(value)) {
    const p = s.properties[k];
    if (!p) throw new Error(`${where} has no property "${k}" in ${s.id} (${file})`);
    checkValue(`${where}.${k}`, v, p, schemas, file);
  }
}

// A Pub/Sub push body: { message: PubsubMessage, subscription }, `data` base64.
export function checkPushBody(body: unknown) {
  if (typeof body !== "object" || body === null) throw new Error("push body must be an object");
  for (const k of Object.keys(body)) if (k !== "message" && k !== "subscription") throw new Error(`push body has no "${k}"`);
  const b = body as { message?: unknown; subscription?: unknown };
  if (typeof b.subscription !== "string") throw new Error("push body.subscription must be a string");
  checkObject("push body.message", b.message, pubsubSchema.schemas.PubsubMessage, pubsubSchema.schemas, "pubsub-api.json");
  if (typeof (b.message as { data?: unknown }).data !== "string") throw new Error("push body.message.data is required");
}

export type Tamper = (body: Record<string, unknown>) => Record<string, unknown>;

export class GmailFake extends FakeGoogleMail {
  readonly violations: string[] = [];
  private tamperNext: Tamper | null = null;
  readonly checkedFetch: (input: string, init: RequestInit) => Promise<Response>;

  constructor() {
    const c = gmailConfig();
    if (c.mode !== "fake") throw new Error("GmailFake needs APP_ENV=test, GMAIL_TOKEN_KEY and no GMAIL_PUBSUB_TOPIC");
    super({ store: new MemoryStore(), clientId: c.clientId, clientSecret: c.clientSecret, audience: c.pushAudience, serviceAccount: c.pushServiceAccount, subscription: c.pushSubscription });
    this.checkedFetch = async (input, init) => {
      try {
        return await this.check(new Request(input, init));
      } catch (e) {
        if (e instanceof Error && !(e instanceof TypeError)) this.violations.push(e.message);
        throw e;
      }
    };
  }

  // The next Gmail answer's JSON is changed by `fn` before it is checked (to show what the schema refuses).
  tamper(fn: Tamper) {
    this.tamperNext = fn;
  }

  private async check(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.origin !== "https://gmail.googleapis.com") {
      if (!["https://oauth2.googleapis.com", "https://www.googleapis.com"].includes(url.origin)) throw new Error(`no Google call to ${url.origin}`);
      return this.fetch(req);
    }
    const m = methodOf(req.method, url.pathname);
    for (const name of url.searchParams.keys()) {
      const p = m.parameters?.[name];
      if (!p || p.location !== "query") throw new Error(`${m.name} has no query parameter "${name}" in gmail-api.json`);
    }
    const text = req.method === "POST" ? await req.clone().text() : "";
    if (text) {
      if (!m.request) throw new Error(`${m.name} takes no body in gmail-api.json`);
      checkObject(`${m.name} body`, JSON.parse(text), gmailSchema.schemas[m.request.$ref], gmailSchema.schemas, "gmail-api.json");
    }
    const res = await this.fetch(req);
    if (!res.ok || !m.response) return res;
    let body = (await res.json()) as Record<string, unknown>;
    if (this.tamperNext) {
      body = this.tamperNext(body);
      this.tamperNext = null;
    }
    checkObject(`${m.name} answer`, body, gmailSchema.schemas[m.response.$ref], gmailSchema.schemas, "gmail-api.json");
    return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
  }

  // Pub/Sub delivers the notice Gmail sends for this user now (checked against PubsubMessage) to the push handler.
  // Null when Gmail would send none (no active watch).
  async deliver(email: string, change?: (n: PushNotice) => PushNotice): Promise<number | null> {
    let n = this.notice(email);
    if (!n) return null;
    if (change) n = change(n);
    checkPushBody(n.body);
    return (await receiveGmailPush(n.authorization, n.body)).status;
  }

  // A notice Pub/Sub never delivers.
  dropNotice(email: string): void {
    this.notice(email);
  }
}

let current: GmailFake | null = null;

// A fresh GmailFake, installed for the current test (and uninstalled after it). Sets a test GMAIL_TOKEN_KEY when none.
export function installGmailFake(): GmailFake {
  if (!process.env.GMAIL_TOKEN_KEY) process.env.GMAIL_TOKEN_KEY = TEST_GMAIL_KEY;
  current = new GmailFake();
  useGmailFetchForTests(current.checkedFetch);
  return current;
}

afterEach(() => {
  const fake = current;
  current = null;
  if (!fake) return;
  useGmailFetchForTests(null);
  const v = fake.violations.splice(0);
  if (v.length) throw new Error(`The fake Gmail saw calls its schemas refuse:\n${v.join("\n")}`);
});
