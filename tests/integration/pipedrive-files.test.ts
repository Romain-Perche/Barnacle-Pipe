// covers SF-122 FR-003, FR-014, FR-015, FR-017, FR-020, US4 scenarios 1–5, SC-004, edge cases (download redirect never
// carries the token; a stale part leaves nothing half-stored): files copied byte for byte through the fake Storage
// (schema-checked), listed once on the right record with Pipedrive's name, date and uploader
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { listFiles, sweepFileCleanup } from "@/server/files/files";
import type { FakePipedrive } from "@/server/pipedrive/fake-pipedrive";
import { getImportView, onSaveForTests, runPart, startImport, continueImport } from "@/server/pipedrive/imports";
import { itemText, namesForReport, reportLines } from "@/server/pipedrive/report";
import { readTimeline } from "@/server/records/timeline";
import { fileHostRequests, installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { StorageFake } from "../fakes/storage";
import { makeUser, resetDb } from "./db-helpers";
import { makePipeline } from "./deal-helpers";
import { DOCX, PDF, PNG, sized } from "./file-helpers";
import { removeToken } from "@/server/pipedrive/connection";
import { deactivate } from "@/server/users";
import { COMPANY, connect, fakeCompany, importRow, linkTarget, LINUS_TOKEN, runToEnd, skipWait, start } from "./pipedrive-helpers";

const storage = new StorageFake();
beforeAll(() => void storage.install());
afterAll(() => storage.uninstall());

function seedFilesSet(fake: FakePipedrive) {
  fakeCompany(fake);
  const pipeline = fake.addPipeline(COMPANY, { name: "Sales" });
  const stage = fake.addStage(COMPANY, { pipeline_id: pipeline, name: "Lead" });
  const e = (value: string) => [{ value, primary: true, label: "work" }];
  const org = fake.addOrganization(COMPANY, { name: "Files Org Fake", owner_id: 1 });
  const person = fake.addPerson(COMPANY, { first_name: "Fay", last_name: "Filefake", owner_id: 1, emails: e("fay@fake.example") });
  const noName = fake.addPerson(COMPANY, { first_name: "", last_name: "", name: "", owner_id: 1, emails: e("noname.files@fake.example") });
  const deal = fake.addDeal(COMPANY, { title: "Files fake deal", owner_id: 1, stage_id: stage, person_id: person, org_id: org });
  const F = (o: Parameters<FakePipedrive["addFile"]>[1], bytes?: Uint8Array) => fake.addFile(COMPANY, o, bytes);
  const big = sized(PDF, 27_367_014);
  const file = {
    pdf: F({ name: "proposal.pdf", user_id: 2, deal_id: deal, person_id: person, add_time: "2025-03-04 05:06:07" }, PDF),
    png: F({ name: "logo.png", user_id: 1, person_id: person }, PNG),
    docx: F({ name: "notes.docx", user_id: 3, org_id: org }, DOCX),
    big: F({ name: "huge.pdf", user_id: 1, deal_id: deal, file_size: big.length }, big),
    empty: F({ name: "empty.txt", user_id: 1, org_id: org }, new Uint8Array(0)),
    onNoName: F({ name: "on-no-name.pdf", user_id: 1, person_id: noName }, PDF),
    email: F({ name: "attached.pdf", user_id: 1, deal_id: deal, mail_message_id: "77" }, PDF),
    drive: F({ name: "Drive doc", user_id: 1, deal_id: deal, remote_location: "googledrive" }),
    lead: F({ name: "lead.pdf", user_id: 1, lead_id: "lead-9" }, PDF),
    gone: F({ name: "gone.pdf", user_id: 1, org_id: org, file_size: 10 }, PDF),
    html: F({ name: '<a href="https://evil.example">Click</a>.pdf', user_id: 1, org_id: org }, PDF),
  };
  fake.loseFileBytes(COMPANY, file.gone);
  return { org, person, deal, file };
}

let linus: { id: number }, margaret: { id: number };
let fake: FakePipedrive;
let set: ReturnType<typeof seedFilesSet>;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  storage.down(false);
  storage.store.keys().forEach((k) => storage.store.delete(k));
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  set = seedFilesSet(fake);
  await connect(linus.id, LINUS_TOKEN);
  await makePipeline("Sales", ["Lead"]);
});
afterEach(() => onSaveForTests(null));
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function importFiles() {
  const id = await start(linus.id, { deals: true, files: true });
  await runToEnd(linus.id, id);
  return (await getImportView(linus.id))!;
}
const fileRow = async (pdId: number) => {
  const id = await linkTarget("file", pdId);
  if (typeof id !== "number") throw new Error(`file ${pdId} not imported`);
  const [row] = await sql<{ id: number; name: string; size: number; kind: string; storage_path: string; added_by: number; added_at: Date; deal_id: number | null; person_id: number | null; organisation_id: number | null }[]>`
    select id::int as id, name, size::int as size, kind, storage_path, added_by::int as added_by, added_at, deal_id::int as deal_id,
           person_id::int as person_id, organisation_id::int as organisation_id from files where id = ${id}`;
  return row;
};
const stored = (path: string) => storage.objects().get(`${storage.bucket}/${path}`);

describe("copied files (US4-1, US4-2, FR-014)", () => {
  it("copies each file byte for byte onto its deal, else person, else organisation, with Pipedrive's name, date and uploader", async () => {
    const view = await importFiles();
    const dealId = (await linkTarget("deal", set.deal))!;
    const pdf = await fileRow(set.file.pdf);
    expect(pdf).toMatchObject({ name: "proposal.pdf", size: PDF.length, kind: "pdf", added_by: margaret.id, added_at: new Date("2025-03-04T05:06:07Z"), deal_id: dealId, person_id: null });
    expect([...stored(pdf.storage_path)!]).toEqual([...PDF]);
    const png = await fileRow(set.file.png);
    expect(png).toMatchObject({ kind: "png", person_id: await linkTarget("person", set.person) });
    expect([...stored(png.storage_path)!]).toEqual([...PNG]);
    expect(await fileRow(set.file.docx)).toMatchObject({ kind: "other", added_by: linus.id, organisation_id: await linkTarget("organisation", set.org) });
    expect((await listFiles(linus.id, { dealId })).map((f) => f.name)).toEqual(["proposal.pdf"]);
    const timeline = await readTimeline(linus.id, { dealId });
    const entry = timeline.entries.find((e) => e.kind === "file_added")!;
    expect(entry.createdAt).toEqual(new Date("2025-03-04T05:06:07Z"));
    expect(view.counts.files).toMatchObject({ imported: 4, already: 0 });
    // Nothing left to clean up, and every stored object is listed.
    expect((await sql`select 1 from file_cleanup`).length).toBe(0);
    expect(storage.objects().size).toBe(4);
  });

  it("leaves out files over 25 MB, empty, gone, linked or on a record not imported (listed) and counts email and lead files", async () => {
    const view = await importFiles();
    const names = await namesForReport(linus.id, view.report);
    const reason = (pd: number) => itemText(view.report.notImported.find((n) => n.kind === "file" && n.pipedriveId === pd)!, names);
    expect(reason(set.file.big)).toBe("Over 25 MB (26.1 MB).");
    expect(reason(set.file.empty)).toBe("Empty file.");
    expect(reason(set.file.gone)).toBe("No longer in Pipedrive.");
    expect(reason(set.file.drive)).toBe("A linked document, not an uploaded file.");
    expect(reason(set.file.onNoName)).toBe("Its person 'noname.files@fake.example' was not imported.");
    const lines = reportLines(view.report, names).map((l) => l.text);
    expect(lines).toContain("1 file on Pipedrive emails: not imported.");
    expect(lines).toContain("1 file on Pipedrive leads: not imported.");
    expect(view.counts.files.notImported).toBe(5);
    expect([...storage.objects().values()].some((b) => b.length > 26_214_400)).toBe(false);
    // The big file's download was never asked for (its size says so) — and nothing of it is stored.
    expect(fake.requests.some((r) => r.path === `/v1/files/${set.file.big}/download`)).toBe(false);
  });

  it("follows a download redirect without ever sending the token to the file host", async () => {
    fake.redirectDownloads(true);
    const view = await importFiles();
    expect(view.counts.files.imported).toBe(4);
    expect(fileHostRequests.length).toBeGreaterThanOrEqual(4);
    expect(fileHostRequests.every((r) => !r.token)).toBe(true);
  });

  it("a repeat counts every file as already imported and stores nothing more", async () => {
    await importFiles();
    const view = await importFiles();
    expect(view.counts.files).toMatchObject({ imported: 0, already: 4 });
    expect(storage.objects().size).toBe(4);
  });
});

describe("the file store (US4-5, FR-003, FR-017)", () => {
  it("does not start when the file store is down or not set up", async () => {
    storage.down(true);
    expect(await startImport(linus.id, { people: true, organisations: true, files: true, consent: "subscribed" })).toEqual({ error: "files_unreachable" });
    storage.down(false);
    vi.stubEnv("SUPABASE_URL", "https://storage.fake.invalid");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(await startImport(linus.id, { people: true, organisations: true, files: true, consent: "subscribed" })).toEqual({ error: "files_unreachable" });
    vi.stubEnv("SUPABASE_URL", "");
    expect(await sql`select 1 from pipedrive_imports`).toHaveLength(0);
  });

  it("pauses when the store fails mid-part, half-stores nothing, and copies the file exactly once after [ CONTINUE ]", async () => {
    const id = await start(linus.id, { deals: true, files: true });
    // Run up to the files step.
    for (let i = 0; i < 100 && (await importRow(id)).step !== "files"; i++) {
      const r = await runPart(linus.id, id);
      if (r.next === "wait") await skipWait(id);
    }
    expect((await importRow(id)).step).toBe("files");
    // Storage goes down after the first sign-upload: the PUT fails.
    const realFetch = storage.fetch;
    let signs = 0;
    const flaky = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/object/upload/sign/") && init?.method === "POST") signs += 1;
      if (signs >= 1 && init?.method === "PUT") throw new TypeError("fetch failed");
      return realFetch(input, init);
    };
    const { useStorageFetchForTests } = await import("@/server/files/storage");
    useStorageFetchForTests(flaky);
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    const row = await importRow(id);
    expect(row).toMatchObject({ state: "paused", pause_reason: "files_unreachable" });
    expect((await sql`select 1 from files`).length).toBe(0);
    const queued = await sql<{ storage_path: string }[]>`select storage_path from file_cleanup`;
    expect(queued).toHaveLength(1);
    storage.install();
    await continueImport(linus.id);
    await runToEnd(linus.id, id);
    expect((await sql`select 1 from files`).length).toBe(4);
    expect(await sql`select 1 from pipedrive_links where kind = 'file'`).toHaveLength(4);
    // The orphan path is swept once due.
    await sql`update file_cleanup set due_at = now() - interval '1 second'`;
    await sweepFileCleanup();
    expect((await sql`select 1 from file_cleanup`).length).toBe(0);
    const listed = new Set((await sql<{ storage_path: string }[]>`select storage_path from files`).map((r) => `${storage.bucket}/${r.storage_path}`));
    expect([...storage.objects().keys()].every((k) => listed.has(k))).toBe(true);
  });

  it("a stale part (another tab moved on) leaves its upload queued for removal now, and no second row", async () => {
    const id = await start(linus.id, { deals: true, files: true });
    for (let i = 0; i < 100 && (await importRow(id)).step !== "files"; i++) {
      const r = await runPart(linus.id, id);
      if (r.next === "wait") await skipWait(id);
    }
    // Just before the first file's commit, another tab moves the cursor.
    let moved = false;
    onSaveForTests({
      before: async () => {
        if (moved) return;
        moved = true;
        await sql`update pipedrive_imports set cursor = '0:99' where id = ${id}`;
      },
    });
    await runPart(linus.id, id);
    expect((await sql`select 1 from files`).length).toBe(0);
    const queued = await sql<{ due: boolean }[]>`select due_at <= now() as due from file_cleanup`;
    expect(queued.length).toBeLessThanOrEqual(1);
    expect(queued.every((q) => q.due)).toBe(true);
  });
});

// covers SF-122 Edge case 15, FR-021 (fix round 1): every per-file commit re-checks, under lock, that the user is active
// and still has the token; a copy under way when either goes is not listed, and its path is due for removal now.
describe("token removed or user deactivated during a file copy (Edge case 15)", () => {
  async function toFilesStep() {
    const id = await start(linus.id, { deals: true, files: true });
    for (let i = 0; i < 100 && (await importRow(id)).step !== "files"; i++) {
      const r = await runPart(linus.id, id);
      if (r.next === "wait") await skipWait(id);
    }
    expect((await importRow(id)).step).toBe("files");
    return id;
  }
  async function nothingListed() {
    expect(await sql`select 1 from files`).toHaveLength(0);
    expect(await sql`select 1 from pipedrive_links where kind = 'file'`).toHaveLength(0);
    const queued = await sql<{ due: boolean }[]>`select due_at <= now() as due from file_cleanup`;
    expect(queued.every((q) => q.due)).toBe(true);
  }

  it("lists no file of the part once the token is removed, and pauses as token refused", async () => {
    const id = await toFilesStep();
    let done = false;
    onSaveForTests({
      before: async () => {
        if (done) return;
        done = true;
        await removeToken(linus.id);
      },
    });
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    await nothingListed();
    expect(await importRow(id)).toMatchObject({ state: "paused", pause_reason: "token_refused" });
  });

  it("lists no file of the part once the user is deactivated, and the import no longer runs", async () => {
    const admin = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
    const id = await toFilesStep();
    let done = false;
    onSaveForTests({
      before: async () => {
        if (done) return;
        done = true;
        await deactivate(admin.id, linus.id);
      },
    });
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    await nothingListed();
    expect((await importRow(id)).state).toBe("paused");
  });

  it("a page save of another step after the token is removed saves nothing and pauses", async () => {
    const id = await start(linus.id, { deals: true });
    let done = false;
    onSaveForTests({
      before: async () => {
        if (done) return;
        done = true;
        await removeToken(linus.id);
      },
    });
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    expect(await importRow(id)).toMatchObject({ state: "paused", pause_reason: "token_refused", step: "prepare" });
  });
});
