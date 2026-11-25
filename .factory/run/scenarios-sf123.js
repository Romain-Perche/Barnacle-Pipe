// SF-123 AI-review scenario script (activity reminders): all 27 scenarios, against the faketime app on :3001
// (`.factory/run/start-faketime-app.sh`, clock from /tmp/ft-time) and crm_dev, except US4 scenario 1 / Edge case 3
// (the fake data at the real clock: app on :3000). Signs in by a `sessions` row. Makes its own "SF123 …" records by SQL
// (deals/people/orgs) and schedules / edits / ticks / deletes activities through the UI. Run:
//   bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules:$PWD/node_modules node .factory/run/scenarios-sf123.js
// ONLY="US1 scenario 1,Edge case 5" runs a subset.
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const { chromium, results, check } = require("./lib.js");
const pg = require("postgres"); const postgres = pg.default || pg;
const BASE = process.env.BASE || "http://localhost:3001";
const REAL = process.env.REAL || "http://localhost:3000";
const db = postgres(process.env.DATABASE_URL || "postgres://postgres@localhost:5432/crm_dev", { prepare: false, max: 3, onnotice: () => {} });
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map((s) => s.trim()) : null;
const ADA = 1, GRACE = 2, LINUS = 3, ALAN = 5;
let browser; const ctxs = {};

// The faketime app's clock (UTC, runs on from there).
async function clock(iso) { fs.writeFileSync("/tmp/ft-time", "@" + iso.replace("T", " ").replace("Z", "") + "\n"); await new Promise((r) => setTimeout(r, 150)); }

async function pageAs(userId, base = BASE) {
  const k = userId + base;
  if (!ctxs[k]) {
    const token = crypto.randomBytes(24).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest();
    await db`insert into sessions (token_hash, user_id, expires_at) values (${hash}, ${userId}, now() + interval '1 day')`;
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addCookies([{ name: "crm_session", value: token, url: base }]);
    ctxs[k] = await ctx.newPage(); ctxs[k].base = base;
  }
  return ctxs[k];
}
async function settle(page) { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); }
async function go(page, path) { await page.goto(page.base + path); await settle(page); }
async function sidebar(page) {
  const t = (await page.getByRole("link", { name: /^Notifications/ }).first().textContent()) || "";
  const m = /(\d+)\s*$/.exec(t.trim()); return m ? Number(m[1]) : 0; // badge "Notifications3" (aria-label "Notifications (3)")
}
// Loads /notifications: { count, lines: [{ id, title, when, preview, unread }] }.
async function notifs(page) {
  await go(page, "/notifications");
  const lines = await page.locator("li.notif").evaluateAll((els) => els.map((e) => ({
    id: e.id, title: e.querySelector(".notif-title")?.textContent || "", when: e.querySelector(".when")?.textContent || "",
    preview: e.querySelector(".notif-preview")?.textContent || "", unread: e.classList.contains("unread"),
    html: e.querySelector(".notif-title")?.innerHTML || "", links: e.querySelectorAll("a").length,
  })));
  return { count: await sidebar(page), lines };
}
const rem = (n, id) => n.lines.filter((l) => l.id === `r-${id}`);
const show = (n, id) => JSON.stringify(rem(n, id).map(({ title, when, preview, unread }) => ({ title, when, preview, unread })));

let seq = 0;
const sub = (s) => `SF123 ${s} ${++seq}`;
async function stage() { return (await db`select id::int from stages where pipeline_id = 1 order by position, id limit 1`)[0].id; }
async function mkOrg(name) { return (await db`insert into organisations (name, created_by, owner_id) values (${name}, 1, 1) returning id::int`)[0].id; }
async function mkPerson(first, last, orgId = null, o = {}) {
  const by = o.by || ADA;
  return (await db`insert into persons (first_name, last_name, organisation_id, created_by, owner_id, private)
    values (${first}, ${last}, ${orgId}, ${by}, ${o.owner || by}, ${!!o.private}) returning id::int`)[0].id;
}
async function mkDeal(title, o = {}) {
  const by = o.by || ADA;
  return (await db`insert into deals (title, stage_id, owner_id, created_by, private, person_id, organisation_id)
    values (${title}, ${await stage()}, ${o.owner || by}, ${by}, ${!!o.private}, ${o.person || null}, ${o.org || null}) returning id::int`)[0].id;
}
const actId = async (subject) => (await db`select id::int from activities where subject = ${subject}`)[0]?.id;
const act = async (id) => (await db`select remind_at, reminder_read_at, assignee_id::int as assignee_id, done_at from activities where id = ${id}`)[0];

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
// Schedules through the box on `path` (a record page or /activities); returns the new id.
async function schedule(page, path, f) {
  await go(page, `${path}?activity=new`); await page.getByRole("dialog").waitFor();
  await fillBox(page, { type: "Call", ...f }); await save(page);
  const id = await actId(f.subject); if (!id) throw new Error("not saved: " + f.subject + " " + (await page.locator("main").innerText()).slice(0, 300));
  return id;
}
async function edit(page, path, id, f) {
  await go(page, `${path}?activity=${id}`); await page.getByRole("dialog").waitFor();
  await fillBox(page, f); await save(page);
}
async function openReminder(page, id) {
  await go(page, "/notifications");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/notifications") || true), page.locator(`#r-${id} button.notif-open`).click()]);
  await settle(page); return new URL(page.url()).pathname;
}
async function tick(page, path, id) { await go(page, path); await page.locator(`#activity-${id}`).getByRole("button", { name: "Mark done" }).first().click(); await settle(page); }
async function untick(page, path, id) { await go(page, path); await page.locator(`#activity-${id}`).getByRole("button", { name: "Mark not done" }).first().click(); await settle(page); }

const scenarios = {}; const S = (n, fn) => { scenarios[n] = fn; };

S("US1 scenario 1", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-11-27T09:00:00Z");
  const deal = await mkDeal(sub("Deal"));
  const s = sub("intro call with Bob Example");
  const before = await notifs(ada);
  const id = await schedule(ada, `/deals/${deal}`, { subject: s, dueOn: "2026-11-27", dueTime: "10:05" });
  await clock("2026-11-27T09:49:00Z"); before.count = (await notifs(ada)).count; // other fake reminders come in meanwhile
  await clock("2026-11-27T09:50:00Z");
  const after = await notifs(ada);
  const r = rem(after, id)[0] || {};
  const whens = after.lines.map((l) => l.when);
  const parse = (w) => { const [d, t] = w.split(", "); return Date.parse(d + " " + t + " UTC"); };
  const ordered = whens.every((w, i) => i === 0 || parse(whens[i - 1]) >= parse(w));
  const ok = after.count === before.count + 1 && r.title === `Call: ${s} at 10:05` && r.when === "27 Nov 2026, 09:50" && r.preview === "Due 27 Nov 2026 10:05" && r.unread && ordered;
  check("US1 scenario 1", ok, `count ${before.count}→${after.count}; line ${show(after, id)}; dates newest first ${ordered} (${whens.slice(0, 4).join(" | ")}…)`);
});

S("US1 scenario 2", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-24T07:00:00Z");
  const s = sub("untimed task");
  const before = await notifs(ada);
  const id = await schedule(ada, "/activities", { type: "Task", subject: s, dueOn: "2026-12-24", dueTime: "" });
  await clock("2026-12-24T08:59:00Z"); before.count = (await notifs(ada)).count;
  await clock("2026-12-24T09:00:00Z");
  const after = await notifs(ada); const r = rem(after, id)[0] || {};
  const ok = r.title === `Task: ${s}` && r.preview === "Due 24 Dec 2026" && r.when === "24 Dec 2026, 09:00" && after.count === before.count + 1;
  check("US1 scenario 2", ok, `count ${before.count}→${after.count}; line ${show(after, id)}`);
});

S("US1 scenario 3", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-11-29T07:00:00Z");
  const deal = await mkDeal(sub("Deal"));
  const base = await notifs(ada);
  const t = await schedule(ada, `/deals/${deal}`, { subject: sub("timed"), dueOn: "2026-11-29", dueTime: "10:00" });
  const u = await schedule(ada, "/activities", { type: "Task", subject: sub("untimed"), dueOn: "2026-11-29", dueTime: "" });
  await clock("2026-11-29T08:59:00Z"); const a = await notifs(ada);
  await clock("2026-11-29T09:44:00Z"); const b = await notifs(ada);
  await clock("2026-11-29T09:45:00Z"); const c = await notifs(ada);
  const ok = a.count === base.count && rem(a, t).length === 0 && rem(a, u).length === 0 && b.count === base.count + 1 && rem(b, t).length === 0 && rem(b, u).length === 1 && c.count === base.count + 2 && rem(c, t).length === 1;
  check("US1 scenario 3", ok, `base ${base.count}; 08:59 count ${a.count} (timed ${rem(a, t).length}, untimed ${rem(a, u).length}); 09:44 count ${b.count} (timed ${rem(b, t).length}, untimed ${rem(b, u).length}); 09:45 count ${c.count} timed ${rem(c, t).length}`);
});

S("US1 scenario 4", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-11-30T08:00:00Z");
  const org = await mkOrg(sub("Org")); const person = await mkPerson("Sfrem", "Fakeperson" + seq, org);
  const deal = await mkDeal(sub("Deal"), { person, org });
  const dId = await schedule(ada, `/deals/${deal}`, { subject: sub("on deal"), dueOn: "2026-11-30", dueTime: "10:00" });
  const pId = await schedule(ada, `/people/${person}`, { subject: sub("on person"), dueOn: "2026-11-30", dueTime: "10:00" });
  const oId = await schedule(ada, `/organisations/${org}`, { subject: sub("on org"), dueOn: "2026-11-30", dueTime: "10:00" });
  const nId = await schedule(ada, "/activities", { subject: sub("no link"), dueOn: "2026-11-30", dueTime: "10:00" });
  const later = await schedule(ada, "/activities", { subject: sub("later"), dueOn: "2026-11-30", dueTime: "16:00" });
  await clock("2026-11-30T09:50:00Z");
  const n0 = await notifs(ada);
  const lands = [];
  for (const id of [dId, pId, oId, nId]) lands.push(await openReminder(ada, id));
  const n1 = await notifs(ada);
  const readNow = [dId, pId, oId, nId].every((id) => rem(n1, id)[0] && !rem(n1, id)[0].unread);
  const landOk = lands[0] === `/deals/${deal}` && lands[1] === `/people/${person}` && lands[2] === `/organisations/${org}` && lands[3] === "/activities";
  // mark all: one more shown unread, `later` still to come
  const x = await schedule(ada, "/activities", { subject: sub("shown"), dueOn: "2026-11-30", dueTime: "10:00" });
  const n2 = await notifs(ada);
  await ada.getByRole("button", { name: "[ MARK ALL AS READ ]" }).click(); await settle(ada);
  const n3 = await notifs(ada);
  await clock("2026-11-30T15:45:00Z");
  const n4 = await notifs(ada);
  const ok = landOk && readNow && n1.count === n0.count - 4 && rem(n2, x)[0]?.unread && n3.count === 0 && !rem(n3, x)[0].unread
    && rem(n4, later)[0]?.unread && n4.count === 1;
  check("US1 scenario 4", ok, `landed ${lands.join(", ")} (deal ${deal}, person ${person}, org ${org}); count ${n0.count}→${n1.count} after 4 opens, read ${readNow}; mark all: count ${n2.count}→${n3.count}, shown one read ${!rem(n3, x)[0]?.unread}; later one at 15:45 ${show(n4, later)} count ${n4.count}`);
});

S("US1 scenario 5", async () => {
  const g = await pageAs(GRACE);
  await clock("2026-12-01T09:00:00Z");
  const deal = await mkDeal(sub("Grace deal"), { by: GRACE });
  const s = sub("Grace self"); const before = await notifs(g);
  const id = await schedule(g, `/deals/${deal}`, { subject: s, dueOn: "2026-12-01", dueTime: "11:00" });
  const mid = await notifs(g);
  await clock("2026-12-01T10:45:00Z"); const after = await notifs(g);
  const assignLine = after.lines.filter((l) => l.id === `a-${id}`).length;
  const ok = rem(after, id).length === 1 && rem(after, id)[0].unread && after.count === before.count + 1 && mid.count === before.count && assignLine === 0;
  check("US1 scenario 5", ok, `count ${before.count}→${mid.count} (scheduled)→${after.count} (10:45); reminder ${show(after, id)}; assignment lines ${assignLine}`);
});

S("US1 scenario 6", async () => {
  const ada = await pageAs(ADA), g = await pageAs(GRACE);
  await clock("2026-12-02T09:00:00Z");
  const deal = await mkDeal(sub("Shared deal"));
  const s = sub("call for Grace");
  const id = await schedule(ada, `/deals/${deal}`, { subject: s, dueOn: "2026-12-02", dueTime: "10:00", assignee: GRACE });
  await clock("2026-12-02T09:46:00Z");
  const n0 = await notifs(g);
  const aLine = n0.lines.find((l) => l.id === `a-${id}`);
  const land = await openReminder(g, id);
  const n1 = await notifs(g);
  const aAfter = n1.lines.find((l) => l.id === `a-${id}`);
  const ok = aLine && aLine.title === `Ada Fake assigned you a call: ${s}` && aLine.unread && rem(n0, id)[0]?.unread && land === `/deals/${deal}`
    && !rem(n1, id)[0].unread && aAfter.unread && n1.count === n0.count - 1;
  check("US1 scenario 6", ok, `Grace before: assignment "${aLine?.title}" unread ${aLine?.unread}, reminder ${show(n0, id)}; opened → ${land}; after: reminder unread ${rem(n1, id)[0]?.unread}, assignment unread ${aAfter?.unread}; count ${n0.count}→${n1.count}`);
});

S("US2 scenario 1", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-03T09:00:00Z");
  const deal = await mkDeal(sub("Deal"));
  const id = await schedule(ada, `/deals/${deal}`, { subject: sub("move me"), dueOn: "2026-12-03", dueTime: "10:00" });
  await clock("2026-12-03T09:50:00Z");
  const n0 = await notifs(ada); await openReminder(ada, id); const n1 = await notifs(ada);
  await edit(ada, `/deals/${deal}`, id, { dueTime: "15:00" });
  const n2 = await notifs(ada);
  await clock("2026-12-03T14:44:00Z"); const n3 = await notifs(ada);
  await clock("2026-12-03T14:45:00Z"); const n4 = await notifs(ada);
  // moved to a time whose reminder has passed but not the due moment: shown at once
  await clock("2026-12-03T14:55:00Z");
  await edit(ada, `/deals/${deal}`, id, { dueTime: "15:05" });
  const n5 = await notifs(ada);
  // date change (to come)
  await edit(ada, `/deals/${deal}`, id, { dueOn: "2026-12-04" }); const n6 = await notifs(ada);
  const ok = rem(n0, id)[0]?.unread && !rem(n1, id)[0]?.unread && rem(n2, id).length === 0 && n2.count === n1.count && rem(n3, id).length === 0
    && rem(n4, id)[0]?.unread && rem(n4, id)[0].when === "03 Dec 2026, 14:45" && n4.count === n2.count + 1
    && rem(n5, id)[0]?.unread && rem(n5, id)[0].when === "03 Dec 2026, 14:50" && rem(n6, id).length === 0;
  check("US2 scenario 1", ok, `shown then read ${!rem(n1, id)[0]?.unread}; moved to 15:00: at 09:50 ${show(n2, id)} count ${n1.count}→${n2.count}; 14:44 ${show(n3, id)}; 14:45 ${show(n4, id)} count ${n4.count}; moved at 14:55 to 15:05 ${show(n5, id)}; moved to tomorrow ${show(n6, id)}`);
});

S("US2 scenario 2", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-05T09:50:00Z");
  const deal = await mkDeal(sub("Deal"));
  const id = await schedule(ada, `/deals/${deal}`, { subject: sub("past me"), dueOn: "2026-12-05", dueTime: "10:00" });
  const n0 = await notifs(ada);
  await edit(ada, `/deals/${deal}`, id, { dueTime: "08:00" });
  const n1 = await notifs(ada); await clock("2026-12-06T12:00:00Z"); const n2 = await notifs(ada);
  const ok = rem(n0, id).length === 1 && rem(n1, id).length === 0 && n1.count === n0.count - 1 && rem(n2, id).length === 0 && (await act(id)).remind_at === null;
  check("US2 scenario 2", ok, `before ${show(n0, id)} count ${n0.count}; after moving to 08:00 lines ${rem(n1, id).length} count ${n1.count}; next day lines ${rem(n2, id).length}; remind_at ${(await act(id)).remind_at}`);
});

S("US2 scenario 3", async () => {
  const ada = await pageAs(ADA), g = await pageAs(GRACE);
  await clock("2026-12-07T09:00:00Z");
  const deal = await mkDeal(sub("Deal"));
  const a = await schedule(ada, `/deals/${deal}`, { subject: sub("hand me now"), dueOn: "2026-12-07", dueTime: "10:00" });
  const b = await schedule(ada, `/deals/${deal}`, { subject: sub("hand me later"), dueOn: "2026-12-07", dueTime: "12:00" });
  await clock("2026-12-07T09:50:00Z");
  const a0 = await notifs(ada), g0 = await notifs(g);
  await edit(ada, `/deals/${deal}`, a, { assignee: GRACE });
  await edit(ada, `/deals/${deal}`, b, { assignee: GRACE });
  const a1 = await notifs(ada), g1 = await notifs(g);
  await clock("2026-12-07T11:45:00Z"); const g2 = await notifs(g); const a2 = await notifs(ada);
  const ok = rem(a0, a).length === 1 && rem(a1, a).length === 0 && a1.count === a0.count - 1 && rem(g1, a)[0]?.unread && rem(g1, b).length === 0
    && rem(g2, b)[0]?.unread && rem(a2, b).length === 0 && rem(a2, a).length === 0;
  check("US2 scenario 3", ok, `Ada ${a0.count}→${a1.count}, line ${show(a1, a)}; Grace at once ${show(g1, a)} (count ${g0.count}→${g1.count}); later one at 09:50 ${show(g1, b)}, at 11:45 ${show(g2, b)}; Ada at 11:45 ${rem(a2, b).length + rem(a2, a).length}`);
});

S("US2 scenario 4", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-08T09:00:00Z");
  const deal = await mkDeal(sub("Deal")); const p = `/deals/${deal}`;
  const r = await schedule(ada, p, { subject: sub("tick read"), dueOn: "2026-12-08", dueTime: "10:00" });
  const u = await schedule(ada, p, { subject: sub("tick unread"), dueOn: "2026-12-08", dueTime: "10:00" });
  await clock("2026-12-08T09:50:00Z");
  await openReminder(ada, r);
  const n0 = await notifs(ada);
  await tick(ada, p, r); await tick(ada, p, u);
  const n1 = await notifs(ada);
  await untick(ada, p, r); await untick(ada, p, u);
  const n2 = await notifs(ada);
  await tick(ada, p, u);
  await clock("2026-12-08T10:05:00Z");
  await untick(ada, p, u);
  const n3 = await notifs(ada);
  const ok = rem(n1, r).length === 0 && rem(n1, u).length === 0 && n1.count === n0.count - 1 && !rem(n2, r)[0]?.unread && rem(n2, u)[0]?.unread
    && n2.count === n0.count && rem(n3, u).length === 0 && rem(n3, r).length === 1;
  check("US2 scenario 4", ok, `before: read ${show(n0, r)}, unread ${show(n0, u)} count ${n0.count}; ticked: lines ${rem(n1, r).length + rem(n1, u).length} count ${n1.count}; unticked: ${show(n2, r)} ${show(n2, u)} count ${n2.count}; ticked and unticked after due: ${show(n3, u)}`);
});

S("US2 scenario 5", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-09T09:00:00Z");
  const deal = await mkDeal(sub("Deal"));
  const doomed = await mkDeal(sub("Doomed deal"));
  const a = await schedule(ada, `/deals/${deal}`, { subject: sub("delete me"), dueOn: "2026-12-09", dueTime: "10:00" });
  const b = await schedule(ada, `/deals/${doomed}`, { subject: sub("goes with deal"), dueOn: "2026-12-09", dueTime: "10:00" });
  await clock("2026-12-09T09:50:00Z");
  const n0 = await notifs(ada);
  await go(ada, `/deals/${deal}?delete-activity=${a}`); await ada.getByRole("alertdialog").getByRole("button", { name: "[ DELETE ]" }).click(); await settle(ada);
  await go(ada, `/deals/${doomed}?confirm=delete`); await ada.getByRole("alertdialog").getByRole("button").last().click(); await settle(ada);
  const n1 = await notifs(ada);
  const gone = (await db`select count(*)::int n from activities where id in (${a}, ${b})`)[0].n;
  const ok = rem(n0, a).length === 1 && rem(n0, b).length === 1 && rem(n1, a).length === 0 && rem(n1, b).length === 0 && n1.count === n0.count - 2 && gone === 0;
  check("US2 scenario 5", ok, `before lines ${rem(n0, a).length}/${rem(n0, b).length} count ${n0.count}; after delete + deal delete lines ${rem(n1, a).length}/${rem(n1, b).length} count ${n1.count}; rows left ${gone}`);
});

S("US2 scenario 6", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-10T09:00:00Z");
  const deal = await mkDeal(sub("Deal")); const org = await mkOrg(sub("Org"));
  const a = await schedule(ada, `/deals/${deal}`, { subject: sub("keep me"), dueOn: "2026-12-10", dueTime: "10:00" });
  const b = await schedule(ada, `/deals/${deal}`, { subject: sub("keep me read"), dueOn: "2026-12-10", dueTime: "10:00" });
  await clock("2026-12-10T09:50:00Z");
  await openReminder(ada, b);
  const before = { a: await act(a), b: await act(b) };
  const sA = sub("renamed"), sB = sub("renamed read");
  await edit(ada, `/deals/${deal}`, a, { type: "Meeting", subject: sA, note: "a note", duration: 30 });
  await edit(ada, `/deals/${deal}`, b, { type: "Task", subject: sB });
  // links: add an organisation to b
  await go(ada, `/deals/${deal}?activity=${b}`); await ada.getByRole("dialog").waitFor();
  const box = ada.getByRole("dialog"); const orgName = (await db`select name from organisations where id = ${org}`)[0].name;
  await box.getByRole("combobox", { name: "Organisation" }).fill(orgName); await ada.waitForTimeout(600);
  await ada.getByRole("option", { name: orgName }).first().click().catch(() => {}); await save(ada);
  const after = { a: await act(a), b: await act(b) };
  const orgLinked = (await db`select organisation_id::int o from activities where id = ${b}`)[0].o === org;
  const n = await notifs(ada);
  const same = (x, y) => (x?.getTime?.() ?? x) === (y?.getTime?.() ?? y);
  const ok = same(before.a.remind_at, after.a.remind_at) && same(before.b.remind_at, after.b.remind_at) && same(before.b.reminder_read_at, after.b.reminder_read_at)
    && rem(n, a)[0]?.title === `Meeting: ${sA} at 10:00` && rem(n, a)[0].unread && rem(n, b)[0]?.title === `Task: ${sB} at 10:00` && !rem(n, b)[0].unread && rem(n, a)[0].when === "10 Dec 2026, 09:45";
  check("US2 scenario 6", ok, `remind_at kept ${same(before.a.remind_at, after.a.remind_at)}/${same(before.b.remind_at, after.b.remind_at)}, read kept ${same(before.b.reminder_read_at, after.b.reminder_read_at)}; org linked ${orgLinked}; lines ${show(n, a)} ${show(n, b)}`);
});

S("US3 scenario 1", async () => {
  const ada = await pageAs(ADA), g = await pageAs(GRACE);
  await clock("2026-12-11T09:00:00Z");
  const deal = await mkDeal(sub("Ada deal")); const person = await mkPerson("Sfpriv", "Fakeperson" + seq);
  const a = await schedule(ada, `/deals/${deal}`, { subject: sub("for Grace on deal"), dueOn: "2026-12-11", dueTime: "10:00", assignee: GRACE });
  const b = await schedule(ada, `/people/${person}`, { subject: sub("for Grace on person"), dueOn: "2026-12-11", dueTime: "10:00", assignee: GRACE });
  await clock("2026-12-11T09:50:00Z");
  await openReminder(g, b); // read before hiding
  const n0 = await notifs(g);
  await db`update deals set private = true where id = ${deal}`; await db`update persons set private = true where id = ${person}`;
  const n1 = await notifs(g);
  // opening its address (posting the form again by hand)
  await go(g, "/notifications");
  await g.evaluate((id) => { const f = document.querySelector("li.notif form"); f.querySelector("[name=kind]").value = "reminder"; f.querySelector("[name=id]").value = String(id); f.querySelector("button").click(); }, a);
  await settle(g); const landA = new URL(g.url()).pathname;
  const readA = (await act(a)).reminder_read_at;
  check("US3 scenario 1", rem(n0, a).length === 1 && rem(n1, a).length === 0 && rem(n1, b).length === 0 && n1.count === n0.count - n0.lines.filter((l) => l.unread && [`r-${a}`, `r-${b}`, `a-${a}`, `a-${b}`].includes(l.id)).length && landA === "/notifications" && readA === null,
    `Grace before ${show(n0, a)} ${show(n0, b)} count ${n0.count}; hidden: lines ${rem(n1, a).length + rem(n1, b).length} count ${n1.count}; opening hidden reminder → ${landA}, marked read ${readA !== null}`);
  globalThis.us3 = { deal, person, a, b };
});

S("US3 scenario 2", async () => {
  const g = await pageAs(GRACE);
  if (!globalThis.us3) await scenarios["US3 scenario 1"]();
  const { deal, person, a, b } = globalThis.us3;
  await clock("2026-12-11T09:52:00Z");
  const n0 = await notifs(g);
  await db`update deals set private = false where id = ${deal}`; await db`update persons set private = false where id = ${person}`;
  const n1 = await notifs(g);
  const ok = rem(n1, a)[0]?.unread && rem(n1, b)[0] && !rem(n1, b)[0].unread && n1.count === n0.count + n1.lines.filter((l) => l.unread && [`r-${a}`, `r-${b}`, `a-${a}`, `a-${b}`].includes(l.id)).length;
  check("US3 scenario 2", ok, `shared again: ${show(n1, a)} ${show(n1, b)} count ${n0.count}→${n1.count}`);
});

S("US3 scenario 3", async () => {
  const g = await pageAs(GRACE);
  await clock("2026-12-12T09:00:00Z");
  const deal = await mkDeal(sub("Grace public"), { by: GRACE });
  const s = sub("Grace only");
  const id = await schedule(g, `/deals/${deal}`, { subject: s, dueOn: "2026-12-12", dueTime: "10:00" });
  await clock("2026-12-12T09:50:00Z");
  const mine = await notifs(g); const seen = [];
  for (const u of [ADA, LINUS, 4]) { const n = await notifs(await pageAs(u)); seen.push(n.lines.some((l) => l.title.includes(s) || l.id === `r-${id}`)); }
  check("US3 scenario 3", rem(mine, id).length === 1 && seen.every((x) => !x), `Grace sees ${show(mine, id)}; Ada (admin) / Linus / Margaret see it: ${seen.join("/")}`);
});

S("US4 scenario 1", async () => {
  execSync("bash .factory/run/reset-db.sh >/dev/null 2>&1 && APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev npm run -s db:seed >/dev/null 2>&1");
  const ada = await pageAs(ADA, REAL);
  const n = await notifs(ada);
  const subj = (t) => n.lines.filter((l) => l.id.startsWith("r-") && l.title.includes(t));
  const timed = subj("Fake call: reminder test call"), untimed = subj("Fake task: reminder test task"), read = subj("Fake meeting: reminder already seen");
  const toCome = (await db`select count(*)::int n from activities where assignee_id = ${ADA} and done_at is null and remind_at > now()`)[0].n;
  const dup = (await db`select count(*)::int n from (select subject from activities group by subject having count(*) > 1) x`)[0].n;
  const rids = n.lines.filter((l) => l.id.startsWith("r-")).map((l) => l.id);
  const ok = timed.length === 1 && timed[0].unread && / at \d\d:\d\d$/.test(timed[0].title) && untimed.length === 1 && untimed[0].unread && !/ at \d/.test(untimed[0].title)
    && read.length === 1 && !read[0].unread && toCome >= 1 && dup === 0 && new Set(rids).size === rids.length;
  check("US4 scenario 1", ok, `after two seeds: timed ${JSON.stringify(timed.map((l) => [l.title, l.when, l.unread]))}; untimed ${JSON.stringify(untimed.map((l) => [l.title, l.preview, l.unread]))}; read ${JSON.stringify(read.map((l) => [l.title, l.unread]))}; to come ${toCome}; duplicate subjects ${dup}; reminder lines ${rids.length}; count ${n.count}`);
});

S("Edge case 1", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-14T09:52:00Z");
  const deal = await mkDeal(sub("Deal")); const n0 = await notifs(ada);
  const a = await schedule(ada, `/deals/${deal}`, { subject: sub("soon"), dueOn: "2026-12-14", dueTime: "10:00" });
  const n1 = await notifs(ada);
  const b = await schedule(ada, "/activities", { type: "Task", subject: sub("today untimed"), dueOn: "2026-12-14", dueTime: "" });
  const n2 = await notifs(ada);
  check("Edge case 1", rem(n1, a)[0]?.unread && n1.count === n0.count + 1 && rem(n2, b)[0]?.unread && n2.count === n0.count + 2,
    `count ${n0.count}→${n1.count}→${n2.count}; ${show(n1, a)} ${show(n2, b)}`);
});

S("Edge case 2", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-15T12:00:00Z");
  const deal = await mkDeal(sub("Deal")); const n0 = await notifs(ada);
  const a = await schedule(ada, `/deals/${deal}`, { subject: sub("happened"), dueOn: "2026-12-15", dueTime: "10:00" });
  const b = await schedule(ada, "/activities", { type: "Task", subject: sub("yesterday"), dueOn: "2026-12-14", dueTime: "" });
  const n1 = await notifs(ada);
  check("Edge case 2", rem(n1, a).length === 0 && rem(n1, b).length === 0 && n1.count === n0.count, `count ${n0.count}→${n1.count}; lines ${rem(n1, a).length + rem(n1, b).length}`);
});

S("Edge case 3", async () => {
  // (a) the fake data at the real clock: overdue ones show none, later ones have their reminder time
  if (!(await db`select 1 from activities where subject = 'Fake call: reminder test call'`).length) execSync("bash .factory/run/reset-db.sh >/dev/null 2>&1");
  const ada = await pageAs(ADA, REAL); const n = await notifs(ada);
  const overdue = await db`select id::int, subject from activities where done_at is null and remind_at is null`;
  const shownOverdue = overdue.filter((o) => n.lines.some((l) => l.id === `r-${o.id}`)).length;
  const planned = await db`select subject, remind_at from activities where done_at is null and remind_at is not null and remind_at > now()`;
  // (b) the migration on a copy of the database: a past planned activity gets none, a future one gets its time
  const P = "/usr/lib/postgresql/17/bin/psql -h localhost -U postgres -q";
  execSync(`${P} -c "drop database if exists sf123_mig" -c "create database sf123_mig" && /usr/lib/postgresql/17/bin/pg_dump -h localhost -U postgres crm_dev | ${P} -d sf123_mig >/dev/null`);
  const m = postgres("postgres://postgres@localhost:5432/sf123_mig", { prepare: false, max: 1, onnotice: () => {} });
  await m`alter table activities drop column remind_at, drop column reminder_read_at`;
  await m`update activities set due_on = '2020-01-01', due_time = '10:00' where subject = 'Fake call: reminder test call'`;
  await m`update activities set due_on = '2030-06-01', due_time = null where subject = 'Fake task: reminder test task'`;
  await m`update activities set due_on = '2030-01-10', due_time = '10:00' where subject = 'Fake meeting: reminder already seen'`;
  execSync(`${P} -d sf123_mig -v ON_ERROR_STOP=1 -f migrations/0017_activity_reminders.sql`);
  const rows = await m`select subject, remind_at from activities where subject like 'Fake % reminder %' order by subject`;
  await m.end(); execSync(`${P} -c "drop database sf123_mig"`);
  const by = Object.fromEntries(rows.map((r) => [r.subject, r.remind_at && r.remind_at.toISOString()]));
  const ok = overdue.length > 0 && shownOverdue === 0 && planned.length > 0 && by["Fake call: reminder test call"] === null
    && by["Fake task: reminder test task"] === "2030-06-01T08:00:00.000Z" && by["Fake meeting: reminder already seen"] === "2030-01-10T09:45:00.000Z";
  check("Edge case 3", ok, `fake data: ${overdue.length} planned without reminder, shown ${shownOverdue}; ${planned.length} with one still to come; migration on a copy: ${JSON.stringify(by)}`);
});

S("Edge case 4", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-16T09:00:00Z");
  const deal = await mkDeal(sub("Deal"));
  const id = await schedule(ada, `/deals/${deal}`, { subject: sub("overdue stays"), dueOn: "2026-12-16", dueTime: "10:00" });
  await clock("2026-12-16T11:00:00Z"); const n1 = await notifs(ada);
  await clock("2026-12-18T11:00:00Z"); const n2 = await notifs(ada);
  await tick(ada, `/deals/${deal}`, id); const n3 = await notifs(ada);
  check("Edge case 4", rem(n1, id).length === 1 && rem(n2, id).length === 1 && rem(n3, id).length === 0 && n2.lines.filter((l) => l.title.includes("overdue stays")).length === 1,
    `after due ${show(n1, id)}; two days later ${show(n2, id)}; done: ${rem(n3, id).length}`);
});

S("Edge case 5", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-03-29T00:40:00Z");
  const deal = await mkDeal(sub("DST deal"));
  const id = await schedule(ada, `/deals/${deal}`, { subject: sub("DST call"), dueOn: "2026-03-29", dueTime: "02:10" });
  await clock("2026-03-29T00:50:00Z"); const n0 = await notifs(ada);
  await clock("2026-03-29T00:55:00Z"); const n1 = await notifs(ada);
  await clock("2026-01-15T07:00:00Z");
  const w = await schedule(ada, "/activities", { type: "Task", subject: sub("winter task"), dueOn: "2026-01-15", dueTime: "" });
  await clock("2026-01-15T08:59:00Z"); const w0 = await notifs(ada);
  await clock("2026-01-15T09:00:00Z"); const w1 = await notifs(ada);
  await clock("2026-07-15T06:00:00Z");
  const su = await schedule(ada, "/activities", { type: "Task", subject: sub("summer task"), dueOn: "2026-07-15", dueTime: "" });
  await clock("2026-07-15T07:59:00Z"); const s0 = await notifs(ada);
  await clock("2026-07-15T08:00:00Z"); const s1 = await notifs(ada);
  const ok = rem(n0, id).length === 0 && rem(n1, id)[0]?.when === "29 Mar 2026, 00:55" && rem(w0, w).length === 0 && rem(w1, w)[0]?.when === "15 Jan 2026, 09:00"
    && rem(s0, su).length === 0 && rem(s1, su)[0]?.when === "15 Jul 2026, 09:00";
  check("Edge case 5", ok, `DST call: 00:50Z ${rem(n0, id).length}, 00:55Z ${show(n1, id)}; winter: 08:59Z ${rem(w0, w).length}, 09:00Z ${show(w1, w)}; summer: 07:59Z ${rem(s0, su).length}, 08:00Z ${show(s1, su)}`);
});

S("Edge case 6", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-17T09:00:00Z");
  const deal = await mkDeal(sub("Archived deal"));
  const s = sub("on archived");
  const id = await schedule(ada, `/deals/${deal}`, { subject: s, dueOn: "2026-12-17", dueTime: "10:00" });
  await db`update deals set archived_at = now() where id = ${deal}`;
  await clock("2026-12-17T09:50:00Z"); const n = await notifs(ada);
  const land = await openReminder(ada, id); const body = await ada.locator("main").innerText();
  await go(ada, "/activities"); const inList = (await ada.locator("main").innerText()).includes(s);
  check("Edge case 6", rem(n, id).length === 1 && land === `/deals/${deal}` && /archived/i.test(body) && inList, `line ${show(n, id)}; opened → ${land} (archived shown ${/archived/i.test(body)}); in Activities list ${inList}`);
});

S("Edge case 7", async () => {
  const ada = await pageAs(ADA), linus = await pageAs(LINUS);
  await clock("2026-12-18T09:50:00Z");
  const deal = await mkDeal(sub("Deal"));
  const s = sub("Alan's call");
  const id = (await db`insert into activities (type, subject, due_on, due_time, deal_id, assignee_id, created_by, assigned_by, remind_at)
    values ('call', ${s}, '2026-12-18', '10:00', ${deal}, ${ALAN}, ${ALAN}, ${ALAN}, '2026-12-18T09:45:00Z') returning id::int`)[0].id;
  const others = [];
  for (const u of [ADA, GRACE, LINUS, 4]) { const n = await notifs(await pageAs(u)); others.push(n.lines.some((l) => l.title.includes(s))); }
  const l0 = await notifs(linus);
  await edit(ada, `/deals/${deal}`, id, { assignee: LINUS });
  const l1 = await notifs(linus);
  check("Edge case 7", others.every((x) => !x) && rem(l1, id)[0]?.unread && l1.count === l0.count + 2,
    `listed for Ada/Grace/Linus/Margaret: ${others.join("/")}; after reassign to Linus ${show(l1, id)} count ${l0.count}→${l1.count} (reminder + assignment)`);
});

S("Edge case 8", async () => {
  const ada = await pageAs(ADA), linus = await pageAs(LINUS);
  await clock("2026-12-19T09:00:00Z");
  const deal = await mkDeal(sub("Private Alan-owned"), { by: ADA, owner: ALAN, private: true });
  const s = sub("Ada on private");
  const id = await schedule(ada, `/deals/${deal}`, { subject: s, dueOn: "2026-12-19", dueTime: "10:00" });
  await go(ada, "/admin/users?handover=5");
  const form = ada.locator("form.handover").first();
  await form.getByLabel("Hand over to").selectOption(String(LINUS));
  await form.getByRole("button", { name: "[ HAND OVER ]" }).click(); await settle(ada);
  const owner = (await db`select owner_id::int o from deals where id = ${deal}`)[0].o; const asg = (await act(id)).assignee_id;
  await clock("2026-12-19T09:50:00Z");
  const a1 = await notifs(ada), l1 = await notifs(linus);
  // Ada loses sight: the deal's creator moved to Linus too (only way to hide it from her)
  await db`update deals set created_by = ${LINUS} where id = ${deal}`;
  const a2 = await notifs(ada);
  check("Edge case 8", owner === LINUS && asg === ADA && rem(a1, id).length === 1 && !l1.lines.some((l) => l.title.includes(s)) && rem(a2, id).length === 0,
    `after hand-over owner ${owner}, assignee ${asg}; Ada ${show(a1, id)}; Linus lists it ${l1.lines.some((l) => l.title.includes(s))}; Ada when she can't see it ${rem(a2, id).length}`);
});

S("Edge case 9", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-20T09:00:00Z");
  const deal = await mkDeal(sub("Deal"));
  const a = await schedule(ada, `/deals/${deal}`, { subject: sub("first"), dueOn: "2026-12-20", dueTime: "10:00" });
  const b = await schedule(ada, `/deals/${deal}`, { subject: sub("second"), dueOn: "2026-12-20", dueTime: "10:00" });
  await clock("2026-12-20T09:50:00Z");
  const orders = [];
  for (let i = 0; i < 3; i++) { const n = await notifs(ada); orders.push(n.lines.filter((l) => l.id === `r-${a}` || l.id === `r-${b}`).map((l) => l.id).join(",")); }
  check("Edge case 9", orders.every((o) => o === `r-${b},r-${a}`), `orders on 3 loads: ${orders.join(" | ")} (newest r-${b})`);
});

S("Edge case 10", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-21T09:00:00Z");
  const deal = await mkDeal(sub("Deal"));
  await schedule(ada, `/deals/${deal}`, { subject: sub("navigate"), dueOn: "2026-12-21", dueTime: "10:00" });
  await go(ada, "/activities"); const c0 = await sidebar(ada);
  await clock("2026-12-21T09:46:00Z"); await ada.waitForTimeout(1500);
  const c1 = await sidebar(ada);
  await ada.getByRole("link", { name: "People", exact: true }).first().click(); await settle(ada); await ada.waitForTimeout(800);
  const c2 = await sidebar(ada);
  await go(ada, "/activities"); const c3 = await sidebar(ada);
  check("Edge case 10", c1 === c0 && c2 === c0 + 1 && c3 === c0 + 1, `open page ${c0}; left open past 09:45 ${c1}; after client navigation ${c2}; after reload ${c3}`);
});

S("Edge case 11", async () => {
  const ada = await pageAs(ADA);
  await clock("2026-12-22T09:50:00Z");
  const deal = await mkDeal(sub("Deal"));
  const s = "<b>Call</b> https://example.com";
  await db`delete from activities where subject = ${s}`;
  const id = await schedule(ada, `/deals/${deal}`, { subject: s, dueOn: "2026-12-22", dueTime: "10:00" });
  const n = await notifs(ada); const r = rem(n, id)[0] || {};
  check("Edge case 11", r.title === `Call: ${s} at 10:00` && !/<b>|<a/i.test(r.html) && r.links === 0, `title "${r.title}"; html ${r.html}; links ${r.links}`);
});

(async () => {
  browser = await chromium.launch();
  const names = Object.keys(scenarios); names.sort((a, b) => (b === "US4 scenario 1") - (a === "US4 scenario 1")); // the reseed first: it drops sessions
  for (const name of names) { const fn = scenarios[name];
    if (ONLY && !ONLY.includes(name)) continue;
    try { await fn(); } catch (e) { check(name, false, "error: " + (e.message || e).toString().slice(0, 400)); }
  }
  await browser.close(); await db.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
})();
