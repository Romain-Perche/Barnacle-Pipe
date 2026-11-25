// What saving one Pipedrive page will do (SF-117 research.md §6, data-model.md § Report). Pure: the import engine loads
// the lookups inside the page's transaction (tables locked), plans, then writes exactly this plan. Existing CRM records
// are referred to by id only; people's names are loaded at display time through visiblePerson() (FR-019).
// - a Pipedrive record with a link → already imported (left as it is, except the unsubscribe rule);
// - an organisation whose name a CRM organisation has, or a person whose email exactly one CRM person has → linked;
// - else added, or not imported with the reason. Deleted Pipedrive records are passed over and not counted.
import type { CustomValue } from "@/server/custom-fields/rules";
import type { PdOrganization, PdPerson } from "@/server/pipedrive/api";
import {
  isOwnerOnly,
  organisationFromPipedrive,
  parseAddTime,
  personFromPipedrive,
  type FieldNotImported,
  type FieldsPlan,
  type Problem,
} from "@/server/pipedrive/rules";
import { isValidEmail, normaliseEmail, type Consent, type OrganisationFields, type PersonFields } from "@/server/records/rules";

export type RecordKind = "person" | "organisation" | "deal" | "note" | "activity" | "file";
// A record of the report: its Pipedrive id and name (as data), and the reason or warning as a message code.
export type ReportItem = { kind: RecordKind; pipedriveId: number; label: string; code: string; args?: Record<string, string | number> };
export type LinkedItem = { kind: "person"; personId: number; pipedriveId: number } | { kind: "organisation"; organisationId: number; pipedriveId: number };
export type ListMiss = { list: "lead_source" | "label" | "deal_label"; value: string; records: number };
export type ChoiceMiss = { kind: RecordKind; field: string; value: string; records: number };
export type OwnerMiss = { name: string; email: string; records: number };
export type PdUsers = Record<string, { name: string; email: string }>;
type CustomToAdd = { fieldId: number; value: CustomValue }[];

type PlanBase = {
  // Records read from this page (deleted ones excepted): what "<done> of <total>" counts.
  done: number;
  already: number;
  notImported: ReportItem[];
  warnings: ReportItem[];
  linked: LinkedItem[];
  lists: ListMiss[];
  choices: ChoiceMiss[];
  owners: Record<string, OwnerMiss>;
  fields: FieldNotImported[];
};

const key = (text: string) => text.trim().toLowerCase();

export class Counter<T extends { records: number }> {
  private map = new Map<string, T>();
  add(k: string, make: () => Omit<T, "records">) {
    const cur = this.map.get(k) ?? ({ ...make(), records: 0 } as T);
    cur.records += 1;
    this.map.set(k, cur);
  }
  list(): T[] {
    return [...this.map.values()];
  }
}

// The CRM owner of a Pipedrive owner: the active CRM user with that email, else the importer (counted per owner).
export function ownerOf(pdOwner: number | null, users: Map<string, number>, pdUsers: PdUsers, importerId: number, owners: Record<string, OwnerMiss>): number {
  if (pdOwner === null) return importerId;
  const u = pdUsers[String(pdOwner)];
  const id = u ? users.get(key(u.email)) : undefined;
  if (id !== undefined) return id;
  const k = String(pdOwner);
  owners[k] ??= { name: u?.name ?? `#${pdOwner}`, email: u?.email ?? "", records: 0 };
  owners[k].records += 1;
  return importerId;
}

export const toItem = (kind: RecordKind, pipedriveId: number, label: string, p: Problem): ReportItem =>
  p.args === undefined ? { kind, pipedriveId, label, code: p.code } : { kind, pipedriveId, label, code: p.code, args: p.args };

// SF-122 FR-021: a record private to another owner, or put on a record the importer cannot see, is never named in the
// report: no label, `privateKind` (shown as "a private deal", "a private note"…), and no argument taken from the record
// itself (its file name, an invalid value of it).
export type PrivateKind = "deal" | "person" | "note" | "activity" | "file";
export function privateItem(kind: RecordKind, pipedriveId: number, privateKind: PrivateKind, p: Problem): ReportItem {
  const args: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p.args ?? {})) {
    if (k === "value") args[k] = "…";
    else if (!(k === "name" && p.code === "file_name_too_long")) args[k] = v;
  }
  return { kind, pipedriveId, label: "", code: p.code, args: { ...args, privateKind } };
}
// toItem, or privateItem when `hidden`.
export const itemFor = (kind: RecordKind, pipedriveId: number, label: string, p: Problem, hidden: PrivateKind | null): ReportItem =>
  hidden === null ? toItem(kind, pipedriveId, label, p) : privateItem(kind, pipedriveId, hidden, p);

// ---------------------------------------------------------------- organisations

export type OrgLookups = {
  importerId: number;
  // Pipedrive organisation ids of this company that already have a link.
  linked: Set<number>;
  // CRM organisations by lower(btrim(name)), archived included.
  organisations: Map<string, { id: number; name: string; archived: boolean }>;
  // Active CRM users by lower(email).
  users: Map<string, number>;
  pdUsers: PdUsers;
  fields: FieldsPlan;
};
export type OrgAdd = { pipedriveId: number; label: string; fields: OrganisationFields & { ownerId: number }; custom: CustomToAdd };
export type OrgPlan = PlanBase & {
  adds: OrgAdd[];
  // `add`: the index of an organisation added by this page (two Pipedrive organisations with one name).
  links: { pipedriveId: number; target: { id: number } | { add: number } }[];
  // Owner-only organisations imported (as shared).
  ownerOnly: number;
};

export function planOrganisationPage(records: PdOrganization[], l: OrgLookups): OrgPlan {
  const plan: OrgPlan = { done: 0, already: 0, notImported: [], warnings: [], linked: [], lists: [], choices: [], owners: {}, fields: l.fields.notImported, adds: [], links: [], ownerOnly: 0 };
  const choices = new Counter<ChoiceMiss>();
  const added = new Map<string, number>();
  for (const o of records) {
    if (o.deleted) continue;
    plan.done += 1;
    if (l.linked.has(o.id)) {
      plan.already += 1;
      continue;
    }
    const k = key(o.name);
    const existing = k === "" ? undefined : l.organisations.get(k);
    if (existing) {
      plan.links.push({ pipedriveId: o.id, target: { id: existing.id } });
      plan.linked.push({ kind: "organisation", organisationId: existing.id, pipedriveId: o.id });
      if (existing.archived) plan.warnings.push(toItem("organisation", o.id, o.name.trim(), { code: "pipedrive_org_archived", args: { name: existing.name } }));
      continue;
    }
    if (k !== "" && added.has(k)) {
      plan.links.push({ pipedriveId: o.id, target: { add: added.get(k)! } });
      continue;
    }
    const r = organisationFromPipedrive(o, l.fields);
    if (!r.ok) {
      plan.notImported.push(toItem("organisation", o.id, r.label, r.problem));
      continue;
    }
    const ownerId = ownerOf(o.ownerId, l.users, l.pdUsers, l.importerId, plan.owners);
    if (isOwnerOnly(o.visibleTo)) plan.ownerOnly += 1;
    for (const w of r.warnings) plan.warnings.push(toItem("organisation", o.id, r.label, w));
    for (const m of r.missingChoices) choices.add(`${key(m.field)}\u0000${key(m.value)}`, () => ({ kind: "organisation", field: m.field, value: m.value }));
    added.set(k, plan.adds.length);
    plan.adds.push({ pipedriveId: o.id, label: r.label, fields: { ...r.fields, ownerId }, custom: r.custom });
  }
  plan.choices = choices.list();
  return plan;
}

// ---------------------------------------------------------------- people

export type PersonLookups = {
  importerId: number;
  // Pipedrive person ids of this company that already have a link → the CRM person (null once deleted).
  links: Map<number, number | null>;
  // Email addresses of the page → the CRM people who have them (archived and private included).
  emails: Map<string, number[]>;
  // CRM people (matched by email) → the Pipedrive person of this company already linked to them.
  linkedFrom: Map<number, number>;
  // Consent of the CRM people linked or matched.
  consents: Map<number, Consent>;
  // Pipedrive organisation ids → the CRM organisation (null: none, e.g. deleted in the CRM).
  organisations: Map<number, number | null>;
  // Pipedrive organisations refused by this part → their Pipedrive name.
  orgsNotImported: Map<number, string>;
  leadSources: Map<string, number>;
  labels: Map<string, number>;
  users: Map<string, number>;
  pdUsers: PdUsers;
  fields: FieldsPlan;
  // The user's choice for people with no consent status in Pipedrive.
  consent: Consent;
};
export type PersonAdd = {
  pipedriveId: number;
  label: string;
  fields: PersonFields;
  organisationId: number | null;
  ownerId: number;
  createdBy: number;
  private: boolean;
  leadSourceId: number | null;
  labelIds: number[];
  createdAt: Date | null;
  custom: CustomToAdd;
};
export type PersonPlan = PlanBase & {
  adds: PersonAdd[];
  links: { pipedriveId: number; personId: number }[];
  // Existing CRM people (linked now or before) to make Unsubscribed (FR-018).
  unsubscribe: number[];
  // Private people imported whose owner is not the importer (counted, never named).
  privateOthers: number;
};

// The person's valid email addresses, normalised (what matching uses).
function emailsOf(p: PdPerson): string[] {
  return [...new Set(p.emails.map((e) => normaliseEmail(e.value)).filter((e) => e !== "" && isValidEmail(e)))];
}

export function planPersonPage(records: PdPerson[], l: PersonLookups): PersonPlan {
  const plan: PersonPlan = {
    done: 0, already: 0, notImported: [], warnings: [], linked: [], lists: [], choices: [], owners: {}, fields: l.fields.notImported,
    adds: [], links: [], unsubscribe: [], privateOthers: 0,
  };
  const lists = new Counter<ListMiss>();
  const choices = new Counter<ChoiceMiss>();
  // Emails and CRM people taken by an earlier person of this page → that person's Pipedrive name.
  // null: a person private to another owner (never named, FR-021).
  const pageEmails = new Map<string, string | null>();
  const claimed = new Map<number, string>();
  const unsubscribe = (personId: number | null, p: PdPerson) => {
    if (personId === null || p.marketingStatus !== "unsubscribed") return;
    if (l.consents.get(personId) === "subscribed" && !plan.unsubscribe.includes(personId)) plan.unsubscribe.push(personId);
  };
  const nameOf = (p: PdPerson) => `${p.firstName} ${p.lastName}`.trim() || p.name.trim() || p.emails[0]?.value.trim() || `#${p.id}`;

  for (const p of records) {
    if (p.deleted) continue;
    plan.done += 1;
    if (l.links.has(p.id)) {
      plan.already += 1;
      unsubscribe(l.links.get(p.id)!, p);
      continue;
    }
    const label = nameOf(p);
    const notImported = (problem: Problem) => plan.notImported.push(toItem("person", p.id, label, problem));
    const emails = emailsOf(p);
    const earlier = emails.map((e) => pageEmails.get(e)).find((n) => n !== undefined);
    if (earlier !== undefined) {
      notImported(earlier === null ? { code: "pipedrive_email_other_person", args: { privatePerson: 1 } } : { code: "pipedrive_email_other_person", args: { name: earlier } });
      continue;
    }
    const matches = [...new Set(emails.flatMap((e) => l.emails.get(e) ?? []))];
    if (matches.length > 1) {
      notImported({ code: "pipedrive_email_many_people" });
      continue;
    }
    if (matches.length === 1) {
      const personId = matches[0];
      if (claimed.has(personId)) {
        notImported({ code: "pipedrive_email_other_person", args: { name: claimed.get(personId)! } });
        continue;
      }
      const from = l.linkedFrom.get(personId);
      if (from !== undefined && from !== p.id) {
        notImported({ code: "pipedrive_email_other_person", args: { personId } });
        continue;
      }
      plan.links.push({ pipedriveId: p.id, personId });
      plan.linked.push({ kind: "person", personId, pipedriveId: p.id });
      claimed.set(personId, label);
      for (const e of emails) pageEmails.set(e, label);
      unsubscribe(personId, p);
      continue;
    }
    const r = personFromPipedrive(p, l.fields, l.consent);
    if (!r.ok) {
      notImported(r.problem);
      continue;
    }
    const ownerId = ownerOf(p.ownerId, l.users, l.pdUsers, l.importerId, plan.owners);
    const isPrivate = isOwnerOnly(p.visibleTo);
    const privateOther = isPrivate && ownerId !== l.importerId;
    if (privateOther) plan.privateOthers += 1;
    const hidden = privateOther ? ("person" as const) : null;
    let organisationId: number | null = null;
    if (p.orgId !== null) {
      organisationId = l.organisations.get(p.orgId) ?? null;
      if (organisationId === null && l.orgsNotImported.has(p.orgId)) {
        plan.warnings.push(itemFor("person", p.id, r.label, { code: "pipedrive_org_not_imported", args: { name: l.orgsNotImported.get(p.orgId)! } }, hidden));
      }
    }
    let leadSourceId: number | null = null;
    if (r.leadSource !== null) {
      leadSourceId = l.leadSources.get(key(r.leadSource)) ?? null;
      if (leadSourceId === null) lists.add(`lead_source\u0000${key(r.leadSource)}`, () => ({ list: "lead_source", value: r.leadSource!.trim() }));
    }
    const labelIds: number[] = [];
    for (const name of r.labels) {
      const id = l.labels.get(key(name));
      if (id === undefined) lists.add(`label\u0000${key(name)}`, () => ({ list: "label", value: name.trim() }));
      else if (!labelIds.includes(id)) labelIds.push(id);
    }
    for (const w of r.warnings) plan.warnings.push(itemFor("person", p.id, r.label, w, hidden));
    for (const m of r.missingChoices) choices.add(`${key(m.field)}\u0000${key(m.value)}`, () => ({ kind: "person", field: m.field, value: m.value }));
    for (const e of emails) pageEmails.set(e, privateOther ? null : r.label);
    plan.adds.push({
      pipedriveId: p.id,
      label: r.label,
      fields: r.fields,
      organisationId,
      ownerId,
      createdBy: isPrivate ? ownerId : l.importerId,
      private: isPrivate,
      leadSourceId,
      labelIds: labelIds.sort((a, b) => a - b),
      createdAt: parseAddTime(p.addTime),
      custom: r.custom,
    });
  }
  plan.lists = lists.list().sort((a, b) => a.list.localeCompare(b.list));
  plan.choices = choices.list();
  return plan;
}
