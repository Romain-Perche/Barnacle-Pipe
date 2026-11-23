// covers FR-010, FR-014, FR-019, US2 scenarios 2–4 (SF-103)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getImport, namesForReport, previewImport, runImport } from "@/server/imports/imports";
import { skipReason, warningText } from "@/server/imports/text";
import { templates } from "@/server/messages";
import { readTimeline } from "@/server/records/timeline";
import { makeOrganisation, makeUser, resetDb, type TestUser } from "./db-helpers";
import { fixture, uploaded } from "./import-helpers";

let ada: TestUser;
let fakeco: number;
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  const linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  fakeco = await makeOrganisation({ name: "Fakeco Ltd", ownerId: linus.id, sector: "Old sector" });
});
afterAll(closeDb);

describe("importing organisations-10.csv", () => {
  it("adds 9 organisations with their values, leaves the existing one as it is, reports it", async () => {
    const before = await sql`select * from organisations where id = ${fakeco}`;
    const id = await uploaded(ada.id, "organisations", fixture("organisations-10.csv"));
    const preview = await previewImport(ada.id, id);
    if (!("adds" in preview)) throw new Error();
    expect(preview).toMatchObject({ adds: 9, needsConsent: 0, newOrganisations: [] });
    expect(preview.sample.rows[0]).toEqual(["Imaginary Gyms Fake", "https://fakeco.example", "Fitness", "11–50", "London", "Ada Fake"]);

    expect(await runImport(ada.id, id, null)).toEqual({ status: "done" });
    const orgs = await sql<{ name: string; website: string | null; sector: string | null; size: string | null; location: string | null; owner_id: number; created_by: number }[]>`
      select name, website, sector, size, location, owner_id::int as owner_id, created_by::int as created_by from organisations where id <> ${fakeco} order by id`;
    expect(orgs.length).toBe(9);
    expect(orgs.slice(0, 4)).toEqual([
      { name: "Imaginary Gyms Fake", website: "https://fakeco.example", sector: "Fitness", size: "11–50", location: "London", owner_id: ada.id, created_by: ada.id },
      { name: "Notreal Studios Fake", website: "https://notreal.example", sector: "Media", size: "11–50", location: "Bristol", owner_id: ada.id, created_by: ada.id },
      { name: "Mock Climbing Fake", website: null, sector: "Fitness", size: "1,000+", location: "Leeds", owner_id: ada.id, created_by: ada.id },
      { name: "Pretend Pools Fake", website: "https://pretendpools.example", sector: "Leisure", size: null, location: "York", owner_id: ada.id, created_by: ada.id },
    ]);
    expect(orgs.map((o) => o.size)).toEqual(["11–50", "11–50", "1,000+", null, "51–200", "1,000+", null, "1–10", "201–1,000"]);
    expect(await sql`select * from organisations where id = ${fakeco}`).toEqual(before);

    const [{ n }] = await sql`select count(*)::int as n from timeline_events where kind = 'imported' and organisation_id is not null and actor_id = ${ada.id}`;
    expect(n).toBe(9);
    const [first] = await sql<{ id: number }[]>`select id::int as id from organisations where name = 'Imaginary Gyms Fake'`;
    expect((await readTimeline(ada.id, { organisationId: first.id })).entries.map((e) => [e.kind, e.actorName])).toEqual([["imported", "Ada Fake"]]);

    const report = (await getImport(ada.id, id))!.report!;
    expect(templates.import_summary_organisations(report.imported, report.skipped.length)).toBe("9 organisations imported. 1 row not imported.");
    const names = await namesForReport(ada.id, report.skipped);
    expect(report.skipped.map((s) => [s.row, s.label, skipReason(s, names)])).toEqual([
      [6, "FAKECO LTD", { text: "Fakeco Ltd already exists.", href: `/organisations/${fakeco}` }],
    ]);
    expect(report.warnings.map((w) => warningText(w).text)).toEqual(["Size not recognised: 'medium' (row 5)"]);
  });

  it("skips a name matching an archived organisation and a name on an earlier row", async () => {
    await makeOrganisation({ name: "Old Fakeco Archive", ownerId: ada.id, archived: true });
    const id = await uploaded(ada.id, "organisations", new TextEncoder().encode("Name\n old fakeco archive \nNew Fake\nNEW FAKE\n"));
    await runImport(ada.id, id, null);
    const report = (await getImport(ada.id, id))!.report!;
    expect(report.imported).toBe(1);
    expect(report.skipped.map((s) => [s.row, s.code])).toEqual([[2, "organisation_exists"], [4, "import_duplicate_in_file_org"]]);
  });
});
