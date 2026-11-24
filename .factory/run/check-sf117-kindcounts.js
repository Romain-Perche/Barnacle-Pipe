// SF-117 fix round 1 (AI review): the "// COUNTS" table of 3 REPORT, per kind, checked against pipedrive_links.
// Run after `bash .factory/run/reset-db.sh` with the app on :3000 (in-process fake Pipedrive).
// NODE_PATH=/opt/playwright/node_modules BASE=http://localhost:3000 node .factory/run/check-sf117-kindcounts.js
const { chromium } = require("playwright");
const L = require("./sf117-lib");
(async () => {
  const browser = await chromium.launch();
  const ada = await L.newPage(browser, "ada@barnacle.ai", "Ada Fake");
  console.log(await L.saveToken(ada, "fake-pipedrive-token"));
  await L.startImport(ada, { people: true, orgs: true, consent: "subscribed" });
  await L.waitReport(ada);
  const t = await ada.locator('section[aria-label="Counts per kind"]').innerText();
  console.log("TABLE:", t.replace(/\s+/g, " "));
  console.log("DB:", L.q(`select kind, count(*) filter (where how='imported') imp, count(*) filter (where how='linked') lnk from pipedrive_links group by kind order by kind`));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
