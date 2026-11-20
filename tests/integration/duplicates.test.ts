// covers FR-004, SC-004, US1 scenario 5, US5 scenario 4, edge cases "archived person's address" and
// "address reusable after delete"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { archivePerson, createPerson, deletePerson, updatePerson } from "@/server/records/people";
import { count, makeUser, resetDb, type TestUser } from "./db-helpers";
import { emails, personForm, saved } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;
let first: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  first = saved(await createPerson(linus.id, personForm({ emails: emails("ada@example.com") })));
});
afterAll(closeDb);

const named = () => ({ code: "duplicate_email", name: "Ada Example", href: `/people/${first}` });

describe("duplicate email addresses", () => {
  it.each(["ADA@example.com", " ada@example.com ", "Ada@Example.COM"])("refuses %j, naming and linking the first person", async (address) => {
    const r = await createPerson(ada.id, personForm({ firstName: "Other", emails: emails("other@example.com", address) }));
    expect(r).toEqual({ status: "invalid", errors: { "emails.1": named() } });
    expect(await count("persons")).toBe(1);
  });

  it("refuses an archived person's address, still naming them", async () => {
    await archivePerson(linus.id, first);
    const r = await createPerson(ada.id, personForm({ emails: emails("ADA@example.com") }));
    expect(r).toEqual({ status: "invalid", errors: { "emails.0": named() } });
  });

  it("refuses a private person's address without naming them to anyone else", async () => {
    const secret = saved(await createPerson(linus.id, personForm({ firstName: "Secret", private: true, emails: emails("secret@example.com") })));
    const r = await createPerson(ada.id, personForm({ emails: emails("secret@example.com") }));
    expect(r).toEqual({ status: "invalid", errors: { "emails.0": { code: "duplicate_email_hidden" } } });
    expect(JSON.stringify(r)).not.toContain(String(`/people/${secret}`));
    // The creator still gets the name.
    const own = await createPerson(linus.id, personForm({ emails: emails("secret@example.com") }));
    expect(own).toMatchObject({ status: "invalid", errors: { "emails.0": { code: "duplicate_email", name: "Secret Example" } } });
  });

  it("refuses an edit that takes another person's address", async () => {
    const other = saved(await createPerson(ada.id, personForm({ firstName: "Bob", emails: emails("bob@example.com") })));
    const r = await updatePerson(ada.id, other, 1, personForm({ firstName: "Bob", emails: emails("bob@example.com", "ADA@EXAMPLE.COM") }));
    expect(r).toEqual({ status: "invalid", errors: { "emails.1": named() } });
    expect(await count("person_emails")).toBe(2);
  });

  it("lets a person keep their own address on edit", async () => {
    expect((await updatePerson(linus.id, first, 1, personForm({ emails: emails("ADA@example.com"), role: "COO" }))).status).toBe("saved");
  });

  it("saves exactly one of two people created at the same time with the same address", async () => {
    const results = await Promise.all(
      [1, 2].map(() => createPerson(ada.id, personForm({ firstName: "Race", emails: emails("race@example.com") }))),
    );
    expect(results.filter((r) => r.status === "saved")).toHaveLength(1);
    const refused = results.find((r) => r.status === "invalid");
    expect(refused).toMatchObject({ status: "invalid", errors: { "emails.0": { code: "duplicate_email", name: "Race Example" } } });
    expect(await count("persons")).toBe(2);
  });

  it("frees the address once the person is deleted", async () => {
    expect((await deletePerson(ada.id, first)).status).toBe("deleted");
    expect((await createPerson(ada.id, personForm({ emails: emails("ada@example.com") }))).status).toBe("saved");
  });
});

// covers FR-004, US1 scenario 5 (SF-92): the owner of a private person is named in the duplicate message
describe("a private person's address, seen by their owner", () => {
  it("names the person to the owner and hides them from anyone else", async () => {
    const margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
    const grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake" });
    const secret = saved(
      await createPerson(linus.id, personForm({ private: true, ownerId: String(margaret.id), emails: emails("private.ada@example.com") })),
    );
    expect(await createPerson(margaret.id, personForm({ firstName: "Copy", emails: emails("private.ada@example.com") }))).toEqual({
      status: "invalid",
      errors: { "emails.0": { code: "duplicate_email", name: "Ada Example", href: `/people/${secret}` } },
    });
    expect(await createPerson(grace.id, personForm({ firstName: "Copy", emails: emails("private.ada@example.com") }))).toEqual({
      status: "invalid",
      errors: { "emails.0": { code: "duplicate_email_hidden" } },
    });
  });
});
