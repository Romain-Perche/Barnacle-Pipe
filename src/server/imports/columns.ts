// The fields a CSV column can fill, the suggested match for each heading, the mapping checks and the example files
// (SF-103 research.md §4, §10). Pure: one table of fields drives the select, the suggestions and the example file.
// SF-115: the kind's custom fields are targets too (`custom:<id>`), after the built-in fields, one column each.
import type { CustomField } from "@/server/custom-fields/rules";
import { KINDS, type Kind } from "@/server/records/rules";

export type ImportKind = "people" | "organisations";
export type PersonField =
  | "first_name" | "last_name" | "full_name" | "email" | "phone" | "organisation" | "role" | "lead_source" | "labels"
  | "linkedin" | "owner" | "consent";
export type OrganisationField = "name" | "website" | "sector" | "size" | "location" | "owner";
export type CustomTarget = `custom:${number}`;
export type ImportField = PersonField | OrganisationField | CustomTarget;

// `customName`: the custom field's name when the columns were chosen (the report names a field deleted since).
export type MappedColumn = { index: number; heading: string; field: ImportField | "skip"; kind?: Kind; customName?: string };
export type ColumnMapping = { columns: MappedColumn[] };

type FieldDef<K extends string> = { key: K; label: string; multiple: boolean; aliases: Record<string, Kind | true>; custom?: true };

const OWNER_ALIASES = { owner: true, owneremail: true, ownername: true } as const;

export const PERSON_IMPORT_FIELDS: readonly FieldDef<PersonField>[] = [
  { key: "first_name", label: "First name", multiple: false, aliases: { firstname: true, first: true, givenname: true, forename: true } },
  { key: "last_name", label: "Last name", multiple: false, aliases: { lastname: true, last: true, surname: true, familyname: true } },
  { key: "full_name", label: "Full name", multiple: false, aliases: { name: true, fullname: true, contact: true, contactname: true, person: true } },
  {
    key: "email", label: "Email address", multiple: true,
    aliases: { email: "work", emailaddress: "work", mail: "work", workemail: "work", personalemail: "personal", otheremail: "other" },
  },
  {
    key: "phone", label: "Phone number", multiple: true,
    aliases: {
      phone: "work", phonenumber: "work", telephone: "work", tel: "work", workphone: "work", officephone: "work",
      mobile: "personal", mobilephone: "personal", cell: "personal", cellphone: "personal", personalphone: "personal", otherphone: "other",
    },
  },
  {
    key: "organisation", label: "Organisation", multiple: false,
    aliases: { organisation: true, organization: true, company: true, companyname: true, org: true, account: true, employer: true },
  },
  { key: "role", label: "Role or job title", multiple: false, aliases: { role: true, jobtitle: true, title: true, position: true } },
  { key: "lead_source", label: "Lead source", multiple: false, aliases: { leadsource: true, source: true } },
  { key: "labels", label: "Labels", multiple: true, aliases: { labels: true, label: true, tags: true, tag: true } },
  { key: "linkedin", label: "LinkedIn profile link", multiple: false, aliases: { linkedin: true, linkedinurl: true, linkedinprofile: true } },
  { key: "owner", label: "Owner", multiple: false, aliases: OWNER_ALIASES },
  {
    key: "consent", label: "Email consent", multiple: false,
    aliases: { consent: true, emailconsent: true, subscribed: true, marketingconsent: true, optin: true },
  },
];

export const ORGANISATION_IMPORT_FIELDS: readonly FieldDef<OrganisationField>[] = [
  { key: "name", label: "Name", multiple: false, aliases: { name: true, organisation: true, organization: true, company: true, companyname: true, account: true } },
  { key: "website", label: "Website", multiple: false, aliases: { website: true, web: true, url: true, domain: true, site: true } },
  { key: "sector", label: "Sector", multiple: false, aliases: { sector: true, industry: true } },
  { key: "size", label: "Size", multiple: false, aliases: { size: true, companysize: true, employees: true, headcount: true } },
  { key: "location", label: "Location", multiple: false, aliases: { location: true, city: true, country: true, address: true, hq: true } },
  { key: "owner", label: "Owner", multiple: false, aliases: OWNER_ALIASES },
];

export const customTarget = (id: number): CustomTarget => `custom:${id}`;
export function customFieldId(field: string): number | null {
  const m = /^custom:([1-9][0-9]{0,15})$/.exec(field);
  return m ? Number(m[1]) : null;
}

// The built-in fields, then the given custom fields (their name as the only alias).
export function fieldsFor(kind: ImportKind, custom: readonly CustomField[] = []): readonly FieldDef<ImportField>[] {
  const builtIn: readonly FieldDef<ImportField>[] = kind === "people" ? PERSON_IMPORT_FIELDS : ORGANISATION_IMPORT_FIELDS;
  return [
    ...builtIn,
    ...custom.map((f) => ({ key: customTarget(f.id), label: f.name, multiple: false, aliases: { [headingKey(f.name)]: true as const }, custom: true as const })),
  ];
}

export function fieldLabel(kind: ImportKind, key: string, custom: readonly CustomField[] = []): string | undefined {
  return fieldsFor(kind, custom).find((f) => f.key === key)?.label;
}

export function headingKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function columnLabel(heading: string, index: number): string {
  return heading.trim() === "" ? `Column ${index + 1}` : heading;
}

// A field key from a form or the database, or "skip" when it is not one of this kind's fields.
export function toField(kind: ImportKind, value: unknown, custom: readonly CustomField[] = []): ImportField | "skip" {
  return fieldsFor(kind, custom).find((f) => f.key === value)?.key ?? "skip";
}

export function toKind(value: unknown): Kind {
  return (KINDS as readonly unknown[]).includes(value) ? (value as Kind) : "work";
}

// A heading equal to a custom field's name (ignoring case, spaces and punctuation) is suggested for it before any
// built-in alias (spec Clarifications: its name is exact).
export function suggest(kind: ImportKind, headings: string[], custom: readonly CustomField[] = []): ColumnMapping {
  const used = new Set<string>();
  const defs = fieldsFor(kind, custom);
  const columns = headings.map((heading, index): MappedColumn => {
    const key = headingKey(heading);
    const own = key ? defs.find((f) => f.custom && Object.hasOwn(f.aliases, key) && !used.has(f.key)) : undefined;
    if (own) {
      used.add(own.key);
      return { index, heading, field: own.key, customName: own.label };
    }
    const def = key ? defs.find((f) => !f.custom && Object.hasOwn(f.aliases, key)) : undefined;
    if (!def || (!def.multiple && used.has(def.key))) return { index, heading, field: "skip" };
    used.add(def.key);
    const alias = def.aliases[key];
    return def.key === "email" || def.key === "phone" ? { index, heading, field: def.key, kind: alias === true ? "work" : alias } : { index, heading, field: def.key };
  });
  return { columns };
}

export type MappingError = { code: "import_one_column"; field: ImportField } | { code: "import_person_name_column" } | { code: "import_organisation_name_column" };

export function checkMapping(kind: ImportKind, mapping: ColumnMapping, custom: readonly CustomField[] = []): MappingError | null {
  const counts = new Map<string, number>();
  for (const c of mapping.columns) {
    const field = toField(kind, c.field, custom);
    if (field !== "skip") counts.set(field, (counts.get(field) ?? 0) + 1);
  }
  for (const def of fieldsFor(kind, custom)) {
    if (!def.multiple && (counts.get(def.key) ?? 0) > 1) return { code: "import_one_column", field: def.key };
  }
  if (kind === "people" && !counts.has("first_name") && !counts.has("last_name") && !counts.has("full_name")) {
    return { code: "import_person_name_column" };
  }
  if (kind === "organisations" && !counts.has("name")) return { code: "import_organisation_name_column" };
  return null;
}

// A value quoted as the reader expects (research.md §1).
function csvValue(value: string): string {
  return /[",;\t\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const EXAMPLES: Record<ImportKind, string[][]> = {
  people: [
    ["First name", "Last name", "Email", "Phone", "Organisation", "Job title", "Lead source", "Labels", "LinkedIn", "Owner", "Consent"],
    ["Ada", "Example", "ada@fakeco.example", "+44 20 7946 0000", "Fakeco Ltd", "COO", "Referral", "Hot, Investor", "https://www.linkedin.com/in/ada-example-fake", "", "Subscribed"],
    ["Brian", "Example", "brian@fakeco.example", "+44 20 7946 0001", "Example Gyms Fake", "Head of Ops", "Exec dinner", "", "", "", "Unsubscribed"],
  ],
  organisations: [
    ["Name", "Website", "Sector", "Size", "Location", "Owner"],
    ["Fakeco Ltd", "fakeco.example", "Fitness", "11–50", "London", ""],
    ["Example Gyms Fake", "examplegyms.example", "Fitness", "201–1,000", "Manchester", ""],
  ],
};

// With a BOM so that Excel opens it as UTF-8.
export function exampleCsv(kind: ImportKind): string {
  return `\uFEFF${EXAMPLES[kind].map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}
