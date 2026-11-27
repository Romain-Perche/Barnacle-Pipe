// covers SF-129 US3 scenarios 1–6, FR-011, FR-012, FR-013, SC-002, Edge Case "Big files from the computer": the
// record's own files and files from the computer (straight to Storage, kept 24 hours at most) are sent byte for byte,
// 25 MB in total; a file gone, another record's or another user's is refused; Storage down sends nothing.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/deals/1" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
}));

const { closeDb, sql } = await import("@/server/db");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { emailBox, startEmailUpload } = await import("@/server/emails/compose");
const { deleteFile, listFiles, sweepFileCleanup } = await import("@/server/files/files");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { StorageFake } = await import("../fakes/storage");
const { resetDb } = await import("./db-helpers");
const { makeDeal } = await import("./deal-helpers");
const { DOCX, PDF, PNG, sized, uploadFile } = await import("./file-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");

const storage = new StorageFake();
let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
let proposal: number, logo: number;
const proposalBytes = sized(PDF, 2000);

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  storage.install();
  storage.down(false);
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  proposal = await uploadFile(storage, w.ada, { dealId: w.pilot }, "proposal.pdf", proposalBytes);
  logo = await uploadFile(storage, w.ada, { dealId: w.pilot }, "logo.png", sized(PNG, 500));
});
afterAll(async () => {
  await afterResponseSettled();
  storage.uninstall();
  vi.unstubAllEnvs();
  await closeDb();
});

const deal = () => ({ kind: "deal" as const, id: w.pilot });

// startEmailUpload, then the browser's PUT to the signed address.
async function fromComputer(name: string, bytes: Uint8Array<ArrayBuffer>, type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", userId = w.ada) {
  const r = await startEmailUpload(userId, { name, size: bytes.length, type });
  if (r.status !== "ok") throw new Error(r.status);
  const put = await storage.fetch(r.url, { method: "PUT", headers: { "content-type": r.contentType }, body: bytes });
  if (put.status !== 200) throw new Error(`PUT ${put.status}`);
  return r.id;
}
const refusedWith = (code: string) => ({ status: "refused", errors: [{ code }] });

describe("US3 scenario 1: the record's files are offered", () => {
  it("the deal offers its own files with names and sizes; a person and an organisation only theirs", async () => {
    const box = (await emailBox(w.ada, deal()))!;
    expect(box.files.map((f) => [f.name, f.size]).sort()).toEqual([["logo.png", 500], ["proposal.pdf", 2000]]);
    expect((await emailBox(w.ada, { kind: "person", id: w.ana }))!.files).toEqual([]);
    await uploadFile(storage, w.ada, { organisationId: w.exampleLtd }, "terms.pdf", sized(PDF, 100));
    expect((await emailBox(w.ada, { kind: "organisation", id: w.exampleLtd }))!.files.map((f) => f.name)).toEqual(["terms.pdf"]);
  });
});

describe("US3 scenarios 2–4: sending files", () => {
  it("a computer file goes to Storage, kept for 24 hours", async () => {
    const id = await fromComputer("notes.docx", sized(DOCX, 300));
    const [row] = await sql`select storage_path, name, size::int as size, content_type from email_uploads where id = ${id}`;
    expect(row).toMatchObject({ name: "notes.docx", size: 300 });
    const [due] = await sql`select due_at from file_cleanup where storage_path = ${row.storage_path}`;
    expect(due.due_at.getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    expect(storage.objects().has(`${storage.bucket}/${row.storage_path}`)).toBe(true);
  });
  it("proposal.pdf (record) + notes.docx (computer): byte for byte, listed on the entry, // FILES unchanged, the upload dropped", async () => {
    const notes = sized(DOCX, 300);
    const up = await fromComputer("notes.docx", notes);
    const [path] = await sql`select storage_path from email_uploads where id = ${up}`;
    expect((await c.send(w.ada, deal(), { fileIds: [proposal], uploadIds: [up] })).status).toBe("sent");
    const [m] = fake.sentMessages(e.ADA);
    expect(m.attachments.map((a) => [a.name, a.type])).toEqual([["proposal.pdf", "application/pdf"], ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]]);
    expect(new Uint8Array(m.attachments[0].bytes)).toEqual(proposalBytes);
    expect(new Uint8Array(m.attachments[1].bytes)).toEqual(notes);
    const [entry] = await e.emailEntries(w.ada, { dealId: w.pilot });
    expect(entry.email!.attachments.map((a) => [a.name, a.size])).toEqual([["proposal.pdf", 2000], ["notes.docx", 300]]);
    expect((await listFiles(w.ada, { dealId: w.pilot })).map((f) => f.name).sort()).toEqual(["logo.png", "proposal.pdf"]);
    expect(await sql`select id from email_uploads`).toEqual([]);
    await afterResponseSettled();
    expect(await sql`select 1 from file_cleanup where storage_path = ${path.storage_path}`).toEqual([]);
    expect(storage.objects().has(`${storage.bucket}/${path.storage_path}`)).toBe(false);
  });
  it("24 MB + 2 MB: refused, nothing sent, no ledger row; without the 2 MB: sent", async () => {
    const big = await fromComputer("big.bin", sized(DOCX, 24 * 1024 * 1024), "application/octet-stream");
    const two = await fromComputer("two.bin", sized(DOCX, 2 * 1024 * 1024), "application/octet-stream");
    const box = c.input(deal(), { uploadIds: [big, two] });
    expect(await (await import("@/server/emails/compose")).sendFromRecord(w.ada, box)).toEqual(refusedWith("compose_attachments_too_large"));
    expect(fake.sentMessages(e.ADA)).toEqual([]);
    expect(await c.ledger()).toEqual([]);
    expect((await (await import("@/server/emails/compose")).sendFromRecord(w.ada, { ...box, uploadIds: [big] })).status).toBe("sent");
    expect(fake.sentMessages(e.ADA)[0].attachments[0].bytes.length).toBe(24 * 1024 * 1024);
  });
  it("a computer file of 30 MB is refused at once", async () => {
    expect(await startEmailUpload(w.ada, { name: "huge.mov", size: 30 * 1024 * 1024 })).toEqual({ status: "compose_attachments_too_large" });
  });
});

describe("US3 scenarios 5–6: files no longer there", () => {
  it("a record file deleted, another record's file, another user's upload, an upload of another size: compose_attachment_gone", async () => {
    await deleteFile(w.ada, { dealId: w.pilot }, logo);
    expect(await c.send(w.ada, deal(), { fileIds: [logo] })).toEqual(refusedWith("compose_attachment_gone"));
    const other = await makeDeal({ title: "Other", stageId: w.stage, createdBy: w.ada });
    const otherFile = await uploadFile(storage, w.ada, { dealId: other }, "other.pdf", sized(PDF, 50));
    expect(await c.send(w.ada, deal(), { fileIds: [otherFile] })).toEqual(refusedWith("compose_attachment_gone"));
    const bobs = await fromComputer("bob.docx", sized(DOCX, 40), undefined, w.bob);
    expect(await c.send(w.ada, deal(), { uploadIds: [bobs] })).toEqual(refusedWith("compose_attachment_gone"));
    const short = await startEmailUpload(w.ada, { name: "short.docx", size: 100 });
    if (short.status !== "ok") throw new Error(short.status);
    await storage.fetch(short.url, { method: "PUT", headers: { "content-type": short.contentType }, body: sized(DOCX, 60) });
    expect(await c.send(w.ada, deal(), { uploadIds: [short.id] })).toEqual(refusedWith("compose_attachment_gone"));
    expect(fake.sentMessages(e.ADA)).toEqual([]);
    expect(await c.ledger()).toEqual([]);
  });
  it("Storage down while sending: compose_send_failed, the ledger row deleted", async () => {
    storage.down();
    expect(await c.send(w.ada, deal(), { fileIds: [proposal] })).toEqual(refusedWith("compose_send_failed"));
    storage.down(false);
    expect(await c.ledger()).toEqual([]);
    expect(fake.sentMessages(e.ADA)).toEqual([]);
  });
  it("an unsent upload is removed after 24 hours with its row", async () => {
    const id = await fromComputer("left.docx", sized(DOCX, 30));
    const [row] = await sql`select storage_path from email_uploads where id = ${id}`;
    await sql`update email_uploads set created_at = now() - interval '25 hours' where id = ${id}`;
    await sql`update file_cleanup set due_at = now() - interval '1 hour' where storage_path = ${row.storage_path}`;
    await sweepFileCleanup();
    expect(await sql`select id from email_uploads`).toEqual([]);
    expect(storage.objects().has(`${storage.bucket}/${row.storage_path}`)).toBe(false);
  });
});
