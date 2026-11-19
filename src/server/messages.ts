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
  // People and organisations (SF-90)
  name_required: "Enter a first or last name.",
  email_invalid: "Enter a valid email address.",
  email_twice: "This email address is listed twice.",
  phone_invalid: "Enter a valid phone number.",
  linkedin_invalid: "Enter a LinkedIn profile link (linkedin.com/…).",
  website_invalid: "Enter a valid website address.",
  duplicate_email_hidden: "Another person already has this email address.",
  organisation_name_required: "Enter the organisation's name.",
  edit_conflict: "Someone else changed this person while you were editing. Reload to see their changes.",
  edit_conflict_organisation: "Someone else changed this organisation while you were editing. Reload to see their changes.",
  choice_exists: "This name is already on the list.",
  choice_name_required: "Enter a name.",
  no_people_match: "No people match these filters.",
  no_organisations_match: "No organisations match these filters.",
  no_people_yet: "No people yet.",
} as const;

// Messages built from a record's name, always read from the database. Kept apart from `messages` so a
// code taken from a URL can never produce them.
export const templates = {
  duplicate_email: (name: string) => `${name} already has this email address.`,
  organisation_exists: (name: string) => `${name} already exists.`,
  person_deleted: (name: string) => `${name} was deleted.`,
  organisation_deleted: (name: string) => `${name} was deleted.`,
} as const;

export type TemplateCode = keyof typeof templates;

// A form field's message: a template when the server gave a name, else a fixed text.
export function fieldMessage(error: { code: string; name?: string }): string | undefined {
  if (error.name !== undefined && (error.code === "duplicate_email" || error.code === "organisation_exists")) {
    return templates[error.code](error.name);
  }
  return messageFor(error.code);
}

export type MessageCode = keyof typeof messages;

export function messageFor(code: string | null | undefined): string | undefined {
  if (!code || !Object.hasOwn(messages, code)) return undefined;
  return messages[code as MessageCode];
}
