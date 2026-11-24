// covers SF-119 FR-015, US5 scenarios 3, 4, 7, SC-003, SC-005, Edge Cases "can no longer see", "no first name",
// "multiple choice" (T039): a person's merge values formatted as on the person page, only for a visible, non-archived
// person; the picker offers only visible, non-archived people matching part of a name or email, 20 at most.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { previewValues, searchPreviewPeople } from "@/server/campaigns/preview";
import { leadSourceId, makeLabel, makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeField, setValue } from "./custom-helpers";

let ada: TestUser, grace: TestUser, linus: TestUser, margaret: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
});
afterAll(closeDb);

describe("previewValues (US5 scenario 4, SC-003)", () => {
  it("gives every built-in and custom value, formatted as on the person page", async () => {
    const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
    const zeta = await makeLabel("Zeta (fake)");
    const alpha = await makeLabel("Alpha (fake)");
    const id = await makePerson({
      firstName: "Cara", lastName: "Fakeperson", createdBy: ada.id, ownerId: margaret.id, emails: ["cara@example.test", "cara2@example.test"],
      phones: ["+44 20 7946 0000", "+44 20 7946 0001"], organisationId: org, role: "CTO", leadSourceId: await leadSourceId("Referral"),
      labelIds: [zeta, alpha],
    });
    await sql`update persons set linkedin_url = 'https://www.linkedin.com/in/cara-fake' where id = ${id}`;
    const diet = await makeField({ kind: "person", name: "Diet", type: "multiple_choice", choices: ["Vegan", "Halal", "None"] });
    const birthday = await makeField({ kind: "person", name: "Birthday", type: "date" });
    const budget = await makeField({ kind: "person", name: "Budget", type: "money" });
    const vip = await makeField({ kind: "person", name: "VIP", type: "yes_no" });
    const note = await makeField({ kind: "person", name: "Note", type: "text" });
    await setValue(diet.id, { personId: id }, "choice_ids", [diet.choices.Halal, diet.choices.Vegan]);
    await setValue(birthday.id, { personId: id }, "date_value", "2026-11-24");
    await setValue(budget.id, { personId: id }, "money_pence", 120000);
    await setValue(vip.id, { personId: id }, "bool_value", false);
    expect(await previewValues(linus.id, id)).toEqual({
      first_name: "Cara", last_name: "Fakeperson", full_name: "Cara Fakeperson", email: "cara@example.test", phone: "+44 20 7946 0000",
      organisation: "Fakeco Ltd", role: "CTO", lead_source: "Referral", linkedin: "https://www.linkedin.com/in/cara-fake",
      owner: "Margaret Fake", labels: "Alpha (fake), Zeta (fake)",
      [`cf:${diet.id}`]: "Vegan, Halal", [`cf:${birthday.id}`]: "24 Nov 2026", [`cf:${budget.id}`]: "£1,200", [`cf:${vip.id}`]: "No",
      [`cf:${note.id}`]: null,
    });
  });

  it("gives null for empty fields (Edge Case: no first name, no organisation, no custom values)", async () => {
    const id = await makePerson({ firstName: "", lastName: "McFake", createdBy: ada.id });
    const v = await previewValues(ada.id, id);
    expect(v).toMatchObject({ first_name: null, last_name: "McFake", full_name: "McFake", email: null, phone: null, organisation: null, role: null, lead_source: null, linkedin: null, labels: null });
  });

  it("gives nothing for a private person the viewer cannot see (admins included) and for an archived person (SC-005)", async () => {
    const hidden = await makePerson({ firstName: "Pat", lastName: "Privatefake", createdBy: linus.id, private: true });
    expect(await previewValues(margaret.id, hidden)).toBeNull();
    expect(await previewValues(grace.id, hidden)).toBeNull();
    expect(await previewValues(linus.id, hidden)).toMatchObject({ first_name: "Pat" });
    const archived = await makePerson({ firstName: "Old", lastName: "Fake", createdBy: ada.id, archived: true });
    expect(await previewValues(ada.id, archived)).toBeNull();
    expect(await previewValues(ada.id, 999_999)).toBeNull();
  });
});

describe("searchPreviewPeople (US5 scenario 3)", () => {
  it("matches part of a name or an email, case-insensitive, with organisation and first email as detail", async () => {
    const org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
    const fakey = await makePerson({ firstName: "Fakey", lastName: "McFake", createdBy: ada.id, emails: ["fakey@example.test"], organisationId: org });
    const other = await makePerson({ firstName: "Other", lastName: "Person", createdBy: ada.id, emails: ["someone@mcfake.test"] });
    expect(await searchPreviewPeople(ada.id, "KEY mc")).toEqual([{ id: fakey, name: "Fakey McFake", detail: "Fakeco Ltd · fakey@example.test" }]);
    expect((await searchPreviewPeople(ada.id, " mcfake ")).map((p) => p.id)).toEqual([fakey, other]);
    expect(await searchPreviewPeople(ada.id, "@MCFAKE.test")).toEqual([{ id: other, name: "Other Person", detail: "someone@mcfake.test" }]);
  });

  it("never offers a hidden or archived person; % and _ are literal", async () => {
    await makePerson({ firstName: "Pat", lastName: "Privatefake", createdBy: linus.id, private: true });
    await makePerson({ firstName: "Old", lastName: "Fake", createdBy: ada.id, archived: true });
    const pct = await makePerson({ firstName: "Fake", lastName: "100%", createdBy: ada.id, emails: ["under_score@example.test"] });
    await makePerson({ firstName: "Barns", lastName: "Fake", createdBy: ada.id }); // "rns" would match r_s as a wildcard
    expect(await searchPreviewPeople(grace.id, "Privatefake")).toEqual([]);
    expect((await searchPreviewPeople(linus.id, "Privatefake")).length).toBe(1);
    expect(await searchPreviewPeople(ada.id, "Old Fake")).toEqual([]);
    expect((await searchPreviewPeople(ada.id, "%")).map((p) => p.id)).toEqual([pct]);
    expect((await searchPreviewPeople(ada.id, "r_s")).map((p) => p.id)).toEqual([pct]);
  });

  it("gives at most 20 of 25, in name order; a blank or 101-character query gives nothing", async () => {
    for (let i = 0; i < 25; i++) await makePerson({ firstName: `Fake${String(i).padStart(2, "0")}`, lastName: "Many", createdBy: ada.id });
    const found = await searchPreviewPeople(ada.id, "many");
    expect(found.length).toBe(20);
    expect(found[0].name).toBe("Fake00 Many");
    expect(found[19].name).toBe("Fake19 Many");
    expect(await searchPreviewPeople(ada.id, "   ")).toEqual([]);
    expect(await searchPreviewPeople(ada.id, "m".repeat(101))).toEqual([]);
  });
});

describe("the chosen person is never stored (US5 scenario 7)", () => {
  it("has no person column on campaigns", async () => {
    const cols = await sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_name = 'campaigns'`;
    expect(cols.map((c) => c.column_name).filter((c) => /person|preview_for/.test(c))).toEqual([]);
  });
});
