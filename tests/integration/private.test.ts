// covers FR-018, FR-019, FR-028, SC-005, US5 scenarios 1–4, edge case "private person's creator deactivated",
// clarifications "owner of a private person does not see them" and "organisation events about a private person"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { parseOrganisationsQuery, parsePeopleQuery } from "@/server/records/list-query";
import { getOrganisation, listOrganisations, peopleOf } from "@/server/records/organisations";
import {
  archivePerson,
  createPerson,
  deletePerson,
  getPerson,
  listPeople,
  peopleFilterOptions,
  restorePerson,
  updatePerson,
} from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { leadSourceId, makeLabel, makeOrganisation, makeUser, resetDb, type TestUser } from "./db-helpers";
import { emails, personForm, saved } from "./record-helpers";

let linus: TestUser; // creator (A)
let margaret: TestUser; // another user (B), also chosen as owner
let ada: TestUser; // admin
let org: number;
let secret: number;
let secretLabel: number;
let removedSource: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  org = await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
  secretLabel = await makeLabel("Secret label", true);
  removedSource = await leadSourceId("Event");
  await sql`update lead_sources set removed_at = now() where id = ${removedSource}`;
  secret = saved(
    await createPerson(
      linus.id,
      personForm({
        firstName: "Secret",
        lastName: "Person",
        private: true,
        organisationId: String(org),
        ownerId: String(margaret.id),
        emails: emails("secret@example.com"),
        labelIds: [String(secretLabel)],
        leadSourceId: String(removedSource),
        consent: "unsubscribed",
      }),
    ),
  );
  // The labels/source were removed before; the creator could not pick them. Attach directly to test the filters.
  await sql`insert into person_labels (person_id, label_id) values (${secret}, ${secretLabel})`;
  await sql`update persons set lead_source_id = ${removedSource} where id = ${secret}`;
  await sql`update users set status = 'active' where id = ${margaret.id}`;
});
afterAll(closeDb);

async function seesNothing(viewerId: number) {
  const queries = [
    {},
    { q: "secret" },
    { q: "secret@example.com" },
    { q: "fakeco" },
    { archived: "1" },
    { owner: String(margaret.id) },
    { label: String(secretLabel) },
    { source: String(removedSource) },
    { org: String(org) },
    { consent: "unsubscribed" },
    { open: String(secret) },
  ];
  for (const q of queries) {
    const r = await listPeople(viewerId, parsePeopleQuery(q));
    expect(r.rows.map((x) => x.id), JSON.stringify(q)).not.toContain(secret);
    expect(r.total, JSON.stringify(q)).toBe(0);
  }
  const options = await peopleFilterOptions(viewerId, null);
  expect(options.labels.map((l) => l.id)).not.toContain(secretLabel);
  expect(options.sources.map((s) => s.id)).not.toContain(removedSource);
  expect(options.organisations.map((o) => o.id)).not.toContain(org);
  expect(await getPerson(viewerId, secret)).toBeNull();
  expect(await peopleOf(viewerId, org)).toEqual([]);
  expect((await getOrganisation(viewerId, org))!.peopleCount).toBe(0);
  const orgs = await listOrganisations(viewerId, parseOrganisationsQuery({}));
  expect(orgs.rows.find((o) => o.id === org)!.people).toBe(0);
  const events = await readTimeline(viewerId, { organisationId: org });
  expect(events.filter((e) => e.kind === "person_linked" || e.kind === "person_unlinked")).toEqual([]);
  expect(JSON.stringify(events)).not.toContain("Secret");
  expect(await readTimeline(viewerId, { personId: secret })).toEqual([]);
}

describe("a private person", () => {
  it("is seen everywhere, marked private, by their creator (US5 scenario 1)", async () => {
    expect((await getPerson(linus.id, secret))!.private).toBe(true);
    expect((await listPeople(linus.id, parsePeopleQuery({ q: "secret" }))).rows.map((r) => r.id)).toEqual([secret]);
    expect((await peopleOf(linus.id, org)).map((p) => p.id)).toEqual([secret]);
    expect((await readTimeline(linus.id, { organisationId: org }))[0]).toMatchObject({ kind: "person_linked", relatedPerson: { id: secret } });
  });

  it("is invisible to another user, even the owner, and to an admin (US5 scenario 2, SC-005)", async () => {
    await seesNothing(margaret.id);
    await seesNothing(ada.id);
  });

  it("cannot be changed by anyone else: edit, archive, restore and delete answer not found (FR-019)", async () => {
    for (const actor of [margaret.id, ada.id]) {
      expect(await updatePerson(actor, secret, 1, personForm({ firstName: "Hacked" }))).toEqual({ status: "not_found" });
      expect(await archivePerson(actor, secret)).toBe("not_found");
      expect(await restorePerson(actor, secret)).toBe("not_found");
    }
    expect(await deletePerson(ada.id, secret)).toEqual({ status: "not_found" });
    const p = await getPerson(linus.id, secret);
    expect(p).toMatchObject({ firstName: "Secret", archived: false, version: 1 });
  });

  it("stays private when the creator is deactivated", async () => {
    await sql`update users set status = 'deactivated' where id = ${linus.id}`;
    await seesNothing(ada.id);
  });

  it("only the creator changes the private flag (FR-018, US5 scenario 3)", async () => {
    const shared = saved(await createPerson(linus.id, personForm({ firstName: "Shared", emails: emails("shared@example.com") })));
    await updatePerson(ada.id, shared, 1, personForm({ firstName: "Shared", private: true, emails: emails("shared@example.com"), ownerId: String(linus.id) }));
    expect((await getPerson(ada.id, shared))!.private).toBe(false);
    expect((await readTimeline(ada.id, { personId: shared })).map((e) => e.kind)).toEqual(["added"]);
    await updatePerson(linus.id, secret, 1, personForm({ firstName: "Secret", lastName: "Person", private: false, organisationId: String(org), ownerId: String(margaret.id), emails: emails("secret@example.com"), consent: "unsubscribed", leadSourceId: String(removedSource), labelIds: [String(secretLabel)] }));
    expect(await getPerson(ada.id, secret)).not.toBeNull();
    expect((await readTimeline(linus.id, { personId: secret }))[0]).toMatchObject({ kind: "edited", fields: ["Private"] });
  });
});
