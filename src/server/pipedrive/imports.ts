// The Pipedrive import engine (SF-117 research.md §5–§6, data-model.md): one row per run in pipedrive_imports, moved on
// part by part by the open import page (no cron, no background job). A part makes at most two Pipedrive calls (the
// three of `prepare` excepted), always OUTSIDE any transaction, then saves the page in one sql.begin() that also moves
// the cursor: a record is saved whole or not at all, and a resumed or repeated part never saves twice (the row lock and
// the step/cursor check throw a stale page away). Each page transaction locks organisations, person_emails and
// pipedrive_links (as the CSV import does), so two imports of one company, or an import and a hand-made add, save one
// page at a time and every check sees the other's rows. pipedrive_links (company + kind + Pipedrive id) is the
// "never twice" key. Every query names its user: only the user who started an import can read or move it.
import { sql, type Sql } from "@/server/db";
import { listFields as listCrmFields } from "@/server/custom-fields/fields";
import { col, inChunks, insertCustomValues, newIds } from "@/server/imports/bulk";
import { templates } from "@/server/messages";
import {
  listFields,
  listOrganizations,
  listPersons,
  listUsers,
  PipedriveBadRequest,
  PipedriveRefused,
  PipedriveSlowDown,
  PipedriveUnreachable,
  type PdField,
  type PdOrganization,
  type PdPerson,
} from "@/server/pipedrive/api";
import { tokenFor } from "@/server/pipedrive/connection";
import { planOrganisationPage, planPersonPage, type LinkedItem, type PdUsers } from "@/server/pipedrive/page";
import { emptyCounts, emptyReport, mergeReport, readCounts, readReport, type Counts, type Report } from "@/server/pipedrive/report";
import { planFields } from "@/server/pipedrive/rules";
import { CONSENTS, isValidEmail, normaliseEmail, type Consent } from "@/server/records/rules";

export type ImportState = "running" | "waiting" | "paused" | "stopped" | "finished";
export type PauseReason = "unreachable" | "token_refused" | "other_company";
type Step = "prepare" | "count_organisations" | "count_people" | "organisations" | "people" | "done";
export type PartResult = { next: "now" } | { next: "wait"; seconds: number } | { next: "stop" };
export type StartError = "pipedrive_tick_something" | "pipedrive_consent_required" | "pipedrive_not_connected";

// Records per saved page, and per counting page (research.md §5).
export const PAGE = 100;
const COUNT_PAGE = 500;
// No part for this long (after any wait Pipedrive asked for): the import shows as paused (spec Clarifications).
export const ABSENT_SECONDS = 30;
const OPEN = ["running", "waiting", "paused"];

type Snapshot = { users: PdUsers; personFields: PdField[]; organizationFields: PdField[] };
type Row = {
  id: number;
  company_id: string;
  company_name: string;
  want_people: boolean;
  want_organisations: boolean;
  consent: Consent | null;
  state: ImportState;
  pause_reason: PauseReason | null;
  step: Step;
  cursor: string | null;
  organisations_total: number | null;
  people_total: number | null;
  organisations_done: number;
  people_done: number;
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
    select id::int as id, company_id::text as company_id, company_name, want_people, want_organisations, consent, state, pause_reason,
           step, cursor, organisations_total, people_total, organisations_done, people_done, snapshot, options, counts, report, finished_at,
           greatest(seen_at, coalesce(wait_until, seen_at)) < now() - make_interval(secs => ${ABSENT_SECONDS}) as absent,
           coalesce(ceil(extract(epoch from (wait_until - now())))::int, 0) as wait_left
    from pipedrive_imports
    where user_id = ${userId} and ${"id" in where ? db`id = ${where.id}` : db`true`}
    order by id desc limit 1`;
  return row ?? null;
}

// ---------------------------------------------------------------- start, continue, stop

export async function startImport(
  userId: number,
  o: { people: boolean; organisations: boolean; consent: string | null },
): Promise<{ id: number; existing: boolean } | { error: StartError }> {
  if (!o.people && !o.organisations) return { error: "pipedrive_tick_something" };
  const consent = (CONSENTS as readonly (string | null)[]).includes(o.consent) ? (o.consent as Consent) : null;
  if (o.people && consent === null) return { error: "pipedrive_consent_required" };
  const [conn] = await sql<{ company_id: string; company_name: string }[]>`
    select company_id::text as company_id, company_name from pipedrive_connections where user_id = ${userId}`;
  if (!conn) return { error: "pipedrive_not_connected" };
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const [open] = await db<{ id: number }[]>`
        select id::int as id from pipedrive_imports where user_id = ${userId} and state in ${db(OPEN)} for update`;
      if (open) return { id: open.id, existing: true };
      // Only the latest report is kept (FR-025).
      await db`delete from pipedrive_imports where user_id = ${userId} and state in ('stopped', 'finished')`;
      const [row] = await db<{ id: number }[]>`
        insert into pipedrive_imports (user_id, company_id, company_name, want_people, want_organisations, consent, counts, report)
        values (${userId}, ${conn.company_id}, ${conn.company_name}, ${o.people}, ${o.organisations}, ${o.people ? consent : null},
                ${db.json(emptyCounts())}, ${db.json(emptyReport())})
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

const ORDER: Step[] = ["prepare", "count_organisations", "count_people", "organisations", "people", "done"];

function nextStep(step: Step, r: Pick<Row, "want_people" | "want_organisations">): Step {
  for (const s of ORDER.slice(ORDER.indexOf(step) + 1)) {
    if ((s === "count_organisations" || s === "organisations") && !r.want_organisations) continue;
    if ((s === "count_people" || s === "people") && !r.want_people) continue;
    return s;
  }
  return "done";
}

type Fetched =
  | { kind: "prepare"; snapshot: Snapshot }
  | { kind: "count"; n: number; next: string | null }
  | { kind: "organisations"; items: PdOrganization[]; next: string | null }
  | { kind: "people"; items: PdPerson[]; next: string | null; orgs: PdOrganization[]; noMarketing: boolean }
  | { kind: "done" };

async function allFields(token: string, kind: "person" | "organization"): Promise<PdField[]> {
  const out: PdField[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const page = await listFields(token, kind, cursor);
    out.push(...page.items);
    cursor = page.next;
    if (!cursor) break;
  }
  return out;
}

// The Pipedrive calls of the row's step. Never inside a transaction.
async function fetchStep(token: string, row: Row): Promise<Fetched> {
  switch (row.step) {
    case "prepare": {
      const users = await listUsers(token);
      const personFields = row.want_people ? await allFields(token, "person") : [];
      const organizationFields = await allFields(token, "organization");
      return { kind: "prepare", snapshot: { users: Object.fromEntries(users.map((u) => [String(u.id), { name: u.name, email: u.email }])), personFields, organizationFields } };
    }
    case "count_organisations": {
      const page = await listOrganizations(token, { cursor: row.cursor, limit: COUNT_PAGE });
      return { kind: "count", n: page.items.filter((o) => !o.deleted).length, next: page.next };
    }
    case "count_people": {
      const page = await listPersons(token, { cursor: row.cursor, limit: COUNT_PAGE, marketing: false });
      return { kind: "count", n: page.items.filter((p) => !p.deleted).length, next: page.next };
    }
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
    fetched = await fetchStep(token.token, row);
  } catch (e) {
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

// One transaction: the row locked and checked, the page saved, the cursor, counts and report moved. Returns whether the
// import is now finished. A stale part (another tab saved it, or the user stopped) changes nothing.
async function save(userId: number, row: Row, f: Fetched): Promise<boolean> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [cur] = await db<{ step: Step; cursor: string | null; state: ImportState; snapshot: Snapshot | null; counts: unknown; report: unknown; options: Row["options"] }[]>`
      select step, cursor, state, snapshot, counts, report, options from pipedrive_imports where id = ${row.id} and user_id = ${userId} for update`;
    if (!cur || cur.step !== row.step || cur.cursor !== row.cursor || (cur.state !== "running" && cur.state !== "waiting")) return false;
    const counts: Counts = readCounts(cur.counts);
    const report: Report = readReport(cur.report);
    let step: Step = row.step;
    let cursor: string | null = row.cursor;
    let done = { organisations: 0, people: 0 };
    let total = { organisations: 0, people: 0 };
    let snapshot = cur.snapshot;
    let options = cur.options ?? {};
    const advance = (next: string | null) => {
      if (next) cursor = next;
      else {
        step = nextStep(step, row);
        cursor = null;
      }
    };

    if (f.kind === "prepare") {
      snapshot = f.snapshot;
      advance(null);
    } else if (f.kind === "count") {
      if (row.step === "count_organisations") total.organisations = f.n;
      else total.people = f.n;
      advance(f.next);
    } else if (f.kind === "organisations" || f.kind === "people") {
      const ctx: Ctx = { userId, importId: row.id, companyId: row.company_id, snapshot: snapshot!, consent: row.consent ?? "unsubscribed" };
      await db`lock table organisations, person_emails, pipedrive_links in share row exclusive mode`;
      if (f.kind === "organisations") {
        const saved = await saveOrganisations(db, ctx, f.items);
        mergeReport(report, counts, saved.page);
        done.organisations = saved.plan.done;
      } else {
        // The page's organisations first (FR-012): counted as imported or linked, not in "<done> of <total>".
        const orgs = f.orgs.length > 0 ? await saveOrganisations(db, ctx, f.orgs) : null;
        if (orgs) mergeReport(report, counts, { ...orgs.page, already: 0 });
        const saved = await savePersons(db, ctx, f.items, orgs?.refused ?? new Map());
        mergeReport(report, counts, saved.page);
        done.people = saved.plan.done;
        if (f.noMarketing) options = { ...options, noMarketingStatus: true };
      }
      advance(f.next);
    } else {
      step = "done";
    }
    const finished = step === "done";
    await db`
      update pipedrive_imports set
        step = ${step}, cursor = ${cursor}, snapshot = ${snapshot === null ? null : db.json(snapshot)}, options = ${db.json(options)},
        counts = ${db.json(counts)}, report = ${db.json(report)},
        organisations_total = case when ${row.step === "count_organisations"} then coalesce(organisations_total, 0) + ${total.organisations} else organisations_total end,
        people_total = case when ${row.step === "count_people"} then coalesce(people_total, 0) + ${total.people} else people_total end,
        organisations_done = organisations_done + ${done.organisations}, people_done = people_done + ${done.people},
        state = ${finished ? "finished" : "running"}, wait_until = null, seen_at = now(),
        finished_at = ${finished ? db`now()` : db`null`}
      where id = ${row.id}`;
    return finished;
  });
}

// ---------------------------------------------------------------- what the pages show

export type Progress = { kind: "organisations" | "people"; done: number; total: number };
export type ImportView = {
  id: number;
  companyName: string;
  wantPeople: boolean;
  wantOrganisations: boolean;
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
  const progress: Progress[] = [
    ...(row.want_organisations ? [{ kind: "organisations" as const, done: row.organisations_done, total: Math.max(row.organisations_total ?? 0, row.organisations_done) }] : []),
    ...(row.want_people ? [{ kind: "people" as const, done: row.people_done, total: Math.max(row.people_total ?? 0, row.people_done) }] : []),
  ];
  const absent = (row.state === "running" || row.state === "waiting") && row.absent;
  const sum = (k: keyof Counts["people"]) => counts.people[k] + counts.organisations[k];
  return {
    id: row.id,
    companyName: row.company_name,
    wantPeople: row.want_people,
    wantOrganisations: row.want_organisations,
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
