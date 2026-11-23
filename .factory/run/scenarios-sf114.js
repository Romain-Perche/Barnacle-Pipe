// SF-114 AI-review scenarios (US1 1–5, US2 1–7, US3 1–7, US4 1–4, US5 1–2, edge cases 1–12), against :3000/crm_dev on
// fresh fake data: `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf114.js`
// (`ONLY="US1 scenario 1,Edge case 4"` for a subset). Setup by SQL ("SF114 …" records); actions through the UI.
const { execSync } = require("child_process");
const { chromium, results, check, signIn } = require("./lib");
const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DB || "crm_dev";
const sql = (s) => execSync(`psql -h localhost -U postgres ${DB} -tA -v ON_ERROR_STOP=1`, { input: s }).toString().trim();
const U = { ada: 1, grace: 2, linus: 3, margaret: 4, alan: 5 };
const NAMES = { ada: "Ada Fake", grace: "Grace Fake", linus: "Linus Fake", margaret: "Margaret Fake" };
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const q = (s) => s.replace(/'/g, "''");
const pid = (name) => +sql(`select id from persons where btrim(first_name||' '||last_name)='${q(name)}' order by id limit 1`);
const did = (title) => +sql(`select id from deals where title='${q(title)}' order by id limit 1`);
function mkPerson(first, last, o = {}) {
  const by = o.by || 1, owner = o.owner || by;
  const id = +sql(`insert into persons (first_name, last_name, owner_id, created_by, private, organisation_id, is_ambassador, referred_by_id, referred_at, created_at, archived_at, lead_source_id)
    values ('${q(first)}', '${q(last)}', ${owner}, ${by}, ${!!o.private}, ${o.org || "null"}, ${!!o.amb}, ${o.ref || "null"}, ${o.ref ? "now()" : "null"}, now() - interval '${o.ago || "0 s"}', ${o.archived ? "now()" : "null"}, ${o.source || "null"}) returning id`).split("\n")[0];
  sql(`insert into timeline_events (person_id, kind, actor_id, created_at) values (${id}, 'added', ${by}, now() - interval '${o.ago || "0 s"}')`);
  if (o.email) sql(`insert into person_emails (person_id, email, kind, position) values (${id}, '${o.email}', 'work', 0)`);
  return id;
}
function mkOrg(name) { return +sql(`insert into organisations (name, owner_id, created_by) values ('${q(name)}', 1, 1) returning id`).split("\n")[0]; }
function mkDeal(title, o = {}) {
  const by = o.by || 1, owner = o.owner || by;
  const stage = sql(`select s.id from stages s join pipelines p on p.id=s.pipeline_id where p.name='Sales' and s.name='Lead in'`);
  const status = o.status || "open";
  const id = +sql(`insert into deals (title, value_pence, stage_id, person_id, owner_id, private, created_by, referred_by_id, referred_at, status, closed_at, lost_reason, archived_at, created_at)
    values ('${q(title)}', ${o.value ?? "null"}, ${stage}, ${o.person || "null"}, ${owner}, ${!!o.private}, ${by}, ${o.ref || "null"}, ${o.ref ? "now()" : "null"}, '${status}',
            ${status === "open" ? "null" : "now()"}, ${status === "lost" ? "'Fake reason'" : "null"}, ${o.archived ? "now()" : "null"}, now() - interval '${o.ago || "0 s"}') returning id`).split("\n")[0];
  sql(`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name) values (${id}, ${stage}, 'Lead in', 'Sales')`);
  sql(`insert into timeline_events (deal_id, kind, actor_id, created_at) values (${id}, 'added', ${by}, now() - interval '${o.ago || "0 s"}')`);
  return id;
}
const note = (col, id, body, by = 1, ago = "0 s") =>
  +sql(`insert into timeline_events (${col}, kind, actor_id, body, created_at) values (${id}, 'note', ${by}, '${q(body)}', now() - interval '${ago}') returning id`).split("\n")[0];

const ctxs = {};
let browser;
async function as(user) {
  if (ctxs[user]) return ctxs[user];
  const c = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await c.newPage();
  await signIn(p, BASE, `${user}@barnacle.ai`, NAMES[user]);
  return (ctxs[user] = p);
}
async function go(p, path) { await p.goto(BASE + path); await p.waitForLoadState("networkidle"); }
const text = async (p, sel = "main") => norm(await p.locator(sel).first().textContent());
const dd = (p, label, scope = "main") => p.locator(scope).locator(`dt:text-is("${label}") + dd`).first();
async function referredBy(p, scope = "main") { const d = dd(p, "Referred by", scope); return { text: norm(await d.textContent()), href: await d.locator("a").first().getAttribute("href").catch(() => null), links: await d.locator("a").count() }; }
const tlTexts = async (p) => (await p.getByRole("region", { name: "Timeline" }).locator("li.ent").allTextContents()).map(norm);
async function save(p) { await p.getByRole("button", { name: "[ SAVE ]" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle"); }
async function pickerOptions(p, typed) {
  const cb = p.getByRole("combobox", { name: "Referred by" });
  if (!(await cb.count())) { await p.getByRole("button", { name: "Clear Referred by" }).click(); }
  await cb.fill(""); await cb.click(); await cb.fill(typed); await p.waitForTimeout(250);
  return (await p.getByRole("listbox", { name: "Ambassadors" }).getByRole("option").allTextContents().catch(() => [])).map(norm);
}
async function pickRef(p, name, detail) {
  await pickerOptions(p, name);
  const opts = p.getByRole("listbox", { name: "Ambassadors" }).getByRole("option").filter({ hasText: detail || name });
  await opts.first().locator("button").click();
}
async function clearRef(p) { if (await p.getByRole("button", { name: "Clear Referred by" }).count()) await p.getByRole("button", { name: "Clear Referred by" }).click(); }
async function setHidden(p, name, value) {
  await p.evaluate(([n, v]) => {
    const f = [...document.querySelectorAll("form")].find((x) => x.querySelector("input[name=firstName], input[name=title]"));
    let i = f.querySelector(`input[name="${n}"]`);
    if (!i) { i = document.createElement("input"); i.type = "hidden"; i.name = n; f.appendChild(i); }
    i.value = v;
  }, [name, value]);
}
async function ambRows(p) {
  await go(p, "/ambassadors");
  return p.$$eval("table tbody tr", (trs) => trs.map((tr) => ({ name: tr.querySelector("a.nm")?.textContent.trim(), href: tr.querySelector("a.nm")?.getAttribute("href"), cells: [...tr.querySelectorAll("td")].map((td) => td.textContent.replace(/\s+/g, " ").trim()) })));
}
async function strip(p) { return p.$$eval("dl.strip[aria-label=Summary] > div", (ds) => Object.fromEntries(ds.map((d) => [d.querySelector("dt").textContent.trim(), d.querySelector("dd").textContent.trim()]))); }
const sectRows = (p, name) => p.getByRole("region", { name }).locator("tbody tr");
async function sectNames(p, name) { return (await sectRows(p, name).locator("a.nm").allTextContents()).map(norm); }
async function updates(p) { return p.$$eval("section[aria-label='Latest updates'] li.ent", (ls) => ls.map((l) => ({ id: l.id, tag: l.querySelector(".kd")?.textContent.trim(), on: l.querySelector(".on-deal a")?.textContent.trim() || null, href: l.querySelector(".on-deal a")?.getAttribute("href") || null, text: l.textContent.replace(/\s+/g, " ").trim(), when: l.querySelector(".when")?.textContent.trim() }))); }
const money = (pence) => "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
async function run(name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  try { await fn(); } catch (e) { check(name, false, "error: " + String(e.message || e).split("\n")[0]); }
}

(async () => {
  browser = await chromium.launch();
  const ada = await as("ada");
  const cara = pid("Cara Example"), dora = pid("Dora Privatefake"), ezra = pid("Ezra Formerfake");
  const ben = pid("Ben Referredfake"), hal = pid("Hal Referredfake"), fay = pid("Fay Referredfake");
  const ambSrc = +sql(`select id from lead_sources where name='Ambassador'`);

  await run("US1 scenario 1", async () => {
    const id = mkPerson("SF114", "Una");
    await go(ada, `/people/${id}/edit`);
    await ada.getByLabel("Ambassador", { exact: true }).check();
    await save(ada);
    const h1 = norm(await ada.locator("h1").textContent());
    const link = ada.getByRole("link", { name: "[ AMBASSADOR PAGE ]" });
    const href = await link.getAttribute("href");
    const tl = await tlTexts(ada);
    await Promise.all([ada.waitForURL(/\/ambassadors\/\d+$/), link.click()]); await ada.waitForLoadState("networkidle");
    const label = await text(ada, ".page-head .label");
    check("US1 scenario 1", /Ambassador/.test(h1) && href === `/ambassadors/${id}` && ada.url().endsWith(`/ambassadors/${id}`) && label.includes("AMBASSADOR") && tl.some((t) => /Made an ambassador by Ada Fake/.test(t)),
      `h1="${h1}", link=${href}, opened ${ada.url().replace(BASE, "")} (label "${label}"), timeline: ${tl.find((t) => /ambassador/i.test(t))}`);
  });

  await run("US1 scenario 2", async () => {
    const rows = await ambRows(ada);
    const exp = sql(`select a.id, btrim(a.first_name||' '||a.last_name) from persons a where a.is_ambassador and (not a.private or a.created_by=1 or a.owner_id=1) order by lower(btrim(a.first_name||' '||a.last_name)), a.id`).split("\n").map((l) => l.split("|")[1]);
    const c = rows.find((r) => r.name === "Cara Example");
    const latest = sql(`select to_char(greatest((select max(referred_at) from persons where referred_by_id=${cara}), (select max(referred_at) from deals where referred_by_id=${cara} and not private)) at time zone 'Europe/London','DD Mon YYYY')`);
    await Promise.all([ada.waitForURL(/\/ambassadors\/\d+$/), ada.locator("table tbody tr", { hasText: "Cara Example" }).locator("a.nm").click()]); await ada.waitForLoadState("networkidle");
    const ok = JSON.stringify(rows.map((r) => r.name)) === JSON.stringify(exp) && c && c.cells.join("|").startsWith("Cara Example|Sample Studios Fake|3|3|£4,500|£4,000|") && ada.url().endsWith(`/ambassadors/${cara}`);
    check("US1 scenario 2", ok, `rows=${JSON.stringify(rows.map((r) => r.name))} expected ${JSON.stringify(exp)}; Cara row: ${c && c.cells.join(" | ")} (latest referral expected ${latest}); click → ${ada.url().replace(BASE, "")}`);
  });

  await run("US1 scenario 3", async () => {
    const saved = sql(`select string_agg(id::text, ',') from persons where is_ambassador`);
    sql(`update persons set is_ambassador=false where is_ambassador`);
    try {
      await go(ada, "/ambassadors");
      const t = await text(ada);
      check("US1 scenario 3", t.includes("No ambassadors yet. Tick Ambassador on a person to add one.") && !(await ada.locator("table tbody tr").count()), `page: ${t.slice(0, 160)}`);
    } finally { sql(`update persons set is_ambassador=true where id in (${saved})`); }
  });

  await run("US1 scenario 4", async () => {
    const una = mkPerson("SF114", "Uma", { amb: true });
    const vic = mkPerson("SF114", "Vic", { ref: una });
    const dl = mkDeal("SF114 Uma deal", { ref: una, value: 10000 });
    await go(ada, `/people/${una}/edit`);
    await ada.getByLabel("Ambassador", { exact: true }).uncheck();
    await save(ada);
    const h1 = norm(await ada.locator("h1").textContent());
    const tl = await tlTexts(ada);
    const rows = await ambRows(ada);
    await go(ada, `/people/${vic}/edit`); const o1 = await pickerOptions(ada, "Uma");
    await go(ada, `/deals/new`); const o2 = await pickerOptions(ada, "Uma");
    await go(ada, `/people/${vic}`); const r1 = await referredBy(ada);
    await go(ada, `/deals/${dl}`); const r2 = await referredBy(ada);
    const ok = !/Ambassador/.test(h1) && !rows.some((r) => r.name === "SF114 Uma") && o1.length === 0 && o2.length === 0 && r1.text === "SF114 Uma" && r2.text === "SF114 Uma" && tl.some((t) => /No longer an ambassador.*Ada Fake/.test(t));
    check("US1 scenario 4", ok, `h1="${h1}", on Ambassadors page: ${rows.some((r) => r.name === "SF114 Uma")}, picker person/deal: ${JSON.stringify(o1)}/${JSON.stringify(o2)}; Vic "Referred by ${r1.text}" (${r1.href}), deal "Referred by ${r2.text}" (${r2.href}); timeline: ${tl.find((t) => /longer/.test(t))}`);
  });

  await run("US1 scenario 5", async () => {
    const id = mkPerson("SF114", "Archamb", { amb: true });
    await go(ada, `/people/${id}`);
    await ada.getByRole("button", { name: "[ ARCHIVE ]" }).click(); await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    const rows = await ambRows(ada); const row = rows.find((r) => r.name === "SF114 Archamb");
    await go(ada, `/people/${ben}/edit`); const o1 = await pickerOptions(ada, "Archamb");
    await go(ada, `/deals/new`); const o2 = await pickerOptions(ada, "Archamb");
    await go(ada, `/people/new`); const o3 = await pickerOptions(ada, "Archamb");
    await go(ada, `/people/${id}`);
    await ada.getByRole("button", { name: "[ RESTORE ]" }).click(); await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    await go(ada, `/deals/new`); const o4 = await pickerOptions(ada, "Archamb");
    check("US1 scenario 5", row && row.cells[0].includes("Archived") && o1.length + o2.length + o3.length === 0 && o4.length === 1,
      `row: ${row && row.cells.join(" | ")}; offered while archived (person edit/deal add/person add): ${o1.length}/${o2.length}/${o3.length}; after restore: ${JSON.stringify(o4)}`);
  });

  await run("US2 scenario 1", async () => {
    const exp = sql(`select btrim(first_name||' '||last_name) from persons a where is_ambassador and archived_at is null and (not private or created_by=1 or owner_id=1) order by 1`).split("\n");
    const out = [];
    for (const path of ["/people/new", `/people/${ben}/edit`, "/deals/new", `/deals/${did("Fake referral · website")}/edit`]) {
      await go(ada, path);
      const got = new Set();
      for (const n of [...exp, "Dora", "Ezra", "Archamb"]) for (const o of await pickerOptions(ada, n)) got.add(o.split(" ").slice(0, 2).join(" "));
      out.push(`${path}: ${[...got].sort().join(", ")}`);
      if (path === "/people/new") {
        await ada.fill('input[name="firstName"]', "SF114"); await ada.fill('input[name="lastName"]', "Noref");
        await clearRef(ada); await ada.getByRole("combobox", { name: "Referred by" }).fill("");
        await ada.getByRole("button", { name: /\[ ADD PERSON \]|\[ SAVE \]/ }).first().click(); await ada.waitForTimeout(1500); await ada.waitForLoadState("networkidle");
        out.push(`saved without referrer → ${ada.url().replace(BASE, "")} ref=${sql(`select coalesce(referred_by_id::text,'null') from persons where last_name='Noref'`)}`);
      }
    }
    const expSet = exp.filter((n) => n !== "Cara Example" || true).sort().join(", ");
    const pathsOk = out.filter((l) => l.includes(": ")).every((l) => l.split(": ")[1] === expSet.replace(/Ben Referredfake, /, ""));
    check("US2 scenario 1", out.filter((l) => /^\/[a-z]/.test(l)).every((l) => l.split(": ")[1] === expSet) && /\/people\/\d+$/.test(out[1]) === false && out.some((l) => /saved without referrer → \/people\/\d+ ref=null/.test(l)),
      `expected offered: ${expSet}; got: ${out.join(" ; ")}`);
  });

  let bob, bobDeal;
  await run("US2 scenario 2", async () => {
    bob = mkPerson("SF114", "Bob Sample"); bobDeal = mkDeal("SF114 Bob deal", { value: 5000 });
    await go(ada, `/people/${bob}/edit`); await pickRef(ada, "Cara Example"); await save(ada);
    const r1 = await referredBy(ada);
    await go(ada, `/deals/${bobDeal}/edit`); await pickRef(ada, "Cara Example"); await save(ada);
    await go(ada, `/deals/${bobDeal}`); const r2 = await referredBy(ada);
    const pl = sql(`select s.pipeline_id from deals d join stages s on s.id=d.stage_id where d.id=${bobDeal}`);
    await go(ada, `/deals?pipeline=${pl}&open=${bobDeal}`); const r3 = await referredBy(ada, "aside[aria-label=Deal]");
    await go(ada, `/deals/list?open=${bobDeal}`); const r4 = await referredBy(ada, "aside[aria-label=Deal]");
    const want = `/ambassadors/${cara}`;
    check("US2 scenario 2", [r1, r2, r3, r4].every((r) => r.text === "Cara Example" && r.href === want),
      `person ${JSON.stringify(r1)}, deal page ${JSON.stringify(r2)}, board drawer ${JSON.stringify(r3)}, list drawer ${JSON.stringify(r4)} (dt "Referred by" + dd)`);
  });

  await run("US2 scenario 3", async () => {
    const p = mkPerson("SF114", "Tim"); const d = mkDeal("SF114 Tim deal");
    const uma2 = mkPerson("SF114", "Zed", { amb: true });
    const lines = [];
    for (const [path, page] of [[`/people/${p}/edit`, `/people/${p}`], [`/deals/${d}/edit`, `/deals/${d}`]]) {
      await go(ada, path); await pickRef(ada, "Cara Example"); await save(ada);
      await go(ada, path); await pickRef(ada, "SF114 Zed"); await save(ada);
      await go(ada, path); await clearRef(ada); await save(ada);
      await go(ada, page); lines.push((await tlTexts(ada)).filter((t) => /Referred by/.test(t)));
    }
    const ok = lines.every((l) => l.length === 3 && /^CHANGE ?Referred by cleared by Ada Fake ?\d\d:\d\d/.test(l[0]) && /Referred by changed from Cara Example to SF114 Zed by Ada Fake/.test(l[1]) && /Referred by set to Cara Example by Ada Fake/.test(l[2]));
    check("US2 scenario 3", ok, `person: ${JSON.stringify(lines[0])}; deal: ${JSON.stringify(lines[1])}`);
  });

  await run("US2 scenario 4", async () => {
    await go(ada, `/people/${cara}/edit`);
    const offered = await pickerOptions(ada, "Cara");
    const v0 = sql(`select version||'|'||coalesce(referred_by_id::text,'null')||'|'||coalesce(role,'') from persons where id=${cara}`);
    await ada.fill('input[name="role"]', "SF114 changed role");
    await setHidden(ada, "referredBy", String(cara));
    await save(ada);
    const body = await text(ada, "body");
    const v1 = sql(`select version||'|'||coalesce(referred_by_id::text,'null')||'|'||coalesce(role,'') from persons where id=${cara}`);
    check("US2 scenario 4", offered.length === 0 && body.includes("A person can't be their own referrer.") && v0 === v1, `options for "Cara" on Cara's form: ${JSON.stringify(offered)}; direct request: message shown=${body.includes("A person can't be their own referrer.")}; DB before ${v0} after ${v1}`);
  });

  await run("US2 scenario 5", async () => {
    const arch = mkPerson("SF114", "Archived amb", { amb: true, archived: true });
    const notes = [];
    let ok = true;
    for (const [what, refId] of [["not an ambassador", ben], ["archived", arch], ["hidden (Dora, Linus's private)", dora], ["unknown id", 99999999]]) {
      for (const kind of ["person", "deal", "new person"]) {
        const path = kind === "person" ? `/people/${bob}/edit` : kind === "deal" ? `/deals/${bobDeal}/edit` : "/people/new";
        const tbl = kind === "deal" ? "deals" : "persons";
        const before = kind === "new person" ? sql(`select count(*) from persons`) : sql(`select version||'|'||coalesce(referred_by_id::text,'') from ${tbl} where id=${kind === "deal" ? bobDeal : bob}`);
        await go(ada, path);
        if (kind === "new person") { await ada.fill('input[name="firstName"]', "SF114"); await ada.fill('input[name="lastName"]', "Refused"); }
        await setHidden(ada, "referredBy", String(refId));
        await ada.locator("form button[type=submit]").last().click(); await ada.waitForTimeout(1500); await ada.waitForLoadState("networkidle");
        const msg = (await text(ada, "body")).includes("Choose an ambassador from the list.");
        const after = kind === "new person" ? sql(`select count(*) from persons`) : sql(`select version||'|'||coalesce(referred_by_id::text,'') from ${tbl} where id=${kind === "deal" ? bobDeal : bob}`);
        if (!msg || before !== after) ok = false;
        notes.push(`${what}/${kind}: msg=${msg} ${before === after ? "unchanged" : before + "→" + after}`);
      }
    }
    check("US2 scenario 5", ok, notes.join("; "));
  });

  await run("US2 scenario 6", async () => {
    const zed = pid("SF114 Zed");
    await go(ada, "/deals/new");
    const pc = ada.getByRole("combobox", { name: "Person", exact: true });
    await pc.fill("Ben Referredfake"); await ada.waitForTimeout(250);
    await ada.getByRole("listbox", { name: "People" }).getByRole("option", { name: /Ben Referredfake/ }).first().locator("button").click().catch(async () => ada.getByRole("listbox", { name: "People" }).getByRole("option", { name: /Ben Referredfake/ }).first().click());
    await ada.waitForTimeout(300);
    const pre = norm(await ada.locator(".picker", { has: ada.getByRole("button", { name: "Clear Referred by" }) }).locator(".chosen").textContent().catch(() => ""));
    // change before saving
    await pickRef(ada, "SF114 Zed");
    await ada.fill('input[name="title"]', "SF114 Prefill changed");
    await save(ada);
    const changed = sql(`select coalesce(referred_by_id::text,'null') from deals where title='SF114 Prefill changed'`);
    // clear before saving
    await go(ada, "/deals/new");
    await pc.fill("Ben Referredfake"); await ada.waitForTimeout(250);
    await ada.getByRole("listbox", { name: "People" }).getByRole("option", { name: /Ben Referredfake/ }).first().locator("button").click().catch(async () => ada.getByRole("listbox", { name: "People" }).getByRole("option", { name: /Ben Referredfake/ }).first().click());
    await clearRef(ada); await ada.fill('input[name="title"]', "SF114 Prefill cleared"); await save(ada);
    const cleared = sql(`select coalesce(referred_by_id::text,'null') from deals where title='SF114 Prefill cleared'`);
    // edit: change main person to someone referred by another ambassador → referrer unchanged
    const d = mkDeal("SF114 Edit keep", { ref: zed });
    await go(ada, `/deals/${d}/edit`);
    if (await ada.getByRole("button", { name: /Clear Person|\[ CLEAR \]/ }).count()) {}
    await pc.fill("Ben Referredfake").catch(() => {}); await ada.waitForTimeout(250);
    await ada.getByRole("listbox", { name: "People" }).getByRole("option", { name: /Ben Referredfake/ }).first().locator("button").click().catch(() => {});
    const preEdit = norm(await ada.locator(".picker .chosen").allTextContents().then((a) => a.join(" / ")));
    await save(ada);
    const kept = sql(`select coalesce(person_id::text,'null')||'|'||coalesce(referred_by_id::text,'null') from deals where id=${d}`);
    check("US2 scenario 6", pre.startsWith("Cara Example") && changed === String(zed) && cleared === "null" && kept === `${ben}|${zed}`,
      `after picking Ben: Referred by shows "${pre}"; changed to Zed and saved → ${changed} (Zed=${zed}); cleared → ${cleared}; edit with new main person Ben: pickers "${preEdit}", saved person|referrer = ${kept}`);
  });

  await run("US2 scenario 7", async () => {
    const formerRef = mkPerson("SF114", "Formerref", { ref: ezra });
    const archAmb = mkPerson("SF114", "Archref amb", { amb: true });
    const dl = mkDeal("SF114 Archref deal", { ref: archAmb });
    sql(`update persons set archived_at=now() where id=${archAmb}`);
    await go(ada, `/people/${formerRef}/edit`); await ada.fill('input[name="role"]', "Changed"); await save(ada);
    await go(ada, `/people/${fay}/edit`); await ada.fill('input[name="role"]', "Changed"); await save(ada);
    await go(ada, `/deals/${dl}/edit`); await ada.fill('input[name="title"]', "SF114 Archref deal 2"); await save(ada);
    const r = sql(`select (select referred_by_id from persons where id=${formerRef})||'|'||(select referred_by_id from persons where id=${fay})||'|'||(select referred_by_id||' '||title from deals where id=${dl})`);
    const ev = sql(`select count(*) from timeline_events where kind like 'referrer_%' and (person_id in (${formerRef},${fay}) or deal_id=${dl}) and created_at > now() - interval '2 minutes'`);
    check("US2 scenario 7", r === `${ezra}|${ezra}|${archAmb} SF114 Archref deal 2` && ev === "0", `after saving (former ambassador Ezra=${ezra}, archived amb=${archAmb}): ${r}; referral events written: ${ev}`);
  });

  await run("US3 scenario 1", async () => {
    const from = [];
    await go(ada, "/ambassadors"); await ada.locator("tr", { hasText: "Cara Example" }).locator("a.nm").click(); await ada.waitForURL(/\/ambassadors\/\d+$/); await ada.waitForLoadState("networkidle"); from.push(ada.url().replace(BASE, ""));
    await go(ada, `/people/${ben}`); await dd(ada, "Referred by").locator("a").click(); await ada.waitForURL(/\/ambassadors\/\d+$/); await ada.waitForLoadState("networkidle"); from.push(ada.url().replace(BASE, ""));
    await go(ada, `/people/${cara}`); await ada.getByRole("link", { name: "[ AMBASSADOR PAGE ]" }).click(); await ada.waitForURL(/\/ambassadors\/\d+$/); await ada.waitForLoadState("networkidle"); from.push(ada.url().replace(BASE, ""));
    const head = await text(ada, ".page-head");
    const pp = await ada.getByRole("link", { name: "[ PERSON PAGE ]" }).getAttribute("href");
    const det = await text(ada, "section[aria-label=Details]");
    const s = await strip(ada);
    const V = (a) => `(not ${a}.private or ${a}.created_by=1 or ${a}.owner_id=1)`;
    const [np, nd, op, wp, nl] = sql(`select (select count(*) from persons r where referred_by_id=${cara} and ${V("r")}), count(*), coalesce(sum(value_pence) filter (where status='open'),0), coalesce(sum(value_pence) filter (where status='won'),0), count(*) filter (where status='lost') from deals d where referred_by_id=${cara} and ${V("d")}`).split("|");
    const expS = { "People referred": np, "Deals referred": nd, Open: money(+op), Won: money(+wp), Lost: nl };
    const role = sql(`select role from persons where id=${cara}`);
    const colors = await ada.$$eval("dl.strip dd.won, dl.strip dd.lost", (e) => e.map((x) => getComputedStyle(x).color));
    const emails = sql(`select string_agg(email, ',') from person_emails where person_id=${cara}`).split(",");
    const phones = sql(`select coalesce(string_agg(phone, ','), '') from person_phones where person_id=${cara}`).split(",").filter(Boolean);
    const ok = from.every((u) => u === `/ambassadors/${cara}`) && head.includes("AMBASSADOR") && head.includes("Cara Example") && head.includes(`${role} at Sample Studios Fake`) && pp === `/people/${cara}` &&
      emails.every((e) => det.includes(e)) && phones.every((e) => det.includes(e)) && det.includes("Ada Fake") &&
      JSON.stringify(s) === JSON.stringify(expS);
    check("US3 scenario 1", ok, `opened from list/ReferredBy/person page: ${from.join(", ")}; head "${head}"; person page link ${pp}; details "${det}" (emails ${emails}, phones ${phones}); strip ${JSON.stringify(s)} (expected ${JSON.stringify(expS)}); won/lost colours ${colors.join(" / ")}`);
  });

  await run("US3 scenario 2", async () => {
    const a = mkPerson("SF114", "Pageamb", { amb: true });
    const org = mkOrg("SF114 Org");
    const p1 = mkPerson("SF114", "Old ref", { ref: a, ago: "3 days" }), p2 = mkPerson("SF114", "Mid ref", { ref: a, ago: "2 days", org, owner: 3 }), p3 = mkPerson("SF114", "New ref", { ref: a, ago: "1 day" });
    await go(ada, `/ambassadors/${a}`);
    const rows = await sectRows(ada, "People referred").evaluateAll((trs) => trs.map((t) => [...t.querySelectorAll("td")].map((d) => d.textContent.trim()).join(" | ") + " → " + t.querySelector("a.nm").getAttribute("href")));
    const ok = rows.length === 3 && rows[0].startsWith("SF114 New ref") && rows[1].startsWith("SF114 Mid ref | SF114 Org | Linus Fake") && rows[2].startsWith("SF114 Old ref") && rows[0].endsWith(`/people/${p3}`) && rows[2].endsWith(`/people/${p1}`);
    check("US3 scenario 2", ok, rows.join(" ;; "));
  });

  await run("US3 scenario 3", async () => {
    const a = mkPerson("SF114", "Dealamb", { amb: true });
    const dA = mkDeal("SF114 Open older", { ref: a, value: 100000, ago: "5 days" });
    const dB = mkDeal("SF114 Open newer", { ref: a, value: 20000, ago: "4 days" });
    const dC = mkDeal("SF114 Won recent", { ref: a, value: 30000, status: "won", ago: "3 days" });
    const dD = mkDeal("SF114 Lost oldest", { ref: a, value: 40000, status: "lost", ago: "6 days" });
    sql(`insert into timeline_events (deal_id, kind, actor_id, fields, created_at) values (${dB}, 'edited', 1, '{Value}', now() - interval '1 hour'), (${dC}, 'won', 1, null, now() - interval '1 minute')`);
    await go(ada, `/ambassadors/${a}`);
    const rows = await sectRows(ada, "Deals referred").evaluateAll((trs) => trs.map((t) => [...t.querySelectorAll("td")].map((d) => d.textContent.trim()).join(" | ") + " → " + t.querySelector("a.nm").getAttribute("href")));
    const order = rows.map((r) => r.split(" | ")[0]);
    const ok = JSON.stringify(order) === JSON.stringify(["SF114 Open newer", "SF114 Open older", "SF114 Won recent", "SF114 Lost oldest"]) && rows[0] === `SF114 Open newer | Sales · Lead in | £200 | Open | Ada Fake → /deals/${dB}` && /Won/.test(rows[2]) && /Lost/.test(rows[3]);
    check("US3 scenario 3", ok, rows.join(" ;; "));
  });

  let updAmb;
  await run("US3 scenario 4", async () => {
    const a = (updAmb = mkPerson("SF114", "Updamb", { amb: true, ago: "2 days" }));
    const rp = mkPerson("SF114", "Upd person", { ref: a, ago: "2 days" });
    const rd = mkDeal("SF114 Upd deal", { ref: a, person: rp, ago: "2 days" });
    const other = mkDeal("SF114 Unreferred deal", { person: rp, ago: "2 days" });
    note("person_id", a, "SF114 own note", 1, "3 hours");
    note("person_id", rp, "SF114 person note", 3, "2 hours");
    note("deal_id", rd, "SF114 deal note", 4, "1 hour");
    note("deal_id", other, "SF114 unreferred note", 1, "30 minutes");
    await go(ada, `/deals/${rd}/edit`); await ada.fill('input[name="title"]', "SF114 Upd deal!"); await save(ada);
    await go(ada, `/ambassadors/${a}`);
    const u = await updates(ada);
    const days = (await ada.locator("section[aria-label='Latest updates'] .day").allTextContents()).map(norm);
    const ids = u.map((x) => x.id);
    const exp = sql(`select 'entry-'||e.id from timeline_events e where e.person_id in (${a},${rp}) or e.deal_id=${rd} order by created_at desc, id desc limit 20`).split("\n");
    const first = u[0];
    const ok = JSON.stringify(ids) === JSON.stringify(exp) && new Set(ids).size === ids.length && first.tag === "DEAL" && first.on === "SF114 Upd deal!" && first.href === `/deals/${rd}` &&
      u.find((x) => /person note/.test(x.text))?.tag === "PERSON" && u.find((x) => /person note/.test(x.text))?.href === `/people/${rp}` && u.find((x) => /own note/.test(x.text))?.tag === "NOTE" && u.find((x) => /own note/.test(x.text))?.on === null &&
      u.find((x) => /deal note/.test(x.text))?.tag === "DEAL" && !u.some((x) => /unreferred/.test(x.text)) && /^\/\/ TODAY · /.test(days[0]) && u.every((x) => /\d\d:\d\d/.test(x.when)) && u.some((x) => x.tag === "CHANGE");
    check("US3 scenario 4", ok, `days ${JSON.stringify(days)}; entries: ${u.map((x) => `${x.tag}[${x.on || "-"}] ${x.text.slice(0, 50)} ${x.when}`).join(" ;; ")}; ids match SQL order: ${JSON.stringify(ids) === JSON.stringify(exp)}`);
  });

  await run("US3 scenario 5", async () => {
    const a = mkPerson("SF114", "Moreamb", { amb: true, ago: "10 days" });
    const rp = mkPerson("SF114", "More person", { ref: a, ago: "10 days" });
    for (let i = 0; i < 45; i++) note(i % 2 ? "person_id" : "person_id", i % 3 ? rp : a, `SF114 bulk ${i}`, 1, `${i * 7} minutes`);
    // same timestamp ties
    sql(`insert into timeline_events (person_id, kind, actor_id, body, created_at) select ${rp}, 'note', 1, 'SF114 tie '||g, now() - interval '100 minutes' from generate_series(1,6) g`);
    const exp = sql(`select 'entry-'||e.id from timeline_events e where e.person_id in (${a},${rp}) order by created_at desc, id desc`).split("\n");
    await go(ada, `/ambassadors/${a}`);
    const n1 = (await updates(ada)).map((x) => x.id);
    await ada.locator("section[aria-label='Latest updates']").getByRole("link", { name: "[ SHOW MORE ]" }).click(); await ada.waitForTimeout(1200); await ada.waitForLoadState("networkidle");
    const n2 = (await updates(ada)).map((x) => x.id);
    await ada.locator("section[aria-label='Latest updates']").getByRole("link", { name: "[ SHOW MORE ]" }).click(); await ada.waitForTimeout(1200); await ada.waitForLoadState("networkidle");
    const n3 = (await updates(ada)).map((x) => x.id);
    const ok = JSON.stringify(n1) === JSON.stringify(exp.slice(0, 20)) && JSON.stringify(n2) === JSON.stringify(exp.slice(0, 40)) && JSON.stringify(n3) === JSON.stringify(exp.slice(0, 60)) && new Set(n3).size === n3.length;
    check("US3 scenario 5", ok, `total ${exp.length} entries; shown ${n1.length} → ${n2.length} → ${n3.length}, all in SQL order without repeats: ${ok}; url ${ada.url().replace(BASE, "")}`);
  });

  await run("US3 scenario 6", async () => {
    const a = mkPerson("SF114", "Lonely", { amb: true });
    sql(`insert into timeline_events (person_id, kind, actor_id) values (${a}, 'ambassador_added', 1)`);
    await go(ada, `/ambassadors/${a}`);
    const s = await strip(ada); const t = await text(ada);
    const u = await updates(ada);
    const ok = JSON.stringify(s) === JSON.stringify({ "People referred": "0", "Deals referred": "0", Open: "£0", Won: "£0", Lost: "0" }) && t.includes("No people referred yet.") && t.includes("No deals referred yet.") && u.length === 2 && u.every((x) => x.on === null);
    check("US3 scenario 6", ok, `strip ${JSON.stringify(s)}; messages: ${t.includes("No people referred yet.")}/${t.includes("No deals referred yet.")}; updates ${u.map((x) => x.tag + " " + x.text).join(" ;; ")}`);
  });

  await run("US3 scenario 7", async () => {
    const p = mkPerson("SF114", "Plain");
    await go(ada, `/ambassadors/${p}`); const t1 = await text(ada);
    await go(ada, `/ambassadors/${ezra}`); const h = await text(ada, "h1"); const t2 = await text(ada);
    check("US3 scenario 7", t1.includes("This ambassador doesn't exist or you can't see them.") && h.includes("No longer an ambassador") && t2.includes("Fay Referredfake"),
      `never ambassador: "${t1.slice(0, 120)}"; Ezra: h1 "${h}"`);
  });

  await run("US4 scenario 1", async () => {
    const linus = await as("linus");
    const a = mkPerson("SF114", "Privtest amb", { amb: true });
    mkPerson("SF114", "Shared ref", { ref: a });
    const sd = mkDeal("SF114 Shared deal", { ref: a, value: 10000 });
    const pp = mkPerson("SF114", "Private ref", { ref: a, private: true, by: 3 });
    const pd1 = mkDeal("SF114 Private open", { ref: a, value: 70000, private: true, by: 3 });
    const pd2 = mkDeal("SF114 Private won", { ref: a, value: 90000, status: "won", private: true, by: 3 });
    const pd3 = mkDeal("SF114 Private lost", { ref: a, value: 5000, status: "lost", private: true, by: 3 });
    note("person_id", pp, "SF114 secret person note", 3); note("deal_id", pd1, "SF114 secret deal note", 3);
    const res = {};
    for (const [who, p] of [["ada", ada], ["linus", linus]]) {
      await go(p, `/ambassadors/${a}`);
      res[who] = { strip: await strip(p), people: await sectNames(p, "People referred"), deals: await sectNames(p, "Deals referred"), upd: (await updates(p)).map((x) => x.text).join(" ") };
      res[who].row = (await ambRows(p)).find((r) => r.name === "SF114 Privtest amb")?.cells.slice(2, 6).join("|");
    }
    const A = res.ada, L = res.linus;
    const ok = JSON.stringify(A.strip) === JSON.stringify({ "People referred": "1", "Deals referred": "1", Open: "£100", Won: "£0", Lost: "0" }) && A.row === "1|1|£100|£0" &&
      !A.people.includes("SF114 Private ref") && A.deals.length === 1 && !/secret/.test(A.upd) && !/Private/.test(A.upd) &&
      JSON.stringify(L.strip) === JSON.stringify({ "People referred": "2", "Deals referred": "4", Open: "£800", Won: "£900", Lost: "1" }) && L.row === "2|4|£800|£900" && /secret deal note/.test(L.upd);
    check("US4 scenario 1", ok, `Ada (admin, hidden): ${JSON.stringify({ ...A, upd: /secret|Private/.test(A.upd) ? "LEAK" : "clean" })}; Linus (owner): strip ${JSON.stringify(L.strip)} row ${L.row}, sees notes ${/secret deal note/.test(L.upd)}`);
  });

  await run("US4 scenario 2", async () => {
    const rows = await ambRows(ada);
    await go(ada, `/people/${ben}/edit`); const o1 = await pickerOptions(ada, "Dora");
    await go(ada, `/deals/new`); const o2 = await pickerOptions(ada, "Dora");
    await go(ada, `/ambassadors/${dora}`); const t = await text(ada);
    const linus = await as("linus"); const lrows = await ambRows(linus);
    check("US4 scenario 2", !rows.some((r) => r.name === "Dora Privatefake") && o1.length + o2.length === 0 && t.includes("This ambassador doesn't exist or you can't see them.") && !t.includes("Dora") && lrows.some((r) => r.name === "Dora Privatefake"),
      `Ada: listed=${rows.some((r) => r.name === "Dora Privatefake")}, offered ${o1.length}/${o2.length}, page "${t.slice(0, 100)}"; Linus sees her: ${lrows.some((r) => r.name === "Dora Privatefake")}`);
  });

  await run("US4 scenario 3", async () => {
    const dl = mkDeal("SF114 Dora deal", { ref: dora, value: 1000 });
    await go(ada, `/people/${hal}`); const r1 = await referredBy(ada); const t1 = await text(ada);
    await go(ada, `/deals/${dl}`); const r2 = await referredBy(ada);
    await go(ada, `/deals/list?open=${dl}`); const r3 = await referredBy(ada, "aside[aria-label=Deal]");
    await go(ada, `/people/${hal}/edit`); await ada.fill('input[name="role"]', "Changed by Ada"); await save(ada);
    await go(ada, `/deals/${dl}/edit`); await ada.fill('input[name="title"]', "SF114 Dora deal 2"); await save(ada);
    const kept = sql(`select (select referred_by_id from persons where id=${hal})||'|'||(select referred_by_id from deals where id=${dl})||'|'||(select role from persons where id=${hal})`);
    const ok = [r1, r2, r3].every((r) => r.text === "Referred by a private person" && r.links === 0) && !t1.includes("Dora") && kept === `${dora}|${dora}|Changed by Ada`;
    check("US4 scenario 3", ok, `person ${JSON.stringify(r1)}, deal ${JSON.stringify(r2)}, drawer ${JSON.stringify(r3)} (shown as dt "Referred by" + dd); after edits: ${kept} (Dora=${dora})`);
  });

  await run("US4 scenario 4", async () => {
    const marg = await as("margaret");
    const a = mkPerson("SF114", "Alanamb", { amb: true, private: true, by: 5 });
    mkPerson("SF114", "Alanref", { ref: a, private: true, by: 5 });
    mkDeal("SF114 Alan private deal", { ref: a, value: 30000, private: true, by: 5 });
    mkPerson("SF114", "Shared alanref", { ref: a });
    await go(marg, `/ambassadors/${a}`); const before = await text(marg);
    await go(ada, "/admin/users");
    await Promise.all([ada.waitForURL(/handover=/), ada.locator("tr", { hasText: "alan@barnacle.ai" }).getByRole("link", { name: "[ HAND OVER ]" }).click()]); await ada.waitForLoadState("networkidle");
    await ada.locator("form.handover select").selectOption({ label: "Margaret Fake" });
    await ada.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click(); await ada.waitForTimeout(1500); await ada.waitForLoadState("networkidle");
    await go(marg, `/ambassadors/${a}`);
    const s = await strip(marg); const ppl = await sectNames(marg, "People referred"); const dls = await sectNames(marg, "Deals referred");
    const row = (await ambRows(marg)).find((r) => r.name === "SF114 Alanamb");
    const ok = before.includes("This ambassador doesn't exist") && s["People referred"] === "2" && s["Deals referred"] === "1" && s.Open === "£300" && ppl.includes("SF114 Alanref") && dls.includes("SF114 Alan private deal") && !!row;
    check("US4 scenario 4", ok, `before hand-over Margaret saw "${before.slice(0, 60)}"; after: strip ${JSON.stringify(s)}, people ${JSON.stringify(ppl)}, deals ${JSON.stringify(dls)}, Ambassadors row ${row && row.cells.join("|")}`);
  });

  await run("US5 scenario 1", async () => {
    await go(ada, "/people");
    await ada.locator('select[name="ref"]').selectOption({ label: "Cara Example" }); await ada.waitForURL(/ref=\d/); await ada.waitForLoadState("networkidle");
    const names = (await ada.locator("td:first-child a.nm").allTextContents()).map(norm).sort();
    const exp = sql(`select btrim(first_name||' '||last_name) from persons where referred_by_id=${cara} and archived_at is null and (not private or created_by=1 or owner_id=1) order by 1`).split("\n");
    const url1 = ada.url();
    await ada.locator('select[name="owner"]').selectOption({ label: "Linus Fake" }).catch(() => {}); await ada.waitForTimeout(1500); await ada.waitForLoadState("networkidle");
    const comb = (await ada.locator("td:first-child a.nm").allTextContents()).map(norm);
    const expComb = sql(`select count(*) from persons where referred_by_id=${cara} and archived_at is null and owner_id=3 and (not private or created_by=1 or owner_id=1)`);
    const url2 = ada.url();
    await go(ada, "/deals/list");
    await ada.locator('select[name="ref"]').selectOption({ label: "Cara Example" }); await ada.waitForURL(/ref=\d/); await ada.waitForLoadState("networkidle");
    const dnames = (await ada.locator("td:first-child a.nm").allTextContents()).map(norm).sort();
    const count = await text(ada, ".head-r .count");
    const dexp = sql(`select title from deals where referred_by_id=${cara} and archived_at is null and status='open' and (not private or created_by=1 or owner_id=1) order by 1`).split("\n").filter(Boolean);
    const dtotal = sql(`select coalesce(sum(value_pence),0) from deals where referred_by_id=${cara} and archived_at is null and status='open' and (not private or created_by=1 or owner_id=1)`);
    const ok = JSON.stringify(names) === JSON.stringify(exp) && /ref=\d/.test(url2) && comb.length === +expComb && JSON.stringify(dnames) === JSON.stringify(dexp) && count.includes(money(+dtotal)) && count.includes(String(dexp.length));
    check("US5 scenario 1", ok, `people ${JSON.stringify(names)} (expected ${JSON.stringify(exp)}), url ${url1.replace(BASE, "")}; + owner Linus: ${comb.length} rows (expected ${expComb}), url ${url2.replace(BASE, "")}; deals ${JSON.stringify(dnames)} (expected ${JSON.stringify(dexp)}), count "${count}" (expected ${dexp.length}, ${money(+dtotal)})`);
  });

  await run("US5 scenario 2", async () => {
    const res = {};
    for (const who of ["ada", "linus"]) {
      const p = await as(who);
      for (const path of ["/people", "/deals/list"]) {
        await go(p, path);
        res[who + path] = (await p.locator('select[name="ref"] option').allTextContents()).map(norm).filter((o) => o !== "Any referrer");
      }
    }
    const v = (u) => `(not %.private or %.created_by=${u} or %.owner_id=${u})`;
    const expFor = (u) => sql(`select btrim(a.first_name||' '||a.last_name) from persons a where ${v(u).replace(/%/g, "a")} and (a.is_ambassador or exists (select 1 from persons r where r.referred_by_id=a.id and ${v(u).replace(/%/g, "r")}) or exists (select 1 from deals d where d.referred_by_id=a.id and ${v(u).replace(/%/g, "d")})) order by lower(btrim(a.first_name||' '||a.last_name)), a.id`).split("\n");
    const ea = expFor(1), el = expFor(3);
    const ok = JSON.stringify(res["ada/people"]) === JSON.stringify(ea) && JSON.stringify(res["ada/deals/list"]) === JSON.stringify(ea) && JSON.stringify(res["linus/people"]) === JSON.stringify(el) &&
      res["ada/people"].includes("Ezra Formerfake") && res["ada/people"].includes("SF114 Archamb") === true && !res["ada/people"].includes("Dora Privatefake") && res["linus/people"].includes("Dora Privatefake");
    check("US5 scenario 2", ok, `Ada options: ${res["ada/people"].join(", ")}; Linus has Dora: ${res["linus/people"].includes("Dora Privatefake")}; match expected: ${JSON.stringify(res["ada/people"]) === JSON.stringify(ea)}/${JSON.stringify(res["linus/people"]) === JSON.stringify(el)}`);
  });

  await run("Edge case 1", async () => {
    const out = [];
    let ok = true;
    for (const priv of [false, true]) {
      const a = mkPerson("SF114", priv ? "Delpriv amb" : "Del amb", { amb: true, private: priv });
      const p = mkPerson("SF114", priv ? "Delpriv ref" : "Del ref"); const d = mkDeal(priv ? "SF114 Delpriv deal" : "SF114 Del deal");
      await go(ada, `/people/${p}/edit`); await pickRef(ada, priv ? "SF114 Delpriv amb" : "SF114 Del amb"); await save(ada);
      await go(ada, `/deals/${d}/edit`); await pickRef(ada, priv ? "SF114 Delpriv amb" : "SF114 Del amb"); await save(ada);
      await go(ada, `/people/${a}?confirm=delete`); await ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click(); await ada.waitForTimeout(1500); await ada.waitForLoadState("networkidle");
      for (const path of [`/people/${p}`, `/deals/${d}`]) {
        await go(ada, path);
        const r = await referredBy(ada); const tl = (await tlTexts(ada)).filter((t) => /Referred by|deleted/.test(t));
        out.push(`${priv ? "private" : "shared"} ${path}: "Referred by ${r.text}", timeline ${JSON.stringify(tl)}`);
        if (r.text !== "—") ok = false;
        if (!priv && !(tl.length >= 1 && /^CHANGE ?Referred by cleared \(a deleted person\)/.test(tl[0]))) ok = false;
        if (priv && tl.length !== 0) ok = false;
      }
    }
    check("Edge case 1", ok, out.join(" ;; ") + " (the field row stays, showing —)");
  });

  await run("Edge case 2", async () => {
    const a = mkPerson("SF114", "Delref amb", { amb: true });
    const p = mkPerson("SF114", "Gone person", { ref: a }); const d = mkDeal("SF114 Gone deal", { ref: a, value: 50000 }); mkDeal("SF114 Stay deal", { ref: a, value: 1000 });
    note("person_id", p, "SF114 gone person note"); note("deal_id", d, "SF114 gone deal note");
    await go(ada, `/ambassadors/${a}`); const s0 = await strip(ada);
    await go(ada, `/people/${p}?confirm=delete`); await ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click(); await ada.waitForTimeout(1500);
    await go(ada, `/deals/${d}?confirm=delete`); await ada.getByRole("button", { name: /DELETE/ }).last().click(); await ada.waitForTimeout(1500);
    const gone = sql(`select count(*) from deals where id=${d}`) + sql(`select count(*) from persons where id=${p}`);
    await go(ada, `/ambassadors/${a}`); const s1 = await strip(ada); const t = await text(ada);
    const ok = gone === "00" && s0["People referred"] === "1" && s1["People referred"] === "0" && s0["Deals referred"] === "2" && s1["Deals referred"] === "1" && s0.Open === "£510" && s1.Open === "£10" && !/Gone/.test(t);
    check("Edge case 2", ok, `before ${JSON.stringify(s0)}, after ${JSON.stringify(s1)}; deleted rows remaining ${gone}; mentions "Gone" on page: ${/Gone/.test(t)}`);
  });

  await run("Edge case 3", async () => {
    const a = mkPerson("SF114", "Archref2 amb", { amb: true });
    const p = mkPerson("SF114", "Archived ref", { ref: a }); const d1 = mkDeal("SF114 Arch open", { ref: a, value: 11100 }); const d2 = mkDeal("SF114 Arch won", { ref: a, value: 22200, status: "won" });
    await go(ada, `/people/${p}`); await ada.getByRole("button", { name: "[ ARCHIVE ]" }).click(); await ada.waitForTimeout(1200);
    for (const d of [d1, d2]) { await go(ada, `/deals/${d}`); await ada.getByRole("button", { name: "[ ARCHIVE ]" }).click(); await ada.waitForTimeout(1200); }
    const arch = sql(`select count(*) from persons where id=${p} and archived_at is not null`) + sql(`select count(*) from deals where id in (${d1},${d2}) and archived_at is not null`);
    await go(ada, `/ambassadors/${a}`); const s = await strip(ada);
    const pr = await text(ada, "section[aria-label='People referred'] tbody"); const dr = await text(ada, "section[aria-label='Deals referred'] tbody");
    const ok = arch === "12" && s["People referred"] === "1" && s["Deals referred"] === "2" && s.Open === "£111" && s.Won === "£222" && /SF114 Archived ref.*Archived/.test(pr) && (dr.match(/Archived/g) || []).length === 2;
    check("Edge case 3", ok, `archived ${arch}; strip ${JSON.stringify(s)}; people "${pr}"; deals "${dr}"`);
  });

  await run("Edge case 4", async () => {
    const y = mkPerson("SF114", "Top amb", { amb: true });
    const x = mkPerson("SF114", "Mid amb", { amb: true, ref: y });
    mkPerson("SF114", "Leaf person", { ref: x }); mkDeal("SF114 Leaf deal", { ref: x });
    await go(ada, `/people/${x}`); const r = await referredBy(ada);
    await go(ada, `/ambassadors/${y}`); const ppl = await sectNames(ada, "People referred"); const dls = await sectNames(ada, "Deals referred"); const s = await strip(ada);
    check("Edge case 4", r.text === "SF114 Top amb" && r.href === `/ambassadors/${y}` && JSON.stringify(ppl) === '["SF114 Mid amb"]' && dls.length === 0 && s["People referred"] === "1",
      `Mid's page: Referred by ${r.text} (${r.href}); Top's people ${JSON.stringify(ppl)}, deals ${JSON.stringify(dls)}, strip ${JSON.stringify(s)}`);
  });

  await run("Edge case 5", async () => {
    const a = mkPerson("SF114", "Both amb", { amb: true });
    const p = mkPerson("SF114", "Both person", { ref: a }); mkDeal("SF114 Both deal", { ref: a, person: p });
    await go(ada, `/ambassadors/${a}`); const ppl = await sectNames(ada, "People referred"); const dls = await sectNames(ada, "Deals referred"); const s = await strip(ada);
    check("Edge case 5", JSON.stringify(ppl) === '["SF114 Both person"]' && JSON.stringify(dls) === '["SF114 Both deal"]' && s["People referred"] === "1" && s["Deals referred"] === "1", `people ${JSON.stringify(ppl)}, deals ${JSON.stringify(dls)}, strip ${JSON.stringify(s)}`);
  });

  await run("Edge case 6", async () => {
    const a = mkPerson("SF114", "Value amb", { amb: true });
    mkDeal("SF114 No value open", { ref: a }); mkDeal("SF114 No value won", { ref: a, status: "won" }); mkDeal("SF114 Lost valued", { ref: a, value: 99900, status: "lost" });
    await go(ada, `/ambassadors/${a}`); const s = await strip(ada);
    const rows = await sectRows(ada, "Deals referred").evaluateAll((trs) => trs.map((t) => [...t.querySelectorAll("td")].map((d) => d.textContent.trim()).join(" | ")));
    const ok = s.Open === "£0" && s.Won === "£0" && s.Lost === "1" && rows.filter((r) => /No value/.test(r)).every((r) => r.split(" | ")[2] === "—");
    check("Edge case 6", ok, `strip ${JSON.stringify(s)}; rows ${rows.join(" ;; ")}`);
  });

  await run("Edge case 7", async () => {
    const a = mkPerson("SF114", "Reopen amb", { amb: true });
    const d = mkDeal("SF114 Reopen deal", { ref: a, value: 12300 });
    await go(ada, `/deals/${d}`); await ada.getByRole("button", { name: "[ WON ]" }).click(); await ada.waitForTimeout(1200); await ada.waitForLoadState("networkidle");
    await go(ada, `/ambassadors/${a}`); const s1 = await strip(ada);
    await go(ada, `/deals/${d}`); await ada.getByRole("button", { name: "[ REOPEN ]" }).click(); await ada.waitForTimeout(1200); await ada.waitForLoadState("networkidle");
    await go(ada, `/ambassadors/${a}`); const s2 = await strip(ada); const row = await text(ada, "section[aria-label='Deals referred'] tbody");
    check("Edge case 7", s1.Won === "£123" && s1.Open === "£0" && s2.Open === "£123" && s2.Won === "£0" && /£123 ?Open/.test(row), `after Won ${JSON.stringify(s1)}; after reopen ${JSON.stringify(s2)}, row "${row}"`);
  });

  await run("Edge case 8", async () => {
    const o1 = mkOrg("SF114 Twin Org A"), o2 = mkOrg("SF114 Twin Org B");
    mkPerson("SF114", "Twin", { amb: true, org: o1, email: "twin.a@example.com" }); mkPerson("SF114", "Twin", { amb: true, org: o2, email: "twin.b@example.com" });
    await go(ada, "/people/new"); const opts = await pickerOptions(ada, "SF114 Twin");
    check("Edge case 8", opts.length === 2 && opts[0] !== opts[1] && opts.some((o) => /Twin Org A.*twin\.a@example\.com/.test(o)) && opts.some((o) => /Twin Org B.*twin\.b@example\.com/.test(o)), `options ${JSON.stringify(opts)}`);
  });

  await run("Edge case 9", async () => {
    const p = mkPerson("SF114", "Archperson", { archived: true });
    const d = mkDeal("SF114 Archdeal", { archived: true });
    await go(ada, `/people/${p}/edit`);
    const tick = await ada.getByLabel("Ambassador", { exact: true }).count(); const picker = await ada.getByRole("combobox", { name: "Referred by" }).count();
    await setHidden(ada, "ambassador", "on"); await setHidden(ada, "referredBy", String(cara));
    await save(ada); const msgP = await text(ada, "body");
    const pAfter = sql(`select is_ambassador||'|'||coalesce(referred_by_id::text,'null') from persons where id=${p}`);
    await go(ada, `/deals/${d}`); const editLink = await ada.getByRole("link", { name: "[ EDIT ]" }).count();
    await go(ada, `/deals/${d}/edit`); const dEdit = await text(ada);
    const dAfter = sql(`select coalesce(referred_by_id::text,'null') from deals where id=${d}`);
    check("Edge case 9", tick === 0 && picker === 0 && pAfter === "false|null" && editLink === 0 && dAfter === "null",
      `archived person form: tick ${tick}, picker ${picker}; direct post with ambassador=on & referredBy=Cara → stored ${pAfter}, page after: "${msgP.slice(0, 120)}"; archived deal: [ EDIT ] links ${editLink}, /edit shows "${dEdit.slice(0, 100)}"`);
  });

  await run("Edge case 10", async () => {
    const p = mkPerson("SF114", "Leadsrc", { source: ambSrc });
    const rows = await ambRows(ada);
    await go(ada, "/people/new"); const opts = await pickerOptions(ada, "Leadsrc");
    const q2 = mkPerson("SF114", "Gets ref", { source: ambSrc });
    await go(ada, `/people/${q2}/edit`); await pickRef(ada, "Cara Example"); await save(ada);
    const after = sql(`select lead_source_id||'|'||referred_by_id from persons where id=${q2}`);
    check("Edge case 10", !rows.some((r) => r.name === "SF114 Leadsrc") && opts.length === 0 && after === `${ambSrc}|${cara}`, `on Ambassadors page: ${rows.some((r) => r.name === "SF114 Leadsrc")}; offered ${JSON.stringify(opts)}; after choosing Cara: lead source|referrer ${after}`);
  });

  await run("Edge case 11", async () => {
    const a = mkPerson("SF114", "Bulk amb", { amb: true });
    sql(`insert into persons (first_name, last_name, owner_id, created_by, referred_by_id, referred_at, created_at) select 'SF114', 'Bulk '||lpad(g::text,2,'0'), 1, 1, ${a}, now(), now() - (g||' minutes')::interval from generate_series(1,55) g`);
    sql(`update persons set created_at = now() - interval '30 minutes' where last_name in ('Bulk 10','Bulk 11','Bulk 12') and referred_by_id=${a}`);
    const stage = sql(`select s.id from stages s join pipelines p on p.id=s.pipeline_id where p.name='Sales' and s.name='Lead in'`);
    sql(`insert into deals (title, stage_id, owner_id, created_by, referred_by_id, referred_at, status, closed_at, created_at) select 'SF114 Bulk deal '||lpad(g::text,2,'0'), ${stage}, 1, 1, ${a}, now(), case when g % 5 = 0 then 'won' else 'open' end, case when g % 5 = 0 then now() end, now() - (g||' minutes')::interval from generate_series(1,55) g`);
    const expP = sql(`select btrim(first_name||' '||last_name) from persons where referred_by_id=${a} order by created_at desc, id desc`).split("\n");
    await go(ada, `/ambassadors/${a}`);
    const p1 = await sectNames(ada, "People referred"); const d1 = await sectNames(ada, "Deals referred");
    await ada.getByRole("region", { name: "People referred" }).getByRole("link", { name: "[ SHOW MORE ]" }).click(); await ada.waitForTimeout(1200); await ada.waitForLoadState("networkidle");
    const p2 = await sectNames(ada, "People referred"); const d2 = await sectNames(ada, "Deals referred");
    await ada.getByRole("region", { name: "Deals referred" }).getByRole("link", { name: "[ SHOW MORE ]" }).click(); await ada.waitForTimeout(1200); await ada.waitForLoadState("networkidle");
    const p3 = await sectNames(ada, "People referred"); const d3 = await sectNames(ada, "Deals referred");
    const firstWon = d3.findIndex((t) => +t.slice(-2) % 5 === 0); const lastOpen = d3.map((t) => +t.slice(-2) % 5 !== 0).lastIndexOf(true);
    const ok = JSON.stringify(p1) === JSON.stringify(expP.slice(0, 50)) && JSON.stringify(p2) === JSON.stringify(expP) && d1.length === 50 && d2.length === 50 && d3.length === 55 && new Set(d3).size === 55 && JSON.stringify(d3.slice(0, 50)) === JSON.stringify(d1) && lastOpen < firstWon && JSON.stringify(p3) === JSON.stringify(expP);
    check("Edge case 11", ok, `people ${p1.length} → ${p2.length} (order matches newest first: ${JSON.stringify(p2) === JSON.stringify(expP)}), deals ${d1.length} → ${d2.length} → ${d3.length} (unique ${new Set(d3).size}, open before won: ${lastOpen < firstWon}, people kept after deals more: ${p3.length})`);
  });

  await run("Edge case 12", async () => {
    const a = mkPerson("<b>Fake</b>", "Amb", { amb: true });
    const p = mkPerson("<b>Fake</b>", "Ref", { ref: a }); const d = mkDeal("<b>Fake</b> deal", { ref: a, value: 100 });
    note("deal_id", d, "<b>Fake</b> note"); note("person_id", p, "<i>x</i>");
    await go(ada, "/ambassadors"); const bold1 = await ada.locator("main b:text('Fake'), main table b").count(); const row = await text(ada, "table tbody");
    await go(ada, `/ambassadors/${a}`); const bold2 = await ada.locator("main b").evaluateAll((bs) => bs.filter((b) => b.textContent === "Fake").length);
    const t = await text(ada);
    const ok = bold1 === 0 && bold2 === 0 && row.includes("<b>Fake</b> Amb") && t.includes("<b>Fake</b> Amb") && t.includes("<b>Fake</b> Ref") && t.includes("<b>Fake</b> deal");
    check("Edge case 12", ok, `Ambassadors page <b> elements: ${bold1}, literal text shown: ${row.includes("<b>Fake</b> Amb")}; ambassador page <b>Fake</b> elements: ${bold2}, literal name/person/deal: ${t.includes("<b>Fake</b> Amb")}/${t.includes("<b>Fake</b> Ref")}/${t.includes("<b>Fake</b> deal")}`);
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
})();
