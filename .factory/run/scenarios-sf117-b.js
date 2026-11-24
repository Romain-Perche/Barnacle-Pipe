// SF-117 AI review, part B: US3 (parts, progress, pause, resume, stop, repeats, two users) and edge cases 2, 9, 16, 17.
// Fresh data first (bash .factory/run/reset-db.sh); the stand-in Pipedrive on :9400 and the app on :3001 (test-env.md).
// Adds company 2001 (800 organisations, 3,000 people, token big-fake-token, Grace) and 3001 (50 / 300, tokens
// mid-a / mid-b, Linus and Margaret) to the stand-in. ~8 min.
const L = require("./sf117-lib");
const { q, ctl, check, BASE } = L;
const ONLY = process.argv.slice(2);
const want = (n) => ONLY.length === 0 || ONLY.some((o) => n.startsWith(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const row = (u) => q(`select state||'|'||coalesce(pause_reason,'')||'|'||organisations_done||'|'||coalesce(organisations_total,0)||'|'||people_done||'|'||coalesce(people_total,0) from pipedrive_imports where user_id=${u} order by id desc limit 1`);
async function until(fn, ms = 120000, step = 100) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(step); } return false; }

(async () => {
  const browser = await L.chromium.launch();
  await ctl("reset");
  // Big company 2001 (Grace), and 3001 (Linus + Margaret).
  await ctl("addCompany", { token: "big-fake-token", user: { id: 1, name: "Grace Pipedrive Fake", email: "grace@barnacle.ai" }, companyId: 2001, companyName: "Bigco Pipedrive Fake" });
  await ctl("addCompany", { token: "big-linus-token", user: { id: 2, name: "Linus Pipedrive Fake", email: "linus@barnacle.ai" }, companyId: 2001, companyName: "Bigco Pipedrive Fake" });
  for (let i = 1; i <= 800; i++) await ctl("addOrganization", 2001, { id: i, name: `Bigco Org ${i} Fake`, owner_id: 1 });
  for (let i = 1; i <= 3000; i++) await ctl("addPerson", 2001, { id: 1000 + i, first_name: `Big${i}`, last_name: "Fake", owner_id: 1, org_id: (i % 800) + 1, emails: [{ value: `big${i}@fake.example`, primary: true, label: "work" }], marketing_status: "subscribed" });
  await ctl("addCompany", { token: "mid-a", user: { id: 1, name: "Linus Mid Fake", email: "linus@barnacle.ai" }, companyId: 3001, companyName: "Midco Pipedrive Fake" });
  await ctl("addCompany", { token: "mid-b", user: { id: 2, name: "Margaret Mid Fake", email: "margaret@barnacle.ai" }, companyId: 3001, companyName: "Midco Pipedrive Fake" });
  for (let i = 1; i <= 50; i++) await ctl("addOrganization", 3001, { id: i, name: `Midco Org ${i} Fake`, owner_id: 1 });
  for (let i = 1; i <= 300; i++) await ctl("addPerson", 3001, { id: 100 + i, first_name: `Mid${i}`, last_name: "Fake", owner_id: 1, org_id: (i % 50) + 1, emails: [{ value: `mid${i}@fake.example`, primary: true, label: "work" }], marketing_status: "unsubscribed" });
  await ctl("addCompany", { token: "marg-token", user: { id: 2, name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" }, companyId: 1001, companyName: "Fakeco Pipedrive" });
  console.log("fake data ready");

  // ---------------- US3 1, 2, 3, 7, Edge 9 and US3 8: Grace, 2001
  let g2 = null;
  if (["US3 scenario 1", "US3 scenario 2", "US3 scenario 3", "US3 scenario 7", "Edge case 9", "US3 scenario 8"].some(want)) {
  const grace = await L.newPage(browser, "grace@barnacle.ai", "Grace Fake");
  await L.saveToken(grace, "big-fake-token");
  const gctx = grace.context();
  const stale = await gctx.newPage();
  await stale.goto(BASE + "/settings/pipedrive-import?new=1"); // a second tab still on 1 CHOOSE
  await ctl("slowDownEvery", 9, 3);
  const t0 = Date.now();
  await L.startImport(grace, { people: true, orgs: true, consent: "unsubscribed" });
  const seen = []; let slowText = ""; let slowAt = null;
  const watch = async (page, untilFn, ms) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const txt = await L.body(page).catch(() => "");
      const prog = (txt.match(/(Organisations|People) · [\d,]+ of [\d,]+/g) || []).join(", ");
      if (seen.length === 0 || seen[seen.length - 1].prog !== prog) seen.push({ s: Math.round((Date.now() - t0) / 1000), prog });
      const m = txt.match(/Pipedrive asked us to slow down\. Carrying on in \d+ seconds?\./);
      if (m && !slowText) { slowText = m[0]; slowAt = row(2); }
      if (await untilFn()) return true;
      await sleep(500);
    }
    return false;
  };
  // US3-7: the stale tab's [ IMPORT ] goes to the running import.
  await stale.check('input[name="organisations"]');
  await Promise.all([stale.waitForLoadState("networkidle"), stale.click("text=[ IMPORT ]")]);
  await stale.waitForTimeout(500);
  const staleStep = await L.stepNow(stale); const openN = q("select count(*) from pipedrive_imports where user_id=2 and state in ('running','waiting','paused')");
  await stale.close();
  await watch(grace, async () => Number(row(2).split("|")[4]) >= 1200, 600000);
  // Edge 9: a person ahead of the cursor is deleted in Pipedrive, one is added.
  await ctl("deletePerson", 2001, 3900);
  await ctl("addPerson", 2001, { id: 5000, first_name: "Latecomer", last_name: "Fake", owner_id: 1, emails: [{ value: "late@fake.example", primary: true, label: "work" }], marketing_status: "subscribed" });
  // US3-3: close the page.
  await grace.close();
  const atClose = row(2);
  await sleep(36000);
  const after36 = row(2);
  g2 = await gctx.newPage();
  await g2.goto(BASE + "/settings"); const settingsTxt = await L.section(g2);
  await g2.goto(BASE + "/settings/pipedrive-import"); const pausedTxt = await L.body(g2);
  const btns = ["[ CONTINUE ]", "[ STOP IMPORT ]"].map((b) => pausedTxt.includes(b));
  await Promise.all([g2.waitForLoadState("networkidle"), g2.click("text=[ CONTINUE ]")]);
  const fin = await watch(g2, async () => row(2).startsWith("finished"), 1500000);
  const secs = Math.round((Date.now() - t0) / 1000);
  await g2.reload(); const rep = await L.body(g2);
  const links = q("select kind||':'||count(*)||':'||count(distinct pipedrive_id) from pipedrive_links where company_id=2001 group by kind order by kind").replace(/\n/g, " ");
  const persons = q("select count(*)||':'||count(distinct e.email) from persons p join person_emails e on e.person_id=p.id where e.email like 'big%@fake.example' or e.email='late@fake.example'");
  const del = q("select count(*) from pipedrive_links where company_id=2001 and pipedrive_id=3900 and kind='person'");
  const counts = q("select counts from pipedrive_imports where user_id=2");
  console.log("progress samples:", JSON.stringify(seen.slice(0, 40)));
  if (want("US3 scenario 1")) {
    const gaps = seen.filter((x) => x.prog.includes("People")).map((x, i, a) => (i ? x.s - a[i - 1].s : 0));
    check("US3 scenario 1", fin && seen.length > 5 && Math.max(...gaps.slice(1, 10)) <= 10 && rep.includes("3 REPORT") && /Organisations · 800 of 800/.test(JSON.stringify(seen)), `${seen.length} different progress texts, first: ${seen.slice(0, 4).map((x) => x.s + "s " + x.prog).join(" / ")}; largest gap between People changes (first 10) ${Math.max(...gaps.slice(1, 10))} s; finished ${fin} → report shown ${rep.includes("3 REPORT")}`);
  }
  if (want("US3 scenario 2")) check("US3 scenario 2", slowText !== "" && links.includes("organisation:800:800") && links.includes("person:3000:3000") && persons === "3000:3000", `seen "${slowText}" (at ${slowAt}); links ${links}; CRM people with big/late emails ${persons}; the fake answered 429 every 9th call`);
  if (want("US3 scenario 3")) check("US3 scenario 3", atClose.split("|")[4] === after36.split("|")[4] && /Import paused: Organisations 800 of 800, People [\d,]+ of 3,000\./.test(settingsTxt + pausedTxt) && btns.every(Boolean) && fin, `at close ${atClose}, 36 s later ${after36}; settings: "${(settingsTxt.match(/Import paused[^.]*\./) || [""])[0]}"; import page: "${(pausedTxt.match(/Import paused[^.]*\./) || [pausedTxt.slice(150, 400)])[0]}", buttons ${btns}; CONTINUE → finished ${fin}`);
  if (want("US3 scenario 7")) check("US3 scenario 7", staleStep.startsWith("2 IMPORTING") && openN === "1", `stale 1 CHOOSE tab submitted while running → shown step "${staleStep}"; open imports ${openN}`);
  if (want("Edge case 9")) check("Edge case 9", del === "0" && !rep.includes("Big2900") && links.includes("person:3000") && JSON.parse(counts).people.notImported === 0, `deleted PD 3900 (Big2900) linked ${del}; Latecomer added mid-run; counts ${counts}; report took ${secs} s`);
  console.log(`US3 big import total ${secs} s (incl. 36 s closed)`);
  if (want("US3 scenario 8")) {
    await ctl("slowDownEvery", null);
    await ctl("addPerson", 2001, { id: 6000, first_name: "Newer", last_name: "Fake", owner_id: 1, emails: [{ value: "newer@fake.example", primary: true, label: "work" }], marketing_status: "subscribed" });
    const before = q("select count(*) from persons");
    await L.startImport(g2, { people: true, orgs: true, consent: "unsubscribed" });
    await L.waitReport(g2, 600000);
    const r = await L.body(g2);
    const c = JSON.parse(q("select counts from pipedrive_imports where user_id=2"));
    const afterN = q("select count(*) from persons");
    check("US3 scenario 8", c.people.imported === 1 && c.people.already === 3000 && c.organisations.already === 800 && Number(afterN) - Number(before) === 1 && /Already imported: 3,?800/.test(r), `counts ${JSON.stringify(c)}; persons ${before}→${afterN}; report "${(r.match(/Already imported: [\d,]+/) || [""])[0]}"`);
  }

  }
  // ---------------- US3 4: Ada, 1001; Pipedrive goes down mid-import
  const ada = await L.newPage(browser, "ada@barnacle.ai", "Ada Fake");
  if (want("US3 scenario 4")) {
    await L.saveToken(ada, "fake-pipedrive-token");
    await L.startImport(ada, { people: true, orgs: true, consent: "subscribed" });
    await until(() => Number(row(1).split("|")[4]) > 0, 60000, 50);
    await ctl("down", true);
    await until(() => row(1).startsWith("paused"), 30000, 200);
    await ada.waitForTimeout(1500);
    const t1 = await L.body(ada); const r1 = row(1);
    const half = q("select count(*) from persons p join pipedrive_links l on l.person_id=p.id and l.company_id=1001 where not exists (select 1 from person_emails e where e.person_id=p.id) and l.how='imported' and l.pipedrive_id not in (159)");
    await ctl("down", false);
    // a 500 next, then a time-out (hang), each pauses with the same message
    await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ CONTINUE ]")]);
    await ctl("failNext", 500);
    await until(() => row(1).startsWith("paused") || row(1).startsWith("finished"), 30000, 200);
    const r500 = row(1); await ada.reload(); const t500 = await L.body(ada);
    await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ CONTINUE ]")]);
    await ctl("hangNext");
    await until(() => row(1).startsWith("paused") || row(1).startsWith("finished"), 40000, 200);
    const rHang = row(1);
    await ada.reload();
    await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ CONTINUE ]")]).catch(() => {});
    await L.waitReport(ada, 120000);
    const dup = q("select count(*) - count(distinct pipedrive_id) from pipedrive_links where company_id=1001");
    const persons = q("select count(*) from pipedrive_links where company_id=1001 and kind='person' and how='imported'") + "/" + q("select count(*) from persons where first_name like 'Person%' and last_name='Fake'");
    check("US3 scenario 4", t1.includes("The import stopped: Pipedrive can't be reached right now.") && t1.includes("[ CONTINUE ]") && r1.startsWith("paused|unreachable") && r500.startsWith("paused|unreachable") && t500.includes("The import stopped: Pipedrive can't be reached right now.") && rHang.startsWith("paused|unreachable") && dup === "0" && persons.split("/")[0] === persons.split("/")[1] && half === "0",
      `network down → ${r1}, page shows message ${t1.includes("The import stopped: Pipedrive can't be reached right now.")}; 500 → ${r500}; time-out → ${rHang}; after continuing: duplicate links ${dup}, imported links/persons ${persons}; persons without emails ${half}`);
  }

  // ---------------- US3 5, Edge 2, Edge 16: Margaret, 1001 with her own token
  const m = await L.newPage(browser, "margaret@barnacle.ai", "Margaret Fake");
  if (want("US3 scenario 5") || want("Edge case 2") || want("Edge case 16")) {
    q("delete from pipedrive_links where company_id=1001"); // so that Margaret's import adds records again
    await L.saveToken(m, "marg-token");
    await ctl("slowDownEvery", 4, 4);
    await L.startImport(m, { people: true, orgs: true, consent: "subscribed" });
    await until(() => row(4).startsWith("waiting") && Number(row(4).split("|")[2]) > 0, 120000, 100);
    await ctl("refuseToken", "marg-token");
    await until(() => row(4).startsWith("paused"), 30000, 200);
    await m.waitForTimeout(1500); await m.reload();
    const t = await L.body(m); const r = row(4);
    const kept = q("select count(*) from pipedrive_links where company_id=1001 and import_id=(select id from pipedrive_imports where user_id=4)");
    check("US3 scenario 5", r.startsWith("paused|token_refused") && t.includes("Pipedrive no longer accepts your token. Save a new token in Settings, then continue.") && Number(kept) > 0, `state ${r}; message shown ${t.includes("Pipedrive no longer accepts your token")}; records kept ${kept}`);
    // Edge 2: another company's token, then [ CONTINUE ]
    await ctl("slowDownEvery", null);
    await L.saveToken(m, "fake-pipedrive-other");
    const k0 = q("select count(*) from pipedrive_links");
    await m.goto(BASE + "/settings/pipedrive-import");
    await Promise.all([m.waitForLoadState("networkidle"), m.click("text=[ CONTINUE ]")]);
    await until(() => row(4).startsWith("paused"), 20000, 200); await m.waitForTimeout(1000); await m.reload();
    const t2 = await L.body(m); const k1 = q("select count(*) from pipedrive_links");
    check("Edge case 2", t2.includes("This import is from another Pipedrive company. Stop it, or save the token of that company again.") && k0 === k1, `after CONTINUE: ${row(4)}; message ${t2.includes("This import is from another Pipedrive company")}; links ${k0}→${k1}`);
    // Edge 16: the right token again, running, then Ada deactivates Margaret.
    await ctl("addCompany", { token: "marg-token", user: { id: 2, name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" }, companyId: 1001, companyName: "Fakeco Pipedrive" });
    await ctl("slowDownEvery", 3, 3);
    await L.saveToken(m, "marg-token");
    await m.goto(BASE + "/settings/pipedrive-import");
    await Promise.all([m.waitForLoadState("networkidle"), m.click("text=[ CONTINUE ]")]);
    await m.waitForTimeout(2000);
    await ada.goto(BASE + "/admin/users");
    await L.rowAction(ada, "margaret@barnacle.ai", "[ DEACTIVATE ]");
    await ada.waitForTimeout(1500);
    const st = q("select status from users where id=4");
    const tok = q("select count(*) from pipedrive_connections where user_id=4");
    const d0 = row(4); const l0 = q("select count(*) from pipedrive_links where import_id=(select id from pipedrive_imports where user_id=4)");
    await sleep(10000);
    const d1 = row(4); const l1 = q("select count(*) from pipedrive_links where import_id=(select id from pipedrive_imports where user_id=4)");
    await m.goto(BASE + "/settings"); const mUrl = m.url();
    check("Edge case 16", st === "deactivated" && tok === "0" && l0 === l1 && Number(l0) > 0, `Margaret ${st}; her token rows ${tok}; import ${d0} → 10 s later ${d1}; records ${l0}→${l1} (kept); her /settings → ${mUrl}`);
    await ctl("slowDownEvery", null);
  }

  // ---------------- US3 6: Linus, 2001, stop
  const linus = await L.newPage(browser, "linus@barnacle.ai", "Linus Fake");
  if (want("US3 scenario 6")) {
    q("delete from pipedrive_links where company_id=2001 and kind='person' and pipedrive_id > 2000");
    await L.saveToken(linus, "big-linus-token");
    await L.startImport(linus, { people: true, consent: "unsubscribed" });
    await until(() => Number(row(3).split("|")[4]) > 1000, 120000, 100);
    await linus.goto(BASE + "/settings/pipedrive-import?stop=1");
    const dlg = (await linus.locator('[role="alertdialog"]').innerText().catch(() => "")).replace(/\s+/g, " ");
    await Promise.all([linus.waitForLoadState("networkidle"), linus.locator('[role="alertdialog"] button').filter({ hasText: /STOP/ }).click()]);
    await linus.waitForTimeout(1000);
    const r0 = row(3); const n0 = q("select count(*) from pipedrive_links where import_id=(select id from pipedrive_imports where user_id=3)");
    await sleep(5000);
    const n1 = q("select count(*) from pipedrive_links where import_id=(select id from pipedrive_imports where user_id=3)");
    await linus.reload(); const t = await L.body(linus);
    check("US3 scenario 6", r0.startsWith("stopped") && n0 === n1 && Number(n0) > 0 && t.includes("Stopped by you before the end.") && (await L.stepNow(linus)).startsWith("3 REPORT"), `confirm "${dlg}"; state ${r0}; records ${n0}→${n1} after 5 s; report shows stopped line ${t.includes("Stopped by you before the end.")}; ${t.slice(80, 260)}`);
  }

  // ---------------- US3 9: Linus and Margaret (re-activated) import 3001 at the same time
  if (want("US3 scenario 9")) {
    q("update users set status='active' where id=4");
    q("update pipedrive_imports set state='stopped', stop_reason='by_user', finished_at=now(), pause_reason=null, wait_until=null where user_id=4 and state in ('running','waiting','paused')");
    const m2 = await L.newPage(browser, "margaret@barnacle.ai", "Margaret Fake");
    await L.saveToken(linus, "mid-a"); await L.saveToken(m2, "mid-b");
    await Promise.all([L.startImport(linus, { people: true, orgs: true, consent: "subscribed" }), L.startImport(m2, { people: true, orgs: true, consent: "subscribed" })]);
    await Promise.all([L.waitReport(linus, 300000), L.waitReport(m2, 300000)]);
    const links = q("select kind||':'||count(*)||':'||count(distinct pipedrive_id) from pipedrive_links where company_id=3001 group by kind order by kind").replace(/\n/g, " ");
    const persons = q("select count(*) from persons where first_name like 'Mid%'"), orgs = q("select count(*) from organisations where name like 'Midco Org%'");
    const c3 = JSON.parse(q("select counts from pipedrive_imports where user_id=3")), c4 = JSON.parse(q("select counts from pipedrive_imports where user_id=4"));
    const sum = (k) => c3.people[k] + c4.people[k];
    // and one after the other: Linus again
    await L.startImport(linus, { people: true, orgs: true, consent: "subscribed" }); await L.waitReport(linus, 300000);
    const c3b = JSON.parse(q("select counts from pipedrive_imports where user_id=3"));
    check("US3 scenario 9", links === "organisation:50:50 person:300:300" && persons === "300" && orgs === "50" && sum("imported") === 300 && sum("already") === 300 && c3b.people.already === 300 && c3b.people.imported === 0,
      `at the same time: links ${links}; CRM Mid people ${persons}, orgs ${orgs}; Linus ${JSON.stringify(c3.people)} / Margaret ${JSON.stringify(c4.people)}; Linus again after: ${JSON.stringify(c3b)}`);
  }

  // ---------------- Edge 17: signed out / deactivated
  if (want("Edge case 17")) {
    // capture a save-token and a run-part request, then replay them without cookies
    let saveReq = null;
    await linus.goto(BASE + "/settings?replace=1");
    await linus.route("**/settings*", async (route) => { const r = route.request(); if (r.method() === "POST" && !saveReq) saveReq = { url: r.url(), headers: r.headers(), body: r.postData() }; await route.continue(); });
    await linus.fill('input[name="token"]', "mid-a");
    await Promise.all([linus.waitForURL(/saved|error/), linus.click("text=[ SAVE TOKEN ]")]);
    await linus.unroute("**/settings*");
    q("delete from pipedrive_connections where user_id=3");
    const anon = await browser.newContext(); const ap = await anon.newPage();
    const pages = [];
    for (const p of ["/settings", "/settings/pipedrive-import"]) { await ap.goto(BASE + p); pages.push(ap.url().replace(BASE, "")); }
    const h = { ...saveReq.headers }; delete h.cookie;
    const res = await anon.request.post(saveReq.url, { headers: h, data: saveReq.body, maxRedirects: 0 }).catch((e) => ({ status: () => "err " + e.message }));
    const rows = q("select count(*) from pipedrive_connections where user_id=3");
    // deactivated: Grace's session after deactivation
    if (!g2) { q("update users set status='active' where id=2"); g2 = await L.newPage(browser, "grace@barnacle.ai", "Grace Fake"); }
    await ada.goto(BASE + "/admin/users"); await L.rowAction(ada, "grace@barnacle.ai", "[ DEACTIVATE ]");
    const st = q("select status from users where id=2");
    await g2.goto(BASE + "/settings/pipedrive-import"); const gUrl = g2.url().replace(BASE, "");
    check("Edge case 17", pages.every((u) => u.startsWith("/sign-in")) && rows === "0" && st === "deactivated" && !gUrl.startsWith("/settings"), `signed out: ${pages.join(", ")}; replayed save-token POST without cookies → ${res.status()} and token rows ${rows}; deactivated Grace (${st}) opening the import page → ${gUrl}`);
  }
  console.log("\n" + JSON.stringify(L.results.map((r) => ({ name: r.name, ok: r.ok }))));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
