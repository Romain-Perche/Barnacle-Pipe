// covers FR-009, FR-018, FR-021, SC-007, US1 scenario 6 (SF-103 research.md §9): reasons name a person only when visible
import { describe, expect, it } from "vitest";
import { skipReason, warningText, type Names } from "@/server/imports/text";

const names: Names = { people: new Map([[100, "Ada Example"]]), organisations: new Map([[10, "Fakeco Ltd"]]) };

describe("skipReason", () => {
  it("names and links a duplicate the viewer can see, names nobody otherwise", () => {
    expect(skipReason({ row: 2, label: "x", code: "import_duplicate_email", personId: 100 }, names)).toEqual({
      text: "Ada Example already has this email address.", href: "/people/100",
    });
    expect(skipReason({ row: 2, label: "x", code: "import_duplicate_email", personId: 101 }, names)).toEqual({
      text: "Another person already has this email address.",
    });
  });
  it("names and links an existing organisation", () => {
    expect(skipReason({ row: 2, label: "x", code: "organisation_exists", organisationId: 10 }, names)).toEqual({
      text: "Fakeco Ltd already exists.", href: "/organisations/10",
    });
  });
  it("gives the form's message, and the import templates with their arguments", () => {
    expect(skipReason({ row: 2, label: "x", code: "email_invalid" }, names).text).toBe("Enter a valid email address.");
    expect(skipReason({ row: 2, label: "x", code: "import_too_long", args: { field: "role", max: 200 } }, names).text).toBe("Keep the role under 200 characters.");
    expect(skipReason({ row: 2, label: "x", code: "import_duplicate_in_file", args: { row: 4 } }, names).text).toBe("Row 4 has the same email address.");
    expect(skipReason({ row: 2, label: "x", code: "import_consent_unknown", args: { value: "maybe" } }, names).text).toBe(
      "Consent not recognised: 'maybe'. Use Subscribed or Unsubscribed.",
    );
  });
});

describe("warningText", () => {
  it("quotes the file's value and lists the rows", () => {
    expect(warningText({ code: "import_label_unknown", value: "Cold", rows: [7] }).text).toBe("Label not on the list: 'Cold' (row 7)");
    expect(warningText({ code: "import_lead_source_unknown", value: "Your account is locked", rows: [2] }).text).toBe(
      "Lead source not on the list: 'Your account is locked' (row 2)",
    );
    expect(warningText({ code: "import_organisation_archived", value: "Fakeco Ltd", organisationId: 10, rows: [3] })).toEqual({
      text: "Fakeco Ltd is archived. (row 3)", href: "/organisations/10",
    });
  });
});
