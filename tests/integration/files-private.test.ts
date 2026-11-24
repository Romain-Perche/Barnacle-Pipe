// covers SF-116 FR-008, FR-009, FR-010, US3 scenarios 1–7, SC-004 (T028): a file on a hidden record does not exist for
// the viewer — lists, counts, timelines, both routes (no Storage call), uploads and deletes — and follows privacy changes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
  headers: async () => new Headers({ "x-pathname": "/files/1/download" }),
}));

const { NextRequest } = await import("next/server");
const { proxy } = await import("@/proxy");
const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { deleteFile, fileAccess, listFiles, startFileUpload } = await import("@/server/files/files");
const { handOverPrivateRecords } = await import("@/server/records/handover");
const { readTimeline } = await import("@/server/records/timeline");
const download = await import("@/app/(app)/files/[id]/download/route");
const preview = await import("@/app/(app)/files/[id]/preview/route");
const { StorageFake } = await import("../fakes/storage");
const { makeDeal, makePipeline } = await import("./deal-helpers");
const { makeOrganisation, makePerson, makeUser, resetDb } = await import("./db-helpers");
const { PDF, uploadFile } = await import("./file-helpers");

const fake = new StorageFake();
let ada: { id: number }, grace: { id: number }, alan: { id: number };
let orgId: number, personId: number, dealId: number, privatePersonId: number;

beforeAll(() => void fake.install());
afterAll(async () => {
  fake.uninstall();
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake" });
  const p = await makePipeline("Sales", ["Lead in"]);
  orgId = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  personId = await makePerson({ firstName: "Shared", lastName: "Person", createdBy: ada.id, organisationId: orgId });
  dealId = await makeDeal({ title: "Fake secret project", stageId: p.stages[0], createdBy: ada.id, private: true, organisationId: orgId, personId });
  privatePersonId = await makePerson({ firstName: "Pat", lastName: "Privatefake", createdBy: ada.id, private: true });
});

const as = async (userId: number) => jar.set(SESSION_COOKIE, (await createSession(userId)).token);
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("a file on Ada's private deal and private person, for Grace (an admin)", () => {
  it("is not listed, counted, on any timeline, given by either route, uploadable or deletable (US3-1, US3-2, US3-6)", async () => {
    const onDeal = await uploadFile(fake, ada.id, { dealId }, "contract.pdf", PDF);
    const onPerson = await uploadFile(fake, ada.id, { personId: privatePersonId }, "cv-fake.pdf", PDF);
    expect(await listFiles(grace.id, { dealId })).toEqual([]);
    expect(await listFiles(grace.id, { personId: privatePersonId })).toEqual([]);
    expect(await fileAccess(grace.id, onDeal)).toEqual({ status: "hidden" });
    expect(await fileAccess(grace.id, onPerson)).toEqual({ status: "hidden" });
    expect(await fileAccess(grace.id, 999_999)).toEqual({ status: "hidden" });

    await as(grace.id);
    const calls = fake.requests.length;
    for (const route of [download, preview]) {
      for (const id of [onDeal, onPerson, 999_999]) {
        const res = await route.GET(new Request("http://localhost:3000/x"), ctx(id));
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/files/unavailable?reason=hidden");
      }
    }
    expect(fake.requests.length).toBe(calls);

    expect(await startFileUpload(grace.id, { dealId }, { name: "x.pdf", size: 5 })).toEqual({ status: "file_record_not_found" });
    expect(await startFileUpload(grace.id, { personId: privatePersonId }, { name: "x.pdf", size: 5 })).toEqual({ status: "file_record_not_found" });
    expect(await deleteFile(grace.id, { dealId }, onDeal)).toEqual({ status: "file_record_not_found" });
    expect((await listFiles(ada.id, { dealId })).map((f) => f.id)).toEqual([onDeal]);

    for (const target of [{ organisationId: orgId }, { personId }]) {
      const { entries } = await readTimeline(grace.id, target);
      expect(entries.filter((e) => e.file !== null), JSON.stringify(target)).toEqual([]);
      const own = await readTimeline(ada.id, target);
      expect(own.entries.filter((e) => e.kind === "file_added").map((e) => e.deal?.id)).toEqual([dealId]);
    }
  });

  it("follows privacy changes at once: shared → ok, private again → hidden (US3-4, US3 independent test)", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "contract.pdf", PDF);
    await sql`update deals set private = false where id = ${dealId}`;
    expect((await fileAccess(grace.id, id)).status).toBe("ok");
    await as(grace.id);
    const res = await download.GET(new Request("http://localhost:3000/x"), ctx(id));
    expect(res.headers.get("location")).toMatch(/\/object\/sign\//);
    await sql`update deals set private = true where id = ${dealId}`;
    expect((await fileAccess(grace.id, id)).status).toBe("hidden");
    const again = await download.GET(new Request("http://localhost:3000/x"), ctx(id));
    expect(again.headers.get("location")).toBe("/files/unavailable?reason=hidden");
  });

  it("is seen by the new owner after a hand-over of a deactivated user's private records (US3-7)", async () => {
    const p = await makePipeline("Old", ["S"]);
    const alansDeal = await makeDeal({ title: "Fake leaver deal", stageId: p.stages[0], createdBy: alan.id, private: true });
    const alansPerson = await makePerson({ firstName: "Sam", lastName: "Leftfake", createdBy: alan.id, private: true });
    const a = await uploadFile(fake, alan.id, { dealId: alansDeal }, "a.pdf", PDF);
    const b = await uploadFile(fake, alan.id, { personId: alansPerson }, "b.pdf", PDF);
    await sql`update users set status = 'deactivated' where id = ${alan.id}`;
    expect((await fileAccess(ada.id, a)).status).toBe("hidden");
    await handOverPrivateRecords(grace.id, alan.id, ada.id);
    expect((await fileAccess(ada.id, a)).status).toBe("ok");
    expect((await fileAccess(ada.id, b)).status).toBe("ok");
    expect(await listFiles(ada.id, { personId: alansPerson })).toHaveLength(1);
  });
});

describe("addresses that reach Storage", () => {
  it("every read address lasts 60 seconds and names one path (US3-5, FR-010)", async () => {
    const id = await uploadFile(fake, ada.id, { organisationId: orgId }, "a.pdf", PDF);
    await as(ada.id);
    await download.GET(new Request("http://localhost:3000/x"), ctx(id));
    await preview.GET(new Request("http://localhost:3000/x"), ctx(id));
    const signs = fake.requests.filter((r) => r.method === "POST" && r.route.startsWith("/object/sign/"));
    expect(signs.length).toBeGreaterThan(0);
    for (const s of signs) {
      expect((s.body as { expiresIn: number }).expiresIn).toBe(60);
      expect(s.route).toMatch(/^\/object\/sign\/crm-files\/files\/[0-9a-f-]{36}$/);
    }
  });

  it("signed out, both addresses go to sign-in with the address as next (US3-3)", () => {
    for (const path of ["/files/1/download", "/files/1/preview"]) {
      const res = proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(`http://localhost:3000/sign-in?next=${encodeURIComponent(path)}`);
    }
  });
});
