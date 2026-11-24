// CSV imports in the database (SF-103 research.md §2, §3, §6, §8, §9): the upload in parts, the column choices, the
// preview and the import itself. Every query on csv_imports names its user: only the user who started an import can
// read or change it. No session state (Supabase's transaction-mode pooler): each change is one sql.begin().
import { sql, type Sql } from "@/server/db";
import { listFields } from "@/server/custom-fields/fields";
import { formatValue, type CustomField, type CustomValue, type RecordKind } from "@/server/custom-fields/rules";
import { checkMapping, customFieldId, suggest, toField, toKind, type ColumnMapping, type ImportKind, type MappingError } from "@/server/imports/columns";
import { MAX_BYTES, PART_BYTES, readFile, type CsvRow, type ReadResult } from "@/server/imports/csv";
import {
  emptyLookups,
  keyOf,
  planOrganisations,
  planPeople,
  type ImportPlan,
  type ImportReport,
  type Lookups,
  type OrganisationToAdd,
  type PersonToAdd,
  type Skip,
} from "@/server/imports/plan";
import { col, inChunks, insertCustomValues, newIds } from "@/server/imports/bulk";
import { splitMulti } from "@/server/imports/rows";
import type { Names } from "@/server/imports/text";
import { CONSENTS, normaliseEmail, type Consent } from "@/server/records/rules";
import { visiblePerson } from "@/server/records/visibility";

export type ImportStatus = "uploading" | "ready" | "done";
export type ImportInfo = {
  id: number;
  kind: ImportKind;
  fileName: string;
  status: ImportStatus;
  rowCount: number | null;
  mapping: ColumnMapping | null;
  report: ImportReport | null;
};

const DAY = "24 hours";

const isKind = (k: unknown): k is ImportKind => k === "people" || k === "organisations";
const RECORD_KIND: Record<ImportKind, RecordKind> = { people: "person", organisations: "organisation" };

// SF-115: the custom fields a people or organisations import can fill.
export function importCustomFields(kind: ImportKind, db: Sql = sql, lock = false): Promise<CustomField[]> {
  return listFields(RECORD_KIND[kind], db, lock);
}

// Deletes the user's unfinished imports and every import older than 24 hours, finished ones included (research.md §3).
export async function purgeImports(db: Sql, userId: number): Promise<void> {
  await db`delete from csv_imports where (user_id = ${userId} and status <> 'done') or created_at < now() - ${DAY}::interval`;
}

export async function startImport(
  userId: number,
  kind: ImportKind,
  fileName: string,
  size: number,
): Promise<{ id: number } | { error: "import_too_large" | "import_no_rows" | "import_upload_failed" }> {
  if (!isKind(kind) || !Number.isSafeInteger(size)) return { error: "import_upload_failed" };
  if (size > MAX_BYTES) return { error: "import_too_large" };
  if (size <= 0) return { error: "import_no_rows" };
  const name = [...(fileName ?? "").trim()].slice(0, 255).join("") || "file.csv";
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    await purgeImports(db, userId);
    const [row] = await db<{ id: number }[]>`
      insert into csv_imports (user_id, kind, file_name, size_bytes) values (${userId}, ${kind}, ${name}, ${size}) returning id::int as id`;
    return { id: row.id };
  });
}

// Appends the next part (index = parts received so far) of the user's own upload; anything else deletes the upload.
export async function uploadPart(userId: number, id: number, index: number, part: Uint8Array): Promise<{ ok: true } | { error: "import_upload_failed" }> {
  const bytes = Buffer.from(part.buffer, part.byteOffset, part.byteLength);
  if (Number.isSafeInteger(index) && bytes.length > 0 && bytes.length <= PART_BYTES) {
    const done = await sql`
      update csv_imports set content = coalesce(content, ''::bytea) || ${bytes}, parts_received = parts_received + 1
      where id = ${id} and user_id = ${userId} and status = 'uploading' and parts_received = ${index}
        and coalesce(octet_length(content), 0) + ${bytes.length} <= size_bytes
      returning id`;
    if (done.length === 1) return { ok: true };
  }
  await sql`delete from csv_imports where id = ${id} and user_id = ${userId} and status <> 'done'`;
  return { error: "import_upload_failed" };
}

type FinishError = Exclude<ReadResult, { ok: true }>["code"] | "import_upload_failed";

// Reads the whole upload: refused (and deleted) with the fixed message, or ready with the suggested columns.
export async function finishUpload(userId: number, id: number): Promise<{ ok: true; kind: ImportKind } | { error: FinishError }> {
  const [row] = await sql<{ kind: ImportKind; content: Buffer | null; size_bytes: number }[]>`
    select kind, content, size_bytes from csv_imports where id = ${id} and user_id = ${userId} and status = 'uploading'`;
  const refuse = async (error: FinishError) => {
    await sql`delete from csv_imports where id = ${id} and user_id = ${userId} and status <> 'done'`;
    return { error };
  };
  if (!row) return { error: "import_upload_failed" };
  if (!row.content || row.content.length !== row.size_bytes) return refuse("import_upload_failed");
  const file = readFile(row.content);
  if (!file.ok) return refuse(file.code);
  const mapping = suggest(row.kind, file.headings, await importCustomFields(row.kind));
  await sql`
    update csv_imports set status = 'ready', row_count = ${file.rows.length}, mapping = ${sql.json(mapping)}
    where id = ${id} and user_id = ${userId} and status = 'uploading'`;
  return { ok: true, kind: row.kind };
}

export async function getImport(viewerId: number, id: number): Promise<ImportInfo | null> {
  const [r] = await sql<{ id: number; kind: ImportKind; file_name: string; status: ImportStatus; row_count: number | null; mapping: ColumnMapping | null; report: ImportReport | null }[]>`
    select id::int as id, kind, file_name, status, row_count, mapping, report from csv_imports where id = ${id} and user_id = ${viewerId}`;
  if (!r) return null;
  return { id: r.id, kind: r.kind, fileName: r.file_name, status: r.status, rowCount: r.row_count, mapping: r.mapping, report: r.report };
}

// The user's own ready import with its file read again (it was checked when the upload finished).
async function loadReady(db: Sql, viewerId: number, id: number, lock: boolean) {
  const [r] = await db<{ kind: ImportKind; status: ImportStatus; content: Buffer | null; mapping: ColumnMapping | null }[]>`
    select kind, status, content, mapping from csv_imports where id = ${id} and user_id = ${viewerId} ${lock ? db`for update` : db``}`;
  if (!r) return null;
  if (r.status !== "ready" || !r.content || !r.mapping) return { status: r.status === "ready" ? "uploading" : r.status, kind: r.kind } as { status: "uploading" | "done"; kind: ImportKind };
  const file = readFile(r.content);
  if (!file.ok) return null;
  return { status: "ready" as const, kind: r.kind, headings: file.headings, rows: file.rows, mapping: r.mapping };
}

export type ColumnView = { index: number; heading: string; samples: string[]; field: string; kind: string };

export async function getColumns(viewerId: number, id: number): Promise<ColumnView[] | null> {
  const r = await loadReady(sql, viewerId, id, false);
  if (!r || r.status !== "ready") return null;
  return r.mapping.columns.map((c) => ({
    index: c.index,
    heading: c.heading,
    samples: r.rows.slice(0, 2).map((row) => (row.values[c.index] ?? "").trim()),
    field: c.field,
    kind: c.kind ?? "work",
  }));
}

// The column fields chosen on the columns step, by column position (unknown keys read as Don't import).
export async function saveColumns(
  viewerId: number,
  id: number,
  choices: Map<number, { field: string; kind: string }>,
): Promise<{ ok: true } | { error: MappingError } | { status: "not_found" | ImportStatus }> {
  const [r] = await sql<{ kind: ImportKind; status: ImportStatus; mapping: ColumnMapping | null }[]>`
    select kind, status, mapping from csv_imports where id = ${id} and user_id = ${viewerId}`;
  if (!r) return { status: "not_found" };
  if (r.status !== "ready" || !r.mapping) return { status: r.status };
  const custom = await importCustomFields(r.kind);
  const mapping: ColumnMapping = {
    columns: r.mapping.columns.map((c) => {
      const field = toField(r.kind, choices.get(c.index)?.field, custom);
      const base = { index: c.index, heading: c.heading, field };
      const customName = custom.find((f) => f.id === customFieldId(field))?.name;
      if (customName !== undefined) return { ...base, customName };
      return field === "email" || field === "phone" ? { ...base, kind: toKind(choices.get(c.index)?.kind) } : base;
    }),
  };
  const error = checkMapping(r.kind, mapping, custom);
  if (error) return { error };
  await sql`update csv_imports set mapping = ${sql.json(mapping)} where id = ${id} and user_id = ${viewerId} and status = 'ready'`;
  return { ok: true };
}

// The emails and organisation names a file names, to look up in one query each (research.md §6).
function wanted(kind: ImportKind, rows: CsvRow[], mapping: ColumnMapping) {
  const cells = (field: string) => mapping.columns.filter((c) => c.field === field).flatMap((c) => rows.map((r) => r.values[c.index] ?? ""));
  return {
    emails: [...new Set(cells("email").flatMap(splitMulti).map(normaliseEmail))],
    organisations: [...new Set(cells(kind === "people" ? "organisation" : "name").map(keyOf).filter((k) => k !== ""))],
  };
}

type Display = { leadSources: Map<number, string>; labels: Map<number, string>; users: Map<number, string> };

// `lock`: inside the import's transaction, the custom fields are read `for share` (a delete waits, or has already run).
async function loadLookups(db: Sql, importerId: number, kind: ImportKind, rows: CsvRow[], mapping: ColumnMapping, lock = false): Promise<{ lookups: Lookups; display: Display }> {
  const want = wanted(kind, rows, mapping);
  const lookups = emptyLookups(importerId);
  lookups.customFields = await importCustomFields(kind, db, lock);
  const emails = await db<{ email: string; person_id: number }[]>`
    select e.email, e.person_id::int as person_id from person_emails e where e.email = any(${want.emails}::text[])`;
  for (const e of emails) lookups.emails.set(e.email, { personId: e.person_id });
  const orgs = await db<{ id: number; name: string; archived: boolean }[]>`
    select id::int as id, name, archived_at is not null as archived from organisations where lower(name) = any(${want.organisations}::text[])`;
  for (const o of orgs) lookups.organisations.set(keyOf(o.name), o);
  const sources = await db<{ id: number; name: string }[]>`select id::int as id, name from lead_sources where removed_at is null`;
  for (const s of sources) lookups.leadSources.set(keyOf(s.name), s.id);
  const labels = await db<{ id: number; name: string }[]>`select id::int as id, name from labels where removed_at is null`;
  for (const l of labels) lookups.labels.set(keyOf(l.name), l.id);
  const users = await db<{ id: number; email: string; name: string }[]>`
    select id::int as id, email, name from users where status = 'active'`;
  lookups.users = users.map((u) => ({ id: u.id, email: keyOf(u.email), name: keyOf(u.name) }));
  const [importer] = await db<{ name: string }[]>`select name from users where id = ${importerId}`;
  return {
    lookups,
    display: {
      leadSources: new Map(sources.map((s) => [s.id, s.name])),
      labels: new Map(labels.map((l) => [l.id, l.name])),
      users: new Map([...users.map((u) => [u.id, u.name] as const), [importerId, importer?.name ?? ""]]),
    },
  };
}

type AnyPlan = { kind: "people"; plan: ImportPlan<PersonToAdd> } | { kind: "organisations"; plan: ImportPlan<OrganisationToAdd> };

function makePlan(kind: ImportKind, rows: CsvRow[], mapping: ColumnMapping, lookups: Lookups): AnyPlan {
  return kind === "people"
    ? { kind, plan: planPeople(rows, mapping, lookups) }
    : { kind, plan: planOrganisations(rows, mapping, lookups) };
}

// The first records as they will be saved, as text cells (the page shows them as text only).
export type Sample = { columns: string[]; rows: string[][] };
const SAMPLE_SIZE = 5;

// SF-115: the mapped custom fields still there, in the mapping's column order.
function mappedCustom(mapping: ColumnMapping, fields: CustomField[]): CustomField[] {
  return mapping.columns.flatMap((c) => fields.filter((f) => f.id === customFieldId(c.field)));
}

function sampleOf(p: AnyPlan, display: Display, lookups: Lookups, mapping: ColumnMapping): Sample {
  const custom = mappedCustom(mapping, lookups.customFields);
  const customCells = (values: { fieldId: number; value: CustomValue }[]) =>
    custom.map((f) => formatValue(f, values.find((v) => v.fieldId === f.id)?.value ?? null));
  const sample = withCustom(p, display, lookups);
  return {
    columns: [...sample.columns, ...custom.map((f) => f.name)],
    rows: sample.rows.map((row, i) => [...row, ...customCells(p.plan.adds[i].custom)]),
  };
}

function withCustom(p: AnyPlan, display: Display, lookups: Lookups): Sample {
  if (p.kind === "organisations") {
    return {
      columns: ["Name", "Website", "Sector", "Size", "Location", "Owner"],
      rows: p.plan.adds.slice(0, SAMPLE_SIZE).map((a) => [
        a.fields.name, a.fields.website ?? "—", a.fields.sector ?? "—", a.fields.size ?? "—", a.fields.location ?? "—",
        display.users.get(a.fields.ownerId) ?? "",
      ]),
    };
  }
  const orgName = new Map<number, string>([...lookups.organisations.values()].map((o) => [o.id, o.name]));
  const newName = new Map(p.plan.newOrganisations.map((o) => [o.key, o.name]));
  return {
    columns: ["Name", "Email", "Phone", "Organisation", "Role", "Lead source", "Labels", "Owner", "Consent"],
    rows: p.plan.adds.slice(0, SAMPLE_SIZE).map((a) => [
      `${a.fields.firstName} ${a.fields.lastName}`.trim(),
      a.fields.emails.map((e) => e.email).join(", ") || "—",
      a.fields.phones.map((ph) => ph.phone).join(", ") || "—",
      a.organisation === null ? "—" : "id" in a.organisation ? (orgName.get(a.organisation.id) ?? "") : (newName.get(a.organisation.newKey) ?? ""),
      a.fields.role ?? "—",
      a.leadSourceId === null ? "—" : (display.leadSources.get(a.leadSourceId) ?? ""),
      a.labelIds.map((id) => display.labels.get(id) ?? "").join(", ") || "—",
      display.users.get(a.ownerId) ?? "",
      a.consent === "subscribed" ? "Subscribed" : a.consent === "unsubscribed" ? "Unsubscribed" : "—",
    ]),
  };
}

export type Preview = {
  kind: ImportKind;
  adds: number;
  newOrganisations: string[];
  skipped: Skip[];
  warnings: ImportReport["warnings"];
  withoutEmail: number;
  needsConsent: number;
  sample: Sample;
  names: Names;
};

export async function previewImport(viewerId: number, id: number): Promise<Preview | { status: "not_found" | ImportStatus }> {
  const r = await loadReady(sql, viewerId, id, false);
  if (!r) return { status: "not_found" };
  if (r.status !== "ready") return { status: r.status };
  const { lookups, display } = await loadLookups(sql, viewerId, r.kind, r.rows, r.mapping);
  const p = makePlan(r.kind, r.rows, r.mapping, lookups);
  return {
    kind: r.kind,
    adds: p.plan.adds.length,
    newOrganisations: p.plan.newOrganisations.map((o) => o.name),
    skipped: p.plan.skipped,
    warnings: p.plan.warnings,
    withoutEmail: p.plan.withoutEmail,
    needsConsent: p.plan.needsConsent,
    sample: sampleOf(p, display, lookups, r.mapping),
    names: await namesForReport(viewerId, p.plan.skipped),
  };
}

// Names of the existing records a plan or report refers to: a person only when the viewer can see them (SC-007).
export async function namesForReport(viewerId: number, skipped: Skip[]): Promise<Names> {
  const personIds = skipped.flatMap((s) => (s.personId === undefined ? [] : [s.personId]));
  const orgIds = skipped.flatMap((s) => (s.organisationId === undefined ? [] : [s.organisationId]));
  const people = personIds.length === 0 ? [] : await sql<{ id: number; name: string }[]>`
    select p.id::int as id, btrim(p.first_name || ' ' || p.last_name) as name from persons p
    where p.id = any(${personIds}::bigint[]) and ${visiblePerson(sql, viewerId)}`;
  const orgs = orgIds.length === 0 ? [] : await sql<{ id: number; name: string }[]>`
    select id::int as id, name from organisations where id = any(${orgIds}::bigint[])`;
  return { people: new Map(people.map((p) => [p.id, p.name])), organisations: new Map(orgs.map((o) => [o.id, o.name])) };
}

type EventRow = { personId: number | null; organisationId: number | null; kind: "imported" | "person_linked"; relatedPersonId: number | null };

async function insertEvents(db: Sql, actorId: number, events: EventRow[]) {
  await inChunks(events, (c) => db`
    insert into timeline_events (person_id, organisation_id, kind, actor_id, related_person_id)
    select * from unnest(${col(c, (e) => e.personId)}::bigint[], ${col(c, (e) => e.organisationId)}::bigint[], ${col(c, (e) => e.kind)}::text[],
                         ${col(c, () => actorId)}::bigint[], ${col(c, (e) => e.relatedPersonId)}::bigint[])`);
}

async function insertNewOrganisations(db: Sql, actorId: number, names: { key: string; name: string }[]): Promise<Map<string, number>> {
  const ids = await newIds(db, "organisations", names.length);
  const rows = names.map((o, i) => ({ id: ids[i], name: o.name.trim() }));
  await inChunks(rows, (c) => db`
    insert into organisations (id, name, owner_id, created_by) overriding system value
    select * from unnest(${col(c, (o) => o.id)}::bigint[], ${col(c, (o) => o.name)}::text[], ${col(c, () => actorId)}::bigint[], ${col(c, () => actorId)}::bigint[])`);
  return new Map(names.map((o, i) => [o.key, ids[i]]));
}

async function importPeople(db: Sql, actorId: number, plan: ImportPlan<PersonToAdd>, consent: Consent | null, fields: CustomField[]): Promise<EventRow[]> {
  const orgIds = await insertNewOrganisations(db, actorId, plan.newOrganisations);
  const ids = await newIds(db, "persons", plan.adds.length);
  const people = plan.adds.map((a, i) => ({
    ...a,
    id: ids[i],
    organisationId: a.organisation === null ? null : "id" in a.organisation ? a.organisation.id : orgIds.get(a.organisation.newKey)!,
    consent: a.consent ?? consent!,
  }));
  await inChunks(people, (c) => db`
    insert into persons (id, first_name, last_name, organisation_id, role, lead_source_id, linkedin_url, owner_id, consent, private, created_by)
    overriding system value
    select id, first_name, last_name, organisation_id, role, lead_source_id, linkedin_url, owner_id, consent, false, ${actorId}
    from unnest(${col(c, (p) => p.id)}::bigint[], ${col(c, (p) => p.fields.firstName)}::text[], ${col(c, (p) => p.fields.lastName)}::text[],
                ${col(c, (p) => p.organisationId)}::bigint[], ${col(c, (p) => p.fields.role)}::text[], ${col(c, (p) => p.leadSourceId)}::bigint[],
                ${col(c, (p) => p.fields.linkedin)}::text[], ${col(c, (p) => p.ownerId)}::bigint[], ${col(c, (p) => p.consent)}::text[])
         as t(id, first_name, last_name, organisation_id, role, lead_source_id, linkedin_url, owner_id, consent)`);
  const emails = people.flatMap((p) => p.fields.emails.map((e, position) => ({ personId: p.id, value: e.email, kind: e.kind, position })));
  const phones = people.flatMap((p) => p.fields.phones.map((e, position) => ({ personId: p.id, value: e.phone, kind: e.kind, position })));
  for (const [table, column, list] of [["person_emails", "email", emails], ["person_phones", "phone", phones]] as const) {
    await inChunks([...list], (c) => db`
      insert into ${db(table)} (person_id, ${db(column)}, kind, position)
      select * from unnest(${col(c, (e) => e.personId)}::bigint[], ${col(c, (e) => e.value)}::text[], ${col(c, (e) => e.kind)}::text[],
                           ${col(c, (e) => e.position)}::int[])`);
  }
  const labels = people.flatMap((p) => p.labelIds.map((labelId) => ({ personId: p.id, labelId })));
  await inChunks(labels, (c) => db`
    insert into person_labels (person_id, label_id)
    select * from unnest(${col(c, (l) => l.personId)}::bigint[], ${col(c, (l) => l.labelId)}::bigint[])`);
  await insertCustomValues(db, "people", fields, people);
  return [
    ...[...orgIds.values()].map((id) => ({ personId: null, organisationId: id, kind: "imported" as const, relatedPersonId: null })),
    ...people.map((p) => ({ personId: p.id, organisationId: null, kind: "imported" as const, relatedPersonId: null })),
    ...people.flatMap((p) =>
      p.organisationId === null ? [] : [{ personId: null, organisationId: p.organisationId, kind: "person_linked" as const, relatedPersonId: p.id }],
    ),
  ];
}

async function importOrganisations(db: Sql, actorId: number, plan: ImportPlan<OrganisationToAdd>, fields: CustomField[]): Promise<EventRow[]> {
  const ids = await newIds(db, "organisations", plan.adds.length);
  const orgs = plan.adds.map((a, i) => ({ id: ids[i], ...a.fields }));
  await inChunks(orgs, (c) => db`
    insert into organisations (id, name, website, sector, size, location, owner_id, created_by) overriding system value
    select id, name, website, sector, size, location, owner_id, ${actorId}
    from unnest(${col(c, (o) => o.id)}::bigint[], ${col(c, (o) => o.name)}::text[], ${col(c, (o) => o.website)}::text[],
                ${col(c, (o) => o.sector)}::text[], ${col(c, (o) => o.size)}::text[], ${col(c, (o) => o.location)}::text[],
                ${col(c, (o) => o.ownerId)}::bigint[])
         as t(id, name, website, sector, size, location, owner_id)`);
  await insertCustomValues(db, "organisations", fields, plan.adds.map((a, i) => ({ id: ids[i], custom: a.custom })));
  return ids.map((id) => ({ personId: null, organisationId: id, kind: "imported" as const, relatedPersonId: null }));
}

export type RunResult = { status: "done" } | { status: "not_found" } | { status: "consent_required" };

// The import (research.md §8): all or nothing, at most once per upload. Another user's add waits for it (table lock)
// instead of racing it; the plan is made again inside, so the report says what really happened.
export async function runImport(viewerId: number, id: number, consentChoice: string | null): Promise<RunResult> {
  const consent = (CONSENTS as readonly (string | null)[]).includes(consentChoice) ? (consentChoice as Consent) : null;
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const r = await loadReady(db, viewerId, id, true);
    if (!r) return { status: "not_found" as const };
    if (r.status === "done") return { status: "done" as const };
    if (r.status !== "ready") return { status: "not_found" as const };
    if (r.kind === "people") await db`lock table organisations, person_emails in share row exclusive mode`;
    else await db`lock table organisations in share row exclusive mode`;
    const { lookups } = await loadLookups(db, viewerId, r.kind, r.rows, r.mapping, true);
    const p = makePlan(r.kind, r.rows, r.mapping, lookups);
    if (p.kind === "people" && p.plan.needsConsent > 0 && consent === null) return { status: "consent_required" as const };
    const fields = lookups.customFields;
    const events = p.kind === "people" ? await importPeople(db, viewerId, p.plan, consent, fields) : await importOrganisations(db, viewerId, p.plan, fields);
    // SF-115 US5 scenario 5: a mapped custom field deleted since the columns step is not used, and the report says so.
    const goneFields = r.mapping.columns.flatMap((c) => {
      const fieldId = customFieldId(c.field);
      return fieldId !== null && !fields.some((f) => f.id === fieldId) ? [c.customName ?? ""] : [];
    });
    await insertEvents(db, viewerId, events);
    const report: ImportReport = {
      imported: p.plan.adds.length,
      organisationsAdded: p.plan.newOrganisations.length,
      organisationsAddedNames: p.plan.newOrganisations.map((o) => o.name),
      skipped: p.plan.skipped,
      warnings: p.plan.warnings,
      ...(goneFields.length > 0 ? { goneFields } : {}),
    };
    await db`
      update csv_imports set status = 'done', content = null, report = ${db.json(report)}, imported_at = now()
      where id = ${id} and user_id = ${viewerId}`;
    return { status: "done" as const };
  });
}
