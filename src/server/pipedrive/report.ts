// The report of a Pipedrive import (SF-117 data-model.md § Report, § Counts): built up part by part under the import
// row's lock (mergeReport, pure), and turned into lines at display time (reportLines, pure) from messages.ts codes only.
// Pipedrive values appear only inside quotes; CRM people are named only when the viewer can see them (namesForReport,
// through visiblePerson(): FR-019).
// SF-122: the same report for deals, notes, activities and files (data-model.md § Counts and report): pipelines and
// stages added, activity types imported as tasks, records on Pipedrive leads, projects and emails, private counts. CRM
// deals are named only through visibleDeal() ("a private deal" otherwise), people through visiblePerson().
import { sql } from "@/server/db";
import { messageFor, templates, type TemplateCode } from "@/server/messages";
import type { FieldNotImported } from "@/server/pipedrive/rules";
import type { ChoiceMiss, LinkedItem, ListMiss, OwnerMiss, RecordKind, ReportItem } from "@/server/pipedrive/page";
import type { Elsewhere, PipelinesReport, TypeCount } from "@/server/pipedrive/records-page";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

export type KindCounts = { imported: number; linked: number; already: number; notImported: number };
export type Counts = {
  organisations: KindCounts;
  people: KindCounts;
  deals: KindCounts;
  notes: KindCounts;
  activities: KindCounts;
  files: KindCounts;
};
export const COUNT_KINDS = ["organisations", "people", "deals", "notes", "activities", "files"] as const;
export const COUNT_OF: Record<RecordKind, keyof Counts> = {
  organisation: "organisations", person: "people", deal: "deals", note: "notes", activity: "activities", file: "files",
};
export type PrivateOn = { notes: number; activities: number; files: number };
export type Report = PipelinesReport & {
  activityTypes: TypeCount[];
  elsewhere: Elsewhere[];
  // Private deals of other owners imported (counted, never named).
  privateDeals: number;
  // Notes, activities and files put on private records of other owners.
  privateOn: PrivateOn;
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
export const emptyCounts = (): Counts => ({ organisations: zero(), people: zero(), deals: zero(), notes: zero(), activities: zero(), files: zero() });
export const emptyReport = (): Report => ({
  notImported: [], linked: [], owners: {}, lists: [], fields: [], choices: [], warnings: [], unsubscribed: [], privateOthers: 0, ownerOnlyOrganisations: 0,
  pipelinesAdded: [], stagesAdded: [], merged: [], notCreated: [], activityTypes: [], elsewhere: [], privateDeals: 0,
  privateOn: { notes: 0, activities: 0, files: 0 },
});

// A stored report or counts, filled in with what an older (SF-117) or partial row lacks.
export const readReport = (raw: unknown): Report => {
  const r = (raw ?? {}) as Partial<Report>;
  return { ...emptyReport(), ...r, privateOn: { notes: 0, activities: 0, files: 0, ...r.privateOn } };
};
export const readCounts = (raw: unknown): Counts => {
  const c = (raw ?? {}) as Partial<Counts>;
  return Object.fromEntries(COUNT_KINDS.map((k) => [k, { ...zero(), ...c[k] }])) as Counts;
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
  // SF-122
  pipelines?: PipelinesReport;
  activityTypes?: TypeCount[];
  elsewhere?: Elsewhere[];
  privateDeals?: number;
  privateOn?: Partial<PrivateOn>;
};

export function mergeReport(report: Report, counts: Counts, page: PageReport): void {
  const c = counts[COUNT_OF[page.kind]];
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
  if (page.pipelines) {
    report.pipelinesAdded.push(...page.pipelines.pipelinesAdded);
    report.stagesAdded.push(...page.pipelines.stagesAdded);
    report.merged.push(...page.pipelines.merged);
    report.notCreated.push(...page.pipelines.notCreated);
  }
  for (const t of page.activityTypes ?? []) {
    const cur = report.activityTypes.find((x) => x.type === t.type);
    if (cur) cur.records += t.records;
    else report.activityTypes.push({ ...t });
  }
  for (const e of page.elsewhere ?? []) {
    const cur = report.elsewhere.find((x) => x.kind === e.kind && x.on === e.on);
    if (cur) cur.records += e.records;
    else report.elsewhere.push({ ...e });
  }
  report.privateDeals += page.privateDeals ?? 0;
  for (const k of ["notes", "activities", "files"] as const) report.privateOn[k] += page.privateOn?.[k] ?? 0;
}

export type Names = { people: Map<number, string>; organisations: Map<number, string>; deals: Map<number, string> };

const argIds = (items: ReportItem[], name: string) => items.flatMap((n) => (typeof n.args?.[name] === "number" ? [n.args[name] as number] : []));

// Names of the CRM records the report refers to: a person or deal only when the viewer can see them.
export async function namesForReport(viewerId: number, report: Report): Promise<Names> {
  const items = [...report.notImported, ...report.warnings];
  const personIds = [
    ...new Set([
      ...report.linked.flatMap((l) => (l.kind === "person" ? [l.personId] : [])),
      ...report.unsubscribed.map((u) => u.personId),
      ...argIds(items, "personId"),
      ...argIds(items, "onPerson"),
    ]),
  ];
  const orgIds = [...new Set([...report.linked.flatMap((l) => (l.kind === "organisation" ? [l.organisationId] : [])), ...argIds(items, "onOrganisation")])];
  const dealIds = [...new Set(argIds(items, "onDeal"))];
  const people = personIds.length === 0 ? [] : await sql<{ id: number; name: string }[]>`
    select p.id::int as id, btrim(p.first_name || ' ' || p.last_name) as name from persons p
    where p.id = any(${personIds}::bigint[]) and ${visiblePerson(sql, viewerId)}`;
  const orgs = orgIds.length === 0 ? [] : await sql<{ id: number; name: string }[]>`
    select id::int as id, name from organisations where id = any(${orgIds}::bigint[])`;
  const deals = dealIds.length === 0 ? [] : await sql<{ id: number; title: string }[]>`
    select d.id::int as id, d.title from deals d where d.id = any(${dealIds}::bigint[]) and ${visibleDeal(sql, viewerId)}`;
  return {
    people: new Map(people.map((p) => [p.id, p.name])),
    organisations: new Map(orgs.map((o) => [o.id, o.name])),
    deals: new Map(deals.map((d) => [d.id, d.title])),
  };
}

// The record a reason is about, as the viewer may see it: a hidden deal or person is "a private deal / person".
function onRecordName(a: Args, names: Names): string | null {
  if (a?.onDeal !== undefined) return names.deals.get(Number(a.onDeal)) ?? messageFor("pipedrive_private_deal") ?? "";
  if (a?.onPerson !== undefined) return names.people.get(Number(a.onPerson)) ?? messageFor("pipedrive_private_person") ?? "";
  if (a?.onOrganisation !== undefined) return names.organisations.get(Number(a.onOrganisation)) ?? null;
  return null;
}

type Args = Record<string, string | number> | undefined;
const s = (args: Args, name: string) => String(args?.[name] ?? "");
const n = (args: Args, name: string) => Number(args?.[name] ?? 0);

// The text of a reason or warning code (fixed messages, or templates with the stored arguments), followed by the CRM
// record it is about when there is one.
export function itemText(item: { code: string; args?: Args }, names: Names): string {
  const text = codeText(item, names);
  const on = onRecordName(item.args, names);
  return on === null ? text : templates.pipedrive_on_record(text, on);
}

function codeText(item: { code: string; args?: Args }, names: Names): string {
  const a = item.args;
  switch (item.code as TemplateCode) {
    case "pipedrive_pipeline_not_created":
      return templates.pipedrive_pipeline_not_created(s(a, "name"));
    case "pipedrive_stage_not_created":
      return templates.pipedrive_stage_not_created(s(a, "name"));
    case "pipedrive_person_not_imported":
      return templates.pipedrive_person_not_imported(s(a, "name"));
    case "pipedrive_organisation_not_imported":
      return templates.pipedrive_organisation_not_imported(s(a, "name"));
    case "pipedrive_deal_not_imported":
      return templates.pipedrive_deal_not_imported(s(a, "name"));
    case "pipedrive_target_deleted": {
      const kind = s(a, "kind");
      return templates.pipedrive_target_deleted(kind === "deal" || kind === "person" ? kind : "organisation");
    }
    case "pipedrive_deal_currency":
      return templates.pipedrive_deal_currency(s(a, "currency"));
    case "pipedrive_participant_left_out":
      return templates.pipedrive_participant_left_out(s(a, "name"));
    case "pipedrive_file_too_large":
      return templates.pipedrive_file_too_large(s(a, "mb"));
    case "pipedrive_duration_left_out":
      return templates.pipedrive_duration_left_out(s(a, "text"));
    case "file_name_too_long":
      return templates.file_name_too_long(a?.privateKind !== undefined ? itemLabel({ label: "", args: a }) : s(a, "name"));
    case "pipedrive_email_other_person": {
      if (a?.privatePerson !== undefined) return messageFor("pipedrive_email_other_hidden") ?? "";
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

// "// PIPELINES": the pipelines and stages added, the merges and the names not created (SF-122 FR-004).
export function pipelineLines(report: Report): Line[] {
  return [
    ...report.pipelinesAdded.map((p) => ({ text: templates.pipedrive_pipeline_added(p.name, p.stages) })),
    ...report.stagesAdded.map((st) => ({ text: templates.pipedrive_stage_added(st.stage, st.pipeline) })),
    ...report.merged.map((m) => ({ text: m.kind === "pipeline" ? templates.pipedrive_pipelines_merged(m.a, m.b) : templates.pipedrive_stages_merged(m.a, m.b) })),
    ...report.notCreated.map((x) => ({ text: templates.pipedrive_name_not_created(x.kind, x.name) })),
  ];
}

const ELSEWHERE_ORDER = (["note", "activity", "file"] as const).flatMap((kind) => (["lead", "project", "email"] as const).map((on) => ({ kind, on })));

// Every line of the report below the "// NOT IMPORTED" table, in a fixed order: owners, private people, private deals,
// private notes / activities / files, owner-only organisations, lists, custom fields, choices, activity types imported
// as tasks, records on Pipedrive leads / projects / emails, linked records, unsubscribed people.
export function reportLines(report: Report, names: Names): Line[] {
  const lines: Line[] = [];
  for (const o of Object.values(report.owners)) lines.push({ text: templates.pipedrive_owner_missing(o.name, o.email, o.records) });
  if (report.privateOthers > 0) lines.push({ text: templates.pipedrive_private_others(report.privateOthers) });
  if (report.privateDeals > 0) lines.push({ text: templates.pipedrive_private_deals(report.privateDeals) });
  for (const [k, kind] of [["notes", "note"], ["activities", "activity"], ["files", "file"]] as const) {
    if (report.privateOn[k] > 0) lines.push({ text: templates.pipedrive_private_on(kind, report.privateOn[k]) });
  }
  if (report.ownerOnlyOrganisations > 0) lines.push({ text: templates.pipedrive_owner_only_orgs(report.ownerOnlyOrganisations) });
  for (const l of report.lists) lines.push({ text: templates.pipedrive_list_missing(l.list, l.value, l.records) });
  for (const f of report.fields) lines.push({ text: itemText(f, names) });
  for (const c of report.choices) lines.push({ text: templates.pipedrive_choice_missing(c.field, c.value, c.records) });
  for (const t of report.activityTypes) lines.push({ text: templates.pipedrive_types_as_tasks(t.name, t.records) });
  for (const { kind, on } of ELSEWHERE_ORDER) {
    const e = report.elsewhere.find((x) => x.kind === kind && x.on === on);
    if (e && e.records > 0) lines.push({ text: templates.pipedrive_elsewhere(kind, on, e.records) });
  }
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
  return report.warnings.map((w) => ({ kind: w.kind, label: itemLabel(w), text: itemText(w, names) }));
}

// The name a report item shows: its Pipedrive name, or "a private deal / person / note / activity / file" for a record
// private to another owner or put on a record the viewer cannot see (FR-021).
export function itemLabel(item: { label: string; args?: Args }): string {
  const k = item.args?.privateKind;
  return k === undefined ? item.label : (messageFor(`pipedrive_private_${k}`) ?? "");
}
