// covers SF-117 FR-003, SC-007: the token is sealed with AES-256-GCM, bound to its user, never stored in plain text
import { describe, expect, it } from "vitest";
import { openToken, sealToken, TokenUnreadable } from "@/server/pipedrive/crypto";

const key = Buffer.alloc(32, 3);
const token = "test-token-0123456789abcdef0123456789abcdef";

describe("sealToken / openToken", () => {
  it("opens what it sealed, for the same user and key", () => {
    expect(openToken(key, 7, sealToken(key, 7, token))).toBe(token);
  });
  it("starts with version 1, then a 12-byte IV and a 16-byte tag", () => {
    const sealed = sealToken(key, 7, token);
    expect(sealed[0]).toBe(1);
    expect(sealed.length).toBe(1 + 12 + 16 + Buffer.byteLength(token));
  });
  it("refuses another user id, another key, a flipped byte, version 2 or a short value", () => {
    const sealed = sealToken(key, 7, token);
    expect(() => openToken(key, 8, sealed)).toThrow(TokenUnreadable);
    expect(() => openToken(Buffer.alloc(32, 4), 7, sealed)).toThrow(TokenUnreadable);
    for (const at of [5, 20, sealed.length - 1]) {
      const flipped = Buffer.from(sealed);
      flipped[at] ^= 1;
      expect(() => openToken(key, 7, flipped), String(at)).toThrow(TokenUnreadable);
    }
    const v2 = Buffer.from(sealed);
    v2[0] = 2;
    expect(() => openToken(key, 7, v2)).toThrow(TokenUnreadable);
    expect(() => openToken(key, 7, Buffer.alloc(10))).toThrow(TokenUnreadable);
  });
  it("holds neither the token nor its base64", () => {
    const sealed = sealToken(key, 7, token);
    expect(sealed.includes(Buffer.from(token))).toBe(false);
    expect(sealed.toString("latin1")).not.toContain(token.slice(0, 8));
    expect(sealed.toString("base64")).not.toContain(Buffer.from(token).toString("base64").slice(0, 12));
  });
  it("seals one token differently each time (random IV)", () => {
    expect(sealToken(key, 7, token).equals(sealToken(key, 7, token))).toBe(false);
  });
});
