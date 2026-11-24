// covers FR-027, SC-009, edge cases "migration twice in a row" and "two at the same time"
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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

  // covers SF-93 T004, SC-007: the pipelines and deals migration on a fresh database
  it("applies 0004_pipelines_deals.sql: one target per event, a stage holding a deal cannot be deleted", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0004_pipelines_deals.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [p] = await c`insert into pipelines (name, position) values ('Sales', 1) returning id`;
      const [s] = await c`insert into stages (pipeline_id, name, position) values (${p.id}, 'Lead in', 1) returning id`;
      const [d] = await c`insert into deals (title, stage_id, owner_id, created_by) values ('Fakeco website', ${s.id}, ${u.id}, ${u.id}) returning id`;
      const [person] = await c`insert into persons (first_name, owner_id, created_by) values ('Ada', ${u.id}, ${u.id}) returning id`;
      await c`insert into timeline_events (deal_id, kind, actor_id, from_stage, to_stage) values (${d.id}, 'moved', ${u.id}, 'A', 'B')`;
      await c`insert into timeline_events (person_id, kind, related_user_id) values (${person.id}, 'handed_over', ${u.id})`;
      await expect(c`insert into timeline_events (deal_id, person_id, kind) values (${d.id}, ${person.id}, 'added')`).rejects.toThrow(
        /timeline_events_target_check/,
      );
      await expect(c`insert into timeline_events (kind) values ('added')`).rejects.toThrow(/timeline_events_target_check/);
      await expect(c`delete from stages where id = ${s.id}`).rejects.toThrow(/deals_stage_id_fkey/);
      await expect(c`delete from pipelines where id = ${p.id}`).rejects.toThrow(/deals_stage_id_fkey/);
      const [{ n }] = await c`select count(*)::int as n from deals`;
      expect(n).toBe(1);
    } finally {
      await c.end();
    }
  });

  // covers SF-95 T001, T004, FR-005, FR-008: 0005_deal_page.sql on a fresh database keeps status, closed date and reason consistent
  it("applies 0005_deal_page.sql: refuses a won deal without a date, a lost deal without a reason, a long reason, a lost event without a reason", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0005_deal_page.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [p] = await c`insert into pipelines (name, position) values ('Sales', 1) returning id`;
      const [s] = await c`insert into stages (pipeline_id, name, position) values (${p.id}, 'Lead in', 1) returning id`;
      const [d] = await c`insert into deals (title, stage_id, owner_id, created_by) values ('Fakeco website', ${s.id}, ${u.id}, ${u.id}) returning id, status`;
      expect(d.status).toBe("open");
      expect(await code(c`update deals set status = 'won' where id = ${d.id}`)).toBe("23514");
      expect(await code(c`update deals set status = 'lost', closed_at = now() where id = ${d.id}`)).toBe("23514");
      expect(await code(c`update deals set status = 'lost', closed_at = now(), lost_reason = ${"x".repeat(501)} where id = ${d.id}`)).toBe("23514");
      expect(await code(c`update deals set status = 'lost', closed_at = now(), lost_reason = ' padded ' where id = ${d.id}`)).toBe("23514");
      expect(await code(c`update deals set status = 'lost', closed_at = now(), lost_reason = ${"x".repeat(500)} where id = ${d.id}`)).toBe("ok");
      expect(await code(c`insert into timeline_events (deal_id, kind, actor_id) values (${d.id}, 'lost', ${u.id})`)).toBe("23514");
      expect(await code(c`insert into timeline_events (deal_id, kind, actor_id, reason) values (${d.id}, 'won', ${u.id}, 'x')`)).toBe("23514");
      expect(await code(c`insert into timeline_events (deal_id, kind, actor_id, reason) values (${d.id}, 'lost', ${u.id}, 'Fake budget cut')`)).toBe("ok");
      expect(await code(c`insert into timeline_events (deal_id, kind, actor_id) values (${d.id}, 'reopened', ${u.id})`)).toBe("ok");
      const [l] = await c`insert into deal_labels (name) values ('Hot') returning id`;
      expect(await code(c`insert into deal_labels (name) values (' hot')`)).toBe("23514");
      expect(await code(c`insert into deal_labels (name) values ('HOT')`)).toBe("23505");
      await c`insert into deal_label_links (deal_id, label_id) values (${d.id}, ${l.id})`;
      const [person] = await c`insert into persons (first_name, owner_id, created_by) values ('Bob', ${u.id}, ${u.id}) returning id`;
      await c`insert into deal_people (deal_id, person_id, linked_by) values (${d.id}, ${person.id}, ${u.id})`;
      await c`insert into deal_followers (deal_id, user_id) values (${d.id}, ${u.id})`;
      await c`delete from deals where id = ${d.id}`;
      const [{ n }] = await c`select (select count(*) from deal_label_links) + (select count(*) from deal_people) + (select count(*) from deal_followers) as n`;
      expect(Number(n)).toBe(0);
    } finally {
      await c.end();
    }
  });

  // covers SF-102 T001, T004, T014, FR-008: 0007_notes_mentions.sql on a fresh database keeps notes consistent
  it("applies 0007_notes_mentions.sql: notes need a body and an author, other events no body or editor, one mention per user per note", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0007_notes_mentions.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [b] = await c`insert into users (email, name) values ('bob@barnacle.ai', 'Bob') returning id`;
      const [o] = await c`insert into organisations (name, owner_id, created_by) values ('Fakeco', ${u.id}, ${u.id}) returning id`;
      expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id) values (${o.id}, 'note', ${u.id})`)).toBe("23514");
      expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id, body) values (${o.id}, 'edited', ${u.id}, 'x')`)).toBe("23514");
      expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id, edited_by) values (${o.id}, 'edited', ${u.id}, ${u.id})`)).toBe("23514");
      expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id, body) values (${o.id}, 'note', null, 'x')`)).toBe("23514");
      // SF-103's kind 'imported' stays allowed, so 0006_csv_imports.sql and this migration apply in either order.
      expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id) values (${o.id}, 'imported', ${u.id})`)).toBe("ok");
      const [n] = await c`insert into timeline_events (organisation_id, kind, actor_id, body) values (${o.id}, 'note', ${u.id}, 'Hi') returning id, version`;
      expect(n.version).toBe(1);
      await c`insert into note_mentions (event_id, user_id, mentioned_by) values (${n.id}, ${b.id}, ${u.id})`;
      expect(await code(c`insert into note_mentions (event_id, user_id, mentioned_by) values (${n.id}, ${b.id}, ${u.id})`)).toBe("23505");
      await c`delete from timeline_events where id = ${n.id}`;
      const [{ m }] = await c`select count(*)::int as m from note_mentions`;
      expect(m).toBe(0);
    } finally {
      await c.end();
    }
  });

  // covers SF-114 T001, T012: 0009_ambassadors.sql on a fresh database: the referrer and referral event checks
  it("applies 0009_ambassadors.sql: no self referrer, from_person only on referrer_changed, person_deleted cause, old kinds kept", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0009_ambassadors.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [p] = await c`insert into persons (first_name, owner_id, created_by) values ('Cara', ${u.id}, ${u.id}) returning id, is_ambassador`;
      const [q] = await c`insert into persons (first_name, owner_id, created_by) values ('Ben', ${u.id}, ${u.id}) returning id`;
      expect(p.is_ambassador).toBe(false);
      expect(await code(c`update persons set referred_by_id = id where id = ${p.id}`)).toBe("23514");
      expect(await code(c`update persons set referred_by_id = ${p.id}, referred_at = now() where id = ${q.id}`)).toBe("ok");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, related_person_id, from_person_id) values (${q.id}, 'referrer_set', ${u.id}, ${p.id}, ${p.id})`)).toBe("23514");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, related_person_id, from_person_id) values (${q.id}, 'referrer_changed', ${u.id}, ${p.id}, ${p.id})`)).toBe("ok");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, cause) values (${q.id}, 'referrer_cleared', ${u.id}, 'person_deleted')`)).toBe("ok");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, cause) values (${q.id}, 'referrer_cleared', ${u.id}, 'other')`)).toBe("23514");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, body) values (${q.id}, 'note', ${u.id}, 'x')`)).toBe("ok");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id) values (${q.id}, 'imported', ${u.id})`)).toBe("ok");
      for (const kind of ["ambassador_added", "ambassador_removed", "referrer_set"]) {
        expect(await code(c`insert into timeline_events (person_id, kind, actor_id) values (${q.id}, ${kind}, ${u.id})`)).toBe("ok");
      }
      // Deleting the referrer clears the columns that name them (the code also clears them itself first).
      await c`delete from persons where id = ${p.id}`;
      const [after] = await c`select referred_by_id from persons where id = ${q.id}`;
      expect(after.referred_by_id).toBeNull();
      const [{ n }] = await c`select count(*)::int as n from timeline_events where from_person_id is not null`;
      expect(n).toBe(0);
    } finally {
      await c.end();
    }
  });

  // covers SF-116 T015, FR-002, FR-007: 0011_files.sql on a fresh database: the file, upload and FILE event checks
  it("applies 0011_files.sql: one record per file, size and name limits, known kinds, FILE event fields, other kinds kept", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0011_files.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [o] = await c`insert into organisations (name, owner_id, created_by) values ('Fakeco', ${u.id}, ${u.id}) returning id`;
      const [p] = await c`insert into persons (first_name, owner_id, created_by) values ('Cara', ${u.id}, ${u.id}) returning id`;
      let n = 0;
      const file = (cols: { org?: number; person?: number; size?: number; name?: string; kind?: string }) =>
        c`insert into files (organisation_id, person_id, name, size, kind, storage_path, added_by)
          values (${cols.org ?? null}, ${cols.person ?? null}, ${cols.name ?? "a.pdf"}, ${cols.size ?? 10}, ${cols.kind ?? "pdf"}, ${`files/x${n++}`}, ${u.id}) returning id`;
      expect(await code(file({ org: o.id }))).toBe("ok");
      expect(await code(file({ org: o.id, person: p.id }))).toBe("23514");
      expect(await code(file({}))).toBe("23514");
      expect(await code(file({ org: o.id, size: 0 }))).toBe("23514");
      expect(await code(file({ org: o.id, size: 26214400 }))).toBe("ok");
      expect(await code(file({ org: o.id, size: 26214401 }))).toBe("23514");
      expect(await code(file({ org: o.id, name: "x".repeat(255) }))).toBe("ok");
      expect(await code(file({ org: o.id, name: "x".repeat(256) }))).toBe("23514");
      expect(await code(file({ org: o.id, kind: "svg" }))).toBe("23514");
      expect(await code(c`insert into file_uploads (organisation_id, person_id, name, size, content_type, storage_path, user_id)
        values (${o.id}, ${p.id}, 'a', 1, 'x', 'files/u1', ${u.id})`)).toBe("23514");
      expect(await code(c`insert into file_uploads (name, size, content_type, storage_path, user_id) values ('a', 1, 'x', 'files/u2', ${u.id})`)).toBe("23514");
      expect(await code(c`insert into file_cleanup (storage_path) values ('files/c1')`)).toBe("ok");
      const [f] = await c`select id from files limit 1`;
      const ev = (kind: string, extra: { file_id?: number; file_name?: string | null; file_size?: number | null; deleted?: number; actor?: number | null }) =>
        c`insert into timeline_events (organisation_id, kind, actor_id, file_id, file_name, file_size, deleted_file_id)
          values (${o.id}, ${kind}, ${extra.actor === undefined ? u.id : extra.actor}, ${extra.file_id ?? null}, ${extra.file_name ?? null},
                  ${extra.file_size ?? null}, ${extra.deleted ?? null})`;
      expect(await code(ev("file_added", { file_id: f.id, file_name: "a.pdf", file_size: 10 }))).toBe("ok");
      expect(await code(ev("file_added", { file_id: f.id, file_size: 10 }))).toBe("23514");
      expect(await code(ev("file_added", { file_id: f.id, file_name: "a.pdf", actor: null }))).toBe("23514");
      expect(await code(ev("file_deleted", { file_name: "a.pdf", deleted: 99 }))).toBe("ok");
      expect(await code(ev("file_deleted", { file_name: "a.pdf" }))).toBe("23514");
      expect(await code(ev("file_deleted", { file_name: "a.pdf", deleted: 99, file_size: 10 }))).toBe("23514");
      expect(await code(ev("file_deleted", { file_name: "a.pdf", deleted: 99, file_id: f.id }))).toBe("23514");
      expect(await code(ev("edited", { file_name: "a.pdf" }))).toBe("23514");
      expect(await code(ev("other_kind", {}))).toBe("23514");
      for (const kind of ["edited", "referrer_set"]) {
        expect(await code(ev(kind, {})), kind).toBe("ok");
      }
      // SF-115's kinds stay allowed (with the field name 0010_custom_fields.sql asks of them).
      for (const kind of ["custom_set", "custom_changed", "custom_cleared"]) {
        expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id, field_name) values (${o.id}, ${kind}, ${u.id}, 'Diet')`), kind).toBe("ok");
      }
      expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id, body) values (${o.id}, 'note', ${u.id}, 'x')`)).toBe("ok");
      // Deleting the file keeps its "added" event, without the link.
      await c`delete from files where id = ${f.id}`;
      const [{ k }] = await c`select count(*)::int as k from timeline_events where kind = 'file_added' and file_id is null`;
      expect(k).toBe(1);
      const rls = await c`select relname from pg_class where relname in ('files', 'file_uploads', 'file_cleanup') and relrowsecurity`;
      expect(rls.map((r) => r.relname).sort()).toEqual(["file_cleanup", "file_uploads", "files"]);
    } finally {
      await c.end();
    }
  });

  // covers SF-120 T005, FR-005, FR-007: 0014_segments.sql on a fresh database: names, who, conditions as a list of at
  // most 20, no foreign keys to things that can be deleted, row level security on
  it("applies 0014_segments.sql: checked names, who and conditions, unique names ignoring case, RLS on", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0014_segments.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const seg = (name: string, who = "everyone", pipeline: number | null = null, stage: number | null = null, status: string | null = null, conditions: unknown = []) =>
        c`insert into segments (name, who, pipeline_id, stage_id, deal_status, conditions, created_by, updated_by)
          values (${name}, ${who}, ${pipeline}, ${stage}, ${status}, ${c.json(conditions as never)}, ${u.id}, ${u.id})`;
      expect(await code(seg("Everyone"))).toBe("ok");
      expect(await code(seg("EVERYONE"))).toBe("23505");
      expect(await code(seg(" padded "))).toBe("23514");
      expect(await code(seg(""))).toBe("23514");
      expect(await code(seg("x".repeat(101)))).toBe("23514");
      expect(await code(seg("x".repeat(100)))).toBe("ok");
      expect(await code(seg("Bad who", "nobody"))).toBe("23514");
      expect(await code(seg("Everyone with pipeline", "everyone", 1, null, "open"))).toBe("23514");
      // No foreign key: a pipeline or stage id that does not exist (deleted) is kept.
      expect(await code(seg("Pipeline", "pipeline", 999, null, "all"))).toBe("ok");
      expect(await code(seg("Pipeline with stage", "pipeline", 999, 5, "open"))).toBe("23514");
      expect(await code(seg("Stage", "stage", 999, 998, "won"))).toBe("ok");
      expect(await code(seg("Stage no stage", "stage", 999, null, "won"))).toBe("23514");
      expect(await code(seg("Bad status", "pipeline", 999, null, "closed"))).toBe("23514");
      expect(await code(seg("Not a list", "everyone", null, null, null, { a: 1 }))).toBe("23514");
      expect(await code(seg("21", "everyone", null, null, null, Array.from({ length: 21 }, () => ({}))))).toBe("23514");
      expect(await code(seg("20", "everyone", null, null, null, Array.from({ length: 20 }, () => ({}))))).toBe("ok");
      const [row] = await c`select version, created_at is not null as at from segments where name = 'Everyone'`;
      expect(row).toEqual({ version: 1, at: true });
      const rls = await c`select relname from pg_class where relname = 'segments' and relrowsecurity`;
      expect(rls.length).toBe(1);
      const idx = await c`select indexname from pg_indexes where indexname in ('segments_name_key', 'deals_stage_live_idx') order by indexname`;
      expect(idx.map((r) => r.indexname)).toEqual(["deals_stage_live_idx", "segments_name_key"]);
    } finally {
      await c.end();
    }
  });

  // covers SF-117 T013, FR-006, FR-017: 0012_pipedrive.sql on a fresh database: connections, imports, links, two new kinds
  it("applies 0012_pipedrive.sql: one open import per user, state and kind checks, link checks, kinds kept and added", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0012_pipedrive.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [o] = await c`insert into organisations (name, owner_id, created_by) values ('Fakeco', ${u.id}, ${u.id}) returning id`;
      const [p] = await c`insert into persons (first_name, owner_id, created_by) values ('Cara', ${u.id}, ${u.id}) returning id`;
      const token = Buffer.alloc(40, 1);
      const conn = (name: string) =>
        c`insert into pipedrive_connections (user_id, token, pipedrive_user_id, pipedrive_user_name, company_id, company_name)
          values (${u.id}, ${token}, 1, 'Fake Person', 1001, ${name}) on conflict (user_id) do update set company_name = excluded.company_name`;
      expect(await code(conn("x".repeat(256)))).toBe("23514");
      expect(await code(conn("Fakeco Pipedrive"))).toBe("ok");
      const imp = (cols: { people?: boolean; orgs?: boolean; consent?: string | null; state?: string; pause?: string | null; finished?: boolean; stop?: string | null }) =>
        c`insert into pipedrive_imports (user_id, company_id, company_name, want_people, want_organisations, consent, state, pause_reason, finished_at, stop_reason)
          values (${u.id}, 1001, 'Fakeco Pipedrive', ${cols.people ?? true}, ${cols.orgs ?? true},
                  ${cols.consent === undefined ? "subscribed" : cols.consent}, ${cols.state ?? "running"}, ${cols.pause ?? null},
                  ${cols.finished ? new Date() : null}, ${cols.stop ?? null}) returning id`;
      expect(await code(imp({ people: false, orgs: false }))).toBe("23514");
      expect(await code(imp({ consent: null }))).toBe("23514");
      expect(await code(imp({ state: "paused" }))).toBe("23514");
      expect(await code(imp({ state: "stopped", finished: true }))).toBe("23514");
      expect(await code(imp({ state: "finished", finished: true }))).toBe("ok");
      expect(await code(imp({}))).toBe("ok");
      expect(await code(imp({ state: "paused", pause: "unreachable" }))).toBe("23505");
      const link = (cols: { kind: string; person?: number | null; org?: number | null; how?: string; id: number }) =>
        c`insert into pipedrive_links (company_id, kind, pipedrive_id, person_id, organisation_id, how)
          values (1001, ${cols.kind}, ${cols.id}, ${cols.person ?? null}, ${cols.org ?? null}, ${cols.how ?? "imported"})`;
      expect(await code(link({ kind: "person", id: 1, person: p.id }))).toBe("ok");
      expect(await code(link({ kind: "person", id: 1, person: p.id }))).toBe("23505");
      expect(await code(link({ kind: "person", id: 2, org: o.id }))).toBe("23514");
      expect(await code(link({ kind: "organisation", id: 2, person: p.id }))).toBe("23514");
      expect(await code(link({ kind: "organisation", id: 2, org: o.id, how: "copied" }))).toBe("23514");
      expect(await code(link({ kind: "organisation", id: 2, org: o.id, how: "linked" }))).toBe("ok");
      // A deleted CRM record keeps its link (both ids null): never imported again.
      await c`delete from persons where id = ${p.id}`;
      const [{ k }] = await c`select count(*)::int as k from pipedrive_links where kind = 'person' and person_id is null`;
      expect(k).toBe(1);
      const ev = (kind: string) => c`insert into timeline_events (organisation_id, kind, actor_id) values (${o.id}, ${kind}, ${u.id})`;
      for (const kind of ["imported", "edited", "pipedrive_imported", "pipedrive_unsubscribed"]) expect(await code(ev(kind)), kind).toBe("ok");
      expect(await code(ev("pipedrive_other"))).toBe("23514");
      expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id, field_name) values (${o.id}, 'custom_set', ${u.id}, 'Diet')`)).toBe("ok");
      expect(await code(c`insert into timeline_events (organisation_id, kind, actor_id, file_name, file_size) values (${o.id}, 'file_added', ${u.id}, 'a.pdf', 1)`)).toBe("ok");
      const rls = await c`select relname from pg_class where relname like 'pipedrive_%' and relkind = 'r' and relrowsecurity`;
      expect(rls.map((r) => r.relname).sort()).toEqual(["pipedrive_connections", "pipedrive_imports", "pipedrive_links"]);
    } finally {
      await c.end();
    }
  });

  // covers SF-120 T005: the segments code keeps to the pooler's limits (no session state); 0014 is transaction-safe
  it("keeps the segments code and 0014_segments.sql free of session state", () => {
    const dir = "src/server/segments";
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(["rules.ts", "reach.ts", "segments.ts"]));
    for (const file of readdirSync(dir)) {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0014_segments.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    expect(migration.match(/create table/gi)?.length).toBe(1);
    expect(migration).toContain("alter table segments enable row level security;");
  });

  // covers SF-121 T004, FR-002, FR-003: 0013_unsubscribe.sql on a fresh database: a distinct 64-hex token for every
  // person (existing rows included), Postgres's own refusals, the three kinds and their checks, other kinds kept
  it("applies 0013_unsubscribe.sql: a distinct token per person, token checks, unsubscribe and consent kinds", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0013_unsubscribe.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      // Rows already there when the column is added: drop it, add people, run the migration's persons statements again.
      await c`alter table persons drop column unsubscribe_token`;
      for (const name of ["Cara", "Dev", "Eve"]) await c`insert into persons (first_name, owner_id, created_by) values (${name}, ${u.id}, ${u.id})`;
      const migration = readFileSync("migrations/0013_unsubscribe.sql", "utf8");
      const personsPart = migration.slice(0, migration.indexOf("alter table timeline_events"));
      await c.unsafe(personsPart);
      const [p] = await c`insert into persons (first_name, owner_id, created_by) values ('Fay', ${u.id}, ${u.id}) returning id, unsubscribe_token`;
      const tokens = (await c`select unsubscribe_token from persons`).map((r) => r.unsubscribe_token as string);
      expect(tokens).toHaveLength(4);
      expect(new Set(tokens).size).toBe(4);
      for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{64}$/);
      expect(await code(c`update persons set unsubscribe_token = 'abc' where id = ${p.id}`)).toBe("23514");
      expect(await code(c`update persons set unsubscribe_token = ${"AB".repeat(32)} where id = ${p.id}`)).toBe("23514");
      expect(await code(c`update persons set unsubscribe_token = ${tokens.find((t) => t !== p.unsubscribe_token)!} where id = ${p.id}`)).toBe("23505");
      const ev = (kind: string, cols: { actor?: number | null; old?: string | null; neu?: string | null } = {}) =>
        c`insert into timeline_events (person_id, kind, actor_id, old_value, new_value)
          values (${p.id}, ${kind}, ${cols.actor === undefined ? u.id : cols.actor}, ${cols.old ?? null}, ${cols.neu ?? null})`;
      expect(await code(ev("unsubscribed_link", { actor: null }))).toBe("ok");
      expect(await code(ev("unsubscribed_mail_app", { actor: null }))).toBe("ok");
      expect(await code(ev("unsubscribed_link"))).toBe("23514");
      expect(await code(ev("unsubscribed_mail_app"))).toBe("23514");
      expect(await code(ev("consent_changed", { old: "Subscribed", neu: "Unsubscribed" }))).toBe("ok");
      expect(await code(ev("consent_changed", { neu: "Unsubscribed" }))).toBe("23514");
      expect(await code(ev("consent_changed", { old: "Subscribed" }))).toBe("23514");
      expect(await code(ev("consent_changed", { actor: null, old: "Subscribed", neu: "Unsubscribed" }))).toBe("23514");
      expect(await code(ev("edited", { old: "x" }))).toBe("23514");
      for (const kind of ["imported", "edited", "pipedrive_imported", "pipedrive_unsubscribed"]) expect(await code(ev(kind)), kind).toBe("ok");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, field_name, new_value) values (${p.id}, 'custom_set', ${u.id}, 'Diet', 'Vegan')`)).toBe("ok");
      expect(await code(ev("unsubscribed_other", { actor: null }))).toBe("23514");
    } finally {
      await c.end();
    }
  });

  // covers SF-121 T004: the unsubscribe code keeps to the pooler's limits; the migration is transaction-safe, no table
  it("keeps the unsubscribe code and 0013_unsubscribe.sql free of session state", () => {
    for (const file of ["src/server/records/unsubscribe.ts", "src/server/records/unsubscribe-rules.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0013_unsubscribe.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    expect(migration).not.toMatch(/create table/i);
  });

  // covers SF-117 T013: the Pipedrive code keeps to the pooler's limits (no session state); the migration is transaction-safe
  it("keeps the Pipedrive code and 0012_pipedrive.sql free of session state", () => {
    const dir = "src/server/pipedrive";
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(["api.ts", "connection.ts", "imports.ts", "rules.ts", "page.ts"]));
    for (const file of readdirSync(dir)) {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0012_pipedrive.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    expect(migration.match(/create table/gi)?.length).toBe(3);
    expect(migration.match(/enable row level security/gi)?.length).toBe(3);
  });

  // covers SF-116 T015: the files code keeps to the pooler's limits (no session state); the migration is transaction-safe
  it("keeps the files code and 0011_files.sql free of session state", () => {
    const dir = "src/server/files";
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(["rules.ts", "storage.ts", "fake-storage.ts", "files.ts"]));
    for (const file of readdirSync(dir)) {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0011_files.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    expect(migration.match(/create table/gi)?.length).toBe(3);
    expect(migration.match(/enable row level security/gi)?.length).toBe(3);
  });

  // covers SF-114 T012: the ambassador code keeps to the pooler's limits (no session state)
  it("keeps the ambassador code and 0009_ambassadors.sql free of session state", () => {
    for (const file of ["src/server/records/ambassadors.ts", "src/server/records/referral-rules.ts", "src/server/records/people.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0009_ambassadors.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toMatch(/'imported'/);
  });

  // covers SF-102 T014: the notes, timeline and notifications code keeps to the pooler's limits (no session state)
  it("keeps the notes, timeline and notifications code free of session state", () => {
    for (const file of ["src/server/records/notes.ts", "src/server/records/timeline.ts", "src/server/notifications.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0007_notes_mentions.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    expect(migration).toMatch(/'note'/);
    expect(migration).toMatch(/'imported'/);
  });

  // covers SF-109 T004, FR-001, FR-014: 0008_activities.sql on a fresh database refuses bad rows and sets links to null
  it("applies 0008_activities.sql: refuses bad activities, a deleted record leaves its activities without the link", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0008_activities.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [o] = await c`insert into organisations (name, owner_id, created_by) values ('Fakeco', ${u.id}, ${u.id}) returning id`;
      const [p] = await c`insert into persons (first_name, last_name, owner_id, created_by) values ('Ada', 'Example', ${u.id}, ${u.id}) returning id`;
      const [pl] = await c`insert into pipelines (name, position) values ('Sales', 1) returning id`;
      const [s] = await c`insert into stages (pipeline_id, name, position) values (${pl.id}, 'Lead in', 1) returning id`;
      const [d] = await c`insert into deals (title, stage_id, owner_id, created_by) values ('Fakeco website', ${s.id}, ${u.id}, ${u.id}) returning id`;
      const add = (over: Record<string, unknown>) => {
        const row = { type: "call", subject: "Call", due_on: "2026-11-25", due_time: null, duration_minutes: null, note: null,
          done_at: null, done_by: null, deal_id: null, person_id: null, organisation_id: null, ...over };
        return c`insert into activities (type, subject, due_on, due_time, duration_minutes, note, done_at, done_by, deal_id, person_id,
                                          organisation_id, assignee_id, created_by, assigned_by)
                 values (${row.type as string}, ${row.subject as string}, ${row.due_on as string}, ${row.due_time as string | null},
                         ${row.duration_minutes as number | null}, ${row.note as string | null}, ${row.done_at as Date | null},
                         ${row.done_by as number | null}, ${row.deal_id as number | null}, ${row.person_id as number | null},
                         ${row.organisation_id as number | null}, ${u.id}, ${u.id}, ${u.id}) returning id`;
      };
      expect(await code(add({ type: "email" }))).toBe("23514");
      for (const subject of [" x", "", "x".repeat(201)]) expect(await code(add({ subject })), subject).toBe("23514");
      expect(await code(add({ duration_minutes: 30 }))).toBe("23514");
      for (const m of [3, 7, 1445]) expect(await code(add({ due_time: "10:00", duration_minutes: m })), String(m)).toBe("23514");
      expect(await code(add({ done_at: new Date() }))).toBe("23514");
      expect(await code(add({ note: "" }))).toBe("23514");
      expect(await code(add({ due_time: "10:00", duration_minutes: 1440, note: "x" }))).toBe("ok");
      const [a] = await add({ deal_id: d.id, person_id: p.id, organisation_id: o.id });
      await c`delete from deals where id = ${d.id}`;
      await c`delete from persons where id = ${p.id}`;
      await c`delete from organisations where id = ${o.id}`;
      const [row] = await c`select deal_id, person_id, organisation_id from activities where id = ${a.id}`;
      expect(row).toEqual({ deal_id: null, person_id: null, organisation_id: null });
      const [kind] = await c`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'timeline_events_kind_check'`;
      expect(kind.def).not.toMatch(/activity/);
    } finally {
      await c.end();
    }
  });

  // covers SF-109 T016: the activities code keeps to the Supabase pooler's limits (no session state)
  it("keeps the activities, timeline, notifications and deals code free of session state", () => {
    for (const file of [
      "src/server/activities/activities.ts", "src/server/activities/list.ts", "src/server/records/timeline.ts",
      "src/server/notifications.ts", "src/server/deals/deals.ts",
    ]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0008_activities.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    expect(migration).not.toMatch(/timeline_events/);
  });

  // covers SF-93 T013: the deals code keeps to the Supabase transaction-mode pooler's limits (no session state)
  it("keeps the deals code free of session state (set, listen, session advisory locks)", () => {
    const dir = "src/server/deals";
    for (const file of readdirSync(dir)) {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    // SF-95 T012: the list and links files are in the folder scanned above; check they exist so the scan covers them.
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(["list.ts", "links.ts"]));
    for (const file of ["0004_pipelines_deals.sql", "0005_deal_page.sql"]) {
      const migration = readFileSync(`migrations/${file}`, "utf8");
      expect(migration, file).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    }
  });

  // covers SF-103 T004, T014, FR-016, FR-017: 0006_csv_imports.sql on a fresh database keeps an import's states consistent
  it("applies 0006_csv_imports.sql: refuses a done import without a report or with its file, a file over 5 MB, deals; accepts an imported event", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0006_csv_imports.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [i] = await c`insert into csv_imports (user_id, kind, file_name, size_bytes) values (${u.id}, 'people', 'a.csv', 10) returning id, status`;
      expect(i.status).toBe("uploading");
      expect(await code(c`update csv_imports set status = 'done', imported_at = now() where id = ${i.id}`)).toBe("23514");
      expect(
        await code(c`update csv_imports set status = 'done', imported_at = now(), report = '{}', content = ${Buffer.from([1])} where id = ${i.id}`),
      ).toBe("23514");
      expect(await code(c`update csv_imports set content = ${Buffer.alloc(5_242_881)} where id = ${i.id}`)).toBe("23514");
      expect(await code(c`update csv_imports set content = ${Buffer.alloc(5_242_880)} where id = ${i.id}`)).toBe("ok");
      expect(await code(c`update csv_imports set status = 'done', imported_at = now(), report = '{}', content = null where id = ${i.id}`)).toBe("ok");
      expect(await code(c`insert into csv_imports (user_id, kind, file_name, size_bytes) values (${u.id}, 'deals', 'a.csv', 10)`)).toBe("23514");
      expect(await code(c`insert into csv_imports (user_id, kind, file_name, size_bytes) values (${u.id}, 'people', 'a.csv', 5242881)`)).toBe("23514");
      const [person] = await c`insert into persons (first_name, owner_id, created_by) values ('Ada', ${u.id}, ${u.id}) returning id`;
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id) values (${person.id}, 'imported', ${u.id})`)).toBe("ok");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, body) values (${person.id}, 'note', ${u.id}, 'A fake note')`)).toBe("ok");
    } finally {
      await c.end();
    }
  });

  // covers SF-103 T014: the import code keeps to the Supabase transaction-mode pooler's limits (no session state)
  it("keeps the import code free of session state (set, listen, session advisory locks)", () => {
    const dir = "src/server/imports";
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(["csv.ts", "columns.ts", "rows.ts", "plan.ts", "imports.ts"]));
    for (const file of readdirSync(dir)) {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0006_csv_imports.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
  });

  // covers SF-115 T013: Supabase's transaction-mode pooler limits (no session state) and 0010_custom_fields.sql's checks
  it("keeps the custom fields code and 0010_custom_fields.sql free of session state", () => {
    const files = readdirSync("src/server/custom-fields").map((f) => `src/server/custom-fields/${f}`);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of [...files, "src/server/imports/imports.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
      expect(text, file).not.toMatch(/pg_advisory_lock\(|pg_try_advisory_lock\(/);
    }
    const migration = readFileSync("migrations/0010_custom_fields.sql", "utf8");
    expect(migration).not.toMatch(/\b(begin|commit|concurrently|vacuum)\b/i);
    for (const table of ["custom_fields", "custom_field_choices", "custom_values"]) {
      expect(migration).toContain(`alter table ${table} enable row level security;`);
    }
  });

  it("applies 0010_custom_fields.sql: refuses bad fields, values and custom events; keeps every kind, SF-116's included", async () => {
    const db = await scratchDb();
    const run = await runMigrate(db);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("Applied 0010_custom_fields.sql");
    const c = postgres(urlFor(db), { max: 1, onnotice: () => {} });
    try {
      const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code);
      const [u] = await c`insert into users (email, name) values ('ada@barnacle.ai', 'Ada') returning id`;
      const [p] = await c`insert into persons (first_name, owner_id, created_by) values ('Cara', ${u.id}, ${u.id}) returning id`;
      const [o] = await c`insert into organisations (name, owner_id, created_by) values ('Fakeco', ${u.id}, ${u.id}) returning id`;
      expect(await code(c`insert into custom_fields (kind, name, type, position) values ('person', ${"x".repeat(61)}, 'text', 1)`)).toBe("23514");
      expect(await code(c`insert into custom_fields (kind, name, type, position) values ('person', 'Colour', 'colour', 1)`)).toBe("23514");
      const [f] = await c`insert into custom_fields (kind, name, type, position) values ('person', 'Diet', 'text', 1) returning id`;
      expect(await code(c`insert into custom_fields (kind, name, type, position) values ('person', 'diet', 'text', 2)`)).toBe("23505");
      expect(await code(c`insert into custom_fields (kind, name, type, position) values ('deal', 'diet', 'text', 1)`)).toBe("ok");
      expect(await code(c`insert into custom_values (field_id, person_id, text_value, bool_value) values (${f.id}, ${p.id}, 'x', true)`)).toBe("23514");
      expect(await code(c`insert into custom_values (field_id, person_id, organisation_id, text_value) values (${f.id}, ${p.id}, ${o.id}, 'x')`)).toBe("23514");
      expect(await code(c`insert into custom_values (field_id, person_id, text_value) values (${f.id}, ${p.id}, '')`)).toBe("23514");
      expect(await code(c`insert into custom_values (field_id, person_id, text_value) values (${f.id}, ${p.id}, 'Vegan')`)).toBe("ok");
      expect(await code(c`insert into custom_values (field_id, person_id, text_value) values (${f.id}, ${p.id}, 'Again')`)).toBe("23505");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id) values (${p.id}, 'custom_set', ${u.id})`)).toBe("23514");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, old_value) values (${p.id}, 'edited', ${u.id}, 'x')`)).toBe("23514");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, field_name, new_value) values (${p.id}, 'custom_set', ${u.id}, 'Diet', 'Vegan')`)).toBe("ok");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, body) values (${p.id}, 'note', ${u.id}, 'x')`)).toBe("ok");
      for (const kind of ["imported", "referrer_set"]) {
        expect(await code(c`insert into timeline_events (person_id, kind, actor_id) values (${p.id}, ${kind}, ${u.id})`), kind).toBe("ok");
      }
      // SF-116's kinds stay allowed (with the fields 0011_files.sql asks of them).
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, file_name, file_size) values (${p.id}, 'file_added', ${u.id}, 'a.pdf', 10)`), "file_added").toBe("ok");
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, file_name, deleted_file_id) values (${p.id}, 'file_deleted', ${u.id}, 'a.pdf', 99)`), "file_deleted").toBe("ok");
      const [q] = await c`insert into persons (first_name, owner_id, created_by) values ('Ben', ${u.id}, ${u.id}) returning id`;
      expect(await code(c`insert into timeline_events (person_id, kind, actor_id, related_person_id, from_person_id) values (${q.id}, 'referrer_changed', ${u.id}, ${p.id}, ${p.id})`)).toBe("ok");
      // A field delete takes its values with it.
      await c`delete from custom_fields where id = ${f.id}`;
      const [{ n }] = await c`select count(*)::int as n from custom_values`;
      expect(n).toBe(0);
    } finally {
      await c.end();
    }
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
