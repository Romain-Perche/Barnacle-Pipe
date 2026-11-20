// Pure rules for people, organisations, lead sources and labels (research.md §13, data-model.md § Validation).
// No database, no Next.js: unit-tested directly.

export const KINDS = ["work", "personal", "other"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABELS: Record<Kind, string> = { work: "Work", personal: "Personal", other: "Other" };

export const SIZES = ["1–10", "11–50", "51–200", "201–1,000", "1,000+"] as const;
export type Size = (typeof SIZES)[number];

export const CONSENTS = ["subscribed", "unsubscribed"] as const;
export type Consent = (typeof CONSENTS)[number];
export const CONSENT_LABELS: Record<Consent, string> = { subscribed: "Subscribed", unsubscribed: "Unsubscribed" };

// A refusal shown next to a field. `name`/`href` only for the duplicate and "already exists" messages,
// and always taken from the database.
export type FieldError = { code: string; name?: string; href?: string };
export type FieldErrors = Record<string, FieldError>;

// What the person form sends, as typed (also sent back to the form on a refusal).
export type PersonForm = {
  firstName: string;
  lastName: string;
  emails: { value: string; kind: string }[];
  phones: { value: string; kind: string }[];
  organisationId: string;
  newOrganisationName: string;
  role: string;
  leadSourceId: string;
  linkedin: string;
  ownerId: string;
  labelIds: string[];
  consent: string;
  private: boolean;
};

// A person's fields once validated and normalised (and as compared for the timeline).
export type PersonFields = {
  firstName: string;
  lastName: string;
  emails: { email: string; kind: Kind }[];
  phones: { phone: string; kind: Kind }[];
  organisationId: number | null;
  newOrganisationName: string | null;
  role: string | null;
  leadSourceId: number | null;
  linkedin: string | null;
  ownerId: number | null;
  labelIds: number[];
  consent: Consent;
  private: boolean;
};

export type OrganisationForm = { name: string; website: string; sector: string; size: string; location: string; ownerId: string };
export type OrganisationFields = {
  name: string;
  website: string | null;
  sector: string | null;
  size: Size | null;
  location: string | null;
  ownerId: number | null;
};

type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9 +().-]+$/;
const ID = /^[1-9][0-9]{0,15}$/;

function cut(text: string, max: number): string {
  return text.trim().slice(0, max).trim();
}

function optional(text: string, max: number): string | null {
  const value = cut(text ?? "", max);
  return value === "" ? null : value;
}

export function toId(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!ID.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

function toKind(value: string): Kind {
  return (KINDS as readonly string[]).includes(value) ? (value as Kind) : "work";
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL.test(email);
}

// Trimmed, as typed; null when not a phone number.
export function normalisePhone(raw: string): string | null {
  const phone = raw.trim();
  if (phone.length > 40 || !PHONE.test(phone) || !/[0-9]/.test(phone)) return null;
  return phone;
}

// An http(s) address with a dotted host, no spaces, no credentials. "" stays "" (not set); null = refused.
function normaliseHttpUrl(raw: string): URL | "" | null {
  let text = raw.trim();
  if (text === "") return "";
  if (text.length > 2000 || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".") || url.hostname.startsWith(".") || url.hostname.endsWith(".")) return null;
  if (url.username || url.password) return null;
  return url;
}

function hrefOf(url: URL): string {
  // A bare host is stored without the slash the parser adds: https://fakeco.example
  if (url.pathname === "/" && !url.search && !url.hash) return `${url.protocol}//${url.host}`;
  return url.href;
}

export function normaliseWebsite(raw: string): string | null {
  const url = normaliseHttpUrl(raw);
  return url === "" || url === null ? url : hrefOf(url);
}

export function normaliseLinkedIn(raw: string): string | null {
  const url = normaliseHttpUrl(raw);
  if (url === "" || url === null) return url;
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  return hrefOf(url);
}

// The host shown in the Organisations list for a website.
export function websiteHost(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).host;
  } catch {
    return website;
  }
}

export function validatePerson(form: PersonForm): Validated<PersonFields> {
  const errors: FieldErrors = {};
  const firstName = cut(form.firstName ?? "", 100);
  const lastName = cut(form.lastName ?? "", 100);
  if (firstName === "" && lastName === "") errors.name = { code: "name_required" };

  const emails: PersonFields["emails"] = [];
  const seen = new Set<string>();
  form.emails.forEach((row, i) => {
    const email = normaliseEmail(row.value ?? "");
    if (email === "") return;
    if (!isValidEmail(email)) errors[`emails.${i}`] = { code: "email_invalid" };
    else if (seen.has(email)) errors[`emails.${i}`] = { code: "email_twice" };
    seen.add(email);
    emails.push({ email, kind: toKind(row.kind) });
  });

  const phones: PersonFields["phones"] = [];
  form.phones.forEach((row, i) => {
    if ((row.value ?? "").trim() === "") return;
    const phone = normalisePhone(row.value);
    if (phone === null) errors[`phones.${i}`] = { code: "phone_invalid" };
    else phones.push({ phone, kind: toKind(row.kind) });
  });

  const linkedin = normaliseLinkedIn(form.linkedin ?? "");
  if (linkedin === null) errors.linkedin = { code: "linkedin_invalid" };

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const organisationId = toId(form.organisationId);
  return {
    ok: true,
    value: {
      firstName,
      lastName,
      emails,
      phones,
      organisationId,
      newOrganisationName: organisationId === null ? optional(form.newOrganisationName ?? "", 200) : null,
      role: optional(form.role ?? "", 200),
      leadSourceId: toId(form.leadSourceId),
      linkedin: linkedin || null,
      ownerId: toId(form.ownerId),
      labelIds: [...new Set(form.labelIds.map(toId).filter((id): id is number => id !== null))].sort((a, b) => a - b),
      consent: form.consent === "unsubscribed" ? "unsubscribed" : "subscribed",
      private: form.private === true,
    },
  };
}

export function validateOrganisation(form: OrganisationForm): Validated<OrganisationFields> {
  const errors: FieldErrors = {};
  const name = cut(form.name ?? "", 200);
  if (name === "") errors.name = { code: "organisation_name_required" };
  const website = normaliseWebsite(form.website ?? "");
  if (website === null) errors.website = { code: "website_invalid" };
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      website: website || null,
      sector: optional(form.sector ?? "", 100),
      size: (SIZES as readonly string[]).includes(form.size) ? (form.size as Size) : null,
      location: optional(form.location ?? "", 100),
      ownerId: toId(form.ownerId),
    },
  };
}

export function validateChoiceName(raw: string): { ok: true; name: string } | { ok: false; code: "choice_name_required" } {
  const name = cut(raw ?? "", 100);
  return name === "" ? { ok: false, code: "choice_name_required" } : { ok: true, name };
}

// `%`, `_` and `\` are literal in a search (Postgres' default LIKE escape is the backslash).
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Fields compared for an "Edited by …: <fields>" event, in the order the form shows them.
export type FieldList<T> = readonly (readonly [keyof T, string])[];

export const PERSON_FIELDS: FieldList<PersonFields> = [
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["organisationId", "Organisation"],
  ["role", "Role"],
  ["emails", "Email addresses"],
  ["phones", "Phone numbers"],
  ["leadSourceId", "Lead source"],
  ["linkedin", "LinkedIn"],
  ["ownerId", "Owner"],
  ["labelIds", "Labels"],
  ["consent", "Consent"],
  ["private", "Private"],
];

export const ORGANISATION_FIELDS: FieldList<OrganisationFields> = [
  ["name", "Name"],
  ["website", "Website"],
  ["sector", "Sector"],
  ["size", "Size"],
  ["location", "Location"],
  ["ownerId", "Owner"],
];

export function changedFields<T>(fields: FieldList<T>, before: T, after: T): string[] {
  return fields.filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(([, label]) => label);
}

export function changedPersonFields(before: PersonFields, after: PersonFields): string[] {
  return changedFields(PERSON_FIELDS, before, after);
}

export function changedOrganisationFields(before: OrganisationFields, after: OrganisationFields): string[] {
  return changedFields(ORGANISATION_FIELDS, before, after);
}

export function fullName(p: { first_name: string; last_name: string }): string {
  return `${p.first_name} ${p.last_name}`.trim();
}
