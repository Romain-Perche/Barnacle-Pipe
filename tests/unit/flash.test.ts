// covers FR-003, FR-011 (SF-92): the one-shot notice shows only allowed codes, with a sane name and count
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

const { readFlash, setFlash } = await import("@/server/records/flash");
const { FLASH_COOKIE } = await import("@/server/records/flash-cookie");

function put(value: unknown) {
  jar.set(FLASH_COOKIE, typeof value === "string" ? value : JSON.stringify(value));
}

beforeEach(() => jar.clear());

describe("flash notices", () => {
  it("returns the text only for an allowed code", async () => {
    await setFlash({ code: "person_no_longer_visible", name: "Ada Example" });
    expect(await readFlash(["person_deleted", "person_no_longer_visible"])).toEqual({
      text: "You can no longer see Ada Example: only their creator and owner can.",
    });
    expect(await readFlash(["person_deleted"])).toBeUndefined();
    expect(await readFlash(["handed_over", "handover_none"])).toBeUndefined();
  });

  it("renders the hand-over notices", async () => {
    await setFlash({ code: "handed_over", name: "Margaret Fake", count: 2 });
    expect(await readFlash(["handed_over", "handover_none"])).toEqual({ text: "2 private people handed to Margaret Fake." });
    await setFlash({ code: "handover_none", name: "Alan Fake" });
    expect(await readFlash(["handed_over", "handover_none"])).toEqual({ text: "Alan Fake has no private people or deals to hand over." });
    await setFlash({ code: "person_deleted", name: "Ada Example" });
    expect(await readFlash(["person_deleted"])).toEqual({ text: "Ada Example was deleted." });
  });

  it("needs an integer count from 1 to 10,000 for handed_over", async () => {
    for (const count of [0, -1, 1.5, "2", undefined, 10_001]) {
      put({ code: "handed_over", name: "Margaret Fake", count });
      expect(await readFlash(["handed_over"]), String(count)).toBeUndefined();
    }
    put({ code: "handed_over", name: "Margaret Fake", count: 10_000 });
    expect(await readFlash(["handed_over"])).toEqual({ text: "10000 private people handed to Margaret Fake." });
  });

  // covers FR-006 (SF-97): the notice names both kinds; a cookie without deals still reads as people only
  it("renders people and deals counts for handed_over", async () => {
    await setFlash({ code: "handed_over", name: "Margaret Fake", count: 2, deals: 1 });
    expect(await readFlash(["handed_over"])).toEqual({ text: "2 private people and 1 private deal handed to Margaret Fake." });
    await setFlash({ code: "handed_over", name: "Margaret Fake", count: 0, deals: 2 });
    expect(await readFlash(["handed_over"])).toEqual({ text: "2 private deals handed to Margaret Fake." });
    put({ code: "handed_over", name: "Margaret Fake", count: 2 });
    expect(await readFlash(["handed_over"])).toEqual({ text: "2 private people handed to Margaret Fake." });
  });

  // covers FR-006 (SF-97)
  it("ignores invalid or zero deals counts", async () => {
    for (const [count, deals] of [[0, 0], [0, -1], [1, -1], [0, 1.5], [0, "1"], [0, 10_001], [-1, 2], [undefined, 1], [0, null]]) {
      put({ code: "handed_over", name: "Margaret Fake", count, deals });
      expect(await readFlash(["handed_over"]), `${count}/${deals}`).toBeUndefined();
    }
  });

  it("ignores long names, non-string names and invalid JSON", async () => {
    put({ code: "person_deleted", name: "x".repeat(301) });
    expect(await readFlash(["person_deleted"])).toBeUndefined();
    put({ code: "person_deleted", name: 3 });
    expect(await readFlash(["person_deleted"])).toBeUndefined();
    put("{not json");
    expect(await readFlash(["person_deleted"])).toBeUndefined();
    put({ code: "toString", name: "x" });
    expect(await readFlash(["person_deleted"])).toBeUndefined();
  });
});
