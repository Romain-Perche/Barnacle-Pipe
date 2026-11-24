// covers SF-116 FR-006, FR-011, FR-012, US5 scenarios 1–2, edge cases "archived record", "won or lost deal", "record
// deleted for good", "storage delete fails", "two users delete at once", "deactivated uploader" (T035)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deleteDeal } from "@/server/deals/deals";
import { deleteFile, fileAccess, listFiles, startFileUpload, sweepFileCleanup, type FileTarget } from "@/server/files/files";
import { deleteOrganisation } from "@/server/records/organisations";
import { deletePerson } from "@/server/records/people";
import { StorageFake } from "../fakes/storage";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { PDF, PNG, uploadFile } from "./file-helpers";

const fake = new StorageFake();
let ada: TestUser, bob: TestUser, grace: TestUser;
let orgId: number, personId: number, dealId: number, stageId: number;

beforeAll(() => void fake.install());
afterAll(async () => {
  fake.uninstall();
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  fake.failDeletes(false);
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Linus Fake" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  const p = await makePipeline("Sales", ["Lead in"]);
  stageId = p.stages[0];
  orgId = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  personId = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
  dealId = await makeDeal({ title: "Fakeco website", stageId, createdBy: ada.id, organisationId: orgId, personId });
});

const pathOf = async (id: number) => (await sql`select storage_path from files where id = ${id}`)[0].storage_path as string;
const stored = (path: string) => fake.objects().has(`crm-files/${path}`);
const queued = async () => (await sql`select storage_path from file_cleanup`).map((r) => r.storage_path as string);

describe("deleteFile", () => {
  it("removes the row and the contents; the address answers gone; anyone who sees the record may delete (US5-1)", async () => {
    const id = await uploadFile(fake, ada.id, { personId }, "old.pdf", PDF);
    const path = await pathOf(id);
    expect(stored(path)).toBe(true);
    expect(await deleteFile(bob.id, { personId }, id)).toEqual({ status: "ok" });
    expect(await listFiles(ada.id, { personId })).toEqual([]);
    expect(stored(path)).toBe(false);
    expect(await queued()).toEqual([]);
    expect(await fileAccess(ada.id, id)).toEqual({ status: "gone" });
  });

  it("still deletes when Storage refuses; the next sweep removes the contents (edge case)", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "a.pdf", PDF);
    const path = await pathOf(id);
    fake.failDeletes();
    expect(await deleteFile(ada.id, { dealId }, id)).toEqual({ status: "ok" });
    expect(await listFiles(ada.id, { dealId })).toEqual([]);
    expect(await fileAccess(ada.id, id)).toEqual({ status: "gone" });
    expect(await queued()).toEqual([path]);
    expect(stored(path)).toBe(true);
    fake.failDeletes(false);
    await sql`update file_cleanup set due_at = now()`;
    await sweepFileCleanup();
    expect(await queued()).toEqual([]);
    expect(stored(path)).toBe(false);
  });

  it("deletes once when two users delete at the same moment: one ok, one gone, one event (edge case, US5-2)", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "a.pdf", PDF);
    const results = await Promise.all([deleteFile(ada.id, { dealId }, id), deleteFile(bob.id, { dealId }, id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["file_gone", "ok"]);
    const [{ n }] = await sql`select count(*)::int as n from timeline_events where kind = 'file_deleted'`;
    expect(n).toBe(1);
  });

  it("answers file_gone for another record's file and changes nothing", async () => {
    const id = await uploadFile(fake, ada.id, { organisationId: orgId }, "a.pdf", PDF);
    expect(await deleteFile(ada.id, { dealId }, id)).toEqual({ status: "file_gone" });
    expect(await listFiles(ada.id, { organisationId: orgId })).toHaveLength(1);
  });

  it("refuses on an archived record, which still lists and gives its files; a won or lost deal accepts both (FR-011)", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "a.pdf", PDF);
    await sql`update deals set archived_at = now() where id = ${dealId}`;
    expect(await deleteFile(ada.id, { dealId }, id)).toEqual({ status: "files_archived" });
    expect(await startFileUpload(ada.id, { dealId }, { name: "b.pdf", size: 5 })).toEqual({ status: "files_archived" });
    expect(await listFiles(ada.id, { dealId })).toHaveLength(1);
    expect((await fileAccess(ada.id, id)).status).toBe("ok");
    await sql`update deals set archived_at = null, status = 'won', closed_at = now() where id = ${dealId}`;
    expect((await startFileUpload(ada.id, { dealId }, { name: "b.pdf", size: 5 })).status).toBe("ok");
    expect(await deleteFile(ada.id, { dealId }, id)).toEqual({ status: "ok" });
  });

  it("lists a deactivated uploader as such (edge case)", async () => {
    await uploadFile(fake, bob.id, { dealId }, "a.pdf", PDF);
    await sql`update users set status = 'deactivated' where id = ${bob.id}`;
    expect((await listFiles(ada.id, { dealId }))[0]).toMatchObject({ addedByName: "Linus Fake", addedByActive: false });
  });
});

describe("deleting a record for good (FR-012)", () => {
  const cases: [string, () => FileTarget, (id: number) => Promise<{ status: string }>][] = [
    ["a deal", () => ({ dealId }), (id) => deleteDeal(grace.id, id)],
    ["a person", () => ({ personId }), (id) => deletePerson(grace.id, id)],
    ["an organisation", () => ({ organisationId: orgId }), (id) => deleteOrganisation(grace.id, id)],
  ];
  for (const [label, target, remove] of cases) {
    it(`removes ${label}'s files and pending uploads, from Storage too; old addresses answer hidden`, async () => {
      const t = target();
      const id = await uploadFile(fake, ada.id, t, "a.png", PNG);
      const path = await pathOf(id);
      const start = await startFileUpload(ada.id, t, { name: "b.pdf", size: PDF.length });
      if (start.status !== "ok") throw new Error(start.status);
      await fake.fetch(start.url, { method: "PUT", headers: { "content-type": start.contentType }, body: PDF });
      const [{ storage_path: pendingPath }] = await sql`select storage_path from file_uploads`;
      const recordId = Object.values(t)[0] as number;
      expect((await remove(recordId)).status).toBe("deleted");
      const [{ files, uploads }] = await sql`select (select count(*)::int from files) as files, (select count(*)::int from file_uploads) as uploads`;
      expect([files, uploads]).toEqual([0, 0]);
      expect(stored(path)).toBe(false);
      expect(stored(pendingPath as string)).toBe(false);
      expect(await queued()).toEqual([]);
      expect(await fileAccess(ada.id, id)).toEqual({ status: "hidden" });
    });
  }

  it("queues nothing when the deal is hidden from the admin (nothing deleted)", async () => {
    const hidden = await makeDeal({ title: "Private", stageId, createdBy: ada.id, private: true });
    await uploadFile(fake, ada.id, { dealId: hidden }, "a.pdf", PDF);
    expect((await deleteDeal(grace.id, hidden)).status).toBe("not_found");
    expect(await queued()).toEqual([]);
    expect(await listFiles(ada.id, { dealId: hidden })).toHaveLength(1);
  });
});
