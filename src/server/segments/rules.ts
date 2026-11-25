// SF-120 segments, the pure part (data-model.md § Condition, § Validation; contracts/routes.md § Domain functions):
// types, reading and checking the form, reading stored conditions back, and the plain-words description of a segment.
// No database here: the option lists and the names come from segments.ts.
import { canonicalNumber, formatDay, formatNumber, parseNumber, type CustomType } from "@/server/custom-fields/rules";
import { parseDate, parseMoney } from "@/server/deals/rules";
import { formatMoney } from "@/server/format";
import { messages, templates } from "@/server/messages";

export const SEGMENT_WHO = ["everyone", "pipeline", "stage"] as const;
export type SegmentWho = (typeof SEGMENT_WHO)[number];
export const DEAL_STATUS_CHOICES = ["open", "won", "lost", "all"] as const;
export type DealStatus = (typeof DEAL_STATUS_CHOICES)[number];
export const MAX_NAME = 100;
export const MAX_CONDITIONS = 20;
export const MAX_VALUES = 100;
export const MAX_TEXT = 200;
// Rows read from one post at most (anything over MAX_CONDITIONS is refused; this only bounds the work).
const MAX_ROWS_READ = 200;

export const CHOICE_FIELDS = ["lead_source", "label", "organisation", "owner"] as const;
export type ChoiceField = (typeof CHOICE_FIELDS)[number];
export const RANGE_TYPES = ["number", "money", "date"] as const;

export type Condition =
  | { field: ChoiceField; ids: number[] }
  | { field: "role"; text: string }
  | { field: "custom"; fieldId: number; type: "text" | "long_text"; text: string }
  | { field: "custom"; fieldId: number; type: "number" | "money" | "date"; from: string | null; to: string | null }
  | { field: "custom"; fieldId: number; type: "single_choice"; ids: number[]; empty: boolean }
  | { field: "custom"; fieldId: number; type: "multiple_choice"; ids: number[] }
  | { field: "custom"; fieldId: number; type: "yes_no"; value: "yes" | "no" | "empty" };
export type CustomCondition = Extract<Condition, { field: "custom" }>;

export type Definition = {
  who: SegmentWho;
  pipelineId: number | null;
  stageId: number | null;
  dealStatus: DealStatus | null;
  conditions: Condition[];
};
export type Reach = { reaches: number; archived: number; unsubscribed: number; noEmail: number };

export const EVERYONE: Definition = { who: "everyone", pipelineId: null, stageId: null, dealStatus: null, conditions: [] };

// ---------------------------------------------------------------- the form

// A condition row as the form holds it: `field` is lead_source | label | organisation | owner | role | cf<id>.
export type ConditionValues = { field: string; values: string[]; from: string; to: string };
export type SegmentFormValues = {
  name: string; who: string; pipelineId: string; stageId: string; dealStatus: string; conditions: ConditionValues[];
};
export type SegmentFormInput = SegmentFormValues & { id: number | null; version: number | null; intent: "save" | "count" };
// Messages already in words, keyed by input: name, pipelineId, stageId, conditions, c.<n>, form.
export type SegmentErrors = Record<string, string>;

const ID = /^[1-9][0-9]{0,15}$/;
const toId = (raw: unknown): number | null => {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!ID.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
};
const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function readSegmentForm(fd: FormData): SegmentFormInput {
  const rows = new Map<number, ConditionValues>();
  for (const key of fd.keys()) {
    const m = /^c\.(\d{1,3})\.field$/.exec(key);
    if (!m || rows.size >= MAX_ROWS_READ) continue;
    const n = Number(m[1]);
    rows.set(n, {
      field: text(fd, key),
      values: fd.getAll(`c.${n}.value`).filter((v): v is string => typeof v === "string"),
      from: text(fd, `c.${n}.from`),
      to: text(fd, `c.${n}.to`),
    });
  }
  return {
    id: toId(text(fd, "id")),
    version: toId(text(fd, "version")),
    intent: text(fd, "intent") === "count" ? "count" : "save",
    name: text(fd, "name"),
    who: text(fd, "who"),
    pipelineId: text(fd, "pipelineId"),
    stageId: text(fd, "stageId"),
    dealStatus: text(fd, "dealStatus"),
    conditions: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row),
  };
}

type Opt = { id: number; name: string };
// What the form offers (research.md §8). Names carry their marks: "(removed)", "(archived)", "(deactivated)", "(deleted)".
// A deleted pipeline, stage, organisation, field or choice already in the segment is offered as "(deleted)" so the
// segment can still be saved (FR-013) or the value removed; a new id must be one of these options.
export type FormField = { id: number; name: string; type: CustomType; choices: Opt[] };
export type FormOptions = {
  pipelines: (Opt & { stages: Opt[] })[];
  leadSources: Opt[];
  labels: Opt[];
  organisations: Opt[];
  owners: Opt[];
  fields: FormField[];
};

export function fieldLabel(field: string, options: Pick<FormOptions, "fields">): string | null {
  switch (field) {
    case "lead_source": return messages.segment_field_lead_source;
    case "label": return messages.segment_field_label;
    case "organisation": return messages.segment_field_organisation;
    case "owner": return messages.segment_field_owner;
    case "role": return messages.segment_field_role;
  }
  const id = /^cf([1-9][0-9]{0,15})$/.exec(field);
  return id ? (options.fields.find((f) => f.id === Number(id[1]))?.name ?? null) : null;
}

const CHOICE_OPTIONS: Record<ChoiceField, keyof Omit<FormOptions, "pipelines" | "fields">> = {
  lead_source: "leadSources", label: "labels", organisation: "organisations", owner: "owners",
};

// Distinct ids among the allowed ones, in the order given.
function keepIds(raw: string[], allowed: Opt[]): number[] {
  const ok = new Set(allowed.map((o) => o.id));
  const ids: number[] = [];
  for (const v of raw) {
    const id = toId(v);
    if (id !== null && ok.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Compares two canonical decimals ("-12.5", "3") without floats.
function compareDecimal(a: string, b: string): number {
  const scale = (t: string) => {
    const [whole, frac = ""] = t.replace("-", "").split(".");
    const n = BigInt(whole) * 10_000n + BigInt((frac + "0000").slice(0, 4));
    return t.startsWith("-") ? -n : n;
  };
  const d = scale(a) - scale(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

type Range = { ok: true; from: string | null; to: string | null } | { ok: false; error: string };
function readRange(type: "number" | "money" | "date", name: string, rawFrom: string, rawTo: string): Range {
  const read = (raw: string): { ok: true; value: string | null } | { ok: false; error: string } => {
    if (type === "number") {
      const n = parseNumber(raw);
      return n.ok ? { ok: true, value: n.value } : { ok: false, error: templates[n.code](name) };
    }
    if (type === "money") {
      const m = parseMoney(raw);
      return m.ok ? { ok: true, value: m.pence === null ? null : String(m.pence) } : { ok: false, error: templates.custom_money_invalid(name) };
    }
    const d = parseDate(raw);
    return d.ok ? { ok: true, value: d.date } : { ok: false, error: templates.custom_date_invalid(name) };
  };
  const from = read(rawFrom);
  if (!from.ok) return from;
  const to = read(rawTo);
  if (!to.ok) return to;
  if (from.value === null && to.value === null) return { ok: false, error: templates.segment_condition_required(name, "range") };
  if (from.value !== null && to.value !== null) {
    const after = type === "date" ? from.value > to.value : compareDecimal(from.value, to.value) > 0;
    if (after) return { ok: false, error: templates.segment_condition_range(name) };
  }
  return { ok: true, from: from.value, to: to.value };
}

function readText(name: string, raw: string[]): { ok: true; text: string } | { ok: false; error: string } {
  const value = (raw[0] ?? "").trim();
  if (value === "") return { ok: false, error: templates.segment_condition_required(name, "text") };
  if ([...value].length > MAX_TEXT) return { ok: false, error: templates.segment_condition_too_long(name) };
  return { ok: true, text: value };
}

// One condition row: the condition, an error in words, or null when the row is dropped (no field, or a made-up field).
function readCondition(row: ConditionValues, options: FormOptions): Condition | string | null {
  const name = fieldLabel(row.field, options);
  if (name === null) return null;
  const values = row.values.filter((v) => v.trim() !== "");
  if (row.field === "role") {
    const t = readText(name, values);
    return t.ok ? { field: "role", text: t.text } : t.error;
  }
  if ((CHOICE_FIELDS as readonly string[]).includes(row.field)) {
    const field = row.field as ChoiceField;
    if (values.length > MAX_VALUES) return templates.segment_condition_too_many(name);
    const ids = keepIds(values, options[CHOICE_OPTIONS[field]]);
    return ids.length === 0 ? templates.segment_condition_required(name, "choose") : { field, ids };
  }
  const f = options.fields.find((x) => `cf${x.id}` === row.field)!;
  switch (f.type) {
    case "text":
    case "long_text": {
      const t = readText(name, values);
      return t.ok ? { field: "custom", fieldId: f.id, type: f.type, text: t.text } : t.error;
    }
    case "number":
    case "money":
    case "date": {
      const r = readRange(f.type, name, row.from, row.to);
      return r.ok ? { field: "custom", fieldId: f.id, type: f.type, from: r.from, to: r.to } : r.error;
    }
    case "single_choice":
    case "multiple_choice": {
      if (values.length > MAX_VALUES) return templates.segment_condition_too_many(name);
      const ids = keepIds(values, f.choices);
      const empty = f.type === "single_choice" && values.includes("empty");
      if (ids.length === 0 && !empty) return templates.segment_condition_required(name, "choose");
      return f.type === "single_choice"
        ? { field: "custom", fieldId: f.id, type: "single_choice", ids, empty }
        : { field: "custom", fieldId: f.id, type: "multiple_choice", ids };
    }
    case "yes_no": {
      const v = values[0];
      if (v !== "yes" && v !== "no" && v !== "empty") return templates.segment_condition_required(name, "yes_no");
      return { field: "custom", fieldId: f.id, type: "yes_no", value: v };
    }
  }
}

export type Validated = { ok: true; name: string; definition: Definition } | { ok: false; errors: SegmentErrors };

// data-model.md § Validation, in form order. Ids are kept only when they are among `options` (a stored id that no longer
// exists is in the options as "(deleted)"), so a made-up id is dropped and never shown back.
export function validateSegmentForm(input: SegmentFormValues, options: FormOptions): Validated {
  const errors: SegmentErrors = {};
  const name = input.name.trim();
  if (name === "") errors.name = messages.segment_name_required;
  else if ([...name].length > MAX_NAME) errors.name = messages.segment_name_too_long;

  const who: SegmentWho = (SEGMENT_WHO as readonly string[]).includes(input.who) ? (input.who as SegmentWho) : "everyone";
  let pipelineId: number | null = null;
  let stageId: number | null = null;
  let dealStatus: DealStatus | null = null;
  if (who !== "everyone") {
    dealStatus = (DEAL_STATUS_CHOICES as readonly string[]).includes(input.dealStatus) ? (input.dealStatus as DealStatus) : "open";
    const pipeline = options.pipelines.find((p) => p.id === toId(input.pipelineId));
    if (!pipeline) errors.pipelineId = messages.segment_pipeline_required;
    else pipelineId = pipeline.id;
    if (who === "stage") {
      const stage = pipeline?.stages.find((s) => s.id === toId(input.stageId));
      if (!stage) errors.stageId = messages.segment_stage_required;
      else stageId = stage.id;
    }
  }

  const conditions: Condition[] = [];
  const rows = input.conditions.filter((r) => r.field.trim() !== "");
  if (rows.length > MAX_CONDITIONS) errors.conditions = messages.segment_conditions_limit;
  else {
    input.conditions.forEach((row, i) => {
      if (row.field.trim() === "") return;
      const c = readCondition(row, options);
      if (typeof c === "string") errors[`c.${i}`] = c;
      else if (c) conditions.push(c);
    });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, name, definition: { who, pipelineId, stageId, dealStatus, conditions } };
}

// ---------------------------------------------------------------- stored conditions

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.length <= MAX_VALUES && v.every(isId);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && [...v].length <= MAX_TEXT;
const isEnd = (type: "number" | "money" | "date", v: unknown): v is string | null => {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  if (type === "date") { const d = parseDate(v); return d.ok && d.date !== null; }
  if (type === "money") return /^[0-9]{1,15}$/.test(v);
  const n = parseNumber(v);
  return n.ok && n.value !== null;
};

// The stored jsonb list read back: an element that does not fit Condition is dropped (a hand-edited row never breaks a page).
export function readConditions(json: unknown): Condition[] {
  if (!Array.isArray(json)) return [];
  const out: Condition[] = [];
  for (const raw of json.slice(0, MAX_CONDITIONS)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if ((CHOICE_FIELDS as readonly string[]).includes(c.field as string)) {
      if (isIds(c.ids) && c.ids.length > 0) out.push({ field: c.field as ChoiceField, ids: c.ids });
      continue;
    }
    if (c.field === "role") {
      if (isText(c.text)) out.push({ field: "role", text: c.text });
      continue;
    }
    if (c.field !== "custom" || !isId(c.fieldId)) continue;
    const fieldId = c.fieldId;
    switch (c.type) {
      case "text":
      case "long_text":
        if (isText(c.text)) out.push({ field: "custom", fieldId, type: c.type, text: c.text });
        break;
      case "number":
      case "money":
      case "date": {
        const type = c.type;
        if (isEnd(type, c.from) && isEnd(type, c.to) && (c.from !== null || c.to !== null)) {
          out.push({ field: "custom", fieldId, type, from: type === "number" && c.from ? canonicalNumber(c.from) : c.from, to: type === "number" && c.to ? canonicalNumber(c.to) : c.to });
        }
        break;
      }
      case "single_choice":
        if (isIds(c.ids) && typeof c.empty === "boolean" && (c.ids.length > 0 || c.empty)) out.push({ field: "custom", fieldId, type: "single_choice", ids: c.ids, empty: c.empty });
        break;
      case "multiple_choice":
        if (isIds(c.ids) && c.ids.length > 0) out.push({ field: "custom", fieldId, type: "multiple_choice", ids: c.ids });
        break;
      case "yes_no":
        if (c.value === "yes" || c.value === "no" || c.value === "empty") out.push({ field: "custom", fieldId, type: "yes_no", value: c.value });
        break;
    }
  }
  return out;
}

// What the client form starts from for a stored definition.
export function formToValues(def: Definition, name = ""): SegmentFormValues {
  const pounds = (pence: string | null) => {
    if (pence === null) return "";
    const n = Number(pence);
    return n % 100 === 0 ? String(n / 100) : `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
  };
  return {
    name,
    who: def.who,
    pipelineId: def.pipelineId === null ? "" : String(def.pipelineId),
    stageId: def.stageId === null ? "" : String(def.stageId),
    dealStatus: def.dealStatus ?? "open",
    conditions: def.conditions.map((c): ConditionValues => {
      const none = { values: [] as string[], from: "", to: "" };
      if (c.field === "role") return { ...none, field: "role", values: [c.text] };
      if (c.field !== "custom") return { ...none, field: c.field, values: c.ids.map(String) };
      const field = `cf${c.fieldId}`;
      switch (c.type) {
        case "text":
        case "long_text": return { ...none, field, values: [c.text] };
        case "number":
        case "date": return { ...none, field, from: c.from ?? "", to: c.to ?? "" };
        case "money": return { ...none, field, from: pounds(c.from), to: pounds(c.to) };
        case "single_choice": return { ...none, field, values: [...c.ids.map(String), ...(c.empty ? ["empty"] : [])] };
        case "multiple_choice": return { ...none, field, values: c.ids.map(String) };
        case "yes_no": return { ...none, field, values: [c.value] };
      }
    }),
  };
}

// ---------------------------------------------------------------- description

type Named = { name: string };
// The names a description needs, for the ids that still exist (segments.ts loads them). A missing id is "(deleted)".
export type Names = {
  pipelines: Record<number, Named>;
  stages: Record<number, Named & { pipelineId: number }>;
  leadSources: Record<number, Named & { removed: boolean }>;
  labels: Record<number, Named & { removed: boolean }>;
  organisations: Record<number, Named & { archived: boolean }>;
  users: Record<number, Named & { active: boolean }>;
  // Person custom fields only: any other field id counts as deleted.
  fields: Record<number, Named & { type: CustomType; choices: Record<number, Named & { removed: boolean }> }>;
};
export type Line = { label: string; value: string };
export type Description = { summary: string; who: Line[]; conditions: Line[]; broken: boolean };

const DELETED = messages.segment_deleted_mark;
const STATUS_LABEL: Record<DealStatus, string> = {
  open: messages.segment_status_open, won: messages.segment_status_won, lost: messages.segment_status_lost, all: messages.segment_status_all,
};

export function describeSegment(def: Definition, names: Names): Description {
  let broken = false;
  const who: Line[] = [];
  let summary: string = messages.segment_who_everyone;
  if (def.who === "everyone") {
    who.push({ label: messages.segment_who_label, value: messages.segment_who_everyone });
  } else {
    const status = def.dealStatus ?? "open";
    const pipeline = def.pipelineId === null ? undefined : names.pipelines[def.pipelineId];
    if (!pipeline) broken = true;
    let place = pipeline?.name ?? DELETED;
    who.push({ label: messages.segment_deals_label, value: STATUS_LABEL[status] });
    if (def.who === "stage") {
      const stage = def.stageId === null ? undefined : names.stages[def.stageId];
      const stageOk = stage !== undefined && stage.pipelineId === def.pipelineId;
      if (!stageOk) broken = true;
      place = `${place} · ${stageOk ? stage.name : DELETED}`;
      who.push({ label: messages.segment_pipeline_stage_label, value: place });
    } else {
      who.push({ label: messages.segment_pipeline_label, value: place });
    }
    summary = templates.segment_summary_deals(status, place);
  }

  const conditions: Line[] = def.conditions.map((c) => {
    const join = (parts: string[]) => parts.join(" or ");
    const marked = (n: Named | undefined, mark: boolean, word: string) => (n ? (mark ? `${n.name} ${word}` : n.name) : DELETED);
    switch (c.field) {
      case "lead_source":
        return { label: messages.segment_field_lead_source, value: join(c.ids.map((id) => marked(names.leadSources[id], !!names.leadSources[id]?.removed, messages.segment_removed_mark))) };
      case "label":
        return { label: messages.segment_field_label, value: join(c.ids.map((id) => marked(names.labels[id], !!names.labels[id]?.removed, messages.segment_removed_mark))) };
      case "organisation":
        return {
          label: messages.segment_field_organisation,
          value: join(c.ids.map((id) => {
            const o = names.organisations[id];
            if (!o) broken = true;
            return marked(o, !!o?.archived, messages.segment_archived_mark);
          })),
        };
      case "owner":
        return { label: messages.segment_field_owner, value: join(c.ids.map((id) => marked(names.users[id], names.users[id]?.active === false, messages.segment_deactivated_mark))) };
      case "role":
        return { label: messages.segment_field_role, value: templates.segment_contains(c.text) };
    }
    const field = names.fields[c.fieldId];
    if (!field || field.type !== c.type) {
      broken = true;
      return { label: DELETED, value: DELETED };
    }
    const choice = (id: number) => marked(field.choices[id], !!field.choices[id]?.removed, messages.segment_removed_mark);
    switch (c.type) {
      case "text":
      case "long_text":
        return { label: field.name, value: templates.segment_contains(c.text) };
      case "number":
      case "money":
      case "date": {
        const show = (v: string | null) =>
          v === null ? null : c.type === "number" ? formatNumber(v) : c.type === "money" ? formatMoney(Number(v)) : formatDay(v);
        return { label: field.name, value: templates.segment_range(show(c.from), show(c.to)) };
      }
      case "single_choice":
        return { label: field.name, value: join([...c.ids.map(choice), ...(c.empty ? [messages.segment_empty_value] : [])]) };
      case "multiple_choice":
        return { label: field.name, value: join(c.ids.map(choice)) };
      case "yes_no":
        return { label: field.name, value: { yes: messages.segment_yes, no: messages.segment_no, empty: messages.segment_empty_value }[c.value] };
    }
  });
  if (def.conditions.length > 0) summary = `${summary} ${templates.segment_more_conditions(def.conditions.length)}`;
  return { summary, who, conditions, broken };
}

// Every id a definition refers to, by kind (to load the names of many segments at once).
export function referencedIds(def: Definition) {
  const ids = { pipelines: [] as number[], stages: [] as number[], leadSources: [] as number[], labels: [] as number[], organisations: [] as number[], users: [] as number[] };
  if (def.pipelineId !== null) ids.pipelines.push(def.pipelineId);
  if (def.stageId !== null) ids.stages.push(def.stageId);
  for (const c of def.conditions) {
    if (c.field === "lead_source") ids.leadSources.push(...c.ids);
    if (c.field === "label") ids.labels.push(...c.ids);
    if (c.field === "organisation") ids.organisations.push(...c.ids);
    if (c.field === "owner") ids.users.push(...c.ids);
  }
  return ids;
}
