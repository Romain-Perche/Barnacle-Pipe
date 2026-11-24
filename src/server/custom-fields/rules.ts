// Pure rules for custom fields (SF-115, contracts/routes.md § Domain functions, data-model.md § Custom value).
// No database, no Next.js: unit-tested directly.
import { parseDate, parseMoney } from "@/server/deals/rules";
import { formatMoney } from "@/server/format";
import type { FieldErrors } from "@/server/records/rules";

export const CUSTOM_TYPES = ["text", "long_text", "number", "money", "date", "single_choice", "multiple_choice", "yes_no"] as const;
export type CustomType = (typeof CUSTOM_TYPES)[number];
export const TYPE_LABELS: Record<CustomType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  money: "Money (£)",
  date: "Date",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  yes_no: "Yes/No",
};
export const CHOICE_TYPES: readonly CustomType[] = ["single_choice", "multiple_choice"];
export const SORTABLE_TYPES: readonly CustomType[] = ["text", "number", "money", "date", "single_choice", "yes_no"];

export type RecordKind = "person" | "organisation" | "deal";
export const RECORD_KINDS: readonly RecordKind[] = ["person", "organisation", "deal"];
export type KindTab = "people" | "organisations" | "deals";
export const KIND_OF_TAB: Record<KindTab, RecordKind> = { people: "person", organisations: "organisation", deals: "deal" };
export const TAB_OF_KIND: Record<RecordKind, KindTab> = { person: "people", organisation: "organisations", deal: "deals" };
// "ADD PERSON FIELD" / "Show in the People list".
export const KIND_WORD: Record<RecordKind, string> = { person: "person", organisation: "organisation", deal: "deal" };
export const LIST_WORD: Record<RecordKind, string> = { person: "People", organisation: "Organisations", deal: "Deals" };

export const MAX_FIELDS = 50;
export const MAX_CHOICES = 100;
export const MAX_IN_LIST = 8;
export const MAX_NAME = 60;
export const MAX_TEXT = 255;
export const MAX_LONG_TEXT = 10_000;

// Built-in field names of each kind, lower case (data-model.md § Custom field): a custom field cannot take them.
export const BUILT_IN_NAMES: Record<RecordKind, readonly string[]> = {
  person: ["first name", "last name", "name", "full name", "email", "email address", "email addresses", "phone", "phone number", "phone numbers",
    "organisation", "role", "lead source", "linkedin", "owner", "labels", "consent", "email consent", "private", "ambassador", "referred by",
    "last contacted", "added", "date added"],
  organisation: ["name", "website", "sector", "size", "location", "owner", "people", "added", "date added"],
  deal: ["title", "value", "organisation", "person", "main person", "other people", "labels", "owner", "expected close date", "private",
    "pipeline", "stage", "status", "referred by", "followers", "lost reason", "added", "date added"],
};

export type CustomChoice = { id: number; name: string; position: number; removed: boolean };
export type CustomField = { id: number; kind: RecordKind; name: string; type: CustomType; position: number; inList: boolean; choices: CustomChoice[] };
// text / long text / date (YYYY-MM-DD) / number (canonical text, never a float): string; money (pence) and single choice: number;
// multiple choice: choice ids in choice order; yes/no: boolean; no value: null.
export type CustomValue = string | number | boolean | number[] | null;
export type CustomValues = Record<number, CustomValue>;

export const isChoiceType = (type: CustomType) => CHOICE_TYPES.includes(type);
export const isCustomType = (v: unknown): v is CustomType => typeof v === "string" && (CUSTOM_TYPES as readonly string[]).includes(v);

const key = (name: string) => name.trim().toLowerCase();
export const valueKey = (fieldId: number) => `cf.${fieldId}`;

// ---------------------------------------------------------------- fields and choices (admin)

export type FieldFormInput = { name: string; type: string; choices: string; inList: boolean };
export type FieldFormValue = { name: string; type: CustomType; choices: string[]; inList: boolean };

export function validateFieldName(kind: RecordKind, raw: string): { ok: true; name: string } | { ok: false; error: { code: string; name?: string } } {
  const name = (raw ?? "").trim();
  if (name === "") return { ok: false, error: { code: "custom_field_name_required" } };
  if ([...name].length > MAX_NAME) return { ok: false, error: { code: "custom_field_name_too_long" } };
  if (BUILT_IN_NAMES[kind].includes(key(name))) return { ok: false, error: { code: "custom_field_exists", name } };
  return { ok: true, name };
}

export function validateChoiceName(raw: string): { ok: true; name: string } | { ok: false; code: "custom_choice_name_required" | "custom_choice_name_too_long" } {
  const name = (raw ?? "").trim();
  if (name === "") return { ok: false, code: "custom_choice_name_required" };
  if ([...name].length > MAX_NAME) return { ok: false, code: "custom_choice_name_too_long" };
  return { ok: true, name };
}

// The add form: name, type, choices one per line (only for the two choice types), "Show in list".
export function validateFieldForm(kind: RecordKind, form: FieldFormInput): { ok: true; value: FieldFormValue } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = validateFieldName(kind, form.name);
  if (!name.ok) errors.name = name.error;
  const type = isCustomType(form.type) ? form.type : null;
  if (!type) errors.type = { code: "custom_field_type_required" };
  const choices: string[] = [];
  if (type && isChoiceType(type)) {
    const lines = (form.choices ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
    if (lines.length === 0) errors.choices = { code: "custom_choices_required" };
    else if (lines.length > MAX_CHOICES) errors.choices = { code: "custom_choices_limit" };
    else if (lines.some((l) => [...l].length > MAX_NAME)) errors.choices = { code: "custom_choice_name_too_long" };
    else if (new Set(lines.map(key)).size !== lines.length) errors.choices = { code: "custom_choice_twice" };
    else choices.push(...lines);
  }
  if (Object.keys(errors).length > 0 || !name.ok || !type) return { ok: false, errors };
  return { ok: true, value: { name: name.name, type, choices, inList: form.inList === true } };
}

// ---------------------------------------------------------------- numbers and days

const NUMBER = /^(-?)(\d+)(?:\.(\d+))?$/;
const LIMIT = 1_000_000_000_000n;

// "1,234.5" → "1234.5"; at most 4 decimals; |n| ≤ 1,000,000,000,000 (compared as BigInt, never through a float).
export function parseNumber(raw: string): { ok: true; value: string | null } | { ok: false; code: "custom_number_invalid" | "custom_number_decimals" | "custom_number_range" } {
  const text = (raw ?? "").replace(/[\s,]/g, "");
  if (text === "") return { ok: true, value: null };
  const m = NUMBER.exec(text);
  if (!m) return { ok: false, code: "custom_number_invalid" };
  const frac = (m[3] ?? "").replace(/0+$/, "");
  if (frac.length > 4) return { ok: false, code: "custom_number_decimals" };
  const whole = BigInt(m[2]);
  if (whole > LIMIT || (whole === LIMIT && frac !== "")) return { ok: false, code: "custom_number_range" };
  const negative = m[1] === "-" && (whole !== 0n || frac !== "");
  return { ok: true, value: `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}` };
}

// The canonical text of a number as Postgres returns it ("1234.5000" → "1234.5").
export function canonicalNumber(text: string): string {
  const parsed = parseNumber(text);
  return parsed.ok && parsed.value !== null ? parsed.value : text;
}

// "1234.5000" → "1,234.5", "0.0000" → "0", "-12.0000" → "-12".
export function formatNumber(text: string): string {
  const m = NUMBER.exec(canonicalNumber(text));
  if (!m) return text;
  const whole = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${m[1]}${whole}${m[3] ? `.${m[3]}` : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-24" → "24 Nov 2026", read from the text (no time zone).
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// ---------------------------------------------------------------- values on records

const sameValue = (a: CustomValue, b: CustomValue) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

const has = (v: CustomValue | undefined): v is Exclude<CustomValue, null> => v !== null && v !== undefined;

// The choices a record may keep: offered ones, plus removed ones it already has.
function allowedChoice(field: CustomField, id: number, current: CustomValue | undefined): boolean {
  const choice = field.choices.find((c) => c.id === id);
  if (!choice) return false;
  if (!choice.removed) return true;
  return current === id || (Array.isArray(current) && current.includes(id));
}

const ID = /^[1-9][0-9]{0,15}$/;

// The field's choices in the admin's order.
export const choicesInOrder = (field: Pick<CustomField, "choices">) => [...field.choices].sort((a, b) => a.position - b.position || a.id - b.id);

// One field's raw form values → its typed value, or the error code.
export function readValue(field: CustomField, raw: string[], current?: CustomValue): { ok: true; value: CustomValue } | { ok: false; code: string } {
  const first = (raw[0] ?? "").trim();
  switch (field.type) {
    case "text": {
      if (first === "") return { ok: true, value: null };
      return [...first].length > MAX_TEXT ? { ok: false, code: "custom_text_too_long" } : { ok: true, value: first };
    }
    case "long_text": {
      const text = (raw[0] ?? "").replace(/\r\n?/g, "\n").trim();
      if (text === "") return { ok: true, value: null };
      return [...text].length > MAX_LONG_TEXT ? { ok: false, code: "custom_long_text_too_long" } : { ok: true, value: text };
    }
    case "number": {
      const n = parseNumber(first);
      return n.ok ? { ok: true, value: n.value } : { ok: false, code: n.code };
    }
    case "money": {
      const m = parseMoney(first);
      return m.ok ? { ok: true, value: m.pence } : { ok: false, code: "custom_money_invalid" };
    }
    case "date": {
      const d = parseDate(first);
      return d.ok ? { ok: true, value: d.date } : { ok: false, code: "custom_date_invalid" };
    }
    case "single_choice": {
      if (first === "") return { ok: true, value: null };
      const id = ID.test(first) ? Number(first) : 0;
      return allowedChoice(field, id, current) ? { ok: true, value: id } : { ok: false, code: "custom_choice_invalid" };
    }
    case "multiple_choice": {
      const ticked = raw.map((r) => r.trim()).filter((r) => r !== "");
      if (ticked.length === 0) return { ok: true, value: null };
      const ids = new Set<number>();
      for (const r of ticked) {
        const id = ID.test(r) ? Number(r) : 0;
        if (!allowedChoice(field, id, current)) return { ok: false, code: "custom_choice_invalid" };
        ids.add(id);
      }
      return { ok: true, value: choicesInOrder(field).filter((c) => ids.has(c.id)).map((c) => c.id) };
    }
    case "yes_no": {
      if (first === "") return { ok: true, value: null };
      if (first === "yes" || first === "no") return { ok: true, value: first === "yes" };
      return { ok: false, code: "custom_choice_invalid" };
    }
  }
}

// Every given field's value from the form (`raw[id]`, missing = empty); errors keyed `cf.<id>` naming the field.
export function validateCustomValues(fields: CustomField[], raw: Record<number, string[]>, current: CustomValues):
  { ok: true; values: CustomValues } | { ok: false; errors: FieldErrors } {
  const values: CustomValues = {};
  const errors: FieldErrors = {};
  for (const field of fields) {
    const read = readValue(field, raw[field.id] ?? [], current[field.id]);
    if (read.ok) values[field.id] = read.value;
    else errors[valueKey(field.id)] = { code: read.code, name: field.name };
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

export function valuesDiffer(a: CustomValue | undefined, b: CustomValue | undefined): boolean {
  return !sameValue(a ?? null, b ?? null);
}

// A value as shown on the record page, in the timeline and the list ("—" when empty).
export function formatValue(field: Pick<CustomField, "type" | "choices">, value: CustomValue | undefined): string {
  if (!has(value)) return "—";
  switch (field.type) {
    case "number":
      return formatNumber(String(value));
    case "money":
      return formatMoney(Number(value));
    case "date":
      return formatDay(String(value));
    case "single_choice":
      return field.choices.find((c) => c.id === value)?.name ?? "—";
    case "multiple_choice": {
      const ids = new Set(Array.isArray(value) ? value : []);
      const names = choicesInOrder(field).filter((c) => ids.has(c.id)).map((c) => c.name);
      return names.length > 0 ? names.join(", ") : "—";
    }
    case "yes_no":
      return value === true ? "Yes" : "No";
    default:
      return String(value);
  }
}

export const LIST_TEXT_MAX = 80;

// A list cell: as `formatValue`, long text cut to its first 80 characters + "…".
export function listText(field: Pick<CustomField, "type" | "choices">, value: CustomValue | undefined): string {
  const text = formatValue(field, value);
  if (field.type !== "long_text" || !has(value)) return text;
  const chars = [...text];
  return chars.length > LIST_TEXT_MAX ? `${chars.slice(0, LIST_TEXT_MAX).join("")}…` : text;
}

export type CustomEventKind = "custom_set" | "custom_changed" | "custom_cleared";
export type CustomEvent = { kind: CustomEventKind; fieldName: string; oldValue: string | null; newValue: string | null };

// The timeline row for one field's change (values as shown now, so later renames do not rewrite it), or null.
export function customEvent(field: Pick<CustomField, "name" | "type" | "choices">, before: CustomValue | undefined, after: CustomValue | undefined): CustomEvent | null {
  if (!valuesDiffer(before, after)) return null;
  const had = has(before);
  const hasNow = has(after);
  if (!hasNow) return { kind: "custom_cleared", fieldName: field.name, oldValue: null, newValue: null };
  if (field.type === "long_text") return { kind: "custom_changed", fieldName: field.name, oldValue: null, newValue: null };
  if (!had) return { kind: "custom_set", fieldName: field.name, oldValue: null, newValue: formatValue(field, after) };
  return { kind: "custom_changed", fieldName: field.name, oldValue: formatValue(field, before), newValue: formatValue(field, after) };
}

// ---------------------------------------------------------------- CSV import cells

const YES = ["yes", "y", "true", "1"];
const NO = ["no", "n", "false", "0"];

export function parseYesNo(raw: string): boolean | null {
  const text = raw.trim().toLowerCase();
  if (YES.includes(text)) return true;
  if (NO.includes(text)) return false;
  return null;
}

// "24/11/2026", "24 Nov 2026" (or "24 November 2026"), "2026-11-24" → "2026-11-24"; anything else null.
export function parseImportDate(raw: string): string | null {
  const text = raw.trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(text))) {
    const month = MONTHS.findIndex((name) => m![2].toLowerCase().startsWith(name.toLowerCase()));
    const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    if (month < 0 || !(m[2].length === 3 || full[month] === m[2].toLowerCase() || (month === 8 && m[2].toLowerCase() === "sept"))) return null;
    [d, mo, y] = [Number(m[1]), month + 1, Number(m[3])];
  } else return null;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parsed = parseDate(iso);
  return parsed.ok ? parsed.date : null;
}

export type ImportCell = { value: CustomValue } | { unreadable: true } | { tooLong: true };

// One CSV cell for a custom field (research.md §14). Empty = no value; choices by current name ignoring case.
export function readImportCell(field: CustomField, cell: string): ImportCell {
  const text = (cell ?? "").trim();
  if (text === "") return { value: null };
  switch (field.type) {
    case "text":
    case "long_text": {
      const read = readValue(field, [cell]);
      return read.ok ? { value: read.value } : { tooLong: true };
    }
    case "number": {
      const n = parseNumber(text);
      return n.ok ? { value: n.value } : { unreadable: true };
    }
    case "money": {
      const m = parseMoney(text.replace(/^£\s*/, "").replace(/\s/g, ""));
      return m.ok ? { value: m.pence } : { unreadable: true };
    }
    case "date": {
      const day = parseImportDate(text);
      return day ? { value: day } : { unreadable: true };
    }
    case "yes_no": {
      const b = parseYesNo(text);
      return b === null ? { unreadable: true } : { value: b };
    }
    case "single_choice": {
      const choice = field.choices.find((c) => !c.removed && key(c.name) === key(text));
      return choice ? { value: choice.id } : { unreadable: true };
    }
    case "multiple_choice": {
      const ids = new Set<number>();
      for (const part of text.split(/[,;]/).map((p) => p.trim()).filter((p) => p !== "")) {
        const choice = field.choices.find((c) => !c.removed && key(c.name) === key(part));
        if (!choice) return { unreadable: true };
        ids.add(choice.id);
      }
      const value = choicesInOrder(field).filter((c) => ids.has(c.id)).map((c) => c.id);
      return { value: value.length > 0 ? value : null };
    }
  }
}
