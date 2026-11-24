// SF-116 US3 (private rules, direct addresses) against :3000/crm_dev on fresh fake data (reset-db.sh first; run after
// or without scenarios-sf116-a.js). Ada Fake owns the private deal "Fake secret project" (44, contract.pdf) and Pat
// Privatefake (33, cv-fake.pdf); Grace Fake (admin) is hidden from both. US3-5 waits 61 s.
const fs = require("fs");
const { chromium, check, signIn, signOut, results } = require("./lib.js");
const { BASE, sql, sha, makeFiles, upload, rows } = require("./sf116-lib.js");
const fileId = (name, where) => Number(sql(`select id from files where name='${name}' and ${where} order by id limit 1`));
(async () => {
  const f = makeFiles();
  const browser = await chromium.launch();
  const ada = await browser.newContext({ acceptDownloads: true }); const pa = await ada.newPage();
  const grace = await browser.newContext({ acceptDownloads: true }); const pg = await grace.newPage();
  await signIn(pa, BASE, "ada@barnacle.ai", "Ada Fake");
  await signIn(pg, BASE, "grace@barnacle.ai", "Grace Fake");
  const contract = fileId("contract.pdf", "deal_id=44"), cv = fileId("cv-fake.pdf", "person_id=33");
  // US3-1
  const pages = ["/deals/list", "/deals", "/organisations/2", "/people/22", "/people", "/organisations", "/activities", "/notifications", "/ambassadors", "/deals/44", "/people/33"];
  const leaks = [];
  for (const u of pages) { await pg.goto(BASE + u); const t = await pg.textContent("body"); if (/contract\.pdf|cv-fake\.pdf/.test(t)) leaks.push(u); }
  await pa.goto(BASE + "/organisations/2"); const adaOrg = await pa.textContent("body");
  await pg.goto(BASE + "/organisations/2"); const gOrgCount = await pg.locator('section[aria-label="Files"] .sect').innerText();
  await pa.goto(BASE + "/organisations/2"); const aOrgCount = await pa.locator('section[aria-label="Files"] .sect').innerText();
  check("US3 scenario 1", leaks.length === 0 && /contract\.pdf/.test(adaOrg), `pages with a hidden file for Grace: ${JSON.stringify(leaks)}; Ada sees contract.pdf on org 2 timeline=${/contract\.pdf/.test(adaOrg)}; FILES counts Grace=${gOrgCount.split("\n")[0]} Ada=${aOrgCount.split("\n")[0]}`);
  // US3-2
  const res = [];
  for (const u of [`/files/${contract}/download`, `/files/${contract}/preview`, `/files/${cv}/download`, `/files/${cv}/preview`, `/files/999999/download`, `/files/999999/preview`]) {
    const seen = []; pg.on("request", (r) => seen.push(r.url()));
    const r = await pg.goto(BASE + u); const t = await pg.locator("main").innerText().catch(() => "");
    pg.removeAllListeners("request");
    res.push({ u, final: pg.url().replace(BASE, ""), msg: t.includes("This file doesn't exist or you can't see it."), storage: seen.some((x) => x.includes("fake-storage")), status: r.status() });
  }
  const same = new Set(res.map((x) => x.final)).size === 1;
  check("US3 scenario 2", res.every((x) => x.msg && !x.storage) && same, JSON.stringify(res));
  // US3-3: signed out
  const anon = await browser.newContext({ acceptDownloads: true }); const pn = await anon.newPage();
  const shared = fileId("proposal.pdf", "deal_id=1");
  const r1 = await anon.request.get(`${BASE}/files/${shared}/download`, { maxRedirects: 0 });
  const r2 = await anon.request.get(`${BASE}/files/${contract}/preview`, { maxRedirects: 0 });
  await pn.goto(`${BASE}/files/${contract}/download`); const signInUrl = pn.url();
  const next = new URL(signInUrl).searchParams.get("next");
  await signIn(pn, BASE, "grace@barnacle.ai", "Grace Fake", next || "");
  const graceAfter = pn.url().replace(BASE, ""); const graceMsg = (await pn.textContent("body")).includes("This file doesn't exist or you can't see it.");
  const anon2 = await browser.newContext({ acceptDownloads: true }); const pn2 = await anon2.newPage();
  await pn2.goto(`${BASE}/files/${contract}/download`);
  const n2 = new URL(pn2.url()).searchParams.get("next");
  const [dl] = await Promise.all([pn2.waitForEvent("download", { timeout: 15000 }).catch(() => null), signIn(pn2, BASE, "ada@barnacle.ai", "Ada Fake", n2 || "").catch(() => {})]);
  check("US3 scenario 3", r1.status() >= 300 && r1.status() < 400 && /sign-in/.test(r1.headers().location) && /sign-in/.test(r2.headers().location) && /sign-in/.test(signInUrl) && graceMsg && !!dl && dl.suggestedFilename() === "contract.pdf",
    `anon → ${r1.status()} ${r1.headers().location}; preview → ${r2.headers().location}; browser sign-in url=${signInUrl}; Grace after sign-in at ${graceAfter} message=${graceMsg}; Ada after sign-in download=${dl && dl.suggestedFilename()}`);
  // US3-4: Grace copies a shared file address, then deal 1 becomes private (created/owned by Ada)
  const addr = `${BASE}/files/${fileId("site-mockup.png", "deal_id=1")}/download`;
  const before = await grace.request.get(addr, { maxRedirects: 0 });
  sql("update deals set private=true where id=1");
  const after = await grace.request.get(addr, { maxRedirects: 0 });
  sql("update deals set private=false where id=1");
  check("US3 scenario 4", before.status() === 303 && /fake-storage/.test(before.headers().location) && after.status() === 303 && /unavailable\?reason=hidden/.test(after.headers().location), `before: ${before.headers().location.slice(0, 70)} after private: ${after.headers().location}`);
  // US3-5
  const dloc = (await ada.request.get(addr, { maxRedirects: 0 })).headers().location;
  const okNow = (await ada.request.get(dloc)).status();
  const other = sql(`select storage_path from files where name='proposal.pdf' and deal_id=1 limit 1`);
  const u = new URL(dloc); const swapped = `${u.origin}/dev/fake-storage/object/sign/crm-files/${other}${u.search}`;
  const otherFile = (await ada.request.get(swapped)).status();
  const sp = sql(`select storage_path from files where name='site-mockup.png' and deal_id=1`);
  const direct = [];
  for (const p of [`/object/public/crm-files/${sp}`, `/object/crm-files/${sp}`, `/object/authenticated/crm-files/${sp}`]) direct.push(`${p.split("/")[2]}=${(await anon.request.get(`${BASE}/dev/fake-storage${p}`)).status()}`);
  // the upload address of a real upload, captured by the browser
  await pa.goto(BASE + "/people/4");
  let upUrl = null;
  await pa.route("**/dev/fake-storage/object/upload/**", async (route) => { upUrl = route.request().url(); await route.continue(); });
  await upload(pa, [f("data.csv")]); await pa.unroute("**/dev/fake-storage/object/upload/**");
  const upRead = (await ada.request.get(upUrl)).status();
  const upAgain = (await ada.request.put(upUrl, { data: Buffer.from("replaced"), headers: { "content-type": "application/octet-stream" } })).status();
  const uu = new URL(upUrl); const upOther = (await ada.request.put(`${uu.origin}/dev/fake-storage/object/upload/sign/crm-files/files/00000000-0000-4000-8000-000000000000${uu.search}`, { data: Buffer.from("x") })).status();
  const csvPath = sql("select storage_path from files where person_id=4 and name='data.csv' order by id desc limit 1");
  const stillCsv = (await ada.request.get(`${BASE}/files/${sql("select id from files where person_id=4 and name='data.csv' order by id desc limit 1")}/download`)).body().then((b) => b.toString());
  const upPath = new URL(upUrl).pathname.includes(csvPath);
  // finishing an upload started more than 2 hours ago
  await pa.route("**/dev/fake-storage/object/upload/**", async (route) => { sql("update file_uploads set created_at = now() - interval '2 hours 1 minute'"); await route.continue(); });
  const stOld = await upload(pa, [f("notes.docx")]); await pa.unroute("**/dev/fake-storage/object/upload/**");
  const oldListed = sql("select count(*) from files where person_id=4 and name='notes.docx'");
  console.log("waiting 61 s for the read address to expire…");
  await new Promise((r) => setTimeout(r, 61000));
  const expired = (await ada.request.get(dloc)).status();
  check("US3 scenario 5", okNow === 200 && otherFile >= 400 && direct.every((x) => !x.endsWith("=200")) && upRead >= 400 && upAgain >= 400 && upOther >= 400 && (await stillCsv) === "a,b\n1,2\n" && upPath && stOld.includes("notes.docx couldn't be uploaded. Try again.") && oldListed === "0" && expired >= 400,
    `read address now=${okNow}, same token on another file=${otherFile}, without the app: ${direct.join(" ")}; upload address: GET=${upRead}, PUT again=${upAgain}, other path=${upOther}, random path=${upPath}, file kept="${(await stillCsv).trim()}"; finish after 2 h: ${JSON.stringify(stOld)} listed=${oldListed}; read address after 61 s=${expired}`);
  // US3-6: Grace sends an upload and a delete for hidden records
  await pg.goto(BASE + "/organisations/5");
  await pg.route("**/organisations/5", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && (req.postData() || "").includes('"kind":"organisation"')) return route.continue({ postData: req.postData().replace('"kind":"organisation","id":5', '"kind":"deal","id":44') });
    return route.continue();
  });
  const st6 = await upload(pg, [f("data.csv")]); await pg.unroute("**/organisations/5");
  const nContract = sql("select count(*) from files where deal_id=44");
  await pg.goto(BASE + "/organisations/5"); await upload(pg, [f("data.csv")]);
  const own = sql("select id from files where organisation_id=5 order by id desc limit 1");
  let del6 = "no own file to delete";
  if (own) {
    await pg.goto(`${BASE}/organisations/5?delete-file=${own}`);
    await pg.evaluate(([fid]) => { const fm = document.querySelector('[role="alertdialog"] form'); fm.querySelector('[name=target]').value = "deal"; fm.querySelector('[name=targetId]').value = "44"; fm.querySelector('[name=fileId]').value = String(fid); }, [contract]);
    await Promise.all([pg.waitForLoadState("networkidle"), pg.locator('[role="alertdialog"] button', { hasText: "[ DELETE ]" }).click()]);
    await pg.waitForTimeout(800);
    del6 = `${pg.url().replace(BASE, "")} msg=${(await pg.textContent("body")).includes("This file doesn't exist or you can't see it.")}`;
  }
  const contractStill = sql(`select count(*) from files where id=${contract}`);
  check("US3 scenario 6", st6.includes("This record doesn't exist or you can't see it.") && nContract === "1" && /msg=true/.test(del6) && contractStill === "1", `upload answer=${JSON.stringify(st6)} files on deal 44=${nContract}; delete → ${del6}; contract.pdf still there=${contractStill}`);
  // US3-7: hand over Alan Fake's private deal and person; a file on each first (moved there by SQL: nobody else can see them)
  await pa.goto(BASE + "/organisations/6"); await upload(pa, [f("small.pdf"), f("shot.png")]);
  sql("update files set organisation_id=null, deal_id=52, added_by=5 where organisation_id=6 and name='small.pdf'");
  sql("update files set organisation_id=null, person_id=35, added_by=5 where organisation_id=6 and name='shot.png'");
  sql("update timeline_events set organisation_id=null, deal_id=52 where kind='file_added' and file_name='small.pdf' and organisation_id=6");
  sql("update timeline_events set organisation_id=null, person_id=35 where kind='file_added' and file_name='shot.png' and organisation_id=6");
  const linus = await browser.newContext({ acceptDownloads: true }); const pl = await linus.newPage();
  await signIn(pl, BASE, "linus@barnacle.ai", "Linus Fake");
  await pl.goto(BASE + "/deals/52"); const beforeHand = (await pl.textContent("body")).includes("small.pdf");
  await pa.goto(BASE + "/admin/users?handover=5");
  await pa.selectOption('select[name="toUserId"]', "3");
  await Promise.all([pa.waitForLoadState("networkidle"), pa.locator('button[type=submit]', { hasText: /HAND OVER/i }).last().click()]);
  await pa.waitForTimeout(800);
  await pl.goto(BASE + "/deals/52"); const dRows = await rows(pl);
  const [dl7] = await Promise.all([pl.waitForEvent("download"), pl.getByRole("link", { name: "Download small.pdf" }).click()]);
  const same7 = sha(fs.readFileSync(await dl7.path())) === sha(fs.readFileSync(f("small.pdf")));
  const pv7 = await linus.request.get(BASE + (await pl.getByRole("link", { name: "Preview small.pdf" }).getAttribute("href")), { maxRedirects: 0 });
  await pl.goto(BASE + "/people/35"); const pRows = await rows(pl);
  await pl.getByRole("link", { name: "Preview shot.png" }).click(); await pl.getByRole("dialog", { name: /shot\.png/ }).waitFor({ timeout: 5000 }).catch(() => {});
  const img7 = await pl.$eval(".filebox img", (i) => i.complete && i.naturalWidth).catch(() => 0);
  check("US3 scenario 7", !beforeHand && dRows.some((x) => x.startsWith("small.pdf")) && same7 && pv7.status() === 303 && /fake-storage/.test(pv7.headers().location) && pRows.some((x) => x.startsWith("shot.png")) && img7 > 0,
    `Linus before hand-over saw it=${beforeHand}; after: deal rows=${JSON.stringify(dRows)} download same bytes=${same7} preview=${pv7.status()}; person rows=${JSON.stringify(pRows)} image shown=${img7}`);
  await browser.close();
  fs.writeFileSync("/tmp/sf116-b.json", JSON.stringify(results, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
