// From one CSV row and the column mapping to a person's or an organisation's fields, through the forms' own
// validators (SF-103 research.md §5). Pure. Lengths are checked first: the forms cut long values silently, an import
// refuses them so that nothing is lost without telling.
import type { ColumnMapping, ImportField } from "@/server/imports/columns";
import {
  SIZES,
  validateOrganisation,
  validatePerson,
  type Consent,
  type OrganisationFields,
  type PersonFields,
  type Size,
} from "@/server/records/rules";

// A message code (messages.ts) or a template code with its arguments (templates in messages.ts).
export type RowError = { code: string; args?: Record<string, string | number> };
type FromRow<T> = { ok: true; value: T; label: string } | { ok: false; error: RowError; label: string };

export type PersonFromRow = {
  fields: PersonFields;
  organisationName: string;
  leadSource: string;
  labels: string[];
  owner: string;
  consent: Consent | null;
};
export type OrganisationFromRow = { fields: OrganisationFields; owner: string; sizeUnknown: string | null };

export function splitFullName(text: string): { first: string; last: string } {
  const [first, ...rest] = text.trim().split(/\s+/);
  return { first: first ?? "", last: rest.join(" ") };
}

export function splitMulti(text: string): string[] {
  return text.split(/[,;]/).map((v) => v.trim()).filter((v) => v !== "");
}

export function tooLong(field: string, value: string, max: number): RowError | null {
  return value.length > max ? { code: "import_too_long", args: { field, max } } : null;
}

const UNSUBSCRIBED = new Set(["unsubscribed", "no", "false", "opted out", "opt out", "optedout", "n", "0"]);
const SUBSCRIBED = new Set(["subscribed", "yes", "true", "opted in", "opt in", "optedin", "y", "1"]);

// null: no value in the file (the user's choice applies); "unknown": refused, never guessed.
export function parseConsent(text: string): Consent | null | "unknown" {
  const word = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (word === "") return null;
  if (UNSUBSCRIBED.has(word)) return "unsubscribed";
  if (SUBSCRIBED.has(word)) return "subscribed";
  return "unknown";
}

const sizeKey = (text: string) => text.replace(/-/g, "–").replace(/[\s,]/g, "");

// A band as written (or with a plain hyphen, with or without thousands commas), else a whole number placed in its band.
export function parseSize(text: string): Size | null | "unknown" {
  const value = text.trim();
  if (value === "") return null;
  const band = SIZES.find((s) => sizeKey(s) === sizeKey(value));
  if (band) return band;
  const digits = value.replace(/[\s,]/g, "");
  if (!/^[0-9]{1,9}$/.test(digits)) return "unknown";
  const n = Number(digits);
  if (n <= 0) return "unknown";
  if (n <= 10) return "1–10";
  if (n <= 50) return "11–50";
  if (n <= 200) return "51–200";
  if (n <= 1000) return "201–1,000";
  return "1,000+";
}

// The trimmed values of the columns set to `field`, in column order.
function valuesOf(values: string[], mapping: ColumnMapping, field: ImportField) {
  return mapping.columns.filter((c) => c.field === field).map((c) => ({ value: (values[c.index] ?? "").trim(), kind: c.kind ?? "work" }));
}
const first = (values: string[], mapping: ColumnMapping, field: ImportField) => valuesOf(values, mapping, field)[0]?.value ?? "";
const firstError = (errors: Record<string, { code: string }>): RowError => ({ code: Object.values(errors)[0].code });

export function personFormFromRow(values: string[], mapping: ColumnMapping): FromRow<PersonFromRow> {
  const emails = valuesOf(values, mapping, "email").flatMap((c) => splitMulti(c.value).map((value) => ({ value, kind: c.kind })));
  const phones = valuesOf(values, mapping, "phone").flatMap((c) => splitMulti(c.value).map((value) => ({ value, kind: c.kind })));
  const hasNameColumns = mapping.columns.some((c) => c.field === "first_name" || c.field === "last_name");
  const full = splitFullName(first(values, mapping, "full_name"));
  const firstName = hasNameColumns ? first(values, mapping, "first_name") : full.first;
  const lastName = hasNameColumns ? first(values, mapping, "last_name") : full.last;
  const label = `${firstName} ${lastName}`.trim() || emails[0]?.value.toLowerCase() || "";
  const refuse = (error: RowError) => ({ ok: false as const, error, label });

  if (values.length > mapping.columns.length) return refuse({ code: "import_too_many_values" });
  const organisationName = first(values, mapping, "organisation");
  const role = first(values, mapping, "role");
  const long =
    tooLong("first name", firstName, 100) ??
    tooLong("last name", lastName, 100) ??
    tooLong("role", role, 200) ??
    tooLong("organisation name", organisationName, 200);
  if (long) return refuse(long);
  const consentText = first(values, mapping, "consent");
  const consent = parseConsent(consentText);
  if (consent === "unknown") return refuse({ code: "import_consent_unknown", args: { value: consentText } });

  const v = validatePerson({
    firstName,
    lastName,
    emails,
    phones,
    organisationId: "",
    newOrganisationName: "",
    role,
    leadSourceId: "",
    linkedin: first(values, mapping, "linkedin"),
    ownerId: "",
    labelIds: [],
    consent: consent ?? "subscribed",
    private: false,
    // SF-114: not set by the CSV import (spec Assumptions).
    ambassador: false,
    referredBy: "",
  });
  if (!v.ok) return refuse(firstError(v.errors));
  return {
    ok: true,
    label,
    value: {
      fields: v.value,
      organisationName,
      leadSource: first(values, mapping, "lead_source"),
      labels: valuesOf(values, mapping, "labels").flatMap((c) => splitMulti(c.value)),
      owner: first(values, mapping, "owner"),
      consent,
    },
  };
}

export function organisationFormFromRow(values: string[], mapping: ColumnMapping): FromRow<OrganisationFromRow> {
  const name = first(values, mapping, "name");
  const refuse = (error: RowError) => ({ ok: false as const, error, label: name });
  if (values.length > mapping.columns.length) return refuse({ code: "import_too_many_values" });
  const sector = first(values, mapping, "sector");
  const location = first(values, mapping, "location");
  const long = tooLong("name", name, 200) ?? tooLong("sector", sector, 100) ?? tooLong("location", location, 100);
  if (long) return refuse(long);
  const sizeText = first(values, mapping, "size");
  const size = parseSize(sizeText);
  const v = validateOrganisation({
    name,
    website: first(values, mapping, "website"),
    sector,
    size: size === "unknown" || size === null ? "" : size,
    location,
    ownerId: "",
  });
  if (!v.ok) return refuse(firstError(v.errors));
  return { ok: true, label: name, value: { fields: v.value, owner: first(values, mapping, "owner"), sizeUnknown: size === "unknown" ? sizeText : null } };
}
