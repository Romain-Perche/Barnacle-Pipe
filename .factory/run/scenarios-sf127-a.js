// SF-127 AI review, part a: US1, US2 (1-3, 5), US3, US6, edges 6-11, 13. Fresh data first:
//   rm -rf .fake-gmail && bash .factory/run/reset-db.sh && psql -h localhost -U postgres -d crm_dev -f .factory/run/sf127-setup.sql
// App on :3000 (start-app.sh). Then part b (scenarios-sf127-b.js) on the same data. Results: /tmp/sf127-a.json.
const fs = require("fs");
const L_ = require("./sf127-lib");
const { chromium, A, L, q, norm, sleep, S, R, pageAs, go, put, connect, conv, pid, oid, did, links, emailEntries, countSubj, gThread } = L_;
const ADA = "Ada Fake <ada@barnacle.ai>", ANA = "Ana Example <ana@example.test>", BEN = "Ben Example <ben@example.test>";
const ukTime = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(d);
async function run(name, fn) { try { await fn(); } catch (e) { R(name, false, "error: " + e.message.split("\n")[0]); } }

(async () => {
  const browser = await chromium.launch();
  const ada = await pageAs(browser, A);
  const lin = await pageAs(browser, L);
  const ana = pid("Ana"), ben = pid("Ben");
  const exLtd = oid("Example Ltd"), other = oid("Other Co"), pilot = did("Example Ltd – pilot");

  await run("US1 scenario 1", async () => {
    const d = await put(ada, A, { from: ANA, to: ADA, subject: "Proposal", text: "Hi Ada, here are the figures we discussed last week… and more text follows here.", att: ["figures.pdf:245760"] });
    await go(ada, `/people/${ana}`);
    const li = ada.getByRole("region", { name: "Timeline" }).locator("li.ent", { has: ada.locator(".subj", { hasText: /^Proposal$/ }) }).first();
    const tag = norm(await li.locator(".kd").innerText());
    const when = norm(await li.locator(".when").innerText());
    const recv = new Date(q(`select to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from email_messages where subject='Proposal'`));
    const day = norm(await li.locator("xpath=ancestor::div[contains(@class,'daygroup')]").locator(".day").innerText());
    const head = norm(await li.locator(".emailhead").innerText());
    const box = li.locator(".emailbody");
    const css = await box.evaluate((e) => { const s = getComputedStyle(e); return { w: s.borderLeftWidth, c: s.borderLeftColor, blue: getComputedStyle(document.documentElement).getPropertyValue("--blue") }; });
    const boxText = norm(await box.innerText());
    const ok = d === "delivered" && tag === "EMAIL" && when === ukTime(recv) && head === "Ana Example → Ada Fake" && css.w === "3px" && /Proposal/.test(boxText) && boxText.includes("Hi Ada, here are the figures we discussed last week…") && boxText.includes("figures.pdf · 240 KB") && /TODAY|26 NOV/i.test(day);
    R("US1 scenario 1", ok, `put ${d}; tag ${tag}; time ${when} (received ${recv.toISOString()} → ${ukTime(recv)}); day "${day}"; head "${head}"; box ${JSON.stringify(css)}: "${boxText}"`);
  });

  await run("US1 scenario 2", async () => {
    const es = await emailEntries(lin, `/organisations/${exLtd}`);
    const e = es.find((x) => x.subj === "Proposal");
    R("US1 scenario 2", e && e.head === "Ana Example → Ada Fake" && e.text.includes("figures.pdf · 240 KB"), `Linus on Example Ltd: ${e ? e.text : "no entry"}`);
  });

  await run("US1 scenario 3", async () => {
    const es = await emailEntries(lin, `/deals/${pilot}`);
    await go(lin, `/deals?open=${pilot}`);
    const drawer = norm(await lin.locator("aside, [role=dialog], .drawer").filter({ hasText: "Example Ltd – pilot" }).first().innerText());
    const dEnt = await lin.locator(".drawer li.ent:has(.kd.email), aside li.ent:has(.kd.email)").allInnerTexts();
    R("US1 scenario 3", countSubj(es, "Proposal") === 1 && dEnt.some((t) => norm(t).includes("Proposal") && norm(t).includes("Ana Example → Ada Fake") && norm(t).includes("figures.pdf · 240 KB")), `deal page entries ${JSON.stringify(es.map((x) => x.text))}; drawer EMAIL entries ${JSON.stringify(dEnt.map(norm))} (drawer has title: ${drawer.includes("pilot")})`);
  });

  await run("US1 scenario 4", async () => {
    const d = await put(ada, A, { sent: true, from: ADA, to: ANA, subject: "Re: Proposal", text: "Thanks Ana, looking now.", thread: gThread(A, "Proposal"), offset: 5 });
    const es = await emailEntries(lin, `/people/${ana}`);
    const iRe = es.findIndex((x) => x.subj === "Re: Proposal"), iP = es.findIndex((x) => x.subj === "Proposal");
    const recv = new Date(q(`select to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from email_messages where subject='Re: Proposal'`));
    R("US1 scenario 4", d === "delivered" && iRe >= 0 && iRe < iP && es[iRe].head === "Ada Fake → Ana Example" && es[iRe].text.includes(ukTime(recv)), `Linus sees ${JSON.stringify(es.map((x) => x.subj + " | " + x.head))}; reply at ${ukTime(recv)}`);
  });

  await run("US1 scenario 5", async () => {
    await put(ada, A, { from: ANA, to: ADA, cc: BEN, subject: "Cc test", text: "Copying Ben." , offset: 6});
    const where = {};
    for (const [k, path] of [["Ana", `/people/${ana}`], ["Ben", `/people/${ben}`], ["Example Ltd", `/organisations/${exLtd}`], ["Other Co", `/organisations/${other}`]]) {
      const es = await emailEntries(lin, path);
      const e = es.find((x) => x.subj === "Cc test");
      where[k] = e ? e.head : null;
    }
    R("US1 scenario 5", Object.values(where).every((h) => h === "Ana Example → Ada Fake · Cc Ben Example"), JSON.stringify(where));
  });

  await run("US1 scenario 6", async () => {
    await connect(lin);
    const mid = "<both-1@example.test>";
    const o = { from: ANA, to: `${ADA}, Linus Fake <linus@barnacle.ai>`, subject: "Both", text: "To both of you.", messageId: mid, att: ["both.pdf:1000"], offset: 7 };
    const d1 = await put(ada, A, o); const d2 = await put(lin, L, o);
    const copies = q(`select count(*) from email_messages where subject='Both'`);
    const counts = {};
    for (const [k, path] of [["Ana", `/people/${ana}`], ["Example Ltd", `/organisations/${exLtd}`], ["deal", `/deals/${pilot}`]]) counts[k] = countSubj(await emailEntries(ada, path), "Both");
    R("US1 scenario 6", copies === "2" && Object.values(counts).every((n) => n === 1), `put ${d1}/${d2}; stored copies ${copies}; entries ${JSON.stringify(counts)}`);
  });

  await run("US1 scenario 7", async () => {
    const reqs = []; ada.on("request", (r) => { if (r.url().includes("evil.test") || r.url().includes(":3999")) reqs.push(r.url()); });
    await put(ada, A, { from: ANA, to: ADA, subject: "HtmlOnly", html: '<div style="color:red"><p>Hello <b>bold</b> world</p><img src="http://localhost:3999/pixel.png" alt="IMG"><a href="http://evil.test/x">click here</a></div>', offset: 8 });
    await go(ada, `/people/${ana}`);
    const li = ada.getByRole("region", { name: "Timeline" }).locator("li.ent", { has: ada.locator(".subj", { hasText: /^HtmlOnly$/ }) }).first();
    const snip = norm(await li.locator(".snip").innerText());
    const inner = await li.locator(".snip").innerHTML();
    R("US1 scenario 7", /Hello bold world/.test(snip) && /click here/.test(snip) && !/[<>]/.test(snip) && !/<img|<b>|<a /.test(inner) && reqs.length === 0, `snippet "${snip}"; box has img/b/a elements: ${/<img|<b>|<a /.test(inner)}; outside requests ${reqs.length}`);
  });

  // A three-email conversation (US2 1), opened from Ana's page.
  await run("US2 scenario 1", async () => {
    await put(ada, A, { from: ANA, to: ADA, subject: "Three", text: "First email.\nSecond line of the first.", offset: 10 });
    await put(ada, A, { sent: true, from: ADA, to: ANA, cc: BEN, subject: "Re: Three", text: "Second email.", thread: gThread(A, "Three"), offset: 11 });
    await put(ada, A, { from: ANA, to: ADA, subject: "Re: Three", text: "Third email with the sheet.", att: ["sheet.xlsx:2048"], thread: gThread(A, "Three"), offset: 12 });
    await go(lin, `/people/${ana}`);
    await Promise.all([lin.waitForURL(/\/emails\/\d+/), lin.locator(".subj", { hasText: /^Three$/ }).first().click()]);
    await lin.waitForLoadState("networkidle");
    const head = norm(await lin.locator(".page-head").innerText());
    const h1 = norm(await lin.locator("h1").innerText());
    const back = lin.locator("a.back");
    const backText = norm(await back.innerText()), backHref = await back.getAttribute("href");
    const left = norm(await lin.locator(".recordleft").innerText()), right = norm(await lin.locator(".recordright").innerText());
    const msgs = (await lin.locator("article.msg").allInnerTexts()).map(norm);
    const ok = head.includes("CONVERSATION · 3 EMAILS") && h1 === "Three" && backText === "← ANA EXAMPLE" && backHref === `/people/${ana}` && left.startsWith("// LINKED TO") && right.startsWith("// EMAILS · OLDEST FIRST") && msgs.length === 3 &&
      msgs[0].includes("First email. Second line") && msgs[1].includes("Second email.") && msgs[1].includes("Cc Ben Example <ben@example.test>") && msgs[1].includes("To Ana Example <ana@example.test>") &&
      msgs[2].includes("sheet.xlsx · 2 KB") && msgs[2].includes("[ DOWNLOAD ]") && msgs.every((m) => /\d{2}:\d{2}/.test(m));
    const pre = await lin.locator("article.msg .emailtext").first().evaluate((e) => getComputedStyle(e).whiteSpace);
    R("US2 scenario 1", ok && pre === "pre-wrap", `head "${head}"; h1 "${h1}"; back "${backText}" → ${backHref}; left "${left.slice(0, 120)}"; white-space ${pre}; emails ${JSON.stringify(msgs)}`);
  });

  await run("US2 scenario 2", async () => {
    const bad = [];
    lin.on("request", (r) => { if (/3999|evil\.test/.test(r.url())) bad.push(r.url()); });
    await put(ada, A, { from: ANA, to: ADA, subject: "Scripted", html: '<html><head><style>body{background:rgb(255,0,0) !important} .msg{display:none}</style></head><body><script>window.__pwned=1;document.title="PWNED"</script><p onclick="x()">Plain words here</p><img src="http://localhost:3999/track.png"><a href="http://evil.test/">a link</a><iframe src="http://evil.test/f"></iframe></body></html>', offset: 13 });
    const c = conv("Scripted");
    await go(lin, `/emails/${c}?from=person-${ana}`);
    const pwned = await lin.evaluate(() => window.__pwned);
    const title = await lin.title();
    const bg = await lin.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const art = lin.locator("article.msg").first();
    const vis = await art.isVisible();
    const html = await art.innerHTML();
    const text = norm(await art.locator(".emailtext").innerText());
    R("US2 scenario 2", pwned === undefined && title !== "PWNED" && bg !== "rgb(255, 0, 0)" && vis && !/<img|<script|<iframe|<style|<a /.test(html) && text.includes("Plain words here") && text.includes("a link") && !/window\.__pwned/.test(text) && bad.length === 0,
      `script ran ${pwned !== undefined}; title "${title}"; body bg ${bg}; article visible ${vis}; tags in article ${(html.match(/<(img|script|iframe|style|a) /g) || []).join(",") || "none"}; text "${text}"; outside requests ${bad.length}`);
  });

  await run("US2 scenario 3", async () => {
    const c = conv("Proposal");
    await go(lin, `/emails/${c}`);
    const [dl] = await Promise.all([lin.waitForEvent("download"), lin.locator("article.msg", { hasText: "figures.pdf" }).getByText("[ DOWNLOAD ]").click()]);
    const path = await dl.path(); const size = fs.statSync(path).size;
    const attId = q(`select a.id from email_attachments a join email_messages m on m.id=a.message_id where a.name='figures.pdf'`);
    const r = await lin.context().request.get(`http://localhost:3000/emails/attachments/${attId}/download`, { maxRedirects: 0 });
    const h = r.headers();
    R("US2 scenario 3", dl.suggestedFilename() === "figures.pdf" && size === 245760 && r.status() === 200 && h["content-type"] === "application/octet-stream" && /^attachment;/.test(h["content-disposition"] || ""),
      `download "${dl.suggestedFilename()}" ${size} bytes; GET ${r.status()} type ${h["content-type"]}, disposition ${h["content-disposition"]}, csp ${h["content-security-policy"]}; only Ada's mailbox has it (copies ${q(`select count(*) from email_attachments where name='figures.pdf'`)})`);
  });

  await run("US2 scenario 5", async () => {
    const c = conv("Both");
    const threads = q(`select count(distinct t.id)||'/'||count(distinct t.conversation_id) from email_messages m join email_threads t on t.id=m.thread_id where m.subject='Both'`);
    await go(lin, `/emails/${c}`);
    const n = await lin.locator("article.msg").count();
    const head = norm(await lin.locator(".page-head").innerText());
    R("US2 scenario 5", n === 1 && head.includes("1 EMAIL") && threads === "2/1", `threads/conversations ${threads}; emails shown ${n}; head "${head}"`);
  });

  // US3: linking.
  await run("US3 scenario 1", async () => {
    await put(ada, A, { sent: true, from: ADA, to: "ana.example@mail.test", subject: "AltAddr", text: "To the other address.", offset: 14 });
    const l = links(conv("AltAddr"));
    await go(lin, `/emails/${conv("AltAddr")}`);
    const left = norm(await lin.locator(".recordleft").innerText());
    R("US3 scenario 1", l.includes("p:Ana/auto") && l.includes("o:Example Ltd/auto") && /PERSON ?Ana Example/.test(left) && /ORG ?Example Ltd/.test(left), `links ${JSON.stringify(l)}; panel "${left}"`);
  });
  await run("US3 scenario 2", async () => {
    const l = links(conv("Proposal"));
    R("US3 scenario 2", l.includes("d:Example Ltd – pilot/auto"), `Proposal links ${JSON.stringify(l)}`);
  });
  await run("US3 scenario 3", async () => {
    await put(ada, A, { from: "Eve Linked <eve@example.test>", to: ADA, subject: "EveConv", text: "Eve here.", offset: 15 });
    const l = links(conv("EveConv"));
    const es = await emailEntries(lin, `/deals/${did("Eve Deal")}`);
    R("US3 scenario 3", l.includes("d:Eve Deal/auto") && countSubj(es, "EveConv") === 1, `links ${JSON.stringify(l)}; on Eve Deal ${countSubj(es, "EveConv")}`);
  });
  await run("US3 scenario 4", async () => {
    await put(ada, A, { from: "Cat Twodeals <cat@example.test>", to: ADA, subject: "CatConv", text: "Cat here.", offset: 16 });
    const l = links(conv("CatConv"));
    R("US3 scenario 4", l.length === 1 && l[0] === "p:Cat/auto", `links ${JSON.stringify(l)} (Cat main of Cat D1, linked on Cat D2)`);
  });
  await run("US3 scenario 5", async () => {
    await put(ada, A, { from: "Dan Closed <dan@example.test>", to: ADA, subject: "DanConv", text: "Dan here.", offset: 17 });
    const l = links(conv("DanConv"));
    R("US3 scenario 5", l.length === 1 && l[0] === "p:Dan/auto", `links ${JSON.stringify(l)} (Dan: won, lost, archived deals)`);
  });
  await run("US3 scenario 6", async () => {
    const l = links(conv("Cc test"));
    R("US3 scenario 6", l.includes("d:Example Ltd – pilot/auto") && l.includes("d:Other Co – renewal/auto"), `Cc test links ${JSON.stringify(l)}`);
  });
  await run("US3 scenario 7", async () => {
    await put(ada, A, { from: "New Person <newbie@example.test>", to: ADA, cc: ANA, subject: "Newbie", text: "Hello from someone new.", offset: 18 });
    await put(ada, A, { from: "late@example.test", to: ADA, cc: ANA, subject: "LateAddr", text: "Ivy's other address.", offset: 19 });
    const before = [...links(conv("Newbie")), ...links(conv("LateAddr"))].filter((x) => /Nina|Ivy|Other Co/.test(x)).length;
    // A teammate (Linus) adds a person with the address, at Other Co.
    await go(lin, "/people/new");
    await lin.fill('input[name="firstName"]', "Nina"); await lin.fill('input[name="lastName"]', "Newbie");
    await lin.getByRole("combobox", { name: "Organisation" }).fill("Other Co").catch(() => {});
    await lin.locator('input[name="emails.0.value"], input[aria-label="Email address 1"]').first().fill("newbie@example.test");
    await Promise.all([lin.waitForURL(/\/people\/\d+$/), lin.click("text=[ SAVE ]")]);
    const nina = Number(new URL(lin.url()).pathname.split("/").pop());
    const ninaEs = await emailEntries(lin, `/people/${nina}`);
    // Ada adds an address to Ivy (one open deal "Ivy Deal").
    const ivy = pid("Ivy");
    await go(ada, `/people/${ivy}/edit`);
    await ada.click("text=[ ADD EMAIL ADDRESS ]");
    await ada.getByLabel("Email address 2", { exact: true }).fill("late@example.test");
    await Promise.all([ada.waitForURL(new RegExp(`/people/${ivy}(\\?|$)`)), ada.click("text=[ SAVE ]")]);
    const ivyEs = await emailEntries(lin, `/people/${ivy}`);
    const dealEs = await emailEntries(lin, `/deals/${did("Ivy Deal")}`);
    const ln = links(conv("Newbie")), li = links(conv("LateAddr"));
    const otherEs = await emailEntries(lin, `/organisations/${oid("Other Co")}`);
    R("US3 scenario 7", before === 0 && ln.includes("p:Nina/auto") && ln.includes("o:Other Co/auto") && countSubj(ninaEs, "Newbie") === 1 && countSubj(otherEs, "Newbie") === 1 && li.includes("p:Ivy/auto") && li.includes("d:Ivy Deal/auto") && countSubj(ivyEs, "LateAddr") === 1 && countSubj(dealEs, "LateAddr") === 1,
      `links before ${before}; Newbie ${JSON.stringify(ln)} (on Nina ${countSubj(ninaEs, "Newbie")}, Other Co ${countSubj(otherEs, "Newbie")}); LateAddr ${JSON.stringify(li)} (on Ivy ${countSubj(ivyEs, "LateAddr")}, Ivy Deal ${countSubj(dealEs, "LateAddr")})`);
  });
  await run("US3 scenario 8", async () => {
    const before = links(conv("DanConv"));
    await put(ada, A, { from: "Dan Closed <dan@example.test>", to: ADA, cc: BEN, subject: "Re: DanConv", text: "Adding Ben.", thread: gThread(A, "DanConv"), offset: 20 });
    const l = links(conv("DanConv"));
    R("US3 scenario 8", l.includes("p:Ben/auto") && l.includes("o:Other Co/auto") && l.includes("d:Other Co – renewal/auto") && conv("Re: DanConv") === conv("DanConv"), `before ${JSON.stringify(before)}; after ${JSON.stringify(l)}`);
  });
  await run("US3 scenario 9", async () => {
    await put(ada, A, { from: "Fay Pdeal <fay@example.test>", to: ADA, subject: "FayConv", text: "Fay here.", offset: 21 });
    const l = links(conv("FayConv"));
    const fay = pid("Fay"), deal = did("Fay Private Deal");
    const a1 = countSubj(await emailEntries(ada, `/people/${fay}`), "FayConv"), a2 = countSubj(await emailEntries(ada, `/deals/${deal}`), "FayConv");
    const b1 = countSubj(await emailEntries(lin, `/people/${fay}`), "FayConv");
    const r = await go(lin, `/deals/${deal}`); const b2 = r.status() === 404 ? 0 : countSubj(await emailEntries(lin), "FayConv");
    R("US3 scenario 9", l.includes("d:Fay Private Deal/auto") && a1 === 1 && a2 === 1 && b1 === 0 && b2 === 0, `links ${JSON.stringify(l)}; Ada: Fay ${a1}, deal ${a2}; Linus: Fay ${b1}, deal ${b2} (deal page ${r.status()})`);
  });

  // US6: Last contacted (Kim: two addresses).
  const lc = (first) => q(`select to_char(last_contacted_at at time zone 'UTC','YYYY-MM-DD HH24:MI') from persons where id=${pid(first)}`);
  const offTo = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / 60000);
  await run("US6 scenario 1", async () => {
    q(`update persons set last_contacted_at='2026-11-20 10:00+00' where id=${pid("Kim")}`);
    await put(ada, A, { from: "Kim Twoaddr <kim@example.test>", to: ADA, subject: "Kim1", text: "Hi.", offset: offTo("2026-11-25T14:05:00Z") });
    await go(ada, `/people/${pid("Kim")}`);
    const det = norm(await ada.locator(".recordleft").innerText());
    R("US6 scenario 1", lc("Kim") === "2026-11-25 14:05" && /25 Nov 2026/.test(det), `Kim last contacted ${lc("Kim")} (email at ${q(`select to_char(received_at at time zone 'UTC','YYYY-MM-DD HH24:MI') from email_messages where subject='Kim1'`)}); page: "${(det.match(/Last contacted[^A-Z]*/i) || [""])[0]}"`);
  });
  await run("US6 scenario 2", async () => {
    const before = lc("Kim");
    await put(ada, A, { from: "Kim Twoaddr <kim@example.test>", to: ADA, subject: "Kim2", text: "Old one.", offset: offTo("2026-11-22T09:00:00Z") });
    R("US6 scenario 2", before === "2026-11-25 14:05" && lc("Kim") === "2026-11-25 14:05" && q(`select count(*) from email_messages where subject='Kim2'`) === "1", `before ${before}; after the 22 Nov email ${lc("Kim")}`);
  });
  await run("US6 scenario 3", async () => {
    q(`update persons set last_contacted_at='2026-11-01 10:00+00' where id in (${ana}, ${ben})`);
    await put(ada, A, { sent: true, from: ADA, to: ANA, bcc: BEN, subject: "BccMail", text: "Ben is in Bcc.", offset: -30 });
    const t = q(`select to_char(received_at at time zone 'UTC','YYYY-MM-DD HH24:MI') from email_messages where subject='BccMail'`);
    R("US6 scenario 3", lc("Ana") === t && lc("Ben") === t, `email at ${t}; Ana ${lc("Ana")}, Ben ${lc("Ben")} (both were 2026-11-01)`);
  });
  await run("Edge case 6", async () => {
    const before = lc("Kim");
    await put(ada, A, { from: ADA, sent: true, to: "Kim Twoaddr <kim@example.test>, Kim Home <kim2@example.test>", subject: "KimBoth", text: "Both of Kim's addresses.", offset: 22 });
    const es = await emailEntries(ada, `/people/${pid("Kim")}`);
    const t = q(`select to_char(received_at at time zone 'UTC','YYYY-MM-DD HH24:MI') from email_messages where subject='KimBoth'`);
    R("Edge case 6", countSubj(es, "KimBoth") === 1 && lc("Kim") === t, `entries on Kim ${countSubj(es, "KimBoth")}; last contacted ${before} → ${lc("Kim")} (email ${t})`);
  });

  await run("Edge case 8", async () => {
    await put(ada, A, { from: "ana@example.test", to: "ada@barnacle.ai", subject: "", text: "No subject, no name.", offset: 23 });
    const es = await emailEntries(ada, `/people/${ana}`);
    const e = es.find((x) => x.text.includes("No subject, no name."));
    R("Edge case 8", e && e.head.startsWith("ana@example.test → ada@barnacle.ai") && e.subj === "(no subject)", e ? `head "${e.head}", subject "${e.subj}"` : "no entry");
  });
  await run("Edge case 9", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}xx`).join(" ") + " THE-END-MARK";
    await put(ada, A, { from: ANA, to: ADA, subject: "LongMail", text: long, offset: 24 });
    await go(ada, `/people/${ana}`);
    const snip = norm(await ada.locator("li.ent", { has: ada.locator(".subj", { hasText: /^LongMail$/ }) }).locator(".snip").innerText());
    await go(ada, `/emails/${conv("LongMail")}`);
    const full = norm(await ada.locator("article.msg .emailtext").innerText());
    R("Edge case 9", [...snip].length === 201 && snip.endsWith("…") && long.startsWith(snip.slice(0, -1)) && full === long, `text ${long.length} chars; snippet ${[...snip].length} chars ends "${snip.slice(-12)}"; conversation shows full: ${full === long}`);
  });
  await run("Edge case 10", async () => {
    await put(ada, A, { from: ANA, to: ADA, subject: "OnlyAtt", att: ["scan.pdf:5000"], offset: 25 });
    await go(ada, `/people/${ana}`);
    const li = ada.locator("li.ent", { has: ada.locator(".subj", { hasText: /^OnlyAtt$/ }) });
    R("Edge case 10", (await li.locator(".snip").count()) === 0 && norm(await li.locator(".emailatts").innerText()).includes("scan.pdf"), `snippet lines ${await li.locator(".snip").count()}; atts "${norm(await li.locator(".emailatts").innerText())}"`);
  });
  await run("Edge case 11", async () => {
    const names = ["a1.pdf:1000", "b2.png:2048", "c3.txt:10", "d4.docx:300000", "e5.zip:5242880", "f6.csv:999"];
    await put(ada, A, { from: ANA, to: ADA, subject: "ManyAtt", text: "Six files.", att: names, offset: 26 });
    await go(ada, `/people/${ana}`);
    const atts = (await ada.locator("li.ent", { has: ada.locator(".subj", { hasText: /^ManyAtt$/ }) }).locator(".att").allInnerTexts()).map(norm);
    R("Edge case 11", atts.length === 6 && names.every((n) => atts.some((a) => a.startsWith(n.split(":")[0] + " · "))), JSON.stringify(atts));
  });
  await run("Edge case 13", async () => {
    let dialog = false; ada.on("dialog", (d) => { dialog = true; d.dismiss(); });
    await put(ada, A, { from: "<i>Ana</i> <ana@example.test>", to: ADA, subject: "<script>alert(1)</script><b>Subj</b>", text: "<b>not bold</b> &amp; <img src=x onerror=alert(2)>", offset: 27 });
    await go(ada, `/people/${ana}`);
    const li = ada.locator("li.ent", { has: ada.locator(".subj", { hasText: "<b>Subj</b>" }) }).first();
    const t = norm(await li.innerText()); const h = await li.innerHTML();
    await go(ada, `/emails/${conv("<script>alert(1)</script><b>Subj</b>")}`);
    const h1 = norm(await ada.locator("h1").innerText()); const art = norm(await ada.locator("article.msg").innerText());
    R("Edge case 13", t.includes("<script>alert(1)</script><b>Subj</b>") && t.includes("<b>not bold</b>") && !/<b>|<img|<i>/.test(h) && h1 === "<script>alert(1)</script><b>Subj</b>" && art.includes("<img src=x onerror=alert(2)>") && !dialog,
      `entry "${t}"; elements b/img/i in entry: ${/<b>|<img|<i>/.test(h)}; heading "${h1}"; dialog ${dialog}`);
  });
  await run("Edge case 7", async () => {
    await put(ada, A, { from: "Linus Fake <linus@barnacle.ai>", to: ADA, subject: "TeamOnly", text: "Internal.", offset: 28 });
    const stored = q(`select count(*) from email_messages where subject='TeamOnly'`);
    const wrong = q(`select count(*) from email_links l join persons p on p.id=l.person_id join person_emails e on e.person_id=p.id where e.email like '%@barnacle.ai'`);
    const pl = links(conv("Proposal")).filter((x) => x.startsWith("p:"));
    R("Edge case 7", stored === "0" && wrong === "0" && pl.length === 1 && pl[0] === "p:Ana/auto", `team email stored ${stored}; links to people with a barnacle.ai address ${wrong}; Proposal person links ${JSON.stringify(pl)}`);
  });

  fs.writeFileSync("/tmp/sf127-a.json", JSON.stringify(S, null, 1));
  await browser.close();
})();
