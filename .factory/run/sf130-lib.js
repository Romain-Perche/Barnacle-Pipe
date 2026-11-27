// SF-130 AI review helpers (reply and forward), on top of sf129-lib.js. Run scripts with NODE_PATH=/opt/playwright/node_modules.
const L = require("./sf129-lib.js");
const { execFileSync } = require("child_process");
const { q, norm, go } = L;
function ctl130(...args) { return JSON.parse(execFileSync("npx", ["tsx", ".factory/run/sf130-ctl.ts", ...args], { cwd: L.ROOT, env: L.ENV, encoding: "utf8" }).trim().split("\n").pop()); }
const sent130 = (email) => ctl130("sent", email);
const rpanel = (p) => p.locator('section.sidepanel[aria-label="Reply"]');
const mid = (subject) => Number(q(`select id from email_messages where subject='${subject.replace(/'/g, "''")}' order by id limit 1`));
async function chips(p, label) { return (await p.locator(`.sidepanel .chips:has(input[aria-label="${label} addresses"]) .chip`).allInnerTexts()).map((t) => t.replace(/×\s*$/, "").trim()); }
async function chipTitles(p, label) { return p.locator(`.sidepanel .chips:has(input[aria-label="${label} addresses"]) .chip`).evaluateAll((els) => els.map((e) => e.getAttribute("title") || e.textContent.replace(/×\s*$/, "").trim())); }
// The EMAIL entry li of a timeline for a subject (first), or the conversation page article.
const entryOf = (p, subj) => p.getByRole("region", { name: "Timeline" }).locator("li.ent:has(.kd.email)").filter({ has: p.locator(".subj", { hasText: new RegExp("^\\s*" + subj.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$") }) }).first();
async function openReply(p, scope, button) {
  await scope.getByRole("link", { name: button, exact: true }).first().click();
  await rpanel(p).waitFor({ timeout: 30000 });
  await p.waitForLoadState("networkidle");
}
async function boxState(p) {
  const pn = rpanel(p);
  return {
    heading: norm(await pn.locator(".hd span").first().innerText()),
    from: norm(await pn.locator(".frm").first().innerText()),
    to: await chips(p, "To"), toAddr: await chipTitles(p, "To"), cc: await chips(p, "Cc"), ccAddr: await chipTitles(p, "Cc"), bcc: await chips(p, "Bcc"),
    subject: await p.inputValue("#email-subject"), text: await p.inputValue("#email-text"),
    quote: (await pn.locator("pre.quote").count()) ? await pn.locator("pre.quote").innerText() : null,
    atts: (await pn.locator(".attachlist li").allInnerTexts()).map(norm),
    room: (await pn.locator(".tot").count()) ? norm(await pn.locator(".tot").innerText()) : null,
    notices: (await pn.locator(".err, .notice").allInnerTexts()).map(norm),
  };
}
async function sendReply(p, { expectClose = true } = {}) {
  await rpanel(p).getByRole("button", { name: "[ SEND ]" }).click();
  if (expectClose) await rpanel(p).waitFor({ state: "detached", timeout: 60000 });
  else { await p.waitForTimeout(500); await p.waitForFunction(() => !document.querySelector(".sidepanel button[type=submit]")?.disabled, null, { timeout: 60000 }); }
  await p.waitForLoadState("networkidle");
}
module.exports = { ...L, ctl130, sent130, rpanel, mid, chips, chipTitles, entryOf, openReply, boxState, sendReply };
