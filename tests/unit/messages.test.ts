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

// covers FR-016 (SF-92): the hand-over, the deleted-person lines and the owner notice, contracts/routes.md § Messages
describe("SF-92 messages", () => {
  it("has the fixed texts", () => {
    expect(messageFor("private_label")).toBe("Private (only the creator and the owner can see this person)");
    expect(messageFor("deleted_person_linked")).toBe("A deleted person was linked");
    expect(messageFor("deleted_person_unlinked")).toBe("A deleted person was unlinked");
    expect(messageFor("handover_choose")).toBe("Choose a user");
    expect(messageFor("handover_choose_user")).toBe("Choose an active user.");
    expect(messageFor("handover_not_deactivated")).toBe("Only a deactivated user's private people can be handed over.");
    expect(messageFor("handover_explain_unchosen")).toBe(
      "They stay private. The user you choose becomes their owner and can see them. You will not see who they are.",
    );
    expect(messageFor("handover_button")).toBe("[ HAND OVER ]");
    expect(messageFor("handover_cancel")).toBe("[ CANCEL ]");
    expect(messageFor("handover_to_label")).toBe("Hand over to");
  });
  it("builds the templates, singular and plural", () => {
    expect(templates.private_people(1)).toBe("1 private person");
    expect(templates.private_people(2)).toBe("2 private people");
    expect(templates.handover_question("Alan Fake", 2, "Margaret Fake")).toBe("Hand Alan Fake's 2 private people to Margaret Fake?");
    expect(templates.handover_question("Alan Fake", 1, "Margaret Fake")).toBe("Hand Alan Fake's 1 private person to Margaret Fake?");
    expect(templates.handover_explain("Margaret Fake")).toBe(
      "They stay private. Margaret Fake becomes their owner and can see them. You will not see who they are.",
    );
    expect(templates.handed_over("Margaret Fake", 2)).toBe("2 private people handed to Margaret Fake.");
    expect(templates.handed_over("Margaret Fake", 1)).toBe("1 private person handed to Margaret Fake.");
    expect(templates.handover_none("Alan Fake")).toBe("Alan Fake has no private people to hand over.");
    expect(templates.handed_over_event("Margaret Fake")).toBe("Handed to Margaret Fake");
    expect(templates.person_no_longer_visible("Ada Example")).toBe("You can no longer see Ada Example: only their creator and owner can.");
  });
  it("never answers the new template codes from messageFor", () => {
    for (const code of ["private_people", "handover_question", "handover_explain", "handed_over", "handover_none", "handed_over_event", "person_no_longer_visible"]) {
      expect(messageFor(code), code).toBeUndefined();
    }
  });
});
