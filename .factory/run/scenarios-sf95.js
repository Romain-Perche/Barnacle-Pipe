// SF-95 (deal list, deal page, Won/Lost/Reopen, restore, links, labels, followers) AI-review scenario script: every
// US1–US5 scenario and edge cases 1–14 of the spec. Run on a freshly seeded crm_dev with the app on :3000:
//   bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf95.js
// Scenarios run in order; each makes its own "SF95 …" deals by SQL (with back-dated stage periods where days matter).
// Edge case 12 runs last: it deletes every deal. (Numbering follows the spec after fix round 1: edge 11 = unknown owner/label.)
const { execFileSync } = require("child_process");
const { chromium, results, check, signIn } = require("./lib");
const BASE = "http://localhost:3000";
const sql = (q) => execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", "crm_dev", "-Atqc", q]).toString().trim();
const one = (q) => sql(q).split("\n")[0];
const esc = (s) => s.replace(/'/g, "''");
const uid = (n) => Number(one(`select id from users where name='${esc(n)}'`));
const pid = (n) => Number(one(`select id from pipelines where name='${esc(n)}'`));
const sid = (p, s) => Number(one(`select s.id from stages s join pipelines p on p.id=s.pipeline_id where p.name='${esc(p)}' and s.name='${esc(s)}'`));
const did = (t) => Number(one(`select id from deals where title='${esc(t)}' order by id desc limit 1`));
const personId = (n) => Number(one(`select id from persons where btrim(first_name||' '||last_name)='${esc(n)}' limit 1`));
const money = (pence) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);
const TODAY = (() => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).formatToParts(new Date()).map((x) => [x.type, x.value])); return `${p.day} ${p.month.slice(0, 3)} ${p.year}`; })();
// periods: [[stage, enteredDaysAgo, leftDaysAgo|null]] in the deal's pipeline; the last one decides the stage.
function mkDeal({ title, pipeline = "Sales", periods, by = "Ada Fake", owner, value = null, org = null, person = null, priv = false, close = null, status = "open", reason = null, archived = false }) {
  const c = uid(by), o = owner ? uid(owner) : c;
  const last = periods[periods.length - 1];
  const st = sid(pipeline, last[0]);
  const closed = status === "open" ? "null" : "now()";
  const id = one(`insert into deals (title, value_pence, stage_id, stage_entered_at, organisation_id, person_id, owner_id, private, created_by, created_at, expected_close_on, status, closed_at, lost_reason, archived_at)
    values ('${esc(title)}', ${value === null ? "null" : value}, ${st}, now() - interval '${last[1]} days',
    ${org ? `(select id from organisations where name='${esc(org)}')` : "null"}, ${person ? personId(person) : "null"}, ${o}, ${priv}, ${c},
    now() - interval '${periods[0][1]} days', ${close ? `'${close}'` : "null"}, '${status}', ${closed}, ${reason ? `'${esc(reason)}'` : "null"}, ${archived ? "now()" : "null"}) returning id`);
  for (const [s, a, b] of periods)
    sql(`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, entered_at, left_at) values (${id}, ${sid(pipeline, s)}, '${esc(s)}', '${esc(pipeline)}', now() - interval '${a} days', ${b === null ? (status === "open" ? "null" : "now()") : `now() - interval '${b} days'`})`);
  sql(`insert into timeline_events (deal_id, kind, actor_id, created_at) values (${id}, 'added', ${c}, now() - interval '${periods[0][1]} days')`);
  return Number(id);
}
const visibleWhere = (v) => `(not d.private or d.created_by=${v} or d.owner_id=${v})`;
function boardExpected(pipeline, stage, viewer) {
  const v = uid(viewer);
  const [n, t] = one(`select count(*), coalesce(sum(d.value_pence),0) from deals d join stages s on s.id=d.stage_id join pipelines p on p.id=s.pipeline_id
    where p.name='${esc(pipeline)}' and s.name='${esc(stage)}' and d.archived_at is null and d.status='open' and ${visibleWhere(v)}`).split("|");
  return `${n} ${n === "1" ? "deal" : "deals"} · ${money(Number(t))}`;
}
function listExpected(viewer, extra = "d.archived_at is null and d.status='open'") {
  const v = uid(viewer);
  const [n, t] = one(`select count(*), coalesce(sum(d.value_pence),0) from deals d join stages s on s.id=d.stage_id where ${extra} and ${visibleWhere(v)}`).split("|");
  return `${n} ${n === "1" ? "deal" : "deals"} · ${money(Number(t))}`;
}
const col = (page, stage) => page.getByRole("region", { name: stage, exact: true });
const tot = async (page, stage) => ((await col(page, stage).locator(".tot").textContent()) || "").trim();
const boardTitles = async (page) => page.locator("a.card .t").evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
const body = async (page) => (await page.textContent("body")) || "";
const vis = async (page) => (await page.innerText("body")) || "";
const go = async (page, path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const click = async (page, loc) => { await Promise.all([page.waitForLoadState("networkidle"), loc.click()]); await page.waitForTimeout(400); await page.waitForLoadState("networkidle"); };
const btn = (page, name) => page.getByRole("button", { name, exact: true });
const NAMES = { "ada@barnacle.ai": "Ada Fake", "grace@barnacle.ai": "Grace Fake", "linus@barnacle.ai": "Linus Fake", "margaret@barnacle.ai": "Margaret Fake" };
async function login(browser, email) { const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 } }); const page = await ctx.newPage(); await signIn(page, BASE, email, NAMES[email]); return page; }
async function run(name, fn) { try { await fn(); } catch (e) { check(name, false, "error: " + String(e.message).split("\n")[0]); } }
const bar = async (page) => page.getByRole("list", { name: "Stages" }).locator("li").evaluateAll((els) => els.map((e) => ({ name: e.querySelector(".nm").textContent.trim(), days: e.querySelector(".days").textContent.trim(), now: e.getAttribute("aria-current") === "step", btn: !!e.querySelector("button") })));
const history = async (page) => page.getByRole("region", { name: "Timeline" }).getByRole("listitem").allTextContents();
const listTitles = async (page) => page.locator("td:first-child a.nm").allTextContents();
const status = (id) => one(`select status||'|'||coalesce(closed_at::text,'')||'|'||coalesce(lost_reason,'')||'|'||stage_id||'|'||coalesce(value_pence::text,'')||'|'||owner_id||'|'||(archived_at is not null) from deals where id=${id}`);
async function postAction(page, actionPagePath, buttonName, fields, asPage) {
  // Replays a server action form post (the form's $ACTION_ID_ field) from `asPage`'s session.
  await go(page, actionPagePath);
  const name = await btn(page, buttonName).first().locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
  const r = await asPage.request.post(BASE + actionPagePath, { multipart: { [name]: "", ...fields }, headers: { "Next-Action": "" }, maxRedirects: 0 }).catch((e) => ({ status: () => "err " + e.message }));
  return r.status();
}

(async () => {
  const browser = await chromium.launch();
  const ada = await login(browser, "ada@barnacle.ai");
  const linus = await login(browser, "linus@barnacle.ai");
  const grace = await login(browser, "grace@barnacle.ai");
  const A = uid("Ada Fake"); const MAINP = one("select btrim(first_name||' '||last_name) from persons where not private and archived_at is null order by id offset 7 limit 1"); let note95 = "";

  await run("US1 scenario 1", async () => {
    const id = mkDeal({ title: "SF95 Page deal", value: 400000, close: "2026-12-19", org: "Fakeco Ltd", person: MAINP, periods: [["Qualified", 3, 1], ["Proposal", 1, null]] });
    sql(`insert into deal_people (deal_id, person_id, linked_by) select ${id}, id, ${A} from persons where btrim(first_name||' '||last_name) <> '${MAINP}' and not private and archived_at is null order by id limit 1`);
    const other = one(`select btrim(p.first_name||' '||p.last_name) from deal_people dp join persons p on p.id=dp.person_id where dp.deal_id=${id}`);
    sql(`insert into deal_label_links (deal_id, label_id) select ${id}, id from deal_labels where name='Warm'; insert into deal_followers (deal_id, user_id) values (${id}, ${uid("Grace Fake")})`);
    sql(`insert into timeline_events (deal_id, kind, actor_id, created_at, fields) values (${id}, 'edited', ${A}, now() - interval '1 hour', '{Title}')`);
    await go(ada, `/deals/${id}`);
    const t = await vis(ada); const tc = await body(ada);
    const det = ada.getByRole("region", { name: "Details" });
    const org = await det.locator('a[href^="/organisations/"]').first().getAttribute("href");
    const per = await det.locator('a[href^="/people/"]').first().getAttribute("href");
    const h = await history(ada);
    const checks = {
      title: tc.includes("SF95 Page deal"), value: tc.includes("£4,000"), pipestage: tc.includes("Sales · Proposal"), owner: /Owner\s*Ada Fake/.test(tc),
      followers: /Followers\s*Grace Fake/.test(tc), close: tc.includes("19 Dec 2026"), labels: /Labels\s*Warm/.test(tc),
      org: org === `/organisations/${one("select id from organisations where name='Fakeco Ltd'")}`, person: per === `/people/${personId(MAINP)}`,
      other: (await ada.getByRole("list", { name: "Other people" }).textContent()).includes(other), added: /Date added\s*\d+ \w{3} 2026/.test(tc),
      status: /Status\s*Open/.test(tc), hist: t.includes("// TIMELINE"), newest: h.length >= 2 && /edited/i.test(h[0]) && /added/i.test(h[h.length - 1]),
    };
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    check("US1 scenario 1", bad.length === 0, `deal page of "SF95 Page deal": all fields shown; failing: ${bad.join(",") || "none"}; history ${JSON.stringify(h)}`);
  });

  let barId;
  await run("US1 scenario 2", async () => {
    barId = mkDeal({ title: "SF95 Bar deal", periods: [["Qualified", 8.2, 5.1], ["Proposal", 5.1, null]] });
    await go(ada, `/deals/${barId}`);
    const b = await bar(ada);
    const ok = b.map((x) => x.name).join(",") === "Lead in,Qualified,Proposal,Negotiation,Closing" && b[0].days === "0 days" && b[1].days === "3 days" && b[2].now && b[2].days === "5 days" && b[3].days === "" && b[4].days === "";
    check("US1 scenario 2", ok, `bar ${JSON.stringify(b.map((x) => `${x.name}:${x.days}${x.now ? "*" : ""}`))}`);
  });

  await run("US1 scenario 3", async () => {
    await go(ada, `/deals?pipeline=${pid("Sales")}&open=${barId}`);
    await click(ada, ada.getByRole("complementary", { name: "Deal" }).getByRole("link", { name: "[ OPEN DEAL PAGE ]" }));
    const url = ada.url();
    const back = ada.getByRole("link", { name: /Sales board/ });
    const href = await back.getAttribute("href");
    await click(ada, back);
    const onBoard = (await ada.getByRole("region", { name: "Proposal", exact: true }).count()) === 1;
    check("US1 scenario 3", url.endsWith(`/deals/${barId}`) && href === `/deals?pipeline=${pid("Sales")}` && onBoard, `drawer link → ${url}; back link "${await back.count() ? "← Sales board" : "?"}" href ${href}; board shown ${onBoard}`);
  });

  await run("US1 scenario 4", async () => {
    await go(ada, `/deals/${barId}`);
    await click(ada, btn(ada, "Move to Negotiation"));
    const st1 = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${barId}`);
    const b1 = await bar(ada);
    const h1 = (await history(ada))[0];
    await click(ada, btn(ada, "Move to Qualified"));
    const b2 = await bar(ada);
    const periods = sql(`select stage_name||':'||(left_at is null) from deal_stage_periods where deal_id=${barId} order by entered_at`).replace(/\n/g, " ");
    const h2 = (await history(ada))[0];
    const ok = st1 === "Negotiation" && b1[3].now && b1[2].days === "5 days" && /Moved from Proposal to Negotiation by Ada Fake/.test(h1) && b2[1].now && b2[1].days === "3 days" && b2[3].days === "" && /Moved from Negotiation to Qualified/.test(h2) && periods.endsWith("Qualified:true");
    check("US1 scenario 4", ok, `later: stage ${st1}, bar ${JSON.stringify(b1.map((x) => x.name + ":" + x.days + (x.now ? "*" : "")))}, history "${h1}"; earlier: bar ${JSON.stringify(b2.map((x) => x.name + ":" + x.days + (x.now ? "*" : "")))}, history "${h2}"; periods ${periods}`);
  });

  await run("US1 scenario 5", async () => {
    const MSG = "This deal doesn't exist or you can't see it.";
    await go(linus, "/deals/9999999"); const a = await vis(linus);
    const del = mkDeal({ title: "SF95 Deleted deal", periods: [["Lead in", 1, null]] }); sql(`delete from deals where id=${del}`);
    await go(linus, `/deals/${del}`); const b = await vis(linus);
    const priv = did("Fake secret project");
    await go(linus, `/deals/${priv}`); const c = await vis(linus); const craw = await body(linus);
    const ok = [a, b, c].every((x) => x.includes(MSG)) && !c.includes("Fake secret project") && !craw.includes("Fake secret project");
    check("US1 scenario 5", ok, `missing, deleted and Ada's private "Fake secret project" (as Linus) all show the message; title absent: ${!craw.includes("Fake secret project")}`);
  });

  await run("US2 scenario 1", async () => {
    const id = mkDeal({ title: "SF95 Win deal", value: 123400, periods: [["Proposal", 2, null]] });
    await go(ada, `/deals?pipeline=${pid("Sales")}`); const before = await tot(ada, "Proposal");
    await go(ada, `/deals/${id}`); await click(ada, btn(ada, "[ WON ]"));
    const t = await body(ada); const h = (await history(ada))[0];
    await go(ada, `/deals?pipeline=${pid("Sales")}`); const after = await tot(ada, "Proposal"); const titles = await boardTitles(ada);
    const ok = t.includes(`Won · ${TODAY}`) && /Marked as won by Ada Fake/.test(h) && !titles.includes("SF95 Win deal") && after === boardExpected("Sales", "Proposal", "Ada Fake") && after !== before;
    check("US2 scenario 1", ok, `badge "Won · ${TODAY}" ${t.includes(`Won · ${TODAY}`)}; history "${h}"; Proposal total ${before} → ${after}; card gone ${!titles.includes("SF95 Win deal")}`);
  });

  await run("US2 scenario 2", async () => {
    const id = mkDeal({ title: "SF95 Lose deal", periods: [["Qualified", 2, null]] });
    await go(ada, `/deals/${id}`); await click(ada, ada.getByRole("link", { name: "[ LOST ]" }));
    const dlg = ada.getByRole("dialog", { name: "Why was this deal lost?" });
    const has = (await dlg.count()) === 1 && (await dlg.getByRole("button", { name: "[ MARK AS LOST ]" }).count()) === 1 && (await dlg.getByRole("link", { name: "[ CANCEL ]" }).count()) === 1;
    await dlg.locator("textarea").fill("Went with a competitor");
    await click(ada, dlg.getByRole("button", { name: "[ MARK AS LOST ]" }));
    const t = await body(ada); const h = (await history(ada))[0];
    const ok = has && t.includes(`Lost · ${TODAY}`) && t.includes("Went with a competitor") && /Marked as lost by Ada Fake: Went with a competitor/.test(h) && status(id).startsWith("lost|");
    check("US2 scenario 2", ok, `box with question, [ MARK AS LOST ], [ CANCEL ]: ${has}; badge "Lost · ${TODAY}" and reason shown; history "${h}"`);
  });

  await run("US2 scenario 3", async () => {
    const id = mkDeal({ title: "SF95 Empty reason", periods: [["Qualified", 2, null]] });
    await go(ada, `/deals/${id}?confirm=lost`);
    const dlg = ada.getByRole("dialog", { name: "Why was this deal lost?" });
    await dlg.locator("textarea").fill("   ");
    await click(ada, dlg.getByRole("button", { name: "[ MARK AS LOST ]" }));
    const t = await vis(ada);
    check("US2 scenario 3", t.includes("Enter why this deal was lost.") && status(id).startsWith("open|"), `spaces only: message shown ${t.includes("Enter why this deal was lost.")}; db status ${status(id)}`);
  });

  await run("US2 scenario 4", async () => {
    const w = did("SF95 Win deal"), l = did("SF95 Lose deal");
    const out = [];
    for (const [id, stage] of [[w, "Proposal"], [l, "Qualified"]]) {
      await go(ada, `/deals/${id}`); await click(ada, btn(ada, "[ REOPEN ]"));
      const h = (await history(ada))[0]; const s = status(id);
      await go(ada, `/deals?pipeline=${pid("Sales")}`);
      const inCol = (await col(ada, stage).locator("a.card", { hasText: one(`select title from deals where id=${id}`) }).count()) === 1;
      out.push({ ok: s.startsWith("open|||") && /Reopened by Ada Fake/.test(h) && inCol && (await tot(ada, stage)) === boardExpected("Sales", stage, "Ada Fake"), s, h, inCol });
    }
    check("US2 scenario 4", out.every((o) => o.ok), JSON.stringify(out));
  });

  await run("US2 scenario 5", async () => {
    const out = [];
    for (const t of ["Fakeco newsletter (won)", "Dummy Leisure app (lost)"]) {
      await go(ada, `/deals/${did(t)}`);
      const b = await bar(ada);
      out.push({ t, won: await btn(ada, "[ WON ]").count(), lost: await ada.getByRole("link", { name: "[ LOST ]" }).count(), reopen: await btn(ada, "[ REOPEN ]").count(), stages: b.length, buttons: b.filter((x) => x.btn).length, form: await ada.locator("form.stagebar-form").count() });
    }
    check("US2 scenario 5", out.every((o) => o.won === 0 && o.lost === 0 && o.reopen === 1 && o.stages === 5 && o.buttons === 0 && o.form === 0), JSON.stringify(out));
  });

  await run("US2 scenario 6", async () => {
    const d1 = mkDeal({ title: "SF95 Race won", periods: [["Proposal", 1, null]] });
    const d2 = mkDeal({ title: "SF95 Race lost", periods: [["Proposal", 1, null]] });
    const d3 = mkDeal({ title: "SF95 Race reopen", periods: [["Proposal", 1, null]], status: "won" });
    const MSG = "Someone else changed this deal while you were editing. Reload to see their changes.";
    const out = [];
    // [ WON ]: Ada's page loaded, Grace marks it won first.
    await go(ada, `/deals/${d1}`); await go(grace, `/deals/${d1}`); await click(grace, btn(grace, "[ WON ]"));
    const s1 = status(d1); await click(ada, btn(ada, "[ WON ]"));
    out.push({ act: "WON", msg: (await vis(ada)).includes(MSG), same: status(d1) === s1, events: one(`select count(*) from timeline_events where deal_id=${d1} and kind='won'`) });
    // [ LOST ]: Ada's box open, Grace moves the deal.
    await go(ada, `/deals/${d2}?confirm=lost`); await go(grace, `/deals/${d2}`); await click(grace, btn(grace, "Move to Negotiation"));
    const s2 = status(d2);
    await ada.getByRole("dialog").locator("textarea").fill("Too late");
    await click(ada, btn(ada, "[ MARK AS LOST ]"));
    out.push({ act: "LOST", msg: (await vis(ada)).includes(MSG), same: status(d2) === s2 });
    // [ REOPEN ]: Ada's page loaded, Grace reopens and marks it won again.
    await go(ada, `/deals/${d3}`); await go(grace, `/deals/${d3}`); await click(grace, btn(grace, "[ REOPEN ]")); await click(grace, btn(grace, "[ WON ]"));
    const s3 = status(d3); await click(ada, btn(ada, "[ REOPEN ]"));
    out.push({ act: "REOPEN", msg: (await vis(ada)).includes(MSG), same: status(d3) === s3 });
    check("US2 scenario 6", out.every((o) => o.msg && o.same && (o.events === undefined || o.events === "1")), JSON.stringify(out));
  });

  // 60 extra open deals of Linus so the list has more than one page.
  for (let i = 1; i <= 60; i++) mkDeal({ title: `SF95 Bulk ${String(i).padStart(2, "0")}`, by: "Linus Fake", value: i * 1000, periods: [["Lead in", 0.01 + i / 10000, null]] });

  await run("US3 scenario 1", async () => {
    await go(linus, "/deals/list");
    const count = ((await linus.locator(".head-r .count").textContent()) || "").trim();
    const heads = (await linus.locator("table.deals-list thead th").allTextContents()).map((s) => s.trim());
    const titles = await listTitles(linus);
    const v = uid("Linus Fake");
    const exp = sql(`select title from deals d where d.archived_at is null and d.status='open' and ${visibleWhere(v)} order by created_at desc, id desc limit 50`).split("\n");
    const ok = count === listExpected("Linus Fake") && titles.length === 50 && JSON.stringify(titles) === JSON.stringify(exp) && heads.join("|").replace(/[↑↓▲▼]/g, "").replace(/\s+/g, " ") .includes("Title") && heads.length === 8 && !titles.includes("Fake secret project");
    check("US3 scenario 1", ok, `count "${count}" (expected "${listExpected("Linus Fake")}"); ${titles.length} rows, newest first matches db ${JSON.stringify(titles) === JSON.stringify(exp)}; headers ${JSON.stringify(heads)}`);
  });

  await run("US3 scenario 2", async () => {
    sql(`insert into deal_label_links (deal_id, label_id) select id, (select id from deal_labels where name='Cold') from deals where title in ('SF95 Bulk 03','SF95 Bulk 13','SF95 Bulk 23')`);
    await go(linus, "/deals/list");
    await linus.fill('input[name="q"]', "Bulk 1"); await linus.keyboard.press("Enter"); await linus.waitForLoadState("networkidle"); await linus.waitForTimeout(500);
    const c1 = ((await linus.locator(".head-r .count").textContent()) || "").trim();
    await Promise.all([linus.waitForURL(/pipeline=\d/), linus.selectOption('select[name="pipeline"]', { label: "Sales" })]); await linus.waitForLoadState("networkidle");
    await Promise.all([linus.waitForURL(/stage=\d/), linus.selectOption('select[name="stage"]', { label: "Lead in" })]); await linus.waitForLoadState("networkidle");
    await Promise.all([linus.waitForURL(/owner=\d/), linus.selectOption('select[name="owner"]', { label: "Linus Fake" })]); await linus.waitForLoadState("networkidle");
    await Promise.all([linus.waitForURL(/label=\d/), linus.selectOption('select[name="label"]', { label: "Cold" })]); await linus.waitForLoadState("networkidle");
    const c2 = ((await linus.locator(".head-r .count").textContent()) || "").trim(); const t2 = await listTitles(linus);
    await click(linus, linus.getByRole("link", { name: "[ CLEAR ]" }));
    const url = linus.url(); const c3 = ((await linus.locator(".head-r .count").textContent()) || "").trim();
    const ok = c1 === "10 deals · £1,450" && c2 === "1 deal · £130" && JSON.stringify(t2) === '["SF95 Bulk 13"]' && url.endsWith("/deals/list") && c3 === listExpected("Linus Fake");
    check("US3 scenario 2", ok, `"Bulk 1" → ${c1} (Bulk 10–19 = 10 deals, £145,000? see note); +Sales, Lead in, Linus, Cold → ${c2} ${JSON.stringify(t2)}; [ CLEAR ] → ${url} ${c3}`);
  });

  await run("US3 scenario 3", async () => {
    const v = uid("Linus Fake");
    const sorts = {
      title: "lower(d.title) X, d.id X", value: "d.value_pence X nulls last, d.id X", organisation: "lower(o.name) X nulls last, d.id X",
      stage: "pl.position X, s.position X, d.id X", owner: "lower(u.name) X, d.id X", close: "d.expected_close_on X nulls last, d.id X", added: "d.created_at X, d.id X",
    };
    const bad = [];
    for (const [k, ord] of Object.entries(sorts)) for (const dir of ["asc", "desc"]) {
      const exp = sql(`select d.title from deals d join stages s on s.id=d.stage_id join pipelines pl on pl.id=s.pipeline_id join users u on u.id=d.owner_id left join organisations o on o.id=d.organisation_id
        where d.archived_at is null and d.status='open' and ${visibleWhere(v)} order by ${ord.replace(/X/g, dir)} limit 50`).split("\n");
      await go(linus, `/deals/list?sort=${k}&dir=${dir}`);
      const got = await listTitles(linus);
      if (JSON.stringify(got) !== JSON.stringify(exp)) bad.push(`${k} ${dir}`);
    }
    // Empty values last both ways (the page with them: value/organisation/close have nulls in the seed + bulk deals).
    const lastNull = [];
    for (const [k, colm] of [["value", "d.value_pence"], ["organisation", "d.organisation_id"], ["close", "d.expected_close_on"]]) for (const dir of ["asc", "desc"]) {
      await go(linus, `/deals/list?sort=${k}&dir=${dir}&page=99`);
      const got = await listTitles(linus);
      const nulls = sql(`select d.title from deals d where d.archived_at is null and d.status='open' and ${visibleWhere(v)} and ${colm} is null`).split("\n").filter(Boolean);
      const lastRows = got.slice(-Math.min(nulls.length, got.length));
      lastNull.push(`${k} ${dir}: ${lastRows.every((t) => nulls.includes(t))}`);
    }
    // One sort by clicking the header.
    await go(linus, "/deals/list"); await click(linus, linus.locator("thead").getByRole("link", { name: /Value/ }));
    const clicked = linus.url();
    check("US3 scenario 3", bad.length === 0 && lastNull.every((s) => s.endsWith("true")) && /sort=value/.test(clicked), `14 sort/direction orders vs db: wrong ${JSON.stringify(bad)}; empties last: ${lastNull.join(", ")}; header click → ${clicked}`);
  });

  await run("US3 scenario 4", async () => {
    await go(linus, "/deals/list");
    await Promise.all([linus.waitForURL(/closed=1/), linus.getByLabel("Show closed deals").check()]); await linus.waitForLoadState("networkidle");
    const c = ((await linus.locator(".head-r .count").textContent()) || "").trim();
    const expAll = listExpected("Linus Fake", "d.archived_at is null");
    await go(linus, linus.url().replace(BASE, "") + "&sort=title&dir=asc&q=(");
    const rows = await linus.locator("table.deals-list tbody tr").evaluateAll((els) => els.map((e) => e.querySelector("td").textContent));
    const wonOk = rows.filter((r) => r.includes("(won)")).every((r) => /Won/.test(r.replace("(won)", ""))) && rows.filter((r) => r.includes("(lost)")).every((r) => /Lost/.test(r.replace("(lost)", "")));
    await Promise.all([linus.waitForURL(/status=lost/), linus.selectOption('select[name="status"]', "lost")]); await linus.waitForLoadState("networkidle");
    const lostT = await listTitles(linus); const cl = ((await linus.locator(".head-r .count").textContent()) || "").trim();
    const expLost = listExpected("Linus Fake", "d.archived_at is null and d.status='lost' and d.title like '%(%'");
    check("US3 scenario 4", c === expAll && wonOk && rows.length > 0 && cl === expLost && lostT.every((t) => /lost/.test(t)), `closed shown: "${c}" (expected "${expAll}"); won/lost rows badged ${wonOk} (${rows.length} rows with "("); status=lost → ${JSON.stringify(lostT)} "${cl}"`);
  });

  await run("US3 scenario 5", async () => {
    const path = `/deals/list?q=Bulk&owner=${uid("Linus Fake")}&sort=value&dir=asc&page=2`;
    await go(linus, path); const a = await listTitles(linus); await linus.reload(); await linus.waitForLoadState("networkidle"); const b = await listTitles(linus);
    const other = await login(browser, "linus@barnacle.ai"); await go(other, path); const c = await listTitles(other); await other.context().close();
    await go(linus, "/deals/list?sort=EVILSORT&dir=sideways&pipeline=EVILPIPE&owner=abc&label=abc&status=EVILSTATUS&page=zz&stage=xx&open=EVILOPEN");
    const t = await vis(linus);
    const selects = await linus.locator("select").evaluateAll((els) => els.map((e) => e.name + "=" + e.value).join("&")); const leak = ["EVILSORT", "sideways", "EVILPIPE", "EVILSTATUS", "EVILOPEN", "99999"].filter((s) => t.includes(s));
    const count = ((await linus.locator(".head-r .count").textContent()) || "").trim();
    check("US3 scenario 5", a.length === 10 && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(c) && a[0] === "SF95 Bulk 51" && leak.length === 0 && count === listExpected("Linus Fake"), `page 2 of Bulk by value asc: ${a[0]}…${a[a.length - 1]} (${a.length}); same after reload ${JSON.stringify(a) === JSON.stringify(b)} and in a new session ${JSON.stringify(a) === JSON.stringify(c)}; invalid values ignored (count ${count}), leaked ${JSON.stringify(leak)}; selects ${selects}`);
    await go(linus, "/deals/list?owner=99999&label=99999&pipeline=99999"); note95 = `unknown ids owner/label/pipeline=99999 → "${((await linus.locator(".head-r .count").textContent()) || "").trim()}", selects ${await linus.locator("select").evaluateAll((els) => els.map((e) => e.name + "=" + e.value).join("&"))}`; console.log("NOTE " + note95);
  });

  await run("US3 scenario 6", async () => {
    await go(ada, `/deals?pipeline=${pid("Sales")}`);
    await click(ada, ada.getByRole("link", { name: /^\[ LIST \]$/ }));
    const u1 = ada.url(); const tbl = await ada.locator("table.deals-list").count();
    await click(ada, ada.getByRole("link", { name: /^\[ BOARD \]$/ }));
    const u2 = ada.url(); const cols = await ada.getByRole("region", { name: "Lead in", exact: true }).count();
    check("US3 scenario 6", u1.endsWith("/deals/list") && tbl === 1 && /\/deals(\?|$)/.test(u2.replace(BASE, "")) && cols === 1, `board → [ LIST ] → ${u1} (table ${tbl}); [ BOARD ] → ${u2} (columns ${cols})`);
  });

  let arch1;
  await run("US4 scenario 1", async () => {
    arch1 = mkDeal({ title: "SF95 Archived open", periods: [["Qualified", 2, null]], archived: true });
    mkDeal({ title: "SF95 Archived won", periods: [["Proposal", 2, null]], status: "won", archived: true });
    await go(ada, "/deals/list");
    await Promise.all([ada.waitForURL(/archived=1/), ada.getByLabel("Show archived deals").check()]); await ada.waitForLoadState("networkidle");
    const rows = await ada.locator("table.deals-list tbody tr").evaluateAll((els) => els.map((e) => e.querySelector("td").textContent));
    const titles = await listTitles(ada);
    const exp = sql(`select d.title from deals d where d.archived_at is not null and ${visibleWhere(uid("Ada Fake"))} order by d.created_at desc, d.id desc`).split("\n");
    await Promise.all([ada.waitForURL(/pipeline=\d/), ada.selectOption('select[name="pipeline"]', { label: "Sales" })]); await ada.waitForLoadState("networkidle");
    const t2 = await listTitles(ada);
    const exp2 = sql(`select d.title from deals d join stages s on s.id=d.stage_id where d.archived_at is not null and s.pipeline_id=${pid("Sales")} and ${visibleWhere(uid("Ada Fake"))} order by d.created_at desc, d.id desc`).split("\n");
    check("US4 scenario 1", JSON.stringify(titles) === JSON.stringify(exp) && rows.every((r) => r.includes("Archived")) && JSON.stringify(t2) === JSON.stringify(exp2), `archived only: ${JSON.stringify(titles)} each "Archived" ${rows.every((r) => r.includes("Archived"))}; + Sales: ${JSON.stringify(t2)}`);
  });

  await run("US4 scenario 2", async () => {
    await go(ada, `/deals/${arch1}`);
    const t = await body(ada);
    const n = async (p, name, role = "button") => p.getByRole(role, { name, exact: true }).count();
    const a = { archived: t.includes(`Archived · ${TODAY}`), restore: await n(ada, "[ RESTORE ]"), del: await n(ada, "[ DELETE ]", "link"), edit: await n(ada, "[ EDIT ]", "link"), won: await n(ada, "[ WON ]"), lost: await n(ada, "[ LOST ]", "link"), reopen: await n(ada, "[ REOPEN ]"), follow: await n(ada, "[ FOLLOW ]"), link: await n(ada, "[ LINK PERSON ]"), archive: await n(ada, "[ ARCHIVE ]"), move: await ada.locator("form.stagebar-form").count() };
    await go(linus, `/deals/${arch1}`);
    const l = { restore: await n(linus, "[ RESTORE ]"), del: await n(linus, "[ DELETE ]", "link") };
    const ok = a.archived && a.restore === 1 && a.del === 1 && a.edit + a.won + a.lost + a.reopen + a.follow + a.link + a.archive + a.move === 0 && l.restore === 1 && l.del === 0;
    check("US4 scenario 2", ok, `admin Ada: ${JSON.stringify(a)}; user Linus: ${JSON.stringify(l)}`);
  });

  await run("US4 scenario 3", async () => {
    const id = mkDeal({ title: "SF95 Archive me", value: 50000, periods: [["Negotiation", 2, null]] });
    await go(ada, `/deals?pipeline=${pid("Sales")}&open=${id}`);
    await click(ada, ada.getByRole("complementary", { name: "Deal" }).getByRole("button", { name: "[ ARCHIVE ]" }));
    const gone = (await col(ada, "Negotiation").locator("a.card", { hasText: "SF95 Archive me" }).count()) === 0;
    await go(ada, "/deals/list?archived=1"); const inList = (await listTitles(ada)).includes("SF95 Archive me");
    await click(ada, ada.getByRole("link", { name: "SF95 Archive me", exact: true }));
    await click(ada, btn(ada, "[ RESTORE ]"));
    const h = (await history(ada))[0];
    await go(ada, `/deals?pipeline=${pid("Sales")}`);
    const back = (await col(ada, "Negotiation").locator("a.card", { hasText: "SF95 Archive me" }).count()) === 1;
    check("US4 scenario 3", gone && inList && back && /Restored by Ada Fake/.test(h) && (await tot(ada, "Negotiation")) === boardExpected("Sales", "Negotiation", "Ada Fake"), `archived from drawer (off board ${gone}), found with Show archived ${inList}, restored: back in Negotiation ${back}; history "${h}"`);
  });

  await run("US4 scenario 4", async () => {
    const id = did("Old fake tender (lost)");
    await go(ada, `/deals/${id}`); await click(ada, btn(ada, "[ RESTORE ]"));
    const s = status(id); const t = await body(ada);
    await go(ada, `/deals?pipeline=${pid("Sales")}`); const titles = await boardTitles(ada);
    check("US4 scenario 4", s.startsWith("lost|") && s.endsWith("|false") && t.includes("Lost ·") && !titles.includes("Old fake tender (lost)"), `restored "Old fake tender (lost)": db ${s}; page shows Lost; on board ${titles.includes("Old fake tender (lost)")}`);
  });

  await run("US4 scenario 5", async () => {
    const sales = pid("Sales");
    sql(`insert into stages (pipeline_id, name, position) values (${sales}, 'SF95 Temp', 99)`);
    const id = mkDeal({ title: "SF95 Archived in temp", periods: [["SF95 Temp", 1, null]], archived: true });
    await go(ada, `/admin/pipelines/${sales}?delete=${sid("Sales", "SF95 Temp")}`);
    await ada.selectOption('select[name="targetStageId"]', { label: "Sales · Proposal" });
    await click(ada, btn(ada, "[ MOVE DEALS AND DELETE ]"));
    const stageAfterDelete = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${id}`);
    await go(ada, `/deals/${id}`); await click(ada, btn(ada, "[ RESTORE ]"));
    const now = (await bar(ada)).find((x) => x.now)?.name;
    await go(ada, `/deals?pipeline=${sales}`);
    const onBoard = (await col(ada, "Proposal").locator("a.card", { hasText: "SF95 Archived in temp" }).count()) === 1;
    check("US4 scenario 5", stageAfterDelete === "Proposal" && now === "Proposal" && onBoard, `stage "SF95 Temp" deleted (deals to Proposal): archived deal's stage ${stageAfterDelete}; after restore the bar's current stage ${now}, on board in Proposal ${onBoard}`);
  });

  let linkId;
  const pick = async (page, name) => { await page.getByRole("combobox", { name: "Person" }).fill(name); await page.getByRole("listbox", { name: "People" }).getByRole("button", { name, exact: true }).click(); };
  await run("US5 scenario 1", async () => {
    linkId = mkDeal({ title: "SF95 Link deal", person: MAINP, periods: [["Lead in", 1, null]] });
    const name = one(`select btrim(first_name||' '||last_name) from persons where not private and archived_at is null and btrim(first_name||' '||last_name) <> '${MAINP}' order by id offset 3 limit 1`);
    await go(ada, `/deals/${linkId}`); await pick(ada, name); await click(ada, btn(ada, "[ LINK PERSON ]"));
    const list = ada.getByRole("list", { name: "Other people" });
    const href = await list.getByRole("link", { name, exact: true }).getAttribute("href");
    const h1 = (await history(ada))[0];
    await click(ada, list.getByRole("button", { name: `Unlink ${name}` }));
    const after = await list.textContent(); const h2 = (await history(ada))[0];
    check("US5 scenario 1", href === `/people/${personId(name)}` && h1.includes(`Linked ${name} by Ada Fake`) && !after.includes(name) && h2.includes(`Unlinked ${name} by Ada Fake`), `linked ${name}: link ${href}, history "${h1}"; unlink: removed ${!after.includes(name)}, history "${h2}"`);
  });

  await run("US5 scenario 2", async () => {
    const name = one(`select btrim(first_name||' '||last_name) from persons where not private and archived_at is null and btrim(first_name||' '||last_name) <> '${MAINP}' order by id offset 4 limit 1`);
    await go(ada, `/deals/${linkId}`); await pick(ada, name); await click(ada, btn(ada, "[ LINK PERSON ]"));
    const n0 = one(`select count(*) from timeline_events where deal_id=${linkId}`);
    const MSG = "This person is already linked to this deal.";
    await pick(ada, name); await click(ada, btn(ada, "[ LINK PERSON ]")); const a = (await vis(ada)).includes(MSG);
    await go(ada, `/deals/${linkId}`); await pick(ada, MAINP); await click(ada, btn(ada, "[ LINK PERSON ]")); const b = (await vis(ada)).includes(MSG);
    const n1 = one(`select count(*) from timeline_events where deal_id=${linkId}`); const links = one(`select count(*) from deal_people where deal_id=${linkId}`);
    check("US5 scenario 2", a && b && n0 === n1 && links === "1", `other person again: message ${a}; main person Robin Leftfake: message ${b}; events ${n0}→${n1}, links ${links}`);
  });

  await run("US5 scenario 3", async () => {
    // give the deal its main person's organisation first, so saving changes only the labels (SF-93 FR-006 fills an empty organisation)
    sql(`update deals d set organisation_id=p.organisation_id from persons p where p.id=d.person_id and d.id=${linkId} and d.organisation_id is null`);
    await go(ada, `/deals/${linkId}/edit?back=page`);
    await ada.getByRole("group", { name: "Labels" }).getByLabel("Renewal").check(); await ada.getByRole("group", { name: "Labels" }).getByLabel("Big ticket").check();
    await click(ada, ada.locator("text=[ SAVE ]"));
    const t = await body(ada); const h = (await history(ada))[0];
    await go(ada, `/deals/list?label=${one("select id from deal_labels where name='Renewal'")}&q=SF95`);
    const row = await ada.locator("tr", { hasText: "SF95 Link deal" }).first().textContent().catch(() => "");
    check("US5 scenario 3", /Labels\s*Big ticket, Renewal/.test(t) && /Edited by Ada Fake: Labels/.test(h) && row.includes("Big ticket, Renewal") && (await listTitles(ada)).join() === "SF95 Link deal", `page labels "Big ticket, Renewal" ${/Labels\s*Big ticket, Renewal/.test(t)}; history "${h}"; label filter Renewal + "SF95" finds ${JSON.stringify(await listTitles(ada))}, row shows labels ${row.includes("Big ticket, Renewal")}`);
  });

  await run("US5 scenario 4", async () => {
    sql(`update deal_labels set name='Seed hot' where name='Hot'`);
    const P = "/admin/lead-sources-and-labels";
    await go(ada, P);
    const region = ada.getByRole("region", { name: "Deal labels" });
    await region.getByLabel("New deal label").fill("Hot"); await click(ada, region.getByRole("button", { name: "[ ADD ]" }));
    const inDeal = (await ada.getByRole("region", { name: "Deal labels" }).locator('input[aria-label="Name of Hot"]').count()) === 1;
    const inPeople = (await ada.getByRole("region", { name: "Labels", exact: true }).locator('input[aria-label="Name of Hot"]').count());
    const peopleHot = inPeople; // the seed has a people label "Hot" too
    const dealOffers = async (id) => { await go(ada, `/deals/${id}/edit`); return (await ada.getByRole("group", { name: "Labels" }).locator("label").allTextContents()).map((s) => s.trim()).sort(); };
    const expDeal = sql("select name from deal_labels where removed_at is null").split("\n").sort();
    const offer1 = await dealOffers(barId);
    await go(ada, "/people/new"); const personOffer = (await ada.getByRole("group", { name: "Labels" }).locator("label").allTextContents()).map((s) => s.trim()).sort();
    const expPeople = sql("select name from labels where removed_at is null").split("\n").sort();
    // rename to Very hot, then a duplicate
    await go(ada, P);
    await ada.getByLabel("Name of Hot").last().fill("Very hot"); await click(ada, ada.getByRole("button", { name: "Rename Hot" }).last());
    const renamed = one(`select count(*) from deal_labels where name='Very hot'`);
    const before = sql("select id||name||coalesce(removed_at::text,'') from deal_labels order by id");
    await ada.getByRole("region", { name: "Deal labels" }).getByLabel("New deal label").fill("  very HOT ");
    await click(ada, ada.getByRole("region", { name: "Deal labels" }).getByRole("button", { name: "[ ADD ]" }));
    const dup1 = (await vis(ada)).includes("This name is already used.");
    await ada.getByRole("region", { name: "Deal labels" }).getByLabel("Name of Warm").fill(" very hot"); await click(ada, ada.getByRole("button", { name: "Rename Warm" }));
    const dup2 = (await vis(ada)).includes("This name is already used.");
    const same = before === sql("select id||name||coalesce(removed_at::text,'') from deal_labels order by id");
    // give the label to the Bar deal, then remove it
    sql(`insert into deal_label_links (deal_id, label_id) select ${barId}, id from deal_labels where name='Very hot'`);
    await go(ada, P); await click(ada, ada.getByRole("region", { name: "Deal labels" }).getByRole("button", { name: "Remove Very hot" }));
    const removed = one(`select removed_at is not null from deal_labels where name='Very hot'`);
    const offerOther = await dealOffers(linkId); const offerHas = await dealOffers(barId);
    // non-admin
    await go(linus, P); const denied = (await vis(linus)).includes("You don't have access to this page.");
    const st = await postAction(ada, P, "[ ADD ]", { name: "Linus label" }, linus).catch((e) => "err " + e.message);
    // the deal label add form is the third [ ADD ]: post through it explicitly
    await go(ada, P);
    const field = await ada.getByRole("region", { name: "Deal labels" }).getByRole("button", { name: "[ ADD ]" }).locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const r = await linus.request.post(BASE + P, { multipart: { [field]: "", name: "Linus deal label" }, maxRedirects: 0 });
    const linusAdded = one(`select count(*) from deal_labels where name ilike 'Linus%'`) + one(`select count(*) from labels where name ilike 'Linus%'`);
    const ok = inDeal && JSON.stringify(offer1) === JSON.stringify(expDeal) && JSON.stringify(personOffer) === JSON.stringify(expPeople) && !personOffer.includes("Big ticket") && renamed === "1" && dup1 && dup2 && same && removed === "t" && !offerOther.includes("Very hot") && offerHas.includes("Very hot") && denied && linusAdded === "00";
    check("US5 scenario 4", ok, `added Hot under Deal labels ${inDeal} (people "Hot" is the seed's people label: ${peopleHot}); edit form offers ${JSON.stringify(offer1)}; person form ${JSON.stringify(personOffer)}; renamed ${renamed}; duplicate add "  very HOT " msg ${dup1}, rename Warm→" very hot" msg ${dup2}, nothing saved ${same}; removed ${removed}: deal without it offers ${JSON.stringify(offerOther)}, deal with it ${JSON.stringify(offerHas)}; Linus page denied ${denied}, direct posts status ${st}/${r.status()}, labels added ${linusAdded}`);
  });

  await run("US5 scenario 5", async () => {
    const n0 = one(`select count(*) from timeline_events where deal_id=${linkId}`);
    await go(linus, `/deals/${linkId}`); await click(linus, btn(linus, "[ FOLLOW ]"));
    const t = await body(linus); const un = await btn(linus, "[ UNFOLLOW ]").count();
    const n1 = one(`select count(*) from timeline_events where deal_id=${linkId}`);
    await click(linus, btn(linus, "[ UNFOLLOW ]")); const t2 = await body(linus);
    check("US5 scenario 5", /Followers\s*Linus Fake/.test(t) && un === 1 && n0 === n1 && !/Followers\s*Linus Fake/.test(t2), `Followers shows Linus ${/Followers\s*Linus Fake/.test(t)}, button [ UNFOLLOW ] ${un}; events ${n0}→${n1}; unfollow removes ${!/Followers\s*Linus Fake/.test(t2)}`);
  });

  await run("US5 scenario 6", async () => {
    const id = mkDeal({ title: "SF95 Private link", periods: [["Lead in", 1, null]] });
    await go(ada, `/deals/${id}`); await pick(ada, "Gus Lorem"); await click(ada, btn(ada, "[ LINK PERSON ]"));
    const adaSees = (await ada.getByRole("list", { name: "Other people" }).textContent()).includes("Gus Lorem");
    await go(linus, `/deals/${id}`);
    const t = await vis(linus); const items = await linus.getByRole("list", { name: "Other people" }).locator("li").count();
    const h = await history(linus);
    check("US5 scenario 6", adaSees && !t.includes("Gus Lorem") && !t.includes("Gus") && items === 0 && !h.some((x) => /Linked/.test(x)), `Ada linked private Gus Lorem (shown to her ${adaSees}); Linus: name absent ${!t.includes("Gus Lorem")}, other people items ${items}, history ${JSON.stringify(h)}`);
  });

  await run("Edge case 1", async () => {
    const a = mkDeal({ title: "SF95 Days 0", periods: [["Lead in", 0.5, null]] });
    const b = mkDeal({ title: "SF95 Days 1", periods: [["Lead in", 1.5, null]] });
    const c = mkDeal({ title: "SF95 Days 12", periods: [["Lead in", 12.9, null]] });
    const d = mkDeal({ title: "SF95 Days back", periods: [["Lead in", 10, 8], ["Qualified", 8, 5.5], ["Lead in", 5.5, 2.5], ["Qualified", 2.5, null]] });
    const out = [];
    for (const id of [a, b, c]) { await go(ada, `/deals/${id}`); out.push((await bar(ada))[0].days); }
    await go(ada, `/deals/${d}`); const bd = await bar(ada);
    check("Edge case 1", out.join("|") === "0 days|1 day|12 days" && bd[0].days === "5 days" && bd[1].days === "5 days", `0.5/1.5/12.9 days in Lead in → ${out.join(", ")}; Lead in 2+3 days and Qualified 2.5+2.5 → ${bd[0].days}, ${bd[1].days}`);
  });

  await run("Edge case 2", async () => {
    const id = mkDeal({ title: "SF95 Cross pipeline", periods: [["Proposal", 3, null]] });
    await go(ada, `/deals?pipeline=${pid("Sales")}&open=${id}`);
    const target = await ada.locator('select[name="toStageId"] option').evaluateAll((els) => els.map((e) => e.textContent).find((t) => t.startsWith("Ambassadors")));
    await ada.selectOption('select[name="toStageId"]', { label: target });
    await click(ada, btn(ada, "[ MOVE ]"));
    await go(ada, `/deals/${id}`);
    const b = await bar(ada); const stages = sql(`select name from stages where pipeline_id=${pid("Ambassadors")} order by position`).split("\n");
    const h = (await history(ada))[0];
    check("Edge case 2", JSON.stringify(b.map((x) => x.name)) === JSON.stringify(stages) && h.includes(`Moved from Sales · Proposal to ${target}`), `bar ${JSON.stringify(b.map((x) => x.name + ":" + x.days))} = Ambassadors stages; history "${h}"`);
  });

  await run("Edge case 3", async () => {
    const id = mkDeal({ title: "SF95 Frozen", periods: [["Proposal", 4.3, null]] });
    await go(ada, `/deals/${id}`); await click(ada, btn(ada, "[ WON ]"));
    // a week later
    sql(`update deal_stage_periods set entered_at = entered_at - interval '7 days', left_at = left_at - interval '7 days' where deal_id=${id}; update deals set closed_at = closed_at - interval '7 days' where id=${id}`);
    await go(ada, `/deals/${id}`); const won = (await bar(ada))[2].days;
    await click(ada, btn(ada, "[ REOPEN ]")); const reopened = (await bar(ada))[2].days;
    sql(`update deal_stage_periods set entered_at = entered_at - interval '1 day' where deal_id=${id} and left_at is null`);
    await go(ada, `/deals/${id}`); const later = (await bar(ada))[2].days;
    const arch = mkDeal({ title: "SF95 Archived counting", periods: [["Proposal", 2.2, null]], archived: true });
    await go(ada, `/deals/${arch}`); const a1 = (await bar(ada))[2].days;
    sql(`update deal_stage_periods set entered_at = entered_at - interval '1 day' where deal_id=${arch}`);
    await go(ada, `/deals/${arch}`); const a2 = (await bar(ada))[2].days;
    check("Edge case 3", won === "4 days" && reopened === "4 days" && later === "5 days" && a1 === "2 days" && a2 === "3 days", `won 4.3 days into Proposal, a week later ${won}; reopened ${reopened}, a day after ${later}; archived open deal 2 → ${a1}, a day later ${a2}`);
  });

  await run("Edge case 4", async () => {
    const id = mkDeal({ title: "SF95 Closed edit", value: 10000, periods: [["Qualified", 1, null]], status: "won" });
    await go(ada, `/deals/${id}/edit?back=page`);
    await ada.fill('input[name="title"]', "SF95 Closed edited"); await ada.fill('input[name="value"]', "250");
    await ada.getByRole("group", { name: "Labels" }).getByLabel("Cold").check();
    await click(ada, ada.locator("text=[ SAVE ]"));
    const s = status(id); const title = one(`select title from deals where id=${id}`);
    const b = await bar(ada); const noMove = b.every((x) => !x.btn);
    await go(ada, `/deals/list?closed=1&q=SF95%20Closed&open=${id}`);
    const dr = ada.getByRole("complementary", { name: "Deal" }); const drT = await dr.textContent(); const mv = await dr.locator('select[name="toStageId"]').count();
    // a direct move request is refused
    const field = await (async () => { await go(ada, `/deals/${barId}`); return ada.locator("form.stagebar-form").locator('input[name^="$ACTION_ID_"]').getAttribute("name"); })();
    const v = one(`select version from deals where id=${id}`);
    await ada.request.post(BASE + `/deals/${id}`, { multipart: { [field]: "", id: String(id), version: v, fromStageId: String(sid("Sales", "Qualified")), toStageId: String(sid("Sales", "Proposal")) }, maxRedirects: 0 });
    const stageAfter = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${id}`);
    await go(ada, `/deals/${id}`); await click(ada, btn(ada, "[ ARCHIVE ]"));
    const archived = one(`select archived_at is not null from deals where id=${id}`);
    check("Edge case 4", title === "SF95 Closed edited" && s.startsWith("won|") && s.split("|")[4] === "25000" && noMove && /Won/.test(drT) && mv === 0 && stageAfter === "Qualified" && archived === "t", `edited won deal: title ${title}, db ${s}; bar buttons none ${noMove}; list drawer shows Won ${/Won/.test(drT)}, Move to pickers ${mv}; direct stage-bar post leaves stage ${stageAfter}; archived ${archived}`);
  });

  await run("Edge case 5", async () => {
    const id = mkDeal({ title: "SF95 Reason", periods: [["Qualified", 1, null]] });
    await go(ada, `/deals/${id}?confirm=lost`);
    const max = await ada.locator("textarea[name=reason]").getAttribute("maxlength");
    // 501 characters by a direct post (the box's textarea stops at 500)
    const field = await ada.getByRole("dialog").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const v = one(`select version from deals where id=${id}`);
    const r = await ada.request.post(BASE + `/deals/${id}`, { multipart: { [field]: "", id: String(id), version: v, reason: "x".repeat(501) }, maxRedirects: 0 });
    const after501 = status(id);
    await go(ada, `/deals/${id}?confirm=lost`);
    const reason = '  <b>Bold</b> see https://example.com [x](http://evil.test) **star**  ';
    await ada.getByRole("dialog").locator("textarea").fill(reason);
    await click(ada, btn(ada, "[ MARK AS LOST ]"));
    const stored = one(`select lost_reason from deals where id=${id}`);
    const shown = await ada.locator(".lost-reason").textContent();
    const tags = await ada.locator(".lost-reason b, .lost-reason a, .lost-reason strong").count();
    const hist = (await history(ada))[0];
    const id2 = mkDeal({ title: "SF95 Reason 500", periods: [["Qualified", 1, null]] });
    await go(ada, `/deals/${id2}?confirm=lost`); await ada.getByRole("dialog").locator("textarea").fill("y".repeat(500)); await click(ada, btn(ada, "[ MARK AS LOST ]"));
    const len500 = one(`select length(lost_reason) from deals where id=${id2}`);
    check("Edge case 5", max === "500" && after501.startsWith("open|") && stored === reason.trim() && shown.includes(reason.trim()) && tags === 0 && hist.includes(reason.trim()) && len500 === "500", `textarea maxlength ${max}; 501 chars posted → still ${after501.split("|")[0]} (http ${r.status()}); spaces trimmed: stored "${stored}"; shown as plain text (no b/a/strong: ${tags}); 500 chars saved ${len500}`);
  });

  await run("Edge case 6", async () => {
    const a = mkDeal({ title: "SF95 Same won", value: 77700, owner: "Grace Fake", periods: [["Proposal", 1, null]] });
    const b = mkDeal({ title: "SF95 Same lost", value: 88800, owner: "Linus Fake", periods: [["Negotiation", 1, null]] });
    const pick = (id) => one(`select value_pence||'|'||owner_id||'|'||stage_id from deals where id=${id}`);
    const a0 = pick(a), b0 = pick(b);
    await go(ada, `/deals/${a}`); await click(ada, btn(ada, "[ WON ]"));
    await go(ada, `/deals/${b}?confirm=lost`); await ada.getByRole("dialog").locator("textarea").fill("Fake reason"); await click(ada, btn(ada, "[ MARK AS LOST ]"));
    check("Edge case 6", a0 === pick(a) && b0 === pick(b) && status(a).startsWith("won") && status(b).startsWith("lost"), `value|owner|stage before/after: won ${a0} → ${pick(a)}, lost ${b0} → ${pick(b)}`);
  });

  await run("Edge case 7", async () => {
    sql(`insert into persons (first_name, last_name, created_by, owner_id) values ('Zed', 'Archfake', ${A}, ${A}), ('Yan', 'Delfake', ${A}, ${A})`);
    const id = mkDeal({ title: "SF95 People edge", periods: [["Lead in", 1, null]] });
    await go(ada, `/deals/${id}`);
    await pick(ada, "Zed Archfake"); await click(ada, btn(ada, "[ LINK PERSON ]"));
    await pick(ada, "Yan Delfake"); await click(ada, btn(ada, "[ LINK PERSON ]"));
    sql(`update persons set archived_at = now() where first_name='Zed' and last_name='Archfake'`);
    await go(ada, `/deals/${id}`);
    const li = await ada.getByRole("list", { name: "Other people" }).locator("li", { hasText: "Zed Archfake" }).textContent();
    await go(ada, `/people/${personId("Yan Delfake")}?confirm=delete`);
    await click(ada, btn(ada, "[ DELETE FOR GOOD ]"));
    await go(ada, `/deals/${id}`);
    const others = await ada.getByRole("list", { name: "Other people" }).textContent(); const h = await history(ada);
    check("Edge case 7", li.includes("Archived") && !others.includes("Yan Delfake") && h.some((x) => x.includes("A deleted person was linked")) && one(`select count(*) from deal_people where deal_id=${id}`) === "1", `archived Zed shown "${li.trim()}"; Yan deleted: other people "${others.trim()}", history ${JSON.stringify(h)}`);
  });

  await run("Edge case 8", async () => {
    // Use the seed's "Seed hot" (renamed from Hot in US5-4) back as "Hot".
    sql(`update deal_labels set name='Hot' where name='Seed hot'; delete from deal_label_links where label_id in (select id from deal_labels where name='Very hot'); delete from deal_labels where name='Very hot'`);
    const a = did("Fakeco website"); const hot = one("select id from deal_labels where name='Hot'");
    await go(ada, "/admin/lead-sources-and-labels"); await click(ada, ada.getByRole("region", { name: "Deal labels" }).getByRole("button", { name: "Remove Hot" }));
    await go(ada, `/deals/${a}`); const page = /Labels\s*[^\n]*Hot/.test(await body(ada));
    await go(ada, `/deals/list?q=Fakeco%20website`); const row = await ada.locator("tr", { hasText: "Fakeco website" }).first().textContent();
    const opts = await ada.locator('select[name="label"] option').allTextContents();
    await go(ada, `/deals/list?label=${hot}`); const found = await listTitles(ada);
    await go(ada, `/deals/${barId}/edit`); const other = (await ada.getByRole("group", { name: "Labels" }).locator("label").allTextContents()).map((s) => s.trim());
    await go(ada, `/deals/${a}/edit?back=page`); const hotBox = ada.getByRole("group", { name: "Labels" }).getByLabel("Hot", { exact: true });
    const ticked = await hotBox.isChecked();
    await ada.fill('input[name="title"]', "Fakeco website"); await click(ada, ada.locator("text=[ SAVE ]"));
    const kept = one(`select count(*) from deal_label_links where deal_id=${a} and label_id=${hot}`);
    await go(ada, `/deals/${did("Mock Labs audit")}`); const fol = /Alan Fake \(deactivated\)/.test(await body(ada));
    check("Edge case 8", page && row.includes("Hot") && opts.includes("Hot") && found.includes("Fakeco website") && !other.includes("Hot") && ticked && kept === "1" && fol, `after removing Hot: deal page shows it ${page}, list row ${row.includes("Hot")}, label filter offers ${opts.includes("Hot")} and finds ${JSON.stringify(found)}; other deal's form ${JSON.stringify(other)}; deal A's form ticked ${ticked}, kept after save ${kept}; "Alan Fake (deactivated)" follower ${fol}`);
  });

  await run("Edge case 9", async () => {
    const priv = did("Fake secret project");
    await go(linus, "/deals/list?q=Fake%20secret"); const lt = await vis(linus);
    await go(linus, "/deals/list"); const count = ((await linus.locator(".head-r .count").textContent()) || "").trim();
    await go(ada, "/deals/list"); const adaCount = ((await ada.locator(".head-r .count").textContent()) || "").trim();
    // direct [ WON ] post by Linus on the private deal
    await go(ada, `/deals/${priv}`);
    const field = await btn(ada, "[ WON ]").locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const v = one(`select version from deals where id=${priv}`);
    await linus.request.post(BASE + `/deals/${priv}`, { multipart: { [field]: "", id: String(priv), version: v }, maxRedirects: 0 });
    const s = status(priv); const expL = listExpected("Linus Fake"), expA = listExpected("Ada Fake");
    // losing sight: Linus owns Ada's deal, makes it private and gives it to Margaret
    const id = mkDeal({ title: "SF95 Lose sight", owner: "Linus Fake", periods: [["Lead in", 1, null]] });
    await go(linus, `/deals/${id}/edit?back=page`);
    await linus.check('input[name="private"]'); await linus.selectOption('select[name="ownerId"]', { label: "Margaret Fake" });
    await click(linus, linus.locator("text=[ SAVE ]"));
    const url = linus.url(); const msg = (await vis(linus)).includes("You can no longer see SF95 Lose sight: only its creator and owner can.");
    check("Edge case 9", !lt.includes("Fake secret project") && count === expL && adaCount === expA && count !== adaCount && s.startsWith("open|") && url.endsWith("/deals/list") && msg, `Linus list: no private deal, "${count}" vs Ada "${adaCount}"; Linus direct WON post: ${s.split("|")[0]}; lose sight → ${url} with message ${msg}`);
  });

  await run("Edge case 10", async () => {
    await go(linus, "/deals/list?page=99"); const last = await listTitles(linus);
    const pager = (await linus.locator("body").textContent()).match(/Page \d+ of \d+|\d+ \/ \d+/)?.[0];
    await go(linus, "/deals/list?page=3"); const p2 = await listTitles(linus);
    const amb = pid("Ambassadors"); const salesStage = sid("Sales", "Proposal");
    await go(linus, `/deals/list?pipeline=${amb}&stage=${salesStage}`);
    const c = ((await linus.locator(".head-r .count").textContent()) || "").trim();
    const stageSel = await linus.locator('select[name="stage"]').inputValue().catch(() => "none");
    check("Edge case 10", JSON.stringify(last) === JSON.stringify(p2) && last.length > 0 && c === listExpected("Linus Fake", `d.archived_at is null and d.status='open' and s.pipeline_id=${amb}`) && stageSel === "", `page=99 shows the last page (= page 2, ${last.length} rows, pager ${pager}); Ambassadors + a Sales stage → "${c}" (whole pipeline), stage select "${stageSel}"`);
  });

  await run("Edge case 11", async () => {
    const base = async (q) => { await go(linus, "/deals/list" + q); return { c: ((await linus.locator(".head-r .count").textContent()) || "").trim(), t: await listTitles(linus),
      owner: await linus.locator('select[name="owner"] option:checked').textContent().catch(() => "none"), label: await linus.locator('select[name="label"] option:checked').textContent().catch(() => "none"),
      clear: await linus.getByRole("link", { name: /CLEAR/ }).count(), txt: await vis(linus) }; };
    const plain = await base(""); const o = await base("?owner=99999"); const l = await base("?label=99999"); const both = await base("?owner=99999&label=99999&sort=value&dir=desc");
    const sorted = await base("?sort=value&dir=desc");
    const ok = (x, y) => x.c === y.c && JSON.stringify(x.t) === JSON.stringify(y.t) && /Any owner/.test(x.owner) && /Any label/.test(x.label) && x.clear === 0 && !x.txt.includes("99999") && !x.txt.includes("No deals match");
    check("Edge case 11", ok(o, plain) && ok(l, plain) && ok(both, sorted) && plain.c === listExpected("Linus Fake"), `plain "${plain.c}"; owner=99999 "${o.c}" sel "${o.owner}" clear ${o.clear}; label=99999 "${l.c}" sel "${l.label}" clear ${l.clear}; both+sort "${both.c}" rows same ${JSON.stringify(both.t) === JSON.stringify(sorted.t)}`);
  });

  await run("Edge case 13", async () => {
    // US4 scenario 4 restored the seeded archived lost deal: add one so every status is archived. Ada does not see
    // Alan's private archived "Fake leaver old deal" (SF-97), so expectations use visibleWhere.
    mkDeal({ title: "SF95 Archived lost", periods: [["Qualified", 1, null]], status: "lost", reason: "Fake reason", archived: true });
    await go(ada, "/deals/list?closed=1&archived=1");
    const vw = visibleWhere(uid("Ada Fake"));
    const t = await listTitles(ada); const exp = sql(`select d.title from deals d where d.archived_at is not null and ${vw} order by d.created_at desc, d.id desc`).split("\n");
    const st = sql(`select distinct d.status from deals d where d.archived_at is not null and ${vw} order by 1`).replace(/\n/g, ",");
    const c = ((await ada.locator(".head-r .count").textContent()) || "").trim();
    check("Edge case 13", JSON.stringify(t) === JSON.stringify(exp) && st.split(",").length === 3 && c === listExpected("Ada Fake", "d.archived_at is not null"), `both ticked: ${JSON.stringify(t)} (statuses ${st}), "${c}"`);
  });

  await run("Edge case 14", async () => {
    const id = mkDeal({ title: "SF95 Delete me", periods: [["Lead in", 1, null]] });
    await go(ada, `/deals/${id}`); await click(ada, ada.getByRole("link", { name: "[ DELETE ]" }));
    const conf = (await vis(ada)).includes("Delete SF95 Delete me for good? This can't be undone.");
    await click(ada, btn(ada, "[ DELETE FOR GOOD ]"));
    const url = ada.url(); const msg = (await vis(ada)).includes("SF95 Delete me was deleted.");
    const gone = one(`select count(*) from deals where id=${id}`);
    // a non-admin's direct delete request
    const id2 = mkDeal({ title: "SF95 Keep me", periods: [["Lead in", 1, null]] });
    await go(ada, `/deals/${id2}?confirm=delete`);
    const field = await btn(ada, "[ DELETE FOR GOOD ]").locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    await linus.request.post(BASE + `/deals/${id2}`, { multipart: { [field]: "", id: String(id2), back: "list" }, maxRedirects: 0 });
    const kept = one(`select count(*) from deals where id=${id2}`);
    await go(linus, `/deals/${id2}`); const noBtn = await linus.getByRole("link", { name: "[ DELETE ]" }).count();
    check("Edge case 14", conf && url.endsWith("/deals/list") && msg && gone === "0" && kept === "1" && noBtn === 0, `confirm text ${conf}; → ${url} "SF95 Delete me was deleted." ${msg}; deleted ${gone === "0"}; Linus direct delete refused (deal kept ${kept}), no [ DELETE ] for him ${noBtn === 0}`);
  });

  await run("Edge case 12", async () => {
    await go(ada, "/deals/list?q=zzzznothing"); const a = (await vis(ada)).includes("No deals match these filters.");
    sql("delete from deals");
    await go(ada, "/deals/list"); const b = (await vis(ada)).includes("No deals yet.");
    check("Edge case 12", a && b, `filter with no match → "No deals match these filters." ${a}; no deals at all → "No deals yet." ${b}`);
  });

  await browser.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
})();
