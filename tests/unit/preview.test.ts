// covers FR-028, edge case "a preview deployment is opened": no database is touched, nobody signs in
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as googleStart } from "@/app/auth/google/start/route";
import { requireUser } from "@/server/auth/session";
import { signInPageState } from "@/server/sign-in-page";

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("DATABASE_URL", ""); // any database access would throw
});
afterEach(() => vi.unstubAllEnvs());

function redirectTarget(err: unknown): string | undefined {
  const digest = (err as { digest?: string }).digest ?? "";
  return digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] : undefined;
}

describe("preview deployments", () => {
  it("the sign-in page shows the preview notice without touching the database", async () => {
    expect(await signInPageState({})).toEqual({ kind: "notice", code: "preview" });
  });

  it("/auth/google/start redirects to /sign-in", async () => {
    const res = await googleStart(new NextRequest("http://localhost:3000/auth/google/start?next=/"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("requireUser() redirects to /sign-in", async () => {
    const err = await requireUser().then(
      () => null,
      (e: unknown) => e,
    );
    expect(redirectTarget(err)).toBe("/sign-in");
  });
});

describe("sign-in page state outside previews", () => {
  beforeEach(() => vi.stubEnv("VERCEL_ENV", ""));

  // covers edge case "no first admin set and no users"
  it("shows the setup notice when FIRST_ADMIN_EMAIL is empty and there are no users", async () => {
    vi.stubEnv("FIRST_ADMIN_EMAIL", "");
    expect(await signInPageState({}, async () => 0)).toEqual({ kind: "notice", code: "setup" });
  });

  it("shows the form when users exist, with the error text from the code only", async () => {
    vi.stubEnv("FIRST_ADMIN_EMAIL", "");
    expect(await signInPageState({ error: "removed", next: "/admin/users" }, async () => 3)).toEqual({
      kind: "form",
      error: "Your access has been removed. Ask an admin if this is a mistake.",
      fake: true,
      next: "/admin/users",
    });
    const unknown = await signInPageState({ error: "<script>alert(1)</script>", next: "//evil.com" }, async () => 3);
    expect(unknown).toEqual({ kind: "form", error: undefined, fake: true, next: "/" });
  });

  it("shows the form when the first admin is set, even with no users; no fake link outside development/test", async () => {
    vi.stubEnv("FIRST_ADMIN_EMAIL", "boss@barnacle.ai");
    vi.stubEnv("APP_ENV", "production");
    expect(await signInPageState({}, async () => 0)).toEqual({ kind: "form", error: undefined, fake: false, next: "/" });
  });

  it("never shows a Users-page message on the sign-in page", async () => {
    expect(await signInPageState({ error: "duplicate" }, async () => 1)).toMatchObject({ kind: "form", error: undefined });
  });
});
