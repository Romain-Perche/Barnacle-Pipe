// covers FR-007, FR-008, FR-009, FR-011, US2 scenarios 1–5, clarification "archived organisations not offered;
// typing an archived one's name shows '<name> already exists.'"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import {
  createOrganisation,
  getOrganisation,
  peopleOf,
  updateOrganisation,
} from "@/server/records/organisations";
import { createPerson, getPerson, personFormChoices, updatePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { count, makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { emails, orgForm, personForm, saved } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

describe("organisations", () => {
  it("saves every field, normalises the website, owner defaults to the user (US2 scenario 1)", async () => {
    const id = saved(
      await createOrganisation(linus.id, orgForm({ website: "fakeco.example", sector: "Fitness", size: "201–1,000", location: "London" })),
    );
    expect(await getOrganisation(linus.id, id)).toMatchObject({
      name: "Fakeco Ltd",
      website: "https://fakeco.example",
      sector: "Fitness",
      size: "201–1,000",
      location: "London",
      owner: { id: linus.id, name: "Linus Fake", active: true },
      archived: false,
      peopleCount: 0,
      version: 1,
    });
    expect(await peopleOf(linus.id, id)).toEqual([]);
    expect((await readTimeline(linus.id, { organisationId: id })).entries).toMatchObject([{ kind: "added", actorName: "Linus Fake" }]);
  });

  it("refuses a name that exists, ignoring case and spaces, archived ones included (US2 scenario 4)", async () => {
    const id = saved(await createOrganisation(ada.id, orgForm()));
    expect(await createOrganisation(ada.id, orgForm({ name: " fakeco ltd " }))).toEqual({
      status: "invalid",
      errors: { name: { code: "organisation_exists", name: "Fakeco Ltd", href: `/organisations/${id}` } },
    });
    const old = await makeOrganisation({ name: "Old Co", ownerId: ada.id, archived: true });
    expect(await createOrganisation(ada.id, orgForm({ name: "OLD CO" }))).toMatchObject({
      errors: { name: { code: "organisation_exists", name: "Old Co", href: `/organisations/${old}` } },
    });
    expect(await count("organisations")).toBe(2);
  });

  it("refuses an empty name and an invalid website; ignores a size outside the five bands", async () => {
    expect(await createOrganisation(ada.id, orgForm({ name: " ", website: "javascript:alert(1)" }))).toEqual({
      status: "invalid",
      errors: { name: { code: "organisation_name_required" }, website: { code: "website_invalid" } },
    });
    const id = saved(await createOrganisation(ada.id, orgForm({ size: "huge" })));
    expect((await getOrganisation(ada.id, id))!.size).toBeNull();
  });

  it("records edits and refuses a save from an old version", async () => {
    const id = saved(await createOrganisation(ada.id, orgForm()));
    expect(await updateOrganisation(linus.id, id, 1, orgForm({ sector: "Gyms", ownerId: String(ada.id) }))).toEqual({ status: "saved", id });
    expect(((await readTimeline(ada.id, { organisationId: id })).entries)[0]).toMatchObject({ kind: "edited", actorName: "Linus Fake", fields: ["Sector"] });
    expect(await updateOrganisation(ada.id, id, 1, orgForm({ sector: "Other" }))).toEqual({
      status: "invalid",
      errors: { form: { code: "edit_conflict_organisation" } },
    });
    expect((await getOrganisation(ada.id, id))!.sector).toBe("Gyms");
  });

  it("refuses renaming to another organisation's name", async () => {
    const other = saved(await createOrganisation(ada.id, orgForm({ name: "Other Co" })));
    const id = saved(await createOrganisation(ada.id, orgForm()));
    expect(await updateOrganisation(ada.id, id, 1, orgForm({ name: "other co" }))).toMatchObject({
      errors: { name: { code: "organisation_exists", name: "Other Co", href: `/organisations/${other}` } },
    });
  });
});

describe("people and their organisation", () => {
  it("links and unlinks a person, recording it on the organisation (US2 scenarios 2 and 5)", async () => {
    const org = saved(await createOrganisation(ada.id, orgForm()));
    const p = saved(await createPerson(linus.id, personForm({ organisationId: String(org), role: "COO", emails: emails("ada@example.com") })));
    expect((await getPerson(ada.id, p))!.organisation).toEqual({ id: org, name: "Fakeco Ltd", archived: false });
    expect(await peopleOf(ada.id, org)).toEqual([{ id: p, name: "Ada Example", role: "COO", email: "ada@example.com" }]);
    expect((await getOrganisation(ada.id, org))!.peopleCount).toBe(1);
    expect(((await readTimeline(ada.id, { organisationId: org })).entries)[0]).toMatchObject({
      kind: "person_linked",
      actorName: "Linus Fake",
      relatedPerson: { id: p, name: "Ada Example" },
    });

    await updatePerson(ada.id, p, 1, personForm({ organisationId: "", role: "COO", emails: emails("ada@example.com"), ownerId: String(linus.id) }));
    expect((await getPerson(ada.id, p))!.organisation).toBeNull();
    expect(await peopleOf(ada.id, org)).toEqual([]);
    expect(((await readTimeline(ada.id, { organisationId: org })).entries)[0]).toMatchObject({ kind: "person_unlinked", actorName: "Ada Fake" });
    expect(((await readTimeline(ada.id, { personId: p })).entries)[0]).toMatchObject({ kind: "edited", fields: ["Organisation"] });
  });

  it("creates a new organisation by name with the person, owned by the user (US2 scenario 3)", async () => {
    const p = saved(await createPerson(linus.id, personForm({ newOrganisationName: " New Org " })));
    const person = await getPerson(linus.id, p);
    expect(person!.organisation).toMatchObject({ name: "New Org", archived: false });
    const org = await getOrganisation(linus.id, person!.organisation!.id);
    expect(org!.owner.id).toBe(linus.id);
    expect(((await readTimeline(linus.id, { organisationId: org!.id })).entries).map((e) => e.kind)).toEqual(["person_linked", "added"]);
  });

  it("links an existing organisation typed as a new name, ignoring case and outer spaces; adds nothing (FR-008, Fix round 1)", async () => {
    // covers FR-008, Fix round 1
    const acme = await makeOrganisation({ name: "Acme Ltd", ownerId: ada.id });
    const p = saved(await createPerson(linus.id, personForm({ newOrganisationName: "  acme ltd  " })));
    expect((await getPerson(linus.id, p))!.organisation).toMatchObject({ id: acme, name: "Acme Ltd" });
    expect(await count("organisations")).toBe(1);
  });

  it("refuses a new organisation name that an archived organisation has, and saves nothing (FR-008, Fix round 1)", async () => {
    // covers FR-008, Fix round 1, clarification Q3
    const old = await makeOrganisation({ name: "Acme Ltd", ownerId: ada.id, archived: true });
    expect(await createPerson(linus.id, personForm({ newOrganisationName: "  acme ltd  " }))).toEqual({
      status: "invalid",
      errors: { organisation: { code: "organisation_exists", name: "Acme Ltd", href: `/organisations/${old}` } },
    });
    expect(await count("persons")).toBe(0);
    expect(await count("organisations")).toBe(1);
  });

  it("offers only non-archived organisations; an archived id is kept only when it is the person's current one", async () => {
    const live = await makeOrganisation({ name: "Live Co", ownerId: ada.id });
    const old = await makeOrganisation({ name: "Old Co", ownerId: ada.id, archived: true });
    expect((await personFormChoices(ada.id, null)).organisations).toEqual([{ id: live, name: "Live Co", archived: false }]);
    const p = saved(await createPerson(ada.id, personForm({ organisationId: String(old) })));
    expect((await getPerson(ada.id, p))!.organisation).toBeNull();

    const kept = await makePerson({ createdBy: ada.id, organisationId: old });
    await updatePerson(ada.id, kept, 1, personForm({ firstName: "Test", lastName: "Person", organisationId: String(old), role: "X" }));
    expect((await getPerson(ada.id, kept))!.organisation).toEqual({ id: old, name: "Old Co", archived: true });
  });

  it("lists only visible, non-archived people on the organisation page, with role and main email (FR-009)", async () => {
    const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
    const a = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, organisationId: org, role: "COO", emails: ["ada@example.com", "b@example.com"] });
    const b = await makePerson({ firstName: "Bob", lastName: "Placeholder", createdBy: ada.id, organisationId: org });
    await makePerson({ firstName: "Gone", lastName: "Person", createdBy: ada.id, organisationId: org, archived: true });
    await makePerson({ firstName: "Hidden", lastName: "Person", createdBy: linus.id, organisationId: org, private: true });
    expect(await peopleOf(ada.id, org)).toEqual([
      { id: a, name: "Ada Example", role: "COO", email: "ada@example.com" },
      { id: b, name: "Bob Placeholder", role: null, email: null },
    ]);
    expect((await getOrganisation(ada.id, org))!.peopleCount).toBe(2);
  });
});
