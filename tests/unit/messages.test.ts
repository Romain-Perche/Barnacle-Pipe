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
