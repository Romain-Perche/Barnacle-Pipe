// What an import will do, row by row (SF-103 research.md §6, data-model.md § Import plan). Pure: the same function
// runs for the preview and again inside the import's transaction, so the report says what really happened.
// Existing records are referred to by id only; names of people are loaded when shown, through visiblePerson().
import type { CustomField, CustomValue } from "@/server/custom-fields/rules";
import type { ColumnMapping } from "@/server/imports/columns";
import type { CsvRow } from "@/server/imports/csv";
import { organisationFormFromRow, personFormFromRow, type RowError } from "@/server/imports/rows";
import type { Consent, OrganisationFields, PersonFields } from "@/server/records/rules";

export type Lookups = {
  importerId: number;
  // Every email address in the CRM (archived and private people included).
  emails: Map<string, { personId: number }>;
  // By lower(btrim(name)), archived ones included.
  organisations: Map<string, { id: number; name: string; archived: boolean }>;
  // Entries still offered, by lower(btrim(name)).
  leadSources: Map<string, number>;
  labels: Map<string, number>;
  // Active users, email and name in lower case.
  users: { id: number; email: string; name: string }[];
  // SF-115: the kind's custom fields (a mapped field not here is ignored).
  customFields: CustomField[];
};

export function emptyLookups(importerId: number): Lookups {
  return { importerId, emails: new Map(), organisations: new Map(), leadSources: new Map(), labels: new Map(), users: [], customFields: [] };
}

// Spreadsheet row number and the name or email from the row (data the user uploaded).
export type RowRef = { row: number; label: string };
export type Skip = RowRef & RowError & { personId?: number; organisationId?: number };
// `field`: the custom field's name of an import_custom_unreadable or import_custom_choice_unknown warning (SF-115).
export type Warning = { code: string; value?: string; rows: number[]; organisationId?: number; field?: string };
export type CustomToAdd = { fieldId: number; value: CustomValue }[];

export type PersonToAdd = {
  row: number;
  label: string;
  fields: PersonFields;
  organisation: { id: number } | { newKey: string } | null;
  ownerId: number;
  leadSourceId: number | null;
  labelIds: number[];
  // null: none in the file, the user's choice applies (FR-007).
  consent: Consent | null;
  custom: CustomToAdd;
};
export type OrganisationToAdd = { row: number; label: string; fields: OrganisationFields & { ownerId: number }; custom: CustomToAdd };

export type ImportPlan<T> = {
  adds: T[];
  newOrganisations: { key: string; name: string }[];
  skipped: Skip[];
  warnings: Warning[];
  withoutEmail: number;
  needsConsent: number;
};

export type ImportReport = {
  imported: number;
  organisationsAdded: number;
  organisationsAddedNames: string[];
  skipped: Skip[];
  warnings: Warning[];
  // SF-115: mapped custom fields deleted before the import ran (their names when mapped).
  goneFields?: string[];
};

export const keyOf = (name: string) => name.trim().toLowerCase();

// One warning per (code, value), with every row it applies to, in the order first met.
class Warnings {
  private byKey = new Map<string, Warning>();
  add(code: string, value: string, row: number, extra: { organisationId?: number; field?: string } = {}) {
    const key = `${code}\u0000${extra.field ?? ""}\u0000${keyOf(value)}`;
    const w = this.byKey.get(key) ?? { code, value, ...extra, rows: [] };
    if (!w.rows.includes(row)) w.rows.push(row);
    this.byKey.set(key, w);
  }
  list(): Warning[] {
    return [...this.byKey.values()].map(({ code, value, organisationId, field, rows }) =>
      field !== undefined ? { code, field, value, rows } : organisationId === undefined ? { code, value, rows } : { code, value, organisationId, rows });
  }
}

function resolveOwner(value: string, row: number, lookups: Lookups, warnings: Warnings): number {
  if (value === "") return lookups.importerId;
  const key = keyOf(value);
  const byEmail = lookups.users.find((u) => u.email === key);
  if (byEmail) return byEmail.id;
  const byName = lookups.users.filter((u) => u.name === key);
  if (byName.length === 1) return byName[0].id;
  warnings.add("import_owner_unknown", value, row);
  return lookups.importerId;
}

const skipOf = (row: number, label: string, error: RowError, extra: { personId?: number; organisationId?: number } = {}): Skip =>
  ({ row, label, ...error, ...extra });

export function planPeople(rows: CsvRow[], mapping: ColumnMapping, lookups: Lookups): ImportPlan<PersonToAdd> {
  const adds: PersonToAdd[] = [];
  const skipped: Skip[] = [];
  const warnings = new Warnings();
  const newOrganisations = new Map<string, string>();
  const emailRows = new Map<string, number>();
  for (const { number: row, values } of rows) {
    const r = personFormFromRow(values, mapping, lookups.customFields);
    if (!r.ok) {
      skipped.push(skipOf(row, r.label, r.error));
      continue;
    }
    const { fields } = r.value;
    let duplicate: Skip | null = null;
    for (const { email } of fields.emails) {
      const existing = lookups.emails.get(email);
      if (existing) duplicate = skipOf(row, r.label, { code: "import_duplicate_email" }, { personId: existing.personId });
      else if (emailRows.has(email)) duplicate = skipOf(row, r.label, { code: "import_duplicate_in_file", args: { row: emailRows.get(email)! } });
      if (duplicate) break;
    }
    if (duplicate) {
      skipped.push(duplicate);
      continue;
    }
    for (const { email } of fields.emails) emailRows.set(email, row);

    let organisation: PersonToAdd["organisation"] = null;
    if (r.value.organisationName !== "") {
      const key = keyOf(r.value.organisationName);
      const existing = lookups.organisations.get(key);
      if (existing) {
        organisation = { id: existing.id };
        if (existing.archived) warnings.add("import_organisation_archived", existing.name, row, { organisationId: existing.id });
      } else {
        if (!newOrganisations.has(key)) newOrganisations.set(key, r.value.organisationName);
        organisation = { newKey: key };
      }
    }
    let leadSourceId: number | null = null;
    if (r.value.leadSource !== "") {
      leadSourceId = lookups.leadSources.get(keyOf(r.value.leadSource)) ?? null;
      if (leadSourceId === null) warnings.add("import_lead_source_unknown", r.value.leadSource, row);
    }
    const labelIds = new Set<number>();
    for (const label of r.value.labels) {
      const id = lookups.labels.get(keyOf(label));
      if (id === undefined) warnings.add("import_label_unknown", label, row);
      else labelIds.add(id);
    }
    adds.push({
      row,
      label: r.label,
      fields: { ...fields, private: false },
      organisation,
      ownerId: resolveOwner(r.value.owner, row, lookups, warnings),
      leadSourceId,
      labelIds: [...labelIds].sort((a, b) => a - b),
      consent: r.value.consent,
      custom: r.value.custom,
    });
    for (const u of r.value.unreadable) warnings.add(u.code, u.value, row, { field: u.field });
  }
  return {
    adds,
    newOrganisations: [...newOrganisations].map(([key, name]) => ({ key, name })),
    skipped,
    warnings: warnings.list(),
    withoutEmail: adds.filter((a) => a.fields.emails.length === 0).length,
    needsConsent: adds.filter((a) => a.consent === null).length,
  };
}

export function planOrganisations(rows: CsvRow[], mapping: ColumnMapping, lookups: Lookups): ImportPlan<OrganisationToAdd> {
  const adds: OrganisationToAdd[] = [];
  const skipped: Skip[] = [];
  const warnings = new Warnings();
  const nameRows = new Map<string, number>();
  for (const { number: row, values } of rows) {
    const r = organisationFormFromRow(values, mapping, lookups.customFields);
    if (!r.ok) {
      skipped.push(skipOf(row, r.label, r.error));
      continue;
    }
    const key = keyOf(r.value.fields.name);
    const existing = lookups.organisations.get(key);
    if (existing) {
      skipped.push(skipOf(row, r.label, { code: "organisation_exists" }, { organisationId: existing.id }));
      continue;
    }
    if (nameRows.has(key)) {
      skipped.push(skipOf(row, r.label, { code: "import_duplicate_in_file_org", args: { row: nameRows.get(key)! } }));
      continue;
    }
    nameRows.set(key, row);
    if (r.value.sizeUnknown !== null) warnings.add("import_size_unknown", r.value.sizeUnknown, row);
    adds.push({ row, label: r.label, fields: { ...r.value.fields, ownerId: resolveOwner(r.value.owner, row, lookups, warnings) }, custom: r.value.custom });
    for (const u of r.value.unreadable) warnings.add(u.code, u.value, row, { field: u.field });
  }
  return { adds, newOrganisations: [], skipped, warnings: warnings.list(), withoutEmail: 0, needsConsent: 0 };
}
