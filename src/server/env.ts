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

// SF-116 (contracts/storage.md § Settings): where file contents are kept. Supabase Storage when SUPABASE_URL (and its
// secret key) is set; the fake storage of src/server/files/fake-storage.ts when it is empty and fakes are allowed;
// otherwise "off": every file action answers "Files can't be reached right now." and the rest of the app works.
export type StorageConfig =
  | { mode: "supabase" | "fake"; baseUrl: string; key: string; bucket: string }
  | { mode: "off" };

export function storageConfig(): StorageConfig {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  const bucket = (process.env.FILES_BUCKET ?? "").trim() || "crm-files";
  if (url) return key ? { mode: "supabase", baseUrl: `${url}/storage/v1`, key, bucket } : { mode: "off" };
  if (isFakeAllowed()) return { mode: "fake", baseUrl: `${appBaseUrl()}/dev/fake-storage`, key: "fake-storage-key", bucket };
  return { mode: "off" };
}

// SF-117 (contracts/pipedrive-api.md § Settings): where Pipedrive is and the key that seals saved tokens. PIPEDRIVE_URL
// when set; else the in-process fake (src/server/pipedrive/fake-pipedrive.ts) where fakes are allowed, else the real
// Pipedrive. `key`: PIPEDRIVE_TOKEN_KEY decoded from base64 when it is exactly 32 bytes, else null ("isn't set up yet").
// There is no built-in key: a copied .env.example can never carry a usable key to production.
export type PipedriveConfig = { mode: "real" | "fake"; baseUrl: string; key: Buffer | null };

export function pipedriveConfig(): PipedriveConfig {
  const url = (process.env.PIPEDRIVE_URL ?? "").trim().replace(/\/+$/, "");
  const key = readTokenKey(process.env.PIPEDRIVE_TOKEN_KEY);
  if (url) return { mode: "real", baseUrl: url, key };
  if (isFakeAllowed()) return { mode: "fake", baseUrl: "https://fake.pipedrive.invalid", key };
  return { mode: "real", baseUrl: "https://api.pipedrive.com", key };
}

// SF-117 / SF-118 (research.md §4): a token-sealing key (PIPEDRIVE_TOKEN_KEY, GMAIL_TOKEN_KEY) is base64 of exactly 32
// bytes, spaces around it ignored; anything else is no key.
export function readTokenKey(raw: string | undefined): Buffer | null {
  const value = (raw ?? "").trim();
  const decoded = /^[A-Za-z0-9+/]+={0,2}$/.test(value) ? Buffer.from(value, "base64") : null;
  return decoded && decoded.length === 32 ? decoded : null;
}

// SF-118 (research.md §12, contracts/google.md § Settings): Gmail is
// - real when GMAIL_PUBSUB_TOPIC is set and the Google client, APP_URL, GMAIL_TOKEN_KEY, the push service account and
//   CRON_SECRET (16 characters or more) are all valid;
// - fake (src/server/gmail/fake-gmail.ts) when there is no topic, fakes are allowed and GMAIL_TOKEN_KEY is valid (no
//   built-in key, as for Pipedrive);
// - else off: Settings says "Gmail can't be connected right now.", the cron and push routes do nothing.
export type GmailConfig =
  | {
      mode: "real" | "fake";
      clientId: string;
      clientSecret: string;
      appUrl: string;
      tokenKey: Buffer;
      topic: string;
      pushAudience: string;
      pushServiceAccount: string;
      pushSubscription: string | null;
      cronSecret: string;
    }
  | { mode: "off" };

export const FAKE_GMAIL = {
  clientId: "fake-gmail-client.apps.googleusercontent.com",
  clientSecret: "fake-gmail-client-secret",
  topic: "projects/crm-fake/topics/gmail-fake",
  pushServiceAccount: "gmail-push-fake@crm-fake.iam.gserviceaccount.com",
  pushSubscription: "projects/crm-fake/subscriptions/gmail-push-fake",
} as const;

export function gmailConfig(): GmailConfig {
  const env = process.env;
  const topic = (env.GMAIL_PUBSUB_TOPIC ?? "").trim();
  const tokenKey = readTokenKey(env.GMAIL_TOKEN_KEY);
  const cronSecret = env.CRON_SECRET ?? "";
  const pushSubscription = (env.GMAIL_PUSH_SUBSCRIPTION ?? "").trim() || null;
  if (topic) {
    const clientId = env.GOOGLE_CLIENT_ID ?? "";
    const clientSecret = env.GOOGLE_CLIENT_SECRET ?? "";
    const appUrl = (env.APP_URL ?? "").trim().replace(/\/+$/, "");
    const pushServiceAccount = (env.GMAIL_PUSH_SERVICE_ACCOUNT ?? "").trim();
    if (!clientId || !clientSecret || !appUrl || !tokenKey || !pushServiceAccount || cronSecret.length < 16) return { mode: "off" };
    const pushAudience = (env.GMAIL_PUSH_AUDIENCE ?? "").trim() || `${appUrl}/gmail/push`;
    return { mode: "real", clientId, clientSecret, appUrl, tokenKey, topic, pushAudience, pushServiceAccount, pushSubscription, cronSecret };
  }
  if (!isFakeAllowed() || !tokenKey) return { mode: "off" };
  const appUrl = appBaseUrl();
  return {
    mode: "fake",
    clientId: FAKE_GMAIL.clientId,
    clientSecret: FAKE_GMAIL.clientSecret,
    appUrl,
    tokenKey,
    topic: FAKE_GMAIL.topic,
    pushAudience: (env.GMAIL_PUSH_AUDIENCE ?? "").trim() || `${appUrl}/gmail/push`,
    pushServiceAccount: FAKE_GMAIL.pushServiceAccount,
    pushSubscription: FAKE_GMAIL.pushSubscription,
    cronSecret,
  };
}

// SF-124 (research.md §16, contracts/google.md § Settings): Google Calendar sync is on when CALENDAR_SYNC is exactly "on"
// and Gmail is set up (real or fake); it then uses Gmail's connection, key and mode. Google posts change notices to
// `${appUrl}/calendar/push` (in fake mode the fake delivers them in process).
export type CalendarConfig = { mode: "off" } | { mode: "real" | "fake"; pushAddress: string };

export function calendarConfig(): CalendarConfig {
  const g = gmailConfig();
  if ((process.env.CALENDAR_SYNC ?? "").trim() !== "on" || g.mode === "off") return { mode: "off" };
  return { mode: g.mode, pushAddress: `${g.appUrl}/calendar/push` };
}
