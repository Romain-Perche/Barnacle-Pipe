// covers FR-025 (messages only from messages.ts; templates never reachable from a URL code), contracts/routes.md § Messages
import { describe, expect, it } from "vitest";
import { messageFor, templates } from "@/server/messages";

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
