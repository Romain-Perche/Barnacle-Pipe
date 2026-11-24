// SF-115 helpers for the AI review's scenario scripts (NODE_PATH=/opt/playwright/node_modules).
const L = require("./lib.js");
const { execSync } = require("child_process");
const B = process.env.BASE || "http://localhost:3000";
const DB = process.env.DB || "crm_dev";
function q(sql) { return execSync(`/usr/lib/postgresql/17/bin/psql -h localhost -U postgres -d ${DB} -tA -F '|' -c ${JSON.stringify(sql)}`).toString().trim(); }
async function go(p, url) { await p.goto(B + url); await p.waitForLoadState("networkidle"); }
async function submit(p, locator) { await Promise.all([p.waitForLoadState("networkidle"), locator.click()]); await p.waitForTimeout(600); await p.waitForLoadState("networkidle"); }
const main = (p) => p.innerText("main");
// Adds a field through the box: kind tab people|organisations|deals.
async function addField(p, tab, name, type, choices, inList) {
  await go(p, `/admin/custom-fields?kind=${tab}&field=new`);
  const d = p.locator('[role="dialog"]');
  await d.locator('input[name="name"]').fill(name);
  await d.locator('select[name="type"]').selectOption(type);
  if (choices != null) await d.locator('textarea').fill(choices);
  if (inList) await d.locator('input[name="inList"]').check();
  await submit(p, d.locator('button:has-text("[ SAVE ]")'));
}
function fieldId(kind, name) { return q(`select id from custom_fields where kind='${kind}' and name='${name.replace(/'/g, "''")}'`); }
async function newPage(b, email, name) { const p = await b.newPage(); await L.signIn(p, B, email, name); return p; }
module.exports = { ...L, B, q, go, submit, main, addField, fieldId, newPage };
// Text of a record page's // MORE DETAILS section (up to the next section).
async function more(p) { const t = await p.innerText("main"); const i = t.indexOf("// MORE DETAILS"); if (i < 0) return null; const r = t.slice(i + 15); const j = r.search(/\/\/ [A-Z]/); return j < 0 ? r : r.slice(0, j); }
module.exports.more = more;
