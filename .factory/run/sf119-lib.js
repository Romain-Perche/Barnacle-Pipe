// SF-119 helpers for the AI review's scenario scripts (NODE_PATH=/opt/playwright/node_modules). Base :3000, db crm_dev.
const H = require("./sf115-lib.js");
const { go, q } = H;
const ed = (p) => p.locator(".campaign-notes");
async function newCampaign(p, name) {
  await go(p, "/campaigns?new=1");
  await p.locator('input[name="name"]').last().fill(name);
  await Promise.all([p.waitForURL(/\/campaigns\/\d+$/), p.click("text=[ CREATE ]")]);
  await p.waitForLoadState("networkidle");
  return Number(p.url().match(/(\d+)$/)[1]);
}
// Header [ SAVE ]; waits for the action answer.
async function save(p) {
  const before = await p.locator(".campaign-notes").innerText();
  await p.locator('button[form="campaign-form"]').click();
  await p.waitForTimeout(500);
  await p.waitForFunction(() => !document.querySelector('button[form="campaign-form"]')?.disabled, null, { timeout: 20000 });
  await p.waitForTimeout(700);
  return p.locator(".campaign-notes").innerText();
}
async function frameText(p) { await p.waitForTimeout(700); return p.frameLocator("iframe.mail-frame").locator("body").innerText(); }
async function frameHtml(p) { await p.waitForTimeout(700); return p.frameLocator("iframe.mail-frame").locator("body").innerHTML(); }
async function choosePerson(p, query, name) {
  await p.fill(".preview-picker input", query);
  const b = p.locator(".picker-list button", { hasText: name }).first();
  await b.waitFor({ timeout: 5000 });
  await b.click();
  await p.waitForTimeout(1000);
}
async function pickerNames(p, query) {
  await p.fill(".preview-picker input", query);
  await p.waitForTimeout(1200);
  return p.locator(".picker-list li").allInnerTexts();
}
async function chooseLayout(p, label) { await p.locator(".chooser button", { hasText: new RegExp(`^${label}$`) }).click(); }
const camp = (id) => q(`select name,sender_name,reply_to,subject,preview_text,content_kind,coalesce(blocks::text,''),coalesce(html,''),version,merge_links::text from campaigns where id=${id}`);
module.exports = { ...H, ed, newCampaign, save, frameText, frameHtml, choosePerson, pickerNames, chooseLayout, camp };
