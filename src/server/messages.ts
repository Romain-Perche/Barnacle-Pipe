import { formatMoney } from "@/server/format";

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
  // Private and deleted people follow-ups (SF-92)
  private_label: "Private (only the creator and the owner can see this person)",
  deleted_person_linked: "A deleted person was linked",
  deleted_person_unlinked: "A deleted person was unlinked",
  handover_choose: "Choose a user",
  handover_choose_user: "Choose an active user.",
  handover_not_deactivated: "Only a deactivated user's private records can be handed over.",
  handover_explain_unchosen: "They stay private. The user you choose becomes their owner and can see them. You will not see who they are.",
  // SF-97: when private deals are handed over too
  handover_explain_unchosen_records: "They stay private. The user you choose becomes their owner and can see them. You will not see what they are.",
  handover_button: "[ HAND OVER ]",
  handover_cancel: "[ CANCEL ]",
  handover_to_label: "Hand over to",
  // Deal list and deal page (SF-95)
  deal_not_found: "This deal doesn't exist or you can't see it.",
  lost_question: "Why was this deal lost?",
  lost_reason_required: "Enter why this deal was lost.",
  lost_reason_too_long: "Keep the reason under 500 characters.",
  deal_person_already_linked: "This person is already linked to this deal.",
  deal_label_exists: "This name is already used.",
  no_deals_match: "No deals match these filters.",
  no_deals_yet: "No deals yet.",
  // CSV import (SF-103)
  import_note: "A CSV file saved as UTF-8, with column headings on the first row, up to 5,000 rows.",
  import_not_csv: "Save the file as CSV (UTF-8) and try again.",
  import_not_utf8: "Save the file as CSV (UTF-8) and try again.",
  import_no_rows: "The file has no rows to import.",
  import_too_large: "The file is larger than 5 MB.",
  import_too_many_rows: "The file has more than 5,000 rows. Split it into smaller files.",
  import_upload_failed: "The file could not be uploaded. Try again.",
  import_person_name_column: "Choose the column with each person's name.",
  import_organisation_name_column: "Choose the column with each organisation's name.",
  import_consent_required: "Choose Subscribed or Unsubscribed for the people with no consent in the file.",
  import_failed: "The import failed. Nothing was imported. Try again.",
  import_too_many_values: "This row has more values than the file has headings.",
  import_skip: "Don't import",
  import_full_name_ignored: "Full name is used only when no first or last name column is set.",
  // Timeline and notes (SF-102)
  note_required: "Write something before adding the note.",
  note_too_long: "Keep the note under 10,000 characters.",
  note_not_found: "This note doesn't exist or you can't see it.",
  note_gone: "This note doesn't exist any more.",
  note_edit_conflict: "Someone else changed this note while you were editing. Reload to see their changes.",
  note_record_archived: "Restore this record before changing its notes.",
  note_delete_confirm: "Delete this note? This can't be undone.",
  no_notifications: "No notifications yet.",
  // SF-109: activities
  activity_subject_required: "Give the activity a subject.",
  activity_subject_too_long: "Keep the subject under 200 characters.",
  activity_due_required: "Pick a due date.",
  activity_time_not_in_uk: "Pick a time that exists in UK time.",
  activity_duration_needs_time: "Pick a time before setting a duration.",
  activity_duration_invalid: "Pick a duration between 5 minutes and 24 hours.",
  activity_note_too_long: "Keep the note under 10,000 characters.",
  activity_type_invalid: "Pick Call, Meeting or Task.",
  activity_assignee_invalid: "Choose an active user.",
  activity_conflict: "Someone else changed this activity while you were editing. Reload to see their changes.",
  activity_gone: "This activity doesn't exist any more.",
  activity_not_found: "This activity doesn't exist or you can't see it.",
  activity_record_archived: "Restore this record before changing its activities.",
  activity_link_not_found: "This record doesn't exist or you can't see it.",
  activity_delete_confirm: "Delete this activity? This can't be undone.",
  activities_empty: "No activities here.",
  activities_none_planned: "No next activity.",
  no_next_activity: "⚠ No next activity",
  followup_question: "Schedule a follow-up?",
  overdue: "Overdue",
  today: "Today",
} as const;

const privatePeople = (n: number) => (n === 1 ? "1 private person" : `${n} private people`);
const privateDeals = (n: number) => (n === 1 ? "1 private deal" : `${n} private deals`);
// The non-zero kinds only, e.g. ["2 private people", "1 private deal"] (SF-97).
const recordLabels = (people: number, deals: number) => [people > 0 ? privatePeople(people) : "", deals > 0 ? privateDeals(deals) : ""].filter(Boolean);
// SF-103: "(row 7)" / "(rows 4, 9)"
const rowsNote = (rows: number[]) => (rows.length === 1 ? `(row ${rows[0]})` : `(rows ${rows.join(", ")})`);
const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordsPhrase = (people: number, deals: number) => recordLabels(people, deals).join(" and ");

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
  // SF-92, SF-97: a deactivated user's private people and private deals
  private_records: (people: number, deals: number) => recordLabels(people, deals).join(" · "),
  handover_question: (from: string, people: number, deals: number, to: string) => `Hand ${from}'s ${recordsPhrase(people, deals)} to ${to}?`,
  handover_explain: (to: string, deals: number) =>
    `They stay private. ${to} becomes their owner and can see them. You will not see ${deals > 0 ? "what" : "who"} they are.`,
  handed_over: (name: string, people: number, deals: number) => `${recordsPhrase(people, deals)} handed to ${name}.`,
  handover_none: (name: string) => `${name} has no private people or deals to hand over.`,
  handed_over_event: (name: string) => `Handed to ${name}`,
  person_no_longer_visible: (name: string) => `You can no longer see ${name}: only their creator and owner can.`,
  // SF-102: notes, mentions and notifications
  mention_cannot_see: (name: string) => `${name} can't see this record, so they can't be mentioned.`,
  mentioned_you: (name: string, record: string) => `${name} mentioned you in a note on ${record}`,
  edited_by: (name: string) => `edited by ${name}`,
  notifications_label: (n: number) => `Notifications (${n})`,
  note_deleted: (_name: string) => "Note deleted.",
  // A delete on a record the user cannot see, shown on its kind's list (fix round 1).
  note_not_found: (_name: string) => messages.note_not_found,
  // SF-95: "<n> deals · £<total>" above the deal list, for every matching deal.
  deal_list_count: (n: number, totalPence: number) => `${n} ${n === 1 ? "deal" : "deals"} · ${formatMoney(totalPence)}`,
  // SF-109: activities
  assignee_cannot_see: (name: string) => `${name} can't see this record, so the activity can't be assigned to them.`,
  assigned_you: (by: string, type: string, subject: string) => `${by} assigned you a ${type}: ${subject}`,
  activity_due: (text: string) => `Due ${text}`,
  done_by: (name: string) => `Done by ${name}`,
  next_activity: (day: string, type: string) => `Next: ${day} · ${type}`,
  activity_deleted: (_name: string) => "Activity deleted.",
  // SF-103 CSV import: values from the file appear only inside quotes; field labels and names come from the app or the database.
  import_one_column: (field: string) => `Only one column can be set to ${field}.`,
  import_too_long: (field: string, max: number) => `Keep the ${field} under ${max} characters.`,
  import_consent_unknown: (value: string) => `Consent not recognised: '${value}'. Use Subscribed or Unsubscribed.`,
  import_duplicate_in_file: (row: number) => `Row ${row} has the same email address.`,
  import_duplicate_in_file_org: (row: number) => `Row ${row} has the same name.`,
  import_lead_source_unknown: (value: string, rows: number[]) => `Lead source not on the list: '${value}' ${rowsNote(rows)}`,
  import_label_unknown: (value: string, rows: number[]) => `Label not on the list: '${value}' ${rowsNote(rows)}`,
  import_owner_unknown: (value: string, rows: number[]) => `Owner not found: '${value}' ${rowsNote(rows)}. You are the owner.`,
  import_size_unknown: (value: string, rows: number[]) => `Size not recognised: '${value}' ${rowsNote(rows)}`,
  import_organisation_archived: (name: string, rows: number[]) => `${name} is archived. ${rowsNote(rows)}`,
  import_summary_people: (n: number, orgs: number, skipped: number) =>
    `${counted(n, "person", "people")} imported. ${counted(orgs, "organisation", "organisations")} added. ${counted(skipped, "row", "rows")} not imported.`,
  import_summary_organisations: (n: number, skipped: number) =>
    `${counted(n, "organisation", "organisations")} imported. ${counted(skipped, "row", "rows")} not imported.`,
  import_without_email: (n: number) =>
    `${counted(n, "person has", "people have")} no email address and cannot be checked for duplicates.`,
  import_needs_consent: (n: number) => `${counted(n, "person has", "people have")} no consent in the file.`,
  import_rows: (n: number) => counted(n, "row", "rows"),
  imported_event: (name: string) => `Imported from CSV by ${name}`,
} as const;

export type TemplateCode = keyof typeof templates;

// A form field's message: a template when the server gave a name, else a fixed text.
export function fieldMessage(error: { code: string; name?: string }): string | undefined {
  if (error.name !== undefined && (error.code === "duplicate_email" || error.code === "organisation_exists" || error.code === "mention_cannot_see" || error.code === "assignee_cannot_see")) {
    return templates[error.code](error.name);
  }
  return messageFor(error.code);
}

export type MessageCode = keyof typeof messages;

export function messageFor(code: string | null | undefined): string | undefined {
  if (!code || !Object.hasOwn(messages, code)) return undefined;
  return messages[code as MessageCode];
}
