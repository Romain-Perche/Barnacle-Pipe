// List addresses (contracts/list-query.md). Pure: searchParams in, a validated query out, and links back.
// Invalid values are dropped (treated as absent), never echoed as messages.
import { CONSENTS, SIZES, toId, type Consent, type Size } from "@/server/records/rules";

export type Params = Record<string, string | string[] | undefined>;
export type Dir = "asc" | "desc";

export const PEOPLE_SORTS = ["name", "organisation", "added", "contacted"] as const;
export const ORGANISATION_SORTS = ["name", "people", "added"] as const;
export const PAGE_SIZE = 50;

export type PeopleQuery = {
  q: string;
  owner: number | null;
  label: number | null;
  source: number | null;
  org: number | null;
  consent: Consent | null;
  sort: (typeof PEOPLE_SORTS)[number];
  dir: Dir;
  page: number;
  archived: boolean;
  open: number | null;
};

export type OrganisationsQuery = {
  q: string;
  owner: number | null;
  sector: string | null;
  size: Size | null;
  sort: (typeof ORGANISATION_SORTS)[number];
  dir: Dir;
  page: number;
  archived: boolean;
  open: number | null;
};

function first(params: Params, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseId(value: string | undefined | null): number | null {
  return toId(value ?? "");
}

function common(params: Params) {
  const page = Number(first(params, "page"));
  return {
    q: first(params, "q").trim().slice(0, 200),
    owner: parseId(first(params, "owner")),
    dir: (first(params, "dir") === "desc" ? "desc" : "asc") as Dir,
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    archived: first(params, "archived") === "1",
    open: parseId(first(params, "open")),
  };
}

export function parsePeopleQuery(params: Params): PeopleQuery {
  const c = common(params);
  return {
    q: c.q,
    owner: c.owner,
    label: parseId(first(params, "label")),
    source: parseId(first(params, "source")),
    org: parseId(first(params, "org")),
    consent: oneOf(first(params, "consent"), CONSENTS),
    sort: oneOf(first(params, "sort"), PEOPLE_SORTS) ?? "name",
    dir: c.dir,
    page: c.page,
    archived: c.archived,
    open: c.open,
  };
}

export function parseOrganisationsQuery(params: Params): OrganisationsQuery {
  const c = common(params);
  const sector = first(params, "sector").trim().slice(0, 100);
  return {
    q: c.q,
    owner: c.owner,
    sector: sector === "" ? null : sector,
    size: oneOf(first(params, "size"), SIZES),
    sort: oneOf(first(params, "sort"), ORGANISATION_SORTS) ?? "name",
    dir: c.dir,
    page: c.page,
    archived: c.archived,
    open: c.open,
  };
}

// The sector filter only keeps a value that is one of the sectors in use (matched ignoring case), so text
// from the address is never shown back on the page (FR-025); an unknown sector filters nothing.
export function knownSector(sector: string | null, inUse: readonly string[]): string | null {
  if (sector === null) return null;
  return inUse.find((s) => s.toLowerCase() === sector.toLowerCase()) ?? null;
}

type AnyQuery = PeopleQuery | OrganisationsQuery;
const ORDER = ["q", "owner", "label", "source", "org", "consent", "sector", "size", "sort", "dir", "page", "archived", "open"];
const DEFAULTS: Record<string, unknown> = { q: "", sort: "name", dir: "asc", page: 1, archived: false };

// A link to `path` with `changes` applied. Changing anything but the page or the drawer goes back to page 1;
// changing anything but the drawer closes the drawer.
export function withParams<Q extends AnyQuery>(path: string, current: Q, changes: Partial<Q>): string {
  const next: Record<string, unknown> = { ...current, ...changes };
  const keys = Object.keys(changes);
  if (keys.some((k) => k !== "page" && k !== "open") && !("page" in changes)) next.page = 1;
  if (keys.some((k) => k !== "open") && !("open" in changes)) next.open = null;
  const search = new URLSearchParams();
  for (const key of ORDER) {
    if (!(key in next)) continue;
    const value = next[key];
    if (value === null || value === undefined || value === DEFAULTS[key]) continue;
    if (key === "archived") {
      if (value === true) search.set(key, "1");
      continue;
    }
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

export function hasFilters(query: AnyQuery): boolean {
  const { q, owner } = query;
  const extra =
    "label" in query
      ? query.label !== null || query.source !== null || query.org !== null || query.consent !== null
      : query.sector !== null || query.size !== null;
  return q !== "" || owner !== null || extra;
}
