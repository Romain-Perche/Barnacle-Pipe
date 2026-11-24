// Edge 8 extra: on the app with Storage unreachable (:3001), ?file=<png> shows the message, no box.
const { chromium, signIn } = require("./lib.js");
const { execSync } = require("child_process");
(async () => {
  const id = execSync(`/usr/lib/postgresql/17/bin/psql -h localhost -U postgres -d crm_dev -Atc "select id from files where name='site-mockup.png' and deal_id=1 limit 1"`).toString().trim();
  const b = await chromium.launch(); const p = await (await b.newContext()).newPage(); const B = "http://localhost:3001";
  await signIn(p, B, "ada@barnacle.ai", "Ada Fake");
  await p.goto(`${B}/deals/1?file=${id}`); await p.waitForLoadState("networkidle");
  const t = await p.textContent("body");
  console.log("url", p.url(), "dialogs", await p.getByRole("dialog").count(), "msg", t.includes("Files can't be reached right now. Try again in a minute."));
  await b.close();
})();
