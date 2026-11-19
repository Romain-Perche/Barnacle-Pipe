// Scenarios against the app on :3000 (APP_ENV=development, crm_dev freshly seeded, FIRST_ADMIN_EMAIL=ada@barnacle.ai).
const L = require("./lib");
const { check, signIn, signOut, bodyText, rowOf, rowCount, rowAction, addUser } = L;
const B = "http://localhost:3000";
const fs = require("fs"); const os = require("os"); const path = require("path");
(async () => {
  const browser = await L.chromium.launch();
  const ctx = async () => (await browser.newContext()).newPage();
  let p, t;

  // US1 sc1 + US4 sc1
  p = await ctx();
  await p.goto(B + "/admin/users");
  t = await bodyText(p);
  const onSignIn = p.url().includes("/sign-in") && (await p.locator("text=Sign in with Google").count()) > 0;
  await p.click("text=[ FAKE GOOGLE LOGIN ]"); await p.fill('input[name="email"]:visible', "grace@barnacle.ai"); await p.fill('input[name="name"]:visible', "Grace Hopper");
  await Promise.all([p.waitForLoadState("networkidle"), p.click("text=[ CONTINUE ]")]); await p.waitForTimeout(300);
  const back = new URL(p.url()).pathname;
  const p2 = await ctx(); await p2.goto(B + "/"); const p2url = p2.url();
  await signIn(p2, B, "linus@barnacle.ai", "Linus Torvalds"); const homeAfter = new URL(p2.url()).pathname;
  check("US1 scenario 1", onSignIn && back === "/admin/users" && homeAfter === "/", `asked /admin/users → ${p.url().replace(B,"")} had button=${onSignIn}; after sign-in at ${back}; asked / → ${p2url.replace(B,"")}, after sign-in ${homeAfter}`);
  // US4 sc1
  const paths = ["/", "/admin/users", "/pipelines", "/some/deep/x?y=1"]; const seen = [];
  const q = await ctx();
  for (const x of paths) { await q.goto(B + x); seen.push(`${x}→${new URL(q.url()).pathname}:${(await q.locator("text=Sign in with Google").count())>0}`); }
  check("US4 scenario 1", seen.every(s => s.includes("→/sign-in:true")), seen.join(", "));

  // US1 sc2: admin adds person, they sign in
  const a = await ctx(); await signIn(a, B, "ada@barnacle.ai", "Ada Lovelace"); await a.goto(B + "/admin/users");
  await addUser(a, B, "mikey@barnacle.ai");
  const m = await ctx(); await signIn(m, B, "mikey@barnacle.ai", "Mikey Smith"); t = await bodyText(m);
  const side = await m.locator("aside, nav").first().innerText().catch(() => "");
  const sb = await bodyText(m);
  const nameIdx = sb.lastIndexOf("Mikey Smith"), soIdx = sb.indexOf("[ Sign out ]");
  check("US1 scenario 2", t.includes("Hello, Mikey") && nameIdx >= 0 && nameIdx < soIdx && new URL(m.url()).pathname === "/", `home url ${m.url().replace(B,"")}; hello=${t.includes("Hello, Mikey")}; full name before Sign out=${nameIdx < soIdx}`);

  // Edge 1: case-insensitive
  const c1 = await ctx(); await signIn(c1, B, "Mikey@Barnacle.ai", "Mikey Smith");
  check("Edge case 1", new URL(c1.url()).pathname === "/" && (await bodyText(c1)).includes("Hello, Mikey"), `signed in as Mikey@Barnacle.ai → ${c1.url().replace(B,"")}`);

  // US1 sc4
  const u4 = await ctx(); await signIn(u4, B, "stranger@barnacle.ai", "Stranger Person"); const u4t = await bodyText(u4);
  await u4.goto(B + "/"); const u4b = u4.url();
  check("US1 scenario 4", u4t.includes("This account doesn't have access yet. Ask an admin to add you.") && u4b.includes("/sign-in"), `msg shown=${u4t.includes("doesn't have access yet")}; home → ${u4b.replace(B,"")}`);
  // US1 sc5
  const u5 = await ctx(); await signIn(u5, B, "someone@gmail.com", "Some One"); const u5t = await bodyText(u5);
  await u5.goto(B + "/"); const u5b = u5.url();
  check("US1 scenario 5", u5t.includes("Only barnacle.ai Google accounts can sign in.") && u5b.includes("/sign-in"), `msg=${u5t.includes("Only barnacle.ai Google accounts")}; home → ${u5b.replace(B,"")}`);

  // US1 sc6
  const s6 = await ctx(); await signIn(s6, B, "linus@barnacle.ai", "Linus Torvalds"); await signOut(s6);
  const after = s6.url(); await s6.goto(B + "/"); const h = s6.url(); await s6.goto(B + "/admin/users"); const u = s6.url();
  check("US1 scenario 6", [after, h, u].every(x => x.includes("/sign-in")) && (await s6.locator("text=Sign in with Google").count()) > 0, `after sign out ${after.replace(B,"")}; / → ${h.replace(B,"")}; /admin/users → ${u.replace(B,"")}`);

  // US1 sc7: real persistent profile, close and relaunch
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-prof-"));
  let pc = await L.chromium.launchPersistentContext(dir); let pp = pc.pages()[0] || await pc.newPage();
  await signIn(pp, B, "linus@barnacle.ai", "Linus Torvalds"); const ck = (await pc.cookies()).map(c => `${c.name} expires in ${Math.round((c.expires - Date.now()/1000)/86400)}d`); await pc.close();
  pc = await L.chromium.launchPersistentContext(dir); pp = pc.pages()[0] || await pc.newPage(); await pp.goto(B + "/");
  const s7t = await bodyText(pp);
  check("US1 scenario 7", new URL(pp.url()).pathname === "/" && s7t.includes("Hello, Linus"), `after browser relaunch: ${pp.url().replace(B,"")}; cookies: ${ck.join(",")}`); await pc.close();

  // US2 sc1 + Edge 6
  await a.goto(B + "/admin/users"); const rows = await a.locator("table.users tbody tr").allInnerTexts();
  const rowOk = rows.every(r => /(admin|user)/i.test(r) && /(active|deactivated)/i.test(r) && /@barnacle\.ai/.test(r));
  const mk = await rowOf(a, "mikey@barnacle.ai"); const mg = await rowOf(a, "margaret@barnacle.ai");
  check("US2 scenario 1", rowOk && rows.length === 6 && /Never/.test(mg), `${rows.length} rows (5 seeded + mikey); e.g. ${rows.slice(0,6).map(r=>r.replace(/\s+/g," ")).join(" | ")}`);

  // US2 sc2
  await addUser(a, B, "newperson@barnacle.ai"); const np = await rowOf(a, "newperson@barnacle.ai");
  const npP = await ctx(); await signIn(npP, B, "newperson@barnacle.ai", "New Person");
  check("US2 scenario 2", np && /\buser\b/i.test(np) && /\bactive\b/i.test(np) && new URL(npP.url()).pathname === "/", `row: ${np && np.replace(/\s+/g," ")}; sign-in → ${npP.url().replace(B,"")}`);

  // Edge 6 (fresh added never signed in)
  await addUser(a, B, "neverin@barnacle.ai"); const ni = await rowOf(a, "neverin@barnacle.ai");
  check("Edge case 6", ni && /^\s*neverin\b/.test(ni) && /Never/.test(ni), `row: ${ni && ni.replace(/\s+/g," ")}`);
  // Edge 2
  await addUser(a, B, "  jd@barnacle.ai  "); const jd = await rowOf(a, "jd@barnacle.ai"); const jdEmail = await a.locator("tr", { hasText: "jd@barnacle.ai" }).locator(".em").innerText().catch(()=>null);
  check("Edge case 2", jdEmail === "jd@barnacle.ai", `email cell: ${JSON.stringify(jdEmail)}`);

  // US2 sc3
  let n0 = await rowCount(a); await addUser(a, B, "x@gmail.com"); let e1 = await bodyText(a); let n1 = await rowCount(a);
  await addUser(a, B, "JD@barnacle.ai"); let e2 = await bodyText(a); let n2 = await rowCount(a);
  check("US2 scenario 3", e1.includes("Only barnacle.ai addresses can be added.") && e2.includes("This person is already a user.") && n0 === n1 && n1 === n2, `rows ${n0}/${n1}/${n2}; outside msg=${e1.includes("Only barnacle.ai addresses")}; dup msg=${e2.includes("already a user")}`);

  // US2 sc4: make margaret admin; margaret reloads
  const mg1 = await ctx(); await signIn(mg1, B, "margaret@barnacle.ai", "Margaret Hamilton");
  const beforeAdmin = (await bodyText(mg1)).toLowerCase().includes("// admin");
  await a.goto(B + "/admin/users"); await rowAction(a, "margaret@barnacle.ai", "[ MAKE ADMIN ]"); const mr = await rowOf(a, "margaret@barnacle.ai");
  await mg1.reload(); const mgAdmin = (await bodyText(mg1)).toLowerCase().includes("// admin"); await mg1.goto(B + "/admin/users"); const mgUsers = (await rowCount(mg1)) > 0;
  check("US2 scenario 4", /admin/i.test(mr) && !beforeAdmin && mgAdmin && mgUsers, `row: ${mr.replace(/\s+/g," ")}; admin group before=${beforeAdmin} after reload=${mgAdmin}; Users table visible=${mgUsers}`);

  // US2 sc5: ada removes margaret's admin; margaret next load
  await rowAction(a, "margaret@barnacle.ai", "[ REMOVE ADMIN ]"); const mr2 = await rowOf(a, "margaret@barnacle.ai");
  await mg1.goto(B + "/"); const mgNo = !(await bodyText(mg1)).toLowerCase().includes("// admin"); await mg1.goto(B + "/admin/users"); const mgForb = (await bodyText(mg1)).includes("You don't have access to this page.");
  // also self-removal (Edge 9): grace removes own rights
  const g = await ctx(); await signIn(g, B, "grace@barnacle.ai", "Grace Hopper"); await g.goto(B + "/admin/users"); await rowAction(g, "grace@barnacle.ai", "[ REMOVE ADMIN ]");
  const gUrl = new URL(g.url()).pathname; const gT = await bodyText(g); await a.reload(); const gr = await rowOf(a, "grace@barnacle.ai");
  check("US2 scenario 5", /\buser\b/i.test(mr2) && mgNo && mgForb && /\buser\b/i.test(gr), `other: row ${mr2.replace(/\s+/g," ")}, admin group hidden=${mgNo}, forbidden=${mgForb}; self (grace): row ${gr.replace(/\s+/g," ")}`);
  check("Edge case 9", gUrl === "/" && gT.includes("Hello, Grace") && !gT.toLowerCase().includes("// admin"), `after self-removal at ${gUrl}; admin group shown=${gT.toLowerCase().includes("// admin")}`);

  // US2 sc8: ada is only active admin now
  await a.goto(B + "/admin/users"); await rowAction(a, "ada@barnacle.ai", "[ REMOVE ADMIN ]"); const l1 = await bodyText(a); const ar = await rowOf(a, "ada@barnacle.ai");
  check("US2 scenario 8", l1.includes("The CRM must always have at least one active admin.") && /admin/i.test(ar) && /\bactive\b/i.test(ar), `remove own rights as only admin → msg=${l1.includes("at least one active admin")}; row ${ar.replace(/\s+/g," ")} (deactivate of the only admin covered by Edge 8: no button; direct path in integration tests)`);

  // Edge 8
  const own = await rowOf(a, "ada@barnacle.ai");
  check("Edge case 8", own.includes("[ REMOVE ADMIN ]") && !own.includes("[ DEACTIVATE ]"), `own row: ${own.replace(/\s+/g," ")}`);

  // US2 sc6: deactivate linus while signed in (s6 signed out; use new)
  const ln = await ctx(); await signIn(ln, B, "linus@barnacle.ai", "Linus Torvalds");
  await rowAction(a, "linus@barnacle.ai", "[ DEACTIVATE ]"); const lr = await rowOf(a, "linus@barnacle.ai");
  await ln.goto(B + "/"); const lnT = await bodyText(ln); const lnU = ln.url();
  await signIn(ln, B, "linus@barnacle.ai", "Linus Torvalds"); const lnT2 = await bodyText(ln);
  const RM = "Your access has been removed. Ask an admin if this is a mistake.";
  check("US2 scenario 6", /deactivated/i.test(lr) && lnU.includes("/sign-in") && lnT.includes(RM) && lnT2.includes(RM), `row ${lr.replace(/\s+/g," ")}; next load → ${lnU.replace(B,"")} msg=${lnT.includes(RM)}; re-sign-in msg=${lnT2.includes(RM)}`);

  // US2 sc7: reactivate linus (was user) and an admin case: make margaret admin, deactivate, reactivate
  await rowAction(a, "linus@barnacle.ai", "[ REACTIVATE ]"); const lr2 = await rowOf(a, "linus@barnacle.ai");
  await rowAction(a, "margaret@barnacle.ai", "[ MAKE ADMIN ]"); await rowAction(a, "margaret@barnacle.ai", "[ DEACTIVATE ]"); await rowAction(a, "margaret@barnacle.ai", "[ REACTIVATE ]"); const mr3 = await rowOf(a, "margaret@barnacle.ai");
  const ln2 = await ctx(); await signIn(ln2, B, "linus@barnacle.ai", "Linus Torvalds");
  check("US2 scenario 7", /\bactive\b/i.test(lr2) && /\buser\b/i.test(lr2) && /admin/i.test(mr3) && /\bactive\b/i.test(mr3) && new URL(ln2.url()).pathname === "/", `linus row ${lr2.replace(/\s+/g," ")}; margaret (admin) after deactivate+reactivate ${mr3.replace(/\s+/g," ")}; linus sign-in → ${ln2.url().replace(B,"")}`);

  // Edge 3: first admin (ada) deactivated by margaret
  const mg2 = await ctx(); await signIn(mg2, B, "margaret@barnacle.ai", "Margaret Hamilton"); await mg2.goto(B + "/admin/users"); await rowAction(mg2, "ada@barnacle.ai", "[ DEACTIVATE ]");
  const e3 = await ctx(); await signIn(e3, B, "ada@barnacle.ai", "Ada Lovelace"); const e3t = await bodyText(e3);
  check("Edge case 3", e3t.includes(RM) && e3.url().includes("/sign-in"), `first admin ada deactivated by margaret, signs in → ${e3.url().replace(B,"")} msg=${e3t.includes(RM)}`);
  await rowAction(mg2, "ada@barnacle.ai", "[ REACTIVATE ]");

  // Edge 10: ada (A) and margaret (B) both open Users page
  const A = await ctx(); await signIn(A, B, "ada@barnacle.ai", "Ada Lovelace"); await A.goto(B + "/admin/users");
  await mg2.goto(B + "/admin/users");
  await rowAction(A, "margaret@barnacle.ai", "[ REMOVE ADMIN ]");
  await rowAction(mg2, "ada@barnacle.ai", "[ REMOVE ADMIN ]"); const e10 = await bodyText(mg2); await A.reload(); const adaRow = await rowOf(A, "ada@barnacle.ai");
  check("Edge case 10", e10.includes("You don't have access to this page.") && /admin/i.test(adaRow), `B sees forbidden=${e10.includes("You don't have access")}; A row ${adaRow.replace(/\s+/g," ")}`);

  // US2 sc9: linus (user) opens users page and posts admin action directly
  await ln2.goto(B + "/admin/users"); const f1 = await bodyText(ln2);
  const before9 = (await A.locator("table.users tbody tr").allInnerTexts()).join("|");
  // Direct server action: replay an admin's form post (action id) with linus's cookies.
  let actionId = null;
  A.on("request", r => { if (r.method() === "POST" && r.headers()["next-action"]) actionId = actionId || { id: r.headers()["next-action"], body: r.postData(), ct: r.headers()["content-type"], router: r.headers()["next-router-state-tree"] }; });
  // capture by doing a harmless failing action (add duplicate) as admin
  await addUser(A, B, "jd@barnacle.ai");
  const lnCookies = (await ln2.context().cookies()).map(c => `${c.name}=${c.value}`).join("; ");
  let direct = "no action captured";
  if (actionId) {
    // Make it a real change: add "hacker@barnacle.ai"
    const body = actionId.body.replace(/jd@barnacle\.ai/, "hacker@barnacle.ai");
    const r = await fetch(B + "/admin/users", { method: "POST", redirect: "manual", headers: { "next-action": actionId.id, "content-type": actionId.ct, cookie: lnCookies, accept: "text/x-component" }, body });
    direct = `direct addUser POST status ${r.status} redirect=${r.headers.get("x-action-redirect") || r.headers.get("location")}`;
  }
  await A.reload(); const after9 = (await A.locator("table.users tbody tr").allInnerTexts()).join("|");
  await ln2.goto(B + "/"); const noAdminGrp = !(await bodyText(ln2)).toLowerCase().includes("// admin");
  check("US2 scenario 9", f1.includes("You don't have access to this page.") && before9 === after9 && !after9.includes("hacker@") && noAdminGrp, `page forbidden=${f1.includes("You don't have access")}; ${direct}; rows unchanged=${before9 === after9}; admin group hidden=${noAdminGrp}`);

  // Edge 5: same email new name
  const e5 = await ctx(); await signIn(e5, B, "linus@barnacle.ai", "Linus Renamed"); const e5t = await e5.innerText("body"); await A.reload(); const lr5 = await rowOf(A, "linus@barnacle.ai");
  check("Edge case 5", e5t.includes("Linus Renamed") && lr5.includes("Linus Renamed"), `sidebar has new name=${e5t.includes("Linus Renamed")}; row ${lr5.replace(/\s+/g," ")}`);

  // Edge 7: cancel
  const e7 = await ctx(); await e7.goto(B + "/dev/fake-google"); await Promise.all([e7.waitForLoadState("networkidle"), e7.click("text=[ CANCEL ]")]); await e7.waitForTimeout(300);
  const e7t = await bodyText(e7);
  check("Edge case 7", e7t.includes("Sign-in was cancelled or failed. Please try again.") && (await e7.locator("text=Sign in with Google").count()) > 0, `→ ${e7.url().replace(B,"")}; msg=${e7t.includes("cancelled or failed")}`);


  // Edge 16: open redirect through /auth/end and /auth/google/start (raw Location, then followed in the browser)
  const e16c = await (await browser.newContext()); const e16p = await e16c.newPage(); await signIn(e16p, B, "grace@barnacle.ai", "Grace Hopper");
  const e16out = [];
  for (const n of ["%2F%09%2Fexample.com", "%2F%0A%2Fexample.com", "%2F%0D%2Fexample.com", "%2F%5Cexample.com", "%2F%09%5Cexample.com", "https%3A%2F%2Fexample.com%2F"]) {
    const r = await e16c.request.get(B + "/auth/end?next=" + n, { maxRedirects: 0 });
    await e16p.goto(B + "/auth/end?next=" + n); const u = new URL(e16p.url());
    e16out.push(`${n}: ${r.status()} Location=${r.headers()["location"]} → ${u.origin === B ? u.pathname : u.href} hello=${(await bodyText(e16p)).includes("Hello, Grace")}`);
  }
  const e16ok1 = e16out.every(x => x.includes("→ / ") && x.includes("hello=true"));
  // signed-out: start sign-in with a hidden-character next; the fake login is the in-app Google stand-in
  const s16 = await ctx(); await s16.goto(B + "/auth/google/start?next=%2F%0A%2Fexample.com", { waitUntil: "commit" }).catch(() => {});
  const startUrl = s16.url();
  const s16b = await ctx(); await signIn(s16b, B, "grace@barnacle.ai", "Grace Hopper", "/\n/example.com");
  const s16u = new URL(s16b.url());
  e16out.push(`start → ${startUrl.slice(0, 120)}; fake login with next "/\\n/example.com" → ${s16u.origin === B ? s16u.pathname : s16u.href}`);
  check("Edge case 16", e16ok1 && s16u.origin === B && s16u.pathname === "/", e16out.join("; "));

  // Edge 17 + US4 sc2
  await ln2.goto(B + "/no/such/page"); const e17 = await bodyText(ln2); const homeLink = await ln2.locator("main a[href='/']").count();
  const hasAside = (await ln2.locator("text=[ Sign out ]").count()) > 0;
  check("Edge case 17", e17.includes("Page not found.") && hasAside && homeLink > 0, `signed-in /no/such/page: msg=${e17.includes("Page not found.")}, sidebar=${hasAside}, Home link in main=${homeLink}`);
  const lay = async (pg, url) => { await pg.goto(B + url); return pg.evaluate(() => {
    const side = document.querySelector("aside") || document.querySelector("nav");
    const cur = [...document.querySelectorAll("a[aria-current], a.active, a.on, a[data-active='true']")].map(a => a.textContent.trim());
    return { bg: side && getComputedStyle(side).backgroundColor, txt: side && side.innerText.replace(/\s+/g, " "), svg: !!(side && side.querySelector("svg, img")), cur };
  }); };
  const l1h = await lay(A, "/"), l1u = await lay(A, "/admin/users");
  check("US4 scenario 2", l1h.bg === l1u.bg && /Home/i.test(l1h.txt) && /Ada Lovelace.*\[ Sign out \]/i.test(l1h.txt) && /Ada Lovelace.*\[ Sign out \]/i.test(l1u.txt) && l1h.cur.join() .includes("Home") && l1u.cur.join().includes("Users") && l1h.svg, `home sidebar bg ${l1h.bg} text "${l1h.txt}" current=${l1h.cur}; users sidebar bg ${l1u.bg} current=${l1u.cur}`);
  await A.goto(B + "/"); await A.screenshot({ path: "/tmp/home.png" }); await A.goto(B + "/admin/users"); await A.screenshot({ path: "/tmp/users.png" });

  await browser.close();
  fs.writeFileSync("/tmp/results-main.json", JSON.stringify(L.results, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
