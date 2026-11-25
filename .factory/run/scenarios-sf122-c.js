// SF-122 AI review, part c (after a and b, same data): US2-5 (Linus edits and deletes an imported note), CRM changes
// before a repeat (deal deleted by an admin, activity and file deleted), new Pipedrive records, the nameless person
// given a name (US5-4), Edge 8/13 data; then a second import posted WITHOUT People/Organisations (Edge 1 server rule),
// Pipedrive made unreachable mid-run (paused message), continued; prints progress samples and the report.
const L = require("./sf122-lib");
const fs = require("fs");
const TMP = process.env.TMPDIR || "/tmp";
const ids = JSON.parse(fs.readFileSync(TMP + "/sf122-ids.json"));
const dealOf = (pd) => L.q(`select deal_id from pipedrive_links where kind='deal' and pipedrive_id=${pd}`);
const t = async (p) => (await p.locator("main").innerText()).replace(/[ \t]+/g, " ");
(async () => {
  const browser = await L.chromium.launch();
  const out = {};
  const linus = await L.newPage(browser, "linus@barnacle.ai", "Linus Fake");
  const D = dealOf(ids.dLeadIn);
  const NID = L.q(`select note_id from pipedrive_links where kind='note' and pipedrive_id=${ids.nDealPerson}`);
  await linus.goto(L.BASE + "/deals/" + D);
  const entry = linus.locator("section[aria-label=Timeline] li", { hasText: "SF122 note on deal and person" }).last();
  await entry.getByRole("link", { name: "Edit note" }).click();
  await linus.waitForURL(/note=/);
  const ef = linus.getByRole("form", { name: "Edit note" });
  await ef.getByRole("textbox", { name: "Note" }).fill("SF122 note edited by Linus");
  await ef.getByRole("button", { name: "[ SAVE ]" }).click();
  await linus.waitForTimeout(800);
  out.edited = L.q(`select body||'|'||coalesce((select email from users where id=edited_by),'') from timeline_events where id=${NID}`);
  // delete another imported note (the one on the xss deal) through the UI
  const NX = L.q(`select note_id from pipedrive_links where kind='note' and pipedrive_id=${ids.nXss}`);
  await linus.goto(L.BASE + "/deals/" + dealOf(ids.dXss));
  await linus.locator("section[aria-label=Timeline] li", { hasText: "Click (https://evil.example)" }).last().getByRole("link", { name: "Delete note" }).click();
  await linus.waitForURL(/delete-note=/);
  await Promise.all([linus.waitForLoadState("networkidle"), linus.getByRole("button", { name: /DELETE/ }).last().click()]);
  await linus.waitForTimeout(800);
  out.deletedNote = L.q(`select count(*) from timeline_events where id=${NX}`);
  // CRM changes before the repeat
  const Q2 = dealOf(ids.dQual2);
  L.q(`delete from deals where id=${Q2}`); // an admin's delete (the app's delete keeps the link the same way: link row stays)
  out.q2link = L.q(`select count(*) from pipedrive_links where kind='deal' and pipedrive_id=${ids.dQual2}`);
  L.q(`update deals set title='SF122 renamed in CRM' where id=${dealOf(ids.dDemo)}`);
  L.q(`delete from activities where id=(select activity_id from pipedrive_links where kind='activity' and pipedrive_id=${ids.aJane})`);
  // new Pipedrive records
  const c = (op, ...a) => L.ctl(op, L.CO, ...a);
  ids.dNew = await c("addDeal", { title: "SF122 new deal round 2", owner_id: 1, stage_id: ids.stages["Proposal"], person_id: L.pidOf(4) });
  ids.dDoraUsd = await c("addDeal", { title: "SF122 Dora USD deal", owner_id: 1, stage_id: ids.stages["Proposal"], person_id: ids.dora, value: 10, currency: "USD" });
  ids.nNew = await c("addNote", { content: "<p>SF122 new note round 2</p>", user_id: 1, person_id: L.pidOf(7) });
  ids.nDoraEmpty = await c("addNote", { content: "<p></p>", user_id: 1, person_id: ids.dora });
  ids.nOnDeleted = await c("addNote", { content: "<p>SF122 note on CRM-deleted deal</p>", user_id: 1, deal_id: ids.dQual2 });
  ids.aOnDeleted = await c("addActivity", { subject: "SF122 activity on CRM-deleted deal", owner_id: 1, type: "call", due_date: "2026-12-12", deal_id: ids.dQual2 });
  ids.fOnDeleted = await c("addFile", { name: "sf122 on deleted.pdf", user_id: 1, deal_id: ids.dQual2 }, L.b64("%PDF-1.4\ndel\n"));
  ids.aNew = await c("addActivity", { subject: "SF122 new activity round 2", owner_id: 1, type: "task", due_date: "2026-12-12" });
  ids.fNew = await c("addFile", { name: "sf122 new round 2.pdf", user_id: 1, person_id: L.pidOf(7) }, L.b64("%PDF-1.4\nnew\n"));
  await c("updatePerson", L.pidOf(99), { name: "Nownamed Fake", first_name: "Nownamed", last_name: "Fake" });
  fs.writeFileSync(TMP + "/sf122-ids.json", JSON.stringify(ids));
  // Edge 1 UI behaviour on the choose page
  const ada = await L.newPage(browser, "ada@barnacle.ai", "Ada Fake");
  await ada.goto(L.BASE + "/settings/pipedrive-import?new=1");
  const st = async () => ada.$$eval("input[type=checkbox]", (b) => b.map((x) => `${x.name}:${x.checked}${x.disabled ? "(locked)" : ""}`).join(","));
  const consentVis = async () => ada.locator('input[name="consent"][value="subscribed"]').isVisible();
  out.e1 = [await st() + " consent " + (await consentVis())];
  await ada.check('input[name="notes"]'); out.e1.push(await st() + " consent " + (await consentVis()));
  await ada.check('input[name="files"]'); await ada.uncheck('input[name="notes"]'); out.e1.push(await st());
  await ada.uncheck('input[name="files"]'); out.e1.push(await st() + " consent " + (await consentVis()));
  await ada.uncheck('input[name="people"]'); out.e1.push(await st() + " consent " + (await consentVis()));
  // Server rule: tick Deals..Files, then strip People/Organisations (hidden inputs and boxes) before posting
  for (const k of ["deals", "notes", "activities", "files"]) await ada.check(`input[name="${k}"]`);
  await ada.check('input[name="consent"][value="subscribed"]');
  await ada.evaluate(() => document.querySelectorAll('input[name="people"], input[name="organisations"]').forEach((e) => e.remove()));
  await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ IMPORT ]")]);
  out.wants = L.q("select want_people, want_organisations, want_deals, want_notes, want_activities, want_files from pipedrive_imports order by id desc limit 1");
  const seen = [];
  let downAt = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const tx = ((await ada.locator("main").textContent().catch(() => "")) || "").replace(/\s+/g, " ");
    const m = tx.match(/\/\/ PROGRESS.*?(?=\/\/|\[ |$)/);
    if (m && seen[seen.length - 1] !== m[0]) seen.push(m[0].slice(0, 400));
    const step = L.q("select step from pipedrive_imports order by id desc limit 1");
    if (!downAt && /deal/.test(step)) { await L.ctl("down", true); downAt = Date.now(); }
    if (downAt && /PAUSED|Continue|CONTINUE/.test(tx)) {
      out.paused = tx.slice(tx.indexOf("// PROGRESS"), tx.indexOf("// PROGRESS") + 900);
      await L.ctl("down", false);
      await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ CONTINUE ]")]);
      downAt = -1;
    }
    if ((await ada.locator('[aria-current="step"]', { hasText: "3 REPORT" }).count()) > 0) break;
    await ada.waitForTimeout(400);
  }
  out.progress = seen;
  out.report = await ada.locator("main").innerText();
  fs.writeFileSync(TMP + "/sf122-c.json", JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
