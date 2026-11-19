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
  ["ownerId", "Owner"],
  ["expectedClose", "Expected close date"],
  ["private", "Private"],
];

export function changedDealFields(before: DealFields, after: DealFields): string[] {
  return changedFields(DEAL_FIELDS, before, after);
}
