// covers SF-116 FR-001, FR-002, US1 scenarios 1–6, SC-002, SC-005, edge cases "two users upload at the same moment",
// "storage unreachable" (T016)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { finishFileUpload, listFiles, startFileUpload, type FileTarget } from "@/server/files/files";
import { signedUrl } from "@/server/files/storage";
import { StorageFake } from "../fakes/storage";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { DOCX, PDF, PNG, sized, TEXT, uploadFile } from "./file-helpers";

const fake = new StorageFake();
let ada: TestUser, bob: TestUser;
let dealId: number, personId: number, orgId: number;
const deal = (): FileTarget => ({ dealId });

beforeAll(() => void fake.install());
afterAll(async () => {
  fake.uninstall();
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  fake.down(false);
  fake.failDeletes(false);
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Linus Fake" });
  const p = await makePipeline("Sales", ["Lead in"]);
  orgId = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  personId = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
  dealId = await makeDeal({ title: "Fakeco website", stageId: p.stages[0], createdBy: ada.id });
});

const pending = async () => (await sql`select count(*)::int as n from file_uploads`)[0].n as number;
const queued = async () => (await sql`select storage_path from file_cleanup`).map((r) => r.storage_path as string);

describe("uploading", () => {
  it("lists a 2.1 MB PDF on a deal, a PNG on a person and an .xlsx on an organisation with name, size, kind, uploader, date (US1-1)", async () => {
    const pdf = sized(PDF, Math.round(2.1 * 1024 * 1024));
    await uploadFile(fake, ada.id, deal(), "proposal.pdf", pdf);
    await uploadFile(fake, ada.id, { personId }, "photo.png", PNG);
    await uploadFile(fake, bob.id, { organisationId: orgId }, "budget.xlsx", DOCX);
    const [d] = await listFiles(bob.id, deal());
    expect(d).toMatchObject({ name: "proposal.pdf", size: pdf.length, kind: "pdf", addedByName: "Ada Fake", addedByActive: true });
    expect(Date.now() - d.addedAt.getTime()).toBeLessThan(60_000);
    expect((await listFiles(ada.id, { personId }))[0]).toMatchObject({ name: "photo.png", kind: "png", size: PNG.length });
    expect((await listFiles(ada.id, { organisationId: orgId }))[0]).toMatchObject({ name: "budget.xlsx", kind: "other", addedByName: "Linus Fake" });
    // Each record lists only its own files.
    expect((await listFiles(ada.id, deal())).map((f) => f.name)).toEqual(["proposal.pdf"]);
    expect(await pending()).toBe(0);
  });

  it("lists newest first and keeps two files with the same name (US1-6, US1-2)", async () => {
    const a = await uploadFile(fake, ada.id, deal(), "proposal.pdf", PDF);
    const b = await uploadFile(fake, ada.id, deal(), "notes.txt", TEXT);
    const c = await uploadFile(fake, bob.id, deal(), "proposal.pdf", PDF);
    expect((await listFiles(ada.id, deal())).map((f) => f.id)).toEqual([c, b, a]);
  });

  it("refuses empty, over 25 MB and 256-character names with no pending row; exactly 25 MB is accepted (US1-3, US1-4)", async () => {
    const calls = fake.requests.length;
    expect(await startFileUpload(ada.id, deal(), { name: "empty.txt", size: 0 })).toEqual({ status: "file_empty" });
    expect(await startFileUpload(ada.id, deal(), { name: "big.zip", size: 26_214_401 })).toEqual({ status: "file_too_large" });
    expect(await startFileUpload(ada.id, deal(), { name: `${"a".repeat(252)}.pdf`, size: 5 })).toEqual({ status: "file_name_too_long" });
    expect(await pending()).toBe(0);
    expect(fake.requests.length).toBe(calls);
    const id = await uploadFile(fake, ada.id, deal(), "exact.bin", sized(DOCX, 26_214_400));
    expect((await listFiles(ada.id, deal()))[0]).toMatchObject({ id, size: 26_214_400 });
  });

  it("lists nothing when the PUT never happened; the path goes to the clean-up list (US1-5, SC-005)", async () => {
    fake.failDeletes();
    const start = await startFileUpload(ada.id, deal(), { name: "lost.pdf", size: PDF.length });
    if (start.status !== "ok") throw new Error(start.status);
    expect(await finishFileUpload(ada.id, start.uploadId)).toEqual({ status: "file_upload_failed" });
    expect(await listFiles(ada.id, deal())).toEqual([]);
    expect(await pending()).toBe(0);
    expect(await queued()).toHaveLength(1);
  });

  it("refuses a stored size other than the declared one, another user's upload, and a finish after 2 hours", async () => {
    const s1 = await startFileUpload(ada.id, deal(), { name: "a.pdf", size: 100 });
    if (s1.status !== "ok") throw new Error(s1.status);
    await fake.fetch(s1.url, { method: "PUT", headers: { "content-type": s1.contentType }, body: PDF });
    expect(await finishFileUpload(ada.id, s1.uploadId)).toEqual({ status: "file_upload_failed" });

    const s2 = await startFileUpload(ada.id, deal(), { name: "b.pdf", size: PDF.length });
    if (s2.status !== "ok") throw new Error(s2.status);
    await fake.fetch(s2.url, { method: "PUT", headers: { "content-type": s2.contentType }, body: PDF });
    expect(await finishFileUpload(bob.id, s2.uploadId)).toEqual({ status: "file_upload_failed" });
    await sql`update file_uploads set created_at = now() - interval '2 hours 1 minute' where id = ${s2.uploadId}`;
    expect(await finishFileUpload(ada.id, s2.uploadId)).toEqual({ status: "file_upload_failed" });
    expect(await listFiles(ada.id, deal())).toEqual([]);
    expect(await pending()).toBe(0);
  });

  it("answers a second finish of the same upload as failed, listing the file once", async () => {
    const s = await startFileUpload(ada.id, deal(), { name: "a.pdf", size: PDF.length });
    if (s.status !== "ok") throw new Error(s.status);
    await fake.fetch(s.url, { method: "PUT", headers: { "content-type": s.contentType }, body: PDF });
    expect((await finishFileUpload(ada.id, s.uploadId)).status).toBe("ok");
    expect(await finishFileUpload(ada.id, s.uploadId)).toEqual({ status: "file_upload_failed" });
    expect(await listFiles(ada.id, deal())).toHaveLength(1);
  });

  it("refuses an archived record, and a record archived between start and finish (path queued)", async () => {
    const p = await makePipeline("Old", ["S"]);
    const archived = await makeDeal({ title: "Old", stageId: p.stages[0], createdBy: ada.id, archived: true });
    expect(await startFileUpload(ada.id, { dealId: archived }, { name: "a.pdf", size: 5 })).toEqual({ status: "files_archived" });
    fake.failDeletes();
    const s = await startFileUpload(ada.id, deal(), { name: "a.pdf", size: PDF.length });
    if (s.status !== "ok") throw new Error(s.status);
    await fake.fetch(s.url, { method: "PUT", headers: { "content-type": s.contentType }, body: PDF });
    await sql`update deals set archived_at = now() where id = ${dealId}`;
    expect(await finishFileUpload(ada.id, s.uploadId)).toEqual({ status: "files_archived" });
    expect(await listFiles(ada.id, deal())).toEqual([]);
    expect(await queued()).toHaveLength(1);
  });

  it("answers files_unreachable when Storage is down at start or finish; nothing listed (edge case)", async () => {
    fake.down();
    expect(await startFileUpload(ada.id, deal(), { name: "a.pdf", size: 5 })).toEqual({ status: "files_unreachable" });
    expect(await pending()).toBe(0);
    fake.down(false);
    const s = await startFileUpload(ada.id, deal(), { name: "a.pdf", size: PDF.length });
    if (s.status !== "ok") throw new Error(s.status);
    await fake.fetch(s.url, { method: "PUT", headers: { "content-type": s.contentType }, body: PDF });
    fake.down();
    expect(await finishFileUpload(ada.id, s.uploadId)).toEqual({ status: "files_unreachable" });
    expect(await listFiles(ada.id, deal())).toEqual([]);
    // Storage is back: the same upload can be finished.
    fake.down(false);
    expect((await finishFileUpload(ada.id, s.uploadId)).status).toBe("ok");
  });

  it("gives back byte for byte what was uploaded (SC-002)", async () => {
    const bytes = sized(PDF, 3 * 1024 * 1024 + 17);
    await uploadFile(fake, ada.id, deal(), "big.pdf", bytes);
    const [{ storage_path }] = await sql`select storage_path from files`;
    const res = await fake.fetch(await signedUrl(storage_path as string, { download: "big.pdf" }));
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), Buffer.from(bytes))).toBe(0);
  });

  it("lists both files when two users upload to one record at the same moment (edge case)", async () => {
    await Promise.all([
      uploadFile(fake, ada.id, deal(), "a.pdf", PDF),
      uploadFile(fake, bob.id, deal(), "b.png", PNG),
    ]);
    expect((await listFiles(ada.id, deal())).map((f) => f.name).sort()).toEqual(["a.pdf", "b.png"]);
  });

  it("decides the kind from bytes, name and stored type: a text file named fake.png is other (edge case)", async () => {
    await uploadFile(fake, ada.id, deal(), "fake.png", TEXT);
    await uploadFile(fake, ada.id, deal(), "real.png", PNG, "application/octet-stream");
    expect((await listFiles(ada.id, deal())).map((f) => f.kind)).toEqual(["other", "other"]);
  });
});
