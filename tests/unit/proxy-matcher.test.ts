// covers SF-116 US1 scenario 3, SC-002 (fix round 1): the proxy never runs on the fake Storage, so Next does not cut a
// 25 MB upload body at its 10 MB proxy limit; every app page and route still goes through it.
import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });
const uuid = "4f6c2d1e-8a3b-4c5d-9e7f-0a1b2c3d4e5f";

describe("proxy matcher", () => {
  it("skips the fake Storage", () => {
    expect(matches(`/dev/fake-storage/object/upload/sign/files/${uuid}?token=x`)).toBe(false);
    expect(matches(`/dev/fake-storage/object/sign/files/${uuid}`)).toBe(false);
  });

  it("still runs on the app's pages and routes", () => {
    for (const url of ["/deals", "/files/1/download", "/sign-in", "/dev/fake-google"]) expect(matches(url)).toBe(true);
  });
});

// covers SF-118 FR-015, T015: Google's push, Vercel's cron and the two fake Gmail pages pass without a session (they
// check their own proof); the Settings page and the Gmail callback still need one.
describe("proxy without a session (SF-118)", () => {
  const run = (path: string, method = "GET") => proxy(new NextRequest(new URL(path, "http://localhost:3000"), { method }));
  it.each([
    ["/gmail/push", "POST"],
    ["/cron/gmail", "GET"],
    ["/dev/fake-google/gmail", "GET"],
    ["/dev/fake-google/gmail/answer", "POST"],
    ["/dev/fake-gmail", "GET"],
    ["/dev/fake-gmail/", "GET"],
  ])("lets %s through", (path, method) => {
    expect(matches(path)).toBe(true);
    expect(run(path, method).headers.get("location")).toBeNull();
  });
  it.each(["/settings", "/settings/gmail/callback?code=x&state=y", "/gmail/push/x", "/cron/gmail/other", "/dev/fake-gmail/x"])(
    "sends %s to sign-in",
    (path) => {
      expect(run(path).headers.get("location")).toMatch(/^http:\/\/localhost:3000\/sign-in\?next=/);
    },
  );
});

// covers SF-121 FR-001, US2 scenario 1, FR-017 (T012, T019, T035): the unsubscribe page, its button, one-click and the
// development links page need no session; anything else still goes to sign-in
describe("public unsubscribe addresses (SF-121)", () => {
  const hex = "ab".repeat(32);
  const toSignIn = (path: string, method = "GET") => {
    const res = proxy(new NextRequest(`http://localhost:3000${path}`, { method }));
    return (res.headers.get("location") ?? "").includes("/sign-in");
  };
  it("lets the page, the button, one-click and the dev links page through with no cookie", () => {
    expect(toSignIn(`/unsubscribe/${hex}`)).toBe(false);
    expect(toSignIn(`/unsubscribe/${hex}/confirm`, "POST")).toBe(false);
    expect(toSignIn(`/unsubscribe/${hex}/one-click`, "POST")).toBe(false);
    expect(toSignIn("/dev/unsubscribe-links")).toBe(false);
    for (const url of [`/unsubscribe/${hex}`, `/unsubscribe/${hex}/one-click`, "/dev/unsubscribe-links"]) expect(matches(url)).toBe(true);
  });
  it("still sends other addresses to sign-in", () => {
    expect(toSignIn("/unsubscribeX")).toBe(true);
    expect(toSignIn("/unsubscribe")).toBe(true);
    expect(toSignIn(`/unsubscribe/${hex}/other`)).toBe(true);
    expect(toSignIn("/people")).toBe(true);
  });
});
