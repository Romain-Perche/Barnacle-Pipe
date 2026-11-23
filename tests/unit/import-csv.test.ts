// covers FR-003, edge cases "not a CSV file", "not valid UTF-8", "commas, semicolons or tabs", "quoted values",
// "more/fewer values", "completely empty rows" (SF-103 research.md §1, §12)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeUtf8, detectDelimiter, MAX_ROWS, parseCsv, readFile } from "@/server/imports/csv";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/csv/${name}`));
const bytes = (text: string) => new TextEncoder().encode(text);

function ok(result: ReturnType<typeof readFile>) {
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
}

describe("decodeUtf8", () => {
  it("drops a leading byte order mark", () => {
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
  });
  it("returns null for Windows-1252 bytes ('Zoë' saved by older Excel)", () => {
    expect(decodeUtf8(new Uint8Array([0x5a, 0x6f, 0xeb]))).toBeNull();
    expect(decodeUtf8(fixture("people-cp1252.csv"))).toBeNull();
  });
});

describe("detectDelimiter", () => {
  it("picks the most frequent of , ; tab on the first line, outside quotes", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"a,b,c";d;e')).toBe(";");
  });
  it("breaks ties in the order , ; tab and answers , for one column", () => {
    expect(detectDelimiter("a,b;c")).toBe(",");
    expect(detectDelimiter("a;b\tc")).toBe(";");
    expect(detectDelimiter("Name")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("keeps quoted commas, semicolons, doubled quotes and line breaks as one value", () => {
    expect(parseCsv('a,"x, y; z","say ""hi""","line\nbreak"\n', ",")).toEqual([["a", "x, y; z", 'say "hi"', "line\nbreak"]]);
  });
  it("accepts \\r\\n, \\n and \\r line ends and adds no row for a final line end", () => {
    const want = [["a", "b"], ["1", "2"], ["3", "4"], ["5", "6"]];
    expect(parseCsv("a,b\r\n1,2\n3,4\r5,6\r\n", ",")).toEqual(want);
    expect(parseCsv("a,b\n1,2", ",")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("gives one record per spreadsheet row: a quoted line break stays in its row, an empty line is a row", () => {
    expect(parseCsv('h1,h2\n"two\nlines",x\n\n,\nlast,y\n', ",")).toEqual([["h1", "h2"], ["two\nlines", "x"], [""], ["", ""], ["last", "y"]]);
  });
  it("reports an unclosed quote at the end", () => {
    expect(parseCsv('a,"b\n1,2', ",")).toBeNull();
  });
});

describe("readFile", () => {
  it("refuses an .xlsx file, a NUL byte, Windows-1252 bytes and an unclosed quote", () => {
    expect(readFile(fixture("not-csv.xlsx"))).toEqual({ ok: false, code: "import_not_csv" });
    expect(readFile(bytes("a,b\n1,\u00002"))).toEqual({ ok: false, code: "import_not_csv" });
    expect(readFile(fixture("people-cp1252.csv"))).toEqual({ ok: false, code: "import_not_utf8" });
    expect(readFile(bytes('a,b\n1,"2\n'))).toEqual({ ok: false, code: "import_not_csv" });
  });
  it("refuses an empty file and a headings-only file", () => {
    expect(readFile(fixture("empty.csv"))).toEqual({ ok: false, code: "import_no_rows" });
    expect(readFile(fixture("headings-only.csv"))).toEqual({ ok: false, code: "import_no_rows" });
    expect(readFile(bytes("a,b\n\n,\n"))).toEqual({ ok: false, code: "import_no_rows" });
  });
  it("accepts 5,000 data rows and refuses 5,001", () => {
    const file = (n: number) => bytes(`Name\n${Array.from({ length: n }, (_, i) => `Org ${i}`).join("\n")}\n`);
    expect(ok(readFile(file(MAX_ROWS))).rows.length).toBe(5000);
    expect(readFile(file(MAX_ROWS + 1))).toEqual({ ok: false, code: "import_too_many_rows" });
  });
  it("reads the same headings and rows from the comma, semicolon and tab files", () => {
    const comma = ok(readFile(fixture("people-20.csv")));
    expect(comma.headings).toEqual(["First name", "Last name", "Email", "Phone", "Organisation", "Job title", "Lead source", "Labels"]);
    expect(comma.rows.length).toBe(20);
    expect(comma.rows[0]).toEqual({
      number: 2,
      values: ["Ada", "Importfake", "ada.importfake@fakeco.example", "+44 20 7946 0001", "fakeco ltd", "COO", "referral", "Hot"],
    });
    expect(ok(readFile(fixture("people-semicolon.csv")))).toEqual(comma);
    expect(ok(readFile(fixture("people-tab.csv")))).toEqual(comma);
  });
  it("keeps the BOM out of the first heading and reads Zoë and £", () => {
    const file = ok(readFile(fixture("people-bom.csv")));
    expect(file.headings[0]).toBe("First name");
    expect(file.rows[0].values[0]).toBe("Zoë");
    expect(file.rows[0].values[5]).toBe("£ budget holder");
  });
  it("skips empty rows but keeps their numbers", () => {
    const file = ok(readFile(bytes("Name,Email\nA,a@x.example\n,\n\nB,b@x.example\n")));
    expect(file.rows.map((r) => r.number)).toEqual([2, 5]);
  });
  it("reads quoted values as one value each", () => {
    const file = ok(readFile(fixture("people-quoted.csv")));
    expect(file.rows[0].values[5]).toBe("Ops, events; travel");
    expect(file.rows[1].values[5]).toBe('The "fixer"\nand planner');
    expect(file.rows[1].number).toBe(3);
  });
});
