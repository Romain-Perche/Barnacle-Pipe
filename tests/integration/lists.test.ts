// covers FR-012, FR-013, FR-014, FR-015, FR-022 (filters offer removed values still in use), US3 scenarios 1–5,
// edge cases "more than 50 matches" and "page beyond the last"
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { listOrganisations, organisationFilterOptions } from "@/server/records/organisations";
import { parseOrganisationsQuery, parsePeopleQuery } from "@/server/records/list-query";
import { listPeople, peopleFilterOptions } from "@/server/records/people";
import { leadSourceId, makeLabel, makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;
let linus: TestUser;
let alan: TestUser;
let hot: number;
let old: number;
let fakeco: number;
let gyms: number;
let referral: number;
let inbound: number;
const ids: Record<string, number> = {};

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
  hot = await makeLabel("Hot");
  old = await makeLabel("Old", true);
  await makeLabel("Unused old", true);
  referral = await leadSourceId("Referral");
  inbound = await leadSourceId("Inbound");
  await sql`update lead_sources set removed_at = now() where id = ${inbound} or name = 'Event'`;
  fakeco = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id, sector: "Fitness", size: "201–1,000", website: "https://fakeco.example" });
  gyms = await makeOrganisation({ name: "Example Gyms", ownerId: linus.id, sector: "fitness", size: "1–10" });
  await makeOrganisation({ name: "Zed Consulting", ownerId: alan.id, sector: "Consulting", size: "11–50" });
  await makeOrganisation({ name: "Archived Co", ownerId: ada.id, archived: true, sector: "Retail" });

  ids.ada = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, ownerId: ada.id, organisationId: fakeco, leadSourceId: referral, labelIds: [hot], createdAt: day(3), lastContactedAt: day(10) });
  ids.bob = await makePerson({ firstName: "Bob", lastName: "Placeholder", createdBy: ada.id, ownerId: linus.id, organisationId: gyms, leadSourceId: inbound, labelIds: [old], consent: "unsubscribed", createdAt: day(1) });
  ids.cleo = await makePerson({ firstName: "Cleo", lastName: "Testperson", createdBy: ada.id, ownerId: alan.id, createdAt: day(2), lastContactedAt: day(5) });
  ids.dan = await makePerson({ firstName: "Dan", lastName: "Archived", createdBy: ada.id, ownerId: ada.id, organisationId: fakeco, archived: true, createdAt: day(4) });
});
afterAll(closeDb);

async function people(params: Record<string, string>) {
  const r = await listPeople(ada.id, parsePeopleQuery(params));
  return r.rows.map((x) => x.name);
}
async function orgs(params: Record<string, string>) {
  const r = await listOrganisations(ada.id, parseOrganisationsQuery(params));
  return r.rows.map((x) => x.name);
}

describe("People list", () => {
  it("shows one row per person with the columns of US3 scenario 1, name A–Z, archived hidden", async () => {
    const r = await listPeople(ada.id, parsePeopleQuery({}));
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.name)).toEqual(["Ada Example", "Bob Placeholder", "Cleo Testperson"]);
    expect(r.rows[0]).toMatchObject({
      id: ids.ada,
      email: null,
      organisation: { id: fakeco, name: "Fakeco Ltd", archived: false },
      owner: { name: "Ada Fake", active: true },
      labels: ["Hot"],
      leadSource: "Referral",
      consent: "subscribed",
      lastContactedAt: day(10),
      archived: false,
    });
    expect(r.rows[2].owner).toEqual({ id: alan.id, name: "Alan Fake", active: false });
  });

  it("filters by owner, label, lead source, organisation and consent, alone and together", async () => {
    expect(await people({ owner: String(linus.id) })).toEqual(["Bob Placeholder"]);
    expect(await people({ label: String(hot) })).toEqual(["Ada Example"]);
    expect(await people({ label: String(old) })).toEqual(["Bob Placeholder"]);
    expect(await people({ source: String(referral) })).toEqual(["Ada Example"]);
    expect(await people({ org: String(fakeco) })).toEqual(["Ada Example"]);
    expect(await people({ consent: "unsubscribed" })).toEqual(["Bob Placeholder"]);
    expect(await people({ consent: "subscribed" })).toEqual(["Ada Example", "Cleo Testperson"]);
    expect(await people({ owner: String(ada.id), source: String(referral), consent: "subscribed" })).toEqual(["Ada Example"]);
    expect(await people({ owner: String(ada.id), consent: "unsubscribed" })).toEqual([]);
  });

  it("sorts by name, organisation, date added and last contacted, both ways, empty values last", async () => {
    expect(await people({ sort: "name", dir: "desc" })).toEqual(["Cleo Testperson", "Bob Placeholder", "Ada Example"]);
    expect(await people({ sort: "organisation" })).toEqual(["Bob Placeholder", "Ada Example", "Cleo Testperson"]);
    expect(await people({ sort: "organisation", dir: "desc" })).toEqual(["Ada Example", "Bob Placeholder", "Cleo Testperson"]);
    expect(await people({ sort: "added" })).toEqual(["Bob Placeholder", "Cleo Testperson", "Ada Example"]);
    expect(await people({ sort: "added", dir: "desc" })).toEqual(["Ada Example", "Cleo Testperson", "Bob Placeholder"]);
    expect(await people({ sort: "contacted" })).toEqual(["Cleo Testperson", "Ada Example", "Bob Placeholder"]);
    expect(await people({ sort: "contacted", dir: "desc" })).toEqual(["Ada Example", "Cleo Testperson", "Bob Placeholder"]);
  });

  it("shows archived people, marked, only when asked (US3 scenario 5)", async () => {
    const r = await listPeople(ada.id, parsePeopleQuery({ archived: "1" }));
    expect(r.rows.map((x) => [x.name, x.archived])).toContainEqual(["Dan Archived", true]);
    expect(r.total).toBe(4);
  });

  it("offers filter values in use, removed ones included while a person has them", async () => {
    const o = await peopleFilterOptions(ada.id, null);
    expect(o.owners.map((x) => x.name)).toEqual(["Ada Fake", "Alan Fake (deactivated)", "Linus Fake"]);
    expect(o.labels.map((x) => x.name)).toEqual(["Hot", "Old"]);
    expect(o.sources.map((x) => x.name)).toEqual(["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Ambassador"]);
    expect(o.organisations.map((x) => x.name)).toEqual(["Example Gyms", "Fakeco Ltd"]);
    const selected = await peopleFilterOptions(ada.id, (await sql`select id::int as id from organisations where name = 'Zed Consulting'`)[0].id);
    expect(selected.organisations.map((x) => x.name)).toContain("Zed Consulting");
  });
});

describe("paging", () => {
  it("shows 50 rows per page with the total; a page beyond the last shows the last", async () => {
    const extra: number[] = [];
    for (let i = 0; i < 48; i++) extra.push(await makePerson({ firstName: "Zz", lastName: `Page ${String(i).padStart(2, "0")}`, createdBy: ada.id }));
    const p1 = await listPeople(ada.id, parsePeopleQuery({}));
    expect(p1).toMatchObject({ total: 51, page: 1, pages: 2 });
    expect(p1.rows).toHaveLength(50);
    const p2 = await listPeople(ada.id, parsePeopleQuery({ page: "2" }));
    expect(p2.rows.map((r) => r.name)).toEqual(["Zz Page 47"]);
    const last = await listPeople(ada.id, parsePeopleQuery({ page: "999" }));
    expect(last).toMatchObject({ page: 2, pages: 2 });
    expect(last.rows).toHaveLength(1);
    await sql`delete from persons where id in ${sql(extra)}`;
    expect(await listPeople(ada.id, parsePeopleQuery({ q: "nobody", page: "3" }))).toMatchObject({ total: 0, page: 1, pages: 1, rows: [] });
  });
});

describe("Organisations list", () => {
  it("shows name, website, sector, size, location, owner and visible non-archived people", async () => {
    const r = await listOrganisations(ada.id, parseOrganisationsQuery({}));
    expect(r.total).toBe(3);
    expect(r.rows[1]).toMatchObject({ name: "Fakeco Ltd", website: "https://fakeco.example", sector: "Fitness", size: "201–1,000", owner: { name: "Ada Fake" }, people: 1 });
  });
  it("searches name or website, filters owner, sector (any case) and size", async () => {
    expect(await orgs({ q: "fakeco.example" })).toEqual(["Fakeco Ltd"]);
    expect(await orgs({ q: "gyms" })).toEqual(["Example Gyms"]);
    expect(await orgs({ owner: String(linus.id) })).toEqual(["Example Gyms"]);
    expect(await orgs({ sector: "FITNESS" })).toEqual(["Example Gyms", "Fakeco Ltd"]);
    expect(await orgs({ size: "11–50" })).toEqual(["Zed Consulting"]);
    expect(await orgs({ archived: "1", sector: "retail" })).toEqual(["Archived Co"]);
  });
  it("sorts by name, number of people and date added", async () => {
    await makePerson({ firstName: "Extra", lastName: "One", createdBy: ada.id, organisationId: gyms });
    await makePerson({ firstName: "Extra", lastName: "Two", createdBy: ada.id, organisationId: gyms });
    expect(await orgs({ sort: "name", dir: "desc" })).toEqual(["Zed Consulting", "Fakeco Ltd", "Example Gyms"]);
    expect(await orgs({ sort: "people", dir: "desc" })).toEqual(["Example Gyms", "Fakeco Ltd", "Zed Consulting"]);
    expect(await orgs({ sort: "people" })).toEqual(["Zed Consulting", "Fakeco Ltd", "Example Gyms"]);
    expect(await orgs({ sort: "added" })).toEqual(["Fakeco Ltd", "Example Gyms", "Zed Consulting"]);
  });
  it("offers owners and sectors in use", async () => {
    const o = await organisationFilterOptions();
    expect(o.owners.map((x) => x.name)).toEqual(["Ada Fake", "Alan Fake (deactivated)", "Linus Fake"]);
    expect(o.sectors).toEqual(["Consulting", "Fitness", "Retail"]);
  });
});
