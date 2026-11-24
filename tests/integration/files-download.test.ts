// covers SF-116 FR-003, FR-004, FR-005, FR-010, US2 scenarios 1–5, edge cases "kind" and "storage unreachable" (T022):
// the download and preview routes, called as Next calls them, with a real session.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
  headers: async () => new Headers({ "x-pathname": "/files/1/download" }),
}));

const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb } = await import("@/server/db");
const { pageFile } = await import("@/server/files/files");
const download = await import("@/app/(app)/files/[id]/download/route");
const preview = await import("@/app/(app)/files/[id]/preview/route");
const { StorageFake } = await import("../fakes/storage");
const { makeDeal, makePipeline } = await import("./deal-helpers");
const { makeOrganisation, makeUser, resetDb } = await import("./db-helpers");
const { DOCX, PDF, PNG, TEXT, uploadFile } = await import("./file-helpers");

const fake = new StorageFake();
let dealId: number, orgId: number, adaId: number;

beforeAll(() => void fake.install());
afterAll(async () => {
  fake.uninstall();
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  fake.down(false);
  fake.advance(0);
  const ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  adaId = ada.id;
  const p = await makePipeline("Sales", ["Lead in"]);
  orgId = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  dealId = await makeDeal({ title: "Fakeco website", stageId: p.stages[0], createdBy: ada.id });
  jar.set(SESSION_COOKIE, (await createSession(ada.id)).token);
});

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const get = (route: typeof download, id: number | string) => route.GET(new Request(`http://localhost:3000/files/${id}/x`), ctx(id));

function expectSafeHeaders(res: Response) {
  expect(res.status).toBe(303);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
}

describe("/files/<id>/download", () => {
  it("sends to a 60 s Storage address with download=<safe name>; it gives the uploaded bytes as an attachment (US2-5)", async () => {
    const id = await uploadFile(fake, adaId, { dealId }, "Q4/report: final.docx", DOCX);
    const res = await get(download, id);
    expectSafeHeaders(res);
    const location = res.headers.get("location")!;
    expect(location.startsWith(`${fake.baseUrl}/object/sign/crm-files/files/`)).toBe(true);
    expect(new URL(location).searchParams.get("download")).toBe("Q4_report_ final.docx");
    const file = await fake.fetch(location);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment; filename="Q4_report_ final.docx"/);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(DOCX);
    // FR-010: the address dies after 60 seconds.
    fake.advance(61_000);
    expect((await fake.fetch(location)).status).toBe(400);
  });

  it("answers unreachable when Storage is down, hidden for an unknown or non-numeric id", async () => {
    const id = await uploadFile(fake, adaId, { dealId }, "a.pdf", PDF);
    fake.down();
    const down = await get(download, id);
    expectSafeHeaders(down);
    expect(down.headers.get("location")).toBe("/files/unavailable?reason=unreachable");
    fake.down(false);
    for (const bad of ["abc", "0", "-1", "1.5", String(id + 1000)]) {
      const res = await get(download, bad);
      expectSafeHeaders(res);
      expect(res.headers.get("location"), bad).toBe("/files/unavailable?reason=hidden");
    }
  });
});

describe("/files/<id>/preview", () => {
  it("sends a PNG and a PDF to Storage without download (US2-2, US2-3)", async () => {
    for (const [name, bytes, type] of [["shot.png", PNG, "image/png"], ["proposal.pdf", PDF, "application/pdf"]] as const) {
      const id = await uploadFile(fake, adaId, { dealId }, name, bytes);
      const res = await get(preview, id);
      expectSafeHeaders(res);
      const location = res.headers.get("location")!;
      expect(new URL(location).searchParams.has("download")).toBe(false);
      const file = await fake.fetch(location);
      expect(file.headers.get("content-type")).toBe(type);
      expect(file.headers.get("content-disposition")).toBeNull();
    }
  });

  it("downloads a .docx, an SVG and a text file named fake.png instead (US2-4)", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    for (const [name, bytes] of [["brief.docx", DOCX], ["logo.svg", svg], ["fake.png", TEXT]] as const) {
      const id = await uploadFile(fake, adaId, { organisationId: orgId }, name, bytes);
      const res = await get(preview, id);
      expectSafeHeaders(res);
      expect(res.headers.get("location"), name).toBe(`/files/${id}/download`);
    }
  });
});

describe("pageFile", () => {
  it("gives a file of that record only (the preview box and delete confirmation)", async () => {
    const onDeal = await uploadFile(fake, adaId, { dealId }, "a.png", PNG);
    const onOrg = await uploadFile(fake, adaId, { organisationId: orgId }, "b.png", PNG);
    expect(await pageFile(adaId, String(onDeal), { dealId })).toMatchObject({ id: onDeal, name: "a.png", kind: "png" });
    expect(await pageFile(adaId, String(onOrg), { dealId })).toBeNull();
    expect(await pageFile(adaId, "x", { dealId })).toBeNull();
    expect(await pageFile(adaId, undefined, { dealId })).toBeNull();
  });
});
