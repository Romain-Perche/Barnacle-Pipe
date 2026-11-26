// SF-128 AI-review scenarios (fetch past emails): US1 1-5, US2 1-4, US3 1-5, US4 1-3, edge cases 1-11.
// Needs (see .factory/test-env.md): `rm -rf .fake-gmail && bash .factory/run/reset-db.sh`, the app on :3000
// (start-app.sh, fake Gmail) and :3003 with GMAIL_TOKEN_KEY= (edge 9, Gmail not set up).
// Run: NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf128.js   (results: /tmp/sf128-results.json)
// Users: Linus (the 100-conversation mailbox), Margaret (small mailboxes, emptied between edge cases), Ada (edge 7, admin),
// Alan (never connected). CRM people made by SQL: Ana Fake (two addresses), Ben Fake, Pia (private, Ada's), Arlo (archived).
const { execFileSync } = require("child_process");
const fs = require("fs");
const lib = require("./lib");
const { chromium } = lib;
const BASE = "http://localhost:3000";
const DB = "crm_dev";
const L = "linus@barnacle.ai", M = "margaret@barnacle.ai", A = "ada@barnacle.ai", AL = "grace@barnacle.ai"; // AL: a user never connected on :3000
const onlyMargaret = process.argv[2] === "margaret"; // skip Linus's part (US1 1,2,4, US2, US3 1-2, US4, edges 10-11)

const q = (s) => execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", DB, "-AtF", "|", "-v", "ON_ERROR_STOP=1", "-c", s], { encoding: "utf8" }).trim();
const ctlEnv = { ...process.env, APP_ENV: "development", DATABASE_URL: `postgres://postgres@localhost:5432/${DB}`, GMAIL_TOKEN_KEY: fs.readFileSync("/tmp/gmail-token-key", "utf8").trim(), APP_URL: BASE };
const ctl = (...args) => JSON.parse(execFileSync("npx", ["tsx", ".factory/run/sf128-ctl.ts", ...args.map((x) => (typeof x === "string" ? x : JSON.stringify(x)))], { encoding: "utf8", env: ctlEnv }).trim().split("\n").pop());
const S = {};
const R = (name, ok, notes) => { S[name] = { ok: !!ok, notes }; console.log((ok ? "PASS " : "FAIL ") + name + " — " + notes); fs.writeFileSync("/tmp/sf128-results.json", JSON.stringify(S, null, 1)); };
const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = (e) => q(`select id from users where email='${e}'`);
const conn = (e) => q(`select id from gmail_connections where user_id=${uid(e)}`);
const fetchRow = (e) => q(`select f.state||'|'||f.copied||'|'||coalesce(f.problem,'-')||'|'||f.started_at from past_email_fetches f join gmail_connections c on c.id=f.connection_id where c.user_id=${uid(e)}`);
const dbThreads = (e) => Number(q(`select count(*) from email_threads t join gmail_connections c on c.id=t.connection_id where c.user_id=${uid(e)}`) || 0);
const dupes = (e) => Number(q(`select count(*) from (select gmail_message_id from email_messages m join gmail_connections c on c.id=m.connection_id where c.user_id=${uid(e)} group by 1 having count(*)>1) x`));

async function ctx(browser, email, { js = true, base = BASE } = {}) {
  const c = await browser.newContext({ javaScriptEnabled: js });
  const p = await c.newPage();
  if (!js) {
    // sign in with a JS page sharing the context's cookies
    const p2 = await c.newPage();
    await lib.signIn(p2, base, email, "");
    await p2.close();
  } else await lib.signIn(p, base, email, "");
  return p;
}
// The card's parts: total line, the PAST EMAILS part, whole card.
async function card(p, { reload = true, base = BASE } = {}) {
  if (reload) await p.goto(base + "/settings");
  const sec = p.locator('section[aria-label="Gmail"]');
  const all = norm(await sec.innerText());
  const lines = (await sec.locator(".gm-lines").count()) ? norm(await sec.locator(".gm-lines").innerText()) : "";
  const tm = /(\d+) conversations? copied/.exec(lines);
  const past = (await sec.locator(".gm-sub").count()) ? norm(await sec.locator(".gm-sub").innerText()) + " " + norm((await sec.locator(".gm-pd").allInnerTexts()).join(" ")) : "";
  const pm = /Fetching past emails: (\d+) conversations? copied/.exec(past);
  const em = /Past emails fetched: (\d+) conversations? copied\./.exec(past);
  return { all, total: tm ? Number(tm[1]) : null, past, progress: pm ? Number(pm[1]) : null, ended: em ? Number(em[1]) : null, button: all.includes("[ FETCH PAST EMAILS ]") };
}
async function connect(p, { reconnect = false } = {}) {
  await p.goto(BASE + "/settings");
  await Promise.all([p.waitForURL(/fake-google\/gmail/), p.locator('section[aria-label="Gmail"] button', { hasText: reconnect ? /RECONNECT GMAIL/ : /CONNECT GMAIL/ }).first().click()]);
  await Promise.all([p.waitForURL(/\/settings(\?|$)/), p.click("text=[ ALLOW ]")]);
  await p.waitForLoadState("networkidle");
}
async function disconnect(p) {
  await p.goto(BASE + "/settings?disconnect=1");
  await Promise.all([p.waitForURL(/\/settings$/), p.locator('section[aria-label="Gmail"] button', { hasText: /DISCONNECT/ }).last().click()]);
}
async function press(p) {
  await p.goto(BASE + "/settings");
  await Promise.all([p.waitForURL(/\/settings/), p.locator("button", { hasText: "[ FETCH PAST EMAILS ]" }).click()]);
  await p.waitForLoadState("networkidle").catch(() => {});
}
async function fakeBtn(p, user, label) {
  await p.goto(BASE + "/dev/fake-gmail?user=" + encodeURIComponent(user));
  await Promise.all([p.waitForURL(/done=/), p.click(`text=${label}`)]);
}
const runCheck = (p, user) => fakeBtn(p, user, "[ RUN THE 15-MINUTE CHECK ]");
// Watches the card (JS-free page) until the fetch ends; returns the progress numbers seen, in order.
async function watch(obs, { timeout = 180000, onSeen } = {}) {
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const c = await card(obs);
    if (c.progress !== null) { seen.push({ t: Date.now() - t0, n: c.progress, button: c.button, total: c.total, unreachable: c.past.includes("Gmail can't be reached right now. Fetching will carry on by itself.") }); if (onSeen) await onSeen(c, seen); }
    if (c.ended !== null) return { seen, end: c };
    await sleep(250);
  }
  return { seen, end: null };
}
const monotonic = (seen) => seen.every((s, i) => i === 0 || s.n >= seen[i - 1].n);
// Empties a user's copied mail, fetch row and (optionally) fake mailbox: a fresh start for one scenario's data.
function fresh(e, { box = true } = {}) {
  q(`delete from past_email_fetches where connection_id in (select id from gmail_connections where user_id=${uid(e)})`);
  q(`delete from email_threads where connection_id in (select id from gmail_connections where user_id=${uid(e)})`);
  if (box) ctl("clear", e);
}
function person(first, last, emails, { priv = false, archived = false, owner = 1 } = {}) {
  const id = q(`insert into persons (first_name,last_name,owner_id,consent,private,created_by,archived_at) values ('${first}','${last}',${owner},'subscribed',${priv},${owner},${archived ? "now()" : "null"}) returning id`).split("\n")[0];
  emails.forEach((e, i) => q(`insert into person_emails (person_id,email,position) values (${id},'${e}',${i})`));
  return id;
}
// The expected copy, worked out independently from the fake mailbox: per thread, the non-draft/spam/bin messages within
// [start, end] and a CRM address among them → those messages.
function expected(e, crm, start, end) {
  const box = ctl("box", e);
  const byThread = {};
  for (const m of box) (byThread[m.threadId] ||= []).push(m);
  const threads = new Set(), msgs = new Set();
  for (const [t, ms] of Object.entries(byThread)) {
    const c = ms.filter((m) => !m.labels.some((l) => ["DRAFT", "SPAM", "TRASH"].includes(l)) && m.date >= start && m.date <= end);
    if (c.some((m) => m.addrs.some((a) => crm.has(a)))) { threads.add(t); c.forEach((m) => msgs.add(m.id)); }
  }
  return { threads, msgs, box };
}
const stored = (e) => new Set(q(`select gmail_message_id from email_messages m join gmail_connections c on c.id=m.connection_id where c.user_id=${uid(e)}`).split("\n").filter(Boolean));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const crmSet = () => new Set(q("select email from person_emails").split("\n"));

(async () => {
  const browser = await chromium.launch();
  q("delete from persons where id in (select person_id from person_emails where email like '%@example.test' and email not like '%@fake.example')");
  person("Ana", "Fake", ["ana.fake@example.test", "ana.home@example.test"]);
  person("Ben", "Fake", ["ben.fake@example.test"]);
  person("Pia", "Private", ["pia.private@example.test"], { priv: true, owner: 1 });
  person("Arlo", "Archived", ["arlo.archived@example.test"], { archived: true });

  if (!onlyMargaret) {
  const lp = await ctx(browser, L);
  const lobs = await ctx(browser, L, { js: false });
  if (!conn(L)) await connect(lp);
  fresh(L);

  // ---- US1 1, 2, 4; US2 1 (no padding: one or two parts); edge 8 partly ----
  {
    const c0 = await card(lp);
    await fakeBtn(lp, L, "[ PUT 100 PAST CONVERSATIONS ]");
    const nBox = new Set(ctl("box", L).map((m) => m.threadId)).size;
    const pressedAt = Date.now();
    await press(lp); // the page stays open: PastFetchRunner runs the parts
    const w = await watch(lobs);
    const row = fetchRow(L);
    const ws = new Date(pressedAt); ws.setUTCFullYear(ws.getUTCFullYear() - 1);
    const exp = expected(L, crmSet(), ws.getTime() - 60000, Date.now());
    const st = stored(L);
    R("US1 scenario 1", c0.total === 0 && c0.past.includes("Copies the last 12 months of your conversations with people in the CRM. Press again after an import: nothing is copied twice.") && nBox === 100 && w.end && w.end.ended === 60 && w.end.total === 60,
      `before: total ${c0.total}, explanation shown ${c0.past.includes("Copies the last 12 months")}; mailbox threads ${nBox}; end card: "${w.end && w.end.past}", total ${w.end && w.end.total}; row ${row}`);
    const groups = { news: 0, team: 0, old: 0, draft: 0, spamTrash: 0 };
    for (const m of exp.box) {
      if (!st.has(m.id)) continue;
      if (m.addrs.some((a) => a.startsWith("news@"))) groups.news++;
      if (m.labels.includes("DRAFT")) groups.draft++;
      if (m.labels.some((l) => l === "SPAM" || l === "TRASH")) groups.spamTrash++;
      if (m.date < ws.getTime()) groups.old++;
      if (m.addrs.every((a) => a.endsWith("@barnacle.ai"))) groups.team++;
    }
    R("US1 scenario 2", sameSet(st, exp.msgs) && Object.values(groups).every((x) => x === 0) && dupes(L) === 0,
      `stored ${st.size} messages, expected (independent rule over the fake mailbox) ${exp.msgs.size} in ${exp.threads.size} threads, same set ${sameSet(st, exp.msgs)}; stored by kind ${JSON.stringify(groups)}; duplicates ${dupes(L)}`);
    const mid = w.seen.filter((s) => s.n < 60);
    R("US1 scenario 4", w.seen.length > 0 && w.seen.every((s) => !s.button) && mid.length > 0,
      `reloads while running: ${w.seen.length}, numbers ${[...new Set(w.seen.map((s) => s.n))].join(",")}; button shown during run: ${w.seen.some((s) => s.button)}`);
    S.__us1seen = w.seen;
  }

  // ---- US3 1, 2 ----
  {
    await press(lp);
    const w1 = await watch(lobs);
    R("US3 scenario 1", w1.end && w1.end.ended === 0 && w1.end.total === 60 && dupes(L) === 0, `second press: "${w1.end && w1.end.past}", total ${w1.end && w1.end.total}; duplicates ${dupes(L)}`);
    person("Nia", "Later", ["nia.later@example.test"]);
    await press(lp);
    const w2 = await watch(lobs);
    R("US3 scenario 2", w2.end && w2.end.ended === 5 && w2.end.total === 65 && dupes(L) === 0, `Nia Later added (5 conversations): "${w2.end && w2.end.past}", total ${w2.end && w2.end.total}; duplicates ${dupes(L)}`);
  }

  // ---- edge 10: reload after the end; press again; disconnect ----
  {
    const a = await card(lobs);
    const b = await card(lobs);
    await press(lobs); // JS-free: no part runs, the progress line stays
    const c = await card(lobs);
    // let it end (the open JS page runs it)
    await lp.goto(BASE + "/settings");
    const w = await watch(lobs);
    S.__e10 = { a, b, c, end: w.end };
  }

  // ---- US2 1, edge 8: 60 to copy among 160 conversations (more than one part of 100) ----
  q("delete from persons where id in (select person_id from person_emails where email='nia.later@example.test')");
  fresh(L);
  await fakeBtn(lp, L, "[ PUT 100 PAST CONVERSATIONS ]");
  ctl("pad", L, "60");
  {
    await press(lp);
    const w = await watch(lobs);
    const nums = [...new Set(w.seen.map((s) => s.n))];
    R("US2 scenario 1", w.end && w.end.ended === 60 && nums.length >= 2 && monotonic(w.seen), `numbers seen on reloads ${nums.join(",")}, never lower ${monotonic(w.seen)}; end "${w.end && w.end.past}"`);
  }

  // ---- US2 2: page closed after the first part ----
  fresh(L, { box: false });
  {
    const p = await ctx(browser, L);
    await press(p);
    // the first part: the runner's first server-action POST answers, then the page is closed
    await p.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"], { timeout: 60000 }).catch(() => {});
    await p.context().close();
    await sleep(500);
    const afterFirst = fetchRow(L);
    let n = 0;
    while (n < 10 && !fetchRow(L).startsWith("ended")) { await runCheck(lp, L); n++; }
    const c = await card(lobs);
    R("US2 scenario 2", afterFirst.startsWith("running") && c.ended === 60 && c.total === 60, `after first part: ${afterFirst}; 15-minute checks run: ${n}; card "${c.past}", total ${c.total}`);
  }

  // ---- US2 3: slow down during a fetch ----
  fresh(L, { box: false });
  {
    const fp = await ctx(browser, L);
    let slowedAt = null, slowedN = null;
    await press(lp);
    const w = await watch(lobs, {
      onSeen: async (c) => {
        if (slowedAt === null && c.progress > 0) { slowedN = c.progress; slowedAt = Date.now(); await fakeBtn(fp, L, "[ SLOW DOWN NEXT CALL ]"); }
      },
    });
    // the plateau: the longest run of the same number while running
    let best = { n: null, ms: 0 };
    for (let i = 0, j = 0; i < w.seen.length; i = j) {
      for (j = i; j < w.seen.length && w.seen[j].n === w.seen[i].n; j++);
      const ms = w.seen[j - 1].t - w.seen[i].t;
      if (ms > best.ms) best = { n: w.seen[i].n, ms };
    }
    const after = w.seen.filter((s) => s.n > best.n).length;
    R("US2 scenario 3", best.ms >= 25000 && after > 0 && w.end && w.end.ended === 60 && monotonic(w.seen), `slow down pressed at number ${slowedN}; longest unchanged number ${best.n} for ${Math.round(best.ms / 1000)} s; higher numbers after: ${after}; end "${w.end && w.end.past}"`);
    await fp.context().close();
  }

  // ---- US2 4: Gmail unreachable ----
  fresh(L, { box: false });
  {
    const fp = await ctx(browser, L);
    let offAt = null, msg = null;
    await press(lp);
    // wait for a number > 0, then Gmail unreachable
    let c;
    for (let i = 0; i < 400; i++) { c = await card(lobs); if (c.progress > 0 || c.ended !== null) break; await sleep(100); }
    await fakeBtn(fp, L, "[ GMAIL UNREACHABLE: ON ]");
    await lp.goto("about:blank"); // the page is closed
    let un = null;
    for (let i = 0; i < 60; i++) { const x = await card(lobs); if (x.past.includes("Gmail can't be reached right now. Fetching will carry on by itself.")) { un = x; break; } if (x.ended !== null) break; await sleep(500); }
    await sleep(3000);
    const un2 = await card(lobs);
    await fakeBtn(fp, L, "[ GMAIL UNREACHABLE: OFF ]");
    let n = 0;
    while (n < 10 && !fetchRow(L).startsWith("ended")) { await runCheck(fp, L); n++; }
    const end = await card(lobs);
    R("US2 scenario 4", un && un2.progress === un.progress && end.ended === 60, `unreachable line: ${un ? `"${un.past}"` : "never shown"}; 3 s later number ${un2.progress}; checks ${n}; end "${end.past}"`);
    await fp.context().close();
  }

  // ---- US4 1, 2: key refused, reconnect ----
  fresh(L, { box: false });
  {
    await lp.goto("about:blank");
    await press(lobs); // no runner: the fetch waits for a part
    const fp = await ctx(browser, L);
    await fakeBtn(fp, L, "[ REFUSE THE KEY ]");
    await runCheck(fp, L); // a part / the sync finds the refusal
    const st = q(`select state from gmail_connections where user_id=${uid(L)}`);
    const c1 = await card(lobs);
    const r1 = fetchRow(L);
    await runCheck(fp, L);
    await runCheck(fp, L);
    const r2 = fetchRow(L);
    R("US4 scenario 1", st === "needs_reconnect" && c1.all.includes("needs reconnecting") && c1.past.includes("Fetching past emails is paused until Gmail is reconnected.") && !c1.button && r1.split("|")[1] === r2.split("|")[1],
      `connection ${st}; card "${c1.all}"; row before/after 2 checks ${r1} / ${r2}`);
    await connect(lp, { reconnect: true });
    const c2 = await card(lobs);
    const w = await watch(lobs);
    R("US4 scenario 2", !c2.past.includes("paused") && c2.progress !== null && w.end && w.end.ended === 60, `after reconnect: "${c2.past}"; end "${w.end && w.end.past}", total ${w.end && w.end.total}`);
    await fp.context().close();
  }

  // ---- US4 3 (disconnect) ----
  fresh(L, { box: false });
  {
    await press(lp);
    for (let i = 0; i < 400; i++) { const c = await card(lobs); if (c.progress > 0) break; await sleep(100); }
    await lp.goto("about:blank");
    await disconnect(lobs);
    await sleep(2500); // a part in flight finishes
    const c1 = await card(lobs);
    const copied = dbThreads(L);
    const fp = await ctx(browser, L);
    await runCheck(fp, L);
    const c2 = await card(lobs);
    const copied2 = dbThreads(L);
    const row = fetchRow(L);
    await connect(lp);
    const c3 = await card(lobs);
    R("US4 scenario 3", c1.all.includes("Gmail is not connected.") && c1.progress === null && c2.all === c1.all && copied2 === copied && copied > 0 && row === "" && c3.total === copied && c3.button && c3.ended === null,
      `after disconnect "${c1.all}"; threads kept ${copied}, after a check ${copied2}, card unchanged ${c2.all === c1.all}; fetch row "${row}"; after connecting again: total ${c3.total}, button ${c3.button}, end message ${c3.ended}; deactivation: see edge 11`);
    await fp.context().close();
  }

  // ---- edge 11 (and US4 3's deactivation): deactivated during a fetch, reactivated ----
  fresh(L, { box: false });
  {
    const ap = await ctx(browser, A);
    await press(lobs); // running, no runner
    await ap.goto(BASE + "/admin/users");
    await lib.rowAction(ap, L, "[ DEACTIVATE ]");
    let st = q(`select status from users where email='${L}'`);
    if (st !== "deactivated") {
      const sel = ap.locator("select").first(); if (await sel.count()) { const v = await sel.locator("option").nth(1).getAttribute("value"); if (v) await sel.selectOption(v); }
      await Promise.all([ap.waitForLoadState("networkidle"), ap.locator("button", { hasText: /DEACTIVATE/i }).last().click()]);
      await ap.waitForTimeout(500);
      st = q(`select status from users where email='${L}'`);
    }
    const row = fetchRow(L);
    await runCheck(ap, A);
    await ap.goto(BASE + "/admin/users");
    await lib.rowAction(ap, L, "[ REACTIVATE ]");
    const lp2 = await ctx(browser, L);
    const c1 = await card(lp2);
    await connect(lp2);
    const c2 = await card(lp2);
    R("Edge case 11", st === "deactivated" && row === "" && c1.all.includes("Gmail is not connected.") && c1.progress === null && c2.button && c2.progress === null && c2.ended === null,
      `deactivated: ${st}, fetch row "${row}"; reactivated card "${c1.all}"; after connecting: button ${c2.button}, "${c2.past}"`);
    S.__lp2 = lp2;
    await ap.context().close();
  }

  // ---- edge 10 result ----
  {
    const e = S.__e10;
    const lp2 = S.__lp2;
    await disconnect(lp2);
    const d = await card(lp2);
    R("Edge case 10", e.a.ended !== null && e.b.ended === e.a.ended && e.a.past.includes("Last fetched") && e.c.ended === null && e.c.progress !== null && !d.past.includes("Past emails fetched"),
      `after end: "${e.a.past}"; reload: ended ${e.b.ended}; pressed again: "${e.c.past}"; after disconnect: "${d.all}"`);
    await connect(lp2);
  }
  }

  // ---- Margaret: small mailboxes ----
  const mp = await ctx(browser, M);
  const mobs = await ctx(browser, M, { js: false });
  if (!conn(M)) await connect(mp);
  const run = async (setup) => {
    fresh(M);
    const info = setup ? await setup() : null;
    await press(mp);
    const w = await watch(mobs);
    return { end: w.end, info };
  };
  const T = (x, extra = {}) => ({ from: x, to: M, subject: "Fake subject", ...extra });

  // US1 5
  {
    const r = await run(() => ctl("add", M, [T("Fake News <news@example.test>", { daysAgo: 10 })]));
    R("US1 scenario 5", r.end && r.end.ended === 0, `newsletter only: "${r.end && r.end.past}"`);
  }
  // US1 3
  {
    const r = await run(() =>
      ctl("add", M, [
        T("ben.fake@example.test", { daysAgo: 400, subject: "Old one" }),
        T("Ben Fake <ben.fake@example.test>", { daysAgo: 100, subject: "Recent 1", cc: "sam.fake@barnacle.ai", text: "First text.", html: "<p>First</p>", attachments: [{ name: "deck.pdf", size: 12345, type: "application/pdf" }] }),
        { from: M, to: "ben.fake@example.test", bcc: "team.fake@barnacle.ai", subject: "Re: Recent 1", text: "My reply.", daysAgo: 99 },
        T("ben.fake@example.test", { daysAgo: 50, subject: "Re: Re: Recent 1", text: "Third.", attachments: [{ name: "photo.png", size: 2048, type: "image/png" }] }),
      ]),
    );
    const rows = q(`select m.gmail_message_id, m.direction, m.from_address, m.to_list, m.cc_list, m.bcc_list, m.subject, m.received_at is not null or m.sent_at is not null, coalesce(m.text_body,''), (select string_agg(a.name||':'||a.size||':'||a.content_type, ',') from email_attachments a where a.message_id=m.id) from email_messages m join gmail_connections c on c.id=m.connection_id where c.user_id=${uid(M)} order by coalesce(m.received_at,m.sent_at)`).split("\n");
    const att = q(`select count(*) from information_schema.columns where table_name='email_attachments' and column_name in ('content','data','bytes')`);
    const ids = r.info.ids;
    const ok = rows.length === 3 && !rows.some((x) => x.startsWith(ids[0] + "|")) && rows[0].includes("Recent 1") && rows[0].includes("deck.pdf:12345:application/pdf") && rows[0].includes("sam.fake@barnacle.ai") && rows[0].includes("First text.") && rows[1].includes("team.fake@barnacle.ai") && rows[1].includes("sent") && rows[2].includes("photo.png:2048:image/png") && att === "0";
    R("US1 scenario 3", ok && r.end.ended === 1, `end "${r.end.past}"; stored rows: ${JSON.stringify(rows)}; attachment content columns ${att}`);
  }
  // Edge 1
  {
    const r1 = await run(() => { ctl("add", M, [T("pia.private@example.test", { daysAgo: 20 })]); ctl("add", M, [T("pia.private@example.test", { daysAgo: 30 })]); ctl("add", M, [T("arlo.archived@example.test", { daysAgo: 40 })]); });
    const del = person("Del", "Gone", ["del.gone@example.test"]);
    q(`delete from persons where id=${del}`);
    const left = q("select count(*) from person_emails where email='del.gone@example.test'");
    const r2 = await run(() => ctl("add", M, [T("del.gone@example.test", { daysAgo: 20 })]));
    R("Edge case 1", r1.end.ended === 3 && r2.end.ended === 0 && left === "0", `private ×2 + archived ×1: "${r1.end.past}"; deleted person (address rows left ${left}): "${r2.end.past}"`);
  }
  // Edge 2
  {
    q("insert into person_emails (person_id,email,position) select person_id,'ana@example.test',5 from person_emails where email='ana.fake@example.test'");
    const r1 = await run(() => ctl("add", M, [T("ANA@Example.test", { daysAgo: 20 })]));
    const r2 = await run(() => ctl("add", M, [T('"Ana Fake" <other@example.test>', { daysAgo: 20 })]));
    q("delete from person_emails where email='ana@example.test'");
    R("Edge case 2", r1.end.ended === 1 && r2.end.ended === 0, `ANA@Example.test: "${r1.end.past}"; "Ana Fake" <other@example.test>: "${r2.end.past}"`);
  }
  // Edge 3
  {
    const r = await run(() => ctl("add", M, [T("ben.fake@example.test", { daysAgo: 425 }), T("ben.fake@example.test", { daysAgo: 30 }), { from: M, to: "ben.fake@example.test", subject: "Re", daysAgo: 29 }]));
    const n = Number(q(`select count(*) from email_messages m join gmail_connections c on c.id=m.connection_id where c.user_id=${uid(M)}`));
    R("Edge case 3", r.end.ended === 1 && n === 2, `"${r.end.past}"; messages stored ${n}`);
  }
  // Edge 4
  {
    const r = await run(() => ctl("add", M, [T("ben.fake@example.test", { daysAgo: 425 }), T("sam.fake@barnacle.ai", { daysAgo: 30, cc: "team.fake@barnacle.ai" })]));
    R("Edge case 4", r.end.ended === 0, `"${r.end.past}"`);
  }
  // Edge 5: 11 months 29 days / 12 months 2 days before the press (calendar, UTC)
  {
    const at = (months, days) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - months); d.setUTCDate(d.getUTCDate() - days); return d.toISOString(); };
    const r1 = await run(() => ctl("add", M, [T("ben.fake@example.test", { isoDate: at(11, 29) })]));
    const r2 = await run(() => ctl("add", M, [T("ben.fake@example.test", { isoDate: at(12, 2) })]));
    R("Edge case 5", r1.end.ended === 1 && r2.end.ended === 0, `${at(11, 29)}: "${r1.end.past}"; ${at(12, 2)}: "${r2.end.past}"`);
  }
  // Edge 6: the test email
  {
    fresh(M);
    await mp.goto(BASE + "/settings");
    await Promise.all([mp.waitForLoadState("networkidle"), mp.click("text=[ SEND ME A TEST EMAIL ]")]);
    const boxN = ctl("box", M).length;
    await press(mp);
    const w = await watch(mobs);
    R("Edge case 6", boxN >= 1 && w.end.ended === 0, `test email in the fake mailbox (${boxN} message(s)); "${w.end.past}"`);
  }
  // US3 3: live sync copied a reply in a 3-month-old conversation
  {
    fresh(M);
    const t = ctl("add", M, [T("ben.fake@example.test", { daysAgo: 90, subject: "Q3" }), { from: M, to: "ben.fake@example.test", subject: "Re: Q3", daysAgo: 89 }]);
    // the reply comes in now, delivered with its notice: the live sync copies it
    const reply = ctl("add", M, []); // no-op guard
    await mp.goto(BASE + "/dev/fake-gmail?user=" + encodeURIComponent(M));
    await mp.selectOption('select[name="direction"]', "received");
    await mp.fill('input[name="from"]', "ben.fake@example.test");
    await mp.fill('input[name="subject"]', "Re: Q3 reply");
    await mp.selectOption('select[name="thread"]', t.threadId);
    await Promise.all([mp.waitForURL(/done=/), mp.click("text=[ PUT IN THE MAILBOX ]")]);
    const before = await card(mobs);
    await press(mp);
    const w = await watch(mobs);
    const msgs = q(`select m.gmail_message_id, count(*) over (partition by m.gmail_message_id) from email_messages m join email_threads th on th.id=m.thread_id where th.gmail_thread_id='${t.threadId}' and m.connection_id=${conn(M)}`).split("\n");
    R("US3 scenario 3", before.total === 1 && w.end.ended === 0 && w.end.total === 1 && msgs.length === 3 && msgs.every((x) => x.endsWith("|1")),
      `total before ${before.total} (live sync copied the reply); end "${w.end.past}", total ${w.end.total}; thread messages ${JSON.stringify(msgs)}`);
    void reply;
  }
  // US3 4: during a running fetch, a new message in a past conversation is copied by the live sync
  {
    fresh(M);
    const t = ctl("add", M, [T("ben.fake@example.test", { daysAgo: 30, subject: "During" })]);
    ctl("add", M, [T("ana.fake@example.test", { daysAgo: 60, subject: "Other" })]);
    const before = await card(mobs);
    await press(mobs); // running, no runner
    await mp.goto(BASE + "/dev/fake-gmail?user=" + encodeURIComponent(M));
    await mp.fill('input[name="from"]', "ben.fake@example.test");
    await mp.fill('input[name="subject"]', "Re: During");
    await mp.selectOption('select[name="thread"]', t.threadId);
    await Promise.all([mp.waitForURL(/done=/), mp.click("text=[ PUT IN THE MAILBOX ]")]);
    const mid = await card(mobs);
    await runCheck(mp, M); // the fetch carries on in the check
    let n = 0; while (n < 5 && !fetchRow(M).startsWith("ended")) { await runCheck(mp, M); n++; }
    const end = await card(mobs);
    const once = q(`select count(*), count(distinct gmail_message_id) from email_messages where connection_id=${conn(M)} and subject='Re: During'`);
    R("US3 scenario 4", before.total === 0 && mid.total === 1 && end.total === 2 && end.ended === 1 && once === "1|1" && dupes(M) === 0,
      `total before ${before.total}, after the live sync ${mid.total} (fetch running: ${mid.progress !== null}), at the end ${end.total}; "${end.past}"; reply stored ${once}`);
  }
  // US3 5: two tabs at once, then the request posted again while running (JS-free tabs: no runner moves the fetch)
  {
    fresh(M, { box: false });
    const t2 = await ctx(browser, M, { js: false });
    await mobs.goto(BASE + "/settings");
    await t2.goto(BASE + "/settings");
    const form = (p) => p.locator("form", { has: p.locator("button", { hasText: "[ FETCH PAST EMAILS ]" }) }).evaluate((f) => [...new FormData(f).entries()]);
    const multipart = Object.fromEntries((await form(mobs)).map(([k, v]) => [k, String(v)]));
    await Promise.all([mobs.locator("button", { hasText: "[ FETCH PAST EMAILS ]" }).click(), t2.locator("button", { hasText: "[ FETCH PAST EMAILS ]" }).click()]);
    await mobs.waitForLoadState("networkidle"); await t2.waitForLoadState("networkidle");
    const r1 = fetchRow(M);
    const rows1 = q(`select count(*) from past_email_fetches where connection_id=${conn(M)}`);
    q(`update past_email_fetches set copied = 7 where connection_id=${conn(M)}`); // a number so far, to see it kept
    const st = (await mobs.request.post(BASE + "/settings", { multipart })).status();
    const r2 = fetchRow(M);
    const c = await card(t2);
    R("US3 scenario 5", rows1 === "1" && r1.startsWith("running") && r2.startsWith("running|7|") && r2.split("|")[3] === r1.split("|")[3] && c.progress === 7 && !c.button,
      `two tabs pressed at once → ${rows1} fetch (${r1}); the request posted again while running (HTTP ${st}) → ${r2} (started_at ${r2.split("|")[3] === r1.split("|")[3] ? "unchanged" : "CHANGED"}); card "${c.past}"`);
    await t2.context().close();
    q(`update past_email_fetches set copied = 0 where connection_id=${conn(M)}`);
    let n = 0; while (n < 5 && !fetchRow(M).startsWith("ended")) { await runCheck(mp, M); n++; }
  }
  // Edge 7: Ada and Margaret, the same conversation
  {
    fresh(M);
    const ap = await ctx(browser, A);
    const aobs = await ctx(browser, A, { js: false });
    ctl("clear", A);
    q(`delete from past_email_fetches where connection_id=${conn(A)}`);
    const msg = { from: "ana.fake@example.test", to: A, cc: M, subject: "Shared fake", daysAgo: 15 };
    ctl("add", A, [msg]);
    ctl("add", M, [msg]);
    const aBefore = await card(aobs);
    const mBefore = await card(mobs);
    await press(ap);
    const wa = await watch(aobs);
    const mMid = await card(mobs);
    await press(mp);
    const wm = await watch(mobs);
    R("Edge case 7", wa.end.ended === 1 && wm.end.ended === 1 && mMid.all === mBefore.all && wa.end.total === aBefore.total + 1,
      `Ada: "${wa.end.past}" (total ${aBefore.total}→${wa.end.total}); Margaret's card unchanged after Ada's fetch: ${mMid.all === mBefore.all}; Margaret: "${wm.end.past}"`);
    await ap.context().close(); await aobs.context().close();
  }
  // Edge 8: 100 conversations to copy (plus 60 pads: more than one part of 100 threads)
  {
    fresh(M);
    for (let i = 0; i < 100; i++) ctl("add", M, [T(i % 2 ? "ben.fake@example.test" : "ana.home@example.test", { daysAgo: 1 + i * 3, subject: `Big ${i}` })]);
    ctl("pad", M, "60");
    await press(mp);
    const w = await watch(mobs);
    const nums = [...new Set(w.seen.map((s) => s.n))];
    R("Edge case 8", monotonic(w.seen) && w.end.ended === 100 && nums.length >= 2 && monotonic(S.__us1seen || []),
      `numbers seen ${nums.join(",")}, never lower ${monotonic(w.seen)}; end "${w.end.past}" (parts are 100 threads in the app; 10 only in the automated tests)`);
  }
  // Edge 9: not connected (Alan), needs reconnecting (Margaret), Gmail not set up (:3003)
  {
    // the action's form fields from a JS-free page that shows the button
    fresh(M);
    await mobs.goto(BASE + "/settings");
    const fields = await mobs.locator("form", { has: mobs.locator("button", { hasText: "[ FETCH PAST EMAILS ]" }) }).evaluate((f) => [...new FormData(f).entries()]);
    const multipart = Object.fromEntries(fields.map(([k, v]) => [k, String(v)]));
    const post = async (p, base = BASE) => (await p.request.post(base + "/settings", { multipart })).status();
    const res = [];
    const alp = await ctx(browser, AL, { js: false });
    const a0 = await card(alp);
    const s1 = await post(alp);
    const a1 = await card(alp);
    res.push(`not connected: button ${a0.button}, POST ${s1}, rows ${q(`select count(*) from past_email_fetches f join gmail_connections c on c.id=f.connection_id where c.user_id=${uid(AL)}`)}, unchanged ${a0.all === a1.all}`);
    const fp = await ctx(browser, M);
    await fakeBtn(fp, M, "[ REFUSE THE KEY ]");
    await runCheck(fp, M);
    const m0 = await card(mobs);
    const s2 = await post(mobs);
    const m1 = await card(mobs);
    const mrow = fetchRow(M);
    res.push(`needs reconnecting: ${m0.all.includes("needs reconnecting")}, button ${m0.button}, POST ${s2}, row "${mrow}", unchanged ${m0.all === m1.all}`);
    let off = "not run (:3003 down)";
    let offOk = false;
    try {
      const gp = await ctx(browser, "grace@barnacle.ai", { js: false, base: "http://localhost:3003" });
      const g0 = await card(gp, { base: "http://localhost:3003" });
      const s3 = await post(gp, "http://localhost:3003");
      const g1 = await card(gp, { base: "http://localhost:3003" });
      off = `Gmail not set up: "${g0.all}", button ${g0.button}, POST ${s3}, unchanged ${g0.all === g1.all}`;
      offOk = !g0.button && g0.all === g1.all && g1.progress === null;
    } catch (e) { off += " " + e.message; }
    res.push(off);
    R("Edge case 9", !a0.button && a0.all === a1.all && !m0.button && m0.all === m1.all && mrow === "" && m1.progress === null && offOk, res.join("; "));
    await connect(fp, { reconnect: true });
    await fp.context().close();
  }
  await browser.close();
  console.log(JSON.stringify(Object.fromEntries(Object.entries(S).filter(([k]) => !k.startsWith("__")).map(([k, v]) => [k, v.ok]))));
})().catch((e) => { console.error(e); process.exit(1); });
