// SF-121 AI review: unsubscribe page, one-click, teammate Consent edits. Fresh seed first
// (bash .factory/run/reset-db.sh), app on :3000 (start-app.sh). Run from the repo root:
//   NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf121.js [scenario-prefix…]
// Edge 8 stops and restarts Postgres (pg_ctl -D /tmp/pgdata). Edge 10 and US5 1 (https) need a second server:
//   APP_ENV=production … see test-env.md § SF-121.
const { chromium, check, signIn, results } = require("./lib.js");
const { execSync } = require("child_process");
const B = process.env.BASE || "http://localhost:3000";
const PG = "/usr/lib/postgresql/17/bin";
const q = (s) => execSync(`${PG}/psql -h localhost -U postgres -d crm_dev -Atc ${JSON.stringify(s)}`).toString().trim();
const tok = (id) => q(`select unsubscribe_token from persons where id=${id}`);
const consent = (id) => q(`select consent from persons where id=${id}`);
const snapshot = () => q(`select string_agg(id||':'||consent, ',' order by id) from persons`);
const LINK = "Unsubscribed from campaigns through the unsubscribe link";
const MAIL = "Unsubscribed from campaigns through their mail app";
const DONE = "You're unsubscribed. You won't get any more campaign emails from us.";
const BAD = "This unsubscribe link isn't valid any more. If you still get emails from us, reply to one and ask to be removed.";
const ERR = "Something went wrong. Try again in a minute.";
const count = (t, s) => t.split(s).length - 1;
const ONLY = process.argv.slice(2);
const want = (n) => ONLY.length === 0 || ONLY.some((o) => n.startsWith(o));
const oneClick = (t, body = "List-Unsubscribe=One-Click", ct = "application/x-www-form-urlencoded") =>
  fetch(`${B}/unsubscribe/${t}/one-click`, { method: "POST", headers: ct ? { "content-type": ct } : {}, body, redirect: "manual" });

async function personPage(p, id) {
  await p.goto(`${B}/people/${id}`); await p.waitForLoadState("networkidle");
  const body = (await p.textContent("body")) || "";
  const m = body.match(/Consent\s*(Subscribed|Unsubscribed)/);
  const lines = await p.locator("li.ent").allInnerTexts();
  return { body, consent: m ? m[1] : null, lines, status: p.url() };
}
async function unsubPage(p, t, extra = "") {
  const r = await p.goto(`${B}/unsubscribe/${t}${extra}`); await p.waitForLoadState("networkidle");
  // body: the text a person sees; html: the rendered DOM without Next.js's <script> router payload (which carries the
  // address, as on every Next page, and is never shown).
  return { status: r.status(), url: p.url(), body: await p.locator("body").innerText(), html: await p.evaluate(() => { const c = document.documentElement.cloneNode(true); c.querySelectorAll("script").forEach((s) => s.remove()); return c.outerHTML; }),
    buttons: await p.locator("button").count(), unsubBtn: await p.locator('button:has-text("[ UNSUBSCRIBE ]")').count(),
    hrefs: await p.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href"))),
    notice: (await p.locator(".notice").allInnerTexts()).join("|"), err: (await p.locator(".err").allInnerTexts()).join("|"),
    h1: (await p.locator("h1").allInnerTexts()).join("|"), aside: await p.locator("aside, nav").count() };
}
async function press(p) { await Promise.all([p.waitForNavigation(), p.click('button:has-text("[ UNSUBSCRIBE ]")')]); await p.waitForLoadState("networkidle"); }
async function unread(p) { await p.goto(`${B}/notifications`); await p.waitForLoadState("networkidle"); return { cnt: (await p.locator(".cnt").allInnerTexts()).join(","), list: (await p.locator("main").innerText()) }; }

(async () => {
  const browser = await chromium.launch();
  const anonCtx = await browser.newContext(); const anon = await anonCtx.newPage();
  const ada = await (await browser.newContext()).newPage(); await signIn(ada, B, "ada@barnacle.ai", "Ada Fake");
  const linus = await (await browser.newContext()).newPage(); await signIn(linus, B, "linus@barnacle.ai", "Linus Fake");
  const grace = await (await browser.newContext()).newPage(); await signIn(grace, B, "grace@barnacle.ai", "Grace Fake");

  // US1 1, 3, 4, Edge 1: Abe Example (1, Ada's, two emails), a GET only.
  if (["US1", "Edge case 1", "US4", "US3 scenario 3"].some(want)) {
    const t = tok(1); const emails = q(`select string_agg(email, ',') from person_emails where person_id=1`).split(",");
    const u = await unsubPage(anon, t);
    const pp = await personPage(ada, 1);
    check("US1 scenario 1", !u.url.includes("sign-in") && u.status === 200 && u.h1 === "Unsubscribe" && u.body.includes("Stop receiving campaign emails from Barnacle Labs.") && u.unsubBtn === 1 && u.body.includes("// EMAIL PREFERENCES") && pp.consent === "Subscribed",
      `url ${u.url} status ${u.status} h1 ${u.h1} button ${u.unsubBtn}; Abe's page Consent ${pp.consent}`);
    const lines = pp.lines.filter((l) => l.includes(LINK) || l.includes(MAIL)).length;
    check("US1 scenario 3", pp.consent === "Subscribed" && lines === 0 && consent(1) === "subscribed", `after GET: Consent ${pp.consent}, unsubscribe lines ${lines}`);
    check("Edge case 1", pp.consent === "Subscribed" && lines === 0, `plain page load: Consent ${pp.consent}, unsubscribe lines ${lines}`);
    const leaks = ["Abe", "Example", "Ada", ...emails].filter((s) => u.html.includes(s));
    const appHrefs = u.hrefs.filter((h) => h && !h.startsWith("#"));
    check("US1 scenario 4", leaks.length === 0 && appHrefs.length === 0 && u.aside === 0, `leaks [${leaks}] hrefs [${u.hrefs}] nav/aside ${u.aside}`);
    // US4 1 "before" state
    const re = /subscribe again|resubscribe|re-subscribe|\[ SUBSCRIBE/i;
    globalThis.us4before = !re.test(u.body) && u.buttons === 1 && appHrefs.length === 0;
  }

  if (want("US1 scenario 2") || want("US4") || want("US3 scenario 3")) {
    const before = await unread(ada);
    await unsubPage(anon, tok(1)); await press(anon);
    const after = { body: (await anon.textContent("body")) || "", notice: (await anon.locator(".notice").allInnerTexts()).join("|"), btn: await anon.locator("button").count() };
    const pp = await personPage(ada, 1);
    const ls = pp.lines.filter((l) => l.includes(LINK));
    const tags = await ada.locator("li.ent", { hasText: LINK }).first().innerText().catch(() => "");
    const nowU = await unread(ada);
    check("US1 scenario 2", after.notice === DONE && after.btn === 0 && pp.consent === "Unsubscribed" && ls.length === 1 && !/ by /.test(ls[0] || "x by ") && /CHANGE/.test(tags) && /\d{1,2}:\d{2}/.test(tags) && before.cnt === nowU.cnt && before.list === nowU.list,
      `notice "${after.notice}" buttons ${after.btn}; Consent ${pp.consent}; line "${(ls[0] || "").replace(/\s+/g, " ")}"; unread ${before.cnt}→${nowU.cnt}, notifications page same ${before.list === nowU.list}`);
    // US4 1 done state + US3 3 reopen
    const d = await unsubPage(anon, tok(1));
    globalThis.us4done = !/subscribe again|resubscribe|\[ SUBSCRIBE/i.test(d.body) && d.buttons === 0 && d.hrefs.length === 0;
    globalThis.abeDone = d;
  }

  if (want("US1 scenario 5")) {
    const u = await unsubPage(linus, tok(2)); await press(linus);
    const n = (await linus.locator(".notice").allInnerTexts()).join("|");
    const pp = await personPage(grace, 2); // Bob, Grace's
    const ls = pp.lines.filter((l) => l.includes(LINK));
    const linusConsent = q(`select count(*) from persons where consent='unsubscribed' and id=2`);
    check("US1 scenario 5", u.unsubBtn === 1 && n === DONE && pp.consent === "Unsubscribed" && ls.length === 1 && !/Linus|Grace|Fake/.test(ls[0]) && linusConsent === "1",
      `signed-in Linus pressed on Bob's link: "${n}"; Bob Consent ${pp.consent}; line "${(ls[0] || "").replace(/\s+/g, " ")}"`);
  }

  if (want("US2")) {
    const s0 = snapshot();
    const r = await oneClick(tok(3));
    const pp = await personPage(linus, 3);
    const ls = pp.lines.filter((l) => l.includes(MAIL));
    const tags = ls[0] || "";
    check("US2 scenario 1", r.status === 200 && pp.consent === "Unsubscribed" && ls.length === 1 && /CHANGE/.test(tags) && !/ by /.test(tags),
      `POST one-click (no cookie) → ${r.status} "${await r.text()}"; Cleo Consent ${pp.consent}; lines ${ls.length} "${tags.replace(/\s+/g, " ")}"`);
    const s1 = snapshot();
    const a = await oneClick(tok(4), ""); const b2 = await oneClick(tok(4), "foo=bar"); const c = await oneClick(tok(4), "List-Unsubscribe=Other");
    const pp4 = await personPage(margaretPage = margaretPage || ada, 4);
    const dev = q(`select count(*) from timeline_events where person_id=4 and kind in ('unsubscribed_link','unsubscribed_mail_app')`);
    check("US2 scenario 2", a.status === 400 && b2.status === 400 && c.status === 400 && consent(4) === "subscribed" && dev === "0" && snapshot() === s1,
      `empty body ${a.status}, foo=bar ${b2.status}, wrong value ${c.status}; Dev consent ${consent(4)}, lines ${dev}`);
    // US2 3: unknown, changed, deleted
    const unknown = "0".repeat(64); const t5 = tok(6); const changed = t5.slice(0, 10) + (t5[10] === "a" ? "b" : "a") + t5.slice(11);
    const del = await deleteTemp(ada);
    const r1 = await oneClick(unknown), r2 = await oneClick(changed), r3 = await oneClick(del.token), r4 = await oneClick("abc");
    const bodies = [await r1.text(), await r2.text(), await r3.text(), await r4.text()];
    check("US2 scenario 3", [r1, r2, r3, r4].every((x) => x.status === 404) && new Set(bodies).size === 1 && snapshot() === s1,
      `unknown ${r1.status}, changed ${r2.status}, deleted ${r3.status}, short ${r4.status}; bodies ${JSON.stringify([...new Set(bodies)])}`);
    globalThis.deleted = del;
  }

  if (want("US3 scenario 1")) {
    const rows = async () => { await anon.goto(`${B}/dev/unsubscribe-links`); await anon.waitForLoadState("networkidle");
      return anon.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent))); };
    const r1 = await rows();
    const gail = r1.find((r) => r[0] === "Gail Mockup"), hugo = r1.find((r) => r[0] === "Hugo Lorem");
    const gEmail = q(`select email from person_emails where person_id=7 limit 1`), hEmail = q(`select email from person_emails where person_id=8 limit 1`);
    const contains = (l, id, first, last, email) => new RegExp(`/${id}(/|$)`).test(l) || l.includes(first) || l.includes(last) || l.includes(email) || l.includes(email.split("@")[0]);
    const r2 = await rows(); const gail2 = r2.find((r) => r[0] === "Gail Mockup");
    const s0 = snapshot();
    await unsubPage(anon, gail2[1].split("/unsubscribe/")[1]); await press(anon);
    const s1 = snapshot();
    const diff = s1.split(",").filter((x, i) => x !== s0.split(",")[i]);
    check("US3 scenario 1", gail[1] !== hugo[1] && !contains(gail[1], 7, "Gail", "Mockup", gEmail) && !contains(hugo[1], 8, "Hugo", "Lorem", hEmail) && gail2[1] === gail[1] && diff.join() === "7:unsubscribed",
      `Gail ${gail[1]} / Hugo ${hugo[1]}; after reload same ${gail2[1] === gail[1]}; changed consents [${diff}]`);
  }

  if (want("US3 scenario 2") || want("Edge case 6") || want("US4")) {
    const t = tok(9); const s0 = snapshot();
    const variants = { changed: t.slice(0, 63) + (t[63] === "0" ? "1" : "0"), added: t + "a", removed: t.slice(0, 63), cut: t.slice(0, 40), extra: t + "%3E", upper: t.toUpperCase() };
    const out = {};
    for (const [k, v] of Object.entries(variants)) { const u = await unsubPage(anon, v); out[k] = u; }
    const ok = Object.values(out).every((u) => u.err === BAD && u.unsubBtn === 0 && u.buttons === 0);
    check("US3 scenario 2", ok && snapshot() === s0, Object.entries(out).map(([k, u]) => `${k}: err="${u.err.slice(0, 30)}…" buttons ${u.buttons}`).join("; ") + `; consents unchanged ${snapshot() === s0}`);
    check("Edge case 6", out.cut.err === BAD && out.extra.err === BAD && out.added.err === BAD && out.cut.buttons === 0 && snapshot() === s0, `cut short: "${out.cut.err}"; extra chars: "${out.extra.err}"; consents unchanged`);
    globalThis.badBody = out.changed; globalThis.us4bad = !/subscribe again|resubscribe|\[ SUBSCRIBE/i.test(out.changed.body) && out.changed.buttons === 0 && out.changed.hrefs.length === 0;
  }

  if (want("US3 scenario 3")) {
    // Finn (6): two pages opened before; press on the first, then the second; plus a second one-click for Cleo (3).
    const p2 = await anonCtx.newPage();
    await unsubPage(anon, tok(6)); await unsubPage(p2, tok(6));
    await press(anon); await press(p2);
    const n2 = (await p2.locator(".notice").allInnerTexts()).join("|");
    const reopen = await unsubPage(anon, tok(6));
    const r = await oneClick(tok(3));
    const finn = await personPage(grace, 6); const cleo = await personPage(linus, 3);
    const fl = finn.lines.filter((l) => l.includes(LINK)).length, cl = cleo.lines.filter((l) => l.includes(MAIL) || l.includes(LINK)).length;
    check("US3 scenario 3", reopen.notice === DONE && reopen.unsubBtn === 0 && n2 === DONE && r.status === 200 && finn.consent === "Unsubscribed" && fl === 1 && cleo.consent === "Unsubscribed" && cl === 1,
      `reopened: "${reopen.notice}", buttons ${reopen.unsubBtn}; old page pressed: "${n2}"; 2nd one-click ${r.status}; Finn ${finn.consent} lines ${fl}; Cleo ${cleo.consent} lines ${cl}`);
    await p2.close();
  }

  if (want("US3 scenario 4")) {
    const del = globalThis.deleted || (await deleteTemp(ada));
    const u = await unsubPage(anon, del.token); const ch = globalThis.badBody || (await unsubPage(anon, "f".repeat(64)));
    const r = await oneClick(del.token);
    check("US3 scenario 4", u.body === ch.body && u.err === BAD && u.buttons === 0 && !u.html.includes("Tempdel") && r.status === 404,
      `deleted person's page same text as a changed link: ${u.body === ch.body}; err "${u.err.slice(0, 40)}…"; name shown ${u.html.includes("Tempdel")}; one-click ${r.status}`);
  }

  if (want("US3 scenario 5")) {
    // Fay Mockup (31): archived, Linus's. Pat Privatefake (33): private, created by Ada, owned by Linus.
    await unsubPage(anon, tok(31)); await press(anon); const n1 = (await anon.locator(".notice").allInnerTexts()).join("|");
    await unsubPage(anon, tok(33)); await press(anon); const n2 = (await anon.locator(".notice").allInnerTexts()).join("|");
    const fay = await personPage(linus, 31), patA = await personPage(ada, 33), patL = await personPage(linus, 33);
    const g = await grace.goto(`${B}/people/33`); const gb = (await grace.textContent("body")) || "";
    check("US3 scenario 5", n1 === DONE && n2 === DONE && fay.consent === "Unsubscribed" && fay.lines.some((l) => l.includes(LINK)) && patA.consent === "Unsubscribed" && patA.lines.some((l) => l.includes(LINK)) && patL.lines.some((l) => l.includes(LINK)) && !gb.includes("Privatefake") && !gb.includes(LINK),
      `Fay(archived) "${n1}", Linus sees ${fay.consent} + line; Pat(private) "${n2}", Ada sees ${patA.consent}, Linus line ${patL.lines.some((l) => l.includes(LINK))}; Grace gets ${g.status()} name shown ${gb.includes("Privatefake")}`);
  }

  if (want("US4")) {
    check("US4 scenario 1", globalThis.us4before && globalThis.us4done && globalThis.us4bad, `before ${globalThis.us4before}, done ${globalThis.us4done}, not valid ${globalThis.us4bad}: no subscribe-again button or link`);
    // US4 2: Abe (1) unsubscribed above; Ada sets Subscribed.
    await ada.goto(`${B}/people/1/edit`); await ada.waitForLoadState("networkidle");
    await ada.check('input[name="consent"][value="subscribed"]');
    await Promise.all([ada.waitForURL(/\/people\/1$/), ada.click('button:has-text("[ SAVE ]")')]);
    let pp = await personPage(ada, 1);
    const cl = pp.lines.filter((l) => l.includes("Consent: Unsubscribed → Subscribed"));
    check("US4 scenario 2", pp.consent === "Subscribed" && cl.length === 1 && cl[0].includes("by Ada Fake"), `Consent ${pp.consent}; line "${(cl[0] || "").replace(/\s+/g, " ")}"`);
    // US4 3
    const u = await unsubPage(anon, tok(1)); await press(anon);
    pp = await personPage(ada, 1);
    const n = pp.lines.filter((l) => l.includes(LINK)).length;
    check("US4 scenario 3", u.unsubBtn === 1 && pp.consent === "Unsubscribed" && n === 2, `button shown ${u.unsubBtn}; Consent ${pp.consent}; unsubscribe lines ${n}`);
  }

  if (want("US4 scenario 4") || want("Edge case 3")) {
    for (const [name, id] of [["US4 scenario 4", 9], ["Edge case 3", 17]]) {
      if (!want(name)) continue;
      await ada.goto(`${B}/people/${id}/edit`); await ada.waitForLoadState("networkidle");
      await unsubPage(anon, tok(id)); await press(anon);
      await ada.fill('input[name="role"]', `Fake role ${id}`);
      await Promise.all([ada.waitForURL(new RegExp(`/people/${id}$`)), ada.click('button:has-text("[ SAVE ]")')]);
      const pp = await personPage(ada, id);
      const ed = pp.lines.filter((l) => /Edited by Ada Fake: Role/.test(l)).length, cl = pp.lines.filter((l) => l.includes("Consent:")).length, ul = pp.lines.filter((l) => l.includes(LINK)).length;
      check(name, pp.body.includes(`Fake role ${id}`) && pp.consent === "Unsubscribed" && ed === 1 && cl === 0 && ul === 1, `Role shown ${pp.body.includes(`Fake role ${id}`)}; Consent ${pp.consent}; "Edited by Ada Fake: Role" ${ed}; consent lines ${cl}; unsubscribe lines ${ul}`);
    }
  }

  if (want("US4 scenario 5")) {
    // Eve Dummy (5): unsubscribed in the seed, Ada's.
    await ada.goto(`${B}/people/5/edit`); await ada.waitForLoadState("networkidle");
    const checked = await ada.locator('input[name="consent"][value="unsubscribed"]').isChecked();
    await ada.fill('input[name="role"]', "Fake role 5");
    await Promise.all([ada.waitForURL(/\/people\/5$/), ada.click('button:has-text("[ SAVE ]")')]);
    const pp = await personPage(ada, 5); const cl = pp.lines.filter((l) => l.includes("Consent")).length;
    check("US4 scenario 5", checked && pp.consent === "Unsubscribed" && cl === 0 && pp.body.includes("Fake role 5"), `form showed Unsubscribed ${checked}; Consent ${pp.consent}; consent lines ${cl}`);
  }

  if (want("US5")) {
    await anon.goto(`${B}/dev/unsubscribe-links`); await anon.waitForLoadState("networkidle");
    const rows = await anon.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent)));
    const nPersons = Number(q("select count(*) from persons"));
    const kara = rows.find((r) => r[0] === "Kara Testperson"), leo = rows.find((r) => r[0] === "Leo Sample");
    const shape = (r) => r[1].startsWith(B + "/unsubscribe/") && r[2] === `<${r[1]}/one-click>` && r[3] === "List-Unsubscribe=One-Click";
    check("US5 scenario 1", rows.length === nPersons && rows.every(shape), `${rows.length} rows (${nPersons} people); e.g. ${JSON.stringify(kara)}; https in production: see the :3002 check`);
    const s0 = snapshot();
    await anon.goto(kara[1]); await anon.waitForLoadState("networkidle"); await press(anon);
    const r = await fetch(leo[2].slice(1, -1), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: leo[3] });
    const diff = snapshot().split(",").filter((x, i) => x !== s0.split(",")[i]);
    const k = await personPage(linus, 11), l = await personPage(margaretPage || ada, 12);
    check("US5 scenario 2", r.status === 200 && diff.join() === "11:unsubscribed,12:unsubscribed" && k.consent === "Unsubscribed", `page link → Kara ${k.consent}; header address → ${r.status}; changed consents [${diff}]`);
  }

  if (want("Edge case 2")) {
    const p2 = await anonCtx.newPage();
    await unsubPage(anon, tok(13)); await unsubPage(p2, tok(13));
    await Promise.all([press(anon), press(p2)]);
    const a = (await anon.locator(".notice").allInnerTexts()).join("|"), b2 = (await p2.locator(".notice").allInnerTexts()).join("|");
    const pp = await personPage(ada, 13); const n = pp.lines.filter((l) => l.includes(LINK)).length;
    check("Edge case 2", a === DONE && b2 === DONE && n === 1 && pp.consent === "Unsubscribed", `tab1 "${a}", tab2 "${b2}"; lines ${n}`);
    await p2.close();
  }

  if (want("Edge case 4")) {
    // Rae Placeholder (18, Grace's)
    await grace.goto(`${B}/people/18/edit`); await grace.waitForLoadState("networkidle");
    await unsubPage(anon, tok(18)); await press(anon);
    await grace.fill('input[name="firstName"]', ""); await grace.fill('input[name="lastName"]', "");
    await grace.click('button:has-text("[ SAVE ]")'); await grace.waitForTimeout(1500); await grace.waitForLoadState("networkidle");
    const refused = /\/edit/.test(grace.url()) && (await grace.locator(".err, [role=alert]").count()) > 0;
    const shownAfter = await grace.locator('input[name="consentShown"]').getAttribute("value");
    await grace.fill('input[name="firstName"]', "Rae"); await grace.fill('input[name="lastName"]', "Placeholder");
    await Promise.all([grace.waitForURL(/\/people\/18$/), grace.click('button:has-text("[ SAVE ]")')]);
    const pp = await personPage(grace, 18); const cl = pp.lines.filter((l) => l.includes("Consent")).length;
    check("Edge case 4", refused && pp.consent === "Unsubscribed" && cl === 0, `refused first ${refused} (consentShown after refusal "${shownAfter}"); Consent ${pp.consent}; consent lines ${cl}`);
  }

  if (want("Edge case 5")) {
    const emails = q(`select count(*) from person_emails where person_id=21`);
    const r = await oneClick(tok(21)); const pp = await personPage(ada, 21);
    check("Edge case 5", emails === "2" && r.status === 200 && pp.consent === "Unsubscribed", `Uma has ${emails} emails; one-click ${r.status}; Consent ${pp.consent}`);
  }

  if (want("Edge case 7")) {
    const marks = ["EVILNEXT123", "EVILMSG456", "EVILERR789"];
    const u1 = await unsubPage(anon, tok(22), `?next=${marks[0]}&message=${marks[1]}&error=${marks[2]}`);
    const u2 = await unsubPage(anon, "z" + marks[0], `?message=${marks[1]}`);
    const u3 = await unsubPage(anon, tok(1), `?message=${marks[1]}&notice=${marks[0]}`);
    const leak = [u1, u3].some((u) => marks.some((m) => u.html.includes(m))) || [marks[1]].some((m) => u2.html.includes(m));
    const leak2 = u2.html.includes("zEVILNEXT123") ? "token echoed in html of invalid page" : "";
    check("Edge case 7", !leak && consent(22) === "subscribed", `marks in ready/done/invalid pages: ${leak}; ${leak2 || "invalid token not echoed"}`);
  }

  if (want("Edge case 8")) {
    const t = tok(22); await unsubPage(anon, t);
    execSync(`${PG}/pg_ctl -D /tmp/pgdata -m fast stop`, { stdio: "ignore" });
    let a = "", rs = 0;
    try { await press(anon); a = (await anon.locator(".err").allInnerTexts()).join("|"); const r = await oneClick(t); rs = r.status; }
    finally { execSync(`${PG}/pg_ctl -D /tmp/pgdata -o "-k /tmp -c listen_addresses=localhost" -l /tmp/pg.log start`, { stdio: "ignore" }); execSync("sleep 3"); }
    const btn = await anon.locator('button:has-text("[ UNSUBSCRIBE ]")').count();
    const pp = await personPage(grace, 22);
    check("Edge case 8", a.includes(ERR) && rs >= 500 && rs < 600 && pp.consent === "Subscribed", `button press with DB down: "${a}" (url ${anon.url().replace(/[0-9a-f]{64}/, "<tok>")}, button still ${btn}); one-click ${rs}; after restart Vic ${pp.consent}`);
  }

  if (want("Edge case 9")) {
    const t = tok(23);
    const a = await unsubPage(anon, t), l = await unsubPage(linus, t);
    const cookies = (await linus.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const r = await fetch(`${B}/unsubscribe/${t}/one-click`, { method: "POST", headers: { cookie: cookies, "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click", redirect: "manual" });
    check("Edge case 9", a.body === l.body && l.aside === 0 && l.hrefs.length === 0 && r.status === 200 && consent(23) === "unsubscribed", `signed-in page same text ${a.body === l.body}, nav/aside ${l.aside}, links ${l.hrefs.length}; one-click with session cookie ${r.status}`);
  }

  console.log(JSON.stringify(results.map((r) => [r.name, r.ok])));
  await browser.close();
})();

var margaretPage = null;
async function deleteTemp(ada) {
  const id = q(`insert into persons (first_name, last_name, created_by, owner_id) values ('Tempdel','Fakeperson',1,1) returning id`).split("\n")[0];
  const token = tok(id);
  await ada.goto(`${B}/people/${id}?confirm=delete`); await ada.waitForLoadState("networkidle");
  await Promise.all([ada.waitForLoadState("networkidle"), ada.locator("button.danger-solid").click()]); await ada.waitForTimeout(800);
  const gone = q(`select count(*) from persons where id=${id}`);
  if (gone !== "0") throw new Error("temp person not deleted through the app");
  return { id, token };
}
