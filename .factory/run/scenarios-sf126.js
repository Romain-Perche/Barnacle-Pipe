// SF-126 double-click scenarios (all 18). App on :3000 (start-app.sh, fresh seed: run reset-db.sh first on re-runs).
// NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf126.js
const { execSync } = require("child_process");
const { chromium, check, signIn } = require("./lib.js");
const B = "http://localhost:3000";
const sql = (q) => execSync(`/usr/lib/postgresql/17/bin/psql -h localhost -U postgres crm_dev -Atc "${q}"`).toString().trim();
(async () => {
  const br = await chromium.launch();
  const page = await (await br.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await signIn(page, B, "ada@barnacle.ai", "Ada Fake");
  const wait = (ms = 1200) => page.waitForTimeout(ms);
  const body = async () => ((await page.locator("body").innerText()) || "").replace(/\s+/g, " ");
  const path = () => new URL(page.url()).pathname + new URL(page.url()).search;

  // US1-1: rename a card to "Fake Deal A" and double-click it
  const salesId = sql("select id from pipelines where name='Sales'");
  const aId = sql(`select d.id from deals d join stages s on s.id=d.stage_id where s.pipeline_id=${salesId} and d.archived_at is null and d.status='open' and not d.private order by d.id limit 1`);
  sql(`update deals set title='Fake Deal A' where id=${aId}`);
  await page.goto(B + `/deals?pipeline=${salesId}`); await wait();
  const cardA = page.locator(`a.card[data-page='/deals/${aId}']`);
  await cardA.dblclick(); await wait(2500);
  check("US1 scenario 1", path() === `/deals/${aId}` && (await page.locator("h1").innerText()).includes("Fake Deal A"), `${path()} h1=${await page.locator("h1").innerText().catch(() => "")}`);
  check("Edge case 3 (board)", !path().includes("open="), path());

  // US1-2 single click
  await page.goto(B + `/deals?pipeline=${salesId}`); await wait();
  await cardA.click(); await wait(2500);
  const drawer = await page.locator("aside.drawer").first().innerText().catch(() => "");
  check("US1 scenario 2", path().startsWith("/deals?") && path().includes(`open=${aId}`) && drawer.includes("Fake Deal A"), `${path()} drawer has title=${drawer.includes("Fake Deal A")}`);

  // US1-3 drag to another stage
  await page.goto(B + `/deals?pipeline=${salesId}`); await wait();
  const before = sql(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${aId}`);
  const target = before === "Closing" ? "Lead in" : "Closing";
  const col = page.locator("section", { has: page.locator("header", { hasText: target }) }).last();
  await cardA.dragTo(col.locator(".cards")); await wait(3000);
  const after = sql(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${aId}`);
  check("US1 scenario 3", after === target && path().startsWith("/deals?") && !/^\/deals\/\d+/.test(new URL(page.url()).pathname), `stage ${before} -> ${after}; url ${path()}`);

  // Edge 7: header and "+" on board
  await page.goto(B + `/deals?pipeline=${salesId}`); await wait();
  const u0 = path();
  await page.locator(".cards").first().locator("xpath=..").locator("header").first().dblclick(); await wait(1500);
  const afterHdr = path();
  const plus = page.locator("header a").first();
  const plusTxt = await plus.innerText().catch(() => "");
  await plus.dblclick(); await wait(2000);
  const afterPlus = path();
  check("Edge case 7", !/^\/deals\/\d+$/.test(new URL(afterHdr, B).pathname) && !/^\/deals\/\d+$/.test(new URL(afterPlus, B).pathname), `header → ${afterHdr}; plus(${plusTxt}) → ${afterPlus}`);

  // US2-1 deal list: value / owner / date cells
  const listUrl = "/deals/list?sort=value&dir=desc&page=2";
  await page.goto(B + listUrl); await wait();
  const lu = path();
  const heads = await page.locator("thead th").allInnerTexts();
  const row = page.locator("tbody tr").nth(1); const dp = await row.getAttribute("data-page");
  const valIdx = heads.findIndex((h) => /value/i.test(h));
  await row.locator("td").nth(valIdx).dblclick(); await wait(2500);
  const r1 = path();
  await page.goBack(); await wait(2000);
  const back = path();
  const ownIdx = heads.findIndex((h) => /owner/i.test(h));
  await page.locator("tbody tr").nth(2).locator("td").nth(ownIdx).dblclick(); await wait(2500);
  const dp3 = await (async () => { await page.goBack(); await wait(1500); return page.locator("tbody tr").nth(2).getAttribute("data-page"); })();
  check("US2 scenario 1", r1 === dp, `value cell → ${r1} exp ${dp}; owner cell row data-page ${dp3}; heads ${heads.join("|")}`);
  check("US2 scenario 3", back === lu && lu.includes("page=2") && lu.includes("sort=value"), `before ${lu} back ${back}`);
  await page.goto(B + "/deals/list"); await wait();
  const r2 = page.locator("tbody tr").nth(0); const dp2 = await r2.getAttribute("data-page");
  await r2.locator("td").nth(valIdx).click(); await wait(2000);
  check("US2 scenario 2", path().startsWith("/deals/list") && path().includes("open=" + dp2.split("/")[2]) && (await page.locator("tbody tr").nth(0).getAttribute("aria-selected")) === "true", path());

  // US3 people: role, owner, labels, custom field cells
  await page.goto(B + "/people"); await wait();
  const ph = await page.locator("thead th").allInnerTexts();
  const out3 = [];
  let ok3 = true;
  for (const want of [/role/i, /owner/i, /label/i, /diet/i]) {
    await page.goto(B + "/people"); await wait();
    const idx = ph.findIndex((h) => want.test(h));
    const r = page.locator("tbody tr").nth(3); const d = await r.getAttribute("data-page");
    if (idx < 0) { ok3 = false; out3.push(`${want} col missing`); continue; }
    await r.locator("td").nth(idx).dblclick({ position: { x: 3, y: 3 } }); await wait(2500);
    out3.push(`${want}: ${path()} exp ${d}`); if (path() !== d) ok3 = false;
  }
  check("US3 scenario 1", ok3, out3.join("; "));
  await page.goto(B + "/people"); await wait();
  const pr = page.locator("tbody tr").nth(3); const pd = await pr.getAttribute("data-page");
  await pr.locator("td").nth(ph.findIndex((h) => /role/i.test(h))).click(); await wait(2000);
  check("US3 scenario 2", path().startsWith("/people?") && path().includes("open=" + pd.split("/")[2]) && (await page.locator("aside.drawer").count()) > 0, path());

  // US4 organisations
  await page.goto(B + "/organisations"); await wait();
  const oh = await page.locator("thead th").allInnerTexts();
  const orow = page.locator("tbody tr").nth(1); const od = await orow.getAttribute("data-page");
  const on = await orow.locator("td").count();
  await orow.locator("td").nth(on - 1).dblclick(); await wait(2500);
  check("US4 scenario 1", path() === od, `last cell (${oh[on - 1]}) → ${path()} exp ${od}`);
  await page.goto(B + "/organisations"); await wait();
  await page.locator("tbody tr").nth(1).locator("td").nth(on - 1).click(); await wait(2000);
  check("US4 scenario 2", path().startsWith("/organisations?") && path().includes("open=" + od.split("/")[2]), path());

  // Edge 1: name link
  const e1 = [];
  for (const p of ["/deals/list", "/people", "/organisations"]) {
    await page.goto(B + p); await wait();
    const r = page.locator("tbody tr").nth(2); const d = await r.getAttribute("data-page");
    await r.locator("a.nm").first().dblclick(); await wait(2500);
    e1.push([p, path(), d]);
  }
  check("Edge case 1", e1.every(([, u, d]) => u === d), JSON.stringify(e1));

  // Edge 2: linked org / person inside rows (cards have no links: org/person on a card are plain text)
  const e2 = [];
  for (const [p, sel] of [["/people", "tbody tr a[href^='/organisations/']:not(.cell-link)"], ["/deals/list", "tbody tr a[href^='/organisations/']:not(.cell-link)"], ["/deals/list", "tbody tr a[href^='/people/']:not(.cell-link)"]]) {
    await page.goto(B + p); await wait();
    const l = page.locator(sel).first(); const h = await l.getAttribute("href");
    const rd = await l.locator("xpath=ancestor::tr").getAttribute("data-page");
    await l.dblclick(); await wait(2500);
    e2.push([p, h, rd, path()]);
  }
  check("Edge case 2", e2.every(([, h, , u]) => u === h), JSON.stringify(e2));

  // Edge 3 for lists: no drawer after double-click
  await page.goto(B + "/people"); await wait();
  const e3r = page.locator("tbody tr").nth(5); const e3d = await e3r.getAttribute("data-page");
  await e3r.locator("td").nth(ph.findIndex((h) => /owner/i.test(h))).dblclick(); await wait(3000);
  check("Edge case 3", path() === e3d && !path().includes("open="), `${path()} (board: see first check)`);

  // Edge 4: deal made private by someone else, person made private, org deleted, after the list loaded
  const e4 = [];
  await page.goto(B + "/deals/list"); await wait();
  const dr = page.locator("tbody tr").nth(3); const ddp = await dr.getAttribute("data-page"); const did = ddp.split("/")[2];
  const dtitle = sql(`select title from deals where id=${did}`);
  sql(`update deals set private=true, created_by=2, owner_id=2 where id=${did}`);
  await dr.locator("td").nth(valIdx).dblclick(); await wait(2500);
  const dbody = await body();
  await page.goto(B + ddp); await wait(); const ddirect = await body();
  e4.push(["deal", path(), dbody.includes(dtitle), dbody.includes("[ DEAL LIST ]"), dbody === ddirect]);
  await page.goto(B + "/people"); await wait();
  const prr = page.locator("tbody tr").nth(6); const ppd = await prr.getAttribute("data-page"); const pid = ppd.split("/")[2];
  const pname = sql(`select first_name||' '||last_name from persons where id=${pid}`);
  sql(`update persons set private=true, created_by=2, owner_id=2 where id=${pid}`);
  await prr.locator("td").nth(ph.findIndex((h) => /owner/i.test(h))).dblclick(); await wait(2500);
  const pbody = await body(); const purl = path();
  await page.goto(B + ppd); await wait(); const pdirect = await body();
  e4.push(["person", purl, pbody.includes(pname), pbody.slice(0, 0), pbody === pdirect]);
  const oid = sql("insert into organisations(name, created_by, owner_id) values ('Gone Fakeorg', 1, 1) returning id").split("\n")[0];
  await page.goto(B + "/organisations?q=Gone"); await wait();
  const orr = page.locator(`tbody tr[data-page='/organisations/${oid}']`);
  sql(`delete from organisations where id=${oid}`);
  await orr.locator("td").last().dblclick(); await wait(2500);
  const obody = await body(); const ourl = path();
  await page.goto(B + `/organisations/${oid}`); await wait(); const odirect = await body();
  e4.push(["org", ourl, obody.includes("Gone Fakeorg"), "", obody === odirect]);
  check("Edge case 4", e4[0][1] === ddp && !e4[0][2] && e4[0][3] && e4[0][4] && !e4[1][2] && e4[1][4] && !e4[2][2] && e4[2][4], JSON.stringify(e4) + " | deal page: " + dbody.slice(dbody.indexOf("DEAL") - 80, dbody.indexOf("DEAL") + 80));

  // Edge 5: archived rows
  const e5 = [];
  for (const [p, name] of [["/people?archived=1&q=Fay", "Fay Mockup"], ["/deals/list?archived=1", "Old fake opportunity"], ["/organisations?archived=1&q=Old", "Old Fakeco Archive"]]) {
    await page.goto(B + p); await wait();
    const r = page.locator("tbody tr", { hasText: name }).first(); const d = await r.getAttribute("data-page");
    const tagged = /archived/i.test(await r.innerText());
    const n = await r.locator("td").count();
    await r.locator("td").nth(n - 1).dblclick(); await wait(2500);
    e5.push([name, tagged, path() === d, /archived/i.test(await body())]);
  }
  check("Edge case 5", e5.every((x) => x[1] && x[2] && x[3]), JSON.stringify(e5));

  // Edge 6: keyboard — focusable elements in a row, Enter on name / Preview
  await page.goto(B + "/people"); await wait();
  const kr = page.locator("tbody tr").nth(2); const kd = await kr.getAttribute("data-page");
  const focusables = await kr.evaluate((tr) => [...tr.querySelectorAll("a,button,input,[tabindex]")].filter((e) => e.tabIndex >= 0).map((e) => (e.getAttribute("aria-label") || e.textContent.trim()) + "→" + e.getAttribute("href")));
  const trTab = await kr.evaluate((tr) => tr.getAttribute("tabindex"));
  await kr.locator("a.nm").focus(); await page.keyboard.press("Enter"); await wait(2500);
  const enterName = path();
  await page.goto(B + "/people"); await wait();
  const prev = page.locator("tbody tr").nth(2).locator("a.cell-link").first();
  const prevCount = await prev.count();
  if (prevCount) { await prev.focus(); await page.keyboard.press("Enter"); await wait(2500); }
  const enterPrev = path();
  check("Edge case 6", enterName === kd && enterPrev.includes("open=" + kd.split("/")[2]) && trTab === null && prevCount === 1, `focusables ${JSON.stringify(focusables)}; tr tabindex ${trTab}; Enter name → ${enterName}; Enter Preview → ${enterPrev}`);

  // Edge 8: text selection
  await page.goto(B + "/people"); await wait();
  const sr = page.locator("tbody tr").nth(4); const sd = await sr.getAttribute("data-page");
  const roleCell = sr.locator("td").nth(ph.findIndex((h) => /role/i.test(h)));
  const roleText = (await roleCell.innerText()).trim();
  const span = roleCell.locator("span, div").first();
  const tgt = (await span.count()) ? span : roleCell;
  let selected = "";
  await page.evaluate(() => document.addEventListener("dblclick", () => { window.__sel = String(getSelection()); }, { capture: true }));
  await tgt.dblclick(); await wait(2500);
  selected = await page.evaluate(() => window.__sel).catch(() => "?");
  check("Edge case 8", path() === sd, `role "${roleText}" selection at dblclick "${selected}" → ${path()} exp ${sd}`);

  await br.close();
})().catch((e) => { console.error(e); process.exit(1); });
