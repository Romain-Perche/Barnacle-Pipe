// covers FR-025, FR-026, US3 scenarios 1, 2 and 4, SC-007
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { runSeeders } from "@/seed";
import { count, resetDb } from "./db-helpers";

beforeEach(resetDb);
afterAll(closeDb);

const FAKE_TEAM = [
  { email: "ada@barnacle.ai", name: "Ada Fake", role: "admin", status: "active" },
  { email: "alan@barnacle.ai", name: "Alan Fake", role: "user", status: "deactivated" },
  { email: "grace@barnacle.ai", name: "Grace Fake", role: "admin", status: "active" },
  { email: "linus@barnacle.ai", name: "Linus Fake", role: "user", status: "active" },
  { email: "margaret@barnacle.ai", name: "Margaret Fake", role: "user", status: "active" },
];

async function users() {
  return sql`select email, name, role, status from users order by email`;
}

function seedCommand(env: Record<string, string | undefined>) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "APP_ENV" && k !== "VERCEL_ENV"));
  for (const [k, v] of Object.entries(env)) if (v !== undefined) base[k] = v;
  return spawnSync("npx", ["tsx", "scripts/seed.ts"], { env: base as NodeJS.ProcessEnv, encoding: "utf8" });
}

describe("fake data", () => {
  it("creates the 5 fake users, and running it twice changes nothing", async () => {
    const first = await runSeeders(sql);
    expect(first.filter((l) => l.startsWith("created ")).length).toBe(5);
    expect(await users()).toEqual(FAKE_TEAM);
    expect(await count("user_changes")).toBe(5);
    const second = await runSeeders(sql);
    expect(second.every((l) => l.startsWith("already there "))).toBe(true);
    expect(await users()).toEqual(FAKE_TEAM);
    expect(await count("user_changes")).toBe(5);
  });

  it("the command prints the users it created and exits 0 in test", async () => {
    const run = seedCommand({ APP_ENV: "test" });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("created ada@barnacle.ai (admin, active)");
    expect(run.stdout).toContain("created alan@barnacle.ai (user, deactivated)");
    const again = seedCommand({ APP_ENV: "development" });
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("already there ada@barnacle.ai");
    expect(await count("users")).toBe(5);
  });

  it.each([
    { APP_ENV: "production" },
    { APP_ENV: "Development" },
    { APP_ENV: "" },
    { APP_ENV: undefined },
    { APP_ENV: "development", VERCEL_ENV: "production" },
    { APP_ENV: "development", VERCEL_ENV: "preview" },
    { APP_ENV: "test", VERCEL_ENV: "preview" },
  ])("is refused with %o, prints the message, exits 1 and changes nothing", async (env) => {
    const run = seedCommand(env);
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("Fake data can only be loaded when APP_ENV is development or test.");
    expect(await count("users")).toBe(0);
  });

  it("is refused before any database connection (works with no DATABASE_URL)", () => {
    const run = seedCommand({ APP_ENV: "production", DATABASE_URL: "" });
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("Fake data can only be loaded when APP_ENV is development or test.");
  });
});

// covers FR-027, SC-007: fake people and organisations
import { listOrganisations, organisationFilterOptions } from "@/server/records/organisations";
import { ORGANISATION_SORTS, PEOPLE_SORTS, parseOrganisationsQuery, parsePeopleQuery } from "@/server/records/list-query";
import { listPeople, peopleFilterOptions } from "@/server/records/people";
import { SIZES } from "@/server/records/rules";

describe("fake people and organisations", () => {
  async function counts() {
    const tables = ["persons", "organisations", "labels", "person_emails", "person_phones", "person_labels", "timeline_events"] as const;
    return Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)])));
  }

  it("adds at least 30 people and 8 organisations, and running it again adds nothing", async () => {
    await runSeeders(sql);
    const first = await counts();
    expect(first.persons).toBeGreaterThanOrEqual(30);
    expect(first.organisations).toBeGreaterThanOrEqual(8);
    expect(first.labels).toBe(3);
    const again = await runSeeders(sql);
    expect(again.every((l) => l.startsWith("already there "))).toBe(true);
    expect(await counts()).toEqual(first);
  });

  it("covers every lead source, label, consent, size, owner, archived and private case with fake names", async () => {
    await runSeeders(sql);
    const [c] = await sql`
      select (select count(distinct lead_source_id) from persons) as sources,
             (select count(distinct label_id) from person_labels) as labels,
             (select count(distinct consent) from persons) as consents,
             (select count(distinct size) from organisations where archived_at is null) as sizes,
             (select count(distinct owner_id) from persons) as owners,
             (select count(*) from persons where organisation_id is null) as no_org,
             (select count(*) from persons where archived_at is not null) as archived_people,
             (select count(*) from organisations where archived_at is not null) as archived_orgs,
             (select count(*) from persons p join users u on u.id = p.created_by where p.private and u.name = 'Ada Fake') as private_by_ada,
             (select count(*) from persons p where (select count(*) from person_emails e where e.person_id = p.id) > 1) as many_emails,
             (select count(*) from person_emails where email not like '%@example.com' and email not like '%@example.net') as real_looking`;
    expect(Number(c.sources)).toBe(6);
    expect(Number(c.labels)).toBe(3);
    expect(Number(c.consents)).toBe(2);
    expect(Number(c.sizes)).toBe(SIZES.length);
    expect(Number(c.owners)).toBe(4);
    expect(Number(c.no_org)).toBeGreaterThan(0);
    expect(Number(c.archived_people)).toBeGreaterThan(0);
    expect(Number(c.archived_orgs)).toBeGreaterThan(0);
    expect(Number(c.private_by_ada)).toBeGreaterThan(0);
    expect(Number(c.many_emails)).toBeGreaterThan(0);
    expect(Number(c.real_looking)).toBe(0);
  });

  it("gives every filter and sort option of both lists at least one row (SC-007)", async () => {
    await runSeeders(sql);
    const [ada] = await sql<{ id: number }[]>`select id::int as id from users where name = 'Ada Fake'`;
    const p = await peopleFilterOptions(ada.id, null);
    const checks: Record<string, string>[] = [
      ...p.owners.map((o) => ({ owner: String(o.id) })),
      ...p.labels.map((o) => ({ label: String(o.id) })),
      ...p.sources.map((o) => ({ source: String(o.id) })),
      ...p.organisations.map((o) => ({ org: String(o.id) })),
      { consent: "subscribed" },
      { consent: "unsubscribed" },
      ...PEOPLE_SORTS.flatMap((sort): Record<string, string>[] => [{ sort }, { sort, dir: "desc" }]),
    ];
    for (const q of checks) expect((await listPeople(ada.id, parsePeopleQuery(q))).total, JSON.stringify(q)).toBeGreaterThan(0);
    const o = await organisationFilterOptions();
    const orgChecks: Record<string, string>[] = [
      ...o.owners.map((x) => ({ owner: String(x.id) })),
      ...o.sectors.map((sector) => ({ sector })),
      ...SIZES.map((size) => ({ size })),
      ...ORGANISATION_SORTS.flatMap((sort): Record<string, string>[] => [{ sort }, { sort, dir: "desc" }]),
    ];
    for (const q of orgChecks) expect((await listOrganisations(ada.id, parseOrganisationsQuery(q))).total, JSON.stringify(q)).toBeGreaterThan(0);
    // The acceptance example of US3: lead source "Exec dinner" and owner "Ada Fake".
    const exec = p.sources.find((s) => s.name === "Exec dinner")!;
    expect((await listPeople(ada.id, parsePeopleQuery({ source: String(exec.id), owner: String(ada.id) }))).total).toBeGreaterThan(0);
  });
});
