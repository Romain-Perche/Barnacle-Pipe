// covers SF-116 US1 scenario 3, SC-002 (fix round 1): the proxy never runs on the fake Storage, so Next does not cut a
// 25 MB upload body at its 10 MB proxy limit; every app page and route still goes through it.
import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";

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
