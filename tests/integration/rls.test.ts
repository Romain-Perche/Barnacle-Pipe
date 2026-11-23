// covers FR-032, SC-010, edge case "another database role reads any app table"; SF-90 T016 (8 new tables); SF-93 T004 (4 new tables); SF-95 T004 (4 new tables); SF-103 T004 (csv_imports); SF-102 T004 (note_mentions); SF-109 T004 (activities)
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
    expect(names).toEqual(
      expect.arrayContaining([
        "users", "sessions", "user_changes", "schema_migrations",
        "organisations", "persons", "person_emails", "person_phones", "lead_sources", "labels", "person_labels", "timeline_events",
        "pipelines", "stages", "deals", "deal_stage_periods",
        "deal_labels", "deal_label_links", "deal_people", "deal_followers",
        "csv_imports",
        "note_mentions",
        "activities",
      ]),
    );
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
