// covers SF-116 FR-006, FR-013, US3 scenario 6, US5 scenarios 1–2 (T038, T025): the delete action's answers (back to the
// page with "File deleted." or an allow-listed code, a hidden record to its kind's list, an unsafe `back` refused), the
// upload actions' codes, and the fixed messages of /files/unavailable.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-pathname": "/deals/1" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb } = await import("@/server/db");
const { listFiles } = await import("@/server/files/files");
const { FLASH_COOKIE } = await import("@/server/records/flash-cookie");
const actions = await import("@/app/(app)/records/file-actions");
const Unavailable = (await import("@/app/(app)/files/unavailable/page")).default;
const { FileOverlays } = await import("@/app/(app)/records/FileOverlays");
const { deleteFile } = await import("@/server/files/files");
const { useStorageFetchForTests } = await import("@/server/files/storage");
const { StorageFake } = await import("../fakes/storage");
const { makeDeal, makePipeline } = await import("./deal-helpers");
const { makeUser, resetDb } = await import("./db-helpers");
const { PDF, PNG, uploadFile } = await import("./file-helpers");

const fake = new StorageFake();
let ada: { id: number }, grace: { id: number }, dealId: number, privateId: number;

beforeAll(() => void fake.install());
afterAll(async () => {
  fake.uninstall();
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  const p = await makePipeline("Sales", ["Lead in"]);
  dealId = await makeDeal({ title: "Fakeco website", stageId: p.stages[0], createdBy: ada.id });
  privateId = await makeDeal({ title: "Fake secret project", stageId: p.stages[0], createdBy: ada.id, private: true });
});

const as = async (id: number) => jar.set(SESSION_COOKIE, (await createSession(id)).token);
const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { to: string }).to;
  }
  throw new Error("no redirect");
}
const flash = () => (jar.has(FLASH_COOKIE) ? (JSON.parse(jar.get(FLASH_COOKIE)!) as { code: string }).code : null);

describe("deleteFileAction", () => {
  it("deletes and goes back to the page with File deleted.; a second delete answers file_gone (US5-1, US5-2)", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "a.pdf", PDF);
    await as(grace.id);
    const post = () => actions.deleteFileAction(form({ target: "deal", targetId: String(dealId), fileId: String(id), back: `/deals/${dealId}` }));
    expect(await redirectOf(post())).toBe(`/deals/${dealId}`);
    expect(flash()).toBe("file_deleted");
    expect(await listFiles(ada.id, { dealId })).toEqual([]);
    jar.delete(FLASH_COOKIE);
    expect(await redirectOf(post())).toBe(`/deals/${dealId}?error=file_gone`);
  });

  it("sends a direct delete on a hidden record to the list with file_not_found, changing nothing (US3-6)", async () => {
    const id = await uploadFile(fake, ada.id, { dealId: privateId }, "contract.pdf", PDF);
    await as(grace.id);
    const to = await redirectOf(actions.deleteFileAction(form({ target: "deal", targetId: String(privateId), fileId: String(id), back: `/deals/${privateId}` })));
    expect(to).toBe("/deals");
    expect(flash()).toBe("file_not_found");
    expect(await listFiles(ada.id, { dealId: privateId })).toHaveLength(1);
  });

  it("never redirects outside the app", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "a.pdf", PDF);
    await as(ada.id);
    const to = await redirectOf(actions.deleteFileAction(form({ target: "deal", targetId: String(dealId), fileId: String(id), back: "https://evil.example/x" })));
    expect(to).toBe("/");
  });
});

describe("upload actions", () => {
  it("answer codes only: hidden record, bad input, refused file", async () => {
    await as(grace.id);
    expect(await actions.startFileUpload({ kind: "deal", id: privateId, name: "<b>x</b>.pdf", size: 5 })).toEqual({ error: "file_record_not_found" });
    expect(await actions.startFileUpload({ kind: "nope", id: dealId, name: "a.pdf", size: 5 })).toEqual({ error: "file_record_not_found" });
    expect(await actions.startFileUpload({ kind: "deal", id: dealId, name: "a.pdf", size: 0 })).toEqual({ error: "file_empty" });
    expect(await actions.finishFileUpload({ uploadId: -1 })).toEqual({ error: "file_upload_failed" });
    const ok = await actions.startFileUpload({ kind: "deal", id: dealId, name: "a.pdf", size: PDF.length });
    if ("error" in ok) throw new Error(ok.error);
    expect(ok.contentType).toBe("application/pdf");
    await fake.fetch(ok.url, { method: "PUT", headers: { "content-type": ok.contentType }, body: PDF });
    expect(await actions.finishFileUpload({ uploadId: ok.uploadId })).toEqual({ ok: true });
  });
});

describe("/files/unavailable", () => {
  it("shows the fixed message for each reason, never text from the address", async () => {
    await as(ada.id);
    const page = async (reason: string) => renderToStaticMarkup(await Unavailable({ searchParams: Promise.resolve({ reason }) }));
    expect(await page("hidden")).toContain("This file doesn&#x27;t exist or you can&#x27;t see it.");
    expect(await page("gone")).toContain("This file doesn&#x27;t exist any more.");
    expect(await page("unreachable")).toContain("Files can&#x27;t be reached right now. Try again in a minute.");
    const odd = await page("<script>alert(1)</script>");
    expect(odd).toContain("This file doesn&#x27;t exist or you can&#x27;t see it.");
    expect(odd).not.toContain("script");
  });
});

describe("FileOverlays", () => {
  const overlay = async (viewerId: number, target: { dealId: number }, query: { file?: string; deleteFile?: string }, archived = false) =>
    renderToStaticMarkup(await FileOverlays({ viewerId, target, archived, back: `/deals/${target.dealId}`, query }));
  const redirected = async (p: Promise<string>) => redirectOf(p);

  // covers SF-116 US5 scenario 2 (fix round 1)
  it("?delete-file= of a file already deleted goes back with file_gone; hidden or unknown ids with file_not_found", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "a.pdf", PDF);
    const secret = await uploadFile(fake, ada.id, { dealId: privateId }, "contract.pdf", PDF);
    expect(await overlay(grace.id, { dealId }, { deleteFile: String(id) })).toContain("[ DELETE ]");
    expect((await deleteFile(ada.id, { dealId }, id)).status).toBe("ok");
    expect(await redirected(overlay(grace.id, { dealId }, { deleteFile: String(id) }))).toBe(`/deals/${dealId}?error=file_gone`);
    expect(await redirected(overlay(grace.id, { dealId: privateId }, { deleteFile: String(secret) }))).toBe(`/deals/${privateId}?error=file_not_found`);
    expect(await redirected(overlay(grace.id, { dealId }, { deleteFile: "999999" }))).toBe(`/deals/${dealId}?error=file_not_found`);
    expect(await redirected(overlay(grace.id, { dealId }, { deleteFile: "abc" }))).toBe(`/deals/${dealId}?error=file_not_found`);
    expect(await overlay(grace.id, { dealId }, { deleteFile: String(id) }, true)).toBe("");
  });

  // covers SF-116 Edge case 8 (fix round 1)
  it("?file= of an image makes the read address first: Storage down → back with files_unreachable, no box", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "photo.png", PNG);
    const html = await overlay(ada.id, { dealId }, { file: String(id) });
    const src = /<img[^>]*src="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(src).toMatch(/\/object\/sign\/[^/]+\/files\/[0-9a-f-]+\?token=/);
    expect(html).toMatch(/<img[^>]*referrerpolicy="no-referrer"/i);
    useStorageFetchForTests(() => Promise.reject(new TypeError("fetch failed")));
    try {
      expect(await redirected(overlay(ada.id, { dealId }, { file: String(id) }))).toBe(`/deals/${dealId}?error=files_unreachable`);
    } finally {
      fake.install();
    }
  });
});
