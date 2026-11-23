// Pure rules for deals, pipelines and stages (research.md §2, data-model.md § Validation).
// No database, no Next.js: unit-tested directly.
import { changedFields, toId, type FieldErrors, type FieldList } from "@/server/records/rules";

// What the deal form sends, as typed (also sent back to the form on a refusal).
export type DealForm = {
  title: string;
  value: string;
  pipelineId: string;
  stageId: string;
  organisationId: string;
  newOrganisationName: string;
  personId: string;
  ownerId: string;
  expectedClose: string;
  private: boolean;
  labelIds: string[];
  // SF-114: "Referred by": "", "<id>" or "keep".
  referredBy: string;
};

// A deal's fields once validated (and as compared for the history). Pipeline and stage only on add.
export type DealFields = {
  title: string;
  valuePence: number | null;
  pipelineId: number | null;
  stageId: number | null;
  organisationId: number | null;
  newOrganisationName: string | null;
  personId: number | null;
  ownerId: number | null;
  expectedClose: string | null;
  private: boolean;
  // Sorted, no duplicates (SF-95): compared as a whole for "Edited by …: Labels".
  labelIds: number[];
  // SF-114: not in DEAL_FIELDS (its own timeline lines); the stored referrer once decided.
  referredById: number | null;
};

export const MAX_PENCE = 999_999_999_999;
// "4000", "4,000", "4000.5", "4,000.50"; commas only as thousands separators, at most 2 decimals.
const MONEY = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseMoney(raw: string): { ok: true; pence: number | null } | { ok: false; code: "deal_value_invalid" } {
  let text = (raw ?? "").trim();
  if (text === "") return { ok: true, pence: null };
  if (text.startsWith("£")) text = text.slice(1);
  const m = MONEY.exec(text);
  if (!m) return { ok: false, code: "deal_value_invalid" };
  const pounds = m[1].replaceAll(",", "");
  const pence = Number(pounds) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(pence) || pence > MAX_PENCE) return { ok: false, code: "deal_value_invalid" };
  return { ok: true, pence };
}

// An empty date, or a real calendar day written YYYY-MM-DD (what <input type="date"> sends).
export function parseDate(raw: string): { ok: true; date: string | null } | { ok: false } {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, date: null };
  const m = DATE.exec(text);
  if (!m) return { ok: false };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1 || day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return { ok: false };
  return { ok: true, date: text };
}

export function validateDeal(form: DealForm): { ok: true; value: DealFields } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const title = (form.title ?? "").trim();
  if (title === "") errors.title = { code: "deal_title_required" };
  else if (title.length > 200) errors.title = { code: "deal_title_too_long" };
  const money = parseMoney(form.value ?? "");
  if (!money.ok) errors.value = { code: money.code };
  const close = parseDate(form.expectedClose ?? "");
  if (!close.ok) errors.expectedClose = { code: "deal_close_date_invalid" };
  if (!money.ok || !close.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  const organisationId = toId(form.organisationId);
  const newName = (form.newOrganisationName ?? "").trim().slice(0, 200).trim();
  return {
    ok: true,
    value: {
      title,
      valuePence: money.pence,
      pipelineId: toId(form.pipelineId),
      stageId: toId(form.stageId),
      organisationId,
      newOrganisationName: organisationId === null && newName !== "" ? newName : null,
      personId: toId(form.personId),
      ownerId: toId(form.ownerId),
      expectedClose: close.date,
      private: form.private === true,
      labelIds: [...new Set((form.labelIds ?? []).map(toId).filter((id): id is number => id !== null))].sort((a, b) => a - b).slice(0, 200),
      // Decided by the save (referral-rules.ts + the database check), not here.
      referredById: null,
    },
  };
}

// Pipeline and stage names: trimmed, 1–100 characters (uniqueness is checked by the database code).
export function validatePipelineName(raw: string): { ok: true; name: string } | { ok: false; code: "pipeline_name_required" } {
  const name = (raw ?? "").trim().slice(0, 100).trim();
  return name === "" ? { ok: false, code: "pipeline_name_required" } : { ok: true, name };
}

// Fields compared for an "Edited by …: <fields>" history line, in the order the form shows them.
export const DEAL_FIELDS: FieldList<DealFields> = [
  ["title", "Title"],
  ["valuePence", "Value"],
  ["organisationId", "Organisation"],
  ["personId", "Person"],
  ["labelIds", "Labels"],
  ["ownerId", "Owner"],
  ["expectedClose", "Expected close date"],
  ["private", "Private"],
];

export function changedDealFields(before: DealFields, after: DealFields): string[] {
  return changedFields(DEAL_FIELDS, before, after);
}

// --- The deal page (SF-95 data-model.md § Stage bar, § Validation, research.md §8) ------------------------------

export type StageBarItem = { id: number; name: string; state: "done" | "now" | "next"; days: number | null };

// Every stage of the deal's current pipeline in order: before the current one "done", the current one "now" (both
// with whole days, rounded down), after it "next" with no count, even when the deal was there before.
export function stageBar(stages: { id: number; name: string; seconds: number }[], currentStageId: number): StageBarItem[] {
  const at = stages.findIndex((s) => s.id === currentStageId);
  return stages.map((s, i) => {
    const state = i < at ? "done" : i === at ? "now" : "next";
    return { id: s.id, name: s.name, state, days: state === "next" ? null : Math.floor(Math.max(0, s.seconds) / 86400) };
  });
}

export const MAX_LOST_REASON = 500;

export function validateLostReason(raw: string): { ok: true; reason: string } | { ok: false; code: "lost_reason_required" | "lost_reason_too_long" } {
  const reason = (raw ?? "").trim();
  if (reason === "") return { ok: false, code: "lost_reason_required" };
  if (reason.length > MAX_LOST_REASON) return { ok: false, code: "lost_reason_too_long" };
  return { ok: true, reason };
}

// Where the edit form, archive and delete return (research.md §8): the deal page, the deal list, else (null) the board.
export const BACK_VALUES = ["page", "list"] as const;
export type Back = (typeof BACK_VALUES)[number];
export function parseBack(raw: string | null | undefined): Back | null {
  return (BACK_VALUES as readonly string[]).includes(raw ?? "") ? (raw as Back) : null;
}

// --- The board's address (contracts/routes.md § Pages, research.md §9) ------------------------------------------

export type BoardParams = Record<string, string | string[] | undefined>;
export const BOARD_ERRORS = ["deal_changed", "deal_move_failed"] as const;
export type BoardQuery = { pipeline: number | null; open: number | null; confirmDelete: boolean; error: (typeof BOARD_ERRORS)[number] | null };

function firstOf(params: BoardParams, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// Ids only, read as numbers; `error` only from the allow-list. Anything else is ignored, never shown.
export function parseBoardQuery(params: BoardParams): BoardQuery {
  const error = firstOf(params, "error");
  const open = toId(firstOf(params, "open"));
  return {
    pipeline: toId(firstOf(params, "pipeline")),
    open,
    confirmDelete: open !== null && firstOf(params, "confirm") === "delete",
    error: (BOARD_ERRORS as readonly string[]).includes(error) ? (error as BoardQuery["error"]) : null,
  };
}

// "/deals?pipeline=3&open=12", built from numeric ids only.
export function boardHref(pipelineId: number | null, extra: { open?: number | null; confirm?: "delete"; error?: BoardQuery["error"] } = {}): string {
  const q = new URLSearchParams();
  if (pipelineId !== null) q.set("pipeline", String(pipelineId));
  if (extra.open) q.set("open", String(extra.open));
  if (extra.confirm) q.set("confirm", extra.confirm);
  if (extra.error) q.set("error", extra.error);
  const s = q.toString();
  return s ? `/deals?${s}` : "/deals";
}
