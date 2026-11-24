// SF-122: and the deals, pipelines, stages, activities (v2), notes, files, participants and downloads (v1), below
// covers SF-117 FR-030; outside services Pipedrive v1 and Pipedrive v2: the test fake answers only what the pinned
// schemas allow (a wrong parameter or property throws), and a missing schema file throws (never a skip)
import { copyFileSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dealFollowers, dealParticipants, downloadFile, listActivities, listActivityTypes, listDeals, listFields, listFiles, listNotes, listOrganizations,
  listPersons, listPipelines, listStages, listUsers, whoAmI,
} from "@/server/pipedrive/api";
import { FILE_HOST } from "@/server/pipedrive/fake-pipedrive";
import { checkedFetch, checkedFileHost, fileHostRequests, installFakePipedrive } from "../fakes/pipedrive";
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

// covers SF-122 FR-023, contracts/pipedrive-api.md § Schemas: the new v2 calls are checked against pipedrive_v2_openapi.json
describe("SF-122: the v2 deals, pipelines, stages and activities (pipedrive_v2_openapi.json)", () => {
  function deals() {
    const fake = setUp();
    fake.addUser(1001, { id: 2, name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" });
    const pipeline = fake.addPipeline(1001, { name: "Sales" });
    const stage = fake.addStage(1001, { pipeline_id: pipeline, name: "Lead" });
    const person = fake.addPerson(1001, { first_name: "Ada", last_name: "Fake", owner_id: 1 });
    const other = fake.addPerson(1001, { first_name: "Bo", last_name: "Fake", owner_id: 1 });
    const deal = fake.addDeal(1001, { title: "Fake deal", owner_id: 1, stage_id: stage, person_id: person, value: 12.5, label_ids: [3] }, { followers: [2], participants: [person, other] });
    fake.addDeal(1001, { title: "Old fake deal", owner_id: 1, stage_id: stage, is_archived: true });
    return { fake, pipeline, stage, person, other, deal };
  }
  it("passes listPipelines, listStages, listDeals (open and archived), dealFollowers, deal fields and listActivities", async () => {
    const { fake, pipeline, stage, deal, person, other } = deals();
    fake.addField(1001, "deal", { field_code: "label", field_name: "Label", field_type: "set", is_custom_field: false, options: [{ id: 3, label: "Hot" }] });
    expect((await listPipelines(TOKEN, null)).items).toEqual([{ id: pipeline, name: "Sales", order: 1, deleted: false }]);
    expect((await listStages(TOKEN, null)).items).toEqual([{ id: stage, pipelineId: pipeline, name: "Lead", order: 1, deleted: false }]);
    const open = await listDeals(TOKEN, { archived: false, cursor: null, limit: 20 });
    expect(open.items).toHaveLength(1);
    expect(open.items[0]).toMatchObject({ id: deal, title: "Fake deal", value: 12.5, currency: "GBP", labelIds: [3], followersCount: 1, participantsCount: 2, archived: false });
    const archived = await listDeals(TOKEN, { archived: true, cursor: null, limit: 20 });
    expect(archived.items.map((d) => [d.title, d.archived])).toEqual([["Old fake deal", true]]);
    expect(await dealFollowers(TOKEN, deal)).toEqual([2]);
    expect(await dealParticipants(TOKEN, deal)).toEqual([{ personId: person, name: "Ada Fake" }, { personId: other, name: "Bo Fake" }]);
    expect((await listFields(TOKEN, "deal", null)).items[0]).toMatchObject({ code: "label", options: [{ id: 3, label: "Hot" }] });
    fake.addActivity(1001, { subject: "Call Ada", type: "call", owner_id: 1, deal_id: deal, due_date: "2026-12-01", due_time: "09:30", duration: "00:30" });
    expect((await listActivities(TOKEN, { cursor: null, limit: 200 })).items[0]).toMatchObject({ subject: "Call Ada", type: "call", dealId: deal, dueTime: "09:30", duration: "00:30" });
  });
  it("throws on a sort, include_fields or parameter the v2 schema does not declare", async () => {
    deals();
    await expect(checkedFetch("/api/v2/deals?sort_by=title", auth)).rejects.toThrow(/not in its enum/);
    await expect(checkedFetch("/api/v2/deals?include_fields=followers", auth)).rejects.toThrow(/not in its enum/);
    await expect(checkedFetch("/api/v2/deals?unknown_param=1", auth)).rejects.toThrow(/"unknown_param" is not in pipedrive_v2_openapi.json/);
    await expect(checkedFetch("/api/v2/stages?pipeline=1", auth)).rejects.toThrow(/"pipeline" is not in/);
    await expect(checkedFetch("/api/v2/activities?sort_by=subject", auth)).rejects.toThrow(/not in its enum/);
    await expect(checkedFetch("/api/v2/activities?include_fields=notes", auth)).rejects.toThrow(/not in its enum/);
    await expect(checkedFetch("/api/v2/deals?include_fields=followers_count,participants_count", auth)).resolves.toMatchObject({ status: 200 });
    await expect(checkedFetch("/api/v2/activities?sort_by=id&sort_direction=asc&limit=200", auth)).resolves.toMatchObject({ status: 200 });
  });
  it("throws on a deal or activity answer with an undeclared property", async () => {
    const { fake } = deals();
    fake.tamper((body) => ((body.data as Record<string, unknown>[])[0].stage_name = "Lead"));
    await expect(listDeals(TOKEN, { archived: false, cursor: null, limit: 20 })).rejects.toThrow(/no property "stage_name"/);
    fake.addActivity(1001, { subject: "Fake task", owner_id: 1 });
    fake.tamper((body) => ((body.data as Record<string, unknown>[])[0].assignee_id = 1));
    await expect(listActivities(TOKEN, { cursor: null, limit: 200 })).rejects.toThrow(/no property "assignee_id"/);
  });
});

// covers SF-122 FR-023: v1 notes, files and activity types against the Zenika file; participants and downloads against
// the file that declares them; a download is checked for its content type only; the file host never gets the token
describe("SF-122: the v1 notes, files, participants and downloads (pipedrive_v1_openapi.yml, else the full copy)", () => {
  it("passes listNotes, listFiles, listActivityTypes with start / limit paging", async () => {
    const fake = setUp();
    for (let i = 0; i < 3; i++) fake.addNote(1001, { content: `<p>Note ${i}</p>`, user_id: 1, lead_id: i === 2 ? "abc" : null });
    const one = await listNotes(TOKEN, { start: 0, limit: 2 });
    expect(one.items.map((n) => n.content)).toEqual(["<p>Note 0</p>", "<p>Note 1</p>"]);
    expect(one.next).toBe(2);
    const two = await listNotes(TOKEN, { start: 2, limit: 2 });
    expect(two.items[0]).toMatchObject({ leadId: "abc" });
    expect(two.next).toBeNull();
    fake.addFile(1001, { name: "a.pdf", user_id: 1, deal_id: 5 }, new Uint8Array([1, 2, 3]));
    expect((await listFiles(TOKEN, { start: 0, limit: 50 })).items[0]).toMatchObject({ name: "a.pdf", size: 3, dealId: 5 });
    expect((await listActivityTypes(TOKEN)).map((t) => t.key)).toEqual(["call", "meeting", "task", "deadline", "email", "lunch"]);
    await expect(checkedFetch("/v1/notes?start=0&limit=200&sort=id%20ASC", auth)).resolves.toMatchObject({ status: 200 });
    await expect(checkedFetch("/v1/activityTypes", auth)).resolves.toMatchObject({ status: 200 });
    await expect(checkedFetch("/v1/files?sort=id%20ASC&start=0&limit=50", auth)).resolves.toMatchObject({ status: 200 });
  });
  it("throws on an undeclared v1 parameter or note property", async () => {
    const fake = setUp();
    fake.addNote(1001, { content: "Hi", user_id: 1 });
    await expect(checkedFetch("/v1/notes?page=2", auth)).rejects.toThrow(/"page" is not in pipedrive_v1_openapi.yml/);
    await expect(checkedFetch("/v1/files?per_page=50", auth)).rejects.toThrow(/"per_page" is not in pipedrive_v1_openapi.yml/);
    fake.tamper((body) => ((body.data as Record<string, unknown>[])[0].body = "Hi"));
    await expect(listNotes(TOKEN, { start: 0, limit: 10 })).rejects.toThrow(/no property "body"/);
  });
  it("checks participants and downloads, refusing an undeclared parameter or property", async () => {
    const fake = setUp();
    const stage = fake.addStage(1001, { pipeline_id: fake.addPipeline(1001, { name: "Sales" }), name: "Lead" });
    const person = fake.addPerson(1001, { first_name: "Ada", last_name: "Fake", owner_id: 1 });
    const deal = fake.addDeal(1001, { title: "D", owner_id: 1, stage_id: stage }, { participants: [person] });
    await expect(checkedFetch(`/v1/deals/${deal}/participants?per_page=10`, auth)).rejects.toThrow(/"per_page" is not in pipedrive_v1/);
    await expect(checkedFetch(`/v1/deals/${deal}/participants?start=0&limit=100`, auth)).resolves.toMatchObject({ status: 200 });
    fake.tamper((body) => ((body.data as Record<string, unknown>[])[0].person_title = "Dr"));
    await expect(dealParticipants(TOKEN, deal)).rejects.toThrow(/no property "person_title"/);
    const file = fake.addFile(1001, { name: "a.pdf", user_id: 1 }, new Uint8Array([7, 8]));
    await expect(checkedFetch(`/v1/files/${file}/download?inline=1`, auth)).rejects.toThrow(/"inline" is not in pipedrive_v1/);
    const res = await checkedFetch(`/v1/files/${file}/download`, auth);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([7, 8]);
    await expect(downloadFile(TOKEN, file, 10)).resolves.toEqual({ bytes: new Uint8Array([7, 8]) });
    await expect(downloadFile(TOKEN, file, 1)).resolves.toBe("too_large");
    await expect(downloadFile(TOKEN, 999, 10)).resolves.toBe("gone");
  });
  it("follows a download redirect once without the token; a token sent to the file host throws", async () => {
    const fake = setUp();
    const file = fake.addFile(1001, { name: "a.pdf", user_id: 1 }, new Uint8Array([9]));
    fake.redirectDownloads(true);
    const res = await checkedFetch(`/v1/files/${file}/download`, auth);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://${FILE_HOST}/1001/${file}`);
    await expect(downloadFile(TOKEN, file, 10)).resolves.toEqual({ bytes: new Uint8Array([9]) });
    expect(fileHostRequests).toEqual([{ path: `/1001/${file}`, token: false }]);
    await expect(checkedFileHost(`/1001/${file}`, auth)).rejects.toThrow(/never go to the file host/);
  });
});
