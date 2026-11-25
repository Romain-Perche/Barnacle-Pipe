// Pipedrive through plain fetch (SF-117 contracts/pipedrive-api.md § Calls, research.md §1): six GET calls, no library.
// SF-122 adds pipelines, stages, deal fields, deals (open and archived), followers, participants, activities, activity
// types, notes, files and file downloads (specs/sf-122-…/contracts/pipedrive-api.md). A download is the one call with
// `redirect: "manual"`: a redirect to Pipedrive's file host is followed once WITHOUT the token, so the token never
// leaves for another host; it reads at most `maxBytes` and times out after 20 seconds.
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
type Additional = {
  next_cursor?: string | null;
  pagination?: { more_items_in_collection?: boolean; next_start?: number };
  more_items_in_collection?: boolean;
  start?: number;
  limit?: number;
};
type Body = { data?: unknown; additional_data?: Additional };

function target(path: string, query: Query) {
  const c = pipedriveConfig();
  const f: Fetch = testFetch ?? (c.mode === "fake" ? fakePipedrive().fetch : fetch);
  const url = new URL(`${c.baseUrl}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  return { f, url };
}

const isNetworkError = (e: unknown) => e instanceof TypeError || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"));

async function get(token: string, path: string, query: Query = {}): Promise<Body> {
  const { f, url } = target(path, query);
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
      if (isNetworkError(e)) throw new PipedriveUnreachable();
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
    return body as Body;
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

const FIELD_PATHS = { person: "/api/v2/personFields", organization: "/api/v2/organizationFields", deal: "/api/v2/dealFields" } as const;

export async function listFields(token: string, kind: "person" | "organization" | "deal", cursor: string | null): Promise<Page<PdField>> {
  const body = await get(token, FIELD_PATHS[kind], { limit: 500, cursor: cursor ?? undefined });
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

// ---------------------------------------------------------------- SF-122: deals, notes, activities and files

export type PdPipeline = { id: number; name: string; order: number; deleted: boolean };
export type PdStage = { id: number; pipelineId: number; name: string; order: number; deleted: boolean };
export type PdDeal = {
  id: number;
  title: string;
  ownerId: number | null;
  personId: number | null;
  orgId: number | null;
  stageId: number | null;
  value: number | null;
  currency: string;
  addTime: string;
  updateTime: string;
  stageChangeTime: string;
  status: string;
  lostReason: string;
  visibleTo: number | null;
  wonTime: string;
  lostTime: string;
  closeTime: string;
  expectedCloseDate: string;
  labelIds: number[];
  archived: boolean;
  deleted: boolean;
  followersCount: number | null;
  participantsCount: number | null;
  custom: Record<string, unknown>;
};
export type PdActivity = {
  id: number;
  subject: string;
  type: string;
  ownerId: number | null;
  deleted: boolean;
  addTime: string;
  updateTime: string;
  dealId: number | null;
  leadId: string;
  personId: number | null;
  orgId: number | null;
  projectId: number | null;
  dueDate: string;
  dueTime: string;
  duration: string;
  done: boolean;
  doneTime: string;
  note: string;
};
export type PdNote = {
  id: number;
  active: boolean;
  addTime: string;
  content: string;
  dealId: number | null;
  personId: number | null;
  orgId: number | null;
  leadId: string;
  userId: number | null;
};
export type PdFile = {
  id: number;
  active: boolean;
  addTime: string;
  name: string;
  size: number | null;
  userId: number | null;
  dealId: number | null;
  personId: number | null;
  orgId: number | null;
  leadId: string;
  mailMessageId: string;
  remoteLocation: string;
};
export type PdActivityType = { key: string; name: string };
export type V1Page<T> = { items: T[]; next: number | null };

const ids = (v: unknown): number[] => list(v).flatMap((l) => (num(l) === null ? [] : [num(l)!]));
// A text field Pipedrive may also send as a number (lead ids, mail ids).
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
// v1 paging: `additional_data.pagination.next_start` when there are more (or, as the participants schema has it,
// `additional_data.more_items_in_collection` with `start` and `limit`).
function nextStart(a: Additional | undefined, start: number, got: number): number | null {
  if (a?.pagination) return a.pagination.more_items_in_collection === true ? (num(a.pagination.next_start) ?? start + got) : null;
  return a?.more_items_in_collection === true ? start + got : null;
}

async function v2All<T>(token: string, path: string, read: (r: Record<string, unknown>) => T | null, cursor: string | null, query: Query = {}): Promise<Page<T>> {
  const body = await get(token, path, { limit: 500, ...query, cursor: cursor ?? undefined });
  return { items: list(body.data).flatMap((x) => { const v = read(obj(x)); return v === null ? [] : [v]; }), next: body.additional_data?.next_cursor ?? null };
}

export function listPipelines(token: string, cursor: string | null): Promise<Page<PdPipeline>> {
  return v2All(token, "/api/v2/pipelines", (r) => {
    const id = num(r.id);
    return id === null ? null : { id, name: str(r.name), order: num(r.order_nr) ?? 0, deleted: r.is_deleted === true };
  }, cursor, { sort_by: "id", sort_direction: "asc" });
}

export function listStages(token: string, cursor: string | null): Promise<Page<PdStage>> {
  return v2All(token, "/api/v2/stages", (r) => {
    const id = num(r.id);
    const pipelineId = num(r.pipeline_id);
    return id === null || pipelineId === null ? null : { id, pipelineId, name: str(r.name), order: num(r.order_nr) ?? 0, deleted: r.is_deleted === true };
  }, cursor, { sort_by: "id", sort_direction: "asc" });
}

export async function listDeals(token: string, o: { archived: boolean; cursor: string | null; limit: number }): Promise<Page<PdDeal>> {
  const body = await get(token, o.archived ? "/api/v2/deals/archived" : "/api/v2/deals", {
    limit: o.limit,
    cursor: o.cursor ?? undefined,
    sort_by: "id",
    sort_direction: "asc",
    include_fields: "followers_count,participants_count",
  });
  const items = list(body.data).flatMap((x): PdDeal[] => {
    const r = obj(x);
    const id = num(r.id);
    if (id === null) return [];
    return [{
      id,
      title: str(r.title),
      ownerId: num(r.owner_id),
      personId: num(r.person_id),
      orgId: num(r.org_id),
      stageId: num(r.stage_id),
      value: num(r.value),
      currency: str(r.currency),
      addTime: str(r.add_time),
      updateTime: str(r.update_time),
      stageChangeTime: str(r.stage_change_time),
      status: str(r.status),
      lostReason: str(r.lost_reason),
      visibleTo: num(r.visible_to),
      wonTime: str(r.won_time),
      lostTime: str(r.lost_time),
      closeTime: str(r.close_time),
      expectedCloseDate: str(r.expected_close_date),
      labelIds: ids(r.label_ids),
      archived: o.archived || r.is_archived === true,
      deleted: r.is_deleted === true,
      followersCount: num(r.followers_count),
      participantsCount: num(r.participants_count),
      custom: obj(r.custom_fields),
    }];
  });
  return { items, next: body.additional_data?.next_cursor ?? null };
}

// The Pipedrive user ids following a deal (every page, at most 5).
export async function dealFollowers(token: string, dealId: number): Promise<number[]> {
  const out: number[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const page: Page<number> = await v2All(token, `/api/v2/deals/${dealId}/followers`, (r) => num(r.user_id), cursor);
    out.push(...page.items);
    cursor = page.next;
    if (!cursor) break;
  }
  return out;
}

// The people of a deal (its main person included). The person id is `person_id.value`, else `person_id` when it is a
// number, else the item's own `id` (the pinned schema's shape: the item is the person).
export async function dealParticipants(token: string, dealId: number): Promise<{ personId: number; name: string }[]> {
  const out: { personId: number; name: string }[] = [];
  let start = 0;
  for (let i = 0; i < 5; i++) {
    const body = await get(token, `/v1/deals/${dealId}/participants`, { start, limit: 500 });
    const items = list(body.data);
    for (const x of items) {
      const r = obj(x);
      const pid = obj(r.person_id);
      const personId = num(pid.value) ?? num(r.person_id) ?? num(r.id);
      if (personId === null) continue;
      const person = obj(r.person);
      out.push({ personId, name: str(person.name) || str(pid.name) || str(r.name) });
    }
    const next = nextStart(body.additional_data, start, items.length);
    if (next === null) break;
    start = next;
  }
  return out;
}

export async function listActivities(token: string, o: { cursor: string | null; limit: number }): Promise<Page<PdActivity>> {
  const body = await get(token, "/api/v2/activities", { limit: o.limit, cursor: o.cursor ?? undefined, sort_by: "id", sort_direction: "asc" });
  const items = list(body.data).flatMap((x): PdActivity[] => {
    const r = obj(x);
    const id = num(r.id);
    if (id === null) return [];
    return [{
      id,
      subject: str(r.subject),
      type: str(r.type),
      ownerId: num(r.owner_id),
      deleted: r.is_deleted === true,
      addTime: str(r.add_time),
      updateTime: str(r.update_time),
      dealId: num(r.deal_id),
      leadId: text(r.lead_id),
      personId: num(r.person_id),
      orgId: num(r.org_id),
      projectId: num(r.project_id),
      dueDate: str(r.due_date),
      dueTime: str(r.due_time),
      duration: str(r.duration),
      done: r.done === true,
      doneTime: str(r.marked_as_done_time),
      note: str(r.note),
    }];
  });
  return { items, next: body.additional_data?.next_cursor ?? null };
}

export async function listActivityTypes(token: string): Promise<PdActivityType[]> {
  return list((await get(token, "/v1/activityTypes")).data).flatMap((x) => {
    const r = obj(x);
    const key = str(r.key_string);
    return key === "" ? [] : [{ key, name: str(r.name) || key }];
  });
}

export async function listNotes(token: string, o: { start: number; limit: number }): Promise<V1Page<PdNote>> {
  const body = await get(token, "/v1/notes", { start: o.start, limit: o.limit, sort: "id ASC" });
  const data = list(body.data);
  const items = data.flatMap((x): PdNote[] => {
    const r = obj(x);
    const id = num(r.id);
    if (id === null) return [];
    return [{
      id,
      active: r.active_flag !== false,
      addTime: str(r.add_time),
      content: str(r.content),
      dealId: num(r.deal_id),
      personId: num(r.person_id),
      orgId: num(r.org_id),
      leadId: text(r.lead_id),
      userId: num(r.user_id),
    }];
  });
  return { items, next: nextStart(body.additional_data, o.start, data.length) };
}

export async function listFiles(token: string, o: { start: number; limit: number }): Promise<V1Page<PdFile>> {
  const body = await get(token, "/v1/files", { start: o.start, limit: o.limit, sort: "id ASC" });
  const data = list(body.data);
  const items = data.flatMap((x): PdFile[] => {
    const r = obj(x);
    const id = num(r.id);
    if (id === null) return [];
    return [{
      id,
      active: r.active_flag !== false,
      addTime: str(r.add_time),
      name: str(r.name) || str(r.file_name),
      size: num(r.file_size),
      userId: num(r.user_id),
      dealId: num(r.deal_id),
      personId: num(r.person_id),
      orgId: num(r.org_id),
      leadId: text(r.lead_id),
      mailMessageId: text(r.mail_message_id),
      remoteLocation: str(r.remote_location),
    }];
  });
  return { items, next: nextStart(body.additional_data, o.start, data.length) };
}

export const DOWNLOAD_TIMEOUT_MS = 20_000;

// Reads a body, stopping as soon as more than `max` bytes came: null then (nothing more is read).
async function readCapped(res: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(size));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// A file's contents: the bytes, "gone" (404 / 410) or "too_large" (more than maxBytes). A 3xx is followed once, to an
// http(s) address, with no x-api-token header. 401 / 403 / 429 from Pipedrive as for any call.
export async function downloadFile(token: string, id: number, maxBytes: number): Promise<{ bytes: Uint8Array<ArrayBuffer> } | "gone" | "too_large"> {
  const { f, url } = target(`/v1/files/${id}/download`, {});
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await f(url.toString(), { method: "GET", headers: { "x-api-token": token }, signal: abort.signal, cache: "no-store", redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        const next = location ? new URL(location, url) : null;
        if (!next || (next.protocol !== "https:" && next.protocol !== "http:")) throw new PipedriveUnreachable();
        // Never the token: the file host is not Pipedrive's API.
        res = await f(next.toString(), { method: "GET", headers: {}, signal: abort.signal, cache: "no-store", redirect: "manual" });
        if (res.status === 404 || res.status === 410) return "gone";
        if (res.status !== 200) throw new PipedriveUnreachable();
      }
    } catch (e) {
      if (isNetworkError(e)) throw new PipedriveUnreachable();
      throw e;
    }
    if (res.status === 401 || res.status === 403) throw new PipedriveRefused();
    if (res.status === 429) throw new PipedriveSlowDown(retrySeconds(res.headers));
    if (res.status === 404 || res.status === 410) return "gone";
    if (res.status !== 200) throw new PipedriveUnreachable();
    try {
      const bytes = await readCapped(res, maxBytes);
      return bytes === null ? "too_large" : { bytes };
    } catch (e) {
      if (isNetworkError(e)) throw new PipedriveUnreachable();
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
}
