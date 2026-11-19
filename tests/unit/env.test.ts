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
