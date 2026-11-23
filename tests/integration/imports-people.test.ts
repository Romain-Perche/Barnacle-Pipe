// covers FR-006 to FR-011, FR-015, FR-016, FR-017, FR-018, FR-019, SC-003, SC-005, SC-006, SC-007, US1 scenarios 3–7,
// edge cases "quoted values", "a value with spaces", "the import fails part-way", "[ IMPORT ] twice" (SF-103)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getImport, namesForReport, previewImport, runImport, saveColumns } from "@/server/imports/imports";
import { skipReason } from "@/server/imports/text";
import { getPerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { count, leadSourceId, makeLabel, makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { fixture, uploaded, utf8 } from "./import-helpers";

let ada: TestUser;
let linus: TestUser;
let fakeco: number;
let hot: number;
let investor: number;
let dupOne: number;
let dupTwo: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  fakeco = await makeOrganisation({ name: "Fakeco Ltd", ownerId: linus.id });
  hot = await makeLabel("Hot");
  investor = await makeLabel("Investor");
  // Already in the CRM: one the importer can see, one private person of another user.
  dupOne = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: linus.id, emails: ["dup.one@fakeco.example"], role: "Keep me" });
  dupTwo = await makePerson({ firstName: "Secret", lastName: "Fake", createdBy: linus.id, private: true, emails: ["dup.two@fakeco.example"] });
});
afterAll(closeDb);

const personByEmail = async (email: string) => {
  const [r] = await sql<{ id: number }[]>`select person_id::int as id from person_emails where email = ${email}`;
  return r?.id;
};

describe("importing people-20.csv", () => {
  it("previews 17 people, 2 new organisations, 3 rows not imported, 17 needing consent", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    const p = await previewImport(ada.id, id);
    if (!("adds" in p)) throw new Error(JSON.stringify(p));
    expect(p.adds).toBe(17);
    expect(p.newOrganisations).toEqual(["Imaginary Rowing Fake", "Notreal Pilates Fake"]);
    expect(p.skipped.map((s) => [s.row, s.label, skipReason(s, p.names).text])).toEqual([
      [4, "Cleo Dupefake", "Ada Example already has this email address."],
      [9, "Ivy Badmailfake", "Enter a valid email address."],
      [15, "Olga Dupefake", "Another person already has this email address."],
    ]);
    expect(p.needsConsent).toBe(17);
    expect(p.withoutEmail).toBe(0);
    expect(p.sample.rows.length).toBe(5);
    expect(p.sample.rows[0]).toEqual(["Ada Importfake", "ada.importfake@fakeco.example", "+44 20 7946 0001", "Fakeco Ltd", "COO", "Referral", "Hot", "Ada Fake", "—"]);
    // Nothing is added by a preview (edge case "leaves after [ PREVIEW ]").
    expect(await count("persons")).toBe(2);
  });

  it("refuses the import until a consent is chosen, adding nothing", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    expect(await runImport(ada.id, id, null)).toEqual({ status: "consent_required" });
    expect(await runImport(ada.id, id, "maybe")).toEqual({ status: "consent_required" });
    expect(await count("persons")).toBe(2);
    expect((await getImport(ada.id, id))?.status).toBe("ready");
  });

  it("adds 17 people with every value, links or adds organisations, records the events and the report", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    const before = await sql`select * from persons order by id`;
    expect(await runImport(ada.id, id, "unsubscribed")).toEqual({ status: "done" });
    expect(await count("persons")).toBe(19);

    const brian = (await getPerson(ada.id, (await personByEmail("brian.importfake@fakeco.example"))!))!;
    expect(brian).toMatchObject({
      firstName: "Brian",
      lastName: "Importfake",
      emails: [{ email: "brian.importfake@fakeco.example", kind: "work" }],
      phones: [{ phone: "+44 20 7946 0002", kind: "work" }],
      organisation: { id: fakeco, name: "Fakeco Ltd", archived: false },
      role: "Head of Ops",
      leadSource: { id: await leadSourceId("Exec dinner"), name: "Exec dinner" },
      labels: [{ id: hot, name: "Hot" }, { id: investor, name: "Investor" }],
      owner: { id: ada.id },
      consent: "unsubscribed",
      private: false,
      createdBy: ada.id,
      lastContactedAt: null,
      archived: false,
    });
    const [{ imported_at }] = await sql`select imported_at from csv_imports where id = ${id}`;
    expect(brian.createdAt.getTime()).toBeLessThanOrEqual(imported_at.getTime());
    expect(Date.now() - brian.createdAt.getTime()).toBeLessThan(60_000);

    // "fakeco ltd" linked the existing one; the new names were added once, owned by the importer.
    const ada2 = (await getPerson(ada.id, (await personByEmail("ada.importfake@fakeco.example"))!))!;
    expect(ada2.organisation?.id).toBe(fakeco);
    const orgs = await sql<{ id: number; name: string; owner_id: number; created_by: number }[]>`
      select id::int as id, name, owner_id::int as owner_id, created_by::int as created_by from organisations where id <> ${fakeco} order by id`;
    expect(orgs.map((o) => [o.name, o.owner_id, o.created_by])).toEqual([
      ["Imaginary Rowing Fake", ada.id, ada.id],
      ["Notreal Pilates Fake", ada.id, ada.id],
    ]);
    const [{ n: rowing }] = await sql`select count(*)::int as n from persons where organisation_id = ${orgs[0].id}`;
    expect(rowing).toBe(3);

    // Timeline: "imported" on each person and new organisation, "person_linked" on the organisation per linked person.
    const events = await sql<{ kind: string; n: number }[]>`select kind, count(*)::int as n from timeline_events group by kind order by kind`;
    expect(events).toEqual([{ kind: "imported", n: 19 }, { kind: "person_linked", n: 11 }]);
    const brianLine = await readTimeline(ada.id, { personId: brian.id });
    expect(brianLine.entries.map((e) => [e.kind, e.actorName])).toEqual([["imported", "Ada Fake"]]);
    const fakecoLine = await readTimeline(ada.id, { organisationId: fakeco });
    expect(fakecoLine.entries.filter((e) => e.kind === "person_linked").map((e) => e.relatedPerson?.name)).toContain("Brian Importfake");

    // The existing people are left as they are.
    expect(await sql`select * from persons where id in (${dupOne}, ${dupTwo}) order by id`).toEqual(before);
    expect(await personByEmail("dup.one@fakeco.example")).toBe(dupOne);
    expect(await personByEmail("dup.two@fakeco.example")).toBe(dupTwo);

    // The file is gone, the report kept.
    const info = await getImport(ada.id, id);
    expect(info?.status).toBe("done");
    expect(info?.report).toMatchObject({ imported: 17, organisationsAdded: 2, organisationsAddedNames: ["Imaginary Rowing Fake", "Notreal Pilates Fake"] });
    expect(info?.report?.skipped.map((s) => [s.row, s.code])).toEqual([[4, "import_duplicate_email"], [9, "email_invalid"], [15, "import_duplicate_email"]]);
    const [{ content }] = await sql`select content from csv_imports where id = ${id}`;
    expect(content).toBeNull();
  });

  it("names a duplicate only when the importer can see them (SC-007)", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    await runImport(ada.id, id, "subscribed");
    const report = (await getImport(ada.id, id))!.report!;
    const names = await namesForReport(ada.id, report.skipped);
    expect(report.skipped.map((s) => skipReason(s, names))).toEqual([
      { text: "Ada Example already has this email address.", href: `/people/${dupOne}` },
      { text: "Enter a valid email address." },
      { text: "Another person already has this email address." },
    ]);
    expect(JSON.stringify(report)).not.toContain("Secret");
    // Linus, the private person's creator, would see the name.
    expect((await namesForReport(linus.id, report.skipped)).people.get(dupTwo)).toBe("Secret Fake");
  });

  it("adds nothing more on a second [ IMPORT ] (FR-016, SC-006)", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    expect(await runImport(ada.id, id, "subscribed")).toEqual({ status: "done" });
    const people = await count("persons");
    const events = await count("timeline_events");
    expect(await runImport(ada.id, id, "subscribed")).toEqual({ status: "done" });
    expect(await count("persons")).toBe(people);
    expect(await count("timeline_events")).toBe(events);
  });

  it("leaves nothing from the file when the import fails part-way, and the import stays ready (FR-016, SC-006)", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    // The database refuses the timeline insert, after the people, emails and organisations went in.
    await sql.unsafe(`create or replace function crm_test_fail() returns trigger language plpgsql as $$
      begin if new.kind = 'imported' then raise exception 'forced failure'; end if; return new; end $$`);
    await sql.unsafe(`create trigger crm_test_fail before insert on timeline_events for each row execute function crm_test_fail()`);
    try {
      await expect(runImport(ada.id, id, "subscribed")).rejects.toThrow(/forced failure/);
    } finally {
      await sql.unsafe(`drop trigger crm_test_fail on timeline_events`);
      await sql.unsafe(`drop function crm_test_fail()`);
    }
    expect(await count("persons")).toBe(2);
    expect(await count("organisations")).toBe(1);
    expect(await count("person_emails")).toBe(2);
    expect(await count("timeline_events")).toBe(0);
    expect((await getImport(ada.id, id))?.status).toBe("ready");
    // Trying again works.
    expect(await runImport(ada.id, id, "subscribed")).toEqual({ status: "done" });
    expect(await count("persons")).toBe(19);
  });

  it("imports with the column choices: a column set to Don't import is left out (US1 scenario 3, FR-023)", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    const fields = ["first_name", "last_name", "email", "phone", "organisation", "skip", "lead_source", "labels"];
    expect(await saveColumns(ada.id, id, new Map(fields.map((field, i) => [i, { field, kind: "personal" }])))).toEqual({ ok: true });
    const p = await previewImport(ada.id, id);
    if (!("adds" in p)) throw new Error();
    expect(p.sample.rows.every((r) => r[4] === "—")).toBe(true);
    await runImport(ada.id, id, "subscribed");
    const [{ n }] = await sql`select count(*)::int as n from persons where role is not null`;
    expect(n).toBe(1);
    const [{ kinds }] = await sql`select array_agg(distinct kind) as kinds from person_emails where email like '%importfake%'`;
    expect(kinds).toEqual(["personal"]);
  });

  it("refuses a second single-value column and a mapping with no name column", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    const choose = (fields: string[]) => saveColumns(ada.id, id, new Map(fields.map((field, i) => [i, { field, kind: "work" }])));
    expect(await choose(["first_name", "last_name", "email", "phone", "organisation", "role", "lead_source", "lead_source"])).toEqual({
      error: { code: "import_one_column", field: "lead_source" },
    });
    expect(await choose(["skip", "skip", "email", "phone", "organisation", "role", "lead_source", "labels"])).toEqual({ error: { code: "import_person_name_column" } });
    expect((await getImport(ada.id, id))?.mapping?.columns[7].field).toBe("labels");
  });
});

describe("values as typed", () => {
  it("keeps quoted commas, semicolons, quotes and line breaks, Zoë and £, formulas and markup as text", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-quoted.csv"));
    await runImport(ada.id, id, "subscribed");
    const roles = await sql<{ role: string }[]>`select role from persons where last_name = 'Quotefake' order by id`;
    expect(roles.map((r) => r.role)).toEqual(["Ops, events; travel", 'The "fixer"\nand planner']);

    const bom = await uploaded(ada.id, "people", fixture("people-bom.csv"));
    await runImport(ada.id, bom, "subscribed");
    const [zoe] = await sql`select first_name, role from persons where last_name = 'Accentfake' order by id limit 1`;
    expect(zoe).toEqual({ first_name: "Zoë", role: "£ budget holder" });

    const tricky = utf8(
      'First name,Last name,Job title,Email\n<a href="https://evil.example">Click</a>,Fake,=SUM(A1:A2),\n  Trim  ,Fake,  COO  ,\nBrace,Fake,"{a,""b""}\\ x",\n@admin,Fake,@admin,\n',
    );
    const t = await uploaded(ada.id, "people", tricky);
    await runImport(ada.id, t, "subscribed");
    const rows = await sql<{ first_name: string; role: string }[]>`select first_name, role from persons where last_name = 'Fake' and created_by = ${ada.id} order by id`;
    expect(rows).toEqual([
      { first_name: '<a href="https://evil.example">Click</a>', role: "=SUM(A1:A2)" },
      { first_name: "Trim", role: "COO" },
      { first_name: "Brace", role: '{a,"b"}\\ x' },
      { first_name: "@admin", role: "@admin" },
    ]);
  });

  it("imports a row with no email even when a person with the same name exists, and counts it", async () => {
    await makePerson({ firstName: "Same", lastName: "Name", createdBy: ada.id });
    const id = await uploaded(ada.id, "people", utf8("Name,Email\nSame Name,\n"));
    const p = await previewImport(ada.id, id);
    if (!("adds" in p)) throw new Error();
    expect(p.withoutEmail).toBe(1);
    await runImport(ada.id, id, "subscribed");
    const [{ n }] = await sql`select count(*)::int as n from persons where first_name = 'Same' and last_name = 'Name'`;
    expect(n).toBe(2);
  });
});
