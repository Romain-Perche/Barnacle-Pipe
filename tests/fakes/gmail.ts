// Fake of Google Mail for the tests (SF-118 contracts/google.md § Fake › Checks): the app's own FakeGoogleMail over a
// MemoryStore, installed as the Gmail code's fetch (useGmailFetchForTests), with
// - every Gmail request checked against Gmail's discovery file (.factory/schemas/gmail-api.json, pinned in
//   scripts/fetch-schemas.mjs): path and method among `resources.users` methods, each query parameter declared for that
//   method, each JSON body property declared in the method's request schema (WatchRequest, Message);
// - every Gmail answer's properties declared in its response schema (Profile, WatchResponse, ListHistoryResponse →
//   History → HistoryMessageAdded → Message, ListMessagesResponse, Message → MessagePart → MessagePartHeader /
//   MessagePartBody, Thread), with the declared JSON types (int64/uint64 as strings);
// - every push body it delivers checked against PubsubMessage in .factory/schemas/pubsub-api.json, `data` base64.
// - SF-124: every Google Calendar request and answer checked against Calendar's discovery file
//   (.factory/schemas/calendar-api.json): path and method among `resources.events` / `resources.channels` methods, each
//   query parameter declared for that method or among the discovery's top-level `parameters`, JSON bodies declared in
//   Event / Channel recursively (EventDateTime, EventReminder, EventAttendee, inline objects, string maps), answers in
//   Event / Events / Channel with their JSON types; the push notices it delivers carry exactly Google's header names
//   (Calendar push notifications have no schema: developers.google.com/calendar/api/guides/push).
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
export const CALENDAR_SCHEMA_PATH = path.join(process.cwd(), ".factory/schemas/calendar-api.json");
// A test key for GMAIL_TOKEN_KEY (32 bytes, base64): set by the Gmail tests, never used outside them.
export const TEST_GMAIL_KEY = Buffer.alloc(32, 0x5a).toString("base64");

type Prop = { type?: string; format?: string; $ref?: string; items?: Prop; additionalProperties?: Prop; properties?: Record<string, Prop> };
type Param = { location: string };
type Schema = { id: string; type: string; properties: Record<string, Prop> };
type MediaUpload = { accept: string[]; maxSize: string; protocols: { simple?: { path: string } } };
type Method = {
  httpMethod: string; path: string; parameters?: Record<string, { location: string }>; request?: { $ref: string }; response?: { $ref: string };
  supportsMediaUpload?: boolean; mediaUpload?: MediaUpload;
};
type Resource = { methods?: Record<string, Method>; resources?: Record<string, Resource> };
type Discovery = { rootUrl: string; servicePath: string; schemas: Record<string, Schema>; resources: Record<string, Resource>; parameters?: Record<string, Param> };

function load(file: string): Discovery {
  if (!existsSync(file)) throw new Error(`${file} is missing: run "npm run test:schemas" to download it.`);
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") throw new Error(`${file} is empty`);
  return JSON.parse(text) as Discovery;
}

export const gmailSchema = load(GMAIL_SCHEMA_PATH);
export const pubsubSchema = load(PUBSUB_SCHEMA_PATH);
export const calendarSchema = load(CALENDAR_SCHEMA_PATH);

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

// SF-129: an upload (users.messages.send through the simple media upload): the path is the method's
// mediaUpload.protocols.simple.path, uploadType "media" or "multipart", the content type one of `accept`, the body at
// most `maxSize` bytes, every other query parameter declared for the method or at the discovery's top level.
export function checkUploadRequest(httpMethod: string, url: URL, contentType: string, size: number) {
  const m = methods.find(
    (x) => x.httpMethod === httpMethod && x.mediaUpload?.protocols.simple && new RegExp(`^${x.mediaUpload.protocols.simple.path.replace(/\{[^}]+\}/g, "([^/]+)")}$`).test(url.pathname),
  );
  if (!m || !m.mediaUpload) throw new Error(`gmail-api.json has no upload ${httpMethod} ${url.pathname}`);
  for (const name of url.searchParams.keys()) {
    const p = m.parameters?.[name] ?? gmailSchema.parameters?.[name];
    if (!p || p.location !== "query") throw new Error(`${m.name} has no query parameter "${name}" in gmail-api.json`);
  }
  const uploadType = url.searchParams.get("uploadType");
  if (uploadType !== "media" && uploadType !== "multipart") throw new Error(`${m.name} simple upload needs uploadType=media or multipart, got ${uploadType}`);
  const type = contentType.split(";")[0].trim().toLowerCase();
  const accepted = m.mediaUpload.accept.some((a) => (a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a));
  if (!accepted) throw new Error(`${m.name} upload accepts ${m.mediaUpload.accept.join(", ")}, not "${type}"`);
  if (size > Number(m.mediaUpload.maxSize)) throw new Error(`${m.name} upload is ${size} bytes, over maxSize ${m.mediaUpload.maxSize}`);
  return m;
}

// SF-124: Calendar's events and channels methods, matched on the path under calendar/v3/.
const calendarMethods: (Method & { name: string; re: RegExp })[] = [];
for (const r of ["events", "channels"]) {
  for (const [name, m] of Object.entries(calendarSchema.resources[r].methods ?? {})) {
    calendarMethods.push({ ...m, name: `${r}.${name}`, re: new RegExp(`^/${calendarSchema.servicePath}${m.path.replace(/\{[^}]+\}/g, "([^/]+)")}$`) });
  }
}
// Exact paths (events/watch) before patterns (events/{eventId}).
calendarMethods.sort((a, b) => (a.path.includes("{eventId}") ? 1 : 0) - (b.path.includes("{eventId}") ? 1 : 0));

function calendarMethodOf(httpMethod: string, pathname: string) {
  const found = calendarMethods.find((m) => m.httpMethod === httpMethod && m.re.test(pathname));
  if (!found) throw new Error(`calendar-api.json has no ${httpMethod} ${pathname}`);
  return found;
}

// The header names of a Calendar push notice (developers.google.com/calendar/api/guides/push).
export const CALENDAR_NOTICE_HEADERS = [
  "x-goog-channel-expiration",
  "x-goog-channel-id",
  "x-goog-channel-token",
  "x-goog-message-number",
  "x-goog-resource-id",
  "x-goog-resource-state",
  "x-goog-resource-uri",
];

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
      if (p.properties) {
        for (const [k, v] of Object.entries(value)) {
          if (!p.properties[k]) throw new Error(`${where} has no property "${k}" (${file})`);
          checkValue(`${where}.${k}`, v, p.properties[k], schemas, file);
        }
      }
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

  private async checkCalendar(req: Request, url: URL): Promise<Response> {
    const m = calendarMethodOf(req.method, url.pathname);
    for (const name of url.searchParams.keys()) {
      const p = m.parameters?.[name] ?? calendarSchema.parameters?.[name];
      if (!p || p.location !== "query") throw new Error(`${m.name} has no query parameter "${name}" in calendar-api.json`);
    }
    const text = req.method === "GET" || req.method === "DELETE" ? "" : await req.clone().text();
    if (text) {
      if (!m.request) throw new Error(`${m.name} takes no body in calendar-api.json`);
      checkObject(`${m.name} body`, JSON.parse(text), calendarSchema.schemas[m.request.$ref], calendarSchema.schemas, "calendar-api.json");
    }
    const res = await this.fetch(req);
    if (!res.ok || !m.response) return res;
    let body = (await res.json()) as Record<string, unknown>;
    if (this.tamperNext) {
      body = this.tamperNext(body);
      this.tamperNext = null;
    }
    checkObject(`${m.name} answer`, body, calendarSchema.schemas[m.response.$ref], calendarSchema.schemas, "calendar-api.json");
    return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
  }

  // The notice Google posts carries exactly the push guide's headers.
  override calendarNotice(email: string, state: "sync" | "exists" = "exists"): Headers | null {
    const h = super.calendarNotice(email, state);
    if (h) {
      const names = [...h.keys()].sort();
      if (JSON.stringify(names) !== JSON.stringify(CALENDAR_NOTICE_HEADERS)) {
        const msg = `a Calendar notice must carry exactly ${CALENDAR_NOTICE_HEADERS.join(", ")}; got ${names.join(", ")}`;
        this.violations.push(msg);
        throw new Error(msg);
      }
    }
    return h;
  }

  private async check(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.href.startsWith("https://www.googleapis.com/calendar/v3/")) return this.checkCalendar(req, url);
    if (url.origin !== "https://gmail.googleapis.com") {
      if (!["https://oauth2.googleapis.com", "https://www.googleapis.com"].includes(url.origin)) throw new Error(`no Google call to ${url.origin}`);
      return this.fetch(req);
    }
    if (url.pathname.startsWith("/upload/")) {
      const body = new Uint8Array(await req.clone().arrayBuffer());
      const um = checkUploadRequest(req.method, url, req.headers.get("content-type") ?? "", body.length);
      const res = await this.fetch(req);
      if (!res.ok || !um.response) return res;
      let answer = (await res.json()) as Record<string, unknown>;
      if (this.tamperNext) {
        answer = this.tamperNext(answer);
        this.tamperNext = null;
      }
      checkObject(`${um.name} answer`, answer, gmailSchema.schemas[um.response.$ref], gmailSchema.schemas, "gmail-api.json");
      return new Response(JSON.stringify(answer), { status: res.status, headers: res.headers });
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
