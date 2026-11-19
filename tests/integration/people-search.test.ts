// covers FR-012 (search), FR-015, US1 scenario 2, edge case "search with %, _ or quotes"
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { parsePeopleQuery } from "@/server/records/list-query";
import { listPeople } from "@/server/records/people";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  const fakeco = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
  await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, emails: ["ada@example.com", "ada.home@example.net"], organisationId: fakeco });
  await makePerson({ firstName: "Bob", lastName: "Placeholder", createdBy: ada.id, emails: ["bob@example.net"] });
  await makePerson({ firstName: "Fifty", lastName: "50% off", createdBy: ada.id });
  await makePerson({ firstName: "Fifty", lastName: "500 off", createdBy: ada.id });
  await makePerson({ firstName: "Under", lastName: "a_b", createdBy: ada.id });
  await makePerson({ firstName: "Under", lastName: "axb", createdBy: ada.id });
  await makePerson({ firstName: "Quote", lastName: "O'Brien", createdBy: ada.id });
  await makePerson({ firstName: "Gone", lastName: "Archived", createdBy: ada.id, archived: true, emails: ["gone@example.com"] });
});
afterAll(closeDb);

async function names(q: string, extra: Record<string, string> = {}) {
  const { rows } = await listPeople(ada.id, parsePeopleQuery({ q, ...extra }));
  return rows.map((r) => r.name);
}

describe("People search", () => {
  it("finds part of the first name, either name order and any email address", async () => {
    expect(await names("ad")).toEqual(["Ada Example"]);
    expect(await names("example ada")).toEqual(["Ada Example"]);
    expect(await names("ada example")).toEqual(["Ada Example"]);
    expect(await names("ADA.HOME@")).toEqual(["Ada Example"]);
    expect(await names("bob@example.net")).toEqual(["Bob Placeholder"]);
  });
  it("finds by organisation name", async () => {
    expect(await names("fakeco")).toEqual(["Ada Example"]);
  });
  it("treats %, _ and quotes literally", async () => {
    expect(await names("50%")).toEqual(["Fifty 50% off"]);
    expect(await names("a_b")).toEqual(["Under a_b"]);
    expect(await names("O'Brien")).toEqual(["Quote O'Brien"]);
    expect(await names("\\")).toEqual([]);
  });
  it("hides archived people unless asked", async () => {
    expect(await names("gone")).toEqual([]);
    expect(await names("gone@example.com", { archived: "1" })).toEqual(["Gone Archived"]);
  });
});
