// Reads the app's settings (contracts/settings-and-commands.md). Always read at call time, never at import.
import { normalizeEmail } from "@/server/auth/rules";

export function appEnv(): string | undefined {
  return process.env.APP_ENV;
}

// Fake Google login and fake data: only when APP_ENV is exactly "development" or "test",
// and never on a Vercel production or preview deployment, whatever APP_ENV says (FR-026).
export function isFakeAllowed(): boolean {
  const app = process.env.APP_ENV;
  const vercel = process.env.VERCEL_ENV;
  return (app === "development" || app === "test") && vercel !== "production" && vercel !== "preview";
}

// Preview deployments only build: no database, nobody signs in (FR-028).
export function isPreview(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export function firstAdminEmail(): string | null {
  const value = normalizeEmail(process.env.FIRST_ADMIN_EMAIL ?? "");
  return value === "" ? null : value;
}

// The app's base URL, only to anchor the parse of a return path (isSafeNext): APP_URL without a trailing
// slash, or http://localhost:3000 when unset (a fake-login-only copy may not set APP_URL).
export function appBaseUrl(): string {
  return (process.env.APP_URL ?? "").replace(/\/+$/, "") || "http://localhost:3000";
}

export type GoogleConfig = { clientId: string; clientSecret: string; appUrl: string };

export function googleConfig(): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const missing = [
    !clientId && "GOOGLE_CLIENT_ID",
    !clientSecret && "GOOGLE_CLIENT_SECRET",
    !appUrl && "APP_URL",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Google sign-in is not configured: set ${missing.join(", ")}.`);
  }
  return { clientId, clientSecret, appUrl };
}
