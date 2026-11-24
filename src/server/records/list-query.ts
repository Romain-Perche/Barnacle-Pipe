// List addresses (contracts/list-query.md). Pure: searchParams in, a validated query out, and links back.
// Invalid values are dropped (treated as absent), never echoed as messages.
import { SORTABLE_TYPES, parseNumber, type CustomField } from "@/server/custom-fields/rules";
import { parseDate, parseMoney } from "@/server/deals/rules";
import { CONSENTS, SIZES, toId, type Consent, type Size } from "@/server/records/rules";

export type Params = Record<string, string | string[] | undefined>;
export type Dir = "asc" | "desc";

export const PEOPLE_SORTS = ["name", "organisation", "added", "contacted"] as const;
export const ORGANISATION_SORTS = ["name", "people", "added"] as const;
export const DEAL_SORTS = ["title", "value", "organisation", "stage", "owner", "close", "added"] as const;
export const DEAL_STATUSES = ["open", "won", "lost"] as const;
export const PAGE_SIZE = 50;
// SF-115: a sort by a custom field shown in the list (`sort=cf<id>`).
export type CustomSort = `cf${number}`;
// SF-115: the list's custom filters, raw from the address (`cf<id>`, `cf<id>_from`, `cf<id>_to`); knownCustomQuery keeps
// only those of fields shown in the list with a valid value.
export type CustomQuery = Record<string, string>;

export type PeopleQuery = {
  q: string;
  owner: number | null;
  label: number | null;
  source: number | null;
  org: number | null;
  consent: Consent | null;
  sort: (typeof PEOPLE_SORTS)[number] | CustomSort;
  dir: Dir;
  page: number;
  archived: boolean;
  open: number | null;
  // SF-114: "Referred by" (a person id).
  ref: number | null;
  custom: CustomQuery;
};

export type OrganisationsQuery = {
  q: string;
  owner: number | null;
  sector: string | null;
  size: Size | null;
  sort: (typeof ORGANISATION_SORTS)[number] | CustomSort;
  dir: Dir;
  page: number;
  archived: boolean;
  open: number | null;
  custom: CustomQuery;
};

// The deal list (SF-95 research.md §5): newest first by default; `status` is only used when closed or archived deals
// are shown, and `stage` only when it belongs to `pipeline` (both checked by the page and list.ts).
export type DealsQuery = {
  q: string;
  pipeline: number | null;
  stage: number | null;
  owner: number | null;
  label: number | null;
  status: (typeof DEAL_STATUSES)[number] | null;
  sort: (typeof DEAL_SORTS)[number] | CustomSort;
  dir: Dir;
  page: number;
  closed: boolean;
  archived: boolean;
  open: number | null;
  // SF-114: "Referred by" (a person id).
  ref: number | null;
  custom: CustomQuery;
};

// The Activities list (SF-109 contracts/routes.md § /activities): `assignee` null is the viewer, "all" everyone.
export const ACTIVITY_WHEN = ["overdue", "today", "week", "planned", "done"] as const;
export const ACTIVITY_TYPE_FILTERS = ["call", "meeting", "task"] as const;
export type ActivitiesQuery = {
  when: (typeof ACTIVITY_WHEN)[number];
  assignee: number | "all" | null;
  type: (typeof ACTIVITY_TYPE_FILTERS)[number] | null;
  page: number;
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

const CUSTOM_KEY = /^cf[1-9][0-9]{0,15}(_from|_to)?$/;
const CUSTOM_SORT = /^cf[1-9][0-9]{0,15}$/;
const MAX_CUSTOM = 24;

// SF-115 research.md §10: at most 24 non-empty `cf…` entries, each value trimmed and cut at 200 characters.
function customParams(params: Params): CustomQuery {
  const custom: CustomQuery = {};
  for (const key of Object.keys(params)) {
    if (Object.keys(custom).length >= MAX_CUSTOM) break;
    if (!CUSTOM_KEY.test(key)) continue;
    const value = first(params, key).trim().slice(0, 200);
    if (value !== "") custom[key] = value;
  }
  return custom;
}

function sortOf<T extends string>(raw: string, allowed: readonly T[], fallback: T): T | CustomSort {
  return oneOf(raw, allowed) ?? (CUSTOM_SORT.test(raw) ? (raw as CustomSort) : fallback);
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
    sort: sortOf(first(params, "sort"), PEOPLE_SORTS, "name"),
    dir: c.dir,
    page: c.page,
    archived: c.archived,
    open: c.open,
    ref: parseId(first(params, "ref")),
    custom: customParams(params),
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
    sort: sortOf(first(params, "sort"), ORGANISATION_SORTS, "name"),
    dir: c.dir,
    page: c.page,
    archived: c.archived,
    open: c.open,
    custom: customParams(params),
  };
}

export function parseDealsQuery(params: Params): DealsQuery {
  const c = common(params);
  return {
    q: c.q,
    pipeline: parseId(first(params, "pipeline")),
    stage: parseId(first(params, "stage")),
    owner: c.owner,
    label: parseId(first(params, "label")),
    status: oneOf(first(params, "status"), DEAL_STATUSES),
    sort: sortOf(first(params, "sort"), DEAL_SORTS, "added"),
    dir: first(params, "dir") === "asc" ? "asc" : "desc",
    page: c.page,
    closed: first(params, "closed") === "1",
    archived: c.archived,
    open: c.open,
    ref: parseId(first(params, "ref")),
    custom: customParams(params),
  };
}

export function parseActivitiesQuery(params: Params): ActivitiesQuery {
  const page = Number(first(params, "page"));
  const assignee = first(params, "assignee");
  return {
    when: oneOf(first(params, "when"), ACTIVITY_WHEN) ?? "planned",
    assignee: assignee === "all" ? "all" : parseId(assignee),
    type: oneOf(first(params, "type"), ACTIVITY_TYPE_FILTERS),
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

export function hasDealFilters(query: DealsQuery): boolean {
  return (
    query.q !== "" || query.pipeline !== null || query.stage !== null || query.owner !== null || query.label !== null ||
    query.status !== null || query.closed || query.archived || query.ref !== null || Object.keys(query.custom).length > 0
  );
}

// Only known values are kept, so they are listed, counted and shown back (FR-013): a pipeline that is an option, a
// stage of that pipeline, an owner, a label and a referrer that are options, a status when closed or archived deals are shown.
type Known = { readonly id: number };
export function knownDealsQuery(
  query: DealsQuery,
  options: { pipelines: readonly Known[]; stages: readonly Known[]; owners: readonly Known[]; labels: readonly Known[]; referrers: readonly Known[] },
): DealsQuery {
  const known = (id: number | null, list: readonly Known[]) => (id !== null && list.some((o) => o.id === id) ? id : null);
  const pipeline = known(query.pipeline, options.pipelines);
  return {
    ...query,
    pipeline,
    stage: pipeline === null ? null : known(query.stage, options.stages),
    owner: known(query.owner, options.owners),
    label: known(query.label, options.labels),
    ref: known(query.ref, options.referrers),
    status: query.closed || query.archived ? query.status : null,
  };
}

// The People list keeps a referrer only when it is one of its options (FR-013): a person hidden from the viewer
// never filters, counts or shows back. Owner, label, source, organisation and consent are not private: unchanged.
export function knownPeopleQuery(query: PeopleQuery, options: { referrers: readonly Known[] }): PeopleQuery {
  return { ...query, ref: query.ref !== null && options.referrers.some((o) => o.id === query.ref) ? query.ref : null };
}

// SF-115 (FR-012): only filters of fields shown in the list with a value valid for the type are kept (a choice of
// the field, removed ones included; "empty"; yes / no; a number, an amount or a day that reads); a sort on a field that
// is not shown or not sortable falls back to the list's default. Nothing else from the address is used.
export function knownCustomQuery<Q extends PeopleQuery | OrganisationsQuery | DealsQuery>(query: Q, shown: readonly CustomField[]): Q {
  const custom: CustomQuery = {};
  for (const field of shown) {
    const key = `cf${field.id}`;
    const raw = query.custom[key];
    const range = (check: (v: string) => boolean) => {
      for (const end of ["_from", "_to"]) {
        const v = query.custom[key + end];
        if (v !== undefined && check(v)) custom[key + end] = v;
      }
    };
    if (raw === "empty") custom[key] = raw;
    switch (field.type) {
      case "text":
      case "long_text":
        if (raw !== undefined && raw !== "empty") custom[key] = raw;
        break;
      case "number":
        range((v) => { const n = parseNumber(v); return n.ok && n.value !== null; });
        break;
      case "money":
        range((v) => { const m = parseMoney(v); return m.ok && m.pence !== null; });
        break;
      case "date":
        range((v) => { const d = parseDate(v); return d.ok && d.date !== null; });
        break;
      case "single_choice":
      case "multiple_choice":
        if (raw !== undefined && field.choices.some((c) => String(c.id) === raw)) custom[key] = raw;
        break;
      case "yes_no":
        if (raw === "yes" || raw === "no") custom[key] = raw;
        break;
    }
  }
  const sortField = CUSTOM_SORT.test(query.sort) ? shown.find((f) => `cf${f.id}` === query.sort) : undefined;
  const fallback = "closed" in query ? "added" : "name";
  const sort = CUSTOM_SORT.test(query.sort) && !(sortField && SORTABLE_TYPES.includes(sortField.type)) ? fallback : query.sort;
  return { ...query, custom, sort };
}

// The sector filter only keeps a value that is one of the sectors in use (matched ignoring case), so text
// from the address is never shown back on the page (FR-025); an unknown sector filters nothing.
export function knownSector(sector: string | null, inUse: readonly string[]): string | null {
  if (sector === null) return null;
  return inUse.find((s) => s.toLowerCase() === sector.toLowerCase()) ?? null;
}

type AnyQuery = PeopleQuery | OrganisationsQuery | DealsQuery | ActivitiesQuery;
const ORDER = [
  "when", "assignee", "type", "q", "pipeline", "stage", "owner", "label", "source", "org", "consent", "sector", "size", "status", "sort", "dir", "page", "closed", "archived", "ref", "open",
];
const DEFAULTS: Record<string, unknown> = { q: "", sort: "name", dir: "asc", page: 1, closed: false, archived: false };
// The deal list's own defaults (newest first); people and organisations keep the ones above.
const DEAL_DEFAULTS: Record<string, unknown> = { ...DEFAULTS, sort: "added", dir: "desc" };
const ACTIVITY_DEFAULTS: Record<string, unknown> = { when: "planned", page: 1 };

// A link to `path` with `changes` applied. Changing anything but the page or the drawer goes back to page 1;
// changing anything but the drawer closes the drawer.
export function withParams<Q extends AnyQuery>(path: string, current: Q, changes: Partial<Q>): string {
  const next: Record<string, unknown> = { ...current, ...changes };
  const keys = Object.keys(changes);
  if (keys.some((k) => k !== "page" && k !== "open") && !("page" in changes)) next.page = 1;
  if (keys.some((k) => k !== "open") && !("open" in changes)) next.open = null;
  const defaults = "when" in current ? ACTIVITY_DEFAULTS : "closed" in current ? DEAL_DEFAULTS : DEFAULTS;
  const search = new URLSearchParams();
  for (const key of ORDER) {
    if (!(key in next)) continue;
    const value = next[key];
    if (value === null || value === undefined || value === defaults[key]) continue;
    if (key === "archived" || key === "closed") {
      if (value === true) search.set(key, "1");
      continue;
    }
    search.set(key, String(value));
  }
  // SF-115: the custom filters, after the built-in keys, sorted by key.
  const custom = (next.custom ?? {}) as CustomQuery;
  for (const key of Object.keys(custom).sort()) search.set(key, custom[key]);
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

export function hasFilters(query: PeopleQuery | OrganisationsQuery): boolean {
  const { q, owner } = query;
  const extra =
    "label" in query
      ? query.label !== null || query.source !== null || query.org !== null || query.consent !== null || query.ref !== null
      : query.sector !== null || query.size !== null;
  return q !== "" || owner !== null || extra || Object.keys(query.custom).length > 0;
}
