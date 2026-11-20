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
    expect(Number(c.owners)).toBe(5); // the four active fake users, and Alan Fake's private people (SF-92)
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

// covers FR-021 (SF-93): fake pipelines and deals, idempotent
describe("fake pipelines and deals", () => {
  async function snapshot() {
    return {
      pipelines: await sql`select name, position from pipelines order by position`,
      stages: await count("stages"),
      deals: await count("deals"),
      periods: await count("deal_stage_periods"),
      events: await sql`select count(*)::int as n from timeline_events where deal_id is not null`,
    };
  }

  it("adds the five pipelines and at least 40 varied deals, and a second run adds nothing", async () => {
    await runSeeders(sql);
    const pipelines = await sql<{ id: number; name: string }[]>`select id::int as id, name from pipelines order by position, id`;
    expect(pipelines.map((p) => p.name)).toEqual(["Sales", "Ambassadors", "Fractional CTO", "Exec Dinner", "Ada Fake's pipeline"]);
    for (const p of pipelines) {
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from stages where pipeline_id = ${p.id}`;
      expect(n, p.name).toBeGreaterThanOrEqual(3);
      expect(n, p.name).toBeLessThanOrEqual(7);
    }
    const [stats] = await sql<
      { total: number; owners: number; with_value: number; without_value: number; with_org: number; without_org: number;
        with_person: number; without_person: number; archived: number; private_by_ada: number; titles: number }[]
    >`
      select count(*)::int as total, count(distinct owner_id)::int as owners,
             count(value_pence)::int as with_value, (count(*) - count(value_pence))::int as without_value,
             count(organisation_id)::int as with_org, (count(*) - count(organisation_id))::int as without_org,
             count(person_id)::int as with_person, (count(*) - count(person_id))::int as without_person,
             count(*) filter (where archived_at is not null)::int as archived,
             count(*) filter (where private and created_by = (select id from users where name = 'Ada Fake'))::int as private_by_ada,
             count(distinct title)::int as titles
      from deals`;
    expect(stats.total).toBeGreaterThanOrEqual(40);
    expect(stats.titles).toBe(stats.total);
    expect(stats.owners).toBeGreaterThanOrEqual(3);
    for (const k of ["with_value", "without_value", "with_org", "without_org", "with_person", "without_person", "archived", "private_by_ada"] as const) {
      expect(stats[k], k).toBeGreaterThanOrEqual(1);
    }
    // Sales "Closing" is left empty; every pipeline has deals.
    const [closing] = await sql<{ n: number }[]>`
      select count(d.id)::int as n from stages s join pipelines p on p.id = s.pipeline_id left join deals d on d.stage_id = s.id
      where p.name = 'Sales' and s.name = 'Closing'`;
    expect(closing.n).toBe(0);
    const empty = await sql`select p.name from pipelines p where not exists (select 1 from deals d join stages s on s.id = d.stage_id where s.pipeline_id = p.id)`;
    expect(empty).toEqual([]);
    // Every open deal: exactly one open stage period (in its stage); a won or lost deal none (SF-95: Won and Lost close
    // it). Every deal has an "added" event; some were moved.
    const bad = await sql`
      select d.id from deals d
      where (d.status = 'open' and (select count(*) from deal_stage_periods x where x.deal_id = d.id and x.left_at is null and x.stage_id = d.stage_id) <> 1)
         or (select count(*) from deal_stage_periods x where x.deal_id = d.id and x.left_at is null) <> (case when d.status = 'open' then 1 else 0 end)
         or not exists (select 1 from timeline_events e where e.deal_id = d.id and e.kind = 'added')`;
    expect(bad).toEqual([]);
    const [moved] = await sql<{ n: number }[]>`select count(*)::int as n from timeline_events where kind = 'moved'`;
    expect(moved.n).toBeGreaterThanOrEqual(1);

    const before = await snapshot();
    const lines = await runSeeders(sql);
    expect(lines).toContain("already there pipelines and deals");
    expect(await snapshot()).toEqual(before);
  });
});

// covers FR-015 (SF-92): fake private people owned by someone other than their creator, and by deactivated Alan Fake
describe("fake private people (SF-92)", () => {
  it("adds a private person whose owner is not their creator and private people owned by Alan Fake, once", async () => {
    await runSeeders(sql);
    const [c] = await sql`
      select (select count(*)::int from persons where private and owner_id <> created_by) as owner_not_creator,
             (select count(*)::int from persons p join users u on u.id = p.owner_id where p.private and u.name = 'Alan Fake') as alans,
             (select count(*)::int from timeline_events e join organisations o on o.id = e.organisation_id
               join persons p on p.id = e.related_person_id where p.private and o.name = 'Fakeco Ltd') as linked`;
    expect(c.owner_not_creator).toBeGreaterThanOrEqual(1);
    expect(c.alans).toBe(2);
    expect(c.linked).toBeGreaterThanOrEqual(1);
    const people = await sql`select first_name || ' ' || last_name as name from persons where private order by 1`;
    expect(people.map((p) => p.name)).toEqual(expect.arrayContaining(["Pat Privatefake", "Robin Leftfake", "Sam Leftfake"]));
    const rows = await count("persons");
    const events = await count("timeline_events");
    await runSeeders(sql);
    expect(await count("persons")).toBe(rows);
    expect(await count("timeline_events")).toBe(events);
  });
});

// covers SF-95 FR-023, T051: won and lost deals, deal labels, other linked people and followers, idempotent
describe("fake deal results, labels, links and followers (SF-95)", () => {
  async function snapshot() {
    return {
      deals: await count("deals"),
      labels: await count("deal_labels"),
      labelLinks: await count("deal_label_links"),
      people: await count("deal_people"),
      followers: await count("deal_followers"),
      events: await count("timeline_events"),
      periods: await count("deal_stage_periods"),
    };
  }

  it("adds won, lost and an archived lost deal with histories, at least 4 deal labels, links and followers, once", async () => {
    await runSeeders(sql);
    const [c] = await sql<
      { won: number; lost: number; archived_lost: number; reasons: number; labels: number; labelled: number; linked: number; followed: number;
        multi_stage: number; won_events: number; lost_events: number }[]
    >`
      select (select count(*)::int from deals where status = 'won') as won,
             (select count(*)::int from deals where status = 'lost') as lost,
             (select count(*)::int from deals where status = 'lost' and archived_at is not null) as archived_lost,
             (select count(*)::int from deals where status = 'lost' and lost_reason ilike '%fake%') as reasons,
             (select count(*)::int from deal_labels) as labels,
             (select count(distinct deal_id)::int from deal_label_links) as labelled,
             (select count(distinct deal_id)::int from deal_people) as linked,
             (select count(distinct deal_id)::int from deal_followers) as followed,
             (select count(*)::int from (select deal_id from deal_stage_periods group by deal_id having count(distinct stage_id) >= 3) x) as multi_stage,
             (select count(*)::int from timeline_events where kind = 'won') as won_events,
             (select count(*)::int from timeline_events where kind = 'lost' and reason is not null) as lost_events`;
    expect(c.won).toBeGreaterThanOrEqual(3);
    expect(c.lost).toBeGreaterThanOrEqual(3);
    expect(c.archived_lost).toBeGreaterThanOrEqual(1);
    expect(c.reasons).toBe(c.lost);
    expect(c.labels).toBeGreaterThanOrEqual(4);
    expect(c.labelled).toBeGreaterThanOrEqual(8);
    expect(c.linked).toBeGreaterThanOrEqual(5);
    expect(c.followed).toBeGreaterThanOrEqual(5);
    expect(c.multi_stage).toBeGreaterThanOrEqual(2);
    expect(c.won_events).toBe(c.won);
    expect(c.lost_events).toBe(c.lost);
    // Never the main person, never a private person, among other linked people.
    const wrong = await sql`
      select 1 from deal_people dp join deals d on d.id = dp.deal_id join persons p on p.id = dp.person_id
      where dp.person_id = d.person_id or p.private`;
    expect(wrong).toEqual([]);

    const before = await snapshot();
    await runSeeders(sql);
    expect(await snapshot()).toEqual(before);
  });
});
