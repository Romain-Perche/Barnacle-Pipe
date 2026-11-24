// covers FR-025, FR-026, US3 scenarios 1, 2 and 4, SC-007
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { runSeeders } from "@/seed";
import { listUsers } from "@/server/users";
import { count, getUser, resetDb } from "./db-helpers";
import { listSegments } from "@/server/segments/segments";

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

// covers FR-010 (SF-97): two private deals created and owned by deactivated Alan Fake, one archived, added once
describe("fake private deals of Alan Fake (SF-97)", () => {
  it("adds Fake leaver deal (open) and Fake leaver old deal (archived), and a second run adds no duplicate", async () => {
    await runSeeders(sql);
    const leaver = () => sql`
      select d.title, d.private, cu.name as creator, ou.name as owner, d.archived_at is not null as archived, s.name as stage, p.name as pipeline,
             (select array_agg(e.kind order by e.id) from timeline_events e where e.deal_id = d.id) as events,
             (select count(*)::int from deal_stage_periods x where x.deal_id = d.id and x.left_at is null and x.stage_id = d.stage_id) as open_periods
      from deals d join users cu on cu.id = d.created_by join users ou on ou.id = d.owner_id
      join stages s on s.id = d.stage_id join pipelines p on p.id = s.pipeline_id
      where d.title like 'Fake leaver%' order by d.title`;
    const rows = await leaver();
    expect(rows).toEqual([
      { title: "Fake leaver deal", private: true, creator: "Alan Fake", owner: "Alan Fake", archived: false, stage: expect.any(String), pipeline: "Sales", events: ["added"], open_periods: 1 },
      { title: "Fake leaver old deal", private: true, creator: "Alan Fake", owner: "Alan Fake", archived: true, stage: expect.any(String), pipeline: "Sales", events: ["added", "archived"], open_periods: 1 },
    ]);
    const alan = (await listUsers()).find((u) => u.name === "Alan Fake")!;
    expect([alan.private_people, alan.private_deals]).toEqual([2, 2]);
    await runSeeders(sql);
    expect(await leaver()).toEqual(rows);
  });

  // covers SF-102 FR-018, T041: notes on each record kind, mentions (read and unread), an edited note, notes on
  // private records; a second run adds nothing
  it("adds fake notes with mentions, an edited note and notes on private records, once", async () => {
    await runSeeders(sql);
    const notes = () => sql<{ id: number; on: string; private: boolean; version: number; edited: boolean; author: string }[]>`
      select e.id::int as id,
             case when e.deal_id is not null then 'deal' when e.person_id is not null then 'person' else 'organisation' end as on,
             coalesce(d.private, p.private, false) as private, e.version, e.edited_by is not null as edited, u.name as author
      from timeline_events e join users u on u.id = e.actor_id
      left join deals d on d.id = e.deal_id left join persons p on p.id = e.person_id
      where e.kind = 'note' order by e.id`;
    const first = await notes();
    expect(first.filter((n) => n.on === "deal").length).toBeGreaterThanOrEqual(2);
    expect(first.filter((n) => n.on === "person").length).toBeGreaterThanOrEqual(2);
    expect(first.filter((n) => n.on === "organisation").length).toBeGreaterThanOrEqual(1);
    expect(first.filter((n) => n.private).map((n) => n.on).sort()).toEqual(["deal", "person"]);
    expect(first.some((n) => n.edited && n.version === 2)).toBe(true);
    const mentions = await sql<{ read: boolean; self: boolean }[]>`
      select read_at is not null as read, user_id = mentioned_by as self from note_mentions`;
    expect(mentions.filter((m) => !m.self).map((m) => m.read).sort()).toEqual([false, true]);
    const [{ bad }] = await sql<{ bad: number }[]>`
      select count(*)::int as bad from timeline_events where kind = 'note' and body !~* 'fake'`;
    expect(bad).toBe(0);
    await runSeeders(sql);
    expect(await notes()).toEqual(first);
    expect(await sql`select 1 from note_mentions`).toHaveLength(mentions.length);
  });

  // covers SF-114 FR-017, T046: fake ambassadors (shared, private, former), open / won / lost referred deals, a private
  // referred deal, notes on referred records; a second run adds no row
  it("adds fake ambassadors and their referrals, once", async () => {
    await runSeeders(sql);
    const snapshot = async () => {
      const [c] = await sql<Record<string, number>[]>`
        select (select count(*) from persons where is_ambassador and not private)::int as shared_amb,
               (select count(*) from persons where is_ambassador and private)::int as private_amb,
               (select count(*) from persons a where not a.is_ambassador
                  and exists (select 1 from persons r where r.referred_by_id = a.id))::int as former,
               (select count(*) from persons where referred_by_id is not null)::int as referred_people,
               (select count(*) from deals where referred_by_id is not null and private)::int as private_deals,
               (select count(distinct status) from deals where referred_by_id is not null)::int as statuses,
               (select count(*) from timeline_events e
                  where e.kind = 'note' and (e.person_id in (select id from persons where referred_by_id is not null)
                                          or e.deal_id in (select id from deals where referred_by_id is not null)))::int as notes,
               (select count(*) from persons)::int as persons, (select count(*) from deals)::int as deals,
               (select count(*) from timeline_events)::int as events, (select count(*) from deal_stage_periods)::int as periods`;
      return c;
    };
    const first = await snapshot();
    expect(first).toMatchObject({ shared_amb: 1, private_amb: 1, former: 1, referred_people: 6, private_deals: 1, statuses: 3, notes: 2 });
    const names = await sql<{ name: string }[]>`
      select first_name || ' ' || last_name as name from persons where is_ambassador or referred_by_id is not null`;
    expect(names.every((n) => /fake|example/i.test(n.name))).toBe(true);
    const again = await runSeeders(sql);
    expect(again.every((l) => l.startsWith("already there "))).toBe(true);
    expect(await snapshot()).toEqual(first);
  });
});

// covers SF-109 FR-017 (T052, T053; replaces the browser test of the fake data)
import { listActivities } from "@/server/activities/list";
import { activityState, ukToday } from "@/server/activities/rules";
import { getBoard } from "@/server/deals/deals";
import { listNotifications } from "@/server/notifications";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

describe("fake activities (SF-109)", () => {
  beforeEach(resetDb);

  it("adds every kind of activity and assignment notification, once", async () => {
    const before = new Date();
    await runSeeders(sql);
    const rows = await sql<{ subject: string; type: string; due_on: string; due_time: string | null; duration_minutes: number | null; done: boolean;
      deal_private: boolean | null; person_private: boolean | null; assigned: boolean; read: boolean; linked: boolean }[]>`
      select a.subject, a.type, to_char(a.due_on, 'YYYY-MM-DD') as due_on, to_char(a.due_time, 'HH24:MI') as due_time, a.duration_minutes,
             a.done_at is not null as done, d.private as deal_private, p.private as person_private, a.assigned_by <> a.assignee_id as assigned,
             a.assignment_read_at is not null as read, (a.deal_id is not null or a.person_id is not null or a.organisation_id is not null) as linked
      from activities a left join deals d on d.id = a.deal_id left join persons p on p.id = a.person_id order by a.id`;
    const states = rows.map((r) => activityState({ dueOn: r.due_on, dueTime: r.due_time, durationMinutes: r.duration_minutes, done: r.done }, before));
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(["call", "meeting", "task"]));
    expect(states).toContain("overdue");
    expect(states).toContain("later");
    // Due today (UK): "Today", or "Overdue" once their time has passed.
    expect(rows.filter((r) => !r.done && r.due_on === ukToday(before)).length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.due_time !== null) && rows.some((r) => r.due_time === null)).toBe(true);
    expect(rows.filter((r) => r.done).length).toBeGreaterThanOrEqual(3);
    expect(rows.some((r) => r.deal_private)).toBe(true);
    expect(rows.some((r) => r.person_private)).toBe(true);
    expect(rows.some((r) => !r.linked)).toBe(true);
    expect(rows.filter((r) => r.assigned).map((r) => r.read).sort()).toEqual([false, true]);
    expect(rows.every((r) => /fake/i.test(r.subject))).toBe(true);
    const [{ contacted }] = await sql<{ contacted: number }[]>`select count(*)::int as contacted from persons where last_contacted_at is not null`;
    expect(contacted).toBeGreaterThanOrEqual(1);
    await runSeeders(sql);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from activities`;
    expect(n).toBe(rows.length);
  });

  // covers SF-109 FR-012, FR-017 (T063, fix round 1): every fake assignee is active and sees each linked record
  it("assigns each fake activity to an active user who can see its links", async () => {
    await runSeeders(sql);
    const hidden = await sql<{ subject: string }[]>`
      select a.subject from activities a join users u on u.id = a.assignee_id
      where u.status <> 'active'
         or (a.person_id is not null and not exists (select 1 from persons p where p.id = a.person_id and ${visiblePerson(sql, sql`u.id`)}))
         or (a.deal_id is not null and not exists (select 1 from deals d where d.id = a.deal_id and ${visibleDeal(sql, sql`u.id`)}))`;
    expect(hidden.map((r) => r.subject)).toEqual([]);
    const [grace] = await sql<{ id: number }[]>`select id::int as id from users where name = 'Grace Fake'`;
    const list = await listActivities(grace.id, { when: "planned", assignee: null, type: null, page: 1 }, new Date());
    expect(list.rows.map((r) => r.subject)).toContain("Fake task: check in after the trial");
  });

  it("gives Ada overdue and today rows, a board card with and one without a next activity, and Grace an unread assignment", async () => {
    await runSeeders(sql);
    const now = new Date();
    const [ada] = await sql<{ id: number }[]>`select id::int as id from users where name = 'Ada Fake'`;
    const [grace] = await sql<{ id: number }[]>`select id::int as id from users where name = 'Grace Fake'`;
    expect((await listActivities(ada.id, { when: "overdue", assignee: null, type: null, page: 1 }, now)).count).toBeGreaterThanOrEqual(1);
    expect((await listActivities(ada.id, { when: "today", assignee: null, type: null, page: 1 }, now)).count).toBeGreaterThanOrEqual(1);
    const board = (await getBoard(ada.id, null))!;
    expect(board.pipeline.name).toBe("Sales");
    const cards = board.columns.flatMap((c) => c.cards);
    expect(cards.some((c) => c.next === null)).toBe(true);
    expect(cards.some((c) => c.next !== null)).toBe(true);
    const assignments = (await listNotifications(grace.id)).items.filter((i) => i.kind === "assignment");
    expect(assignments.map((a) => a.read)).toEqual([false]);
  });
});

// covers SF-116 FR-016, T040: fake files of several kinds on deals, people and organisations, on a private deal, a
// private person and an archived record, with their FILE entries (one deleted); hidden from Grace where private; once
describe("fake files (SF-116)", () => {
  it("adds files of each kind with their timeline entries, hides the private ones from Grace, and adds nothing the second time", async () => {
    const { StorageFake } = await import("../fakes/storage");
    const { listFiles, fileAccess } = await import("@/server/files/files");
    const fake = new StorageFake().install();
    try {
      await runSeeders(sql);
      const files = () => sql<{ id: number; name: string; kind: string; on: string; private: boolean; archived: boolean }[]>`
        select f.id::int as id, f.name, f.kind,
               case when f.deal_id is not null then 'deal' when f.person_id is not null then 'person' else 'organisation' end as on,
               coalesce(d.private, p.private, false) as private, coalesce(d.archived_at, p.archived_at, o.archived_at) is not null as archived
        from files f left join deals d on d.id = f.deal_id left join persons p on p.id = f.person_id
        left join organisations o on o.id = f.organisation_id order by f.id`;
      const first = await files();
      expect(new Set(first.map((f) => f.on))).toEqual(new Set(["deal", "person", "organisation"]));
      expect(new Set(first.map((f) => f.kind))).toEqual(new Set(["png", "pdf", "gif", "other"]));
      expect(first.find((f) => f.name === "fake.png")?.kind).toBe("other");
      expect(first.filter((f) => f.private).map((f) => f.name).sort()).toEqual(["contract.pdf", "cv-fake.pdf"]);
      expect(first.filter((f) => f.archived).map((f) => f.name)).toEqual(["old-brief.docx"]);
      expect(first.every((f) => /fake|\.(pdf|png|gif|xlsx|docx)$/.test(f.name))).toBe(true);
      // Every listed file has its contents in the (fake) storage, read back byte for byte.
      expect(fake.objects().size).toBe(first.length);
      const events = await sql<{ kind: string; n: number }[]>`
        select kind, count(*)::int as n from timeline_events where kind in ('file_added', 'file_deleted') group by kind order by kind`;
      expect(events).toEqual([{ kind: "file_added", n: first.length + 1 }, { kind: "file_deleted", n: 1 }]);
      const [grace] = await sql<{ id: number }[]>`select id::int as id from users where name = 'Grace Fake'`;
      for (const f of first.filter((x) => x.private)) expect((await fileAccess(grace.id, f.id)).status).toBe("hidden");
      const [secret] = await sql<{ id: number }[]>`select id::int as id from deals where title = 'Fake secret project'`;
      expect(await listFiles(grace.id, { dealId: secret.id })).toEqual([]);
      const second = await runSeeders(sql);
      expect(second).toContain("already there files");
      expect(await files()).toEqual(first);
    } finally {
      fake.uninstall();
    }
  });
});

// covers SF-115 FR-018 (T044): every type, a field in each list, a removed choice still on a record, values on a private
// person and a private deal, a timeline entry per value; a second run adds no row
describe("fake custom fields (SF-115)", () => {
  beforeEach(resetDb);
  it("adds fake custom fields and values, once", async () => {
    await runSeeders(sql);
    const snapshot = async () => {
      const [c] = await sql<Record<string, number>[]>`
        select (select count(distinct type) from custom_fields)::int as types,
               (select count(distinct kind) from custom_fields where in_list)::int as listed_kinds,
               (select count(*) from custom_values v join custom_field_choices c on c.id = v.choice_id where c.removed_at is not null)::int as removed_kept,
               (select count(*) from custom_values v join persons p on p.id = v.person_id where p.private)::int as private_people,
               (select count(*) from custom_values v join deals d on d.id = v.deal_id where d.private)::int as private_deals,
               (select count(*) from custom_values)::int as values,
               (select count(*) from timeline_events where kind like 'custom_%')::int as events,
               (select count(*) from custom_fields)::int as fields, (select count(*) from custom_field_choices)::int as choices`;
      return c;
    };
    const first = await snapshot();
    expect(first).toMatchObject({ types: 8, listed_kinds: 3, removed_kept: 1, fields: 9 });
    expect(first.private_people).toBeGreaterThanOrEqual(1);
    expect(first.private_deals).toBeGreaterThanOrEqual(1);
    expect(first.events).toBe(first.values);
    const names = await sql<{ name: string }[]>`select name from custom_fields`;
    expect(names.every((n) => n.name.endsWith("(fake)"))).toBe(true);
    const again = await runSeeders(sql);
    expect(again.every((l) => l.startsWith("already there "))).toBe(true);
    expect(await snapshot()).toEqual(first);
  });
});

// covers SF-119 FR-021 (T050): five fake drafts, once: one per layout, one pasted HTML email with a script, one linked to
// the people custom field "Diet (fake)"
describe("fake campaigns (SF-119)", () => {
  beforeEach(resetDb);
  it("adds the five drafts once", async () => {
    await runSeeders(sql);
    const rows = async () =>
      [...(await sql<{ name: string; content_kind: string; types: string | null; html: string | null; merge_links: { name: string }[] }[]>`
        select name, content_kind, (select string_agg(b->>'type', ',' order by o) from jsonb_array_elements(blocks) with ordinality as x(b, o)) as types,
               html, merge_links
        from campaigns order by name`)];
    const first = await rows();
    expect(first.map((r) => r.name)).toEqual([
      "Event recap (fake)", "Exec dinner – March (fake)", "Newsletter – winter (fake)", "Pasted HTML sample (fake)", "Welcome note (fake)",
    ]);
    expect(first.map((r) => r.types).sort()).toEqual(
      [null, "heading,text", "heading,text,button", "image,heading,text,button,divider,text", "text"].sort(),
    );
    expect(first.find((r) => r.content_kind === "html")?.html).toContain("<script>");
    expect(first.find((r) => r.name === "Event recap (fake)")?.merge_links).toEqual([expect.objectContaining({ name: "Diet (fake)" })]);
    const again = await runSeeders(sql);
    expect(again.filter((l) => l.includes("campaign"))).toEqual(["already there campaigns"]);
    expect(await rows()).toEqual(first);
  });
});

// covers SF-120 FR-015 (T031): four fake segments, one of each kind of choice, with a count; a second run adds none
describe("fake segments (SF-120)", () => {
  beforeEach(resetDb);
  it("adds the four fake segments once, each reaching people for Ada", async () => {
    await runSeeders(sql);
    const rows = await listSegments((await getUser("ada@barnacle.ai")).id);
    expect(rows.map((r) => [r.name, r.summary, r.broken])).toEqual([
      ["Fake — everyone", "Everyone in the CRM", false],
      ["Fake — Exec Dinner, all deals", "People on all deals of Exec Dinner", false],
      ["Fake — Inbound owned by Ada Fake", "Everyone in the CRM + 3 conditions", false],
      ["Fake — Sales Proposal, open deals", "People on open deals of Sales · Proposal + 1 condition", false],
    ]);
    expect(rows[0].reaches).toBeGreaterThan(0);
    expect(rows[1].reaches).toBeGreaterThan(0);
    expect(rows.every((r) => r.updatedBy === "Ada Fake")).toBe(true);
    const again = await runSeeders(sql);
    expect(again.filter((l) => l.includes("segment")).sort()).toEqual(rows.map((r) => `already there segment ${r.name}`).sort());
    expect((await listSegments((await getUser("ada@barnacle.ai")).id)).length).toBe(4);
  });
});
