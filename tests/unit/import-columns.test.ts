// covers FR-002, FR-004, FR-005, edge cases "a column with no heading", "two columns set to a single-value field",
// "no name column", "Date added and Last contacted columns" (SF-103 research.md §4, §10)
import { describe, expect, it } from "vitest";
import { checkMapping, columnLabel, exampleCsv, headingKey, ORGANISATION_IMPORT_FIELDS, PERSON_IMPORT_FIELDS, suggest, type ColumnMapping } from "@/server/imports/columns";
import { readFile } from "@/server/imports/csv";

const fields = (m: ColumnMapping) => m.columns.map((c) => (c.kind ? `${c.field}:${c.kind}` : c.field));
const mapping = (...cols: string[]): ColumnMapping => ({
  columns: cols.map((field, index) => ({ index, heading: field, field: field as ColumnMapping["columns"][number]["field"] })),
});

describe("headingKey", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(headingKey("E-mail")).toBe("email");
    expect(headingKey("e mail")).toBe("email");
    expect(headingKey(" EMAIL ")).toBe("email");
    expect(headingKey("Job title")).toBe("jobtitle");
  });
});

describe("suggest", () => {
  it("matches the standard people headings, Job title as role", () => {
    const m = suggest("people", ["First name", "Last name", "Email", "Phone", "Organisation", "Job title", "Lead source", "Labels"]);
    expect(fields(m)).toEqual(["first_name", "last_name", "email:work", "phone:work", "organisation", "role", "lead_source", "labels"]);
    expect(m.columns.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("matches US spellings and other common headings", () => {
    expect(fields(suggest("people", ["Organization", "Mobile", "Personal email", "E-mail", "Surname", "LinkedIn URL", "Owner", "Consent"]))).toEqual([
      "organisation", "phone:personal", "email:personal", "email:work", "last_name", "linkedin", "owner", "consent",
    ]);
    expect(fields(suggest("people", ["Company"]))).toEqual(["organisation"]);
  });
  it("sets Don't import for Date added, Last contacted, Notes and a second single-value column", () => {
    expect(fields(suggest("people", ["Date added", "Last contacted", "Notes", "Lead source", "Source", "Email", "Work email"]))).toEqual([
      "skip", "skip", "skip", "lead_source", "skip", "email:work", "email:work",
    ]);
  });
  it("matches the organisation headings", () => {
    expect(fields(suggest("organisations", ["Name", "Website", "Sector", "Size", "Location", "Owner", "Notes"]))).toEqual([
      "name", "website", "sector", "size", "location", "owner", "skip",
    ]);
  });
});

describe("checkMapping", () => {
  it("refuses two columns on a single-value field", () => {
    expect(checkMapping("people", mapping("first_name", "lead_source", "lead_source"))).toEqual({ code: "import_one_column", field: "lead_source" });
    expect(checkMapping("organisations", mapping("name", "size", "size"))).toEqual({ code: "import_one_column", field: "size" });
  });
  it("accepts several email, phone and labels columns", () => {
    expect(checkMapping("people", mapping("first_name", "email", "email", "phone", "phone", "labels", "labels", "skip", "skip"))).toBeNull();
  });
  it("needs a name column", () => {
    expect(checkMapping("people", mapping("email", "role"))).toEqual({ code: "import_person_name_column" });
    expect(checkMapping("people", mapping("full_name"))).toBeNull();
    expect(checkMapping("people", mapping("last_name"))).toBeNull();
    expect(checkMapping("organisations", mapping("website"))).toEqual({ code: "import_organisation_name_column" });
  });
  it("reads an unknown or other kind's field as Don't import", () => {
    expect(checkMapping("organisations", mapping("name", "first_name", "first_name"))).toBeNull();
  });
});

describe("columnLabel", () => {
  it("shows a column with no heading by its position", () => {
    expect(columnLabel("", 2)).toBe("Column 3");
    expect(columnLabel("Email", 0)).toBe("Email");
  });
});

describe("fields", () => {
  it("labels each field as the select shows it", () => {
    expect(PERSON_IMPORT_FIELDS.find((f) => f.key === "role")?.label).toBe("Role or job title");
    expect(PERSON_IMPORT_FIELDS.filter((f) => f.multiple).map((f) => f.key)).toEqual(["email", "phone", "labels"]);
    expect(ORGANISATION_IMPORT_FIELDS.map((f) => f.key)).toEqual(["name", "website", "sector", "size", "location", "owner"]);
  });
});

describe("exampleCsv", () => {
  it("gives every people heading and two fake rows, with a BOM, that read back and match every field", () => {
    const bytes = new TextEncoder().encode(exampleCsv("people"));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const file = readFile(bytes);
    if (!file.ok) throw new Error(file.code);
    expect(file.headings).toEqual(["First name", "Last name", "Email", "Phone", "Organisation", "Job title", "Lead source", "Labels", "LinkedIn", "Owner", "Consent"]);
    expect(file.rows.length).toBe(2);
    expect(file.rows.every((r) => r.values[2].endsWith("@fakeco.example"))).toBe(true);
    expect(suggest("people", file.headings).columns.every((c) => c.field !== "skip")).toBe(true);
  });
  it("gives every organisation heading and two fake rows", () => {
    const file = readFile(new TextEncoder().encode(exampleCsv("organisations")));
    if (!file.ok) throw new Error(file.code);
    expect(file.headings).toEqual(["Name", "Website", "Sector", "Size", "Location", "Owner"]);
    expect(file.rows.length).toBe(2);
    expect(suggest("organisations", file.headings).columns.every((c) => c.field !== "skip")).toBe(true);
  });
});

// covers SF-115 FR-013, US5 scenario 1: custom fields as targets, suggested by name before built-in aliases, one column each
import { checkMapping as checkCustom, fieldLabel as labelOf, fieldsFor as fieldsOf, suggest as suggestCustom, toField as toFieldCustom } from "@/server/imports/columns";
import type { CustomField } from "@/server/custom-fields/rules";
describe("custom field targets", () => {
  const source: CustomField = { id: 7, kind: "person", name: "Source", type: "text", position: 1, inList: false, choices: [] };
  const diet: CustomField = { id: 8, kind: "person", name: "Dietary needs", type: "single_choice", position: 2, inList: false, choices: [] };
  it("offers custom fields after the built-in fields", () => {
    const keys = fieldsOf("people", [source, diet]).map((f) => f.key);
    expect(keys.slice(-2)).toEqual(["custom:7", "custom:8"]);
    expect(labelOf("people", "custom:8", [source, diet])).toBe("Dietary needs");
    expect(toFieldCustom("people", "custom:8", [diet])).toBe("custom:8");
    expect(toFieldCustom("people", "custom:9", [diet])).toBe("skip");
  });
  it("suggests a heading equal to the field name (case, spaces, punctuation ignored) before a built-in alias", () => {
    const m = suggestCustom("people", ["First name", "SOURCE", "dietary-needs", "Lead source", "Source"], [source, diet]);
    expect(m.columns.map((c) => c.field)).toEqual(["first_name", "custom:7", "custom:8", "lead_source", "skip"]);
    expect(m.columns[2].customName).toBe("Dietary needs");
    // Without the custom field, "Source" is the lead source as before.
    expect(suggestCustom("people", ["Source"]).columns[0].field).toBe("lead_source");
  });
  it("lets a custom field take one column", () => {
    const mapping = { columns: [{ index: 0, heading: "a", field: "first_name" as const }, { index: 1, heading: "b", field: "custom:8" as const }, { index: 2, heading: "c", field: "custom:8" as const }] };
    expect(checkCustom("people", mapping, [diet])).toEqual({ code: "import_one_column", field: "custom:8" });
  });
});
