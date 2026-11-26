// SF-127 AI review helpers (email on the timeline). Run scripts with NODE_PATH=/opt/playwright/node_modules.
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const BASE = "http://localhost:3000";
const DB = "crm_dev";
const A = "ada@barnacle.ai", L = "linus@barnacle.ai", G = "grace@barnacle.ai";
const q = (s) => execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", DB, "-AtF", "|", "-v", "ON_ERROR_STOP=1", "-c", s], { encoding: "utf8" }).trim();
const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = {};
const R = (name, ok, notes) => { S[name] = { ok: !!ok, notes }; console.log((ok ? "PASS " : "FAIL ") + name + " — " + notes); };

async function pageAs(browser, email, viewport = { width: 1400, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(BASE + "/dev/fake-google");
  await p.fill('input[name="email"]:visible', email);
  await Promise.all([p.waitForLoadState("networkidle"), p.click("text=[ CONTINUE ]")]);
  return p;
}
async function go(p, path) { const r = await p.goto(BASE + path); await p.waitForLoadState("networkidle"); return r; }
// Puts a message in a user's fake mailbox through /dev/fake-gmail (its notice delivered unless deliver:false).
async function put(p, user, o) {
  await go(p, "/dev/fake-gmail?user=" + encodeURIComponent(user));
  await p.selectOption('select[name="direction"]', o.sent ? "sent" : "received");
  for (const k of ["from", "to", "cc", "bcc", "subject", "messageId"]) if (o[k] != null) await p.fill(`input[name="${k}"]`, o[k]);
  if (o.text != null) await p.fill('textarea[name="text"]', o.text);
  if (o.html != null) await p.fill('textarea[name="html"]', o.html);
  if (o.att) await p.fill('textarea[name="attachments"]', o.att.join("\n"));
  if (o.offset) await p.fill('input[name="offset"]', String(o.offset));
  if (o.thread) await p.selectOption('select[name="thread"]', o.thread);
  if (o.deliver === false) await p.uncheck('input[name="deliver"]');
  await Promise.all([p.waitForURL(/done=/), p.click("text=[ PUT IN THE MAILBOX ]")]);
  return new URL(p.url()).searchParams.get("done");
}
async function runCheck(p, user) {
  await go(p, "/dev/fake-gmail?user=" + encodeURIComponent(user));
  await Promise.all([p.waitForURL(/done=checked/), p.click("text=[ RUN THE 15-MINUTE CHECK ]")]);
}
async function connect(p) {
  await go(p, "/settings");
  await Promise.all([p.waitForURL(/fake-google\/gmail/), p.locator('section[aria-label="Gmail"] button', { hasText: /CONNECT GMAIL/ }).click()]);
  await Promise.all([p.waitForURL(/\/settings(\?|$)/), p.click("text=[ ALLOW ]")]);
  await p.waitForLoadState("networkidle");
}
const gThread = (user, subject) => q(`select t.gmail_thread_id from email_threads t join gmail_connections c on c.id=t.connection_id join email_messages m on m.thread_id=t.id where c.email='${user}' and m.subject='${subject}' limit 1`);
const conv = (subject) => Number(q(`select t.conversation_id from email_messages m join email_threads t on t.id=m.thread_id where m.subject='${subject.replace(/'/g, "''")}' order by m.id limit 1`));
const pid = (first, last) => Number(q(`select id from persons where first_name='${first}' and last_name='${last || {Ana:"Example",Ben:"Example",Pia:"Private",Cat:"Twodeals",Dan:"Closed",Eve:"Linked",Fay:"Pdeal",Gus:"Mover",Hal:"Archived",Ivy:"Later",Jo:"Gone",Kim:"Twoaddr",Nina:"Newbie",Lia:"Pager"}[first]}' order by id limit 1`));
const oid = (name) => Number(q(`select id from organisations where name='${name}'`));
const did = (title) => Number(q(`select id from deals where title='${title}'`));
const links = (c) => q(`select coalesce('p:'||p.first_name, 'o:'||o.name, 'd:'||d.title)||(case when l.removed then '(removed)' else '' end)||'/'||l.how from email_links l left join persons p on p.id=l.person_id left join organisations o on o.id=l.organisation_id left join deals d on d.id=l.deal_id where l.conversation_id=${c} order by 1`).split("\n").filter(Boolean);
// EMAIL entries of the timeline on a page: [{text, head, box}]
async function emailEntries(p, path) {
  if (path) await go(p, path);
  const lis = p.getByRole("region", { name: "Timeline" }).locator("li.ent:has(.kd.email)");
  const out = [];
  for (let i = 0; i < (await lis.count()); i++) {
    const li = lis.nth(i);
    out.push({ text: norm(await li.innerText()), head: norm(await li.locator(".emailhead").innerText()), subj: norm(await li.locator(".subj").innerText()) });
  }
  return out;
}
const subjects = (es) => es.map((e) => e.subj);
const countSubj = (es, s) => es.filter((e) => e.subj === s).length;
module.exports = { chromium, BASE, A, L, G, q, norm, sleep, S, R, pageAs, go, put, runCheck, connect, gThread, conv, pid, oid, did, links, emailEntries, subjects, countSubj };
