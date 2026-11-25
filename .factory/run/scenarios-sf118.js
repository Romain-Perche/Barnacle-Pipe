// SF-118 AI-review scenarios (Gmail connect and sync): all 32 (US1 1-5, US2 1-7, US3 1-4, US4 1-4, edge cases 1-12).
// Needs (see .factory/test-env.md): `bash .factory/run/reset-db.sh` on crm_dev, then the app on :3000 (start-app.sh, fake
// Gmail), plus :3003 started with GMAIL_TOKEN_KEY= (edge 9) and :3002 with real-mode Gmail settings and an unreachable
// Google (US3-2). Run: NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf118.js
// Users: Linus Fake (main), Margaret Fake (second mailbox), Ada Fake (admin, deactivates Margaret).
const { execFileSync } = require("child_process");
const fs = require("fs");
const lib = require("./lib");
const { chromium, check, results } = lib;
const BASE = "http://localhost:3000";
const DB = "crm_dev";
const L = "linus@barnacle.ai", M = "margaret@barnacle.ai", A = "ada@barnacle.ai";

const q = (s) => execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", DB, "-AtF", "|", "-v", "ON_ERROR_STOP=1", "-c", s], { encoding: "utf8" }).trim();
const ctlEnv = { ...process.env, APP_ENV: "development", DATABASE_URL: `postgres://postgres@localhost:5432/${DB}`, GMAIL_TOKEN_KEY: fs.readFileSync("/tmp/gmail-token-key", "utf8").trim(), APP_URL: BASE };
const ctl = (...args) => JSON.parse(execFileSync("npx", ["tsx", ".factory/run/gmail-ctl.ts", ...args], { encoding: "utf8", env: ctlEnv }).trim().split("\n").pop());
const S = {};
const R = (name, ok, notes) => { S[name] = { ok: !!ok, notes }; console.log((ok ? "PASS " : "FAIL ") + name + " — " + notes); };

async function page(browser, email, base = BASE) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await lib.signIn(p, base, email, "");
  return p;
}
const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
async function card(p, base = BASE) { await p.goto(base + "/settings"); return norm(await p.locator('section[aria-label="Gmail"]').innerText()); }
const count = (c) => { const m = /(\d+) conversations? copied/.exec(c); return m ? Number(m[1]) : null; };
const lastSync = (c) => (/Last sync: (.*?) \d+ conversation/.exec(c) || [])[1];
async function connect(p, { account, untick, cancel } = {}) {
  await p.goto(BASE + "/settings");
  await Promise.all([p.waitForURL(/fake-google\/gmail/), p.locator('section[aria-label="Gmail"] button', { hasText: /CONNECT GMAIL/ }).click()]);
  if (account) await p.fill('input[name="email"]', account);
  if (untick) await p.locator("label.check", { hasText: untick }).locator("input").uncheck();
  // The consent buttons post to /dev/fake-google/gmail/answer, a 303 to the callback, then a 303 to /settings.
  await Promise.all([p.waitForURL(/\/settings(\?|$)/), p.click(cancel ? "text=[ CANCEL ]" : "text=[ ALLOW ]")]);
  await p.waitForLoadState("networkidle");
  return norm(await p.locator('section[aria-label="Gmail"]').innerText());
}
async function put(p, user, o) {
  await p.goto(BASE + "/dev/fake-gmail?user=" + encodeURIComponent(user));
  await p.selectOption('select[name="direction"]', o.sent ? "sent" : "received");
  for (const k of ["from", "to", "cc", "subject"]) if (o[k] != null) await p.fill(`input[name="${k}"]`, o[k]);
  if (o.text != null) await p.fill('textarea[name="text"]', o.text);
  if (o.html != null) await p.fill('textarea[name="html"]', o.html);
  if (o.att) await p.fill('textarea[name="attachments"]', o.att.join("\n"));
  if (o.offset) await p.fill('input[name="offset"]', String(o.offset));
  if (o.label) await p.selectOption('select[name="label"]', o.label);
  if (o.thread) await p.selectOption('select[name="thread"]', o.thread);
  if (o.deliver === false) await p.uncheck('input[name="deliver"]');
  await Promise.all([p.waitForURL(/done=/), p.click("text=[ PUT IN THE MAILBOX ]")]);
  return new URL(p.url()).searchParams.get("done");
}
async function runCheck(p, user) {
  await p.goto(BASE + "/dev/fake-gmail?user=" + encodeURIComponent(user));
  await Promise.all([p.waitForURL(/done=checked/), p.click("text=[ RUN THE 15-MINUTE CHECK ]")]);
}
async function fakeBtn(p, user, label) {
  await p.goto(BASE + "/dev/fake-gmail?user=" + encodeURIComponent(user));
  await Promise.all([p.waitForURL(/done=/), p.click(`text=${label}`)]);
}
async function fakeHint(p, user) { await p.goto(BASE + "/dev/fake-gmail?user=" + encodeURIComponent(user)); return norm(await p.locator("p.hint").first().innerText()); }
async function push(n) { const r = await fetch(BASE + "/gmail/push", { method: "POST", headers: { authorization: n.authorization, "content-type": "application/json" }, body: JSON.stringify(n.body) }); return r.status; }
const threadOf = (user, subject) => q(`select t.gmail_thread_id from email_threads t join gmail_connections c on c.id=t.connection_id join email_messages m on m.thread_id=t.id where c.email='${user}' and m.subject='${subject}' limit 1`);
const msgCount = (user, subject) => Number(q(`select count(*) from email_messages m join gmail_connections c on c.id=m.connection_id where c.email='${user}' and m.subject='${subject}'`));
const uid = (e) => q(`select id from users where email='${e}'`);
async function waitMinuteTick() { const s = new Date().getSeconds(); await new Promise((r) => setTimeout(r, (61 - s) * 1000)); }
function person(first, last, emails, { priv = false, archived = false } = {}) {
  const id = q(`insert into persons (first_name,last_name,owner_id,consent,private,created_by,archived_at) values ('${first}','${last}',1,'subscribed',${priv},1,${archived ? "now()" : "null"}) returning id`).split("\n")[0];
  emails.forEach((e, i) => q(`insert into person_emails (person_id,email,position) values (${id},'${e}',${i})`));
  return id;
}

(async () => {
  const browser = await chromium.launch();
  q("delete from person_emails where email like 'ana%@example.test' or email in ('new@example.test','priv@example.test','arch@example.test','gone@example.test','other@example.test')");
  const lp = await page(browser, L);

  // ---- US1 ----
  {
    const c = await card(lp);
    const order = await lp.evaluate(() => { const s = [...document.querySelectorAll("section[aria-label]")].map((x) => x.getAttribute("aria-label")); return s; });
    const links = lp.locator("aside a, nav a").filter({ hasText: /^Settings/ });
    const n = await links.count();
    const warn = await lp.locator(".warn").count();
    const below = await lp.evaluate(() => { const a = [...document.querySelectorAll("a")].find((x) => /^Settings/.test(x.textContent.trim())); const b = [...document.querySelectorAll("button")].find((x) => /sign out/i.test(x.textContent)); return a && b ? (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? "above" : "below") : "missing"; });
    const pi = order.indexOf("Pipedrive"), gi = order.indexOf("Gmail");
    R("US1 scenario 1", c.includes("Gmail is not connected.") && c.includes("[ CONNECT GMAIL ]") && n === 1 && warn === 0 && pi >= 0 && gi > pi && below === "above", `card "${c}"; sections ${order.join(",")}; Settings links ${n}, "!" ${warn}, link ${below} SIGN OUT`);
  }
  {
    const c = await connect(lp, { cancel: true });
    const rows = q(`select count(*) from gmail_connections where user_id=${uid(L)}`);
    R("US1 scenario 3", c.includes("Gmail was not connected.") && c.includes("[ CONNECT GMAIL ]") && rows === "0", `after CANCEL: "${c}"; rows ${rows}`);
  }
  {
    const c = await connect(lp, { account: M });
    const rows = q(`select count(*) from gmail_connections where user_id=${uid(L)}`);
    R("US1 scenario 4", c.includes(`Connect the Gmail account you sign in with (${L}).`) && rows === "0", `account ${M}: "${c}"; rows ${rows}`);
  }
  {
    const c = await connect(lp, { untick: "Send email" });
    const rows = q(`select count(*) from gmail_connections where user_id=${uid(L)}`);
    const c2 = await connect(lp, { untick: /Read, compose|Read|modify/i });
    const rows2 = q(`select count(*) from gmail_connections where user_id=${uid(L)}`);
    const msg = "Gmail needs all the permissions asked for. Try again and tick every box.";
    R("US1 scenario 5", c.includes(msg) && c2.includes(msg) && rows === "0" && rows2 === "0", `send unticked: "${c}"; read unticked: "${c2}"; rows ${rows}/${rows2}`);
  }
  {
    const c = await connect(lp);
    const once = (c.match(/Gmail connected\./g) || []).length;
    const hint = await fakeHint(lp, L);
    const c2 = await card(lp);
    const cipher = q(`select encode(token_cipher,'escape') like '%fake%' from gmail_connections where user_id=${uid(L)}`);
    const ok = once === 1 && c.includes(`Connected as ${L}`) && c.includes("Last sync: Not synced yet") && c.includes("0 conversations copied") && c.includes("[ SEND ME A TEST EMAIL ]") && c.includes("[ DISCONNECT ]") && c.includes("Gmail · connected") && /Watch: active/.test(hint) && !c2.includes("Gmail connected.");
    R("US1 scenario 2", ok, `"${c}"; fake: "${hint}"; after reload notice gone: ${!c2.includes("Gmail connected.")}; cipher has plain 'fake': ${cipher}`);
  }

  // ---- US2 ----
  person("Ana", "Fake", ["ana@example.test", "ana.k@example.test"]);
  {
    const d = await put(lp, L, { from: '"Ana K" <ana.k@example.test>', subject: "SF118 two attachments", text: "hi", att: ["a.pdf:1000", "b.png:2000"] });
    const c = await card(lp);
    const atts = q(`select string_agg(a.name||':'||a.size, ',' order by a.position) from email_attachments a join email_messages m on m.id=a.message_id where m.subject='SF118 two attachments'`);
    R("US2 scenario 1", d === "delivered" && count(c) === 1 && c.includes("1 conversation copied") && lastSync(c) && lastSync(c) !== "Not synced yet", `${d}; "${c}"; stored attachments ${atts}`);
  }
  {
    const d = await put(lp, L, { sent: true, from: L, to: "ana@example.test", subject: "SF118 sent from gmail", text: "hello ana" });
    const c = await card(lp);
    R("US2 scenario 2", d === "delivered" && c.includes("2 conversations copied"), `${d}; "${c}"`);
  }
  {
    await waitMinuteTick();
    const before = await card(lp); const dbBefore = q(`select last_synced_at from gmail_connections where user_id=${uid(L)}`);
    await put(lp, L, { from: "news@letters.example.test", subject: "SF118 newsletter" });
    await put(lp, L, { from: M, to: L, subject: "SF118 teammates only" });
    const after = await card(lp); const dbAfter = q(`select last_synced_at from gmail_connections where user_id=${uid(L)}`);
    R("US2 scenario 3", count(after) === count(before) && lastSync(after) !== lastSync(before) && dbAfter !== dbBefore && msgCount(L, "SF118 newsletter") === 0, `before "${lastSync(before)}" ${count(before)} → after "${lastSync(after)}" ${count(after)}`);
  }
  {
    const t = threadOf(L, "SF118 two attachments");
    const before = count(await card(lp));
    await put(lp, L, { sent: true, from: L, to: "grace@barnacle.ai", subject: "Fwd: SF118 two attachments", thread: t });
    const after = count(await card(lp));
    const inThread = q(`select count(*) from email_messages m join email_threads t on t.id=m.thread_id where t.gmail_thread_id='${t}'`);
    R("US2 scenario 4", before === after && inThread === "2", `count ${before} → ${after}; messages in that conversation ${inThread}`);
  }
  {
    const before = count(await card(lp));
    const d = await put(lp, L, { from: "ana@example.test", subject: "SF118 dropped notice", deliver: false });
    const dropped = ctl("notice", L); // the notice Gmail would have sent then, kept for later
    const mid = count(await card(lp));
    await runCheck(lp, L);
    const after = count(await card(lp));
    const st = await push(dropped);
    const again = count(await card(lp));
    R("US2 scenario 5", d === "dropped" && mid === before && after === before + 1 && st === 204 && again === after && msgCount(L, "SF118 dropped notice") === 1, `${d}; ${before} → ${mid} (dropped) → ${after} after check; same notice again: HTTP ${st}, ${again}`);
  }
  {
    const before = count(await card(lp));
    await put(lp, L, { from: "ana@example.test", subject: "SF118 yesterday", offset: -1440 });
    await runCheck(lp, L);
    const after = count(await card(lp));
    R("US2 scenario 6", before === after && msgCount(L, "SF118 yesterday") === 0, `${before} → ${after}`);
  }
  {
    await put(lp, L, { from: "ana@example.test", subject: "SF118 contract", att: ["contract.pdf:20971520"] });
    const cols = q(`select string_agg(column_name, ',') from information_schema.columns where table_name='email_attachments'`);
    const row = q(`select a.name||'|'||a.size||'|'||coalesce(a.content_type,'') from email_attachments a join email_messages m on m.id=a.message_id where m.subject='SF118 contract'`);
    R("US2 scenario 7", row.startsWith("contract.pdf|20971520") && !/data|content(?!_type)|bytes/.test(cols.replace("content_type", "")), `stored "${row}"; email_attachments columns: ${cols}`);
  }

  // ---- US3 ----
  {
    await lp.goto(BASE + "/settings");
    await Promise.all([lp.waitForLoadState("networkidle"), lp.click("text=[ SEND ME A TEST EMAIL ]")]);
    await lp.waitForTimeout(500);
    const c = norm(await lp.locator('section[aria-label="Gmail"]').innerText());
    const sent = ctl("sent", L).filter((m) => m.subject === "Barnacle CRM test email");
    const box = await (async () => { await lp.goto(BASE + "/dev/fake-gmail?user=" + L); return norm(await lp.locator("tr", { hasText: "Barnacle CRM test email" }).first().innerText()); })();
    R("US3 scenario 1", sent.length === 1 && sent[0].from.includes(L) && sent[0].to.includes(L) && /SENT/.test(box) && /INBOX/.test(box) && c.includes(`Test email sent to ${L}. Check your inbox.`), `"${c}"; fake mailbox row: ${box}`);
  }
  {
    // :3002 = the same database with real-mode Gmail settings and Google unreachable (proxy on a closed port).
    const p2 = await page(browser, L, "http://localhost:3002");
    const before = q(`select state, last_synced_at, (select count(*) from email_threads where connection_id=c.id) from gmail_connections c where user_id=${uid(L)}`);
    await p2.goto("http://localhost:3002/settings");
    await Promise.all([p2.waitForURL(/settings/), p2.click("text=[ SEND ME A TEST EMAIL ]")]);
    await p2.waitForLoadState("networkidle");
    const c = norm(await p2.locator('section[aria-label="Gmail"]').innerText());
    const after = q(`select state, last_synced_at, (select count(*) from email_threads where connection_id=c.id) from gmail_connections c where user_id=${uid(L)}`);
    const sent = ctl("sent", L).filter((m) => m.subject === "Barnacle CRM test email").length;
    R("US3 scenario 2", c.includes("The test email could not be sent. Try again in a minute.") && before === after && sent === 1, `Google unreachable: "${c}"; connection ${before} → ${after}; test emails in Sent still ${sent}`);
    await p2.context().close();
  }
  {
    const t = threadOf(L, "SF118 two attachments");
    const r1 = ctl("send", uid(L), JSON.stringify({ to: ["ana@example.test"], subject: "Re: SF118 two attachments", text: "reply", threadId: t }));
    const r2 = ctl("send", uid(L), JSON.stringify({ to: ["ana@example.test"], subject: "SF118 new from crm", text: "new" }));
    const sent = ctl("sent", L);
    const m1 = sent.find((m) => m.id === r1.result?.messageId);
    const r3 = ctl("send", uid("grace@barnacle.ai"), JSON.stringify({ to: ["ana@example.test"], subject: "never", text: "x" }));
    const graceSent = ctl("sent", "grace@barnacle.ai").length;
    R("US3 scenario 3", r1.ok && r1.result.threadId === t && m1 && m1.from.includes(L) && !!m1.inReplyTo && r2.ok && r2.result.threadId !== t && r3.ok === false && r3.error === "GmailNotConnected" && graceSent === 0, `reply: ${JSON.stringify(r1)} from "${m1 && m1.from}" In-Reply-To "${m1 && m1.inReplyTo}"; new: ${JSON.stringify(r2)}; Grace (no connection): ${JSON.stringify(r3)}, her Sent ${graceSent}`);
  }
  {
    await runCheck(lp, L);
    R("US3 scenario 4", msgCount(L, "Barnacle CRM test email") === 0, `test emails stored after the check: ${msgCount(L, "Barnacle CRM test email")}`);
  }

  // ---- edge cases on Linus's mailbox ----
  {
    const b = count(await card(lp));
    await put(lp, L, { from: "new@example.test", subject: "SF118 before person" });
    person("New", "Fake", ["new@example.test"]);
    await runCheck(lp, L);
    const mid = count(await card(lp));
    await put(lp, L, { from: "new@example.test", subject: "SF118 after person" });
    const after = count(await card(lp));
    R("Edge case 1", mid === b && after === b + 1, `${b} → ${mid} after person added + check → ${after} after a new message`);
  }
  {
    const b = count(await card(lp));
    await put(lp, L, { from: "ANA@Example.test ", subject: "SF118 case" });
    const m = count(await card(lp));
    await put(lp, L, { from: '"Ana Fake" <other@example.test>', subject: "SF118 display name" });
    const a = count(await card(lp));
    R("Edge case 2", m === b + 1 && a === m, `${b} → ${m} (ANA@Example.test ) → ${a} ("Ana Fake" <other@…>)`);
  }
  {
    person("Priv", "Fake", ["priv@example.test"], { priv: true });
    person("Arch", "Fake", ["arch@example.test"], { archived: true });
    const gone = person("Gone", "Fake", ["gone@example.test"]);
    const b = count(await card(lp));
    await put(lp, L, { from: "priv@example.test", subject: "SF118 private" });
    const x1 = count(await card(lp));
    await put(lp, L, { from: "arch@example.test", subject: "SF118 archived" });
    const x2 = count(await card(lp));
    // delete through the app as the creator (Ada, admin)
    const ap = await page(browser, A);
    await ap.goto(BASE + "/people/" + gone);
    let deleted = false;
    try {
      const btn = ap.locator("a, button", { hasText: /DELETE/ }).first();
      await btn.click(); await ap.waitForLoadState("networkidle");
      const confirm = ap.locator("button", { hasText: /DELETE/ }).last();
      await Promise.all([ap.waitForLoadState("networkidle"), confirm.click()]);
      await ap.waitForTimeout(500);
      deleted = q(`select count(*) from persons where id=${gone}`) === "0";
    } catch (e) { deleted = false; }
    if (!deleted) q(`delete from persons where id=${gone}`);
    await put(lp, L, { from: "gone@example.test", subject: "SF118 deleted person" });
    const x3 = count(await card(lp));
    R("Edge case 3", x1 === b + 1 && x2 === x1 + 1 && x3 === x2, `${b} → ${x1} (private) → ${x2} (archived) → ${x3} (after deleting the person ${deleted ? "in the app" : "by SQL"})`);
    S.__ap = ap;
  }
  {
    const mp = await page(browser, M);
    await connect(mp);
    const lb = count(await card(lp)), mb = count(await card(mp));
    await put(lp, L, { from: "ana@example.test", to: `${L}, ${M}`, subject: "SF118 two mailboxes" });
    await put(mp, M, { from: "ana@example.test", to: `${L}, ${M}`, subject: "SF118 two mailboxes" });
    const la = count(await card(lp)), ma = count(await card(mp));
    const ids = q(`select string_agg(c.email||'='||coalesce(m.rfc_message_id,'?'), ' ; ') from email_messages m join gmail_connections c on c.id=m.connection_id where m.subject='SF118 two mailboxes'`);
    R("Edge case 4", la === lb + 1 && ma === mb + 1, `Linus ${lb} → ${la}, Margaret ${mb} → ${ma}; stored: ${ids}`);
    S.__mp = mp;
  }
  {
    const b = count(await card(lp));
    await put(lp, L, { sent: true, from: L, to: "ana@example.test", subject: "SF118 draft", label: "DRAFT" });
    await put(lp, L, { from: "ana@example.test", subject: "SF118 spam", label: "SPAM" });
    await runCheck(lp, L);
    const m = count(await card(lp));
    const t = ctl("trash", L, "SF118 case");
    await runCheck(lp, L);
    const a = count(await card(lp));
    R("Edge case 5", m === b && a === b && t === true && msgCount(L, "SF118 draft") + msgCount(L, "SF118 spam") === 0, `${b} → ${m} after a draft + spam → ${a} after moving a copied message to the bin (trash done: ${t})`);
  }
  {
    // Large catch-up: notices dropped, history forgotten, then the check.
    const b = count(await card(lp));
    for (let i = 1; i <= 4; i++) await put(lp, L, { from: "ana@example.test", subject: `SF118 catchup ${i}`, deliver: false });
    await fakeBtn(lp, L, "[ FORGET HISTORY ]");
    await runCheck(lp, L);
    const a = count(await card(lp));
    const each = [1, 2, 3, 4].map((i) => msgCount(L, `SF118 catchup ${i}`));
    const extra = q(`select coalesce(string_agg(m.subject, ', '), '') from email_messages m join gmail_connections c on c.id=m.connection_id where c.email='${L}' and m.subject not like 'SF118 catchup%' and m.created_at > now() - interval '20 seconds'`);
    R("Edge case 6", a >= b + 4 && each.every((n) => n === 1), `${b} → ${a} after 4 dropped messages, Gmail history forgotten, one check; each catch-up message stored ${each.join(",")}; also copied by that catch-up: "${extra}"`);
  }
  {
    const b = await card(lp);
    const bad = ctl("badnotice", L);
    const s1 = await push(bad);
    const s0 = (await fetch(BASE + "/gmail/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bad.body) })).status;
    // a notice for an address with no working connection (Grace), properly signed
    await put(lp, L, { from: "ana@example.test", subject: "SF118 unsent notice", deliver: false });
    const good = ctl("notice", L);
    const forGrace = { ...good, body: { ...good.body, message: { ...good.body.message, data: Buffer.from(JSON.stringify({ emailAddress: "grace@barnacle.ai", historyId: "999999" })).toString("base64") } } };
    const s2 = await push(forGrace);
    const a = await card(lp);
    R("Edge case 7", s1 === 403 && s0 === 403 && count(a) === count(b) && lastSync(a) === lastSync(b) && q(`select count(*) from gmail_connections where user_id=${uid("grace@barnacle.ai")}`) === "0", `bad proof: HTTP ${s1}, no proof: HTTP ${s0}, no connection: HTTP ${s2}; count ${count(b)} → ${count(a)}, last sync "${lastSync(b)}" → "${lastSync(a)}"`);
    await runCheck(lp, L); // copy the pending one so later counts are clean
  }
  {
    const b = count(await card(lp));
    await fakeBtn(lp, L, "[ FAIL RENEWALS ]");
    q(`update gmail_connections set watch_renewed_at = now() - interval '25 hours' where user_id=${uid(L)}`);
    await runCheck(lp, L);
    const st = q(`select state, watch_renewed_at < now() - interval '24 hours' from gmail_connections where user_id=${uid(L)}`);
    const c1 = await card(lp);
    await put(lp, L, { from: "ana@example.test", subject: "SF118 after failed renewal", deliver: false });
    await runCheck(lp, L);
    const c2 = await card(lp);
    await fakeBtn(lp, L, "[ FAIL RENEWALS ]");
    R("Edge case 11", c1.includes("Gmail · connected") && count(c2) === b + 1 && st.startsWith("working|t"), `after a failed renewal: state ${st}, card "${c1.slice(0, 40)}…"; ${b} → ${count(c2)} after the next check`);
  }
  {
    const b = count(await card(lp));
    await put(lp, L, { from: "ana@example.test", subject: "SF118 html only", html: "<p>only html</p>" });
    await put(lp, L, { from: "ana@example.test", subject: "SF118 attachment only", att: [":4321"] });
    const a = count(await card(lp));
    const row = q(`select a.name||'|'||a.size from email_attachments a join email_messages m on m.id=a.message_id where m.subject='SF118 attachment only'`);
    const html = q(`select coalesce(text_body,'<null>')||'|'||coalesce(html_body,'') from email_messages where subject='SF118 html only'`);
    R("Edge case 12", a === b + 2 && row === "(no name)|4321", `${b} → ${a}; nameless attachment stored as "${row}"; html-only message text|html: ${html}`);
  }
  {
    // Connecting twice: two tabs started one after the other, both allowed.
    const gp = await page(browser, "grace@barnacle.ai");
    const g2 = await gp.context().newPage();
    await g2.goto(BASE + "/settings"); // tab 2 opened before tab 1 connects
    const c1 = await connect(gp);
    await Promise.all([g2.waitForURL(/fake-google\/gmail/), g2.locator('section[aria-label="Gmail"] button', { hasText: /CONNECT GMAIL/ }).click()]);
    await Promise.all([g2.waitForURL(/\/settings(\?|$)/), g2.click("text=[ ALLOW ]")]); await g2.waitForLoadState("networkidle");
    const c2 = norm(await g2.locator('section[aria-label="Gmail"]').innerText());
    const c = await card(gp);
    const rows = q(`select count(*) from gmail_connections where user_id=${uid("grace@barnacle.ai")}`);
    const toks = ctl("tokens", "grace@barnacle.ai");
    // another user's address: Grace picks Linus's account
    await gp.goto(BASE + "/settings?disconnect=1");
    await Promise.all([gp.waitForURL(/\/settings$/), gp.locator('section[aria-label="Gmail"] button', { hasText: /DISCONNECT/ }).last().click()]);
    const w = await connect(gp, { account: L });
    const linusRows = q(`select count(*) from gmail_connections where email='${L}'`);
    R("Edge case 10", rows === "1" && (c.match(/Connected as/g) || []).length === 1 && w.includes("Connect the Gmail account you sign in with (grace@barnacle.ai).") && linusRows === "1", `tab 1 "${c1.slice(0, 60)}…", tab 2 "${c2.slice(0, 60)}…"; Settings "${c}"; rows ${rows}; Grace's tokens ${JSON.stringify(toks)}; Grace picking ${L}: "${w}"`);
    await gp.context().close();
  }

  // ---- US4 ----
  {
    // US4-2: Google stops accepting Linus's key, the check finds it.
    const before = await card(lp);
    await fakeBtn(lp, L, "[ REFUSE THE KEY ]");
    await runCheck(lp, L);
    const c = await card(lp);
    const st = q(`select state from gmail_connections where user_id=${uid(L)}`);
    const pages = ["/people", "/deals", "/settings", "/notifications"];
    const warns = [];
    for (const path of pages) { await lp.goto(BASE + path); warns.push(await lp.locator("a", { hasText: /^Settings/ }).locator(".warn").count()); }
    const color = await lp.locator(".warn").first().evaluate((e) => getComputedStyle(e).color);
    const leaseOk = await (async () => { await put(lp, L, { from: "ana@example.test", subject: "SF118 while refused" }); await runCheck(lp, L); return count(await card(lp)); })();
    const ok = st === "needs_reconnect" && c.includes(`Google no longer accepts the CRM's access to ${L}. Reconnect to carry on copying email.`) && c.includes("[ RECONNECT GMAIL ]") && c.includes("[ DISCONNECT ]") && lastSync(c) === lastSync(before) && count(c) === count(before) && warns.every((w) => w === 1) && leaseOk === count(before) && c.includes("needs reconnecting");
    R("US4 scenario 2", ok, `"${c}"; "!" on ${pages.join(",")}: ${warns.join(",")} colour ${color}; count while refused ${leaseOk}`);
  }
  {
    // US4-4
    const c = await card(lp);
    const r = ctl("send", uid(L), JSON.stringify({ to: ["ana@example.test"], subject: "SF118 should not go", text: "x" }));
    const sent = ctl("sent", L).filter((m) => m.subject === "SF118 should not go").length;
    R("US4 scenario 4", !c.includes("SEND ME A TEST EMAIL") && r.ok === false && r.error === "GmailNeedsReconnect" && sent === 0, `card has test button: ${c.includes("SEND ME A TEST EMAIL")}; send → ${JSON.stringify(r)}; sent ${sent}`);
  }
  {
    // US4-3: make the count 37 by SQL-free means is slow; set it up with real copies: put in enough CRM conversations before? We
    // simulate the "37" by copying more conversations through a reconnect cycle: first note the count N.
    const before = count(await card(lp));
    // reconnect
    await lp.goto(BASE + "/settings");
    await Promise.all([lp.waitForURL(/fake-google\/gmail/), lp.click("text=[ RECONNECT GMAIL ]")]);
    await Promise.all([lp.waitForURL(/\/settings(\?|$)/), lp.click("text=[ ALLOW ]")]); await lp.waitForLoadState("networkidle");
    const c = norm(await lp.locator('section[aria-label="Gmail"]').innerText());
    const warn = await lp.locator("a", { hasText: /^Settings/ }).locator(".warn").count();
    await runCheck(lp, L); // the message that came while refused is in a new conversation: copied now (carry on from the last sync)
    const afterCatch = count(await card(lp));
    await put(lp, L, { from: "ana@example.test", subject: "SF118 after reconnect" });
    const after = count(await card(lp));
    // an already-copied message reported again (dropped notice + check) is not counted twice
    await fakeBtn(lp, L, "[ FORGET HISTORY ]"); await runCheck(lp, L);
    const final = count(await card(lp));
    const dups = q(`select count(*) from (select gmail_message_id from email_messages group by connection_id, gmail_message_id having count(*)>1) x`);
    R("US4 scenario 3", c.includes("Gmail reconnected.") && c.includes("Gmail · connected") && count(c) === before && warn === 0 && after === afterCatch + 1 && final === after && dups === "0", `count ${before} → after reconnect "${c}" (still ${count(c)}); "!" ${warn}; the message from while refused copied by the check: ${afterCatch}; new conversation → ${after}; full re-listing → ${final}; duplicates ${dups} (the spec's 37/38 is shown with the real count ${before}/${before + 1 + (afterCatch - before)})`);
  }
  {
    // US4-1
    const before = count(await card(lp));
    const tokBefore = ctl("tokens", L);
    await lp.goto(BASE + "/settings");
    await lp.click("text=[ DISCONNECT ]");
    await lp.waitForURL(/disconnect=1/);
    const box = norm(await lp.locator('section[aria-label="Gmail"]').innerText());
    await Promise.all([lp.waitForURL(/\/settings$/), lp.locator('section[aria-label="Gmail"] button', { hasText: /DISCONNECT/ }).last().click()]);
    await lp.waitForLoadState("networkidle");
    const c = norm(await lp.locator('section[aria-label="Gmail"]').innerText());
    const hint = await fakeHint(lp, L);
    const tok = ctl("tokens", L);
    const cipher = q(`select token_cipher is null from gmail_connections where user_id=${uid(L)}`);
    const kept = Number(q(`select count(*) from email_threads t join gmail_connections c on c.id=t.connection_id where c.user_id=${uid(L)}`));
    const d = await put(lp, L, { from: "ana@example.test", subject: "SF118 after disconnect" });
    await runCheck(lp, L);
    const c2 = await card(lp);
    R("US4 scenario 1", box.includes("Disconnect Gmail? New email will stop being copied. Emails already copied stay in the CRM.") && c.includes("Gmail disconnected.") && c.includes("[ CONNECT GMAIL ]") && /Key: revoked/.test(hint) && /Watch: none/.test(hint) && cipher === "t" && kept === before && msgCount(L, "SF118 after disconnect") === 0 && c2.includes("Gmail is not connected."), `confirm "${box}"; after: "${c}"; fake: "${hint}" tokens ${JSON.stringify(tokBefore)}→${JSON.stringify(tok)}; key gone ${cipher}; conversations kept ${kept}/${before}; new message: ${d}, stored ${msgCount(L, "SF118 after disconnect")}`);
  }

  // ---- edge 8: deactivate Margaret (connected) as Ada ----
  {
    const ap = S.__ap;
    await ap.goto(BASE + "/admin/users");
    await lib.rowAction(ap, M, "Deactivate");
    if (await ap.locator("button", { hasText: /DEACTIVATE|Deactivate/ }).count()) { /* a confirmation, if any */ }
    let st = q(`select status from users where email='${M}'`);
    if (st !== "deactivated") {
      // maybe a confirm box with a hand-over: pick the first option and confirm
      const sel = ap.locator("select").first(); if (await sel.count()) { const v = await sel.locator("option").nth(1).getAttribute("value"); if (v) await sel.selectOption(v); }
      await Promise.all([ap.waitForLoadState("networkidle"), ap.locator("button", { hasText: /DEACTIVATE/i }).last().click()]);
      await ap.waitForTimeout(500);
      st = q(`select status from users where email='${M}'`);
    }
    const conn = q(`select state, token_cipher is null from gmail_connections where user_id=${uid(M)}`);
    const hint = await fakeHint(ap, M);
    await put(ap, M, { from: "ana@example.test", subject: "SF118 to deactivated" });
    await runCheck(ap, M);
    const stored = msgCount(M, "SF118 to deactivated");
    await ap.goto(BASE + "/admin/users");
    await lib.rowAction(ap, M, "Reactivate");
    const st2 = q(`select status from users where email='${M}'`);
    const mp = await page(browser, M);
    const c = await card(mp);
    R("Edge case 8", st === "deactivated" && conn === "disconnected|t" && /Key: revoked/.test(hint) && stored === 0 && st2 === "active" && c.includes("Gmail is not connected.") && c.includes("[ CONNECT GMAIL ]"), `status ${st}; connection ${conn}; fake "${hint}"; new message stored ${stored}; reactivated ${st2}; Settings "${c}"`);
  }

  // ---- edge 9: :3003 has no GMAIL_TOKEN_KEY ----
  {
    const p3 = await page(browser, "grace@barnacle.ai", "http://localhost:3003");
    const c = await card(p3, "http://localhost:3003");
    await p3.goto("http://localhost:3003/people"); const people = p3.url().includes("/people") && (await p3.locator("table").count()) > 0;
    await p3.goto("http://localhost:3003/deals"); const deals = (await p3.locator("main").innerText()).length > 50;
    R("Edge case 9", c.includes("Gmail can't be connected right now.") && !c.includes("CONNECT GMAIL") && people && deals, `"${c}"; people page ok ${people}, deals ok ${deals}`);
  }

  await browser.close();
  delete S.__ap; delete S.__mp;
  fs.writeFileSync("/tmp/sf118-results.json", JSON.stringify(S, null, 1));
  console.log(`\n${Object.values(S).filter((x) => x.ok).length}/${Object.keys(S).length} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
