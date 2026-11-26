// SF-126 double-click scenarios. App on :3000 (start-app.sh).
const { chromium, check, signIn } = require("./lib.js");
const B = "http://localhost:3000";
(async () => {
  const br = await chromium.launch(); const page = await (await br.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await signIn(page, B, "ada@barnacle.ai", "Ada Fake");
  const wait = (ms = 1200) => page.waitForTimeout(ms);
  // board
  await page.goto(B + "/deals"); await wait();
  const card = page.locator("a.card").first();
  const cname = (await card.innerText()).split("\n")[0];
  const page_ = await card.getAttribute("data-page");
  await card.click(); await wait();
  check("US1-2 single click", /open=/.test(page.url()) && page.url().includes("/deals"), page.url());
  await page.goto(B + "/deals"); await wait();
  await page.locator("a.card").first().dblclick(); await wait(2000);
  check("US1-1 board dblclick", page.url().endsWith(page_), `${page.url()} expected ${page_}`);
  await page.goto(B + "/deals"); await wait();
  const hdr = page.locator(".col header, header").first(); await hdr.dblclick(); await wait();
  const plus = page.locator("a[aria-label*='dd' i], a:has-text('+')").first();
  if (await plus.count()) { await plus.dblclick(); await wait(); }
  console.log("after header/plus:", page.url());
  // deal list
  await page.goto(B + "/deals/list?sort=value&page=1"); await wait();
  const url0 = page.url();
  const row = page.locator("tbody tr").nth(1); const dp = await row.getAttribute("data-page");
  await row.locator("td").nth(4).dblclick(); await wait(2000);
  check("US2-1 list dblclick cell", page.url().endsWith(dp), page.url() + " exp " + dp);
  await page.goBack(); await wait(1500);
  check("US2-3 back", page.url().startsWith(url0.split("?")[0]) && !page.url().includes("open="), page.url());
  await page.locator("tbody tr").nth(1).locator("td").nth(4).click(); await wait();
  check("US2-2 list single", /open=/.test(page.url()), page.url());
  // name link dblclick
  await page.goto(B + "/deals/list"); await wait();
  const nm = page.locator("tbody tr").nth(2); const dp2 = await nm.getAttribute("data-page");
  await nm.locator("a.nm").first().dblclick(); await wait(2000);
  console.log("name dblclick ->", page.url(), "exp", dp2);
  // people
  for (const [path, seg] of [["/people", "people"], ["/organisations", "organisations"]]) {
    await page.goto(B + path); await wait();
    const r = page.locator("tbody tr").nth(1); const d = await r.getAttribute("data-page");
    const tds = r.locator("td"); const n = await tds.count();
    await tds.nth(n - 2).dblclick(); await wait(2000);
    check(seg + " dblclick", page.url().endsWith(d), page.url() + " exp " + d);
    await page.goto(B + path); await wait();
    await page.locator("tbody tr").nth(1).locator("td").nth(n - 2).click(); await wait();
    check(seg + " single", /open=/.test(page.url()), page.url());
  }
  // text selection / linked org in people
  await page.goto(B + "/people"); await wait();
  const orgLink = page.locator("tbody tr a[href^='/organisations/']").first();
  if (await orgLink.count()) { const h = await orgLink.getAttribute("href"); await orgLink.dblclick(); await wait(2000); check("edge2 org link", page.url().endsWith(h), page.url() + " exp " + h); }
  // deal list linked org/person
  await page.goto(B + "/deals/list"); await wait();
  const l2 = page.locator("tbody tr a[href^='/people/'], tbody tr a[href^='/organisations/']").first();
  if (await l2.count()) { const h = await l2.getAttribute("href"); await l2.dblclick(); await wait(2000); check("edge2 deal list link", page.url().endsWith(h), page.url() + " exp " + h); }
  // board linked? 
  // deleted deal
  await page.goto(B + "/deals/99999"); await wait(); console.log("notfound:", (await page.textContent("body")).slice(0,200).replace(/\s+/g," "));
  await br.close();
})();
