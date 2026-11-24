// The report of a Pipedrive import (SF-117 data-model.md § Report, § Counts): built up part by part under the import
// row's lock (mergeReport, pure), and turned into lines at display time (reportLines, pure) from messages.ts codes only.
// Pipedrive values appear only inside quotes; CRM people are named only when the viewer can see them (namesForReport,
// through visiblePerson(): FR-019).
import { sql } from "@/server/db";
import { messageFor, templates, type TemplateCode } from "@/server/messages";
import type { FieldNotImported } from "@/server/pipedrive/rules";
import type { ChoiceMiss, LinkedItem, ListMiss, OwnerMiss, RecordKind, ReportItem } from "@/server/pipedrive/page";
import { visiblePerson } from "@/server/records/visibility";

export type KindCounts = { imported: number; linked: number; already: number; notImported: number };
export type Counts = { organisations: KindCounts; people: KindCounts };
export type Report = {
  notImported: ReportItem[];
  linked: LinkedItem[];
  owners: Record<string, OwnerMiss>;
  lists: ListMiss[];
  fields: FieldNotImported[];
  choices: ChoiceMiss[];
  warnings: ReportItem[];
  unsubscribed: { personId: number }[];
  privateOthers: number;
  ownerOnlyOrganisations: number;
};

const zero = (): KindCounts => ({ imported: 0, linked: 0, already: 0, notImported: 0 });
export const emptyCounts = (): Counts => ({ organisations: zero(), people: zero() });
export const emptyReport = (): Report => ({
  notImported: [], linked: [], owners: {}, lists: [], fields: [], choices: [], warnings: [], unsubscribed: [], privateOthers: 0, ownerOnlyOrganisations: 0,
});

// A stored report or counts, filled in with what an older or partial row lacks.
export const readReport = (raw: unknown): Report => ({ ...emptyReport(), ...((raw ?? {}) as Partial<Report>) });
export const readCounts = (raw: unknown): Counts => {
  const c = (raw ?? {}) as Partial<Counts>;
  return { organisations: { ...zero(), ...c.organisations }, people: { ...zero(), ...c.people } };
};

const k = (text: string) => text.trim().toLowerCase();

// What one page adds to the report. Records not imported are listed once per Pipedrive record, fields once per name,
// owners, list values and choices once each with their counter summed.
export type PageReport = {
  kind: RecordKind;
  imported: number;
  already: number;
  notImported: ReportItem[];
  linked: LinkedItem[];
  owners: Record<string, OwnerMiss>;
  lists: ListMiss[];
  fields: FieldNotImported[];
  choices: ChoiceMiss[];
  warnings: ReportItem[];
  unsubscribed: number[];
  privateOthers: number;
  ownerOnly: number;
};

export function mergeReport(report: Report, counts: Counts, page: PageReport): void {
  const c = page.kind === "person" ? counts.people : counts.organisations;
  c.imported += page.imported;
  c.already += page.already;
  c.linked += page.linked.length;
  for (const item of page.notImported) {
    if (!report.notImported.some((x) => x.kind === item.kind && x.pipedriveId === item.pipedriveId)) report.notImported.push(item);
  }
  c.notImported = report.notImported.filter((x) => x.kind === page.kind).length;
  report.linked.push(...page.linked);
  for (const [id, o] of Object.entries(page.owners)) {
    const cur = report.owners[id];
    report.owners[id] = cur ? { ...cur, records: cur.records + o.records } : { ...o };
  }
  for (const l of page.lists) {
    const cur = report.lists.find((x) => x.list === l.list && k(x.value) === k(l.value));
    if (cur) cur.records += l.records;
    else report.lists.push({ ...l });
  }
  for (const f of page.fields) if (!report.fields.some((x) => x.kind === f.kind && k(x.name) === k(f.name))) report.fields.push(f);
  for (const ch of page.choices) {
    const cur = report.choices.find((x) => x.kind === ch.kind && k(x.field) === k(ch.field) && k(x.value) === k(ch.value));
    if (cur) cur.records += ch.records;
    else report.choices.push({ ...ch });
  }
  report.warnings.push(...page.warnings);
  for (const personId of page.unsubscribed) if (!report.unsubscribed.some((u) => u.personId === personId)) report.unsubscribed.push({ personId });
  report.privateOthers += page.privateOthers;
  report.ownerOnlyOrganisations += page.ownerOnly;
}

export type Names = { people: Map<number, string>; organisations: Map<number, string> };

// Names of the CRM records the report refers to: a person only when the viewer can see them.
export async function namesForReport(viewerId: number, report: Report): Promise<Names> {
  const personIds = [
    ...new Set([
      ...report.linked.flatMap((l) => (l.kind === "person" ? [l.personId] : [])),
      ...report.unsubscribed.map((u) => u.personId),
      ...report.notImported.flatMap((n) => (typeof n.args?.personId === "number" ? [n.args.personId] : [])),
    ]),
  ];
  const orgIds = [...new Set(report.linked.flatMap((l) => (l.kind === "organisation" ? [l.organisationId] : [])))];
  const people = personIds.length === 0 ? [] : await sql<{ id: number; name: string }[]>`
    select p.id::int as id, btrim(p.first_name || ' ' || p.last_name) as name from persons p
    where p.id = any(${personIds}::bigint[]) and ${visiblePerson(sql, viewerId)}`;
  const orgs = orgIds.length === 0 ? [] : await sql<{ id: number; name: string }[]>`
    select id::int as id, name from organisations where id = any(${orgIds}::bigint[])`;
  return { people: new Map(people.map((p) => [p.id, p.name])), organisations: new Map(orgs.map((o) => [o.id, o.name])) };
}

type Args = Record<string, string | number> | undefined;
const s = (args: Args, name: string) => String(args?.[name] ?? "");
const n = (args: Args, name: string) => Number(args?.[name] ?? 0);

// The text of a reason or warning code (fixed messages, or templates with the stored arguments).
export function itemText(item: { code: string; args?: Args }, names: Names): string {
  const a = item.args;
  switch (item.code as TemplateCode) {
    case "pipedrive_email_other_person": {
      if (a?.personId !== undefined) {
        const name = names.people.get(Number(a.personId));
        return name === undefined ? (messageFor("pipedrive_email_other_hidden") ?? "") : templates.pipedrive_email_other_person(name);
      }
      return templates.pipedrive_email_other_person(s(a, "name"));
    }
    case "pipedrive_value_invalid":
      return templates.pipedrive_value_invalid(s(a, "field"), s(a, "value"));
    case "pipedrive_value_too_long":
      return templates.pipedrive_value_too_long(s(a, "field"), n(a, "max"));
    case "pipedrive_currency":
      return templates.pipedrive_currency(s(a, "field"), s(a, "currency"));
    case "pipedrive_org_archived":
      return templates.pipedrive_org_archived(s(a, "name"));
    case "pipedrive_org_not_imported":
      return templates.pipedrive_org_not_imported(s(a, "name"));
    case "import_too_long":
      return templates.import_too_long(s(a, "field"), n(a, "max"));
    case "pipedrive_field_no_match":
      return templates.pipedrive_field_no_match(s(a, "name"));
    case "pipedrive_field_type_mismatch":
      return templates.pipedrive_field_type_mismatch(s(a, "name"), s(a, "pd"), s(a, "crm"));
    case "pipedrive_field_unsupported":
      return templates.pipedrive_field_unsupported(s(a, "name"), s(a, "pd"));
    default:
      return messageFor(item.code) ?? "";
  }
}

export type Line = { text: string };

// Every line of the report below the "// NOT IMPORTED" table, in a fixed order: owners, private and owner-only counts,
// lists, custom fields, choices, linked records, unsubscribed people, then the warnings on single records.
export function reportLines(report: Report, names: Names): Line[] {
  const lines: Line[] = [];
  for (const o of Object.values(report.owners)) lines.push({ text: templates.pipedrive_owner_missing(o.name, o.email, o.records) });
  if (report.privateOthers > 0) lines.push({ text: templates.pipedrive_private_others(report.privateOthers) });
  if (report.ownerOnlyOrganisations > 0) lines.push({ text: templates.pipedrive_owner_only_orgs(report.ownerOnlyOrganisations) });
  for (const l of report.lists) lines.push({ text: templates.pipedrive_list_missing(l.list, l.value, l.records) });
  for (const f of report.fields) lines.push({ text: itemText(f, names) });
  for (const c of report.choices) lines.push({ text: templates.pipedrive_choice_missing(c.field, c.value, c.records) });
  for (const l of report.linked) {
    if (l.kind === "person") {
      const name = names.people.get(l.personId);
      lines.push({ text: name === undefined ? (messageFor("pipedrive_linked_hidden") ?? "") : templates.pipedrive_linked(name) });
    } else {
      const name = names.organisations.get(l.organisationId);
      if (name !== undefined) lines.push({ text: templates.pipedrive_linked(name) });
    }
  }
  for (const u of report.unsubscribed) {
    const name = names.people.get(u.personId);
    lines.push({ text: name === undefined ? (messageFor("pipedrive_unsubscribed_hidden") ?? "") : templates.pipedrive_unsubscribed(name) });
  }
  return lines;
}

// A warning on one record: "<Kind> · <Pipedrive name>: <text>" parts, kept apart so the page shows the name as data.
export function warningLines(report: Report, names: Names): { kind: RecordKind; label: string; text: string }[] {
  return report.warnings.map((w) => ({ kind: w.kind, label: w.label, text: itemText(w, names) }));
}
