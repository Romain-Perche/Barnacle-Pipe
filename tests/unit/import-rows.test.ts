// covers FR-008, FR-014, SC-005, edge cases "spaces around a value", "more values than headings", "Full name",
// "several emails or phones in a cell", "a formula in a cell", "a value longer than the form allows" (SF-103 research.md §5)
import { describe, expect, it } from "vitest";
import type { ColumnMapping, MappedColumn } from "@/server/imports/columns";
import { organisationFormFromRow, parseConsent, parseSize, personFormFromRow, splitFullName, splitMulti, tooLong } from "@/server/imports/rows";

const cols = (...specs: (MappedColumn["field"] | [MappedColumn["field"], MappedColumn["kind"]])[]): ColumnMapping => ({
  columns: specs.map((s, index) => (Array.isArray(s) ? { index, heading: s[0], field: s[0], kind: s[1] } : { index, heading: s, field: s })),
});

function person(values: string[], mapping: ColumnMapping) {
  const r = personFormFromRow(values, mapping);
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.error)}`);
  return r.value;
}
const refusal = (values: string[], mapping: ColumnMapping) => {
  const r = personFormFromRow(values, mapping);
  return r.ok ? null : r.error;
};

describe("personFormFromRow", () => {
  const basic = cols("first_name", "last_name", "email", "role");

  it("trims every value and keeps formulas and @ values as typed", () => {
    const p = person(["  Ada ", " Example", " ADA@Fakeco.Example ", "  COO  "], basic);
    expect(p.fields).toMatchObject({ firstName: "Ada", lastName: "Example", role: "COO", emails: [{ email: "ada@fakeco.example", kind: "work" }] });
    expect(person(["Ada", "", "", "=SUM(A1:A2)"], basic).fields.role).toBe("=SUM(A1:A2)");
    expect(person(["Ada", "", "", "@admin"], basic).fields.role).toBe("@admin");
  });

  it("refuses more values than headings and reads missing values as empty", () => {
    expect(refusal(["Ada", "Example", "", "", "extra"], basic)).toEqual({ code: "import_too_many_values" });
    expect(person(["Ada"], basic).fields).toMatchObject({ firstName: "Ada", lastName: "", emails: [], role: null });
  });

  it("splits a full name when no first or last name column is set", () => {
    expect(person(["Ada May Example"], cols("full_name")).fields).toMatchObject({ firstName: "Ada", lastName: "May Example" });
    expect(person(["Cher"], cols("full_name")).fields).toMatchObject({ firstName: "Cher", lastName: "" });
    expect(person(["Ada", "Ada May Example"], cols("first_name", "full_name")).fields).toMatchObject({ firstName: "Ada", lastName: "" });
  });

  it("splits email and phone cells on , and ;, after earlier columns, the first one main", () => {
    const p = person(["Ada", "a@x.example; b@x.example", "c@x.example", "+44 1, 020 7946", "07700 900000"], cols("first_name", ["email", "personal"], ["email", "other"], "phone", ["phone", "personal"]));
    expect(p.fields.emails).toEqual([
      { email: "a@x.example", kind: "personal" },
      { email: "b@x.example", kind: "personal" },
      { email: "c@x.example", kind: "other" },
    ]);
    expect(p.fields.phones).toEqual([
      { phone: "+44 1", kind: "work" },
      { phone: "020 7946", kind: "work" },
      { phone: "07700 900000", kind: "personal" },
    ]);
  });

  it("gives the person form's message for a refused row", () => {
    expect(refusal(["", "", "a@x.example"], basic)).toEqual({ code: "name_required" });
    expect(refusal(["Ada", "", "ada@"], basic)).toEqual({ code: "email_invalid" });
    expect(refusal(["Ada", "", "a@x.example, A@x.example"], basic)).toEqual({ code: "email_twice" });
    expect(refusal(["Ada", "call me"], cols("first_name", "phone"))).toEqual({ code: "phone_invalid" });
    expect(refusal(["Ada", "https://example.com/ada"], cols("first_name", "linkedin"))).toEqual({ code: "linkedin_invalid" });
  });

  it("refuses values longer than the form keeps instead of cutting them", () => {
    expect(refusal(["x".repeat(101)], basic)).toEqual({ code: "import_too_long", args: { field: "first name", max: 100 } });
    expect(refusal(["Ada", "x".repeat(101)], basic)).toEqual({ code: "import_too_long", args: { field: "last name", max: 100 } });
    expect(refusal(["Ada", "", "", "x".repeat(201)], basic)).toEqual({ code: "import_too_long", args: { field: "role", max: 200 } });
    expect(refusal(["Ada", "x".repeat(201)], cols("first_name", "organisation"))).toEqual({
      code: "import_too_long", args: { field: "organisation name", max: 200 },
    });
    expect(person(["x".repeat(100), "", "", "y".repeat(200)], basic).fields.role).toBe("y".repeat(200));
  });

  it("reads lead source, labels, owner, organisation and consent as text, labels split and once each", () => {
    const p = person(["Ada", " Fakeco Ltd ", " Referral ", "Hot; Cold, ", "hot", " linus@barnacle.ai ", "no"], cols("first_name", "organisation", "lead_source", "labels", "labels", "owner", "consent"));
    expect(p).toMatchObject({ organisationName: "Fakeco Ltd", leadSource: "Referral", labels: ["Hot", "Cold", "hot"], owner: "linus@barnacle.ai", consent: "unsubscribed" });
    expect(p.fields.private).toBe(false);
    expect(person(["Ada", ""], cols("first_name", "consent")).consent).toBeNull();
  });

  it("refuses an unrecognised consent value", () => {
    expect(refusal(["Ada", "maybe"], cols("first_name", "consent"))).toEqual({ code: "import_consent_unknown", args: { value: "maybe" } });
  });

  it("labels the row with its name, else its first email", () => {
    expect(personFormFromRow(["Ada", "Example", "a@x.example"], basic).label).toBe("Ada Example");
    expect(refusal(["", "", "a@x.example"], basic)).toEqual({ code: "name_required" });
    const r = personFormFromRow(["", "", "a@x.example"], basic);
    expect(r.label).toBe("a@x.example");
  });
});

describe("organisationFormFromRow", () => {
  const m = cols("name", "website", "sector", "size", "location", "owner");
  it("saves the website as the form does and the size as a band", () => {
    const r = organisationFormFromRow([" Fakeco Ltd ", "fakeco.example", "Fitness", "35", "London", ""], m);
    if (!r.ok) throw new Error(r.error.code);
    expect(r.value.fields).toEqual({ name: "Fakeco Ltd", website: "https://fakeco.example", sector: "Fitness", size: "11–50", location: "London", ownerId: null });
    expect(r.value.sizeUnknown).toBeNull();
  });
  it("leaves an unrecognised size empty and says so", () => {
    const r = organisationFormFromRow(["Fakeco Ltd", "", "", "medium", "", ""], m);
    if (!r.ok) throw new Error(r.error.code);
    expect(r.value.fields.size).toBeNull();
    expect(r.value.sizeUnknown).toBe("medium");
  });
  it("gives the organisation form's message for a refused row and refuses long values", () => {
    expect(organisationFormFromRow(["", "x.example"], m)).toMatchObject({ ok: false, error: { code: "organisation_name_required" } });
    expect(organisationFormFromRow(["Fakeco", "not a site"], m)).toMatchObject({ ok: false, error: { code: "website_invalid" } });
    expect(organisationFormFromRow(["x".repeat(201)], m)).toMatchObject({ ok: false, error: { code: "import_too_long", args: { field: "name", max: 200 } } });
    expect(organisationFormFromRow(["F", "", "x".repeat(101)], m)).toMatchObject({ ok: false, error: { code: "import_too_long", args: { field: "sector", max: 100 } } });
    expect(organisationFormFromRow(["F", "", "", "", "x".repeat(101)], m)).toMatchObject({ ok: false, error: { code: "import_too_long", args: { field: "location", max: 100 } } });
  });
});

describe("value rules", () => {
  it("splitFullName splits at the first run of spaces", () => {
    expect(splitFullName("Ada   May Example")).toEqual({ first: "Ada", last: "May Example" });
    expect(splitFullName("Ada")).toEqual({ first: "Ada", last: "" });
  });
  it("splitMulti splits on , and ; and drops empty parts", () => {
    expect(splitMulti(" a ; b,, c ")).toEqual(["a", "b", "c"]);
    expect(splitMulti("")).toEqual([]);
  });
  it("tooLong answers the template arguments only past the maximum", () => {
    expect(tooLong("role", "x".repeat(200), 200)).toBeNull();
    expect(tooLong("role", "x".repeat(201), 200)).toEqual({ code: "import_too_long", args: { field: "role", max: 200 } });
  });
  it("parseConsent reads the subscribed and unsubscribed words, never guesses", () => {
    for (const w of ["unsubscribed", "Unsubscribed", "no", "false", "opted out", "Opt out", "optedout", "n", "0"]) expect(parseConsent(w), w).toBe("unsubscribed");
    for (const w of ["subscribed", "Subscribed", "yes", "true", "opted in", "opt in", "optedin", "y", "1"]) expect(parseConsent(w), w).toBe("subscribed");
    expect(parseConsent("  ")).toBeNull();
    expect(parseConsent("maybe")).toBe("unknown");
  });
  it("parseSize reads bands, hyphens and whole numbers", () => {
    expect(parseSize("11–50")).toBe("11–50");
    expect(parseSize("11-50")).toBe("11–50");
    expect(parseSize("201-1,000")).toBe("201–1,000");
    expect(parseSize("1000+")).toBe("1,000+");
    expect(parseSize("1,000+")).toBe("1,000+");
    expect(parseSize("35")).toBe("11–50");
    expect(parseSize("1,200")).toBe("1,000+");
    expect(parseSize("1000")).toBe("201–1,000");
    expect(parseSize("10")).toBe("1–10");
    expect(parseSize("")).toBeNull();
    expect(parseSize("0")).toBe("unknown");
    expect(parseSize("medium")).toBe("unknown");
  });
});

// covers SF-115 FR-013, US5 scenarios 2–4: custom cells read, unreadable ones listed, too long text refuses the row
import { personFormFromRow as personRow, organisationFormFromRow as orgRow } from "@/server/imports/rows";
import type { CustomField as CF } from "@/server/custom-fields/rules";
describe("custom columns of a row", () => {
  const diet: CF = { id: 1, kind: "person", name: "Diet", type: "single_choice", position: 1, inList: false,
    choices: [{ id: 11, name: "Vegan", position: 1, removed: false }, { id: 12, name: "Old", position: 2, removed: true }] };
  const nick: CF = { id: 2, kind: "person", name: "Nick", type: "text", position: 2, inList: false, choices: [] };
  const born: CF = { id: 3, kind: "person", name: "Born", type: "date", position: 3, inList: false, choices: [] };
  const mapping = { columns: [
    { index: 0, heading: "First", field: "first_name" as const }, { index: 1, heading: "Diet", field: "custom:1" as const },
    { index: 2, heading: "Nick", field: "custom:2" as const }, { index: 3, heading: "Born", field: "custom:3" as const },
  ] };
  it("reads readable values and lists the unreadable ones", () => {
    const r = personRow(["Ada", "vegan", "Addy", "24/11/1990"], mapping, [diet, nick, born]);
    expect(r).toMatchObject({ ok: true, value: { custom: [{ fieldId: 1, value: 11 }, { fieldId: 2, value: "Addy" }, { fieldId: 3, value: "1990-11-24" }], unreadable: [] } });
    const bad = personRow(["Ada", "Pescatarian", "", "soon"], mapping, [diet, nick, born]);
    expect(bad).toMatchObject({ ok: true, value: { custom: [], unreadable: [{ field: "Diet", value: "Pescatarian", code: "import_custom_choice_unknown" }, { field: "Born", value: "soon", code: "import_custom_unreadable" }] } });
    // A removed choice is not set from a file.
    expect(personRow(["Ada", "Old", "", ""], mapping, [diet, nick, born])).toMatchObject({ ok: true, value: { unreadable: [{ field: "Diet", value: "Old" }] } });
  });
  // covers SF-115 fix round 1 (US5 scenario 2): a multiple choice cell keeps its known parts and warns per unknown part
  it("keeps the known parts of a multiple choice cell and lists each unknown part", () => {
    const topics: CF = { id: 5, kind: "person", name: "Topics", type: "multiple_choice", position: 5, inList: false,
      choices: [{ id: 51, name: "AI", position: 1, removed: false }, { id: 52, name: "Events", position: 2, removed: false }] };
    const m = { columns: [{ index: 0, heading: "First", field: "first_name" as const }, { index: 1, heading: "Topics", field: "custom:5" as const }] };
    expect(personRow(["Ada", "AI, Nope"], m, [topics])).toMatchObject({ ok: true, value: {
      custom: [{ fieldId: 5, value: [51] }], unreadable: [{ field: "Topics", value: "Nope", code: "import_custom_choice_unknown" }] } });
    expect(personRow(["Ada", "Nope; Other"], m, [topics])).toMatchObject({ ok: true, value: { custom: [], unreadable: [
      { field: "Topics", value: "Nope", code: "import_custom_choice_unknown" }, { field: "Topics", value: "Other", code: "import_custom_choice_unknown" }] } });
  });
  it("refuses a row whose text is over its limit", () => {
    expect(personRow(["Ada", "", "x".repeat(256), ""], mapping, [diet, nick, born])).toMatchObject({ ok: false, error: { code: "import_too_long", args: { field: "Nick", max: 255 } } });
  });
  it("ignores a column of a field that is gone", () => {
    expect(personRow(["Ada", "vegan", "x", "y"], mapping, [nick])).toMatchObject({ ok: true, value: { custom: [{ fieldId: 2, value: "x" }], unreadable: [] } });
  });
  it("reads organisation rows too", () => {
    const code: CF = { id: 4, kind: "organisation", name: "Code", type: "number", position: 1, inList: false, choices: [] };
    const m = { columns: [{ index: 0, heading: "Name", field: "name" as const }, { index: 1, heading: "Code", field: "custom:4" as const }] };
    expect(orgRow(["Fakeco", "1,234"], m, [code])).toMatchObject({ ok: true, value: { custom: [{ fieldId: 4, value: "1234" }] } });
  });
});
