// SF-122 AI review, part b: UI checks after scenarios-sf122-a.js (same data, app :3001). Prints what each page shows.
const L = require("./sf122-lib");
const fs = require("fs");
const ids = JSON.parse(fs.readFileSync((process.env.TMPDIR || "/tmp") + "/sf122-ids.json"));
const dealOf = (pd) => L.q(`select deal_id from pipedrive_links where kind='deal' and pipedrive_id=${pd}`);
const t = async (p) => (await p.locator("main").innerText()).replace(/[ \t]+/g, " ");
(async () => {
  const browser = await L.chromium.launch();
  const ada = await L.newPage(browser, "ada@barnacle.ai", "Ada Fake");
  const out = {};
  // US1-1: the choose page
  await ada.goto(L.BASE + "/settings/pipedrive-import?new=1");
  out.boxes = await ada.$$eval('input[type=checkbox]', (b) => b.map((x) => `${x.name}:${x.checked}`).join(","));
  out.emailBox = await ada.locator("label", { hasText: /email/i }).count();
  // US1-7, US2-1, US4-1 on the lead-in deal
  const D = dealOf(ids.dLeadIn);
  await ada.goto(L.BASE + "/deals/" + D);
  out.dealPage = await t(ada);
  out.stagebar = await ada.locator('ol.stagebar').first().innerHTML();
  // file download bytes
  const fid = L.q(`select file_id from pipedrive_links where kind='file' and pipedrive_id=${ids.fDealPerson}`);
  const r = await ada.request.get(L.BASE + `/files/${fid}/download`);
  out.dl = (await r.body()).toString();
  const rp = await ada.request.get(L.BASE + `/files/${L.q(`select file_id from pipedrive_links where kind='file' and pipedrive_id=${ids.fPersonOrg}`)}/preview`);
  out.pv = rp.status() + " " + (await rp.body()).toString("base64").slice(0, 30);
  // Person004 timeline (note of the deal shown once as an entry of the deal)
  const P4 = L.pid(L.pidOf(4));
  await ada.goto(L.BASE + "/people/" + P4);
  out.p4 = await t(ada);
  // XSS deal
  const X = dealOf(ids.dXss);
  await ada.goto(L.BASE + "/deals/" + X);
  out.xss = await t(ada);
  out.xssLinks = await ada.locator('a[href*="evil.example"]').count();
  await ada.goto(L.BASE + "/activities");
  out.actAda = await t(ada);
  out.actLinksEvil = await ada.locator('a[href*="evil.example"]').count();
  // board: SF122 today call on 'SF122 qualified A'
  await ada.goto(L.BASE + "/deals");
  out.board = await t(ada);
  // Grace: notifications and activities
  const grace = await L.newPage(browser, "grace@barnacle.ai", "Grace Fake");
  await grace.goto(L.BASE + "/notifications"); out.graceNotif = await t(grace);
  await grace.goto(L.BASE + "/activities"); out.graceAct = await t(grace);
  // Linus: private deal and its records
  const linus = await L.newPage(browser, "linus@barnacle.ai", "Linus Fake");
  const PRIV = dealOf(ids.dPriv2);
  const r2 = await linus.goto(L.BASE + "/deals/" + PRIV); out.linusPriv = (await t(linus)).slice(0, 200);
  await linus.goto(L.BASE + "/people/" + P4); out.linusP4 = await t(linus);
  await linus.goto(L.BASE + "/activities"); out.linusAct = await t(linus);
  await linus.goto(L.BASE + "/notifications"); out.linusNotif = await t(linus);
  await linus.goto(L.BASE + "/deals/" + D); out.linusDeal = await t(linus);
  const marg = await L.newPage(browser, "margaret@barnacle.ai", "Margaret Fake");
  await marg.goto(L.BASE + "/deals/" + PRIV); out.margPriv = await t(marg);
  fs.writeFileSync((process.env.TMPDIR || "/tmp") + "/sf122-ui.json", JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
