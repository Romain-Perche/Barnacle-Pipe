// What saving one page of Pipedrive deals, notes or activities, or one file, will do (SF-122 research.md §4–§9). Pure:
// the import engine loads the lookups inside the page's transaction (tables locked), plans, then writes exactly this
// plan, as page.ts does for people and organisations.
// - a Pipedrive record with a link → already imported (left as it is, even if changed or deleted in the CRM since);
// - a deal, note, activity or file whose record (deal, person, organisation) the import did not bring in → not
//   imported, with the reason, and no link: a later import can bring it in;
// - on a Pipedrive lead or project (or an email, for files) → counted, not imported;
// - else added. Deleted Pipedrive records are passed over and not counted.
import type { PdActivity, PdDeal, PdFile, PdNote, PdPipeline, PdStage } from "@/server/pipedrive/api";
import {
  activityFromPipedrive,
  dealFromPipedrive,
  fileCheck,
  noteFromPipedrive,
  notePreview,
  targetOf,
  type ActivityValues,
  type DealValues,
  type StageMap,
} from "@/server/pipedrive/deal-rules";
import { Counter, itemFor, ownerOf, toItem, type ChoiceMiss, type ListMiss, type OwnerMiss, type PdUsers, type RecordKind, type ReportItem } from "@/server/pipedrive/page";
import { parseAddTime, type FieldNotImported, type FieldsPlan, type Problem } from "@/server/pipedrive/rules";
import type { CustomValue } from "@/server/custom-fields/rules";

const key = (text: string) => text.trim().toLowerCase();
const MAX_NAME = 100;

// ---------------------------------------------------------------- pipelines and stages (research.md §4)

export type CrmPipelines = { pipelines: { id: number; name: string; position: number }[]; stages: { id: number; pipelineId: number; name: string; position: number }[] };
export type StageRef = { stageId: number } | { newPipeline: number; stage: number } | { newStage: number } | { problem: Problem };
export type PipelinesReport = {
  pipelinesAdded: { name: string; stages: number }[];
  stagesAdded: { pipeline: string; stage: string }[];
  merged: { kind: "pipeline" | "stage"; a: string; b: string }[];
  notCreated: { kind: "pipeline" | "stage"; name: string }[];
};
export type PipelinesPlan = {
  newPipelines: { name: string; position: number; stages: string[] }[];
  newStages: { pipelineId: number; name: string; position: number }[];
  stageMap: Record<string, StageRef>;
  report: PipelinesReport;
};

const inOrder = <T extends { order: number; id: number }>(list: T[]) => [...list].sort((a, b) => a.order - b.order || a.id - b.id);

// Every active Pipedrive pipeline and stage matched to the CRM's by name (ignoring case and surrounding spaces), or
// created at the end. Inserts only: nothing is renamed, reordered or deleted.
export function planPipelines(pdPipelines: PdPipeline[], pdStages: PdStage[], crm: CrmPipelines): PipelinesPlan {
  const plan: PipelinesPlan = { newPipelines: [], newStages: [], stageMap: {}, report: { pipelinesAdded: [], stagesAdded: [], merged: [], notCreated: [] } };
  let nextPipeline = Math.max(0, ...crm.pipelines.map((p) => p.position)) + 1;
  // A target pipeline: an existing CRM one (id) or one created by this plan (index), with its stages by name key.
  type Target = { ref: { id: number; name: string } | { index: number }; stages: Map<string, { ref: StageRef; pdPipeline: number; name: string }>; next: number };
  const targets = new Map<string, Target & { firstName: string }>();
  for (const p of inOrder(pdPipelines.filter((x) => !x.deleted))) {
    const k = key(p.name);
    const stages = inOrder(pdStages.filter((s) => s.pipelineId === p.id && !s.deleted));
    if (k === "" || p.name.trim().length > MAX_NAME) {
      if (k !== "") plan.report.notCreated.push({ kind: "pipeline", name: p.name.trim() });
      for (const s of stages) plan.stageMap[s.id] = { problem: { code: "pipedrive_pipeline_not_created", args: { name: p.name.trim() } } };
      continue;
    }
    let t = targets.get(k);
    if (t) plan.report.merged.push({ kind: "pipeline", a: t.firstName, b: p.name });
    else {
      const existing = crm.pipelines.find((x) => key(x.name) === k);
      if (existing) {
        const own = crm.stages.filter((s) => s.pipelineId === existing.id);
        t = {
          ref: { id: existing.id, name: existing.name },
          stages: new Map(own.map((s) => [key(s.name), { ref: { stageId: s.id }, pdPipeline: -1, name: s.name }])),
          next: Math.max(0, ...own.map((s) => s.position)) + 1,
          firstName: p.name,
        };
      } else {
        plan.newPipelines.push({ name: p.name.trim(), position: nextPipeline++, stages: [] });
        t = { ref: { index: plan.newPipelines.length - 1 }, stages: new Map(), next: 1, firstName: p.name };
      }
      targets.set(k, t);
    }
    for (const s of stages) {
      const sk = key(s.name);
      if (sk === "" || s.name.trim().length > MAX_NAME) {
        if (sk !== "") plan.report.notCreated.push({ kind: "stage", name: s.name.trim() });
        plan.stageMap[s.id] = { problem: { code: "pipedrive_stage_not_created", args: { name: s.name.trim() } } };
        continue;
      }
      const seen = t.stages.get(sk);
      if (seen) {
        if (seen.pdPipeline === p.id) plan.report.merged.push({ kind: "stage", a: seen.name, b: s.name });
        plan.stageMap[s.id] = seen.ref;
        continue;
      }
      let ref: StageRef;
      if ("index" in t.ref) {
        const np = plan.newPipelines[t.ref.index];
        np.stages.push(s.name.trim());
        ref = { newPipeline: t.ref.index, stage: np.stages.length - 1 };
      } else {
        plan.newStages.push({ pipelineId: t.ref.id, name: s.name.trim(), position: t.next++ });
        plan.report.stagesAdded.push({ pipeline: t.ref.name, stage: s.name.trim() });
        ref = { newStage: plan.newStages.length - 1 };
      }
      t.stages.set(sk, { ref, pdPipeline: p.id, name: s.name });
      plan.stageMap[s.id] = ref;
    }
  }
  plan.report.pipelinesAdded = plan.newPipelines.map((p) => ({ name: p.name, stages: p.stages.length }));
  return plan;
}

// ---------------------------------------------------------------- shared

// A Pipedrive deal, person or organisation → its CRM record (null: deleted in the CRM since); absent: not brought in.
export type Links = { deals: Map<number, number | null>; persons: Map<number, number | null>; organisations: Map<number, number | null> };
type Kind3 = "deal" | "person" | "organisation";
const LINK_MAP = { deal: "deals", person: "persons", organisation: "organisations" } as const;
const NOT_IMPORTED = { deal: "pipedrive_deal_not_imported", person: "pipedrive_person_not_imported", organisation: "pipedrive_organisation_not_imported" } as const;

// The CRM record of a Pipedrive one, or why there is none. `names`: "<kind>:<Pipedrive id>" → its name in the report.
function resolve(kind: Kind3, pdId: number, links: Links, names: Map<string, string>): { id: number } | { problem: Problem } {
  const map = links[LINK_MAP[kind]];
  if (!map.has(pdId)) return { problem: { code: NOT_IMPORTED[kind], args: { name: names.get(`${kind}:${pdId}`) ?? `#${pdId}` } } };
  const id = map.get(pdId)!;
  return id === null ? { problem: { code: "pipedrive_target_deleted", args: { kind } } } : { id };
}

export type Elsewhere = { kind: "note" | "activity" | "file"; on: "lead" | "project" | "email"; records: number };
export type TypeCount = { type: string; name: string; records: number };
type CrmTarget = { dealId: number | null; personId: number | null; organisationId: number | null };
const crmTarget = (kind: Kind3, id: number): CrmTarget => ({ dealId: kind === "deal" ? id : null, personId: kind === "person" ? id : null, organisationId: kind === "organisation" ? id : null });

type Base = {
  done: number;
  already: number;
  notImported: ReportItem[];
  warnings: ReportItem[];
  owners: Record<string, OwnerMiss>;
};
const base = (): Base => ({ done: 0, already: 0, notImported: [], warnings: [], owners: {} });

// ---------------------------------------------------------------- deals (research.md §5)

export type DealLookups = {
  importerId: number;
  // Pipedrive deal ids already linked.
  linked: Set<number>;
  links: Links;
  names: Map<string, string>;
  stageMap: StageMap;
  users: Map<string, number>;
  pdUsers: PdUsers;
  labels: Map<string, number>;
  fields: FieldsPlan;
  // Read for this page (outside the transaction): the deal's participants and followers.
  participants: Map<number, { personId: number; name: string }[]>;
  followers: Map<number, number[]>;
  now: Date;
};
export type DealAdd = {
  pipedriveId: number;
  label: string;
  deal: DealValues;
  personId: number | null;
  organisationId: number | null;
  otherPeople: number[];
  followers: number[];
  labelIds: number[];
  custom: { fieldId: number; value: CustomValue }[];
};
export type DealPlan = Base & { adds: DealAdd[]; lists: ListMiss[]; choices: ChoiceMiss[]; fields: FieldNotImported[]; privateDeals: number };

export function planDealPage(items: PdDeal[], l: DealLookups): DealPlan {
  const plan: DealPlan = { ...base(), adds: [], lists: [], choices: [], fields: l.fields.notImported, privateDeals: 0 };
  const lists = new Counter<ListMiss>();
  const choices = new Counter<ChoiceMiss>();
  for (const d of items) {
    if (d.deleted) continue;
    plan.done += 1;
    if (l.linked.has(d.id)) {
      plan.already += 1;
      continue;
    }
    const label = d.title.trim() || `#${d.id}`;
    const refuse = (p: Problem) => plan.notImported.push(toItem("deal", d.id, label, p));
    let personId: number | null = null;
    let organisationId: number | null = null;
    if (d.personId !== null) {
      const r = resolve("person", d.personId, l.links, l.names);
      if ("problem" in r) {
        refuse(r.problem);
        continue;
      }
      personId = r.id;
    }
    if (d.orgId !== null) {
      const r = resolve("organisation", d.orgId, l.links, l.names);
      if ("problem" in r) {
        refuse(r.problem);
        continue;
      }
      organisationId = r.id;
    }
    const owners: Record<string, OwnerMiss> = {};
    const r = dealFromPipedrive(d, { importerId: l.importerId, users: l.users, pdUsers: l.pdUsers, owners, stageMap: l.stageMap, labels: l.labels, fields: l.fields, now: l.now });
    if (!r.ok) {
      refuse(r.problem);
      continue;
    }
    for (const [id, o] of Object.entries(owners)) {
      plan.owners[id] ??= { ...o, records: 0 };
      plan.owners[id].records += o.records;
    }
    // FR-021: a deal private to another owner is never named in the importer's report.
    const hidden = r.deal.private && r.deal.ownerId !== l.importerId ? ("deal" as const) : null;
    const warn = (p: Problem) => plan.warnings.push(itemFor("deal", d.id, r.label, p, hidden));
    r.warnings.forEach(warn);
    const otherPeople: number[] = [];
    for (const p of l.participants.get(d.id) ?? []) {
      if (p.personId === d.personId) continue;
      const crm = l.links.persons.get(p.personId);
      if (crm === undefined || crm === null) warn({ code: "pipedrive_participant_left_out", args: { name: p.name.trim() || l.names.get(`person:${p.personId}`) || `#${p.personId}` } });
      else if (crm !== personId && !otherPeople.includes(crm)) otherPeople.push(crm);
    }
    const followers: number[] = [];
    for (const pdUser of l.followers.get(d.id) ?? []) {
      const u = l.pdUsers[String(pdUser)];
      const id = u ? l.users.get(key(u.email)) : undefined;
      if (id !== undefined && !followers.includes(id)) followers.push(id);
    }
    for (const name of r.missingLabels) lists.add(`deal_label\u0000${key(name)}`, () => ({ list: "deal_label", value: name }));
    for (const m of r.missingChoices) choices.add(`${key(m.field)}\u0000${key(m.value)}`, () => ({ kind: "deal", field: m.field, value: m.value }));
    if (r.deal.private && r.deal.ownerId !== l.importerId) plan.privateDeals += 1;
    plan.adds.push({ pipedriveId: d.id, label: r.label, deal: r.deal, personId, organisationId, otherPeople, followers, labelIds: r.labelIds, custom: r.custom });
  }
  plan.lists = lists.list();
  plan.choices = choices.list();
  return plan;
}

// ---------------------------------------------------------------- notes (research.md §6)

export type RecordLookups = {
  importerId: number;
  // Pipedrive ids of this kind already linked.
  linked: Set<number>;
  links: Links;
  names: Map<string, string>;
  users: Map<string, number>;
  pdUsers: PdUsers;
  // CRM records the importer cannot see ("deal:<id>", "person:<id>"): what is put on them is counted, never named.
  hidden: Set<string>;
  now: Date;
};
export type NoteAdd = { pipedriveId: number; target: CrmTarget; body: string; actorId: number; createdAt: Date };
export type RecordsPlanBase = Base & { elsewhere: Elsewhere[]; privateOn: number };
export type NotePlan = RecordsPlanBase & { adds: NoteAdd[] };

const isHidden = (t: CrmTarget, hidden: Set<string>) =>
  (t.dealId !== null && hidden.has(`deal:${t.dealId}`)) || (t.personId !== null && hidden.has(`person:${t.personId}`));
// FR-021: what is put on a record the importer cannot see is never named in the report.
const hiddenAs = <K extends "note" | "activity" | "file">(kind: K, t: CrmTarget, hidden: Set<string>): K | null => (isHidden(t, hidden) ? kind : null);

export function planNotePage(items: PdNote[], l: RecordLookups): NotePlan {
  const plan: NotePlan = { ...base(), elsewhere: [], privateOn: 0, adds: [] };
  const elsewhere = new Counter<Elsewhere>();
  for (const n of items) {
    if (!n.active) continue;
    plan.done += 1;
    if (l.linked.has(n.id)) {
      plan.already += 1;
      continue;
    }
    const t = targetOf(n);
    if (t.kind === "lead" || t.kind === "project") {
      const on = t.kind;
      elsewhere.add(on, () => ({ kind: "note", on }));
      continue;
    }
    const text = noteFromPipedrive(n.content);
    const label = text.ok ? notePreview(text.text) : notePreview(n.content.replace(/<[^>]*>/g, " ")) || `#${n.id}`;
    const r = resolve(t.kind, t.id, l.links, l.names);
    if ("problem" in r) {
      plan.notImported.push(toItem("note", n.id, label, r.problem));
      continue;
    }
    const target = crmTarget(t.kind, r.id);
    if (!text.ok) {
      plan.notImported.push(itemFor("note", n.id, label, onRecord(text.problem, target), hiddenAs("note", target, l.hidden)));
      continue;
    }
    if (isHidden(target, l.hidden)) plan.privateOn += 1;
    const actorId = ownerOf(n.userId, l.users, l.pdUsers, l.importerId, plan.owners);
    plan.adds.push({ pipedriveId: n.id, target, body: text.text, actorId, createdAt: parseAddTime(n.addTime) ?? l.now });
  }
  plan.elsewhere = elsewhere.list();
  return plan;
}

// A reason about a record the CRM has: the record goes in the arguments, named at display time only if visible.
function onRecord(p: Problem, t: CrmTarget): Problem {
  const on: Record<string, number> = t.dealId !== null ? { onDeal: t.dealId } : t.personId !== null ? { onPerson: t.personId } : { onOrganisation: t.organisationId! };
  return { code: p.code, args: { ...p.args, ...on } };
}

// ---------------------------------------------------------------- activities (research.md §7)

export type ActivityLookups = RecordLookups & { types: Record<string, { name: string; custom: boolean }> };
export type ActivityAdd = { pipedriveId: number; value: ActivityValues; target: CrmTarget };
export type ActivityPlan = RecordsPlanBase & { adds: ActivityAdd[]; types: TypeCount[] };

export function planActivityPage(items: PdActivity[], l: ActivityLookups): ActivityPlan {
  const plan: ActivityPlan = { ...base(), elsewhere: [], privateOn: 0, adds: [], types: [] };
  const elsewhere = new Counter<Elsewhere>();
  const types = new Counter<TypeCount>();
  for (const a of items) {
    if (a.deleted) continue;
    plan.done += 1;
    if (l.linked.has(a.id)) {
      plan.already += 1;
      continue;
    }
    const label = a.subject.trim() || `#${a.id}`;
    if (a.dealId === null && a.personId === null && a.orgId === null && (a.leadId.trim() !== "" || a.projectId !== null)) {
      const on = a.leadId.trim() !== "" ? "lead" : "project";
      elsewhere.add(on, () => ({ kind: "activity", on }));
      continue;
    }
    const target: CrmTarget = { dealId: null, personId: null, organisationId: null };
    let problem: Problem | null = null;
    for (const [kind, pdId] of [["deal", a.dealId], ["person", a.personId], ["organisation", a.orgId]] as const) {
      if (pdId === null) continue;
      const r = resolve(kind, pdId, l.links, l.names);
      if ("problem" in r) {
        problem = r.problem;
        break;
      }
      if (kind === "deal") target.dealId = r.id;
      else if (kind === "person") target.personId = r.id;
      else target.organisationId = r.id;
    }
    if (problem) {
      plan.notImported.push(toItem("activity", a.id, label, problem));
      continue;
    }
    const owners: Record<string, OwnerMiss> = {};
    const r = activityFromPipedrive(a, { importerId: l.importerId, users: l.users, pdUsers: l.pdUsers, owners, types: l.types, now: l.now });
    const hidden = hiddenAs("activity", target, l.hidden);
    if (!r.ok) {
      plan.notImported.push(itemFor("activity", a.id, r.label, target.dealId ?? target.personId ?? target.organisationId ? onRecord(r.problem, target) : r.problem, hidden));
      continue;
    }
    for (const [id, o] of Object.entries(owners)) {
      plan.owners[id] ??= { ...o, records: 0 };
      plan.owners[id].records += o.records;
    }
    for (const w of r.warnings) plan.warnings.push(itemFor("activity", a.id, r.label, w, hidden));
    if (r.otherType) {
      const t = r.otherType;
      types.add(t.type, () => ({ type: t.type, name: t.name }));
    }
    if (hidden) plan.privateOn += 1;
    plan.adds.push({ pipedriveId: a.id, value: r.value, target });
  }
  plan.elsewhere = elsewhere.list();
  plan.types = types.list();
  return plan;
}

// ---------------------------------------------------------------- one file (research.md §8)

export type FileItemPlan =
  | { kind: "skip" }
  | { kind: "already" }
  | { kind: "elsewhere"; on: "lead" | "project" | "email" }
  | { kind: "notImported"; item: ReportItem }
  | { kind: "copy"; target: CrmTarget; uploaderId: number; addedAt: Date; hidden: boolean };

// `owners` is filled in when the uploader has no CRM user.
export function planFileItem(f: PdFile, l: RecordLookups, owners: Record<string, OwnerMiss>): FileItemPlan {
  const check = fileCheck(f);
  if ("skip" in check) return { kind: "skip" };
  if (l.linked.has(f.id)) return { kind: "already" };
  if ("elsewhere" in check) return { kind: "elsewhere", on: check.elsewhere };
  const label = f.name.trim() || `#${f.id}`;
  const t = targetOf(f);
  // The target first, so that a file refused for itself on a record the importer cannot see is not named (FR-021).
  if (t.kind === "lead" || t.kind === "project") {
    if ("problem" in check) return { kind: "notImported", item: toItem("file", f.id, label, check.problem) };
    return { kind: "elsewhere", on: t.kind };
  }
  const r = resolve(t.kind, t.id, l.links, l.names);
  const target = "id" in r ? crmTarget(t.kind, r.id) : null;
  const hidden = target === null ? null : hiddenAs("file", target, l.hidden);
  if ("problem" in check) return { kind: "notImported", item: itemFor("file", f.id, label, check.problem, hidden) };
  if (target === null) return { kind: "notImported", item: toItem("file", f.id, label, (r as { problem: Problem }).problem) };
  const uploaderId = ownerOf(f.userId, l.users, l.pdUsers, l.importerId, owners);
  return { kind: "copy", target, uploaderId, addedAt: parseAddTime(f.addTime) ?? l.now, hidden: hidden !== null };
}

export type { RecordKind };
