// SF-129 AI review, part B: US2 8, US3, US4, edges 1-3, 7, 9, 11, 13-15. After part A on the same data; the Gmail-off app
// on :3003 (PORT=3003 SKIP_BUILD=1 SKIP_SEED=1 GMAIL_TOKEN_KEY= bash .factory/run/start-app.sh). Edge 14 deactivates Ada
// Fake (last). ONLY="Edge case 7,…" runs some.
const L = require("./sf129-lib.js");
const { q, norm, go, R, S, sleep } = L;
const fs = require("fs"), crypto = require("crypto"), cp = require("child_process");
const PSQL = (s) => cp.execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", "crm_dev", "-v", "ON_ERROR_STOP=1", "-qAtc", s], { encoding: "utf8" }).trim();
const tl = (p) => p.getByRole("region", { name: "Timeline" });
const sentCount = (u = L.A) => L.sent(u).length;
const lastSent = (u = L.A) => L.sent(u).slice(-1)[0];
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
const D = "/tmp/sf129-files"; fs.mkdirSync(D, { recursive: true });
function mk(name, size, head = "") { const f = `${D}/${name}`; const b = Buffer.alloc(size); crypto.randomFillSync(b); Buffer.from(head, "binary").copy(b); fs.writeFileSync(f, b); return f; }
const PNG = "\x89PNG\r\n\x1a\n";
async function addRecordFile(p, path, file) {
  await go(p, path);
  await p.locator('section[aria-label="Files"] input[aria-label="Files to add"]').setInputFiles(file);
  const n = require("path").basename(file);
  await p.locator('section[aria-label="Files"] table').getByText(n, { exact: true }).first().waitFor({ timeout: 60000 });
  await p.waitForLoadState("networkidle");
}
async function attachComputer(p, file, { expectListed = true } = {}) {
  await p.setInputFiles('.sidepanel input[type="file"]', file);
  const n = require("path").basename(file);
  if (expectListed) await L.panel(p).locator(".attachlist li", { hasText: n }).waitFor({ timeout: 60000 });
  else await p.waitForTimeout(1500);
  await p.waitForFunction(() => !document.querySelector(".sidepanel .uploading"), null, { timeout: 60000 });
}
async function attachRecord(p, name) {
  await L.panel(p).locator("summary", { hasText: "FILE ▾" }).click();
  await L.panel(p).locator(".attachpick button", { hasText: name }).click();
}
const offered = async (p) => { const d = L.panel(p).locator("details.attachpick"); if (!(await d.count())) return []; if (!(await d.evaluate((e) => e.open))) await d.locator("summary").click(); return (await L.panel(p).locator(".attachpick li").allInnerTexts()).map(norm); };
const attachList = async (p) => (await L.panel(p).locator(".attachlist li").allInnerTexts()).map((t) => norm(t.replace(/×/, "")));
const filesOf = async (p, path) => { await go(p, path); return (await p.locator('section[aria-label="Files"] tbody tr').allInnerTexts()).map(norm).sort(); };
const hasWrite = async (p, scope) => (await (scope || p).getByRole("link", { name: "[ WRITE EMAIL ]" }).count()) > 0;

(async () => {
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const want = (n) => !only || only.includes(n);
  const run = async (name, fn) => { if (!want(name)) return; try { await fn(); } catch (e) { R(name, false, "error: " + e.message.split("\n")[0]); } };
  const b = await L.chromium.launch();
  const p = await L.pageAs(b, L.A);
  const pipe = q(`select pipeline_id from stages where id=1`);
  const npd = L.recId("deal", "NoPerson deal");
  const fd = L.recId("deal", "Files deal"), fio = L.recId("person", "Fio Files"), forg = L.recId("org", "Fake Org Ltd"), deal = L.recId("deal", "Fake Deal Ltd renewal"), ana = L.recId("person", "Ana Fake");
  const proposal = mk("proposal.pdf", 2 * 1024 * 1024, "%PDF-1.4\n"), logo = mk("logo.png", 300 * 1024, PNG), notes = mk("notes.docx", 1024 * 1024, "PK\x03\x04");

  await run("US3 scenario 1", async () => {
    if (!(await filesOf(p, `/deals/${fd}`)).some((t) => t.includes("proposal.pdf"))) {
      await addRecordFile(p, `/deals/${fd}`, proposal); await addRecordFile(p, `/deals/${fd}`, logo);
      await addRecordFile(p, `/people/${fio}`, mk("fio-own.txt", 1000)); await addRecordFile(p, `/organisations/${forg}`, mk("org-own.txt", 1200));
      await addRecordFile(p, `/deals/${deal}`, mk("renewal-deal.txt", 1500));
    }
    await L.openBox(p, `/deals/${fd}`);
    const off = await offered(p), att = await attachList(p);
    R("US3 scenario 1", off.length === 2 && off.some((t) => /proposal\.pdf · 2(\.0)? MB/i.test(t)) && off.some((t) => /logo\.png · 300 KB/i.test(t)) && att.length === 0, `offered ${JSON.stringify(off)}; attached at open ${JSON.stringify(att)}`);
  });
  await run("US3 scenario 2", async () => {
    await L.openBox(p, `/deals/${fd}`);
    await attachRecord(p, "proposal.pdf");
    await attachComputer(p, notes);
    const att = await attachList(p);
    const removes = await L.panel(p).locator(".attachlist .chip-x").count();
    await L.fill(p, { subject: "With files", text: "see attached" });
    const n0 = sentCount(); await L.send(p);
    const m = lastSent();
    const a = Object.fromEntries(m.attachments.map((x) => [x.name, x]));
    const es = (await L.emailEntries(p, `/deals/${fd}`)).filter((e) => e.subj === "With files");
    const ok = sentCount() === n0 + 1 && a["proposal.pdf"]?.sha === sha(proposal) && a["notes.docx"]?.sha === sha(notes) && att.length === 2 && removes === 2 && es.length === 1 && /proposal\.pdf · 2(\.0)? MB/.test(es[0].text) && /notes\.docx · 1(\.0)? MB/.test(es[0].text);
    R("US3 scenario 2", ok, `box listed ${JSON.stringify(att)} with ${removes} remove buttons; sent attachments ${JSON.stringify(m.attachments.map((x) => `${x.name} ${x.type} ${x.size} ${x.sha === sha(x.name === "proposal.pdf" ? proposal : notes) ? "bytes equal" : "BYTES DIFFER"}`))}; entry "${es[0] && es[0].text}"`);
  });
  await run("US3 scenario 6", async () => {
    const before = await filesOf(p, `/deals/${fd}`);
    await L.openBox(p, `/deals/${fd}`);
    await attachComputer(p, mk("computer-only.txt", 5000));
    await L.fill(p, { subject: "Computer file only", text: "x" }); await L.send(p);
    const after = await filesOf(p, `/deals/${fd}`);
    R("US3 scenario 6", JSON.stringify(before) === JSON.stringify(after) && lastSent().attachments.some((x) => x.name === "computer-only.txt"), `// FILES before ${JSON.stringify(before)} after ${JSON.stringify(after)}; sent with computer-only.txt`);
  });
  await run("US3 scenario 3", async () => {
    const big1 = mk("big1.bin", 12 * 1024 * 1024), big2 = mk("big2.bin", 12 * 1024 * 1024), two = mk("two.bin", 2 * 1024 * 1024);
    await L.openBox(p, `/deals/${fd}`);
    await L.fill(p, { subject: "Big total", text: "x" });
    await attachComputer(p, big1); await attachComputer(p, big2);
    const tot0 = norm(await L.panel(p).locator(".tot").innerText());
    await attachComputer(p, two, { expectListed: false });
    const e1 = await L.errs(p), list1 = await attachList(p);
    const n0 = sentCount();
    await L.send(p, { expectClose: false }).catch(() => {});
    const closed = (await L.panel(p).count()) === 0;
    const e2 = closed ? ["(box closed: sent)"] : await L.errs(p);
    const n1 = sentCount();
    R("US3 scenario 3", e1.includes("Attachments can be 25 MB in total at most.") && !closed && e2.includes("Attachments can be 25 MB in total at most.") && n1 === n0, `24 MB attached ("${tot0}"); adding a 2 MB computer file: ${JSON.stringify(e1)}, list now ${JSON.stringify(list1)} (the 2 MB file is refused at pick time, so it is never in the list); pressing [ SEND ]: ${JSON.stringify(e2)}, Sent +${n1 - n0}`);
    // variant: the 2 MB file is a record file (proposal.pdf)
    if (!closed) await go(p, `/deals/${fd}`);
    await L.openBox(p, `/deals/${fd}`);
    await L.fill(p, { subject: "Big total 2", text: "x" });
    await attachComputer(p, big1); await attachComputer(p, big2);
    await attachRecord(p, "proposal.pdf");
    const e3 = await L.errs(p), tot = norm(await L.panel(p).locator(".tot").innerText());
    const m0 = sentCount();
    await L.send(p, { expectClose: false });
    const e4 = await L.errs(p); const m1 = sentCount();
    await L.panel(p).getByRole("button", { name: "Remove proposal.pdf" }).click();
    await L.send(p);
    const m2 = sentCount();
    S["US3 scenario 3"].notes += ` | record-file variant (24 MB + proposal.pdf 2 MB): on adding, box shows ${JSON.stringify(e3)} ("${tot}"); [ SEND ]: ${JSON.stringify(e4)}, Sent +${m1 - m0}; after removing proposal.pdf [ SEND ] sent +${m2 - m1}`;
    console.log("  variant: " + S["US3 scenario 3"].notes.split(" | ")[1]);
  });
  await run("US3 scenario 4", async () => {
    await L.openBox(p, `/people/${fio}`); const po = await offered(p);
    await L.openBox(p, `/organisations/${forg}`); const oo = await offered(p);
    R("US3 scenario 4", po.length === 1 && /fio-own\.txt/i.test(po[0]) && oo.length === 1 && /org-own\.txt/i.test(oo[0]), `Fio Files' page (main person of Files deal) offers ${JSON.stringify(po)}; Fake Org Ltd (its deal has renewal-deal.txt) offers ${JSON.stringify(oo)}`);
  });
  await run("US3 scenario 5", async () => {
    await L.openBox(p, `/deals/${fd}`);
    await attachRecord(p, "logo.png");
    await L.fill(p, { to: ["cat@example.test"], subject: "Logo gone", text: "keep me" });
    const g = await L.pageAs(b, L.G);
    const fid = q(`select id from files where name='logo.png' and deal_id=${fd}`);
    await go(g, `/deals/${fd}?delete-file=${fid}`);
    await Promise.all([g.waitForLoadState("networkidle"), g.locator(".overlay").getByRole("button", { name: "[ DELETE ]" }).click()]);
    await sleep(500);
    const gone = q(`select count(*) from files where id=${fid}`);
    const n0 = sentCount();
    await L.send(p, { expectClose: false });
    const e = await L.errs(p);
    const kept = (await p.inputValue("#email-subject")) === "Logo gone" && (await p.inputValue("#email-text")) === "keep me" && (await L.chips(p, "To")).includes("cat@example.test");
    R("US3 scenario 5", gone === "0" && e.includes("One of the attached files is no longer on the record. Remove it and send again.") && sentCount() === n0 && kept, `Grace deleted logo.png (rows left ${gone}); [ SEND ]: ${JSON.stringify(e)}; Sent +${sentCount() - n0}; subject, text and To kept ${kept}`);
    await g.context().close();
  });
  await run("Edge case 13", async () => {
    const f30 = mk("thirty.bin", 30 * 1024 * 1024);
    await L.openBox(p, `/deals/${fd}`);
    await attachComputer(p, f30, { expectListed: false });
    const e = await L.errs(p), l = await attachList(p);
    R("Edge case 13", e.includes("Attachments can be 25 MB in total at most.") && !l.some((t) => t.includes("thirty.bin")), `chose a 30 MB file: ${JSON.stringify(e)}; list ${JSON.stringify(l)}`);
  });
  await run("Edge case 1", async () => {
    const cases = [["deal with no main person", `/deals/${L.recId("deal", "NoPerson deal")}`], ["deal whose main person has no address", `/deals/${L.recId("deal", "NoEmail deal")}`], ["person with no address", `/people/${L.recId("person", "Nemo Noemail")}`], ["deal whose main person is private (Grace's)", `/deals/${L.recId("deal", "HiddenPerson deal")}`]];
    const notes = []; let ok = true;
    for (const [n, path] of cases) {
      await L.openBox(p, path);
      const to = await L.chips(p, "To");
      const n0 = sentCount();
      await L.fill(p, { to: ["ana@example.test"], subject: `Edge1 ${n}`, text: "x" }); await L.send(p);
      const good = to.length === 0 && sentCount() === n0 + 1; ok = ok && good;
      notes.push(`${n}: To ${JSON.stringify(to)}, sent +${sentCount() - n0}`);
    }
    R("Edge case 1", ok, notes.join("; "));
  });
  await run("Edge case 2", async () => {
    const ad = L.recId("deal", "Arch deal"), ari = L.recId("person", "Ari Archme"), ao = L.recId("org", "Arch Org Ltd");
    await L.openBox(p, `/deals/${ad}`);
    await L.fill(p, { to: ["ana@example.test"], subject: "Archived meanwhile", text: "x" });
    PSQL(`update deals set archived_at=now() where id=${ad}; update persons set archived_at=now() where id=${ari}; update organisations set archived_at=now() where id=${ao}`);
    const n0 = sentCount();
    await L.send(p, { expectClose: false });
    const e = await L.errs(p); const n1 = sentCount();
    const w = [];
    for (const [n, path] of [["deal", `/deals/${ad}`], ["person", `/people/${ari}`], ["organisation", `/organisations/${ao}`]]) { await go(p, path); w.push(`${n} page ${await hasWrite(p)}`); }
    await go(p, `/deals?pipeline=${pipe}&open=${ad}`);
    const dr = p.locator("aside.deal-drawer"); w.push(`drawer (shown ${await dr.isVisible()}) ${await hasWrite(p, dr)}`);
    R("Edge case 2", e.includes("This record is archived: restore it to send email from it.") && n1 === n0 && w.every((x) => x.endsWith("false")), `archived (by SQL, as a teammate would) while the box was open → [ SEND ]: ${JSON.stringify(e)}, Sent +${n1 - n0}; [ WRITE EMAIL ] on archived ${w.join(", ")}`);
  });
  await run("Edge case 3", async () => {
    const hd = L.recId("deal", "Hide deal"), dd = L.recId("deal", "Delete deal");
    const notes = []; let ok = true;
    await L.openBox(p, `/deals/${hd}`);
    await L.fill(p, { to: ["ana@example.test"], subject: "Hidden meanwhile", text: "x" });
    PSQL(`update deals set private=true where id=${hd}`); // Linus's deal made private by Linus
    let n0 = sentCount(); await L.send(p, { expectClose: false }); let e = await L.errs(p);
    ok = ok && e.includes("This record doesn't exist or you can't see it.") && sentCount() === n0; notes.push(`made private: ${JSON.stringify(e)}, Sent +${sentCount() - n0}`);
    await L.openBox(p, `/deals/${dd}`);
    await L.fill(p, { to: ["ana@example.test"], subject: "Deleted meanwhile", text: "x" });
    const g = await L.pageAs(b, L.G);
    await go(g, `/deals/${dd}?confirm=delete`);
    const del = g.locator("button.danger-solid").first();
    await Promise.all([g.waitForLoadState("networkidle"), del.click()]); await sleep(500);
    const left = q(`select count(*) from deals where id=${dd}`);
    n0 = sentCount(); await L.send(p, { expectClose: false }); e = await L.errs(p);
    ok = ok && left === "0" && e.includes("This record doesn't exist or you can't see it.") && sentCount() === n0; notes.push(`deleted by Grace (rows left ${left}): ${JSON.stringify(e)}, Sent +${sentCount() - n0}`);
    await g.context().close();
    R("Edge case 3", ok, notes.join("; "));
  });
  await run("Edge case 9", async () => {
    const before = (await L.emailEntries(p, `/deals/${fd}`)).length;
    await L.openBox(p, `/deals/${fd}`);
    await attachRecord(p, "proposal.pdf");
    await L.fill(p, { cc: ["cat@example.test"], bcc: ["dan@example.test"], subject: "Gmail down", text: "line1\nline2" });
    L.ctl("unreachable", "on");
    const n0 = sentCount();
    await L.send(p, { expectClose: false });
    const e = await L.errs(p);
    const kept = JSON.stringify([await L.chips(p, "To"), await L.chips(p, "Cc"), await L.chips(p, "Bcc"), await p.inputValue("#email-subject"), await p.inputValue("#email-text"), await attachList(p)]);
    L.ctl("unreachable", "off");
    const after = (await L.emailEntries(p, `/deals/${fd}`)).length;
    R("Edge case 9", e.includes("The email could not be sent. Try again in a minute.") && sentCount() === n0 && after === before && kept.includes("Gmail down") && kept.includes("proposal.pdf") && kept.includes("dan@example.test"), `Google unreachable: ${JSON.stringify(e)}; kept ${kept}; Sent +${sentCount() - n0}; deal EMAIL entries ${before}→${after}`);
  });
  await run("Edge case 7", async () => {
    // Hold the send path between Gmail's answer and its own storing (the ledger update sleeps 8 s), and run the
    // 15-minute check (the Gmail sync) meanwhile.
    PSQL(`create or replace function sf129_hold() returns trigger language plpgsql as $$ begin if new.gmail_message_id is not null and old.gmail_message_id is null then perform pg_sleep(8); end if; return new; end $$;
          drop trigger if exists sf129_hold on email_sends; create trigger sf129_hold before update on email_sends for each row execute function sf129_hold();`);
    try {
      await L.openBox(p, `/deals/${npd}`);
      await L.fill(p, { to: ["ana@example.test"], subject: "Sync first", text: "x" });
      const sendP = L.send(p);
      await sleep(3000);
      const r = await fetch(L.BASE + "/cron/gmail", { headers: { authorization: "Bearer fake-cron-secret-0123456789" } });
      const storedEarly = q(`select count(*) from email_messages where subject='Sync first'`);
      await sendP;
      const c = L.conv("Sync first");
      const lk = L.links(c);
      const d = L.countSubj(await L.emailEntries(p, `/deals/${npd}`), "Sync first"), a = L.countSubj(await L.emailEntries(p, `/people/${ana}`), "Sync first");
      const st = q(`select state from email_sends where gmail_message_id is not null order by id desc limit 1`);
      R("Edge case 7", r.status < 300 && lk.includes("d:NoPerson deal/manual") && d === 1 && a === 1, `cron ${r.status} during the held send; message rows right after the check ${storedEarly}; links ${JSON.stringify(lk)}; ledger ${st}; deal ${d}×, Ana ${a}×`);
    } finally { PSQL(`drop trigger if exists sf129_hold on email_sends`); }
  });
  await run("Edge case 11", async () => {
    PSQL(`create or replace function sf129_fail() returns trigger language plpgsql as $$ begin if new.subject = 'Not recorded' then raise exception 'sf129 forced failure'; end if; return new; end $$;
          drop trigger if exists sf129_fail on email_messages; create trigger sf129_fail before insert on email_messages for each row execute function sf129_fail();`);
    let body;
    try {
      await L.openBox(p, `/deals/${npd}`);
      await L.fill(p, { to: ["ana@example.test"], subject: "Not recorded", text: "x" });
      const n0 = sentCount(); await L.send(p);
      body = norm(await p.locator("body").innerText());
      var sentN = sentCount() - n0;
      await sleep(2000);
    } finally { PSQL(`drop trigger if exists sf129_fail on email_messages`); }
    const stored0 = q(`select count(*) from email_messages where subject='Not recorded'`);
    await L.runCheck(p, L.A);
    const stored1 = q(`select count(*) from email_messages where subject='Not recorded'`);
    const d = L.countSubj(await L.emailEntries(p, `/deals/${npd}`), "Not recorded"), a = L.countSubj(await L.emailEntries(p, `/people/${ana}`), "Not recorded");
    const lk11 = L.links(L.conv("Not recorded"));
    R("Edge case 11", lk11.includes("d:NoPerson deal/manual") && sentN === 1 && body.includes("Email sent to ana@example.test.") && d === 1 && a === 1, `storing forced to fail by a DB trigger: Sent +${sentN}, page says "Email sent to ana@example.test." ${body.includes("Email sent to ana@example.test.")}; stored before/after the next 15-minute check ${stored0}/${stored1}; links ${JSON.stringify(lk11)}; NoPerson deal ${d}×, Ana ${a}×`);
  });
  await run("US2 scenario 8", async () => {
    const ud = L.recId("deal", "Unlink deal");
    const c = L.conv("To a stranger");
    const lp = await L.pageAs(b, L.L);
    let who = "Linus";
    let r = await go(lp, `/emails/${c}?from=deal-${ud}`);
    let pg = lp;
    if (r.status() !== 200) { who = "Ada (Linus gets " + r.status() + ")"; pg = p; await go(p, `/emails/${c}?from=deal-${ud}`); }
    const row = pg.locator("li", { hasText: "Unlink deal" }).first();
    await Promise.all([pg.waitForLoadState("networkidle"), row.locator("button", { hasText: "[ UNLINK ]" }).click()]);
    await sleep(500);
    const l1 = L.links(c);
    await L.runCheck(p, L.A);
    const l2 = L.links(c);
    const d = L.countSubj(await L.emailEntries(p, `/deals/${ud}`), "To a stranger");
    R("US2 scenario 8", d === 0 && l2.every((x) => !x.startsWith("d:Unlink deal") || x.includes("(removed)")), `${who} unlinked the deal: links ${JSON.stringify(l1)}; after the 15-minute check ${JSON.stringify(l2)}; Unlink deal shows it ${d}×`);
    await lp.context().close();
  });
  await run("Edge case 15", async () => {
    const la = L.recId("deal", "Later arch deal"), ldd = L.recId("deal", "Later del deal"), del = L.recId("person", "Del Deleteme");
    for (const [id, s] of [[la, "Later archived"], [ldd, "Later deleted"]]) { await L.openBox(p, `/deals/${id}`); if (id === la) await L.fill(p, { to: ["ben@example.test"] }); await L.fill(p, { subject: s, text: "x" }); await L.send(p); }
    PSQL(`update deals set archived_at=now() where id=${la}`);
    const a = L.countSubj(await L.emailEntries(p, `/deals/${la}`), "Later archived");
    await go(p, `/deals/${ldd}?confirm=delete`);
    await Promise.all([p.waitForLoadState("networkidle"), p.locator("button.danger-solid").first().click()]); await sleep(500);
    const left = q(`select count(*) from deals where id=${ldd}`);
    const dp = L.countSubj(await L.emailEntries(p, `/people/${del}`), "Later deleted");
    const bp = L.countSubj(await L.emailEntries(p, `/people/${L.recId("person", "Ben Fake")}`), "Later archived");
    R("Edge case 15", a === 1 && left === "0" && dp === 1 && bp === 1, `archived deal still shows its entry ${a}×; deleted deal (rows ${left}): Del Deleteme's page ${dp}×; Ben's page (archived deal's recipient) ${bp}×`);
  });
  await run("US4 scenario 1", async () => {
    const g = await L.pageAs(b, L.G);
    await L.openBox(g, `/deals/${deal}`);
    const t = norm(await L.panel(g).innerText());
    const link = L.panel(g).getByRole("link", { name: "[ GO TO SETTINGS ]" });
    const href = (await link.count()) ? await link.getAttribute("href") : null;
    const fields = await L.panel(g).locator("input, textarea").count(), sendB = await L.panel(g).getByRole("button", { name: "[ SEND ]" }).count();
    // disconnected: Margaret connects, then disconnects in Settings
    const m = await L.pageAs(b, "margaret@barnacle.ai");
    await L.connect(m);
    await go(m, "/settings?disconnect=1");
    await Promise.all([m.waitForLoadState("networkidle"), m.locator("button.danger-solid").first().click()]);
    await sleep(500);
    const mstate = q(`select state from gmail_connections where email='margaret@barnacle.ai'`);
    await L.openBox(m, `/deals/${deal}`);
    const mt = norm(await L.panel(m).innerText()); const msend = await L.panel(m).getByRole("button", { name: "[ SEND ]" }).count();
    R("US4 scenario 1", t.includes("Connect your Gmail in Settings to send email from the CRM.") && href === "/settings" && fields === 0 && sendB === 0 && mt.includes("Connect your Gmail in Settings to send email from the CRM.") && msend === 0, `never connected (Grace): "${t}", link ${href}, fields ${fields}, [ SEND ] ${sendB}; disconnected (Margaret, state ${mstate}): "${mt}", [ SEND ] ${msend}`);
    await g.context().close(); await m.context().close();
  });
  await run("US4 scenario 2", async () => {
    const lp = await L.pageAs(b, L.L);
    await L.connect(lp);
    await go(lp, "/dev/fake-gmail?user=" + encodeURIComponent(L.L));
    await Promise.all([lp.waitForLoadState("networkidle"), lp.click("text=[ REFUSE THE KEY ]")]);
    await L.runCheck(lp, L.L);
    const st = q(`select state from gmail_connections where email='${L.L}'`);
    await L.openBox(lp, `/deals/${deal}`);
    const t = norm(await L.panel(lp).innerText());
    const href = await L.panel(lp).getByRole("link", { name: "[ GO TO SETTINGS ]" }).getAttribute("href").catch(() => null);
    const sendB = await L.panel(lp).getByRole("button", { name: "[ SEND ]" }).count();
    R("US4 scenario 2", t.includes("Reconnect your Gmail in Settings to send email from the CRM.") && href === "/settings" && sendB === 0, `Linus's connection ${st}: "${t}", link ${href}, [ SEND ] ${sendB}`);
    await lp.context().close();
  });
  await run("US4 scenario 4", async () => {
    const off = await b.newContext({ viewport: { width: 1400, height: 1000 } }); const o = await off.newPage();
    await o.goto("http://localhost:3003/dev/fake-google"); await o.fill('input[name="email"]:visible', L.A); await o.fill('input[name="name"]:visible', "Ada Fake");
    await Promise.all([o.waitForLoadState("networkidle"), o.click("text=[ CONTINUE ]")]);
    await o.goto(`http://localhost:3003/deals/${deal}`); await o.waitForLoadState("networkidle");
    await tl(o).getByRole("link", { name: "[ WRITE EMAIL ]" }).click(); await L.panel(o).waitFor(); await o.waitForLoadState("networkidle");
    const t = norm(await L.panel(o).innerText()); const sendB = await L.panel(o).getByRole("button", { name: "[ SEND ]" }).count();
    R("US4 scenario 4", t.includes("Email can't be sent from the CRM right now.") && sendB === 0, `app with Gmail not set up (:3003), Ada: "${t}", [ SEND ] ${sendB}`);
    await off.close();
  });
  await run("US4 scenario 3", async () => {
    const before = (await L.emailEntries(p, `/deals/${deal}`)).length;
    await L.openBox(p, `/deals/${deal}`);
    await L.fill(p, { subject: "Key refused", text: "keep this" });
    const fp = await b.newPage(); // same session
    const ctx2 = await L.pageAs(b, L.A);
    await go(ctx2, "/dev/fake-gmail?user=" + encodeURIComponent(L.A));
    await Promise.all([ctx2.waitForLoadState("networkidle"), ctx2.click("text=[ REFUSE THE KEY ]")]);
    const n0 = sentCount();
    await L.send(p, { expectClose: false });
    await sleep(1500); await p.waitForLoadState("networkidle");
    const t = norm(await L.panel(p).innerText());
    const kept = (await p.inputValue("#email-subject").catch(() => "")) === "Key refused" && (await p.inputValue("#email-text").catch(() => "")) === "keep this";
    const href = await L.panel(p).getByRole("link", { name: "[ GO TO SETTINGS ]" }).getAttribute("href").catch(() => null);
    const bang = norm(await p.locator("nav, aside").filter({ hasText: /SETTINGS/i }).first().locator("a", { hasText: /SETTINGS/i }).innerText().catch(() => ""));
    const after = (await L.emailEntries(p, `/deals/${deal}`)).length;
    R("US4 scenario 3", sentCount() === n0 && t.includes("Reconnect your Gmail in Settings to send email from the CRM.") && href === "/settings" && kept && /!/.test(bang) && after === before, `key refused at [ SEND ]: Sent +${sentCount() - n0}; box "${t.slice(0, 160)}"; link ${href}; subject and text still in the box ${kept}; sidebar "${bang}"; deal EMAIL entries ${before}→${after}`);
    await ctx2.context().close(); await fp.close();
    await L.connect(p); // working again for the rest
  });
  await run("Edge case 14", async () => {
    const g = await L.pageAs(b, L.G);
    await go(g, "/admin/users");
    await Promise.all([g.waitForLoadState("networkidle"), g.locator("tr", { hasText: L.A }).getByRole("button", { name: "[ DEACTIVATE ]" }).click()]);
    await sleep(500);
    const st = q(`select status from users where email='${L.A}'`);
    const es = await L.emailEntries(g, `/deals/${deal}`);
    const heads = es.map((e) => e.head);
    R("Edge case 14", st === "deactivated" && heads.length > 0 && heads.every((h) => h.startsWith("Ada Fake →")), `Grace deactivated Ada (status ${st}); Grace sees ${heads.length} EMAIL entries on Fake Deal Ltd renewal, heads e.g. "${heads[0]}"; all start "Ada Fake →" ${heads.every((h) => h.startsWith("Ada Fake →"))}`);
    await g.context().close();
  });
  fs.writeFileSync("/tmp/sf129-b.json", JSON.stringify(S, null, 1));
  await b.close();
})();
