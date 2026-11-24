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
