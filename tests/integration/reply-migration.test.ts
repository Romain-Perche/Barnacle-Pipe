// covers SF-130 T011, data-model.md § Migration: Supabase Postgres has no public schema and no fake; 0022_email_reply.sql
// is checked on the real local Postgres (PostgreSQL docs § Foreign keys, ON DELETE SET NULL): email_sends.reply_message_id
// exists, may be null, and a deleted answered email nulls it while the ledger row stays.
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
const r = await import("./reply-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

describe("0022_email_reply.sql", () => {
  it("reply_message_id: a nullable bigint referencing email_messages, set to null when that email is deleted", async () => {
    const [col] = await sql<{ data_type: string; is_nullable: string }[]>`
      select data_type, is_nullable from information_schema.columns where table_name = 'email_sends' and column_name = 'reply_message_id'`;
    expect(col).toEqual({ data_type: "bigint", is_nullable: "YES" });
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    await sql`
      insert into email_sends (user_id, send_key, connection_id, reply_message_id, rfc_message_id, state)
      values (${w.ada}, '00000000-0000-4000-8000-000000000001', ${w.adaConn}, ${pricing.id}, '<a@barnacle.ai>', 'sending')`;
    await expect(sql`
      insert into email_sends (user_id, send_key, connection_id, reply_message_id, rfc_message_id, state)
      values (${w.ada}, '00000000-0000-4000-8000-000000000002', ${w.adaConn}, ${pricing.id + 1000}, '<b@barnacle.ai>', 'sending')`).rejects.toThrow(/foreign key/);
    await sql`delete from email_messages where id = ${pricing.id}`;
    expect(await sql`select reply_message_id, state from email_sends`).toEqual([{ reply_message_id: null, state: "sending" }]);
  });
});
