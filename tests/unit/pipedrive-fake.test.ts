// covers SF-117 FR-030; outside services Pipedrive v1 and Pipedrive v2: the test fake answers only what the pinned
// schemas allow (a wrong parameter or property throws), and a missing schema file throws (never a skip)
import { copyFileSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listFields, listOrganizations, listPersons, listUsers, whoAmI } from "@/server/pipedrive/api";
import { checkedFetch, installFakePipedrive } from "../fakes/pipedrive";
import { loadPipedriveV1, loadPipedriveV2, PIPEDRIVE_V1_PATH, PIPEDRIVE_V2_PATH } from "../fakes/pipedrive-schema";

const TOKEN = "test-token-1";
const auth = { "x-api-token": TOKEN };

function setUp() {
  const fake = installFakePipedrive();
  fake.addCompany({ token: TOKEN, user: { id: 1, name: "Fake Person", email: "linus@barnacle.ai" }, companyId: 1001, companyName: "Fakeco Pipedrive" });
  return fake;
}

describe("the Pipedrive v1 fake (pipedrive_v1_openapi.yml)", () => {
  it("passes whoAmI and listUsers", async () => {
    setUp();
    await expect(whoAmI(TOKEN)).resolves.toEqual({ id: 1, name: "Fake Person", companyId: 1001, companyName: "Fakeco Pipedrive" });
    await expect(listUsers(TOKEN)).resolves.toEqual([{ id: 1, name: "Fake Person", email: "linus@barnacle.ai" }]);
  });
  it("throws on the token in the address, an undeclared parameter or no x-api-token header", async () => {
    setUp();
    await expect(checkedFetch("/v1/users/me?api_token=x", auth)).rejects.toThrow(/never be in the address/);
    await expect(checkedFetch("/v1/users/me?foo=1", auth)).rejects.toThrow(/"foo" is not in pipedrive_v1_openapi.yml/);
    await expect(checkedFetch("/v1/users/me")).rejects.toThrow(/x-api-token/);
    await expect(checkedFetch("/v1/nothing", auth)).rejects.toThrow(/no GET \/nothing/);
  });
  it("throws on an answer with a property the schema does not declare", async () => {
    const fake = setUp();
    fake.tamper((body) => ((body.data as Record<string, unknown>).not_a_field = 1));
    await expect(whoAmI(TOKEN)).rejects.toThrow(/no property "not_a_field"/);
  });
  it("throws when a schema file is missing or empty", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pd-schema-"));
    for (const [from, load] of [[PIPEDRIVE_V1_PATH, loadPipedriveV1], [PIPEDRIVE_V2_PATH, loadPipedriveV2]] as const) {
      const copy = path.join(dir, path.basename(from));
      copyFileSync(from, copy);
      expect(() => load(copy)).not.toThrow();
      renameSync(copy, `${copy}.away`);
      expect(() => load(copy)).toThrow(/is missing: run "npm run test:schemas"/);
    }
  });
});

describe("the Pipedrive v2 fake (pipedrive_v2_openapi.json)", () => {
  it("passes listPersons, listOrganizations and listFields", async () => {
    const fake = setUp();
    fake.addField(1001, "person", { field_code: "abc", field_name: "Budget", field_type: "double", is_custom_field: true });
    fake.addField(1001, "organization", { field_code: "industry", field_name: "Industry", field_type: "enum", is_custom_field: false, options: [{ id: 1, label: "Software" }] });
    const org = fake.addOrganization(1001, { name: "Fakeco Ltd", owner_id: 1, address: { value: "1 Fake Street" }, industry: 1, employee_count: 12 });
    fake.addPerson(1001, {
      first_name: "Ada", last_name: "Fake", owner_id: 1, org_id: org, emails: [{ value: "ada@fake.example", primary: true, label: "work" }],
      marketing_status: "subscribed", custom_fields: { abc: 12.5 },
    });
    const persons = await listPersons(TOKEN, { cursor: null, limit: 100, marketing: true });
    expect(persons.items[0]).toMatchObject({ firstName: "Ada", orgId: org, marketingStatus: "subscribed", custom: { abc: 12.5 } });
    expect(persons.next).toBeNull();
    const orgs = await listOrganizations(TOKEN, { cursor: null, limit: 100 });
    expect(orgs.items[0]).toMatchObject({ name: "Fakeco Ltd", address: "1 Fake Street", industry: 1, employeeCount: 12 });
    await expect(listOrganizations(TOKEN, { cursor: null, limit: 100, ids: [org] })).resolves.toMatchObject({ items: [{ id: org }] });
    expect((await listFields(TOKEN, "person", null)).items).toEqual([{ code: "abc", name: "Budget", type: "double", custom: true, options: [] }]);
    expect((await listFields(TOKEN, "organization", null)).items[0].options).toEqual([{ id: 1, label: "Software" }]);
  });
  it("pages by cursor in ascending ids", async () => {
    const fake = setUp();
    for (let i = 0; i < 5; i++) fake.addPerson(1001, { first_name: `P${i}`, owner_id: 1 });
    const one = await listPersons(TOKEN, { cursor: null, limit: 2, marketing: false });
    const two = await listPersons(TOKEN, { cursor: one.next, limit: 2, marketing: false });
    const three = await listPersons(TOKEN, { cursor: two.next, limit: 2, marketing: false });
    expect([...one.items, ...two.items, ...three.items].map((p) => p.firstName)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
    expect(three.next).toBeNull();
  });
  it("throws on a value not in its enum, a limit over 500 or an undeclared parameter", async () => {
    setUp();
    await expect(checkedFetch("/api/v2/persons?include_fields=marketing_statuses", auth)).rejects.toThrow(/not in its enum/);
    await expect(checkedFetch("/api/v2/persons?sort_by=name", auth)).rejects.toThrow(/not in its enum/);
    await expect(checkedFetch("/api/v2/persons?limit=501", auth)).rejects.toThrow(/over 500/);
    await expect(checkedFetch("/api/v2/persons?org=1", auth)).rejects.toThrow(/"org" is not in pipedrive_v2_openapi.json/);
    await expect(checkedFetch("/api/v2/persons?limit=100")).rejects.toThrow(/x-api-token/);
  });
  it("throws on a person with an `email` property instead of `emails`, or marketing_status not asked for", async () => {
    const fake = setUp();
    fake.addPerson(1001, { first_name: "Ada", owner_id: 1 });
    fake.tamper((body) => ((body.data as Record<string, unknown>[])[0].email = "ada@fake.example"));
    await expect(listPersons(TOKEN, { cursor: null, limit: 100, marketing: false })).rejects.toThrow(/no property "email"/);
    fake.tamper((body) => ((body.data as Record<string, unknown>[])[0].marketing_status = "subscribed"));
    await expect(listPersons(TOKEN, { cursor: null, limit: 100, marketing: false })).rejects.toThrow(/no property "marketing_status"/);
  });
});
