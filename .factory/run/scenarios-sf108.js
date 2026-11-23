// SF-108 AI-review scenarios (US1 1-5, US2 1-3, US3 1, edge cases 1-6) against :3000/crm_dev on fresh fake data.
// Run: bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf108.js
// Bob = Linus Fake (id 3), Ada = Ada Fake (id 1). Every scenario starts by deleting note_mentions (Linus at 0).
// Each check waits up to 5 s for the count (the client asks it after the page shows) and notes what showed first.
const { execSync } = require("child_process");
const { chromium, results, check, signIn } = require("./lib");
const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DB || "crm_dev";
const sql = (s) => execSync(`psql -h localhost -U postgres ${DB} -tA -v ON_ERROR_STOP=1`, { input: s }).toString().trim();
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
let browser;

const BOB = 3, ADA = 1;
function mention(col, id, to = BOB, by = ADA) {
  const ev = +sql(`insert into timeline_events (${col}, kind, actor_id, body) values (${id}, 'note', ${by}, '@[user:${to}] look') returning id`).split("\n")[0];
  sql(`insert into note_mentions (event_id, user_id, mentioned_by) values (${ev}, ${to}, ${by})`);
  return ev;
}
const firstId = (q) => +sql(q).split("\n")[0];
const publicDeal = () => firstId("select id from deals where not private and archived_at is null and status='open' order by id limit 1");
const publicPerson = () => firstId("select id from persons where not private and archived_at is null order by id limit 1");

async function newPage(email, name) {
  const c = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await c.newPage();
  await signIn(p, BASE, email, name);
  return p;
}
const bob = () => newPage("linus@barnacle.ai", "Linus Fake");
const side = (p) => p.locator("aside[aria-label=Sidebar]");
async function state(p) {
  if (!(await side(p).count())) return "NO SIDEBAR";
  const l = side(p).getByRole("link", { name: /^Notifications( \(\d+\))?$/ });
  const snap = await l.ariaSnapshot().catch(() => "?");
  const name = (snap.match(/link "([^"]+)"/) || [])[1] || snap;
  const b = await l.locator(".cnt").allTextContents().catch(() => []); const badge = b.length ? b[0].trim() : "none";
  return `${name} [badge ${badge}]`;
}
const want = (n) => n > 0 ? `Notifications (${n}) [badge ${n}]` : "Notifications [badge none]";
async function expectCount(p, n) {
  const first = await state(p);
  let s = first;
  for (let i = 0; i < 50 && s !== want(n); i++) { await p.waitForTimeout(100); s = await state(p); }
  return { ok: s === want(n), first, last: s };
}
const mark = (p) => p.evaluate(() => (window.__noReload = 1));
const noReload = (p) => p.evaluate(() => window.__noReload === 1);
async function clickSide(p, label) { await side(p).getByRole("link", { name: label, exact: true }).click(); }

async function run(name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  sql("delete from note_mentions");
  try { await fn(); } catch (e) { check(name, false, "error: " + e.message.split("\n")[0]); }
}
function report(name, r, extra = "", soft = true) {
  check(name, r.ok && soft, `first seen "${r.first}", final "${r.last}"${extra}`);
}

(async () => {
  browser = await chromium.launch();

  await run("US1 scenario 1", async () => {
    const p = await bob(); await p.goto(BASE + "/deals"); await p.waitForLoadState("networkidle");
    const before = await state(p); await mark(p);
    // Ada saves a note mentioning Bob through the UI in her own session.
    const a = await newPage("ada@barnacle.ai", "Ada Fake");
    const d = publicDeal();
    await a.goto(BASE + "/deals/" + d); await a.waitForLoadState("networkidle");
    const box = a.getByRole("form", { name: "Add a note" }); const t = box.getByRole("textbox", { name: "Note" });
    await t.click(); await t.pressSequentially("Hi @Lin", { delay: 30 });
    await a.getByRole("listbox", { name: "Teammates" }).getByRole("option", { name: "Linus Fake" }).click();
    await box.getByRole("button", { name: "[ ADD NOTE ]" }).click(); await a.waitForTimeout(1000);
    const saved = sql(`select count(*) from note_mentions where user_id=${BOB}`);
    await clickSide(p, "People"); await p.waitForURL(/\/people/);
    const r = await expectCount(p, 1);
    report("US1 scenario 1", r, `; before "${before}"; mentions saved by Ada's UI: ${saved}; no reload ${await noReload(p)}`, await noReload(p) && saved === "1");
    await a.context().close(); await p.context().close();
  });

  await run("US1 scenario 2", async () => {
    const p = await bob(); const notes = []; let ok = true;
    const step = async (label, from, click, urlRe) => {
      await p.goto(BASE + from); await p.waitForLoadState("networkidle"); await mark(p);
      sql("delete from note_mentions"); mention("deal_id", publicDeal());
      await click(); await p.waitForURL(urlRe);
      const r = await expectCount(p, 1); const nr = await noReload(p);
      ok = ok && r.ok && nr; notes.push(`${label}: first "${r.first}" final "${r.last}" noReload ${nr}`);
    };
    await step("people list→person", "/people", () => p.locator("td:first-child a.nm").first().click(), /\/people\/\d+/);
    await step("deal list→deal", "/deals/list", () => p.locator("td:first-child a.nm").first().click(), /\/deals\/\d+/);
    await step("orgs list→org", "/organisations", () => p.locator("td:first-child a.nm").first().click(), /\/organisations\/\d+/);
    await step("board→card drawer", "/deals", () => p.locator("a.card").first().click(), /open=\d+/);
    const d = publicDeal(); const org = firstId(`select organisation_id from deals where id=${d}`);
    await step("deal page→organisation", "/deals/" + d, () => p.locator(`main a[href="/organisations/${org}"]`).first().click(), new RegExp(`/organisations/${org}`));
    check("US1 scenario 2", ok, notes.join("; "));
    await p.context().close();
  });

  await run("US1 scenario 3", async () => {
    const p = await bob(); await p.goto(BASE + "/people"); await p.waitForLoadState("networkidle"); await mark(p);
    mention("deal_id", publicDeal());
    await clickSide(p, "People");
    const r = await expectCount(p, 1); const nr = await noReload(p);
    report("US1 scenario 3", r, `; url ${p.url()}; noReload ${nr}`, nr);
    await p.context().close();
  });

  await run("US1 scenario 4", async () => {
    const d = publicDeal(); const e1 = mention("deal_id", d); const e2 = mention("deal_id", publicPerson() && d);
    const p = await bob(); await p.goto(BASE + "/deals"); await p.waitForLoadState("networkidle");
    const s0 = await state(p); await mark(p);
    sql(`delete from timeline_events where id=${e1}`);
    await clickSide(p, "People"); await p.waitForURL(/\/people/);
    const r1 = await expectCount(p, 1);
    // edit: put back to 2, then the second note edited to no longer mention Bob
    const e3 = mention("deal_id", d);
    await clickSide(p, "Organisations"); await p.waitForURL(/\/organisations/);
    const mid = await expectCount(p, 2);
    sql(`update timeline_events set body='no mention now' where id=${e3}; delete from note_mentions where event_id=${e3}`);
    await clickSide(p, "Deals"); await p.waitForURL(/\/deals/);
    const r2 = await expectCount(p, 1);
    check("US1 scenario 4", s0 === want(2) && r1.ok && mid.ok && r2.ok && await noReload(p),
      `start "${s0}"; after delete: first "${r1.first}" final "${r1.last}"; back to 2: "${mid.last}"; after edit removing mention: first "${r2.first}" final "${r2.last}"`);
    await p.context().close();
  });

  await run("US1 scenario 5", async () => {
    const d = publicDeal(); const pr = publicPerson();
    const p = await bob();
    // a) deal made private by Ada (Ada creator, owner Ada)
    const d2 = firstId(`select id from deals where not private and archived_at is null and owner_id<>${BOB} and created_by<>${BOB} order by id offset 3 limit 1`);
    mention("deal_id", d2); await p.goto(BASE + "/deals"); await p.waitForLoadState("networkidle"); const s0 = await state(p); await mark(p);
    sql(`update deals set private=true, created_by=${ADA}, owner_id=${ADA} where id=${d2}`);
    await clickSide(p, "People"); await p.waitForURL(/\/people/);
    const r1 = await expectCount(p, 0);
    await p.reload(); await p.waitForLoadState("networkidle"); const full1 = await state(p);
    // b) person deleted
    sql("delete from note_mentions"); const pid = firstId(`select id from persons where not private and archived_at is null and owner_id is distinct from ${BOB} order by id desc limit 1`);
    mention("person_id", pid); await p.goto(BASE + "/organisations"); await p.waitForLoadState("networkidle"); const s1 = await state(p); await mark(p);
    sql(`delete from persons where id=${pid}`);
    await clickSide(p, "Deals"); await p.waitForURL(/\/deals/);
    const r2 = await expectCount(p, 0);
    check("US1 scenario 5", s0 === want(1) && s1 === want(1) && r1.ok && r2.ok && full1 === want(0),
      `made private: start "${s0}", after link first "${r1.first}" final "${r1.last}", full reload "${full1}"; person deleted: start "${s1}", after link first "${r2.first}" final "${r2.last}"`);
    await p.context().close();
  });

  await run("US2 scenario 1", async () => {
    const d = publicDeal(); const pr = publicPerson(); mention("deal_id", d); mention("person_id", pr);
    const p = await bob(); await p.goto(BASE + "/deals"); await p.waitForLoadState("networkidle"); const s0 = await state(p); await mark(p);
    await clickSide(p, /^Notifications/); await p.waitForURL(/\/notifications/);
    await p.getByRole("list", { name: "Notifications" }).getByRole("button").first().click();
    await p.waitForURL(/\/(deals|people)\/\d+/);
    const r = await expectCount(p, 1); const nr = await noReload(p);
    report("US2 scenario 1", r, `; start "${s0}"; landed on ${p.url().replace(BASE, "")}; noReload ${nr}`, s0 === want(2));
    await p.context().close();
  });

  await run("US2 scenario 2", async () => {
    mention("deal_id", publicDeal()); mention("person_id", publicPerson());
    const p = await bob(); await p.goto(BASE + "/notifications"); await p.waitForLoadState("networkidle"); const s0 = await state(p);
    await p.getByRole("button", { name: "[ MARK ALL AS READ ]" }).click(); await p.waitForTimeout(500);
    const r = await expectCount(p, 0); const txt = await side(p).textContent();
    report("US2 scenario 2", r, `; start "${s0}"; sidebar contains "0": ${/Notifications\s*0/.test(txt)}`, s0 === want(2));
    await p.context().close();
  });

  await run("US2 scenario 3", async () => {
    const d = publicDeal(); mention("person_id", publicPerson());
    const p = await bob(); await p.goto(BASE + "/deals/" + d); await p.waitForLoadState("networkidle"); const s0 = await state(p); await mark(p);
    mention("deal_id", d); // Ada's new mention in another session
    const box = p.getByRole("form", { name: "Add a note" });
    await box.getByRole("textbox", { name: "Note" }).fill("Bob's own note SF108");
    await box.getByRole("button", { name: "[ ADD NOTE ]" }).click();
    await p.getByText("Bob's own note SF108").first().waitFor();
    const r = await expectCount(p, 2); const nr = await noReload(p);
    report("US2 scenario 3", r, `; start "${s0}"; url ${p.url().replace(BASE, "")}; noReload ${nr}`, s0 === want(1));
    await p.context().close();
  });

  await run("US3 scenario 1", async () => {
    const p = await bob(); await p.goto(BASE + "/deals"); await p.waitForLoadState("networkidle");
    await clickSide(p, "People"); await p.waitForURL(/\/people$/);
    await p.locator("td:first-child a.nm").first().click(); await p.waitForURL(/\/people\/\d+/);
    const s0 = await state(p); await mark(p);
    mention("deal_id", publicDeal());
    await p.goBack(); await p.waitForURL(/\/people$/);
    const r = await expectCount(p, 1);
    mention("deal_id", publicDeal());
    await p.goForward(); await p.waitForURL(/\/people\/\d+/);
    const r2 = await expectCount(p, 2); const nr = await noReload(p);
    report("US3 scenario 1", r, `; B showed "${s0}"; forward to B: first "${r2.first}" final "${r2.last}"; noReload ${nr}`, s0 === want(0) && nr);
    await p.context().close();
  });

  await run("Edge case 1", async () => {
    mention("deal_id", publicDeal());
    const p = await bob(); await p.goto(BASE + "/people"); await p.waitForLoadState("networkidle"); const s0 = await state(p); await mark(p);
    const t2 = await p.context().newPage(); await t2.goto(BASE + "/notifications"); await t2.waitForLoadState("networkidle");
    await t2.getByRole("button", { name: "[ MARK ALL AS READ ]" }).click(); await t2.waitForTimeout(800);
    await clickSide(p, "Deals"); await p.waitForURL(/\/deals/);
    const r = await expectCount(p, 0); const has0 = /Notifications\s*\(?0/.test(await side(p).textContent());
    report("Edge case 1", r, `; start "${s0}"; shows 0: ${has0}`, s0 === want(1) && !has0);
    await p.context().close();
  });

  await run("Edge case 2", async () => {
    const d = firstId("insert into deals (title, value_pence, stage_id, owner_id, created_by, stage_entered_at) select 'SF108 gone', 100, s.id, 1, 1, now() from stages s join pipelines pl on pl.id=s.pipeline_id order by pl.position, s.position limit 1 returning id");
    const p = await bob(); await p.goto(BASE + "/deals/list"); await p.waitForLoadState("networkidle"); await mark(p);
    const link = p.locator("td:first-child a.nm", { hasText: "SF108 gone" });
    const shown = await link.count();
    sql(`delete from deals where id=${d}`); mention("deal_id", publicDeal());
    await link.click(); await p.waitForURL(new RegExp(`/deals/${d}`));
    await p.waitForTimeout(500);
    const r = await expectCount(p, 1); const body = (await p.locator("main").textContent()).replace(/\s+/g, " ").slice(0, 120);
    report("Edge case 2", r, `; link shown ${shown}; sidebar present ${await side(p).count()}; main: "${body}"`, shown === 1 && (await side(p).count()) === 1);
    await p.context().close();
  });

  await run("Edge case 3", async () => {
    const p = await bob(); await p.goto(BASE + "/deals"); await p.waitForLoadState("networkidle");
    const t2 = await p.context().newPage(); await t2.goto(BASE + "/deals"); await t2.waitForLoadState("networkidle");
    await t2.getByText("[ Sign out ]").click(); await t2.waitForURL(/sign-in/);
    await clickSide(p, "People"); await p.waitForURL(/sign-in/, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(500);
    const url = p.url().replace(BASE, ""); const sb = await side(p).count(); const notif = await p.getByText(/Notifications/).count();
    check("Edge case 3", /sign-in/.test(url) && sb === 0 && notif === 0, `url ${url}; sidebar ${sb}; "Notifications" texts ${notif}`);
    await p.context().close();
  });

  await run("Edge case 4", async () => {
    const d = publicDeal(); for (let i = 0; i < 12; i++) mention("deal_id", d);
    const p = await bob(); await p.goto(BASE + "/deals"); await p.waitForLoadState("networkidle"); const s0 = await state(p); await mark(p);
    mention("deal_id", d);
    await clickSide(p, "People"); await p.waitForURL(/\/people/);
    const r = await expectCount(p, 13);
    await p.reload(); await p.waitForLoadState("networkidle"); const full = await state(p);
    report("Edge case 4", r, `; start "${s0}"; after full reload "${full}"`, s0 === want(12) && full === want(13));
    await p.context().close();
  });

  await run("Edge case 5", async () => {
    const p = await bob(); await p.goto(BASE + "/organisations"); await p.waitForLoadState("networkidle"); await mark(p);
    mention("deal_id", publicDeal());
    await clickSide(p, "People"); await clickSide(p, "Deals"); await p.waitForURL(/\/deals$/);
    const r = await expectCount(p, 1);
    const cur = await side(p).locator('a[aria-current="page"]').textContent();
    report("Edge case 5", r, `; current link "${cur.trim()}"; noReload ${await noReload(p)}`, /Deals/.test(cur));
    await p.context().close();
  });

  await run("Edge case 6", async () => {
    mention("deal_id", publicDeal()); mention("person_id", publicPerson());
    const p = await bob(); await p.goto(BASE + "/deals"); await p.waitForLoadState("networkidle");
    mention("deal_id", publicDeal());
    await clickSide(p, "People"); await p.waitForURL(/\/people/);
    const r = await expectCount(p, 3);
    await p.reload(); await p.waitForLoadState("networkidle"); const after = await state(p);
    report("Edge case 6", r, `; after full reload "${after}"`, after === r.last);
    await p.context().close();
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed`);
})();
