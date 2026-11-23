// covers FR-002 (rows in the order sent; first = main), contracts/routes.md § Server actions (form field names)
import { describe, expect, it } from "vitest";
import { idFrom, organisationFormFromData, personFormFromData } from "@/server/records/form-data";

function data(entries: [string, string][]) {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe("personFormFromData", () => {
  it("reads every field; email and phone rows in index order", () => {
    const form = personFormFromData(
      data([
        ["firstName", "Ada"], ["lastName", "Example"],
        ["emails.1.value", "b@example.com"], ["emails.1.kind", "personal"],
        ["emails.0.value", "a@example.com"], ["emails.0.kind", "work"],
        ["emails.10.value", "c@example.com"], ["emails.10.kind", "other"],
        ["phones.0.value", "+44 1"], ["phones.0.kind", "work"],
        ["organisationId", "3"], ["newOrganisationName", ""], ["role", "COO"], ["leadSourceId", "2"],
        ["linkedin", "linkedin.com/in/ada"], ["ownerId", "1"], ["labelIds", "4"], ["labelIds", "5"],
        ["consent", "unsubscribed"], ["private", "on"],
      ]),
    );
    expect(form).toEqual({
      firstName: "Ada", lastName: "Example",
      emails: [
        { value: "a@example.com", kind: "work" },
        { value: "b@example.com", kind: "personal" },
        { value: "c@example.com", kind: "other" },
      ],
      phones: [{ value: "+44 1", kind: "work" }],
      organisationId: "3", newOrganisationName: "", role: "COO", leadSourceId: "2", linkedin: "linkedin.com/in/ada",
      ownerId: "1", labelIds: ["4", "5"], consent: "unsubscribed", private: true, ambassador: false, referredBy: "",
    });
  });
  it("treats missing fields as empty, an unticked Private as false, and keeps at most 50 rows", () => {
    const many = Array.from({ length: 60 }, (_, i) => [`emails.${i}.value`, `x${i}@example.com`] as [string, string]);
    const form = personFormFromData(data(many));
    expect(form.firstName).toBe("");
    expect(form.private).toBe(false);
    expect(form.emails).toHaveLength(50);
    expect(form.emails[0]).toEqual({ value: "x0@example.com", kind: "work" });
  });
});

describe("organisationFormFromData and idFrom", () => {
  it("reads the organisation fields and a numeric id", () => {
    expect(organisationFormFromData(data([["name", "Fakeco"], ["size", "1–10"]]))).toEqual({
      name: "Fakeco", website: "", sector: "", size: "1–10", location: "", ownerId: "",
    });
    expect(idFrom(data([["id", "12"]]))).toBe(12);
    expect(idFrom(data([["id", "abc"]]))).toBeNull();
    expect(idFrom(data([["version", "3"]]), "version")).toBe(3);
  });
});

// covers contracts/routes.md § Server actions (SF-93 createDeal/updateDeal field names)
import { dealFormFromData } from "@/server/records/form-data";
describe("dealFormFromData", () => {
  it("reads every field of the deal form; Private only when ticked", () => {
    const form = dealFormFromData(
      data([
        ["title", "Fakeco website"], ["value", "£4,000"], ["pipelineId", "1"], ["stageId", "3"], ["organisationId", ""],
        ["newOrganisationName", "Fakeco Ltd"], ["personId", "7"], ["ownerId", "2"], ["expectedClose", "2026-12-15"], ["private", "on"],
      ]),
    );
    expect(form).toEqual({
      title: "Fakeco website", value: "£4,000", pipelineId: "1", stageId: "3", organisationId: "", newOrganisationName: "Fakeco Ltd",
      personId: "7", ownerId: "2", expectedClose: "2026-12-15", private: true, labelIds: [], referredBy: "",
    });
    expect(dealFormFromData(data([["title", "x"]]))).toMatchObject({ title: "x", value: "", stageId: "", private: false });
  });
  // covers SF-95 FR-017 (label checkboxes on the deal form)
  it("reads every ticked deal label", () => {
    expect(dealFormFromData(data([["labelIds", "3"], ["labelIds", "1"]])).labelIds).toEqual(["3", "1"]);
  });
});

// covers SF-114 FR-001, FR-004 (contracts/routes.md § Server actions: `ambassador` and `referredBy`)
describe("the Ambassador tick and Referred by", () => {
  it("reads the tick ('on') and the referrer on the person form", () => {
    expect(personFormFromData(data([["ambassador", "on"], ["referredBy", "12"]]))).toMatchObject({ ambassador: true, referredBy: "12" });
    expect(personFormFromData(data([["referredBy", "keep"]]))).toMatchObject({ ambassador: false, referredBy: "keep" });
  });
  it("reads the referrer on the deal form", () => {
    expect(dealFormFromData(data([["referredBy", "12"]])).referredBy).toBe("12");
    expect(dealFormFromData(data([])).referredBy).toBe("");
  });
});
