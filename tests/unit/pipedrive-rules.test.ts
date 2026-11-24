// covers SF-117 FR-007–FR-011, FR-013–FR-016, US2 scenarios 2, 3, 5–12, edge cases on values: the pure mapping of a
// Pipedrive person or organisation to the CRM's fields (left out with a warning, never cut), built-in field names,
// consent, privacy, size bands and every custom field type of FR-016
import { describe, expect, it } from "vitest";
import type { CustomField } from "@/server/custom-fields/rules";
import type { PdField, PdOrganization, PdPerson } from "@/server/pipedrive/api";
import {
  builtInOf,
  consentOf,
  contactKind,
  customCompatibility,
  fieldKey,
  isOwnerOnly,
  organisationFromPipedrive,
  parseAddTime,
  personFromPipedrive,
  planFields,
  readCustomValue,
} from "@/server/pipedrive/rules";

const pdField = (name: string, type: string, options: string[] = [], custom = true, code = `c_${fieldKey(name)}`): PdField => ({
  code,
  name,
  type,
  custom,
  options: options.map((label, i) => ({ id: i + 1, label })),
});
const crmField = (id: number, name: string, type: CustomField["type"], choices: (string | [string, boolean])[] = [], kind: CustomField["kind"] = "person"): CustomField => ({
  id,
  kind,
  name,
  type,
  position: id,
  inList: false,
  choices: choices.map((c, i) => (Array.isArray(c) ? { id: 100 * id + i, name: c[0], position: i, removed: c[1] } : { id: 100 * id + i, name: c, position: i, removed: false })),
});
const person = (p: Partial<PdPerson> = {}): PdPerson => ({
  id: 1, name: "", firstName: "Ada", lastName: "Fake", ownerId: 1, orgId: null, addTime: "2025-03-04 10:11:12", emails: [], phones: [], visibleTo: 3,
  labelIds: [], jobTitle: "", marketingStatus: null, custom: {}, deleted: false, ...p,
});
const org = (o: Partial<PdOrganization> = {}): PdOrganization => ({
  id: 1, name: "Fakeco Ltd", ownerId: 1, visibleTo: 3, addTime: "", address: "", website: "", industry: null, employeeCount: null, custom: {}, deleted: false, ...o,
});
const emptyPlan = planFields("person", [], []);

describe("names (FR-007, US2-3)", () => {
  it("keeps first and last names", () => {
    const r = personFromPipedrive(person({ firstName: "Ada", lastName: "Example" }), emptyPlan, "subscribed");
    expect(r.ok && [r.fields.firstName, r.fields.lastName]).toEqual(["Ada", "Example"]);
  });
  it("splits a full name as the CSV import does", () => {
    const r = personFromPipedrive(person({ firstName: "", lastName: "", name: "Ada May Example" }), emptyPlan, "subscribed");
    expect(r.ok && [r.fields.firstName, r.fields.lastName]).toEqual(["Ada", "May Example"]);
  });
  it("refuses a person with no name, and a name longer than the form keeps (edge case)", () => {
    const none = personFromPipedrive(person({ firstName: " ", lastName: "", name: "  " }), emptyPlan, "subscribed");
    expect(none).toMatchObject({ ok: false, problem: { code: "pipedrive_no_name" } });
    const long = personFromPipedrive(person({ firstName: "A".repeat(101) }), emptyPlan, "subscribed");
    expect(long).toMatchObject({ ok: false, problem: { code: "import_too_long", args: { field: "first name", max: 100 } } });
  });
});

describe("emails and phones (US2-2, FR-007, FR-015)", () => {
  it("keeps Pipedrive's order with the primary first; work → Work, home and mobile → Personal, others → Other", () => {
    const r = personFromPipedrive(
      person({
        emails: [{ value: "home@fake.example", primary: false, label: "home" }, { value: "Work@Fake.example", primary: true, label: "work" }],
        phones: [
          { value: "020 7946 0001", primary: false, label: "work" },
          { value: "07700 900001", primary: true, label: "mobile" },
          { value: "01632 960001", primary: false, label: "home" },
          { value: "01632 960002", primary: false, label: "fax" },
        ],
      }),
      emptyPlan,
      "subscribed",
    );
    if (!r.ok) throw new Error("refused");
    expect(r.fields.emails).toEqual([{ email: "work@fake.example", kind: "work" }, { email: "home@fake.example", kind: "personal" }]);
    expect(r.fields.phones).toEqual([
      { phone: "07700 900001", kind: "personal" },
      { phone: "020 7946 0001", kind: "work" },
      { phone: "01632 960001", kind: "personal" },
      { phone: "01632 960002", kind: "other" },
    ]);
    expect(contactKind("")).toBe("other");
  });
  it("leaves an invalid email or phone out with a warning, and keeps the person", () => {
    const r = personFromPipedrive(
      person({ emails: [{ value: "ada@", primary: true, label: "work" }, { value: "ada@fake.example", primary: false, label: "work" }], phones: [{ value: "call me", primary: true, label: "work" }] }),
      emptyPlan,
      "subscribed",
    );
    if (!r.ok) throw new Error("refused");
    expect(r.fields.emails).toEqual([{ email: "ada@fake.example", kind: "work" }]);
    expect(r.fields.phones).toEqual([]);
    expect(r.warnings).toEqual([
      { code: "pipedrive_value_invalid", args: { field: "email address", value: "ada@" } },
      { code: "pipedrive_value_invalid", args: { field: "phone number", value: "call me" } },
    ]);
  });
});

describe("built-in field names (FR-009, edge case)", () => {
  it("recognises role, lead source and LinkedIn ignoring case, spaces and punctuation", () => {
    expect(["Job Title", "role", " JOB-title "].map(builtInOf)).toEqual(["role", "role", "role"]);
    expect(["Lead-source", "Source", "lead source"].map(builtInOf)).toEqual(["leadSource", "leadSource", "leadSource"]);
    expect(["LinkedIn URL", "linkedin profile", "LinkedIn"].map(builtInOf)).toEqual(["linkedin", "linkedin", "linkedin"]);
    expect(builtInOf("Budget")).toBeNull();
  });
  it("never lists them as unmatched custom fields, even when a CRM custom field has the same name", () => {
    const plan = planFields("person", [pdField("Job Title", "varchar"), pdField("Lead-source", "enum", ["Webinar"]), pdField("LinkedIn URL", "varchar")], [crmField(1, "Job title", "text")]);
    expect(plan.notImported).toEqual([]);
    expect(plan.mapped).toEqual([]);
    expect(Object.keys(plan.builtIn).sort()).toEqual(["leadSource", "linkedin", "role"]);
  });
  it("reads role, lead source (option label) and LinkedIn from those fields", () => {
    const fields = [pdField("Role", "varchar"), pdField("Source", "enum", ["Referral", "Webinar"]), pdField("LinkedIn profile", "varchar")];
    const plan = planFields("person", fields, []);
    const r = personFromPipedrive(person({ custom: { c_role: "Fake Director", c_source: 2, c_linkedinprofile: "linkedin.com/in/ada-fake" } }), plan, "subscribed");
    if (!r.ok) throw new Error("refused");
    expect([r.fields.role, r.leadSource, r.fields.linkedin]).toEqual(["Fake Director", "Webinar", "https://linkedin.com/in/ada-fake"]);
    // Pipedrive's own job_title comes first.
    const own = personFromPipedrive(person({ jobTitle: "Chief Fake", custom: { c_role: "Other" } }), plan, "subscribed");
    expect(own.ok && own.fields.role).toBe("Chief Fake");
  });
  it("leaves out a role over 200 characters and a LinkedIn value that is not a link, with warnings", () => {
    const plan = planFields("person", [pdField("LinkedIn", "varchar")], []);
    const r = personFromPipedrive(person({ jobTitle: "R".repeat(201), custom: { c_linkedin: "not a link" } }), plan, "subscribed");
    if (!r.ok) throw new Error("refused");
    expect(r.fields.role).toBeNull();
    expect(r.fields.linkedin).toBeNull();
    expect(r.warnings).toEqual([
      { code: "pipedrive_value_too_long", args: { field: "role", max: 200 } },
      { code: "pipedrive_value_invalid", args: { field: "LinkedIn link", value: "not a link" } },
    ]);
  });
  it("reads label names from the label field's options", () => {
    const plan = planFields("person", [pdField("Labels", "set", ["Hot", "Cold"], false, "label_ids")], []);
    const r = personFromPipedrive(person({ labelIds: [2, 1] }), plan, "subscribed");
    expect(r.ok && r.labels).toEqual(["Cold", "Hot"]);
  });
});

describe("consent (FR-014, US2-7)", () => {
  it("follows Pipedrive's subscribed / unsubscribed, else the user's choice", () => {
    expect(consentOf("unsubscribed", "subscribed")).toBe("unsubscribed");
    expect(consentOf("subscribed", "unsubscribed")).toBe("subscribed");
    for (const s of ["no_consent", "archived", null, ""]) {
      expect(consentOf(s, "unsubscribed"), String(s)).toBe("unsubscribed");
      expect(consentOf(s, "subscribed"), String(s)).toBe("subscribed");
    }
  });
});

describe("privacy (FR-013)", () => {
  it("is owner only for visible_to 1 only", () => {
    expect(isOwnerOnly(1)).toBe(true);
    for (const v of [3, 5, 7, null]) expect(isOwnerOnly(v)).toBe(false);
  });
});

describe("Date added", () => {
  it("reads Pipedrive's UTC timestamps, or null", () => {
    expect(parseAddTime("2025-03-04 10:11:12")?.toISOString()).toBe("2025-03-04T10:11:12.000Z");
    expect(parseAddTime("2025-03-04T10:11:12Z")?.toISOString()).toBe("2025-03-04T10:11:12.000Z");
    expect(parseAddTime("soon")).toBeNull();
  });
});

describe("organisations (FR-008, US2-10)", () => {
  const plan = planFields("organisation", [pdField("Industry", "enum", ["Software", "Retail"], false, "industry")], []);
  it("maps the address, website, industry and the number of employees to their band", () => {
    const r = organisationFromPipedrive(org({ address: "1 Fake Street", website: "fakeco.example", industry: 2, employeeCount: 12 }), plan);
    if (!r.ok) throw new Error("refused");
    expect(r.fields).toMatchObject({ name: "Fakeco Ltd", location: "1 Fake Street", website: "https://fakeco.example", sector: "Retail", size: "11–50" });
  });
  it("leaves out a size that fits no band and a refused website, with warnings; the organisation stays", () => {
    const r = organisationFromPipedrive(org({ employeeCount: 0, website: "not a site" }), plan);
    if (!r.ok) throw new Error("refused");
    expect(r.fields.size).toBeNull();
    expect(r.fields.website).toBeNull();
    expect(r.warnings).toEqual([
      { code: "pipedrive_value_invalid", args: { field: "website", value: "not a site" } },
      { code: "pipedrive_value_invalid", args: { field: "number of employees", value: "0" } },
    ]);
  });
  it("refuses an organisation without a name or with one over 200 characters", () => {
    expect(organisationFromPipedrive(org({ name: "  " }), plan)).toMatchObject({ ok: false, problem: { code: "pipedrive_no_name" } });
    expect(organisationFromPipedrive(org({ name: "N".repeat(201) }), plan)).toMatchObject({ ok: false, problem: { code: "import_too_long", args: { field: "name", max: 200 } } });
  });
  it("leaves out a location over 100 characters", () => {
    const r = organisationFromPipedrive(org({ address: "A".repeat(101) }), plan);
    expect(r.ok && r.fields.location).toBeNull();
    expect(r.ok && r.warnings).toEqual([{ code: "pipedrive_value_too_long", args: { field: "location", max: 100 } }]);
  });
});

describe("custom fields (FR-016, US2-11, US2-12)", () => {
  it("accepts every compatible pair of FR-016", () => {
    const pairs: [string, CustomField["type"], string[]?][] = [
      ["varchar", "text"], ["text", "long_text"], ["text", "text"], ["double", "number"], ["int", "number"], ["monetary", "money"],
      ["date", "date"], ["enum", "single_choice"], ["set", "multiple_choice"], ["enum", "yes_no", ["Yes", "No"]], ["enum", "single_choice", ["yes", "no"]],
    ];
    for (const [pd, crm, opts] of pairs) expect(customCompatibility(pdField("F", pd, opts ?? []), crmField(1, "F", crm)), `${pd}→${crm}`).toEqual({ ok: true });
  });
  it("refuses a mismatch, an unsupported type and a missing field, each with its reason", () => {
    expect(customCompatibility(pdField("Budget", "varchar"), crmField(1, "Budget", "number"))).toEqual({
      ok: false, code: "pipedrive_field_type_mismatch", args: { name: "Budget", pd: "varchar", crm: "number" },
    });
    expect(customCompatibility(pdField("Pick", "enum", ["A", "B"]), crmField(1, "Pick", "yes_no"))).toMatchObject({ ok: false, code: "pipedrive_field_type_mismatch" });
    expect(customCompatibility(pdField("Region", "address"), crmField(1, "Region", "text"))).toEqual({ ok: false, code: "pipedrive_field_unsupported", args: { name: "Region", pd: "address" } });
    expect(customCompatibility(pdField("Region", "address"), undefined)).toMatchObject({ code: "pipedrive_field_unsupported" });
    expect(customCompatibility(pdField("Favourite colour", "varchar"), undefined)).toEqual({ ok: false, code: "pipedrive_field_no_match", args: { name: "Favourite colour" } });
  });
  it("matches CRM fields by name ignoring case and surrounding spaces; lists each unmatched field once", () => {
    const plan = planFields("person", [pdField(" budget ", "double"), pdField("Favourite colour", "varchar"), pdField("Region", "address")], [crmField(1, "Budget", "number")]);
    expect(plan.mapped.map((m) => m.crm.name)).toEqual(["Budget"]);
    expect(plan.notImported).toEqual([
      { kind: "person", name: "Favourite colour", code: "pipedrive_field_no_match", args: { name: "Favourite colour" } },
      { kind: "person", name: "Region", code: "pipedrive_field_unsupported", args: { name: "Region", pd: "address" } },
    ]);
  });
  it("reads each type's value", () => {
    const yes = pdField("NDA", "enum", ["Yes", "No"]);
    expect(readCustomValue(pdField("T", "varchar"), crmField(1, "T", "text"), " hello ")).toEqual({ value: "hello" });
    expect(readCustomValue(pdField("N", "double"), crmField(1, "N", "number"), 1234.5)).toEqual({ value: "1234.5" });
    expect(readCustomValue(pdField("M", "monetary"), crmField(1, "M", "money"), { value: 250.5, currency: "GBP" })).toEqual({ value: 25050 });
    expect(readCustomValue(pdField("D", "date"), crmField(1, "D", "date"), "2026-11-24")).toEqual({ value: "2026-11-24" });
    expect(readCustomValue(yes, crmField(1, "NDA", "yes_no"), 1)).toEqual({ value: true });
    expect(readCustomValue(yes, crmField(1, "NDA", "yes_no"), 2)).toEqual({ value: false });
    const single = crmField(2, "Colour", "single_choice", ["Red", "Teal"]);
    expect(readCustomValue(pdField("Colour", "enum", ["TEAL", "Blue"]), single, 1)).toEqual({ value: 201 });
    const multi = crmField(3, "Topics", "multiple_choice", ["AI", "Events", ["Old", true]]);
    expect(readCustomValue(pdField("Topics", "set", ["events", "ai", "Hiring", "old"]), multi, [1, 2, 3, 4])).toEqual({ value: [300, 301], missing: ["Hiring", "old"] });
    expect(readCustomValue(pdField("Topics", "set", ["events"]), multi, null)).toBeNull();
  });
  it("counts an option that is not a current choice, and leaves out values over the limits with warnings", () => {
    const single = crmField(2, "Colour", "single_choice", ["Red", ["Teal", true]]);
    expect(readCustomValue(pdField("Colour", "enum", ["Teal"]), single, 1)).toEqual({ value: null, missing: ["Teal"] });
    expect(readCustomValue(pdField("T", "varchar"), crmField(1, "T", "text"), "x".repeat(256))).toEqual({ warning: { code: "pipedrive_value_too_long", args: { field: "T", max: 255 } } });
    expect(readCustomValue(pdField("T", "text"), crmField(1, "T", "long_text"), "x".repeat(10_001))).toEqual({ warning: { code: "pipedrive_value_too_long", args: { field: "T", max: 10_000 } } });
    expect(readCustomValue(pdField("N", "double"), crmField(1, "N", "number"), 1.23456)).toEqual({ warning: { code: "pipedrive_value_invalid", args: { field: "N", value: "1.23456" } } });
    expect(readCustomValue(pdField("M", "monetary"), crmField(1, "M", "money"), { value: 10, currency: "EUR" })).toEqual({ warning: { code: "pipedrive_currency", args: { field: "M", currency: "EUR" } } });
  });
  it("puts mapped values, missing choices and warnings on the person", () => {
    const fields = [pdField("Budget", "double"), pdField("Colour", "enum", ["Teal"]), pdField("Notes", "varchar")];
    const plan = planFields("person", fields, [crmField(1, "Budget", "number"), crmField(2, "Colour", "single_choice", ["Red"]), crmField(3, "Notes", "text")]);
    const r = personFromPipedrive(person({ custom: { c_budget: 12, c_colour: 1, c_notes: "y".repeat(300) } }), plan, "subscribed");
    if (!r.ok) throw new Error("refused");
    expect(r.custom).toEqual([{ fieldId: 1, value: "12" }]);
    expect(r.missingChoices).toEqual([{ field: "Colour", value: "Teal" }]);
    expect(r.warnings).toEqual([{ code: "pipedrive_value_too_long", args: { field: "Notes", max: 255 } }]);
  });
});
