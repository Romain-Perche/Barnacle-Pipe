import { afterEach, describe, expect, it, vi } from "vitest";
import { firstAdminEmail, isFakeAllowed, isPreview } from "@/server/env";

function withEnv(env: Record<string, string | undefined>) {
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

afterEach(() => vi.unstubAllEnvs());

describe("isFakeAllowed", () => {
  // covers FR-026, US3 scenario 4, SC-007
  it.each(["production", "Development", "dev", "TEST", "", " development", undefined])(
    "is false for APP_ENV=%s",
    (appEnv) => {
      withEnv({ APP_ENV: appEnv, VERCEL_ENV: undefined });
      expect(isFakeAllowed()).toBe(false);
    },
  );
  it.each([
    ["development", "production"],
    ["development", "preview"],
    ["test", "production"],
    ["test", "preview"],
  ])("is false for APP_ENV=%s with VERCEL_ENV=%s", (appEnv, vercelEnv) => {
    withEnv({ APP_ENV: appEnv, VERCEL_ENV: vercelEnv });
    expect(isFakeAllowed()).toBe(false);
  });
  it.each([
    ["development", undefined],
    ["development", "development"],
    ["test", undefined],
    ["test", ""],
  ])("is true for APP_ENV=%s with VERCEL_ENV=%s", (appEnv, vercelEnv) => {
    withEnv({ APP_ENV: appEnv, VERCEL_ENV: vercelEnv });
    expect(isFakeAllowed()).toBe(true);
  });
});

describe("isPreview / firstAdminEmail", () => {
  // covers FR-028
  it("isPreview only for VERCEL_ENV=preview", () => {
    withEnv({ VERCEL_ENV: "preview" });
    expect(isPreview()).toBe(true);
    withEnv({ VERCEL_ENV: "production" });
    expect(isPreview()).toBe(false);
  });
  // covers FR-003, edge case "no first admin set"
  it("firstAdminEmail is normalised, empty is null", () => {
    withEnv({ FIRST_ADMIN_EMAIL: "  Boss@Barnacle.ai " });
    expect(firstAdminEmail()).toBe("boss@barnacle.ai");
    withEnv({ FIRST_ADMIN_EMAIL: "  " });
    expect(firstAdminEmail()).toBeNull();
    withEnv({ FIRST_ADMIN_EMAIL: undefined });
    expect(firstAdminEmail()).toBeNull();
  });
});

// covers SF-116 FR-015, Clarifications "no file store set up" (contracts/storage.md § Settings)
import { storageConfig } from "@/server/env";
describe("storageConfig", () => {
  it("uses Supabase when SUPABASE_URL is set (trailing slash removed, default bucket crm-files)", () => {
    withEnv({ APP_ENV: "production", SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_SECRET_KEY: "k", FILES_BUCKET: undefined });
    expect(storageConfig()).toEqual({ mode: "supabase", baseUrl: "https://abc.supabase.co/storage/v1", key: "k", bucket: "crm-files" });
    withEnv({ APP_ENV: "test", SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: "k", FILES_BUCKET: "other" });
    expect(storageConfig()).toMatchObject({ mode: "supabase", bucket: "other" });
  });
  it.each(["development", "test"])("uses the fake with APP_ENV=%s and no SUPABASE_URL", (appEnv) => {
    withEnv({ APP_ENV: appEnv, VERCEL_ENV: undefined, SUPABASE_URL: "", APP_URL: "http://localhost:3000/" });
    expect(storageConfig()).toEqual({ mode: "fake", baseUrl: "http://localhost:3000/dev/fake-storage", key: "fake-storage-key", bucket: "crm-files" });
  });
  it.each([
    ["production", undefined],
    ["development", "production"],
    ["test", "preview"],
  ])("is off with APP_ENV=%s, VERCEL_ENV=%s and no SUPABASE_URL", (appEnv, vercelEnv) => {
    withEnv({ APP_ENV: appEnv, VERCEL_ENV: vercelEnv, SUPABASE_URL: undefined });
    expect(storageConfig()).toEqual({ mode: "off" });
  });
  it("is off when the URL is set without its key", () => {
    withEnv({ APP_ENV: "production", SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: "" });
    expect(storageConfig()).toEqual({ mode: "off" });
  });
});

// covers SF-117 FR-030, FR-003, Clarifications "no token encryption key" (contracts/pipedrive-api.md § Settings)
import { pipedriveConfig } from "@/server/env";
describe("pipedriveConfig", () => {
  const key32 = Buffer.alloc(32, 7).toString("base64");
  it.each(["development", "test"])("uses the fake with APP_ENV=%s and no PIPEDRIVE_URL", (appEnv) => {
    withEnv({ APP_ENV: appEnv, VERCEL_ENV: undefined, PIPEDRIVE_URL: "", PIPEDRIVE_TOKEN_KEY: key32 });
    const c = pipedriveConfig();
    expect(c.mode).toBe("fake");
    expect(c.baseUrl).toBe("https://fake.pipedrive.invalid");
    expect(c.key?.equals(Buffer.alloc(32, 7))).toBe(true);
  });
  it("uses the real Pipedrive when fakes are refused (VERCEL_ENV=production), whatever APP_ENV says", () => {
    withEnv({ APP_ENV: "development", VERCEL_ENV: "production", PIPEDRIVE_URL: undefined, PIPEDRIVE_TOKEN_KEY: key32 });
    expect(pipedriveConfig()).toMatchObject({ mode: "real", baseUrl: "https://api.pipedrive.com" });
    withEnv({ APP_ENV: "production", PIPEDRIVE_URL: undefined });
    expect(pipedriveConfig()).toMatchObject({ mode: "real", baseUrl: "https://api.pipedrive.com" });
  });
  it("uses PIPEDRIVE_URL when set (trimmed, without a trailing slash), even where fakes are allowed", () => {
    withEnv({ APP_ENV: "test", PIPEDRIVE_URL: " http://localhost:9999/ ", PIPEDRIVE_TOKEN_KEY: key32 });
    expect(pipedriveConfig()).toMatchObject({ mode: "real", baseUrl: "http://localhost:9999" });
  });
  it.each([
    ["empty", ""],
    ["unset", undefined],
    ["31 bytes", Buffer.alloc(31, 1).toString("base64")],
    ["33 bytes", Buffer.alloc(33, 1).toString("base64")],
    ["not base64", "not a key at all, really not!!"],
  ])("has no key when PIPEDRIVE_TOKEN_KEY is %s", (_what, value) => {
    withEnv({ APP_ENV: "test", PIPEDRIVE_URL: "", PIPEDRIVE_TOKEN_KEY: value });
    expect(pipedriveConfig().key).toBeNull();
  });
});

// covers SF-118 FR-003, FR-018, edge case "Gmail not set up" (research.md §12, contracts/google.md § Settings)
import { gmailConfig, readTokenKey } from "@/server/env";
describe("readTokenKey", () => {
  it("decodes base64 of exactly 32 bytes (trimmed), else null", () => {
    expect(readTokenKey(` ${Buffer.alloc(32, 5).toString("base64")} `)?.equals(Buffer.alloc(32, 5))).toBe(true);
    for (const raw of ["", undefined, Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"), "not a key at all, really not!!"]) {
      expect(readTokenKey(raw), String(raw)).toBeNull();
    }
  });
});
describe("gmailConfig", () => {
  const key = Buffer.alloc(32, 8).toString("base64");
  const real = {
    APP_ENV: "production",
    VERCEL_ENV: undefined,
    GMAIL_PUBSUB_TOPIC: "projects/crm-fake/topics/gmail",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    APP_URL: "https://crm.example.test/",
    GMAIL_TOKEN_KEY: key,
    GMAIL_PUSH_SERVICE_ACCOUNT: "push@crm-fake.iam.gserviceaccount.com",
    GMAIL_PUSH_AUDIENCE: undefined,
    GMAIL_PUSH_SUBSCRIPTION: undefined,
    CRON_SECRET: "a-cron-secret-of-16+",
  };
  it("is real when the topic and every setting are valid; the audience defaults to APP_URL/gmail/push", () => {
    withEnv(real);
    const c = gmailConfig();
    if (c.mode !== "real") throw new Error(c.mode);
    expect(c).toMatchObject({ topic: "projects/crm-fake/topics/gmail", appUrl: "https://crm.example.test", pushAudience: "https://crm.example.test/gmail/push", pushSubscription: null });
    expect(c.tokenKey.equals(Buffer.alloc(32, 8))).toBe(true);
    withEnv({ ...real, GMAIL_PUSH_AUDIENCE: "https://aud.example.test", GMAIL_PUSH_SUBSCRIPTION: "projects/p/subscriptions/s" });
    expect(gmailConfig()).toMatchObject({ pushAudience: "https://aud.example.test", pushSubscription: "projects/p/subscriptions/s" });
  });
  it.each([
    ["GOOGLE_CLIENT_ID", ""],
    ["GOOGLE_CLIENT_SECRET", ""],
    ["APP_URL", ""],
    ["GMAIL_TOKEN_KEY", Buffer.alloc(31).toString("base64")],
    ["GMAIL_PUSH_SERVICE_ACCOUNT", ""],
    ["CRON_SECRET", "short-15-chars!"],
  ])("is off with a topic but %s=%j", (name, value) => {
    withEnv({ ...real, [name]: value });
    expect(gmailConfig()).toEqual({ mode: "off" });
  });
  it.each(["development", "test"])("is fake with APP_ENV=%s, no topic and a key", (appEnv) => {
    withEnv({ ...real, APP_ENV: appEnv, GMAIL_PUBSUB_TOPIC: "", GOOGLE_CLIENT_ID: "", CRON_SECRET: "", APP_URL: "" });
    expect(gmailConfig()).toMatchObject({ mode: "fake", appUrl: "http://localhost:3000" });
  });
  it("is off without a key even where fakes are allowed (no built-in key), and without a topic in production", () => {
    withEnv({ ...real, APP_ENV: "test", GMAIL_PUBSUB_TOPIC: "", GMAIL_TOKEN_KEY: "" });
    expect(gmailConfig()).toEqual({ mode: "off" });
    withEnv({ ...real, GMAIL_PUBSUB_TOPIC: "" });
    expect(gmailConfig()).toEqual({ mode: "off" });
    withEnv({ ...real, APP_ENV: "development", VERCEL_ENV: "preview", GMAIL_PUBSUB_TOPIC: "" });
    expect(gmailConfig()).toEqual({ mode: "off" });
  });
});
