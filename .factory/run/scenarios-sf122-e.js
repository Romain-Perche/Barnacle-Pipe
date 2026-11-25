// SF-122 AI review, part e (fresh data): file store cases and Edge 15. Needs: app :3002 (SUPABASE_URL=http://localhost:54321,
// the storage-proxy.js stand-in forwarding to :3001's fake storage) and app :3003 (SUPABASE_URL=http://localhost:54399:
// nothing listens = unreachable). US4-5 start check on :3003 and on :3002 with the proxy "down"; the store failing during the
// files step (pause, [ CONTINUE ]); US5-5 page closed half-way (paused message) then continued; Edge 15: four 4 MB files
// with each upload held 4 s, then (a) [ STOP IMPORT ], (b) the token removed, (c) the user deactivated, during a copy.
const L = require("./sf122-lib");
const fs = require("fs");
const TMP = process.env.TMPDIR || "/tmp";
const SP = "http://localhost:54321/__mode";
const mode = (m) => fetch(SP, { method: "POST", body: JSON.stringify(m) });
const t = async (p) => ((await p.locator("main").textContent()) || "").replace(/\s+/g, " ");
const row = () => L.q("select step||'|'||state||'|'||coalesce(pause_reason,'')||'|'||coalesce(cursor,'') from pipedrive_imports where user_id=1");
const files = () => L.q("select count(*) from files");
(async () => {
  const ONLY = process.env.ONLY || "";
  const ids = ONLY ? JSON.parse(fs.readFileSync(TMP + "/sf122-ids.json")) : await L.setupData();
  const browser = await L.chromium.launch();
  const out = {};
  const B2 = "http://localhost:3002";
  if (!ONLY) {
  // US4-5 start check: unreachable store (:3003)
  let ada = await L.newPage(browser, "ada@barnacle.ai", "Ada Fake");
  const B3 = "http://localhost:3003";
  await ada.goto(B3 + "/dev/fake-google"); // same DB, sign in on 3003
  await L.signIn(ada, B3, "ada@barnacle.ai", "Ada Fake");
  await ada.goto(B3 + "/settings"); await ada.goto(B3 + "/settings?replace=1").catch(() => {});
  await L.saveToken(ada, "fake-pipedrive-token");
  ada.close();
  ada = await (await browser.newContext()).newPage(); await L.signIn(ada, B3, "ada@barnacle.ai", "Ada Fake");
  await ada.goto(B3 + "/settings/pipedrive-import?new=1");
  await ada.check('input[name="files"]'); await ada.check('input[name="consent"][value="subscribed"]');
  await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ IMPORT ]")]);
  out.start3003 = (await t(ada)).slice(0, 400) + " | rows " + L.q("select count(*) from pipedrive_imports");
  // :3002 with the proxy down
  const a2 = await (await browser.newContext()).newPage(); await L.signIn(a2, B2, "ada@barnacle.ai", "Ada Fake");
  await mode({ mode: "down", delay: 0 });
  await a2.goto(B2 + "/settings/pipedrive-import?new=1");
  await a2.check('input[name="files"]'); await a2.check('input[name="consent"][value="subscribed"]');
  await Promise.all([a2.waitForLoadState("networkidle"), a2.click("text=[ IMPORT ]")]);
  out.start3002down = (await t(a2)).slice(0, 400) + " | rows " + L.q("select count(*) from pipedrive_imports");
  // the store fails during the files step
  await mode({ mode: "pass", delay: 3000 });
  await a2.goto(B2 + "/settings/pipedrive-import?new=1");
  for (const k of ["deals", "notes", "activities", "files"]) await a2.check(`input[name="${k}"]`);
  await a2.check('input[name="consent"][value="subscribed"]');
  await Promise.all([a2.waitForLoadState("networkidle"), a2.click("text=[ IMPORT ]")]);
  let t0 = Date.now();
  while (Date.now() - t0 < 200000 && !row().startsWith("files")) await a2.waitForTimeout(300);
  await mode({ mode: "down" });
  t0 = Date.now();
  while (Date.now() - t0 < 60000 && !/PAUSED/.test(await t(a2))) await a2.waitForTimeout(500);
  out.midFail = (await t(a2)).replace(/.*\/\/ PROGRESS/, "// PROGRESS").slice(0, 500) + " | row " + row();
  out.midFailFiles = files() + " cleanup " + L.q("select count(*)||' due '||count(*) filter (where due_at<=now()) from file_cleanup");
  await mode({ mode: "pass", delay: 0 });
  await Promise.all([a2.waitForLoadState("networkidle"), a2.click("text=[ CONTINUE ]")]);
  await L.waitReport(a2, 200000);
  out.afterContinue = (await t(a2)).match(/\/\/ COUNTS.*?\/\/ PIPELINES/)?.[0];
  out.dupFiles = L.q("select count(*)||'/'||count(distinct (name, coalesce(deal_id,0), coalesce(person_id,0), coalesce(organisation_id,0))) from files where id in (select file_id from pipedrive_links where kind='file')");
  out.dupAll = L.q("select string_agg(kind||':'||n||'/'||d, ' ') from (select kind, count(*) n, count(distinct pipedrive_id) d from pipedrive_links group by kind) x");
  }
  // Edge 15: four 4 MB files, uploads held 4 s each
  const c = (op, ...a) => L.ctl(op, L.CO, ...a);
  const runCase = async (name, act) => {
    for (let i = 0; i < 3; i++) await c("addFile", { name: `sf122 ${name} ${i}.bin`, user_id: 1, deal_id: ids.dLeadIn }, { __fill: [4_000_000, 65 + i] });
    await mode({ mode: "pass", delay: 4000 });
    let p = await (await browser.newContext()).newPage(); await L.signIn(p, B2, "ada@barnacle.ai", "Ada Fake");
    if (!L.q("select count(*) from pipedrive_connections where user_id=1").startsWith("1")) await (async () => { await p.goto(B2 + "/settings?replace=1"); await p.fill('input[name="token"]', "fake-pipedrive-token"); await Promise.all([p.waitForURL(/saved|error/), p.click("text=[ SAVE TOKEN ]")]); })();
    await p.goto(B2 + "/settings/pipedrive-import?new=1");
    await p.check('input[name="files"]'); await p.check('input[name="consent"][value="subscribed"]');
    await Promise.all([p.waitForLoadState("networkidle"), p.click("text=[ IMPORT ]")]);
    const before = () => L.q(`select count(*) from files where name like 'sf122 ${name}%'`);
    let t1 = Date.now();
    while (Date.now() - t1 < 200000 && !row().startsWith("files")) await p.waitForTimeout(200);
    await p.waitForTimeout(1500); // first upload under way
    const at = before();
    await act(p);
    await new Promise((r) => setTimeout(r, 25000));
    const after = before();
    let msg = "";
    try { await p.goto(B2 + "/settings/pipedrive-import"); msg = (await t(p)).replace(/.*\/\/ PROGRESS/, "// PROGRESS").slice(0, 300); } catch (e) { msg = "page: " + e.message; }
    out["e15_" + name] = `files of this case at action ${at}, 25 s later ${after}; row ${row()}; page ${p.url()} ${msg}; cleanup ${L.q("select count(*) from file_cleanup")}`;
    await mode({ mode: "pass", delay: 0 });
    fs.writeFileSync(TMP + "/sf122-e.json", JSON.stringify(out, null, 1));
  };
  if (!ONLY) {
  await runCase("stop", async (p) => { await p.click("text=[ STOP IMPORT ]").catch(() => {}); await p.waitForTimeout(500); const b = p.getByRole("button", { name: /STOP/ }); if (await b.count()) await b.last().click().catch(() => {}); });
  L.q("update pipedrive_imports set state='finished', step='done', pause_reason=null, finished_at=now() where user_id=1 and state not in ('finished','stopped')");
  await runCase("token", async () => { L.q("delete from pipedrive_connections where user_id=1"); });
  L.q("update pipedrive_imports set state='finished', step='done', pause_reason=null, finished_at=now() where user_id=1 and state not in ('finished','stopped')");
  }
  L.q("update pipedrive_imports set state='finished', step='done', pause_reason=null, finished_at=now() where user_id=1 and state not in ('finished','stopped')");
  await runCase("deact", async () => { const g = await (await browser.newContext()).newPage(); await L.signIn(g, B2, "grace@barnacle.ai", "Grace Fake"); await g.goto(B2 + "/admin/users"); await L.rowAction(g, "ada@barnacle.ai", "[ DEACTIVATE ]"); });
  out.deactStatus = L.q("select status from users where id=1");
  L.q("update users set status='active' where id=1");
  fs.writeFileSync(TMP + "/sf122-e.json", JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
