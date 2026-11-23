// covers FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-011, US1 scenarios 1, 3 and 4,
// edge cases "owner deactivated" and "removed lead source / label kept"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { createPerson, getPerson, personFormChoices, updatePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { count, leadSourceId, makeLabel, makeUser, resetDb, type TestUser } from "./db-helpers";
import { emails, personForm, saved } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;
let alan: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
});
afterAll(closeDb);

describe("createPerson", () => {
  it("saves every field; owner defaults to the user, consent Subscribed, date added set, never contacted", async () => {
    const hot = await makeLabel("Hot");
    const referral = await leadSourceId("Referral");
    const id = saved(
      await createPerson(
        ada.id,
        personForm({
          emails: [
            { value: " Ada@Example.COM ", kind: "work" },
            { value: "ada.home@example.net", kind: "personal" },
          ],
          phones: [{ value: " +44 20 7946 0000 ", kind: "work" }],
          role: "COO",
          leadSourceId: String(referral),
          linkedin: "linkedin.com/in/ada-example",
          labelIds: [String(hot)],
        }),
      ),
    );
    const p = await getPerson(ada.id, id);
    expect(p).toMatchObject({
      firstName: "Ada",
      lastName: "Example",
      name: "Ada Example",
      emails: [
        { email: "ada@example.com", kind: "work" },
        { email: "ada.home@example.net", kind: "personal" },
      ],
      phones: [{ phone: "+44 20 7946 0000", kind: "work" }],
      role: "COO",
      leadSource: { id: referral, name: "Referral" },
      linkedin: "https://linkedin.com/in/ada-example",
      owner: { id: ada.id, name: "Ada Fake", active: true },
      labels: [{ id: hot, name: "Hot" }],
      consent: "subscribed",
      private: false,
      archived: false,
      organisation: null,
      lastContactedAt: null,
      createdBy: ada.id,
      version: 1,
    });
    expect(Math.abs(p!.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
    const events = (await readTimeline(ada.id, { personId: id })).entries;
    expect(events).toMatchObject([{ kind: "added", actorName: "Ada Fake" }]);
  });

  it("refuses invalid fields and saves nothing (US1 scenario 4)", async () => {
    const r = await createPerson(ada.id, personForm({ firstName: "", lastName: " ", emails: emails("nope"), linkedin: "https://example.com/ada" }));
    expect(r).toEqual({
      status: "invalid",
      errors: { name: { code: "name_required" }, "emails.0": { code: "email_invalid" }, linkedin: { code: "linkedin_invalid" } },
    });
    expect(await count("persons")).toBe(0);
  });

  it("refuses a deactivated or unknown owner and uses the user instead", async () => {
    const a = saved(await createPerson(linus.id, personForm({ ownerId: String(alan.id), emails: emails("a@example.com") })));
    expect((await getPerson(linus.id, a))!.owner.id).toBe(linus.id);
    const b = saved(await createPerson(linus.id, personForm({ ownerId: "999", emails: emails("b@example.com") })));
    expect((await getPerson(linus.id, b))!.owner.id).toBe(linus.id);
    const c = saved(await createPerson(linus.id, personForm({ ownerId: String(ada.id), emails: emails("c@example.com") })));
    expect((await getPerson(linus.id, c))!.owner.id).toBe(ada.id);
  });

  it("ignores removed lead sources and labels for a new person", async () => {
    await sql`update lead_sources set removed_at = now() where name = 'Inbound'`;
    const removedLabel = await makeLabel("Old", true);
    const id = saved(
      await createPerson(ada.id, personForm({ leadSourceId: String(await leadSourceId("Inbound")), labelIds: [String(removedLabel)] })),
    );
    const p = await getPerson(ada.id, id);
    expect(p!.leadSource).toBeNull();
    expect(p!.labels).toEqual([]);
  });
});

describe("updatePerson", () => {
  async function adaExample() {
    return saved(
      await createPerson(
        ada.id,
        personForm({
          role: "COO",
          emails: [
            { value: "ada@example.com", kind: "work" },
            { value: "ada.home@example.net", kind: "personal" },
          ],
          phones: [{ value: "+44 20 7946 0000", kind: "work" }],
        }),
      ),
    );
  }

  it("replaces emails and phones and records one edit naming Role, Email addresses, Phone numbers (US1 scenario 3)", async () => {
    const id = await adaExample();
    const r = await updatePerson(
      linus.id,
      id,
      1,
      personForm({
        role: "CEO",
        emails: [{ value: "ada@example.com", kind: "work" }],
        phones: [
          { value: "+44 20 7946 0000", kind: "work" },
          { value: "07700 900000", kind: "personal" },
        ],
      }),
    );
    expect(r).toEqual({ status: "saved", id });
    const p = await getPerson(ada.id, id);
    expect(p!.role).toBe("CEO");
    expect(p!.emails).toEqual([{ email: "ada@example.com", kind: "work" }]);
    expect(p!.phones.map((x) => x.phone)).toEqual(["+44 20 7946 0000", "07700 900000"]);
    expect(p!.version).toBe(2);
    expect(await count("person_emails")).toBe(1);
    const events = (await readTimeline(ada.id, { personId: id })).entries;
    expect(events[0]).toMatchObject({ kind: "edited", actorName: "Linus Fake", fields: ["Role", "Email addresses", "Phone numbers"] });
    expect(events).toHaveLength(2);
  });

  it("records nothing when nothing changed (but still saves)", async () => {
    const id = await adaExample();
    const same = personForm({
      role: "COO",
      ownerId: String(ada.id),
      emails: [
        { value: "ada@example.com", kind: "work" },
        { value: "ada.home@example.net", kind: "personal" },
      ],
      phones: [{ value: "+44 20 7946 0000", kind: "work" }],
    });
    expect((await updatePerson(ada.id, id, 1, same)).status).toBe("saved");
    expect((await readTimeline(ada.id, { personId: id })).entries).toHaveLength(1);
  });

  it("records a consent change as Consent (FR-006)", async () => {
    const id = saved(await createPerson(ada.id, personForm()));
    await updatePerson(linus.id, id, 1, personForm({ ownerId: String(ada.id), consent: "unsubscribed" }));
    const [last] = (await readTimeline(ada.id, { personId: id })).entries;
    expect(last).toMatchObject({ kind: "edited", actorName: "Linus Fake", fields: ["Consent"] });
    expect((await getPerson(ada.id, id))!.consent).toBe("unsubscribed");
  });

  it("keeps a current deactivated owner; never takes a deactivated one as a new owner", async () => {
    const id = saved(await createPerson(ada.id, personForm({ ownerId: String(linus.id) })));
    await sql`update users set status = 'deactivated' where id = ${linus.id}`;
    await updatePerson(ada.id, id, 1, personForm({ ownerId: String(linus.id), role: "CFO" }));
    expect((await getPerson(ada.id, id))!.owner).toEqual({ id: linus.id, name: "Linus Fake", active: false });
    await updatePerson(ada.id, id, 2, personForm({ ownerId: String(alan.id) }));
    expect((await getPerson(ada.id, id))!.owner.id).toBe(linus.id);
  });

  it("keeps a removed lead source and label the person already has", async () => {
    const old = await makeLabel("Old");
    const inbound = await leadSourceId("Inbound");
    const id = saved(await createPerson(ada.id, personForm({ leadSourceId: String(inbound), labelIds: [String(old)] })));
    await sql`update lead_sources set removed_at = now() where id = ${inbound}`;
    await sql`update labels set removed_at = now() where id = ${old}`;
    await updatePerson(ada.id, id, 1, personForm({ leadSourceId: String(inbound), labelIds: [String(old)], role: "CTO" }));
    const p = await getPerson(ada.id, id);
    expect(p!.leadSource).toEqual({ id: inbound, name: "Inbound" });
    expect(p!.labels).toEqual([{ id: old, name: "Old" }]);
  });

  it("offers active users, non-removed choices plus the person's own, and non-archived organisations", async () => {
    const old = await makeLabel("Old");
    const hot = await makeLabel("Hot");
    const id = saved(await createPerson(ada.id, personForm({ labelIds: [String(old)], ownerId: String(linus.id) })));
    await sql`update labels set removed_at = now() where id = ${old}`;
    await sql`update users set status = 'deactivated' where id = ${linus.id}`;
    const fresh = await personFormChoices(ada.id, null);
    expect(fresh.labels.map((l) => l.name)).toEqual(["Hot"]);
    expect(fresh.owners.map((o) => o.name)).toEqual(["Ada Fake"]);
    expect(fresh.leadSources.map((l) => l.name)).toEqual(["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Event", "Ambassador"]);
    const p = await getPerson(ada.id, id);
    const editing = await personFormChoices(ada.id, p);
    expect(editing.labels.map((l) => l.id).sort()).toEqual([old, hot].sort());
    expect(editing.owners).toContainEqual({ id: linus.id, name: "Linus Fake (deactivated)" });
  });
});
