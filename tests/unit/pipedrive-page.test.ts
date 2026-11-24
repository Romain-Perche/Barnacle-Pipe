// covers SF-117 FR-011, FR-013, FR-017, FR-018, US2 scenarios 8, 9, 13–15, edge cases on duplicates and archived
// organisations: the pure plan of one Pipedrive page (already imported, linked, added, not imported, warnings)
import { describe, expect, it } from "vitest";
import type { PdOrganization, PdPerson } from "@/server/pipedrive/api";
import { planOrganisationPage, planPersonPage, type OrgLookups, type PersonLookups } from "@/server/pipedrive/page";
import { planFields } from "@/server/pipedrive/rules";

const IMPORTER = 10;
const MARGARET = 11;
const pdUsers = {
  "1": { name: "Fake Person", email: "linus@barnacle.ai" },
  "2": { name: "Margaret Pipedrive Fake", email: "Margaret@barnacle.ai" },
  "3": { name: "Jane Fake", email: "jane@fake.example" },
};
const users = new Map([["linus@barnacle.ai", IMPORTER], ["margaret@barnacle.ai", MARGARET]]);

const org = (o: Partial<PdOrganization>): PdOrganization => ({
  id: 1, name: "Fakeco Ltd", ownerId: 1, visibleTo: 3, addTime: "", address: "", website: "", industry: null, employeeCount: null, custom: {}, deleted: false, ...o,
});
const person = (p: Partial<PdPerson>): PdPerson => ({
  id: 1, name: "", firstName: "Ada", lastName: "Fake", ownerId: 1, orgId: null, addTime: "2025-01-02 03:04:05", emails: [], phones: [], visibleTo: 3,
  labelIds: [], jobTitle: "", marketingStatus: null, custom: {}, deleted: false, ...p,
});
const email = (value: string) => ({ value, primary: true, label: "work" });

function orgLookups(extra: Partial<OrgLookups> = {}): OrgLookups {
  return { importerId: IMPORTER, linked: new Set(), organisations: new Map(), users, pdUsers, fields: planFields("organisation", [], []), ...extra };
}
function personLookups(extra: Partial<PersonLookups> = {}): PersonLookups {
  return {
    importerId: IMPORTER, links: new Map(), emails: new Map(), linkedFrom: new Map(), consents: new Map(), organisations: new Map(),
    orgsNotImported: new Map(), leadSources: new Map([["referral", 5]]), labels: new Map([["hot", 7]]), users, pdUsers,
    fields: planFields("person", [], []), consent: "unsubscribed", ...extra,
  };
}

describe("planOrganisationPage", () => {
  it("counts a linked Pipedrive organisation as already imported", () => {
    const plan = planOrganisationPage([org({ id: 4 })], orgLookups({ linked: new Set([4]) }));
    expect(plan.already).toBe(1);
    expect(plan.adds).toEqual([]);
  });
  it("links one whose name a CRM organisation has (case and spaces ignored), with a warning when archived (US2-15)", () => {
    const plan = planOrganisationPage(
      [org({ id: 4, name: " FAKECO ltd " })],
      orgLookups({ organisations: new Map([["fakeco ltd", { id: 30, name: "Fakeco Ltd", archived: true }]]) }),
    );
    expect(plan.links).toEqual([{ pipedriveId: 4, target: { id: 30 } }]);
    expect(plan.warnings).toEqual([{ kind: "organisation", pipedriveId: 4, label: "FAKECO ltd", code: "pipedrive_org_archived", args: { name: "Fakeco Ltd" } }]);
  });
  it("links the second of two Pipedrive organisations with one name to the first (edge case)", () => {
    const plan = planOrganisationPage([org({ id: 4, name: "Sample Fake" }), org({ id: 5, name: "sample fake " })], orgLookups());
    expect(plan.adds.map((a) => a.pipedriveId)).toEqual([4]);
    expect(plan.links).toEqual([{ pipedriveId: 5, target: { add: 0 } }]);
  });
  it("gives an organisation whose owner has no CRM user to the importer, counted under that owner; never private", () => {
    const plan = planOrganisationPage([org({ id: 4, ownerId: 3, visibleTo: 1 }), org({ id: 5, name: "B Fake", ownerId: 2 })], orgLookups());
    expect(plan.adds.map((a) => a.fields.ownerId)).toEqual([IMPORTER, MARGARET]);
    expect(plan.owners).toEqual({ "3": { name: "Jane Fake", email: "jane@fake.example", records: 1 } });
    expect(plan.ownerOnly).toBe(1);
  });
  it("lists an organisation with no name as not imported, and skips deleted ones", () => {
    const plan = planOrganisationPage([org({ id: 4, name: "" }), org({ id: 6, deleted: true })], orgLookups());
    expect(plan.notImported).toEqual([{ kind: "organisation", pipedriveId: 4, label: "#4", code: "pipedrive_no_name" }]);
    expect(plan.done).toBe(1);
  });
});

describe("planPersonPage", () => {
  it("counts a linked Pipedrive person as already imported", () => {
    const plan = planPersonPage([person({ id: 9 })], personLookups({ links: new Map([[9, 50]]) }));
    expect(plan.already).toBe(1);
    expect(plan.adds).toEqual([]);
  });
  it("links one whose email exactly one CRM person has, and leaves it as it is (US2-13)", () => {
    const plan = planPersonPage([person({ id: 9, emails: [email("ADA@fake.example ")] })], personLookups({ emails: new Map([["ada@fake.example", [50]]]) }));
    expect(plan.links).toEqual([{ pipedriveId: 9, personId: 50 }]);
    expect(plan.linked).toEqual([{ kind: "person", personId: 50, pipedriveId: 9 }]);
  });
  it("does not import or link one whose emails belong to two CRM people (edge case)", () => {
    const plan = planPersonPage(
      [person({ id: 9, emails: [email("a@fake.example"), { value: "b@fake.example", primary: false, label: "home" }] })],
      personLookups({ emails: new Map([["a@fake.example", [50]], ["b@fake.example", [51]]]) }),
    );
    expect(plan.notImported).toEqual([{ kind: "person", pipedriveId: 9, label: "Ada Fake", code: "pipedrive_email_many_people" }]);
    expect(plan.links).toEqual([]);
  });
  it("does not import one whose CRM match is linked from another Pipedrive person (edge case, across parts)", () => {
    const plan = planPersonPage(
      [person({ id: 9, emails: [email("a@fake.example")] })],
      personLookups({ emails: new Map([["a@fake.example", [50]]]), linkedFrom: new Map([[50, 8]]) }),
    );
    expect(plan.notImported).toEqual([{ kind: "person", pipedriveId: 9, label: "Ada Fake", code: "pipedrive_email_other_person", args: { personId: 50 } }]);
  });
  it("adds the first of two persons of one page sharing an email; the second is not imported", () => {
    const plan = planPersonPage(
      [person({ id: 9, firstName: "First", emails: [email("same@fake.example")] }), person({ id: 10, firstName: "Second", emails: [email("Same@fake.example")] })],
      personLookups(),
    );
    expect(plan.adds.map((a) => a.pipedriveId)).toEqual([9]);
    expect(plan.notImported).toEqual([{ kind: "person", pipedriveId: 10, label: "Second Fake", code: "pipedrive_email_other_person", args: { name: "First Fake" } }]);
  });
  it("gives an owner-only person of Margaret to her as owner and creator, private (US2-9, FR-013)", () => {
    const plan = planPersonPage([person({ id: 9, ownerId: 2, visibleTo: 1 })], personLookups());
    expect(plan.adds[0]).toMatchObject({ private: true, ownerId: MARGARET, createdBy: MARGARET });
    expect(plan.privateOthers).toBe(1);
  });
  it("gives an owner-only person of an owner without CRM user to the importer as owner and creator", () => {
    const plan = planPersonPage([person({ id: 9, ownerId: 3, visibleTo: 1 })], personLookups());
    expect(plan.adds[0]).toMatchObject({ private: true, ownerId: IMPORTER, createdBy: IMPORTER });
    expect(plan.privateOthers).toBe(0);
    expect(plan.owners).toEqual({ "3": { name: "Jane Fake", email: "jane@fake.example", records: 1 } });
  });
  it("shares every other person, with the importer as creator", () => {
    const plan = planPersonPage([person({ id: 9, ownerId: 2, visibleTo: 7 })], personLookups());
    expect(plan.adds[0]).toMatchObject({ private: false, ownerId: MARGARET, createdBy: IMPORTER });
  });
  it("matches lead sources and labels on the lists; counts the others once per value (FR-010)", () => {
    const fields = planFields(
      "person",
      [
        { code: "label_ids", name: "Labels", type: "set", custom: false, options: [{ id: 1, label: "Hot" }, { id: 2, label: "Cold" }] },
        { code: "src", name: "Lead source", type: "enum", custom: true, options: [{ id: 1, label: " referral" }, { id: 2, label: "Webinar" }] },
      ],
      [],
    );
    const plan = planPersonPage(
      [person({ id: 9, labelIds: [1, 2], custom: { src: 1 } }), person({ id: 10, labelIds: [2], custom: { src: 2 } }), person({ id: 11, custom: { src: 2 } })],
      personLookups({ fields }),
    );
    expect(plan.adds.map((a) => [a.leadSourceId, a.labelIds])).toEqual([[5, [7]], [null, []], [null, []]]);
    expect(plan.lists).toEqual([{ list: "label", value: "Cold", records: 2 }, { list: "lead_source", value: "Webinar", records: 2 }]);
  });
  it("links the person to the CRM organisation of its Pipedrive organisation, or warns when it was not imported", () => {
    const plan = planPersonPage(
      [person({ id: 9, orgId: 4 }), person({ id: 10, orgId: 5 })],
      personLookups({ organisations: new Map([[4, 30]]), orgsNotImported: new Map([[5, "Too Long Fake"]]) }),
    );
    expect(plan.adds.map((a) => a.organisationId)).toEqual([30, null]);
    expect(plan.warnings).toEqual([{ kind: "person", pipedriveId: 10, label: "Ada Fake", code: "pipedrive_org_not_imported", args: { name: "Too Long Fake" } }]);
  });
  it("makes an existing Subscribed person Unsubscribed when Pipedrive says unsubscribed, never the reverse (FR-018)", () => {
    const plan = planPersonPage(
      [
        person({ id: 9, marketingStatus: "unsubscribed" }),
        person({ id: 10, marketingStatus: "unsubscribed", emails: [email("b@fake.example")] }),
        person({ id: 11, marketingStatus: "subscribed", emails: [email("c@fake.example")] }),
      ],
      personLookups({
        links: new Map([[9, 50]]),
        emails: new Map([["b@fake.example", [51]], ["c@fake.example", [52]]]),
        consents: new Map([[50, "subscribed"], [51, "subscribed"], [52, "unsubscribed"]]),
      }),
    );
    expect(plan.unsubscribe).toEqual([50, 51]);
  });
  it("takes Date added from Pipedrive and the consent from Pipedrive or the user's choice", () => {
    const plan = planPersonPage([person({ id: 9, marketingStatus: "subscribed" }), person({ id: 10, marketingStatus: "no_consent" })], personLookups());
    expect(plan.adds.map((a) => a.fields.consent)).toEqual(["subscribed", "unsubscribed"]);
    expect(plan.adds[0].createdAt?.toISOString()).toBe("2025-01-02T03:04:05.000Z");
  });
});
