// SF-129 AI review helpers (write an email from a record). Run scripts with NODE_PATH=/opt/playwright/node_modules.
const L127 = require("./sf127-lib.js");
const { execFileSync } = require("child_process");
const { q, norm, go } = L127;
const ROOT = require("path").resolve(__dirname, "../..");
const ENV = { ...process.env, APP_ENV: "development", DATABASE_URL: "postgres://postgres@localhost:5432/crm_dev", GMAIL_TOKEN_KEY: require("fs").readFileSync("/tmp/gmail-token-key", "utf8").trim(), APP_URL: "http://localhost:3000" };
// Ada's (or any user's) fake Sent mail through the fake's state file: [{id, from, to, cc, bcc, subject, text, attachments:[{name,type,size,sha}]}]
function sent(email) {
  return JSON.parse(execFileSync("npx", ["tsx", ".factory/run/sf129-ctl.ts", "sent", email], { cwd: ROOT, env: ENV, encoding: "utf8" }).trim().split("\n").pop());
}
function ctl(...args) { return execFileSync("npx", ["tsx", ".factory/run/gmail-ctl.ts", ...args], { cwd: ROOT, env: ENV, encoding: "utf8" }).trim(); }
const recId = (kind, name) => Number(kind === "deal" ? q(`select id from deals where title='${name}'`) : kind === "org" ? q(`select id from organisations where name='${name}'`) : q(`select id from persons where first_name||' '||last_name='${name}'`));
const pathOf = (kind, id) => (kind === "deal" ? `/deals/${id}` : kind === "org" ? `/organisations/${id}` : `/people/${id}`);
const panel = (p) => p.locator('section.sidepanel[aria-label="New email"]');
async function chips(p, label) { return (await p.locator(`.sidepanel .chips:has(input[aria-label="${label} addresses"]) .chip`).allInnerTexts()).map((t) => t.replace(/×\s*$/, "").trim()); }
async function openBox(p, path) {
  await go(p, path);
  await p.getByRole("region", { name: "Timeline" }).getByRole("link", { name: "[ WRITE EMAIL ]" }).first().click();
  await panel(p).waitFor();
  await p.waitForLoadState("networkidle");
}
async function addAddr(p, label, text) { const i = p.locator(`.sidepanel input[aria-label="${label} addresses"]`); await i.fill(text); await i.press("Enter"); }
async function removeAll(p, label) { const b = p.locator(`.sidepanel .chips:has(input[aria-label="${label} addresses"]) .chip-x`); while (await b.count()) await b.first().click(); }
async function fill(p, { to, cc, bcc, subject, text }) {
  if (to) for (const a of to) await addAddr(p, "To", a);
  if (cc) for (const a of cc) await addAddr(p, "Cc", a);
  if (bcc) for (const a of bcc) await addAddr(p, "Bcc", a);
  if (subject != null) await p.fill("#email-subject", subject);
  if (text != null) await p.fill("#email-text", text);
}
async function send(p, { expectClose = true } = {}) {
  const btn = panel(p).getByRole("button", { name: "[ SEND ]" });
  await btn.click();
  if (expectClose) await panel(p).waitFor({ state: "detached", timeout: 60000 });
  else { await p.waitForTimeout(300); await p.waitForFunction(() => !document.querySelector(".sidepanel button[type=submit]")?.disabled, null, { timeout: 60000 }); }
  await p.waitForLoadState("networkidle");
}
const errs = async (p) => (await panel(p).locator(".err, .notice").allInnerTexts()).map(norm);
module.exports = { ...L127, sent, ctl, recId, pathOf, panel, chips, openBox, addAddr, removeAll, fill, send, errs, ENV, ROOT };
// Sign in keeping the user's full name (the free-form fake login renames a user to the address's local part otherwise).
const NAMES = { "ada@barnacle.ai": "Ada Fake", "grace@barnacle.ai": "Grace Fake", "linus@barnacle.ai": "Linus Fake", "margaret@barnacle.ai": "Margaret Fake" };
module.exports.pageAs = async function pageAs(browser, email, viewport = { width: 1400, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(L127.BASE + "/dev/fake-google");
  await p.fill('input[name="email"]:visible', email);
  if (await p.locator('input[name="name"]:visible').count()) await p.fill('input[name="name"]:visible', NAMES[email] || "");
  await Promise.all([p.waitForLoadState("networkidle"), p.click("text=[ CONTINUE ]")]);
  return p;
};
