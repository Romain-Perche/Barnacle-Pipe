// covers SF-129 FR-010, FR-014 (T016): Supabase Postgres has no public schema and no fake; the checks of
// 0021_email_send.sql run on the real local Postgres (PostgreSQL docs § Constraints, § INSERT … ON CONFLICT).
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
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");

let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  w = await e.world(installGmailFake(), jar);
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const KEY = "00000000-0000-4000-8000-000000000001";
const sendRow = (o: { key?: string; rfc?: string; state?: string; person?: number | null } = {}) => sql`
  insert into email_sends (user_id, send_key, connection_id, deal_id, person_id, rfc_message_id, state)
  values (${w.ada}, ${o.key ?? KEY}, ${w.adaConn}, ${w.pilot}, ${o.person ?? null}, ${o.rfc ?? "<a@barnacle.ai>"}, ${o.state ?? "sending"})`;
const upload = (o: { size?: number; name?: string; path?: string }) => sql`
  insert into email_uploads (user_id, storage_path, name, size, content_type)
  values (${w.ada}, ${o.path ?? "files/x"}, ${o.name ?? "a.pdf"}, ${o.size ?? 10}, 'application/pdf')`;

describe("0021_email_send.sql checks", () => {
  it("email_sends: state, one record at most, one row per (user, send key), one row per Message-ID", async () => {
    await expect(sendRow({ state: "other" })).rejects.toThrow(/check constraint/);
    await expect(sendRow({ person: w.ana })).rejects.toThrow(/check constraint/);
    await sendRow();
    await expect(sendRow({ rfc: "<b@barnacle.ai>" })).rejects.toThrow(/unique/);
    await expect(sendRow({ key: "00000000-0000-4000-8000-000000000002" })).rejects.toThrow(/unique/);
    const claimed = await sql`
      insert into email_sends (user_id, send_key, connection_id, rfc_message_id, state) values (${w.ada}, ${KEY}, ${w.adaConn}, '<c@barnacle.ai>', 'sending')
      on conflict (user_id, send_key) do nothing returning id`;
    expect(claimed).toHaveLength(0);
  });
  it("the record deleted: its id set to null, the row kept", async () => {
    await sendRow();
    await sql`delete from deals where id = ${w.pilot}`;
    expect((await sql`select deal_id from email_sends`)[0].deal_id).toBeNull();
  });
  it("email_uploads: size 1 to 26214400, a name of 1 to 255 characters", async () => {
    await expect(upload({ size: 26_214_401 })).rejects.toThrow(/check constraint/);
    await expect(upload({ size: 0 })).rejects.toThrow(/check constraint/);
    await expect(upload({ name: "" })).rejects.toThrow(/check constraint/);
    await upload({ size: 26_214_400, name: "n".repeat(255) });
    await expect(upload({ path: "files/x" })).rejects.toThrow(/unique/);
  });
});
