// Gmail's notices through a Pub/Sub authenticated push (SF-118 research.md §6, FR-008, FR-015). Each POST to
// /gmail/push carries a Google-signed OIDC token, checked here with node:crypto only:
// - header alg RS256, kid among Google's keys (JWK set cached for its max-age, at most 1 h; fetched again once on an
//   unknown kid), the RS256 signature;
// - iss accounts.google.com, aud = GMAIL_PUSH_AUDIENCE, email = GMAIL_PUSH_SERVICE_ACCOUNT with email_verified,
//   exp in the future and iat at most 1 h old (5 minutes of clock leeway).
// Answers: 403 bad proof, 400 bad body, 204 otherwise (Pub/Sub retries anything else). A notice for an address with no
// working connection, or a sync that fails, is acknowledged: the 15-minute check recovers.
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { sql } from "@/server/db";
import { gmailConfig } from "@/server/env";
import { fetchSigningKeys } from "@/server/gmail/google-api";
import { syncConnection } from "@/server/gmail/sync";

const LEEWAY_S = 5 * 60;
const MAX_CACHE_MS = 60 * 60 * 1000;
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

type Jwks = { keys: Map<string, KeyObject>; until: number };
let cache: Jwks | null = null;

// Tests only: forget the cached keys.
export function forgetPushKeys(): void {
  cache = null;
}

async function loadKeys(nowMs: number): Promise<Jwks> {
  const { keys, maxAge } = await fetchSigningKeys();
  const map = new Map<string, KeyObject>();
  for (const k of keys) {
    if (typeof k.kid !== "string" || k.kty !== "RSA" || (k.alg !== undefined && k.alg !== "RS256")) continue;
    try {
      map.set(k.kid, createPublicKey({ key: { kty: "RSA", n: k.n as string, e: k.e as string }, format: "jwk" }));
    } catch {
      // a key Node can't read is left out
    }
  }
  cache = { keys: map, until: nowMs + Math.min(Math.max(maxAge, 0) * 1000, MAX_CACHE_MS) };
  return cache;
}

function part<T>(text: string): T | null {
  try {
    const v = JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as unknown;
    return typeof v === "object" && v !== null ? (v as T) : null;
  } catch {
    return null;
  }
}

export type PushCheck = { audience: string; serviceAccount: string };

// True only for a token Google signed for this app's push subscription.
export async function verifyPushToken(authorization: string | null | undefined, cfg: PushCheck, nowMs = Date.now()): Promise<boolean> {
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization ?? "");
  if (!m) return false;
  const head = part<{ alg?: unknown; kid?: unknown }>(m[1]);
  const claims = part<{ iss?: unknown; aud?: unknown; email?: unknown; email_verified?: unknown; exp?: unknown; iat?: unknown }>(m[2]);
  if (!head || !claims || head.alg !== "RS256" || typeof head.kid !== "string") return false;
  const cached = cache && cache.until > nowMs ? cache : null;
  let jwks = cached ?? (await loadKeys(nowMs));
  // An unknown kid in cached keys: Google may have rotated them; fetch them again once.
  if (cached && !jwks.keys.has(head.kid)) jwks = await loadKeys(nowMs);
  const key = jwks.keys.get(head.kid);
  if (!key) return false;
  const signed = verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), key, Buffer.from(m[3], "base64url"));
  if (!signed) return false;
  const now = Math.floor(nowMs / 1000);
  return (
    typeof claims.iss === "string" &&
    ISSUERS.includes(claims.iss) &&
    claims.aud === cfg.audience &&
    claims.email === cfg.serviceAccount &&
    claims.email_verified === true &&
    typeof claims.exp === "number" &&
    claims.exp + LEEWAY_S > now &&
    typeof claims.iat === "number" &&
    claims.iat <= now + LEEWAY_S &&
    now - claims.iat <= 3600 + LEEWAY_S
  );
}

// The push body: { message: { data: base64 JSON { emailAddress, historyId }, … }, subscription }. Null when bad.
function readBody(body: unknown): { subscription: string; emailAddress: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { message?: { data?: unknown }; subscription?: unknown };
  if (typeof b.subscription !== "string" || typeof b.message?.data !== "string") return null;
  try {
    const data = JSON.parse(Buffer.from(b.message.data, "base64").toString("utf8")) as { emailAddress?: unknown };
    if (typeof data?.emailAddress !== "string" || data.emailAddress === "") return null;
    return { subscription: b.subscription, emailAddress: data.emailAddress.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export async function receiveGmailPush(authorization: string | null | undefined, body: unknown, now = new Date()): Promise<{ status: 204 | 400 | 403 }> {
  const cfg = gmailConfig();
  if (cfg.mode === "off") return { status: 204 };
  let ok = false;
  try {
    ok = await verifyPushToken(authorization, { audience: cfg.pushAudience, serviceAccount: cfg.pushServiceAccount }, now.getTime());
  } catch {
    ok = false; // Google's keys can't be fetched: the notice can't be proved (Pub/Sub sends it again).
  }
  if (!ok) return { status: 403 };
  const notice = readBody(body);
  if (!notice) return { status: 400 };
  if (cfg.pushSubscription && notice.subscription !== cfg.pushSubscription) return { status: 403 };
  const [row] = await sql<{ id: string }[]>`
    select id::text as id from gmail_connections where email = ${notice.emailAddress} and state = 'working'`;
  if (!row) return { status: 204 };
  try {
    await syncConnection(Number(row.id), now);
  } catch {
    // The 15-minute check copies anything this run missed.
  }
  return { status: 204 };
}
