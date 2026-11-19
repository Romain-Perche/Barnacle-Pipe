// Pure sign-in rules (research.md §3). No database, no Next.js: unit-tested directly.

export const DOMAIN = "barnacle.ai";
const BARNACLE_EMAIL = /^[a-z0-9._%+-]+@barnacle\.ai$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isBarnacleEmail(email: string): boolean {
  return BARNACLE_EMAIL.test(normalizeEmail(email));
}

export type GoogleIdentity = { email: string; emailVerified: boolean; hd: string | null };
export type SignInDecision = "ok" | "create_first_admin" | "domain" | "removed" | "not_allowed";

// existingUser: the user row found for the normalised email, or null.
export function decideSignIn(
  identity: GoogleIdentity,
  existingUser: { status: "active" | "deactivated" } | null,
  firstAdminEmail: string | null,
): SignInDecision {
  const email = normalizeEmail(identity.email);
  if (!identity.emailVerified || !isBarnacleEmail(email)) return "domain";
  if (identity.hd !== null && identity.hd.toLowerCase() !== DOMAIN) return "domain";
  if (existingUser) return existingUser.status === "active" ? "ok" : "removed";
  if (firstAdminEmail !== null && email === normalizeEmail(firstAdminEmail)) return "create_first_admin";
  return "not_allowed";
}

// Where to go after sign-in: an in-app path only, else "/" (FR-009, no open redirect).
export function isSafeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next === "/auth" || next.startsWith("/auth/") || next.startsWith("/auth?")) return "/";
  return next;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function displayNameFor(email: string, googleName: string | null | undefined): string {
  const name = (googleName ?? "").trim();
  return name !== "" ? name : normalizeEmail(email).split("@")[0];
}
