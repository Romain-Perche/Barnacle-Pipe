// SF-109 AI-review scenario script (activities): all 45 US1–US6 scenarios and edge cases 1–14, against :3000/crm_dev
// on fresh fake data (`bash .factory/run/reset-db.sh` first). Signs in by inserting a `sessions` row (crm_session
// cookie). Makes its own "SF109 …" records by SQL. Run:
//   bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules:$PWD/node_modules node .factory/run/scenarios-sf109.js
// ONLY="US1 scenario 1,Edge case 4" runs a subset (each scenario makes its own data).
const crypto = require("crypto");
const { chromium, results, check } = require("./lib.js");
const pg = require("postgres"); const postgres = pg.default || pg;
const BASE = process.env.BASE || "http://localhost:3000";
const db = postgres(process.env.DATABASE_URL || "postgres://postgres@localhost:5432/crm_dev", { prepare: false, max: 3, onnotice: () => {} });
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map((s) => s.trim()) : null;
const ADA = 1, GRACE = 2, LINUS = 3, MARGARET = 4, ALAN = 5;

const ukDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
const addDays = (day, n) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (day) => { const [y, m, d] = day.split("-"); return `${d} ${MON[+m - 1]} ${y}`; };
const TODAY = ukDay();
const TOMORROW = addDays(TODAY, 1);
let browser;
const ctxs = {};

async function pageAs(userId) {
  if (!ctxs[userId]) {
    const token = crypto.randomBytes(24).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest();
    await db`insert into sessions (token_hash, user_id, expires_at) values (${hash}, ${userId}, now() + interval '1 day')`;
    const ctx = await browser.newContext({ viewport: { width: 1900, height: 1100 } });
    await ctx.addCookies([{ name: "crm_session", value: token, url: BASE }]);
    ctxs[userId] = await ctx.newPage();
  }
  return ctxs[userId];
}
async function go(page, path) { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); }
const text = async (loc) => ((await loc.count()) ? (await loc.first().textContent()) || "" : "");
const next = (page) => page.getByRole("region", { name: "Next activities" });
const timeline = (page) => page.getByRole("region", { name: "Timeline" });
async function settle(page) { await page.waitForLoadState("networkidle"); await page.waitForTimeout(400); }

let seq = 0;
async function stage() { return (await db`select id::int from stages where pipeline_id = 1 order by position, id limit 1`)[0].id; }
async function mkOrg(name) { return (await db`insert into organisations (name, created_by, owner_id) values (${name}, 1, 1) returning id::int`)[0].id; }
async function mkPerson(first, last, orgId = null, opts = {}) {
  const by = opts.by || ADA;
  return (await db`insert into persons (first_name, last_name, organisation_id, created_by, owner_id, private)
    values (${first}, ${last}, ${orgId}, ${by}, ${opts.owner || by}, ${!!opts.private}) returning id::int`)[0].id;
}
async function mkDeal(title, personId = null, orgId = null, opts = {}) {
  const by = opts.by || ADA;
  return (await db`insert into deals (title, stage_id, organisation_id, person_id, owner_id, created_by, private)
    values (${title}, ${await stage()}, ${orgId}, ${personId}, ${opts.owner || by}, ${by}, ${!!opts.private}) returning id::int`)[0].id;
}
async function mkAct(o) {
  return (await db`insert into activities (type, subject, due_on, due_time, duration_minutes, note, deal_id, person_id, organisation_id,
      assignee_id, created_by, assigned_by, done_at, done_by)
    values (${o.type || "call"}, ${o.subject}, ${o.dueOn || TOMORROW}, ${o.dueTime || null}, ${o.duration || null}, ${o.note || null},
      ${o.dealId || null}, ${o.personId || null}, ${o.orgId || null}, ${o.assignee || ADA}, ${o.by || ADA}, ${o.assignedBy || o.by || ADA},
      ${o.doneAt || null}, ${o.doneAt ? o.doneBy || ADA : null}) returning id::int`)[0].id;
}
const actRow = async (id) => (await db`select * from activities where id = ${id}`)[0];
const sub = (s) => `SF109 ${s} ${++seq}`;

// The activity box: fill and save. `f`: { type, subject, dueOn, dueTime, duration, assignee }.
async function fillBox(page, f) {
  const box = page.getByRole("dialog");
  if (f.type) await box.getByRole("radio", { name: f.type, exact: true }).check({ force: true });
  if (f.subject !== undefined) await box.getByLabel("Subject").fill(f.subject);
  if (f.dueOn !== undefined) await box.getByLabel("Date").fill(f.dueOn);
  if (f.dueTime !== undefined) await box.getByLabel("Time").fill(f.dueTime);
  if (f.duration !== undefined) await box.getByLabel("Duration").selectOption(String(f.duration));
  if (f.assignee !== undefined) await box.getByLabel("Assigned to").selectOption(String(f.assignee));
  if (f.note !== undefined) await box.getByLabel("Note").fill(f.note);
}
async function save(page) { await page.getByRole("dialog").getByRole("button", { name: "[ SAVE ]" }).click(); await settle(page); }
async function openSchedule(page) { await next(page).getByRole("link", { name: "[ SCHEDULE ACTIVITY ]" }).click(); await page.getByRole("dialog").waitFor(); }
async function pickerValues(page) {
  const box = page.getByRole("dialog");
  return {
    deal: await box.getByRole("combobox", { name: "Deal" }).inputValue(),
    person: await box.getByRole("combobox", { name: "Person" }).inputValue(),
    org: await box.getByRole("combobox", { name: "Organisation" }).inputValue(),
    dealId: await box.locator('input[name="dealId"]').inputValue(),
    personId: await box.locator('input[name="personId"]').inputValue(),
    orgId: await box.locator('input[name="organisationId"]').inputValue(),
  };
}
async function alertText(page) { return (await page.locator("p.err[role=alert], .notice, [role=status], p.err").allTextContents()).join(" | "); }
async function unread(page) {
  await go(page, "/notifications");
  const name = (await page.getByRole("link", { name: /^Notifications/ }).first().textContent()) || "";
  const m = /(\d+)/.exec(name);
  return m ? Number(m[1]) : 0;
}

const scenarios = {};
const S = (name, fn) => { scenarios[name] = fn; };

S("US1 scenario 1", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg(sub("Org")); const person = await mkPerson("Sfone", "Fakeperson", org); const deal = await mkDeal(sub("Deal"), person, org);
  const out = [];
  for (const path of [`/deals/${deal}`, `/people/${person}`, `/organisations/${org}`]) {
    await go(page, path);
    await openSchedule(page);
    const title = await text(page.getByRole("dialog").locator("h2"));
    await fillBox(page, { type: "Call", subject: "Call Ada about the proposal", dueOn: TOMORROW, dueTime: "10:00" });
    await save(page);
    const dialogGone = (await page.getByRole("dialog").count()) === 0;
    const li = next(page).locator("li.arow", { hasText: "Call Ada about the proposal" });
    const row = (await text(li)).replace(/\s+/g, " ");
    const shown = /call/i.test(row) && row.includes(`${dayText(TOMORROW)} 10:00`) && row.includes("Ada Fake");
    const tag = await text(li.locator(".tt, [class*=type], .kd").first());
    out.push({ path, ok: dialogGone && shown && title === "Schedule activity", row: row.slice(0, 120), tagUpper: (await li.first().innerText()).includes("CALL") });
  }
  check("US1 scenario 1", out.every((o) => o.ok && o.tagUpper), JSON.stringify(out));
});

S("US1 scenario 2", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg("Example Ltd Fake"); const ada = await mkPerson("Ada", "Example", org); const deal = await mkDeal(sub("Example deal"), ada, org);
  const other = await mkPerson("Otto", "Sfpicker", null);
  await go(page, `/deals/${deal}`);
  await openSchedule(page);
  const v = await pickerValues(page);
  const filled = v.dealId === String(deal) && v.person === "Ada Example" && v.personId === String(ada) && v.org === "Example Ltd Fake";
  // remove org, pick another person
  const box = page.getByRole("dialog");
  await box.locator(".field", { hasText: "Organisation" }).getByRole("button", { name: "[ CLEAR ]" }).click();
  await box.getByRole("combobox", { name: "Person" }).fill("Otto Sf");
  await box.getByRole("listbox", { name: "People" }).getByRole("button", { name: "Otto Sfpicker" }).click();
  // a private person hidden from Ada is not offered
  await box.getByRole("combobox", { name: "Person" }).fill("Robin Left");
  const hiddenOffered = await box.getByRole("button", { name: "Robin Leftfake" }).count();
  await box.getByRole("combobox", { name: "Person" }).fill("");
  await box.getByRole("combobox", { name: "Person" }).fill("Otto Sf");
  await box.getByRole("listbox", { name: "People" }).getByRole("button", { name: "Otto Sfpicker" }).click();
  const s = sub("Picked");
  await fillBox(page, { subject: s, dueOn: TOMORROW });
  await save(page);
  const [a] = await db`select deal_id::int, person_id::int, organisation_id::int from activities where subject = ${s}`;
  check("US1 scenario 2", filled && a && a.deal_id === deal && a.person_id === other && a.organisation_id === null && hiddenOffered === 0,
    `prefill ${JSON.stringify(v)}; saved ${JSON.stringify(a)}; hidden private person offered: ${hiddenOffered}`);
});

S("US1 scenario 3", async () => {
  const page = await pageAs(LINUS);
  await go(page, "/people/8"); // Hugo Lorem, Lorem Logistics Fake
  await openSchedule(page);
  const v = await pickerValues(page);
  const box = page.getByRole("dialog");
  await box.getByRole("combobox", { name: "Deal" }).fill("Fake");
  const opts = await box.getByRole("listbox", { name: "Deals" }).getByRole("button").allTextContents();
  await box.getByRole("combobox", { name: "Deal" }).fill("Fakeco website");
  await box.getByRole("listbox", { name: "Deals" }).getByRole("button", { name: "Fakeco website", exact: true }).click();
  const s = sub("Person deal");
  await fillBox(page, { subject: s, dueOn: TOMORROW });
  await save(page);
  const [a] = await db`select deal_id::int, person_id::int, organisation_id::int from activities where subject = ${s}`;
  const ok = v.person === "Hugo Lorem" && v.org === "Lorem Logistics Fake" && v.deal === "" && !opts.includes("Fake secret project")
    && !opts.some((o) => /\(won\)|\(lost\)/.test(o)) && a && a.deal_id === 1 && a.person_id === 8 && a.organisation_id === 8;
  check("US1 scenario 3", ok, `prefill ${JSON.stringify(v)}; deal options for "Fake": ${JSON.stringify(opts)}; saved ${JSON.stringify(a)}`);
});

S("US1 scenario 4", async () => {
  const page = await pageAs(ADA);
  const deal = await mkDeal(sub("Validation deal"));
  const before = (await db`select count(*)::int n from activities`)[0].n;
  const msgs = [];
  async function attempt(f, unlimit = false) {
    await go(page, `/deals/${deal}?activity=new`);
    if (unlimit) await page.evaluate(() => document.querySelectorAll("[maxlength]").forEach((e) => e.removeAttribute("maxlength")));
    await fillBox(page, f);
    await save(page);
    msgs.push((await page.getByRole("dialog").innerText()).match(/(Give the activity a subject\.|Pick a due date\.|Keep the subject under 200 characters\.|Keep the note under 10,000 characters\.)/g) || []);
  }
  await attempt({ subject: "", dueOn: TOMORROW });
  await attempt({ subject: "    ", dueOn: TOMORROW });
  await attempt({ subject: "Has subject", dueOn: "" });
  await attempt({ subject: "x".repeat(201), dueOn: TOMORROW }, true);
  await attempt({ subject: "Long note", dueOn: TOMORROW, note: "n".repeat(10001) }, true);
  const after = (await db`select count(*)::int n from activities`)[0].n;
  const exp = ["Give the activity a subject.", "Give the activity a subject.", "Pick a due date.", "Keep the subject under 200 characters.", "Keep the note under 10,000 characters."];
  check("US1 scenario 4", exp.every((e, i) => msgs[i].includes(e)) && after === before, `messages ${JSON.stringify(msgs)}; activities before/after ${before}/${after}`);
});

S("US1 scenario 5", async () => {
  const page = await pageAs(ADA);
  const deal = await mkDeal(sub("Edit deal"), 1, 1);
  const s = sub("Edit me");
  const id = await mkAct({ subject: s, dealId: deal, personId: 1, orgId: 1, dueTime: "09:00" });
  await go(page, `/deals/${deal}`);
  await next(page).getByRole("link", { name: `Edit ${s}` }).click();
  await page.getByRole("dialog", { name: "Edit activity" }).waitFor();
  await fillBox(page, { subject: s + " edited", type: "Meeting", dueTime: "11:15" });
  await save(page);
  const onDeal = await text(next(page));
  await go(page, "/people/1"); const onPerson = await text(next(page));
  await go(page, "/activities?assignee=all"); const onList = await page.locator(`#activity-${id}`).innerText();
  const editedOk = [onDeal, onPerson, onList].every((t) => t.includes(s + " edited") && t.includes("11:15")) && /meeting/i.test(onList);
  // cancel
  await go(page, `/deals/${deal}?activity=${id}`);
  await fillBox(page, { subject: "Should not stick" });
  await page.getByRole("dialog").getByRole("link", { name: "[ CANCEL ]" }).click(); await settle(page);
  const cancelOk = (await page.getByRole("dialog").count()) === 0 && (await actRow(id)).subject === s + " edited";
  // conflict
  await go(page, `/deals/${deal}?activity=${id}`);
  await db`update activities set subject = ${s + " by other"}, version = version + 1 where id = ${id}`;
  await fillBox(page, { subject: "Mine" }); await save(page);
  const conflictMsg = await page.getByRole("dialog").innerText();
  const conflictOk = conflictMsg.includes("Someone else changed this activity while you were editing. Reload to see their changes.") && (await actRow(id)).subject === s + " by other";
  // gone
  await go(page, `/deals/${deal}?activity=${id}`);
  await db`delete from activities where id = ${id}`;
  await fillBox(page, { subject: "Mine" }); await save(page);
  const goneOk = (await page.getByRole("dialog").innerText()).includes("This activity doesn't exist any more.");
  check("US1 scenario 5", editedOk && cancelOk && conflictOk && goneOk, `edited everywhere ${editedOk}; cancel ${cancelOk}; conflict ${conflictOk}; gone ${goneOk}`);
});

S("US1 scenario 6", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg(sub("Del org")); const person = await mkPerson("Del", "Sfperson", org); const deal = await mkDeal(sub("Del deal"), person, org);
  const s = sub("Delete me"); const s2 = sub("Delete done");
  const id = await mkAct({ subject: s, dealId: deal, personId: person, orgId: org });
  const id2 = await mkAct({ subject: s2, dealId: deal, personId: person, orgId: org, doneAt: new Date() });
  await go(page, `/deals/${deal}`);
  await next(page).getByRole("link", { name: `Delete ${s}` }).click();
  const dlg = page.getByRole("alertdialog", { name: "Delete this activity? This can't be undone." });
  await dlg.waitFor();
  await dlg.getByRole("button").last().click(); await settle(page);
  const notice = (await page.textContent("body")).includes("Activity deleted.");
  // the done one from the Done list
  await go(page, `/activities?assignee=all&when=done`);
  await page.getByRole("link", { name: `Delete ${s2}` }).click();
  await page.getByRole("alertdialog").getByRole("button").last().click(); await settle(page);
  const notice2 = (await page.textContent("body")).includes("Activity deleted.");
  let leftovers = 0;
  for (const p of [`/deals/${deal}`, `/people/${person}`, `/organisations/${org}`, "/activities?assignee=all", "/activities?assignee=all&when=done"]) {
    await go(page, p); const b = await page.textContent("main");
    if (b.includes(s) || b.includes(s2)) leftovers++;
  }
  check("US1 scenario 6", notice && notice2 && leftovers === 0 && !(await actRow(id)) && !(await actRow(id2)), `notice ${notice}/${notice2}; pages still showing it ${leftovers}`);
});

S("US1 scenario 7", async () => {
  const page = await pageAs(ADA);
  const deal = await mkDeal(sub("Duration deal"));
  const s1 = sub("Timed"), s2 = sub("Untimed");
  await mkAct({ subject: s1, dealId: deal, dueTime: "10:00", duration: 30 });
  await mkAct({ subject: s2, dealId: deal, dueOn: TODAY });
  await go(page, `/deals/${deal}`);
  const t1 = (await next(page).locator("li.arow", { hasText: s1 }).innerText()).replace(/\s+/g, " ");
  const t2 = (await next(page).locator("li.arow", { hasText: s2 }).innerText()).replace(/\s+/g, " ");
  const ok = t1.includes(`${dayText(TOMORROW)} 10:00–10:30`) && t2.includes(dayText(TODAY)) && !/\d\d:\d\d/.test(t2) && /today/i.test(t2) && !/overdue/i.test(t2);
  check("US1 scenario 7", ok, `timed: "${t1}"; untimed due today: "${t2}"`);
});

S("US2 scenario 1", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg(sub("Tick org")); const person = await mkPerson("Tick", "Sfperson", org); const deal = await mkDeal(sub("Tick deal"), person, org);
  const s = sub("Tick me");
  const id = await mkAct({ subject: s, dealId: deal, personId: person, orgId: org, note: "Tick note line" });
  await go(page, `/deals/${deal}`);
  await next(page).locator("li.arow", { hasText: s }).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const row = await actRow(id);
  const leftNext = !(await text(next(page))).includes(s);
  const tl = [];
  for (const p of [`/deals/${deal}`, `/people/${person}`, `/organisations/${org}`]) {
    await go(page, p);
    const e = timeline(page).locator("li", { hasText: s });
    const t = (await e.count()) === 1 ? (await e.innerText()).replace(/\s+/g, " ") : `count ${await e.count()}`;
    tl.push(t);
  }
  const tlOk = tl.every((t) => t.includes("ACTIVITY") && /call/i.test(t) && t.includes("Tick note line") && t.includes("Done by Ada Fake") && /\d\d:\d\d/.test(t));
  // from the Activities list
  const s2 = sub("Tick from list");
  const id2 = await mkAct({ subject: s2, dealId: deal });
  await go(page, `/activities?assignee=all`);
  await page.locator(`#activity-${id2}`).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const r2 = await actRow(id2);
  const listOk = r2.done_at !== null && Number(r2.done_by) === ADA && !(await page.textContent("main")).includes(s2) && (await page.getByRole("dialog").count()) === 0;
  check("US2 scenario 1", row.done_at && Number(row.done_by) === ADA && leftNext && tlOk && listOk,
    `done_by ${row.done_by} at ${row.done_at && row.done_at.toISOString()}; left NEXT ${leftNext}; timelines ${JSON.stringify(tl)}; list tick ${listOk} (no follow-up box there)`);
});

S("US2 scenario 2", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg(sub("Fu org")); const person = await mkPerson("Fu", "Sfperson", org); const deal = await mkDeal(sub("Fu deal"), person, org);
  const s = sub("Before follow-up");
  await mkAct({ subject: s, dealId: deal, personId: person, orgId: org, assignee: LINUS, assignedBy: LINUS, by: LINUS });
  await go(page, `/deals/${deal}`);
  await next(page).locator("li.arow", { hasText: s }).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const dlg = page.getByRole("dialog", { name: "Schedule a follow-up?" });
  const opened = (await dlg.count()) === 1;
  const v = opened ? await pickerValues(page) : {};
  const assignee = opened ? await dlg.getByLabel("Assigned to").inputValue() : "";
  const date = opened ? await dlg.getByLabel("Date").inputValue() : "x";
  const prefillOk = v.dealId === String(deal) && v.personId === String(person) && v.orgId === String(org) && assignee === String(LINUS) && date === "";
  await dlg.getByRole("link", { name: "[ NOT NOW ]" }).click(); await settle(page);
  const closed = (await page.getByRole("dialog").count()) === 0;
  // tick again (another one) and save a follow-up
  const s2 = sub("Second"); await mkAct({ subject: s2, dealId: deal, personId: person, orgId: org });
  await go(page, `/deals/${deal}`);
  await next(page).locator("li.arow", { hasText: s2 }).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const fu = sub("Follow-up task");
  await fillBox(page, { type: "Task", subject: fu, dueOn: addDays(TODAY, 7) }); await save(page);
  const saved = (await text(next(page))).includes(fu) && (await page.getByRole("dialog").count()) === 0;
  const [r] = await db`select deal_id::int, person_id::int, organisation_id::int, type from activities where subject = ${fu}`;
  // in the drawer
  const s3 = sub("Drawer tick"); await mkAct({ subject: s3, dealId: deal });
  await go(page, `/deals?pipeline=1&open=${deal}`);
  const drawer = page.getByRole("complementary", { name: "Deal" });
  await drawer.getByRole("region", { name: "Next activities" }).locator("li.arow", { hasText: s3 }).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const drawerFu = (await page.getByRole("dialog", { name: "Schedule a follow-up?" }).count()) === 1;
  check("US2 scenario 2", opened && prefillOk && closed && saved && r && r.deal_id === deal && r.person_id === person && drawerFu,
    `box opened ${opened}; prefill ${JSON.stringify(v)} assignee ${assignee} date "${date}"; NOT NOW closes ${closed}; follow-up saved ${saved} ${JSON.stringify(r)}; drawer box ${drawerFu}`);
});

S("US2 scenario 3", async () => {
  const page = await pageAs(ADA);
  const deal = await mkDeal(sub("Untick deal"));
  const s = sub("Untick me");
  const due = addDays(TODAY, 3);
  const id = await mkAct({ subject: s, dealId: deal, dueOn: due, dueTime: "14:00", doneAt: new Date() });
  await go(page, `/deals/${deal}`);
  const before = (await timeline(page).locator("li", { hasText: s }).count()) === 1;
  await timeline(page).locator("li", { hasText: s }).getByRole("button", { name: "Mark not done" }).click(); await settle(page);
  const inTl = await timeline(page).locator("li", { hasText: s }).count();
  const nx = await text(next(page).locator("li.arow", { hasText: s }));
  const r = await actRow(id);
  check("US2 scenario 3", before && inTl === 0 && nx.includes(`${dayText(due)} 14:00`) && r.done_at === null,
    `on timeline before ${before}; after untick timeline entries ${inTl}; NEXT row "${nx.replace(/\s+/g, " ")}"`);
});

async function lastContacted(page, person) {
  await go(page, `/people/${person}`);
  const dd = page.locator("dt", { hasText: "Last contacted" }).locator("xpath=following-sibling::dd[1]");
  return ((await text(dd)) || "").trim();
}
S("US2 scenario 4", async () => {
  const page = await pageAs(ADA);
  const p1 = await mkPerson("Lc", "Sfone"); const p2 = await mkPerson("Lc", "Sftwo"); const p3 = await mkPerson("Lc", "Sfthree");
  const a1 = await mkAct({ subject: sub("past call"), personId: p1, dueOn: "2026-11-20" });
  const a2 = await mkAct({ subject: sub("future call"), personId: p2, dueOn: "2026-11-30" });
  const a3 = await mkAct({ subject: sub("task"), type: "task", personId: p3, dueOn: "2026-11-20" });
  const tick = async (person, id) => { await go(page, `/people/${person}`); await page.locator(`#activity-${id}`).getByRole("button", { name: "Mark done" }).click(); await settle(page); };
  await tick(p1, a1); const lc1 = await lastContacted(page, p1);
  await tick(p2, a2); const lc2 = await lastContacted(page, p2);
  await tick(p3, a3); const lc3 = await lastContacted(page, p3);
  // untick does not move it back
  await go(page, `/people/${p1}`);
  await timeline(page).locator(`#activity-${a1}`).getByRole("button", { name: "Mark not done" }).click(); await settle(page);
  const lc1b = await lastContacted(page, p1);
  // a later call that is earlier than the current value does not lower it
  const a4 = await mkAct({ subject: sub("older call"), personId: p1, dueOn: "2026-11-10", type: "meeting" });
  await tick(p1, a4); const lc1c = await lastContacted(page, p1);
  const ok = lc1.includes("20 Nov 2026") && lc2.includes(dayText(TODAY)) && /never/i.test(lc3) && lc1b.includes("20 Nov 2026") && lc1c.includes("20 Nov 2026");
  check("US2 scenario 4", ok, `call due 20 Nov → "${lc1}"; call due 30 Nov ticked today → "${lc2}"; task → "${lc3}"; after untick → "${lc1b}"; older meeting → "${lc1c}"`);
});

S("Edge case 9", async () => {
  const page = await pageAs(ADA);
  const p = await mkPerson("Early", "Sfticker");
  const id = await mkAct({ subject: sub("early meeting"), type: "meeting", personId: p, dueOn: addDays(TODAY, 10), dueTime: "10:00" });
  const t0 = Date.now();
  await go(page, `/people/${p}`);
  await page.locator(`#activity-${id}`).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const [r] = await db`select last_contacted_at from persons where id = ${p}`;
  const lc = await lastContacted(page, p);
  const near = r.last_contacted_at && Math.abs(r.last_contacted_at.getTime() - t0) < 60_000;
  check("Edge case 9", near && lc.includes(dayText(TODAY)), `Last contacted stored ${r.last_contacted_at && r.last_contacted_at.toISOString()}, shown "${lc}"`);
});

S("US3 scenario 1", async () => {
  const page = await pageAs(MARGARET);
  // 60 planned activities for Margaret: some overdue, same-day timed and untimed
  const d1 = addDays(TODAY, 2);
  await mkAct({ subject: "SF109 M untimed", dueOn: d1, assignee: MARGARET, by: MARGARET });
  await mkAct({ subject: "SF109 M timed late", dueOn: d1, dueTime: "18:00", assignee: MARGARET, by: MARGARET });
  await mkAct({ subject: "SF109 M overdue", dueOn: addDays(TODAY, -2), assignee: MARGARET, by: MARGARET, dealId: 1, personId: 1, orgId: 1 });
  for (let i = 0; i < 57; i++) await mkAct({ subject: `SF109 M bulk ${i}`, dueOn: addDays(TODAY, 5 + (i % 10)), assignee: MARGARET, by: MARGARET });
  const expected = (await db`select count(*)::int n from activities a where assignee_id = ${MARGARET} and done_at is null
    and (person_id is null or exists (select 1 from persons p where p.id = a.person_id and (not p.private or p.created_by = ${MARGARET} or p.owner_id = ${MARGARET})))
    and (deal_id is null or exists (select 1 from deals d where d.id = a.deal_id and (not d.private or d.created_by = ${MARGARET} or d.owner_id = ${MARGARET})))`)[0].n;
  await go(page, "/activities");
  const count = await text(page.locator(".count-line"));
  const rows = page.locator("table.activities-list tbody tr");
  const n = await rows.count();
  const subjects = await rows.locator(".subj").allTextContents();
  const firstRow = (await rows.first().innerText()).replace(/\s+/g, " ");
  const firstLinks = await rows.first().locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const hasBox = (await rows.first().getByRole("button", { name: "Mark done" }).count()) === 1;
  const iT = subjects.indexOf("SF109 M timed late"), iU = subjects.indexOf("SF109 M untimed");
  const others = (await db`select count(*)::int n from activities where assignee_id <> ${MARGARET} and done_at is null`)[0].n;
  const allMine = !subjects.some((s) => s.startsWith("Fake ")); // seed activities are not Margaret's
  check("US3 scenario 1", count.includes(`${expected} ACTIVITIES`) && n === 50 && subjects[0] === "SF109 M overdue" && iT >= 0 && iT < iU && hasBox
    && firstLinks.includes("/deals/1") && firstLinks.includes("/people/1") && firstLinks.includes("/organisations/1") && allMine,
    `count "${count.trim()}" (expected ${expected}); rows on page 1: ${n}; first "${firstRow.slice(0, 160)}"; links ${JSON.stringify(firstLinks.filter((h) => !/activity=|delete/.test(h)))}; timed(${iT}) before untimed(${iU}); others' planned not shown ${allMine}`);
});

S("US3 scenario 2", async () => {
  const page = await pageAs(ADA);
  const deal = await mkDeal(sub("State deal"));
  const nowUk = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const [h] = nowUk.split(":").map(Number);
  const sPast = sub("yesterday"), sEarly = sub("today early"), sDur = sub("today with duration"), sLate = sub("today late");
  await mkAct({ subject: sPast, dealId: deal, dueOn: addDays(TODAY, -1) });
  await mkAct({ subject: sEarly, dealId: deal, dueOn: TODAY, dueTime: "00:05" });
  // started before now, but its duration has not passed (only checkable when now is after 01:00)
  if (h >= 1 && h <= 21) await mkAct({ subject: sDur, dealId: deal, dueOn: TODAY, dueTime: `${String(h - 1).padStart(2, "0")}:00`, duration: 180 });
  await mkAct({ subject: sLate, dealId: deal, dueOn: TODAY, dueTime: "23:55" });
  await go(page, `/deals/${deal}`);
  const mark = async (s) => { const li = next(page).locator("li.arow", { hasText: s }); const od = li.locator(".od"); const td = li.locator(".td");
    return { od: await text(od), td: await text(td), color: (await od.count()) ? await od.evaluate((e) => getComputedStyle(e).color) : null }; };
  const m = { past: await mark(sPast), early: await mark(sEarly), late: await mark(sLate), dur: h >= 1 && h <= 21 ? await mark(sDur) : "skipped" };
  await go(page, "/activities?assignee=all&when=overdue");
  const listOd = await text(page.locator("tr", { hasText: sPast }).locator(".od"));
  const red = (c) => c && /rgb\((1[5-9]\d|2\d\d), (\d|[1-7]\d), (\d|[1-7]\d)\)/.test(c);
  const ok = /overdue/i.test(m.past.od) && red(m.past.color) && /overdue/i.test(m.early.od) && /today/i.test(m.late.td) && !m.late.od
    && (m.dur === "skipped" || (/today/i.test(m.dur.td) && !m.dur.od)) && /overdue/i.test(listOd);
  check("US3 scenario 2", ok, `UK now ${nowUk}; marks ${JSON.stringify(m)}; list mark "${listOd}"`);
});

S("US3 scenario 3", async () => {
  const page = await pageAs(ADA);
  const vis = (u) => db`(a.person_id is null or exists (select 1 from persons p where p.id = a.person_id and (not p.private or p.created_by = ${u} or p.owner_id = ${u})))
    and (a.deal_id is null or exists (select 1 from deals d where d.id = a.deal_id and (not d.private or d.created_by = ${u} or d.owner_id = ${u})))`;
  // a Sunday-of-this-week and next-Monday activity for "This week"
  const dow = (new Date(TODAY + "T12:00:00Z").getUTCDay() + 6) % 7; const mon = addDays(TODAY, -dow), sun = addDays(mon, 6);
  await mkAct({ subject: "SF109 W sunday", dueOn: sun }); await mkAct({ subject: "SF109 W next monday", dueOn: addDays(mon, 7) });
  await mkAct({ subject: "SF109 W monday", dueOn: mon });
  const now = new Date();
  const sets = {
    overdue: db`a.done_at is null and (a.due_on < ${TODAY}::date or (a.due_on = ${TODAY}::date and a.due_time is not null and ((a.due_on + a.due_time) at time zone 'Europe/London') + make_interval(mins => coalesce(a.duration_minutes,0)) <= ${now}))`,
    today: db`a.done_at is null and a.due_on = ${TODAY}::date`,
    week: db`a.done_at is null and a.due_on between ${mon}::date and ${sun}::date`,
    planned: db`a.done_at is null`,
    done: db`a.done_at is not null`,
  };
  const out = {};
  let ok = true;
  for (const [when, cond] of Object.entries(sets)) {
    const exp = await db`select subject from activities a where ${cond} and ${vis(ADA)} order by ${when === "done" ? db`a.done_at desc, a.id desc` : db`a.id`}`;
    await go(page, `/activities?assignee=all`);
    await page.getByRole("navigation", { name: "Show" }).getByRole("link", { name: { overdue: "Overdue", today: "Today", week: "This week", planned: "Planned", done: "Done" }[when], exact: true }).click();
    await settle(page);
    const got = await page.locator("table.activities-list tbody tr .subj").allTextContents();
    const count = await text(page.locator(".count-line"));
    const expS = exp.map((r) => r.subject);
    const same = when === "done" ? JSON.stringify(got) === JSON.stringify(expS.slice(0, 50)) : (expS.length > 50 ? got.length === 50 : [...got].sort().join("|") === [...expS].sort().join("|"));
    const cur = await page.getByRole("navigation", { name: "Show" }).locator('[aria-current="page"]').textContent();
    out[when] = { exp: expS.length, got: got.length, same, count: count.trim(), url: page.url().replace(BASE, ""), cur };
    if (!same || !count.includes(String(expS.length))) ok = false;
  }
  ok = ok && out.week.same && !out.week.url.includes("x");
  check("US3 scenario 3", ok, JSON.stringify(out));
});

S("US3 scenario 4", async () => {
  const page = await pageAs(ADA);
  await mkAct({ subject: "SF109 Linus meeting", type: "meeting", assignee: LINUS, by: LINUS });
  await mkAct({ subject: "SF109 Linus call", type: "call", assignee: LINUS, by: LINUS });
  await mkAct({ subject: "SF109 Alan task", type: "task", assignee: ALAN });
  await go(page, "/activities");
  const opts = await page.getByLabel("Assignee").locator("option").allTextContents();
  await Promise.all([page.waitForURL(/assignee=3/), page.getByLabel("Assignee").selectOption(String(LINUS))]); await settle(page);
  await Promise.all([page.waitForURL(/type=meeting/), page.getByLabel("Type").selectOption("meeting")]); await settle(page);
  const url = page.url();
  const got = await page.locator("table.activities-list tbody tr .subj").allTextContents();
  const exp = (await db`select subject from activities where assignee_id = ${LINUS} and type = 'meeting' and done_at is null`).map((r) => r.subject);
  const p2 = await pageAs(GRACE); await p2.goto(url); await settle(p2);
  const shared = await p2.locator("table.activities-list tbody tr .subj").allTextContents();
  await go(page, "/activities?assignee=5"); const alan = await page.locator("table.activities-list tbody tr .subj").allTextContents();
  await go(page, "/activities?assignee=all&type=task"); const types = await page.locator("table.activities-list tbody tr").evaluateAll((rs) => rs.map((r) => r.children[1].textContent.trim().toLowerCase()));
  const ok = [...got].sort().join() === [...exp].sort().join() && got.includes("SF109 Linus meeting") && !got.includes("SF109 Linus call")
    && JSON.stringify(shared) === JSON.stringify(got) && opts.includes("Assignee: Everyone") && opts.some((o) => o.includes("Alan Fake (deactivated)"))
    && alan.includes("SF109 Alan task") && types.every((t) => t === "task");
  check("US3 scenario 4", ok, `url ${url.replace(BASE, "")}; rows ${JSON.stringify(got)} expected ${JSON.stringify(exp)}; same for another user ${JSON.stringify(shared)}; assignee options ${JSON.stringify(opts)}; deactivated Alan rows ${JSON.stringify(alan)}; type=task types ${[...new Set(types)]}`);
});

S("US3 scenario 5", async () => {
  const page = await pageAs(ADA);
  await go(page, "/activities?assignee=5&type=meeting");
  const body = await page.textContent("main");
  const btn = await page.locator(".empty").getByRole("link", { name: "[ SCHEDULE ACTIVITY ]" }).count();
  check("US3 scenario 5", body.includes("No activities here.") && btn === 1 && (await page.locator("table.activities-list").count()) === 0, `empty text shown ${body.includes("No activities here.")}; button ${btn}`);
});

S("US3 scenario 6", async () => {
  const page = await pageAs(ADA);
  await go(page, "/activities");
  await page.locator(".head-acts").getByRole("link", { name: "[ SCHEDULE ACTIVITY ]" }).click();
  await page.getByRole("dialog").waitFor();
  const v = await pickerValues(page);
  const s = sub("No link");
  await fillBox(page, { subject: s, dueOn: TOMORROW, type: "Task" }); await save(page);
  const [r] = await db`select deal_id, person_id, organisation_id from activities where subject = ${s}`;
  await go(page, "/activities?activity=new");
  const s2 = sub("With org");
  const box = page.getByRole("dialog");
  await box.getByRole("combobox", { name: "Organisation" }).fill("Sample Studios");
  await box.getByRole("listbox", { name: "Organisations" }).getByRole("button", { name: "Sample Studios Fake" }).click();
  await fillBox(page, { subject: s2, dueOn: TOMORROW }); await save(page);
  const [r2] = await db`select organisation_id::int from activities where subject = ${s2}`;
  const listed = (await page.textContent("main")).includes(s);
  check("US3 scenario 6", !v.dealId && !v.personId && !v.orgId && r && r.deal_id === null && r.person_id === null && r.organisation_id === null && r2 && r2.organisation_id === 3 && listed,
    `prefill ${JSON.stringify(v)}; no-link saved ${!!r} and listed ${listed}; with org ${JSON.stringify(r2)}`);
});

async function card(page, title) { return page.locator("a.card", { hasText: title }); }
S("US4 scenario 1", async () => {
  const page = await pageAs(ADA);
  const t = sub("Bare deal"); await mkDeal(t);
  await go(page, "/deals?pipeline=1");
  const c = await card(page, t);
  const w = c.locator(".warnline");
  const last = await c.evaluate((e) => (e.lastElementChild ? e.lastElementChild.className : ""));
  const color = (await w.count()) ? await w.evaluate((e) => getComputedStyle(e).color) : null;
  // "Intro call" from the seed too
  const seeded = await text((await card(page, "Intro call")).locator(".warnline"));
  check("US4 scenario 1", (await text(w)).includes("⚠ No next activity") && last.includes("warnline") && color === "rgb(180, 83, 9)" && seeded.includes("No next activity"),
    `line "${await text(w)}", last child class "${last}", colour ${color}; seeded Intro call "${seeded}"`);
});

S("US4 scenario 2", async () => {
  const page = await pageAs(ADA);
  const t1 = sub("Next deal"), t2 = sub("Overdue deal");
  const d1 = await mkDeal(t1), d2 = await mkDeal(t2);
  const later = addDays(TODAY, 4), later2 = addDays(TODAY, 9);
  await mkAct({ subject: sub("a"), dealId: d1, dueOn: later2, type: "task" });
  await mkAct({ subject: sub("b"), dealId: d1, dueOn: later, type: "call" });
  await mkAct({ subject: sub("c"), dealId: d1, dueOn: addDays(TODAY, -30), type: "task", doneAt: new Date() });
  await mkAct({ subject: sub("d"), dealId: d2, dueOn: addDays(TODAY, -2), type: "meeting" });
  await go(page, "/deals?pipeline=1");
  const c1 = await card(page, t1), c2 = await card(page, t2);
  const l1 = await text(c1.locator(".nextline")), l2 = await text(c2.locator(".nextline"));
  const [, m, d] = later.split("-"); const exp1 = `Next: ${d} ${MON[+m - 1]} · Call`;
  const od2 = c2.locator(".nextline .od");
  const color = (await od2.count()) ? await od2.evaluate((e) => getComputedStyle(e).color) : null;
  const ok = l1.includes(exp1) && !(await c1.locator(".od").count()) && !(await c1.locator(".warnline").count()) && /Meeting/.test(l2) && /overdue/i.test(await text(od2)) && !(await c2.locator(".warnline").count());
  check("US4 scenario 2", ok, `card 1 "${l1}" (expected "${exp1}"); card 2 "${l2}" overdue colour ${color}`);
});

S("US4 scenario 3", async () => {
  const page = await pageAs(ADA);
  const t = sub("Drawer deal"); const d = await mkDeal(t);
  await go(page, "/deals?pipeline=1");
  await (await card(page, t)).click(); await settle(page);
  const drawer = page.getByRole("complementary", { name: "Deal" });
  const reg = drawer.getByRole("region", { name: "Next activities" });
  const hasSched = await reg.getByRole("link", { name: "[ SCHEDULE ACTIVITY ]" }).count();
  await reg.getByRole("link", { name: "[ SCHEDULE ACTIVITY ]" }).click(); await page.getByRole("dialog").waitFor();
  const s = sub("Drawer task");
  await fillBox(page, { type: "Task", subject: s, dueOn: addDays(TODAY, 6) }); await save(page);
  const inDrawer = (await text(drawer.getByRole("region", { name: "Next activities" }))).includes(s);
  const boxes = await drawer.getByRole("region", { name: "Next activities" }).getByRole("button", { name: "Mark done" }).count();
  // close the drawer
  await page.keyboard.press("Escape"); await settle(page);
  if (await page.getByRole("complementary", { name: "Deal" }).count()) { const close = page.getByRole("complementary", { name: "Deal" }).getByRole("link", { name: /close|×|\[ X \]/i }); if (await close.count()) { await close.first().click(); await settle(page); } else await go(page, "/deals?pipeline=1"); }
  const l1 = await text((await card(page, t)).locator(".nextline"));
  // tick in the drawer
  await (await card(page, t)).click(); await settle(page);
  await page.getByRole("complementary", { name: "Deal" }).getByRole("region", { name: "Next activities" }).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  if (await page.getByRole("dialog").count()) { await page.getByRole("dialog").getByRole("link", { name: "[ NOT NOW ]" }).click(); await settle(page); }
  await page.keyboard.press("Escape"); await settle(page);
  if (await page.getByRole("complementary", { name: "Deal" }).count()) await go(page, "/deals?pipeline=1");
  const l2 = await text((await card(page, t)).locator(".warnline"));
  check("US4 scenario 3", hasSched === 1 && inDrawer && boxes === 1 && /Next: .* · Task/.test(l1) && l2.includes("No next activity"),
    `drawer has SCHEDULE ${hasSched}, scheduled shown ${inDrawer}, done boxes ${boxes}; card after schedule "${l1}"; after tick "${l2}"`);
});

S("US4 scenario 4", async () => {
  const t = sub("Hidden act deal"); const d = await mkDeal(t, null, null, { by: LINUS });
  await mkAct({ subject: sub("on Gus"), dealId: d, personId: 32, assignee: ADA }); // Gus Lorem: private, Ada and Margaret only
  const linus = await pageAs(LINUS); await go(linus, "/deals?pipeline=1");
  const lLine = (await text((await card(linus, t)).locator(".warnline"))) + (await text((await card(linus, t)).locator(".nextline")));
  const ada = await pageAs(ADA); await go(ada, "/deals?pipeline=1");
  const aLine = await text((await card(ada, t)).locator(".nextline"));
  check("US4 scenario 4", lLine.includes("No next activity") && aLine.startsWith("Next:"), `Linus (cannot see Gus) "${lLine}"; Ada "${aLine}"`);
});

S("US5 scenario 1", async () => {
  const secret = "Fake call: secret project check-in"; // seed: on private deal 44 (Ada created, Margaret owner), org 2
  const gus = "Fake task: private follow-up with Gus"; // seed: private person 32
  const out = {};
  let ok = true;
  for (const [u, name] of [[GRACE, "Grace (admin)"], [LINUS, "Linus"]]) {
    const page = await pageAs(u);
    const seen = [];
    for (const when of ["overdue", "today", "week", "planned", "done"]) {
      await go(page, `/activities?assignee=all&when=${when}`);
      const main = await page.locator("main").innerText();
      const count = Number((/(\d+) ACTIVIT/.exec(await text(page.locator(".count-line"))) || [])[1]);
      const n = await page.locator("table.activities-list tbody tr").count();
      if (main.includes(secret) || main.includes(gus)) seen.push(when);
      if (when === "planned") {
        const exp = (await db`select count(*)::int n from activities a where done_at is null
          and (person_id is null or exists (select 1 from persons p where p.id = a.person_id and (not p.private or p.created_by = ${u} or p.owner_id = ${u})))
          and (deal_id is null or exists (select 1 from deals d where d.id = a.deal_id and (not d.private or d.created_by = ${u} or d.owner_id = ${u})))`)[0].n;
        out[name + " planned count"] = `${count} (expected ${exp})`;
        if (count !== exp) ok = false;
      }
    }
    for (const p of ["/organisations/2", "/people/22", "/organisations/2?timeline=100", "/deals?pipeline=1"]) {
      await go(page, p); const b = await page.locator("main").innerText();
      if (b.includes(secret) || b.includes(gus) || b.includes("Fake secret project")) seen.push(p);
    }
    out[name] = seen;
    if (seen.length) ok = false;
  }
  const marg = await pageAs(MARGARET); await go(marg, "/activities?assignee=all");
  const margSees = (await marg.locator("main").innerText()).includes(secret);
  check("US5 scenario 1", ok && margSees, `${JSON.stringify(out)}; Margaret (owner) sees it ${margSees}`);
});

S("US5 scenario 2", async () => {
  const page = await pageAs(ADA);
  await go(page, "/deals/44?activity=new"); // private: Ada (creator), Margaret (owner)
  const opts = await page.getByRole("dialog").getByLabel("Assigned to").locator("option").allTextContents();
  const before = (await db`select count(*)::int n from activities`)[0].n;
  await page.evaluate(() => { const s = document.querySelector('select[name="assigneeId"]'); const o = document.createElement("option"); o.value = "2"; o.textContent = "Grace"; s.appendChild(o); s.value = "2"; });
  await fillBox(page, { subject: sub("to Grace"), dueOn: TOMORROW }); await save(page);
  const msg = await page.getByRole("dialog").innerText();
  const after = (await db`select count(*)::int n from activities`)[0].n;
  check("US5 scenario 2", JSON.stringify(opts) === JSON.stringify(["Ada Fake", "Margaret Fake"]) && msg.includes("Grace Fake can't see this record, so the activity can't be assigned to them.") && after === before,
    `assignees offered ${JSON.stringify(opts)}; direct Grace: ${/can't see this record[^\n]*/.exec(msg)}; saved ${after - before}`);
});

S("US5 scenario 3", async () => {
  const page = await pageAs(LINUS);
  const hidden = 11; // seed: on private deal 44
  const before = await actRow(hidden);
  const mine = await mkAct({ subject: sub("Linus own"), assignee: LINUS, by: LINUS });
  const MSG = "This activity doesn't exist or you can't see it.";
  // view
  await go(page, `/activities?activity=${hidden}`); const viewBox = await page.getByRole("dialog").count();
  await go(page, `/deals/44`); const dealPage = (await page.locator("main").innerText()).slice(0, 200);
  // edit
  await go(page, `/activities?activity=${mine}`);
  await page.evaluate((id) => { document.querySelector('.actbox input[name="id"]').value = String(id); document.querySelector('.actbox input[name="version"]').value = "1"; }, hidden);
  await fillBox(page, { subject: "Hijack" }); await save(page);
  const editMsg = (await page.getByRole("dialog").innerText()).includes(MSG);
  // tick
  await go(page, `/activities`);
  await page.locator(`#activity-${mine} input[name="id"]`).evaluate((e, id) => (e.value = String(id)), hidden);
  await page.locator(`#activity-${mine}`).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const tickMsg = (await page.textContent("main")).includes(MSG);
  // untick
  await go(page, `/activities?when=done`);
  const doneHidden = 0;
  // delete
  await go(page, `/activities?delete-activity=${mine}`);
  await page.locator('[role=alertdialog] input[name="id"]').evaluate((e, id) => (e.value = String(id)), hidden);
  await page.getByRole("alertdialog").getByRole("button").last().click(); await settle(page);
  const delMsg = (await page.textContent("main")).includes(MSG);
  const after = await actRow(hidden);
  const unchanged = after && after.version === before.version && after.subject === before.subject && after.done_at === null;
  check("US5 scenario 3", viewBox === 0 && editMsg && tickMsg && delMsg && unchanged && (await actRow(mine)),
    `view box ${viewBox}; edit msg ${editMsg}; tick msg ${tickMsg}; delete msg ${delMsg}; hidden activity unchanged ${unchanged}; deal 44 page "${dealPage.replace(/\s+/g, " ").slice(0, 80)}"`);
});

S("US5 scenario 4", async () => {
  // Alan (deactivated) owns private deal 52 and private person 35
  const s1 = sub("on leaver deal"), s2 = sub("on Sam");
  await mkAct({ subject: s1, dealId: 52, assignee: ALAN, by: ALAN });
  await mkAct({ subject: s2, personId: 35, assignee: ALAN, by: ALAN });
  const linus = await pageAs(LINUS);
  await go(linus, "/deals/52"); const beforeSee = (await linus.locator("main").innerText()).includes(s1);
  const ada = await pageAs(ADA);
  await go(ada, "/admin/users?handover=5");
  const form = ada.locator("form.handover").first();
  await form.getByLabel("Hand over to").selectOption(String(LINUS));
  await form.getByRole("button", { name: "[ HAND OVER ]" }).click(); await settle(ada);
  await go(linus, "/deals/52"); const d = await text(next(linus));
  await go(linus, "/people/35"); const p = await text(next(linus));
  const ok = !beforeSee && d.includes(s1) && d.includes("Alan Fake (deactivated)") && p.includes(s2) && p.includes("Alan Fake (deactivated)");
  check("US5 scenario 4", ok, `before hand-over Linus sees it ${beforeSee}; deal NEXT "${d.replace(/\s+/g, " ").slice(0, 160)}"; person NEXT "${p.replace(/\s+/g, " ").slice(0, 160)}"`);
});

S("US6 scenario 1", async () => {
  const ada = await pageAs(ADA), linus = await pageAs(LINUS);
  const n0 = await unread(linus);
  await go(ada, "/deals/1?activity=new");
  const s = sub("for Linus");
  await fillBox(ada, { type: "Call", subject: s, dueOn: TOMORROW, dueTime: "10:00", duration: 30, assignee: LINUS }); await save(ada);
  await go(linus, "/people");
  const side = await text(linus.getByRole("link", { name: /^Notifications/ }).first());
  await go(linus, "/notifications");
  const items = await linus.getByRole("list", { name: "Notifications" }).locator("li").allInnerTexts();
  const first = (items[0] || "").replace(/\s+/g, " ");
  // edit to make Linus the assignee
  const s2 = sub("reassigned to Linus"); const id2 = await mkAct({ subject: s2, dealId: 1 });
  await go(ada, `/deals/1?activity=${id2}`); await fillBox(ada, { assignee: LINUS }); await save(ada);
  const n2 = await unread(linus);
  const items2 = await linus.getByRole("list", { name: "Notifications" }).locator("li").allInnerTexts();
  const ok = /(\d+)/.exec(side)?.[1] === String(n0 + 1) && first.includes(`Ada Fake assigned you a call: ${s}`) && first.includes(`Due ${dayText(TOMORROW)} 10:00`)
    && n2 === n0 + 2 && (items2[0] || "").includes(`Ada Fake assigned you a call: ${s2}`);
  check("US6 scenario 1", ok, `before ${n0}; sidebar "${side}"; first item "${first}"; after reassign count ${n2}, first "${(items2[0] || "").replace(/\s+/g, " ")}"`);
});

S("US6 scenario 2", async () => {
  const ada = await pageAs(ADA);
  const n0 = await unread(ada);
  const before = (await db`select count(*)::int n from activities where assignee_id = ${ADA} and assigned_by <> ${ADA}`)[0].n;
  await go(ada, "/deals/1?activity=new"); const s = sub("self"); await fillBox(ada, { subject: s, dueOn: TOMORROW, assignee: ADA }); await save(ada);
  const id = await mkAct({ subject: sub("from Linus"), assignee: LINUS, by: LINUS, dealId: 1 });
  await go(ada, `/deals/1?activity=${id}`); await fillBox(ada, { assignee: ADA }); await save(ada);
  const n1 = await unread(ada);
  const after = (await db`select count(*)::int n from activities where assignee_id = ${ADA} and assigned_by <> ${ADA}`)[0].n;
  check("US6 scenario 2", n1 === n0 && after === before, `Ada unread before/after ${n0}/${n1}; assignment notifications ${before}/${after}`);
});

S("US6 scenario 3", async () => {
  const linus = await pageAs(LINUS);
  const org = await mkOrg(sub("Nav org")); const p = await mkPerson("Nav", "Sfperson");
  const targets = [
    [await mkAct({ subject: sub("n deal"), dealId: 3, personId: p, orgId: org, assignee: LINUS, by: ADA }), "/deals/3"],
    [await mkAct({ subject: sub("n person"), personId: p, orgId: org, assignee: LINUS, by: ADA }), `/people/${p}`],
    [await mkAct({ subject: sub("n org"), orgId: org, assignee: LINUS, by: ADA }), `/organisations/${org}`],
    [await mkAct({ subject: sub("n none"), assignee: LINUS, by: ADA }), "/activities"],
  ];
  const out = [];
  let ok = true;
  for (const [id, path] of targets) {
    const n0 = await unread(linus);
    const subj = (await actRow(id)).subject;
    await linus.getByRole("list", { name: "Notifications" }).locator("li", { hasText: subj }).getByRole("button").first().click();
    await settle(linus);
    const landed = new URL(linus.url()).pathname;
    const n1 = await unread(linus);
    const read = (await actRow(id)).assignment_read_at !== null;
    out.push({ path, landed, n0, n1, read });
    if (landed !== path || n1 !== n0 - 1 || !read) ok = false;
  }
  await mkAct({ subject: sub("mark all"), assignee: LINUS, by: ADA, dealId: 3 });
  await go(linus, "/notifications");
  await linus.getByRole("button", { name: "[ MARK ALL AS READ ]" }).click(); await settle(linus);
  const n2 = await unread(linus);
  const left = (await db`select count(*)::int n from activities where assignee_id = ${LINUS} and assigned_by <> ${LINUS} and assignment_read_at is null`)[0].n;
  check("US6 scenario 3", ok && n2 === 0 && left === 0, `${JSON.stringify(out)}; after MARK ALL AS READ count ${n2}, unread assignment rows ${left}`);
});

S("US6 scenario 4", async () => {
  const ada = await pageAs(ADA), linus = await pageAs(LINUS), marg = await pageAs(MARGARET);
  const s = sub("Bob to Cy"); const id = await mkAct({ subject: s, dealId: 3, assignee: LINUS, by: ADA });
  const l0 = await unread(linus); const m0 = await unread(marg);
  const lHas0 = (await linus.locator("main").innerText()).includes(s);
  await go(ada, `/deals/3?activity=${id}`); await fillBox(ada, { assignee: MARGARET }); await save(ada);
  const l1 = await unread(linus); const lHas1 = (await linus.locator("main").innerText()).includes(s);
  const m1 = await unread(marg); const mItem = ((await marg.getByRole("list", { name: "Notifications" }).locator("li", { hasText: s }).allInnerTexts())[0] || "");
  // other fields, tick, untick: Margaret's notification unchanged
  await go(ada, `/deals/3?activity=${id}`); await fillBox(ada, { subject: s + " v2" }); await save(ada);
  await go(ada, "/deals/3"); await next(ada).locator("li.arow", { hasText: s }).getByRole("button", { name: "Mark done" }).click(); await settle(ada);
  await go(ada, "/deals/3"); await timeline(ada).locator("li", { hasText: s }).getByRole("button", { name: "Mark not done" }).click(); await settle(ada);
  const m2 = await unread(marg); const mStill = (await marg.locator("main").innerText()).includes(s + " v2");
  // delete
  const s2 = sub("Bob deleted"); const id2 = await mkAct({ subject: s2, dealId: 3, assignee: LINUS, by: ADA });
  const l2 = await unread(linus);
  await go(ada, `/deals/3?delete-activity=${id2}`); await ada.getByRole("alertdialog").getByRole("button").last().click(); await settle(ada);
  const l3 = await unread(linus); const lHas3 = (await linus.locator("main").innerText()).includes(s2);
  const ok = lHas0 && !lHas1 && l1 === l0 - 1 && m1 === m0 + 1 && mItem.includes(`Ada Fake assigned you a call: ${s}`) && m2 === m1 && mStill && l3 === l2 - 1 && !lHas3;
  check("US6 scenario 4", ok, `Linus ${l0}→${l1} (still listed ${lHas1}); Margaret ${m0}→${m1} "${mItem.replace(/\s+/g, " ")}"; after edit/tick/untick Margaret ${m2} listed ${mStill}; delete: Linus ${l2}→${l3} listed ${lHas3}`);
});

S("US6 scenario 5", async () => {
  const linus = await pageAs(LINUS);
  const t = sub("Hide later"); const d = await mkDeal(t);
  const s = sub("hidden later"); await mkAct({ subject: s, dealId: d, assignee: LINUS, by: ADA });
  const n0 = await unread(linus); const has0 = (await linus.locator("main").innerText()).includes(s);
  await db`update deals set private = true where id = ${d}`;
  const n1 = await unread(linus); const has1 = (await linus.locator("main").innerText()).includes(s);
  await db`update deals set private = false where id = ${d}`;
  const n2 = await unread(linus);
  check("US6 scenario 5", has0 && !has1 && n1 === n0 - 1 && n2 === n0, `visible: listed ${has0} count ${n0}; deal made private: listed ${has1} count ${n1}; shared again: count ${n2}`);
});

S("Edge case 1", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg(sub("Arch org")); const person = await mkPerson("Arch", "Sfperson", org); const d = await mkDeal(sub("Arch deal"), person, org);
  const s = sub("arch planned"), s2 = sub("arch done");
  const id = await mkAct({ subject: s, dealId: d }); await mkAct({ subject: s2, dealId: d, doneAt: new Date() });
  const ida = await mkAct({ subject: sub("arch on person"), personId: person });
  const ido = await mkAct({ subject: sub("arch on org"), orgId: org });
  await go(page, "/activities?assignee=all"); // load the list before archiving (for a direct request)
  await db`update deals set archived_at = now() where id = ${d}`;
  await db`update persons set archived_at = now() where id = ${person}`;
  await db`update organisations set archived_at = now() where id = ${org}`;
  const pages = {};
  for (const [p, subj] of [[`/deals/${d}`, s], [`/people/${person}`, (await actRow(ida)).subject], [`/organisations/${org}`, (await actRow(ido)).subject]]) {
    await go(page, p);
    const nx = next(page);
    pages[p] = { shown: (await text(nx)).includes(subj), sched: await nx.getByRole("link", { name: "[ SCHEDULE ACTIVITY ]" }).count(), boxes: await page.getByRole("button", { name: /Mark (not )?done/ }).count(), edit: await page.getByRole("link", { name: /^(Edit|Delete) SF109/ }).count() };
  }
  await go(page, `/deals/${d}`); const tlDone = (await text(timeline(page))).includes(s2);
  // direct tick: the list row loaded before archiving has a done box
  await go(page, "/activities?assignee=all");
  const row = page.locator(`#activity-${id}`);
  const archivedMark = /archived/i.test(await row.innerText()); const rowBox = await row.getByRole("button", { name: "Mark done" }).count();
  // direct: take another row's form and point it at the archived one
  const other = await mkAct({ subject: sub("direct helper") });
  await go(page, "/activities?assignee=all");
  await page.locator(`#activity-${other} input[name="id"]`).evaluate((e, v) => (e.value = String(v)), id);
  await page.locator(`#activity-${other}`).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const msg = (await page.textContent("main")).includes("Restore this record before changing its activities.");
  const stillPlanned = (await actRow(id)).done_at === null;
  await go(page, `/deals/${d}?activity=new`); const box = await page.getByRole("dialog").count();
  await db`update deals set archived_at = null where id = ${d}`;
  await go(page, "/activities?assignee=all");
  await page.locator(`#activity-${id}`).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const tickedAfter = (await actRow(id)).done_at !== null;
  const ok = Object.values(pages).every((x) => x.shown && x.sched === 0 && x.boxes === 0 && x.edit === 0) && tlDone && archivedMark && rowBox === 0 && msg && stillPlanned && box === 0 && tickedAfter;
  check("Edge case 1", ok, `${JSON.stringify(pages)}; done entry on timeline ${tlDone}; list row "Archived" ${archivedMark}, box ${rowBox}; direct tick message ${msg}, unchanged ${stillPlanned}; ?activity=new box ${box}; ticked after restore ${tickedAfter}`);
});

S("Edge case 2", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg(sub("Multi org")); const person = await mkPerson("Multi", "Sfperson", org); const d = await mkDeal(sub("Multi deal"), person, org);
  const sp = sub("multi planned"), sd = sub("multi done");
  await mkAct({ subject: sp, dealId: d, personId: person, orgId: org }); await mkAct({ subject: sd, dealId: d, personId: person, orgId: org, doneAt: new Date() });
  const counts = {};
  for (const p of [`/deals/${d}`, `/people/${person}`, `/organisations/${org}`]) {
    await go(page, p);
    counts[p] = { next: await next(page).locator("li.arow", { hasText: sp }).count(), tl: await timeline(page).locator("li", { hasText: sd }).count() };
  }
  await go(page, "/activities?assignee=all"); const lp = await page.locator("tbody tr", { hasText: sp }).count();
  await go(page, "/activities?assignee=all&when=done"); const ld = await page.locator("tbody tr", { hasText: sd }).count();
  check("Edge case 2", Object.values(counts).every((c) => c.next === 1 && c.tl === 1) && lp === 1 && ld === 1, `${JSON.stringify(counts)}; list planned ${lp}, done ${ld}`);
});

S("Edge case 3", async () => {
  const page = await pageAs(ADA);
  const t = sub("Won deal"); const d = await mkDeal(t);
  const s = sub("won keeps"); await mkAct({ subject: s, dealId: d });
  await db`update deals set status = 'won', closed_at = now() where id = ${d}`;
  await go(page, `/deals/${d}`); const kept = (await text(next(page))).includes(s);
  await go(page, "/deals?pipeline=1"); const onBoard = await page.locator("a.card", { hasText: t }).count();
  await db`update deals set status = 'open', closed_at = null where id = ${d}`;
  await db`delete from activities where deal_id = ${d}`;
  await go(page, "/deals?pipeline=1"); const back = await text(page.locator("a.card", { hasText: t }).locator(".warnline"));
  check("Edge case 3", kept && onBoard === 0 && back.includes("No next activity"), `won: activity kept ${kept}, on board ${onBoard}; reopened with no planned activity: "${back}"`);
});

S("Edge case 4", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg(sub("Gone org")); const person = await mkPerson("Gone", "Sfperson"); const priv = await mkPerson("Gonepriv", "Sfperson", null, { private: true });
  const d = await mkDeal(sub("Gone deal"));
  const aDeal = await mkAct({ subject: sub("deal only"), dealId: d });
  const aDealP = await mkAct({ subject: sub("deal+person"), dealId: d, personId: person });
  const aPerson = await mkAct({ subject: sub("person only"), personId: person });
  const aPersonO = await mkAct({ subject: sub("person+org"), personId: person, orgId: org });
  const aOrg = await mkAct({ subject: sub("org only"), orgId: org });
  const aPriv = await mkAct({ subject: sub("private+org"), personId: priv, orgId: org });
  const del = async (path) => { await go(page, path + "?confirm=delete"); await page.locator("button.danger-solid").first().click(); await settle(page); };
  await del(`/deals/${d}`);
  const r1 = { dealOnlyGone: !(await actRow(aDeal)), dealPersonKept: (await actRow(aDealP))?.deal_id === null };
  await go(page, `/people/${person}`); r1.shownOnPerson = (await text(next(page))).includes((await actRow(aDealP)).subject);
  await del(`/people/${priv}`);
  r1.privGone = !(await actRow(aPriv));
  await del(`/people/${person}`);
  r1.personOnlyGone = !(await actRow(aPerson)) && !(await actRow(aDealP)); r1.personOrgKept = (await actRow(aPersonO))?.person_id === null;
  await del(`/organisations/${org}`);
  r1.orgGone = !(await actRow(aOrg)) && !(await actRow(aPersonO));
  check("Edge case 4", Object.values(r1).every(Boolean), JSON.stringify(r1));
});

S("Edge case 5", async () => {
  const page = await pageAs(ADA);
  const org = await mkOrg(sub("Keep org")); const org2 = await mkOrg(sub("Other org")); const person = await mkPerson("Keep", "Sfperson", org);
  const d = await mkDeal(sub("Keep deal"), person, org);
  const id = await mkAct({ subject: sub("keep links"), dealId: d, personId: person, orgId: org });
  await db`update deals set person_id = null, organisation_id = ${org2}, version = version + 1 where id = ${d}`;
  const r = await actRow(id);
  await go(page, `/people/${person}`); const onPerson = (await text(next(page))).includes(r.subject);
  await go(page, `/organisations/${org}`); const onOrg = (await text(next(page))).includes(r.subject);
  check("Edge case 5", Number(r.person_id) === person && Number(r.organisation_id) === org && onPerson && onOrg, `links after the deal changed: person ${r.person_id}, org ${r.organisation_id}; shown on person ${onPerson}, org ${onOrg} (deal changed by SQL)`);
});

S("Edge case 6", async () => {
  const page = await pageAs(ADA);
  const d = await mkDeal(sub("Deact deal"));
  const s = sub("for Margaret"); const id = await mkAct({ subject: s, dealId: d, assignee: MARGARET });
  await db`update users set status = 'deactivated' where id = ${MARGARET}`;
  try {
    await go(page, `/deals/${d}`); const row = await text(next(page).locator("li.arow", { hasText: s }));
    await go(page, `/activities?assignee=${MARGARET}`); const listed = (await page.locator("main").innerText()).includes(s);
    await go(page, `/deals/${d}?activity=new`); const newOpts = await page.getByRole("dialog").getByLabel("Assigned to").locator("option").allTextContents();
    await go(page, `/deals/${d}?activity=${id}`); const editOpts = await page.getByRole("dialog").getByLabel("Assigned to").locator("option").allTextContents();
    await fillBox(page, { assignee: LINUS }); await save(page);
    const re = Number((await actRow(id)).assignee_id);
    check("Edge case 6", row.includes("Margaret Fake (deactivated)") && listed && !newOpts.some((o) => o.includes("Margaret")) && !newOpts.some((o) => o.includes("Alan")) && re === LINUS,
      `row "${row.replace(/\s+/g, " ")}"; listed ${listed}; new-form assignees ${JSON.stringify(newOpts)}; edit-form ${JSON.stringify(editOpts)}; reassigned to ${re}`);
  } finally { await db`update users set status = 'active' where id = ${MARGARET}`; }
});

S("Edge case 7", async () => {
  const page = await pageAs(ADA);
  const d = await mkDeal(sub("UK time"));
  const s = sub("0030"); await mkAct({ subject: s, dealId: d, dueOn: TODAY, dueTime: "00:30" });
  await go(page, `/deals/${d}`);
  const li = next(page).locator("li.arow", { hasText: s });
  const nowUk = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const markOk = nowUk >= "00:30" ? /overdue/i.test(await text(li.locator(".od"))) : /today/i.test(await text(li.locator(".td")));
  await go(page, `/deals/${d}?activity=new`);
  const before = (await db`select count(*)::int n from activities`)[0].n;
  await fillBox(page, { subject: sub("gap"), dueOn: "2026-03-29", dueTime: "01:30" }); await save(page);
  const msg = (await page.getByRole("dialog").innerText()).includes("Pick a time that exists in UK time.");
  const after = (await db`select count(*)::int n from activities`)[0].n;
  check("Edge case 7", markOk && msg && after === before, `UK now ${nowUk}: due today 00:30 mark ok ${markOk} (the before-00:30 side needs the clock; unit-tested); 29 Mar 2026 01:30 refused ${msg}, saved ${after - before}`);
});

S("Edge case 8", async () => {
  const page = await pageAs(ADA);
  const d = await mkDeal(sub("Past due"));
  await go(page, `/deals/${d}?activity=new`);
  const s = sub("logged call"); await fillBox(page, { subject: s, dueOn: addDays(TODAY, -5), dueTime: "09:00" }); await save(page);
  const saved = (await text(next(page))).includes(s);
  await next(page).locator("li.arow", { hasText: s }).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  const [r] = await db`select done_at from activities where subject = ${s}`;
  check("Edge case 8", saved && r && r.done_at !== null, `saved with a past date ${saved}; ticked ${!!(r && r.done_at)}`);
});

S("Edge case 10", async () => {
  const page = await pageAs(ADA);
  const d = await mkDeal(sub("Durations"));
  await go(page, `/deals/${d}?activity=new`);
  const opts = await page.getByRole("dialog").getByLabel("Duration").locator("option").evaluateAll((os) => os.map((o) => o.value));
  await fillBox(page, { subject: sub("dur no time"), dueOn: TOMORROW, duration: 30 }); await save(page);
  const m1 = (await page.getByRole("dialog").innerText()).includes("Pick a time before setting a duration.");
  await go(page, `/deals/${d}?activity=new`);
  await page.evaluate(() => { const s = document.querySelector('select[name="duration"]'); const o = document.createElement("option"); o.value = "7"; s.appendChild(o); s.value = "7"; });
  await fillBox(page, { subject: sub("dur 7"), dueOn: TOMORROW, dueTime: "10:00" }); await save(page);
  const m2 = (await page.getByRole("dialog").innerText()).includes("Pick a duration between 5 minutes and 24 hours.");
  await go(page, `/deals/${d}?activity=new`);
  const s = sub("dur 24h"); await fillBox(page, { subject: s, dueOn: TOMORROW, dueTime: "10:00", duration: 1440 }); await save(page);
  const [r] = await db`select duration_minutes from activities where subject = ${s}`;
  const optsOk = opts[0] === "" && opts[1] === "5" && opts[opts.length - 1] === "1440" && opts.length === 289;
  check("Edge case 10", m1 && m2 && r && r.duration_minutes === 1440 && optsOk, `no time: ${m1}; 7 minutes: ${m2}; 24 h saved ${r && r.duration_minutes}; options ${opts.length} (${opts[1]}…${opts[opts.length - 1]})`);
});

S("Edge case 11", async () => {
  const ada = await pageAs(ADA), linus = await pageAs(LINUS);
  const d = await mkDeal(sub("Race deal"));
  const s = sub("race"); const id = await mkAct({ subject: s, dealId: d });
  await go(ada, `/deals/${d}`); await go(linus, `/deals/${d}`);
  const b1 = next(ada).locator("li.arow", { hasText: s }).getByRole("button", { name: "Mark done" });
  const b2 = next(linus).locator("li.arow", { hasText: s }).getByRole("button", { name: "Mark done" });
  await Promise.all([b1.click(), b2.click()]); await settle(ada); await settle(linus);
  const r = await actRow(id);
  const by = Number(r.done_by) === ADA ? "Ada Fake" : "Linus Fake";
  await go(ada, `/deals/${d}`);
  const entries = await timeline(ada).locator("li", { hasText: s }).allInnerTexts();
  check("Edge case 11", entries.length === 1 && entries[0].includes(`Done by ${by}`) && r.version === 2, `entries ${entries.length}: "${(entries[0] || "").replace(/\s+/g, " ")}"; done_by in DB ${by}; version ${r.version} (one tick applied)`);
});

S("Edge case 12", async () => {
  const page = await pageAs(ADA);
  const d = await mkDeal(sub("Plain note"));
  await go(page, `/deals/${d}?activity=new`);
  const note = "<b>bold?</b> line one\nhttps://example.com/x [link](https://e.com)\n\nline four";
  const s = sub("note text"); await fillBox(page, { subject: s + " <i>x</i>", dueOn: TOMORROW, note }); await save(page);
  await next(page).locator("li.arow", { hasText: s }).getByRole("button", { name: "Mark done" }).click(); await settle(page);
  if (await page.getByRole("dialog").count()) { await page.getByRole("dialog").getByRole("link", { name: "[ NOT NOW ]" }).click(); await settle(page); }
  const e = timeline(page).locator("li", { hasText: s });
  const n = e.locator(".actnote");
  const tc = await n.textContent(); const inner = await n.innerHTML();
  const ws = await n.evaluate((x) => getComputedStyle(x).whiteSpace);
  const links = await n.locator("*").count();
  const subjText = await e.locator(".subj").textContent();
  check("Edge case 12", tc === note && !/<a|<b>|<i>/.test(inner) && /pre-wrap|pre-line/.test(ws) && links === 0 && subjText.includes("<i>x</i>"),
    `note text equal ${tc === note}; white-space ${ws}; elements a/b/i inside entry ${links}; subject shown "${subjText}"`);
});

S("Edge case 13", async () => {
  const page = await pageAs(ADA);
  const s = sub("unlinked"); await mkAct({ subject: s });
  await go(page, "/activities"); const listed = (await page.locator("main").innerText()).includes(s);
  let elsewhere = 0;
  for (const p of ["/deals/1", "/people/1", "/organisations/1", "/deals?pipeline=1"]) { await go(page, p); if ((await page.locator("main").innerText()).includes(s)) elsewhere++; }
  check("Edge case 13", listed && elsewhere === 0, `in the Activities list ${listed}; on record pages/board ${elsewhere}`);
});

S("Edge case 14", async () => {
  const page = await pageAs(ADA);
  const d = await mkDeal(sub("Show more"));
  const day = addDays(TODAY, -3);
  const base = new Date(day + "T09:00:00Z").getTime();
  const notes = [];
  for (let i = 0; i < 40; i++) notes.push(db`insert into timeline_events (kind, deal_id, actor_id, body, created_at) values ('note', ${d}, ${ADA}, ${"SF109 note " + i}, ${new Date(base + i * 120000)})`);
  for (const q of notes) await q;
  for (let i = 0; i < 30; i++) await mkAct({ subject: `SF109 more act ${i}`, dealId: d, dueOn: day, doneAt: new Date(base + i * 120000 + 60000) });
  // newer entries on other days
  await go(page, `/deals/${d}`);
  const before = await timeline(page).locator("li").count();
  await timeline(page).getByRole("link", { name: /SHOW MORE/ }).click(); await settle(page);
  const days = await timeline(page).locator(".day").allTextContents();
  const entries = await timeline(page).locator("li").count();
  const acts = await timeline(page).locator("li", { hasText: "SF109 more act" }).count();
  const dup = days.length !== new Set(days).size;
  check("Edge case 14", !dup && acts === 30 && entries > before, `before SHOW MORE ${before} entries; after ${entries} (activities ${acts}); day headings ${JSON.stringify(days)}`);
});

(async () => {
  browser = await chromium.launch();
  for (const [name, fn] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.includes(name)) continue;
    try { await fn(); } catch (e) { check(name, false, "error: " + String(e.message || e).split("\n")[0]); }
  }
  await browser.close(); await db.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? "; failed: " + failed.map((r) => r.name).join(", ") : ""}`);
})();
