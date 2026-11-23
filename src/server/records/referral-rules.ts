// Pure rules of "Referred by" (SF-114 data-model.md § Validation, research.md §4–§5). No database: unit-tested directly.
import { toId } from "@/server/records/rules";

// What the form posts: "" (none), "<id>", or "keep" (only while a referrer hidden from the user is left untouched).
export type RequestedReferrer = { keep: true } | { id: number | null } | { invalid: true };

export type ReferrerDecision =
  | { kind: "keep" }
  | { kind: "none" }
  // A new referrer: the save's transaction checks it is an offered ambassador (isOfferedAmbassador).
  | { kind: "check"; id: number }
  | { kind: "refuse"; code: "referrer_self" | "referrer_invalid" };

export type ReferralEvent =
  | { kind: "referrer_set"; to: number }
  | { kind: "referrer_changed"; from: number; to: number }
  | { kind: "referrer_cleared" };

export function parseReferredBy(raw: string): RequestedReferrer {
  const text = (raw ?? "").trim();
  if (text === "") return { id: null };
  if (text === "keep") return { keep: true };
  const id = toId(text);
  return id === null ? { invalid: true } : { id };
}

// An unchanged referrer is always kept, even once no longer offered (FR-005); a person is never their own referrer.
export function decideReferrer(requested: RequestedReferrer, currentId: number | null, selfId: number | null): ReferrerDecision {
  if ("invalid" in requested) return { kind: "refuse", code: "referrer_invalid" };
  if ("keep" in requested || requested.id === currentId) return { kind: "keep" };
  if (requested.id === null) return { kind: "none" };
  if (requested.id === selfId) return { kind: "refuse", code: "referrer_self" };
  return { kind: "check", id: requested.id };
}

export function referralEvent(beforeId: number | null, afterId: number | null): ReferralEvent | null {
  if (beforeId === afterId) return null;
  if (afterId === null) return { kind: "referrer_cleared" };
  if (beforeId === null) return { kind: "referrer_set", to: afterId };
  return { kind: "referrer_changed", from: beforeId, to: afterId };
}
