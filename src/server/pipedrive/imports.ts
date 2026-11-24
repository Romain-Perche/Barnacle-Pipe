// The Pipedrive import engine (SF-117 research.md §5–§6, data-model.md): one row per run in pipedrive_imports, moved on
// part by part by the open import page (no cron, no background job). A part makes at most two Pipedrive calls (the
// five of `prepare`, and a deal page's follower and participant calls, excepted), always OUTSIDE any transaction, then saves the page in one sql.begin() that also moves
// the cursor: a record is saved whole or not at all, and a resumed or repeated part never saves twice (the row lock and
// the step/cursor check throw a stale page away). Each page transaction locks organisations, person_emails and
// pipedrive_links (as the CSV import does), so two imports of one company, or an import and a hand-made add, save one
// page at a time and every check sees the other's rows. pipedrive_links (company + kind + Pipedrive id) is the
// "never twice" key. Every query names its user: only the user who started an import can read or move it.
// SF-122 (specs/sf-122-…/research.md, data-model.md): after people, the steps `pipelines` (read from Pipedrive, then
// matched by name or created in one locked transaction), `deals` / `archived_deals` (20 a part, followers and participants
// read one after the other, outside the transaction), `notes` and `activities` (200 a part) and `files` (copied one at
// a time: download → path queued in file_cleanup → Storage upload → one transaction lists the file AND takes its path
// off the queue; a part stops starting copies after 15 s or 25 MB). No Pipedrive or Storage call is ever made inside
// sql.begin(). An import notifies nobody: no note_mentions, and an activity's assigned_by is its assignee.
import { sql, type Sql } from "@/server/db";
import { listFields as listCrmFields } from "@/server/custom-fields/fields";
import { ukInstant } from "@/server/activities/rules";
import { storageConfig } from "@/server/env";
import { insertFile, sweepFileCleanup } from "@/server/files/files";
import { fileKind, MAX_FILE_BYTES, uploadContentType } from "@/server/files/rules";
import { createSignedUploadUrl, newStoragePath, objectInfo, putSigned, StorageUnreachable } from "@/server/files/storage";
import { col, inChunks, insertCustomValues, newIds } from "@/server/imports/bulk";
import { templates } from "@/server/messages";
import {
  dealFollowers,
  dealParticipants,
  downloadFile,
  listActivities,
  listActivityTypes,
  listDeals,
  listFields,
  listFiles,
  listNotes,
  listOrganizations,
  listPersons,
  listPipelines,
  listStages,
  listUsers,
  PipedriveBadRequest,
  PipedriveRefused,
  PipedriveSlowDown,
  PipedriveUnreachable,
  type Page,
  type PdActivity,
  type PdActivityType,
  type PdDeal,
  type PdField,
  type PdNote,
  type PdOrganization,
  type PdPerson,
  type PdPipeline,
  type PdStage,
} from "@/server/pipedrive/api";
import { tokenFor } from "@/server/pipedrive/connection";
import { formatMb, type StageMap } from "@/server/pipedrive/deal-rules";
import { Counter, planOrganisationPage, planPersonPage, toItem, type LinkedItem, type OwnerMiss, type PdUsers, type ReportItem } from "@/server/pipedrive/page";
import {
  planActivityPage,
  planDealPage,
  planFileItem,
  planNotePage,
  planPipelines,
  type Elsewhere,
  type Links,
  type RecordLookups,
} from "@/server/pipedrive/records-page";
import { COUNT_KINDS, emptyCounts, emptyReport, mergeReport, readCounts, readReport, type Counts, type PageReport, type Report } from "@/server/pipedrive/report";
import { planFields } from "@/server/pipedrive/rules";
import { CONSENTS, isValidEmail, normaliseEmail, type Consent } from "@/server/records/rules";

export type ImportState = "running" | "waiting" | "paused" | "stopped" | "finished";
export type PauseReason = "unreachable" | "token_refused" | "other_company" | "files_unreachable";
type Step =
  | "prepare" | "count_organisations" | "count_people" | "count_deals" | "count_archived_deals" | "count_notes" | "count_activities" | "count_files"
  | "organisations" | "people" | "pipelines" | "deals" | "archived_deals" | "notes" | "activities" | "files" | "done";
export type PartResult = { next: "now" } | { next: "wait"; seconds: number } | { next: "stop" };
export type StartError = "pipedrive_tick_something" | "pipedrive_consent_required" | "pipedrive_not_connected" | "files_unreachable";
type Kind = (typeof COUNT_KINDS)[number];

// Records per saved page, and per counting page (research.md §5; SF-122 research.md §3).
export const PAGE = 100;
const COUNT_PAGE = 500;
export const DEAL_PAGE = 20;
export const NOTE_PAGE = 200;
export const ACTIVITY_PAGE = 200;
export const FILE_PAGE = 50;
// A file part starts no new copy after this long or this many bytes copied (research.md §3).
export const FILE_PART_MS = 15_000;
const FILE_PART_BYTES = MAX_FILE_BYTES;
const DOWNLOAD_UPLOAD_MS = 20_000;
// No part for this long (after any wait Pipedrive asked for): the import shows as paused (spec Clarifications).
export const ABSENT_SECONDS = 30;
const OPEN = ["running", "waiting", "paused"];

type Snapshot = {
  users: PdUsers;
  personFields: PdField[];
  organizationFields: PdField[];
  // SF-122: read in `prepare` when Deals (and Activities) are ticked; stageMap written by the `pipelines` step.
  dealFields?: PdField[];
  activityTypes?: PdActivityType[];
  stageMap?: StageMap;
};
type Wants = { want_people: boolean; want_organisations: boolean; want_deals: boolean; want_notes: boolean; want_activities: boolean; want_files: boolean };
type Row = Wants & {
  id: number;
  company_id: string;
  company_name: string;
  consent: Consent | null;
  state: ImportState;
  pause_reason: PauseReason | null;
  step: Step;
  cursor: string | null;
  organisations_total: number | null;
  people_total: number | null;
  deals_total: number | null;
  notes_total: number | null;
  activities_total: number | null;
  files_total: number | null;
  organisations_done: number;
  people_done: number;
  deals_done: number;
  notes_done: number;
  activities_done: number;
  files_done: number;
  snapshot: Snapshot | null;
  options: { noMarketingStatus?: boolean };
  counts: unknown;
  report: unknown;
  absent: boolean;
  wait_left: number;
  finished_at: Date | null;
};

async function load(db: Sql, userId: number, where: { id: number } | { latest: true }): Promise<Row | null> {
  const [row] = await db<Row[]>`
    select id::int as id, company_id::text as company_id, company_name, want_people, want_organisations, want_deals, want_notes,
           want_activities, want_files, consent, state, pause_reason, step, cursor,
           organisations_total, people_total, deals_total, notes_total, activities_total, files_total,
           organisations_done, people_done, deals_done, notes_done, activities_done, files_done,
           snapshot, options, counts, report, finished_at,
           greatest(seen_at, coalesce(wait_until, seen_at)) < now() - make_interval(secs => ${ABSENT_SECONDS}) as absent,
           coalesce(ceil(extract(epoch from (wait_until - now())))::int, 0) as wait_left
    from pipedrive_imports
    where user_id = ${userId} and ${"id" in where ? db`id = ${where.id}` : db`true`}
    order by id desc limit 1`;
  return row ?? null;
}

// ---------------------------------------------------------------- start, continue, stop

// FR-003: the file store set up and answering (a missing object is an answer).
async function storageReachable(): Promise<boolean> {
  if (storageConfig().mode === "off") return false;
  try {
    await objectInfo("files/pipedrive-import-check");
    return true;
  } catch (e) {
    if (e instanceof StorageUnreachable) return false;
    throw e;
  }
}

export async function startImport(
  userId: number,
  o: { people: boolean; organisations: boolean; deals?: boolean; notes?: boolean; activities?: boolean; files?: boolean; consent: string | null },
): Promise<{ id: number; existing: boolean } | { error: StartError }> {
  const deals = o.deals === true;
  const notes = o.notes === true;
  const activities = o.activities === true;
  const files = o.files === true;
  // FR-002: deals, notes, activities and files come with people and organisations (the server enforces it too).
  const records = deals || notes || activities || files;
  const people = o.people || records;
  const organisations = o.organisations || records;
  if (!people && !organisations) return { error: "pipedrive_tick_something" };
  const consent = (CONSENTS as readonly (string | null)[]).includes(o.consent) ? (o.consent as Consent) : null;
  if (people && consent === null) return { error: "pipedrive_consent_required" };
  const [conn] = await sql<{ company_id: string; company_name: string }[]>`
    select company_id::text as company_id, company_name from pipedrive_connections where user_id = ${userId}`;
  if (!conn) return { error: "pipedrive_not_connected" };
  if (files && !(await storageReachable())) return { error: "files_unreachable" };
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const [open] = await db<{ id: number }[]>`
        select id::int as id from pipedrive_imports where user_id = ${userId} and state in ${db(OPEN)} for update`;
      if (open) return { id: open.id, existing: true };
      // Only the latest report is kept (FR-025).
      await db`delete from pipedrive_imports where user_id = ${userId} and state in ('stopped', 'finished')`;
      const [row] = await db<{ id: number }[]>`
        insert into pipedrive_imports (user_id, company_id, company_name, want_people, want_organisations, want_deals, want_notes,
                                       want_activities, want_files, consent, counts, report)
        values (${userId}, ${conn.company_id}, ${conn.company_name}, ${people}, ${organisations}, ${deals}, ${notes}, ${activities}, ${files},
                ${people ? consent : null}, ${db.json(emptyCounts())}, ${db.json(emptyReport())})
        returning id::int as id`;
      return { id: row.id, existing: false };
    });
  } catch (e) {
    // Two starts at once: the partial unique index lets one through; the other goes to it.
    if ((e as { code?: string }).code === "23505") {
      const [open] = await sql<{ id: number }[]>`select id::int as id from pipedrive_imports where user_id = ${userId} and state in ${sql(OPEN)}`;
      if (open) return { id: open.id, existing: true };
    }
    throw e;
  }
}

// [ CONTINUE ]: the open import runs again from where it stopped.
export async function continueImport(userId: number): Promise<number | null> {
  const [row] = await sql<{ id: number }[]>`
    update pipedrive_imports set state = 'running', pause_reason = null, wait_until = null, seen_at = now()
    where user_id = ${userId} and state in ${sql(OPEN)} returning id::int as id`;
  return row?.id ?? null;
}

// [ STOP IMPORT ]: no more records; those imported stay; the report shows what was done.
export async function stopImport(userId: number): Promise<number | null> {
  const [row] = await sql<{ id: number }[]>`
    update pipedrive_imports set state = 'stopped', stop_reason = 'by_user', pause_reason = null, wait_until = null, finished_at = now()
    where user_id = ${userId} and state in ${sql(OPEN)} returning id::int as id`;
  return row?.id ?? null;
}

async function pause(userId: number, id: number, reason: PauseReason) {
  await sql`
    update pipedrive_imports set state = 'paused', pause_reason = ${reason}, wait_until = null, seen_at = now()
    where id = ${id} and user_id = ${userId} and state in ('running', 'waiting')`;
}

// ---------------------------------------------------------------- one part

const ORDER: Step[] = [
  "prepare", "count_organisations", "count_people", "count_deals", "count_archived_deals", "count_notes", "count_activities", "count_files",
  "organisations", "people", "pipelines", "deals", "archived_deals", "notes", "activities", "files", "done",
];
// The flag a step needs (a step whose kind is not ticked is skipped).
const STEP_WANT: Partial<Record<Step, keyof Wants>> = {
  count_organisations: "want_organisations", organisations: "want_organisations",
  count_people: "want_people", people: "want_people",
  count_deals: "want_deals", count_archived_deals: "want_deals", pipelines: "want_deals", deals: "want_deals", archived_deals: "want_deals",
  count_notes: "want_notes", notes: "want_notes",
  count_activities: "want_activities", activities: "want_activities",
  count_files: "want_files", files: "want_files",
};
// The kind whose total a counting step adds to.
const COUNT_STEP: Partial<Record<Step, Kind>> = {
  count_organisations: "organisations", count_people: "people", count_deals: "deals", count_archived_deals: "deals",
  count_notes: "notes", count_activities: "activities", count_files: "files",
};

function nextStep(step: Step, r: Wants): Step {
  for (const s of ORDER.slice(ORDER.indexOf(step) + 1)) {
    const want = STEP_WANT[s];
    if (want && !r[want]) continue;
    return s;
  }
  return "done";
}

type Fetched =
  | { kind: "prepare"; snapshot: Snapshot }
  | { kind: "count"; n: number; next: string | null }
  | { kind: "organisations"; items: PdOrganization[]; next: string | null }
  | { kind: "people"; items: PdPerson[]; next: string | null; orgs: PdOrganization[]; noMarketing: boolean }
  | { kind: "pipelines"; pipelines: PdPipeline[]; stages: PdStage[] }
  | { kind: "deals"; items: PdDeal[]; next: string | null; participants: Map<number, { personId: number; name: string }[]>; followers: Map<number, number[]> }
  | { kind: "notes"; items: PdNote[]; next: string | null }
  | { kind: "activities"; items: PdActivity[]; next: string | null }
  | { kind: "done" };

// Every page of a cursor list (at most 10).
async function all<T>(read: (cursor: string | null) => Promise<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const page = await read(cursor);
    out.push(...page.items);
    cursor = page.next;
    if (!cursor) break;
  }
  return out;
}

const allFields = (token: string, kind: "person" | "organization" | "deal") => all((c) => listFields(token, kind, c));
const startOf = (cursor: string | null) => (cursor === null ? 0 : Number(cursor.split(":")[0]) || 0);
const v1Next = (next: number | null) => (next === null ? null : String(next));

// The Pipedrive calls of the row's step. Never inside a transaction.
async function fetchStep(token: string, row: Row): Promise<Fetched> {
  switch (row.step) {
    case "prepare": {
      const users = await listUsers(token);
      const personFields = row.want_people ? await allFields(token, "person") : [];
      const organizationFields = await allFields(token, "organization");
      const snapshot: Snapshot = { users: Object.fromEntries(users.map((u) => [String(u.id), { name: u.name, email: u.email }])), personFields, organizationFields };
      if (row.want_deals) snapshot.dealFields = await allFields(token, "deal");
      if (row.want_activities) snapshot.activityTypes = await listActivityTypes(token);
      return { kind: "prepare", snapshot };
    }
    case "count_organisations": {
      const page = await listOrganizations(token, { cursor: row.cursor, limit: COUNT_PAGE });
      return { kind: "count", n: page.items.filter((o) => !o.deleted).length, next: page.next };
    }
    case "count_people": {
      const page = await listPersons(token, { cursor: row.cursor, limit: COUNT_PAGE, marketing: false });
      return { kind: "count", n: page.items.filter((p) => !p.deleted).length, next: page.next };
    }
    case "count_deals":
    case "count_archived_deals": {
      const page = await listDeals(token, { archived: row.step === "count_archived_deals", cursor: row.cursor, limit: COUNT_PAGE });
      return { kind: "count", n: page.items.filter((d) => !d.deleted).length, next: page.next };
    }
    case "count_notes": {
      const page = await listNotes(token, { start: startOf(row.cursor), limit: COUNT_PAGE });
      return { kind: "count", n: page.items.filter((n) => n.active).length, next: v1Next(page.next) };
    }
    case "count_activities": {
      const page = await listActivities(token, { cursor: row.cursor, limit: COUNT_PAGE });
      return { kind: "count", n: page.items.filter((a) => !a.deleted).length, next: page.next };
    }
    case "count_files": {
      const page = await listFiles(token, { start: startOf(row.cursor), limit: COUNT_PAGE });
      return { kind: "count", n: page.items.filter((f) => f.active).length, next: v1Next(page.next) };
    }
    case "pipelines":
      // Read here rather than in `prepare`, so that no part needs more than five calls (a part is repeated whole after
      // a slow-down).
      return { kind: "pipelines", pipelines: await all((c) => listPipelines(token, c)), stages: await all((c) => listStages(token, c)) };
    case "deals":
    case "archived_deals": {
      const page = await listDeals(token, { archived: row.step === "archived_deals", cursor: row.cursor, limit: DEAL_PAGE });
      // Only when Pipedrive's counts say there is something to read; one call after the other (no burst).
      const followers = new Map<number, number[]>();
      const participants = new Map<number, { personId: number; name: string }[]>();
      for (const d of page.items) {
        if (d.deleted) continue;
        if ((d.followersCount ?? 0) > 0) followers.set(d.id, await dealFollowers(token, d.id));
        if ((d.participantsCount ?? 0) > (d.personId !== null ? 1 : 0)) participants.set(d.id, await dealParticipants(token, d.id));
      }
      return { kind: "deals", items: page.items, next: page.next, participants, followers };
    }
    case "notes": {
      const page = await listNotes(token, { start: startOf(row.cursor), limit: NOTE_PAGE });
      return { kind: "notes", items: page.items, next: v1Next(page.next) };
    }
    case "activities": {
      const page = await listActivities(token, { cursor: row.cursor, limit: ACTIVITY_PAGE });
      return { kind: "activities", items: page.items, next: page.next };
    }
    case "files":
      throw new Error("files are copied by runFilesPart");
    case "organisations": {
      const page = await listOrganizations(token, { cursor: row.cursor, limit: PAGE });
      return { kind: "organisations", items: page.items, next: page.next };
    }
    case "people": {
      let noMarketing = row.options.noMarketingStatus === true;
      let page;
      try {
        page = await listPersons(token, { cursor: row.cursor, limit: PAGE, marketing: !noMarketing });
      } catch (e) {
        // No marketing app: ask once without the marketing status; every person then gets the user's choice.
        if (!(e instanceof PipedriveBadRequest) || noMarketing) throw e;
        noMarketing = true;
        page = await listPersons(token, { cursor: row.cursor, limit: PAGE, marketing: false });
      }
      // FR-012: the organisations of this page that have no link yet come in the same part (the second call).
      const orgIds = [...new Set(page.items.filter((p) => !p.deleted && p.orgId !== null).map((p) => p.orgId!))];
      const linked = orgIds.length === 0 ? [] : await sql<{ id: string }[]>`
        select pipedrive_id::text as id from pipedrive_links
        where company_id = ${row.company_id} and kind = 'organisation' and pipedrive_id = any(${orgIds}::bigint[])`;
      const missing = orgIds.filter((id) => !linked.some((l) => Number(l.id) === id));
      const orgs = missing.length === 0 ? [] : (await listOrganizations(token, { cursor: null, limit: PAGE, ids: missing })).items;
      return { kind: "people", items: page.items, next: page.next, orgs, noMarketing };
    }
    case "done":
      return { kind: "done" };
  }
}

// Moves the import on by one part: `now` (call again in a second), `wait` (Pipedrive asked to slow down) or `stop`
// (paused, finished, stopped, not this user's, or the user is not active). Returns no record data and no text.
export async function runPart(userId: number, id: number): Promise<PartResult> {
  const [user] = await sql<{ status: string }[]>`select status from users where id = ${userId}`;
  if (!user || user.status !== "active") return { next: "stop" };
  const row = await load(sql, userId, { id });
  if (!row || (row.state !== "running" && row.state !== "waiting") || row.absent) return { next: "stop" };
  if (row.state === "waiting" && row.wait_left > 0) return { next: "wait", seconds: row.wait_left };
  const token = await tokenFor(userId);
  if (!token) {
    await pause(userId, id, "token_refused");
    return { next: "stop" };
  }
  if (String(token.companyId) !== row.company_id) {
    await pause(userId, id, "other_company");
    return { next: "stop" };
  }
  let fetched: Fetched;
  try {
    if (row.step === "files") return await runFilesPart(userId, row, token.token);
    fetched = await fetchStep(token.token, row);
  } catch (e) {
    if (e instanceof StorageUnreachable) {
      await pause(userId, id, "files_unreachable");
      return { next: "stop" };
    }
    if (e instanceof PipedriveSlowDown) {
      await sql`
        update pipedrive_imports set state = 'waiting', wait_until = now() + make_interval(secs => ${e.seconds}), seen_at = now()
        where id = ${id} and user_id = ${userId} and state in ('running', 'waiting')`;
      return { next: "wait", seconds: e.seconds };
    }
    if (e instanceof PipedriveRefused) {
      await pause(userId, id, "token_refused");
      return { next: "stop" };
    }
    if (e instanceof PipedriveUnreachable || e instanceof PipedriveBadRequest) {
      await pause(userId, id, "unreachable");
      return { next: "stop" };
    }
    if (row.step === "files") await pause(userId, id, "unreachable");
    throw e;
  }
  let finished: boolean;
  try {
    finished = await save(userId, row, fetched);
  } catch (e) {
    // Nothing of the page was saved (rolled back); the next [ CONTINUE ] reads it again.
    await pause(userId, id, "unreachable");
    throw e;
  }
  return finished ? { next: "stop" } : { next: "now" };
}

// ---------------------------------------------------------------- saving a page

type Ctx = { userId: number; importId: number; companyId: string; snapshot: Snapshot; consent: Consent };

async function activeUsers(db: Sql): Promise<Map<string, number>> {
  const users = await db<{ id: number; email: string }[]>`select id::int as id, email from users where status = 'active'`;
  return new Map(users.map((u) => [u.email.trim().toLowerCase(), u.id]));
}

type EventRow = { personId: number | null; organisationId: number | null; kind: "pipedrive_imported" | "person_linked" | "pipedrive_unsubscribed"; relatedPersonId: number | null };

async function insertEvents(db: Sql, actorId: number, events: EventRow[]) {
  await inChunks(events, (c) => db`
    insert into timeline_events (person_id, organisation_id, kind, actor_id, related_person_id)
    select * from unnest(${col(c, (e) => e.personId)}::bigint[], ${col(c, (e) => e.organisationId)}::bigint[], ${col(c, (e) => e.kind)}::text[],
                         ${col(c, () => actorId)}::bigint[], ${col(c, (e) => e.relatedPersonId)}::bigint[])`);
}

type LinkRow = { kind: "person" | "organisation"; pipedriveId: number; personId: number | null; organisationId: number | null; how: "imported" | "linked" };

async function insertLinks(db: Sql, ctx: Ctx, links: LinkRow[]) {
  await inChunks(links, (c) => db`
    insert into pipedrive_links (company_id, kind, pipedrive_id, person_id, organisation_id, how, import_id)
    select ${ctx.companyId}::bigint, kind, pipedrive_id, person_id, organisation_id, how, ${ctx.importId}::bigint
    from unnest(${col(c, (l) => l.kind)}::text[], ${col(c, (l) => l.pipedriveId)}::bigint[], ${col(c, (l) => l.personId)}::bigint[],
                ${col(c, (l) => l.organisationId)}::bigint[], ${col(c, (l) => l.how)}::text[])
         as t(kind, pipedrive_id, person_id, organisation_id, how)`);
}

// Saves a page of organisations (or the organisations of a people page). Returns the report part, and for each
// Pipedrive organisation the CRM organisation it now leads to, and those refused (with their Pipedrive name).
async function saveOrganisations(db: Sql, ctx: Ctx, items: PdOrganization[]) {
  const ids = items.map((o) => o.id);
  const linked = await db<{ id: string }[]>`
    select pipedrive_id::text as id from pipedrive_links where company_id = ${ctx.companyId} and kind = 'organisation' and pipedrive_id = any(${ids}::bigint[])`;
  const keys = [...new Set(items.map((o) => o.name.trim().toLowerCase()).filter((k) => k !== ""))];
  const orgs = await db<{ id: number; name: string; archived: boolean }[]>`
    select id::int as id, name, archived_at is not null as archived from organisations where lower(btrim(name)) = any(${keys}::text[])`;
  const crmFields = await listCrmFields("organisation", db, true);
  const plan = planOrganisationPage(items, {
    importerId: ctx.userId,
    linked: new Set(linked.map((l) => Number(l.id))),
    organisations: new Map(orgs.map((o) => [o.name.trim().toLowerCase(), o])),
    users: await activeUsers(db),
    pdUsers: ctx.snapshot.users,
    fields: planFields("organisation", ctx.snapshot.organizationFields, crmFields),
  });
  const newOrgIds = await newIds(db, "organisations", plan.adds.length);
  const rows = plan.adds.map((a, i) => ({ id: newOrgIds[i], ...a.fields }));
  await inChunks(rows, (c) => db`
    insert into organisations (id, name, website, sector, size, location, owner_id, created_by) overriding system value
    select id, name, website, sector, size, location, owner_id, ${ctx.userId}
    from unnest(${col(c, (o) => o.id)}::bigint[], ${col(c, (o) => o.name)}::text[], ${col(c, (o) => o.website)}::text[],
                ${col(c, (o) => o.sector)}::text[], ${col(c, (o) => o.size)}::text[], ${col(c, (o) => o.location)}::text[],
                ${col(c, (o) => o.ownerId)}::bigint[])
         as t(id, name, website, sector, size, location, owner_id)`);
  await insertCustomValues(db, "organisations", crmFields, plan.adds.map((a, i) => ({ id: newOrgIds[i], custom: a.custom })));
  const resolved = plan.links.map((l) => ({ pipedriveId: l.pipedriveId, organisationId: "id" in l.target ? l.target.id : newOrgIds[l.target.add] }));
  await insertLinks(db, ctx, [
    ...plan.adds.map((a, i) => ({ kind: "organisation" as const, pipedriveId: a.pipedriveId, personId: null, organisationId: newOrgIds[i], how: "imported" as const })),
    ...resolved.map((l) => ({ kind: "organisation" as const, pipedriveId: l.pipedriveId, personId: null, organisationId: l.organisationId, how: "linked" as const })),
  ]);
  await insertEvents(db, ctx.userId, newOrgIds.map((id) => ({ personId: null, organisationId: id, kind: "pipedrive_imported" as const, relatedPersonId: null })));
  const linkedItems: LinkedItem[] = resolved.map((l) => ({ kind: "organisation", organisationId: l.organisationId, pipedriveId: l.pipedriveId }));
  return {
    plan,
    page: {
      kind: "organisation" as const, imported: plan.adds.length, already: plan.already, notImported: plan.notImported, linked: linkedItems,
      owners: plan.owners, lists: plan.lists, fields: plan.fields, choices: plan.choices, warnings: plan.warnings, unsubscribed: [], privateOthers: 0,
      ownerOnly: plan.ownerOnly,
    },
    refused: new Map(plan.notImported.map((n) => [n.pipedriveId, items.find((o) => o.id === n.pipedriveId)?.name.trim() ?? n.label])),
  };
}

async function savePersons(db: Sql, ctx: Ctx, items: PdPerson[], orgsNotImported: Map<number, string>) {
  const pdIds = items.map((p) => p.id);
  const links = await db<{ id: string; person_id: number | null }[]>`
    select pipedrive_id::text as id, person_id::int as person_id from pipedrive_links
    where company_id = ${ctx.companyId} and kind = 'person' and pipedrive_id = any(${pdIds}::bigint[])`;
  const emails = [...new Set(items.flatMap((p) => p.emails.map((e) => normaliseEmail(e.value)).filter((e) => e !== "" && isValidEmail(e))))];
  const owned = await db<{ email: string; person_id: number }[]>`
    select email, person_id::int as person_id from person_emails where email = any(${emails}::text[])`;
  const emailMap = new Map<string, number[]>();
  for (const e of owned) emailMap.set(e.email, [...(emailMap.get(e.email) ?? []), e.person_id]);
  const matched = [...new Set(owned.map((e) => e.person_id))];
  const from = matched.length === 0 ? [] : await db<{ person_id: number; id: string }[]>`
    select person_id::int as person_id, pipedrive_id::text as id from pipedrive_links
    where company_id = ${ctx.companyId} and kind = 'person' and person_id = any(${matched}::bigint[])`;
  const known = [...new Set([...matched, ...links.flatMap((l) => (l.person_id === null ? [] : [l.person_id]))])];
  const consents = known.length === 0 ? [] : await db<{ id: number; consent: Consent }[]>`
    select id::int as id, consent from persons where id = any(${known}::bigint[])`;
  const orgIds = [...new Set(items.flatMap((p) => (p.orgId === null ? [] : [p.orgId])))];
  const orgLinks = orgIds.length === 0 ? [] : await db<{ id: string; organisation_id: number | null }[]>`
    select pipedrive_id::text as id, organisation_id::int as organisation_id from pipedrive_links
    where company_id = ${ctx.companyId} and kind = 'organisation' and pipedrive_id = any(${orgIds}::bigint[])`;
  const sources = await db<{ id: number; name: string }[]>`select id::int as id, name from lead_sources where removed_at is null`;
  const labels = await db<{ id: number; name: string }[]>`select id::int as id, name from labels where removed_at is null`;
  const crmFields = await listCrmFields("person", db, true);
  const plan = planPersonPage(items, {
    importerId: ctx.userId,
    links: new Map(links.map((l) => [Number(l.id), l.person_id])),
    emails: emailMap,
    linkedFrom: new Map(from.map((f) => [f.person_id, Number(f.id)])),
    consents: new Map(consents.map((c) => [c.id, c.consent])),
    organisations: new Map(orgLinks.map((l) => [Number(l.id), l.organisation_id])),
    orgsNotImported,
    leadSources: new Map(sources.map((s) => [s.name.trim().toLowerCase(), s.id])),
    labels: new Map(labels.map((l) => [l.name.trim().toLowerCase(), l.id])),
    users: await activeUsers(db),
    pdUsers: ctx.snapshot.users,
    fields: planFields("person", ctx.snapshot.personFields, crmFields),
    consent: ctx.consent,
  });
  const ids = await newIds(db, "persons", plan.adds.length);
  const people = plan.adds.map((a, i) => ({ ...a, id: ids[i] }));
  await inChunks(people, (c) => db`
    insert into persons (id, first_name, last_name, organisation_id, role, lead_source_id, linkedin_url, owner_id, consent, private, created_by, created_at)
    overriding system value
    select id, first_name, last_name, organisation_id, role, lead_source_id, linkedin_url, owner_id, consent, private, created_by, coalesce(created_at, now())
    from unnest(${col(c, (p) => p.id)}::bigint[], ${col(c, (p) => p.fields.firstName)}::text[], ${col(c, (p) => p.fields.lastName)}::text[],
                ${col(c, (p) => p.organisationId)}::bigint[], ${col(c, (p) => p.fields.role)}::text[], ${col(c, (p) => p.leadSourceId)}::bigint[],
                ${col(c, (p) => p.fields.linkedin)}::text[], ${col(c, (p) => p.ownerId)}::bigint[], ${col(c, (p) => p.fields.consent)}::text[],
                ${col(c, (p) => p.private)}::boolean[], ${col(c, (p) => p.createdBy)}::bigint[], ${col(c, (p) => p.createdAt)}::timestamptz[])
         as t(id, first_name, last_name, organisation_id, role, lead_source_id, linkedin_url, owner_id, consent, private, created_by, created_at)`);
  const emailRows = people.flatMap((p) => p.fields.emails.map((e, position) => ({ personId: p.id, value: e.email, kind: e.kind, position })));
  const phoneRows = people.flatMap((p) => p.fields.phones.map((e, position) => ({ personId: p.id, value: e.phone, kind: e.kind, position })));
  for (const [table, column, list] of [["person_emails", "email", emailRows], ["person_phones", "phone", phoneRows]] as const) {
    await inChunks([...list], (c) => db`
      insert into ${db(table)} (person_id, ${db(column)}, kind, position)
      select * from unnest(${col(c, (e) => e.personId)}::bigint[], ${col(c, (e) => e.value)}::text[], ${col(c, (e) => e.kind)}::text[],
                           ${col(c, (e) => e.position)}::int[])`);
  }
  const labelRows = people.flatMap((p) => p.labelIds.map((labelId) => ({ personId: p.id, labelId })));
  await inChunks(labelRows, (c) => db`
    insert into person_labels (person_id, label_id)
    select * from unnest(${col(c, (l) => l.personId)}::bigint[], ${col(c, (l) => l.labelId)}::bigint[])`);
  await insertCustomValues(db, "people", crmFields, people);
  await insertLinks(db, ctx, [
    ...people.map((p) => ({ kind: "person" as const, pipedriveId: p.pipedriveId, personId: p.id, organisationId: null, how: "imported" as const })),
    ...plan.links.map((l) => ({ kind: "person" as const, pipedriveId: l.pipedriveId, personId: l.personId, organisationId: null, how: "linked" as const })),
  ]);
  // FR-018: a Subscribed person Pipedrive says is unsubscribed becomes Unsubscribed; nothing else changes.
  const unsubscribed = plan.unsubscribe.length === 0 ? [] : await db<{ id: number }[]>`
    update persons set consent = 'unsubscribed', version = version + 1
    where id = any(${plan.unsubscribe}::bigint[]) and consent = 'subscribed' returning id::int as id`;
  await insertEvents(db, ctx.userId, [
    ...people.map((p) => ({ personId: p.id, organisationId: null, kind: "pipedrive_imported" as const, relatedPersonId: null })),
    ...people.flatMap((p) => (p.organisationId === null ? [] : [{ personId: null, organisationId: p.organisationId, kind: "person_linked" as const, relatedPersonId: p.id }])),
    ...unsubscribed.map((u) => ({ personId: u.id, organisationId: null, kind: "pipedrive_unsubscribed" as const, relatedPersonId: null })),
  ]);
  return {
    plan,
    page: {
      kind: "person" as const, imported: plan.adds.length, already: plan.already, notImported: plan.notImported, linked: plan.linked as LinkedItem[],
      owners: plan.owners, lists: plan.lists, fields: plan.fields, choices: plan.choices, warnings: plan.warnings,
      unsubscribed: unsubscribed.map((u) => u.id), privateOthers: plan.privateOthers, ownerOnly: 0,
    },
  };
}

// ---------------------------------------------------------------- SF-122 savers

type SaveHooks = { before?: () => void | Promise<void>; after?: () => void | Promise<void> };
let saveHooks: SaveHooks | null = null;

// Tests only: called at the start and the end of every import transaction (inside it), to check that no outside call is
// made while one is open, or to make one fail. Throws outside APP_ENV=test.
export function onSaveForTests(hooks: SaveHooks | null): void {
  if (process.env.APP_ENV !== "test") throw new Error("onSaveForTests is for tests only.");
  saveHooks = hooks;
}

// Pipedrive names of the records the report lists as not imported: "<kind>:<Pipedrive id>" → label.
const namesOf = (report: Report) => new Map(report.notImported.map((n) => [`${n.kind}:${n.pipedriveId}`, n.label]));

async function linkMap(db: Sql, companyId: string, kind: "deal" | "person" | "organisation", ids: number[]): Promise<Map<number, number | null>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const column = kind === "deal" ? db`deal_id` : kind === "person" ? db`person_id` : db`organisation_id`;
  const rows = await db<{ id: string; target: number | null }[]>`
    select pipedrive_id::text as id, ${column}::int as target from pipedrive_links
    where company_id = ${companyId} and kind = ${kind} and pipedrive_id = any(${unique}::bigint[])`;
  return new Map(rows.map((r) => [Number(r.id), r.target]));
}

async function linkedSet(db: Sql, companyId: string, kind: "deal" | "note" | "activity" | "file", ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db<{ id: string }[]>`
    select pipedrive_id::text as id from pipedrive_links where company_id = ${companyId} and kind = ${kind} and pipedrive_id = any(${ids}::bigint[])`;
  return new Set(rows.map((r) => Number(r.id)));
}

async function linksFor(db: Sql, companyId: string, items: { dealId: number | null; personId: number | null; orgId: number | null }[]): Promise<Links> {
  const pick = (f: (x: (typeof items)[number]) => number | null) => items.flatMap((x) => (f(x) === null ? [] : [f(x)!]));
  return {
    deals: await linkMap(db, companyId, "deal", pick((x) => x.dealId)),
    persons: await linkMap(db, companyId, "person", pick((x) => x.personId)),
    organisations: await linkMap(db, companyId, "organisation", pick((x) => x.orgId)),
  };
}

// CRM deals and people the importer cannot see (private, neither creator nor owner): research.md §9.
async function hiddenTargets(db: Sql, importerId: number, links: Links): Promise<Set<string>> {
  const ids = (m: Map<number, number | null>) => [...m.values()].filter((v): v is number => v !== null);
  const deals = ids(links.deals);
  const people = ids(links.persons);
  const out = new Set<string>();
  if (deals.length > 0) {
    for (const r of await db<{ id: number }[]>`
      select id::int as id from deals where id = any(${deals}::bigint[]) and private and created_by <> ${importerId} and owner_id <> ${importerId}`) out.add(`deal:${r.id}`);
  }
  if (people.length > 0) {
    for (const r of await db<{ id: number }[]>`
      select id::int as id from persons where id = any(${people}::bigint[]) and private and created_by <> ${importerId} and owner_id <> ${importerId}`) out.add(`person:${r.id}`);
  }
  return out;
}

type NewLink = { kind: "deal" | "note" | "activity" | "file"; pipedriveId: number; id: number };

async function insertRecordLinks(db: Sql, ctx: Ctx, links: NewLink[]) {
  const of = (l: NewLink, k: NewLink["kind"]) => (l.kind === k ? l.id : null);
  await inChunks(links, (c) => db`
    insert into pipedrive_links (company_id, kind, pipedrive_id, deal_id, note_id, activity_id, file_id, how, import_id)
    select ${ctx.companyId}::bigint, kind, pipedrive_id, deal_id, note_id, activity_id, file_id, 'imported', ${ctx.importId}::bigint
    from unnest(${col(c, (l) => l.kind)}::text[], ${col(c, (l) => l.pipedriveId)}::bigint[], ${col(c, (l) => of(l, "deal"))}::bigint[],
                ${col(c, (l) => of(l, "note"))}::bigint[], ${col(c, (l) => of(l, "activity"))}::bigint[], ${col(c, (l) => of(l, "file"))}::bigint[])
         as t(kind, pipedrive_id, deal_id, note_id, activity_id, file_id)`);
}

const pageReport = (kind: PageReport["kind"], o: Partial<PageReport>): PageReport => ({
  kind, imported: 0, already: 0, notImported: [], linked: [], owners: {}, lists: [], fields: [], choices: [], warnings: [], unsubscribed: [],
  privateOthers: 0, ownerOnly: 0, ...o,
});

// The `pipelines` step: every Pipedrive pipeline and stage matched or created, in one transaction holding the tables
// (so two imports, or an import and an admin, never create one name twice). Inserts only.
async function savePipelines(db: Sql, pdPipelines: PdPipeline[], pdStages: PdStage[]): Promise<{ stageMap: StageMap; page: PageReport }> {
  await db`lock table pipelines, stages in share row exclusive mode`;
  const pipelines = await db<{ id: number; name: string; position: number }[]>`select id::int as id, name, position from pipelines`;
  const stages = await db<{ id: number; pipelineId: number; name: string; position: number }[]>`
    select id::int as id, pipeline_id::int as "pipelineId", name, position from stages`;
  const plan = planPipelines(pdPipelines, pdStages, { pipelines, stages });
  const created: { id: number; stages: number[] }[] = [];
  for (const p of plan.newPipelines) {
    const [row] = await db<{ id: number }[]>`insert into pipelines (name, position) values (${p.name}, ${p.position}) returning id::int as id`;
    const ids: number[] = [];
    for (const [i, name] of p.stages.entries()) {
      const [st] = await db<{ id: number }[]>`insert into stages (pipeline_id, name, position) values (${row.id}, ${name}, ${i + 1}) returning id::int as id`;
      ids.push(st.id);
    }
    created.push({ id: row.id, stages: ids });
  }
  const added: number[] = [];
  for (const st of plan.newStages) {
    const [row] = await db<{ id: number }[]>`insert into stages (pipeline_id, name, position) values (${st.pipelineId}, ${st.name}, ${st.position}) returning id::int as id`;
    added.push(row.id);
  }
  const stageMap: StageMap = {};
  for (const [pdId, ref] of Object.entries(plan.stageMap)) {
    stageMap[pdId] = "stageId" in ref ? ref.stageId : "newStage" in ref ? added[ref.newStage] : "newPipeline" in ref ? created[ref.newPipeline].stages[ref.stage] : ref.problem;
  }
  return { stageMap, page: pageReport("deal", { pipelines: plan.report }) };
}

async function saveDeals(db: Sql, ctx: Ctx, f: Extract<Fetched, { kind: "deals" }>, report: Report) {
  const items = f.items;
  const linked = await linkedSet(db, ctx.companyId, "deal", items.map((d) => d.id));
  const participantIds = [...f.participants.values()].flat().map((p) => p.personId);
  const links: Links = {
    deals: new Map(),
    persons: await linkMap(db, ctx.companyId, "person", [...items.flatMap((d) => (d.personId === null ? [] : [d.personId])), ...participantIds]),
    organisations: await linkMap(db, ctx.companyId, "organisation", items.flatMap((d) => (d.orgId === null ? [] : [d.orgId]))),
  };
  const labels = await db<{ id: number; name: string }[]>`select id::int as id, name from deal_labels where removed_at is null`;
  const crmFields = await listCrmFields("deal", db, true);
  const plan = planDealPage(items, {
    importerId: ctx.userId,
    linked,
    links,
    names: namesOf(report),
    stageMap: ctx.snapshot.stageMap ?? {},
    users: await activeUsers(db),
    pdUsers: ctx.snapshot.users,
    labels: new Map(labels.map((l) => [l.name.trim().toLowerCase(), l.id])),
    fields: planFields("deal", ctx.snapshot.dealFields ?? [], crmFields),
    participants: f.participants,
    followers: f.followers,
    now: new Date(),
  });
  const ids = await newIds(db, "deals", plan.adds.length);
  const deals = plan.adds.map((a, i) => ({ ...a, id: ids[i] }));
  await inChunks(deals, (c) => db`
    insert into deals (id, title, value_pence, stage_id, stage_entered_at, organisation_id, person_id, owner_id, expected_close_on, private,
                       created_by, created_at, status, closed_at, lost_reason, archived_at)
    overriding system value
    select * from unnest(${col(c, (d) => d.id)}::bigint[], ${col(c, (d) => d.deal.title)}::text[], ${col(c, (d) => d.deal.valuePence)}::bigint[],
                         ${col(c, (d) => d.deal.stageId)}::bigint[], ${col(c, (d) => d.deal.stageEnteredAt)}::timestamptz[],
                         ${col(c, (d) => d.organisationId)}::bigint[], ${col(c, (d) => d.personId)}::bigint[], ${col(c, (d) => d.deal.ownerId)}::bigint[],
                         ${col(c, (d) => d.deal.expectedClose)}::date[], ${col(c, (d) => d.deal.private)}::boolean[], ${col(c, (d) => d.deal.createdBy)}::bigint[],
                         ${col(c, (d) => d.deal.createdAt)}::timestamptz[], ${col(c, (d) => d.deal.status)}::text[], ${col(c, (d) => d.deal.closedAt)}::timestamptz[],
                         ${col(c, (d) => d.deal.lostReason)}::text[], ${col(c, (d) => d.deal.archivedAt)}::timestamptz[])`);
  // One stage period from Pipedrive's last stage change (no invented history); it stops at the closing time.
  const stageIds = [...new Set(deals.map((d) => d.deal.stageId))];
  const stageNames = stageIds.length === 0 ? [] : await db<{ id: number; stage: string; pipeline: string }[]>`
    select s.id::int as id, s.name as stage, p.name as pipeline from stages s join pipelines p on p.id = s.pipeline_id where s.id = any(${stageIds}::bigint[])`;
  const names = new Map(stageNames.map((x) => [x.id, x]));
  await inChunks(deals, (c) => db`
    insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, entered_at, left_at, moved_by)
    select * from unnest(${col(c, (d) => d.id)}::bigint[], ${col(c, (d) => d.deal.stageId)}::bigint[], ${col(c, (d) => names.get(d.deal.stageId)!.stage)}::text[],
                         ${col(c, (d) => names.get(d.deal.stageId)!.pipeline)}::text[], ${col(c, (d) => d.deal.stageEnteredAt)}::timestamptz[],
                         ${col(c, (d) => (d.deal.closedAt === null ? null : new Date(Math.max(d.deal.closedAt.getTime(), d.deal.stageEnteredAt.getTime()))))}::timestamptz[],
                         ${col(c, () => ctx.userId)}::bigint[])`);
  const labelRows = deals.flatMap((d) => d.labelIds.map((labelId) => ({ dealId: d.id, labelId })));
  await inChunks(labelRows, (c) => db`
    insert into deal_label_links (deal_id, label_id) select * from unnest(${col(c, (l) => l.dealId)}::bigint[], ${col(c, (l) => l.labelId)}::bigint[])`);
  const peopleRows = deals.flatMap((d) => d.otherPeople.map((personId) => ({ dealId: d.id, personId })));
  await inChunks(peopleRows, (c) => db`
    insert into deal_people (deal_id, person_id, linked_by)
    select deal_id, person_id, ${ctx.userId} from unnest(${col(c, (l) => l.dealId)}::bigint[], ${col(c, (l) => l.personId)}::bigint[]) as t(deal_id, person_id)`);
  const followerRows = deals.flatMap((d) => d.followers.map((userId) => ({ dealId: d.id, userId })));
  await inChunks(followerRows, (c) => db`
    insert into deal_followers (deal_id, user_id) select * from unnest(${col(c, (l) => l.dealId)}::bigint[], ${col(c, (l) => l.userId)}::bigint[])`);
  await insertCustomValues(db, "deals", crmFields, deals);
  // FR-008: one "Imported from Pipedrive" entry per deal; no added / won / lost entries, no follower notice.
  await inChunks(deals, (c) => db`
    insert into timeline_events (deal_id, kind, actor_id)
    select deal_id, 'pipedrive_imported', ${ctx.userId} from unnest(${col(c, (d) => d.id)}::bigint[]) as t(deal_id)`);
  await insertRecordLinks(db, ctx, deals.map((d) => ({ kind: "deal" as const, pipedriveId: d.pipedriveId, id: d.id })));
  return {
    done: plan.done,
    page: pageReport("deal", {
      imported: deals.length, already: plan.already, notImported: plan.notImported, owners: plan.owners, lists: plan.lists, fields: plan.fields,
      choices: plan.choices, warnings: plan.warnings, privateDeals: plan.privateDeals,
    }),
  };
}

async function recordLookups(db: Sql, ctx: Ctx, kind: "note" | "activity" | "file", items: { id: number; dealId: number | null; personId: number | null; orgId: number | null }[], report: Report): Promise<RecordLookups> {
  const links = await linksFor(db, ctx.companyId, items);
  return {
    importerId: ctx.userId,
    linked: await linkedSet(db, ctx.companyId, kind, items.map((x) => x.id)),
    links,
    names: namesOf(report),
    users: await activeUsers(db),
    pdUsers: ctx.snapshot.users,
    hidden: await hiddenTargets(db, ctx.userId, links),
    now: new Date(),
  };
}

async function saveNotes(db: Sql, ctx: Ctx, items: PdNote[], report: Report) {
  const plan = planNotePage(items, await recordLookups(db, ctx, "note", items, report));
  const ids = await newIds(db, "timeline_events", plan.adds.length);
  const notes = plan.adds.map((a, i) => ({ ...a, id: ids[i] }));
  // Plain notes (editable and deletable like any note); no note_mentions, so nobody is notified (FR-010).
  await inChunks(notes, (c) => db`
    insert into timeline_events (id, deal_id, person_id, organisation_id, kind, actor_id, body, created_at)
    overriding system value
    select id, deal_id, person_id, organisation_id, 'note', actor_id, body, created_at
    from unnest(${col(c, (n) => n.id)}::bigint[], ${col(c, (n) => n.target.dealId)}::bigint[], ${col(c, (n) => n.target.personId)}::bigint[],
                ${col(c, (n) => n.target.organisationId)}::bigint[], ${col(c, (n) => n.actorId)}::bigint[], ${col(c, (n) => n.body)}::text[],
                ${col(c, (n) => n.createdAt)}::timestamptz[])
         as t(id, deal_id, person_id, organisation_id, actor_id, body, created_at)`);
  await insertRecordLinks(db, ctx, notes.map((n) => ({ kind: "note" as const, pipedriveId: n.pipedriveId, id: n.id })));
  return {
    done: plan.done,
    page: pageReport("note", {
      imported: notes.length, already: plan.already, notImported: plan.notImported, owners: plan.owners, warnings: plan.warnings, elsewhere: plan.elsewhere,
      privateOn: { notes: plan.privateOn },
    }),
  };
}

async function saveActivities(db: Sql, ctx: Ctx, items: PdActivity[], report: Report) {
  const base = await recordLookups(db, ctx, "activity", items, report);
  const types = Object.fromEntries((ctx.snapshot.activityTypes ?? []).map((t) => [t.key, { name: t.name, custom: !["call", "meeting", "task", "deadline", "email", "lunch"].includes(t.key) }]));
  const plan = planActivityPage(items, { ...base, types });
  const ids = await newIds(db, "activities", plan.adds.length);
  const rows = plan.adds.map((a, i) => ({ ...a, id: ids[i] }));
  // assigned_by = the assignee: the assignment notification (assignee_id <> assigned_by) never fires (FR-013).
  await inChunks(rows, (c) => db`
    insert into activities (id, type, subject, due_on, due_time, duration_minutes, note, deal_id, person_id, organisation_id, assignee_id,
                            done_at, done_by, created_by, created_at, assigned_by, assigned_at)
    overriding system value
    select id, type, subject, due_on, due_time, duration_minutes, note, deal_id, person_id, organisation_id, assignee_id,
           done_at, case when done_at is null then null else assignee_id end, ${ctx.userId}, created_at, assignee_id, created_at
    from unnest(${col(c, (a) => a.id)}::bigint[], ${col(c, (a) => a.value.type)}::text[], ${col(c, (a) => a.value.subject)}::text[],
                ${col(c, (a) => a.value.dueOn)}::date[], ${col(c, (a) => a.value.dueTime)}::time[], ${col(c, (a) => a.value.durationMinutes)}::int[],
                ${col(c, (a) => a.value.note)}::text[], ${col(c, (a) => a.target.dealId)}::bigint[], ${col(c, (a) => a.target.personId)}::bigint[],
                ${col(c, (a) => a.target.organisationId)}::bigint[], ${col(c, (a) => a.value.assigneeId)}::bigint[], ${col(c, (a) => a.value.doneAt)}::timestamptz[],
                ${col(c, (a) => a.value.createdAt)}::timestamptz[])
         as t(id, type, subject, due_on, due_time, duration_minutes, note, deal_id, person_id, organisation_id, assignee_id, done_at, created_at)`);
  await insertRecordLinks(db, ctx, rows.map((a) => ({ kind: "activity" as const, pipedriveId: a.pipedriveId, id: a.id })));
  // SF-109's Last contacted: a done call or meeting with a person raises it to the earlier of its due time and when it
  // was done, never lowering it.
  const contacted = new Map<number, Date>();
  for (const a of rows) {
    if (a.value.doneAt === null || a.value.type === "task" || a.target.personId === null) continue;
    const due = ukInstant(a.value.dueOn, a.value.dueTime);
    const at = due.getTime() < a.value.doneAt.getTime() ? due : a.value.doneAt;
    const cur = contacted.get(a.target.personId);
    if (!cur || cur.getTime() < at.getTime()) contacted.set(a.target.personId, at);
  }
  const updates = [...contacted.entries()].map(([id, at]) => ({ id, at }));
  if (updates.length > 0) {
    await db`
      update persons p set last_contacted_at = greatest(coalesce(p.last_contacted_at, '-infinity'::timestamptz), v.at)
      from unnest(${col(updates, (u) => u.id)}::bigint[], ${col(updates, (u) => u.at)}::timestamptz[]) as v(id, at)
      where p.id = v.id`;
  }
  return {
    done: plan.done,
    page: pageReport("activity", {
      imported: rows.length, already: plan.already, notImported: plan.notImported, owners: plan.owners, warnings: plan.warnings, elsewhere: plan.elsewhere,
      activityTypes: plan.types, privateOn: { activities: plan.privateOn },
    }),
  };
}

type Totals = Partial<Record<Kind, number>>;

// The row's update after a part: step, cursor, snapshot, options, counts, report, totals and done counters.
async function writeRow(db: Sql, row: Row, o: { step: Step; cursor: string | null; snapshot: Snapshot | null; options: Row["options"]; counts: Counts; report: Report; total: Totals; done: Totals }) {
  const finished = o.step === "done";
  const t = (k: Kind) => o.total[k] !== undefined;
  const n = (x: Totals, k: Kind) => x[k] ?? 0;
  await db`
    update pipedrive_imports set
      step = ${o.step}, cursor = ${o.cursor}, snapshot = ${o.snapshot === null ? null : db.json(o.snapshot)}, options = ${db.json(o.options)},
      counts = ${db.json(o.counts)}, report = ${db.json(o.report)},
      organisations_total = case when ${t("organisations")} then coalesce(organisations_total, 0) + ${n(o.total, "organisations")} else organisations_total end,
      people_total = case when ${t("people")} then coalesce(people_total, 0) + ${n(o.total, "people")} else people_total end,
      deals_total = case when ${t("deals")} then coalesce(deals_total, 0) + ${n(o.total, "deals")} else deals_total end,
      notes_total = case when ${t("notes")} then coalesce(notes_total, 0) + ${n(o.total, "notes")} else notes_total end,
      activities_total = case when ${t("activities")} then coalesce(activities_total, 0) + ${n(o.total, "activities")} else activities_total end,
      files_total = case when ${t("files")} then coalesce(files_total, 0) + ${n(o.total, "files")} else files_total end,
      organisations_done = organisations_done + ${n(o.done, "organisations")}, people_done = people_done + ${n(o.done, "people")},
      deals_done = deals_done + ${n(o.done, "deals")}, notes_done = notes_done + ${n(o.done, "notes")},
      activities_done = activities_done + ${n(o.done, "activities")}, files_done = files_done + ${n(o.done, "files")},
      state = ${finished ? "finished" : "running"}, wait_until = null, seen_at = now(),
      finished_at = ${finished ? db`now()` : db`null`}
    where id = ${row.id}`;
  return finished;
}

type Locked = { step: Step; cursor: string | null; state: ImportState; snapshot: Snapshot | null; counts: unknown; report: unknown; options: Row["options"] };

// The import row locked, if the part is still current (same step and cursor, running or waiting).
async function lockRow(db: Sql, userId: number, row: Row, cursor = row.cursor): Promise<Locked | null> {
  const [cur] = await db<Locked[]>`
    select step, cursor, state, snapshot, counts, report, options from pipedrive_imports where id = ${row.id} and user_id = ${userId} for update`;
  if (!cur || cur.step !== row.step || cur.cursor !== cursor || (cur.state !== "running" && cur.state !== "waiting")) return null;
  return cur;
}

// One transaction: the row locked and checked, the page saved, the cursor, counts and report moved. Returns whether the
// import is now finished. A stale part (another tab saved it, or the user stopped) changes nothing.
async function save(userId: number, row: Row, f: Fetched): Promise<boolean> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    await saveHooks?.before?.();
    const cur = await lockRow(db, userId, row);
    if (!cur) return false;
    const counts: Counts = readCounts(cur.counts);
    const report: Report = readReport(cur.report);
    let step: Step = row.step;
    let cursor: string | null = row.cursor;
    const done: Totals = {};
    const total: Totals = {};
    let snapshot = cur.snapshot;
    let options = cur.options ?? {};
    const advance = (next: string | null) => {
      if (next) cursor = next;
      else {
        step = nextStep(step, row);
        cursor = null;
      }
    };
    const ctx = (): Ctx => ({ userId, importId: row.id, companyId: row.company_id, snapshot: snapshot!, consent: row.consent ?? "unsubscribed" });

    if (f.kind === "prepare") {
      snapshot = f.snapshot;
      advance(null);
    } else if (f.kind === "count") {
      total[COUNT_STEP[row.step]!] = f.n;
      advance(f.next);
    } else if (f.kind === "organisations" || f.kind === "people") {
      await db`lock table organisations, person_emails, pipedrive_links in share row exclusive mode`;
      if (f.kind === "organisations") {
        const saved = await saveOrganisations(db, ctx(), f.items);
        mergeReport(report, counts, saved.page);
        done.organisations = saved.plan.done;
      } else {
        // The page's organisations first (FR-012): counted as imported or linked, not in "<done> of <total>".
        const orgs = f.orgs.length > 0 ? await saveOrganisations(db, ctx(), f.orgs) : null;
        if (orgs) mergeReport(report, counts, { ...orgs.page, already: 0 });
        const saved = await savePersons(db, ctx(), f.items, orgs?.refused ?? new Map());
        mergeReport(report, counts, saved.page);
        done.people = saved.plan.done;
        if (f.noMarketing) options = { ...options, noMarketingStatus: true };
      }
      advance(f.next);
    } else if (f.kind === "pipelines") {
      const saved = await savePipelines(db, f.pipelines, f.stages);
      snapshot = { ...snapshot!, stageMap: saved.stageMap };
      mergeReport(report, counts, saved.page);
      advance(null);
    } else if (f.kind === "deals" || f.kind === "notes" || f.kind === "activities") {
      await db`lock table organisations, person_emails, pipedrive_links in share row exclusive mode`;
      const saved =
        f.kind === "deals" ? await saveDeals(db, ctx(), f, report) : f.kind === "notes" ? await saveNotes(db, ctx(), f.items, report) : await saveActivities(db, ctx(), f.items, report);
      mergeReport(report, counts, saved.page);
      done[f.kind] = saved.done;
      advance(f.next);
    } else {
      step = "done";
    }
    const finished = await writeRow(db, row, { step, cursor, snapshot, options, counts, report, total, done });
    await saveHooks?.after?.();
    return finished;
  });
}

// ---------------------------------------------------------------- files (research.md §8)

// What a file part collected since its last commit: report items, counters and records read.
type FileBatch = { done: number; already: number; notImported: ReportItem[]; owners: Record<string, OwnerMiss>; elsewhere: Counter<Elsewhere>; imported: number; privateOn: number };
const newBatch = (): FileBatch => ({ done: 0, already: 0, notImported: [], owners: {}, elsewhere: new Counter<Elsewhere>(), imported: 0, privateOn: 0 });

// Merges a batch into the locked row and moves the cursor (or the step).
async function commitBatch(db: Sql, row: Row, cur: Locked, batch: FileBatch, next: { step: Step; cursor: string | null }) {
  const counts = readCounts(cur.counts);
  const report = readReport(cur.report);
  mergeReport(report, counts, pageReport("file", {
    imported: batch.imported, already: batch.already, notImported: batch.notImported, owners: batch.owners, elsewhere: batch.elsewhere.list(),
    privateOn: { files: batch.privateOn },
  }));
  return writeRow(db, row, { ...next, snapshot: cur.snapshot, options: cur.options ?? {}, counts, report, total: {}, done: { files: batch.done } });
}

// A file part: a page of 50 metadata, then one file copied at a time from the cursor's index, each listed in its own
// transaction together with the items passed over before it. No new copy starts after FILE_PART_MS or 25 MB. Throws
// Pipedrive errors and StorageUnreachable to runPart (nothing since the last commit is saved; it is read again).
async function runFilesPart(userId: number, row: Row, token: string): Promise<PartResult> {
  const started = Date.now();
  const [startText, indexText] = (row.cursor ?? "0:0").split(":");
  const start = Number(startText) || 0;
  let index = Number(indexText) || 0;
  const page = await listFiles(token, { start, limit: FILE_PAGE });
  const snapshot = row.snapshot!;
  const ctx: Ctx = { userId, importId: row.id, companyId: row.company_id, snapshot, consent: row.consent ?? "unsubscribed" };
  const lookups = await recordLookups(sql, ctx, "file", page.items, readReport(row.report));
  let cursor = row.cursor;
  let batch = newBatch();
  let copied = 0;
  try {
    for (; index < page.items.length; index++) {
      if (Date.now() - started > FILE_PART_MS || copied >= FILE_PART_BYTES) break;
      const f = page.items[index];
      const plan = planFileItem(f, lookups, batch.owners);
      if (plan.kind === "skip") continue;
      batch.done += 1;
      if (plan.kind === "already") batch.already += 1;
      else if (plan.kind === "elsewhere") batch.elsewhere.add(plan.on, () => ({ kind: "file", on: plan.on }));
      else if (plan.kind === "notImported") batch.notImported.push(plan.item);
      else {
        const label = f.name.trim() || `#${f.id}`;
        const dl = await downloadFile(token, f.id, MAX_FILE_BYTES);
        if (dl === "gone" || dl === "too_large" || dl.bytes.length === 0) {
          const code = dl === "gone" ? { code: "pipedrive_file_gone" } : dl === "too_large" ? { code: "pipedrive_file_too_large", args: { mb: formatMb(Math.max(f.size ?? 0, MAX_FILE_BYTES + 1)) } } : { code: "pipedrive_file_empty" };
          batch.notImported.push(toItem("file", f.id, label, code));
          continue;
        }
        const bytes = dl.bytes;
        copied += bytes.length;
        // Queued for clean-up BEFORE the upload (committed): a crash, a time-out or a lost race always ends with the
        // object removed. The file is listed only in the commit that takes it off the queue.
        const path = newStoragePath();
        await sql`insert into file_cleanup (storage_path, due_at) values (${path}, now() + interval '1 hour')`;
        const { url } = await createSignedUploadUrl(path);
        if (!(await putSigned(url, bytes, uploadContentType(f.name), { timeoutMs: DOWNLOAD_UPLOAD_MS }))) throw new StorageUnreachable();
        const nextCursor = `${start}:${index + 1}`;
        const result = await sql.begin(async (tx) => {
          const db = tx as unknown as Sql;
          await saveHooks?.before?.();
          const cur = await lockRow(db, userId, row, cursor);
          if (!cur) return "stale" as const;
          await db`lock table pipedrive_links in share row exclusive mode`;
          const [taken] = await db`select 1 from pipedrive_links where company_id = ${row.company_id} and kind = 'file' and pipedrive_id = ${f.id}`;
          const t = plan.target;
          const [exists] = t.dealId !== null
            ? await db`select 1 from deals where id = ${t.dealId}`
            : t.personId !== null ? await db`select 1 from persons where id = ${t.personId}` : await db`select 1 from organisations where id = ${t.organisationId}`;
          if (taken) batch.already += 1;
          else if (!exists) {
            batch.notImported.push(toItem("file", f.id, label, { code: "pipedrive_target_deleted", args: { kind: t.dealId !== null ? "deal" : t.personId !== null ? "person" : "organisation" } }));
          } else {
            const target = t.dealId !== null ? { dealId: t.dealId } : t.personId !== null ? { personId: t.personId } : { organisationId: t.organisationId! };
            const kind = fileKind({ head: bytes.subarray(0, 16), name: f.name, storedType: uploadContentType(f.name) });
            const fileId = await insertFile(db, plan.uploaderId, target, { name: f.name, size: bytes.length, kind, path, addedAt: plan.addedAt });
            await insertRecordLinks(db, ctx, [{ kind: "file", pipedriveId: f.id, id: fileId }]);
            await db`delete from file_cleanup where storage_path = ${path}`;
            batch.imported += 1;
            if (plan.hidden) batch.privateOn += 1;
          }
          if (taken || !exists) await db`update file_cleanup set due_at = now() where storage_path = ${path}`;
          await commitBatch(db, row, cur, batch, { step: row.step, cursor: nextCursor });
          await saveHooks?.after?.();
          return "ok" as const;
        });
        if (result === "stale") {
          await sql`update file_cleanup set due_at = now() where storage_path = ${path}`;
          return { next: "now" };
        }
        cursor = nextCursor;
        batch = newBatch();
      }
    }
    const next = index < page.items.length ? { step: row.step, cursor: `${start}:${index}` } : page.next !== null ? { step: row.step, cursor: `${page.next}:0` } : { step: nextStep(row.step, row), cursor: null };
    const finished = await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      await saveHooks?.before?.();
      const cur = await lockRow(db, userId, row, cursor);
      if (!cur) return false;
      const r = await commitBatch(db, row, cur, batch, next);
      await saveHooks?.after?.();
      return r;
    });
    return finished ? { next: "stop" } : { next: "now" };
  } finally {
    await sweepFileCleanup();
  }
}

// ---------------------------------------------------------------- what the pages show

export type Progress = { kind: Kind; done: number; total: number };
export type ImportView = {
  id: number;
  companyName: string;
  wantPeople: boolean;
  wantOrganisations: boolean;
  wants: Record<Kind, boolean>;
  state: ImportState;
  // `paused` also when no part ran for 30 seconds (the page does not move it on until [ CONTINUE ]).
  effectiveState: ImportState;
  pauseReason: PauseReason | "absent" | null;
  waitSeconds: number;
  progress: Progress[];
  counts: Counts;
  totals: { imported: number; linked: number; notImported: number; already: number };
  report: Report;
  pausedText: string;
  stoppedByUser: boolean;
};

// The user's latest import (open, or the last finished or stopped one with its report), or null.
export async function getImportView(userId: number): Promise<ImportView | null> {
  const row = await load(sql, userId, { latest: true });
  if (!row) return null;
  const counts = readCounts(row.counts);
  const wants: Record<Kind, boolean> = {
    organisations: row.want_organisations, people: row.want_people, deals: row.want_deals, notes: row.want_notes, activities: row.want_activities, files: row.want_files,
  };
  // FR-018: one line per ticked kind, in the order Organisations, People, Deals, Notes, Activities, Files.
  const progress: Progress[] = COUNT_KINDS.filter((k) => wants[k]).map((k) => {
    const done = row[`${k}_done`];
    return { kind: k, done, total: Math.max(row[`${k}_total`] ?? 0, done) };
  });
  const absent = (row.state === "running" || row.state === "waiting") && row.absent;
  const sum = (k: keyof Counts["people"]) => COUNT_KINDS.reduce((n, kind) => n + counts[kind][k], 0);
  return {
    id: row.id,
    companyName: row.company_name,
    wantPeople: row.want_people,
    wantOrganisations: row.want_organisations,
    wants,
    state: row.state,
    effectiveState: absent ? "paused" : row.state,
    pauseReason: absent ? "absent" : row.pause_reason,
    waitSeconds: row.state === "waiting" ? Math.max(0, row.wait_left) : 0,
    progress,
    counts,
    totals: { imported: sum("imported"), linked: sum("linked"), notImported: sum("notImported"), already: sum("already") },
    report: readReport(row.report),
    pausedText: templates.pipedrive_paused(progress),
    stoppedByUser: row.state === "stopped",
  };
}
