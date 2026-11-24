// Reads what the person, organisation and deal forms post (contracts/routes.md § Server actions). Pure.
import type { DealForm } from "@/server/deals/rules";
import { toId, type CustomForm, type OrganisationForm, type PersonForm } from "@/server/records/rules";

const MAX_ROWS = 50;

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

// `emails.<i>.value` / `emails.<i>.kind`, in index order (the first is the main one).
function rows(fd: FormData, prefix: string): { value: string; kind: string }[] {
  const re = new RegExp(`^${prefix}\\.(\\d{1,4})\\.value$`);
  const indexes = [...fd.keys()]
    .map((k) => re.exec(k)?.[1])
    .filter((i): i is string => i !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  return [...new Set(indexes)]
    .slice(0, MAX_ROWS)
    .map((i) => ({ value: text(fd, `${prefix}.${i}.value`), kind: text(fd, `${prefix}.${i}.kind`) || "work" }));
}

// SF-115 (research.md §7): `cfShown` (the custom field ids the form showed) and every `cf.<id>` value; absent when the
// form showed no custom field. At most 50 fields, 100 values each, each cut at 10,001 characters (so too long still fails).
function custom(fd: FormData): CustomForm | undefined {
  const shownRaw = fd.get("cfShown");
  if (typeof shownRaw !== "string") return undefined;
  const shown = [...new Set(shownRaw.split(",").map((s) => toId(s.trim())).filter((id): id is number => id !== null))].slice(0, 50);
  const values: Record<number, string[]> = {};
  for (const k of new Set(fd.keys())) {
    const m = /^cf\.([1-9][0-9]{0,15})$/.exec(k);
    if (!m || Object.keys(values).length >= 50) continue;
    values[Number(m[1])] = fd.getAll(k).filter((v): v is string => typeof v === "string").slice(0, 100).map((v) => v.slice(0, 10_001));
  }
  return { shown, values };
}

const withCustom = <T extends object>(form: T, fd: FormData): T => {
  const c = custom(fd);
  return c ? { ...form, custom: c } : form;
};

export function personFormFromData(fd: FormData): PersonForm {
  return withCustom(personFields(fd), fd);
}

function personFields(fd: FormData): PersonForm {
  return {
    firstName: text(fd, "firstName"),
    lastName: text(fd, "lastName"),
    emails: rows(fd, "emails"),
    phones: rows(fd, "phones"),
    organisationId: text(fd, "organisationId"),
    newOrganisationName: text(fd, "newOrganisationName"),
    role: text(fd, "role"),
    leadSourceId: text(fd, "leadSourceId"),
    linkedin: text(fd, "linkedin"),
    ownerId: text(fd, "ownerId"),
    labelIds: fd.getAll("labelIds").filter((v): v is string => typeof v === "string").slice(0, 200),
    consent: text(fd, "consent"),
    consentShown: text(fd, "consentShown"),
    private: text(fd, "private") === "on",
    ambassador: text(fd, "ambassador") === "on",
    referredBy: text(fd, "referredBy"),
  };
}

export function organisationFormFromData(fd: FormData): OrganisationForm {
  return withCustom<OrganisationForm>({
    name: text(fd, "name"),
    website: text(fd, "website"),
    sector: text(fd, "sector"),
    size: text(fd, "size"),
    location: text(fd, "location"),
    ownerId: text(fd, "ownerId"),
  }, fd);
}

export function dealFormFromData(fd: FormData): DealForm {
  return withCustom<DealForm>({
    title: text(fd, "title"),
    value: text(fd, "value"),
    pipelineId: text(fd, "pipelineId"),
    stageId: text(fd, "stageId"),
    organisationId: text(fd, "organisationId"),
    newOrganisationName: text(fd, "newOrganisationName"),
    personId: text(fd, "personId"),
    ownerId: text(fd, "ownerId"),
    expectedClose: text(fd, "expectedClose"),
    private: text(fd, "private") === "on",
    labelIds: fd.getAll("labelIds").filter((v): v is string => typeof v === "string").slice(0, 200),
    referredBy: text(fd, "referredBy"),
  }, fd);
}

export function idFrom(fd: FormData, key = "id"): number | null {
  return toId(text(fd, key));
}
