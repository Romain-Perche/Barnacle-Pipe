// Scenarios on the extra servers: 3101 empty DB + FIRST_ADMIN boss@ (APP_ENV=test), 3102 empty DB no FIRST_ADMIN,
// 3103 VERCEL_ENV=preview, 3104 APP_ENV empty, 3105 APP_ENV=production, 3106 APP_ENV=development+VERCEL_ENV=production,
// 3107 APP_ENV=Development. See .factory/test-env.md.
const L = require("./lib"); const { check, signIn, bodyText } = L; const fs = require("fs");
(async () => {
  const browser = await L.chromium.launch(); const pg = async () => (await browser.newContext()).newPage();
  let p = await pg(); const B1 = "http://localhost:3101";
  await signIn(p, B1, "boss@barnacle.ai", "Boss Person"); const t = (await bodyText(p)).toLowerCase();
  const usersLink = await p.locator("nav[aria-label=Admin] a", { hasText: "Users" }).count();
  check("US1 scenario 3", new URL(p.url()).pathname === "/" && t.includes("// admin") && usersLink > 0, `empty DB, boss@ signs in → ${p.url()}; admin group=${t.includes("// admin")}; Users link=${usersLink}`);
  p = await pg(); await p.goto("http://localhost:3102/sign-in"); let t2 = await bodyText(p);
  check("Edge case 4", t2.includes("The CRM isn't set up yet. No first admin has been named.") && (await p.locator("text=Sign in with Google").count()) === 0, `msg=${t2.includes("isn't set up yet")}; Google button count=${await p.locator("text=Sign in with Google").count()}`);
  p = await pg(); await p.goto("http://localhost:3103/"); let t3 = await bodyText(p);
  check("Edge case 11", p.url().includes("/sign-in") && t3.includes("Sign-in is turned off on preview deployments.") && (await p.locator("text=Sign in with Google").count()) === 0, `/ → ${p.url()}; msg=${t3.includes("turned off on preview")}; button=${await p.locator("text=Sign in with Google").count()}`);
  const envs = {};
  for (const port of [3103, 3104, 3105, 3106, 3107]) {
    p = await pg(); await p.goto(`http://localhost:${port}/sign-in`); const link = await p.locator("text=[ FAKE GOOGLE LOGIN ]").count();
    const r = await p.goto(`http://localhost:${port}/dev/fake-google`); const nf = (await bodyText(p)).includes("Page not found.");
    envs[port] = { link, nf, status: r.status() };
  }
  fs.writeFileSync("/tmp/results-env-pages.json", JSON.stringify(envs));
  console.log(JSON.stringify(envs));
  await browser.close(); fs.writeFileSync("/tmp/results-env.json", JSON.stringify(L.results, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
