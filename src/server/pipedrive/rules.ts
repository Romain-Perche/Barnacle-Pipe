// From a Pipedrive person or organisation to the CRM's fields (SF-117 research.md §7). Pure, unit-tested. It reuses the
// forms' and the CSV import's own helpers, so the import accepts exactly what the forms accept. A value the form would
// refuse, or one longer than the form keeps, is left out with a warning, never cut or changed; a record is refused only
// when its name is missing or too long.
import { MAX_LONG_TEXT, MAX_TEXT, choicesInOrder, parseNumber, readValue, type CustomField, type CustomValue } from "@/server/custom-fields/rules";
import { parseSize, splitFullName } from "@/server/imports/rows";
import {
  isValidEmail,
  normaliseEmail,
  normaliseLinkedIn,
  normalisePhone,
  normaliseWebsite,
  validateOrganisation,
  validatePerson,
  type Consent,
  type Kind,
  type OrganisationFields,
  type PersonFields,
} from "@/server/records/rules";
import type { PdContact, PdField, PdOrganization, PdPerson } from "@/server/pipedrive/api";

// A message or template code (messages.ts) with its arguments.
export type Problem = { code: string; args?: Record<string, string | number> };

// A field name without case, spaces or punctuation: "Job-Title " → "jobtitle".
export const fieldKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const nameKey = (name: string) => name.trim().toLowerCase();

// FR-009: the person fields the CRM fills its built-in Role, Lead source and LinkedIn from.
export const BUILT_IN_KEYS = {
  role: ["jobtitle", "role"],
  leadSource: ["leadsource", "source"],
  linkedin: ["linkedin", "linkedinprofile", "linkedinurl"],
} as const;
export type BuiltIn = keyof typeof BUILT_IN_KEYS;

export function builtInOf(name: string): BuiltIn | null {
  const key = fieldKey(name);
  for (const [b, keys] of Object.entries(BUILT_IN_KEYS)) if ((keys as readonly string[]).includes(key)) return b as BuiltIn;
  return null;
}

// Pipedrive's label of an email or phone: work → Work; home, mobile → Personal; anything else → Other.
export function contactKind(label: string): Kind {
  const l = label.trim().toLowerCase();
  if (l === "work") return "work";
  if (l === "home" || l === "mobile") return "personal";
  return "other";
}

// Pipedrive's order with the primary one moved first.
export function inPipedriveOrder<T extends { primary: boolean }>(list: T[]): T[] {
  return [...list.filter((c) => c.primary), ...list.filter((c) => !c.primary)];
}

// FR-014: Pipedrive's subscribed / unsubscribed, else the user's choice (never a guess).
export function consentOf(status: string | null, choice: Consent): Consent {
  if (status === "unsubscribed") return "unsubscribed";
  if (status === "subscribed") return "subscribed";
  return choice;
}

// FR-013: "Owner only" in Pipedrive.
export const isOwnerOnly = (visibleTo: number | null) => visibleTo === 1;

// Pipedrive's add_time ("2025-03-04 10:11:12" in UTC, or ISO), else null.
export function parseAddTime(text: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3] ?? "Z"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------- custom fields (FR-016)

const SUPPORTED_TYPES = new Set(["varchar", "varchar_auto", "text", "double", "int", "monetary", "date", "enum", "set"]);
const isYesNo = (pd: PdField) => pd.options.length === 2 && pd.options.map((o) => nameKey(o.label)).sort().join(",") === "no,yes";

const COMPATIBLE: Record<string, CustomField["type"][]> = {
  varchar: ["text"],
  varchar_auto: ["text"],
  text: ["long_text", "text"],
  double: ["number"],
  int: ["number"],
  monetary: ["money"],
  date: ["date"],
  enum: ["single_choice"],
  set: ["multiple_choice"],
};

export function customCompatibility(pd: PdField, crm: CustomField | undefined): { ok: true } | { ok: false; code: string; args: Record<string, string> } {
  if (!SUPPORTED_TYPES.has(pd.type)) return { ok: false, code: "pipedrive_field_unsupported", args: { name: pd.name.trim(), pd: pd.type } };
  if (!crm) return { ok: false, code: "pipedrive_field_no_match", args: { name: pd.name.trim() } };
  const types = pd.type === "enum" && isYesNo(pd) ? ["single_choice", "yes_no"] : COMPATIBLE[pd.type];
  if (types.includes(crm.type)) return { ok: true };
  return { ok: false, code: "pipedrive_field_type_mismatch", args: { name: pd.name.trim(), pd: pd.type, crm: crm.type } };
}

export type FieldNotImported = { kind: "person" | "organisation" | "deal"; name: string; code: string; args: Record<string, string> };
export type FieldsPlan = {
  builtIn: Partial<Record<BuiltIn, PdField>>;
  mapped: { pd: PdField; crm: CustomField }[];
  notImported: FieldNotImported[];
  // Person label names (field `label_ids` / `label`), deal label names (field `label`, SF-122) and organisation
  // industries (field `industry`), by option id.
  labelOptions: Map<number, string>;
  industryOptions: Map<number, string>;
};

// Which Pipedrive fields fill what, for one kind: built-in names first (people only), then custom fields matched to
// the kind's CRM custom fields by name (ignoring case and surrounding spaces); every other custom field once, with why.
// SF-122: kind "deal" has no built-in names; its `label` field gives the deal label names.
export function planFields(kind: "person" | "organisation" | "deal", pdFields: PdField[], crmFields: CustomField[]): FieldsPlan {
  const plan: FieldsPlan = { builtIn: {}, mapped: [], notImported: [], labelOptions: new Map(), industryOptions: new Map() };
  const seen = new Set<string>();
  for (const pd of pdFields) {
    if (kind === "person" && (pd.code === "label_ids" || pd.code === "label")) for (const o of pd.options) plan.labelOptions.set(o.id, o.label);
    if (kind === "deal" && (pd.code === "label" || pd.code === "label_ids")) for (const o of pd.options) plan.labelOptions.set(o.id, o.label);
    if (kind === "organisation" && pd.code === "industry") for (const o of pd.options) plan.industryOptions.set(o.id, o.label);
    const builtIn = kind === "person" ? builtInOf(pd.name) : null;
    if (builtIn) {
      plan.builtIn[builtIn] ??= pd;
      continue;
    }
    if (!pd.custom) continue;
    const key = nameKey(pd.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const crm = crmFields.find((f) => nameKey(f.name) === key);
    const c = customCompatibility(pd, crm);
    if (c.ok) plan.mapped.push({ pd, crm: crm! });
    else plan.notImported.push({ kind, name: pd.name.trim(), code: c.code, args: c.args });
  }
  return plan;
}

const isEmpty = (raw: unknown) => raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);
const asText = (raw: unknown) => (typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : JSON.stringify(raw));
const optionIds = (raw: unknown): number[] =>
  (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [raw]).map((v) => Number(typeof v === "string" ? v.trim() : v)).filter(Number.isInteger);

// The label of an option field's value (an option id), or the text itself for another field.
export function optionLabel(pd: PdField, raw: unknown): string {
  if (isEmpty(raw)) return "";
  if (pd.type === "enum" || pd.type === "set") {
    const id = optionIds(raw)[0];
    return pd.options.find((o) => o.id === id)?.label ?? "";
  }
  return typeof raw === "string" ? raw : asText(raw);
}

export type CustomRead = { value: CustomValue; missing?: string[] } | { warning: Problem } | null;

// One Pipedrive custom value for its CRM field. null: no value. `missing`: options that are no current choice.
export function readCustomValue(pd: PdField, crm: CustomField, raw: unknown): CustomRead {
  if (isEmpty(raw)) return null;
  const invalid = { warning: { code: "pipedrive_value_invalid", args: { field: crm.name, value: asText(raw) } } };
  const through = (text: string) => {
    const r = readValue(crm, [text]);
    return r.ok ? { value: r.value } : invalid;
  };
  switch (crm.type) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string") return invalid;
      const r = readValue(crm, [raw]);
      if (r.ok) return r.value === null ? null : { value: r.value };
      return { warning: { code: "pipedrive_value_too_long", args: { field: crm.name, max: crm.type === "text" ? MAX_TEXT : MAX_LONG_TEXT } } };
    }
    case "number": {
      if (typeof raw !== "number" && typeof raw !== "string") return invalid;
      const n = parseNumber(String(raw));
      return n.ok ? (n.value === null ? null : { value: n.value }) : invalid;
    }
    case "money": {
      const m = typeof raw === "object" && raw !== null ? (raw as { value?: unknown; currency?: unknown }) : null;
      if (!m || (typeof m.value !== "number" && typeof m.value !== "string")) return invalid;
      const currency = typeof m.currency === "string" ? m.currency.trim().toUpperCase() : "";
      if (currency !== "GBP") return { warning: { code: "pipedrive_currency", args: { field: crm.name, currency: currency || "?" } } };
      return through(String(m.value));
    }
    case "date":
      return typeof raw === "string" ? through(raw.slice(0, 10)) : invalid;
    case "yes_no": {
      const label = nameKey(optionLabel(pd, raw));
      return label === "yes" ? { value: true } : label === "no" ? { value: false } : invalid;
    }
    case "single_choice":
    case "multiple_choice": {
      const labels = optionIds(raw).map((id) => pd.options.find((o) => o.id === id)?.label);
      if (labels.some((l) => l === undefined)) return invalid;
      const ids = new Set<number>();
      const missing: string[] = [];
      for (const label of labels as string[]) {
        const choice = crm.choices.find((c) => !c.removed && nameKey(c.name) === nameKey(label));
        if (choice) ids.add(choice.id);
        else if (!missing.includes(label)) missing.push(label);
      }
      const value: CustomValue =
        crm.type === "single_choice" ? ([...ids][0] ?? null) : ids.size === 0 ? null : choicesInOrder(crm).filter((c) => ids.has(c.id)).map((c) => c.id);
      return missing.length > 0 ? { value, missing } : { value };
    }
  }
}

export type CustomOut = { custom: { fieldId: number; value: CustomValue }[]; missingChoices: { field: string; value: string }[]; warnings: Problem[] };

export function customValues(plan: FieldsPlan, values: Record<string, unknown>): CustomOut {
  const out: CustomOut = { custom: [], missingChoices: [], warnings: [] };
  for (const { pd, crm } of plan.mapped) {
    const r = readCustomValue(pd, crm, values[pd.code]);
    if (r === null) continue;
    if ("warning" in r) {
      out.warnings.push(r.warning);
      continue;
    }
    if (r.value !== null) out.custom.push({ fieldId: crm.id, value: r.value });
    for (const value of r.missing ?? []) out.missingChoices.push({ field: crm.name, value });
  }
  return out;
}

// ---------------------------------------------------------------- people and organisations

const tooLong = (field: string, max: number): Problem => ({ code: "import_too_long", args: { field, max } });

export type PersonResult =
  | ({ ok: true; label: string; fields: PersonFields; leadSource: string | null; labels: string[] } & CustomOut)
  | { ok: false; label: string; problem: Problem };

export function personFromPipedrive(p: PdPerson, plan: FieldsPlan, consentChoice: Consent): PersonResult {
  const hasParts = p.firstName.trim() !== "" || p.lastName.trim() !== "";
  const split = splitFullName(p.name);
  const firstName = (hasParts ? p.firstName : split.first).trim();
  const lastName = (hasParts ? p.lastName : split.last).trim();
  const label = `${firstName} ${lastName}`.trim() || p.emails[0]?.value.trim() || `#${p.id}`;
  if (firstName === "" && lastName === "") return { ok: false, label, problem: { code: "pipedrive_no_name" } };
  if (firstName.length > 100) return { ok: false, label, problem: tooLong("first name", 100) };
  if (lastName.length > 100) return { ok: false, label, problem: tooLong("last name", 100) };

  const warnings: Problem[] = [];
  const invalid = (field: string, value: string) => warnings.push({ code: "pipedrive_value_invalid", args: { field, value } });
  const emails: { value: string; kind: string }[] = [];
  for (const e of inPipedriveOrder<PdContact>(p.emails)) {
    const email = normaliseEmail(e.value);
    if (email === "") continue;
    if (!isValidEmail(email)) invalid("email address", e.value.trim());
    else if (!emails.some((x) => x.value === email)) emails.push({ value: email, kind: contactKind(e.label) });
  }
  const phones: { value: string; kind: string }[] = [];
  for (const ph of inPipedriveOrder<PdContact>(p.phones)) {
    if (ph.value.trim() === "") continue;
    const phone = normalisePhone(ph.value);
    if (phone === null) invalid("phone number", ph.value.trim());
    else phones.push({ value: phone, kind: contactKind(ph.label) });
  }
  const builtIn = (b: BuiltIn) => (plan.builtIn[b] ? optionLabel(plan.builtIn[b], p.custom[plan.builtIn[b].code]).trim() : "");
  let role = p.jobTitle.trim() || builtIn("role");
  if (role.length > 200) {
    warnings.push({ code: "pipedrive_value_too_long", args: { field: "role", max: 200 } });
    role = "";
  }
  let linkedin = builtIn("linkedin");
  if (linkedin !== "" && normaliseLinkedIn(linkedin) === null) {
    invalid("LinkedIn link", linkedin);
    linkedin = "";
  }
  const custom = customValues(plan, p.custom);
  const v = validatePerson({
    firstName, lastName, emails, phones, organisationId: "", newOrganisationName: "", role, leadSourceId: "", linkedin,
    ownerId: "", labelIds: [], consent: consentOf(p.marketingStatus, consentChoice), private: false, ambassador: false, referredBy: "",
  });
  if (!v.ok) return { ok: false, label, problem: { code: Object.values(v.errors)[0].code } };
  const leadSource = builtIn("leadSource");
  return {
    ok: true,
    label,
    fields: v.value,
    leadSource: leadSource === "" ? null : leadSource,
    labels: p.labelIds.flatMap((id) => (plan.labelOptions.has(id) ? [plan.labelOptions.get(id)!] : [])),
    custom: custom.custom,
    missingChoices: custom.missingChoices,
    warnings: [...warnings, ...custom.warnings],
  };
}

export type OrganisationResult =
  | ({ ok: true; label: string; fields: OrganisationFields } & CustomOut)
  | { ok: false; label: string; problem: Problem };

export function organisationFromPipedrive(o: PdOrganization, plan: FieldsPlan): OrganisationResult {
  const name = o.name.trim();
  const label = name || `#${o.id}`;
  if (name === "") return { ok: false, label, problem: { code: "pipedrive_no_name" } };
  if (name.length > 200) return { ok: false, label, problem: tooLong("name", 200) };
  const warnings: Problem[] = [];
  let website = o.website.trim();
  if (website !== "" && normaliseWebsite(website) === null) {
    warnings.push({ code: "pipedrive_value_invalid", args: { field: "website", value: website } });
    website = "";
  }
  const capped = (field: string, value: string, max: number) => {
    if (value.length <= max) return value;
    warnings.push({ code: "pipedrive_value_too_long", args: { field, max } });
    return "";
  };
  const sector = capped("sector", (o.industry === null ? "" : (plan.industryOptions.get(o.industry) ?? "")).trim(), 100);
  const location = capped("location", o.address.trim(), 100);
  let size = "";
  if (o.employeeCount !== null) {
    const band = parseSize(String(o.employeeCount));
    if (band === null || band === "unknown") warnings.push({ code: "pipedrive_value_invalid", args: { field: "number of employees", value: String(o.employeeCount) } });
    else size = band;
  }
  const custom = customValues(plan, o.custom);
  const v = validateOrganisation({ name, website, sector, size, location, ownerId: "" });
  if (!v.ok) return { ok: false, label, problem: { code: Object.values(v.errors)[0].code } };
  return { ok: true, label, fields: v.value, custom: custom.custom, missingChoices: custom.missingChoices, warnings: [...warnings, ...custom.warnings] };
}
