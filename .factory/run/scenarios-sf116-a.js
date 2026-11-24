// SF-116 US1 + US2 against :3000/crm_dev on fresh fake data (reset-db.sh first). Ada Fake throughout.
const fs = require("fs");
const { chromium, check, signIn, results } = require("./lib.js");
const { BASE, sql, sha, makeFiles, upload, filesText, rows } = require("./sf116-lib.js");
(async () => {
  const f = makeFiles();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await signIn(page, BASE, "ada@barnacle.ai", "Ada Fake");
  const today = sql("select to_char(now() at time zone 'Europe/London','FMDD Mon YYYY')");
  // US1-1: organisation Example Gyms Fake (2)
  await page.goto(BASE + "/organisations/2");
  let st = await upload(page, [f("proposal.pdf")]);
  let r = await rows(page);
  check("US1 scenario 1", st.includes("File added.") && /^proposal\.pdf\s+PDF\s+2\.1 MB\s+Ada Fake\s+/.test(r[0] || ""), `status=${JSON.stringify(st)} first row=${JSON.stringify(r[0])} today=${today}`);
  await page.reload(); r = await rows(page);
  check("US1 scenario 1 (reload)", /proposal\.pdf/.test(r[0] || ""), JSON.stringify(r));
  // also person and deal
  await page.goto(BASE + "/people/2"); st = await upload(page, [f("shot.png")]); r = await rows(page);
  check("US1 scenario 1 (person)", st.includes("File added.") && /^shot\.png\s+PNG\s+70 B\s+Ada Fake/.test(r[0] || ""), JSON.stringify(r[0]));
  // US1-2, 3, 4: several files at once on Sample Studios Fake (3)
  await page.goto(BASE + "/organisations/3");
  st = await upload(page, [f("empty.txt"), f("shot.png"), f("big26.bin"), f("exact25.bin"), f("notes.docx")]);
  r = await rows(page);
  const names = r.map((x) => x.split("\t")[0].trim());
  const db3 = sql("select string_agg(name||':'||size, ',' order by id) from files where organisation_id=3");
  const ups = sql("select count(*) from file_uploads");
  check("US1 scenario 2", st.includes("File added.") && st.includes("empty.txt is empty.") && st.includes("big26.bin is over 25 MB, the most a file can be.") && names.includes("shot.png") && names.includes("notes.docx") && !names.includes("big26.bin") && !names.includes("empty.txt"), `status=${JSON.stringify(st)} names=${names} db=${db3}`);
  check("US1 scenario 3", st.includes("big26.bin is over 25 MB, the most a file can be.") && db3.includes("exact25.bin:26214400") && !db3.includes("big26") && ups === "0", `db=${db3} pending uploads=${ups}`);
  check("US1 scenario 4", st.includes("empty.txt is empty.") && !db3.includes("empty.txt"), `db=${db3}`);
  // Long name (edge 4 too)
  st = await upload(page, [{ name: "n".repeat(252) + ".txt", mimeType: "text/plain", buffer: Buffer.from("x") }]);
  check("Edge case 4 (long name)", st.includes("n".repeat(40) + "… has a name over 255 characters."), JSON.stringify(st));
  // US1-5: progress + dropped connection on person 3
  await page.goto(BASE + "/people/3");
  const seen = new Set();
  await page.route("**/dev/fake-storage/object/upload/**", async (route) => { await new Promise((res) => setTimeout(res, 1500)); await route.continue(); });
  await page.locator('input[aria-label="Files to add"]').setInputFiles([f("proposal.pdf")]);
  for (let i = 0; i < 60; i++) { const t = await page.locator(".upload-status .uploading").allInnerTexts(); t.forEach((x) => seen.add(x)); if (await page.locator(".upload-status .notice, .upload-status .err").count()) break; await page.waitForTimeout(50); }
  await page.unroute("**/dev/fake-storage/object/upload/**");
  const okProgress = [...seen].length > 0 && [...seen].every((x) => /^Uploading proposal\.pdf… \d+%$/.test(x));
  await page.route("**/dev/fake-storage/object/upload/**", (route) => route.abort("connectionreset"));
  st = await upload(page, [f("notes.docx")]);
  await page.unroute("**/dev/fake-storage/object/upload/**");
  await page.reload(); r = await rows(page);
  check("US1 scenario 5", okProgress && st.includes("notes.docx couldn't be uploaded. Try again.") && !r.some((x) => x.startsWith("notes.docx")), `progress=${JSON.stringify([...seen])} status=${JSON.stringify(st)} rows=${JSON.stringify(r)}`);
  // US1-6: deal 1 already has proposal.pdf
  await page.goto(BASE + "/deals/1"); st = await upload(page, [f("proposal.pdf")]); r = await rows(page);
  check("US1 scenario 6", r.filter((x) => x.startsWith("proposal.pdf")).length === 2 && sql("select count(*) from files where deal_id=1 and name='proposal.pdf'") === "2", JSON.stringify(r));
  // US2-1: deal 1 page
  const order = await page.evaluate(() => { const t = document.body.innerText; return [t.indexOf("// NEXT ACTIVITIES"), t.search(/\/\/ FILES \(\d+\)/), t.indexOf("// TIMELINE")]; });
  const heads = await page.locator("table.files-table thead th").allInnerTexts();
  const n = await page.locator("table.files-table tbody tr").count();
  const heading = await page.locator('section[aria-label="Files"] .sect').innerText();
  const rowsActs = await page.$$eval("table.files-table tbody tr", (trs) => trs.map((tr) => ({ n: tr.querySelector("a.nm").textContent, a: [...tr.querySelectorAll("td:last-child a, td:last-child button")].map((x) => x.textContent.trim()).join(" ") })));
  const times = sql("select string_agg(name, ',' order by added_at desc, id desc) from files where deal_id=1");
  const expActs = (nm) => (/\.(pdf|png)$/.test(nm) && nm !== "budget.xlsx" ? "[ PREVIEW ] [ DOWNLOAD ] [ DELETE ]" : "[ DOWNLOAD ] [ DELETE ]");
  const okActs = rowsActs.every((x) => x.a === expActs(x.n));
  await page.goto(BASE + "/organisations/4");
  const empty = await filesText(page);
  check("US2 scenario 1", order[0] < order[1] && order[1] < order[2] && heading.includes(`// FILES (${n})`) && heading.includes("[ ADD FILE ]") && heads.slice(0, 5).join("|") === "Name|Kind|Size|Added by|Added" && rowsActs.map((x) => x.n).join(",") === times && okActs && empty.includes("// FILES (0)") && empty.includes("No files yet.") && empty.includes("[ ADD FILE ]"), `order=${order} heading=${JSON.stringify(heading)} heads=${heads} rows=${JSON.stringify(rowsActs)} db order=${times} empty=${JSON.stringify(empty)}`);
  // US2-2: image box from the name and from [ PREVIEW ]
  await page.goto(BASE + "/deals/1");
  let ok2 = true; const notes2 = [];
  for (const how of ["name", "preview"]) {
    if (how === "name") await page.locator("table.files-table a.nm", { hasText: "site-mockup.png" }).click();
    else await page.getByRole("link", { name: "Preview site-mockup.png" }).click();
    const dlg = page.getByRole("dialog", { name: /site-mockup\.png/ });
    await dlg.waitFor();
    await page.waitForFunction(() => { const i = document.querySelector(".filebox img"); return i && i.complete; });
    const nat = await page.$eval(".filebox img", (i) => [i.naturalWidth, getComputedStyle(i).maxWidth, getComputedStyle(i).objectFit]);
    const txt = await dlg.innerText();
    await dlg.getByRole("link", { name: "[ CLOSE ]" }).click();
    await page.waitForFunction(() => !document.querySelector(".filebox"));
    const back = await page.locator('section[aria-label="Files"]').count();
    notes2.push(`${how}: img=${nat} text=${JSON.stringify(txt)} closed url=${page.url()}`);
    ok2 = ok2 && nat[0] > 0 && nat[2] === "contain" && /site-mockup\.png/.test(txt) && /\d+ B|KB|MB/.test(txt) && txt.includes("[ DOWNLOAD ]") && txt.includes("[ CLOSE ]") && back === 1;
  }
  check("US2 scenario 2", ok2, notes2.join(" | "));
  // US2-3: PDF opens in a new tab, inline application/pdf
  const pdfLink = page.locator("table.files-table a.nm", { hasText: "proposal.pdf" }).first();
  const target = await pdfLink.getAttribute("target");
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "Preview proposal.pdf" }).first().click()]);
  await popup.waitForLoadState().catch(() => {});
  const resp = await ctx.request.get(BASE + (await pdfLink.getAttribute("href")));
  const h = resp.headers();
  const pv = await ctx.request.get(BASE + (await page.getByRole("link", { name: "Preview proposal.pdf" }).first().getAttribute("href")), { maxRedirects: 0 });
  check("US2 scenario 3", target === "_blank" && !!popup && pv.status() === 303 && (pv.headers().location || "").includes("/dev/fake-storage/object/sign/") && !(pv.headers().location || "").includes("download=") && h["content-type"] === "application/pdf" && !/attachment/.test(h["content-disposition"] || ""), `target=${target} popup opened=${!!popup} preview 303 location=${(pv.headers().location||'').slice(0,80)} type=${h["content-type"]} disposition=${h["content-disposition"]}`);
  await popup.close();
  // US2-4: other kinds on Sample Studios Fake
  await page.goto(BASE + "/organisations/3");
  await upload(page, [f("pic.svg"), f("page.html"), f("data.csv")]);
  const notes4 = []; let ok4 = true;
  for (const nm of ["notes.docx", "pic.svg", "page.html", "data.csv"]) {
    console.log("US2-4", nm);
    const prev = await page.getByRole("link", { name: `Preview ${nm}` }).count();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.locator("table.files-table a.nm", { hasText: nm }).first().click()]);
    const kind = await page.locator("tr", { hasText: nm }).first().locator(".ft").innerText();
    notes4.push(`${nm}: preview links=${prev} download=${dl.suggestedFilename()} kind=${kind} url=${page.url()}`);
    ok4 = ok4 && prev === 0 && dl.suggestedFilename() === nm && page.url() === BASE + "/organisations/3";
  }
  check("US2 scenario 4", ok4, notes4.join(" | "));
  // US2-5: [ DOWNLOAD ] keeps name and bytes
  const notes5 = []; let ok5 = true;
  for (const [url, nm] of [["/organisations/3", "notes.docx"], ["/organisations/2", "proposal.pdf"], ["/people/2", "shot.png"]]) {
    await page.goto(BASE + url);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("link", { name: `Download ${nm}` }).first().click()]);
    const same = sha(fs.readFileSync(await dl.path())) === sha(fs.readFileSync(f(nm)));
    notes5.push(`${nm}: saved as ${dl.suggestedFilename()} same bytes=${same}`);
    ok5 = ok5 && same && dl.suggestedFilename() === nm;
  }
  check("US2 scenario 5", ok5, notes5.join(" | "));
  // US2-6: the drawer of deal 1 on the board
  const pid = sql("select s.pipeline_id from deals d join stages s on s.id=d.stage_id where d.id=1");
  await page.goto(BASE + "/deals/1"); const pageRows = await rows(page);
  await page.goto(`${BASE}/deals?pipeline=${pid}&open=1`);
  const drawerRows = await rows(page); const dtext = await filesText(page);
  st = await upload(page, [f("small.pdf")]); const after = await rows(page);
  check("US2 scenario 6", JSON.stringify(drawerRows) === JSON.stringify(pageRows) && dtext.includes("[ ADD FILE ]") && st.includes("File added.") && after[0].startsWith("small.pdf"), `drawer=${JSON.stringify(dtext.slice(0, 300))} same as page=${JSON.stringify(drawerRows) === JSON.stringify(pageRows)} after upload first=${JSON.stringify(after[0])}`);
  await browser.close();
  fs.writeFileSync("/tmp/sf116-a.json", JSON.stringify(results, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
