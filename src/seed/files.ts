// Fake files (SF-116 data-model.md § Fake data, FR-016): small generated contents only (a PNG, one-page PDFs, a GIF,
// empty zips named .xlsx/.docx, text named fake.png), never real documents. Each goes into Storage through the storage
// module (the fake in development and tests), then gets the same row and "added" FILE entry as a finished upload, by
// the record's creator. "old-version.pdf" is added and then deleted through deleteFile, so the timeline shows both
// kinds. Idempotent: a file is skipped when its record already has (or had) a file of that name.
import { deflateSync, crc32 } from "node:zlib";
import type { Sql } from "@/server/db";
import { deleteFile, insertFile, type FileTarget } from "@/server/files/files";
import { createSignedUploadUrl, newStoragePath, objectInfo, putSigned, readHead } from "@/server/files/storage";
import { fileKind, uploadContentType } from "@/server/files/rules";

const enc = (s: string) => new TextEncoder().encode(s);

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// A 48×48 blue-to-orange gradient.
function png(): Uint8Array<ArrayBuffer> {
  const size = 48;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      raw.set([Math.round(43 + t * 212), Math.round(0 + t * 66), Math.round(255 - t * 255)], y * (1 + size * 3) + 1 + x * 3);
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

// A one-page PDF with one line of text.
function pdf(text: string): Uint8Array<ArrayBuffer> {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}

const GIF = new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
// An empty zip archive (what an .xlsx or .docx is made of).
const ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

type Seed = { name: string; bytes: Uint8Array<ArrayBuffer> };

async function one(query: Promise<{ id: number; created_by: number }[]>) {
  const [row] = await query;
  return row ?? null;
}

// Stores the bytes, reads them back like finishFileUpload, then the row and its FILE entry.
async function add(sql: Sql, actorId: number, target: FileTarget, f: Seed): Promise<boolean> {
  const path = newStoragePath();
  const contentType = uploadContentType(f.name);
  const { url } = await createSignedUploadUrl(path);
  if (!(await putSigned(url, f.bytes, contentType))) throw new Error(`could not store ${f.name}`);
  const info = await objectInfo(path);
  if (!info) throw new Error(`could not read back ${f.name}`);
  const kind = fileKind({ head: await readHead(path, 16), name: f.name, storedType: info.contentType });
  await sql.begin((tx) => insertFile(tx as unknown as Sql, actorId, target, { name: f.name, size: info.size, kind, path }));
  return true;
}

export async function seedFiles(sql: Sql): Promise<string[]> {
  const deal = (title: string) =>
    one(sql<{ id: number; created_by: number }[]>`select id::int as id, created_by::int as created_by from deals where title = ${title} order by id limit 1`);
  const website = await deal("Fakeco website");
  const secret = await deal("Fake secret project");
  const archived = await deal("Old fake opportunity");
  const pat = await one(sql<{ id: number; created_by: number }[]>`
    select id::int as id, created_by::int as created_by from persons where first_name = 'Pat' and last_name = 'Privatefake'`);
  const shared = await one(sql<{ id: number; created_by: number }[]>`
    select id::int as id, created_by::int as created_by from persons where not private and archived_at is null order by id limit 1`);
  const fakeco = await one(sql<{ id: number; created_by: number }[]>`
    select id::int as id, created_by::int as created_by from organisations where name = 'Fakeco Ltd'`);

  const plan: { on: { id: number; created_by: number } | null; target: (id: number) => FileTarget; files: Seed[] }[] = [
    {
      on: website,
      target: (id) => ({ dealId: id }),
      files: [
        { name: "old-version.pdf", bytes: pdf("Fake proposal, old version") },
        { name: "budget.xlsx", bytes: ZIP },
        { name: "proposal.pdf", bytes: pdf("Fake proposal for Fakeco website") },
        { name: "site-mockup.png", bytes: png() },
      ],
    },
    { on: secret, target: (id) => ({ dealId: id }), files: [{ name: "contract.pdf", bytes: pdf("Fake contract, private deal") }] },
    { on: pat, target: (id) => ({ personId: id }), files: [{ name: "cv-fake.pdf", bytes: pdf("Fake CV of Pat Privatefake") }] },
    {
      on: fakeco,
      target: (id) => ({ organisationId: id }),
      files: [
        { name: "brand-guide.pdf", bytes: pdf("Fakeco Ltd fake brand guide") },
        { name: "logo.gif", bytes: GIF },
      ],
    },
    { on: archived, target: (id) => ({ dealId: id }), files: [{ name: "old-brief.docx", bytes: ZIP }] },
    { on: shared, target: (id) => ({ personId: id }), files: [{ name: "fake.png", bytes: enc("Fake notes saved as fake.png: not an image.") }] },
  ];

  let added = 0;
  for (const p of plan) {
    if (!p.on) continue;
    const target = p.target(p.on.id);
    for (const f of p.files) {
      const col = "dealId" in target ? sql`deal_id` : "personId" in target ? sql`person_id` : sql`organisation_id`;
      const [there] = await sql`
        select 1 from files where ${col} = ${p.on.id} and name = ${f.name}
        union all
        select 1 from timeline_events where ${col} = ${p.on.id} and kind = 'file_deleted' and file_name = ${f.name}`;
      if (there) continue;
      await add(sql, p.on.created_by, target, f);
      added++;
      if (f.name === "old-version.pdf") {
        const [row] = await sql<{ id: number }[]>`select id::int as id from files where ${col} = ${p.on.id} and name = ${f.name}`;
        await deleteFile(p.on.created_by, target, row.id);
      }
    }
  }
  return [added === 0 ? "already there files" : `added ${added} fake files`];
}
