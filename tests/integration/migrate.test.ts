// covers FR-027, SC-009, edge cases "migration twice in a row" and "two at the same time"
import { spawn } from "node:child_process";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const baseUrl = process.env.DATABASE_URL!;
const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
const created: string[] = [];

function urlFor(db: string) {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

async function scratchDb() {
  const name = `crm_migrate_${Math.random().toString(36).slice(2, 10)}`;
  await admin.unsafe(`create database ${name}`);
  created.push(name);
  return name;
}

function runMigrate(db: string): Promise<{ code: number | null; out: string; ms: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "scripts/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: urlFor(db) },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, ms: Date.now() - start });
    });
  });
}

async function check(db: string) {
  const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
  try {
    const dupes = await c`select name, count(*)::int as n from schema_migrations group by name having count(*) > 1`;
    const applied = await c`select name from schema_migrations order by name`;
    const tables = await c`select count(*)::int as n from pg_tables where schemaname = 'public' and tablename = 'users'`;
    const sources = await c`select name from lead_sources order by id`;
    return {
      dupes: dupes.length,
      applied: applied.map((r) => r.name as string),
      users: tables[0].n as number,
      leadSources: sources.map((r) => r.name as string),
    };
  } finally {
    await c.end();
  }
}

async function advisoryLocks() {
  const [row] = await admin`select count(*)::int as n from pg_locks where locktype = 'advisory'`;
  return row.n as number;
}

afterAll(async () => {
  for (const db of created) await admin.unsafe(`drop database if exists ${db} with (force)`);
  await admin.end();
});

describe("npm run db:migrate", () => {
  it("runs twice in a row: both finish, the second says the database is up to date", async () => {
    const db = await scratchDb();
    const first = await runMigrate(db);
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain("0001_users_sessions.sql");
    // covers SF-90 T016: the people and organisations migration applies on a fresh database
    expect(first.out).toContain("Applied 0002_people_organisations.sql");
    const second = await runMigrate(db);
    expect(second.code, second.out).toBe(0);
    expect(second.out).toContain("Database is up to date.");
    expect(first.ms).toBeLessThan(30_000);
    expect(second.ms).toBeLessThan(30_000);
    const state = await check(db);
    expect(state.dupes).toBe(0);
    expect(state.applied).toContain("0001_users_sessions.sql");
    expect(state.applied).toContain("0002_people_organisations.sql");
    expect(state.users).toBe(1);
    expect(state.leadSources).toEqual(["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Event", "Ambassador"]);
    expect(await advisoryLocks()).toBe(0);
  });

  it("runs twice at the same time: both finish, each migration applied once, no lock left", async () => {
    const db = await scratchDb();
    const [a, b] = await Promise.all([runMigrate(db), runMigrate(db)]);
    expect(a.code, a.out).toBe(0);
    expect(b.code, b.out).toBe(0);
    expect(a.ms).toBeLessThan(30_000);
    expect(b.ms).toBeLessThan(30_000);
    // Exactly one of them applied the file.
    expect([a.out, b.out].filter((o) => o.includes("Applied 0001_users_sessions.sql")).length).toBe(1);
    const state = await check(db);
    expect(state.dupes).toBe(0);
    expect(state.applied.filter((n) => n === "0001_users_sessions.sql").length).toBe(1);
    expect(await advisoryLocks()).toBe(0);
  });
});

// covers FR-005, FR-011 (SF-92): 0003 applies on a fresh database and changes the timeline as data-model.md says
describe("migration 0003_private_owner_handover", () => {
  it("keeps events about a deleted person, checks handed_over events and adds the owner index", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0003_private_owner_handover.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const [u] = await c`insert into users (email, name) values ('a@barnacle.ai', 'A') returning id`;
      const [o] = await c`insert into organisations (name, owner_id, created_by) values ('Org', ${u.id}, ${u.id}) returning id`;
      const [p] = await c`insert into persons (first_name, last_name, owner_id, created_by) values ('Ada', 'Example', ${u.id}, ${u.id}) returning id`;
      const [e] = await c`
        insert into timeline_events (organisation_id, kind, actor_id, related_person_id)
        values (${o.id}, 'person_linked', ${u.id}, ${p.id}) returning id`;
      await c`delete from persons where id = ${p.id}`;
      const [kept] = await c`select related_person_id, actor_id from timeline_events where id = ${e.id}`;
      expect(kept).toEqual({ related_person_id: null, actor_id: u.id });

      const [q] = await c`insert into persons (first_name, last_name, owner_id, created_by) values ('B', 'C', ${u.id}, ${u.id}) returning id`;
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      expect(await code(c`insert into timeline_events (person_id, kind) values (${q.id}, 'handed_over')`)).toBe("23514");
      expect(await code(c`insert into timeline_events (person_id, kind, related_user_id) values (${q.id}, 'edited', ${u.id})`)).toBe("23514");
      expect(await code(c`insert into timeline_events (person_id, kind, related_user_id) values (${q.id}, 'handed_over', ${u.id})`)).toBe("ok");
      const idx = await c`select 1 from pg_indexes where indexname = 'persons_private_owner_idx'`;
      expect(idx.length).toBe(1);
    } finally {
      await c.end();
    }
  });
});
