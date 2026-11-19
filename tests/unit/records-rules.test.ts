// covers FR-001, FR-002, FR-004, FR-005, FR-006, FR-007, FR-020, US1 scenario 4, edge cases on emails, phones,
// website and LinkedIn addresses and the `50%` search (research.md §13, data-model.md § Validation)
import { describe, expect, it } from "vitest";
import {
  changedOrganisationFields,
  changedPersonFields,
  escapeLike,
  normaliseEmail,
  normaliseLinkedIn,
  normalisePhone,
  normaliseWebsite,
  validateChoiceName,
  validateOrganisation,
  validatePerson,
  type PersonForm,
} from "@/server/records/rules";

function form(over: Partial<PersonForm> = {}): PersonForm {
  return {
    firstName: "Ada",
    lastName: "Example",
    emails: [{ value: "ada@example.com", kind: "work" }],
    phones: [],
    organisationId: "",
    newOrganisationName: "",
    role: "",
    leadSourceId: "",
    linkedin: "",
    ownerId: "",
    labelIds: [],
    consent: "subscribed",
    private: false,
    ...over,
  };
}

describe("names", () => {
  it("needs a first or a last name after trimming", () => {
    const r = validatePerson(form({ firstName: "  ", lastName: " " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toEqual({ code: "name_required" });
  });
  it("accepts only one of the two and trims them", () => {
    const r = validatePerson(form({ firstName: "  ", lastName: " Example " }));
    expect(r.ok && r.value.firstName === "" && r.value.lastName === "Example").toBe(true);
  });
});

describe("emails", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail(" Ada@Example.COM ")).toBe("ada@example.com");
    const r = validatePerson(form({ emails: [{ value: " Ada@Example.COM ", kind: "work" }] }));
    expect(r.ok && r.value.emails).toEqual([{ email: "ada@example.com", kind: "work" }]);
  });
  it("refuses an invalid address next to its row", () => {
    const r = validatePerson(form({ emails: [{ value: "ok@example.com", kind: "work" }, { value: "not an email", kind: "work" }] }));
    expect(!r.ok && r.errors["emails.1"]).toEqual({ code: "email_invalid" });
  });
  it("refuses an address longer than 254 characters", () => {
    const long = `${"a".repeat(250)}@example.com`;
    const r = validatePerson(form({ emails: [{ value: long, kind: "work" }] }));
    expect(!r.ok && r.errors["emails.0"]).toEqual({ code: "email_invalid" });
  });
  it("refuses the same address twice on one person", () => {
    const r = validatePerson(form({ emails: [{ value: "a@x.com", kind: "work" }, { value: "A@x.com ", kind: "personal" }] }));
    expect(!r.ok && r.errors["emails.1"]).toEqual({ code: "email_twice" });
  });
  it("drops empty rows, keeps the order (first = main) and the kinds; an unknown kind is Work", () => {
    const r = validatePerson(
      form({
        emails: [
          { value: "", kind: "work" },
          { value: "b@example.com", kind: "personal" },
          { value: " ", kind: "other" },
          { value: "a@example.com", kind: "drop table" },
        ],
      }),
    );
    expect(r.ok && r.value.emails).toEqual([
      { email: "b@example.com", kind: "personal" },
      { email: "a@example.com", kind: "work" },
    ]);
  });
});

describe("phones", () => {
  it("keeps a phone as typed, without surrounding spaces", () => {
    expect(normalisePhone("  +44 20 7946 0000 ")).toBe("+44 20 7946 0000");
    expect(normalisePhone("(020) 7946-0000.")).toBe("(020) 7946-0000.");
  });
  it("refuses letters, no digit, or more than 40 characters", () => {
    expect(normalisePhone("+44 call me")).toBeNull();
    expect(normalisePhone("+() -")).toBeNull();
    expect(normalisePhone("1".repeat(41))).toBeNull();
    const r = validatePerson(form({ phones: [{ value: "abc", kind: "work" }] }));
    expect(!r.ok && r.errors["phones.0"]).toEqual({ code: "phone_invalid" });
  });
});

describe("website", () => {
  it("adds https:// to an address without a scheme", () => {
    expect(normaliseWebsite("fakeco.example")).toBe("https://fakeco.example");
    expect(normaliseWebsite(" http://fakeco.example/about ")).toBe("http://fakeco.example/about");
    expect(normaliseWebsite("")).toBe("");
  });
  it("refuses text that is not a site and other schemes", () => {
    for (const bad of ["not a site", "javascript:alert(1)", "ftp://x.example", "https://user:pw@fakeco.example", "localhost"]) {
      expect(normaliseWebsite(bad), bad).toBeNull();
    }
    const r = validateOrganisation({ name: "Fakeco", website: "javascript:alert(1)", sector: "", size: "", location: "", ownerId: "" });
    expect(!r.ok && r.errors.website).toEqual({ code: "website_invalid" });
  });
});

describe("LinkedIn", () => {
  it("accepts linkedin.com addresses and adds https://", () => {
    expect(normaliseLinkedIn("linkedin.com/in/ada-example")).toBe("https://linkedin.com/in/ada-example");
    expect(normaliseLinkedIn("www.linkedin.com/in/ada")).toBe("https://www.linkedin.com/in/ada");
    expect(normaliseLinkedIn("https://uk.linkedin.com/in/ada")).toBe("https://uk.linkedin.com/in/ada");
  });
  it("refuses other sites and schemes", () => {
    for (const bad of ["https://example.com/ada", "javascript:alert(1)", "https://notlinkedin.com/in/ada", "linkedin"]) {
      expect(normaliseLinkedIn(bad), bad).toBeNull();
    }
    const r = validatePerson(form({ linkedin: "https://example.com/ada" }));
    expect(!r.ok && r.errors.linkedin).toEqual({ code: "linkedin_invalid" });
  });
});

describe("other person fields", () => {
  it("reads ids, consent and private; unknown consent is Subscribed", () => {
    const r = validatePerson(
      form({ organisationId: "4", leadSourceId: "2", ownerId: "3", labelIds: ["5", "x", "5", "1"], consent: "maybe", private: true, role: " COO " }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.organisationId).toBe(4);
      expect(r.value.leadSourceId).toBe(2);
      expect(r.value.ownerId).toBe(3);
      expect(r.value.labelIds).toEqual([1, 5]);
      expect(r.value.consent).toBe("subscribed");
      expect(r.value.private).toBe(true);
      expect(r.value.role).toBe("COO");
    }
  });
  it("takes a new organisation name only when no organisation is picked", () => {
    const r = validatePerson(form({ newOrganisationName: "  New Org " }));
    expect(r.ok && r.value.newOrganisationName).toBe("New Org");
    const both = validatePerson(form({ organisationId: "2", newOrganisationName: "New Org" }));
    expect(both.ok && both.value.newOrganisationName).toBeNull();
  });
});

describe("organisations", () => {
  const base = { name: "Fakeco Ltd", website: "", sector: "", size: "", location: "", ownerId: "" };
  it("needs a name", () => {
    const r = validateOrganisation({ ...base, name: "   " });
    expect(!r.ok && r.errors.name).toEqual({ code: "organisation_name_required" });
  });
  it("keeps only the five size bands", () => {
    const ok = validateOrganisation({ ...base, size: "201–1,000" });
    expect(ok.ok && ok.value.size).toBe("201–1,000");
    const bad = validateOrganisation({ ...base, size: "huge" });
    expect(bad.ok && bad.value.size).toBeNull();
  });
});

describe("lead source and label names", () => {
  it("trims, refuses empty, cuts at 100", () => {
    expect(validateChoiceName("  Hot ")).toEqual({ ok: true, name: "Hot" });
    expect(validateChoiceName("   ")).toEqual({ ok: false, code: "choice_name_required" });
    const long = validateChoiceName("x".repeat(150));
    expect(long.ok && long.name.length).toBe(100);
  });
});

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLike("50%_\\")).toBe("50\\%\\_\\\\");
    expect(escapeLike("O'Brien")).toBe("O'Brien");
  });
});

describe("changedFields", () => {
  const before = (() => {
    const r = validatePerson(
      form({
        role: "COO",
        emails: [{ value: "ada@example.com", kind: "work" }, { value: "ada.home@example.net", kind: "personal" }],
        phones: [{ value: "+44 20 7946 0000", kind: "work" }],
      }),
    );
    if (!r.ok) throw new Error("bad fixture");
    return { ...r.value, organisationId: null, ownerId: 1, leadSourceId: null };
  })();

  it("returns [] when nothing changed", () => {
    expect(changedPersonFields(before, { ...before })).toEqual([]);
  });
  it("returns human names in form order (US1 scenario 3)", () => {
    const after = {
      ...before,
      role: "CEO",
      emails: before.emails.slice(0, 1),
      phones: [...before.phones, { phone: "07700 900000", kind: "personal" as const }],
    };
    expect(changedPersonFields(before, after)).toEqual(["Role", "Email addresses", "Phone numbers"]);
  });
  it("counts a reorder or a kind change of emails or phones as a change", () => {
    expect(changedPersonFields(before, { ...before, emails: [...before.emails].reverse() })).toEqual(["Email addresses"]);
    expect(changedPersonFields(before, { ...before, phones: [{ phone: "+44 20 7946 0000", kind: "other" }] })).toEqual(["Phone numbers"]);
  });
  it("names consent, labels and private changes (FR-006)", () => {
    expect(changedPersonFields(before, { ...before, consent: "unsubscribed", labelIds: [3], private: true })).toEqual([
      "Labels",
      "Consent",
      "Private",
    ]);
  });
  it("names organisation field changes", () => {
    const org = { name: "Fakeco", website: null, sector: null, size: null, location: null, ownerId: 1 };
    expect(changedOrganisationFields(org, { ...org, website: "https://fakeco.example", size: "1–10", ownerId: 2 })).toEqual([
      "Website",
      "Size",
      "Owner",
    ]);
  });
});
