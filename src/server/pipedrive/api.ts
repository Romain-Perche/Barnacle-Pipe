// Pipedrive through plain fetch (SF-117 contracts/pipedrive-api.md § Calls, research.md §1): six GET calls, no library.
// The personal API token goes in the `x-api-token` header, never in the address, so it stays out of request logs and
// out of any error. Settings come from pipedriveConfig() at call time; in fake mode the calls go in process to
// fakePipedrive(). Every call times out after 10 seconds. The errors carry no address, header or body text.
import { pipedriveConfig } from "@/server/env";
import { fakePipedrive } from "@/server/pipedrive/fake-pipedrive";

export class PipedriveRefused extends Error {
  constructor() {
    super("Pipedrive refused the token");
    this.name = "PipedriveRefused";
  }
}
export class PipedriveSlowDown extends Error {
  constructor(readonly seconds: number) {
    super("Pipedrive asked to slow down");
    this.name = "PipedriveSlowDown";
  }
}
export class PipedriveBadRequest extends Error {
  constructor() {
    super("Pipedrive refused the request");
    this.name = "PipedriveBadRequest";
  }
}
export class PipedriveUnreachable extends Error {
  constructor() {
    super("Pipedrive can't be reached");
    this.name = "PipedriveUnreachable";
  }
}

export const TIMEOUT_MS = 10_000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
let testFetch: Fetch | null = null;

// Tests only: every Pipedrive call goes to `fn` (tests/fakes/pipedrive.ts). Throws outside APP_ENV=test.
export function usePipedriveFetchForTests(fn: Fetch | null): void {
  if (process.env.APP_ENV !== "test") throw new Error("usePipedriveFetchForTests is for tests only.");
  testFetch = fn;
}

// The wait Pipedrive asks for: Retry-After (seconds), else x-ratelimit-reset (seconds), else 10; kept within 1–300.
export function retrySeconds(headers: Headers): number {
  const read = (name: string) => {
    const text = (headers.get(name) ?? "").trim();
    return /^\d+(\.\d+)?$/.test(text) ? Math.ceil(Number(text)) : null;
  };
  const seconds = read("retry-after") ?? read("x-ratelimit-reset") ?? 10;
  return Math.min(300, Math.max(1, seconds));
}

type Query = Record<string, string | number | undefined>;

async function get(token: string, path: string, query: Query = {}): Promise<{ data?: unknown; additional_data?: { next_cursor?: string | null } }> {
  const c = pipedriveConfig();
  const f: Fetch = testFetch ?? (c.mode === "fake" ? fakePipedrive().fetch : fetch);
  const url = new URL(`${c.baseUrl}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  // A timer (not AbortSignal.timeout) so that the tests can move the clock.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await f(url.toString(), {
        method: "GET",
        headers: { "x-api-token": token, accept: "application/json" },
        signal: abort.signal,
        cache: "no-store",
      });
    } catch (e) {
      // fetch rejects with a TypeError on a network error and an AbortError on the time-out; anything else is a bug.
      if (e instanceof TypeError || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"))) throw new PipedriveUnreachable();
      throw e;
    }
    if (res.status === 401 || res.status === 403) throw new PipedriveRefused();
    if (res.status === 429) throw new PipedriveSlowDown(retrySeconds(res.headers));
    if (res.status === 400) throw new PipedriveBadRequest();
    if (res.status !== 200) throw new PipedriveUnreachable();
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PipedriveUnreachable();
    }
    if (typeof body !== "object" || body === null || (body as { success?: unknown }).success !== true) throw new PipedriveUnreachable();
    return body as { data?: unknown; additional_data?: { next_cursor?: string | null } };
  } finally {
    clearTimeout(timer);
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export type PdMe = { id: number; name: string; companyId: number; companyName: string };
export type PdUser = { id: number; name: string; email: string };
export type PdOption = { id: number; label: string };
export type PdField = { code: string; name: string; type: string; custom: boolean; options: PdOption[] };
export type PdContact = { value: string; primary: boolean; label: string };
export type PdOrganization = {
  id: number;
  name: string;
  ownerId: number | null;
  visibleTo: number | null;
  addTime: string;
  address: string;
  website: string;
  industry: number | null;
  employeeCount: number | null;
  custom: Record<string, unknown>;
  deleted: boolean;
};
export type PdPerson = {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  ownerId: number | null;
  orgId: number | null;
  addTime: string;
  emails: PdContact[];
  phones: PdContact[];
  visibleTo: number | null;
  labelIds: number[];
  jobTitle: string;
  // null: not asked for (no marketing app) or not set.
  marketingStatus: string | null;
  custom: Record<string, unknown>;
  deleted: boolean;
};
export type Page<T> = { items: T[]; next: string | null };

export async function whoAmI(token: string): Promise<PdMe> {
  const d = obj((await get(token, "/v1/users/me")).data);
  const id = num(d.id);
  const companyId = num(d.company_id);
  if (id === null || companyId === null) throw new PipedriveUnreachable();
  return { id, name: str(d.name), companyId, companyName: str(d.company_name) };
}

export async function listUsers(token: string): Promise<PdUser[]> {
  return list((await get(token, "/v1/users")).data).flatMap((u) => {
    const r = obj(u);
    const id = num(r.id);
    return id === null ? [] : [{ id, name: str(r.name), email: str(r.email) }];
  });
}

export async function listFields(token: string, kind: "person" | "organization", cursor: string | null): Promise<Page<PdField>> {
  const body = await get(token, kind === "person" ? "/api/v2/personFields" : "/api/v2/organizationFields", { limit: 500, cursor: cursor ?? undefined });
  const items = list(body.data).map((f) => {
    const r = obj(f);
    return {
      code: str(r.field_code),
      name: str(r.field_name),
      type: str(r.field_type),
      custom: r.is_custom_field === true,
      options: list(r.options).flatMap((o) => {
        const id = num(obj(o).id);
        return id === null ? [] : [{ id, label: str(obj(o).label) }];
      }),
    };
  });
  return { items, next: body.additional_data?.next_cursor ?? null };
}

const contacts = (v: unknown): PdContact[] =>
  list(v).map((c) => ({ value: str(obj(c).value), primary: obj(c).primary === true, label: str(obj(c).label) }));

export async function listOrganizations(token: string, o: { cursor: string | null; limit: number; ids?: number[] }): Promise<Page<PdOrganization>> {
  const body = await get(token, "/api/v2/organizations", {
    limit: o.limit,
    sort_by: "id",
    sort_direction: "asc",
    cursor: o.cursor ?? undefined,
    ids: o.ids && o.ids.length > 0 ? o.ids.join(",") : undefined,
  });
  const items = list(body.data).flatMap((x) => {
    const r = obj(x);
    const id = num(r.id);
    if (id === null) return [];
    return [{
      id,
      name: str(r.name),
      ownerId: num(r.owner_id),
      visibleTo: num(r.visible_to),
      addTime: str(r.add_time),
      address: str(obj(r.address).value),
      website: str(r.website),
      industry: num(r.industry),
      employeeCount: num(r.employee_count),
      custom: obj(r.custom_fields),
      deleted: r.is_deleted === true,
    }];
  });
  return { items, next: body.additional_data?.next_cursor ?? null };
}

export async function listPersons(token: string, o: { cursor: string | null; limit: number; marketing: boolean }): Promise<Page<PdPerson>> {
  const body = await get(token, "/api/v2/persons", {
    limit: o.limit,
    sort_by: "id",
    sort_direction: "asc",
    cursor: o.cursor ?? undefined,
    include_fields: o.marketing ? "marketing_status" : undefined,
  });
  const items = list(body.data).flatMap((x) => {
    const r = obj(x);
    const id = num(r.id);
    if (id === null) return [];
    return [{
      id,
      name: str(r.name),
      firstName: str(r.first_name),
      lastName: str(r.last_name),
      ownerId: num(r.owner_id),
      orgId: num(r.org_id),
      addTime: str(r.add_time),
      emails: contacts(r.emails),
      phones: contacts(r.phones),
      visibleTo: num(r.visible_to),
      labelIds: list(r.label_ids).flatMap((l) => (num(l) === null ? [] : [num(l)!])),
      jobTitle: str(r.job_title),
      marketingStatus: typeof r.marketing_status === "string" ? r.marketing_status : null,
      custom: obj(r.custom_fields),
      deleted: r.is_deleted === true,
    }];
  });
  return { items, next: body.additional_data?.next_cursor ?? null };
}
