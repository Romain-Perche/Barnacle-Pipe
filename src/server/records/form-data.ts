// Reads what the person, organisation and deal forms post (contracts/routes.md § Server actions). Pure.
import type { DealForm } from "@/server/deals/rules";
import { toId, type OrganisationForm, type PersonForm } from "@/server/records/rules";

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

export function personFormFromData(fd: FormData): PersonForm {
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
    private: text(fd, "private") === "on",
  };
}

export function organisationFormFromData(fd: FormData): OrganisationForm {
  return {
    name: text(fd, "name"),
    website: text(fd, "website"),
    sector: text(fd, "sector"),
    size: text(fd, "size"),
    location: text(fd, "location"),
    ownerId: text(fd, "ownerId"),
  };
}

export function dealFormFromData(fd: FormData): DealForm {
  return {
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
  };
}

export function idFrom(fd: FormData, key = "id"): number | null {
  return toId(text(fd, key));
}
