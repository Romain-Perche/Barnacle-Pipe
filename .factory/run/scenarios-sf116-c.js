// SF-116 US4, US5 and edge cases against :3000/crm_dev (fresh fake data: reset-db.sh first). Edge 8 needs a second
// app on :3001 whose Storage is unreachable, edge 9 one on :3002 behind storage-proxy.js MODE=fail-deletes (test-env.md).
const fs = require("fs"), path = require("path");
const { chromium, check, signIn, results } = require("./lib.js");
const { BASE, sql, sha, makeFiles, upload, rows } = require("./sf116-lib.js");
const fid = (name, where) => sql(`select id from files where name='${name}' and ${where} order by id desc limit 1`);
// Timeline entries (li.ent) that are about a file: their own FILE entries and, on a person or organisation, the linked
// deals' file entries (tagged DEAL like the deal's other entries).
async function timeline(page) { return page.$$eval("li.ent", (lis) => lis.filter((li) => li.querySelector(".kd.file") || / (added|deleted) /.test(li.innerText)).map((li) => { const a = li.querySelector(".ent-body > div:last-child a"); return { t: li ? li.innerText.replace(/\s+/g, " ") : "", href: a ? a.getAttribute("href") : null, target: a ? a.getAttribute("target") : null }; })); }
async function confirmDelete(page, url, name) {
  await page.goto(url); await page.getByRole("link", { name: `Delete ${name}` }).first().click();
  const dlg = page.getByRole("alertdialog"); await dlg.waitFor(); return dlg;
}
(async () => {
  const f = makeFiles();
  const browser = await chromium.launch();
  const ada = await browser.newContext({ acceptDownloads: true }); const pa = await ada.newPage();
  const grace = await browser.newContext({ acceptDownloads: true }); const pg = await grace.newPage();
  await signIn(pa, BASE, "ada@barnacle.ai", "Ada Fake"); await signIn(pg, BASE, "grace@barnacle.ai", "Grace Fake");
  // US4-1: deal 1 (person 1, organisation 1)
  await pa.goto(BASE + "/deals/1"); await upload(pa, [f("proposal.pdf"), f("shot.png"), f("notes.docx")]);
  await pa.reload(); let tl = await timeline(pa);
  const want = { "proposal.pdf (2.1 MB)": ["/preview", "_blank"], "shot.png (70 B)": ["?file=", null], "notes.docx (5 KB)": ["/download", null] };
  const n41 = []; let ok41 = true;
  for (const [txt, [h, tg]] of Object.entries(want)) { const e = tl.find((x) => x.t.includes(`Ada Fake added ${txt}`)); n41.push(`${txt}: ${e ? e.t + " → " + e.href + " " + e.target : "missing"}`); ok41 = ok41 && e && /^FILE/.test(e.t) && e.href && e.href.includes(h) && e.target === tg && /\d{1,2}:\d{2}/.test(e.t); }
  check("US4 scenario 1", ok41, n41.join(" | "));
  // US5-3: cancel
  let dlg = await confirmDelete(pa, BASE + "/deals/1", "notes.docx");
  const q = await dlg.innerText(); await dlg.getByRole("link", { name: "[ CANCEL ]" }).click(); await pa.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  const still = (await rows(pa)).some((r) => r.startsWith("notes.docx")) && sql("select count(*) from files where deal_id=1 and name='notes.docx'") === "1";
  check("US5 scenario 3", q.includes("Delete notes.docx? This can't be undone.") && still && sql("select count(*) from timeline_events where kind='file_deleted' and deal_id=1") === "1", `question=${JSON.stringify(q)} still listed=${still} url=${pa.url()}`);
  // US5-1: delete notes.docx from deal 1
  const docId = fid("notes.docx", "deal_id=1"); const docPath = sql(`select storage_path from files where id=${docId}`);
  const diskBefore = fs.existsSync(path.join(".fake-storage", encodeURIComponent("crm-files/" + docPath)));
  dlg = await confirmDelete(pa, BASE + "/deals/1", "notes.docx");
  await Promise.all([pa.waitForLoadState("networkidle"), dlg.getByRole("button", { name: "[ DELETE ]" }).click()]); await pa.waitForTimeout(800);
  const body51 = await pa.textContent("body"); const r51 = await rows(pa);
  const diskAfter = fs.existsSync(path.join(".fake-storage", encodeURIComponent("crm-files/" + docPath)));
  const a1 = await ada.request.get(`${BASE}/files/${docId}/download`, { maxRedirects: 0 }); const a2 = await ada.request.get(`${BASE}/files/${docId}/preview`, { maxRedirects: 0 });
  await pa.goto(`${BASE}/files/${docId}/download`); const goneMsg = (await pa.textContent("body")).includes("This file doesn't exist any more.");
  check("US5 scenario 1", body51.includes("File deleted.") && !r51.some((r) => r.startsWith("notes.docx")) && diskBefore && !diskAfter && /reason=gone/.test(a1.headers().location) && /reason=gone/.test(a2.headers().location) && goneMsg,
    `notice=${body51.includes("File deleted.")} rows=${r51.length} contents in storage before=${diskBefore} after=${diskAfter} download→${a1.headers().location} preview→${a2.headers().location} message=${goneMsg}`);
  // US4-2
  await pa.goto(BASE + "/deals/1"); tl = await timeline(pa);
  const del = tl.find((x) => x.t.includes("Ada Fake deleted notes.docx")); const added = tl.find((x) => x.t.includes("Ada Fake added notes.docx"));
  const oldv = tl.filter((x) => x.t.includes("old-version.pdf"));
  check("US4 scenario 2", del && /FILE/i.test(del.t) && /\d{1,2}:\d{2}/.test(del.t) && added && added.href === null && oldv.length === 2 && oldv.every((x) => x.href === null), `deleted=${del && del.t} added=${added && added.t} link=${added && added.href}; seeded old-version.pdf: ${JSON.stringify(oldv)}`);
  // US4-3: person 1 and organisation 1 timelines show deal 1's FILE entries
  const n43 = []; let ok43 = true;
  for (const u of ["/people/1", "/organisations/1"]) { await pa.goto(BASE + u); const t = await timeline(pa); const a = t.find((x) => x.t.includes("added proposal.pdf (2.1 MB)")); const d = t.find((x) => x.t.includes("deleted notes.docx")); n43.push(`${u}: added=${a && a.t.slice(0, 90)} (${a && a.href}) deleted=${d && d.t.slice(0, 90)}`); ok43 = ok43 && a && d && a.href; }
  check("US4 scenario 3", ok43, n43.join(" | "));
  // US4-4: contract.pdf on private deal 44 (person 22, organisation 2)
  const n44 = []; let ok44 = true;
  for (const u of ["/people/22", "/organisations/2"]) { await pa.goto(BASE + u); const ta = (await timeline(pa)).filter((x) => x.t.includes("contract.pdf")).length; await pg.goto(BASE + u); const tg = (await timeline(pg)).filter((x) => x.t.includes("contract.pdf")).length; n44.push(`${u}: Ada ${ta} entries, Grace ${tg}`); ok44 = ok44 && ta > 0 && tg === 0; }
  check("US4 scenario 4", ok44, n44.join(" | "));
  // US5-2: Grace deletes after Ada's page loaded
  await pa.goto(BASE + "/deals/1"); await pg.goto(BASE + "/deals/1");
  const shotId = fid("shot.png", "deal_id=1");
  dlg = await confirmDelete(pg, BASE + "/deals/1", "shot.png"); await Promise.all([pg.waitForLoadState("networkidle"), dlg.getByRole("button", { name: "[ DELETE ]" }).click()]);
  await pa.getByRole("link", { name: "Delete shot.png" }).click(); await pa.waitForLoadState("networkidle"); await pa.waitForTimeout(800);
  const delMsg = (await pa.textContent("body")).includes("This file doesn't exist any more."); const delUrl = pa.url();
  await pa.goto(BASE + "/deals/1"); await pg.goto(BASE + "/deals/1");
  const csvId = (await upload(pg, [f("data.csv")]), fid("data.csv", "deal_id=1"));
  await pa.goto(BASE + "/deals/1");
  dlg = await confirmDelete(pg, BASE + "/deals/1", "data.csv"); await Promise.all([pg.waitForLoadState("networkidle"), dlg.getByRole("button", { name: "[ DELETE ]" }).click()]);
  await pa.getByRole("link", { name: "Download data.csv" }).click(); await pa.waitForLoadState("networkidle");
  const dlMsg = (await pa.textContent("body")).includes("This file doesn't exist any more.");
  const evs = sql("select count(*) from timeline_events where kind='file_deleted' and deleted_file_id in (" + shotId + "," + csvId + ")");
  check("US5 scenario 2", delMsg && dlMsg && evs === "2", `[ DELETE ] on a file already deleted → url=${delUrl.replace(BASE, "")} message shown=${delMsg}; [ DOWNLOAD ] → ${pa.url().replace(BASE, "")} message=${dlMsg}; deleted entries=${evs}`);
  // Edge 1: archived deal 43 (old-brief.docx), archived person / organisation
  await pa.goto(BASE + "/deals/43"); const e1 = await pa.locator('section[aria-label="Files"]').innerText();
  const oldId = fid("old-brief.docx", "deal_id=43");
  const [dl1] = await Promise.all([pa.waitForEvent("download"), pa.getByRole("link", { name: "Download old-brief.docx" }).click()]);
  const fay = sql("select id from persons where archived_at is not null limit 1"), oorg = sql("select id from organisations where archived_at is not null limit 1");
  await pa.goto(`${BASE}/people/${fay}`); const e1p = await pa.locator('section[aria-label="Files"]').innerText();
  await pa.goto(`${BASE}/organisations/${oorg}`); const e1o = await pa.locator('section[aria-label="Files"]').innerText();
  await pa.goto(`${BASE}/deals/43?delete-file=${oldId}`); const noBox = await pa.getByRole("alertdialog").count();
  // direct requests: an upload sent to deal 43 and a delete form pointed at it
  await pa.goto(BASE + "/organisations/7");
  await pa.route("**/organisations/7", (route) => { const r = route.request(); if (r.method() === "POST" && (r.postData() || "").includes('"kind":"organisation"')) return route.continue({ postData: r.postData().replace('"kind":"organisation","id":7', '"kind":"deal","id":43') }); return route.continue(); });
  const st1 = await upload(pa, [f("data.csv")]); await pa.unroute("**/organisations/7");
  await upload(pa, [f("data.csv")]); const own = fid("data.csv", "organisation_id=7");
  await pa.goto(`${BASE}/organisations/7?delete-file=${own}`);
  await pa.evaluate(([x]) => { const fm = document.querySelector('[role="alertdialog"] form'); fm.querySelector("[name=target]").value = "deal"; fm.querySelector("[name=targetId]").value = "43"; fm.querySelector("[name=fileId]").value = x; }, [oldId]);
  await Promise.all([pa.waitForLoadState("networkidle"), pa.getByRole("alertdialog").getByRole("button", { name: "[ DELETE ]" }).click()]); await pa.waitForTimeout(800);
  const delArch = (await pa.textContent("body")).includes("Restore this record before changing its files.");
  check("Edge case 1", !e1.includes("[ ADD FILE ]") && !e1.includes("[ DELETE ]") && e1.includes("[ PREVIEW ]") === false && e1.includes("[ DOWNLOAD ]") && dl1.suggestedFilename() === "old-brief.docx" && !e1p.includes("[ ADD FILE ]") && !e1o.includes("[ ADD FILE ]") && noBox === 0 && st1.includes("Restore this record before changing its files.") && delArch && sql(`select count(*) from files where id=${oldId}`) === "1",
    `deal 43 section=${JSON.stringify(e1)} download=${dl1.suggestedFilename()}; person ${fay}=${JSON.stringify(e1p)}; org ${oorg}=${JSON.stringify(e1o)}; confirmation opened=${noBox}; upload → ${JSON.stringify(st1)}; delete → ${pa.url().replace(BASE, "")} message=${delArch}`);
  // Edge 3: won 45, lost 48
  const n3 = []; let ok3 = true;
  for (const d of [45, 48]) { await pa.goto(`${BASE}/deals/${d}`); const st = await upload(pa, [f("small.pdf")]); const s = await pa.locator('section[aria-label="Files"]').innerText(); n3.push(`${d}: ${JSON.stringify(st)} ${JSON.stringify(s.slice(0, 160))}`); ok3 = ok3 && st.includes("File added.") && s.includes("[ ADD FILE ]") && s.includes("[ DELETE ]") && s.includes("small.pdf"); }
  check("Edge case 3", ok3, n3.join(" | "));
  // Edge 2: Ada deletes deal 48 (person 19, organisation 9) for good
  const f48 = fid("small.pdf", "deal_id=48"); const p48 = sql(`select storage_path from files where id=${f48}`);
  const disk48 = () => fs.existsSync(path.join(".fake-storage", encodeURIComponent("crm-files/" + p48)));
  const before2 = disk48();
  await pa.goto(BASE + "/people/19"); const pt1 = (await timeline(pa)).filter((x) => x.t.includes("small.pdf")).length;
  await pa.goto(BASE + "/deals/48?confirm=delete"); await Promise.all([pa.waitForLoadState("networkidle"), pa.getByRole("alertdialog").getByRole("button").first().click()]); await pa.waitForTimeout(800);
  const gone48 = sql("select count(*) from deals where id=48");
  await pa.goto(`${BASE}/files/${f48}/download`); const m2 = (await pa.textContent("body")).includes("This file doesn't exist or you can't see it.");
  await pa.goto(BASE + "/people/19"); const pt2 = (await timeline(pa)).filter((x) => x.t.includes("small.pdf")).length;
  check("Edge case 2", gone48 === "0" && before2 && !disk48() && m2 && pt1 > 0 && pt2 === 0, `deal rows left=${gone48}; contents before=${before2} after=${disk48()}; old address message=${m2}; person 19 FILE entries before=${pt1} after=${pt2}`);
  // Edge 4: a name with markup and other scripts
  const nm = "<b>bold</b> ü日本 a\\b:c.txt"; // given in memory: Chromium drops a file on disk whose name has a backslash
  await pa.goto(BASE + "/organisations/8"); await upload(pa, [{ name: nm, mimeType: "text/plain", buffer: Buffer.from("markup name\n") }]);
  const cell = await pa.locator("table.files-table a.nm").first().evaluate((a) => ({ text: a.textContent, html: a.innerHTML, href: a.getAttribute("href"), b: a.querySelectorAll("b").length }));
  const [dl4] = await Promise.all([pa.waitForEvent("download"), pa.locator("table.files-table a.nm").first().click()]);
  const tl4 = (await timeline(pa)).find((x) => x.t.includes("bold"));
  // Headless Chromium here names any non-ASCII download "download": read the name Storage is told to give instead.
  const loc4 = (await ada.request.get(BASE + cell.href, { maxRedirects: 0 })).headers().location;
  const cd4 = (await ada.request.get(loc4)).headers()["content-disposition"] || "";
  const saved4 = decodeURIComponent((cd4.match(/filename\*=UTF-8''([^;]+)/) || [])[1] || "");
  check("Edge case 4", cell.text === nm && cell.b === 0 && /^\/files\/\d+\/download$/.test(cell.href) && !!dl4 && saved4 !== "" && !/[\/\\<>:]/.test(saved4) && saved4.includes("ü日本") && /^attachment/.test(cd4) && tl4 && tl4.t.includes(nm),
    `cell text=${JSON.stringify(cell.text)} <b> elements=${cell.b} href=${cell.href}; download started; Storage told to save it as ${JSON.stringify(saved4)} (${cd4}); timeline=${tl4 && tl4.t}; long name: see scenarios-sf116-a.js`);
  // Edge 5: text renamed fake.png, svg, html
  await pa.goto(BASE + "/organisations/8"); await upload(pa, [f("fake.png"), f("pic.svg"), f("page.html")]);
  const n5 = []; let ok5 = true;
  for (const n of ["fake.png", "pic.svg", "page.html"]) {
    const prev = await pa.getByRole("link", { name: `Preview ${n}` }).count(); const kind = sql(`select kind from files where organisation_id=8 and name='${n}'`);
    const [d] = await Promise.all([pa.waitForEvent("download", { timeout: 10000 }).catch(() => null), pa.locator("table.files-table a.nm", { hasText: n }).click()]);
    const pv = await ada.request.get(`${BASE}/files/${fid(n, "organisation_id=8")}/preview`, { maxRedirects: 0 });
    n5.push(`${n}: kind=${kind} preview links=${prev} click→download=${d && d.suggestedFilename()} preview route→${pv.headers().location.replace(BASE, "")}`);
    ok5 = ok5 && kind === "other" && prev === 0 && d && pv.headers().location.endsWith("/download");
  }
  check("Edge case 5", ok5, n5.join(" | "));
  // Edge 6: two users upload at the same moment to organisation 9
  await pa.goto(BASE + "/organisations/8"); await pg.goto(BASE + "/organisations/8");
  await Promise.all([upload(pa, [f("small.pdf")]), upload(pg, [f("data.csv")])]);
  await pa.reload(); const r6 = (await rows(pa)).map((r) => r.split("\t")[0]); const t6 = (await timeline(pa)).filter((x) => /added (small\.pdf|data\.csv)/.test(x.t)).length;
  check("Edge case 6", r6.includes("small.pdf") && r6.includes("data.csv") && t6 === 2, `rows=${r6} added entries=${t6}`);
  // Edge 7: both delete the same file at once
  const t7 = fid("small.pdf", "organisation_id=8");
  const d1 = await confirmDelete(pa, BASE + "/organisations/8", "small.pdf"); const d2 = await confirmDelete(pg, BASE + "/organisations/8", "small.pdf");
  await Promise.all([Promise.all([pa.waitForLoadState("networkidle"), d1.getByRole("button", { name: "[ DELETE ]" }).click()]), Promise.all([pg.waitForLoadState("networkidle"), d2.getByRole("button", { name: "[ DELETE ]" }).click()])]);
  await pa.waitForTimeout(800);
  const m7 = [await pa.textContent("body"), await pg.textContent("body")].map((b) => (b.includes("File deleted.") ? "deleted" : b.includes("This file doesn't exist any more.") ? "gone" : "?")).sort();
  const ev7 = sql(`select count(*) from timeline_events where kind='file_deleted' and deleted_file_id=${t7}`);
  check("Edge case 7", ev7 === "1" && m7.join() === "deleted,gone", `deleted entries=${ev7} messages=${m7}`);
  // Edge 10: Margaret uploads, then is deactivated
  const mg = await (await browser.newContext()).newPage(); await signIn(mg, BASE, "margaret@barnacle.ai", "Margaret Fake");
  await mg.goto(BASE + "/organisations/7"); await upload(mg, [f("small.pdf")]);
  await pa.goto(BASE + "/admin/users"); await Promise.all([pa.waitForLoadState("networkidle"), pa.locator("tr", { hasText: "margaret@barnacle.ai" }).getByRole("button", { name: /Deactivate/i }).click()]);
  await pa.waitForTimeout(500);
  await pa.goto(BASE + "/organisations/7"); const r10 = (await rows(pa)).find((r) => r.startsWith("small.pdf"));
  check("Edge case 10", r10 && r10.includes("Margaret Fake (deactivated)") && sql("select status from users where id=4") === "deactivated", `row=${JSON.stringify(r10)}`);
  // Edge 11: person 1 is deal 1's main person
  await pa.goto(BASE + "/deals/1"); const dn = (await rows(pa)).map((r) => r.split("\t")[0]);
  await pa.goto(BASE + "/people/1"); const pn = (await rows(pa)).map((r) => r.split("\t")[0]); const ptl = (await timeline(pa)).filter((x) => x.t.includes("proposal.pdf")).length;
  check("Edge case 11", !dn.includes("fake.png") && pn.join() === "fake.png" && ptl > 0, `deal 1 lists ${dn}; person 1 lists ${pn}; person timeline proposal.pdf entries=${ptl}`);
  // Edge 8: app on :3001 with Storage unreachable
  const p8 = await (await browser.newContext({ acceptDownloads: true })).newPage(); const B8 = "http://localhost:3001";
  await signIn(p8, B8, "ada@barnacle.ai", "Ada Fake");
  await p8.goto(B8 + "/deals/1"); const st8 = await upload(p8, [f("small.pdf")]); await p8.reload();
  const page8 = await p8.locator('section[aria-label="Files"]').innerText(); const ok8page = (await p8.textContent("body")).includes("// TIMELINE");
  const pid = fid("proposal.pdf", "deal_id=1"); const pngId = fid("site-mockup.png", "deal_id=1");
  await p8.goto(`${B8}/files/${pid}/download`); const m8a = (await p8.textContent("body")).includes("Files can't be reached right now. Try again in a minute.");
  await p8.goto(`${B8}/files/${pid}/preview`); const m8b = (await p8.textContent("body")).includes("Files can't be reached right now. Try again in a minute.");
  await p8.goto(`${B8}/deals/1?file=${pngId}`); const box8 = await p8.getByRole("dialog").count();
  const boxText8 = box8 ? await p8.getByRole("dialog").innerText() : ""; const img8 = box8 ? await p8.$eval(".filebox img", (i) => i.complete && i.naturalWidth) : null;
  const listed8 = sql("select count(*) from files where deal_id=1 and name='small.pdf'");
  check("Edge case 8", st8.includes("Files can't be reached right now. Try again in a minute.") && m8a && m8b && ok8page && listed8 === "0" && page8.includes("proposal.pdf"),
    `upload → ${JSON.stringify(st8)}; download message=${m8a} preview message=${m8b}; page still shows files and timeline=${ok8page}; preview box opens=${box8} text=${JSON.stringify(boxText8)} image width=${img8}; small.pdf listed=${listed8}`);
  // Edge 9: app on :3002 whose Storage fails every delete
  const p9 = await (await browser.newContext()).newPage(); const B9 = "http://localhost:3002";
  await signIn(p9, B9, "ada@barnacle.ai", "Ada Fake");
  await p9.goto(B9 + "/organisations/6"); await upload(p9, [f("shot.png")]); const id9 = fid("shot.png", "organisation_id=6"); const path9 = sql(`select storage_path from files where id=${id9}`);
  const d9 = await confirmDelete(p9, B9 + "/organisations/6", "shot.png"); await Promise.all([p9.waitForLoadState("networkidle"), d9.getByRole("button", { name: "[ DELETE ]" }).click()]); await p9.waitForTimeout(800);
  const b9 = await p9.textContent("body"); const r9 = await rows(p9);
  await p9.goto(`${B9}/files/${id9}/download`); const m9 = (await p9.textContent("body")).includes("This file doesn't exist any more.");
  const queued = sql(`select count(*) from file_cleanup where storage_path='${path9}'`);
  const onDisk = fs.existsSync(path.join(".fake-storage", encodeURIComponent("crm-files/" + path9)));
  // later: a file action on the normal app sweeps it (due_at moved to now)
  sql(`update file_cleanup set due_at = now() where storage_path='${path9}'`);
  await pa.goto(BASE + "/organisations/8"); await upload(pa, [f("data.csv")]);
  const after9 = sql(`select count(*) from file_cleanup where storage_path='${path9}'`); const onDisk2 = fs.existsSync(path.join(".fake-storage", encodeURIComponent("crm-files/" + path9)));
  check("Edge case 9", b9.includes("File deleted.") && !r9.some((r) => r.startsWith("shot.png")) && m9 && queued === "1" && onDisk && after9 === "0" && !onDisk2,
    `notice=${b9.includes("File deleted.")} still listed=${r9.some((r) => r.startsWith("shot.png"))} old address message=${m9}; queued for clean-up=${queued} contents left=${onDisk}; after a later upload on :3000: queued=${after9} contents left=${onDisk2}`);
  await browser.close();
  fs.writeFileSync("/tmp/sf116-c.json", JSON.stringify(results, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
