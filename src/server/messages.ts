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
  choice_removed_exists: "A removed entry already has this name. Add it again to bring it back.",
  choice_name_required: "Enter a name.",
  no_people_match: "No people match these filters.",
  no_organisations_match: "No organisations match these filters.",
  no_people_yet: "No people yet.",
  delete_confirm_label: "Confirm delete",
  delete_for_good: "[ DELETE FOR GOOD ]",
  delete_cancel: "[ CANCEL ]",
  // Pipelines, deals and the board (SF-93)
  deal_title_required: "Enter a deal title.",
  deal_title_too_long: "Keep the title under 200 characters.",
  deal_value_invalid: "Enter a value in pounds, for example 4000 or 4000.50.",
  deal_stage_required: "Choose a pipeline and stage.",
  deal_close_date_invalid: "Enter a valid date.",
  deal_edit_conflict: "Someone else changed this deal while you were editing. Reload to see their changes.",
  deal_changed: "This deal changed since you loaded the board. The board has been refreshed.",
  deal_move_failed: "The deal could not be moved. Try again.",
  no_pipelines_yet: "No pipelines yet.",
  no_stages_yet: "This pipeline has no stages yet.",
  no_deals_in_stage: "No deals in this stage.",
  pipeline_name_required: "Enter a name.",
  pipeline_name_exists: "This name is already used.",
  stage_last_with_deals: "A pipeline with deals needs at least one stage.",
  stage_target_invalid: "Choose another stage of this pipeline to move the deals to.",
  pipeline_target_invalid: "Choose a stage in another pipeline to move the deals to.",
  pipeline_delete_no_target: "Add a stage to another pipeline first, so its deals have somewhere to go.",
} as const;

// Messages built from a record's name, always read from the database. Kept apart from `messages` so a
// code taken from a URL can never produce them.
export const templates = {
  duplicate_email: (name: string) => `${name} already has this email address.`,
  organisation_exists: (name: string) => `${name} already exists.`,
  person_deleted: (name: string) => `${name} was deleted.`,
  organisation_deleted: (name: string) => `${name} was deleted.`,
  delete_confirm: (name: string) => `Delete ${name} for good? This can't be undone.`,
  deal_deleted: (title: string) => `${title} was deleted.`,
  deal_no_longer_visible: (title: string) => `You can no longer see ${title}: only its creator and owner can.`,
  deal_count: (n: number) => `${n} ${n === 1 ? "deal" : "deals"}`,
  pipeline_has_deals: (name: string, n: number) => `${name} has ${n} deals. Move them to:`,
  pipeline_delete_confirm: (name: string) => `Delete ${name}? This can't be undone.`,
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
