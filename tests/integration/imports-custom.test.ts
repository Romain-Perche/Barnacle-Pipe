// covers FR-013, SC-007, US5 scenarios 1–5, spec Clarifications "an import adds no timeline entry per custom value"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deleteField } from "@/server/custom-fields/fields";
import { readCustomValues } from "@/server/custom-fields/values";
import { getColumns, getImport, previewImport, runImport, saveColumns } from "@/server/imports/imports";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeField } from "./custom-helpers";
import { uploaded, utf8 } from "./import-helpers";

let ada: TestUser;
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
});
afterAll(closeDb);

describe("people import with custom columns", () => {
  it("suggests, previews and imports 1,000 rows; lists unreadable values with their rows (SC-007, US5 scenarios 1–4)", async () => {
    const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["None", "Vegetarian", "Vegan"] });
    const born = await makeField({ kind: "person", name: "Birthday", type: "date" });
    const budget = await makeField({ kind: "person", name: "Budget", type: "money" });
    const lines = ["First name,Last name,Email,Diet,Birthday,Budget"];
    for (let i = 1; i <= 1000; i++) {
      const d = i === 7 ? "Pescatarian" : ["None", "vegetarian", "VEGAN"][i % 3];
      const b = i === 9 || i === 10 ? "someday" : "24/11/1990";
      lines.push(`Fake,Person ${i},p${i}@fakeco.example,${d},${b},"£4,000.50"`);
    }
    const id = await uploaded(ada.id, "people", utf8(lines.join("\n")));
    const columns = (await getColumns(ada.id, id))!;
    expect(columns.map((c) => c.field)).toEqual(["first_name", "last_name", "email", `custom:${diet.id}`, `custom:${born.id}`, `custom:${budget.id}`]);
    const preview = await previewImport(ada.id, id);
    if (!("sample" in preview)) throw new Error("no preview");
    expect(preview.sample.columns.slice(-3)).toEqual(["Diet", "Birthday", "Budget"]);
    expect(preview.sample.rows[0].slice(-3)).toEqual(["Vegetarian", "24 Nov 1990", "£4,000.50"]);
    expect(preview.warnings).toEqual([
      { code: "import_custom_unreadable", field: "Diet", value: "Pescatarian", rows: [8] },
      { code: "import_custom_unreadable", field: "Birthday", value: "someday", rows: [10, 11] },
    ]);
    expect(await runImport(ada.id, id, "subscribed")).toEqual({ status: "done" });
    const report = (await getImport(ada.id, id))!.report!;
    expect(report.imported).toBe(1000);
    expect(report.warnings).toHaveLength(2);
    const counts = await sql<{ field_id: number; n: number }[]>`select field_id::int as field_id, count(*)::int as n from custom_values group by field_id order by field_id`;
    expect(counts).toEqual([{ field_id: diet.id, n: 999 }, { field_id: born.id, n: 998 }, { field_id: budget.id, n: 1000 }]);
    const [p1] = await sql<{ id: number }[]>`select id::int as id from persons where last_name = 'Person 3'`;
    expect((await readCustomValues(sql, ada.id, { personId: p1.id })).map((d) => d.text)).toEqual(["None", "24 Nov 1990", "£4,000.50"]);
    // Only the "imported" entry on each imported person.
    const kinds = await sql`select distinct kind from timeline_events where person_id is not null`;
    expect(kinds.map((k) => k.kind)).toEqual(["imported"]);
  });

  it("ignores a field deleted between preview and import and says so in the report (US5 scenario 5)", async () => {
    const diet = await makeField({ kind: "person", name: "Diet", type: "text" });
    const nick = await makeField({ kind: "person", name: "Nick", type: "text" });
    const id = await uploaded(ada.id, "people", utf8("First name,Diet,Nick\nAda,Vegan,Addy\n"));
    expect(await saveColumns(ada.id, id, new Map([[0, { field: "first_name", kind: "work" }], [1, { field: `custom:${diet.id}`, kind: "work" }], [2, { field: `custom:${nick.id}`, kind: "work" }]]))).toEqual({ ok: true });
    await previewImport(ada.id, id);
    await deleteField(ada.id, diet.id);
    expect(await runImport(ada.id, id, "subscribed")).toEqual({ status: "done" });
    expect((await getImport(ada.id, id))!.report).toMatchObject({ imported: 1, goneFields: ["Diet"] });
    expect(await sql`select field_id::int as field_id, text_value from custom_values`).toEqual([{ field_id: nick.id, text_value: "Addy" }]);
  });

  it("refuses a row with text over its limit, with the too long reason", async () => {
    const nick = await makeField({ kind: "person", name: "Nick", type: "text" });
    const id = await uploaded(ada.id, "people", utf8(`First name,Nick\nAda,${"x".repeat(256)}\nGrace,ok\n`));
    expect((await getColumns(ada.id, id))!.map((c) => c.field)).toEqual(["first_name", `custom:${nick.id}`]);
    await runImport(ada.id, id, "subscribed");
    expect((await getImport(ada.id, id))!.report).toMatchObject({ imported: 1, skipped: [{ row: 2, code: "import_too_long", args: { field: "Nick", max: 255 } }] });
  });
});

describe("organisations import with custom columns", () => {
  it("imports every readable value of three custom columns (SC-007)", async () => {
    const code = await makeField({ kind: "organisation", name: "Account code", type: "text" });
    const budget = await makeField({ kind: "organisation", name: "Annual budget", type: "money" });
    const nda = await makeField({ kind: "organisation", name: "NDA", type: "yes_no" });
    const lines = ["Name,Account code,Annual budget,NDA"];
    for (let i = 1; i <= 1000; i++) lines.push(`Fake Org ${i},AC-${i},${i === 5 ? "lots" : String(i * 10)},${i % 2 === 0 ? "y" : "no"}`);
    const id = await uploaded(ada.id, "organisations", utf8(lines.join("\n")));
    const preview = await previewImport(ada.id, id);
    if (!("warnings" in preview)) throw new Error("no preview");
    expect(preview.warnings).toEqual([{ code: "import_custom_unreadable", field: "Annual budget", value: "lots", rows: [6] }]);
    expect(await runImport(ada.id, id, null)).toEqual({ status: "done" });
    const counts = await sql<{ field_id: number; n: number }[]>`select field_id::int as field_id, count(*)::int as n from custom_values group by field_id order by field_id`;
    expect(counts).toEqual([{ field_id: code.id, n: 1000 }, { field_id: budget.id, n: 999 }, { field_id: nda.id, n: 1000 }]);
    const kinds = await sql`select distinct kind from timeline_events`;
    expect(kinds.map((k) => k.kind)).toEqual(["imported"]);
  });
});
