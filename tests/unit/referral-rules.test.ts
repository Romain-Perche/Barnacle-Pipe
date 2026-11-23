// covers SF-114 FR-005, FR-006, US2 scenarios 4, 5, 7 (data-model.md § Validation)
import { describe, expect, it } from "vitest";
import { decideReferrer, parseReferredBy, referralEvent } from "@/server/records/referral-rules";

describe("parseReferredBy", () => {
  it("reads empty as none, 'keep' as keep and a positive id", () => {
    expect(parseReferredBy("")).toEqual({ id: null });
    expect(parseReferredBy("  ")).toEqual({ id: null });
    expect(parseReferredBy("keep")).toEqual({ keep: true });
    expect(parseReferredBy("42")).toEqual({ id: 42 });
  });
  it("refuses anything else", () => {
    for (const raw of ["abc", "0", "-1", "1.5", "99999999999999999999", "KEEP"]) expect(parseReferredBy(raw)).toEqual({ invalid: true });
  });
});

describe("decideReferrer", () => {
  it("keeps the current referrer on 'keep' or the same id, even with no current one", () => {
    expect(decideReferrer({ keep: true }, 7, 1)).toEqual({ kind: "keep" });
    expect(decideReferrer({ keep: true }, null, 1)).toEqual({ kind: "keep" });
    expect(decideReferrer({ id: 7 }, 7, 1)).toEqual({ kind: "keep" });
    expect(decideReferrer({ id: null }, null, 1)).toEqual({ kind: "keep" });
  });
  it("clears on an empty value", () => {
    expect(decideReferrer({ id: null }, 7, 1)).toEqual({ kind: "none" });
  });
  it("refuses the person themselves and an invalid value", () => {
    expect(decideReferrer({ id: 1 }, null, 1)).toEqual({ kind: "refuse", code: "referrer_self" });
    expect(decideReferrer({ invalid: true }, 7, 1)).toEqual({ kind: "refuse", code: "referrer_invalid" });
  });
  it("asks for a database check on a new id (deals have no self)", () => {
    expect(decideReferrer({ id: 9 }, 7, 1)).toEqual({ kind: "check", id: 9 });
    expect(decideReferrer({ id: 9 }, null, null)).toEqual({ kind: "check", id: 9 });
  });
});

describe("referralEvent", () => {
  it("is null when nothing changed", () => {
    expect(referralEvent(null, null)).toBeNull();
    expect(referralEvent(3, 3)).toBeNull();
  });
  it("names set, changed and cleared", () => {
    expect(referralEvent(null, 3)).toEqual({ kind: "referrer_set", to: 3 });
    expect(referralEvent(2, 3)).toEqual({ kind: "referrer_changed", from: 2, to: 3 });
    expect(referralEvent(2, null)).toEqual({ kind: "referrer_cleared" });
  });
});
