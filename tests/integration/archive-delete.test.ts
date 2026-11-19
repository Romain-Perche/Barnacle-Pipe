// covers FR-016, FR-017, SC-006, US4 scenarios 1–5, clarification "deleting a person removes their timeline and
// every organisation event about them"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { archiveOrganisation, deleteOrganisation, getOrganisation, restoreOrganisation } from "@/server/records/organisations";
import { archivePerson, createPerson, deletePerson, getPerson, restorePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { count, makeLabel, makeOrganisation, makeUser, resetDb, type TestUser } from "./db-helpers";
import { emails, personForm, saved } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;
let org: number;
let person: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
  const hot = await makeLabel("Hot");
  person = saved(
    await createPerson(
      linus.id,
      personForm({ organisationId: String(org), emails: emails("ada@example.com"), phones: [{ value: "0123", kind: "work" }], labelIds: [String(hot)] }),
    ),
  );
});
afterAll(closeDb);

describe("archive and restore", () => {
  it("any user archives and restores a person, once each (US4 scenarios 1–2)", async () => {
    expect(await archivePerson(linus.id, person)).toBe("ok");
    expect(await archivePerson(linus.id, person)).toBe("ok");
    expect((await getPerson(linus.id, person))!.archived).toBe(true);
    expect(await restorePerson(linus.id, person)).toBe("ok");
    expect(await restorePerson(linus.id, person)).toBe("ok");
    expect((await getPerson(linus.id, person))!.archived).toBe(false);
    const kinds = (await readTimeline(linus.id, { personId: person })).map((e) => [e.kind, e.actorName]);
    expect(kinds).toEqual([
      ["restored", "Linus Fake"],
      ["archived", "Linus Fake"],
      ["added", "Linus Fake"],
    ]);
  });

  it("any user archives and restores an organisation", async () => {
    expect(await archiveOrganisation(linus.id, org)).toBe("ok");
    expect((await getOrganisation(linus.id, org))!.archived).toBe(true);
    expect((await getPerson(linus.id, person))!.organisation).toEqual({ id: org, name: "Fakeco Ltd", archived: true });
    expect(await restoreOrganisation(linus.id, org)).toBe("ok");
    expect((await readTimeline(linus.id, { organisationId: org })).map((e) => e.kind)).toEqual(["restored", "archived", "person_linked"]);
  });

  it("answers not_found for a missing record", async () => {
    expect(await archivePerson(linus.id, 999)).toBe("not_found");
    expect(await restoreOrganisation(linus.id, 999)).toBe("not_found");
  });
});

describe("delete", () => {
  it("is refused to a non-admin and to a deactivated admin; nothing is deleted (SC-006)", async () => {
    const grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin", status: "deactivated" });
    for (const actor of [linus.id, grace.id]) {
      expect(await deletePerson(actor, person)).toEqual({ status: "forbidden" });
      expect(await deleteOrganisation(actor, org)).toEqual({ status: "forbidden" });
    }
    expect(await count("persons")).toBe(1);
    expect(await count("organisations")).toBe(1);
  });

  it("an admin deletes a person with their emails, phones, labels, events and organisation events about them", async () => {
    expect(await deletePerson(ada.id, person)).toEqual({ status: "deleted", name: "Ada Example" });
    expect(await getPerson(ada.id, person)).toBeNull();
    for (const t of ["persons", "person_emails", "person_phones", "person_labels"] as const) expect(await count(t), t).toBe(0);
    const [{ n }] = await sql`select count(*)::int as n from timeline_events where person_id = ${person} or related_person_id = ${person}`;
    expect(n).toBe(0);
    expect(await deletePerson(ada.id, person)).toEqual({ status: "not_found" });
  });

  it("an admin deletes an organisation; its people stay with no organisation (US4 scenario 4)", async () => {
    expect(await deleteOrganisation(ada.id, org)).toEqual({ status: "deleted", name: "Fakeco Ltd" });
    expect(await getOrganisation(ada.id, org)).toBeNull();
    expect((await getPerson(ada.id, person))!.organisation).toBeNull();
    expect(await count("timeline_events")).toBe(1); // the person's "added"
  });
});
