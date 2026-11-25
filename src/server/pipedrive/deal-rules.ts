// From a Pipedrive deal, activity, note or file to what the CRM keeps (SF-122 research.md §5–§8). Pure, unit-tested.
// It reuses the forms' own rules (deal title, money, dates, lost reason; activity subject, note and duration limits;
// file limits), so the import accepts exactly what the forms accept. A value the form would refuse is left out with a
// warning, never cut or changed; a record is refused only for what it cannot exist without (title, subject, due date,
// stage, text, contents).
import { ACTIVITY_NOTE_MAX, SUBJECT_MAX, type ActivityType } from "@/server/activities/rules";
import { MAX_PENCE, parseDate, parseMoney, validateLostReason } from "@/server/deals/rules";
import { MAX_FILE_BYTES, validateFile } from "@/server/files/rules";
import { messages } from "@/server/messages";
import type { PdActivity, PdDeal, PdFile } from "@/server/pipedrive/api";
import { htmlToText } from "@/server/pipedrive/html";
import { ownerOf, type OwnerMiss, type PdUsers } from "@/server/pipedrive/page";
import { customValues, isOwnerOnly, parseAddTime, type CustomOut, type FieldsPlan, type Problem } from "@/server/pipedrive/rules";

const key = (text: string) => text.trim().toLowerCase();
const cut = (value: string) => value.replace(/\r\n?/g, "\n").trim();
const length = (s: string) => [...s].length;

// ---------------------------------------------------------------- deals (research.md §5)

// A Pipedrive stage → its CRM stage, or why it has none (a pipeline or stage name the CRM refused).
export type StageMap = Record<string, number | Problem>;

export type DealCtx = {
  importerId: number;
  // Active CRM users by lower(email).
  users: Map<string, number>;
  pdUsers: PdUsers;
  // Owners with no CRM user, counted (filled in).
  owners: Record<string, OwnerMiss>;
  stageMap: StageMap;
  // Deal labels still offered, by lower(btrim(name)).
  labels: Map<string, number>;
  fields: FieldsPlan;
  now: Date;
};
export type DealValues = {
  title: string;
  valuePence: number | null;
  stageId: number;
  stageEnteredAt: Date;
  ownerId: number;
  expectedClose: string | null;
  private: boolean;
  createdBy: number;
  createdAt: Date;
  status: "open" | "won" | "lost";
  closedAt: Date | null;
  lostReason: string | null;
  archivedAt: Date | null;
};
export type DealResult =
  | ({ ok: true; label: string; deal: DealValues; labelIds: number[]; missingLabels: string[] } & CustomOut)
  | { ok: false; label: string; problem: Problem };

const time = (text: string) => (text.trim() === "" ? null : parseAddTime(text));

export function dealFromPipedrive(d: PdDeal, c: DealCtx): DealResult {
  const title = d.title.trim();
  const label = title || `#${d.id}`;
  if (title === "") return { ok: false, label, problem: { code: "deal_title_required" } };
  if (title.length > 200) return { ok: false, label, problem: { code: "deal_title_too_long" } };
  const stage = d.stageId === null ? undefined : c.stageMap[String(d.stageId)];
  if (stage === undefined) return { ok: false, label, problem: { code: "pipedrive_stage_missing" } };
  if (typeof stage !== "number") return { ok: false, label, problem: stage };

  const warnings: Problem[] = [];
  let valuePence: number | null = null;
  if (d.value !== null && d.value !== 0) {
    const currency = d.currency.trim().toUpperCase();
    if (currency !== "GBP") warnings.push({ code: "pipedrive_deal_currency", args: { currency: currency || "?" } });
    else {
      const money = d.value < 0 ? null : parseMoney(String(d.value));
      if (money && money.ok && money.pence !== null && money.pence <= MAX_PENCE) valuePence = money.pence;
      else warnings.push({ code: "pipedrive_value_invalid", args: { field: "value", value: String(d.value) } });
    }
  }
  let expectedClose: string | null = null;
  if (d.expectedCloseDate.trim() !== "") {
    const date = parseDate(d.expectedCloseDate.trim().slice(0, 10));
    if (date.ok) expectedClose = date.date;
    else warnings.push({ code: "pipedrive_value_invalid", args: { field: "expected close date", value: d.expectedCloseDate.trim() } });
  }
  const createdAt = time(d.addTime) ?? c.now;
  const stageEnteredAt = time(d.stageChangeTime) ?? createdAt;
  let status: DealValues["status"] = "open";
  let closedAt: Date | null = null;
  let lostReason: string | null = null;
  if (d.status === "won") {
    status = "won";
    closedAt = time(d.wonTime) ?? time(d.closeTime) ?? c.now;
  } else if (d.status === "lost") {
    status = "lost";
    closedAt = time(d.lostTime) ?? time(d.closeTime) ?? c.now;
    const r = validateLostReason(d.lostReason);
    if (r.ok) lostReason = r.reason;
    else if (r.code === "lost_reason_required") lostReason = messages.pipedrive_no_lost_reason;
    else {
      lostReason = messages.pipedrive_lost_reason_too_long;
      warnings.push({ code: "pipedrive_lost_reason_too_long" });
    }
  }
  const ownerId = ownerOf(d.ownerId, c.users, c.pdUsers, c.importerId, c.owners);
  const isPrivate = isOwnerOnly(d.visibleTo);
  const labelIds: number[] = [];
  const missingLabels: string[] = [];
  for (const id of d.labelIds) {
    const name = c.fields.labelOptions.get(id);
    if (name === undefined) continue;
    const crm = c.labels.get(key(name));
    if (crm === undefined) {
      if (!missingLabels.includes(name.trim())) missingLabels.push(name.trim());
    } else if (!labelIds.includes(crm)) labelIds.push(crm);
  }
  const custom = customValues(c.fields, d.custom);
  return {
    ok: true,
    label,
    deal: {
      title, valuePence, stageId: stage, stageEnteredAt, ownerId, expectedClose, private: isPrivate, createdBy: isPrivate ? ownerId : c.importerId,
      createdAt, status, closedAt, lostReason, archivedAt: d.archived ? (time(d.updateTime) ?? c.now) : null,
    },
    labelIds: labelIds.sort((a, b) => a - b),
    missingLabels,
    custom: custom.custom,
    missingChoices: custom.missingChoices,
    warnings: [...warnings, ...custom.warnings],
  };
}

// ---------------------------------------------------------------- notes (research.md §6)

export type Target = { kind: "deal" | "person" | "organisation"; id: number } | { kind: "lead" } | { kind: "project" };

// FR-009: the one record a note or file goes on: its deal, else its person, else its organisation. With none of them it
// is on a Pipedrive lead (lead_id) or else elsewhere (a project), counted, not imported.
export function targetOf(r: { dealId: number | null; personId: number | null; orgId: number | null; leadId: string; projectId?: number | null }): Target {
  if (r.dealId !== null) return { kind: "deal", id: r.dealId };
  if (r.personId !== null) return { kind: "person", id: r.personId };
  if (r.orgId !== null) return { kind: "organisation", id: r.orgId };
  return r.leadId.trim() !== "" ? { kind: "lead" } : { kind: "project" };
}

// The note column's limit (timeline_events.body): a note up to it comes in whole (spec Clarifications).
export const NOTE_IMPORT_MAX = 100_000;

export function noteFromPipedrive(html: string): { ok: true; text: string } | { ok: false; problem: Problem } {
  const text = htmlToText(html);
  if (text === "") return { ok: false, problem: { code: "pipedrive_note_empty" } };
  if (length(text) > NOTE_IMPORT_MAX) return { ok: false, problem: { code: "pipedrive_note_too_long" } };
  return { ok: true, text };
}

// A note's name in the report: its first 60 characters on one line, "…" when cut.
export function notePreview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = [...line];
  return chars.length > 60 ? `${chars.slice(0, 60).join("").trimEnd()}…` : line;
}

// ---------------------------------------------------------------- activities (research.md §7)

const HHMM = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
const london = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// Pipedrive's due date and time (UTC) as the UK date and time the CRM keeps; the date may move across midnight.
export function ukFromUtc(date: string, time: string): { dueOn: string; dueTime: string } {
  const m = HHMM.exec(time.trim())!;
  const [y, mo, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2])));
  const p = Object.fromEntries(london.formatToParts(at).map((x) => [x.type, x.value]));
  return { dueOn: `${p.year}-${p.month}-${p.day}`, dueTime: `${p.hour}:${p.minute}` };
}

// "HH:MM" → minutes rounded up to the next 5; none for empty or 0; a warning beyond 24 hours or unreadable.
export function durationMinutes(text: string): { minutes: number | null } | { warning: Problem } {
  const t = text.trim();
  if (t === "") return { minutes: null };
  const m = HHMM.exec(t);
  const warning = { warning: { code: "pipedrive_duration_left_out", args: { text: t } } };
  if (!m || Number(m[2]) > 59) return warning;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes === 0) return { minutes: null };
  const rounded = Math.ceil(minutes / 5) * 5;
  return rounded > 1440 ? warning : { minutes: rounded };
}

export type ActivityCtx = {
  importerId: number;
  users: Map<string, number>;
  pdUsers: PdUsers;
  owners: Record<string, OwnerMiss>;
  // Pipedrive activity types by key: their name, and whether the account added them.
  types: Record<string, { name: string; custom: boolean }>;
  now: Date;
};
export type ActivityValues = {
  type: ActivityType;
  subject: string;
  dueOn: string;
  dueTime: string | null;
  durationMinutes: number | null;
  note: string | null;
  assigneeId: number;
  doneAt: Date | null;
  createdAt: Date;
};
export type ActivityResult =
  | { ok: true; label: string; value: ActivityValues; warnings: Problem[]; otherType: { type: string; name: string } | null }
  | { ok: false; label: string; problem: Problem };

const CRM_TYPES = new Set(["call", "meeting", "task"]);

export function activityFromPipedrive(a: PdActivity, c: ActivityCtx): ActivityResult {
  const subject = cut(a.subject);
  const label = subject || `#${a.id}`;
  if (subject === "") return { ok: false, label, problem: { code: "activity_subject_required" } };
  if (length(subject) > SUBJECT_MAX) return { ok: false, label, problem: { code: "activity_subject_too_long" } };
  const day = parseDate(a.dueDate.trim().slice(0, 10));
  if (!day.ok || day.date === null) return { ok: false, label, problem: { code: "pipedrive_no_due_date" } };
  const warnings: Problem[] = [];
  let dueOn = day.date;
  let dueTime: string | null = null;
  const t = a.dueTime.trim();
  const tm = HHMM.exec(t);
  if (tm && Number(tm[1]) < 24 && Number(tm[2]) < 60) ({ dueOn, dueTime } = ukFromUtc(dueOn, t));
  else if (t !== "") warnings.push({ code: "pipedrive_value_invalid", args: { field: "due time", value: t } });
  let duration: number | null = null;
  const dm = durationMinutes(a.duration);
  if ("warning" in dm) warnings.push(dm.warning);
  else if (dm.minutes !== null && dueTime === null) warnings.push({ code: "pipedrive_duration_left_out", args: { text: a.duration.trim() } });
  else duration = dm.minutes;
  let note: string | null = htmlToText(a.note);
  if (note === "") note = null;
  else if (length(note) > ACTIVITY_NOTE_MAX) {
    warnings.push({ code: "pipedrive_value_too_long", args: { field: "note", max: ACTIVITY_NOTE_MAX } });
    note = null;
  }
  const known = CRM_TYPES.has(a.type);
  const typeInfo = c.types[a.type];
  const assigneeId = ownerOf(a.ownerId, c.users, c.pdUsers, c.importerId, c.owners);
  const createdAt = time(a.addTime) ?? c.now;
  return {
    ok: true,
    label,
    value: {
      type: known ? (a.type as ActivityType) : "task", subject, dueOn, dueTime, durationMinutes: duration, note, assigneeId,
      doneAt: a.done ? (time(a.doneTime) ?? time(a.updateTime) ?? c.now) : null, createdAt,
    },
    warnings,
    otherType: known ? null : { type: a.type, name: typeInfo?.custom ? typeInfo.name : a.type || "?" },
  };
}

// ---------------------------------------------------------------- files (research.md §8)

// Megabytes to one decimal (1 MB = 1,048,576 bytes): "26.1".
export function formatMb(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}

export type FileCheck = { ok: true } | { skip: true } | { elsewhere: "email" | "lead" | "project" } | { problem: Problem };

// Whether a Pipedrive file can be copied, from its metadata only (the target is checked by the plan).
export function fileCheck(f: PdFile): FileCheck {
  if (!f.active) return { skip: true };
  if (f.mailMessageId.trim() !== "") return { elsewhere: "email" };
  if (f.remoteLocation.trim() !== "" && f.remoteLocation.trim() !== "s3") return { problem: { code: "pipedrive_file_link" } };
  const t = targetOf(f);
  if (t.kind === "lead" || t.kind === "project") return { elsewhere: t.kind };
  if (f.size !== null && f.size <= 0) return { problem: { code: "pipedrive_file_empty" } };
  if (f.size !== null && f.size > MAX_FILE_BYTES) return { problem: { code: "pipedrive_file_too_large", args: { mb: formatMb(f.size) } } };
  const v = validateFile({ name: f.name, size: 1 });
  if (!v.ok) return { problem: { code: "file_name_too_long", args: { name: f.name } } };
  return { ok: true };
}
