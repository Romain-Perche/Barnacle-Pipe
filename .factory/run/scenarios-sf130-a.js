// SF-130 AI review, part A: data in Ada's fake mailbox, then US1, US2, US3. Fresh data first (test-env.md § SF-130).
const L = require("./sf130-lib.js");
const { q, norm, go, R, S, A } = L;
const fs = require("fs");
const ukDate = (iso) => {
  const d = new Date(iso); const f = (o) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).formatToParts(d);
  const g = (parts, t) => parts.find((x) => x.type === t).value;
  const a = f({ day: "numeric", month: "short", year: "numeric" }); const b = f({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${g(a, "day")} ${g(a, "month")} ${g(a, "year")} at ${g(b, "hour")}:${g(b, "minute")}`;
};
const recvAt = (id) => q(`select to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from email_messages where id=${id}`);
const convOfMsg = (id) => Number(q(`select t.conversation_id from email_messages m join email_threads t on t.id=m.thread_id where m.id=${id}`));
const convCount = () => Number(q(`select count(*) from email_conversations`));
const msgsIn = (c) => q(`select m.subject from email_messages m join email_threads t on t.id=m.thread_id where t.conversation_id=${c} order by m.received_at, m.id`).split("\n").filter(Boolean);
(async () => {
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const want = (n) => !only || only.includes(n);
  async function run(n, fn) { if (!want(n)) return; try { await fn(); } catch (e) { R(n, false, "error: " + String(e.message).split("\n")[0]); } }
  const b = await L.chromium.launch();
  const p = await L.pageAs(b, A);
  const deal = L.recId("deal", "Fake Deal Ltd renewal"), ana = L.recId("person", "Ana Fake");
  if (!process.env.SKIP_DATA) {
    q(`insert into organisations (name, owner_id, created_by) values ('Zed Org Ltd',1,1)`);
    q(`update persons set organisation_id=(select id from organisations where name='Zed Org Ltd') where first_name='Zed' and last_name='Drawer'`);
    q(`insert into persons (first_name,last_name,owner_id,created_by,private,consent) values ('Cat','Fake',1,1,false,'subscribed')`);
    q(`insert into person_emails (person_id,email,kind,position) select id,'cat@example.test','work',0 from persons where first_name='Cat' and last_name='Fake'`);
    const put = (o) => L.put(p, A, o);
    await put({ from: "Ana Fake <ana@example.test>", to: A, subject: "Pricing", text: "Hello Ada,\nHere is our pricing.\n\nBest, Ana", messageId: "<pricing-1@example.test>" });
    await put({ sent: true, from: `Ada Fake <${A}>`, to: "ana@example.test", cc: "ben@example.test", bcc: "dan@example.test", subject: "Sent by Ada", text: "From me." });
    await put({ from: "ana@example.test", to: "RE: Pricing".length && A, subject: "RE: Pricing", text: "x" });
    await put({ from: "ana@example.test", to: A, subject: "Re: Re: Pricing", text: "x" });
    await put({ from: "ana@example.test", to: A, subject: "", text: "no subject here" });
    await put({ from: "Ana Fake <ana@example.test>", to: `${A}, ben@example.test`, cc: "cat@example.test", subject: "Group", text: "Hi all" });
    await put({ from: "ana@example.test", to: `Ada@Barnacle.ai, ben@example.test, cat@example.test`, cc: "ben@example.test, cat@example.test, Ana@example.test", subject: "Dupes", text: "dupes" });
    await put({ from: "Ana Fake <ana@example.test>", to: A, subject: "Colleague conv", text: "For the team.", messageId: "<colleague-1@example.test>" });
    await put({ from: "Ana Fake <ana@example.test>", to: A, subject: "Links conv", text: "Links." });
  }
  const pricing = L.mid("Pricing"), pconv = convOfMsg(pricing);

  await run("US1 scenario 1", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Pricing"), "[ REPLY ]");
    const s = await L.boxState(p);
    const box = await L.rpanel(p).boundingBox();
    const dim = (await p.locator(".overlay.sideoverlay").count()) > 0;
    const quote0 = `On ${ukDate(recvAt(pricing))}, Ana Fake <ana@example.test> wrote:\n> Hello Ada,\n> Here is our pricing.\n>\n> Best, Ana`;
    const ok = s.heading === "// REPLY · Pricing" && s.from.includes(A) && JSON.stringify(s.to) === '["Ana Fake"]' && JSON.stringify(s.toAddr) === '["ana@example.test"]' && s.cc.length === 0 && s.bcc.length === 0 && s.subject === "Re: Pricing" && s.text === "" && s.quote === quote0 && box.x > 600 && dim;
    R("US1 scenario 1", ok, `heading "${s.heading}", ${s.from}, To ${JSON.stringify(s.to)} (${JSON.stringify(s.toAddr)}), Cc ${s.cc.length}, Bcc ${s.bcc.length}, Subject "${s.subject}", text "${s.text}", panel x=${box.x} over dim overlay ${dim}; quote ${JSON.stringify(s.quote)}`);
  });
  let reply1;
  await run("US1 scenario 2", async () => {
    const n0 = L.sent130(A).length;
    await p.fill("#email-text", "Thanks Ana,\n\nAgreed.");
    await L.sendReply(p);
    const sent = L.sent130(A); reply1 = sent[sent.length - 1];
    const expText = `Thanks Ana,\n\nAgreed.\n\nOn ${ukDate(recvAt(pricing))}, Ana Fake <ana@example.test> wrote:\n> Hello Ada,\n> Here is our pricing.\n>\n> Best, Ana`;
    const body = norm(await p.locator("body").innerText());
    const notices = body.split("Email sent to ana@example.test.").length - 1; const nt = (body.match(/Email sent to [^.]*\.[a-z]*\.?/g) || []).join(" | ");
    const first = p.getByRole("region", { name: "Timeline" }).locator("li.ent").first();
    const subj = (await first.locator(".kd.email").count()) ? norm(await first.locator(".subj").innerText()) : null;
    const ok = sent.length === n0 + 1 && reply1.to.includes("ana@example.test") && !reply1.to.includes(",") && reply1.subject === "Re: Pricing" && reply1.text.replace(/\r\n/g, "\n").trim() === expText && reply1.from.includes(A) && notices === 1 && subj === "Re: Pricing" && (await L.rpanel(p).count()) === 0;
    R("US1 scenario 2", ok, `sent +${sent.length - n0}: From ${reply1.from}, To ${reply1.to}, Subject ${reply1.subject}, text ${JSON.stringify(reply1.text)}; notice "Email sent to ana@example.test." ×${notices} (notices on page: ${nt}); newest timeline entry EMAIL "${subj}"`);
  });
  let reply2;
  await run("US1 scenario 3", async () => {
    await go(p, `/emails/${pconv}`);
    const url0 = p.url(); const linked0 = norm(await p.getByText("// LINKED TO", { exact: true }).locator("xpath=..").innerText());
    const arts = p.locator("article.msg");
    const n = await arts.count();
    await L.openReply(p, arts.nth(n - 1), "[ REPLY ]");
    await p.fill("#email-text", "Second answer.");
    await L.sendReply(p);
    const sent = L.sent130(A); reply2 = sent[sent.length - 1];
    const arts2 = p.locator("article.msg"); const n2 = await arts2.count();
    const lastText = norm(await arts2.nth(n2 - 1).innerText());
    const linked1 = norm(await p.getByText("// LINKED TO", { exact: true }).locator("xpath=..").innerText());
    const ok = p.url().split("?")[0] === url0.split("?")[0] && n2 === n + 1 && lastText.includes("Second answer.") && linked0 === linked1 && (await L.rpanel(p).count()) === 0 && convOfMsg(Number(q(`select max(id) from email_messages`))) === pconv;
    R("US1 scenario 3", ok, `conversation page ${url0} → ${p.url()}; emails ${n} → ${n2}, newest "${lastText.slice(0, 80)}"; LINKED TO unchanged ${linked0 === linked1} ("${linked1.slice(0, 120)}")`);
  });
  await run("US1 scenario 7", async () => {
    await go(p, "/dev/fake-gmail?user=" + encodeURIComponent(A));
    const t = norm(await p.locator("body").innerText());
    const ids = L.ctl130("box", A); const r1 = ids.find((m) => m.id === reply1.id);
    const ok = reply2.inReplyTo === r1.mid && reply2.references.split(/\s+/).join(" ") === `<pricing-1@example.test> ${r1.mid}` && t.includes(`In-Reply-To ${r1.mid}`) && t.includes(`References <pricing-1@example.test> ${r1.mid}`) && reply1.inReplyTo === "<pricing-1@example.test>" && t.includes("In-Reply-To <pricing-1@example.test>");
    R("US1 scenario 7", ok, `reply to Pricing: In-Reply-To ${reply1.inReplyTo}, References ${reply1.references}; reply to the reply: In-Reply-To ${reply2.inReplyTo}, References ${reply2.references}; the fake mailbox page shows both lines`);
  });
  await run("US2 scenario 2", async () => {
    const box = L.ctl130("box", A); const orig = box.find((m) => m.mid === "<pricing-1@example.test>");
    const r1 = box.find((m) => m.id === reply1.id), r2 = box.find((m) => m.id === reply2.id);
    await go(p, "/dev/fake-gmail?user=" + encodeURIComponent(A));
    const t = norm(await p.locator("body").innerText());
    R("US2 scenario 2", r1.threadId === orig.threadId && r2.threadId === orig.threadId && t.includes(`thread ${orig.threadId}`), `Pricing in thread ${orig.threadId}; reply 1 in ${r1.threadId}, reply 2 in ${r2.threadId} (fake mailbox page lists "thread …" per message)`);
  });
  await run("US2 scenario 6", async () => {
    await go(p, `/people/${ana}`);
    const t = norm(await p.locator("body").innerText());
    const lc = q(`select to_char(last_contacted_at at time zone 'UTC','YYYY-MM-DD HH24:MI') from persons where id=${ana}`);
    const sentAt = q(`select to_char(max(received_at) at time zone 'UTC','YYYY-MM-DD HH24:MI') from email_messages where direction='sent' and subject='Re: Pricing'`);
    const m = /Last contacted\s*(.{0,40})/i.exec(t);
    R("US2 scenario 6", lc === sentAt && !!m && /\d/.test(m[1]), `Ana Fake's Last contacted ${lc} UTC = the latest reply's send time ${sentAt} (was 2026-11-20 10:00); page shows "${m ? m[0] : t.match(/Last contacted.{0,30}/)?.[0]}"`);
  });
  await run("US1 scenario 8", async () => {
    await go(p, `/deals/${deal}`);
    const li = L.entryOf(p, "Pricing");
    const lis = p.getByRole("region", { name: "Timeline" }).locator("li.ent:has(.kd.email)");
    const notes = []; let ok = true;
    for (let i = 0; i < (await lis.count()); i++) {
      const e = lis.nth(i); const eh = e.locator(".eh");
      const btns = (await eh.locator(".acts.mini a.btn").allInnerTexts()).map(norm);
      const hb = await eh.locator(".emailhead").boundingBox(), ab = await eh.locator(".acts.mini").boundingBox();
      const good = JSON.stringify(btns) === '["[ REPLY ]","[ REPLY ALL ]","[ FORWARD ]"]' && ab.x > hb.x && Math.abs(ab.y - hb.y) < 20;
      ok = ok && good; if (i < 3) notes.push(`entry ${i}: ${JSON.stringify(btns)} right of line ${good}`);
    }
    await go(p, `/emails/${pconv}`);
    const arts = p.locator("article.msg"); const n = await arts.count();
    for (let i = 0; i < n; i++) {
      const eh = arts.nth(i).locator(".eh");
      const btns = (await eh.locator(".acts.mini a.btn").allInnerTexts()).map(norm);
      const to = norm(await eh.locator(".hd").innerText());
      const hb = await eh.locator(".hd").boundingBox(), ab = await eh.locator(".acts.mini").boundingBox();
      const good = JSON.stringify(btns) === '["[ REPLY ]","[ REPLY ALL ]","[ FORWARD ]"]' && to.startsWith("To ") && ab.x > hb.x + 50;
      ok = ok && good; notes.push(`conversation email ${i} "${to.slice(0, 40)}": ${good}`);
    }
    const border = await p.locator("article.msg .acts.mini a.btn").first().evaluate((e) => getComputedStyle(e).borderTopStyle + " " + getComputedStyle(e).fontSize);
    R("US1 scenario 8", ok && n >= 2, notes.join("; ") + `; button style ${border}`);
  });
  await run("US1 scenario 4", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Sent by Ada"), "[ REPLY ]");
    const s = await L.boxState(p);
    R("US1 scenario 4", JSON.stringify(s.toAddr) === '["ana@example.test"]' && s.cc.length === 0, `To ${JSON.stringify(s.toAddr)}, Cc ${JSON.stringify(s.cc)}`);
  });
  await run("US3 scenario 2", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Sent by Ada"), "[ REPLY ALL ]");
    const s = await L.boxState(p);
    const all = [...s.toAddr, ...s.ccAddr, ...s.bcc].join(",");
    R("US3 scenario 2", JSON.stringify(s.toAddr) === '["ana@example.test"]' && JSON.stringify(s.ccAddr) === '["ben@example.test"]' && !all.includes("dan@"), `To ${JSON.stringify(s.toAddr)}, Cc ${JSON.stringify(s.ccAddr)}, Bcc ${JSON.stringify(s.bcc)}`);
  });
  await run("US1 scenario 5", async () => {
    const res = [];
    for (const [subj, exp] of [["RE: Pricing", "RE: Pricing"], ["Re: Re: Pricing", "Re: Re: Pricing"]]) {
      await go(p, `/deals/${deal}`); await L.openReply(p, L.entryOf(p, subj), "[ REPLY ]");
      res.push([subj, await p.inputValue("#email-subject"), exp]);
    }
    const ns = Number(q(`select id from email_messages where subject='' order by id limit 1`));
    await go(p, `/deals/${deal}?email=reply-${ns}`); await L.rpanel(p).waitFor();
    res.push(["(empty)", await p.inputValue("#email-subject"), "Re: (no subject)"]);
    R("US1 scenario 5", res.every((r) => r[1] === r[2]), res.map((r) => `"${r[0]}" → "${r[1]}"`).join("; "));
  });
  await run("US1 scenario 6", async () => {
    const notes = []; let ok = true;
    for (const btn of ["[ CANCEL ]", "[ CLOSE ]"]) {
      const n0 = L.sent130(A).length; const e0 = (await L.emailEntries(p, `/deals/${deal}`)).length;
      await L.openReply(p, L.entryOf(p, "Pricing"), "[ REPLY ]");
      await p.fill("#email-text", "Never sent"); await L.addAddr(p, "Cc", "ben@example.test");
      await L.rpanel(p).getByRole("link", { name: btn }).or(L.rpanel(p).getByRole("button", { name: btn })).first().click();
      await L.rpanel(p).waitFor({ state: "detached" }); await p.waitForLoadState("networkidle");
      const n1 = L.sent130(A).length; const e1 = (await L.emailEntries(p, `/deals/${deal}`)).length;
      ok = ok && n1 === n0 && e1 === e0; notes.push(`${btn}: Sent ${n0}→${n1}, deal EMAIL entries ${e0}→${e1}`);
    }
    R("US1 scenario 6", ok, notes.join("; "));
  });
  await run("US3 scenario 1", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Group"), "[ REPLY ALL ]");
    const s = await L.boxState(p);
    const all = [...s.toAddr, ...s.ccAddr].join(",").toLowerCase();
    R("US3 scenario 1", JSON.stringify(s.toAddr) === '["ana@example.test","ben@example.test"]' && JSON.stringify(s.ccAddr) === '["cat@example.test"]' && s.bcc.length === 0 && !all.includes("barnacle") && s.heading === "// REPLY ALL · Group", `heading "${s.heading}", To ${JSON.stringify(s.toAddr)} (shown ${JSON.stringify(s.to)}), Cc ${JSON.stringify(s.ccAddr)}, Bcc ${s.bcc.length}`);
  });
  await run("US3 scenario 4", async () => {
    const i = (await L.chipTitles(p, "To")).indexOf("ben@example.test");
    await p.locator(`.sidepanel .chips:has(input[aria-label="To addresses"]) .chip-x`).nth(i).click();
    await p.fill("#email-text", "To the rest.");
    const n0 = L.sent130(A).length;
    await L.sendReply(p);
    const s = L.sent130(A); const m = s[s.length - 1];
    R("US3 scenario 4", s.length === n0 + 1 && !/ben@/.test(m.to + m.cc + m.bcc) && /ana@example.test/.test(m.to) && /cat@example.test/.test(m.cc) && m.to.split(",").length === 1 && m.cc.split(",").length === 1 && !m.bcc, `sent To "${m.to}", Cc "${m.cc}", Bcc "${m.bcc}"`);
  });
  await run("US3 scenario 3", async () => {
    await go(p, `/deals/${deal}`);
    await L.openReply(p, L.entryOf(p, "Dupes"), "[ REPLY ALL ]");
    const s = await L.boxState(p);
    const all = [...s.toAddr, ...s.ccAddr].map((x) => x.toLowerCase());
    R("US3 scenario 3", JSON.stringify(s.toAddr) === '["ana@example.test","ben@example.test","cat@example.test"]' && s.ccAddr.length === 0 && new Set(all).size === all.length && !all.some((x) => x.includes("barnacle")), `From ana, To "Ada@Barnacle.ai, ben, cat", Cc "ben, cat, Ana@example.test" → To ${JSON.stringify(s.toAddr)}, Cc ${JSON.stringify(s.ccAddr)}`);
  });
  fs.writeFileSync("/tmp/sf130-a.json", JSON.stringify(S, null, 1));
  await b.close();
})();
