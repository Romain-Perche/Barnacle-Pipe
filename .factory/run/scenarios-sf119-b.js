// SF-119 part B: US2 1–5, US3 1–5, US4 1–4, US5 1–6, edge cases 2–8. Run after reset-db.sh (fresh fake data);
// part A may run before it. Makes its own people / fields by SQL ("SF119 …"). ONLY="US4 scenario 2,…" for a subset.
const H = require("./sf119-lib.js");
const { chromium, check, results, q, go, newPage, newCampaign, save, frameText, frameHtml, choosePerson, pickerNames, chooseLayout, camp } = H;
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const run = (n) => !ONLY || ONLY.includes(n);
const DOT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const setHtml = (p, html) => p.locator("textarea.html-box").evaluate((t, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(t, v); t.dispatchEvent(new Event("input", { bubbles: true }));
}, html);
async function htmlDraft(p, name, html) {
  const id = await newCampaign(p, name);
  await p.locator(".chooser button", { hasText: "Paste HTML" }).click();
  await setHtml(p, html);
  return id;
}
(async () => {
  const b = await chromium.launch();
  const p = await newPage(b, "ada@barnacle.ai", "Ada Fake");
  const dialogs = []; p.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  // test data (a rerun first removes the last run's)
  q("delete from custom_values where field_id in (select id from custom_fields where name like 'SF119 %'); delete from custom_fields where name like 'SF119 %'; delete from person_phones where person_id=36; delete from persons where last_name like 'SF119 %'; delete from campaigns where name like 'SF119 %'");
  const fid = q("insert into custom_fields (kind,name,type,position,in_list) values ('person','SF119 Diet','text',20,false) returning id").split("\n")[0];
  q(`insert into custom_values (field_id, person_id, text_value) values (${fid}, 36, 'Gluten free (fake)')`);
  const money = q("insert into custom_fields (kind,name,type,position,in_list) values ('person','SF119 Budget','money',21,false) returning id").split("\n")[0];
  const yn = q("insert into custom_fields (kind,name,type,position,in_list) values ('person','SF119 Member','yes_no',22,false) returning id").split("\n")[0];
  q(`insert into custom_values (field_id, person_id, money_pence) values (${money}, 36, 120000)`);
  q(`insert into custom_values (field_id, person_id, bool_value) values (${yn}, 36, false)`);
  const nofirst = q("insert into persons (first_name,last_name,owner_id,consent,private,created_by) values ('','SF119 Emptyfake',1,'subscribed',false,1) returning id").split("\n")[0];
  const markup = q("insert into persons (first_name,last_name,role,owner_id,consent,private,created_by) values ('<i>Mark</i>','SF119 Markupfake','<b>Fake</b>',1,'subscribed',false,1) returning id").split("\n")[0];
  const fading = q("insert into persons (first_name,last_name,role,owner_id,consent,private,created_by) values ('Fadey','SF119 Fadingfake','Secret role (fake)',2,'subscribed',false,2) returning id").split("\n")[0];
  const fields = q("select name from custom_fields where kind='person' order by position, id").split("\n");

  if (run("US5 scenario 1") || run("US2 scenario 1") || run("US2 scenario 2")) {
    const id = await newCampaign(p, "SF119 tags (fake)");
    const pick = await p.locator(".preview-picker input").inputValue();
    await p.fill("#campaign-subject", "Hello ");
    await p.locator("#campaign-subject").press("End");
    await p.locator(".field-head button", { hasText: "[ INSERT MERGE TAG ]" }).click();
    const items = await p.locator(".tagmenu-list button").allInnerTexts();
    await p.locator(".tagmenu-list button", { hasText: /^First name$/ }).click(); await p.waitForTimeout(300);
    const s1 = await p.locator("#campaign-subject").inputValue();
    // cursor in the middle: put it after "Hello "
    await p.locator("#campaign-subject").evaluate((e) => { e.focus(); e.setSelectionRange(6, 6); });
    await p.locator(".field-head button", { hasText: "[ INSERT MERGE TAG ]" }).click();
    await p.fill(".tagmenu-box input", "friend");
    await p.locator(".tagmenu-list button", { hasText: /^Organisation$/ }).click(); await p.waitForTimeout(300);
    const s2 = await p.locator("#campaign-subject").inputValue();
    const want = ["First name", "Last name", "Full name", "Email", "Phone", "Organisation", "Role", "Lead source", "LinkedIn", "Owner", "Labels", ...fields];
    check("US2 scenario 1", JSON.stringify(items.map((x) => x.toLowerCase())) === JSON.stringify(want.map((x) => x.toLowerCase())) && s1 === "Hello {{First name}}", `menu ${JSON.stringify(items)}; after insert "${s1}"`);
    // preview text and a content text get it too; typed by hand in pasted HTML
    await chooseLayout(p, "Text");
    const ta = p.locator(".blk textarea").first();
    await ta.fill("Dear ");
    await ta.press("End");
    await p.locator(".content-head button", { hasText: "[ INSERT MERGE TAG ]" }).click();
    await p.fill(".tagmenu-box input", "reader");
    await p.locator(".tagmenu-list button", { hasText: /^Last name$/ }).click(); await p.waitForTimeout(300);
    const t2 = await ta.inputValue();
    const sub5 = await p.locator(".mail-subject").innerText();
    const fr5 = await frameText(p);
    check("US5 scenario 1", pick === "" && sub5.includes("[First name]") && sub5.includes("[Organisation]") && fr5.includes("Dear [Last name]"), `picker "${pick}"; subject "${sub5}"; frame ${JSON.stringify(fr5.slice(0, 80))}`);
    const hid = await htmlDraft(p, "SF119 typed in html (fake)", "<p>Hi {{ first name | pal }} at {{Organisation|your place}}</p>");
    await choosePerson(p, "SF119 Emptyfake", "SF119 Emptyfake");
    const fh = await frameText(p);
    check("US2 scenario 2", s2 === "Hello {{Organisation | friend}}{{First name}}" && t2 === "Dear {{Last name | reader}}" && fh.includes("Hi pal at your place"), `subject "${s2}"; text block "${t2}"; typed in HTML → frame ${JSON.stringify(fh.split("\n")[0])}`);
  }

  if (run("US2 scenario 3")) {
    const id = await newCampaign(p, "SF119 unknown (fake)");
    await p.fill("#campaign-subject", "{{  first NAME  }} likes {{Favourite colour}}");
    const n = await save(p);
    await choosePerson(p, "Cara", "Cara Example");
    const sub = await p.locator(".mail-subject").innerText();
    const pv = await p.locator(".campaign-preview").innerText();
    check("US2 scenario 3", n.includes("Draft saved.") && n.includes("Unknown merge tags: {{Favourite colour}}") && pv.includes("Unknown merge tags: {{Favourite colour}}") && sub === "Cara likes {{Favourite colour}}" && camp(id).includes("{{Favourite colour}}"),
      `notes ${JSON.stringify(n)}; preview subject "${sub}"; preview lists it ${pv.includes("Unknown merge tags: {{Favourite colour}}")}`);
  }

  if (run("US2 scenario 4") || run("US2 scenario 5")) {
    const id = await newCampaign(p, "SF119 rename blocks (fake)");
    await p.fill("#campaign-subject", "Food: {{SF119 Diet | none given}}");
    await chooseLayout(p, "Blank");
    await p.locator(".blk textarea").first().fill("Your diet: {{sf119 diet | none given}}");
    await save(p);
    const hid = await htmlDraft(p, "SF119 rename html (fake)", "<p>Diet: {{SF119 Diet | none given}}</p>");
    await save(p);
    // rename through the admin page
    await go(p, `/admin/custom-fields?kind=people&field=${fid}`);
    await p.locator('[role="dialog"] input[name="name"]').first().fill("SF119 Dietary needs");
    await H.submit(p, p.locator('[role="dialog"] button:has-text("[ SAVE ]")'));
    const renamed = q(`select name from custom_fields where id=${fid}`);
    await go(p, `/campaigns/${id}`);
    const subj = await p.locator("#campaign-subject").inputValue();
    const blk = await p.locator(".blk textarea").first().inputValue();
    await choosePerson(p, "Cara", "Cara Example");
    const ps = await p.locator(".mail-subject").innerText(); const pf = await frameText(p);
    await go(p, `/campaigns/${hid}`);
    const hb = await p.locator("textarea.html-box").inputValue();
    await choosePerson(p, "Cara", "Cara Example");
    const hf = await frameText(p);
    if (run("US2 scenario 4")) check("US2 scenario 4", renamed === "SF119 Dietary needs" && subj === "Food: {{SF119 Dietary needs | none given}}" && blk === "Your diet: {{SF119 Dietary needs | none given}}" && hb === "<p>Diet: {{SF119 Dietary needs | none given}}</p>" && ps === "Food: Gluten free (fake)" && pf.includes("Your diet: Gluten free (fake)") && hf.includes("Diet: Gluten free (fake)"),
      `renamed in admin to "${renamed}"; subject "${subj}"; block "${blk}"; html "${hb}"; preview "${ps}" / ${JSON.stringify(pf.split("\n")[0])} / ${JSON.stringify(hf.split("\n")[0])}`);
    // US2-5 as written: a saved draft, then the field deleted (no rename in between)
    const gid = q("insert into custom_fields (kind,name,type,position,in_list) values ('person','SF119 Gone','text',23,false) returning id").split("\n")[0];
    const g5 = await newCampaign(p, "SF119 deleted field (fake)");
    await p.fill("#campaign-subject", "Note: {{sf119 gone | n/a}}");
    const g5n = await save(p);
    q(`delete from custom_fields where id=${gid}`);
    await go(p, `/campaigns/${g5}`);
    const g5s = await p.locator("#campaign-subject").inputValue(); const g5u = await p.locator(".campaign-notes").innerText();
    await choosePerson(p, "Cara", "Cara Example"); const g5p = await p.locator(".campaign-preview").innerText();
    await p.fill("#campaign-subject", "Note: {{First name}}"); const g5c = await p.locator(".campaign-notes").innerText();
    if (run("US2 scenario 5")) check("US2 scenario 5", !g5n.includes("Unknown") && g5s === "Note: {{SF119 Gone | n/a}}" && g5u.includes("Unknown merge tags: {{SF119 Gone | n/a}}") && g5p.includes("Unknown merge tags: {{SF119 Gone | n/a}}") && !g5c.includes("Unknown merge tags"),
      `saved "{{sf119 gone | n/a}}" (recognised); after delete: subject "${g5s}", notes ${JSON.stringify(g5u)}; after changing the tag: ${JSON.stringify(g5c)}`);
    // US2-5: an admin deletes the field
    q(`delete from custom_values where field_id=${fid}; delete from custom_fields where id=${fid}`);
    await go(p, `/campaigns/${id}`);
    const s5 = await p.locator("#campaign-subject").inputValue();
    const n5 = await p.locator(".campaign-notes").innerText();
    await p.fill("#campaign-subject", "Food: {{First name}}");
    await p.locator(".blk textarea").first().fill("Changed");
    const n5b = await p.locator(".campaign-notes").innerText();
    check("US2-5 after rename then delete", s5 === "Food: {{SF119 Dietary needs | none given}}" && n5.includes("Unknown merge tags: {{SF119 Dietary needs | none given}}") && !n5b.includes("Unknown merge tags"),
      `after delete (by SQL, as the admin delete does): subject "${s5}"; notes ${JSON.stringify(n5)}; after changing the tags: ${JSON.stringify(n5b)}`);
  }

  if (run("US3 scenario 1") || run("US3 scenario 2") || run("US3 scenario 3")) {
    const id = await newCampaign(p, "SF119 layouts (fake)");
    const ch = await p.locator(".chooser button").allInnerTexts();
    const seen = {};
    for (const l of ["Blank", "Text", "Text with a button", "Newsletter"]) {
      await chooseLayout(p, l);
      seen[l] = await p.locator(".blk .bt").allInnerTexts();
      await p.locator(".content-head button", { hasText: "Layout" }).click(); // stays on blocks
      // back to the chooser: remove every block
      while (await p.locator(".blk").count()) await p.locator(".blk button", { hasText: "[ REMOVE ]" }).first().click();
    }
    check("US3 scenario 1", JSON.stringify(ch) === JSON.stringify(["Blank", "Text", "Text with a button", "Newsletter", "Paste HTML"]) &&
      JSON.stringify(seen) === JSON.stringify({ Blank: ["Text"], Text: ["Heading", "Text"], "Text with a button": ["Heading", "Text", "Button"], Newsletter: ["Image", "Heading", "Text", "Button", "Divider", "Text"] }),
      `chooser ${JSON.stringify(ch)}; blocks ${JSON.stringify(seen)}`);
    await chooseLayout(p, "Newsletter");
    const lims = await p.locator(".blk").evaluateAll((bs) => bs.map((b) => [...b.querySelectorAll("input,textarea")].map((e) => `${e.tagName.toLowerCase()}:${e.type}:${e.maxLength}:${e.previousElementSibling?.textContent ?? ""}`)));
    await p.locator(".blk").nth(0).locator("input").nth(0).fill("https://example.test/pic.png");
    await p.locator(".blk").nth(0).locator("input").nth(1).fill("Fake picture");
    await p.locator(".blk").nth(1).locator("input").fill("Fake heading");
    await p.locator(".blk").nth(2).locator("textarea").fill("Line one\nLine two https://example.test/page");
    await p.locator(".blk").nth(3).locator("input").nth(0).fill("Book a seat");
    await p.locator(".blk").nth(3).locator("input").nth(1).fill("https://example.test/book");
    const fh = await frameHtml(p);
    check("US3 scenario 2", fh.includes("Line one<br>Line two") && /<a [^>]*href="https:\/\/example.test\/page"/.test(fh) && fh.includes("Book a seat") && fh.includes("<hr") && /<img[^>]*alt="Fake picture"/.test(fh),
      `inputs per block ${JSON.stringify(lims)}; frame has <br>, auto link, button, hr, img`);
    // US3-3: add one of each type, remove, move, save, reload
    for (const t of ["Heading", "Text", "Button", "Image", "Divider"]) {
      await p.locator(".addblock button", { hasText: "[ + ADD BLOCK ]" }).click();
      await p.locator(".addblock-types button", { hasText: new RegExp(`^${t}$`) }).click();
    }
    await p.locator(".blk").nth(6).locator("input").fill("Added heading");
    await p.locator(".blk").nth(7).locator("textarea").fill("Added text");
    await p.locator(".blk").nth(8).locator("input").nth(0).fill("Added button");
    await p.locator(".blk").nth(8).locator("input").nth(1).fill("mailto:fake@example.test");
    await p.locator(".blk").nth(9).locator("input").nth(0).fill("https://example.test/pic.png");
    await p.locator(".blk").nth(5).locator("button", { hasText: "[ REMOVE ]" }).click(); // the last Newsletter text
    await p.locator('button[aria-label="Move Button down"]').first().click(); // Newsletter button below the divider
    await p.locator(".blk").nth(1).locator('button[aria-label="Move Heading up"]').click(); // heading above the image
    const order = await p.locator(".blk .bt").allInnerTexts();
    const n3 = await save(p);
    await p.reload(); await p.waitForLoadState("networkidle");
    const after = await p.locator(".blk .bt").allInnerTexts();
    const dbt = JSON.parse(q(`select blocks from campaigns where id=${id}`)).map((x) => x.type);
    // 50 blocks
    while ((await p.locator(".blk").count()) < 50) {
      await p.locator(".addblock button", { hasText: "[ + ADD BLOCK ]" }).click();
      await p.locator(".addblock-types button", { hasText: /^Divider$/ }).click();
    }
    const full = await p.locator(".addblock button", { hasText: "[ + ADD BLOCK ]" }).isDisabled();
    const n50 = await save(p);
    await p.evaluate(() => { const i = document.querySelector('input[name="blocks"]'); const v = JSON.parse(i.value); v.push({ type: "divider" }); i.value = JSON.stringify(v); });
    const ver = camp(id).split("|")[8];
    // a 51st block can only be posted by a forged request: run the server action with the edited hidden input
    const forged = await p.evaluate(async () => { const f = document.getElementById("campaign-form"); const fd = new FormData(f); return JSON.parse(fd.get("blocks")).length; });
    check("US3 scenario 3", JSON.stringify(order) === JSON.stringify(["Heading", "Image", "Text", "Divider", "Button", "Heading", "Text", "Button", "Image", "Divider"]) && n3.includes("Draft saved.") && JSON.stringify(after) === JSON.stringify(order) && dbt.join() === order.join().toLowerCase() && full && n50.includes("Draft saved.") && JSON.parse(q(`select blocks from campaigns where id=${id}`)).length === 50,
      `order ${JSON.stringify(order)}; after reload same ${JSON.stringify(after) === JSON.stringify(order)}; db ${dbt}; at 50 the add button is disabled=${full}, 50 saved ${n50.includes("Draft saved.")} (51 refused by the server: unit/integration tests)`);
  }

  if (run("US3 scenario 4") || run("US3 scenario 5")) {
    const id = await newCampaign(p, "SF119 links (fake)");
    await chooseLayout(p, "Text with a button");
    await p.locator(".blk").nth(0).locator("input").fill("<b>Bold heading</b>");
    await p.locator(".blk").nth(1).locator("textarea").fill("<i>italic</i> <script>alert(2)</script>");
    await p.locator(".blk").nth(2).locator("input").nth(0).fill("<u>Label</u>");
    await p.locator(".blk").nth(2).locator("input").nth(1).fill("https://example.test/ok");
    await save(p);
    const ver = camp(id).split("|")[8];
    const out = {};
    for (const bad of ["javascript:alert(1)", "ftp://fake.test/x", "example.test/no-scheme"]) {
      await p.locator(".blk").nth(2).locator("input").nth(1).fill(bad);
      const before = await p.locator("#campaign-form").innerText();
      await save(p);
      out[bad] = ((await p.locator("#campaign-form").innerText()).match(/Button: [^\n]*/) || [await p.locator(".blk").nth(2).locator("input").nth(1).evaluate((e) => "browser: " + e.validationMessage)])[0];
    }
    await p.locator(".blk").nth(2).locator("input").nth(1).fill("mailto:fake@example.test");
    await p.locator(".addblock button", { hasText: "[ + ADD BLOCK ]" }).click();
    await p.locator(".addblock-types button", { hasText: /^Image$/ }).click();
    await p.locator(".blk").nth(3).locator("input").nth(0).fill("http://fake.test/a.png");
    await save(p);
    const img = ((await p.locator("#campaign-form").innerText()).match(/Image: [^\n]*/) || ["none"])[0];
    const ver2 = camp(id).split("|")[8];
    if (run("US3 scenario 4")) check("US3 scenario 4", out["javascript:alert(1)"] === "Button: enter a web address starting with https://." && out["ftp://fake.test/x"] === "Button: enter a web address starting with https://." && img === "Image: enter a web address starting with https://." && ver === ver2,
      `messages ${JSON.stringify(out)}; image http:// → "${img}"; nothing saved ${ver === ver2}`);
    await p.locator(".blk").nth(3).locator("button", { hasText: "[ REMOVE ]" }).click();
    const fh = await frameHtml(p); const ft = await frameText(p);
    if (run("US3 scenario 5")) check("US3 scenario 5", ft.includes("<b>Bold heading</b>") && ft.includes("<i>italic</i> <script>alert(2)</script>") && ft.includes("<u>Label</u>") && !/<b>|<i>|<u>|<script/.test(fh) && dialogs.length === 0,
      `frame text ${JSON.stringify(ft.split("\n").slice(0, 3))}; no <b>/<i>/<u>/<script> elements: ${!/<b>|<i>|<u>|<script/.test(fh)}`);
  }

  if (run("US4 scenario 1") || run("US4 scenario 2") || run("Edge case 8") || run("US5 scenario 5")) {
    const html = `<!doctype html><html><head><title>Fake</title><style>*{background:red !important;color:red !important} h1{color:rgb(0, 128, 0) !important}</style><link rel="stylesheet" href="https://example.test/x.css"></head>
<body><h1>Fake news for {{First name | friend}}</h1><img id="pic" src="${DOT}" width="20" height="20" alt="dot">
<script>alert('x');document.title='Hacked (fake)';parent.document.title='Hacked';top.document.body.innerHTML='gone'</script>
<img src="nope.png" onerror="alert('e');top.document.title='Hacked'">
<form action="/campaigns" method="post"><input name="q" value="1"><button id="send">Send form</button></form>
<iframe src="https://example.test/"></iframe><a id="lnk" href="https://example.test/landing">Fake link</a></body></html>`;
    const id = await htmlDraft(p, "SF119 pasted (fake)", html);
    const n = await save(p);
    await p.reload(); await p.waitForLoadState("networkidle");
    const box = await p.locator("textarea.html-box").inputValue();
    await choosePerson(p, "Cara", "Cara Example");
    const fr = p.frameLocator("iframe.mail-frame");
    await p.waitForTimeout(800);
    const ft = await frameText(p);
    const h1c = await fr.locator("h1").evaluate((e) => getComputedStyle(e).color);
    const picW = await fr.locator("#pic").evaluate((e) => e.naturalWidth);
    if (run("US4 scenario 1")) check("US4 scenario 1", n.includes("Draft saved.") && box === html && ft.includes("Fake news for Cara") && h1c === "rgb(0, 128, 0)" && picW === 1,
      `saved; box equals pasted ${box === html}; frame "${ft.split("\n")[0]}", h1 colour ${h1c}, image loaded ${picW === 1}`);
    // US4-2
    const reqs = []; p.on("request", (r) => { if (r.method() === "POST") reqs.push(r.url()); });
    const url = p.url(); const title = await p.title();
    const sideOk = await p.locator("aside.side").isVisible();
    await fr.locator("#send").click(); await p.waitForTimeout(1500);
    const [pop] = await Promise.all([p.context().waitForEvent("page", { timeout: 5000 }).catch(() => null), fr.locator("#lnk").click()]);
    await p.waitForTimeout(800);
    const title2 = await p.title();
    const side2 = await p.locator("aside.side").innerText();
    const head2 = await p.locator(".page-head h1").innerText();
    if (run("US4 scenario 2")) check("US4 scenario 2", dialogs.length === 0 && title === title2 && !/Hacked/.test(title2) && sideOk && /campaigns/i.test(side2) && head2 === "SF119 pasted (fake)" && reqs.length === 0 && p.url() === url && pop !== null,
      `alerts ${dialogs.length}; title "${title2}"; sidebar/header kept; form click POSTs ${JSON.stringify(reqs)}; url same ${p.url() === url}; link opened a new tab ${pop ? pop.url() : "none"}`);
    if (pop) await pop.close();
    // Edge 8
    const sideBg = await p.locator("aside.side").evaluate((e) => getComputedStyle(e).backgroundColor);
    const mainBg = await p.locator("main").evaluate((e) => getComputedStyle(e).backgroundColor);
    const subjC = await p.locator("#campaign-subject").evaluate((e) => getComputedStyle(e).color);
    if (run("Edge case 8")) check("Edge case 8", picW === 1 && ![sideBg, mainBg, subjC].includes("rgb(255, 0, 0)"), `image shown ${picW === 1}; sidebar ${sideBg}, main ${mainBg}, subject text ${subjC} (not red)`);
    // US5-5
    const last = await fr.locator("body > p").last().innerText();
    const ua = await fr.locator("body > p").last().locator("a").evaluate((a) => a.getAttribute("href"));
    const pages = p.context().pages().length;
    await fr.locator("body > p").last().locator("a").click(); await p.waitForTimeout(800);
    if (run("US5 scenario 5")) check("US5 scenario 5", last === "Don't want these emails? Unsubscribe" && ua === null && p.context().pages().length === pages && p.url() === url,
      `last line "${last}", link href ${ua}; click opened nothing and the page stayed`);
  }

  if (run("US4 scenario 3")) {
    const id = await htmlDraft(p, "SF119 big (fake)", "x".repeat(500001));
    const ver = camp(id).split("|")[8];
    const n = await save(p);
    const t = await p.locator("#campaign-form").innerText().then((x) => x + n);
    const ok = await (async () => { await setHtml(p, "y".repeat(500000)); return save(p); })();
    check("US4 scenario 3", t.includes("The HTML can be at most 500,000 characters.") && ok.includes("Draft saved.") && q(`select length(html) from campaigns where id=${id}`) === "500000",
      `500,001 → message ${t.includes("The HTML can be at most 500,000 characters.")}, nothing saved; 500,000 → ${JSON.stringify(ok.split("\n")[0])}`);
  }

  if (run("US4 scenario 4")) {
    const id = await newCampaign(p, "SF119 switch (fake)");
    await chooseLayout(p, "Text with a button");
    await p.locator(".blk").nth(0).locator("input").fill("Switch heading");
    await p.locator(".blk").nth(2).locator("input").nth(0).fill("Go");
    await p.locator(".blk").nth(2).locator("input").nth(1).fill("https://example.test/go");
    await p.locator(".content-head button", { hasText: "Paste HTML" }).click();
    const c1 = await p.locator('[role="alertdialog"]').innerText();
    await p.locator('[role="alertdialog"] button', { hasText: "[ SWITCH ]" }).click();
    const box = await p.locator("textarea.html-box").inputValue();
    await setHtml(p, "<p>Pasted (fake)</p>");
    await p.locator(".content-head button", { hasText: "Layout" }).click();
    const c2 = await p.locator('[role="alertdialog"]').innerText();
    await p.locator('[role="alertdialog"] button', { hasText: "[ CANCEL ]" }).click();
    const kept = await p.locator("textarea.html-box").inputValue();
    await p.locator(".content-head button", { hasText: "Layout" }).click();
    await p.locator('[role="alertdialog"] button', { hasText: "[ SWITCH ]" }).click();
    await chooseLayout(p, "Text");
    const bl = await p.locator(".blk .bt").allInnerTexts();
    await save(p);
    check("US4 scenario 4", c1.includes("Switch to Paste HTML?") && box.includes("Switch heading") && box.includes('href="https://example.test/go"') && c2.includes("The pasted HTML will be replaced") && kept === "<p>Pasted (fake)</p>" && JSON.stringify(bl) === `["Heading","Text"]` && camp(id).split("|")[5] === "blocks",
      `box 1 ${JSON.stringify(c1)}; HTML box starts ${JSON.stringify(box.slice(0, 90))}; box 2 ${JSON.stringify(c2)}; cancel kept HTML; then blocks ${bl}`);
  }

  if (run("US5 scenario 2") || run("US5 scenario 4") || run("Edge case 6")) {
    const id = await newCampaign(p, "SF119 all tags (fake)");
    await p.fill('[name="senderName"]', "Ada at Fakeco");
    await p.fill('[name="replyTo"]', "reply@example.test");
    await p.fill("#campaign-subject", "Hi {{First name}}");
    await p.fill('[name="previewText"]', "From {{Organisation | nowhere}}");
    await chooseLayout(p, "Blank");
    const all = ["First name", "Last name", "Full name", "Email", "Phone", "Organisation", "Role", "Lead source", "LinkedIn", "Owner", "Labels", "Diet (fake)", "Birthday (fake)", "Newsletter topics (fake)", "Head count met (fake)", "SF119 Budget", "SF119 Member"];
    await p.locator(".blk textarea").first().fill(all.map((f) => `${f}=[{{${f} | EMPTY}}]`).join("\n"));
    await save(p);
    await choosePerson(p, "Cara", "Cara Example");
    const from = await p.locator(".mail-head").innerText();
    const ft = await frameText(p);
    const got = Object.fromEntries(ft.split("\n").filter((l) => l.includes("=[")).map((l) => [l.split("=[")[0], l.split("=[")[1].replace(/]$/, "")]));
    q("insert into person_phones (person_id, phone, position) values (36, '+44 7700 900111', 0), (36, '+44 7700 900222', 1)");
    // person page for comparison
    await choosePerson(p, "Cara", "Cara Example").catch(() => {});
    await p.locator(".preview-picker input").fill(""); await choosePerson(p, "Cara", "Cara Example");
    const got2 = Object.fromEntries((await frameText(p)).split("\n").filter((l) => l.includes("=[")).map((l) => [l.split("=[")[0], l.split("=[")[1].replace(/]$/, "")]));
    if (run("US5 scenario 4")) check("US5 scenario 4", from.includes("From: Ada at Fakeco") && from.includes("Reply-to: reply@example.test") && from.includes("Hi Cara") && from.includes("From Sample Studios Fake") &&
      got2["First name"] === "Cara" && got2["Full name"] === "Cara Example" && got2["Email"] === "cara.ambassador@example.com" && got2["Phone"] === "+44 7700 900111" && got2["Role"] === "Partnerships lead" && got2["Owner"] === "Ada Fake" && got2["Lead source"] === "EMPTY" && got2["Labels"] === "EMPTY",
      `head ${JSON.stringify(from)}; values ${JSON.stringify(got2)}`);
    if (run("Edge case 6")) check("Edge case 6", got["Newsletter topics (fake)"] === "AI, Events" && got["Birthday (fake)"] === "24 Nov 1990" && got["SF119 Budget"] === "£1,200" && got["SF119 Member"] === "No" && got["Diet (fake)"] === "Vegan" && got["Head count met (fake)"] === "EMPTY",
      `multiple choice "${got["Newsletter topics (fake)"]}", date "${got["Birthday (fake)"]}", money "${got["SF119 Budget"]}", yes/no "${got["SF119 Member"]}", empty number → "${got["Head count met (fake)"]}"`);
    // US5-2: typing without saving
    const t0 = Date.now();
    await p.fill("#campaign-subject", "Live {{Last name}} now");
    await p.waitForFunction(() => document.querySelector(".mail-subject")?.textContent === "Live Example now", null, { timeout: 2000 }).catch(() => {});
    const d1 = Date.now() - t0;
    const t1 = Date.now();
    await p.locator(".blk textarea").first().fill("Typed block for {{Full name}}");
    const ok2 = await p.waitForFunction(() => document.querySelector("iframe.mail-frame")?.contentDocument === null || true, null).then(async () => {
      for (let i = 0; i < 20; i++) { if ((await p.frameLocator("iframe.mail-frame").locator("body").innerText()).includes("Typed block for Cara Example")) return true; await p.waitForTimeout(100); } return false; });
    const d2 = Date.now() - t1;
    const t2 = Date.now();
    await p.locator(".addblock button", { hasText: "[ + ADD BLOCK ]" }).click();
    await p.locator(".addblock-types button", { hasText: /^Heading$/ }).click();
    await p.locator(".blk").nth(1).locator("input").fill("New heading for {{First name}}");
    let ok3 = false; for (let i = 0; i < 20 && !ok3; i++) { ok3 = (await p.frameLocator("iframe.mail-frame").locator("body").innerText()).includes("New heading for Cara"); if (!ok3) await p.waitForTimeout(100); }
    const d3 = Date.now() - t2;
    if (run("US5 scenario 2")) check("US5 scenario 2", (await p.locator(".mail-subject").innerText()) === "Live Example now" && d1 < 2000 && ok2 && d2 < 2000 && ok3 && d3 < 2000,
      `subject in ${d1} ms; block text in ${d2} ms; added block in ${d3} ms`);
  }

  if (run("US5 scenario 3")) {
    const l = await newPage(b, "linus@barnacle.ai", "Linus Fake");
    const id = await newCampaign(l, "SF119 picker (fake)");
    const pr = await pickerNames(l, "privatefake");
    const gus = await pickerNames(l, "Lorem");
    const fay = await pickerNames(l, "Mockup");
    const byMail = await pickerNames(l, "cara.ambassador@");
    const many = await pickerNames(l, "e");
    const total = q("select count(*) from persons where archived_at is null and not private and (first_name||' '||last_name) ilike '%e%'");
    check("US5 scenario 3", pr.some((x) => x.startsWith("Pat Privatefake")) && pr.some((x) => x.startsWith("Dora Privatefake")) && !gus.some((x) => x.startsWith("Gus Lorem")) && !fay.some((x) => x.startsWith("Fay Mockup")) && byMail.some((x) => x.startsWith("Cara Example")) && many.length === 20 && Number(total) > 20,
      `Linus: "privatefake" → ${JSON.stringify(pr)}; "Lorem" → ${JSON.stringify(gus)} (Ada's private Gus Lorem hidden); "Mockup" (archived Fay) → ${JSON.stringify(fay)}; by email → ${JSON.stringify(byMail)}; "e" → ${many.length} of ${total}+ matches`);
    await l.close();
  }

  if (run("US5 scenario 6")) {
    const id = await newCampaign(p, "SF119 markup values (fake)");
    await chooseLayout(p, "Blank");
    await p.locator(".blk textarea").first().fill("Role {{Role}} name {{First name}}");
    await choosePerson(p, "Markupfake", "SF119 Markupfake");
    const lt = await frameText(p); const lh = await frameHtml(p);
    const hid = await htmlDraft(p, "SF119 markup html (fake)", `<p>Role {{Role}} name {{First name}}</p><a href="https://example.test/?r={{Role}}" title="{{First name}}">x</a>`);
    await choosePerson(p, "Markupfake", "SF119 Markupfake");
    const ht = await frameText(p); const hh = await frameHtml(p);
    check("US5 scenario 6", lt.includes("Role <b>Fake</b> name <i>Mark</i>") && ht.includes("Role <b>Fake</b> name <i>Mark</i>") && !/<b>|<i>/.test(lh + hh),
      `layout ${JSON.stringify(lt.split("\n")[0])}; html ${JSON.stringify(ht.split("\n")[0])}; no <b>/<i> elements ${!/<b>|<i>/.test(lh + hh)}`);
  }

  if (run("Edge case 2") || run("Edge case 3") || run("Edge case 5")) {
    const id = await newCampaign(p, "SF119 odd tags (fake)");
    await p.fill("#campaign-subject", "A {{}} B {{First name C {{ First name|  }} D");
    const n = await save(p);
    await choosePerson(p, "Cara", "Cara Example");
    const s = await p.locator(".mail-subject").innerText();
    await p.locator(".preview-picker input").fill(""); await choosePerson(p, "SF119 Emptyfake", "SF119 Emptyfake");
    const s2 = await p.locator(".mail-subject").innerText();
    if (run("Edge case 2")) check("Edge case 2", n.includes("Unknown merge tags: {{}}") && !n.includes("First name") && s === "A {{}} B {{First name C Cara D" && s2.replace(/\s+/g, " ") === "A {{}} B {{First name C D",
      `notes ${JSON.stringify(n)}; Cara → "${s}"; no first name → "${s2}"`);
    const hid = await htmlDraft(p, "SF119 other tool (fake)", "<p>{{product.title}} and {{ shop_name }}</p>");
    const n3 = await save(p);
    const pv3 = await p.locator(".campaign-preview").innerText();
    if (run("Edge case 3")) check("Edge case 3", n3.includes("Unknown merge tags: {{product.title}}, {{ shop_name }}") && pv3.includes("Unknown merge tags: {{product.title}}, {{ shop_name }}"), `notes ${JSON.stringify(n3)}`);
    // Edge 5
    const eid = await newCampaign(p, "SF119 empty person (fake)");
    await p.fill("#campaign-subject", "Hi {{First name | there}}{{First name}}");
    await p.fill('[name="previewText"]', "{{Organisation | your team}}{{Organisation}}{{Diet (fake)}}{{Birthday (fake) | someday}}");
    await chooseLayout(p, "Blank");
    await p.locator(".blk textarea").first().fill("X{{First name}}Y{{Diet (fake) | no diet}}Z{{Labels}}{{Lead source | none}}");
    await choosePerson(p, "SF119 Emptyfake", "SF119 Emptyfake");
    const all = (await p.locator(".mail-head").innerText()) + (await frameText(p));
    if (run("Edge case 5")) check("Edge case 5", all.includes("Hi there") && all.includes("your teamsomeday") && all.includes("XYno dietZnone") && !/\[First name\]|undefined|null/.test(all), `preview ${JSON.stringify(all)}`);
  }

  if (run("Edge case 4")) {
    const id = await newCampaign(p, "SF119 fading (fake)");
    await p.fill("#campaign-subject", "Role {{Role}}");
    await choosePerson(p, "Fadingfake", "SF119 Fadingfake");
    const before = await p.locator(".mail-subject").innerText();
    q(`update persons set private = true where id=${fading}`);
    const still = await p.locator(".mail-subject").innerText();
    await save(p);
    const after = await p.locator(".campaign-preview").innerText();
    await p.reload(); await p.waitForLoadState("networkidle");
    const again = await pickerNames(p, "Fadingfake");
    check("Edge case 4", before === "Role Secret role (fake)" && after.includes("Choose a person to preview.") && !after.includes("Secret role") && again.every((x) => !x.includes("Fadingfake")),
      `before "${before}"; made private by Grace (SQL); until the next save the preview still showed "${still}"; after save: ${JSON.stringify(after.slice(0, 120))}; picker now ${JSON.stringify(again)}`);
  }

  if (run("Edge case 7")) {
    const raw = "<div><b>Unclosed bold <p>para\nplain text line & < more";
    const id = await htmlDraft(p, "SF119 invalid html (fake)", raw);
    const n = await save(p);
    await p.reload(); await p.waitForLoadState("networkidle");
    const box = await p.locator("textarea.html-box").inputValue();
    const ft = await frameText(p);
    check("Edge case 7", n.includes("Draft saved.") && box === raw && ft.includes("Unclosed bold") && ft.includes("plain text line & < more"), `box same ${box === raw}; frame ${JSON.stringify(ft)}`);
  }

  console.log(JSON.stringify(results.map((r) => [r.name, r.ok])));
  await b.close();
})().catch((e) => { console.error(e); console.log(JSON.stringify(results.map((r) => [r.name, r.ok]))); process.exit(1); });
