// covers FR-025 (messages only from messages.ts; templates never reachable from a URL code), contracts/routes.md § Messages
import { describe, expect, it } from "vitest";
import { fieldMessage, messageFor, messages, templates } from "@/server/messages";

describe("record messages", () => {
  it("has the fixed texts of contracts/routes.md", () => {
    expect(messageFor("name_required")).toBe("Enter a first or last name.");
    expect(messageFor("email_invalid")).toBe("Enter a valid email address.");
    expect(messageFor("email_twice")).toBe("This email address is listed twice.");
    expect(messageFor("phone_invalid")).toBe("Enter a valid phone number.");
    expect(messageFor("linkedin_invalid")).toBe("Enter a LinkedIn profile link (linkedin.com/…).");
    expect(messageFor("website_invalid")).toBe("Enter a valid website address.");
    expect(messageFor("duplicate_email_hidden")).toBe("Another person already has this email address.");
    expect(messageFor("organisation_name_required")).toBe("Enter the organisation's name.");
    expect(messageFor("edit_conflict")).toBe("Someone else changed this person while you were editing. Reload to see their changes.");
    expect(messageFor("edit_conflict_organisation")).toBe(
      "Someone else changed this organisation while you were editing. Reload to see their changes.",
    );
    expect(messageFor("choice_exists")).toBe("This name is already on the list.");
    expect(messageFor("choice_name_required")).toBe("Enter a name.");
    expect(messageFor("no_people_match")).toBe("No people match these filters.");
    expect(messageFor("no_organisations_match")).toBe("No organisations match these filters.");
    expect(messageFor("no_people_yet")).toBe("No people yet.");
  });
  it("holds the delete confirmation labels and the removed-name message (Fix round 1)", () => {
    // covers FR-025, Fix round 1
    expect(messageFor("choice_removed_exists")).toBe("A removed entry already has this name. Add it again to bring it back.");
    expect(messageFor("delete_confirm_label")).toBe("Confirm delete");
    expect(messageFor("delete_for_good")).toBe("[ DELETE FOR GOOD ]");
    expect(messageFor("delete_cancel")).toBe("[ CANCEL ]");
  });
  it("builds the template messages from a name", () => {
    expect(templates.duplicate_email("Ada Example")).toBe("Ada Example already has this email address.");
    expect(templates.organisation_exists("Fakeco Ltd")).toBe("Fakeco Ltd already exists.");
    expect(templates.person_deleted("Ada Example")).toBe("Ada Example was deleted.");
    expect(templates.organisation_deleted("Fakeco Ltd")).toBe("Fakeco Ltd was deleted.");
    expect(templates.delete_confirm("Ada Example")).toBe("Delete Ada Example for good? This can't be undone.");
  });
  it("never answers a template code from messageFor (a URL code cannot produce them)", () => {
    for (const code of ["duplicate_email", "organisation_exists", "person_deleted", "organisation_deleted", "delete_confirm", "toString", "__proto__"]) {
      expect(messageFor(code), code).toBeUndefined();
    }
  });
});

// covers FR-019, contracts/routes.md § Messages (SF-93 pipelines, deals and the board)
describe("deal and pipeline messages", () => {
  it("has the fixed texts of SF-93 contracts/routes.md", () => {
    const expected: Record<string, string> = {
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
    };
    for (const [code, text] of Object.entries(expected)) expect(messageFor(code), code).toBe(text);
  });
  it("builds the deal templates from database names only", () => {
    expect(templates.deal_count(0)).toBe("0 deals");
    expect(templates.deal_count(1)).toBe("1 deal");
    expect(templates.deal_count(200)).toBe("200 deals");
    expect(templates.deal_deleted("Fakeco website")).toBe("Fakeco website was deleted.");
    expect(templates.deal_no_longer_visible("Fakeco website")).toBe("You can no longer see Fakeco website: only its creator and owner can.");
    expect(templates.pipeline_has_deals("Qualified", 3)).toBe("Qualified has 3 deals. Move them to:");
    expect(templates.pipeline_delete_confirm("Partners")).toBe("Delete Partners? This can't be undone.");
    expect(templates.delete_confirm("Fakeco website")).toBe("Delete Fakeco website for good? This can't be undone.");
    // A template is never reachable through a code from the address.
    expect(messageFor("deal_deleted")).toBeUndefined();
    expect(messageFor("deal_no_longer_visible")).toBeUndefined();
  });
});

// covers FR-016 (SF-92): the hand-over, the deleted-person lines and the owner notice, contracts/routes.md § Messages
describe("SF-92 messages", () => {
  it("has the fixed texts", () => {
    expect(messageFor("private_label")).toBe("Private (only the creator and the owner can see this person)");
    expect(messageFor("deleted_person_linked")).toBe("A deleted person was linked");
    expect(messageFor("deleted_person_unlinked")).toBe("A deleted person was unlinked");
    expect(messageFor("handover_choose")).toBe("Choose a user");
    expect(messageFor("handover_choose_user")).toBe("Choose an active user.");
    expect(messageFor("handover_not_deactivated")).toBe("Only a deactivated user's private records can be handed over.");
    expect(messageFor("handover_explain_unchosen")).toBe(
      "They stay private. The user you choose becomes their owner and can see them. You will not see who they are.",
    );
    expect(messageFor("handover_button")).toBe("[ HAND OVER ]");
    expect(messageFor("handover_cancel")).toBe("[ CANCEL ]");
    expect(messageFor("handover_to_label")).toBe("Hand over to");
  });
  // covers FR-002, FR-003, FR-006, US2 scenarios 1–3 (SF-97): people-only wording stays SF-92's
  it("builds the templates, singular and plural", () => {
    expect(templates.private_records(1, 0)).toBe("1 private person");
    expect(templates.private_records(2, 0)).toBe("2 private people");
    expect(templates.handover_question("Alan Fake", 2, 0, "Margaret Fake")).toBe("Hand Alan Fake's 2 private people to Margaret Fake?");
    expect(templates.handover_question("Alan Fake", 1, 0, "Margaret Fake")).toBe("Hand Alan Fake's 1 private person to Margaret Fake?");
    expect(templates.handover_explain("Margaret Fake", 0)).toBe(
      "They stay private. Margaret Fake becomes their owner and can see them. You will not see who they are.",
    );
    expect(templates.handed_over("Margaret Fake", 2, 0)).toBe("2 private people handed to Margaret Fake.");
    expect(templates.handed_over("Margaret Fake", 1, 0)).toBe("1 private person handed to Margaret Fake.");
    expect(templates.handover_none("Alan Fake")).toBe("Alan Fake has no private people or deals to hand over.");
    expect(templates.handed_over_event("Margaret Fake")).toBe("Handed to Margaret Fake");
    expect(templates.person_no_longer_visible("Ada Example")).toBe("You can no longer see Ada Example: only their creator and owner can.");
  });
  // covers FR-002, FR-003, FR-006, US1 scenarios 1–3 (SF-97)
  it("names private people and private deals together", () => {
    expect(templates.private_records(2, 1)).toBe("2 private people · 1 private deal");
    expect(templates.private_records(1, 2)).toBe("1 private person · 2 private deals");
    expect(templates.handover_question("Alan Fake", 2, 1, "Margaret Fake")).toBe("Hand Alan Fake's 2 private people and 1 private deal to Margaret Fake?");
    expect(templates.handover_explain("Margaret Fake", 1)).toBe(
      "They stay private. Margaret Fake becomes their owner and can see them. You will not see what they are.",
    );
    expect(messageFor("handover_explain_unchosen_records")).toBe(
      "They stay private. The user you choose becomes their owner and can see them. You will not see what they are.",
    );
    expect(templates.handed_over("Margaret Fake", 2, 1)).toBe("2 private people and 1 private deal handed to Margaret Fake.");
  });
  // covers FR-002, FR-003, FR-006, US2 scenarios 1–3 (SF-97)
  it("names private deals alone", () => {
    expect(templates.private_records(0, 1)).toBe("1 private deal");
    expect(templates.private_records(0, 3)).toBe("3 private deals");
    expect(templates.handover_question("Alan Fake", 0, 1, "Margaret Fake")).toBe("Hand Alan Fake's 1 private deal to Margaret Fake?");
    expect(templates.handover_explain("Margaret Fake", 2)).toBe(
      "They stay private. Margaret Fake becomes their owner and can see them. You will not see what they are.",
    );
    expect(templates.handed_over("Margaret Fake", 0, 1)).toBe("1 private deal handed to Margaret Fake.");
  });
  it("never answers the new template codes from messageFor", () => {
    for (const code of ["private_records", "handover_question", "handover_explain", "handed_over", "handover_none", "handed_over_event", "person_no_longer_visible"]) {
      expect(messageFor(code), code).toBeUndefined();
    }
  });
});

// covers SF-95 FR-021, contracts/routes.md § Messages
describe("deal page and list messages (SF-95)", () => {
  it("has the 8 new fixed texts", () => {
    expect(messageFor("deal_not_found")).toBe("This deal doesn't exist or you can't see it.");
    expect(messageFor("lost_question")).toBe("Why was this deal lost?");
    expect(messageFor("lost_reason_required")).toBe("Enter why this deal was lost.");
    expect(messageFor("lost_reason_too_long")).toBe("Keep the reason under 500 characters.");
    expect(messageFor("deal_person_already_linked")).toBe("This person is already linked to this deal.");
    expect(messageFor("deal_label_exists")).toBe("This name is already used.");
    expect(messageFor("no_deals_match")).toBe("No deals match these filters.");
    expect(messageFor("no_deals_yet")).toBe("No deals yet.");
  });
  it("counts the list's deals and their total", () => {
    expect(templates.deal_list_count(1, 400000)).toBe("1 deal · £4,000");
    expect(templates.deal_list_count(12, 1234550)).toBe("12 deals · £12,345.50");
    expect(templates.deal_list_count(0, 0)).toBe("0 deals · £0");
    expect(messageFor("deal_list_count")).toBeUndefined();
  });
});

// covers FR-018, FR-021, contracts/routes.md § Messages (SF-103 CSV import)
describe("CSV import messages (SF-103)", () => {
  it("has the fixed texts", () => {
    const expected: Record<string, string> = {
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
    };
    for (const [code, text] of Object.entries(expected)) expect(messageFor(code), code).toBe(text);
  });
  it("builds the templates, singular and plural, with file values only inside quotes", () => {
    expect(templates.import_one_column("Lead source")).toBe("Only one column can be set to Lead source.");
    expect(templates.import_too_long("role", 200)).toBe("Keep the role under 200 characters.");
    expect(templates.import_consent_unknown("maybe")).toBe("Consent not recognised: 'maybe'. Use Subscribed or Unsubscribed.");
    expect(templates.import_duplicate_in_file(4)).toBe("Row 4 has the same email address.");
    expect(templates.import_duplicate_in_file_org(4)).toBe("Row 4 has the same name.");
    expect(templates.import_lead_source_unknown("Webinar", [4, 9])).toBe("Lead source not on the list: 'Webinar' (rows 4, 9)");
    expect(templates.import_lead_source_unknown("Your account is locked", [2])).toBe("Lead source not on the list: 'Your account is locked' (row 2)");
    expect(templates.import_label_unknown("Cold", [7])).toBe("Label not on the list: 'Cold' (row 7)");
    expect(templates.import_owner_unknown("Nobody", [3, 5])).toBe("Owner not found: 'Nobody' (rows 3, 5). You are the owner.");
    expect(templates.import_size_unknown("medium", [5])).toBe("Size not recognised: 'medium' (row 5)");
    expect(templates.import_organisation_archived("Fakeco Ltd", [3])).toBe("Fakeco Ltd is archived. (row 3)");
    expect(templates.import_summary_people(17, 2, 3)).toBe("17 people imported. 2 organisations added. 3 rows not imported.");
    expect(templates.import_summary_people(1, 1, 1)).toBe("1 person imported. 1 organisation added. 1 row not imported.");
    expect(templates.import_summary_organisations(9, 1)).toBe("9 organisations imported. 1 row not imported.");
    expect(templates.import_summary_organisations(1, 0)).toBe("1 organisation imported. 0 rows not imported.");
    expect(templates.import_without_email(12)).toBe("12 people have no email address and cannot be checked for duplicates.");
    expect(templates.import_without_email(1)).toBe("1 person has no email address and cannot be checked for duplicates.");
    expect(templates.import_needs_consent(4)).toBe("4 people have no consent in the file.");
    expect(templates.import_needs_consent(1)).toBe("1 person has no consent in the file.");
    expect(templates.import_rows(20)).toBe("20 rows");
    expect(templates.import_rows(1)).toBe("1 row");
    expect(templates.imported_event("Ada Fake")).toBe("Imported from CSV by Ada Fake");
  });
  it("never answers a template code from messageFor", () => {
    for (const code of Object.keys(templates).filter((c) => c.startsWith("import"))) expect(messageFor(code), code).toBeUndefined();
    expect(messageFor("import_one_column")).toBeUndefined();
  });
});

// covers SF-102 FR-016, contracts/routes.md § Messages (T006)
describe("timeline and notes messages", () => {
  it("has the fixed texts", () => {
    expect(messageFor("note_required")).toBe("Write something before adding the note.");
    expect(messageFor("note_too_long")).toBe("Keep the note under 10,000 characters.");
    expect(messageFor("note_not_found")).toBe("This note doesn't exist or you can't see it.");
    expect(messageFor("note_gone")).toBe("This note doesn't exist any more.");
    expect(messageFor("note_edit_conflict")).toBe("Someone else changed this note while you were editing. Reload to see their changes.");
    expect(messageFor("note_record_archived")).toBe("Restore this record before changing its notes.");
    expect(messageFor("note_delete_confirm")).toBe("Delete this note? This can't be undone.");
    expect(messageFor("no_notifications")).toBe("No notifications yet.");
  });
  it("has the templates, never reachable from a URL code", () => {
    expect(templates.mention_cannot_see("Bob Fake")).toBe("Bob Fake can't see this record, so they can't be mentioned.");
    expect(templates.mentioned_you("Ada Fake", "Fakeco website")).toBe("Ada Fake mentioned you in a note on Fakeco website");
    expect(templates.edited_by("Bob Fake")).toBe("edited by Bob Fake");
    expect(templates.notifications_label(3)).toBe("Notifications (3)");
    expect(templates.note_deleted("")).toBe("Note deleted.");
    expect(messageFor("mention_cannot_see")).toBeUndefined();
    expect(messageFor("mentioned_you")).toBeUndefined();
  });
  it("fieldMessage renders the mention refusal with the server's name", () => {
    expect(fieldMessage({ code: "mention_cannot_see", name: "Bob Fake" })).toBe("Bob Fake can't see this record, so they can't be mentioned.");
    expect(fieldMessage({ code: "mention_cannot_see" })).toBeUndefined();
  });
});

// covers SF-114 FR-015 (contracts/routes.md § Messages)
describe("ambassador messages (SF-114)", () => {
  it("has the fixed texts", () => {
    expect(messageFor("ambassadors_empty")).toBe("No ambassadors yet. Tick Ambassador on a person to add one.");
    expect(messageFor("ambassador_not_found")).toBe("This ambassador doesn't exist or you can't see them.");
    expect(messageFor("referrer_self")).toBe("A person can't be their own referrer.");
    expect(messageFor("referrer_invalid")).toBe("Choose an ambassador from the list.");
    expect(messageFor("no_people_referred")).toBe("No people referred yet.");
    expect(messageFor("no_deals_referred")).toBe("No deals referred yet.");
    expect(messageFor("no_longer_ambassador")).toBe("No longer an ambassador");
    expect(messageFor("referred_by_private")).toBe("Referred by a private person");
    expect(messageFor("referrer_cleared_deleted")).toBe("Referred by cleared (a deleted person)");
  });
  it("shows the referrer refusals next to the field", () => {
    expect(fieldMessage({ code: "referrer_self" })).toBe("A person can't be their own referrer.");
    expect(fieldMessage({ code: "referrer_invalid" })).toBe("Choose an ambassador from the list.");
  });
  it("has the templates, never reachable from a URL code", () => {
    expect(templates.referred_by("Cara Example")).toBe("Referred by Cara Example");
    expect(templates.referrer_set_event("Cara Example")).toBe("Referred by set to Cara Example");
    expect(templates.referrer_changed_event("Cara Example", "Dora Privatefake")).toBe("Referred by changed from Cara Example to Dora Privatefake");
    expect(messageFor("referred_by")).toBeUndefined();
    expect(messageFor("referrer_set_event")).toBeUndefined();
  });
});

// covers SF-109 FR-015, contracts/routes.md § Messages (T006)
describe("activity messages", () => {
  it("has the fixed texts", () => {
    const expected: Record<string, string> = {
      activity_subject_required: "Give the activity a subject.",
      activity_subject_too_long: "Keep the subject under 200 characters.",
      activity_due_required: "Pick a due date.",
      activity_time_not_in_uk: "Pick a time that exists in UK time.",
      activity_duration_needs_time: "Pick a time before setting a duration.",
      activity_duration_invalid: "Pick a duration between 5 minutes and 24 hours.",
      activity_note_too_long: "Keep the note under 10,000 characters.",
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
    };
    for (const [code, text] of Object.entries(expected)) expect(messageFor(code), code).toBe(text);
  });
  it("has the templates, never reachable from a URL code", () => {
    expect(templates.assignee_cannot_see("Bob Fake")).toBe("Bob Fake can't see this record, so the activity can't be assigned to them.");
    expect(templates.assigned_you("Ada Fake", "call", "Call Ada about the proposal")).toBe("Ada Fake assigned you a call: Call Ada about the proposal");
    expect(templates.activity_due("25 Nov 2026 10:00")).toBe("Due 25 Nov 2026 10:00");
    expect(templates.done_by("Ada Fake")).toBe("Done by Ada Fake");
    expect(templates.next_activity("25 Nov", "Call")).toBe("Next: 25 Nov · Call");
    expect(templates.activity_deleted("")).toBe("Activity deleted.");
    expect(messageFor("assignee_cannot_see")).toBeUndefined();
    expect(messageFor("assigned_you")).toBeUndefined();
  });
  it("fieldMessage renders the assignee refusal with the server's name", () => {
    expect(fieldMessage({ code: "assignee_cannot_see", name: "Bob Fake" })).toBe("Bob Fake can't see this record, so the activity can't be assigned to them.");
    expect(fieldMessage({ code: "assignee_cannot_see" })).toBeUndefined();
  });
});

// covers SF-116 FR-013 (contracts/routes.md § Messages): the file messages and templates, word for word
describe("SF-116 file messages", () => {
  it("has the fixed messages", () => {
    const expected: Record<string, string> = {
      file_added: "File added.",
      file_deleted: "File deleted.",
      file_not_found: "This file doesn't exist or you can't see it.",
      file_gone: "This file doesn't exist any more.",
      file_record_not_found: "This record doesn't exist or you can't see it.",
      files_archived: "Restore this record before changing its files.",
      files_unreachable: "Files can't be reached right now. Try again in a minute.",
      no_files: "No files yet.",
    };
    for (const [code, text] of Object.entries(expected)) expect(messageFor(code), code).toBe(text);
  });
  it("has the templates built from a file name, never reachable from a URL code", () => {
    expect(templates.file_too_large("big.zip")).toBe("big.zip is over 25 MB, the most a file can be.");
    expect(templates.file_empty("empty.txt")).toBe("empty.txt is empty.");
    expect(templates.file_name_too_long("a".repeat(300))).toBe(`${"a".repeat(40)}… has a name over 255 characters.`);
    expect(templates.file_upload_failed("a.pdf")).toBe("a.pdf couldn't be uploaded. Try again.");
    expect(templates.file_uploading("a.pdf", 42)).toBe("Uploading a.pdf… 42%");
    expect(templates.file_delete_confirm("a.pdf")).toBe("Delete a.pdf? This can't be undone.");
    expect(messageFor("file_too_large")).toBeUndefined();
    expect(messageFor("file_uploading")).toBeUndefined();
  });
});

// covers SF-115 contracts/routes.md § Messages (T049): every custom field code used in src/server/custom-fields/ exists
import { readdirSync as readDir, readFileSync as readText } from "node:fs";
describe("custom field messages (SF-115)", () => {
  it("has the fixed texts", () => {
    expect(messageFor("custom_field_name_required")).toBe("Give the field a name.");
    expect(messageFor("custom_field_name_too_long")).toBe("A field name can be at most 60 characters.");
    expect(messageFor("custom_field_type_required")).toBe("Choose a type.");
    expect(messageFor("custom_choices_required")).toBe("Add at least one choice.");
    expect(messageFor("custom_choice_name_required")).toBe("Give the choice a name.");
    expect(messageFor("custom_choice_name_too_long")).toBe("A choice name can be at most 60 characters.");
    expect(messageFor("custom_choice_twice")).toBe("Two choices have the same name.");
    expect(messageFor("custom_choice_last")).toBe("A choice field needs at least one choice.");
    expect(messageFor("custom_choice_removed_exists")).toBe("A removed choice has this name. Add it again to bring it back.");
    expect(messageFor("custom_fields_limit")).toBe("A kind can have at most 50 custom fields.");
    expect(messageFor("custom_choices_limit")).toBe("A field can have at most 100 choices.");
    expect(messageFor("custom_list_limit")).toBe("At most 8 custom fields can be shown in a list.");
    expect(messageFor("custom_fields_empty")).toBe("No custom fields yet.");
    expect(messageFor("custom_record_archived")).toBe("Restore this record before changing its custom fields.");
  });
  it("has the templates, never reachable from a URL code, and names the field next to its input", () => {
    expect(templates.custom_field_exists("Owner")).toBe("There is already a field called Owner.");
    expect(templates.custom_choice_exists("Vegan")).toBe("There is already a choice called Vegan.");
    expect(templates.custom_number_range("N")).toBe("N: enter a number between -1,000,000,000,000 and 1,000,000,000,000.");
    expect(templates.custom_money_invalid("Budget")).toBe("Budget: enter an amount in pounds, for example 4000 or 4000.50.");
    expect(templates.custom_choice_invalid("Diet")).toBe("Diet: choose one of the choices.");
    expect(templates.custom_set_event("Diet", "Vegan")).toBe("Diet set to Vegan");
    expect(templates.custom_changed_event("Diet", "Vegan", "Vegetarian")).toBe("Diet changed from Vegan to Vegetarian");
    expect(templates.custom_changed_plain("Notes")).toBe("Notes changed");
    expect(templates.custom_cleared_event("Diet")).toBe("Diet cleared");
    // covers SF-115 fix round 1: an unknown choice value of a CSV cell
    expect(templates.import_custom_choice_unknown("Topics", "Nope", [2])).toBe('Topics: "Nope" is not one of its choices and was not set. (row 2)');
    expect(templates.import_custom_field_gone("Diet")).toBe("Diet was deleted before the import ran: its column was not imported.");
    expect(messageFor("custom_field_exists")).toBeUndefined();
    expect(messageFor("custom_set_event")).toBeUndefined();
    expect(fieldMessage({ code: "custom_number_decimals", name: "Head count" })).toBe("Head count: at most 4 decimal places.");
  });
  it("knows every custom_* code the custom fields code uses", () => {
    const used = new Set<string>();
    for (const file of readDir("src/server/custom-fields")) {
      for (const m of readText(`src/server/custom-fields/${file}`, "utf8").matchAll(/"(custom_[a-z_]+)"/g)) used.add(m[1]);
    }
    const kinds = new Set(["custom_set", "custom_changed", "custom_cleared", "custom_fields", "custom_field_choices", "custom_values", "custom_fields_name_key", "custom_field_choices_name_key"]);
    const missing = [...used].filter((c) => !kinds.has(c) && messageFor(c) === undefined && !Object.hasOwn(templates, c));
    expect(used.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});

// covers SF-119 FR-019, contracts/routes.md § Messages (T004): every campaign code, and the templates' exact texts
describe("campaign messages (SF-119)", () => {
  it("has the fixed texts of contracts/routes.md", () => {
    const expected: Record<string, string> = {
      campaigns_empty: "No campaigns yet.",
      campaign_saved: "Draft saved.",
      campaign_gone: "This campaign no longer exists.",
      campaign_name_required: "Give the campaign a name.",
      campaign_name_too_long: "A campaign name can be at most 100 characters.",
      campaign_sender_too_long: "Sender name: at most 100 characters.",
      campaign_reply_to_invalid: "Reply-to: enter one valid email address.",
      campaign_subject_too_long: "Subject: at most 255 characters.",
      campaign_preview_text_too_long: "Preview text: at most 255 characters.",
      campaign_fallback_too_long: "If empty, show: at most 100 characters.",
      campaign_html_too_long: "The HTML can be at most 500,000 characters.",
      campaign_blocks_limit: "A campaign can have at most 50 blocks.",
      campaign_content_invalid: "The content couldn't be read. Reload and try again.",
      campaign_still_empty: "Still empty: ",
      campaign_unknown_tags: "Unknown merge tags: ",
      campaign_preview_choose: "Choose a person to preview.",
      campaign_unsubscribe_line: "Don't want these emails?",
      campaign_unsubscribe: "Unsubscribe",
      campaign_switch_to_html: "Switch to Paste HTML? The HTML box will start with this content as HTML.",
      campaign_switch_to_layout: "Switch to a layout? The pasted HTML will be replaced by the layout's blocks.",
      campaign_new: "[ NEW CAMPAIGN ]",
      campaign_save: "[ SAVE ]",
      campaign_duplicate: "[ DUPLICATE ]",
      campaign_delete: "[ DELETE ]",
      campaign_insert_tag: "[ INSERT MERGE TAG ]",
      campaign_if_empty: "If empty, show",
      campaign_add_block: "[ + ADD BLOCK ]",
      campaign_layout_blank: "Blank",
      campaign_layout_text: "Text",
      campaign_layout_text_button: "Text with a button",
      campaign_layout_newsletter: "Newsletter",
      campaign_paste_html: "Paste HTML",
      campaign_block_heading: "Heading",
      campaign_block_text: "Text",
      campaign_block_button: "Button",
      campaign_block_image: "Image",
      campaign_block_divider: "Divider",
      campaign_col_name: "Name",
      campaign_col_subject: "Subject",
      campaign_col_status: "Status",
      campaign_col_created_by: "Created by",
      campaign_col_last_edited: "Last edited",
    };
    for (const [code, text] of Object.entries(expected)) expect(messageFor(code), code).toBe(text);
  });
  it("builds the templates from names read from the database", () => {
    expect(templates.campaign_deleted("Exec dinner (fake)")).toBe('Campaign "Exec dinner (fake)" deleted.');
    expect(templates.campaign_delete_confirm("Exec dinner (fake)")).toBe(`Delete the campaign "Exec dinner (fake)" for good? This can't be undone.`);
    expect(templates.campaign_edit_conflict("Ada Fake")).toBe("Ada Fake changed this campaign since you opened it. Reload to see their changes.");
    expect(templates.campaign_button_url("Button")).toBe("Button: enter a web address starting with https://.");
    expect(templates.campaign_image_url("Image")).toBe("Image: enter a web address starting with https://.");
    expect(templates.campaign_block_too_long("Text", 10_000)).toBe("Text: at most 10,000 characters.");
    expect(templates.campaign_copy_name("Exec dinner (fake)")).toBe("Copy of Exec dinner (fake)");
    for (const code of ["campaign_deleted", "campaign_delete_confirm", "campaign_edit_conflict", "campaign_copy_name"]) {
      expect(messageFor(code), code).toBeUndefined();
    }
  });
});

// covers SF-120 FR-011, FR-014 (T004): every segment message of contracts/routes.md § Messages, templates in singular and plural
describe("segment messages (SF-120)", () => {
  it("has the fixed texts", () => {
    expect(messageFor("segment_name_required")).toBe("Give the segment a name.");
    expect(messageFor("segment_name_too_long")).toBe("A segment name can be at most 100 characters.");
    expect(messageFor("segment_pipeline_required")).toBe("Choose a pipeline.");
    expect(messageFor("segment_stage_required")).toBe("Choose a stage.");
    expect(messageFor("segment_conditions_limit")).toBe("A segment can have at most 20 conditions.");
    expect(messageFor("segment_changed")).toBe("Someone else changed this segment. Open it again to see their changes.");
    expect(messageFor("segment_not_found")).toBe("This segment no longer exists.");
    expect(messageFor("segment_count_note")).toBe("Recipients are worked out when the campaign is sent, so this number can change.");
    expect(messageFor("segment_broken")).toBe("This segment refers to something that was deleted. Edit it before using it.");
    expect(messageFor("segments_none")).toBe("No segments yet.");
    expect(messageFor("segment_who_everyone")).toBe("Everyone in the CRM");
    expect(messageFor("segment_who_pipeline")).toBe("People on the deals of a pipeline");
    expect(messageFor("segment_who_stage")).toBe("People on the deals of a stage");
    expect(["open", "won", "lost", "all"].map((s) => messageFor(`segment_status_${s}`))).toEqual(["Open deals", "Won deals", "Lost deals", "All deals"]);
  });
  it("renders the templates with the names as given", () => {
    expect(templates.segment_name_exists("<b>Test</b>")).toBe("There is already a segment called <b>Test</b>.");
    expect(templates.segment_deleted("Sales — Proposal")).toBe("Segment Sales — Proposal deleted.");
    expect(templates.segment_delete_confirm("Old list")).toBe("Delete the segment Old list? It is deleted for the whole team.");
    expect(templates.segment_reaches(1)).toBe("Reaches 1 person now");
    expect(templates.segment_reaches(0)).toBe("Reaches 0 people now");
    expect(templates.segment_reaches(42)).toBe("Reaches 42 people now");
    expect(templates.segment_left_out(3, 5, 2)).toBe("Left out: 3 archived · 5 unsubscribed · 2 with no email address");
    expect(templates.segment_more_conditions(1)).toBe("+ 1 condition");
    expect(templates.segment_more_conditions(3)).toBe("+ 3 conditions");
    expect(templates.segment_last_changed("Ada Fake", "24 Nov 2026 10:12")).toBe("Last changed by Ada Fake · 24 Nov 2026 10:12");
    expect(templates.segment_condition_required("Lead source", "choose")).toBe("Lead source: choose at least one.");
    for (const code of ["segment_name_exists", "segment_deleted", "segment_reaches", "segment_left_out"]) expect(messageFor(code)).toBeUndefined();
  });
});

// covers SF-117 FR-028, contracts/routes.md § Messages: every Pipedrive message and template, Pipedrive values in quotes
describe("Pipedrive import messages (SF-117)", () => {
  it("has the fixed texts", () => {
    const expected: Record<string, string> = {
      pipedrive_not_set_up: "The Pipedrive import isn't set up yet.",
      pipedrive_token_required: "Paste your Pipedrive API token.",
      pipedrive_token_refused: "Pipedrive did not accept this token. Copy it again from Pipedrive and try again.",
      pipedrive_unreachable: "Pipedrive can't be reached right now. Try again in a minute.",
      pipedrive_token_note: "In Pipedrive: Personal preferences → API.",
      pipedrive_tick_something: "Tick what to import.",
      pipedrive_consent_required: "Choose the email consent of people with no consent status in Pipedrive.",
      pipedrive_existing_note:
        "Records already in the CRM (a person with the same email address, an organisation with the same name) are linked to the Pipedrive record and left as they are.",
      pipedrive_keep_open: "Keep this page open: the import moves on while it is open. Closing it pauses the import.",
      pipedrive_stopped_unreachable: "The import stopped: Pipedrive can't be reached right now.",
      pipedrive_token_no_longer: "Pipedrive no longer accepts your token. Save a new token in Settings, then continue.",
      pipedrive_other_company: "This import is from another Pipedrive company. Stop it, or save the token of that company again.",
      pipedrive_stopped_by_you: "Stopped by you before the end.",
      pipedrive_no_name: "No name.",
      pipedrive_email_many_people: "Its email addresses belong to more than one person in the CRM.",
      pipedrive_linked_hidden: "A person already in the CRM has this email address: linked, not changed.",
      pipedrive_unsubscribed_hidden: "A person already in the CRM is unsubscribed in Pipedrive: now Unsubscribed in the CRM.",
    };
    for (const [code, text] of Object.entries(expected)) expect(messageFor(code), code).toBe(text);
    for (const code of ["pipedrive_saved", "pipedrive_removed", "pipedrive_remove_confirm", "pipedrive_stop_confirm", "pipedrive_running"]) {
      expect(messageFor(code), code).toMatch(/\S/);
    }
  });
  it("builds the templates, Pipedrive values only inside quotes", () => {
    expect(templates.pipedrive_connected("Fake Person", "Fakeco Pipedrive")).toBe("Connected to Pipedrive as Fake Person (Fakeco Pipedrive).");
    expect(templates.pipedrive_saved_on("24 Nov 2026")).toBe("Token saved on 24 Nov 2026.");
    expect(templates.pipedrive_slow_down(8)).toBe("Pipedrive asked us to slow down. Carrying on in 8 seconds.");
    expect(templates.pipedrive_paused([{ kind: "organisations", done: 800, total: 800 }, { kind: "people", done: 1200, total: 3000 }])).toBe(
      "Import paused: Organisations 800 of 800, People 1,200 of 3,000.",
    );
    expect(templates.pipedrive_progress("people", 1200, 3000)).toBe("People · 1,200 of 3,000");
    expect(templates.pipedrive_owner_missing("Jane Fake", "jane@fake.example", 12)).toBe(
      "Owner 'Jane Fake' (jane@fake.example) has no CRM user: 12 records given to you.",
    );
    expect(templates.pipedrive_private_others(3)).toBe("3 private people of other owners imported.");
    expect(templates.pipedrive_owner_only_orgs(2)).toBe("2 owner-only organisations imported as shared.");
    expect(templates.pipedrive_list_missing("lead_source", "Webinar", 4)).toBe("Lead source not on the list: 'Webinar' (4 people)");
    expect(templates.pipedrive_list_missing("label", "Cold", 7)).toBe("Label not on the list: 'Cold' (7 people)");
    expect(templates.pipedrive_choice_missing("Colour", "Teal", 3)).toBe("'Teal' is not a choice of 'Colour': left out (3 records).");
    expect(templates.pipedrive_field_no_match("Favourite colour")).toBe("No CRM field named 'Favourite colour'.");
    expect(templates.pipedrive_field_type_mismatch("Budget", "varchar", "number")).toBe("'Budget' is a text field in Pipedrive and a number field in the CRM.");
    expect(templates.pipedrive_field_unsupported("Region", "address")).toBe("'Region' is an address field in Pipedrive: not imported.");
    expect(templates.pipedrive_field_unsupported("Odd", "json")).toBe("'Odd' is an other field in Pipedrive: not imported.");
    expect(templates.pipedrive_linked("Ada Example")).toBe("Ada Example was already in the CRM: linked, not changed.");
    expect(templates.pipedrive_unsubscribed("Ada Example")).toBe("Ada Example is unsubscribed in Pipedrive: now Unsubscribed in the CRM.");
    expect(templates.pipedrive_email_other_person("Ada Example")).toBe("Another Pipedrive person, 'Ada Example', has the same email address.");
    expect(templates.pipedrive_value_invalid("email address", "ada@")).toBe("Email address 'ada@' is not valid: left out.");
    expect(templates.pipedrive_value_too_long("role", 200)).toBe("Role longer than 200 characters: left out.");
    expect(templates.pipedrive_org_archived("Fakeco Ltd")).toBe("Fakeco Ltd is archived.");
    expect(templates.pipedrive_org_not_imported("Sample Studios Fake")).toBe("Its organisation 'Sample Studios Fake' was not imported: imported without an organisation.");
    expect(templates.pipedrive_currency("Budget", "EUR")).toBe("'Budget': amount in EUR, not GBP: left out.");
    expect(templates.pipedrive_imported_by("Linus Fake")).toBe("Imported from Pipedrive by Linus Fake");
    expect(templates.pipedrive_unsubscribed_by("Linus Fake")).toBe("Unsubscribed by the Pipedrive import of Linus Fake");
  });
  it("never answers a Pipedrive template from a URL code", () => {
    for (const code of ["pipedrive_connected", "pipedrive_linked", "pipedrive_field_no_match"]) expect(messageFor(code), code).toBeUndefined();
  });
});

// covers SF-121 T002: the unsubscribe page's texts and the three timeline lines
describe("unsubscribe messages (SF-121)", () => {
  it("has the exact texts", () => {
    expect(messages.unsubscribe_lead).toBe("Stop receiving campaign emails from Barnacle Labs.");
    expect(messages.unsubscribe_done).toBe("You're unsubscribed. You won't get any more campaign emails from us.");
    expect(messages.unsubscribe_invalid).toBe(
      "This unsubscribe link isn't valid any more. If you still get emails from us, reply to one and ask to be removed.",
    );
    expect(messages.unsubscribe_error).toBe("Something went wrong. Try again in a minute.");
    expect(templates.unsubscribed_link_event).toBe("Unsubscribed from campaigns through the unsubscribe link");
    expect(templates.unsubscribed_mail_app_event).toBe("Unsubscribed from campaigns through their mail app");
    expect(templates.consent_changed_event("Unsubscribed", "Subscribed")).toBe("Consent: Unsubscribed → Subscribed");
  });
});
