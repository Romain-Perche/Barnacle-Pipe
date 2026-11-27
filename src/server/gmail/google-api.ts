// Google calls of the Gmail connection (SF-118 contracts/google.md § Calls, research.md §1, §2, §5): one plain `fetch`
// each, 10 s time-out, settings from gmailConfig() at call time. In fake mode the calls go in process to fakeGmail();
// tests install their own fetch (useGmailFetchForTests). Errors carry only the HTTP status and Google's error code,
// never a token or a body:
// - GoogleKeyRefused: Google no longer accepts the key (invalid_grant, a Gmail 401, a 403 for missing permissions);
// - GoogleUnavailable: anything else (network, time-out, 5xx, other 4xx, Gmail off); SF-128: its GmailSlowDown for a
//   429 or a rate-limit 403;
// - HistoryGone: history.list answered 404 (the start id is older than the history Gmail keeps).
import { gmailConfig } from "@/server/env";
import { CERTS_URL, fakeGmail, REVOKE_URL, TOKEN_URL } from "@/server/gmail/fake-gmail";
import { askedScopes, classifyGoogleError, slowDownSeconds, type GmailMessage } from "@/server/gmail/rules";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 10_000;

export class GoogleKeyRefused extends Error {
  constructor(status: number, code: string) {
    super(`Google refused the key (${status} ${code})`);
    this.name = "GoogleKeyRefused";
  }
}
export class GoogleUnavailable extends Error {
  constructor(status: number | string, code = "") {
    super(`Google can't be used right now (${status}${code ? ` ${code}` : ""})`);
    this.name = "GoogleUnavailable";
  }
}
// SF-128 (contracts/google.md § Errors): Gmail asks to slow down (429, or 403 rateLimitExceeded /
// userRateLimitExceeded) for `seconds`. A GoogleUnavailable, so every SF-118 / SF-124 caller behaves as before.
export class GmailSlowDown extends GoogleUnavailable {
  constructor(
    status: number,
    readonly seconds: number,
  ) {
    super(status, "slow_down");
    this.name = "GmailSlowDown";
  }
}
// SF-128: threads.list refused the page token it gave (the fetch restarts its slice).
export class PageTokenRefused extends Error {
  constructor() {
    super("Gmail refused the page token (400)");
    this.name = "PageTokenRefused";
  }
}
export class HistoryGone extends Error {
  constructor() {
    super("Gmail no longer has this history (404)");
    this.name = "HistoryGone";
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
let testFetch: Fetch | null = null;

// Tests only: every Google call of the Gmail code goes to `fn` (tests/fakes/gmail.ts). Throws outside APP_ENV=test.
export function useGmailFetchForTests(fn: Fetch | null): void {
  if (process.env.APP_ENV !== "test") throw new Error("useGmailFetchForTests is for tests only.");
  testFetch = fn;
}

// Exported for the Calendar calls (SF-124, src/server/calendar/calendar-api.ts): one way to reach Google, one test switch.
export function settings() {
  const c = gmailConfig();
  if (c.mode === "off") throw new GoogleUnavailable("off");
  const f: Fetch = testFetch ?? (c.mode === "fake" ? fakeGmail().fetch : fetch);
  return { ...c, fetch: f };
}

export function callbackUrl(appUrl: string): string {
  return `${appUrl}/settings/gmail/callback`;
}

// The consent address (research.md §2): same client as sign-in, PKCE S256, offline access, consent every time, the
// user's own address as a hint; the Gmail scopes plus Calendar's when Calendar sync is on (SF-124 askedScopes()). In fake mode the fake consent screen of this app.
export function consentUrl({ state, codeChallenge, loginHint }: { state: string; codeChallenge: string; loginHint: string }): string {
  const c = settings();
  const url = new URL(c.mode === "fake" ? `${c.appUrl}/dev/fake-google/gmail` : AUTH_URL);
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: callbackUrl(c.appUrl),
    response_type: "code",
    scope: askedScopes().join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    login_hint: loginHint,
    hd: "barnacle.ai",
  }).toString();
  return url.toString();
}

export async function call(url: string, init: { method: string; headers?: Record<string, string>; body?: string }, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const c = settings();
  try {
    return await c.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // fetch rejects with a TypeError on a network error and a DOMException on a time-out; anything else is a bug.
    if (e instanceof TypeError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))) throw new GoogleUnavailable("network");
    throw e;
  }
}

export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isSlowDown(status: number, body: unknown): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const e = (body as { error?: { errors?: { reason?: unknown }[] } } | null)?.error;
  const reasons = typeof e === "object" && e !== null && Array.isArray(e.errors) ? e.errors.map((x) => x?.reason) : [];
  return reasons.some((r) => r === "rateLimitExceeded" || r === "userRateLimitExceeded");
}

// Exported for the tests of the error classification (SF-128 T019).
export async function failWith(res: Response): Promise<never> {
  const body = await readJson(res);
  const b = (body ?? {}) as { error?: unknown };
  const code = typeof b.error === "string" ? b.error : typeof (b.error as { status?: unknown })?.status === "string" ? String((b.error as { status: string }).status) : "";
  if (isSlowDown(res.status, body)) throw new GmailSlowDown(res.status, slowDownSeconds(res.headers.get("retry-after")));
  if (classifyGoogleError(res.status, body) === "key_refused") throw new GoogleKeyRefused(res.status, code);
  throw new GoogleUnavailable(res.status, code);
}

const form = (values: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
});

export async function exchangeGmailCode(code: string, verifier: string): Promise<{ refreshToken: string | null; accessToken: string; scope: string }> {
  const c = settings();
  const res = await call(TOKEN_URL, form({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(c.appUrl), client_id: c.clientId, client_secret: c.clientSecret, code_verifier: verifier }));
  if (!res.ok) return failWith(res);
  const body = (await readJson(res)) as { access_token?: unknown; refresh_token?: unknown; scope?: unknown } | null;
  if (typeof body?.access_token !== "string") throw new GoogleUnavailable(res.status, "no_access_token");
  return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null, scope: typeof body.scope === "string" ? body.scope : "" };
}

// A fresh access token for one sync, renewal or send; kept in memory only.
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const c = settings();
  const res = await call(TOKEN_URL, form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret }));
  if (!res.ok) return failWith(res);
  const body = (await readJson(res)) as { access_token?: unknown } | null;
  if (typeof body?.access_token !== "string") throw new GoogleUnavailable(res.status, "no_access_token");
  return body.access_token;
}

export async function revokeToken(token: string): Promise<void> {
  const res = await call(REVOKE_URL, form({ token }));
  if (!res.ok) await failWith(res);
}

async function gmail(accessToken: string, method: string, route: string, opts: { query?: [string, string][]; body?: unknown; timeoutMs?: number } = {}): Promise<Response> {
  const q = new URLSearchParams(opts.query ?? []).toString();
  const res = await call(`${GMAIL}/${route}${q ? `?${q}` : ""}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }, opts.timeoutMs);
  return res;
}

async function gmailJson<T>(accessToken: string, method: string, route: string, opts: { query?: [string, string][]; body?: unknown } = {}): Promise<T> {
  const res = await gmail(accessToken, method, route, opts);
  if (!res.ok) return failWith(res);
  return (await readJson(res)) as T;
}

export async function getProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string }> {
  const p = await gmailJson<{ emailAddress?: unknown; historyId?: unknown }>(accessToken, "GET", "profile");
  if (typeof p?.emailAddress !== "string" || typeof p.historyId !== "string") throw new GoogleUnavailable(200, "bad_profile");
  return { emailAddress: p.emailAddress, historyId: p.historyId };
}

export async function watch(accessToken: string, topicName: string): Promise<{ historyId: string; expiration: Date }> {
  const w = await gmailJson<{ historyId?: unknown; expiration?: unknown }>(accessToken, "POST", "watch", { body: { topicName } });
  const ms = Number(w?.expiration);
  if (typeof w?.historyId !== "string" || !Number.isFinite(ms)) throw new GoogleUnavailable(200, "bad_watch");
  return { historyId: w.historyId, expiration: new Date(ms) };
}

export async function stopWatch(accessToken: string): Promise<void> {
  const res = await gmail(accessToken, "POST", "stop");
  if (!res.ok) await failWith(res);
}

// The messages added since `startHistoryId`, oldest first, each with the id of its history record.
export async function listHistory(
  accessToken: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<{ entries: { messageId: string; historyId: string }[]; historyId: string; nextPageToken: string | null }> {
  const query: [string, string][] = [["startHistoryId", startHistoryId], ["historyTypes", "messageAdded"], ["maxResults", "500"]];
  if (pageToken) query.push(["pageToken", pageToken]);
  const res = await gmail(accessToken, "GET", "history", { query });
  if (res.status === 404) throw new HistoryGone();
  if (!res.ok) return failWith(res);
  const body = (await readJson(res)) as { history?: { id?: unknown; messagesAdded?: { message?: { id?: unknown } }[] }[]; historyId?: unknown; nextPageToken?: unknown };
  if (typeof body?.historyId !== "string") throw new GoogleUnavailable(200, "bad_history");
  const entries = (body.history ?? []).flatMap((h) =>
    (h.messagesAdded ?? [])
      .map((a) => a.message?.id)
      .filter((id): id is string => typeof id === "string")
      .map((messageId) => ({ messageId, historyId: typeof h.id === "string" ? h.id : (body.historyId as string) })),
  );
  return { entries, historyId: body.historyId, nextPageToken: typeof body.nextPageToken === "string" ? body.nextPageToken : null };
}

export async function listMessages(accessToken: string, q: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const query: [string, string][] = [["q", q], ["maxResults", "500"], ["includeSpamTrash", "false"]];
  if (pageToken) query.push(["pageToken", pageToken]);
  const body = await gmailJson<{ messages?: { id?: unknown }[]; nextPageToken?: unknown }>(accessToken, "GET", "messages", { query });
  return {
    ids: (body?.messages ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string"),
    nextPageToken: typeof body?.nextPageToken === "string" ? body.nextPageToken : null,
  };
}

// One message with its parts (format=full); null when it is gone from the mailbox.
export async function getMessage(accessToken: string, id: string): Promise<GmailMessage | null> {
  const res = await gmail(accessToken, "GET", `messages/${encodeURIComponent(id)}`, { query: [["format", "full"]] });
  if (res.status === 404) return null;
  if (!res.ok) return failWith(res);
  return (await readJson(res)) as GmailMessage;
}

// SF-127 (contracts/gmail.md): an attachment's bytes (users.messages.attachments.get, up to Gmail's 25 MB: 30 s);
// null when the message or the attachment is gone.
export async function getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array | null> {
  const res = await gmail(accessToken, "GET", `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, { timeoutMs: 30_000 });
  if (res.status === 404) return null;
  if (!res.ok) return failWith(res);
  const body = (await readJson(res)) as { data?: unknown } | null;
  if (typeof body?.data !== "string") throw new GoogleUnavailable(200, "bad_attachment");
  return new Uint8Array(Buffer.from(body.data, "base64url"));
}

// SF-128 (contracts/google.md § New calls): one page of the user's threads for `q`, spam and bin left out. A 400 while
// a page token was sent: the token is no longer good (PageTokenRefused).
export async function listThreads(accessToken: string, q: string, pageToken?: string | null): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const query: [string, string][] = [["q", q], ["maxResults", "100"], ["includeSpamTrash", "false"]];
  if (pageToken) query.push(["pageToken", pageToken]);
  const res = await gmail(accessToken, "GET", "threads", { query });
  if (res.status === 400 && pageToken) throw new PageTokenRefused();
  if (!res.ok) return failWith(res);
  const body = (await readJson(res)) as { threads?: { id?: unknown }[]; nextPageToken?: unknown } | null;
  return {
    ids: (body?.threads ?? []).map((t) => t.id).filter((x): x is string => typeof x === "string"),
    nextPageToken: typeof body?.nextPageToken === "string" ? body.nextPageToken : null,
  };
}

// SF-128: every message of a thread with its labels, Gmail's date and the four address headers (no bodies); null when
// the thread is gone.
export async function getThreadMessages(accessToken: string, threadId: string): Promise<GmailMessage[] | null> {
  const res = await gmail(accessToken, "GET", `threads/${encodeURIComponent(threadId)}`, {
    query: [["format", "metadata"], ["metadataHeaders", "From"], ["metadataHeaders", "To"], ["metadataHeaders", "Cc"], ["metadataHeaders", "Bcc"]],
  });
  if (res.status === 404) return null;
  if (!res.ok) return failWith(res);
  const body = (await readJson(res)) as { messages?: GmailMessage[] } | null;
  return (body?.messages ?? []).filter((m) => typeof m?.id === "string" && typeof m.threadId === "string");
}

// The Message-ID, References and Subject headers of each message of a thread (to reply in it).
export async function getThreadMetadata(accessToken: string, threadId: string): Promise<{ name: string; value: string }[][]> {
  const t = await gmailJson<{ messages?: { payload?: { headers?: { name: string; value: string }[] } }[] }>(accessToken, "GET", `threads/${encodeURIComponent(threadId)}`, {
    query: [["format", "metadata"], ["metadataHeaders", "Message-ID"], ["metadataHeaders", "References"], ["metadataHeaders", "Subject"]],
  });
  return (t?.messages ?? []).map((m) => m.payload?.headers ?? []);
}

export async function sendRaw(accessToken: string, raw: string, threadId?: string | null): Promise<{ id: string; threadId: string }> {
  const sent = await gmailJson<{ id?: unknown; threadId?: unknown }>(accessToken, "POST", "messages/send", { body: threadId ? { raw, threadId } : { raw } });
  if (typeof sent?.id !== "string" || typeof sent.threadId !== "string") throw new GoogleUnavailable(200, "bad_send");
  return { id: sent.id, threadId: sent.threadId };
}

// Google's signing keys (JWK set) and how long they may be kept (cache-control max-age, in seconds).
export async function fetchSigningKeys(): Promise<{ keys: Record<string, unknown>[]; maxAge: number }> {
  const res = await call(CERTS_URL, { method: "GET" });
  if (!res.ok) return failWith(res);
  const body = (await readJson(res)) as { keys?: unknown };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 0);
  return { keys: Array.isArray(body?.keys) ? (body.keys as Record<string, unknown>[]) : [], maxAge };
}
