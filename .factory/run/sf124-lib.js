// Helpers for the SF-124 AI-review scenario scripts (Google Calendar sync), app on :3000 (start-app.sh: fake Gmail,
// CALENDAR_SYNC=on), database crm_dev. Results are appended to /tmp/sf124-results.json.
const { execFileSync } = require("child_process");
const fs = require("fs");
const lib = require("./lib");
const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DB || "crm_dev";
const A = "ada@barnacle.ai", L = "linus@barnacle.ai", G = "grace@barnacle.ai", M = "margaret@barnacle.ai", AL = "alan@barnacle.ai";

const q = (s) => execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", DB, "-AtF", "|", "-v", "ON_ERROR_STOP=1", "-c", s], { encoding: "utf8" }).trim();
const ctlEnv = { ...process.env, APP_ENV: "development", DATABASE_URL: `postgres://postgres@localhost:5432/${DB}`, GMAIL_TOKEN_KEY: fs.readFileSync("/tmp/gmail-token-key", "utf8").trim(), CALENDAR_SYNC: "on", APP_URL: BASE };
const ctl = (...args) => JSON.parse(execFileSync("npx", ["tsx", ".factory/run/calendar-ctl.ts", ...args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))], { encoding: "utf8", env: ctlEnv }).trim().split("\n").pop());
const events = (email) => ctl("events", email);
const live = (email) => events(email).filter((e) => e.status !== "cancelled");
const eventId = (actId) => q(`select google_event_id from calendar_events where activity_id=${actId}`);
const evOf = (email, actId) => live(email).filter((e) => (e.extendedProperties?.private?.barnacleCrmActivity === String(actId)) || e.id === eventId(actId));
const act = (id) => {
  const r = q(`select type, subject, due_on, coalesce(to_char(due_time,'HH24:MI'),''), coalesce(duration_minutes::text,''), coalesce(note,''), coalesce(deal_id::text,''), coalesce(person_id::text,''), coalesce(organisation_id::text,''), assignee_id, coalesce(done_at::text,''), version from activities where id=${id}`);
  if (!r) return null;
  const [type, subject, dueOn, dueTime, duration, note, deal, person, org, assignee, done, version] = r.split("|");
  return { type, subject, dueOn, dueTime, duration, note, deal, person, org, assignee, done, version };
};
const uid = (e) => q(`select id from users where email='${e}'`);
const S = {};
const R = (name, ok, notes) => {
  S[name] = { ok: !!ok, notes };
  console.log((ok ? "PASS " : "FAIL ") + name + " — " + notes);
  const f = "/tmp/sf124-results.json";
  const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  all[name] = { ok: !!ok, notes };
  fs.writeFileSync(f, JSON.stringify(all, null, 1));
};
const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageAs(browser, email, base = BASE) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  await lib.signIn(p, base, email, "");
  return p;
}
async function card(p, base = BASE) { await p.goto(base + "/settings"); await p.waitForLoadState("networkidle"); return norm(await p.locator('section[aria-label="Gmail"]').innerText()); }
async function warn(p) { return p.locator('a[href="/settings"] .warn').count(); }
// Connect through the fake consent screen; returns { card, consent } (consent: the labels of the scope boxes).
async function connect(p, { untick, cancel, base = BASE } = {}) {
  await p.goto(base + "/settings");
  await Promise.all([p.waitForURL(/fake-google\/gmail/), p.locator('section[aria-label="Gmail"] button', { hasText: /CONNECT GMAIL/ }).click()]);
  const consent = (await p.locator("label.check").allInnerTexts()).map(norm);
  if (untick) await p.locator("label.check", { hasText: untick }).locator("input").uncheck();
  await Promise.all([p.waitForURL(/\/settings(\?|$)/), p.click(cancel ? "text=[ CANCEL ]" : "text=[ ALLOW ]")]);
  await p.waitForLoadState("networkidle");
  return { card: norm(await p.locator('section[aria-label="Gmail"]').innerText()), consent };
}
// The activity box on /activities (or `path`): f = { type, subject, dueOn, dueTime, duration (minutes or ""), assignee (user id), note }.
async function fillBox(p, f) {
  const box = p.getByRole("dialog");
  if (f.type) await box.getByRole("radio", { name: f.type, exact: true }).check({ force: true });
  if (f.subject !== undefined) await box.getByLabel("Subject").fill(f.subject);
  if (f.dueOn !== undefined) await box.getByLabel("Date").fill(f.dueOn);
  if (f.dueTime !== undefined) await box.getByLabel("Time").fill(f.dueTime);
  if (f.duration !== undefined) await box.getByLabel("Duration").selectOption(String(f.duration));
  if (f.assignee !== undefined) await box.getByLabel("Assigned to").selectOption(String(f.assignee));
  if (f.note !== undefined) await box.getByLabel("Note").fill(f.note);
}
async function saveBox(p) {
  await p.getByRole("dialog").getByRole("button", { name: "[ SAVE ]" }).click();
  await p.waitForLoadState("networkidle"); await sleep(600);
  // "Schedule a follow-up?" may appear after a done; close boxes left open
}
async function schedule(p, f, path = "/activities") {
  const sep = path.includes("?") ? "&" : "?";
  await p.goto(BASE + path + sep + "activity=new"); await p.getByRole("dialog").waitFor();
  await fillBox(p, f); await saveBox(p);
  await sleep(1500); // calendarAfterChange runs after the response
  const id = q(`select id from activities where subject='${f.subject.replace(/'/g, "''")}' order by id desc limit 1`);
  return id;
}
async function edit(p, id, f) {
  await p.goto(BASE + "/activities?when=planned&assignee=all&activity=" + id); await p.getByRole("dialog").waitFor();
  await fillBox(p, f); await saveBox(p); await sleep(1500);
}
async function tick(p, id) {
  // the done box of the row on the Activities list (planned or done tab)
  const subj = q(`select subject from activities where id=${id}`);
  const done = q(`select done_at is not null from activities where id=${id}`) === "t";
  await p.goto(BASE + `/activities?when=${done ? "done" : "planned"}&assignee=all`); await p.waitForLoadState("networkidle");
  const row = p.locator("tr", { hasText: subj }).first();
  await row.getByRole("button", { name: done ? "Mark not done" : "Mark done" }).click();
  await p.waitForLoadState("networkidle"); await sleep(1800);
}
async function delAct(p, id) {
  await p.goto(BASE + "/activities?when=planned&assignee=all&delete-activity=" + id);
  await p.getByRole("alertdialog").getByRole("button").first().click();
  await p.waitForLoadState("networkidle"); await sleep(1800);
}
// Fake calendar page.
async function fakePage(p, user) { await p.goto(BASE + "/dev/fake-calendar?user=" + encodeURIComponent(user)); await p.waitForLoadState("networkidle"); }
async function addEvent(p, user, o) {
  await fakePage(p, user);
  const f = p.locator("form").filter({ has: p.locator('textarea[name="description"]') });
  await f.locator('input[name="title"]').fill(o.title ?? "");
  await f.locator('input[name="date"]').fill(o.date);
  if (o.allDay) { await f.locator('input[name="allDay"]').check(); if (o.endDate) await f.locator('input[name="endDate"]').fill(o.endDate); }
  else { await f.locator('input[name="start"]').fill(o.start); await f.locator('input[name="end"]').fill(o.end); }
  if (o.guests) await f.locator('input[name="guests"]').fill(o.guests);
  if (o.organizer) await f.locator('input[name="organizer"]').fill(o.organizer);
  if (o.description) await f.locator('textarea[name="description"]').fill(o.description);
  if (o.recurring) await f.locator('input[name="recurring"]').check();
  if (o.deliver === false) await f.locator('input[name="deliver"]').uncheck();
  await Promise.all([p.waitForURL(/done=/), f.locator('button[type="submit"]').click()]);
  await p.waitForLoadState("networkidle");
  const evs = events(user).filter((e) => e.summary === (o.title ?? ""));
  return { done: new URL(p.url()).searchParams.get("done"), id: evs.length ? evs[evs.length - 1].id : null };
}
async function eventSection(p, user, id) { await fakePage(p, user); return p.locator("section.gm-card").filter({ hasText: "Id: " + id }); }
async function changeEvent(p, user, id, o) {
  const s = await eventSection(p, user, id);
  const f = s.locator("form").first();
  if (o.title !== undefined) await f.locator('input[name="title"]').fill(o.title);
  if (o.date) await f.locator('input[name="date"]').fill(o.date);
  if (o.allDay) await f.locator('input[name="allDay"]').check();
  if (o.start) await f.locator('input[name="start"]').fill(o.start);
  if (o.end) await f.locator('input[name="end"]').fill(o.end);
  if (o.deliver === false) await f.locator('input[name="deliver"]').uncheck();
  await Promise.all([p.waitForURL(/done=/), f.locator('button[type="submit"]').click()]);
  await p.waitForLoadState("networkidle"); await sleep(300);
  return new URL(p.url()).searchParams.get("done");
}
async function eventBtn(p, user, id, idx, deliver = true) { // idx 1 decline, 2 delete
  const s = await eventSection(p, user, id);
  const f = s.locator("form").nth(idx);
  if (!deliver) await f.locator('input[name="deliver"]').uncheck();
  await Promise.all([p.waitForURL(/done=/), f.locator('button[type="submit"]').click()]);
  await p.waitForLoadState("networkidle");
  return new URL(p.url()).searchParams.get("done");
}
async function fakeBtn(p, user, label) { await fakePage(p, user); await Promise.all([p.waitForURL(/done=/), p.locator("button", { hasText: label }).first().click()]); await p.waitForLoadState("networkidle"); return new URL(p.url()).searchParams.get("done"); }
const runCheck = (p, user = A) => fakeBtn(p, user, "[ RUN THE 15-MINUTE CHECK ]");
async function push(headers) { const r = await fetch(BASE + "/calendar/push", { method: "POST", headers }); return { status: r.status, body: await r.text() }; }
function person(first, last, emails, { priv = false, archived = false, owner = 1, org = null } = {}) {
  const id = q(`insert into persons (first_name,last_name,owner_id,consent,private,created_by,archived_at,organisation_id) values ('${first}','${last}',${owner},'subscribed',${priv},${owner},${archived ? "now()" : "null"},${org ?? "null"}) returning id`).split("\n")[0];
  emails.forEach((e, i) => q(`insert into person_emails (person_id,email,position) values (${id},'${e}',${i})`));
  return id;
}
const actCount = (where = "true") => Number(q(`select count(*) from activities where ${where}`));
const iso = (d, t) => { // UK wall clock → instant (Dec/Nov: GMT; BST between last Sun Mar and last Sun Oct)
  return new Date(`${d}T${t}:00Z`).toISOString();
};
module.exports = { lib, BASE, DB, A, L, G, M, AL, q, ctl, events, live, eventId, evOf, act, uid, S, R, norm, sleep, pageAs, card, warn, connect, fillBox, saveBox, schedule, edit, tick, delAct, fakePage, addEvent, eventSection, changeEvent, eventBtn, fakeBtn, runCheck, push, person, actCount, iso };
