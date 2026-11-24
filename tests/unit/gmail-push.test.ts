// covers SF-118 FR-008, FR-015, edge case "Notices not from Google" (research.md §6): only a token Google signed for
// this app's push subscription is accepted; Google's keys are cached for their max-age and fetched again once for an
// unknown kid.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPushKeys, verifyPushToken } from "@/server/gmail/push";
import { installGmailFake, TEST_GMAIL_KEY, type GmailFake } from "../fakes/gmail";

let fake: GmailFake;
let cfg: { audience: string; serviceAccount: string };
const certsCalls = () => fake.requests.filter((r) => r.url === "https://www.googleapis.com/oauth2/v3/certs").length;

beforeEach(() => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  forgetPushKeys();
  fake = installGmailFake();
  cfg = { audience: fake.options.audience, serviceAccount: fake.options.serviceAccount };
});

const bearer = (t: string) => `Bearer ${t}`;

describe("verifyPushToken", () => {
  it("accepts a good token", async () => {
    expect(await verifyPushToken(bearer(fake.signPushToken()), cfg, fake.now())).toBe(true);
  });
  it.each([
    ["alg HS256", {}, { alg: "HS256" }],
    ["alg none", {}, { alg: "none" }],
    ["a wrong iss", { iss: "https://evil.example" }, {}],
    ["a wrong aud", { aud: "https://other.example/gmail/push" }, {}],
    ["a wrong email", { email: "someone@evil.iam.gserviceaccount.com" }, {}],
    ["email_verified false", { email_verified: false }, {}],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 600 }, {}],
    ["iat over 1 h old", { iat: Math.floor(Date.now() / 1000) - 2 * 3600, exp: Math.floor(Date.now() / 1000) + 600 }, {}],
  ])("refuses %s", async (_what, claims, head) => {
    expect(await verifyPushToken(bearer(fake.signPushToken(claims, head)), cfg, fake.now())).toBe(false);
  });
  it("refuses a bad signature, a token signed by another key, and a missing or malformed Authorization", async () => {
    const good = fake.signPushToken();
    const [h, c, s] = good.split(".");
    const flipped = `${s.slice(0, 10)}${s[10] === "A" ? "B" : "A"}${s.slice(11)}`;
    expect(await verifyPushToken(bearer(`${h}.${c}.${flipped}`), cfg, fake.now())).toBe(false);
    const otherClaims = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(c, "base64url").toString()), email: "x@y.test" })).toString("base64url");
    expect(await verifyPushToken(bearer(`${h}.${otherClaims}.${s}`), cfg, fake.now())).toBe(false);
    expect(await verifyPushToken(bearer(fake.signPushToken({}, {}, { otherKey: true })), cfg, fake.now())).toBe(false);
    for (const a of [null, undefined, "", good, `Basic ${good}`, "Bearer a.b"]) expect(await verifyPushToken(a, cfg, fake.now()), String(a)).toBe(false);
  });
  it("fetches Google's keys again exactly once for an unknown kid, and caches them by max-age", async () => {
    expect(await verifyPushToken(bearer(fake.signPushToken()), cfg, fake.now())).toBe(true);
    expect(certsCalls()).toBe(1);
    expect(await verifyPushToken(bearer(fake.signPushToken()), cfg, fake.now())).toBe(true);
    expect(certsCalls()).toBe(1);
    expect(await verifyPushToken(bearer(fake.signPushToken({}, { kid: "unknown-kid" })), cfg, fake.now())).toBe(false);
    expect(certsCalls()).toBe(2);
    // After max-age (19800 s, kept at most 1 h) the keys are fetched again.
    fake.advance(3601 * 1000);
    expect(await verifyPushToken(bearer(fake.signPushToken()), cfg, fake.now())).toBe(true);
    expect(certsCalls()).toBe(3);
  });
});
