// SF-122 AI review, part d (fresh data via setupData): Linus (not an admin) imports everything (Edge 2); a Margaret-only
// deal with a USD value (is its title named in Linus's report?); Edge 12: a note and an activity deleted in Pipedrive while
// the import is still on people, a deal added after the deals step; then a second import.
const L = require("./sf122-lib");
const fs = require("fs");
const TMP = process.env.TMPDIR || "/tmp";
const t = async (p) => (await p.locator("main").innerText()).replace(/[ \t]+/g, " ");
(async () => {
  const ids = await L.setupData();
  const c = (op, ...a) => L.ctl(op, L.CO, ...a);
  ids.dMargUsd = await c("addDeal", { title: "SF122 Margaret secret USD", owner_id: 2, visible_to: 1, stage_id: ids.stages["Proposal"], person_id: L.pidOf(4), value: 9, currency: "USD", lost_reason: null });
  ids.nToDelete = await c("addNote", { content: "<p>SF122 note deleted mid-import</p>", user_id: 1, person_id: L.pidOf(8) });
  ids.aToDelete = await c("addActivity", { subject: "SF122 activity deleted mid-import", owner_id: 1, type: "call", due_date: "2026-12-12" });
  await L.ctl("slowDownEvery", 25, 1);
  const browser = await L.chromium.launch();
  const out = {};
  const linus = await L.newPage(browser, "linus@barnacle.ai", "Linus Fake");
  await L.saveToken(linus, "fake-pipedrive-token");
  out.pipelinesBefore = L.q("select count(*) from pipelines") + "/" + L.q("select count(*) from stages");
  await L.startAll(linus);
  let deleted = false, added = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 600000) {
    const step = L.q("select step from pipedrive_imports order by id desc limit 1");
    if (!deleted && /^(people|organisations|pipelines)$/.test(step)) { await c("deleteNote", ids.nToDelete); await c("deleteActivity", ids.aToDelete); deleted = step; }
    if (!added && /notes|activities|files/.test(step)) { ids.dLate = await c("addDeal", { title: "SF122 added during import", owner_id: 1, stage_id: ids.stages["Proposal"], person_id: L.pidOf(4) }); added = step; }
    if ((await linus.locator('[aria-current="step"]', { hasText: "3 REPORT" }).count()) > 0) break;
    await linus.waitForTimeout(300);
  }
  out.deletedAt = deleted; out.addedAt = added;
  await L.ctl("slowDownEvery", null);
  out.report1 = await t(linus);
  out.lateIn1 = L.q("select count(*) from deals where title='SF122 added during import'");
  out.delIn = L.q("select count(*) from timeline_events where body like 'SF122 note deleted mid%'") + "/" + L.q("select count(*) from activities where subject like 'SF122 activity deleted mid%'");
  out.pipelinesAfter = L.q("select count(*) from pipelines") + "/" + L.q("select count(*) from stages");
  out.newPipelines = L.q("select string_agg(name, ', ' order by position) from pipelines where name like 'Fake%'");
  // Linus on the Pipelines admin page and its actions
  const r = await linus.goto(L.BASE + "/admin/pipelines"); out.adminPage = linus.url().replace(L.BASE, "") + " | " + (await t(linus)).slice(0, 200);
  const ada = await L.newPage(browser, "ada@barnacle.ai", "Ada Fake");
  await ada.goto(L.BASE + "/admin/pipelines"); out.adminAda = (await t(ada)).slice(0, 900);
  // second import by Linus
  await L.startAll(linus);
  await L.waitReport(linus);
  out.report2 = await t(linus);
  out.lateIn2 = L.q("select count(*) from deals where title='SF122 added during import'");
  fs.writeFileSync(TMP + "/sf122-d.json", JSON.stringify(out, null, 1));
  fs.writeFileSync(TMP + "/sf122-ids.json", JSON.stringify(ids));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
