// covers SF-117 US2 scenarios 1–16, FR-004, FR-005, FR-007–FR-016, FR-019, FR-025, FR-026, SC-008: the spec's small
// account (30 people, 10 organisations) imported start to finish through runPart: every value, the links to the
// existing person and organisation (unchanged), the timeline entries and the report lines.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getImportView, startImport } from "@/server/pipedrive/imports";
import { namesForReport, reportLines, warningLines, itemText } from "@/server/pipedrive/report";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makeField } from "./custom-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb } from "./db-helpers";
import { COMPANY, connect, LINUS_TOKEN, runToEnd, smallAccount, start } from "./pipedrive-helpers";

let linus: { id: number }, margaret: { id: number };
let fake: ReturnType<typeof installFakePipedrive>;
let account: ReturnType<typeof smallAccount>;
let existingPersonId: number, existingOrgId: number, budgetId: number, hotId: number, referralId: number;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  account = smallAccount(fake);
  await connect(linus.id, LINUS_TOKEN);
  [{ id: hotId }] = await sql<{ id: number }[]>`insert into labels (name) values ('Hot') returning id::int as id`;
  [{ id: referralId }] = await sql<{ id: number }[]>`select id::int as id from lead_sources where name = 'Referral'`;
  budgetId = (await makeField({ kind: "person", name: "Budget", type: "number" })).id;
  existingOrgId = await makeOrganisation({ name: "Fakeco Ltd", ownerId: margaret.id, archived: true, sector: "Shipping" });
  existingPersonId = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: margaret.id, emails: ["ada.example@fake.example"], role: "Old role" });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const linkOf = async (kind: "person" | "organisation", pipedriveId: number) =>
  (await sql<{ person_id: number | null; organisation_id: number | null; how: string }[]>`
    select person_id::int as person_id, organisation_id::int as organisation_id, how from pipedrive_links
    where company_id = ${COMPANY} and kind = ${kind} and pipedrive_id = ${pipedriveId}`)[0];
const personRow = async (id: number) =>
  (await sql<Record<string, unknown>[]>`select * from persons where id = ${id}`)[0];

async function importAll(o: { people?: boolean; organisations?: boolean } = {}) {
  const id = await start(linus.id, { ...o, consent: "unsubscribed" });
  await runToEnd(linus.id, id);
  return id;
}

describe("starting (US2-1, US2-7, FR-004, FR-005)", () => {
  it("refuses nothing ticked, and People without a consent choice; starts nothing", async () => {
    expect(await startImport(linus.id, { people: false, organisations: false, consent: "subscribed" })).toEqual({ error: "pipedrive_tick_something" });
    expect(await startImport(linus.id, { people: true, organisations: true, consent: null })).toEqual({ error: "pipedrive_consent_required" });
    expect(await startImport(linus.id, { people: true, organisations: false, consent: "maybe" })).toEqual({ error: "pipedrive_consent_required" });
    expect(await startImport(margaret.id, { people: false, organisations: true, consent: null })).toEqual({ error: "pipedrive_not_connected" });
    expect(await sql`select 1 from pipedrive_imports`).toHaveLength(0);
    // Organisations only needs no consent.
    expect(await startImport(linus.id, { people: false, organisations: true, consent: null })).toMatchObject({ existing: false });
  });
});

describe("a complete import of the small account", () => {
  it("imports every value of a person (US2-2, 3, 5, 6, 8, 11; FR-007, FR-009, FR-010, FR-016; SC-008)", async () => {
    await importAll();
    const link = await linkOf("person", account.person.full);
    expect(link.how).toBe("imported");
    const p = await personRow(link.person_id!);
    const org = await linkOf("organisation", account.org.sample);
    expect(p).toMatchObject({
      first_name: "Grace", last_name: "Fulldata", role: "Fake CTO", linkedin_url: "https://www.linkedin.com/in/grace-fake", consent: "subscribed",
      private: false, organisation_id: String(org.organisation_id), lead_source_id: String(referralId), owner_id: String(margaret.id), created_by: String(linus.id),
    });
    expect((p.created_at as Date).toISOString()).toBe("2024-05-06T07:08:09.000Z");
    expect(p.last_contacted_at).toBeNull();
    const emails = await sql`select email, kind from person_emails where person_id = ${link.person_id} order by position`;
    expect(emails.map((e) => [e.email, e.kind])).toEqual([["grace@fake.example", "work"], ["home.grace@fake.example", "personal"]]);
    const phones = await sql`select phone, kind from person_phones where person_id = ${link.person_id} order by position`;
    expect(phones.map((e) => [e.phone, e.kind])).toEqual([["020 7946 0001", "work"], ["07700 900001", "personal"], ["01632 960001", "personal"]]);
    const labels = await sql`select label_id::int as id from person_labels where person_id = ${link.person_id}`;
    expect(labels.map((l) => l.id)).toEqual([hotId]);
    const values = await sql`select field_id::int as f, number_value::text as n from custom_values where person_id = ${link.person_id}`;
    expect(values.map((v) => [v.f, v.n])).toEqual([[budgetId, "1500.0000"]]);
    expect(await sql`select 1 from timeline_events where kind like 'custom_%'`).toHaveLength(0);
  });

  it("imports an organisation's address, website, industry and size band, with warnings for what it left out (US2-10, FR-008)", async () => {
    const id = await importAll();
    const o = (await sql`select * from organisations where id = ${(await linkOf("organisation", account.org.sample)).organisation_id}`)[0];
    expect(o).toMatchObject({ name: "Sample Studios Fake", location: "1 Fake Street, London", website: "https://samplestudios.example", sector: "Software", size: "11–50", owner_id: String(margaret.id), created_by: String(linus.id) });
    const zero = await linkOf("organisation", account.org.badSize);
    expect(zero.how).toBe("imported");
    const view = (await getImportView(linus.id))!;
    expect(view.id).toBe(id);
    const names = await namesForReport(linus.id, view.report);
    expect(warningLines(view.report, names)).toContainEqual({ kind: "organisation", label: "Zero Staff Fake", text: "Number of employees '0' is not valid: left out." });
  });

  it("takes consent from Pipedrive, else the user's choice (US2-7, FR-014)", async () => {
    await importAll();
    const consent = async (pd: number) => (await personRow((await linkOf("person", pd)).person_id!)).consent;
    expect(await consent(account.person.unsubscribed)).toBe("unsubscribed");
    expect(await consent(account.person.full)).toBe("subscribed");
    expect(await consent(account.person.webinar)).toBe("unsubscribed");
  });

  it("splits a full name, refuses a person with no name, leaves an invalid email out (US2-3, edge cases)", async () => {
    await importAll();
    const full = await personRow((await linkOf("person", account.person.fullName)).person_id!);
    expect([full.first_name, full.last_name]).toEqual(["Ada", "May Example"]);
    expect(await linkOf("person", account.person.noName)).toBeUndefined();
    const bea = (await linkOf("person", account.person.badEmail)).person_id!;
    expect((await sql`select email from person_emails where person_id = ${bea}`).map((e) => e.email)).toEqual(["bea@fake.example"]);
  });

  it("links the matching person and organisation, leaves them exactly as they were, with no new entry (US2-13, US2-15, SC-005)", async () => {
    const before = { p: await personRow(existingPersonId), o: (await sql`select * from organisations where id = ${existingOrgId}`)[0] };
    await importAll();
    expect(await linkOf("person", account.person.existing)).toEqual({ person_id: existingPersonId, organisation_id: null, how: "linked" });
    expect(await linkOf("organisation", account.org.fakeco)).toEqual({ person_id: null, organisation_id: existingOrgId, how: "linked" });
    expect(await personRow(existingPersonId)).toEqual(before.p);
    expect((await sql`select * from organisations where id = ${existingOrgId}`)[0]).toEqual(before.o);
    expect(await sql`select 1 from timeline_events where person_id = ${existingPersonId}`).toHaveLength(0);
    expect(await sql`select 1 from timeline_events where organisation_id = ${existingOrgId} and kind <> 'person_linked'`).toHaveLength(0);
    // A person of that Pipedrive organisation is linked to the existing (archived) CRM organisation.
    const una = await personRow((await linkOf("person", account.person.unsubscribed)).person_id!);
    expect(una.organisation_id).toBe(String(existingOrgId));
  });

  it("adds one Pipedrive-imported entry per imported record, and person_linked on organisations (FR-026)", async () => {
    await importAll();
    const [{ people }] = await sql`select count(*)::int as people from pipedrive_links where kind = 'person' and how = 'imported'`;
    const [{ orgs }] = await sql`select count(*)::int as orgs from pipedrive_links where kind = 'organisation' and how = 'imported'`;
    const events = await sql`select kind, person_id, organisation_id, actor_id::int as actor from timeline_events where kind = 'pipedrive_imported'`;
    expect(events.filter((e) => e.person_id !== null)).toHaveLength(people);
    expect(events.filter((e) => e.organisation_id !== null)).toHaveLength(orgs);
    expect(events.every((e) => e.actor === linus.id)).toBe(true);
    const grace = (await linkOf("person", account.person.full)).person_id!;
    const sample = (await linkOf("organisation", account.org.sample)).organisation_id!;
    expect(await sql`select 1 from timeline_events where kind = 'person_linked' and organisation_id = ${sample} and related_person_id = ${grace}`).toHaveLength(1);
    expect(await sql`select 1 from timeline_events where kind in ('added', 'imported')`).toHaveLength(0);
  });

  it("counts what it did: 30 people and 10 organisations read (US2-16, FR-025)", async () => {
    await importAll();
    const view = (await getImportView(linus.id))!;
    expect(view.state).toBe("finished");
    expect(view.progress).toEqual([{ kind: "organisations", done: 10, total: 10 }, { kind: "people", done: 30, total: 30 }]);
    // People: 1 linked, 2 not imported (no name, the second "dup@"), 27 imported. Organisations: 1 linked, 9 imported.
    expect(view.counts).toEqual({
      organisations: { imported: 9, linked: 1, already: 0, notImported: 0 },
      people: { imported: 27, linked: 1, already: 0, notImported: 2 },
      // SF-122: the kinds not ticked stay at zero.
      deals: { imported: 0, linked: 0, already: 0, notImported: 0 },
      notes: { imported: 0, linked: 0, already: 0, notImported: 0 },
      activities: { imported: 0, linked: 0, already: 0, notImported: 0 },
      files: { imported: 0, linked: 0, already: 0, notImported: 0 },
    });
    expect(view.totals).toEqual({ imported: 36, linked: 2, notImported: 2, already: 0 });
  });

  it("writes the report lines (US2-5, 6, 8, 12, 13, 16; FR-010, FR-011, FR-016)", async () => {
    await importAll();
    const view = (await getImportView(linus.id))!;
    const names = await namesForReport(linus.id, view.report);
    const lines = reportLines(view.report, names).map((l) => l.text);
    expect(lines).toContain("Lead source not on the list: 'Webinar' (4 people)");
    expect(lines).toContain("Label not on the list: 'Cold' (5 people)");
    expect(lines).toContain("No CRM field named 'Favourite colour'.");
    expect(lines).toContain("'Region' is an address field in Pipedrive: not imported.");
    expect(lines).toContain("Owner 'Jane Fake' (jane@fake.example) has no CRM user: 3 records given to you.");
    expect(lines).toContain("1 owner-only organisation imported as shared.");
    // The existing person is Margaret's and shared: Linus can see them, so they are named.
    expect(lines).toContain("Ada Example was already in the CRM: linked, not changed.");
    expect(lines).toContain("Fakeco Ltd was already in the CRM: linked, not changed.");
    expect(lines.filter((l) => l.includes("Job title") || l.includes("Lead source") && l.includes("No CRM"))).toEqual([]);
    const notImported = view.report.notImported.map((n) => [n.kind, n.label, itemText(n, names)]);
    expect(notImported).toEqual([
      ["person", "Dan Secondfake", "Another Pipedrive person, 'Dot Firstfake', has the same email address."],
      ["person", "noname@fake.example", "No name."],
    ]);
    expect(warningLines(view.report, names)).toContainEqual({ kind: "person", label: "Bea Bademail", text: "Email address 'bea@' is not valid: left out." });
    expect(warningLines(view.report, names)).toContainEqual({ kind: "organisation", label: "FAKECO LTD", text: "Fakeco Ltd is archived." });
  });

  it("names a linked person only when the importer can see them (US2-13, FR-019)", async () => {
    await sql`update persons set private = true where id = ${existingPersonId}`;
    await importAll();
    const view = (await getImportView(linus.id))!;
    const lines = reportLines(view.report, await namesForReport(linus.id, view.report)).map((l) => l.text);
    expect(lines).toContain("A person already in the CRM has this email address: linked, not changed.");
    expect(lines.join("\n")).not.toContain("Ada Example was");
  });
});

describe("only People ticked (US2-4, FR-012)", () => {
  it("imports or links the organisation of each imported person with all its fields, and no other organisation", async () => {
    await importAll({ people: true, organisations: false });
    const sample = await linkOf("organisation", account.org.sample);
    expect(sample.how).toBe("imported");
    expect((await sql`select sector, size from organisations where id = ${sample.organisation_id}`)[0]).toEqual({ sector: "Software", size: "11–50" });
    expect((await linkOf("organisation", account.org.fakeco)).organisation_id).toBe(existingOrgId);
    // Owner-only and zero-staff organisations have no person: not imported.
    expect(await linkOf("organisation", account.org.ownerOnly)).toBeUndefined();
    expect(await linkOf("organisation", account.org.badSize)).toBeUndefined();
    const view = (await getImportView(linus.id))!;
    expect(view.progress.map((p) => p.kind)).toEqual(["people"]);
    expect(view.counts.organisations.imported).toBe(7);
    expect(view.counts.organisations.linked).toBe(1);
  });
});

// The "// COUNTS" table of step 3 REPORT, as rendered: one row per kind, its cells taken from view.counts.
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { ReportStep } = await import("@/app/(app)/settings/pipedrive-import/ReportStep");

async function reportRows() {
  const view = (await getImportView(linus.id))!;
  const html = renderToStaticMarkup(createElement(ReportStep, { view, names: await namesForReport(linus.id, view.report) }));
  const table = html.match(/<section aria-label="Counts per kind">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const rows = [...table.matchAll(/<tr><th scope="row">([^<]+)<\/th>((?:<td>[^<]*<\/td>)+)<\/tr>/g)].map((m) => [
    m[1],
    ...[...m[2].matchAll(/<td>([^<]*)<\/td>/g)].map((c) => c[1]),
  ]);
  return { view, html: table, rows };
}
const cells = (c: { imported: number; linked: number; already: number; notImported: number }) =>
  [c.imported, c.linked, c.already, c.notImported].map(String);

describe("the report's counts per kind (FR-025, US2 scenario 16)", () => {
  // covers FR-025, US2 scenario 16
  it("shows people and organisations imported, linked, already imported and not imported", async () => {
    await importAll();
    let r = await reportRows();
    expect(r.html).toContain(`<span class="c">//</span> COUNTS`);
    expect(r.html).toContain("Imported</th><th>Linked</th><th>Already imported</th><th>Not imported");
    expect(r.rows).toEqual([
      ["People", ...cells(r.view.counts.people)],
      ["Organisations", ...cells(r.view.counts.organisations)],
    ]);
    expect(r.rows).toEqual([
      ["People", "27", "1", "0", "2"],
      ["Organisations", "9", "1", "0", "0"],
    ]);
    // Run again: every record saved the first time now counts as already imported.
    await importAll();
    r = await reportRows();
    expect(r.rows).toEqual([
      ["People", ...cells(r.view.counts.people)],
      ["Organisations", ...cells(r.view.counts.organisations)],
    ]);
    expect(r.rows).toEqual([
      ["People", "0", "0", "28", "2"],
      ["Organisations", "0", "0", "10", "0"],
    ]);
  });

  // covers FR-025, FR-012: only People ticked still shows the organisations they brought; nothing ticked has no row
  it("has a row for a kind not ticked only when it has counts", async () => {
    await importAll({ people: true, organisations: false });
    expect((await reportRows()).rows).toEqual([
      ["People", "27", "1", "0", "2"],
      ["Organisations", "7", "1", "0", "0"],
    ]);
    await importAll({ people: false, organisations: true });
    expect((await reportRows()).rows.map((row) => row[0])).toEqual(["Organisations"]);
  });
});
