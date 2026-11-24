// SF-122 AI review, part a: sets up the scenario data (sf122-lib.js setupData), runs one import of all six kinds as Ada
// (token fake-pipedrive-token, consent Subscribed), prints the progress lines seen and the full report text to
// $TMPDIR/sf122-report.txt. Checks are done afterwards by scenarios-sf122-checks.js against the database and pages.
const L = require("./sf122-lib");
(async () => {
  const ids = await L.setupData();
  const browser = await L.chromium.launch();
  const ada = await L.newPage(browser, "ada@barnacle.ai", "Ada Fake");
  await L.saveToken(ada, "fake-pipedrive-token");
  await ada.goto(L.BASE + "/settings/pipedrive-import?new=1");
  const choose = (await ada.textContent("main")).replace(/\s+/g, " ");
  require("fs").writeFileSync((process.env.TMPDIR || "/tmp") + "/sf122-choose.txt", choose);
  await L.startAll(ada);
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 600000) {
    const p = await ada.locator("main").innerText().catch(() => "");
    const prog = p.split("\n").filter((l) => / of /.test(l)).join(" | ");
    if (prog) seen.add(prog);
    if ((await ada.locator('[aria-current="step"]', { hasText: "3 REPORT" }).count()) > 0) break;
    await ada.waitForTimeout(700);
  }
  console.log("PROGRESS SAMPLES:\n" + [...seen].slice(0, 4).concat([...seen].slice(-2)).join("\n"));
  const rep = await ada.locator("main").innerText();
  require("fs").writeFileSync((process.env.TMPDIR || "/tmp") + "/sf122-report.txt", rep);
  console.log("took", Math.round((Date.now() - t0) / 1000), "s");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
