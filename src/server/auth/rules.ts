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
// The URL parser drops tab/CR/LF and reads "\\" as "/", so such values are refused outright; the rest is
// parsed against the app's base URL and the *parsed* path is returned, so the target is exactly what was checked.
export function isSafeNext(next: string | null | undefined, appUrl: string): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (/[\x00-\x1f\x7f\\]/.test(next) || next.startsWith("//")) return "/";
  let url: URL;
  let origin: string;
  try {
    url = new URL(next, appUrl);
    origin = new URL(appUrl).origin;
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  const path = url.pathname;
  // "/.//evil.com" parses to the path "//evil.com", which a browser would read as another site.
  if (path.startsWith("//") || path === "/auth" || path.startsWith("/auth/")) return "/";
  return path + url.search + url.hash;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function displayNameFor(email: string, googleName: string | null | undefined): string {
  const name = (googleName ?? "").trim();
  return name !== "" ? name : normalizeEmail(email).split("@")[0];
}
