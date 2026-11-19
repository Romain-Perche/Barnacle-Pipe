// covers FR-016, FR-017, SC-006, US4 scenarios 1–5, clarification "deleting a person removes their timeline and
// every organisation event about them" (SF-92 changes it: those events stay, without the person)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { archiveOrganisation, deleteOrganisation, getOrganisation, restoreOrganisation } from "@/server/records/organisations";
import { archivePerson, createPerson, deletePerson, getPerson, restorePerson, updatePerson } from "@/server/records/people";
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

  it("an admin deletes a person with their emails, phones, labels and events; organisation events lose the person (SF-92 FR-005, FR-006)", async () => {
    expect(await deletePerson(ada.id, person)).toEqual({ status: "deleted", name: "Ada Example" });
    expect(await getPerson(ada.id, person)).toBeNull();
    for (const t of ["persons", "person_emails", "person_phones", "person_labels"] as const) expect(await count(t), t).toBe(0);
    const [{ n }] = await sql`select count(*)::int as n from timeline_events where person_id = ${person} or related_person_id = ${person}`;
    expect(n).toBe(0);
    expect((await readTimeline(ada.id, { organisationId: org })).map((e) => [e.kind, e.relatedPerson])).toEqual([["person_linked", null]]);
    expect(await deletePerson(ada.id, person)).toEqual({ status: "not_found" });
  });

  it("an admin deletes an organisation; its people stay with no organisation (US4 scenario 4)", async () => {
    expect(await deleteOrganisation(ada.id, org)).toEqual({ status: "deleted", name: "Fakeco Ltd" });
    expect(await getOrganisation(ada.id, org)).toBeNull();
    expect((await getPerson(ada.id, person))!.organisation).toBeNull();
    expect(await count("timeline_events")).toBe(1); // the person's "added"
  });
});

// covers FR-005, FR-006, FR-007, SC-002, US2 scenarios 1–4 (SF-92)
describe("deleting a person keeps the history on other records", () => {
  it("keeps linked and unlinked events, in order, with actor and time, without the person (US2 scenarios 1–2)", async () => {
    await sql`update timeline_events set created_at = now() - interval '2 days' where organisation_id = ${org}`;
    await updatePerson(linus.id, person, 1, personForm({ emails: emails("ada@example.com"), phones: [{ value: "0123", kind: "work" }] }));
    const before = await readTimeline(linus.id, { organisationId: org });
    expect(before.map((e) => e.kind)).toEqual(["person_unlinked", "person_linked"]);
    expect(await deletePerson(ada.id, person)).toEqual({ status: "deleted", name: "Ada Example" });
    const after = await readTimeline(linus.id, { organisationId: org });
    expect(after).toEqual(before.map((e) => ({ ...e, relatedPerson: null })));
    expect(after.map((e) => e.actorName)).toEqual(["Linus Fake", "Linus Fake"]);
    const rows = await sql`select related_person_id from timeline_events where organisation_id = ${org}`;
    expect(rows.map((r) => r.related_person_id)).toEqual([null, null]);
    expect(JSON.stringify(after)).not.toContain("Ada");
    for (const t of ["person_emails", "person_phones", "person_labels"] as const) expect(await count(t), t).toBe(0);
  });

  it("adds no unlinked event when the person is still linked (US2 scenario 3)", async () => {
    await deletePerson(ada.id, person);
    expect((await readTimeline(ada.id, { organisationId: org })).map((e) => e.kind)).toEqual(["person_linked"]);
  });

  it("removes every event about a person who was private when deleted (FR-007, US2 scenario 4)", async () => {
    const secret = saved(await createPerson(linus.id, personForm({ firstName: "Secret", private: true, ownerId: String(ada.id), organisationId: String(org) })));
    const other = await makeOrganisation({ name: "Other Fake", ownerId: ada.id });
    await updatePerson(linus.id, secret, 1, personForm({ firstName: "Secret", private: true, ownerId: String(ada.id), organisationId: String(other) }));
    expect(await deletePerson(ada.id, secret)).toEqual({ status: "deleted", name: "Secret Example" });
    const [{ n }] = await sql`select count(*)::int as n from timeline_events where related_person_id is null and kind like 'person_%' and organisation_id = ${other}`;
    expect(n).toBe(0);
    for (const viewer of [linus.id, ada.id]) {
      const events = [...(await readTimeline(viewer, { organisationId: org })), ...(await readTimeline(viewer, { organisationId: other }))];
      expect(events.map((e) => [e.kind, e.relatedPerson?.id ?? null])).toEqual([["person_linked", person]]);
    }
  });

  it("leaves other records' events unchanged when the person was never linked (US2 scenario 4)", async () => {
    const lone = saved(await createPerson(linus.id, personForm({ firstName: "Lone" })));
    const before = await sql`select * from timeline_events where person_id is distinct from ${lone} order by id`;
    await deletePerson(ada.id, lone);
    expect(await sql`select * from timeline_events order by id`).toEqual(before);
  });
});
