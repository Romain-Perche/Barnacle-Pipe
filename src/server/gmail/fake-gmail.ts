// The fake Google Mail (SF-118 research.md §14, contracts/google.md § Fake): Google's token, revoke and signing-key
// endpoints and the Gmail calls the app makes, answered at their real URLs by an in-process `fetch`, over fake mailboxes.
// Used only when isFakeAllowed() and GMAIL_PUBSUB_TOPIC is empty (local runs, tests). The consent screen
// (/dev/fake-google/gmail) makes codes with consent(); the mailbox page (/dev/fake-gmail) puts mail in with addMessage()
// and delivers Pub/Sub notices signed by the fake's own RSA key (notice()). Tests wrap it in tests/fakes/gmail.ts, which
// checks every Gmail call and answer against Google's discovery files.
// Like Google: codes work once for 10 minutes (PKCE S256), `scope` lists only the ticked scopes, a refresh token only
// with access_type=offline, access tokens last 1 hour and die with their refresh token, history ids rise and an old
// start id answers 404 after forgetHistory(), a watch lasts 7 days, notices only while a watch is active.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  activeChannel,
  addFakeEvent,
  CALENDAR_ROOT,
  calendarApi,
  calendarOf,
  changeFakeEvent,
  declineFakeEvent,
  deleteFakeEvent,
  ensureCalendarState,
  expireTokens,
  noticeHeaders,
  type CalendarState,
  type FakeEvent,
  type FakeEventChange,
  type NewFakeEvent,
} from "@/server/calendar/fake-calendar";
import { gmailConfig, isFakeAllowed } from "@/server/env";
import type { GmailPart } from "@/server/gmail/rules";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GMAIL_ROOT = "https://gmail.googleapis.com/";
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const SEND = "https://www.googleapis.com/auth/gmail.send";

const CODE_MS = 10 * 60 * 1000;
const ACCESS_SECONDS = 3600;
const WATCH_MS = 7 * 24 * 60 * 60 * 1000;

export type FakeMessage = { id: string; threadId: string; labelIds: string[]; internalDate: string; historyId: string; payload: GmailPart; sizeEstimate: number };
type Mailbox = { messages: FakeMessage[]; history: { id: number; messageId: string }[]; watch: { topic: string; expiration: number } | null };
type CodeGrant = { email: string; scopes: string[]; challenge: string; redirectUri: string; clientId: string; offline: boolean; createdAt: number; used: boolean };
type TokenStatus = "active" | "revoked" | "refused" | "unknown";
export type FakeState = {
  seq: number;
  historyId: number;
  historyFloor: number;
  mailboxes: Record<string, Mailbox>;
  codes: Record<string, CodeGrant>;
  refresh: Record<string, { email: string; scopes: string[]; status: TokenStatus }>;
  access: Record<string, { email: string; scopes: string[]; refresh: string | null; expires: number; dead: boolean }>;
  failWatch: boolean;
  offsetMs: number;
  key: { kid: string; privatePem: string };
  // SF-127: attachment bytes (base64url) by "<message id>/<attachment id>", served by messages.attachments.get.
  attachmentData?: Record<string, string>;
} & CalendarState; // SF-124: the fake Google Calendar (src/server/calendar/fake-calendar.ts)

export interface StateStore {
  load(): FakeState | null;
  save(state: FakeState): void;
}

export class MemoryStore implements StateStore {
  private state: FakeState | null = null;
  load() {
    return this.state;
  }
  save(state: FakeState) {
    this.state = state;
  }
}

// `.fake-gmail/state.json` (git-ignored), read on every call so every route of a dev server sees the same mailboxes.
export class DiskStore implements StateStore {
  constructor(private dir = ".fake-gmail") {}
  private get file() {
    return path.join(this.dir, "state.json");
  }
  load() {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as FakeState) : null;
  }
  save(state: FakeState) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(state));
  }
}

export type FakeGmailOptions = {
  store: StateStore;
  clientId: string;
  clientSecret: string;
  audience: string;
  serviceAccount: string;
  subscription: string | null;
};

export type NewMessage = {
  from: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  text?: string | null;
  html?: string | null;
  // SF-127: `data` the bytes (default: `size` bytes of a fake pattern); `inline` puts them in the part's body.data with no
  // attachmentId, as Gmail does for small parts.
  attachments?: { name: string; size: number; type?: string; data?: string | Uint8Array; inline?: boolean }[];
  labels?: string[];
  internalDate?: Date;
  threadId?: string | null;
  messageId?: string;
};

export type PushNotice = { authorization: string; body: { message: { data: string; messageId: string; publishTime: string; attributes?: Record<string, string> }; subscription: string } };
export type FakeRequest = { method: string; url: string; path: string; query: Record<string, string>; body: unknown };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=UTF-8", ...headers } });
}
const oauthError = (status: number, error: string, description?: string) => json(status, description ? { error, error_description: description } : { error });
const gmailError = (code: number, status: string, message: string, reason: string) =>
  json(code, { error: { code, message, errors: [{ message, domain: "global", reason }], status } });
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const header = (name: string, value: string) => ({ name, value });
// `size` bytes of a fixed fake pattern (an attachment added without its bytes).
const fakeBytes = (size: number) => (size > 0 ? Buffer.alloc(size, "FAKE-ATTACHMENT\n") : Buffer.alloc(0));

// A small RFC 5322/MIME reader for messages.send: headers, and a body that is text, or multipart with base64 parts.
function parseMime(raw: string): { headers: { name: string; value: string }[]; parts: GmailPart[] } {
  const readPart = (text: string): { headers: { name: string; value: string }[]; body: string } => {
    const at = text.indexOf("\r\n\r\n");
    const head = at < 0 ? text : text.slice(0, at);
    const body = at < 0 ? "" : text.slice(at + 4);
    const headers: { name: string; value: string }[] = [];
    for (const line of head.split("\r\n")) {
      if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1].value += line.replace(/^[ \t]+/, " ");
      else {
        const i = line.indexOf(":");
        if (i > 0) headers.push(header(line.slice(0, i), line.slice(i + 1).trim()));
      }
    }
    return { headers, body };
  };
  const top = readPart(raw);
  const get = (hs: { name: string; value: string }[], n: string) => hs.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
  const leaf = (hs: { name: string; value: string }[], body: string, id: string): GmailPart => {
    const type = get(hs, "Content-Type").split(";")[0].trim() || "text/plain";
    const bytes = /base64/i.test(get(hs, "Content-Transfer-Encoding")) ? Buffer.from(body.replace(/\s+/g, ""), "base64") : Buffer.from(body, "utf8");
    return { partId: id, mimeType: type, filename: "", headers: hs, body: { size: bytes.length, data: b64url(bytes) } };
  };
  const boundary = /boundary="?([^";]+)"?/i.exec(get(top.headers, "Content-Type"))?.[1];
  if (!boundary) return { headers: top.headers, parts: [leaf(top.headers, top.body, "0")] };
  const chunks = top.body.split(`--${boundary}`).slice(1).filter((c) => !c.startsWith("--"));
  return {
    headers: top.headers,
    parts: chunks.map((c, i) => {
      const p = readPart(c.replace(/^\r\n/, "").replace(/\r\n$/, ""));
      return leaf(p.headers, p.body, String(i));
    }),
  };
}

export class FakeGoogleMail {
  readonly requests: FakeRequest[] = [];
  private isDown = false;
  // SF-124 test switches: the next Calendar write is applied but its answer is lost (a network error); writes to these
  // event ids answer 400.
  private loseAnswer = false;
  private readonly refused = new Set<string>();

  constructor(readonly options: FakeGmailOptions) {
    this.fetch = this.fetch.bind(this);
  }

  // ---- state -------------------------------------------------------------------------------------------------------
  private state(): FakeState {
    let s = this.options.store.load();
    if (!s) {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      s = {
        seq: 1000,
        historyId: 1000,
        historyFloor: 0,
        mailboxes: {},
        codes: {},
        refresh: {},
        access: {},
        failWatch: false,
        offsetMs: 0,
        calendars: {},
        channels: [],
        unreachable: false,
        key: { kid: `fake-${randomBytes(8).toString("hex")}`, privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
      };
      this.options.store.save(s);
    }
    ensureCalendarState(s);
    return s;
  }
  private change<T>(fn: (s: FakeState) => T): T {
    const s = this.state();
    const out = fn(s);
    this.options.store.save(s);
    return out;
  }
  private box(s: FakeState, email: string): Mailbox {
    const key = email.trim().toLowerCase();
    s.mailboxes[key] ??= { messages: [], history: [], watch: null };
    return s.mailboxes[key];
  }
  now(): number {
    return Date.now() + this.state().offsetMs;
  }
  private nextId(s: FakeState): string {
    s.seq += 1;
    return `${s.seq.toString(16)}${randomBytes(4).toString("hex")}`.padStart(16, "0");
  }

  // ---- switches ----------------------------------------------------------------------------------------------------
  // Every call rejects as a network error / is back.
  down(on = true) {
    this.isDown = on;
  }
  // Google stops accepting this user's key: refresh answers invalid_grant, its access tokens answer 401.
  refuseKey(email: string) {
    const who = email.trim().toLowerCase();
    this.change((s) => {
      for (const t of Object.values(s.refresh)) if (t.email === who && t.status === "active") t.status = "refused";
      for (const t of Object.values(s.access)) if (t.email === who) t.dead = true;
    });
  }
  // users.watch answers 500 (a renewal failure that is not about the key).
  failWatch(on = true) {
    this.change((s) => void (s.failWatch = on));
  }
  // Gmail no longer has the history before now: an older startHistoryId answers 404.
  forgetHistory() {
    this.change((s) => {
      s.historyId += 100;
      s.historyFloor = s.historyId;
    });
  }
  // Moves the fake's clock (codes, access tokens, watches, JWTs) `ms` ahead.
  advance(ms: number) {
    this.change((s) => void (s.offsetMs += ms));
  }
  isFailingWatch(): boolean {
    return this.state().failWatch;
  }
  mailbox(email: string): FakeMessage[] {
    return structuredClone(this.state().mailboxes[email.trim().toLowerCase()]?.messages ?? []);
  }
  sent(email: string): FakeMessage[] {
    return this.mailbox(email).filter((m) => m.labelIds.includes("SENT"));
  }
  mailboxes(): string[] {
    return Object.keys(this.state().mailboxes).sort();
  }
  watchOf(email: string): { topic: string; expiration: number } | null {
    const w = this.state().mailboxes[email.trim().toLowerCase()]?.watch ?? null;
    return w && w.expiration > this.now() ? w : null;
  }
  tokenStatus(token: string): TokenStatus {
    return this.state().refresh[token]?.status ?? "unknown";
  }
  // Every refresh token the fake gave this user, oldest first, with its status (tests: SC-004, revocations).
  tokensOf(email: string): { token: string; status: TokenStatus }[] {
    return Object.entries(this.state().refresh)
      .filter(([, t]) => t.email === email.trim().toLowerCase())
      .map(([token, t]) => ({ token, status: t.status }));
  }
  // The key status of a user's newest refresh token, for the mailbox page.
  keyStatusOf(email: string): TokenStatus {
    const mine = Object.values(this.state().refresh).filter((t) => t.email === email.trim().toLowerCase());
    return mine.length ? mine[mine.length - 1].status : "unknown";
  }

  // ---- calendar (SF-124) ------------------------------------------------------------------------------------------
  // Every Google call (token endpoint included) fails as a network error / works again; kept in the state so every
  // route of a dev server sees it.
  setUnreachable(on: boolean) {
    this.change((s) => void (s.unreachable = on));
  }
  isUnreachable(): boolean {
    return this.state().unreachable;
  }
  calendarEvents(email: string): FakeEvent[] {
    return structuredClone(this.state().calendars[email.trim().toLowerCase()]?.events ?? []);
  }
  calendarEmails(): string[] {
    return Object.keys(this.state().calendars).sort();
  }
  calendarChannel(email: string) {
    return structuredClone(activeChannel(this.state(), email, this.now()));
  }
  // The headers of Google's notice for this calendar now (and counts it as sent), or null with no active channel.
  calendarNotice(email: string, state: "sync" | "exists" = "exists"): Headers | null {
    return this.change((s) => noticeHeaders(s, email, this.now(), state));
  }
  // Google posts the notice to the app's push route (in process). Null when no channel is active.
  async deliverCalendar(email: string): Promise<number | null> {
    const headers = this.calendarNotice(email);
    if (!headers) return null;
    const { receiveCalendarPush } = await import("@/server/calendar/push");
    return (await receiveCalendarPush(headers)).status;
  }
  // The notice is sent with no delivery (a lost notice).
  dropCalendarNotice(email: string): void {
    this.calendarNotice(email);
  }
  private async after(email: string, deliver: boolean | undefined) {
    if (deliver) await this.deliverCalendar(email);
  }
  async addEvent(email: string, input: NewFakeEvent, o: { deliver?: boolean } = {}): Promise<string> {
    const e = this.change((s) => addFakeEvent(s, this.now(), email, input));
    await this.after(email, o.deliver);
    return e.id;
  }
  async changeEvent(email: string, id: string, change: FakeEventChange, o: { deliver?: boolean } = {}): Promise<void> {
    this.change((s) => changeFakeEvent(s, this.now(), email, id, change));
    await this.after(email, o.deliver);
  }
  async declineEvent(email: string, id: string, o: { deliver?: boolean } = {}): Promise<void> {
    this.change((s) => declineFakeEvent(s, this.now(), email, id));
    await this.after(email, o.deliver);
  }
  async deleteEvent(email: string, id: string, o: { deliver?: boolean } = {}): Promise<void> {
    this.change((s) => deleteFakeEvent(s, this.now(), email, id));
    await this.after(email, o.deliver);
  }
  expireCalendarTokens(email?: string): void {
    this.change((s) => expireTokens(s, email));
  }
  // The user takes one permission back in their Google Account: their keys and access tokens lose that scope.
  removeScope(email: string, scope: string) {
    const who = email.trim().toLowerCase();
    this.change((s) => {
      for (const t of [...Object.values(s.refresh), ...Object.values(s.access)]) if (t.email === who) t.scopes = t.scopes.filter((x) => x !== scope);
    });
  }
  // The next Calendar write is done but its answer never arrives.
  loseNextCalendarAnswer() {
    this.loseAnswer = true;
  }
  // Writes to this event id answer 400 (Google refuses that one event).
  refuseEventWrites(id: string, on = true) {
    if (on) this.refused.add(id);
    else this.refused.delete(id);
  }
  // Makes sure a user's calendar exists (empty), so the fake page lists them.
  touchCalendar(email: string): void {
    this.change((s) => void calendarOf(s, email));
  }

  // ---- consent screen ----------------------------------------------------------------------------------------------
  // What Google's consent screen gives on [ ALLOW ]: a one-use code for this account and the ticked scopes.
  consent(grant: { email: string; scopes: string[]; codeChallenge: string; redirectUri: string; clientId: string; offline: boolean }): string {
    const code = `fake-code-${randomBytes(12).toString("hex")}`;
    this.change((s) => {
      s.codes[code] = { email: grant.email.trim().toLowerCase(), scopes: grant.scopes, challenge: grant.codeChallenge, redirectUri: grant.redirectUri, clientId: grant.clientId, offline: grant.offline, createdAt: this.now(), used: false };
      this.box(s, grant.email);
    });
    return code;
  }

  // ---- mail --------------------------------------------------------------------------------------------------------
  private add(s: FakeState, email: string, msg: Omit<FakeMessage, "id" | "historyId" | "sizeEstimate"> & { id?: string }): FakeMessage {
    const box = this.box(s, email);
    s.historyId += 1;
    const id = msg.id ?? this.nextId(s);
    const full: FakeMessage = { ...msg, id, historyId: String(s.historyId), sizeEstimate: JSON.stringify(msg.payload).length };
    box.messages.push(full);
    box.history.push({ id: s.historyId, messageId: id });
    return full;
  }

  // Puts a message in a user's mailbox (received in INBOX by default; with SENT it is one the user sent).
  addMessage(email: string, m: NewMessage): { id: string; threadId: string; historyId: string } {
    return this.change((s) => {
      const box = this.box(s, email);
      const threadId = m.threadId && box.messages.some((x) => x.threadId === m.threadId) ? m.threadId : this.nextId(s);
      const date = m.internalDate ?? new Date(this.now());
      const headers = [header("From", m.from)];
      if (m.to) headers.push(header("To", m.to));
      if (m.cc) headers.push(header("Cc", m.cc));
      if (m.bcc) headers.push(header("Bcc", m.bcc));
      headers.push(header("Subject", m.subject ?? ""), header("Date", date.toUTCString()), header("Message-ID", m.messageId ?? `<${randomBytes(8).toString("hex")}@fake.example>`));
      const parts: GmailPart[] = [];
      let n = 0;
      if (m.text != null) parts.push({ partId: String(n++), mimeType: "text/plain", filename: "", headers: [header("Content-Type", 'text/plain; charset="UTF-8"')], body: { size: Buffer.byteLength(m.text), data: b64url(m.text) } });
      if (m.html != null) parts.push({ partId: String(n++), mimeType: "text/html", filename: "", headers: [header("Content-Type", 'text/html; charset="UTF-8"')], body: { size: Buffer.byteLength(m.html), data: b64url(m.html) } });
      const stored: [string, string][] = [];
      for (const a of m.attachments ?? []) {
        const bytes = a.data === undefined ? fakeBytes(a.size) : Buffer.from(a.data);
        const attachmentId = `ANGjdJ${randomBytes(12).toString("hex")}`;
        if (!a.inline) stored.push([attachmentId, b64url(bytes)]);
        parts.push({
          partId: String(n++),
          mimeType: a.type ?? "application/octet-stream",
          filename: a.name,
          headers: [header("Content-Type", a.type ?? "application/octet-stream"), header("Content-Disposition", `attachment; filename="${a.name}"`)],
          body: a.inline ? { size: a.size, data: b64url(bytes) } : { size: a.size, attachmentId },
        });
      }
      const msg = this.add(s, email, {
        threadId,
        labelIds: m.labels ?? ["INBOX", "UNREAD"],
        internalDate: String(date.getTime()),
        payload: { partId: "", mimeType: "multipart/mixed", filename: "", headers, body: { size: 0 }, parts },
      });
      s.attachmentData ??= {};
      for (const [attachmentId, data] of stored) s.attachmentData[`${msg.id}/${attachmentId}`] = data;
      return { id: msg.id, threadId: msg.threadId, historyId: msg.historyId };
    });
  }

  // SF-127: the message is deleted for good from the mailbox (messages.get and its attachments answer 404).
  deleteMessage(email: string, messageId: string) {
    this.change((s) => {
      const box = this.box(s, email);
      box.messages = box.messages.filter((x) => x.id !== messageId);
    });
  }

  // Changes a message's labels, as moving it to the bin in Gmail does (no messageAdded history).
  setLabels(email: string, messageId: string, labels: string[]) {
    this.change((s) => {
      const m = this.box(s, email).messages.find((x) => x.id === messageId);
      if (m) m.labelIds = labels;
      s.historyId += 1;
    });
  }

  // ---- push notices ------------------------------------------------------------------------------------------------
  // A Google-signed OIDC token, as a Pub/Sub authenticated push carries (claims and header may be changed by tests).
  signPushToken(claims: Record<string, unknown> = {}, head: Record<string, unknown> = {}, opts: { otherKey?: boolean } = {}): string {
    const s = this.state();
    const iat = Math.floor(this.now() / 1000);
    const h = { alg: "RS256", kid: s.key.kid, typ: "JWT", ...head };
    const c = {
      aud: this.options.audience,
      azp: "112233445566778899000",
      email: this.options.serviceAccount,
      email_verified: true,
      exp: iat + 3600,
      iat,
      iss: "https://accounts.google.com",
      sub: "112233445566778899000",
      ...claims,
    };
    const input = `${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(c))}`;
    const key = opts.otherKey ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey : createPrivateKey(s.key.privatePem);
    return `${input}.${b64url(sign("sha256", Buffer.from(input), key))}`;
  }

  // The Pub/Sub push Gmail would send for this user now, or null when the user has no active watch.
  notice(email: string): PushNotice | null {
    const who = email.trim().toLowerCase();
    if (!this.watchOf(who)) return null;
    const s = this.state();
    const data = Buffer.from(JSON.stringify({ emailAddress: who, historyId: s.historyId })).toString("base64");
    return {
      authorization: `Bearer ${this.signPushToken()}`,
      body: {
        message: { data, messageId: String(Math.floor(Math.random() * 1e15)), publishTime: new Date(this.now()).toISOString() },
        subscription: this.options.subscription ?? "projects/crm-fake/subscriptions/gmail-push-fake",
      },
    };
  }

  // ---- fetch -------------------------------------------------------------------------------------------------------
  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
    let body: unknown = text;
    if ((req.headers.get("content-type") ?? "").includes("application/json") && text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const logged: unknown = url.origin === "https://oauth2.googleapis.com" ? "(form)" : body;
    this.requests.push({ method: req.method, url: `${url.origin}${url.pathname}`, path: url.pathname, query: Object.fromEntries(url.searchParams), body: logged });
    if (this.isDown || this.state().unreachable) throw new TypeError("fetch failed");
    const base = `${url.origin}${url.pathname}`;
    if (base.startsWith(CALENDAR_ROOT)) {
      const auth = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
      const target = req.method === "POST" ? (body as { id?: unknown } | null)?.id : decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if ((req.method === "POST" || req.method === "PATCH") && typeof target === "string" && this.refused.has(target)) {
        return json(400, { error: { errors: [{ domain: "global", reason: "invalid", message: "Invalid value" }], code: 400, message: "Invalid value" } });
      }
      const res = this.change((s) => {
        const a = s.access[auth];
        const token = a && !a.dead && a.expires >= this.now() ? { email: a.email, scopes: a.scopes } : null;
        return calendarApi(s, this.now(), { method: req.method, url, body }, token);
      });
      if (this.loseAnswer && req.method !== "GET") {
        this.loseAnswer = false;
        throw new TypeError("fetch failed");
      }
      return res;
    }
    if (base === TOKEN_URL) return this.token(req, text);
    if (base === REVOKE_URL) return this.revoke(req, text);
    if (base === CERTS_URL) return this.certs();
    if (url.origin === "https://gmail.googleapis.com") return this.gmail(req, url, body);
    return json(404, { error: "not_found" });
  }

  private token(req: Request, text: string): Response {
    if (req.method !== "POST") return oauthError(405, "invalid_request");
    if (!(req.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return oauthError(400, "invalid_request", "form body required");
    const f = new URLSearchParams(text);
    const grant = f.get("grant_type");
    const need = grant === "authorization_code" ? ["code", "redirect_uri", "client_id", "client_secret", "code_verifier"] : ["refresh_token", "client_id", "client_secret"];
    if (grant !== "authorization_code" && grant !== "refresh_token") return oauthError(400, "unsupported_grant_type");
    if (need.some((k) => !f.get(k))) return oauthError(400, "invalid_request", "Missing required parameter");
    if (f.get("client_id") !== this.options.clientId || f.get("client_secret") !== this.options.clientSecret) return oauthError(401, "invalid_client", "Unauthorized");
    return this.change((s) => {
      if (grant === "authorization_code") {
        const c = s.codes[f.get("code")!];
        if (!c || c.used || this.now() - c.createdAt > CODE_MS || c.redirectUri !== f.get("redirect_uri") || c.clientId !== f.get("client_id")) {
          if (c) c.used = true;
          return oauthError(400, "invalid_grant", "Bad Request");
        }
        c.used = true;
        if (createHash("sha256").update(f.get("code_verifier")!).digest("base64url") !== c.challenge) return oauthError(400, "invalid_grant", "Bad Request");
        const refresh = c.offline ? `fake-refresh-${randomBytes(24).toString("base64url")}` : null;
        if (refresh) s.refresh[refresh] = { email: c.email, scopes: c.scopes, status: "active" };
        const access = this.newAccess(s, c.email, c.scopes, refresh);
        return json(200, { access_token: access, expires_in: ACCESS_SECONDS - 1, scope: c.scopes.join(" "), token_type: "Bearer", ...(refresh ? { refresh_token: refresh } : {}) });
      }
      const r = s.refresh[f.get("refresh_token")!];
      if (!r || r.status !== "active") return oauthError(400, "invalid_grant", "Token has been expired or revoked.");
      const access = this.newAccess(s, r.email, r.scopes, f.get("refresh_token"));
      return json(200, { access_token: access, expires_in: ACCESS_SECONDS - 1, scope: r.scopes.join(" "), token_type: "Bearer" });
    });
  }

  private newAccess(s: FakeState, email: string, scopes: string[], refresh: string | null): string {
    const token = `fake-access-${randomBytes(24).toString("base64url")}`;
    s.access[token] = { email, scopes, refresh, expires: this.now() + ACCESS_SECONDS * 1000, dead: false };
    return token;
  }

  // RFC 7009: 200 for a known token (its access tokens die with a refresh token), 400 invalid_token otherwise.
  private revoke(req: Request, text: string): Response {
    if (req.method !== "POST") return oauthError(405, "invalid_request");
    const token = new URLSearchParams(text).get("token") ?? "";
    return this.change((s) => {
      const refresh = s.refresh[token] ? token : s.access[token]?.refresh ?? null;
      if (!refresh && !s.access[token]) return oauthError(400, "invalid_token", "Token expired or revoked");
      if (refresh && s.refresh[refresh]) s.refresh[refresh].status = "revoked";
      for (const [k, a] of Object.entries(s.access)) if (k === token || (refresh && a.refresh === refresh)) a.dead = true;
      return new Response(null, { status: 200 });
    });
  }

  // RFC 7517 JWK set of the fake's signing key, cached like Google's.
  private certs(): Response {
    const s = this.state();
    const jwk = createPublicKey(createPrivateKey(s.key.privatePem)).export({ format: "jwk" }) as { kty: string; n: string; e: string };
    return json(200, { keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid: s.key.kid, alg: "RS256", use: "sig" }] }, { "cache-control": "public, max-age=19800, must-revalidate, no-transform" });
  }

  private gmail(req: Request, url: URL, body: unknown): Response {
    const m = /^\/gmail\/v1\/users\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (!m || m[1] !== "me") return gmailError(404, "NOT_FOUND", "Requested entity was not found.", "notFound");
    const route = m[2];
    const auth = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
    return this.change((s) => {
      const a = s.access[auth];
      if (!a || a.dead || a.expires < this.now()) return gmailError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials.", "authError");
      const isSend = route === "messages/send" && req.method === "POST";
      const allowed = a.scopes.includes(MODIFY) || (isSend && a.scopes.includes(SEND));
      if (!allowed) return gmailError(403, "PERMISSION_DENIED", "Request had insufficient authentication scopes.", "insufficientPermissions");
      const box = this.box(s, a.email);
      const q = url.searchParams;
      if (req.method === "GET" && route === "profile") {
        return json(200, { emailAddress: a.email, messagesTotal: box.messages.length, threadsTotal: new Set(box.messages.map((x) => x.threadId)).size, historyId: String(s.historyId) });
      }
      if (req.method === "POST" && route === "watch") {
        const topic = (body as { topicName?: unknown })?.topicName;
        if (typeof topic !== "string" || topic === "") return gmailError(400, "INVALID_ARGUMENT", "Invalid topicName", "invalidArgument");
        if (s.failWatch) return gmailError(500, "INTERNAL", "Backend Error", "backendError");
        box.watch = { topic, expiration: this.now() + WATCH_MS };
        return json(200, { historyId: String(s.historyId), expiration: String(box.watch.expiration) });
      }
      if (req.method === "POST" && route === "stop") {
        box.watch = null;
        return new Response(null, { status: 204 });
      }
      if (req.method === "GET" && route === "history") {
        const start = Number(q.get("startHistoryId"));
        if (!Number.isFinite(start) || q.get("startHistoryId") === null) return gmailError(400, "INVALID_ARGUMENT", "Invalid startHistoryId", "invalidArgument");
        if (start < s.historyFloor) return gmailError(404, "NOT_FOUND", "Requested entity was not found.", "notFound");
        const max = Math.min(Number(q.get("maxResults") ?? 100) || 100, 500);
        const from = Number(q.get("pageToken") ?? 0) || 0;
        const entries = box.history.filter((h) => h.id > start);
        const page = entries.slice(from, from + max);
        const history = page.map((h) => {
          const msg = box.messages.find((x) => x.id === h.messageId);
          const ref = { id: h.messageId, threadId: msg?.threadId ?? h.messageId };
          return { id: String(h.id), messages: [ref], messagesAdded: [{ message: { ...ref, labelIds: msg?.labelIds ?? [] } }] };
        });
        return json(200, { ...(history.length ? { history } : {}), historyId: String(s.historyId), ...(from + max < entries.length ? { nextPageToken: String(from + max) } : {}) });
      }
      if (req.method === "GET" && route === "messages") {
        const after = /(?:^|\s)after:(\d+)/.exec(q.get("q") ?? "")?.[1];
        const spamTrash = q.get("includeSpamTrash") === "true";
        const max = Math.min(Number(q.get("maxResults") ?? 100) || 100, 500);
        const from = Number(q.get("pageToken") ?? 0) || 0;
        const all = box.messages
          .filter((x) => (after === undefined ? true : Number(x.internalDate) / 1000 > Number(after)))
          .filter((x) => spamTrash || !x.labelIds.some((l) => l === "SPAM" || l === "TRASH"))
          .sort((x, y) => Number(y.internalDate) - Number(x.internalDate));
        const page = all.slice(from, from + max).map((x) => ({ id: x.id, threadId: x.threadId }));
        return json(200, { ...(page.length ? { messages: page } : {}), resultSizeEstimate: all.length, ...(from + max < all.length ? { nextPageToken: String(from + max) } : {}) });
      }
      // SF-127: users.messages.attachments.get → MessagePartBody { size, data } (base64url).
      const att = /^messages\/([^/]+)\/attachments\/([^/]+)$/.exec(route);
      if (req.method === "GET" && att) {
        const msg = box.messages.find((x) => x.id === att[1]);
        const data = msg ? s.attachmentData?.[`${msg.id}/${att[2]}`] : undefined;
        if (!msg || data === undefined) return gmailError(404, "NOT_FOUND", "Requested entity was not found.", "notFound");
        return json(200, { size: Buffer.from(data, "base64url").length, data });
      }
      const one = /^messages\/([^/]+)$/.exec(route);
      if (req.method === "GET" && one && one[1] !== "send") {
        const msg = box.messages.find((x) => x.id === one[1]);
        if (!msg) return gmailError(404, "NOT_FOUND", "Requested entity was not found.", "notFound");
        return json(200, { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds, snippet: "", historyId: msg.historyId, internalDate: msg.internalDate, payload: msg.payload, sizeEstimate: msg.sizeEstimate });
      }
      const thread = /^threads\/([^/]+)$/.exec(route);
      if (req.method === "GET" && thread) {
        const msgs = box.messages.filter((x) => x.threadId === thread[1]);
        if (msgs.length === 0) return gmailError(404, "NOT_FOUND", "Requested entity was not found.", "notFound");
        const wanted = q.getAll("metadataHeaders").map((h) => h.toLowerCase());
        return json(200, {
          id: thread[1],
          historyId: String(s.historyId),
          messages: msgs.map((x) => ({
            id: x.id,
            threadId: x.threadId,
            labelIds: x.labelIds,
            historyId: x.historyId,
            internalDate: x.internalDate,
            payload: { mimeType: x.payload.mimeType, headers: (x.payload.headers ?? []).filter((h) => wanted.length === 0 || wanted.includes(h.name.toLowerCase())) },
          })),
        });
      }
      if (isSend) {
        const raw = (body as { raw?: unknown })?.raw;
        if (typeof raw !== "string" || raw === "") return gmailError(400, "INVALID_ARGUMENT", "Invalid raw", "invalidArgument");
        const mime = parseMime(Buffer.from(raw, "base64url").toString("utf8"));
        const get = (n: string) => mime.headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
        const asked = (body as { threadId?: unknown }).threadId;
        const threadId = typeof asked === "string" && box.messages.some((x) => x.threadId === asked) ? asked : this.nextId(s);
        const headers = mime.headers.filter((h) => h.name.toLowerCase() !== "bcc");
        if (!get("Message-ID")) headers.push(header("Message-ID", `<fake-${randomBytes(8).toString("hex")}@mail.gmail.com>`));
        const toSelf = [get("To"), get("Cc"), get("Bcc")].join(",").toLowerCase().includes(a.email);
        const msg = this.add(s, a.email, {
          threadId,
          labelIds: toSelf ? ["SENT", "INBOX", "UNREAD"] : ["SENT"],
          internalDate: String(this.now()),
          payload: { partId: "", mimeType: mime.parts.length > 1 ? "multipart/alternative" : mime.parts[0]?.mimeType ?? "text/plain", filename: "", headers, body: { size: 0 }, parts: mime.parts },
        });
        return json(200, { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
      }
      return gmailError(404, "NOT_FOUND", "Requested entity was not found.", "notFound");
    });
  }
}

const g = globalThis as unknown as { __crmFakeGmail?: FakeGoogleMail };

// The one fake of this process: memory in tests, `.fake-gmail/state.json` in development. Only in fake mode.
export function fakeGmail(): FakeGoogleMail {
  const c = gmailConfig();
  if (!isFakeAllowed() || c.mode !== "fake") throw new Error("The fake Gmail only runs with APP_ENV development or test and no GMAIL_PUBSUB_TOPIC.");
  if (!g.__crmFakeGmail) {
    g.__crmFakeGmail = new FakeGoogleMail({
      store: process.env.APP_ENV === "test" ? new MemoryStore() : new DiskStore(),
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      audience: c.pushAudience,
      serviceAccount: c.pushServiceAccount,
      subscription: c.pushSubscription,
    });
  }
  return g.__crmFakeGmail;
}
