// The fake of Google Sign-In must refuse what the real schema refuses (test recipe rule 2).
import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GoogleFake, SCHEMA_PATH, USERINFO_URL, userinfoBody } from "../fakes/google";

describe("Google fake vs oauth2-api.json", () => {
  it("has the schema file (missing schema = failure, never a skip)", () => {
    expect(existsSync(SCHEMA_PATH) && statSync(SCHEMA_PATH).size > 0).toBe(true);
  });

  it("uses the schema's userinfo path", () => {
    expect(USERINFO_URL).toBe("https://www.googleapis.com/oauth2/v2/userinfo");
  });

  it("refuses a userinfo property that is not in the schema (wrong field)", () => {
    expect(() => userinfoBody({ email: "a@barnacle.ai", email_verified: true })).toThrow(/email_verified/);
    expect(() => userinfoBody({ email: "a@barnacle.ai", verified_email: "yes" })).toThrow(/boolean/);
    expect(userinfoBody({ email: "a@barnacle.ai", verified_email: true, hd: "barnacle.ai", name: "A" })).toBeTruthy();
  });

  it("refuses a wrong path, a wrong method and an unknown query parameter", async () => {
    const fake = new GoogleFake();
    fake.issueCode("c", { verifier: "v", redirectUri: "r", clientId: "id", userinfo: { email: "a@barnacle.ai", verified_email: true } });
    const tok = await fake.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "c", redirect_uri: "r", client_id: "id", client_secret: "fake-secret", code_verifier: "v" }),
    });
    const { access_token } = (await tok.json()) as { access_token: string };
    const auth = { authorization: `Bearer ${access_token}` };
    expect((await fake.fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: auth })).status).toBe(404);
    expect((await fake.fetch(USERINFO_URL, { method: "POST", headers: auth })).status).toBe(405);
    expect((await fake.fetch(`${USERINFO_URL}?bogus=1`, { headers: auth })).status).toBe(400);
    expect((await fake.fetch(`${USERINFO_URL}?alt=json`, { headers: auth })).status).toBe(200);
  });

  it("refuses a wrong PKCE verifier and a reused code with invalid_grant", async () => {
    const fake = new GoogleFake();
    fake.issueCode("c", { verifier: "v", redirectUri: "r", clientId: "id", userinfo: { email: "a@barnacle.ai" } });
    const post = (verifier: string) =>
      fake.fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: "c", redirect_uri: "r", client_id: "id", client_secret: "fake-secret", code_verifier: verifier }),
      });
    expect((await post("wrong")).status).toBe(400);
    expect((await post("v")).status).toBe(200);
    expect((await post("v")).status).toBe(400);
  });
});
