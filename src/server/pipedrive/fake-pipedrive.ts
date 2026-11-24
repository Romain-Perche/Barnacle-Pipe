// A fake Pipedrive in process (SF-117 contracts/pipedrive-api.md § The fake, research.md §2): the six calls the import
// makes (v1 /users/me and /users; v2 /personFields, /organizationFields, /organizations, /persons) with Pipedrive's
// shapes, per company and token. It pages by cursor (base64 of the last id, ids ascending, `limit` ≤ 500 else 400),
// filters by `ids`, answers 401 to an unknown or refused token, and can be told to answer 429 with Retry-After every
// n calls, to fail the next call, or to refuse `include_fields=marketing_status` (no marketing app).
// Used by the app only when fakes are allowed and PIPEDRIVE_URL is empty; tests wrap it (tests/fakes/pipedrive.ts).
// Every name is clearly fake. `requests` records method, path and query, never the token.
// SF-122 (specs/sf-122-…/contracts/pipedrive-api.md § The fake): also deal fields, pipelines, stages, deals (open and
// archived, with followers and participants), activities, activity types, notes and files with their bytes. v2 lists
// page by cursor as above; v1 lists (/notes, /files, participants) by start / limit with `additional_data`.
// /v1/files/{id}/download answers the bytes, or with redirectDownloads(true) a 302 to FILE_HOST, which serves them only
// to a request WITHOUT x-api-token (400 otherwise, so a leaked token fails the test).

export type FakeUser = { id: number; name: string; email: string };
export type FakeField = {
  field_code: string;
  field_name: string;
  field_type: string;
  is_custom_field: boolean;
  options?: { id: number; label: string }[] | null;
};
export type FakeContact = { value: string; primary: boolean; label: string };
export type FakeOrganization = {
  id: number;
  name: string;
  owner_id: number;
  add_time: string;
  update_time: string | null;
  is_deleted: boolean;
  visible_to: number;
  address: { value: string } | null;
  label_ids: number[];
  website: string | null;
  industry: number | null;
  employee_count: number | null;
  custom_fields: Record<string, unknown>;
};
export type FakePerson = {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  owner_id: number;
  org_id: number | null;
  add_time: string;
  update_time: string | null;
  emails: FakeContact[];
  phones: FakeContact[];
  is_deleted: boolean;
  visible_to: number;
  label_ids: number[];
  job_title: string;
  custom_fields: Record<string, unknown>;
  // Served only with include_fields=marketing_status.
  marketing_status?: string | null;
};
export type FakePipeline = { id: number; name: string; order_nr: number; is_deleted: boolean; add_time: string; update_time: string | null };
export type FakeStage = { id: number; pipeline_id: number; name: string; order_nr: number; is_deleted: boolean; add_time: string; update_time: string | null };
export type FakeDeal = {
  id: number;
  title: string;
  owner_id: number;
  person_id: number | null;
  org_id: number | null;
  pipeline_id: number | null;
  stage_id: number | null;
  value: number | null;
  currency: string;
  add_time: string;
  update_time: string | null;
  stage_change_time: string | null;
  is_deleted: boolean;
  is_archived: boolean;
  status: string;
  lost_reason: string | null;
  visible_to: number;
  close_time: string | null;
  won_time: string | null;
  lost_time: string | null;
  expected_close_date: string | null;
  label_ids: number[];
  custom_fields: Record<string, unknown>;
};
export type FakeActivity = {
  id: number;
  subject: string;
  type: string;
  owner_id: number;
  is_deleted: boolean;
  add_time: string;
  update_time: string | null;
  deal_id: number | null;
  lead_id: string | null;
  person_id: number | null;
  org_id: number | null;
  project_id: number | null;
  due_date: string | null;
  due_time: string | null;
  duration: string | null;
  busy: boolean;
  done: boolean;
  marked_as_done_time: string | null;
  note: string | null;
};
export type FakeActivityType = { id: number; name: string; key_string: string; icon_key: string; color: string | null; order_nr: number; active_flag: boolean; is_custom_flag: boolean; add_time: string; update_time: string | null };
export type FakeNote = {
  id: number;
  active_flag: boolean;
  add_time: string;
  update_time: string | null;
  content: string;
  deal_id: number | null;
  person_id: number | null;
  org_id: number | null;
  lead_id: string | null;
  user_id: number;
};
export type FakeFile = {
  id: number;
  user_id: number;
  deal_id: number | null;
  person_id: number | null;
  org_id: number | null;
  lead_id: string | null;
  add_time: string;
  update_time: string | null;
  name: string;
  file_name: string;
  file_size: number;
  active_flag: boolean;
  remote_location: string | null;
  mail_message_id: string | null;
};
type Company = {
  id: number;
  name: string;
  users: Map<number, FakeUser>;
  personFields: FakeField[];
  organizationFields: FakeField[];
  dealFields: FakeField[];
  organizations: Map<number, FakeOrganization>;
  persons: Map<number, FakePerson>;
  pipelines: Map<number, FakePipeline>;
  stages: Map<number, FakeStage>;
  deals: Map<number, FakeDeal>;
  followers: Map<number, number[]>;
  participants: Map<number, number[]>;
  activities: Map<number, FakeActivity>;
  activityTypes: FakeActivityType[];
  notes: Map<number, FakeNote>;
  files: Map<number, FakeFile>;
  bytes: Map<number, Uint8Array>;
  nextId: number;
};
// Where redirected downloads go (never Pipedrive's API host).
export const FILE_HOST = "files.fake-pipedrive.invalid";
const DEFAULT_TYPES = [["call", "Call"], ["meeting", "Meeting"], ["task", "Task"], ["deadline", "Deadline"], ["email", "Email"], ["lunch", "Lunch"]] as const;
export type FakeRequest = { method: string; path: string; query: Record<string, string> };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const NOW = "2026-11-01 09:00:00";
export const encodeCursor = (id: number) => Buffer.from(String(id)).toString("base64url");
const decodeCursor = (c: string): number | null => {
  const n = Number(Buffer.from(c, "base64url").toString("utf8"));
  return Number.isSafeInteger(n) ? n : null;
};

export class FakePipedrive {
  private companies = new Map<number, Company>();
  private tokens = new Map<string, { companyId: number; userId: number }>();
  private refused = new Set<string>();
  private slow: { every: number; seconds: number } | null = null;
  private calls = 0;
  private failure: "network" | 500 | null = null;
  private hanging = false;
  private marketingApp = true;
  private redirecting = false;
  // Test hook: changes the next answer's JSON body before it is sent.
  private tamperNext: ((body: Record<string, unknown>) => void) | null = null;
  readonly requests: FakeRequest[] = [];

  constructor() {
    this.fetch = this.fetch.bind(this);
  }

  addCompany(o: { token: string; user: FakeUser; companyId: number; companyName: string }): void {
    let c = this.companies.get(o.companyId);
    if (!c) {
      c = {
        id: o.companyId, name: o.companyName, users: new Map(), personFields: [], organizationFields: [], dealFields: [], organizations: new Map(),
        persons: new Map(), pipelines: new Map(), stages: new Map(), deals: new Map(), followers: new Map(), participants: new Map(),
        activities: new Map(), notes: new Map(), files: new Map(), bytes: new Map(), nextId: 1,
        activityTypes: DEFAULT_TYPES.map(([key, name], i) => ({
          id: i + 1, name, key_string: key, icon_key: key, color: null, order_nr: i + 1, active_flag: true, is_custom_flag: false, add_time: NOW, update_time: null,
        })),
      };
      this.companies.set(o.companyId, c);
    }
    c.users.set(o.user.id, o.user);
    this.tokens.set(o.token, { companyId: o.companyId, userId: o.user.id });
    this.refused.delete(o.token);
  }

  private company(id: number): Company {
    const c = this.companies.get(id);
    if (!c) throw new Error(`no fake Pipedrive company ${id}`);
    return c;
  }

  addUser(companyId: number, user: FakeUser): void {
    this.company(companyId).users.set(user.id, user);
  }

  addField(companyId: number, kind: "person" | "organization" | "deal", field: FakeField): void {
    const c = this.company(companyId);
    (kind === "person" ? c.personFields : kind === "deal" ? c.dealFields : c.organizationFields).push({ options: null, ...field });
  }

  private newId(c: Company, id?: number): number {
    const n = id ?? c.nextId++;
    c.nextId = Math.max(c.nextId, n + 1);
    return n;
  }

  addPipeline(companyId: number, p: Partial<FakePipeline> & { name: string }): number {
    const c = this.company(companyId);
    const id = this.newId(c, p.id);
    c.pipelines.set(id, { order_nr: c.pipelines.size + 1, is_deleted: false, add_time: NOW, update_time: null, ...p, id });
    return id;
  }

  addStage(companyId: number, s: Partial<FakeStage> & { pipeline_id: number; name: string }): number {
    const c = this.company(companyId);
    const id = this.newId(c, s.id);
    const order = [...c.stages.values()].filter((x) => x.pipeline_id === s.pipeline_id).length + 1;
    c.stages.set(id, { order_nr: order, is_deleted: false, add_time: NOW, update_time: null, ...s, id });
    return id;
  }

  addDeal(companyId: number, d: Partial<FakeDeal> & { title: string; owner_id: number; stage_id: number }, extra: { followers?: number[]; participants?: number[] } = {}): number {
    const c = this.company(companyId);
    const id = this.newId(c, d.id);
    c.deals.set(id, {
      person_id: null, org_id: null, pipeline_id: c.stages.get(d.stage_id)?.pipeline_id ?? null, value: null, currency: "GBP", add_time: NOW,
      update_time: null, stage_change_time: null, is_deleted: false, is_archived: false, status: "open", lost_reason: null, visible_to: 3,
      close_time: null, won_time: null, lost_time: null, expected_close_date: null, label_ids: [], custom_fields: {}, ...d, id,
    });
    if (extra.followers) c.followers.set(id, extra.followers);
    if (extra.participants) c.participants.set(id, extra.participants);
    return id;
  }

  deleteDeal(companyId: number, id: number): void {
    this.company(companyId).deals.delete(id);
  }

  addActivity(companyId: number, a: Partial<FakeActivity> & { subject: string; owner_id: number }): number {
    const c = this.company(companyId);
    const id = this.newId(c, a.id);
    c.activities.set(id, {
      type: "task", is_deleted: false, add_time: NOW, update_time: null, deal_id: null, lead_id: null, person_id: null, org_id: null,
      project_id: null, due_date: "2026-11-30", due_time: null, duration: null, busy: false, done: false, marked_as_done_time: null, note: null, ...a, id,
    });
    return id;
  }

  deleteActivity(companyId: number, id: number): void {
    this.company(companyId).activities.delete(id);
  }

  addActivityType(companyId: number, key: string, name: string): void {
    const c = this.company(companyId);
    c.activityTypes.push({ id: c.activityTypes.length + 1, name, key_string: key, icon_key: "task", color: null, order_nr: c.activityTypes.length + 1, active_flag: true, is_custom_flag: true, add_time: NOW, update_time: null });
  }

  addNote(companyId: number, n: Partial<FakeNote> & { content: string; user_id: number }): number {
    const c = this.company(companyId);
    const id = this.newId(c, n.id);
    c.notes.set(id, { active_flag: true, add_time: NOW, update_time: null, deal_id: null, person_id: null, org_id: null, lead_id: null, ...n, id });
    return id;
  }

  // A note deleted in Pipedrive: no longer listed.
  deleteNote(companyId: number, id: number): void {
    this.company(companyId).notes.delete(id);
  }

  addFile(companyId: number, f: Partial<FakeFile> & { name: string; user_id: number }, bytes: Uint8Array = new Uint8Array(0)): number {
    const c = this.company(companyId);
    const id = this.newId(c, f.id);
    c.files.set(id, {
      deal_id: null, person_id: null, org_id: null, lead_id: null, add_time: NOW, update_time: null, file_name: f.name, file_size: bytes.length,
      active_flag: true, remote_location: null, mail_message_id: null, ...f, id,
    });
    c.bytes.set(id, bytes);
    return id;
  }

  // A file removed in Pipedrive: still listed by an earlier page, but its download answers 404.
  deleteFile(companyId: number, id: number): void {
    const c = this.company(companyId);
    c.files.delete(id);
    c.bytes.delete(id);
  }

  // The file's bytes gone while its metadata stays (a download then answers 404).
  loseFileBytes(companyId: number, id: number): void {
    this.company(companyId).bytes.delete(id);
  }

  // On: a download answers 302 to FILE_HOST instead of the bytes.
  redirectDownloads(on: boolean): void {
    this.redirecting = on;
  }

  // Changes a person in the fake (e.g. a name given after a first import).
  updatePerson(companyId: number, id: number, change: Partial<FakePerson>): void {
    const c = this.company(companyId);
    const p = c.persons.get(id);
    if (p) c.persons.set(id, { ...p, ...change, id });
  }

  addOrganization(companyId: number, o: Partial<FakeOrganization> & { name: string; owner_id: number }): number {
    const c = this.company(companyId);
    const id = o.id ?? c.nextId++;
    c.nextId = Math.max(c.nextId, id + 1);
    c.organizations.set(id, {
      add_time: NOW, update_time: null, is_deleted: false, visible_to: 3, address: null, label_ids: [], website: null, industry: null,
      employee_count: null, custom_fields: {}, ...o, id,
    });
    return id;
  }

  addPerson(companyId: number, p: Partial<FakePerson> & { owner_id: number }): number {
    const c = this.company(companyId);
    const id = p.id ?? c.nextId++;
    c.nextId = Math.max(c.nextId, id + 1);
    const first = p.first_name ?? "";
    const last = p.last_name ?? "";
    c.persons.set(id, {
      name: p.name ?? `${first} ${last}`.trim(), first_name: first, last_name: last, org_id: null, add_time: NOW, update_time: null,
      emails: [], phones: [], is_deleted: false, visible_to: 3, label_ids: [], job_title: "", custom_fields: {}, ...p, id,
    });
    return id;
  }

  deletePerson(companyId: number, id: number): void {
    this.company(companyId).persons.delete(id);
  }

  deleteOrganization(companyId: number, id: number): void {
    this.company(companyId).organizations.delete(id);
  }

  dealCount(companyId: number): number {
    return this.company(companyId).deals.size;
  }

  personCount(companyId: number): number {
    return this.company(companyId).persons.size;
  }

  organizationCount(companyId: number): number {
    return this.company(companyId).organizations.size;
  }

  refuseToken(token: string): void {
    this.refused.add(token);
  }

  // Every nth call (counted from now) answers 429 with `Retry-After: seconds`; null turns it off.
  slowDownEvery(n: number | null, seconds = 10): void {
    this.slow = n === null ? null : { every: n, seconds };
    this.calls = 0;
  }

  failNext(kind: "network" | 500): void {
    this.failure = kind;
  }

  // The next call never answers (until its signal aborts it).
  hangNext(): void {
    this.hanging = true;
  }

  noMarketingApp(): void {
    this.marketingApp = false;
  }

  tamper(fn: (body: Record<string, unknown>) => void): void {
    this.tamperNext = fn;
  }

  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams);
    this.requests.push({ method: req.method, path: url.pathname, query });
    if (url.hostname === FILE_HOST) return this.fileHost(req, url);
    if (this.hanging) {
      this.hanging = false;
      return new Promise<Response>((_, reject) => {
        const signal = req.signal;
        signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }
    if (this.failure) {
      const f = this.failure;
      this.failure = null;
      if (f === "network") throw new TypeError("fetch failed");
      return json(500, { success: false, error: "Internal error" });
    }
    if (this.slow) {
      this.calls += 1;
      if (this.calls % this.slow.every === 0) return json(429, { success: false, error: "Too many requests" }, { "retry-after": String(this.slow.seconds) });
    }
    const token = req.headers.get("x-api-token") ?? "";
    const who = this.tokens.get(token);
    if (!who || this.refused.has(token)) return json(401, { success: false, error: "unauthorized access", errorCode: 401 });
    const c = this.company(who.companyId);
    const res = this.route(req.method, url, c, who.userId);
    if (this.tamperNext && res.status === 200) {
      const fn = this.tamperNext;
      this.tamperNext = null;
      const body = await res.json();
      fn(body);
      return json(200, body);
    }
    return res;
  }

  private fileHost(req: Request, url: URL): Response {
    if (req.headers.get("x-api-token")) return new Response("A token was sent to the file host.", { status: 400 });
    const [companyId, id] = url.pathname.split("/").filter(Boolean).map(Number);
    const bytes = this.companies.get(companyId)?.bytes.get(id);
    if (!bytes) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/octet-stream" } });
  }

  private route(method: string, url: URL, c: Company, userId: number): Response {
    if (method !== "GET") return json(404, { success: false, error: "Not found" });
    const q = url.searchParams;
    const user = (u: FakeUser) => ({
      id: u.id, name: u.name, email: u.email, default_currency: "GBP", locale: "en_GB", lang: 1, phone: null, activated: true,
      last_login: NOW, created: NOW, modified: NOW, has_created_company: false, access: [], active_flag: true,
      timezone_name: "Europe/London", timezone_offset: "+00:00", role_id: 1, icon_url: null, is_you: u.id === userId,
    });
    switch (url.pathname) {
      case "/v1/users/me": {
        const me = c.users.get(userId)!;
        return json(200, { success: true, data: { ...user(me), company_id: c.id, company_name: c.name, company_domain: "fake", company_country: "GB" } });
      }
      case "/v1/users":
        return json(200, { success: true, data: [...c.users.values()].map(user) });
      case "/api/v2/personFields":
      case "/api/v2/organizationFields": {
        const all = url.pathname === "/api/v2/personFields" ? c.personFields : c.organizationFields;
        const fields = all.map((f, i) => ({ ...f, _i: i + 1 }));
        return this.page(q, fields.map((f) => ({ id: f._i, item: { field_code: f.field_code, field_name: f.field_name, field_type: f.field_type, is_custom_field: f.is_custom_field, options: f.options ?? null } })));
      }
      case "/api/v2/organizations": {
        const orgs = [...c.organizations.values()].sort((a, b) => a.id - b.id);
        const ids = (q.get("ids") ?? "").split(",").filter(Boolean).map(Number);
        const chosen = ids.length > 0 ? orgs.filter((o) => ids.includes(o.id)) : orgs;
        return this.page(q, chosen.map((o) => ({ id: o.id, item: o })), ids.length > 0);
      }
      case "/api/v2/persons": {
        const include = (q.get("include_fields") ?? "").split(",").filter(Boolean);
        const marketing = include.includes("marketing_status");
        if (marketing && !this.marketingApp) return json(400, { success: false, error: "Marketing status is not available" });
        const persons = [...c.persons.values()].sort((a, b) => a.id - b.id).map((p) => {
          const { marketing_status, ...rest } = p;
          return { id: p.id, item: marketing ? { ...rest, marketing_status: marketing_status ?? null } : rest };
        });
        return this.page(q, persons);
      }
      case "/api/v2/dealFields": {
        const fields = c.dealFields.map((f, i) => ({ id: i + 1, item: { field_code: f.field_code, field_name: f.field_name, field_type: f.field_type, is_custom_field: f.is_custom_field, options: f.options ?? null } }));
        return this.page(q, fields);
      }
      case "/api/v2/pipelines":
        return this.page(q, [...c.pipelines.values()].sort((a, b) => a.id - b.id).map((p) => ({ id: p.id, item: p })));
      case "/api/v2/stages":
        return this.page(q, [...c.stages.values()].sort((a, b) => a.id - b.id).map((s) => ({ id: s.id, item: s })));
      case "/api/v2/deals":
      case "/api/v2/deals/archived": {
        const archived = url.pathname.endsWith("/archived");
        const include = (q.get("include_fields") ?? "").split(",").filter(Boolean);
        const deals = [...c.deals.values()].filter((d) => d.is_archived === archived && !d.is_deleted).sort((a, b) => a.id - b.id).map((d) => {
          const item: Record<string, unknown> = { ...d };
          if (include.includes("followers_count")) item.followers_count = (c.followers.get(d.id) ?? []).length;
          if (include.includes("participants_count")) item.participants_count = (c.participants.get(d.id) ?? []).length;
          return { id: d.id, item };
        });
        return this.page(q, deals);
      }
      case "/api/v2/activities":
        return this.page(q, [...c.activities.values()].filter((a) => !a.is_deleted).sort((a, b) => a.id - b.id).map((a) => ({ id: a.id, item: a })));
      case "/v1/activityTypes":
        return json(200, { success: true, data: c.activityTypes });
      case "/v1/notes":
        return this.v1Page(q, [...c.notes.values()].sort((a, b) => a.id - b.id));
      case "/v1/files":
        return this.v1Page(q, [...c.files.values()].sort((a, b) => a.id - b.id));
      default: {
        const followers = /^\/api\/v2\/deals\/(\d+)\/followers$/.exec(url.pathname);
        if (followers) {
          const deal = c.deals.get(Number(followers[1]));
          if (!deal) return json(404, { success: false, error: "Deal not found" });
          return this.page(q, (c.followers.get(deal.id) ?? []).map((userId) => ({ id: userId, item: { user_id: userId, add_time: NOW } })));
        }
        const participants = /^\/v1\/deals\/(\d+)\/participants$/.exec(url.pathname);
        if (participants) {
          const deal = c.deals.get(Number(participants[1]));
          if (!deal) return json(404, { success: false, error: "Deal not found" });
          const people = (c.participants.get(deal.id) ?? []).flatMap((id) => {
            const p = c.persons.get(id);
            return p ? [{ id: p.id, name: p.name, first_name: p.first_name, last_name: p.last_name, active_flag: true, add_time: p.add_time }] : [];
          });
          return this.v1Page(q, people, true);
        }
        const download = /^\/v1\/files\/(\d+)\/download$/.exec(url.pathname);
        if (download) {
          const id = Number(download[1]);
          const file = c.files.get(id);
          const bytes = c.bytes.get(id);
          if (!file || !file.active_flag || !bytes) return json(404, { success: false, error: "File not found" });
          if (this.redirecting) return new Response(null, { status: 302, headers: { location: `https://${FILE_HOST}/${c.id}/${id}` } });
          return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/octet-stream" } });
        }
        return json(404, { success: false, error: "Not found" });
      }
    }
  }

  // v1 paging: start / limit (≤ 500), ids ascending. `flat`: the participants shape (start, limit and
  // more_items_in_collection directly in additional_data) instead of additional_data.pagination.
  private v1Page(q: URLSearchParams, rows: unknown[], flat = false): Response {
    const limit = q.has("limit") ? Number(q.get("limit")) : 100;
    const start = q.has("start") ? Number(q.get("start")) : 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(start) || start < 0) return json(400, { success: false, error: "bad start or limit" });
    const sort = q.get("sort");
    if (sort !== null && sort !== "id ASC") return json(400, { success: false, error: "unsupported sort" });
    const taken = rows.slice(start, start + limit);
    const more = rows.length > start + limit;
    const additional = flat
      ? { start, limit, more_items_in_collection: more }
      : { pagination: { start, limit, more_items_in_collection: more, ...(more ? { next_start: start + limit } : {}) } };
    return json(200, { success: true, data: taken, additional_data: additional });
  }

  private page(q: URLSearchParams, rows: { id: number; item: unknown }[], noCursor = false): Response {
    const limit = q.has("limit") ? Number(q.get("limit")) : 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) return json(400, { success: false, error: "limit must be 1–500" });
    const cursor = q.get("cursor");
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && after === null) return json(400, { success: false, error: "bad cursor" });
    const rest = after === null ? rows : rows.filter((r) => r.id > after);
    const taken = rest.slice(0, limit);
    const more = !noCursor && rest.length > limit;
    return json(200, { success: true, data: taken.map((r) => r.item), additional_data: { next_cursor: more ? encodeCursor(taken[taken.length - 1].id) : null } });
  }
}

// ---------------------------------------------------------------- the development instance

let dev: FakePipedrive | null = null;

// The fake the running app uses (APP_ENV development/test, PIPEDRIVE_URL empty): built on first use, always the same.
export function fakePipedrive(): FakePipedrive {
  if (!dev) dev = buildDevFake();
  return dev;
}

export const DEV_TOKEN = "fake-pipedrive-token";
export const DEV_OTHER_TOKEN = "fake-pipedrive-other";

// Deterministic data covering every case of the spec: 60 organisations, 300 people (contracts § The fake).
// Owners: Fake Person (ada@barnacle.ai, the seeded admin), Margaret Pipedrive Fake (margaret@barnacle.ai) and
// Jane Fake (jane@fake.example: no CRM user).
export function buildDevFake(): FakePipedrive {
  const f = new FakePipedrive();
  const CO = 1001;
  f.addCompany({ token: DEV_TOKEN, user: { id: 1, name: "Fake Person", email: "ada@barnacle.ai" }, companyId: CO, companyName: "Fakeco Pipedrive" });
  f.addUser(CO, { id: 2, name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" });
  f.addUser(CO, { id: 3, name: "Jane Fake", email: "jane@fake.example" });
  f.addCompany({ token: DEV_OTHER_TOKEN, user: { id: 50, name: "Other Person Fake", email: "other@fake.example" }, companyId: 1002, companyName: "Otherco Pipedrive" });
  f.addOrganization(1002, { name: "Otherco Client Fake", owner_id: 50 });

  const budget = "fake_custom_field_01";
  const colour = "fake_custom_field_02";
  const jobKey = "fake_custom_field_03";
  const source = "fake_custom_field_04";
  const linkedin = "fake_custom_field_05";
  const region = "fake_custom_field_06";
  f.addField(CO, "person", { field_code: "name", field_name: "Name", field_type: "varchar", is_custom_field: false });
  f.addField(CO, "person", { field_code: "label_ids", field_name: "Labels", field_type: "set", is_custom_field: false, options: [{ id: 1, label: "Hot" }, { id: 2, label: "Cold" }, { id: 3, label: "Investor" }] });
  f.addField(CO, "person", { field_code: budget, field_name: "Budget", field_type: "double", is_custom_field: true });
  f.addField(CO, "person", { field_code: colour, field_name: "Favourite colour", field_type: "varchar", is_custom_field: true });
  f.addField(CO, "person", { field_code: jobKey, field_name: "Job title", field_type: "varchar", is_custom_field: true });
  f.addField(CO, "person", { field_code: source, field_name: "Lead source", field_type: "enum", is_custom_field: true, options: [{ id: 11, label: "Referral" }, { id: 12, label: "Webinar" }, { id: 13, label: "Event" }] });
  f.addField(CO, "person", { field_code: linkedin, field_name: "LinkedIn", field_type: "varchar", is_custom_field: true });
  f.addField(CO, "organization", { field_code: "industry", field_name: "Industry", field_type: "enum", is_custom_field: false, options: [{ id: 21, label: "Software" }, { id: 22, label: "Retail" }, { id: 23, label: "Leisure" }] });
  f.addField(CO, "organization", { field_code: region, field_name: "Region", field_type: "address", is_custom_field: true });

  const orgIds: number[] = [];
  for (let i = 1; i <= 60; i++) {
    const name =
      i === 1 ? "Fakeco Ltd" : i === 60 ? `Sample Studios Fake ${"Long".repeat(60)}` : `Pipedrive Org ${String(i).padStart(2, "0")} Fake`;
    orgIds.push(
      f.addOrganization(CO, {
        name,
        owner_id: i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1,
        visible_to: i % 10 === 0 ? 1 : 3,
        address: i % 2 === 0 ? { value: `${i} Fake Street, London` } : null,
        website: i % 4 === 0 ? `fakeorg${i}.example` : null,
        industry: [21, 22, 23][i % 3],
        employee_count: i % 5 === 0 ? 0 : i * 7,
        custom_fields: { [region]: i % 2 === 0 ? { value: "London" } : null },
      }),
    );
  }
  const statuses = ["subscribed", "unsubscribed", "no_consent", "archived", null];
  for (let i = 1; i <= 300; i++) {
    const n = String(i).padStart(3, "0");
    const emails: FakeContact[] = [{ value: `person${n}@fake.example`, primary: true, label: "work" }];
    if (i % 4 === 0) emails.push({ value: `home${n}@fake.example`, primary: false, label: "home" });
    if (i === 17) emails.push({ value: "person001@fake.example", primary: false, label: "other" }); // a duplicate email
    if (i === 23) emails.push({ value: "not-an-email@", primary: false, label: "work" });
    const phones: FakeContact[] = i % 3 === 0 ? [{ value: `+44 20 7946 ${n.padStart(4, "0")}`, primary: true, label: "work" }, { value: `07700 900${n}`, primary: false, label: "mobile" }] : [];
    f.addPerson(CO, {
      first_name: i === 99 ? "" : `Person${n}`,
      last_name: i === 99 ? "" : "Fake",
      name: i === 99 ? "" : `Person${n} Fake`,
      owner_id: i % 11 === 0 ? 3 : i % 5 === 0 ? 2 : 1,
      org_id: i % 6 === 0 ? null : orgIds[(i - 1) % 60],
      visible_to: i % 13 === 0 ? 1 : 3,
      emails,
      phones,
      label_ids: i % 5 === 0 ? [1] : i % 7 === 0 ? [2] : [],
      job_title: i % 9 === 0 ? "Fake Director" : "",
      marketing_status: statuses[i % 5],
      custom_fields: {
        [budget]: i % 4 === 0 ? i * 100 : null,
        [colour]: i % 8 === 0 ? "Teal" : null,
        [source]: i % 10 === 0 ? 12 : i % 6 === 0 ? 11 : null,
        [linkedin]: i % 12 === 0 ? `https://www.linkedin.com/in/person${n}-fake` : null,
      },
    });
  }
  return f;
}
