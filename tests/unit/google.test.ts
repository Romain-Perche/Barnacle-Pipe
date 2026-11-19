// covers FR-002, FR-024 (real Google path), research.md §2
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizationUrl, newPkce, signInWithGoogleCode } from "@/server/auth/google";
import { GoogleFake, s256 } from "../fakes/google";

const cfg = { GOOGLE_CLIENT_ID: "client-123", GOOGLE_CLIENT_SECRET: "fake-secret", APP_URL: "http://localhost:3000" };
beforeEach(() => {
  for (const [k, v] of Object.entries(cfg)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe("authorizationUrl", () => {
  it("asks Google for the code flow with PKCE, state and the barnacle.ai hint", () => {
    const { verifier, challenge } = newPkce();
    expect(challenge).toBe(s256(verifier));
    const url = new URL(authorizationUrl({ state: "st4te", codeChallenge: challenge }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("client-123");
    expect(p.get("redirect_uri")).toBe("http://localhost:3000/auth/google/callback");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("state")).toBe("st4te");
    expect(p.get("code_challenge")).toBe(challenge);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("hd")).toBe("barnacle.ai");
    expect(p.get("prompt")).toBe("select_account");
  });

  it("throws a clear error when Google is not configured", () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(() => authorizationUrl({ state: "s", codeChallenge: "c" })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });
});

describe("signInWithGoogleCode", () => {
  function setup(userinfo: Record<string, string | boolean>) {
    const fake = new GoogleFake("fake-secret");
    const { verifier } = newPkce();
    fake.issueCode("code-1", { verifier, redirectUri: "http://localhost:3000/auth/google/callback", clientId: "client-123", userinfo });
    return { fake, verifier };
  }

  it("exchanges the code and maps userinfo to the identity", async () => {
    const { fake, verifier } = setup({ email: "Ada@Barnacle.ai", verified_email: true, hd: "barnacle.ai", name: "Ada Fake", given_name: "Ada" });
    const result = await signInWithGoogleCode("code-1", verifier, fake.fetch);
    expect(result).toEqual({ ok: true, identity: { email: "Ada@Barnacle.ai", emailVerified: true, hd: "barnacle.ai", name: "Ada Fake" } });
    expect(fake.requests.map((r) => r.method)).toEqual(["POST", "GET"]);
  });

  it("maps a missing hd to null and a missing name to null", async () => {
    const { fake, verifier } = setup({ email: "me@gmail.com", verified_email: true });
    const result = await signInWithGoogleCode("code-1", verifier, fake.fetch);
    expect(result).toEqual({ ok: true, identity: { email: "me@gmail.com", emailVerified: true, hd: null, name: null } });
  });

  it("returns cancelled when the token exchange fails (wrong verifier, unknown code)", async () => {
    const { fake } = setup({ email: "ada@barnacle.ai", verified_email: true });
    expect(await signInWithGoogleCode("code-1", "wrong-verifier", fake.fetch)).toEqual({ ok: false, code: "cancelled" });
    expect(await signInWithGoogleCode("nope", "x", fake.fetch)).toEqual({ ok: false, code: "cancelled" });
  });

  it("returns cancelled when userinfo fails or has no email", async () => {
    const { fake, verifier } = setup({ name: "No Email" });
    expect(await signInWithGoogleCode("code-1", verifier, fake.fetch)).toEqual({ ok: false, code: "cancelled" });
    const broken = async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = await fake.fetch(input, init);
      return new URL(new Request(input, init).url).hostname === "www.googleapis.com" ? new Response("{}", { status: 500 }) : r;
    };
    const s = setup({ email: "ada@barnacle.ai", verified_email: true });
    expect(await signInWithGoogleCode("code-1", s.verifier, broken)).toEqual({ ok: false, code: "cancelled" });
  });

  it("returns cancelled when the network call throws", async () => {
    const boom = async () => {
      throw new Error("offline");
    };
    expect(await signInWithGoogleCode("c", "v", boom)).toEqual({ ok: false, code: "cancelled" });
  });
});
