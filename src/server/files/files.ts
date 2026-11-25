// Files on deals, people and organisations (SF-116 data-model.md § State changes, contracts/routes.md § Domain
// functions, research.md §2, §6–§8). Every `files` read uses visibleFile(); every change is one transaction that
// re-checks the record (visible, not archived), and no Storage call is ever made inside a transaction. Contents that
// must leave Storage go through `file_cleanup`, swept after every upload start, finish and delete (no cron).
import { sql, type Sql } from "@/server/db";
import { fileKind, MAX_FILE_BYTES, uploadContentType, validateFile, type FileKind, type FileRefusal } from "@/server/files/rules";
import {
  createSignedUploadUrl, newStoragePath, objectInfo, readHead, removeObjects, StorageUnreachable,
} from "@/server/files/storage";
import { parseId } from "@/server/records/list-query";
import { recordEvent, type Target } from "@/server/records/timeline";
import { visibleDeal, visibleFile, visiblePerson } from "@/server/records/visibility";

export type FileTarget = Target;
export type FileRow = {
  id: number; name: string; kind: FileKind; size: number; addedByName: string; addedByActive: boolean; addedAt: Date;
};
export type StoredFile = FileRow & { storagePath: string };

export type StartResult =
  | { status: "ok"; uploadId: number; url: string; contentType: string }
  | { status: FileRefusal | "file_record_not_found" | "files_archived" | "files_unreachable" };
export type FinishResult = { status: "ok"; id: number } | { status: "file_upload_failed" | "file_record_not_found" | "files_archived" | "files_unreachable" };
export type DeleteFileResult = { status: "ok" | "file_gone" | "file_record_not_found" | "files_archived" };
export type FileAccess = { status: "ok"; file: StoredFile } | { status: "gone" } | { status: "hidden" };

const UPLOAD_HOURS = 2;
const SWEEP_BATCH = 50;

const columns = (t: FileTarget) => ({
  dealId: "dealId" in t ? t.dealId : null,
  personId: "personId" in t ? t.personId : null,
  organisationId: "organisationId" in t ? t.organisationId : null,
});

// The file's (or pending upload's) record column equals the target.
function onRecord(db: Sql, t: FileTarget, alias = "f") {
  const a = db(alias);
  if ("dealId" in t) return db`${a}.deal_id = ${t.dealId}`;
  if ("personId" in t) return db`${a}.person_id = ${t.personId}`;
  return db`${a}.organisation_id = ${t.organisationId}`;
}

// The record when the actor can see it: { archived } or null; `lock` takes its row `for update`.
async function readRecord(db: Sql, actorId: number, t: FileTarget, lock: boolean): Promise<{ archived: boolean } | null> {
  const forUpdate = lock ? db`for update` : db``;
  const [row] =
    "dealId" in t
      ? await db<{ archived: boolean }[]>`
          select d.archived_at is not null as archived from deals d where d.id = ${t.dealId} and ${visibleDeal(db, actorId)} ${forUpdate}`
      : "personId" in t
        ? await db<{ archived: boolean }[]>`
            select p.archived_at is not null as archived from persons p where p.id = ${t.personId} and ${visiblePerson(db, actorId)} ${forUpdate}`
        : await db<{ archived: boolean }[]>`
            select o.archived_at is not null as archived from organisations o where o.id = ${t.organisationId} ${forUpdate}`;
  return row ?? null;
}

const fileFields = (db: Sql) => db`
  f.id::int as id, f.name, f.kind, f.size::float8 as size, u.name as "addedByName", u.status = 'active' as "addedByActive",
  f.added_at as "addedAt"`;

// The record's own files the viewer can see, newest first (FR-003).
export async function listFiles(viewerId: number, target: FileTarget): Promise<FileRow[]> {
  return sql<FileRow[]>`
    select ${fileFields(sql)} from files f join users u on u.id = f.added_by
    where ${onRecord(sql, target)} and ${visibleFile(sql, viewerId)}
    order by f.added_at desc, f.id desc`;
}

// A file of this record the viewer can see, from an address parameter (the preview box, the delete confirmation).
export async function pageFile(viewerId: number, idParam: string | undefined, target: FileTarget): Promise<FileRow | null> {
  const id = parseId(idParam);
  if (id === null) return null;
  const [row] = await sql<FileRow[]>`
    select ${fileFields(sql)} from files f join users u on u.id = f.added_by
    where f.id = ${id} and ${onRecord(sql, target)} and ${visibleFile(sql, viewerId)}`;
  return row ?? null;
}

// What /files/<id>/download|preview may give the viewer (contracts/routes.md § Routes): the file; "gone" when it was
// deleted from a record the viewer can see; else "hidden" (never existed, hidden record, record deleted for good).
export async function fileAccess(viewerId: number, id: number | null): Promise<FileAccess> {
  if (id === null) return { status: "hidden" };
  const [file] = await sql<StoredFile[]>`
    select ${fileFields(sql)}, f.storage_path as "storagePath" from files f join users u on u.id = f.added_by
    where f.id = ${id} and ${visibleFile(sql, viewerId)}`;
  if (file) return { status: "ok", file };
  const [gone] = await sql`
    select 1 from timeline_events e
    where e.kind = 'file_deleted' and e.deleted_file_id = ${id}
      and (e.deal_id is null or exists (select 1 from deals d where d.id = e.deal_id and ${visibleDeal(sql, viewerId)}))
      and (e.person_id is null or exists (select 1 from persons p where p.id = e.person_id and ${visiblePerson(sql, viewerId)}))
    limit 1`;
  return gone ? { status: "gone" } : { status: "hidden" };
}

// Step 1 of an upload: the checks, a pending row with a fresh random path, and a write-only address for that path.
export async function startFileUpload(actorId: number, target: FileTarget, file: { name: string; size: number }): Promise<StartResult> {
  const valid = validateFile(file);
  if (!valid.ok) return { status: valid.code };
  const record = await readRecord(sql, actorId, target, false);
  if (!record) return { status: "file_record_not_found" };
  if (record.archived) return { status: "files_archived" };
  const path = newStoragePath();
  const contentType = uploadContentType(file.name);
  const c = columns(target);
  const [row] = await sql<{ id: number }[]>`
    insert into file_uploads (deal_id, person_id, organisation_id, name, size, content_type, storage_path, user_id)
    values (${c.dealId}, ${c.personId}, ${c.organisationId}, ${file.name}, ${file.size}, ${contentType}, ${path}, ${actorId})
    returning id::int as id`;
  let url: string;
  try {
    ({ url } = await createSignedUploadUrl(path));
  } catch (e) {
    await sql`delete from file_uploads where id = ${row.id}`;
    if (e instanceof StorageUnreachable) return { status: "files_unreachable" };
    throw e;
  }
  await sweepFileCleanup();
  return { status: "ok", uploadId: row.id, url, contentType };
}

// Moves a pending upload's path to the clean-up list (its contents, if any, must go).
async function dropUpload(db: Sql, uploadId: number) {
  await db`
    with gone as (delete from file_uploads where id = ${uploadId} returning storage_path)
    insert into file_cleanup (storage_path) select storage_path from gone on conflict do nothing`;
}

// Step 2: reads the stored object back (size, type, first bytes) and only then lists the file (FR-002).
export async function finishFileUpload(actorId: number, uploadId: number): Promise<FinishResult> {
  const [up] = await sql<
    { id: number; name: string; size: number; storage_path: string; deal_id: number | null; person_id: number | null;
      organisation_id: number | null; fresh: boolean }[]
  >`
    select id::int as id, name, size::float8 as size, storage_path, deal_id::int as deal_id, person_id::int as person_id,
           organisation_id::int as organisation_id, created_at > now() - make_interval(hours => ${UPLOAD_HOURS}) as fresh
    from file_uploads where id = ${uploadId} and user_id = ${actorId}`;
  if (!up) return { status: "file_upload_failed" };
  if (!up.fresh) {
    await dropUpload(sql, up.id);
    return { status: "file_upload_failed" };
  }
  let info: { size: number; contentType: string } | null;
  let head: Uint8Array;
  try {
    info = await objectInfo(up.storage_path);
    head = info ? await readHead(up.storage_path, 16) : new Uint8Array();
  } catch (e) {
    if (e instanceof StorageUnreachable) return { status: "files_unreachable" };
    throw e;
  }
  if (!info || info.size !== up.size || info.size > MAX_FILE_BYTES) {
    await dropUpload(sql, up.id);
    await sweepFileCleanup();
    return { status: "file_upload_failed" };
  }
  const target: FileTarget =
    up.deal_id !== null ? { dealId: up.deal_id } : up.person_id !== null ? { personId: up.person_id } : { organisationId: up.organisation_id! };
  const kind = fileKind({ head, name: up.name, storedType: info.contentType });
  const result = await sql.begin(async (tx): Promise<FinishResult> => {
    const db = tx as unknown as Sql;
    const record = await readRecord(db, actorId, target, true);
    // The pending row is claimed here: a second finish of the same upload finds nothing.
    const [claimed] = await db`delete from file_uploads where id = ${up.id} returning id`;
    if (!claimed) return { status: "file_upload_failed" };
    if (!record || record.archived) {
      await db`insert into file_cleanup (storage_path) values (${up.storage_path}) on conflict do nothing`;
      return { status: record ? "files_archived" : "file_record_not_found" };
    }
    const id = await insertFile(db, actorId, target, { name: up.name, size: info.size, kind, path: up.storage_path });
    return { status: "ok", id };
  });
  await sweepFileCleanup();
  return result;
}

// Lists a stored file: its row and its "added" FILE entry (in the caller's transaction). Also used by the fake data and
// the Pipedrive import (SF-122), which passes Pipedrive's upload date as `addedAt` for both the row and the entry.
export async function insertFile(
  db: Sql, actorId: number, target: FileTarget, f: { name: string; size: number; kind: FileKind; path: string; addedAt?: Date },
): Promise<number> {
  const c = columns(target);
  const [row] = await db<{ id: number }[]>`
    insert into files (deal_id, person_id, organisation_id, name, size, kind, storage_path, added_by, added_at)
    values (${c.dealId}, ${c.personId}, ${c.organisationId}, ${f.name}, ${f.size}, ${f.kind}, ${f.path}, ${actorId},
            coalesce(${f.addedAt ?? null}::timestamptz, now()))
    returning id::int as id`;
  await recordEvent(db, { ...target, kind: "file_added", actorId, fileId: row.id, fileName: f.name, fileSize: f.size, createdAt: f.addedAt });
  return row.id;
}

// Deletes a file of the record (FR-006): the row and a FILE entry at once; the contents right after, or later.
export async function deleteFile(actorId: number, target: FileTarget, fileId: number): Promise<DeleteFileResult> {
  const result = await sql.begin(async (tx): Promise<DeleteFileResult & { path?: string }> => {
    const db = tx as unknown as Sql;
    const record = await readRecord(db, actorId, target, true);
    if (!record) return { status: "file_record_not_found" };
    if (record.archived) return { status: "files_archived" };
    const [row] = await db<{ storage_path: string; name: string }[]>`
      delete from files f where f.id = ${fileId} and ${onRecord(db, target)} returning f.storage_path, f.name`;
    if (!row) return { status: "file_gone" };
    await db`insert into file_cleanup (storage_path) values (${row.storage_path}) on conflict do nothing`;
    await recordEvent(db, { ...target, kind: "file_deleted", actorId, fileName: row.name, deletedFileId: fileId });
    return { status: "ok", path: row.storage_path };
  });
  if (result.path) {
    try {
      await removeObjects([result.path]);
      await sql`delete from file_cleanup where storage_path = ${result.path}`;
    } catch {
      // Left in file_cleanup: a later sweep removes it.
    }
    await sweepFileCleanup();
  }
  return { status: result.status };
}

// Used inside the transactions that delete a deal, person or organisation for good (FR-012): queue the contents of
// its files and pending uploads before the rows go by cascade.
export async function cleanupPathsFor(db: Sql, target: FileTarget): Promise<void> {
  await db`
    insert into file_cleanup (storage_path)
    select f.storage_path from files f where ${onRecord(db, target)}
    union all
    select u.storage_path from file_uploads u where ${onRecord(db, target, "u")}
    on conflict do nothing`;
}

// research.md §8: pending uploads older than 2 hours join the list; up to 50 due paths are claimed (pushed 10 minutes
// ahead, committed), then removed from Storage: done rows go, failed ones count an attempt. Never throws.
export async function sweepFileCleanup(): Promise<void> {
  try {
    await sql`
      with old as (delete from file_uploads where created_at < now() - make_interval(hours => ${UPLOAD_HOURS}) returning storage_path)
      insert into file_cleanup (storage_path) select storage_path from old on conflict do nothing`;
    const claimed = await sql<{ storage_path: string }[]>`
      update file_cleanup set due_at = now() + interval '10 minutes'
      where storage_path in (select storage_path from file_cleanup where due_at <= now() order by due_at limit ${SWEEP_BATCH} for update skip locked)
      returning storage_path`;
    if (claimed.length === 0) return;
    const paths = claimed.map((r) => r.storage_path);
    try {
      await removeObjects(paths);
      await sql`delete from file_cleanup where storage_path in ${sql(paths)}`;
    } catch {
      await sql`update file_cleanup set attempts = attempts + 1 where storage_path in ${sql(paths)}`;
    }
  } catch {
    // The sweep never fails the call that ran it.
  }
}
