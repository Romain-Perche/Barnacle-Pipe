// covers FR-006, FR-007, FR-009 to FR-015, SC-003, SC-004, US1 scenarios 5–7, US2 scenarios 3–4, US3 scenarios 1–4
// (SF-103 research.md §6)
import { describe, expect, it } from "vitest";
import { suggest } from "@/server/imports/columns";
import { emptyLookups, planOrganisations, planPeople, type Lookups } from "@/server/imports/plan";

const IMPORTER = 1;

function lookups(over: Partial<Lookups> = {}): Lookups {
  return {
    ...emptyLookups(IMPORTER),
    organisations: new Map([
      ["fakeco ltd", { id: 10, name: "Fakeco Ltd", archived: false }],
      ["old fakeco archive", { id: 11, name: "Old Fakeco Archive", archived: true }],
    ]),
    emails: new Map([
      ["taken@fakeco.example", { personId: 100 }],
      ["private@fakeco.example", { personId: 101 }],
    ]),
    leadSources: new Map([["referral", 3], ["event", 5]]),
    labels: new Map([["hot", 7], ["investor", 8]]),
    users: [
      { id: 1, email: "ada@barnacle.ai", name: "ada fake" },
      { id: 2, email: "linus@barnacle.ai", name: "linus fake" },
      { id: 3, email: "margaret@barnacle.ai", name: "same name" },
      { id: 4, email: "grace@barnacle.ai", name: "same name" },
    ],
    ...over,
  };
}

const rows = (...values: string[][]) => values.map((v, i) => ({ number: i + 2, values: v }));
const people = (headings: string[], ...values: string[][]) => planPeople(rows(...values), suggest("people", headings), lookups());

describe("planPeople: duplicates", () => {
  const H = ["First name", "Email"];
  it("skips an email a person in the CRM has (any case and spaces), naming nobody in the plan", () => {
    const plan = people(H, ["Ada", " TAKEN@fakeco.example "], ["Bob", "private@fakeco.example"], ["Cy", "new@fakeco.example"]);
    expect(plan.skipped).toEqual([
      { row: 2, label: "Ada", code: "import_duplicate_email", personId: 100 },
      { row: 3, label: "Bob", code: "import_duplicate_email", personId: 101 },
    ]);
    expect(plan.adds.map((a) => a.row)).toEqual([4]);
  });
  it("skips an email used on an earlier imported row, but a refused row does not use its email", () => {
    const plan = people(["First name", "Email", "Phone"], ["", "a@fakeco.example", ""], ["Ann", "a@fakeco.example", ""], ["Bea", "A@fakeco.example", ""]);
    expect(plan.skipped).toEqual([
      { row: 2, label: "a@fakeco.example", code: "name_required" },
      { row: 4, label: "Bea", code: "import_duplicate_in_file", args: { row: 3 } },
    ]);
    expect(plan.adds.map((a) => a.row)).toEqual([3]);
  });
  it("gives the form's message for a refused row and imports every other row", () => {
    const plan = people(H, ["Ada", "ada@"], ["Bob", "bob@fakeco.example"]);
    expect(plan.skipped).toEqual([{ row: 2, label: "Ada", code: "email_invalid" }]);
    expect(plan.adds.length).toBe(1);
  });
});

describe("planPeople: organisations", () => {
  const H = ["First name", "Organisation"];
  it("links an existing organisation ignoring case and spaces; an archived one with a warning", () => {
    const plan = people(H, ["Ada", " fakeco ltd "], ["Bob", "OLD FAKECO ARCHIVE"], ["Cy", "Old Fakeco Archive"]);
    expect(plan.adds.map((a) => a.organisation)).toEqual([{ id: 10 }, { id: 11 }, { id: 11 }]);
    expect(plan.newOrganisations.map((o) => o.name)).toEqual([]);
    expect(plan.warnings).toEqual([{ code: "import_organisation_archived", value: "Old Fakeco Archive", organisationId: 11, rows: [3, 4] }]);
  });
  it("adds one organisation per new name, as first written by an imported row", () => {
    const plan = people(H, ["", "Skipped Org Fake"], ["Ada", "New Org Fake"], ["Bob", "new org fake "], ["Cy", "NEW ORG FAKE"]);
    expect(plan.newOrganisations.map((o) => o.name)).toEqual(["New Org Fake"]);
    expect(plan.adds.map((a) => a.organisation)).toEqual([{ newKey: "new org fake" }, { newKey: "new org fake" }, { newKey: "new org fake" }]);
  });
  it("refuses an organisation name longer than the organisation form allows", () => {
    const plan = people(H, ["Ada", "x".repeat(201)]);
    expect(plan.skipped).toEqual([{ row: 2, label: "Ada", code: "import_too_long", args: { field: "organisation name", max: 200 } }]);
    expect(plan.newOrganisations.map((o) => o.name)).toEqual([]);
  });
});

describe("planPeople: lists, owners, consent, counts", () => {
  it("matches lead sources and labels to entries still offered, one warning per unmatched value with its rows", () => {
    const plan = people(
      ["First name", "Lead source", "Labels"],
      ["Ada", " REFERRAL ", "Hot; Cold, hot"],
      ["Bob", "Webinar", "cold"],
      ["Cy", "webinar", "Investor"],
      ["Dee", "Removed source", ""],
    );
    expect(plan.adds.map((a) => [a.leadSourceId, a.labelIds])).toEqual([[3, [7]], [null, []], [null, [8]], [null, []]]);
    expect(plan.warnings).toEqual([
      { code: "import_label_unknown", value: "Cold", rows: [2, 3] },
      { code: "import_lead_source_unknown", value: "Webinar", rows: [3, 4] },
      { code: "import_lead_source_unknown", value: "Removed source", rows: [5] },
    ]);
  });
  it("matches owners to active users by email or full name, else the importer with a warning", () => {
    const plan = people(
      ["First name", "Owner"],
      ["Ada", "LINUS@barnacle.ai"],
      ["Bob", "Linus Fake"],
      ["Cy", "alan@barnacle.ai"],
      ["Dee", "Same Name"],
      ["Eve", ""],
      ["Fay", "alan@barnacle.ai"],
    );
    expect(plan.adds.map((a) => a.ownerId)).toEqual([2, 2, 1, 1, 1, 1]);
    expect(plan.warnings).toEqual([
      { code: "import_owner_unknown", value: "alan@barnacle.ai", rows: [4, 7] },
      { code: "import_owner_unknown", value: "Same Name", rows: [5] },
    ]);
  });
  it("makes the importer the owner when no owner column is set", () => {
    expect(people(["First name"], ["Ada"]).adds[0].ownerId).toBe(IMPORTER);
  });
  it("keeps the file's consent, counts rows without one, refuses an unknown one", () => {
    const plan = people(["First name", "Consent"], ["Ada", "Unsubscribed"], ["Bob", "yes"], ["Cy", ""], ["Dee", "maybe"], ["Eve", "opted out"]);
    expect(plan.adds.map((a) => a.consent)).toEqual(["unsubscribed", "subscribed", null, "unsubscribed"]);
    expect(plan.needsConsent).toBe(1);
    expect(plan.skipped).toEqual([{ row: 5, label: "Dee", code: "import_consent_unknown", args: { value: "maybe" } }]);
  });
  it("counts the people without an email address; every add is not private", () => {
    const plan = people(["First name", "Email"], ["Ada", ""], ["Bob", "bob@fakeco.example"], ["Cy", ""]);
    expect(plan.withoutEmail).toBe(2);
    expect(plan.adds.every((a) => a.fields.private === false)).toBe(true);
  });
  it("uses a full name column only when no first or last name column is set", () => {
    expect(people(["Name"], ["Ada May Example"]).adds[0].fields).toMatchObject({ firstName: "Ada", lastName: "May Example" });
    expect(people(["First name", "Name"], ["Ada", "Ada May Example"]).adds[0].fields).toMatchObject({ firstName: "Ada", lastName: "" });
  });
});

describe("planOrganisations", () => {
  const plan = (...values: string[][]) => planOrganisations(rows(...values), suggest("organisations", ["Name", "Size", "Owner"]), lookups());
  it("skips a name already in the CRM (any case, spaces, archived) or on an earlier row", () => {
    const p = plan([" FAKECO LTD ", "", ""], ["old fakeco archive", "", ""], ["New Fake", "", ""], ["new fake", "", ""]);
    expect(p.skipped).toEqual([
      { row: 2, label: "FAKECO LTD", code: "organisation_exists", organisationId: 10 },
      { row: 3, label: "old fakeco archive", code: "organisation_exists", organisationId: 11 },
      { row: 5, label: "new fake", code: "import_duplicate_in_file_org", args: { row: 4 } },
    ]);
    expect(p.adds.map((a) => a.fields.name)).toEqual(["New Fake"]);
  });
  it("leaves an unrecognised size empty with a warning, still adding the organisation; no consent asked", () => {
    const p = plan(["A Fake", "medium", ""], ["B Fake", "35", ""], ["C Fake", "Medium", ""]);
    expect(p.adds.map((a) => a.fields.size)).toEqual([null, "11–50", null]);
    expect(p.warnings).toEqual([{ code: "import_size_unknown", value: "medium", rows: [2, 4] }]);
    expect(p.needsConsent).toBe(0);
  });
  it("matches owners like people imports", () => {
    const p = plan(["A Fake", "", "linus@barnacle.ai"], ["B Fake", "", "nobody"], ["C Fake", "", ""]);
    expect(p.adds.map((a) => a.fields.ownerId)).toEqual([2, 1, 1]);
    expect(p.warnings).toEqual([{ code: "import_owner_unknown", value: "nobody", rows: [3] }]);
  });
});
