// covers SF-118 FR-018, T011: Google's token, revoke and signing-key endpoints have no public schema; the fake copies
// RFC 6749 §5.1/§5.2/§6, RFC 7636, RFC 7009 §2.2, RFC 7517 and Google's "Using OAuth 2.0 for Web Server Applications"
// (codes once and for 10 minutes, granular consent, offline access, 1-hour access tokens dying with their refresh token).
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installGmailFake, TEST_GMAIL_KEY, type GmailFake } from "../fakes/gmail";

const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const SEND = "https://www.googleapis.com/auth/gmail.send";
const REDIRECT = "http://localhost:3000/settings/gmail/callback";
const VERIFIER = "a-verifier-of-the-fake-oauth-test-0123456789";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
let fake: GmailFake;

beforeEach(() => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  fake = installGmailFake();
});

const code = (o: { scopes?: string[]; offline?: boolean } = {}) =>
  fake.consent({ email: "linus@barnacle.ai", scopes: o.scopes ?? [MODIFY, SEND], codeChallenge: CHALLENGE, redirectUri: REDIRECT, clientId: fake.options.clientId, offline: o.offline ?? true });

async function post(url: string, values: Record<string, string>) {
  const res = await fake.checkedFetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> | null };
}
const exchange = (c: string, over: Record<string, string> = {}) =>
  post("https://oauth2.googleapis.com/token", {
    grant_type: "authorization_code",
    code: c,
    redirect_uri: REDIRECT,
    client_id: fake.options.clientId,
    client_secret: fake.options.clientSecret,
    code_verifier: VERIFIER,
    ...over,
  });
const refresh = (token: string) =>
  post("https://oauth2.googleapis.com/token", { grant_type: "refresh_token", refresh_token: token, client_id: fake.options.clientId, client_secret: fake.options.clientSecret });
const profile = (access: string) => fake.checkedFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { method: "GET", headers: { authorization: `Bearer ${access}` } });

describe("token endpoint (RFC 6749 §5.1, §5.2; RFC 7636)", () => {
  it("answers an access token for 3600 s, the ticked scopes and a refresh token with offline access", async () => {
    const r = await exchange(code());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ token_type: "Bearer", scope: `${MODIFY} ${SEND}` });
    expect(r.body!.expires_in).toBeLessThanOrEqual(3600);
    expect(typeof r.body!.refresh_token).toBe("string");
    expect((await exchange(code({ scopes: [MODIFY] }))).body!.scope).toBe(MODIFY);
    expect((await exchange(code({ offline: false }))).body).not.toHaveProperty("refresh_token");
  });
  it("is invalid_grant for an unknown, used or expired code, and a wrong code_verifier", async () => {
    expect(await exchange("nope")).toEqual({ status: 400, body: expect.objectContaining({ error: "invalid_grant" }) });
    const once = code();
    expect((await exchange(once)).status).toBe(200);
    expect((await exchange(once)).body!.error).toBe("invalid_grant");
    const old = code();
    fake.advance(10 * 60 * 1000 + 1000);
    expect((await exchange(old)).body!.error).toBe("invalid_grant");
    expect((await exchange(code(), { code_verifier: "another-verifier-0123456789-0123456789" })).body!.error).toBe("invalid_grant");
  });
  it("is 401 invalid_client for a wrong secret, 400 invalid_request for a missing parameter", async () => {
    expect(await exchange(code(), { client_secret: "wrong" })).toEqual({ status: 401, body: expect.objectContaining({ error: "invalid_client" }) });
    expect(await exchange(code(), { code_verifier: "" })).toEqual({ status: 400, body: expect.objectContaining({ error: "invalid_request" }) });
  });
  it("refreshes, and is invalid_grant for a revoked or refused refresh token (§6)", async () => {
    const r = (await exchange(code())).body!;
    expect((await refresh(r.refresh_token as string)).status).toBe(200);
    fake.refuseKey("linus@barnacle.ai");
    expect((await refresh(r.refresh_token as string)).body!.error).toBe("invalid_grant");
    expect(fake.tokenStatus(r.refresh_token as string)).toBe("refused");
    const r2 = (await exchange(code())).body!;
    await post("https://oauth2.googleapis.com/revoke", { token: r2.refresh_token as string });
    expect((await refresh(r2.refresh_token as string)).body!.error).toBe("invalid_grant");
  });
  it("access tokens last an hour and die with a revoked refresh token (Gmail 401)", async () => {
    const r = (await exchange(code())).body!;
    expect((await profile(r.access_token as string)).status).toBe(200);
    fake.advance(3601 * 1000);
    expect((await profile(r.access_token as string)).status).toBe(401);
    const fresh = (await refresh(r.refresh_token as string)).body!.access_token as string;
    expect((await profile(fresh)).status).toBe(200);
    await post("https://oauth2.googleapis.com/revoke", { token: r.refresh_token as string });
    expect((await profile(fresh)).status).toBe(401);
  });
  it("a token without gmail.modify gets 403 insufficientPermissions from Gmail", async () => {
    const access = (await exchange(code({ scopes: [SEND] }))).body!.access_token as string;
    const res = await profile(access);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { errors: { reason: string }[] } }).error.errors[0].reason).toBe("insufficientPermissions");
  });
});

describe("revoke (RFC 7009 §2.2) and certs (RFC 7517)", () => {
  it("revoke answers 200 for a known token, 400 invalid_token for an unknown one", async () => {
    const r = (await exchange(code())).body!;
    expect((await post("https://oauth2.googleapis.com/revoke", { token: r.refresh_token as string })).status).toBe(200);
    expect(fake.tokenStatus(r.refresh_token as string)).toBe("revoked");
    expect(await post("https://oauth2.googleapis.com/revoke", { token: "unknown" })).toEqual({ status: 400, body: expect.objectContaining({ error: "invalid_token" }) });
  });
  it("certs is a JWK set with kid, kty RSA, alg RS256, n, e and a max-age", async () => {
    const res = await fake.checkedFetch("https://www.googleapis.com/oauth2/v3/certs", { method: "GET" });
    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
    const { keys } = (await res.json()) as { keys: Record<string, string>[] };
    expect(keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    for (const k of ["kid", "n", "e"]) expect(typeof keys[0][k]).toBe("string");
  });
});
