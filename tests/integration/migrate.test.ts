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
