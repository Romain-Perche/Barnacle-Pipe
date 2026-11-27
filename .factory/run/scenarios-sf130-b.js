// SF-130 AI review, part B (after part A on the same data): US2 1/3/4/5, US4 (forward), US5, edges 1-17.
const L = require("./sf130-lib.js");
const { q, norm, go, R, S, A } = L;
const fs = require("fs");
const LI = "linus@barnacle.ai", G = "grace@barnacle.ai", M = "margaret@barnacle.ai";
const convOfMsg = (id) => Number(q(`select t.conversation_id from email_messages m join email_threads t on t.id=m.thread_id where m.id=${id}`));
const convCount = () => Number(q(`select count(*) from email_conversations`));
const msgCount = (c) => Number(q(`select count(distinct m.dedupe_key) from email_messages m join email_threads t on t.id=m.thread_id where t.conversation_id=${c}`));
const msgRows = (c) => Number(q(`select count(*) from email_messages m join email_threads t on t.id=m.thread_id where t.conversation_id=${c}`));
const tlCount = async (p, path, subj) => (await L.emailEntries(p, path)).filter((e) => e.subj === subj).length;
(async () => {
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const want = (n) => !only || only.includes(n);
  async function run(n, fn) { if (!want(n)) return; try { await fn(); } catch (e) { R(n, false, "error: " + String(e.message).split("\n")[0]); } }
  const b = await L.chromium.launch();
  const p = await L.pageAs(b, A);
  const deal = L.recId("deal", "Fake Deal Ltd renewal"), ana = L.recId("person", "Ana Fake"), forg = L.recId("org", "Fake Org Ltd");
  const put = (o) => L.put(p, A, o);
  if (!process.env.SKIP_DATA) {
    const big = "A".repeat(99) + "\n";
    await put({ from: "Ana Fake <ana@example.test>", to: A, subject: "Pricing pack", text: "Our pack.\nTwo files.", att: ["quote.pdf:2097152", "plan.png:307200"] });
    await put({ from: "ana@example.test", to: A, subject: "Fwd: Old news", text: "x" });
    await put({ from: "ana@example.test", to: A, subject: "FW: Older", text: "x" });
    await put({ from: "ana@example.test", to: A, subject: "Big pack", text: "big", att: ["a.bin:20971520", "b.bin:10485760"] });
    await put({ from: "pia@example.test", to: A, subject: "Pia conv", text: "private" });
    await put({ from: "ben@example.test", to: A, subject: "Ben conv", text: "ben" });
    await put({ from: "ana@example.test", to: A, subject: "Gone conv", text: "gone" });
    await put({ from: "fio@example.test", to: A, subject: "Fio conv", text: "fio" });
    await put({ from: "ana@example.test", to: `${A}, ben@example.test`, subject: "Unknown sender conv", text: "u" });
    await put({ from: "ana@example.test", to: A, subject: "NoMid conv", text: "first", messageId: "<nomid-0@example.test>" });
    await put({ from: "ana@example.test", to: A, subject: "NoMid conv", text: "second", messageId: "<nomid-1@example.test>", thread: null });
    await put({ from: "ana@example.test", to: A, subject: "Html conv", html: "<p>Hello <b>there</b></p><p>Line two</p>" });
    await put({ from: "ana@example.test", to: A, subject: "Empty conv", text: "" });
    await put({ from: "ana@example.test", to: A, subject: "Long conv", text: big.repeat(1500) });
    await put({ from: "Ana K <ana@example.test>", to: A, subject: "Names conv", text: "named" });
    await put({ from: "ana@example.test", to: A, subject: "Chars conv", text: "<b>prix</b> 🎉" });
    await put({ from: "ana@example.test", to: A, subject: "Not recorded", text: "nr" });
    await put({ from: "ari@example.test", to: A, subject: "Arch conv", text: "arch" });
    await put({ from: "zed@example.test", to: A, subject: "Drawer conv", text: "drawer" });
  }
  const pricing = L.mid("Pricing"), pconv = convOfMsg(pricing);

  // ---- US4 forward
  const pack = L.mid("Pricing pack");
  await run("US4 scenario 1", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Pricing pack"), "[ FORWARD ]");
    const s = await L.boxState(p);
    const rm = await L.rpanel(p).locator(".attachlist li button.chip-x").count();
    R("US4 scenario 1", s.heading === "// FORWARD · Pricing pack" && s.to.length + s.cc.length + s.bcc.length === 0 && s.subject === "Fwd: Pricing pack" && s.atts.length === 2 && /quote\.pdf/.test(s.atts[0]) && /plan\.png/.test(s.atts[1]) && rm === 2 && s.room === "2.3 MB of 25 MB",
      `(subject "Pricing pack" instead of "Pricing") heading "${s.heading}", To/Cc/Bcc ${s.to.length}/${s.cc.length}/${s.bcc.length}, Subject "${s.subject}", attachments ${JSON.stringify(s.atts)} with ${rm} remove buttons, room "${s.room}"`);
  });
  let fwd1;
  await run("US4 scenario 2", async () => {
    await L.addAddr(p, "To", "ed@example.test"); await p.fill("#email-text", "See below.");
    const n0 = L.sent130(A).length;
    await L.sendReply(p);
    const s = L.sent130(A); fwd1 = s[s.length - 1];
    const orig = L.ctl130("att", A, "Pricing pack");
    const recv = q(`select received_at from email_messages where id=${pack}`);
    const t = fwd1.text.replace(/\r\n/g, "\n");
    const ok = s.length === n0 + 1 && fwd1.to.trim() === "ed@example.test" && fwd1.subject === "Fwd: Pricing pack" && /^See below\.\n\n---------- Forwarded message ---------\nFrom: Ana Fake <ana@example\.test>\nDate: \d{1,2} \w{3} \d{4} at \d\d:\d\d\nSubject: Pricing pack\nTo: ada@barnacle\.ai\n\nOur pack\.\nTwo files\.\s*$/.test(t)
      && JSON.stringify(fwd1.attachments) === JSON.stringify(orig) && !!fwd1.inReplyTo;
    R("US4 scenario 2", ok, `sent To "${fwd1.to}", Subject "${fwd1.subject}", text ${JSON.stringify(t)}; attachments ${JSON.stringify(fwd1.attachments)} vs earlier ${JSON.stringify(orig)}; In-Reply-To ${fwd1.inReplyTo}`);
  });
  await run("US4 scenario 3", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Pricing pack"), "[ FORWARD ]");
    await L.rpanel(p).getByRole("button", { name: "Remove plan.png" }).click();
    await L.addAddr(p, "To", "ed@example.test");
    await L.sendReply(p);
    const s = L.sent130(A); const m = s[s.length - 1];
    R("US4 scenario 3", m.attachments.length === 1 && m.attachments[0].name === "quote.pdf", `sent attachments ${JSON.stringify(m.attachments.map((a) => a.name))}`);
  });
  await run("US4 scenario 4", async () => {
    fs.writeFileSync("/tmp/extra.txt", "fake extra ".repeat(100));
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Pricing pack"), "[ FORWARD ]");
    await p.setInputFiles('.sidepanel input[type="file"]', "/tmp/extra.txt");
    await p.locator(".sidepanel .attachlist li", { hasText: "extra.txt" }).waitFor();
    const room = norm(await L.rpanel(p).locator(".tot").innerText());
    await L.addAddr(p, "To", "ed@example.test");
    await L.sendReply(p);
    const s = L.sent130(A); const m = s[s.length - 1];
    R("US4 scenario 4", JSON.stringify(m.attachments.map((a) => a.name)) === '["quote.pdf","plan.png","extra.txt"]' && room === "2.3 MB of 25 MB", `room with a computer file "${room}"; sent attachments ${JSON.stringify(m.attachments.map((a) => a.name + ":" + a.size))}`);
  });
  await run("Edge case 16", async () => {
    fs.writeFileSync("/tmp/big23.bin", Buffer.alloc(23 * 1024 * 1024, 1));
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Pricing pack"), "[ FORWARD ]");
    await p.setInputFiles('.sidepanel input[type="file"]', "/tmp/big23.bin");
    await p.waitForTimeout(3000);
    const s = await L.boxState(p);
    const n0 = L.sent130(A).length;
    await L.addAddr(p, "To", "ed@example.test");
    await L.rpanel(p).getByRole("button", { name: "[ SEND ]" }).click().catch(() => {}); await p.waitForTimeout(2000);
    const n1 = L.sent130(A).length;
    R("Edge case 16", s.notices.some((t) => t.includes("Attachments can be 25 MB in total at most.")) && n1 === n0, `forward 2.3 MB + a 23 MB computer file: notices ${JSON.stringify(s.notices)}, attachments ${JSON.stringify(s.atts)}, room "${s.room}"; [ SEND ] sent ${n1 - n0}`);
  });
  await run("US4 scenario 5", async () => {
    const r = [];
    for (const subj of ["Fwd: Old news", "FW: Older"]) { await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, subj), "[ FORWARD ]"); r.push([subj, await p.inputValue("#email-subject")]); }
    R("US4 scenario 5", r.every(([a, b]) => a === b), r.map(([a, b]) => `"${a}" → "${b}"`).join("; "));
  });
  await run("US4 scenario 6", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Big pack"), "[ FORWARD ]");
    const s = await L.boxState(p);
    await L.addAddr(p, "To", "ed@example.test");
    const n0 = L.sent130(A).length;
    await L.rpanel(p).getByRole("button", { name: "[ SEND ]" }).click().catch(() => {}); await p.waitForTimeout(2000);
    const n1 = L.sent130(A).length;
    await L.rpanel(p).getByRole("button", { name: "Remove a.bin" }).click();
    const s2 = await L.boxState(p);
    await L.sendReply(p);
    const n2 = L.sent130(A).length;
    R("US4 scenario 6", s.atts.length === 2 && s.notices.some((t) => t === "Attachments can be 25 MB in total at most.") && n1 === n0 && n2 === n0 + 1, `listed ${JSON.stringify(s.atts)}, notices ${JSON.stringify(s.notices)}, room ${s.room}; [ SEND ] sent ${n1 - n0}; after removing a.bin (room ${s2.room}, notices ${JSON.stringify(s2.notices)}) sent ${n2 - n0}`);
  });
  await run("US4 scenario 7", async () => {
    L.ctl130("failatt", "on");
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Pricing pack"), "[ FORWARD ]");
    await L.addAddr(p, "To", "ed@example.test"); await p.fill("#email-text", "Keep me");
    const n0 = L.sent130(A).length; const k0 = Number(q(`select count(*) from email_sends`));
    await L.sendReply(p, { expectClose: false });
    const s = await L.boxState(p);
    L.ctl130("failatt", "off");
    const n1 = L.sent130(A).length;
    R("US4 scenario 7", n1 === n0 && s.text === "Keep me" && s.atts.length === 2 && JSON.stringify(s.toAddr) === '["ed@example.test"]' && s.notices.includes("One of the forwarded attachments can't be fetched from Gmail right now. Remove it or try again later.") && Number(q(`select count(*) from email_sends`)) === k0, `sent ${n1 - n0}; box kept text "${s.text}", To ${JSON.stringify(s.toAddr)}, attachments ${s.atts.length}; notices ${JSON.stringify(s.notices)}`);
  });
  await run("US4 scenario 8", async () => {
    const c = convOfMsg(pack);
    const links0 = L.links(c);
    await go(p, `/emails/${c}`);
    const arts = (await p.locator("article.msg").allInnerTexts()).map(norm);
    const fwdListed = arts.filter((t) => t.includes("Fwd: Pricing pack") || t.includes("ed@example.test")).length;
    R("US4 scenario 8", convOfMsg(Number(q(`select id from email_messages where rfc_message_id='${fwd1.messageId}' limit 1`))) === c && fwdListed >= 1 && JSON.stringify(L.links(c)) === JSON.stringify(links0), `forward ${fwd1.messageId} in conversation ${c}; page lists ${arts.length} emails (${fwdListed} to ed); links ${JSON.stringify(links0)} (unchanged)`);
  });

  // ---- US2
  const lp = await L.pageAs(b, LI);
  await run("US2 scenario 1", async () => {
    await L.connect(lp);
    const cid = convOfMsg(L.mid("Colleague conv")); const c0 = convCount(); const links0 = L.links(cid);
    await go(lp, `/deals/${deal}`);
    await L.openReply(lp, L.entryOf(lp, "Colleague conv"), "[ REPLY ]");
    await lp.fill("#email-text", "From Linus.");
    await L.sendReply(lp);
    const s = L.sent130(LI); const m = s[s.length - 1];
    const stored = Number(q(`select id from email_messages where rfc_message_id='${m.messageId}' limit 1`));
    const onDeal = await tlCount(lp, `/deals/${deal}`, "Re: Colleague conv");
    const onAna = await tlCount(lp, `/people/${ana}`, "Re: Colleague conv");
    await go(lp, `/emails/${cid}`); const listed = (await lp.locator("article.msg").allInnerTexts()).some((t) => t.includes("From Linus."));
    R("US2 scenario 1", m.from.includes(LI) && m.inReplyTo === "<colleague-1@example.test>" && m.references === "<colleague-1@example.test>" && convOfMsg(stored) === cid && convCount() === c0 && onDeal === 1 && onAna === 1 && listed && JSON.stringify(L.links(cid)) === JSON.stringify(links0),
      `Linus sent From ${m.from}, In-Reply-To ${m.inReplyTo}, References ${m.references}, new Gmail thread ${m.threadId}; stored in conversation ${convOfMsg(stored)} (=${cid}), conversations ${c0}→${convCount()}; deal timeline ×${onDeal}, Ana's ×${onAna}, conversation page lists it ${listed}; links ${JSON.stringify(L.links(cid))}`);
  });
  await run("US2 scenario 3", async () => {
    const cid = convOfMsg(L.mid("Links conv"));
    const lone = L.recId("org", "Lone Org Ltd");
    q(`insert into email_links (conversation_id, organisation_id, how) values (${cid}, ${lone}, 'manual') on conflict do nothing`);
    q(`update email_links set removed=true where conversation_id=${cid} and deal_id=${deal}`);
    const links0 = L.links(cid);
    await go(p, `/emails/${cid}`);
    await L.openReply(p, p.locator("article.msg").first(), "[ REPLY ]");
    await p.fill("#email-text", "links stay"); await L.sendReply(p);
    R("US2 scenario 3", JSON.stringify(L.links(cid)) === JSON.stringify(links0) && links0.some((l) => l.startsWith("o:Lone Org Ltd/manual")) && links0.some((l) => l.includes("(removed)")) && msgCount(cid) === 2, `links before ${JSON.stringify(links0)}, after ${JSON.stringify(L.links(cid))} (hand link and removal made by SQL as SF-127's link/unlink store them)`);
  });
  await run("US2 scenario 4", async () => {
    const zed = L.recId("person", "Zed Drawer");
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Pricing"), "[ REPLY ]");
    await L.addAddr(p, "Cc", "zed@example.test"); await p.fill("#email-text", "Adding Zed.");
    await L.sendReply(p);
    const lk = L.links(pconv);
    const onZed = await tlCount(p, `/people/${zed}`, "Re: Pricing");
    R("US2 scenario 4", lk.includes("p:Zed/auto") && lk.includes("o:Zed Org Ltd/auto") && lk.includes("d:Zed drawer deal/auto") && onZed >= 1, `links now ${JSON.stringify(lk)}; Zed Drawer's timeline shows "Re: Pricing" ×${onZed}`);
  });
  await run("US2 scenario 5", async () => {
    const n0 = msgRows(pconv), d0 = msgCount(pconv), c0 = convCount();
    const cp0 = q(`select coalesce(sum(copied),0) from past_email_fetches`);
    const e0 = await tlCount(p, `/deals/${deal}`, "Re: Pricing");
    await L.runCheck(p, A);
    const n1 = msgRows(pconv), d1 = msgCount(pconv);
    const e1 = await tlCount(p, `/deals/${deal}`, "Re: Pricing");
    const cp1 = q(`select coalesce(sum(copied),0) from past_email_fetches`);
    R("US2 scenario 5", n0 === n1 && d0 === d1 && convCount() === c0 && e0 === e1 && cp0 === cp1, `after the 15-minute check: rows in the conversation ${n0}→${n1}, distinct emails ${d0}→${d1}, conversations ${c0}→${convCount()}, deal timeline "Re: Pricing" ${e0}→${e1}, copied count ${cp0}→${cp1}`);
  });

  // ---- US5
  const gp = await L.pageAs(b, G);
  await run("US5 scenario 1", async () => {
    const r = [];
    for (const path of [`/deals/${deal}`, `/emails/${pconv}`]) {
      await go(gp, path);
      const conn = await gp.getByRole("link", { name: "[ CONNECT GMAIL TO REPLY ]" }).count();
      const href = conn ? await gp.getByRole("link", { name: "[ CONNECT GMAIL TO REPLY ]" }).first().getAttribute("href") : null;
      const btn = await gp.getByRole("link", { name: /^\[ (REPLY|REPLY ALL|FORWARD) \]$/ }).count();
      const emails = path.startsWith("/deals") ? await gp.getByRole("region", { name: "Timeline" }).locator("li.ent:has(.kd.email)").count() : await gp.locator("article.msg").count();
      r.push({ path, emails, conn, href, btn });
    }
    R("US5 scenario 1", r.every((x) => x.conn === x.emails && x.emails > 0 && x.href === "/settings" && x.btn === 0), "Grace (never connected): " + JSON.stringify(r));
  });
  await run("US5 scenario 5", async () => {
    await go(gp, `/deals/${deal}?email=reply-${pricing}`);
    await L.rpanel(gp).waitFor();
    const t = norm(await L.rpanel(gp).innerText());
    const send = await L.rpanel(gp).getByRole("button", { name: "[ SEND ]" }).count();
    R("US5 scenario 5", t.includes("Connect your Gmail in Settings to send email from the CRM.") && /GO TO SETTINGS/.test(t) && send === 0, `box: "${t.slice(0, 200)}", [ SEND ] ×${send}`);
  });
  await run("US5 scenario 2", async () => {
    q(`update gmail_connections set state='needs_reconnect' where email='${LI}'`);
    const r = [];
    for (const path of [`/deals/${deal}`, `/emails/${pconv}`]) {
      await go(lp, path);
      const c = await lp.getByRole("link", { name: "[ RECONNECT GMAIL TO REPLY ]" }).count();
      const href = c ? await lp.getByRole("link", { name: "[ RECONNECT GMAIL TO REPLY ]" }).first().getAttribute("href") : null;
      const btn = await lp.getByRole("link", { name: /^\[ (REPLY|REPLY ALL|FORWARD) \]$/ }).count();
      r.push({ path, c, href, btn });
    }
    q(`update gmail_connections set state='working' where email='${LI}'`);
    R("US5 scenario 2", r.every((x) => x.c > 0 && x.href === "/settings" && x.btn === 0), "Linus (needs reconnecting): " + JSON.stringify(r));
  });
  await run("US5 scenario 3", async () => {
    const BASE3 = "http://localhost:3003";
    const ctx = await b.newContext(); const p3 = await ctx.newPage();
    await p3.goto(BASE3 + "/dev/fake-google"); await p3.fill('input[name="email"]:visible', A);
    if (await p3.locator('input[name="name"]:visible').count()) await p3.fill('input[name="name"]:visible', "Ada Fake");
    await Promise.all([p3.waitForLoadState("networkidle"), p3.click("text=[ CONTINUE ]")]);
    const r = [];
    for (const path of [`/deals/${deal}`, `/emails/${pconv}`]) {
      await p3.goto(BASE3 + path); await p3.waitForLoadState("networkidle");
      const t = norm(await p3.locator("main").innerText());
      r.push({ path, buttons: /\[ (REPLY|REPLY ALL|FORWARD) \]/.test(t), link: /GMAIL TO REPLY/.test(t), emails: path.startsWith("/deals") ? await p3.locator("li.ent:has(.kd.email)").count() : await p3.locator("article.msg").count() });
    }
    R("US5 scenario 3", r.every((x) => !x.buttons && !x.link && x.emails > 0), "Gmail off app on :3003, Ada: " + JSON.stringify(r));
  });
  await run("US5 scenario 4", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Pricing"), "[ REPLY ]");
    await p.fill("#email-text", "Typed before refusal"); await L.addAddr(p, "Cc", "ben@example.test");
    const p2 = await p.context().newPage();
    await go(p2, "/dev/fake-gmail?user=" + encodeURIComponent(A));
    await Promise.all([p2.waitForURL(/done=/), p2.click("text=[ REFUSE THE KEY ]")]); await p2.close();
    const n0 = L.sent130(A).length;
    await L.sendReply(p, { expectClose: false }); await p.waitForTimeout(1500);
    const s = await L.boxState(p);
    const settingsLink = norm(await p.locator("nav a[href='/settings'], aside a[href='/settings']").first().innerText().catch(() => ""));
    const panelT = norm(await L.rpanel(p).innerText());
    const n1 = L.sent130(A).length;
    R("US5 scenario 4", n1 === n0 && s.text === "Typed before refusal" && s.ccAddr.includes("ben@example.test") && /reconnect/i.test(panelT) && /!/.test(settingsLink), `sent ${n1 - n0}; text kept "${s.text}", Cc ${JSON.stringify(s.ccAddr)}; notices ${JSON.stringify(s.notices)}; sidebar "${settingsLink}"`);
    await L.connect(p);
  });

  // ---- Edges
  const mp = await L.pageAs(b, M);
  await run("Edge case 1", async () => {
    const pm = L.mid("Pia conv"), pc = convOfMsg(pm);
    await go(mp, `/deals/${deal}`);
    const sees = (await L.emailEntries(mp)).filter((e) => e.subj === "Pia conv").length;
    await go(mp, `/emails/${pc}?email=reply-${pm}`);
    const t1 = norm(await mp.locator("body").innerText());
    await go(mp, `/deals/${deal}?email=reply-${pm}`);
    const t2 = (await mp.locator(".sidepanel").count()) ? norm(await mp.locator(".sidepanel").innerText()) : "(no box)";
    const send = await mp.getByRole("button", { name: "[ SEND ]" }).count();
    R("Edge case 1", sees === 0 && t1.includes("This conversation doesn't exist or you can't see it.") && !/\[ REPLY \]/.test(t1) && t2.includes("This conversation doesn't exist or you can't see it.") && send === 0, `Margaret (cannot see Ada's private Pia): Pia conv entries ${sees}; conversation page with ?email=reply: "${t1.match(/This conversation[^.]*\./)?.[0]}"; reply address on a deal she can see: "${t2.slice(0, 120)}"; [ SEND ] ×${send}`);
  });
  await run("Edge case 2", async () => {
    const notes = []; let ok = true;
    const bm = L.mid("Ben conv"), ben = L.recId("person", "Ben Fake");
    await go(p, `/emails/${convOfMsg(bm)}`);
    await L.openReply(p, p.locator("article.msg").first(), "[ REPLY ]");
    await p.fill("#email-text", "Kept text 1");
    q(`update persons set private=true, owner_id=2, created_by=2 where id=${ben}`);
    let n0 = L.sent130(A).length;
    await L.sendReply(p, { expectClose: false });
    let s = await L.boxState(p);
    q(`update persons set private=false, owner_id=1, created_by=1 where id=${ben}`);
    ok = ok && L.sent130(A).length === n0 && s.text === "Kept text 1" && s.notices.includes("This conversation doesn't exist or you can't see it.");
    notes.push(`Ben made Grace's private: sent ${L.sent130(A).length - n0}, text "${s.text}", notices ${JSON.stringify(s.notices)}`);
    const gm = L.mid("Gone conv");
    await go(p, `/emails/${convOfMsg(gm)}`);
    await L.openReply(p, p.locator("article.msg").first(), "[ REPLY ]");
    await p.fill("#email-text", "Kept text 2");
    q(`delete from email_attachments where message_id=${gm}; delete from email_messages where id=${gm}`);
    n0 = L.sent130(A).length;
    await L.sendReply(p, { expectClose: false });
    s = await L.boxState(p);
    ok = ok && L.sent130(A).length === n0 && s.text === "Kept text 2" && s.notices.includes("This conversation doesn't exist or you can't see it.");
    notes.push(`email deleted from the CRM: sent ${L.sent130(A).length - n0}, text "${s.text}", notices ${JSON.stringify(s.notices)}`);
    R("Edge case 2", ok, notes.join("; "));
  });
  await run("Edge case 3", async () => {
    const am = L.mid("Arch conv"), ac = convOfMsg(am);
    const ari = L.recId("person", "Ari Archme");
    const ad = L.recId("deal", "Arch deal");
    q(`insert into email_links (conversation_id, deal_id, how) values (${ac}, ${ad}, 'manual') on conflict do nothing`);
    q(`update persons set archived_at=now() where id=${ari}; update deals set archived_at=now() where id=${ad}`);
    const pipe = q(`select pipeline_id from stages where id=1`);
    const r = [];
    for (const path of [`/people/${ari}`, `/deals/${ad}`]) {
      await go(p, path);
      const n = await p.getByRole("region", { name: "Timeline" }).locator("li.ent:has(.kd.email)").count();
      const btn = await p.getByRole("region", { name: "Timeline" }).getByRole("link", { name: /REPLY|FORWARD/ }).count();
      r.push(`${path}: ${n} EMAIL entries, ${btn} reply links`);
    }
    await go(p, `/emails/${ac}`);
    const cbtn = await p.locator("article.msg").getByRole("link", { name: "[ REPLY ]" }).count();
    R("Edge case 3", r.every((x) => / [1-9]\d* EMAIL entries, 0 reply/.test(x)) && cbtn === 1, r.join("; ") + `; conversation page [ REPLY ] ×${cbtn} (the archived deal's drawer: not opened, the board hides archived deals)`);
  });
  await run("Edge case 4", async () => {
    const fm = L.mid("Fio conv"), fc = convOfMsg(fm), fd = L.recId("deal", "Files deal");
    const nfiles = Number(q(`select count(*) from files where deal_id=${fd}`));
    if (nfiles === 0) {
      await go(p, `/deals/${fd}`);
      fs.writeFileSync("/tmp/fio-terms.txt", "fio terms");
      await p.locator('input[type="file"]').first().setInputFiles("/tmp/fio-terms.txt");
      await p.waitForTimeout(3000); await p.reload(); await p.waitForLoadState("networkidle");
    }
    const names = q(`select name from files where deal_id=${fd} order by id`).split("\n").filter(Boolean);
    const offered = async () => { const d = L.rpanel(p).locator("details"); if (!(await d.count())) return []; await d.first().locator("summary").click(); return (await d.first().locator("label, li").allInnerTexts()).map(norm); };
    await go(p, `/deals/${fd}`); await L.openReply(p, L.entryOf(p, "Fio conv"), "[ REPLY ]"); const o1 = await offered();
    await go(p, `/emails/${fc}?from=deal-${fd}`); await L.openReply(p, p.locator("article.msg").first(), "[ REPLY ]"); const o2 = await offered();
    await go(p, `/emails/${fc}`); await L.openReply(p, p.locator("article.msg").first(), "[ REPLY ]"); const o3 = await offered();
    const comp = await L.rpanel(p).locator('input[type="file"]').count();
    R("Edge case 4", names.length > 0 && names.every((n) => o1.join(" ").toLowerCase().includes(n.toLowerCase()) && o2.join(" ").toLowerCase().includes(n.toLowerCase())) && o3.length === 0 && comp === 1, `Files deal files ${JSON.stringify(names)}; offered from the deal ${JSON.stringify(o1)}, from the conversation page ?from=deal ${JSON.stringify(o2)}, from it with no record ${JSON.stringify(o3)} (computer input ${comp})`);
  });
  await run("Edge case 5", async () => {
    const um = L.mid("Unknown sender conv");
    q(`update email_messages set from_address=null, from_name=null where id=${um}`);
    await go(p, `/deals/${deal}`);
    const head = norm(await L.entryOf(p, "Unknown sender conv").locator(".emailhead").innerText());
    await L.openReply(p, L.entryOf(p, "Unknown sender conv"), "[ REPLY ]"); const s1 = await L.boxState(p);
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Unknown sender conv"), "[ REPLY ALL ]"); const s2 = await L.boxState(p);
    R("Edge case 5", /Unknown sender/.test(head) && s1.to.length === 0 && JSON.stringify(s2.toAddr) === '["ben@example.test"]', `(sender removed from the stored email by SQL; the fake page always writes a From) entry "${head}"; REPLY To ${JSON.stringify(s1.toAddr)}; REPLY ALL To ${JSON.stringify(s2.toAddr)} Cc ${JSON.stringify(s2.ccAddr)}`);
  });
  await run("Edge case 6", async () => {
    await put({ sent: true, from: `Ada Fake <${A}>`, to: A, subject: "Pricing", text: "note to self", thread: L.ctl130("box", A).find((m) => m.mid === "<pricing-1@example.test>").threadId });
    const self = Number(q(`select id from email_messages where text_body='note to self' limit 1`));
    await go(p, `/deals/${deal}?email=reply-${self}`); await L.rpanel(p).waitFor(); const s1 = await L.boxState(p);
    await go(p, `/deals/${deal}?email=reply-all-${self}`); await L.rpanel(p).waitFor(); const s2 = await L.boxState(p);
    S.__e7self = { to: s2.toAddr, cc: s2.ccAddr };
    R("Edge case 6", self > 0 && JSON.stringify(s1.toAddr) === `["${A}"]`, `Ada's email to herself only (id ${self}, in the Pricing thread): REPLY To ${JSON.stringify(s1.toAddr)}`);
  });
  await run("Edge case 7", async () => {
    await go(p, `/deals/${deal}?email=reply-all-${pricing}`); await L.rpanel(p).waitFor(); const s = await L.boxState(p);
    const e = S.__e7self || {};
    R("Edge case 7", JSON.stringify(s.toAddr) === '["ana@example.test"]' && s.ccAddr.length === 0 && (e.to || [1]).length === 0 && (e.cc || [1]).length === 0, `received Pricing (to Ada alone) REPLY ALL To ${JSON.stringify(s.toAddr)} Cc ${JSON.stringify(s.ccAddr)}; Ada's email to herself alone REPLY ALL To ${JSON.stringify(e.to)} Cc ${JSON.stringify(e.cc)}`);
  });
  await run("Edge case 8", async () => {
    const ids = q(`select id from email_messages where subject='NoMid conv' order by received_at`).split("\n").map(Number);
    const c = convOfMsg(ids[ids.length - 1]);
    q(`update email_messages set rfc_message_id=null where id=${ids[ids.length - 1]}`);
    await go(p, `/emails/${c}`);
    const n = await p.locator("article.msg").count();
    await L.openReply(p, p.locator("article.msg").nth(n - 1), "[ REPLY ]");
    await p.fill("#email-text", "no mid"); await L.sendReply(p);
    const s = L.sent130(A); const m = s[s.length - 1];
    const n2 = await p.locator("article.msg").count(); const last = norm(await p.locator("article.msg").nth(n2 - 1).innerText());
    R("Edge case 8", m.inReplyTo === "" && (m.references === "" || m.references === "<nomid-0@example.test>") && n2 === n + 1 && last.includes("no mid"), `ids in conversation ${ids.length} (one or two threads: conv ${ids.map(convOfMsg)}); newest set to no Message-ID by SQL; sent In-Reply-To "${m.inReplyTo}", References "${m.references}"; page ${n}→${n2} emails, newest "${last.slice(0, 60)}"`);
  });
  await run("Edge case 9", async () => {
    await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, "Html conv"), "[ REPLY ]");
    const s = await L.boxState(p); await p.fill("#email-text", "html reply"); await L.sendReply(p);
    const m = L.sent130(A).slice(-1)[0];
    await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, "Empty conv"), "[ REPLY ]");
    const s2 = await L.boxState(p);
    await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, "Empty conv"), "[ FORWARD ]");
    const s3 = await L.boxState(p);
    R("Edge case 9", !/<p>|<b>/.test(s.quote) && /> Hello there/.test(s.quote) && !/<p>|<b>/.test(m.text) && /> Hello there/.test(m.text) && s2.quote.split("\n").length === 1 && /wrote:$/.test(s2.quote) && /^To: .*$/m.test(s3.quote) && s3.quote.trim().split("\n").pop().startsWith("To:"), `HTML-only quote ${JSON.stringify(s.quote)}; sent text ${JSON.stringify(m.text)}; empty email reply quote ${JSON.stringify(s2.quote)}; forward block ${JSON.stringify(s3.quote)}`);
  });
  await run("Edge case 10", async () => {
    await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, "Long conv"), "[ REPLY ]");
    await p.fill("#email-text", "short"); await L.sendReply(p);
    const m = L.sent130(A).slice(-1)[0];
    const quoted = (m.text.match(/^> A{99}$/gm) || []).length;
    await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, "Long conv"), "[ REPLY ]");
    await p.locator("#email-text").evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(el, "x".repeat(100001)); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await L.sendReply(p, { expectClose: false });
    const s = await L.boxState(p);
    R("Edge case 10", m.subject === "Re: Long conv" && quoted === 1500 && s.notices.concat(s.atts).some((t) => t.includes("The text can be 100,000 characters at most.")), `earlier email 150,000 characters: sent text ${m.text.length} characters, ${quoted} quoted lines of 1500; typing 100,001 characters: ${JSON.stringify(s.notices)}`);
  });
  await run("Edge case 11", async () => {
    await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, "Names conv"), "[ REPLY ]");
    const s = await L.boxState(p); await L.addAddr(p, "Cc", "ed@example.test"); await p.fill("#email-text", "names"); await L.sendReply(p);
    const m = L.sent130(A).slice(-1)[0];
    R("Edge case 11", JSON.stringify(s.to) === '["Ana Fake"]' && /^Ana Fake <ana@example.test>$/.test(m.to.trim()) && m.cc.trim() === "ed@example.test" && /, Ana K <ana@example.test> wrote:/.test(s.quote) && /, Ana K <ana@example.test> wrote:/.test(m.text), `chip ${JSON.stringify(s.to)}; header To "${m.to}", Cc "${m.cc}"; quote line "${s.quote.split("\n")[0]}"`);
  });
  await run("Edge case 12", async () => {
    await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, "Chars conv"), "[ REPLY ]");
    const s = await L.boxState(p); await p.fill("#email-text", "chars"); await L.sendReply(p);
    const m = L.sent130(A).slice(-1)[0];
    const c = convOfMsg(L.mid("Chars conv")); await go(p, `/emails/${c}`);
    const t = (await p.locator("article.msg").allInnerTexts()).join("\n");
    const bold = await p.locator("article.msg .emailtext b").count();
    R("Edge case 12", s.quote.includes("> <b>prix</b> 🎉") && m.text.includes("> <b>prix</b> 🎉") && t.includes("<b>prix</b> 🎉") && bold === 0, `box quote ${JSON.stringify(s.quote)}; sent has the line ${m.text.includes("> <b>prix</b> 🎉")}; conversation page shows the characters ${t.includes("<b>prix</b> 🎉")} (no <b> element: ${bold === 0})`);
  });
  await run("Edge case 13", async () => {
    const e0 = await tlCount(p, `/deals/${deal}`, "Re: Group");
    await L.openReply(p, L.entryOf(p, "Group"), "[ REPLY ]");
    await p.fill("#email-text", "double");
    const n0 = L.sent130(A).length;
    await L.rpanel(p).getByRole("button", { name: "[ SEND ]" }).dblclick();
    await L.rpanel(p).waitFor({ state: "detached", timeout: 60000 }); await p.waitForLoadState("networkidle");
    const e1 = await tlCount(p, `/deals/${deal}`, "Re: Group");
    R("Edge case 13", L.sent130(A).length === n0 + 1 && e1 === e0 + 1, `double click: sent +${L.sent130(A).length - n0}; deal "Re: Group" entries ${e0}→${e1}`);
  });
  await run("Edge case 14", async () => {
    const e0 = (await L.emailEntries(p, `/deals/${deal}`)).length;
    await L.openReply(p, L.entryOf(p, "Group"), "[ REPLY ]"); await p.fill("#email-text", "slow");
    L.ctl("unreachable", "on");
    const n0 = L.sent130(A).length;
    await L.sendReply(p, { expectClose: false });
    const s = await L.boxState(p);
    L.ctl("unreachable", "off");
    const e1 = (await L.emailEntries(p, `/deals/${deal}`)).length;
    R("Edge case 14", L.sent130(A).length === n0 && s.text === "slow" && s.notices.includes("The email could not be sent. Try again in a minute.") && e1 === e0, `Gmail unreachable: sent ${L.sent130(A).length - n0}; text kept "${s.text}"; notices ${JSON.stringify(s.notices)}; entries ${e0}→${e1}`);
  });
  await run("Edge case 15", async () => {
    const nm = L.mid("Not recorded"), c = convOfMsg(nm);
    q(`create or replace function sf130_fail() returns trigger language plpgsql as $$ begin if new.subject='Re: Not recorded' then raise exception 'fake failure'; end if; return new; end $$; drop trigger if exists sf130_fail on email_messages; create trigger sf130_fail before insert on email_messages for each row execute function sf130_fail()`);
    await go(p, `/emails/${c}`);
    await L.openReply(p, p.locator("article.msg").first(), "[ REPLY ]"); await p.fill("#email-text", "nr reply"); await L.sendReply(p);
    const notice = /Email sent to /.test(norm(await p.locator("body").innerText()));
    const before = msgCount(c);
    q(`drop trigger sf130_fail on email_messages`);
    await L.runCheck(p, A);
    const after = msgCount(c), rows = Number(q(`select count(*) from email_messages where subject='Re: Not recorded'`));
    const inConv = rows > 0 && Number(q(`select count(*) from email_messages m join email_threads t on t.id=m.thread_id where m.subject='Re: Not recorded' and t.conversation_id=${c}`)) === rows;
    R("Edge case 15", notice && before === 1 && after === 2 && rows === 1 && inConv, `"Email sent to Ana Fake." ${notice}; conversation emails ${before} (storing failed) → ${after} after the 15-minute check; copies ${rows}, in the same conversation ${inConv}`);
  });
  await run("Edge case 17", async () => {
    const zd = L.recId("deal", "Zed drawer deal");
    const pipe = q(`select pipeline_id from stages where id=1`);
    await go(p, `/deals?pipeline=${pipe}&open=${zd}`);
    const drawer = p.locator("aside.deal-drawer");
    await L.openReply(p, drawer.getByRole("region", { name: "Timeline" }).locator("li.ent:has(.kd.email)").filter({ hasText: "Drawer conv" }).first(), "[ REPLY ]");
    const board = (await p.locator(".board, [aria-label*='oard']").count()) > 0, dv = await drawer.isVisible();
    await p.fill("#email-text", "drawer reply"); await L.sendReply(p);
    const url = new URL(p.url());
    const first = drawer.getByRole("region", { name: "Timeline" }).locator("li.ent").first();
    const subj = (await first.locator(".kd.email").count()) ? norm(await first.locator(".subj").innerText()) : null;
    R("Edge case 17", board && dv && url.searchParams.get("open") === String(zd) && (await drawer.isVisible()) && subj === "Re: Drawer conv", `box over board ${board} and drawer ${dv}; after send ${url.pathname + url.search}, drawer open ${await drawer.isVisible()}, newest drawer entry "${subj}"`);
  });
  fs.writeFileSync("/tmp/sf130-b.json", JSON.stringify(S, null, 1));
  await b.close();
})();
