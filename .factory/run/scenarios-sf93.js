// SF-93 (pipelines, deals, board) AI-review scenario script: every US1–US6 scenario and edge case 1–16.
// Run on a freshly seeded crm_dev with the app on :3000:
//   bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf93.js
// Scenarios run in order and build on each other's data (see the comments); results print as PASS/FAIL lines.
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
const money = (pence) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);
function expected(pipeline, stage, viewer) {
  const v = uid(viewer);
  const [n, t] = one(`select count(*), coalesce(sum(d.value_pence),0) from deals d join stages s on s.id=d.stage_id join pipelines p on p.id=s.pipeline_id
    where p.name='${esc(pipeline)}' and s.name='${esc(stage)}' and d.archived_at is null and (not d.private or d.created_by=${v} or d.owner_id=${v})`).split("|");
  return `${n} ${n === "1" ? "deal" : "deals"} · ${money(Number(t))}`;
}
function insertDeal({ title, pipeline, stage, by, owner, value = null, org = null, person = null, priv = false }) {
  const st = sid(pipeline, stage), c = uid(by), o = owner ? uid(owner) : c;
  const id = one(`insert into deals (title, value_pence, stage_id, organisation_id, person_id, owner_id, private, created_by) values ('${esc(title)}', ${value === null ? "null" : value}, ${st},
    ${org ? `(select id from organisations where name='${esc(org)}')` : "null"}, ${person ? `(select id from persons where first_name||' '||last_name='${esc(person)}' limit 1)` : "null"}, ${o}, ${priv}, ${c}) returning id`);
  sql(`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name) values (${id}, ${st}, '${esc(stage)}', '${esc(pipeline)}'); insert into timeline_events (deal_id, kind, actor_id) values (${id}, 'added', ${c})`);
  return Number(id);
}
const col = (page, stage) => page.getByRole("region", { name: stage, exact: true });
const tot = async (page, stage) => ((await col(page, stage).locator(".tot").textContent()) || "").trim();
const cardTitles = async (page, stage) => col(page, stage).locator("a.card .t").evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
const card = (page, title) => page.locator("a.card").filter({ has: page.locator(".t", { hasText: title }) });
const drawer = (page) => page.getByRole("complementary", { name: "Deal" });
const body = async (page) => (await page.textContent("body")) || "";
const visible = async (page) => ((await page.innerText("body")) || "").toLowerCase();
const go = async (page, path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const NAMES = { "ada@barnacle.ai": "Ada Fake", "grace@barnacle.ai": "Grace Fake", "linus@barnacle.ai": "Linus Fake", "margaret@barnacle.ai": "Margaret Fake" };
async function login(browser, email) { const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 } }); const page = await ctx.newPage(); await signIn(page, BASE, email, NAMES[email]); return page; }
async function run(name, fn) { try { await fn(); } catch (e) { check(name, false, "error: " + String(e.message).split("\n")[0]); } }
async function save(page) { await Promise.all([page.waitForLoadState("networkidle"), page.click("text=[ SAVE ]")]); await page.waitForTimeout(500); await page.waitForLoadState("networkidle"); }
async function pickOrg(page, name, exists = true) {
  const i = page.getByRole("combobox", { name: "Organisation" }); await i.fill(name);
  if (exists) await page.getByRole("listbox", { name: "Organisations" }).getByRole("button", { name, exact: true }).click(); else await page.getByRole("button", { name: `Add organisation '${name}'` }).click();
}
async function pickPerson(page, name) { await page.getByRole("combobox", { name: "Person" }).fill(name); await page.getByRole("listbox", { name: "People" }).getByRole("button", { name, exact: true }).click(); }
async function newDeal(page, pipeline, f) {
  await go(page, `/deals/new?pipeline=${pid(pipeline)}`);
  if (f.title !== undefined) await page.fill('input[name="title"]', f.title);
  if (f.value !== undefined) await page.fill('input[name="value"]', f.value);
  if (f.org) await pickOrg(page, f.org, f.orgExists !== false);
  if (f.person) await pickPerson(page, f.person);
  if (f.stage) await page.selectOption('select[name="stageId"]', { label: f.stage });
  if (f.owner) await page.selectOption('select[name="ownerId"]', { label: f.owner });
  if (f.priv) await page.check('input[name="private"]');
  await save(page);
}
const historyItems = async (page) => drawer(page).getByRole("region", { name: "History" }).getByRole("listitem").allTextContents();

(async () => {
  const browser = await chromium.launch();
  // Setup: the scenarios add their own "Fakeco website"; "Ada Example" works at Fakeco Ltd.
  sql(`delete from deals where title='Fakeco website'`);
  sql(`insert into persons (first_name,last_name,organisation_id,owner_id,consent,private,created_by) values ('Ada','Example',(select id from organisations where name='Fakeco Ltd'),${uid("Ada Fake")},'subscribed',false,${uid("Ada Fake")})`);
  const linus = await login(browser, "linus@barnacle.ai");
  const marg = await login(browser, "margaret@barnacle.ai");
  const ada = await login(browser, "ada@barnacle.ai");
  const grace = await login(browser, "grace@barnacle.ai");

  await run("US1 scenario 1", async () => {
    await go(linus, "/deals");
    const h1 = (await linus.textContent("h1")).trim();
    const names = await linus.locator("section.col h2").allTextContents();
    const exp = sql(`select s.name from stages s where pipeline_id=(select id from pipelines order by position limit 1) order by position`).split("\n");
    const heads = []; let ok = h1 === "Sales" && JSON.stringify(names) === JSON.stringify(exp);
    for (const s of names) { const t = await tot(linus, s); heads.push(`${s}: ${t}`); if (t !== expected("Sales", s, "Linus Fake")) ok = false; }
    check("US1 scenario 1", ok, `h1 ${h1}; ${heads.join("; ")}`);
  });

  await run("US2 scenario 1", async () => {
    await go(linus, "/deals"); await linus.click("text=[ ADD DEAL ]"); await linus.waitForLoadState("networkidle");
    await linus.fill('input[name="title"]', "Fakeco website"); await linus.fill('input[name="value"]', "4000");
    await pickOrg(linus, "Fakeco Ltd"); await pickPerson(linus, "Ada Example");
    await linus.selectOption('select[name="stageId"]', { label: "Proposal" }); await save(linus);
    const inCol = await card(linus, "Fakeco website").count() && (await cardTitles(linus, "Proposal")).includes("Fakeco website");
    const owner = one(`select u.name from deals d join users u on u.id=d.owner_id where d.title='Fakeco website'`);
    const t = await tot(linus, "Proposal");
    check("US2 scenario 1", inCol && owner === "Linus Fake" && t === expected("Sales", "Proposal", "Linus Fake") && t.startsWith("6 deals"),
      `card in Proposal ${!!inCol}, owner ${owner}, header "${t}" (was 5 deals before), url ${linus.url()}`);
  });

  await run("US1 scenario 2", async () => {
    await go(linus, "/deals");
    const c = card(linus, "Fakeco website"); const txt = (await c.textContent()).trim();
    const ok = /Fakeco website/.test(txt) && /Fakeco Ltd/.test(txt) && /Ada Example/.test(txt) && /£4,000(?!\.)/.test(txt) && !/No next activity/i.test(await body(linus));
    check("US1 scenario 2", ok, `card text: "${txt}"`);
  });

  await run("US1 scenario 3", async () => {
    await go(linus, "/deals");
    await Promise.all([linus.waitForURL(/pipeline=/), linus.selectOption('select[name="pipeline"]', { label: "Ambassadors" })]);
    await linus.waitForLoadState("networkidle");
    const h1 = (await linus.textContent("h1")).trim(); const url = linus.url();
    const cols = await linus.locator("section.col h2").allTextContents();
    await linus.reload(); await linus.waitForLoadState("networkidle");
    const h1b = (await linus.textContent("h1")).trim();
    const p2 = await (await browser.newContext()).newPage(); await signIn(p2, BASE, "margaret@barnacle.ai", "Margaret Fake", new URL(url).pathname + new URL(url).search);
    await go(p2, new URL(url).pathname + new URL(url).search); const h1c = (await p2.textContent("h1")).trim();
    check("US1 scenario 3", h1 === "Ambassadors" && url.includes(`pipeline=${pid("Ambassadors")}`) && h1b === "Ambassadors" && h1c === "Ambassadors",
      `after pick: h1 ${h1}, url ${url}, columns ${cols.join(",")}; after reload ${h1b}; shared address (other user) ${h1c}`);
    await p2.context().close();
  });

  await run("US1 scenario 4", async () => {
    await go(linus, "/deals"); const t = await tot(linus, "Closing"); const none = (await col(linus, "Closing").textContent());
    check("US1 scenario 4", t === "0 deals · £0" && none.includes("No deals in this stage."), `Closing header "${t}", column text "${none.trim()}"`);
  });

  await run("US2 scenario 2", async () => {
    await go(linus, "/deals"); await col(linus, "Qualified").getByRole("link", { name: "Add a deal to Qualified" }).click(); await linus.waitForURL(/deals\/new/); await linus.waitForSelector('select[name="pipelineId"]');
    const p = await linus.$eval('select[name="pipelineId"]', (s) => s.selectedOptions[0].textContent);
    const s = await linus.$eval('select[name="stageId"]', (s) => s.selectedOptions[0].textContent);
    check("US2 scenario 2", p === "Sales" && s === "Qualified", `form opened at ${linus.url()}: pipeline "${p}", stage "${s}"`);
  });

  await run("US2 scenario 3", async () => {
    const before = one("select count(*) from deals"); const notes = []; let ok = true;
    for (const [title, value, want] of [["", "100", "title"], ["Bad value deal", "-5", "value"], ["Bad value deal", "abc", "value"], ["Bad value deal", "4000.123", "value"]]) {
      await newDeal(linus, "Sales", { title, value });
      const b = await body(linus); const tErr = b.includes("Enter a deal title."), vErr = b.includes("Enter a value in pounds, for example 4000 or 4000.50.");
      const near = want === "title" ? await linus.locator('label:has(input[name="title"]), .field:has(input[name="title"])').first().textContent() : await linus.locator('.field:has(input[name="value"]), label:has(input[name="value"])').first().textContent();
      const good = (want === "title" ? tErr : vErr) && near.includes(want === "title" ? "Enter a deal title." : "Enter a value in pounds") && linus.url().includes("/deals/new");
      if (!good) ok = false; notes.push(`title "${title}" value "${value}": ${good ? "message next to " + want : "MISSING"}`);
    }
    const after = one("select count(*) from deals");
    check("US2 scenario 3", ok && before === after, notes.join("; ") + `; deals ${before} → ${after}`);
  });

  await run("US2 scenario 4", async () => {
    await newDeal(linus, "Sales", { title: "Kara fake deal", person: "Kara Testperson" });
    const o = one(`select o.name from deals d left join organisations o on o.id=d.organisation_id where d.title='Kara fake deal'`);
    const t = (await card(linus, "Kara fake deal").textContent()) || "";
    check("US2 scenario 4", o === "Fakeco Ltd" && t.includes("Fakeco Ltd"), `saved deal organisation: ${o}; card "${t.trim()}"`);
  });

  await run("US2 scenario 5", async () => {
    await newDeal(linus, "Sales", { title: "New org fake deal", org: "Brand New Fakeorg", orgExists: false });
    const o = one(`select o.name||'|'||o.created_by from deals d join organisations o on o.id=d.organisation_id where d.title='New org fake deal'`);
    const n = one(`select count(*) from organisations where name='Brand New Fakeorg'`);
    check("US2 scenario 5", o.startsWith("Brand New Fakeorg|") && n === "1", `deal organisation row: ${o}; organisations named so: ${n}`);
  });

  await run("US3 scenario 1", async () => {
    await go(linus, "/deals");
    const q0 = await tot(linus, "Qualified"), p0 = await tot(linus, "Proposal");
    await card(linus, "Sample Gyms CRM").dragTo(col(linus, "Proposal"));
    const quick = (await cardTitles(linus, "Proposal"))[0];
    await linus.waitForTimeout(1500);
    const q1 = await tot(linus, "Qualified"), p1 = await tot(linus, "Proposal");
    await linus.reload(); await linus.waitForLoadState("networkidle");
    const after = (await cardTitles(linus, "Proposal")).includes("Sample Gyms CRM") && !(await cardTitles(linus, "Qualified")).includes("Sample Gyms CRM");
    check("US3 scenario 1", quick === "Sample Gyms CRM" && q1 === expected("Sales", "Qualified", "Linus Fake") && p1 === expected("Sales", "Proposal", "Linus Fake") && q1 !== q0 && p1 !== p0 && after,
      `top of Proposal right after drop: ${quick}; Qualified "${q0}" → "${q1}", Proposal "${p0}" → "${p1}"; still in Proposal after reload: ${after}`);
  });

  await run("US3 scenario 2", async () => {
    const p = await login(browser, "grace@barnacle.ai"); await go(p, "/deals"); await card(p, "Sample Gyms CRM").click(); await p.waitForURL(/open=/); await p.waitForLoadState("networkidle");
    const h = await historyItems(p); const line = h.find((x) => x.includes("Moved from Qualified to Proposal")) || "";
    check("US3 scenario 2", /Moved from Qualified to Proposal by Linus Fake/.test(line) && /\d{1,2} \w{3} \d{4}.*\d{1,2}:\d{2}/.test(line), `Grace sees history line "${line}"`);
    await p.context().close();
  });

  await run("US3 scenario 3", async () => {
    const id = did("Sample Gyms CRM");
    await go(linus, `/deals?pipeline=${pid("Sales")}&open=${id}`);
    await drawer(linus).locator('select[name="toStageId"]').selectOption({ label: "Sales · Negotiation" });
    await Promise.all([linus.waitForLoadState("networkidle"), drawer(linus).getByRole("button", { name: "[ MOVE ]" }).click()]); await linus.waitForTimeout(500);
    const a = (await cardTitles(linus, "Negotiation"))[0]; const h1 = (await historyItems(linus))[0] || "";
    const negOk = (await tot(linus, "Negotiation")) === expected("Sales", "Negotiation", "Linus Fake");
    await drawer(linus).locator('select[name="toStageId"]').selectOption({ label: "Ambassadors · Talking" });
    await Promise.all([linus.waitForLoadState("networkidle"), drawer(linus).getByRole("button", { name: "[ MOVE ]" }).click()]); await linus.waitForTimeout(500);
    const h1b = (await linus.textContent("h1")).trim(); const inT = (await cardTitles(linus, "Talking")).includes("Sample Gyms CRM"); const h2 = (await historyItems(linus))[0] || "";
    const periods = one(`select count(*) from deal_stage_periods where deal_id=${id}`), open = one(`select stage_name from deal_stage_periods where deal_id=${id} and left_at is null`);
    check("US3 scenario 3", a === "Sample Gyms CRM" && negOk && /Moved from Proposal to Negotiation by Linus Fake/.test(h1) && h1b === "Ambassadors" && inT && /Moved from Sales · Negotiation to Ambassadors · Talking by Linus Fake/.test(h2) && open === "Talking",
      `stage move: top of Negotiation ${a}, history "${h1}"; pipeline move: board ${h1b}, in Talking ${inT}, history "${h2}"; stage periods ${periods}, open one ${open}`);
  });

  await run("US3 scenario 4", async () => {
    await go(linus, "/deals"); const id = did("Fakeco AI pilot");
    const b = one(`select version||'/'||(select count(*) from timeline_events where deal_id=${id})||'/'||(select count(*) from deal_stage_periods where deal_id=${id}) from deals where id=${id}`);
    const t0 = await tot(linus, "Proposal");
    let posts = 0; const h = (r) => { if (r.method() === "POST") posts++; }; linus.on("request", h);
    await card(linus, "Fakeco AI pilot").dragTo(col(linus, "Proposal").locator("header"));
    await linus.waitForTimeout(1500); linus.off("request", h);
    const a = one(`select version||'/'||(select count(*) from timeline_events where deal_id=${id})||'/'||(select count(*) from deal_stage_periods where deal_id=${id}) from deals where id=${id}`);
    check("US3 scenario 4", a === b && t0 === (await tot(linus, "Proposal")) && (await cardTitles(linus, "Proposal")).includes("Fakeco AI pilot") && !(await linus.locator('p.err[role="alert"]').count()),
      `version/events/periods ${b} → ${a}; Proposal "${t0}" unchanged; POSTs sent ${posts}`);
  });

  await run("US3 scenario 5", async () => {
    await go(linus, "/deals"); // Linus loads the board, then Margaret archives one deal and moves another
    const arch = did("Placeholder Partners intro"), mv = did("Fake retainer renewal");
    await go(marg, `/deals?open=${arch}`); await Promise.all([marg.waitForLoadState("networkidle"), drawer(marg).getByRole("button", { name: "[ ARCHIVE ]" }).click()]);
    await go(marg, `/deals?open=${mv}`); await drawer(marg).locator('select[name="toStageId"]').selectOption({ label: "Sales · Closing" });
    await Promise.all([marg.waitForLoadState("networkidle"), drawer(marg).getByRole("button", { name: "[ MOVE ]" }).click()]); await marg.waitForTimeout(500);
    await card(linus, "Placeholder Partners intro").dragTo(col(linus, "Lead in")); await linus.waitForTimeout(2000);
    const m1 = (await linus.locator('[role="alert"]').allTextContents()).join(" "); const gone = (await card(linus, "Placeholder Partners intro").count()) === 0;
    await go(linus, "/deals"); // fresh board, then Margaret moves the deal back to Qualified behind Linus' back
    await go(marg, `/deals?open=${mv}`); await drawer(marg).locator('select[name="toStageId"]').selectOption({ label: "Sales · Qualified" });
    await Promise.all([marg.waitForLoadState("networkidle"), drawer(marg).getByRole("button", { name: "[ MOVE ]" }).click()]); await marg.waitForTimeout(500);
    await card(linus, "Fake retainer renewal").dragTo(col(linus, "Lead in")); await linus.waitForTimeout(2000);
    const m2 = (await linus.locator('[role="alert"]').allTextContents()).join(" ");
    const where = (await cardTitles(linus, "Qualified")).includes("Fake retainer renewal") && !(await cardTitles(linus, "Lead in")).includes("Fake retainer renewal") && !(await cardTitles(linus, "Closing")).includes("Fake retainer renewal");
    const dbStage = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${mv}`);
    const msg = "This deal changed since you loaded the board. The board has been refreshed.";
    check("US3 scenario 5", m1.includes(msg) && gone && m2.includes(msg) && where && dbStage === "Qualified",
      `archived deal drag: "${m1}", card gone ${gone}; moved deal drag: "${m2}", (Margaret moved it Closing → Qualified after Linus loaded the board) shown in Qualified ${where}, DB stage ${dbStage}`);
  });

  await run("US4 scenario 1", async () => {
    await go(linus, "/deals"); await card(linus, "Fakeco website").click(); await linus.waitForURL(/open=/); await linus.waitForLoadState("networkidle");
    const d = drawer(linus); const t = (await d.textContent()) || "";
    const orgHref = await d.getByRole("link", { name: "Fakeco Ltd" }).getAttribute("href"); const perHref = await d.getByRole("link", { name: "Ada Example" }).getAttribute("href");
    const fields = ["Fakeco website", "Sales · Proposal", "£4,000", "Linus Fake", "// HISTORY"].every((x) => t.includes(x)) && /Date added/.test(t) && /Expected close/.test(t) && /Owner/.test(t);
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    // newest first: add a second event by editing the title, then compare
    const id = did("Fakeco website");
    const url = linus.url();
    await linus.reload(); const hist = await historyItems(linus);
    const p2 = await login(browser, "grace@barnacle.ai"); await go(p2, new URL(url).pathname + new URL(url).search); const shared = await drawer(p2).count();
    await p2.context().close();
    check("US4 scenario 1", fields && orgHref.startsWith("/organisations/") && perHref.startsWith("/people/") && url.includes(`open=${id}`) && shared === 1 && t.includes(today),
      `drawer: "${t.replace(/\s+/g, " ").slice(0, 300)}"; org link ${orgHref}, person link ${perHref}; address ${url} opens the drawer for another user: ${shared === 1}; history ${JSON.stringify(hist)}`);
  });

  await run("US4 scenario 2", async () => {
    const id = did("Fakeco website"); await go(linus, `/deals?open=${id}`); const t0 = await tot(linus, "Proposal");
    await drawer(linus).getByRole("link", { name: "[ EDIT ]" }).click(); await linus.waitForLoadState("networkidle");
    await linus.fill('input[name="value"]', "5000"); await save(linus);
    const c = (await card(linus, "Fakeco website").textContent()) || ""; const t1 = await tot(linus, "Proposal"); const h = await historyItems(linus);
    check("US4 scenario 2", c.includes("£5,000") && t1 === expected("Sales", "Proposal", "Linus Fake") && t1 !== t0 && /Edited by Linus Fake: Value/.test(h[0] || "") && h.length >= 2 && /Added/i.test(h[h.length - 1]),
      `card "${c.trim()}", Proposal "${t0}" → "${t1}", history (newest first) ${JSON.stringify(h)}`);
  });

  await run("US4 scenario 3", async () => {
    const id = did("Kara fake deal"); await go(linus, `/deals?open=${id}`); const s = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${id}`); const t0 = await tot(linus, s);
    await Promise.all([linus.waitForLoadState("networkidle"), drawer(linus).getByRole("button", { name: "[ ARCHIVE ]" }).click()]); await linus.waitForTimeout(500);
    const gone = (await card(linus, "Kara fake deal").count()) === 0; const t1 = await tot(linus, s);
    const ev = one(`select e.kind||' by '||u.name from timeline_events e join users u on u.id=e.actor_id where e.deal_id=${id} order by e.id desc limit 1`);
    check("US4 scenario 3", gone && t1 === expected("Sales", s, "Linus Fake") && t0 !== t1 && ev === "archived by Linus Fake",
      `card gone ${gone}; ${s} "${t0}" → "${t1}"; last history event in DB: ${ev} (the drawer of an archived deal is not shown on the board, so it is read from the DB)`);
  });

  await run("US4 scenario 4", async () => {
    const id = did("Fakeco website"); await go(ada, `/deals?open=${id}`);
    await drawer(ada).getByRole("link", { name: "[ DELETE ]" }).click(); await ada.waitForLoadState("networkidle");
    const q = (await ada.getByRole("alertdialog").textContent()) || "";
    await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ DELETE FOR GOOD ]")]); await ada.waitForTimeout(500);
    const b = await body(ada); const n = one(`select count(*) from deals where id=${id}`);
    check("US4 scenario 4", q.includes("Delete Fakeco website for good? This can't be undone.") && b.includes("Fakeco website was deleted.") && n === "0" && (await card(ada, "Fakeco website").count()) === 0,
      `confirm "${q.trim().slice(0, 80)}"; after: notice shown ${b.includes("Fakeco website was deleted.")}, deal rows ${n}`);
  });

  await run("US4 scenario 5", async () => {
    const id = insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", by: "Linus Fake" });
    await go(ada, `/deals?open=${id}&confirm=delete`);
    const field = await ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    await go(linus, `/deals?open=${id}&confirm=delete`);
    const noBtn = (await drawer(linus).getByRole("link", { name: "[ DELETE ]" }).count()) === 0 && !(await body(linus)).includes("for good?");
    const res = await linus.request.post(BASE + "/deals", { multipart: { [field]: "", id: String(id) } }); const txt = await res.text();
    const n = one(`select count(*) from deals where id=${id}`);
    check("US4 scenario 5", noBtn && txt.includes("You don&#x27;t have access to this page.") && n === "1", `Linus drawer without DELETE ${noBtn}; replayed delete action answer has the no-access text ${txt.includes("You don&#x27;t have access")}; deal still there ${n === "1"}`);
  });

  // --- Edge cases on the board (Sales) ---
  await run("Edge case 1", async () => {
    await newDeal(linus, "Sales", { title: "Fake pence A", value: "£4,000.50", stage: "Closing" });
    await newDeal(linus, "Sales", { title: "Fake pence B", value: " 4000.5 ", stage: "Closing" });
    await newDeal(linus, "Sales", { title: "Fake no value", value: "", stage: "Closing" });
    const v = sql(`select title||'='||coalesce(value_pence::text,'null') from deals where title like 'Fake pence%' or title='Fake no value' order by title`).replace(/\n/g, ", ");
    await go(linus, "/deals"); const a = (await card(linus, "Fake pence A").locator(".val").textContent()), nv = await card(linus, "Fake no value").locator(".val").textContent();
    const t = await tot(linus, "Closing"); const f = (await card(linus, "Intro call").locator(".val").textContent());
    check("Edge case 1", v === "Fake no value=null, Fake pence A=400050, Fake pence B=400050" && a === "£4,000.50" && nv === "—" && t === expected("Sales", "Closing", "Linus Fake") && f === "£8,400",
      `saved ${v}; card values "${a}", empty "${nv}", whole pounds card "${f}"; Closing header "${t}" (includes 2 × £4,000.50 and £0)`);
  });

  await run("Edge case 2", async () => {
    await go(linus, "/deals"); const c = card(linus, "Fake no value");
    const lines = await c.locator(".ln").count(); const txt = (await c.textContent()).trim();
    const k = card(linus, "Fakeco AI pilot"); const kl = await k.locator(".ln").allTextContents();
    check("Edge case 2", lines === 0 && kl.length >= 1, `card with no org/person: "${txt}" (${lines} extra lines); a card with an org has lines ${JSON.stringify(kl)}`);
  });

  await run("Edge case 3", async () => {
    insertDeal({ title: "Fake" + "verylongtitle".repeat(14), pipeline: "Sales", stage: "Lead in", by: "Linus Fake", org: "Testfield Health Fake" });
    sql(`update organisations set name='Testfield Health Fake ${"Averyveryverylongorganisationname".repeat(2)}' where name='Testfield Health Fake'`);
    await go(linus, "/deals");
    const w = await linus.$$eval("section.col", (cs) => cs.map((c) => Math.round(c.getBoundingClientRect().width)));
    const c = await card(linus, "Fakeverylongtitle").evaluate((e) => ({ cw: e.getBoundingClientRect().width, sw: e.scrollWidth, cl: e.clientWidth, h: e.getBoundingClientRect().height }));
    sql(`update organisations set name='Testfield Health Fake' where name like 'Testfield Health Fake %'`);
    check("Edge case 3", new Set(w).size === 1 && c.sw <= c.cl + 1 && c.cw <= w[0], `column widths ${JSON.stringify(w)}; long card width ${c.cw}, scrollWidth ${c.sw} vs clientWidth ${c.cl}, height ${c.h} (wrapped)`);
  });

  await run("Edge case 4", async () => {
    const id = insertDeal({ title: "Fake archived links", pipeline: "Sales", stage: "Lead in", by: "Linus Fake", org: "Sample Studios Fake", person: "Cleo Testperson" });
    const per = one(`select id from persons where first_name='Cleo'`), org = one(`select id from organisations where name='Sample Studios Fake'`);
    sql(`update persons set archived_at=now() where id=${per}; update organisations set archived_at=now() where id=${org}`);
    await go(linus, `/deals?open=${id}`);
    const c = (await card(linus, "Fake archived links").textContent()); const d = drawer(linus);
    const badges = await d.locator(".badge").allTextContents();
    const ok1 = c.includes("Sample Studios Fake") && c.includes("Cleo Testperson") && badges.filter((b) => b.trim() === "Archived").length === 2;
    // An admin deletes the person and the organisation through their pages
    await go(ada, `/people/${per}?confirm=delete`); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ DELETE FOR GOOD ]")]);
    await go(ada, `/organisations/${org}?confirm=delete`); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ DELETE FOR GOOD ]")]);
    await ada.waitForTimeout(500);
    const left = one(`select '1/'||coalesce(organisation_id::text,'none')||'/'||coalesce(person_id::text,'none') from deals where id=${id}`);
    await go(linus, `/deals?open=${id}`); const c2 = (await card(linus, "Fake archived links").textContent()).trim();
    check("Edge case 4", ok1 && left === "1/none/none" && !c2.includes("Cleo") && !c2.includes("Sample Studios"), `card while archived "${c.trim()}", drawer badges ${JSON.stringify(badges)}; after admin deletes: deal row/org/person ${left}, card "${c2}"`);
  });

  await run("Edge case 5", async () => {
    const id = insertDeal({ title: "Fake Alan deal", pipeline: "Sales", stage: "Lead in", by: "Linus Fake", owner: "Alan Fake" });
    await go(linus, `/deals?open=${id}`); const d = (await drawer(linus).textContent());
    await go(linus, `/deals/${id}/edit`); const eo = await linus.$$eval('select[name="ownerId"] option', (o) => o.map((x) => x.textContent));
    await go(linus, `/deals/new?pipeline=${pid("Sales")}`); const no = await linus.$$eval('select[name="ownerId"] option', (o) => o.map((x) => x.textContent));
    check("Edge case 5", d.includes("Alan Fake (deactivated)") && eo.some((x) => x.includes("Alan Fake")) && !no.some((x) => x.includes("Alan")),
      `drawer shows "Alan Fake (deactivated)": ${d.includes("Alan Fake (deactivated)")}; edit form owners ${JSON.stringify(eo)}; new form owners ${JSON.stringify(no)}`);
  });

  await run("Edge case 13", async () => {
    await go(linus, "/deals"); const before = (await cardTitles(linus, "Negotiation"))[0];
    await card(linus, "Mock Labs audit").dragTo(col(linus, "Negotiation")); await linus.waitForTimeout(1500); await linus.reload(); await linus.waitForLoadState("networkidle");
    const t = await cardTitles(linus, "Negotiation");
    const order = sql(`select d.title from deals d join stages s on s.id=d.stage_id where s.name='Negotiation' and s.pipeline_id=${pid("Sales")} and d.archived_at is null and (not d.private or d.created_by=${uid("Linus Fake")} or d.owner_id=${uid("Linus Fake")}) order by d.stage_entered_at desc, d.id desc`).split("\n");
    check("Edge case 13", t[0] === "Mock Labs audit" && JSON.stringify(t) === JSON.stringify(order), `top before ${before}; after drag ${JSON.stringify(t)} (DB by entered-at desc ${JSON.stringify(order)})`);
  });

  await run("Edge case 14", async () => {
    await go(linus, "/deals"); const id = did("Old fake opportunity");
    const st = one(`select s.name||'/'||(d.archived_at is not null) from deals d join stages s on s.id=d.stage_id where d.id=${id}`);
    const shown = await card(linus, "Old fake opportunity").count(); const t = await tot(linus, "Proposal");
    await go(linus, `/deals?open=${id}`); const dr = await drawer(linus).count();
    check("Edge case 14", shown === 0 && st === "Proposal/true" && t === expected("Sales", "Proposal", "Linus Fake") && dr === 0, `archived deal on board ${shown}, drawer ${dr}, DB stage/archived ${st}, Proposal header "${t}" (excludes its £6,400)`);
  });

  await run("Edge case 15", async () => {
    await go(linus, "/deals"); const q0 = await tot(linus, "Lead in");
    await linus.route("**/deals**", (r) => (r.request().method() === "POST" ? r.abort("internetdisconnected") : r.continue()));
    await card(linus, "Fakeco training day").dragTo(col(linus, "Qualified")); await linus.waitForTimeout(2000);
    const m = (await linus.locator('[role="alert"]').allTextContents()).join(" ");
    const back = (await cardTitles(linus, "Lead in")).includes("Fakeco training day") && !(await cardTitles(linus, "Qualified")).includes("Fakeco training day");
    await linus.unroute("**/deals**");
    const db = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.title='Fakeco training day'`);
    check("Edge case 15", m.includes("The deal could not be moved. Try again.") && back && q0 === (await tot(linus, "Lead in")) && db === "Lead in", `message "${m}", card back in Lead in ${back}, DB stage ${db}`);
  });

  await run("Edge case 8", async () => {
    const id = did("Intro call"); const b2 = await login(browser, "grace@barnacle.ai");
    await go(linus, `/deals/${id}/edit`); await go(b2, `/deals/${id}/edit`);
    await linus.fill('input[name="value"]', "1111"); await save(linus);
    await b2.fill('input[name="value"]', "2222"); await save(b2);
    const b = await body(b2); const v = one(`select value_pence from deals where id=${id}`);
    check("Edge case 8", b.includes("Someone else changed this deal while you were editing. Reload to see their changes.") && v === "111100", `second save message shown ${b.includes("Someone else changed")}; DB value ${v} (first save kept)`);
    await b2.context().close();
  });

  await run("Edge case 9", async () => {
    const notes = []; let ok = true;
    const priv = did("Fake secret project"), arch = did("Old fake opportunity"), other = Number(one(`select d.id from deals d join stages s on s.id=d.stage_id where s.pipeline_id=${pid("Ambassadors")} and d.archived_at is null and not d.private limit 1`));
    for (const [q, want] of [["?pipeline=999999", "Sales"], ["?pipeline=%3Cb%3Ezzqq%3C/b%3E", "Sales"], ["?open=999999", "Sales"], [`?open=${arch}`, "Sales"], [`?pipeline=${pid("Sales")}&open=${other}`, "Sales"], [`?pipeline=${pid("Exec Dinner")}&open=${priv}zzqq`, "Exec Dinner"], [`?open=${priv}`, "Sales"], [`?open=zzqq&error=zzqq`, "Sales"]]) {
      await go(linus, "/deals" + q); const h1 = (await linus.textContent("h1")).trim(); const dr = await drawer(linus).count(); const leak = (await visible(linus)).includes("zzqq") || (await visible(linus)).includes("fake secret project");
      const good = h1 === want && dr === 0 && !leak; if (!good) ok = false; notes.push(`${q} → ${h1}, drawer ${dr}, leak ${leak}`);
    }
    check("Edge case 9", ok, notes.join("; ") + ` (Fake secret project is private to Ada, viewer Linus)`);
  });

  await run("Edge case 10", async () => {
    sql(`insert into pipelines (name, position) values ('Fake wide pipeline', 99)`); const p = pid("Fake wide pipeline");
    for (let i = 1; i <= 11; i++) sql(`insert into stages (pipeline_id, name, position) values (${p}, 'Fake stage number ${i} with a long name', ${i})`);
    insertDeal({ title: "Fake wide deal", pipeline: "Fake wide pipeline", stage: "Fake stage number 11 with a long name", by: "Linus Fake", value: 123400 });
    await go(linus, `/deals?pipeline=${p}`);
    const b = await linus.$eval(".board", (e) => ({ sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX }));
    const heads = await linus.$$eval("section.col header", (hs) => hs.map((h) => { const n = h.querySelector("h2"), t = h.querySelector(".tot"); return { n: n.textContent, cut: n.scrollWidth > n.clientWidth || t.scrollWidth > t.clientWidth, t: t.textContent }; }));
    check("Edge case 10", heads.length === 11 && b.sw > b.cw && /auto|scroll/.test(b.ox) && heads.every((h) => !h.cut) && heads[10].t === "1 deal · £1,234", `board scrollWidth ${b.sw} > clientWidth ${b.cw} (overflow-x ${b.ox}); 11 headers, any cut off: ${heads.some((h) => h.cut)}; last header "${heads[10].n}" "${heads[10].t}"`);
  });

  await run("Edge case 11", async () => {
    const p = pid("Fake wide pipeline"); const s = sid("Fake wide pipeline", "Fake stage number 1 with a long name"); const lin = uid("Linus Fake");
    sql(`insert into deals (title, value_pence, stage_id, owner_id, created_by) select 'Fake bulk '||g, g*100, ${s}, ${lin}, ${lin} from generate_series(1,200) g`);
    await go(linus, `/deals?pipeline=${p}`);
    const t = await tot(linus, "Fake stage number 1 with a long name");
    const sc = await col(linus, "Fake stage number 1 with a long name").evaluate((c) => { const els = [c, ...c.querySelectorAll("*")]; const s = els.find((e) => e.scrollHeight > e.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(e).overflowY)); return s ? { cls: s.className, sh: s.scrollHeight, ch: s.clientHeight } : null; });
    const page = await linus.evaluate(() => ({ dh: document.documentElement.scrollHeight, wh: window.innerHeight }));
    check("Edge case 11", t === "200 deals · £20,100" && sc !== null, `header "${t}" (sum 1..200 pounds = £20,100); scrolling element in the column ${JSON.stringify(sc)}; page height ${page.dh} vs window ${page.wh}`);
  });

  // --- US5: pipelines admin (Ada) ---
  await run("US5 scenario 1", async () => {
    await go(ada, "/admin/pipelines"); await ada.getByRole("textbox", { name: "New pipeline" }).fill("Partners");
    await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ ADD PIPELINE ]")]); await ada.waitForTimeout(400);
    const stages = one(`select count(*) from stages where pipeline_id=${pid("Partners")}`);
    await go(ada, "/deals"); const opts = await ada.$$eval('select[name="pipeline"] option', (o) => o.map((x) => x.textContent));
    await Promise.all([ada.waitForURL(/pipeline=/), ada.selectOption('select[name="pipeline"]', { label: "Partners" })]); await ada.waitForLoadState("networkidle");
    const b = await body(ada);
    check("US5 scenario 1", stages === "0" && opts.includes("Partners") && b.includes("This pipeline has no stages yet."), `stages ${stages}; picker ${JSON.stringify(opts)}; board says no stages ${b.includes("This pipeline has no stages yet.")}`);
  });

  await run("US5 scenario 2", async () => {
    const p = pid("Partners"); await go(ada, `/admin/pipelines/${p}`);
    for (const s of ["Intro", "Talking", "Signed"]) { await ada.getByRole("textbox", { name: "New stage" }).fill(s); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ ADD STAGE ]")]); await ada.waitForTimeout(300); }
    insertDeal({ title: "Fake partner deal", pipeline: "Partners", stage: "Talking", by: "Ada Fake", value: 50000 });
    await ada.getByRole("textbox", { name: "Name of Talking" }).fill("In talks"); await Promise.all([ada.waitForLoadState("networkidle"), ada.getByRole("button", { name: "Rename Talking" }).click()]); await ada.waitForTimeout(300);
    for (let i = 0; i < 2; i++) { await Promise.all([ada.waitForLoadState("networkidle"), ada.getByRole("button", { name: "Move Signed up" }).click()]); await ada.waitForTimeout(300); }
    await go(ada, `/deals?pipeline=${p}`); const cols = await ada.locator("section.col h2").allTextContents(); const inT = await cardTitles(ada, "In talks");
    check("US5 scenario 2", JSON.stringify(cols) === JSON.stringify(["Signed", "Intro", "In talks"]) && inT.includes("Fake partner deal") && (await tot(ada, "In talks")) === "1 deal · £500", `columns ${JSON.stringify(cols)}; In talks cards ${JSON.stringify(inT)}`);
  });

  await run("US5 scenario 3", async () => {
    await go(ada, "/admin/pipelines");
    for (let i = 0; i < 10 && (await ada.getByRole("button", { name: "Move Partners up" }).isEnabled()); i++) { await Promise.all([ada.waitForLoadState("networkidle"), ada.getByRole("button", { name: "Move Partners up" }).click()]); await ada.waitForTimeout(300); }
    await go(ada, "/deals"); const opts = await ada.$$eval('select[name="pipeline"] option', (o) => o.map((x) => x.textContent)); const h1 = (await ada.textContent("h1")).trim();
    await go(linus, "/deals"); const h1l = (await linus.textContent("h1")).trim();
    check("US5 scenario 3", opts[0] === "Partners" && h1 === "Partners" && h1l === "Partners", `picker order ${JSON.stringify(opts)}; default board for Ada ${h1}, for Linus ${h1l}`);
    await go(ada, "/admin/pipelines"); // put Partners back below Sales
    await Promise.all([ada.waitForLoadState("networkidle"), ada.getByRole("button", { name: "Move Partners down" }).click()]);
  });

  await run("US5 scenario 4", async () => {
    const before = one("select count(*) from deals"); const ps = sid("Sales", "Proposal"); const ids = sql(`select id from deals where stage_id=${ps} order by id`).split("\n");
    const archived = one(`select count(*) from deals where stage_id=${ps} and archived_at is not null`);
    await go(ada, `/admin/pipelines/${pid("Sales")}`); await ada.getByRole("link", { name: "Delete Proposal" }).click(); await ada.waitForSelector('select[name="targetStageId"]');
    const dlg = (await ada.getByRole("alertdialog").textContent()) || ""; const opts = await ada.$$eval('select[name="targetStageId"] option', (o) => o.map((x) => x.textContent));
    await ada.selectOption('select[name="targetStageId"]', { label: "Sales · Qualified" });
    await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ MOVE DEALS AND DELETE ]")]); await ada.waitForTimeout(500);
    const after = one("select count(*) from deals"); const moved = one(`select count(*) from deals where id in (${ids.join(",")}) and stage_id=${sid("Sales", "Qualified")}`);
    const evs = one(`select count(*) from timeline_events where kind='moved' and deal_id in (${ids.join(",")}) and from_stage='Proposal' and to_stage='Qualified' and cause='stage_deleted'`);
    const gone = one(`select count(*) from stages where id=${ps}`);
    await go(linus, `/deals?pipeline=${pid("Sales")}&open=${did("Testfield Health portal")}`); const h = (await historyItems(linus))[0] || "";
    check("US5 scenario 4", before === after && moved === String(ids.length) && evs === String(ids.length) && gone === "0" && /Moved from Proposal to Qualified by Ada Fake \(stage deleted\)/.test(h) && opts.every((o) => o.startsWith("Sales · ") && o !== "Sales · Proposal"),
      `dialog "${dlg.trim().slice(0, 60)}", targets ${JSON.stringify(opts)}; ${ids.length} deals (${archived} archived) moved ${moved}, events ${evs}; deals ${before} → ${after}; stage rows ${gone}; history "${h}"`);
  });

  await run("US5 scenario 5", async () => {
    const before = one("select count(*) from deals"); const p = pid("Exec Dinner"); const n = one(`select count(*) from deals d join stages s on s.id=d.stage_id where s.pipeline_id=${p}`);
    await go(ada, "/admin/pipelines"); await ada.getByRole("link", { name: "Delete Exec Dinner" }).click(); await ada.waitForSelector('select[name="targetStageId"]');
    const opts = await ada.$$eval('select[name="targetStageId"] option', (o) => o.map((x) => x.textContent));
    await ada.selectOption('select[name="targetStageId"]', { label: "Ambassadors · Active" });
    await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ MOVE DEALS AND DELETE ]")]); await ada.waitForTimeout(500);
    const after = one("select count(*) from deals"); const gone = one(`select count(*) from pipelines where id=${p}`); const inA = one(`select count(*) from deals where stage_id=${sid("Ambassadors", "Active")}`);
    // empty pipeline
    await ada.getByRole("textbox", { name: "New pipeline" }).fill("Fake empty pipeline"); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ ADD PIPELINE ]")]); await ada.waitForTimeout(300);
    await ada.getByRole("link", { name: "Delete Fake empty pipeline" }).click(); await ada.waitForSelector('[role="alertdialog"]');
    const conf = (await ada.getByRole("alertdialog").textContent()) || ""; const still = one(`select count(*) from pipelines where name='Fake empty pipeline'`);
    await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ DELETE FOR GOOD ]")]); await ada.waitForTimeout(300);
    const gone2 = one(`select count(*) from pipelines where name='Fake empty pipeline'`);
    check("US5 scenario 5", gone === "0" && before === after && !opts.some((o) => o.startsWith("Exec Dinner")) && opts.length > 0 && conf.includes("Delete Fake empty pipeline? This can't be undone.") && still === "1" && gone2 === "0",
      `Exec Dinner (${n} deals) targets: ${opts.length} stages, none of Exec Dinner; deleted ${gone === "0"}; deals ${before} → ${after}; Ambassadors · Active now ${inA}; empty pipeline confirm "${conf.trim().slice(0, 60)}", kept before confirm ${still}, gone after ${gone2 === "0"}`);
  });

  await run("US5 scenario 6", async () => {
    const b0 = sql("select name from pipelines order by id"); const s0 = sql(`select name from stages where pipeline_id=${pid("Sales")} order by id`);
    await go(ada, "/admin/pipelines"); await ada.getByRole("textbox", { name: "New pipeline" }).fill("  sALES  "); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ ADD PIPELINE ]")]); await ada.waitForTimeout(300);
    const m1 = (await body(ada)).includes("This name is already used.");
    await go(ada, "/admin/pipelines"); await ada.getByRole("textbox", { name: "Name of Ambassadors" }).fill(" sales"); await Promise.all([ada.waitForLoadState("networkidle"), ada.getByRole("button", { name: "Rename Ambassadors" }).click()]); await ada.waitForTimeout(300);
    const m2 = (await body(ada)).includes("This name is already used.");
    await go(ada, `/admin/pipelines/${pid("Sales")}`); await ada.getByRole("textbox", { name: "New stage" }).fill(" LEAD IN "); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ ADD STAGE ]")]); await ada.waitForTimeout(300);
    const m3 = (await body(ada)).includes("This name is already used.");
    await go(ada, `/admin/pipelines/${pid("Sales")}`); await ada.getByRole("textbox", { name: "Name of Closing" }).fill("qualified "); await Promise.all([ada.waitForLoadState("networkidle"), ada.getByRole("button", { name: "Rename Closing" }).click()]); await ada.waitForTimeout(300);
    const m4 = (await body(ada)).includes("This name is already used.");
    // the same stage name in another pipeline is allowed
    const ok = b0 === sql("select name from pipelines order by id") && s0 === sql(`select name from stages where pipeline_id=${pid("Sales")} order by id`);
    check("US5 scenario 6", m1 && m2 && m3 && m4 && ok, `add pipeline "  sALES  " ${m1}, rename to " sales" ${m2}, add stage " LEAD IN " ${m3}, rename stage to "qualified " ${m4}; nothing saved ${ok}`);
  });

  await run("US5 scenario 7", async () => {
    await go(ada, "/admin/pipelines"); const field = await ada.getByRole("button", { name: "[ ADD PIPELINE ]" }).locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    await go(ada, `/admin/pipelines/${pid("Sales")}`); const sfield = await ada.getByRole("button", { name: "Rename Closing" }).locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const p0 = sql("select id||name||position from pipelines order by id"), st0 = sql("select id||name||position from stages order by id");
    await go(linus, "/admin/pipelines"); const b1 = (await body(linus)).includes("You don't have access to this page.");
    await go(linus, `/admin/pipelines/${pid("Sales")}`); const b2 = (await body(linus)).includes("You don't have access to this page.");
    const nav = await linus.locator("nav a", { hasText: "Pipelines" }).count();
    const r1 = await (await linus.request.post(BASE + "/admin/pipelines", { multipart: { [field]: "", name: "Fake hacker pipeline" } })).text();
    const r2 = await (await linus.request.post(BASE + `/admin/pipelines/${pid("Sales")}`, { multipart: { [sfield]: "", id: String(sid("Sales", "Closing")), pipelineId: String(pid("Sales")), name: "Hacked" } })).text();
    const same = p0 === sql("select id||name||position from pipelines order by id") && st0 === sql("select id||name||position from stages order by id");
    const adaNav = await ada.locator("nav a", { hasText: "Pipelines" }).count();
    check("US5 scenario 7", b1 && b2 && nav === 0 && r1.includes("You don&#x27;t have access to this page.") && r2.includes("You don&#x27;t have access to this page.") && same,
      `pages refused ${b1}/${b2}; Linus sidebar Pipelines links ${nav} (Ada ${adaNav}); direct add/rename answers no-access ${r1.includes("have access")}/${r2.includes("have access")}; nothing changed ${same}`);
  });

  await run("Edge case 12", async () => {
    await go(ada, "/admin/pipelines"); await ada.getByRole("textbox", { name: "New pipeline" }).fill("Fake one stage"); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ ADD PIPELINE ]")]);
    const p = pid("Fake one stage"); sql(`insert into stages (pipeline_id, name, position) values (${p}, 'Only', 1)`);
    insertDeal({ title: "Fake lonely deal", pipeline: "Fake one stage", stage: "Only", by: "Ada Fake" });
    await go(ada, `/admin/pipelines/${p}`); await ada.getByRole("link", { name: "Delete Only" }).click(); await ada.waitForSelector('[role="alertdialog"]');
    let b = await body(ada); const btn = await ada.locator("text=[ MOVE DEALS AND DELETE ]").count();
    if (btn) { await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ MOVE DEALS AND DELETE ]")]); b = await body(ada); }
    const still = one(`select count(*) from stages where pipeline_id=${p}`);
    check("Edge case 12", b.includes("A pipeline with deals needs at least one stage.") && still === "1", `message shown ${b.includes("A pipeline with deals needs at least one stage.")}; delete button offered ${btn}; stage still there ${still === "1"}`);
  });

  await run("Edge case 16", async () => {
    const d0 = one("select count(*) from deals"); const id = insertDeal({ title: "Fake person gone", pipeline: "Sales", stage: "Lead in", by: "Linus Fake", person: "Dev Sample" });
    const per = one(`select id from persons where first_name='Dev' and last_name='Sample'`);
    await go(ada, `/people/${per}?confirm=delete`); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ DELETE FOR GOOD ]")]); await ada.waitForTimeout(300);
    const pr = one(`select count(*) from persons where id=${per}`), dr = one(`select '1/'||coalesce(person_id::text,'none') from deals where id=${id}`);
    // stage and pipeline deletes keep every deal
    const p = pid("Fake one stage"); await go(ada, `/admin/pipelines/${p}`); await ada.getByRole("textbox", { name: "New stage" }).fill("Second"); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ ADD STAGE ]")]);
    const c1 = one("select count(*) from deals");
    await ada.getByRole("link", { name: "Delete Only" }).click(); await ada.waitForSelector('select[name="targetStageId"]'); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ MOVE DEALS AND DELETE ]")]);
    await go(ada, "/admin/pipelines"); await ada.getByRole("link", { name: "Delete Fake one stage" }).click(); await ada.waitForSelector('select[name="targetStageId"]');
    await ada.selectOption('select[name="targetStageId"]', { label: "Sales · Lead in" }); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ MOVE DEALS AND DELETE ]")]);
    const c2 = one("select count(*) from deals"); const lone = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.title='Fake lonely deal'`);
    check("Edge case 16", pr === "0" && dr === "1/none" && c1 === c2 && lone === "Lead in" && one(`select count(*) from pipelines where name='Fake one stage'`) === "0",
      `person deleted (${pr} rows), deal kept with no person (${dr}); stage then pipeline delete: deals ${c1} → ${c2}, lonely deal now in ${lone}`);
  });

  // --- US6: private deals (A = Linus, B = Margaret, C = Grace (admin), plus Ada admin) ---
  await run("US6 scenario 1", async () => {
    sql(`delete from deals where title='Fakeco website'`);
    await newDeal(linus, "Sales", { title: "Fakeco website", value: "4000", stage: "Qualified" });
    const id = did("Fakeco website"); await go(linus, `/deals/${id}/edit`); await linus.check('input[name="private"]'); await save(linus);
    const cb = await card(linus, "Fakeco website").locator(".badge").allTextContents(); const db = await drawer(linus).locator("h2 .badge").allTextContents();
    check("US6 scenario 1", cb.includes("Private") && db.includes("Private") && one(`select private from deals where id=${id}`) === "t", `card badge ${JSON.stringify(cb)}, drawer badge ${JSON.stringify(db)} (url ${linus.url()})`);
  });

  await run("US6 scenario 2", async () => {
    const id = did("Fakeco website"); const notes = []; let ok = true;
    for (const [pg, who] of [[marg, "Margaret Fake"], [ada, "Ada Fake"]]) {
      await go(pg, `/deals?pipeline=${pid("Sales")}`); const c = await card(pg, "Fakeco website").count(); const t = await tot(pg, "Qualified");
      const exp = expected("Sales", "Qualified", who); const linusT = expected("Sales", "Qualified", "Linus Fake");
      await go(pg, `/deals?pipeline=${pid("Sales")}&open=${id}`); const dr = await drawer(pg).count(); const h1 = (await pg.textContent("h1")).trim(); const leak = (await body(pg)).includes("Fakeco website");
      const good = c === 0 && t === exp && t !== linusT && dr === 0 && h1 === "Sales" && !leak; if (!good) ok = false;
      notes.push(`${who}: card ${c}, header "${t}" (Linus sees "${linusT}"), drawer by address ${dr}, title in page ${leak}`);
    }
    check("US6 scenario 2", ok, notes.join("; "));
  });

  await run("US6 scenario 3", async () => {
    sql(`delete from deals where title='Fake shared deal'`);
    const id = insertDeal({ title: "Fake shared deal", pipeline: "Sales", stage: "Lead in", by: "Linus Fake", owner: "Margaret Fake", value: 10000 });
    await go(grace, `/deals/${id}/edit`); const offered = await grace.locator('input[name="private"]').count();
    await go(ada, `/deals/${id}/edit`); const offeredAda = await ada.locator('input[name="private"]').count();
    // grab action ids from C's pages while the deal is still public
    await go(grace, `/deals?open=${id}`);
    const fid = async (pg, btn) => pg.getByRole("button", { name: btn }).locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const fMove = await fid(grace, "[ MOVE ]"), fArch = await fid(grace, "[ ARCHIVE ]");
    await go(ada, `/deals?open=${id}&confirm=delete`); const fDel = await fid(ada, "[ DELETE FOR GOOD ]");
    await go(grace, `/deals/${id}/edit`); const formFields = await grace.$$eval('form input[type="hidden"]', (es) => es.map((e) => [e.name, e.value]));
    const v = one(`select version from deals where id=${id}`);
    sql(`update deals set private=true, version=version+1 where id=${id}`); const snap = () => one(`select title||value_pence||stage_id||coalesce(archived_at::text,'-')||version||private from deals where id=${id}`); const s0 = snap();
    const nv = String(Number(v) + 1);
    const editFields = Object.fromEntries(formFields.filter(([n]) => n.startsWith("$ACTION")).map(([n]) => [n, ""]));
    const edit = await grace.request.post(BASE + `/deals/${id}/edit`, { multipart: { ...editFields, id: String(id), version: nv, title: "Hacked", value: "1", pipelineId: String(pid("Sales")), stageId: String(sid("Sales", "Lead in")), organisationId: "", newOrganisationName: "", personId: "", ownerId: String(uid("Margaret Fake")), expectedClose: "" } });
    for (const [pg] of [[grace], [ada]]) {
      await pg.request.post(BASE + "/deals", { multipart: { [fMove]: "", id: String(id), version: nv, pipelineId: String(pid("Sales")), toStageId: String(sid("Sales", "Qualified")) } });
      await pg.request.post(BASE + "/deals", { multipart: { [fArch]: "", id: String(id) } });
    }
    await ada.request.post(BASE + "/deals", { multipart: { [fDel]: "", id: String(id) } });
    const s1 = snap(); const exists = one(`select count(*) from deals where id=${id}`);
    check("US6 scenario 3", offered === 0 && offeredAda === 0 && s0 === s1 && exists === "1", `Private offered to Grace ${offered}, to Ada ${offeredAda}; after the deal became private, replayed edit (status ${edit.status()}), move, archive (Grace and Ada) and delete (Ada): deal unchanged ${s0 === s1}, still exists ${exists}`);
  });

  await run("US6 scenario 4", async () => {
    // Gus Lorem is private to Ada (creator); make Ada his owner too
    sql(`update persons set owner_id=${uid("Ada Fake")} where first_name='Gus' and last_name='Lorem'`);
    // The seed's person for each deal depends on person ids (SF-92 added people): link Gus Lorem here.
    sql(`update deals set person_id=(select id from persons where first_name='Gus' and last_name='Lorem') where title='Lorem Logistics tracking'`);
    const id = did("Lorem Logistics tracking"); const per = one(`select first_name from persons p join deals d on d.person_id=p.id where d.id=${id}`);
    const s = one(`select s.name||'|'||p.name from deals d join stages s on s.id=d.stage_id join pipelines p on p.id=s.pipeline_id where d.id=${id}`).split("|");
    await go(linus, `/deals?pipeline=${pid(s[1])}&open=${id}`);
    const c = (await card(linus, "Lorem Logistics tracking").textContent()).trim(); const d = (await drawer(linus).textContent()) || "";
    await go(ada, `/deals?pipeline=${pid(s[1])}&open=${id}`); const ca = (await card(ada, "Lorem Logistics tracking").textContent()).trim();
    check("US6 scenario 4", per === "Gus" && !c.includes("Gus") && !d.includes("Gus") && d.length > 0 && ca.includes("Gus Lorem"), `Linus card "${c}", drawer mentions Gus ${d.includes("Gus")}; Ada (creator) card "${ca}"`);
  });

  await run("US6 scenario 5", async () => {
    sql(`delete from deals where title='Fakeco website'`);
    await newDeal(linus, "Sales", { title: "Fakeco website", value: "4000", stage: "Qualified", owner: "Margaret Fake", priv: true });
    const id = did("Fakeco website"); const notes = [];
    await go(marg, `/deals?pipeline=${pid("Sales")}`); const badge = await card(marg, "Fakeco website").locator(".badge").allTextContents(); const t = await tot(marg, "Qualified");
    const tOk = t === expected("Sales", "Qualified", "Margaret Fake") && t !== expected("Sales", "Qualified", "Grace Fake");
    await card(marg, "Fakeco website").click(); await marg.waitForURL(/open=/); await marg.waitForLoadState("networkidle"); const dr = await drawer(marg).count();
    await drawer(marg).getByRole("link", { name: "[ EDIT ]" }).click(); await marg.waitForLoadState("networkidle"); await marg.fill('input[name="value"]', "4500"); await save(marg);
    const v = one(`select value_pence from deals where id=${id}`);
    await card(marg, "Fakeco website").dragTo(col(marg, "Negotiation")); await marg.waitForTimeout(1500); const st = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${id}`);
    await go(grace, `/deals?pipeline=${pid("Sales")}`); const gC = await card(grace, "Fakeco website").count(); await go(ada, `/deals?pipeline=${pid("Sales")}`); const aC = await card(ada, "Fakeco website").count();
    await go(marg, `/deals/${id}/edit`); const offered = await marg.locator('input[name="private"]').count(); await marg.uncheck('input[name="private"]'); await save(marg);
    const priv = one(`select private from deals where id=${id}`);
    // archive (on a second private deal so the public one stays for later)
    const id2 = insertDeal({ title: "Fake private for B", pipeline: "Sales", stage: "Lead in", by: "Linus Fake", owner: "Margaret Fake", priv: true });
    await go(marg, `/deals?open=${id2}`); await Promise.all([marg.waitForLoadState("networkidle"), drawer(marg).getByRole("button", { name: "[ ARCHIVE ]" }).click()]);
    const arch = one(`select archived_at is not null from deals where id=${id2}`);
    check("US6 scenario 5", badge.includes("Private") && tOk && dr === 1 && v === "450000" && st === "Negotiation" && gC === 0 && aC === 0 && offered === 1 && priv === "f" && arch === "t",
      `B card badge ${JSON.stringify(badge)}, header "${t}" counts it ${tOk}, drawer ${dr}; edit value → ${v}; drag → ${st}; Grace sees ${gC}, Ada sees ${aC}; Private offered to B ${offered}, unticked → private=${priv}; B archived another private deal ${arch}`);
  });

  await run("US6 scenario 6", async () => {
    const id = did("Fakeco website"); sql(`update deals set private=true, owner_id=${uid("Margaret Fake")}, version=version+1 where id=${id}`);
    await go(marg, `/deals/${id}/edit`); await marg.selectOption('select[name="ownerId"]', { label: "Grace Fake" }); await save(marg);
    const b = await body(marg); const c = await card(marg, "Fakeco website").count(); const url = marg.url();
    await go(linus, `/deals?pipeline=${pid(one(`select p.name from deals d join stages s on s.id=d.stage_id join pipelines p on p.id=s.pipeline_id where d.id=${id}`))}`); const lC = await card(linus, "Fakeco website").count();
    await go(grace, `/deals?pipeline=${pid("Sales")}`); const gC = await card(grace, "Fakeco website").count();
    check("US6 scenario 6", b.includes("You can no longer see Fakeco website: only its creator and owner can.") && c === 0 && !url.includes("/edit") && lC === 1 && gC === 1, `B on ${url}: message ${b.includes("You can no longer see Fakeco website")}, card for B ${c}; A sees ${lC}, C sees ${gC}`);
  });

  await run("Edge case 7", async () => {
    const id = insertDeal({ title: "Fake owner chain", pipeline: "Sales", stage: "Lead in", by: "Linus Fake", owner: "Margaret Fake", priv: true });
    await go(marg, `/deals/${id}/edit`); await marg.selectOption('select[name="ownerId"]', { label: "Grace Fake" }); await save(marg);
    const seen = {}; for (const [pg, n] of [[linus, "A Linus"], [marg, "B Margaret"], [grace, "C Grace"], [ada, "admin Ada"]]) { await go(pg, `/deals?pipeline=${pid("Sales")}`); seen[n] = await card(pg, "Fake owner chain").count(); }
    check("Edge case 7", seen["A Linus"] === 1 && seen["B Margaret"] === 0 && seen["C Grace"] === 1 && seen["admin Ada"] === 0, `who sees the card: ${JSON.stringify(seen)}`);
  });

  await run("Edge case 6", async () => {
    const id = insertDeal({ title: "Fake orphan private", pipeline: "Sales", stage: "Lead in", by: "Linus Fake", owner: "Margaret Fake", priv: true, value: 77700 });
    sql(`update users set status='deactivated' where name='Linus Fake'`);
    await go(marg, `/deals?pipeline=${pid("Sales")}`); const mC = await card(marg, "Fake orphan private").count(); const t = await tot(marg, "Lead in"); const tOk = t === expected("Sales", "Lead in", "Margaret Fake");
    await card(marg, "Fake orphan private").dragTo(col(marg, "Qualified")); await marg.waitForTimeout(1500); const st = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${id}`);
    await go(ada, `/deals?pipeline=${pid("Sales")}`); const aC = await card(ada, "Fake orphan private").count();
    sql(`update users set status='deactivated' where name='Margaret Fake'`);
    const seen = {}; for (const [pg, n] of [[ada, "Ada"], [grace, "Grace"]]) { await go(pg, `/deals?pipeline=${pid("Sales")}`); seen[n] = await card(pg, "Fake orphan private").count(); }
    await go(marg, `/deals?pipeline=${pid("Sales")}`); const mUrl = marg.url();
    const kept = one(`select count(*) from deals where id=${id}`);
    sql(`update users set status='active' where name='Linus Fake'`);
    const l2 = await login(browser, "linus@barnacle.ai"); await go(l2, `/deals?pipeline=${pid("Sales")}`); const back = await card(l2, "Fake orphan private").count(); await l2.context().close();
    sql(`update users set status='active' where name='Margaret Fake'`);
    check("Edge case 6", mC === 1 && tOk && st === "Qualified" && aC === 0 && seen.Ada === 0 && seen.Grace === 0 && kept === "1" && back === 1,
      `creator deactivated: owner sees ${mC}, counts it ${tOk} ("${t}"), drags it → ${st}; admin sees ${aC}. Both deactivated: Ada ${seen.Ada}, Grace ${seen.Grace}, Margaret's session lands on ${mUrl}; row kept ${kept}; creator reactivated sees it ${back}`);
  });

  // --- US1 scenario 5: empty CRM (last: wipes pipelines and deals) ---
  await run("US1 scenario 5", async () => {
    sql("truncate deal_stage_periods, deals, stages, pipelines cascade");
    await go(ada, "/deals"); const a = await body(ada); const link = ada.getByRole("link", { name: "[ ADD PIPELINE ]" }); const href = (await link.count()) ? await link.getAttribute("href") : null;
    const l2 = await login(browser, "linus@barnacle.ai"); await go(l2, "/deals"); const b = await body(l2); const ln = await l2.getByRole("link", { name: "[ ADD PIPELINE ]" }).count(); await l2.context().close();
    check("US1 scenario 5", a.includes("No pipelines yet.") && href === "/admin/pipelines" && b.includes("No pipelines yet.") && ln === 0, `admin: message ${a.includes("No pipelines yet.")}, link ${href}; Linus: message ${b.includes("No pipelines yet.")}, links ${ln}`);
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
})();
