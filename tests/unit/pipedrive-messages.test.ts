// covers SF-122 contracts/routes.md § Messages, FR-019, FR-021: the new fixed messages and templates, singular and plural,
// Pipedrive values quoted
import { describe, expect, it } from "vitest";
import { messageFor, templates } from "@/server/messages";

describe("SF-122 Pipedrive messages", () => {
  it("has the fixed messages verbatim", () => {
    expect(messageFor("pipedrive_emails_note")).toBe("Pipedrive emails are not imported: they will come from Gmail.");
    expect(messageFor("pipedrive_no_lost_reason")).toBe("No reason given in Pipedrive.");
    expect(messageFor("pipedrive_lost_reason_too_long")).toBe("Lost reason too long to import from Pipedrive.");
    expect(messageFor("pipedrive_note_empty")).toBe("Empty once its formatting is removed.");
    expect(messageFor("pipedrive_note_too_long")).toBe("Longer than 100,000 characters.");
    expect(messageFor("pipedrive_no_due_date")).toBe("No due date.");
    expect(messageFor("pipedrive_file_gone")).toBe("No longer in Pipedrive.");
    expect(messageFor("pipedrive_file_link")).toBe("A linked document, not an uploaded file.");
    expect(messageFor("pipedrive_file_empty")).toBe("Empty file.");
    expect(messageFor("pipedrive_stage_missing")).toBe("Its stage is not in Pipedrive any more.");
    expect(messageFor("pipedrive_private_deal")).toBe("a private deal");
    expect(messageFor("pipedrive_private_person")).toBe("a private person");
  });

  it("builds the templates, singular and plural", () => {
    expect(templates.pipedrive_pipeline_added("Fake Partners", 5)).toBe("Pipeline 'Fake Partners' added with 5 stages.");
    expect(templates.pipedrive_pipeline_added("Solo", 1)).toBe("Pipeline 'Solo' added with 1 stage.");
    expect(templates.pipedrive_stage_added("Proposal", "Sales")).toBe("Stage 'Proposal' added to the pipeline Sales.");
    expect(templates.pipedrive_pipelines_merged("Sales", "sales ")).toBe("Pipedrive pipelines 'Sales' and 'sales ' were imported into one pipeline.");
    expect(templates.pipedrive_stages_merged("Won", "won")).toBe("Pipedrive stages 'Won' and 'won' were imported into one stage.");
    expect(templates.pipedrive_name_not_created("pipeline", "x")).toBe("Pipeline name 'x' is longer than 100 characters: not created.");
    expect(templates.pipedrive_name_not_created("stage", "y")).toBe("Stage name 'y' is longer than 100 characters: not created.");
    expect(templates.pipedrive_pipeline_not_created("x")).toBe("Its pipeline 'x' could not be created.");
    expect(templates.pipedrive_person_not_imported("No Name Fake")).toBe("Its person 'No Name Fake' was not imported.");
    expect(templates.pipedrive_organisation_not_imported("Fakeco")).toBe("Its organisation 'Fakeco' was not imported.");
    expect(templates.pipedrive_deal_not_imported("Fakeco renewal")).toBe("Its deal 'Fakeco renewal' was not imported.");
    expect(templates.pipedrive_target_deleted("deal")).toBe("Its deal was deleted in the CRM.");
    expect(templates.pipedrive_target_deleted("organisation")).toBe("Its organisation was deleted in the CRM.");
    expect(templates.pipedrive_deal_currency("USD")).toBe("Value in USD, not GBP: left out.");
    expect(templates.pipedrive_participant_left_out("Ada Example")).toBe("Linked person 'Ada Example' was not imported: left out.");
    expect(templates.pipedrive_private_deals(2)).toBe("2 private deals of other owners imported.");
    expect(templates.pipedrive_private_deals(1)).toBe("1 private deal of other owners imported.");
    expect(templates.pipedrive_private_on("note", 4)).toBe("4 notes on private records of other owners imported.");
    expect(templates.pipedrive_private_on("note", 1)).toBe("1 note on private records of other owners imported.");
    expect(templates.pipedrive_private_on("activity", 1)).toBe("1 activity on private records of other owners imported.");
    expect(templates.pipedrive_private_on("activity", 3)).toBe("3 activities on private records of other owners imported.");
    expect(templates.pipedrive_private_on("file", 2)).toBe("2 files on private records of other owners imported.");
    expect(templates.pipedrive_types_as_tasks("deadline", 14)).toBe("14 'deadline' activities imported as tasks.");
    expect(templates.pipedrive_types_as_tasks("lunch", 1)).toBe("1 'lunch' activity imported as tasks.");
    expect(templates.pipedrive_elsewhere("note", "lead", 14)).toBe("14 notes on Pipedrive leads: not imported.");
    expect(templates.pipedrive_elsewhere("activity", "project", 1)).toBe("1 activity on Pipedrive projects: not imported.");
    expect(templates.pipedrive_elsewhere("file", "email", 2)).toBe("2 files on Pipedrive emails: not imported.");
    expect(templates.pipedrive_file_too_large("26.1")).toBe("Over 25 MB (26.1 MB).");
    expect(templates.pipedrive_duration_left_out("25:00")).toBe("Duration '25:00' is not between 5 minutes and 24 hours: left out.");
    expect(templates.pipedrive_list_missing("deal_label", "VIP", 3)).toBe("Deal label not on the list: 'VIP' (3 deals)");
  });

  it("counts the six kinds in progress and pause lines, in the order given", () => {
    expect(templates.pipedrive_progress("deals", 1200, 2000)).toBe("Deals · 1,200 of 2,000");
    const parts = (["organisations", "people", "deals", "notes", "activities", "files"] as const).map((kind) => ({ kind, done: 1, total: 2 }));
    expect(templates.pipedrive_paused(parts)).toBe(
      "Import paused: Organisations 1 of 2, People 1 of 2, Deals 1 of 2, Notes 1 of 2, Activities 1 of 2, Files 1 of 2.",
    );
  });
});
