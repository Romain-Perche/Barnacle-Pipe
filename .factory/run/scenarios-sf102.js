// SF-102 AI-review scenarios (US1 1–8, US2 1–7, US3 1–7, US4 1–5, edge cases 1–18), against :3000/crm_dev on fresh fake
// data: `bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf102.js`
// Each scenario makes its own "SF102 …" records by SQL (setup only) and drives the app as a user would.
const { execSync } = require("child_process");
const { chromium, results, check, signIn } = require("./lib");
const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DB || "crm_dev";
const sql = (s) => execSync(`psql -h localhost -U postgres ${DB} -tA -v ON_ERROR_STOP=1`, { input: s }).toString().trim();
const U = { ada: 1, grace: 2, linus: 3, margaret: 4, alan: 5 };
const NAMES = { ada: "Ada Fake", grace: "Grace Fake", linus: "Linus Fake", margaret: "Margaret Fake" };
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
let n = 0;
function mkOrg(name, by = 1) {
  const id = sql(`insert into organisations (name, owner_id, created_by) values ('${name}', ${by}, ${by}) returning id`).split("\n")[0];
  sql(`insert into timeline_events (organisation_id, kind, actor_id) values (${id}, 'added', ${by})`);
  return +id;
}
function mkPerson(first, last, o = {}) {
  const by = o.by || 1, owner = o.owner || by;
  const id = sql(`insert into persons (first_name, last_name, owner_id, created_by, private, organisation_id) values ('${first}', '${last}', ${owner}, ${by}, ${!!o.private}, ${o.org || "null"}) returning id`).split("\n")[0];
  sql(`insert into timeline_events (person_id, kind, actor_id) values (${id}, 'added', ${by})`);
  return +id;
}
function mkDeal(title, o = {}) {
  const by = o.by || 1, owner = o.owner || by;
  const stage = sql(`select s.id from stages s join pipelines p on p.id=s.pipeline_id where p.name='Sales' and s.name='Lead in'`);
  const id = sql(`insert into deals (title, stage_id, organisation_id, person_id, owner_id, private, created_by) values ('${title}', ${stage}, ${o.org || "null"}, ${o.person || "null"}, ${owner}, ${!!o.private}, ${by}) returning id`).split("\n")[0];
  sql(`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name) values (${id}, ${stage}, 'Lead in', 'Sales')`);
  sql(`insert into timeline_events (deal_id, kind, actor_id) values (${id}, 'added', ${by})`);
  if (o.others) for (const p of o.others) sql(`insert into deal_people (deal_id, person_id, linked_by) values (${id}, ${p}, ${by})`);
  return +id;
}
// a note by SQL (setup only), optionally back-dated
function sqlNote(col, id, body, by, ago = "0 seconds") {
  return +sql(`insert into timeline_events (${col}, kind, actor_id, body, created_at) values (${id}, 'note', ${by}, '${body}', now() - interval '${ago}') returning id`).split("\n")[0];
}
const ukToday = () => new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
const ukDay = (d) => d.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

const ctxs = {};
let browser;
async function as(user) {
  if (ctxs[user]) return ctxs[user];
  const c = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await c.newPage();
  await signIn(p, BASE, `${user}@barnacle.ai`, NAMES[user]);
  return (ctxs[user] = p);
}
async function go(p, path) { await p.goto(BASE + path); await p.waitForLoadState("networkidle"); }
const tl = (p) => p.getByRole("region", { name: "Timeline" });
const ents = (p) => tl(p).locator("li.ent");
const box = (p) => p.getByRole("form", { name: "Add a note" });
async function addNote(p, text) {
  const t = box(p).getByRole("textbox", { name: "Note" });
  await t.fill(text);
  await box(p).getByRole("button", { name: "[ ADD NOTE ]" }).click();
  await p.waitForTimeout(800); await p.waitForLoadState("networkidle");
}
async function typeMention(p, letters, pick, form = box(p)) {
  const t = form.getByRole("textbox", { name: "Note" });
  await t.click(); await t.press("End");
  const cur = await t.inputValue();
  await t.pressSequentially((cur && !/\s$/.test(cur) ? " " : "") + "@" + letters, { delay: 30 });
  await p.waitForTimeout(200);
  const opts = await p.getByRole("listbox", { name: "Teammates" }).getByRole("option").allTextContents().catch(() => []);
  if (pick) { await p.getByRole("listbox", { name: "Teammates" }).getByRole("option", { name: pick }).click(); await t.pressSequentially(" ", { delay: 20 }); }
  return opts;
}
async function entryTexts(p) { return (await ents(p).allTextContents()).map(norm); }
async function sidebar(p) { return norm(await p.locator("nav a[href='/notifications']").first().textContent()); }
async function sidebarName(p) { return (await p.locator("nav a[href='/notifications']").first().getAttribute("aria-label")) || norm(await p.locator("nav a[href='/notifications']").first().textContent()); }
const unread = (u) => +sql(`select count(*) from note_mentions where user_id=${u} and user_id<>mentioned_by and read_at is null`);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
async function run(name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  try { await fn(); } catch (e) { check(name, false, "error: " + String(e.message || e).split("\n")[0]); }
}

(async () => {
  browser = await chromium.launch();
  const today = ukToday();

  await run("US1 scenario 1", async () => {
    const o = mkOrg("SF102 Org One"), pe = mkPerson("Sfone", "Person"), d = mkDeal("SF102 Deal One");
    const ada = await as("ada"); const out = [];
    for (const path of [`/deals/${d}`, `/people/${pe}`, `/organisations/${o}`]) {
      await go(ada, path);
      await addNote(ada, "Called Ada,\nwants a proposal by Friday");
      const f = ents(ada).first();
      const tag = norm(await f.locator(".kd").textContent()), body = (await f.locator(".notebody").textContent()).replace(/\r\n/g, "\n");
      const who = norm(await f.locator(".author").textContent()), when = norm(await f.locator(".when").textContent());
      const day = norm(await tl(ada).locator(".day").first().textContent());
      const val = await box(ada).getByRole("textbox", { name: "Note" }).inputValue();
      await ada.reload(); const after = (await ents(ada).first().locator(".notebody").textContent()).replace(/\r\n/g, "\n");
      const ok = tag === "NOTE" && body === "Called Ada,\nwants a proposal by Friday" && who === "Ada Fake" && /^\d\d:\d\d$/.test(when) && day === `// TODAY · ${today}` && val === "" && after === body;
      out.push(`${path}: ${ok ? "ok" : `tag=${tag} body=${JSON.stringify(body)} who=${who} when=${when} day=${day} box=${JSON.stringify(val)}`}`);
    }
    check("US1 scenario 1", out.every((s) => s.endsWith("ok")), out.join("; ") + ` (heading "// TODAY · ${today}", time HH:MM, line break kept, box empty)`);
  });

  await run("US1 scenario 2", async () => {
    const pe = mkPerson("Sftwo", "Person"); const ada = await as("ada"); await go(ada, `/people/${pe}`);
    const before = sql(`select count(*) from timeline_events where kind='note'`);
    await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(800);
    const m1 = norm(await box(ada).getByRole("alert").textContent().catch(() => ""));
    await addNote(ada, "    ");
    const m2 = norm(await box(ada).getByRole("alert").textContent().catch(() => ""));
    const after = sql(`select count(*) from timeline_events where kind='note'`);
    const msg = "Write something before adding the note.";
    check("US1 scenario 2", m1 === msg && m2 === msg && before === after, `empty: "${m1}"; spaces: "${m2}"; notes ${before}→${after}`);
  });

  await run("US1 scenario 3", async () => {
    const pe = mkPerson("Sfthree", "Person"); const ada = await as("ada"); await go(ada, `/people/${pe}`);
    const t = box(ada).getByRole("textbox", { name: "Note" });
    const max = await t.getAttribute("maxlength");
    await t.fill("x".repeat(10000)); await t.press("End"); await t.press("y"); await t.press("z");
    const typed = (await t.inputValue()).length;
    // a direct send: lift the limit in the page and send 10,001 characters
    await t.evaluate((el) => el.removeAttribute("maxlength"));
    const before = sql(`select count(*) from timeline_events where kind='note'`);
    await addNote(ada, "a".repeat(10001));
    const m = norm(await box(ada).getByRole("alert").textContent().catch(() => ""));
    const after = sql(`select count(*) from timeline_events where kind='note'`);
    check("US1 scenario 3", max === "10000" && typed === 10000 && m === "Keep the note under 10,000 characters." && before === after, `maxlength=${max}, typing past it keeps ${typed} chars; 10,001 sent → "${m}"; notes ${before}→${after}`);
  });

  await run("US1 scenario 4", async () => {
    const pe = mkPerson("Sffour", "Person");
    const linus = await as("linus"); await go(linus, `/people/${pe}`);
    await addNote(linus, "first text");
    await linus.waitForTimeout(1100); await addNote(linus, "a newer note");
    const ada = await as("ada"); await go(ada, `/people/${pe}`);
    const target = ents(ada).filter({ hasText: "first text" });
    await target.getByRole("link", { name: "Edit note" }).click(); await ada.waitForLoadState("networkidle");
    const ef = ada.getByRole("form", { name: "Edit note" });
    await ef.getByRole("textbox", { name: "Note" }).fill("not kept");
    await ef.getByRole("link", { name: "[ CANCEL ]" }).click(); await ada.waitForTimeout(800);
    const afterCancel = norm(await ents(ada).nth(1).locator(".notebody").textContent());
    await ents(ada).nth(1).getByRole("link", { name: "Edit note" }).click(); await ada.waitForLoadState("networkidle");
    await ada.getByRole("form", { name: "Edit note" }).getByRole("textbox", { name: "Note" }).fill("second text");
    await ada.getByRole("form", { name: "Edit note" }).getByRole("button", { name: "[ SAVE ]" }).click();
    await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    const texts = await entryTexts(ada);
    const second = texts[1] || "";
    const ok = afterCancel === "first text" && texts[0].includes("a newer note") && second.includes("second text") && second.includes("Linus Fake") && second.includes("edited by Ada Fake");
    check("US1 scenario 4", ok, `after [ CANCEL ]: "${afterCancel}"; after [ SAVE ]: entry 1 "${texts[0]}", entry 2 "${second}"`);
  });

  await run("US1 scenario 5", async () => {
    const o = mkOrg("SF102 Org Five"), pe = mkPerson("Sffive", "Person", { org: o }), d = mkDeal("SF102 Deal Five", { org: o, person: pe });
    const linus = await as("linus"); await go(linus, `/deals/${d}`); await addNote(linus, "Five note to delete");
    const ada = await as("ada");
    const seen = [];
    for (const path of [`/deals/${d}`, `/people/${pe}`, `/organisations/${o}`]) { await go(ada, path); seen.push((await tl(ada).textContent()).includes("Five note to delete")); }
    await go(ada, `/deals/${d}`);
    await ents(ada).filter({ hasText: "Five note to delete" }).getByRole("link", { name: "Delete note" }).click(); await ada.waitForLoadState("networkidle");
    const conf = ada.getByRole("alertdialog", { name: "Confirm note delete" });
    const ct = norm(await conf.textContent());
    await conf.getByRole("button", { name: "[ DELETE ]" }).click(); await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    const notice = norm(await ada.locator("p.notice").textContent().catch(() => ""));
    const gone = [];
    for (const path of [`/deals/${d}`, `/people/${pe}`, `/organisations/${o}`]) { await go(ada, path); gone.push(!(await tl(ada).textContent()).includes("Five note to delete")); }
    check("US1 scenario 5", seen.every(Boolean) && ct.includes("Delete this note? This can't be undone.") && notice === "Note deleted." && gone.every(Boolean), `shown on deal/person/org before: ${seen}; confirm "${ct}"; notice "${notice}"; gone from deal/person/org: ${gone}`);
  });

  await run("US1 scenario 6", async () => {
    // private deal of Ada with a note; Linus (cannot see it) posts edit/delete for that note from his own note's form
    const priv = mkDeal("SF102 Private Six", { private: true });
    const pn = sqlNote("deal_id", priv, "Secret six", U.ada);
    // a deleted record's note id
    const gd = mkDeal("SF102 Gone Six"); const gn = sqlNote("deal_id", gd, "Gone six", U.ada); sql(`delete from deals where id=${gd}`);
    const msg = "This note doesn't exist or you can't see it.";
    const pe = mkPerson("Sfsix", "Person"); const own = sqlNote("person_id", pe, "Linus own six", U.linus);
    const linus = await as("linus"); const out = [];
    for (const [label, nid, tgt, tid] of [["private, form names the hidden deal", pn, "deal", priv], ["deleted, form names the deleted deal", gn, "deal", gd], ["private, form names Linus's own visible person", pn, "person", pe]]) {
      await go(linus, `/people/${pe}?note=${own}`);
      const ef = linus.getByRole("form", { name: "Edit note" });
      await ef.evaluate((f, a) => { f.querySelector("input[name=noteId]").value = a.nid; f.querySelector("input[name=target]").value = a.tgt; f.querySelector("input[name=targetId]").value = a.tid; }, { nid, tgt, tid });
      await ef.getByRole("textbox", { name: "Note" }).fill("hacked");
      await ef.getByRole("button", { name: "[ SAVE ]" }).click(); await linus.waitForTimeout(1000);
      const m = norm(await ef.getByRole("alert").textContent().catch(() => ""));
      await go(linus, `/people/${pe}?delete-note=${own}`);
      const df = linus.getByRole("alertdialog", { name: "Confirm note delete" }).locator("form");
      await df.evaluate((f, a) => { f.querySelector("input[name=noteId]").value = a.nid; f.querySelector("input[name=target]").value = a.tgt; f.querySelector("input[name=targetId]").value = a.tid; }, { nid, tgt, tid });
      await df.getByRole("button", { name: "[ DELETE ]" }).click(); await linus.waitForURL(/error=/, { timeout: 5000 }).catch(() => {}); await linus.waitForLoadState("networkidle");
      const mt = await linus.locator("main").innerText(); const dm = (mt.includes(msg) ? msg : norm(mt).slice(0, 80)) + ` (url ${linus.url().replace(BASE, "")}; names the record: ${/SF102 (Private|Gone) Six/.test(mt)})`;
      out.push({ label, m, dm });
    }
    const body = sql(`select body from timeline_events where id=${pn}`), ownBody = sql(`select body from timeline_events where id=${own}`);
    check("US1 scenario 6", out.every((o) => o.m === msg && o.dm.includes(msg)) && body === "Secret six" && ownBody === "Linus own six", out.map((o) => `${o.label}: edit → "${o.m}", delete → "${o.dm}"`).join("; ") + `; private note body still "${body}", Linus's own note unchanged "${ownBody}"`);
  });

  await run("US1 scenario 7", async () => {
    const pe = mkPerson("Sfseven", "Person"); const nid = sqlNote("person_id", pe, "Original seven", U.ada);
    const ada = await as("ada"), linus = await as("linus");
    await go(ada, `/people/${pe}?note=${nid}`);
    await go(linus, `/people/${pe}?note=${nid}`);
    await linus.getByRole("form", { name: "Edit note" }).getByRole("textbox", { name: "Note" }).fill("Linus seven");
    await linus.getByRole("form", { name: "Edit note" }).getByRole("button", { name: "[ SAVE ]" }).click(); await linus.waitForTimeout(1000);
    const ef = ada.getByRole("form", { name: "Edit note" });
    await ef.getByRole("textbox", { name: "Note" }).fill("Ada seven"); await ef.getByRole("button", { name: "[ SAVE ]" }).click(); await ada.waitForTimeout(1000);
    const m1 = norm(await ef.getByRole("alert").textContent().catch(() => "")); const b1 = sql(`select body from timeline_events where id=${nid}`);
    // deleted case
    await go(ada, `/people/${pe}?note=${nid}`);
    sql(`delete from timeline_events where id=${nid}`); // Linus deletes it meanwhile (via the app below would also work)
    await ada.getByRole("form", { name: "Edit note" }).getByRole("textbox", { name: "Note" }).fill("Ada again");
    await ada.getByRole("form", { name: "Edit note" }).getByRole("button", { name: "[ SAVE ]" }).click(); await ada.waitForTimeout(1000);
    const m2 = norm(await ada.getByRole("form", { name: "Edit note" }).getByRole("alert").textContent().catch(() => ""));
    const cnt = sql(`select count(*) from timeline_events where person_id=${pe} and kind='note'`);
    check("US1 scenario 7", m1 === "Someone else changed this note while you were editing. Reload to see their changes." && b1 === "Linus seven" && m2 === "This note doesn't exist any more." && cnt === "0", `edited meanwhile → "${m1}", body stays "${b1}"; deleted meanwhile → "${m2}", notes left ${cnt}`);
  });

  await run("US1 scenario 8", async () => {
    const o = mkOrg("SF102 Org Eight"), pe = mkPerson("Sfeight", "Person"), d = mkDeal("SF102 Deal Eight");
    for (const [c, i] of [["organisation_id", o], ["person_id", pe], ["deal_id", d]]) sqlNote(c, i, "Eight note", U.ada);
    sql(`update organisations set archived_at=now() where id=${o}; update persons set archived_at=now() where id=${pe}; update deals set archived_at=now() where id=${d}`);
    const ada = await as("ada"); const out = [];
    const paths = [`/deals/${d}`, `/people/${pe}`, `/organisations/${o}`];
    for (const path of paths) { await go(ada, path); out.push({ shown: (await tl(ada).locator(".notebody").allTextContents()).includes("Eight note"), box: await box(ada).count(), edit: await tl(ada).getByRole("link", { name: "Edit note" }).count(), del: await tl(ada).getByRole("link", { name: "Delete note" }).count() }); }
    sql(`update organisations set archived_at=null where id=${o}; update persons set archived_at=null where id=${pe}; update deals set archived_at=null where id=${d}`);
    const back = [];
    for (const path of paths) { await go(ada, path); back.push(`${await box(ada).count()}/${await tl(ada).getByRole("link", { name: "Edit note" }).count()}/${await tl(ada).getByRole("link", { name: "Delete note" }).count()}`); }
    check("US1 scenario 8", out.every((x) => x.shown && !x.box && !x.edit && !x.del) && back.every((b) => b === "1/1/1"), `archived (deal, person, org): ${JSON.stringify(out)}; restored (by SQL) box/edit/delete: ${back}`);
  });

  await run("US2 scenario 1", async () => {
    const d = mkDeal("SF102 Deal Twoone");
    sql(`update timeline_events set created_at = now() - interval '1 day' where deal_id=${d} and kind='added'`);
    sqlNote("deal_id", d, "Older note", U.linus, "20 hours");
    sql(`insert into timeline_events (deal_id, kind, actor_id, from_stage, to_stage) values (${d}, 'moved', 1, 'Lead in', 'Qualified')`);
    const ada = await as("ada"); await go(ada, `/deals/${d}`); await addNote(ada, "Newest note");
    const body = norm(await ada.locator("main").textContent());
    const days = (await tl(ada).locator(".day").allTextContents()).map(norm);
    const tags = (await tl(ada).locator(".kd").allTextContents()).map(norm);
    const texts = await entryTexts(ada);
    const y = ukDay(new Date(Date.now() - 86400000)), y20 = ukDay(new Date(Date.now() - 20 * 3600000));
    const expectDays = y20 === today ? [`// TODAY · ${today}`, `// ${y}`] : [`// TODAY · ${today}`, `// ${y}`];
    const okTimes = (await tl(ada).locator(".when").allTextContents()).every((t) => /^\d\d:\d\d$/.test(norm(t)));
    const ok = /\/\/ TIMELINE/.test(body) && !/HISTORY/.test(body) && JSON.stringify(days) === JSON.stringify(expectDays) && tags.every((t) => t === "NOTE" || t === "CHANGE") && texts[0].includes("Newest note") && texts[1].includes("Moved") && texts[texts.length - 1].includes("Added") && okTimes;
    check("US2 scenario 1", ok, `days ${JSON.stringify(days)}; tags ${tags}; entries ${JSON.stringify(texts)}`);
  });

  // shared setup for US2-2/3
  const o22 = mkOrg("SF102 Org Twotwo"), p22 = mkPerson("Sftwotwo", "Person", { org: o22 }), q22 = mkPerson("Sfother", "Person");
  const d22a = mkDeal("SF102 Main Deal", { person: p22, org: o22 }), d22b = mkDeal("SF102 Other Deal", { others: [p22] });
  await run("US2 scenario 2", async () => {
    sql(`update timeline_events set created_at=now()-interval '3 hours' where deal_id in (${d22a},${d22b}) or person_id=${p22} or organisation_id=${o22}`);
    sqlNote("person_id", p22, "Own person note", U.ada, "2 hours");
    sqlNote("deal_id", d22a, "Main deal note", U.linus, "90 minutes");
    sqlNote("deal_id", d22b, "Other deal note", U.grace, "1 hour");
    const ada = await as("ada"); await go(ada, `/people/${p22}`);
    const texts = await entryTexts(ada);
    const info = [];
    for (let i = 0; i < await ents(ada).count(); i++) { const e = ents(ada).nth(i); const od = e.locator(".on-deal a"); info.push({ tag: norm(await e.locator(".kd").textContent()), deal: (await od.count()) ? norm(await od.textContent()) + "→" + (await od.getAttribute("href")) : "" }); }
    const idx = (s) => texts.findIndex((t) => t.includes(s));
    const order = [idx("Other deal note"), idx("Main deal note"), idx("Own person note")];
    const dealEntries = info.filter((x) => x.deal);
    const okDeals = dealEntries.every((x) => x.tag === "DEAL") && dealEntries.some((x) => x.deal === `SF102 Main Deal→/deals/${d22a}`) && dealEntries.some((x) => x.deal === `SF102 Other Deal→/deals/${d22b}`);
    const added = texts.filter((t) => /Added/.test(t)).length; // own added + 2 deals' added
    check("US2 scenario 2", order[0] === 0 && order[0] < order[1] && order[1] < order[2] && okDeals && added === 3 && info[idx("Own person note")].tag === "NOTE", `entries: ${texts.map((t, i) => `[${info[i].tag}${info[i].deal ? " " + info[i].deal : ""}] ${t}`).join(" || ")}`);
  });

  await run("US2 scenario 3", async () => {
    sqlNote("organisation_id", o22, "Own org note", U.ada, "100 minutes");
    const ada = await as("ada"); await go(ada, `/organisations/${o22}`);
    const texts = await entryTexts(ada);
    const tags = (await tl(ada).locator(".kd").allTextContents()).map(norm);
    const i1 = texts.findIndex((t) => t.includes("Main deal note")), i2 = texts.findIndex((t) => t.includes("Own org note"));
    const hrefs = await tl(ada).locator(".on-deal a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const ok = i1 === 0 && i2 > i1 && tags[i1] === "DEAL" && tags[i2] === "NOTE" && !texts.some((t) => t.includes("Other deal note")) && hrefs.every((h) => h === `/deals/${d22a}`) && hrefs.length === 2;
    check("US2 scenario 3", ok, `org timeline: ${texts.map((t, i) => `[${tags[i]}] ${t}`).join(" || ")} (Other Deal is not the org's: not shown)`);
  });

  await run("US2 scenario 4", async () => {
    const ada = await as("ada");
    await go(ada, `/deals/${d22b}`);
    await ada.getByRole("button", { name: `Unlink Sftwotwo Person` }).click(); await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    await go(ada, `/people/${p22}`); const pt = await tl(ada).textContent();
    await go(ada, `/deals/${d22b}`); const dt = norm(await tl(ada).textContent());
    // change the main deal's organisation (SQL) and look at the old organisation
    const o2 = mkOrg("SF102 Org New"); sql(`update deals set organisation_id=${o2} where id=${d22a}`);
    await go(ada, `/organisations/${o22}`); const ot = await tl(ada).textContent();
    await go(ada, `/organisations/${o2}`); const nt = await tl(ada).textContent();
    sql(`update deals set organisation_id=${o22} where id=${d22a}`);
    const ok = !pt.includes("Other deal note") && !pt.includes("SF102 Other Deal") && /Unlinked Sftwotwo Person/.test(dt) && !ot.includes("Main deal note") && nt.includes("Main deal note");
    check("US2 scenario 4", ok, `after Unlink: person shows Other Deal entries: ${pt.includes("SF102 Other Deal")}; deal timeline: "${dt.slice(0, 300)}"; after org change: old org shows deal note ${ot.includes("Main deal note")}, new org ${nt.includes("Main deal note")}`);
  });

  await run("US2 scenario 5", async () => {
    const pe = mkPerson("Sfpaging", "Person"); sql(`update timeline_events set created_at=now()-interval '5 days' where person_id=${pe}`);
    // 120 notes, several sharing the same timestamp, spread over 3 days
    sql(`insert into timeline_events (person_id, kind, actor_id, body, created_at) select ${pe}, 'note', 1, 'Paging '||g, date_trunc('minute', now()) - (g/3) * interval '30 minutes' from generate_series(1,120) g`);
    const expected = sql(`select body from timeline_events where person_id=${pe} order by created_at desc, id desc`).split("\n");
    const ada = await as("ada"); await go(ada, `/people/${pe}`);
    const c1 = await ents(ada).count();
    const first = (await tl(ada).locator(".notebody").allTextContents()).map(norm);
    const more1 = await tl(ada).getByRole("link", { name: "[ SHOW MORE ]" }).count();
    await tl(ada).getByRole("link", { name: "[ SHOW MORE ]" }).click(); await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    const c2 = await ents(ada).count();
    await tl(ada).getByRole("link", { name: "[ SHOW MORE ]" }).click(); await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    const all = (await tl(ada).locator(".notebody").allTextContents()).map(norm);
    const more3 = await tl(ada).getByRole("link", { name: "[ SHOW MORE ]" }).count();
    const allTexts = await entryTexts(ada);
    const days = (await tl(ada).locator(".day").allTextContents()).map(norm);
    globalThis.edge12 = { days, uniq: new Set(days).size === days.length };
    const ok = c1 === 50 && more1 === 1 && JSON.stringify(first) === JSON.stringify(expected.slice(0, 50)) && c2 === 100 && JSON.stringify(all) === JSON.stringify(expected) && more3 === 0 && allTexts.length === 121 && allTexts[120].includes("Added");
    check("US2 scenario 5", ok, `121 entries (120 notes, ties every 3, + Added): page 1 ${c1} with SHOW MORE=${more1}, then ${c2}, then ${allTexts.length} with SHOW MORE=${more3}; order equals created_at desc,id desc: ${JSON.stringify(all) === JSON.stringify(expected)}`);
  });

  await run("US2 scenario 6", async () => {
    const ada = await as("ada");
    // add a person through the app
    await go(ada, `/people/new`);
    await ada.fill('input[name="firstName"]', "Sfsix"); await ada.fill('input[name="lastName"]', "Fresh");
    await Promise.all([ada.waitForURL(/\/people\/\d+/), ada.locator("form.recform").getByRole("button", { name: "[ SAVE ]" }).click()]); await ada.waitForLoadState("networkidle");
    const texts = await entryTexts(ada);
    check("US2 scenario 6", texts.length === 1 && /Added/.test(texts[0]) && (await box(ada).count()) === 1, `new person ${ada.url()}: entries ${JSON.stringify(texts)}, note box ${await box(ada).count()}`);
  });

  await run("US2 scenario 7", async () => {
    const o = mkOrg("SF102 Org Seven"), pe = mkPerson("Sfseven2", "Person"), d = mkDeal("SF102 Archived Seven", { org: o, person: pe });
    sqlNote("deal_id", d, "Seven deal note", U.ada);
    sql(`update deals set archived_at=now() where id=${d}`);
    const ada = await as("ada"); const arch = [];
    for (const path of [`/people/${pe}`, `/organisations/${o}`]) { await go(ada, path); const e = ents(ada).filter({ hasText: "Seven deal note" }); arch.push((await e.count()) === 1 && norm(await e.locator(".on-deal").textContent()) === "SF102 Archived SevenArchived"); }
    // delete it through the app (restore first: the deal page offers delete)
    await go(ada, `/deals/${d}?confirm=delete`);
    const btn = ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" });
    let via = "app";
    if (await btn.count()) { await Promise.all([ada.waitForLoadState("networkidle"), btn.click()]); await ada.waitForTimeout(800); } else { via = "sql"; sql(`delete from deals where id=${d}`); }
    const gone = [];
    for (const path of [`/people/${pe}`, `/organisations/${o}`]) { await go(ada, path); gone.push(!(await tl(ada).textContent()).includes("SF102 Archived Seven")); }
    check("US2 scenario 7", arch.every(Boolean) && gone.every(Boolean), `archived deal entries on person/org with "Archived": ${arch}; after delete (${via}) gone: ${gone}`);
  });

  await run("US3 scenario 1", async () => {
    const d = mkDeal("SF102 Mention One"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    const o1 = await typeMention(ada, "li"); // starts with / contains
    await box(ada).getByRole("textbox", { name: "Note" }).fill("");
    const o2 = await typeMention(ada, "fake");
    await box(ada).getByRole("textbox", { name: "Note" }).fill("Hello ");
    await typeMention(ada, "lin", "Linus Fake");
    const val = await box(ada).getByRole("textbox", { name: "Note" }).inputValue();
    check("US3 scenario 1", JSON.stringify(o1) === JSON.stringify(["Linus Fake"]) && o2.length === 4 && !o2.includes("Alan Fake") && val.startsWith("Hello @Linus Fake"), `"@li" → ${JSON.stringify(o1)}; "@fake" → ${JSON.stringify(o2)} (deactivated Alan not offered); after choosing: ${JSON.stringify(val)}`);
  });

  await run("US3 scenario 2", async () => {
    const o = mkOrg("SF102 Org Mtwo"), d = mkDeal("SF102 Mention Two", { org: o }); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await box(ada).getByRole("textbox", { name: "Note" }).fill("Ask");
    await typeMention(ada, "lin", "Linus Fake"); await box(ada).getByRole("textbox", { name: "Note" }).pressSequentially("about <i>it</i>");
    await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1000);
    const out = [];
    for (const path of [`/deals/${d}`, `/organisations/${o}`]) {
      await go(ada, path); const nb = ents(ada).first().locator(".notebody");
      const marks = (await nb.locator("mark.mention").allTextContents()); const html = String(await nb.evaluate((e) => e.children.length));
      const style = await nb.locator("mark.mention").evaluate((m) => getComputedStyle(m).backgroundColor + "/" + getComputedStyle(m).color);
      const base = await nb.evaluate((m) => getComputedStyle(m).color);
      out.push({ path, marks, text: norm(await nb.textContent()), other: html !== "1", style, base });
    }
    check("US3 scenario 2", out.every((o) => JSON.stringify(o.marks) === '["@Linus Fake"]' && o.text === "Ask @Linus Fake about <i>it</i>" && !o.other && o.style.split("/")[1] !== o.base), JSON.stringify(out));
  });

  await run("US3 scenario 3", async () => {
    sql(`delete from note_mentions`);
    const d = mkDeal("SF102 Notify Three"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await typeMention(ada, "lin", "Linus Fake"); await box(ada).getByRole("textbox", { name: "Note" }).pressSequentially("older one");
    await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    const long = "Z".repeat(250);
    const grace = await as("grace"); await go(grace, `/deals/${d}`);
    await typeMention(grace, "lin", "Linus Fake"); await box(grace).getByRole("textbox", { name: "Note" }).fill((await box(grace).getByRole("textbox", { name: "Note" }).inputValue()) + long);
    await box(grace).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await grace.waitForTimeout(1200);
    const linus = await as("linus"); await go(linus, `/people`);
    const sb = await sidebar(linus);
    await go(linus, `/notifications`);
    const items = linus.getByRole("list", { name: "Notifications" }).getByRole("listitem");
    const t0 = norm(await items.nth(0).locator(".notif-title").textContent()), p0 = norm(await items.nth(0).locator(".notif-preview").textContent()), w0 = norm(await items.nth(0).locator(".when").textContent());
    const t1 = norm(await items.nth(1).locator(".notif-title").textContent());
    const expPrev = ("@Linus Fake " + long).slice(0, 200);
    globalThis.n3 = { d };
    check("US3 scenario 3", sb.includes("2") && /Notifications\s*\(?2\)?/.test(sb) && t0 === "Grace Fake mentioned you in a note on SF102 Notify Three" && t1 === "Ada Fake mentioned you in a note on SF102 Notify Three" && p0.length <= 201 && p0.startsWith("@Linus Fake ZZZ") && w0.length > 0, `two mentions (Ada then Grace): sidebar "${sb}" (spec's "(1)" holds per mention; 2 here); rows: "${t0}" [${w0}] preview ${p0.length} chars "${p0.slice(0, 30)}…", then "${t1}"; expected preview ${expPrev.length} chars`);
  });

  await run("US3 scenario 4", async () => {
    const linus = await as("linus"); await go(linus, `/notifications`);
    const before = unread(U.linus);
    await Promise.all([linus.waitForURL(/\/deals\/\d+/), linus.getByRole("list", { name: "Notifications" }).getByRole("button").first().click()]); await linus.waitForLoadState("networkidle");
    const url = linus.url(); const after = unread(U.linus); const sb = await sidebar(linus);
    await go(linus, `/notifications`);
    await linus.getByRole("button", { name: "[ MARK ALL AS READ ]" }).click(); await linus.waitForTimeout(1000); await linus.waitForLoadState("networkidle");
    const sb2 = await sidebar(linus); const left = unread(U.linus);
    check("US3 scenario 4", url.endsWith(`/deals/${globalThis.n3.d}`) && before === 2 && after === 1 && /\(?1\)?/.test(sb) && left === 0 && sb2 === "Notifications", `opened → ${url}; unread ${before}→${after}, sidebar "${sb}"; after [ MARK ALL AS READ ]: unread ${left}, sidebar "${sb2}"`);
  });

  await run("US3 scenario 5", async () => {
    sql(`delete from note_mentions`);
    const d = mkDeal("SF102 Self Five"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await typeMention(ada, "ada", "Ada Fake"); await typeMention(ada, "lin", "Linus Fake"); await typeMention(ada, "lin", "Linus Fake");
    const v = await box(ada).getByRole("textbox", { name: "Note" }).inputValue();
    await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    const ua = unread(U.ada), ul = +sql(`select count(*) from note_mentions where user_id=${U.linus}`);
    const ada2 = await as("ada"); await go(ada2, "/people"); const sb = await sidebar(ada2);
    check("US3 scenario 5", ua === 0 && ul === 1 && sb === "Notifications", `note "${v.trim()}": Ada's notifications ${ua} (sidebar "${sb}"), Linus's ${ul}`);
  });

  await run("US3 scenario 6", async () => {
    sql(`delete from note_mentions`);
    const d = mkDeal("SF102 Edit Six"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await typeMention(ada, "lin", "Linus Fake"); await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    const nid = sql(`select id from timeline_events where deal_id=${d} and kind='note'`);
    sql(`update note_mentions set read_at=now() where event_id=${nid}`); // Linus read it
    await go(ada, `/deals/${d}?note=${nid}`);
    const ef = ada.getByRole("form", { name: "Edit note" });
    await typeMention(ada, "marg", "Margaret Fake", ef);
    await ef.getByRole("button", { name: "[ SAVE ]" }).click(); await ada.waitForTimeout(1200); await ada.waitForLoadState("networkidle");
    const rows1 = sql(`select user_id||':'||(read_at is null) from note_mentions where event_id=${nid} order by user_id`).split("\n");
    // remove Linus
    await go(ada, `/deals/${d}?note=${nid}`);
    const ef2 = ada.getByRole("form", { name: "Edit note" });
    await ef2.getByRole("textbox", { name: "Note" }).fill("only @Margaret Fake now");
    await ef2.getByRole("button", { name: "[ SAVE ]" }).click(); await ada.waitForTimeout(1200); await ada.waitForLoadState("networkidle");
    const rows2 = sql(`select user_id||':'||(read_at is null) from note_mentions where event_id=${nid} order by user_id`).split("\n").filter(Boolean);
    const marks = await ents(ada).first().locator("mark.mention").allTextContents();
    check("US3 scenario 6", JSON.stringify(rows1) === JSON.stringify(["3:false", "4:true"]) && JSON.stringify(rows2) === JSON.stringify(["4:true"]), `after adding Margaret (user:unread): ${rows1} (Linus's stays read, no new one); after removing Linus (typed text kept "@Margaret Fake"): ${rows2}; marks ${JSON.stringify(marks)}`);
  });

  await run("US3 scenario 7", async () => {
    sql(`delete from note_mentions`);
    const d = mkDeal("SF102 Delete Seven"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await typeMention(ada, "marg", "Margaret Fake"); await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    const marg = await as("margaret"); await go(marg, "/notifications");
    const b = await marg.getByRole("list", { name: "Notifications" }).getByRole("listitem").count(); const sb1 = await sidebar(marg);
    await go(ada, `/deals/${d}`);
    await ents(ada).first().getByRole("link", { name: "Delete note" }).click(); await ada.waitForLoadState("networkidle");
    await ada.getByRole("alertdialog", { name: "Confirm note delete" }).getByRole("button", { name: "[ DELETE ]" }).click(); await ada.waitForTimeout(1000);
    await go(marg, "/notifications");
    const empty = norm(await marg.locator("main").textContent()); const sb2 = await sidebar(marg);
    check("US3 scenario 7", b === 1 && /1/.test(sb1) && empty.includes("No notifications yet.") && sb2 === "Notifications", `before delete: ${b} row, sidebar "${sb1}"; after: "${empty.includes("No notifications yet.") ? "No notifications yet." : empty.slice(0, 120)}", sidebar "${sb2}"`);
  });

  await run("US4 scenario 1", async () => {
    const o = mkOrg("SF102 Org Private"), pe = mkPerson("Sfprivdeal", "Person", { org: o });
    const d = mkDeal("SF102 Hidden Deal", { org: o, person: pe, private: true });
    for (let i = 0; i < 55; i++) sqlNote("deal_id", d, "Hidden note " + i, U.ada);
    const out = [];
    for (const u of ["linus", "grace"]) {
      const p = await as(u);
      for (const path of [`/people/${pe}`, `/organisations/${o}`]) { await go(p, path); const t = await tl(p).textContent(); out.push(`${u} ${path}: entries ${await ents(p).count()}, deal named ${t.includes("SF102 Hidden Deal") || t.includes("Hidden note")}, SHOW MORE ${await tl(p).getByRole("link", { name: "[ SHOW MORE ]" }).count()}`); }
    }
    const ada = await as("ada"); await go(ada, `/people/${pe}`); const adaCount = await ents(ada).count();
    check("US4 scenario 1", out.every((s) => s.includes("entries 1,") && s.includes("named false") && s.endsWith("SHOW MORE 0")) && adaCount === 50, out.join("; ") + `; Ada (creator) sees ${adaCount} on the person page (paged)`);
  });

  await run("US4 scenario 2", async () => {
    const o = mkOrg("SF102 Org Privperson"), pe = mkPerson("Sfsecret", "Privateperson", { org: o, private: true });
    const d = mkDeal("SF102 Deal Privperson", { org: o, others: [] });
    const ada = await as("ada");
    // Ada links the private person to the deal through the app and writes notes
    await go(ada, `/deals/${d}`);
    await ada.locator("form.link-person").evaluate((f, id) => { const i = f.querySelector("input[name=personId]"); i.value = String(id); }, pe);
    await ada.locator("form.link-person").getByRole("button", { name: "[ LINK PERSON ]" }).click(); await ada.waitForTimeout(1000);
    sqlNote("person_id", pe, "Private person note", U.ada);
    const adaDeal = norm(await (await go(ada, `/deals/${d}`), tl(ada)).textContent());
    const out = [];
    for (const u of ["linus", "grace"]) { const p = await as(u); for (const path of [`/deals/${d}`, `/organisations/${o}`]) { await go(p, path); const t = await tl(p).innerText(); out.push(`${u} ${path}: names person ${/Sfsecret|Privateperson/.test(t)}, note ${t.includes("Private person note")}`); } }
    check("US4 scenario 2", adaDeal.includes("Sfsecret") && out.every((s) => s.includes("person false, note false")), `Ada's deal timeline names the person: ${adaDeal.includes("Sfsecret")}; ` + out.join("; "));
  });

  await run("US4 scenario 3", async () => {
    const d = mkDeal("SF102 Private Mention", { private: true, by: U.ada, owner: U.linus });
    const ada = await as("ada"); await go(ada, `/deals/${d}`);
    const opts = await typeMention(ada, "fake");
    await box(ada).getByRole("textbox", { name: "Note" }).fill("hello @Margaret Fake");
    await box(ada).evaluate((f) => { const i = document.createElement("input"); i.type = "hidden"; i.name = "mention"; i.value = "4"; f.appendChild(i); });
    const before = sql(`select count(*) from timeline_events where deal_id=${d} and kind='note'`);
    await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    const m = norm(await box(ada).getByRole("alert").textContent().catch(() => ""));
    const after = sql(`select count(*) from timeline_events where deal_id=${d} and kind='note'`);
    check("US4 scenario 3", JSON.stringify([...opts].sort()) === JSON.stringify(["Ada Fake", "Linus Fake"]) && m === "Margaret Fake can't see this record, so they can't be mentioned." && before === after, `private deal (creator Ada, owner Linus): "@fake" offers ${JSON.stringify(opts)}; direct mention of Margaret → "${m}"; notes ${before}→${after}`);
  });

  await run("US4 scenario 4", async () => {
    sql(`delete from note_mentions`);
    const d = mkDeal("SF102 Goes Private"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await typeMention(ada, "lin", "Linus Fake"); await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    sql(`update deals set private=true where id=${d}`);
    const linus = await as("linus"); await go(linus, "/notifications");
    const shown = (await linus.locator("main").textContent()).includes("SF102 Goes Private"); const sb = await sidebar(linus);
    await go(linus, `/deals/${d}`); const page = norm(await linus.locator("main").textContent());
    sql(`update deals set private=false where id=${d}`);
    await go(linus, "/notifications"); const back = (await linus.locator("main").textContent()).includes("SF102 Goes Private"); const sb2 = await sidebar(linus);
    check("US4 scenario 4", !shown && sb === "Notifications" && page.includes("This deal doesn't exist or you can't see it.") && back && /1/.test(sb2), `made private (SQL): listed ${shown}, sidebar "${sb}", deal page "${page.slice(0, 80)}"; shared again: listed ${back}, sidebar "${sb2}"`);
  });

  await run("US4 scenario 5", async () => {
    const d = +sql(`select id from deals where title='Fake leaver deal'`);
    sqlNote("deal_id", d, "Leaver private note", U.alan);
    const linus = await as("linus"); await go(linus, `/deals/${d}`); const before = norm(await linus.locator("main").textContent());
    const ada = await as("ada");
    await go(ada, "/admin/users");
    await Promise.all([ada.waitForURL(/handover=/), ada.locator("tr", { hasText: "alan@barnacle.ai" }).getByRole("link", { name: "[ HAND OVER ]" }).click()]); await ada.waitForLoadState("networkidle");
    await ada.locator("form.handover select").selectOption({ label: "Linus Fake" });
    await Promise.all([ada.waitForLoadState("networkidle"), ada.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click()]); await ada.waitForTimeout(1000);
    await go(linus, `/deals/${d}`); const t = await tl(linus).textContent().catch(() => "");
    check("US4 scenario 5", before.includes("doesn't exist or you can't see it") && t.includes("Leaver private note"), `Linus before hand-over: "${before.slice(0, 60)}"; after hand-over to Linus, timeline shows the note: ${t.includes("Leaver private note")}`);
  });

  await run("Edge case 1", async () => {
    const o = mkOrg("SF102 Org Edge1"), pe = mkPerson("Sfedgeone", "Person", { org: o });
    const d = mkDeal("SF102 Edge One", { org: o, person: pe }); sqlNote("deal_id", d, "Edge one note", U.ada);
    const ada = await as("ada"); const c = [];
    for (const path of [`/people/${pe}`, `/organisations/${o}`]) { await go(ada, path); c.push(await ents(ada).filter({ hasText: "Edge one note" }).count()); }
    check("Edge case 1", c[0] === 1 && c[1] === 1, `deal note on person timeline ×${c[0]}, on organisation ×${c[1]}`);
  });

  await run("Edge case 2", async () => {
    const pe = mkPerson("Sfrelink", "Person"); const d = mkDeal("SF102 Relink");
    const ada = await as("ada");
    const link = async () => { await go(ada, `/deals/${d}`); await ada.locator("form.link-person").evaluate((f, id) => { f.querySelector("input[name=personId]").value = String(id); }, pe); await ada.locator("form.link-person").getByRole("button", { name: "[ LINK PERSON ]" }).click(); await ada.waitForTimeout(1000); };
    await link(); await go(ada, `/deals/${d}`); await addNote(ada, "Before unlink");
    await ada.getByRole("button", { name: "Unlink Sfrelink Person" }).click(); await ada.waitForTimeout(1000);
    await go(ada, `/deals/${d}`); await addNote(ada, "While unlinked");
    await go(ada, `/people/${pe}`); const mid = await tl(ada).textContent();
    await link(); await go(ada, `/people/${pe}`); const t = await tl(ada).textContent();
    check("Edge case 2", !mid.includes("Before unlink") && t.includes("Before unlink") && t.includes("While unlinked"), `while unlinked person shows deal notes: ${mid.includes("Before unlink")}; relinked: "Before unlink" ${t.includes("Before unlink")}, "While unlinked" ${t.includes("While unlinked")}`);
  });

  await run("Edge case 3", async () => {
    const pe = mkPerson("Sflinkonce", "Person"); const d = mkDeal("SF102 Link Once");
    const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await ada.locator("form.link-person").evaluate((f, id) => { f.querySelector("input[name=personId]").value = String(id); }, pe);
    await ada.locator("form.link-person").getByRole("button", { name: "[ LINK PERSON ]" }).click(); await ada.waitForTimeout(1000);
    await go(ada, `/people/${pe}`); const texts = await entryTexts(ada);
    const tags = (await tl(ada).locator(".kd").allTextContents()).map(norm);
    const linkRows = texts.map((t, i) => [t, tags[i]]).filter(([t]) => /Linked/i.test(t));
    const evs = sql(`select coalesce(person_id::text,'-')||'/'||coalesce(deal_id::text,'-')||'/'||kind from timeline_events where kind like '%link%' and (person_id=${pe} or deal_id=${d} or related_person_id=${pe})`);
    check("Edge case 3", linkRows.length === 1, `link entries on the person timeline: ${JSON.stringify(linkRows)} (events: ${evs.replace(/\n/g, ", ")})`);
  });

  await run("Edge case 4", async () => {
    sql(`delete from note_mentions`);
    const d = mkDeal("SF102 Deactivated Mention"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await typeMention(ada, "marg", "Margaret Fake"); await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    const nid = sql(`select id from timeline_events where deal_id=${d} and kind='note'`);
    sql(`update note_mentions set read_at=now() where event_id=${nid}`);
    sql(`update users set status='deactivated' where id=4`);
    await go(ada, `/deals/${d}`);
    const mark = await ents(ada).first().locator("mark.mention").allTextContents();
    const opts = await typeMention(ada, "marg");
    // edit the note keeping her mention: no new notification
    await go(ada, `/deals/${d}?note=${nid}`);
    const ef = ada.getByRole("form", { name: "Edit note" }); await ef.getByRole("textbox", { name: "Note" }).press("End"); await ef.getByRole("textbox", { name: "Note" }).pressSequentially(" more");
    await ef.getByRole("button", { name: "[ SAVE ]" }).click(); await ada.waitForTimeout(1200);
    const rows1 = sql(`select count(*) filter (where read_at is null)||'/'||count(*) from note_mentions where user_id=4`);
    await go(ada, `/deals/${d}`); const mark2 = await ents(ada).first().locator("mark.mention").allTextContents();
    // a new note with a direct mention of her
    await box(ada).getByRole("textbox", { name: "Note" }).fill("again @Margaret Fake");
    await box(ada).evaluate((f) => { const i = document.createElement("input"); i.type = "hidden"; i.name = "mention"; i.value = "4"; f.appendChild(i); });
    await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    const err = norm(await box(ada).getByRole("alert").textContent().catch(() => ""));
    const rows2 = sql(`select count(*) filter (where read_at is null)||'/'||count(*) from note_mentions where user_id=4`);
    sql(`update users set status='active' where id=4`);
    check("Edge case 4", JSON.stringify(mark) === '["@Margaret Fake"]' && opts.length === 0 && rows1 === "0/1" && JSON.stringify(mark2) === '["@Margaret Fake"]' && rows2 === "0/1", `after deactivating Margaret: note shows ${JSON.stringify(mark)}; "@marg" offers ${JSON.stringify(opts)}; edit keeping her mention: her notifications unread/all ${rows1}, still shows ${JSON.stringify(mark2)}; a direct mention in a new note → ${err ? `refused "${err}"` : "saved"}, unread/all ${rows2}`);
  });

  await run("Edge case 5", async () => {
    sql(`delete from note_mentions`);
    const d = mkDeal("SF102 Email Text"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await addNote(ada, "Write to ada@example.fake and @Linus Fake later");
    const nid = sql(`select id from timeline_events where deal_id=${d} and kind='note'`);
    const marks = await ents(ada).first().locator("mark.mention").count(); const txt = await ents(ada).first().locator(".notebody").textContent();
    const rows = sql(`select count(*) from note_mentions where event_id=${nid}`);
    check("Edge case 5", marks === 0 && txt === "Write to ada@example.fake and @Linus Fake later" && rows === "0", `typed (not chosen) text: shown "${txt}", highlighted ${marks}, notifications ${rows}`);
  });

  await run("Edge case 6", async () => {
    const d = mkDeal("SF102 Rename"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await typeMention(ada, "marg", "Margaret Fake"); await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    sql(`update users set name='Margaret Renamedfake' where id=4`);
    await go(ada, `/deals/${d}`); const mark = await ents(ada).first().locator("mark.mention").allTextContents();
    sql(`update users set name='Margaret Fake' where id=4`);
    check("Edge case 6", JSON.stringify(mark) === '["@Margaret Renamedfake"]', `after rename: ${JSON.stringify(mark)}`);
  });

  await run("Edge case 7", async () => {
    sql(`delete from note_mentions`);
    const ada = await as("ada"); const out = [];
    const pe = mkPerson("Sfdelete", "Person"), o = mkOrg("SF102 Org Delete"), d = mkDeal("SF102 Delete Deal");
    for (const [path, del] of [[`/people/${pe}`, `/people/${pe}?confirm=delete`], [`/organisations/${o}`, `/organisations/${o}?confirm=delete`], [`/deals/${d}`, `/deals/${d}?confirm=delete`]]) {
      await go(ada, path); await typeMention(ada, "lin", "Linus Fake"); await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    }
    const nids = sql(`select id from timeline_events where kind='note' and (person_id=${pe} or organisation_id=${o} or deal_id=${d})`).split("\n");
    const before = unread(U.linus);
    for (const del of [`/people/${pe}?confirm=delete`, `/organisations/${o}?confirm=delete`, `/deals/${d}?confirm=delete`]) {
      await go(ada, del); const b = ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" });
      if (await b.count()) { await Promise.all([ada.waitForLoadState("networkidle"), b.click()]); await ada.waitForTimeout(800); out.push(del + ": deleted"); } else out.push(del + ": no delete button");
    }
    const left = sql(`select count(*) from timeline_events where id in (${nids.join(",")})`);
    const linus = await as("linus"); await go(linus, "/notifications"); const sb = await sidebar(linus);
    check("Edge case 7", nids.length === 3 && before === 3 && left === "0" && unread(U.linus) === 0 && sb === "Notifications", `${out.join("; ")}; notes left ${left}/3; Linus notifications ${before}→${unread(U.linus)}, sidebar "${sb}"`);
  });

  await run("Edge case 8", async () => {
    const pe = mkPerson("Sfplain", "Person"); const ada = await as("ada"); await go(ada, `/people/${pe}`);
    const raw = "  <b>bold</b> https://example.fake *star* [x](y)\n   second line  \n\nthird  ";
    await addNote(ada, raw);
    const nb = ents(ada).first().locator(".notebody");
    const txt = (await nb.textContent()).replace(/\r\n/g, "\n"); const html = String(await nb.evaluate((e) => e.children.length)); const ws = await nb.evaluate((e) => getComputedStyle(e).whiteSpace);
    const exp = raw.trim();
    check("Edge case 8", txt === exp && !/<a|<b>/.test(html) && /pre/.test(ws), `shown ${JSON.stringify(txt)} (expected ${JSON.stringify(exp)}); child elements: ${/<a|<b>/.test(html)}; white-space ${ws}`);
  });

  await run("Edge case 9", async () => {
    const pe = mkPerson("Sfemptyedit", "Person"); const nid = sqlNote("person_id", pe, "Keep me", U.ada);
    const ada = await as("ada"); await go(ada, `/people/${pe}?note=${nid}`);
    const ef = ada.getByRole("form", { name: "Edit note" });
    await ef.getByRole("textbox", { name: "Note" }).fill("   "); await ef.getByRole("button", { name: "[ SAVE ]" }).click(); await ada.waitForTimeout(1000);
    const m = norm(await ef.getByRole("alert").textContent().catch(() => ""));
    const b = sql(`select body from timeline_events where id=${nid}`);
    check("Edge case 9", m === "Write something before adding the note." && b === "Keep me", `edit to spaces → "${m}"; body "${b}"`);
  });

  await run("Edge case 10", async () => {
    const pe = mkPerson("Sfdeactauthor", "Person"); const nid = sqlNote("person_id", pe, "By Margaret", U.margaret);
    sql(`update users set status='deactivated' where id=4`);
    const linus = await as("linus"); await go(linus, `/people/${pe}`);
    const who = norm(await ents(linus).first().locator(".author").textContent());
    await go(linus, `/people/${pe}?note=${nid}`);
    const ef = linus.getByRole("form", { name: "Edit note" }); await ef.getByRole("textbox", { name: "Note" }).fill("By Margaret, fixed"); await ef.getByRole("button", { name: "[ SAVE ]" }).click(); await linus.waitForTimeout(1200);
    const b = sql(`select body from timeline_events where id=${nid}`);
    await go(linus, `/people/${pe}?delete-note=${nid}`);
    await linus.getByRole("alertdialog", { name: "Confirm note delete" }).getByRole("button", { name: "[ DELETE ]" }).click(); await linus.waitForTimeout(1000);
    const left = sql(`select count(*) from timeline_events where id=${nid}`);
    sql(`update users set status='active' where id=4`);
    check("Edge case 10", who === "Margaret Fake (deactivated)" && b === "By Margaret, fixed" && left === "0", `author shown "${who}"; Linus edited → "${b}"; then deleted (left ${left})`);
  });

  await run("Edge case 11", async () => {
    const pe = mkPerson("Sfmultiedit", "Person"); const nid = sqlNote("person_id", pe, "v1", U.linus);
    for (const [u, t] of [["ada", "v2"], ["grace", "v3"]]) { const p = await as(u); await go(p, `/people/${pe}?note=${nid}`); const ef = p.getByRole("form", { name: "Edit note" }); await ef.getByRole("textbox", { name: "Note" }).fill(t); await ef.getByRole("button", { name: "[ SAVE ]" }).click(); await p.waitForTimeout(1200); }
    const ada = await as("ada"); await go(ada, `/people/${pe}`); const e = norm(await ents(ada).first().locator(".edited").textContent());
    check("Edge case 11", e === "edited by Grace Fake", `after Ada then Grace edit: "${e}"`);
  });

  await run("Edge case 12", async () => {
    const r = globalThis.edge12 || { days: [], uniq: false };
    check("Edge case 12", r.uniq && r.days.length >= 2, `after two [ SHOW MORE ] on the 121-entry timeline (page breaks inside a day): headings ${JSON.stringify(r.days)}`);
  });

  await run("Edge case 13", async () => {
    const ada = await as("ada"); await go(ada, `/people/${p22}`);
    const rows = [];
    for (let i = 0; i < await ents(ada).count(); i++) { const e = ents(ada).nth(i); rows.push({ tag: norm(await e.locator(".kd").textContent()), deal: await e.locator(".on-deal").count(), note: await e.locator(".notebody").count(), lines: (await e.locator(".ent-body").innerText()).split("\n").filter((s) => s.trim()).length }); }
    const nb = ents(ada).filter({ hasText: "Own person note" }).locator(".notebody");
    const st = await nb.evaluate((e) => { const s = getComputedStyle(e); return `${s.borderLeftWidth} ${s.borderLeftStyle} ${s.borderLeftColor}`; });
    const changeOk = rows.filter((r) => !r.note).every((r) => (r.deal ? r.tag === "DEAL" && r.lines === 2 : r.tag === "CHANGE" && r.lines === 1));
    const orange = /rgb\((2[0-5]\d|1[5-9]\d), (\d{1,3}), (\d{1,2})\)/.exec(st);
    check("Edge case 13", changeOk && rows.some((r) => !r.note && !r.deal) && rows.some((r) => !r.note && r.deal) && /^3px solid/.test(st) && !!orange, `entries ${JSON.stringify(rows)} (DEAL change = deal title line + 1 change line); note box left edge "${st}"`);
  });

  await run("Edge case 14", async () => {
    const pe = mkPerson("Sfsametime", "Person");
    const a = await as("ada"), l = await as("linus");
    await go(a, `/people/${pe}`); await go(l, `/people/${pe}`);
    await box(a).getByRole("textbox", { name: "Note" }).fill("Ada at once"); await box(l).getByRole("textbox", { name: "Note" }).fill("Linus at once");
    await Promise.all([box(a).getByRole("button", { name: "[ ADD NOTE ]" }).click(), box(l).getByRole("button", { name: "[ ADD NOTE ]" }).click()]);
    await a.waitForTimeout(1500); await go(a, `/people/${pe}`);
    const n = await tl(a).locator(".notebody").allTextContents();
    check("Edge case 14", n.length === 2 && n.includes("Ada at once") && n.includes("Linus at once"), `both submitted together: ${JSON.stringify(n)}`);
  });

  await run("Edge case 15", async () => {
    sql(`delete from note_mentions`);
    const d = mkDeal("SF102 Archived Notify"); const ada = await as("ada"); await go(ada, `/deals/${d}`);
    await typeMention(ada, "lin", "Linus Fake"); await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1200);
    sql(`update deals set archived_at=now() where id=${d}`);
    const linus = await as("linus"); await go(linus, "/notifications");
    await Promise.all([linus.waitForURL(/\/deals\/\d+/), linus.getByRole("list", { name: "Notifications" }).getByRole("button").first().click()]); await linus.waitForLoadState("networkidle");
    const t = norm(await linus.locator("main").textContent());
    check("Edge case 15", linus.url().endsWith(`/deals/${d}`) && t.includes("Archived") && t.includes("SF102 Archived Notify"), `opened ${linus.url()}; page shows "Archived": ${t.includes("Archived")}`);
  });

  await run("Edge case 16", async () => {
    sql(`delete from note_mentions`);
    const linus = await as("linus"); await go(linus, "/notifications"); const empty = (await linus.locator("main").textContent()).includes("No notifications yet.");
    const d = mkDeal("SF102 Many Notes");
    sql(`with n as (insert into timeline_events (deal_id, kind, actor_id, body, created_at) select ${d}, 'note', 1, 'Many '||g||' @[user:3]', now() - g * interval '1 minute' from generate_series(1,60) g returning id, created_at) insert into note_mentions (event_id, user_id, mentioned_by, created_at) select id, 3, 1, created_at from n`);
    await go(linus, "/notifications");
    const c1 = await linus.getByRole("list", { name: "Notifications" }).getByRole("listitem").count();
    const first = norm(await linus.locator(".notif-preview").first().textContent());
    await linus.getByRole("link", { name: "[ SHOW MORE ]" }).click(); await linus.waitForTimeout(1000); await linus.waitForLoadState("networkidle");
    const c2 = await linus.getByRole("list", { name: "Notifications" }).getByRole("listitem").count();
    const more = await linus.getByRole("link", { name: "[ SHOW MORE ]" }).count();
    const sb = await sidebar(linus);
    check("Edge case 16", empty && c1 === 50 && c2 === 60 && more === 0 && first.startsWith("Many 1 "), `none: "No notifications yet." ${empty}; 60: first page ${c1} (newest "${first}"), after SHOW MORE ${c2}, SHOW MORE left ${more}; sidebar "${sb}"`);
  });

  await run("Edge case 17", async () => {
    // exactly 10,000 characters counting each line break once, typed in the box (the browser posts CRLF)
    const pe = mkPerson("Sfseventeen", "Person"); const ada = await as("ada"); await go(ada, `/people/${pe}`);
    const line = "y".repeat(99) + "\n"; let text = line.repeat(100); text = text.slice(0, 9999) + "z"; // 100 lines, 99 breaks
    const t = box(ada).getByRole("textbox", { name: "Note" }); await t.fill(text);
    const boxLen = (await t.inputValue()).length;
    await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    const err = norm(await box(ada).getByRole("alert").textContent().catch(() => ""));
    const row = sql(`select length(body)||'|'||(body like '%'||chr(13)||'%')||'|'||(length(body)-length(replace(body, chr(10), ''))) from timeline_events where person_id=${pe} and kind='note'`);
    const shown = await ents(ada).first().locator(".notebody").textContent().catch(() => "");
    check("Edge case 17", boxLen === 10000 && err === "" && row === "10000|false|99" && shown.replace(/\r\n/g, "\n") === text, `box holds ${boxLen} chars; error "${err}"; stored length|has CR|line breaks = ${row}; shown text equal: ${shown.replace(/\r\n/g, "\n") === text}`);
  });

  await run("Edge case 18", async () => {
    const pe = mkPerson("Sfeighteen", "Person"); const ada = await as("ada"); await go(ada, `/people/${pe}`);
    const t = box(ada).getByRole("textbox", { name: "Note" }); await t.fill("Ask");
    await typeMention(ada, "Lin", "Linus Fake");
    await t.press("End"); await t.pressSequentially("and @Linus Fakeson too", { delay: 10 });
    await ada.keyboard.press("Escape").catch(() => {});
    const before = unread(U.linus);
    await box(ada).getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForTimeout(1000); await ada.waitForLoadState("networkidle");
    const nb = ents(ada).first().locator(".notebody");
    const marks = await nb.locator("mark.mention").allTextContents(); const txt = norm(await nb.textContent());
    const body = sql(`select body from timeline_events where person_id=${pe} and kind='note'`);
    const after = unread(U.linus);
    check("Edge case 18", marks.length === 1 && marks[0] === "@Linus Fake" && txt.includes("and @Linus Fakeson too") && /@\[user:3\]/.test(body) && body.includes("@Linus Fakeson") && after - before === 1, `marks ${JSON.stringify(marks)}; shown "${txt}"; stored "${body}"; Linus unread ${before}→${after}`);
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log("FAILED: " + f.name);
})();
