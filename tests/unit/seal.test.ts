// covers SF-118 FR-003, SC-004, and SF-117 FR-003, SC-007: one shared AES-256-GCM seal for saved tokens of outside
// services, bound to its user and its purpose ("pipedrive-token", "gmail-token"); Pipedrive tokens sealed before the
// move still open.
import { describe, expect, it } from "vitest";
import { openToken, sealToken, TokenUnreadable } from "@/server/crypto/seal";

const key = Buffer.alloc(32, 3);
const token = "test-token-0123456789abcdef0123456789abcdef";
const PURPOSES = ["pipedrive-token", "gmail-token"] as const;

describe("sealToken / openToken", () => {
  it.each(PURPOSES)("opens what it sealed, for the same purpose, user and key (%s)", (purpose) => {
    expect(openToken(key, purpose, 7, sealToken(key, purpose, 7, token))).toBe(token);
  });
  it("starts with version 1, then a 12-byte IV and a 16-byte tag", () => {
    const sealed = sealToken(key, "gmail-token", 7, token);
    expect(sealed[0]).toBe(1);
    expect(sealed.length).toBe(1 + 12 + 16 + Buffer.byteLength(token));
  });
  it("refuses another user id, another purpose, another key, a flipped byte, version 2 or a short value", () => {
    const sealed = sealToken(key, "gmail-token", 7, token);
    expect(() => openToken(key, "gmail-token", 8, sealed)).toThrow(TokenUnreadable);
    expect(() => openToken(key, "pipedrive-token", 7, sealed)).toThrow(TokenUnreadable);
    expect(() => openToken(key, "pipedrive-token", 7, sealToken(key, "gmail-token", 7, token))).toThrow(TokenUnreadable);
    expect(() => openToken(Buffer.alloc(32, 4), "gmail-token", 7, sealed)).toThrow(TokenUnreadable);
    for (const at of [5, 20, sealed.length - 1]) {
      const flipped = Buffer.from(sealed);
      flipped[at] ^= 1;
      expect(() => openToken(key, "gmail-token", 7, flipped), String(at)).toThrow(TokenUnreadable);
    }
    const v2 = Buffer.from(sealed);
    v2[0] = 2;
    expect(() => openToken(key, "gmail-token", 7, v2)).toThrow(TokenUnreadable);
    expect(() => openToken(key, "gmail-token", 7, Buffer.alloc(10))).toThrow(TokenUnreadable);
  });
  it("throws a neutral message that holds no part of the token", () => {
    try {
      openToken(key, "gmail-token", 8, sealToken(key, "gmail-token", 7, token));
      throw new Error("opened");
    } catch (e) {
      expect(e).toBeInstanceOf(TokenUnreadable);
      expect((e as Error).message).not.toMatch(/Pipedrive|Gmail/);
      expect((e as Error).message).not.toContain(token.slice(11, 19));
    }
  });
  it("holds neither the token nor its base64", () => {
    const sealed = sealToken(key, "gmail-token", 7, token);
    expect(sealed.includes(Buffer.from(token))).toBe(false);
    expect(sealed.toString("latin1")).not.toContain(token.slice(0, 8));
    expect(sealed.toString("base64")).not.toContain(Buffer.from(token).toString("base64").slice(0, 12));
  });
  it("seals one token differently each time (random IV)", () => {
    expect(sealToken(key, "gmail-token", 7, token).equals(sealToken(key, "gmail-token", 7, token))).toBe(false);
  });
  it("still opens a token sealed by SF-117's pipedrive/crypto.ts before the move", () => {
    // Made once with SF-117's sealToken(Buffer.alloc(32, 9), 42, "sf117-sample-token-abc123").
    const sample = Buffer.from("AZLLl/JOa0rw67hpBK/jHavLICJEqnzyeZfA4zbyGDrwYHyBCX/aSQwA8F/d+DBnKNKDw41u", "base64");
    expect(openToken(Buffer.alloc(32, 9), "pipedrive-token", 42, sample)).toBe("sf117-sample-token-abc123");
    expect(() => openToken(Buffer.alloc(32, 9), "gmail-token", 42, sample)).toThrow(TokenUnreadable);
  });
});
