// covers SF-121 FR-002, FR-006, FR-012 (T007): token shape, the links and headers built from a base, the one-click body
import { describe, expect, it } from "vitest";
import { isOneClickBody, isTokenShape, unsubscribeLinks } from "@/server/records/unsubscribe-rules";

const token = "ab".repeat(32);

describe("isTokenShape", () => {
  it("accepts 64 lowercase hex characters only", () => {
    expect(isTokenShape(token)).toBe(true);
    expect(isTokenShape(`g${token.slice(1)}`)).toBe(false);
    expect(isTokenShape(token.slice(1))).toBe(false);
    expect(isTokenShape(`${token}a`)).toBe(false);
    expect(isTokenShape(token.toUpperCase())).toBe(false);
    expect(isTokenShape("")).toBe(false);
  });
});

describe("unsubscribeLinks", () => {
  it("builds the page link and both headers, with or without a trailing slash on the base", () => {
    const want = {
      pageUrl: `https://crm.example.test/unsubscribe/${token}`,
      listUnsubscribe: `<https://crm.example.test/unsubscribe/${token}/one-click>`,
      listUnsubscribePost: "List-Unsubscribe=One-Click",
    };
    expect(unsubscribeLinks("https://crm.example.test", token)).toEqual(want);
    expect(unsubscribeLinks("https://crm.example.test//", token)).toEqual(want);
  });
});

describe("isOneClickBody", () => {
  it("is true only for List-Unsubscribe=One-Click", () => {
    expect(isOneClickBody(new URLSearchParams("List-Unsubscribe=One-Click"))).toBe(true);
    const fd = new FormData();
    fd.set("List-Unsubscribe", "One-Click");
    expect(isOneClickBody(fd)).toBe(true);
    expect(isOneClickBody(new URLSearchParams("List-Unsubscribe=one-click"))).toBe(false);
    expect(isOneClickBody(new URLSearchParams(""))).toBe(false);
    expect(isOneClickBody(new URLSearchParams("Other=One-Click"))).toBe(false);
  });
});
