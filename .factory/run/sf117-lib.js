// Helpers for the SF-117 AI-review scripts (Pipedrive import). Run with NODE_PATH=/opt/playwright/node_modules.
// Needs: the app on :3001 started with PIPEDRIVE_URL=http://localhost:9400 and the stand-in Pipedrive
// (.factory/run/pipedrive-server.ts) on :9400 (see .factory/test-env.md).
const { execFileSync } = require("child_process");
const lib = require("./lib");
const BASE = process.env.BASE || "http://localhost:3001";
const PD = process.env.PD || "http://localhost:9400";
const DB = process.env.DB || "crm_dev";

function q(sqlText) {
  return execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", DB, "-AtF", "|", "-v", "ON_ERROR_STOP=1", "-c", sqlText], { encoding: "utf8" }).trim();
}
async function ctl(op, ...args) {
  const r = await fetch(PD + "/__control", { method: "POST", body: JSON.stringify({ op, args }) });
  const j = await r.json();
  if (!j.ok) throw new Error(op + ": " + j.error);
  return j.out;
}
async function newPage(browser, email, name = "") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await lib.signIn(page, BASE, email, name);
  return page;
}
async function saveToken(page, token) {
  await page.goto(BASE + "/settings");
  if (await page.getByRole("link", { name: "[ REPLACE TOKEN ]" }).count()) await page.goto(BASE + "/settings?replace=1");
  await page.fill('input[name="token"]', token);
  await Promise.all([page.waitForURL(/settings\?(saved|error)/), page.click("text=[ SAVE TOKEN ]")]);
  return section(page);
}
async function section(page) { return (await page.locator('section[aria-label="Pipedrive"]').innerText()).replace(/\s+/g, " "); }
async function startImport(page, { people = false, orgs = false, consent = null } = {}) {
  await page.goto(BASE + "/settings/pipedrive-import?new=1");
  if (people) await page.check('input[name="people"]');
  if (orgs) await page.check('input[name="organisations"]');
  if (consent) await page.check(`input[name="consent"][value="${consent}"]`);
  await Promise.all([page.waitForLoadState("networkidle"), page.click("text=[ IMPORT ]")]);
  await page.waitForTimeout(500);
}
async function stepNow(page) { return (await page.locator('[aria-current="step"]').first().innerText()).trim(); }
async function waitReport(page, ms = 600000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.locator('[aria-current="step"]', { hasText: "3 REPORT" }).count()) > 0) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}
async function body(page) { return ((await page.textContent("main")) || (await page.textContent("body")) || "").replace(/\s+/g, " "); }
function pid(pdId, company = 1001) { return q(`select person_id from pipedrive_links where company_id=${company} and kind='person' and pipedrive_id=${pdId}`); }
function oid(pdId, company = 1001) { return q(`select organisation_id from pipedrive_links where company_id=${company} and kind='organisation' and pipedrive_id=${pdId}`); }
module.exports = { ...lib, BASE, PD, q, ctl, newPage, saveToken, section, startImport, stepNow, waitReport, body, pid, oid };
