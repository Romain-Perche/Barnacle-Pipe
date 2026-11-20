// SF-97 (hand-over of private deals) AI-review scenario script: US1 1–6, US2 1–3, edge cases 1–13.
// App on :3000 / crm_dev (bash .factory/run/start-app.sh). The script resets the data itself between phases
// (reset-db.sh), so just run: NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf97.js
// Phases: A = US1 + edges 1,4,5,8–11,13(created part); B = edge 3; C = US2-1/2 + edges 2,12,13(not-created part);
// D = US2-3; E = edges 6,7. Setup by SQL (deactivated owners cannot be chosen in forms).
const { execFileSync } = require("child_process");
const { chromium, results, check, signIn } = require("./lib");
const BASE = "http://localhost:3000";
const sql = (q) => execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", "crm_dev", "-Atqc", q]).toString().trim();
const one = (q) => sql(q).split("\n")[0];
const reset = () => execFileSync("bash", [".factory/run/reset-db.sh"], { stdio: "ignore" });
const uid = (n) => Number(one(`select id from users where name='${n}'`));
const did = (t) => Number(one(`select id from deals where title='${t}' order by id desc limit 1`));
const sales = () => Number(one(`select id from pipelines where name='Sales'`));
const NAMES = { "ada@barnacle.ai": "Ada Fake", "grace@barnacle.ai": "Grace Fake", "linus@barnacle.ai": "Linus Fake", "margaret@barnacle.ai": "Margaret Fake", "alan@barnacle.ai": "Alan Fake" };
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const go = async (p, path) => { const r = await p.goto(BASE + path); await p.waitForLoadState("networkidle"); return r; };
const col = (p, stage) => p.getByRole("region", { name: stage, exact: true });
const tot = async (p, stage) => norm(await col(p, stage).locator(".tot").textContent());
const titles = async (p, stage) => col(p, stage).locator("a.card .t").evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
const card = (p, t) => p.locator("a.card").filter({ has: p.locator(".t", { hasText: t }) });
const drawer = (p) => p.getByRole("complementary", { name: "Deal" });
const field = async (p, k) => norm(await drawer(p).locator("dt", { hasText: k }).locator("xpath=following-sibling::dd[1]").textContent());
const hist = async (p) => (await drawer(p).getByRole("region", { name: "Timeline" }).getByRole("listitem").allTextContents()).map(norm);
const row = async (p) => norm(await p.locator("tr", { hasText: "alan@barnacle.ai" }).first().textContent());
const hasBtn = async (p) => (await p.locator("tr", { hasText: "alan@barnacle.ai" }).getByRole("link", { name: "[ HAND OVER ]" }).count()) > 0;
const status = async (p) => norm(await p.getByRole("main").getByRole("status").first().textContent().catch(() => ""));
let browser;
async function login(email) { const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 } }); const p = await ctx.newPage(); await signIn(p, BASE, email, NAMES[email]); return p; }
async function openPanel(p) { await go(p, "/admin/users"); await Promise.all([p.waitForURL(/handover=/), p.locator("tr", { hasText: "alan@barnacle.ai" }).getByRole("link", { name: "[ HAND OVER ]" }).click()]); await p.waitForLoadState("networkidle"); }
async function choose(p, name) { await p.locator("form.handover select").selectOption({ label: name }); }
async function confirm(p) { await Promise.all([p.waitForLoadState("networkidle"), p.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click()]); await p.waitForTimeout(600); await p.waitForLoadState("networkidle"); }
async function board(p) { await go(p, `/deals?pipeline=${sales()}`); }
async function openDeal(p, id) { await go(p, `/deals?pipeline=${sales()}&open=${id}`); }
async function run(name, fn) { try { await fn(); } catch (e) { check(name, false, "error: " + String(e.message).split("\n")[0]); } }
function insertDeal(title, by, owner, priv, person = "null") {
  const st = one(`select s.id from stages s join pipelines p on p.id=s.pipeline_id where p.name='Sales' and s.name='Lead in'`);
  const id = one(`insert into deals (title, value_pence, stage_id, owner_id, private, created_by, person_id) values ('${title}', 50000, ${st}, ${uid(owner)}, ${priv}, ${uid(by)}, ${person}) returning id`);
  sql(`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name) values (${id}, ${st}, 'Lead in', 'Sales'); insert into timeline_events (deal_id, kind, actor_id) values (${id}, 'added', ${uid(by)})`);
  return Number(id);
}
const dropDeal = (t) => sql(`delete from timeline_events where deal_id in (select id from deals where title='${t}'); delete from deal_stage_periods where deal_id in (select id from deals where title='${t}'); delete from deals where title='${t}'`);
const unprivatePeople = () => sql(`update persons set private=false where owner_id=${uid("Alan Fake")}`);

(async () => {
  browser = await chromium.launch();
  // ---------- Phase A ----------
  reset();
  dropDeal("Fake leaver old deal");
  const deal = did("Fake leaver deal");
  sql(`update deals set value_pence=777700, organisation_id=(select id from organisations where name='Fakeco Ltd'), person_id=(select id from persons where first_name='Cleo' limit 1), expected_close_on='2027-03-15' where id=${deal};
       update timeline_events set actor_id=${uid("Alan Fake")} where deal_id=${deal} and kind='added'`);
  const e1 = insertDeal("SF97 E1 deal", "Alan Fake", "Linus Fake", true);
  const e4 = insertDeal("SF97 E4 shared", "Alan Fake", "Alan Fake", false);
  const ada = await login("ada@barnacle.ai"), grace = await login("grace@barnacle.ai"), linus = await login("linus@barnacle.ai"), marg = await login("margaret@barnacle.ai");
  // before: what Alan sees as creator / owner, the drawer facts and position
  const factsSql = () => one(`select stage_id||'/'||value_pence||'/'||coalesce(organisation_id,0)||'/'||coalesce(person_id,0)||'/'||expected_close_on||'/'||stage_entered_at||'/'||created_by||'/'||private from deals where id=${deal}`);
  const factsBefore = factsSql();
  const allLeadOrder = () => sql(`select d.title from deals d join stages s on s.id=d.stage_id join pipelines p on p.id=s.pipeline_id where p.name='Sales' and s.name='Lead in' and d.archived_at is null order by d.stage_entered_at desc, d.id desc`).split("\n");
  const orderBefore = allLeadOrder();

  await run("US1 scenario 1", async () => {
    await go(ada, "/admin/users"); const r = await row(ada); const main = await ada.innerText("main");
    const leak = ["Leftfake", "Fake leaver", "7,777", "Fakeco", "Cleo", "Lead in"].filter((s) => main.includes(s));
    check("US1 scenario 1", r.includes("2 private people · 1 private deal") && (await hasBtn(ada)) && leak.length === 0, `row "${r}", button ${await hasBtn(ada)}, leaked ${JSON.stringify(leak)}`);
  });
  await run("Edge case 1", async () => { check("Edge case 1 (count)", (await row(ada)).includes("1 private deal"), `row "${await row(ada)}" (E1 deal created by Alan owned by Linus not counted)`); });
  await run("Edge case 4", async () => { check("Edge case 4 (count)", (await row(ada)).includes("1 private deal"), `shared deal owned by Alan not counted`); });
  await run("US1 scenario 2", async () => {
    await openPanel(ada); await choose(ada, "Margaret Fake"); const q = norm(await ada.locator("form.handover .q").textContent()); const h = norm(await ada.locator("form.handover .hint").textContent());
    const main = await ada.innerText("main");
    check("US1 scenario 2", q === "Hand Alan Fake's 2 private people and 1 private deal to Margaret Fake?" && h === "They stay private. Margaret Fake becomes their owner and can see them. You will not see what they are." && !main.includes("Fake leaver"), `q="${q}" hint="${h}"`);
  });
  await run("Edge case 8", async () => {
    await Promise.all([ada.waitForURL(/\/admin\/users$/), ada.locator("form.handover").getByRole("link", { name: "[ CANCEL ]" }).click()]); await ada.waitForLoadState("networkidle");
    const panel = await ada.locator("form.handover").count(); const r = await row(ada);
    check("Edge case 8", panel === 0 && r.includes("2 private people · 1 private deal") && (await hasBtn(ada)) && one(`select owner_id from deals where id=${deal}`) == uid("Alan Fake"),
      `panel closed ${panel === 0}, row "${r}", owner in DB still Alan (creator is Alan, deactivated, cannot sign in)`);
  });
  await run("Edge case 9", async () => {
    await openPanel(ada); await confirm(ada); const t1 = norm(await ada.locator("form.handover").textContent()); const r1 = await row(ada);
    await openPanel(ada); await choose(ada, "Margaret Fake"); sql(`update users set status='deactivated' where name='Margaret Fake'`); await confirm(ada);
    const t2 = norm(await ada.locator("form.handover").textContent().catch(() => "")); const r2 = await row(ada); sql(`update users set status='active' where name='Margaret Fake'`);
    check("Edge case 9", t1.includes("Choose an active user.") && t2.includes("Choose an active user.") && r1.includes("2 private people · 1 private deal") && r2.includes("2 private people · 1 private deal"), `no choice: "${t1.slice(0, 80)}"; Margaret deactivated: "${t2.slice(0, 80)}"; rows "${r1}" / "${r2}"`);
  });
  await run("Edge case 10/11", async () => {
    await openPanel(ada); await go(ada, ada.url().replace(BASE, "")); const f = await ada.locator('form.handover input[name^="$ACTION_ID_"]').getAttribute("name");
    const post = async (p, userId, to) => { const res = await p.request.post(BASE + "/admin/users", { multipart: { [f]: "", userId: String(userId), toUserId: String(to) } }); return (await res.text()).replace(/&#x27;/g, "'"); };
    const b10 = await post(linus, uid("Alan Fake"), uid("Linus Fake"));
    await go(ada, "/admin/users"); const r10 = await row(ada);
    check("Edge case 10", b10.includes("You don't have access to this page.") && r10.includes("2 private people · 1 private deal") && one(`select owner_id from deals where id=${deal}`) == uid("Alan Fake"), `Linus post forbidden ${b10.includes("You don't have access to this page.")}, row "${r10}"`);
    const linusDeal = insertDeal("SF97 linus private", "Linus Fake", "Linus Fake", true);
    const b11 = await post(ada, uid("Linus Fake"), uid("Margaret Fake"));
    check("Edge case 11", b11.includes("Only a deactivated user's private records can be handed over.") && one(`select owner_id from deals where id=${linusDeal}`) == uid("Linus Fake") && one(`select count(*) from timeline_events where kind='handed_over'`) === "0", `message shown ${b11.includes("Only a deactivated user's private records can be handed over.")}, Linus's private deal owner ${one(`select owner_id from deals where id=${linusDeal}`)}`);
    dropDeal("SF97 linus private");
  });
  await run("US1 scenario 3 / Edge case 5", async () => {
    await openPanel(ada); await choose(ada, "Margaret Fake");
    await openPanel(grace); await choose(grace, "Margaret Fake"); await confirm(grace);
    const st = await status(grace); const r = await row(grace); const btn = await hasBtn(grace);
    check("US1 scenario 3", st === "2 private people and 1 private deal handed to Margaret Fake." && !/private/.test(r) && !btn, `status "${st}", row "${r}", button ${btn}`);
    await confirm(ada); const st2 = await status(ada); const r2 = await row(ada);
    check("Edge case 5", st2 === "Alan Fake has no private people or deals to hand over." && !/private/.test(r2), `second admin: "${st2}", row "${r2}"`);
  });
  await run("US1 scenario 4", async () => {
    await board(marg); const c = card(marg, "Fake leaver deal"); const badge = (await c.locator(".badge").allTextContents()).map(norm);
    const want = one(`select count(*)||'/'||sum(value_pence) from deals d join stages s on s.id=d.stage_id join pipelines p on p.id=s.pipeline_id where p.name='Sales' and s.name='Lead in' and archived_at is null and (not private or created_by=${uid("Margaret Fake")} or owner_id=${uid("Margaret Fake")})`);
    const t = await tot(marg, "Lead in");
    await openDeal(marg, deal); const owner = await field(marg, "Owner"); const h = await hist(marg);
    const ho = h.find((x) => x.startsWith("Handed to Margaret Fake by Grace Fake")) || "";
    const creatorShown = h.some((x) => x.startsWith("Added by Alan Fake")) && one(`select created_by from deals where id=${deal}`) == uid("Alan Fake");
    // manage: edit title, untick private, move, archive
    await go(marg, `/deals/${deal}/edit`); await marg.fill('input[name="title"]', "Fake leaver deal edited"); await marg.uncheck('input[name="private"]');
    await Promise.all([marg.waitForLoadState("networkidle"), marg.click("text=[ SAVE ]")]); await marg.waitForTimeout(500);
    const after = one(`select title||'/'||private||'/'||owner_id from deals where id=${deal}`);
    sql(`update deals set title='Fake leaver deal', private=true where id=${deal}`); // restore for later scenarios (also moved below on a copy)
    check("US1 scenario 4", badge.includes("Private") && t.startsWith(want.split("/")[0] + " deal") && owner === "Margaret Fake" && /\d/.test(ho) && creatorShown && after === `Fake leaver deal edited/false/${uid("Margaret Fake")}`,
      `card badge ${JSON.stringify(badge)}, column "${t}" (expected ${want}), owner "${owner}", history ${JSON.stringify(h)}, edit+untick private -> ${after}`);
  });
  await run("US1 scenario 5", async () => {
    const res = [];
    for (const [p, who] of [[linus, "Linus Fake"], [grace, "Grace Fake"]]) {
      await board(p); const n = await card(p, "Fake leaver deal").count(); const t = await tot(p, "Lead in");
      const want = one(`select count(*) from deals d join stages s on s.id=d.stage_id join pipelines p on p.id=s.pipeline_id where p.name='Sales' and s.name='Lead in' and archived_at is null and (not private or created_by=${uid(who)} or owner_id=${uid(who)})`);
      const leak = (await p.innerText("body")).includes("Fake leaver"); res.push({ who, n, t, want, leak });
    }
    check("US1 scenario 5", res.every((r) => r.n === 0 && !r.leak && r.t.startsWith(r.want + " deal")), JSON.stringify(res));
  });
  await run("US1 scenario 6", async () => {
    const after = factsSql(); const orderAfter = allLeadOrder();
    await board(marg); const ui = await titles(marg, "Lead in"); const expectUi = orderBefore.filter((t) => !["SF97 E1 deal"].includes(t));
    await openDeal(marg, deal); const facts = ["Pipeline · Stage", "Value", "Organisation", "Person", "Expected close"]; const shown = []; for (const k of facts) shown.push(`${k}=${await field(marg, k)}`);
    check("US1 scenario 6", after === factsBefore && JSON.stringify(orderAfter) === JSON.stringify(orderBefore) && JSON.stringify(ui) === JSON.stringify(expectUi), `DB facts before ${factsBefore} after ${after}; Margaret drawer ${shown.join("; ")}; column order same ${JSON.stringify(ui) === JSON.stringify(expectUi)} (${ui.join(", ")})`);
  });
  await run("Edge case 1", async () => {
    await board(linus); const n = await card(linus, "SF97 E1 deal").count(); await openDeal(linus, e1); const o = await field(linus, "Owner");
    check("Edge case 1", n === 1 && o === "Linus Fake" && one(`select owner_id from deals where id=${e1}`) == uid("Linus Fake"), `B=Linus board card ${n}, owner "${o}"; Alan row did not count it (see count check)`);
  });
  await run("Edge case 4", async () => {
    const seen = []; for (const p of [ada, grace, linus, marg]) { await board(p); seen.push(await card(p, "SF97 E4 shared").count()); }
    await openDeal(linus, e4); const o = await field(linus, "Owner");
    check("Edge case 4", seen.every((n) => n === 1) && o === "Alan Fake (deactivated)", `cards seen by 4 users ${JSON.stringify(seen)}, owner "${o}"`);
  });
  await run("US1 scenario 4 (move/archive)", async () => {
    await openDeal(marg, deal); await drawer(marg).locator('select[name="toStageId"]').selectOption({ label: "Sales · Qualified" });
    await Promise.all([marg.waitForLoadState("networkidle"), drawer(marg).getByRole("button", { name: "[ MOVE ]" }).click()]); await marg.waitForTimeout(500);
    const st = one(`select s.name from deals d join stages s on s.id=d.stage_id where d.id=${deal}`);
    await openDeal(marg, deal); await Promise.all([marg.waitForLoadState("networkidle"), drawer(marg).getByRole("button", { name: "[ ARCHIVE ]" }).click()]); await marg.waitForTimeout(500);
    const ar = one(`select archived_at is not null from deals where id=${deal}`);
    check("US1 scenario 4 (move/archive)", st === "Qualified" && ar === "t", `moved to ${st}, archived ${ar}`);
    sql(`update deals set archived_at=null where id=${deal}`);
  });
  await run("Edge case 13 (created)", async () => {
    sql(`update users set status='active' where name='Alan Fake'`); const alan = await login("alan@barnacle.ai");
    await go(alan, `/deals?pipeline=${sales()}`); const qual = await card(alan, "Fake leaver deal").count(); await openDeal(alan, deal); const o = await field(alan, "Owner");
    check("Edge case 13 (created part)", qual === 1 && o === "Margaret Fake", `Alan reactivated: own created deal on board ${qual}, owner "${o}"`);
  });

  // ---------- Phase B: edge 3 ----------
  reset(); unprivatePeople();
  await run("Edge case 3", async () => {
    const a = await login("ada@barnacle.ai"), m = await login("margaret@barnacle.ai");
    await go(a, "/admin/users"); const r0 = await row(a);
    await openPanel(a); await choose(a, "Margaret Fake"); await confirm(a); const st = await status(a); const r1 = await row(a);
    await board(m); const open = await card(m, "Fake leaver deal").count(); const old = await card(m, "Fake leaver old deal").count();
    const owners = sql(`select owner_id from deals where title like 'Fake leaver%'`).split("\n");
    check("Edge case 3", r0.includes("2 private deals") && !r0.includes("people") && st === "2 private deals handed to Margaret Fake." && !/private/.test(r1) && open === 1 && old === 0 && owners.every((o) => o == uid("Margaret Fake")),
      `row before "${r0}", status "${st}", row after "${r1}", Margaret board open ${open} archived ${old}, owners ${owners}`);
  });

  // ---------- Phase C: US2-1/2, edges 2, 12, 13 ----------
  reset(); unprivatePeople(); dropDeal("Fake leaver deal"); dropDeal("Fake leaver old deal");
  const pat = one(`select id from persons where first_name='Pat' and last_name='Privatefake'`);
  const e2 = insertDeal("SF97 E2 deal", "Ada Fake", "Alan Fake", true, pat);
  {
    const a = await login("ada@barnacle.ai"), m = await login("margaret@barnacle.ai"), g = await login("grace@barnacle.ai");
    await run("US2 scenario 1", async () => { await go(g, "/admin/users"); const r = await row(g); check("US2 scenario 1", /Deactivated\s*1 private deal/.test(r) && !r.includes("people") && !r.includes("person") && (await hasBtn(g)), `row "${r}", button ${await hasBtn(g)}`); });
    await run("Edge case 2", async () => { check("Edge case 2 (count)", (await row(g)).includes("1 private deal"), `row "${await row(g)}"`); });
    await run("US2 scenario 2", async () => {
      await openPanel(g); await choose(g, "Margaret Fake"); const q = norm(await g.locator("form.handover .q").textContent()); await confirm(g); const st = await status(g);
      check("US2 scenario 2", q === "Hand Alan Fake's 1 private deal to Margaret Fake?" && st === "1 private deal handed to Margaret Fake.", `q "${q}", status "${st}"`);
    });
    await run("Edge case 2", async () => {
      await board(a); const ca = await card(a, "SF97 E2 deal").count(); await board(m); const cm = await card(m, "SF97 E2 deal").count(); await openDeal(m, e2); const o = await field(m, "Owner");
      check("Edge case 2", ca === 1 && cm === 1 && o === "Margaret Fake", `creator Ada's board ${ca}, Margaret's ${cm}, owner "${o}"`);
    });
    await run("Edge case 12", async () => { await openDeal(m, e2); const p = await field(m, "Person"); await openDeal(a, e2); const pa = await field(a, "Person"); check("Edge case 12", (p === "" || p === "—") && pa.includes("Pat"), `Margaret drawer Person "${p}" (Ada, who sees Pat: "${pa}")`); });
    await run("Edge case 13 (not created)", async () => {
      sql(`update users set status='active' where name='Alan Fake'`); const al = await login("alan@barnacle.ai"); await board(al); const n = await card(al, "SF97 E2 deal").count(); await openDeal(al, e2); const dr = await drawer(al).count();
      check("Edge case 13 (not-created part)", n === 0 && dr === 0, `Alan reactivated: deal owned not created on board ${n}, drawer by address ${dr}`);
    });
  }

  // ---------- Phase D: US2-3 ----------
  reset(); dropDeal("Fake leaver deal"); dropDeal("Fake leaver old deal");
  await run("US2 scenario 3", async () => {
    const a = await login("ada@barnacle.ai"); await go(a, "/admin/users"); const r = await row(a);
    await openPanel(a); await choose(a, "Margaret Fake"); const q = norm(await a.locator("form.handover .q").textContent()); const h = norm(await a.locator("form.handover .hint").textContent()); await confirm(a); const st = await status(a);
    check("US2 scenario 3", r.includes("Deactivated2 private peopleNever") && !r.includes("deal") && q === "Hand Alan Fake's 2 private people to Margaret Fake?" && st === "2 private people handed to Margaret Fake.", `row "${r}", q "${q}", hint "${h}", status "${st}"`);
  });

  // ---------- Phase E: edges 6, 7 ----------
  reset(); unprivatePeople(); dropDeal("Fake leaver deal"); dropDeal("Fake leaver old deal");
  const e6 = insertDeal("SF97 E6 deal", "Ada Fake", "Alan Fake", true);
  {
    const a = await login("ada@barnacle.ai"), g = await login("grace@barnacle.ai");
    await run("Edge case 6", async () => {
      await openPanel(g); await choose(g, "Margaret Fake");
      await go(a, `/deals/${e6}/edit`); await a.uncheck('input[name="private"]'); await Promise.all([a.waitForLoadState("networkidle"), a.click("text=[ SAVE ]")]); await a.waitForTimeout(500);
      const pv = one(`select private from deals where id=${e6}`);
      await confirm(g); const st = await status(g); await openDeal(a, e6); const o = await field(a, "Owner");
      check("Edge case 6", pv === "f" && st === "Alan Fake has no private people or deals to hand over." && o === "Alan Fake (deactivated)", `private after untick ${pv}, status "${st}", owner "${o}"`);
    });
    await run("Edge case 7", async () => {
      sql(`update deals set private=true where id=${e6}`);
      await openPanel(g); await choose(g, "Grace Fake"); await confirm(g); const st = await status(g);
      await board(g); const badge = (await card(g, "SF97 E6 deal").locator(".badge").allTextContents()).map(norm); await openDeal(g, e6); const o = await field(g, "Owner");
      check("Edge case 7", st === "1 private deal handed to Grace Fake." && badge.includes("Private") && o === "Grace Fake", `status "${st}", badge ${JSON.stringify(badge)}, owner "${o}"`);
    });
  }
  await browser.close();
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
})();
