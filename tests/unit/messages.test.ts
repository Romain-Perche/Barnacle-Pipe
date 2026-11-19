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
