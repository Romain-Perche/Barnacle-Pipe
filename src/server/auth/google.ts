// Google sign-in: OAuth 2.0 authorization code flow with PKCE, then Google's userinfo endpoint
// (research.md §2). No library: two fetch calls.
import { createHash, randomBytes } from "node:crypto";
import { googleConfig } from "@/server/env";
import { DOMAIN } from "@/server/auth/rules";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export class GoogleSignInFailed extends Error {}

export type GoogleProfile = { email: string; emailVerified: boolean; hd: string | null; name: string | null };
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomToken();
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function redirectUri(appUrl: string) {
  return `${appUrl}/auth/google/callback`;
}

export function authorizationUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
  const cfg = googleConfig();
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(cfg.appUrl),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    hd: DOMAIN,
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function exchangeCode(code: string, verifier: string, fetchImpl: FetchFn = fetch): Promise<string> {
  const cfg = googleConfig();
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(cfg.appUrl),
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new GoogleSignInFailed(`token endpoint answered ${res.status}`);
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || body.access_token === "") throw new GoogleSignInFailed("no access_token");
  return body.access_token;
}

export async function fetchUserinfo(accessToken: string, fetchImpl: FetchFn = fetch): Promise<GoogleProfile> {
  const res = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new GoogleSignInFailed(`userinfo answered ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if (typeof body.email !== "string" || body.email === "") throw new GoogleSignInFailed("userinfo has no email");
  return {
    email: body.email,
    emailVerified: body.verified_email === true,
    hd: typeof body.hd === "string" ? body.hd : null,
    name: typeof body.name === "string" ? body.name : null,
  };
}

// Any failure of Google's side is shown as "Sign-in was cancelled or failed".
export async function signInWithGoogleCode(
  code: string,
  verifier: string,
  fetchImpl: FetchFn = fetch,
): Promise<{ ok: true; identity: GoogleProfile } | { ok: false; code: "cancelled" }> {
  try {
    const token = await exchangeCode(code, verifier, fetchImpl);
    return { ok: true, identity: await fetchUserinfo(token, fetchImpl) };
  } catch {
    return { ok: false, code: "cancelled" };
  }
}
