// covers FR-032, SC-010, edge case "another database role reads any app table"
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { makeUser, resetDb } from "./db-helpers";

beforeAll(async () => {
  await resetDb();
  await makeUser({ email: "ada@barnacle.ai", role: "admin" });
});
afterAll(closeDb);

describe("Row Level Security", () => {
  it("is enabled on every table in public (including tables later features add)", async () => {
    const tables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')`;
    const names = tables.map((t) => t.relname);
    expect(names).toEqual(expect.arrayContaining(["users", "sessions", "user_changes", "schema_migrations"]));
    expect(tables.filter((t) => !t.relrowsecurity).map((t) => t.relname)).toEqual([]);
  });

  it("has no policies in public", async () => {
    const policies = await sql`select policyname from pg_policies where schemaname = 'public'`;
    expect(policies.length).toBe(0);
  });

  it("gives another role (like Supabase's Data API) no rows and refuses its writes", async () => {
    await sql.unsafe(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'crm_rls_probe') then create role crm_rls_probe nologin; end if;
    end $$`);
    await sql`grant usage on schema public to crm_rls_probe`;
    await sql`grant select, insert on users to crm_rls_probe`;

    const ownerCount = await sql`select count(*)::int as n from users`;
    expect(ownerCount[0].n).toBe(1);

    const probeRows = await sql.begin(async (tx) => {
      await tx`set local role crm_rls_probe`;
      return tx`select * from users`;
    });
    expect(probeRows.length).toBe(0);

    await expect(
      sql.begin(async (tx) => {
        await tx`set local role crm_rls_probe`;
        await tx`insert into users (email, name) values ('probe@barnacle.ai', 'Probe')`;
      }),
    ).rejects.toThrow(/row-level security/);
  });
});
