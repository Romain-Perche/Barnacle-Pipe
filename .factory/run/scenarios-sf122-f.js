// SF-122 AI review, part f (app :3001, after e's data): US5-1 paused message (page closed during deals, reopened ~40 s
// later), US3-3 done activity on the person's timeline, Edge 14 download name, Edge 16 signed-out / deactivated requests.
const L = require("./sf122-lib");
const fs = require("fs");
const TMP = process.env.TMPDIR || "/tmp";
const ids = JSON.parse(fs.readFileSync(TMP + "/sf122-ids.json"));
const t = async (p) => ((await p.locator("main").textContent()) || "").replace(/\s+/g, " ");
(async () => {
  const browser = await L.chromium.launch();
  const out = {};
  L.q("update pipedrive_imports set state='finished', step='done', pause_reason=null, finished_at=now() where state not in ('finished','stopped')");
  const c = (op, ...a) => L.ctl(op, L.CO, ...a);
  for (let i = 0; i < 45; i++) await c("addDeal", { title: `SF122 bulk ${i}`, owner_id: 1, stage_id: ids.stages["Proposal"], person_id: L.pidOf(4) });
  const ctx = await browser.newContext(); let ada = await ctx.newPage(); await L.signIn(ada, L.BASE, "ada@barnacle.ai", "Ada Fake");
  if (L.q("select count(*) from pipedrive_connections where user_id=1") === "0") await L.saveToken(ada, "fake-pipedrive-token");
  let startReq = null;
  ada.on("request", (r) => { if (r.method() === "POST" && r.url().includes("pipedrive-import") && !startReq) startReq = { url: r.url(), headers: r.headers(), body: r.postData() }; });
  await L.ctl("slowDownEvery", 3, 2);
  await L.startAll(ada);
  let t0 = Date.now();
  while (Date.now() - t0 < 120000 && !/^deals/.test(L.q("select step from pipedrive_imports where user_id=1"))) await ada.waitForTimeout(200);
  await ada.close();
  await new Promise((r) => setTimeout(r, 45000));
  out.atReopen = L.q("select step||'|'||state||'|'||coalesce(pause_reason,'') from pipedrive_imports where user_id=1");
  ada = await ctx.newPage(); await ada.goto(L.BASE + "/settings/pipedrive-import");
  out.paused = (await t(ada)).replace(/.*\/\/ PROGRESS/, "// PROGRESS").slice(0, 500);
  await L.ctl("slowDownEvery", null);
  if (await ada.locator("text=[ CONTINUE ]").count()) await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ CONTINUE ]")]);
  await L.waitReport(ada, 300000);
  out.counts = (await t(ada)).match(/\/\/ COUNTS.*?\/\/ PIPELINES/)?.[0];
  out.bulk = L.q("select count(*)||'/'||count(distinct title) from deals where title like 'SF122 bulk%'");
  // US3-3
  const P6 = L.pid(L.pidOf(6));
  await ada.goto(L.BASE + "/people/" + P6); const p6 = await t(ada);
  const i = p6.indexOf("SF122 done call"); out.p6 = p6.slice(Math.max(0, i - 200), i + 150); out.p6last = (p6.match(/LAST CONTACTED.{0,40}/i) || [""])[0];
  // Edge 14
  const fid = L.q(`select file_id from pipedrive_links where kind='file' and pipedrive_id=${ids.fXss}`);
  const r = await ada.request.get(L.BASE + `/files/${fid}/download`, { maxRedirects: 0 });
  out.dlLoc = r.status() + " " + decodeURIComponent(r.headers()["location"] || "");
  // Edge 16
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(L.BASE + "/settings/pipedrive-import"); out.anonPage = anon.url();
  const before = L.q("select count(*) from pipedrive_imports");
  if (startReq) { const h = { ...startReq.headers }; delete h.cookie; const rr = await anon.request.post(startReq.url, { headers: h, data: startReq.body, maxRedirects: 0 }); out.anonPost = rr.status(); }
  // deactivated Margaret replays the same start with her own session
  const m = await (await browser.newContext()).newPage(); await L.signIn(m, L.BASE, "margaret@barnacle.ai", "Margaret Fake");
  await L.saveToken(m, "fake-pipedrive-token");
  const mc = (await m.context().cookies()).map((x) => `${x.name}=${x.value}`).join("; ");
  const g = await (await browser.newContext()).newPage(); await L.signIn(g, L.BASE, "grace@barnacle.ai", "Grace Fake");
  await g.goto(L.BASE + "/admin/users"); await L.rowAction(g, "margaret@barnacle.ai", "[ DEACTIVATE ]");
  if (startReq) { const h = { ...startReq.headers, cookie: mc }; const rr = await anon.request.post(startReq.url, { headers: h, data: startReq.body, maxRedirects: 0 }); out.deactPost = rr.status(); }
  await m.goto(L.BASE + "/settings/pipedrive-import"); out.deactPage = m.url();
  out.importsBeforeAfter = before + " → " + L.q("select count(*) from pipedrive_imports") + "; margaret imports " + L.q("select count(*) from pipedrive_imports where user_id=4");
  L.q("update users set status='active' where id=4");
  fs.writeFileSync(TMP + "/sf122-f.json", JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
