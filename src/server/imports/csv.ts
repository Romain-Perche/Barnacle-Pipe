// Reading an uploaded CSV file (SF-103 research.md §1, §12). Pure: no database, no Next.js.
// UTF-8 only (a leading BOM is dropped), headings on the first row, values separated by commas, semicolons or tabs
// (found from the first line), double-quoted values as RFC 4180.

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
// Each upload request stays under Vercel's 4.5 MB and the server actions' 1 MB body limits (research.md §2).
export const PART_BYTES = 512 * 1024;

export type Delimiter = "," | ";" | "\t";
// `number` is the spreadsheet row: the heading row is 1, empty rows keep their number.
export type CsvRow = { number: number; values: string[] };
export type ReadResult =
  | { ok: true; headings: string[]; rows: CsvRow[] }
  | { ok: false; code: "import_not_csv" | "import_not_utf8" | "import_no_rows" | "import_too_many_rows" };

export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) counts[ch]++;
  }
  let best: Delimiter = ",";
  for (const d of [";", "\t"] as const) if (counts[d] > counts[best]) best = d;
  return best;
}

// One record per row; null when a quote is never closed.
export function parseCsv(text: string, delimiter: Delimiter): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(value);
    rows.push(row);
    row = [];
    value = "";
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else quoted = false;
      } else value += ch;
    } else if (ch === '"' && value === "") quoted = true;
    else if (ch === delimiter) {
      row.push(value);
      value = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else value += ch;
    i++;
  }
  if (quoted) return null;
  // A final line end adds no row.
  if (value !== "" || row.length > 0) endRow();
  return rows;
}

const isEmpty = (values: string[]) => values.every((v) => v.trim() === "");

export function readFile(bytes: Uint8Array): ReadResult {
  // An .xlsx file (a ZIP) or any binary file.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return { ok: false, code: "import_not_csv" };
  if (bytes.includes(0)) return { ok: false, code: "import_not_csv" };
  const text = decodeUtf8(bytes);
  if (text === null) return { ok: false, code: "import_not_utf8" };
  const records = parseCsv(text, detectDelimiter(text));
  if (records === null) return { ok: false, code: "import_not_csv" };
  if (records.length === 0) return { ok: false, code: "import_no_rows" };
  const headings = records[0].map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let n = 1; n < records.length; n++) {
    if (!isEmpty(records[n])) rows.push({ number: n + 1, values: records[n] });
  }
  if (rows.length === 0) return { ok: false, code: "import_no_rows" };
  if (rows.length > MAX_ROWS) return { ok: false, code: "import_too_many_rows" };
  return { ok: true, headings, rows };
}
