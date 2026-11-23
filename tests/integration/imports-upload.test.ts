// covers FR-003, FR-017, FR-020, edge cases "not a CSV file", "not valid UTF-8", "larger than 5 MB", "more than 5,000 rows"
// (SF-103 research.md §2, §3)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { MAX_BYTES, PART_BYTES } from "@/server/imports/csv";
import { finishUpload, getColumns, getImport, previewImport, purgeImports, runImport, saveColumns, startImport, uploadPart } from "@/server/imports/imports";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { fixture, upload, uploaded, utf8 } from "./import-helpers";

let ada: TestUser;
let linus: TestUser;
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

const imports = async () => (await sql<{ id: number; user_id: number; status: string }[]>`
  select id::int as id, user_id::int as user_id, status from csv_imports order by id`).map((r) => ({ ...r }));

describe("startImport", () => {
  it("refuses a file larger than 5 MB and an empty file, adding nothing", async () => {
    expect(await startImport(ada.id, "people", "big.csv", MAX_BYTES + 1)).toEqual({ error: "import_too_large" });
    expect(await startImport(ada.id, "people", "empty.csv", 0)).toEqual({ error: "import_no_rows" });
    expect(await imports()).toEqual([]);
  });
});

describe("uploadPart", () => {
  it("appends parts of 512 KiB in order", async () => {
    const bytes = utf8(`Name\n${`Fakeco Org ${"x".repeat(300)}\n`.repeat(2_000)}`);
    expect(bytes.length).toBeGreaterThan(PART_BYTES);
    const id = await uploaded(ada.id, "organisations", bytes);
    const [row] = await sql`select parts_received, row_count, status from csv_imports where id = ${id}`;
    expect(row).toEqual({ parts_received: 2, row_count: 2_000, status: "ready" });
  });

  it("refuses a part out of order, over the declared size, another user's upload or a ready import", async () => {
    const out = await startImport(ada.id, "people", "a.csv", 10);
    if ("error" in out) throw new Error();
    expect(await uploadPart(ada.id, out.id, 1, utf8("abc"))).toEqual({ error: "import_upload_failed" });
    expect(await getImport(ada.id, out.id)).toBeNull();

    const over = await startImport(ada.id, "people", "a.csv", 3);
    if ("error" in over) throw new Error();
    expect(await uploadPart(ada.id, over.id, 0, utf8("abcd"))).toEqual({ error: "import_upload_failed" });
    expect(await getImport(ada.id, over.id)).toBeNull();

    const other = await startImport(ada.id, "people", "a.csv", 3);
    if ("error" in other) throw new Error();
    expect(await uploadPart(linus.id, other.id, 0, utf8("abc"))).toEqual({ error: "import_upload_failed" });
    expect(await getImport(ada.id, other.id)).not.toBeNull();

    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    expect(await uploadPart(ada.id, id, 1, utf8("x"))).toEqual({ error: "import_upload_failed" });
    expect(await getImport(ada.id, id)).toBeNull();
  });

  // covers T041: a file of 5 MB + 1 byte is refused at the start and by the parts' total check
  it("refuses more than 5 MB in total", async () => {
    const out = await startImport(ada.id, "people", "a.csv", MAX_BYTES);
    if ("error" in out) throw new Error();
    const part = new Uint8Array(PART_BYTES).fill(0x41);
    for (let i = 0; i < MAX_BYTES / PART_BYTES; i++) expect(await uploadPart(ada.id, out.id, i, part)).toEqual({ ok: true });
    expect(await uploadPart(ada.id, out.id, MAX_BYTES / PART_BYTES, utf8("x"))).toEqual({ error: "import_upload_failed" });
    expect(await imports()).toEqual([]);
  });
});

describe("finishUpload", () => {
  it("refuses Windows-1252, .xlsx, empty, headings-only and 5,001-row files with the fixed codes and deletes them", async () => {
    expect((await upload(ada.id, "people", fixture("people-cp1252.csv"))).error).toBe("import_not_utf8");
    expect((await upload(ada.id, "people", fixture("not-csv.xlsx"))).error).toBe("import_not_csv");
    expect((await upload(ada.id, "people", fixture("headings-only.csv"))).error).toBe("import_no_rows");
    expect((await upload(ada.id, "people", fixture("empty.csv"))).error).toBe("import_no_rows");
    const big = utf8(`Name\n${Array.from({ length: 5001 }, (_, i) => `Org ${i}`).join("\n")}`);
    expect((await upload(ada.id, "organisations", big)).error).toBe("import_too_many_rows");
    expect(await imports()).toEqual([]);
  });

  it("refuses an upload that is not complete", async () => {
    const out = await startImport(ada.id, "people", "a.csv", 10);
    if ("error" in out) throw new Error();
    await uploadPart(ada.id, out.id, 0, utf8("Name\n"));
    expect(await finishUpload(ada.id, out.id)).toEqual({ error: "import_upload_failed" });
    expect(await imports()).toEqual([]);
  });

  it("makes people-20.csv ready with 20 rows and the suggested columns", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"), "exec-dinner-guests.csv");
    const info = await getImport(ada.id, id);
    expect(info).toMatchObject({ kind: "people", fileName: "exec-dinner-guests.csv", status: "ready", rowCount: 20 });
    expect(info?.mapping?.columns.map((c) => c.field)).toEqual(["first_name", "last_name", "email", "phone", "organisation", "role", "lead_source", "labels"]);
    const columns = await getColumns(ada.id, id);
    expect(columns?.[0]).toEqual({ index: 0, heading: "First name", samples: ["Ada", "Brian"], field: "first_name", kind: "work" });
  });
});

describe("purgeImports and ownership", () => {
  it("deletes the user's other unfinished imports and any import older than 24 hours, keeps other users' recent ones", async () => {
    const a1 = await uploaded(ada.id, "people", fixture("people-20.csv"));
    const l2 = await uploaded(linus.id, "organisations", fixture("organisations-10.csv"));
    await sql`update csv_imports set status = 'done', content = null, report = '{}', imported_at = now(), created_at = now() - interval '25 hours' where id = ${l2}`;
    // Linus's done import is older than 24 hours: his next start deletes it.
    const l1 = await uploaded(linus.id, "people", fixture("people-20.csv"));
    expect((await imports()).map((r) => r.id)).toEqual([a1, l1]);
    const a2 = await uploaded(ada.id, "organisations", fixture("organisations-10.csv"));
    expect((await imports()).map((r) => r.id)).toEqual([l1, a2]);
    expect(a1).not.toBe(a2);
    await sql`update csv_imports set created_at = now() - interval '25 hours' where id = ${l1}`;
    const grace = await makeUser({ email: "grace@barnacle.ai" });
    await purgeImports(sql, grace.id);
    expect((await imports()).map((r) => r.id)).toEqual([a2]);
  });

  it("does not find another user's import anywhere", async () => {
    const id = await uploaded(ada.id, "people", fixture("people-20.csv"));
    expect(await getImport(linus.id, id)).toBeNull();
    expect(await getColumns(linus.id, id)).toBeNull();
    expect(await saveColumns(linus.id, id, new Map())).toEqual({ status: "not_found" });
    expect(await previewImport(linus.id, id)).toEqual({ status: "not_found" });
    expect(await runImport(linus.id, id, "subscribed")).toEqual({ status: "not_found" });
    expect(await getImport(ada.id, id)).toMatchObject({ status: "ready" });
  });
});
