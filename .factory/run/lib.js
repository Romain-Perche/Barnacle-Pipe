// Helpers for the AI review's Playwright scenario scripts. Run with NODE_PATH=/opt/playwright/node_modules.
const { chromium } = require("playwright");
const results = [];
function check(name, ok, notes) { results.push({ name, ok: !!ok, notes }); console.log((ok ? "PASS " : "FAIL ") + name + " — " + notes); }
async function signIn(page, base, email, name = "", next = "") {
  await page.goto(base + "/dev/fake-google" + (next ? "?next=" + encodeURIComponent(next) : ""));
  await page.fill('input[name="email"]:visible', email);
  await page.fill('input[name="name"]:visible', name);
  await Promise.all([page.waitForLoadState("networkidle"), page.click("text=[ CONTINUE ]")]);
  await page.waitForTimeout(300);
}
async function signOut(page) { await page.click("text=[ Sign out ]"); await page.waitForURL(/sign-in/); await page.waitForLoadState("networkidle"); }
async function bodyText(page) { return (await page.textContent("body")) || ""; }
async function rowOf(page, email) { const r = page.locator("tr", { hasText: email }); return (await r.count()) ? (await r.first().innerText()) : null; }
async function rowCount(page) { return page.locator("table.users tbody tr").count(); }
async function rowAction(page, email, label) {
  await Promise.all([page.waitForLoadState("networkidle"), page.locator("tr", { hasText: email }).locator(`button:has-text("${label}")`).click()]);
  await page.waitForTimeout(300);
}
async function addUser(page, base, email) {
  await page.fill('input[name="email"]', email);
  await Promise.all([page.waitForLoadState("networkidle"), page.click("text=[ ADD USER ]")]);
  await page.waitForTimeout(300);
}
module.exports = { chromium, results, check, signIn, signOut, bodyText, rowOf, rowCount, rowAction, addUser };
