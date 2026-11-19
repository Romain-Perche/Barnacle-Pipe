// Every user-facing message, by code. The single source of these texts (contracts/routes.md § Messages).
// Pages look codes up here; text from a URL is never shown.
export const messages = {
  domain: "Only barnacle.ai Google accounts can sign in.",
  not_allowed: "This account doesn't have access yet. Ask an admin to add you.",
  removed: "Your access has been removed. Ask an admin if this is a mistake.",
  cancelled: "Sign-in was cancelled or failed. Please try again.",
  setup: "The CRM isn't set up yet. No first admin has been named.",
  preview: "Sign-in is turned off on preview deployments.",
  invalid_domain: "Only barnacle.ai addresses can be added.",
  duplicate: "This person is already a user.",
  last_admin: "The CRM must always have at least one active admin.",
  self_deactivate: "You can't deactivate yourself.",
  forbidden: "You don't have access to this page.",
  not_found: "Page not found.",
  seed_refused: "Fake data can only be loaded when APP_ENV is development or test.",
} as const;

export type MessageCode = keyof typeof messages;

export function messageFor(code: string | null | undefined): string | undefined {
  if (!code || !Object.hasOwn(messages, code)) return undefined;
  return messages[code as MessageCode];
}
