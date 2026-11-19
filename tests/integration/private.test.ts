// covers FR-018, FR-019, FR-028, SC-005, US5 scenarios 1–4, edge case "private person's creator deactivated",
// clarification "organisation events about a private person"; SF-92: covers FR-001, FR-002, FR-003, SC-001,
// US1 scenarios 1–4 and 6 (the owner of a private person sees them; nobody else does, admins included)
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
let margaret: TestUser; // the owner (B)
let grace: TestUser; // another user (C), neither creator nor owner
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
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake" });
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

async function seesEverything(viewerId: number) {
  const queries = [
    { q: "secret" },
    { q: "secret@example.com" },
    { q: "fakeco" },
    { owner: String(margaret.id) },
    { label: String(secretLabel) },
    { source: String(removedSource) },
    { org: String(org) },
    { consent: "unsubscribed" },
  ];
  for (const q of queries) {
    const r = await listPeople(viewerId, parsePeopleQuery(q));
    expect(r.rows.map((x) => x.id), JSON.stringify(q)).toEqual([secret]);
    expect(r.total, JSON.stringify(q)).toBe(1);
  }
  const options = await peopleFilterOptions(viewerId, null);
  expect(options.labels.map((l) => l.id)).toContain(secretLabel);
  expect(options.sources.map((s) => s.id)).toContain(removedSource);
  expect(options.organisations.map((o) => o.id)).toContain(org);
  expect(options.owners.map((o) => o.id)).toContain(margaret.id);
  expect((await getPerson(viewerId, secret))!.private).toBe(true);
  expect((await peopleOf(viewerId, org)).map((p) => p.id)).toEqual([secret]);
  expect((await getOrganisation(viewerId, org))!.peopleCount).toBe(1);
  const orgs = await listOrganisations(viewerId, parseOrganisationsQuery({}));
  expect(orgs.rows.find((o) => o.id === org)!.people).toBe(1);
  expect((await readTimeline(viewerId, { organisationId: org }))[0]).toMatchObject({ kind: "person_linked", relatedPerson: { id: secret } });
  expect((await readTimeline(viewerId, { personId: secret })).map((e) => e.kind)).toEqual(["added"]);
}

describe("a private person", () => {
  it("is seen everywhere, marked private, by their creator and their owner (US5 scenario 1, SF-92 US1 scenario 1, FR-001)", async () => {
    await seesEverything(linus.id);
    await seesEverything(margaret.id);
  });

  it("is invisible to any other user and to an admin who is neither (US5 scenario 2, SC-005, SF-92 US1 scenario 2, SC-001)", async () => {
    await seesNothing(grace.id);
    await seesNothing(ada.id);
  });

  it("cannot be changed by anyone else: edit, archive, restore and delete answer not found (FR-019)", async () => {
    for (const actor of [grace.id, ada.id]) {
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

  it("someone neither creator nor owner cannot change the private flag (FR-018, US5 scenario 3, SF-92 FR-002)", async () => {
    const shared = saved(await createPerson(linus.id, personForm({ firstName: "Shared", emails: emails("shared@example.com") })));
    await updatePerson(ada.id, shared, 1, personForm({ firstName: "Shared", private: true, emails: emails("shared@example.com"), ownerId: String(linus.id) }));
    expect((await getPerson(ada.id, shared))!.private).toBe(false);
    expect((await readTimeline(ada.id, { personId: shared })).map((e) => e.kind)).toEqual(["added"]);
    await updatePerson(linus.id, secret, 1, personForm({ firstName: "Secret", lastName: "Person", private: false, organisationId: String(org), ownerId: String(margaret.id), emails: emails("secret@example.com"), consent: "unsubscribed", leadSourceId: String(removedSource), labelIds: [String(secretLabel)] }));
    expect(await getPerson(ada.id, secret)).not.toBeNull();
    expect((await readTimeline(linus.id, { personId: secret }))[0]).toMatchObject({ kind: "edited", fields: ["Private"] });
  });
});

// covers FR-002, FR-003, US1 scenarios 3, 4, 6 (SF-92)
describe("the owner of a private person", () => {
  const form = (over: Parameters<typeof personForm>[0] = {}) =>
    personForm({
      firstName: "Secret",
      lastName: "Person",
      private: true,
      organisationId: String(org),
      ownerId: String(margaret.id),
      emails: emails("secret@example.com"),
      consent: "unsubscribed",
      leadSourceId: String(removedSource),
      labelIds: [String(secretLabel)],
      ...over,
    });

  it("edits the person; the timeline names the owner and the field (US1 scenario 3)", async () => {
    expect(await updatePerson(margaret.id, secret, 1, form({ role: "COO" }))).toEqual({ status: "saved", id: secret });
    expect((await getPerson(margaret.id, secret))!.role).toBe("COO");
    expect((await readTimeline(margaret.id, { personId: secret }))[0]).toMatchObject({ kind: "edited", actorName: "Margaret Fake", fields: ["Role"] });
  });

  it("makes the person shared: the whole team sees them (US1 scenario 4)", async () => {
    expect(await updatePerson(margaret.id, secret, 1, form({ private: false }))).toEqual({ status: "saved", id: secret });
    expect((await getPerson(grace.id, secret))!.private).toBe(false);
    expect((await readTimeline(grace.id, { personId: secret }))[0]).toMatchObject({ kind: "edited", fields: ["Private"] });
  });

  it("makes a shared person they own private (FR-002)", async () => {
    const shared = saved(await createPerson(linus.id, personForm({ firstName: "Shared", ownerId: String(margaret.id) })));
    await updatePerson(margaret.id, shared, 1, personForm({ firstName: "Shared", ownerId: String(margaret.id), private: true }));
    expect((await getPerson(margaret.id, shared))!.private).toBe(true);
    expect(await getPerson(grace.id, shared)).toBeNull();
  });

  it("gives the person to someone else and can no longer see them (US1 scenario 6, FR-003)", async () => {
    expect(await updatePerson(margaret.id, secret, 1, form({ ownerId: String(grace.id) }))).toEqual({
      status: "saved",
      id: secret,
      visible: false,
      name: "Secret Person",
    });
    expect(await getPerson(margaret.id, secret)).toBeNull();
    expect((await getPerson(linus.id, secret))!.owner.id).toBe(grace.id);
    expect((await getPerson(grace.id, secret))!.owner.id).toBe(grace.id);
  });

  it("the creator changing the owner still sees the person", async () => {
    expect(await updatePerson(linus.id, secret, 1, form({ ownerId: String(grace.id) }))).toEqual({ status: "saved", id: secret });
  });
});
