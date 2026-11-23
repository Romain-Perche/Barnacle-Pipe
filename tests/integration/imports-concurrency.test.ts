// covers FR-016, US1 edge case "another user adds a person with the same email between the preview and [ IMPORT ]",
// edge case "[ IMPORT ] twice quickly" (SF-103 research.md §8)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getImport, previewImport, runImport } from "@/server/imports/imports";
import { createPerson } from "@/server/records/people";
import { count, makeUser, resetDb, type TestUser } from "./db-helpers";
import { fixture, uploaded } from "./import-helpers";
import { emails, personForm } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

async function lockHeld(): Promise<boolean> {
  const rows = await sql`
    select 1 from pg_locks l join pg_class c on c.oid = l.relation
    where c.relname = 'person_emails' and l.mode = 'ShareRowExclusiveLock' and l.granted`;
  return rows.length > 0;
}

describe("concurrent changes", () => {
  it("reports a row whose email another user added after the preview (the report, not the preview, says so)", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    const preview = await previewImport(ada.id, id);
    if (!("adds" in preview)) throw new Error();
    expect(preview.adds).toBe(19);
    expect((await createPerson(linus.id, personForm({ firstName: "Gina", lastName: "Other", emails: emails("gina.importfake@fakeco.example") }))).status).toBe("saved");
    expect(await runImport(ada.id, id, "subscribed")).toEqual({ status: "done" });
    const report = (await getImport(ada.id, id))!.report!;
    expect(report.imported).toBe(18);
    expect(report.skipped.find((s) => s.row === 8)).toMatchObject({ code: "import_duplicate_email" });
  });

  it("makes a person added during the import wait, then refuses the duplicate address without a crash", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    // Slow the import down once it holds its locks: one second per timeline insert statement.
    await sql.unsafe(`create or replace function crm_test_slow() returns trigger language plpgsql as $$
      begin perform pg_sleep(1); return null; end $$`);
    await sql.unsafe(`create trigger crm_test_slow before insert on timeline_events for each statement execute function crm_test_slow()`);
    try {
      const importing = runImport(ada.id, id, "subscribed");
      for (let i = 0; i < 100 && !(await lockHeld()); i++) await new Promise((r) => setTimeout(r, 20));
      expect(await lockHeld()).toBe(true);
      const adding = await createPerson(linus.id, personForm({ firstName: "Tara", lastName: "Other", emails: emails("tara.importfake@fakeco.example") }));
      expect(await importing).toEqual({ status: "done" });
      expect(adding).toEqual({
        status: "invalid",
        errors: { "emails.0": expect.objectContaining({ code: "duplicate_email", name: "Tara Importfake" }) },
      });
    } finally {
      await sql.unsafe(`drop trigger crm_test_slow on timeline_events`);
      await sql.unsafe(`drop function crm_test_slow()`);
    }
    const [{ n }] = await sql`select count(*)::int as n from person_emails where email = 'tara.importfake@fakeco.example'`;
    expect(n).toBe(1);
  });

  it("adds the people once when [ IMPORT ] is sent twice at the same time", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    const results = await Promise.all([runImport(ada.id, id, "subscribed"), runImport(ada.id, id, "subscribed")]);
    expect(results).toEqual([{ status: "done" }, { status: "done" }]);
    expect(await count("persons")).toBe(19);
  });
});
