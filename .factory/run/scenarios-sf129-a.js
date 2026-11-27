// SF-129 AI review, part A: US1, US2 (1-7), US5, edges 4-6, 8, 10, 12. Fresh data first (see test-env.md § SF-129).
const bare = (h) => (h || "").replace(/^.*<([^>]+)>$/, "$1");
const L = require("./sf129-lib.js");
const { q, norm, go, R, S, sleep } = L;
const fs = require("fs");
const tl = (p) => p.getByRole("region", { name: "Timeline" });
async function entries(p, path) { return L.emailEntries(p, path); }
async function newestIsEmail(p, subj) {
  const first = tl(p).locator("li.ent").first();
  const isEmail = (await first.locator(".kd.email").count()) > 0;
  const s = isEmail ? norm(await first.locator(".subj").innerText()) : null;
  return { ok: isEmail && s === subj, s };
}
const sentCount = () => L.sent(L.A).length;
const lastSent = () => L.sent(L.A).slice(-1)[0];
const bodyText = async (p) => norm(await p.locator("body").innerText());
const occurrences = (t, s) => t.split(s).length - 1;
async function pasteInto(p, label, text) {
  await p.locator(`.sidepanel input[aria-label="${label} addresses"]`).evaluate((el, t) => {
    el.focus(); const dt = new DataTransfer(); dt.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await p.waitForTimeout(200);
}
(async () => {
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const want = (n) => !only || only.includes(n);
  const b = await L.chromium.launch();
  const p = await L.pageAs(b, L.A);
  const deal = L.recId("deal", "Fake Deal Ltd renewal"), ana = L.recId("person", "Ana Fake"), ben = L.recId("person", "Ben Fake"), forg = L.recId("org", "Fake Org Ltd");
  const run = async (name, fn) => { if (!want(name)) return; try { await fn(); } catch (e) { R(name, false, "error: " + e.message.split("\n")[0]); } };

  await run("US1 scenario 1", async () => {
    await L.openBox(p, `/deals/${deal}`);
    const t = norm(await L.panel(p).innerText());
    const box = await L.panel(p).boundingBox(); const vp = p.viewportSize();
    const dim = await p.evaluate(() => getComputedStyle(document.querySelector(".sideoverlay")).backgroundColor);
    const h1 = await p.locator("h1", { hasText: "Fake Deal Ltd renewal" }).isVisible();
    const to = await L.chips(p, "To"), cc = await L.chips(p, "Cc"), bcc = await L.chips(p, "Bcc");
    const subj = await p.inputValue("#email-subject"), text = await p.inputValue("#email-text");
    const ok = /^\/\/ NEW EMAIL · FAKE DEAL LTD RENEWAL/i.test(t) && t.includes("FROM ada@barnacle.ai") && JSON.stringify(to) === '["ana@example.test"]' && !cc.length && !bcc.length && subj === "" && text === "" && box.x > vp.width / 3 && Math.round(box.x + box.width) === vp.width && box.height >= vp.height - 2 && /rgba\(.*0\.\d+\)/.test(dim) && h1;
    R("US1 scenario 1", ok, `heading "${t.slice(0, 40)}", From ada@barnacle.ai, To ${JSON.stringify(to)}, Cc/Bcc ${cc.length}/${bcc.length}, subject/text empty ${subj === "" && text === ""}; panel x=${box.x} w=${box.width} h=${box.height} of ${vp.width}x${vp.height}; overlay ${dim}; deal heading still visible on the left: ${h1}`);
  });
  await run("US1 scenario 2", async () => {
    const n0 = sentCount();
    await L.fill(p, { subject: "Next steps", text: "Hi Ana,\n\nHere is the plan." });
    await L.send(p);
    const s = L.sent(L.A); const m = s[s.length - 1];
    const body = await bodyText(p);
    const nw = await newestIsEmail(p, "Next steps");
    const closed = (await L.panel(p).count()) === 0;
    const ok = s.length === n0 + 1 && /ada@barnacle\.ai/.test(m.from) && bare(m.to) === "ana@example.test" && m.subject === "Next steps" && m.text.replace(/\r\n/g, "\n") === "Hi Ana,\n\nHere is the plan." && closed && occurrences(body, "Email sent to ana@example.test.") === 1 && nw.ok;
    R("US1 scenario 2", ok, `Sent +${s.length - n0}: From "${m.from}", To "${m.to}", Subject "${m.subject}", text ${JSON.stringify(m.text)}; box closed ${closed}; url ${p.url().replace(L.BASE, "")}; notice shown ${occurrences(body, "Email sent to ana@example.test.")}×; newest timeline entry EMAIL "${nw.s}"`);
  });
  await run("US1 scenario 3", async () => {
    await L.openBox(p, `/people/${ana}`);
    const to = await L.chips(p, "To");
    R("US1 scenario 3", JSON.stringify(to) === '["ana@example.test"]', `Ana Fake's page: To ${JSON.stringify(to)}`);
  });
  await run("US1 scenario 4", async () => {
    const zd = L.recId("deal", "Zed drawer deal");
    const pipe = q(`select pipeline_id from stages where id=1`);
    await go(p, `/deals?pipeline=${pipe}&open=${zd}`);
    const drawer = p.locator('aside.deal-drawer');
    await drawer.getByRole("link", { name: "[ WRITE EMAIL ]" }).click();
    await L.panel(p).waitFor(); await p.waitForLoadState("networkidle");
    const drawerStill = await drawer.isVisible(); const boardStill = (await p.locator(".board, [aria-label*='oard']").count()) > 0;
    const to = await L.chips(p, "To");
    const box = await L.panel(p).boundingBox();
    const n0 = sentCount();
    await L.fill(p, { subject: "Drawer hello", text: "From the drawer." });
    await L.send(p);
    const url = new URL(p.url());
    const drawerAfter = await drawer.isVisible();
    const first = drawer.getByRole("region", { name: "Timeline" }).locator("li.ent").first();
    const subj = (await first.locator(".kd.email").count()) ? norm(await first.locator(".subj").innerText()) : null;
    const ok = drawerStill && JSON.stringify(to) === '["zed@example.test"]' && box.x > 600 && sentCount() === n0 + 1 && url.searchParams.get("open") === String(zd) && drawerAfter && subj === "Drawer hello";
    R("US1 scenario 4", ok, `panel over board (${boardStill}) and drawer (still visible ${drawerStill}) at x=${box.x}; To ${JSON.stringify(to)}; after send url ${url.pathname + url.search}, drawer open ${drawerAfter}, newest drawer timeline entry EMAIL "${subj}"`);
  });
  await run("US1 scenario 5", async () => {
    const lo = L.recId("org", "Lone Org Ltd");
    await L.openBox(p, `/organisations/${lo}`);
    const to = await L.chips(p, "To");
    const n0 = sentCount();
    await L.fill(p, { to: ["ana@example.test"], subject: "Org hello", text: "From the org." });
    await L.send(p);
    const m = lastSent();
    R("US1 scenario 5", to.length === 0 && sentCount() === n0 + 1 && bare(m.to) === "ana@example.test", `To at open ${JSON.stringify(to)}; typed ana@example.test and sent: Sent +${sentCount() - n0}, To "${m.to}"`);
  });
  await run("US2 scenario 3", async () => {
    const lo = L.recId("org", "Lone Org Ltd");
    const a = L.countSubj(await entries(p, `/organisations/${lo}`), "Org hello"), b2 = L.countSubj(await entries(p, `/people/${ana}`), "Org hello");
    R("US2 scenario 3", a === 1 && b2 === 1, `"Org hello" on Lone Org Ltd ${a}×, on Ana Fake ${b2}×`);
  });
  await run("US1 scenario 6", async () => {
    await L.openBox(p, `/deals/${deal}`);
    await L.removeAll(p, "To");
    await L.fill(p, { to: ["ben@example.test"], cc: ["cat@example.test"], bcc: ["dan@example.test"], subject: "Three fields", text: "x" });
    const n0 = sentCount();
    await L.send(p);
    const m = lastSent();
    const all = [m.to, m.cc, m.bcc].join(",");
    R("US1 scenario 6", sentCount() === n0 + 1 && bare(m.to) === "ben@example.test" && m.cc === "cat@example.test" && m.bcc === "dan@example.test" && !all.includes("ana@"), `sent To "${m.to}", Cc "${m.cc}", Bcc "${m.bcc}"`);
  });
  await run("US1 scenario 7", async () => {
    const before = (await entries(p, `/deals/${deal}`)).length; const n0 = sentCount();
    let notes = [];
    for (const how of ["[ CANCEL ]", "[ CLOSE ]"]) {
      await L.openBox(p, `/deals/${deal}`);
      await L.fill(p, { cc: ["x@example.test"], subject: "Never sent", text: "nope" });
      await L.panel(p).getByRole("link", { name: how }).click();
      await L.panel(p).waitFor({ state: "detached" }); await p.waitForLoadState("networkidle");
      notes.push(`${how}: box closed, url ${p.url().replace(L.BASE, "")}`);
    }
    const after = (await entries(p, `/deals/${deal}`)).length;
    R("US1 scenario 7", sentCount() === n0 && after === before, notes.join("; ") + `; Sent ${n0}→${sentCount()}, deal EMAIL entries ${before}→${after}`);
  });
  await run("US2 scenario 1", async () => {
    await L.openBox(p, `/deals/${deal}`);
    await L.fill(p, { cc: ["ben@example.test"], subject: "Renewal terms", text: "Line one\nLine two\n\nLine four" });
    fs.writeFileSync("/tmp/terms.txt", "fake terms ".repeat(300));
    await p.setInputFiles('.sidepanel input[type="file"]', "/tmp/terms.txt");
    await p.locator(".sidepanel .attachlist li", { hasText: "terms.txt" }).waitFor();
    await L.send(p);
    const pipe = q(`select pipeline_id from stages where id=1`);
    const views = [["deal page", `/deals/${deal}`], ["drawer", `/deals?pipeline=${pipe}&open=${deal}`], ["Ana", `/people/${ana}`], ["Ben", `/people/${ben}`]];
    const notes = []; let ok = true; let e1;
    for (const [n, path] of views) {
      const es = (await entries(p, path)).filter((e) => e.subj === "Renewal terms");
      if (!e1) e1 = es[0];
      const e = es[0] || { text: "", head: "" };
      const good = es.length === 1 && e.head === "Ada Fake → Ana Fake · Cc Ben Fake" && e.text.includes("Line one") && /terms\.txt/.test(e.text) && /3\.2 KB|3 KB|KB/.test(e.text);
      ok = ok && good; notes.push(`${n}: ${es.length}× "${e.text.slice(0, 140)}"`);
    }
    await go(p, `/deals/${deal}`);
    await tl(p).locator("li.ent", { hasText: "Renewal terms" }).locator("a.subj").click();
    await p.waitForURL(/\/emails\//); await p.waitForLoadState("networkidle");
    const ct = await p.locator("main").innerText();
    const linked = norm(await p.locator("section", { hasText: "LINKED TO" }).first().innerText());
    const conv = ct.includes("Line one\nLine two\n\nLine four") || ct.replace(/\r/g, "").includes("Line one\nLine two\n\nLine four");
    const lk = /Fake Deal Ltd renewal/.test(linked) && /Ana Fake/.test(linked) && /Ben Fake/.test(linked);
    R("US2 scenario 1", ok && conv && lk, notes.join(" | ") + ` | conversation page: text with line breaks ${conv}; LINKED TO: ${linked.slice(0, 200)}`);
  });
  await run("US2 scenario 2", async () => {
    await L.openBox(p, `/people/${ana}`);
    await L.fill(p, { subject: "From Ana page", text: "hello" });
    await L.send(p);
    const a = L.countSubj(await entries(p, `/people/${ana}`), "From Ana page"), o = L.countSubj(await entries(p, `/organisations/${forg}`), "From Ana page"), d = L.countSubj(await entries(p, `/deals/${deal}`), "From Ana page");
    R("US2 scenario 2", a === 1 && o === 1 && d === 1, `Ana Fake ${a}×, Fake Org Ltd ${o}×, Fake Deal Ltd renewal ${d}×`);
  });
  await run("US2 scenario 4", async () => {
    const ud = L.recId("deal", "Unlink deal");
    const np = q("select count(*) from persons"), npe = q("select count(*) from person_emails where email='stranger@nowhere.test'");
    await L.openBox(p, `/deals/${ud}`);
    await L.fill(p, { to: ["stranger@nowhere.test"], subject: "To a stranger", text: "hi" });
    await L.send(p);
    const c = L.countSubj(await entries(p, `/deals/${ud}`), "To a stranger");
    const np2 = q("select count(*) from persons"), npe2 = q("select count(*) from person_emails where email='stranger@nowhere.test'");
    R("US2 scenario 4", c === 1 && np === np2 && npe2 === "0", `Unlink deal shows it ${c}×; persons ${np}→${np2}; person_emails with the address ${npe}→${npe2}`);
  });
  await run("US2 scenario 6", async () => {
    const pd = L.recId("deal", "Pia deal");
    await L.openBox(p, `/deals/${pd}`);
    await L.fill(p, { to: ["pia@example.test"], subject: "To private Pia", text: "secret" });
    await L.send(p);
    const ada = L.countSubj(await entries(p, `/deals/${pd}`), "To private Pia");
    const m = await L.pageAs(b, "margaret@barnacle.ai");
    await go(m, `/deals/${pd}`);
    const mt = await m.locator("main").innerText();
    const me = (await L.emailEntries(m)).length;
    R("US2 scenario 6", ada === 1 && me === 0 && !mt.includes("To private Pia") && !mt.includes("pia@example.test"), `Ada sees it ${ada}× on Pia deal; Margaret (cannot see Pia Private) sees ${me} EMAIL entries, subject in page ${mt.includes("To private Pia")}`);
    await m.context().close();
  });
  await run("US2 scenario 7", async () => {
    const lex = L.recId("person", "Lex Later");
    const anaLc = q(`select to_char(last_contacted_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') from persons where id=${ana}`);
    const sentAt = q(`select to_char(max(m.sent_at) at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') from email_messages m join email_threads t on t.id=m.thread_id join email_conversation_addresses a on a.conversation_id=t.conversation_id where a.email='ana@example.test'`);
    await L.openBox(p, `/people/${lex}`);
    await L.fill(p, { subject: "To Lex", text: "hi" }); await L.send(p);
    const lexLc = q(`select to_char(last_contacted_at at time zone 'UTC','YYYY-MM-DD') from persons where id=${lex}`);
    await go(p, `/people/${ana}`); const at = norm(await p.locator("main").innerText());
    const lcA = (at.match(/LAST CONTACTED\s*(.{0,30})/i) || [])[1];
    await go(p, `/people/${lex}`); const lt = norm(await p.locator("main").innerText());
    const lcL = (lt.match(/LAST CONTACTED\s*(.{0,30})/i) || [])[1];
    R("US2 scenario 7", anaLc === sentAt && lexLc === "2027-06-01", `Ana Fake (was 20 Nov 2026): last_contacted ${anaLc} = latest send ${sentAt}, page "${lcA}"; Lex Later (was 1 Jun 2027, later): ${lexLc}, page "${lcL}"`);
  });
  await run("US5 scenario 1", async () => {
    const una = L.recId("person", "Una Unsub"), ud = L.recId("deal", "Una deal");
    const notes = []; let ok = true;
    for (const [n, path] of [["page", `/people/${una}`], ["deal", `/deals/${ud}`]]) {
      await L.openBox(p, path);
      const to = await L.chips(p, "To"); const t = norm(await L.panel(p).innerText());
      const warn = /consent|unsubscrib/i.test(t);
      const n0 = sentCount();
      await L.fill(p, { subject: `Una from ${n}`, text: "hi" }); await L.send(p);
      const good = JSON.stringify(to) === '["una@example.test"]' && !warn && sentCount() === n0 + 1;
      ok = ok && good; notes.push(`${n}: To ${JSON.stringify(to)}, warning ${warn}, sent +${sentCount() - n0}`);
    }
    R("US5 scenario 1", ok, notes.join("; "));
  });
  await run("US5 scenario 2", async () => {
    const una = L.recId("person", "Una Unsub");
    await go(p, `/people/${una}`);
    const t = norm(await p.locator("main").innerText());
    const c = (t.match(/CONSENT\s*(\w+)/i) || [])[1];
    const es = await L.emailEntries(p);
    const db = q(`select consent from persons where id=${una}`);
    R("US5 scenario 2", /unsubscribed/i.test(c || "") && db === "unsubscribed" && L.countSubj(es, "Una from page") === 1, `Consent on page "${c}", db ${db}; EMAIL entries: ${L.subjects(es).join(", ")}`);
  });
  await run("Edge case 4", async () => {
    const n0 = sentCount();
    await L.openBox(p, `/deals/${deal}`);
    await L.removeAll(p, "To");
    await L.fill(p, { to: ["ana@"], subject: "Bad addr", text: "x" });
    await L.send(p, { expectClose: false });
    const e1 = await L.errs(p);
    const n1 = sentCount();
    await L.removeAll(p, "To");
    await L.fill(p, { to: ["Ana@Example.test"], cc: ["ana@example.test "] });
    await L.send(p);
    const m = lastSent();
    await L.openBox(p, `/deals/${deal}`);
    await L.removeAll(p, "To");
    await pasteInto(p, "To", "a@example.test, b@example.test; c@example.test");
    const pasted = await L.chips(p, "To");
    const ok = e1.includes("ana@ is not a valid email address.") && n1 === n0 && sentCount() === n0 + 1 && bare(m.to).toLowerCase() === "ana@example.test" && m.cc === "" && pasted.length === 3;
    R("Edge case 4", ok, `"ana@": ${JSON.stringify(e1)}, Sent ${n0}→${n1}; To Ana@Example.test + Cc "ana@example.test ": sent To "${m.to}", Cc "${m.cc}"; pasted → ${JSON.stringify(pasted)}`);
  });
  await run("Edge case 5", async () => {
    const n0 = sentCount(); const notes = []; let ok = true;
    const cases = [
      ["To empty", { subject: "s", text: "t" }, "Add at least one address in To.", true],
      ["subject empty", { to: ["ana@example.test"], text: "t" }, "Add a subject.", false],
      ["101 addresses", { subject: "s", text: "t", paste: Array.from({ length: 101 }, (_, i) => `p${i}@example.test`).join(", ") }, "An email can go to 100 addresses at most.", true],
      ["251-char subject", { to: ["ana@example.test"], subject: "x".repeat(251), text: "t" }, "The subject can be 250 characters at most.", false],
      ["100,001-char text", { to: ["ana@example.test"], subject: "s", text: "y".repeat(100001) }, "The text can be 100,000 characters at most.", false],
    ];
    for (const [n, f, msg] of cases) {
      await L.openBox(p, `/deals/${deal}`);
      await L.removeAll(p, "To");
      if (f.paste) await pasteInto(p, "To", f.paste);
      await L.fill(p, f);
      await L.send(p, { expectClose: false });
      const e = await L.errs(p);
      const good = e.includes(msg) && sentCount() === n0;
      ok = ok && good; notes.push(`${n}: ${JSON.stringify(e)}${good ? "" : " ✗"}`);
    }
    await L.openBox(p, `/deals/${deal}`);
    await L.fill(p, { subject: "Empty text ok" }); await L.send(p);
    const m = lastSent();
    ok = ok && sentCount() === n0 + 1 && m.subject === "Empty text ok";
    R("Edge case 5", ok, notes.join("; ") + `; Sent unchanged through the five; empty text + subject sent: "${m.subject}" text ${JSON.stringify(m.text)}`);
  });
  await run("Edge case 6", async () => {
    const zd = L.recId("deal", "Zed drawer deal"), zed = L.recId("person", "Zed Drawer");
    await L.openBox(p, `/deals/${zd}`);
    await L.removeAll(p, "To");
    await L.fill(p, { to: ["bob@barnacle.ai"], subject: "To teammate Bob", text: "hi" });
    const n0 = sentCount(); await L.send(p);
    const d = L.countSubj(await entries(p, `/deals/${zd}`), "To teammate Bob");
    const c = L.conv("To teammate Bob");
    const lk = L.links(c);
    const z = L.countSubj(await entries(p, `/people/${zed}`), "To teammate Bob");
    R("Edge case 6", sentCount() === n0 + 1 && d === 1 && lk.every((x) => !x.startsWith("p:")) && z === 0, `sent +${sentCount() - n0}; Zed drawer deal shows it ${d}×; its links ${JSON.stringify(lk)} (no person); Zed Drawer's page ${z}×`);
  });
  await run("Edge case 8", async () => {
    await L.openBox(p, `/deals/${deal}`);
    await L.fill(p, { cc: ["ana.k@example.test"], subject: "Two of Ana", text: "hi" }); await L.send(p);
    const es = (await entries(p, `/people/${ana}`)).filter((e) => e.subj === "Two of Ana");
    const m = lastSent();
    R("Edge case 8", es.length === 1 && m.to === "Ana Fake <ana@example.test>" && m.cc === "Ana Fake <ana.k@example.test>" && es[0].head === "Ada Fake → Ana Fake · Cc Ana Fake", `sent To ${m.to} Cc ${m.cc}; Ana Fake's page ${es.length}× "${es[0] && es[0].head}"`);
  });
  await run("Edge case 10", async () => {
    const before = (await entries(p, `/deals/${deal}`)).length; const n0 = sentCount();
    await L.openBox(p, `/deals/${deal}`);
    await L.fill(p, { subject: "Double press", text: "once" });
    await L.panel(p).getByRole("button", { name: "[ SEND ]" }).dblclick();
    await L.panel(p).waitFor({ state: "detached", timeout: 60000 }); await p.waitForLoadState("networkidle");
    const after = await entries(p, `/deals/${deal}`);
    R("Edge case 10", sentCount() === n0 + 1 && after.length === before + 1 && L.countSubj(after, "Double press") === 1, `double click on [ SEND ]: Sent +${sentCount() - n0}, deal EMAIL entries ${before}→${after.length}`);
  });
  await run("Edge case 12", async () => {
    const txt = "Bonjour Zoë,\n\n<b>prix</b> 🎉\nhttps://example.test";
    await L.openBox(p, `/deals/${deal}`);
    await L.fill(p, { subject: "Chars", text: txt }); await L.send(p);
    const m = lastSent();
    await go(p, `/deals/${deal}`);
    await tl(p).locator("li.ent", { hasText: "Chars" }).locator("a.subj").first().click();
    await p.waitForURL(/\/emails\//); await p.waitForLoadState("networkidle");
    const ct = await p.locator("main").innerText();
    const bold = await p.locator("main b, main strong").filter({ hasText: "prix" }).count();
    const lines = ct.includes("Bonjour Zoë,\n\n<b>prix</b> 🎉\nhttps://example.test");
    R("Edge case 12", m.text.replace(/\r\n/g, "\n") === txt && bold === 0 && lines, `sent text ${JSON.stringify(m.text)}; conversation page shows the text with its lines ${lines}, bold <b> elements ${bold}`);
  });
  await run("US2 scenario 5", async () => {
    await go(p, "/settings");
    const c0 = norm(await p.locator('section[aria-label="Gmail"]').innerText()).match(/(\d+) conversations?/)?.[0];
    const before = {};
    const pages = { deal: `/deals/${deal}`, ana: `/people/${ana}`, ben: `/people/${ben}`, org: `/organisations/${forg}` };
    for (const [k, path] of Object.entries(pages)) before[k] = L.subjects(await entries(p, path)).sort().join("|");
    await L.runCheck(p, L.A);
    // a push notice too
    const n = JSON.parse(L.ctl("notice", L.A));
    let pushStatus = "no notice";
    if (n) { const r = await fetch(L.BASE + "/gmail/push", { method: "POST", headers: { authorization: n.authorization, "content-type": "application/json" }, body: typeof n.body === "string" ? n.body : JSON.stringify(n.body) }); pushStatus = r.status; }
    await sleep(1500);
    let same = true; const notes = [];
    for (const [k, path] of Object.entries(pages)) { const a = L.subjects(await entries(p, path)).sort().join("|"); if (a !== before[k]) same = false; const dup = a.split("|").filter((x, i, arr) => arr.indexOf(x) !== i); notes.push(`${k}: ${a.split("|").length} entries, duplicates ${JSON.stringify(dup)}`); }
    await go(p, "/settings");
    const c1 = norm(await p.locator('section[aria-label="Gmail"]').innerText()).match(/(\d+) conversations?/)?.[0];
    const dupMsgs = q("select count(*) from (select gmail_message_id from email_messages group by connection_id, gmail_message_id having count(*)>1) x");
    R("US2 scenario 5", same && c0 === c1 && dupMsgs === "0", `15-minute check + push (${pushStatus}); timelines unchanged ${same} (${notes.join("; ")}); Settings "${c0}" → "${c1}"; duplicate stored messages ${dupMsgs}`);
  });
  fs.writeFileSync("/tmp/sf129-a.json", JSON.stringify(S, null, 1));
  await b.close();
})();
