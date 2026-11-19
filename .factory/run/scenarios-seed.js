// US3 scenarios 1-3 on :3108 (crm_seed, freshly migrated + seeded once). Arg "count" just prints the Users row count.
const L = require("./lib"); const { check, signIn, bodyText, rowCount } = L; const fs = require("fs"); const B = "http://localhost:3108";
(async () => {
  const browser = await L.chromium.launch(); const pg = async () => (await browser.newContext()).newPage();
  // Sign in as the fake admin by picking from the list.
  let p = await pg(); await p.goto(B + "/dev/fake-google"); const list = await p.locator("ul.chooser li").allInnerTexts();
  await Promise.all([p.waitForLoadState("networkidle"), p.locator("ul.chooser button", { hasText: "ada@barnacle.ai" }).click()]); await p.waitForTimeout(300);
  const home = new URL(p.url()).pathname;
  await p.goto(B + "/admin/users"); const rows = (await p.locator("table.users tbody tr").allInnerTexts()).map(r => r.replace(/\s+/g, " "));
  console.log("COUNT " + rows.length); console.log(rows.join("\n"));
  if (process.argv[2] === "count") { await browser.close(); return; }
  // pick deactivated, type unlisted
  const q = await pg(); await q.goto(B + "/dev/fake-google"); await Promise.all([q.waitForLoadState("networkidle"), q.locator("ul.chooser button", { hasText: "alan@barnacle.ai" }).click()]); await q.waitForTimeout(300);
  const dt = await bodyText(q);
  await signIn(q, B, "unlisted@barnacle.ai", "Un Listed"); const ut = await bodyText(q);
  check("US3 scenario 3", list.length === 5 && home === "/" && dt.includes("Your access has been removed. Ask an admin if this is a mistake.") && ut.includes("This account doesn't have access yet. Ask an admin to add you."),
    `list: ${list.map(s => s.replace(/\s+/g, " ")).join(", ")}; picked ada → ${home}; picked alan (deactivated) → removed msg=${dt.includes("access has been removed")}; typed unlisted@ → not-yet msg=${ut.includes("doesn't have access yet")}`);
  await browser.close(); fs.writeFileSync("/tmp/results-seed.json", JSON.stringify(L.results, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
