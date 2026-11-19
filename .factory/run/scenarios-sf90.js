// SF-90 (people and organisations) AI-review scenarios. Run against :3000 (crm_dev):
//   phase A: NO_SEED=1 bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf90.js A
//   phase B: bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf90.js B
// Phase A starts from an empty CRM (only ada@barnacle.ai, the FIRST_ADMIN, plus users added by SQL); phase B uses the seed.
const { execSync } = require("child_process");
const { chromium, results, check, signIn } = require("./lib");
const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DB || "crm_dev";
const sql = (q) => execSync(`/usr/lib/postgresql/17/bin/psql -h localhost -U postgres -d ${DB} -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const TODAY = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const settle = (p) => p.waitForLoadState("networkidle").then(() => p.waitForTimeout(300));
const text = async (p) => (await p.textContent("main").catch(() => null)) || (await p.textContent("body")) || "";
const details = async (p) => (await p.locator('[aria-label="Details"]').textContent().catch(() => "")) || "";
const tl = async (p) => (await p.locator('[aria-label="Timeline"] li').allInnerTexts().catch(() => []));
const drawer = (p) => p.locator('aside[aria-label="Preview"]');
const rows = (p) => p.locator("tbody tr");
const pid = (name) => Number(sql(`select id from persons where btrim(first_name||' '||last_name)='${name.replace(/'/g, "''")}' order by id desc limit 1`));
const oid = (name) => Number(sql(`select id from organisations where name='${name.replace(/'/g, "''")}'`));
const nPersons = () => Number(sql("select count(*) from persons"));

async function sec(name, fn) {
  try { await fn(); } catch (e) { check(name, false, "error: " + String(e.message || e).split("\n")[0]); }
}
async function user(browser, email, name) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await signIn(p, BASE, email, name);
  return p;
}
async function save(p) { await Promise.all([settle(p), p.getByRole("button", { name: "[ SAVE ]" }).click()]); await settle(p); }
async function addEmailRow(p) { await p.getByRole("button", { name: "[ ADD EMAIL ADDRESS ]" }).click(); }
async function addPhoneRow(p) { await p.getByRole("button", { name: "[ ADD PHONE NUMBER ]" }).click(); }
async function fillPerson(p, f) {
  await p.goto(BASE + "/people/new"); await settle(p);
  if (f.first !== undefined) await p.getByLabel("First name").fill(f.first);
  if (f.last !== undefined) await p.getByLabel("Last name").fill(f.last);
  for (let i = 0; i < (f.emails || []).length; i++) { if (i) await addEmailRow(p); await p.getByLabel(`Email address ${i + 1}`, { exact: true }).fill(f.emails[i]); }
  for (let i = 0; i < (f.phones || []).length; i++) { if (i) await addPhoneRow(p); await p.getByLabel(`Phone number ${i + 1}`, { exact: true }).fill(f.phones[i]); }
  if (f.role) await p.getByLabel("Role or job title").fill(f.role);
  if (f.source) await p.locator("form.recform select[name=leadSourceId]").selectOption({ label: f.source });
  if (f.linkedin) await p.getByLabel("LinkedIn profile").fill(f.linkedin);
  if (f.org) { await p.getByRole("combobox", { name: "Organisation" }).fill(f.org[0]); await p.getByRole("listbox", { name: "Organisations" }).getByRole("button", { name: f.org[1], exact: true }).click(); }
  if (f.private) await p.getByLabel(/Private/).check();
}
async function addPerson(p, f) { await fillPerson(p, f); await save(p); return p.url(); }
async function fillOrg(p, f) {
  await p.goto(BASE + "/organisations/new"); await settle(p);
  for (const [k, v] of Object.entries(f)) {
    if (k === "Size") await p.getByLabel("Size").selectOption({ label: v }); else await p.getByLabel(k, { exact: true }).fill(v);
  }
}

async function phaseA(browser) {
  // Fresh CRM: only the first admin, plus Linus (user) added straight into the users table.
  const ada = await user(browser, "ada@barnacle.ai", "Ada Fake");
  sql("insert into users (email, name, role, status) values ('linus@barnacle.ai','Linus Fake','user','active')");
  const linus = await user(browser, "linus@barnacle.ai", "Linus Fake");

  await sec("US6 scenario 1", async () => {
    await ada.goto(BASE + "/admin/lead-sources-and-labels"); await settle(ada);
    const src = (await ada.locator('section[aria-label="Lead sources"] input[name=name]').evaluateAll((es) => es.map((e) => e.value))).join("|");
    const lab = await ada.locator('section[aria-label="Labels"]');
    const names = ["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Event", "Ambassador"];
    const allIn = names.every((n) => src.includes(n));
    const labRows = await lab.locator('input[name=id]').count();
    const addField = await lab.getByLabel("New label").count();
    const sidebar = await ada.locator("nav").allTextContents().then((a) => a.join(" "));
    check("US6 scenario 1", allIn && labRows === 0 && addField === 1, `lead sources=${src}; six listed=${allIn}; label rows=${labRows}; label add field=${addField}; sidebar link=${sidebar.includes("Lead sources and labels")}`);
  });

  await sec("US2 scenario 1", async () => {
    await fillOrg(linus, { Name: "Fakeco Ltd", Website: "fakeco.example", Sector: "Fitness", Size: "201–1,000", Location: "London" });
    await save(linus);
    const d = await details(linus); const t = await text(linus);
    const href = await linus.locator('[aria-label="Details"] a[href="https://fakeco.example"]').count();
    check("US2 scenario 1", /\/organisations\/\d+$/.test(linus.url()) && ["Fitness", "201–1,000", "London", "Linus Fake"].every((s) => d.includes(s)) && href === 1 && t.includes("No people yet."),
      `url=${linus.url().replace(BASE, "")}; details=${JSON.stringify(d.slice(0, 200))}; website link=${href}; "No people yet."=${t.includes("No people yet.")}`);
  });

  await sec("US2 scenario 4", async () => {
    const before = sql("select count(*) from organisations");
    await fillOrg(ada, { Name: " fakeco ltd " }); await save(ada);
    const t = await text(ada);
    const link = await ada.getByRole("link", { name: "Fakeco Ltd" }).getAttribute("href").catch(() => null);
    check("US2 scenario 4", t.includes("Fakeco Ltd already exists.") && link === `/organisations/${oid("Fakeco Ltd")}` && sql("select count(*) from organisations") === before,
      `message=${t.includes("Fakeco Ltd already exists.")}; link=${link}; orgs ${before}->${sql("select count(*) from organisations")}`);
  });

  await sec("US1 scenario 1", async () => {
    const url = await addPerson(linus, { first: "Ada", last: "Example", emails: ["ada@example.com", "ada.home@example.net"], phones: ["+44 20 7946 0000"], role: "COO", source: "Referral" });
    const d = await details(linus); const h = await linus.locator("h1").textContent();
    const want = ["ada@example.com", "ada.home@example.net", "+44 20 7946 0000", "COO", "Referral", "Linus Fake", "Subscribed", TODAY, "Never"];
    const miss = want.filter((s) => !d.includes(s));
    check("US1 scenario 1", /\/people\/\d+$/.test(url) && h.includes("Ada Example") && miss.length === 0, `url=${url.replace(BASE, "")}; h1=${h}; missing=${JSON.stringify(miss)}; details=${JSON.stringify(d.replace(/\s+/g, " ").slice(0, 400))}`);
  });

  await sec("US2 scenario 2", async () => {
    await addPerson(linus, { first: "Bea", last: "Linked", emails: ["bea@example.com"], role: "CFO", org: ["Fakeco", "Fakeco Ltd"] });
    const link = await linus.locator('[aria-label="Details"]').getByRole("link", { name: "Fakeco Ltd" }).getAttribute("href").catch(() => null);
    // edit Ada Example and pick the organisation too
    await linus.goto(`${BASE}/people/${pid("Ada Example")}/edit`); await settle(linus);
    await linus.getByRole("combobox", { name: "Organisation" }).fill("fakeco");
    await linus.getByRole("listbox", { name: "Organisations" }).getByRole("button", { name: "Fakeco Ltd", exact: true }).click();
    await save(linus);
    await linus.goto(`${BASE}/organisations/${oid("Fakeco Ltd")}`); await settle(linus);
    const people = await linus.locator('[aria-label="People"]').innerText().catch(async () => await text(linus));
    check("US2 scenario 2", link === `/organisations/${oid("Fakeco Ltd")}` && /Bea Linked[\s\S]*CFO/.test(people) && /Ada Example[\s\S]*COO/.test(people), `person link=${link}; org people=${JSON.stringify(people.replace(/\s+/g, " ").slice(0, 300))}`);
  });

  await sec("US1 scenario 2", async () => {
    const out = [];
    for (const q of ["ada.home@example.net", "ada@example.com", "Exam", "ada exam", "Fakeco"]) {
      await ada.goto(`${BASE}/people?q=${encodeURIComponent(q)}`); await settle(ada);
      out.push(`${q}:${(await rows(ada).filter({ hasText: "Ada Example" }).count()) > 0}`);
    }
    // also typed into the search field
    await ada.goto(BASE + "/people"); await settle(ada);
    await ada.getByRole("searchbox").fill("ada.home@example.net"); await ada.getByRole("searchbox").press("Enter"); await settle(ada);
    out.push(`typed:${(await rows(ada).filter({ hasText: "Ada Example" }).count()) > 0}`);
    check("US1 scenario 2", out.every((s) => s.endsWith("true")), "searched as Ada Fake (another user): " + out.join(", "));
  });

  await sec("US1 scenario 3", async () => {
    const id = pid("Ada Example");
    await ada.goto(`${BASE}/people/${id}/edit`); await settle(ada);
    await ada.getByLabel("Role or job title").fill("CEO");
    await addPhoneRow(ada); await ada.getByLabel("Phone number 2", { exact: true }).fill("+44 7700 900123");
    await ada.getByRole("button", { name: "Remove email address 2" }).click();
    await save(ada);
    const d = await details(ada); const t = await tl(ada);
    check("US1 scenario 3", d.includes("CEO") && d.includes("+44 7700 900123") && !d.includes("ada.home@example.net") && /Edited by Ada Fake: Role, Email addresses, Phone numbers/.test(t[0] || "") && /\d{1,2}:\d{2}/.test(t[0] || ""),
      `details has CEO/new phone/no 2nd email=${d.includes("CEO")}/${d.includes("+44 7700 900123")}/${!d.includes("ada.home@example.net")}; timeline top=${JSON.stringify(t[0])}`);
  });

  await sec("US1 scenario 4", async () => {
    const before = nPersons(); const out = [];
    await fillPerson(ada, { first: "", last: "", emails: ["x@example.com"] }); await save(ada);
    out.push(`empty name msg=${(await text(ada)).includes("Enter a first or last name.")} nearField=${await ada.locator("label.field", { hasText: "First name" }).innerText().then((s) => s.includes("Enter a first or last name.")).catch(() => false)}`);
    await fillPerson(ada, { first: "Bad", emails: ["not-an-email"] }); await save(ada);
    out.push(`bad email msg=${await ada.locator(".row-item", { has: ada.getByLabel("Email address 1", { exact: true }) }).innerText().then((s) => s.includes("Enter a valid email address.")).catch(() => false)}`);
    await fillPerson(ada, { first: "Bad", linkedin: "https://example.com/ada" }); await save(ada);
    out.push(`bad linkedin msg=${await ada.locator("label.field", { hasText: "LinkedIn profile" }).innerText().then((s) => s.includes("Enter a LinkedIn profile link (linkedin.com/…).")).catch(() => false)}`);
    check("US1 scenario 4", out.every((s) => !s.includes("false")) && nPersons() === before, out.join("; ") + `; persons ${before}->${nPersons()}`);
  });

  await sec("US1 scenario 5", async () => {
    const before = nPersons(); const id = pid("Ada Example");
    await fillPerson(linus, { first: "Dup", last: "One", emails: ["ADA@example.com"] }); await save(linus);
    const t1 = await text(linus); const l1 = await linus.getByRole("link", { name: "Ada Example" }).getAttribute("href").catch(() => null);
    // edit another person (Bea Linked) to the same address
    await linus.goto(`${BASE}/people/${pid("Bea Linked")}/edit`); await settle(linus);
    await linus.getByLabel("Email address 1", { exact: true }).fill("ADA@example.com"); await save(linus);
    const t2 = await text(linus); const l2 = await linus.getByRole("link", { name: "Ada Example" }).getAttribute("href").catch(() => null);
    const beaEmail = sql(`select email from person_emails where person_id=${pid("Bea Linked")}`);
    check("US1 scenario 5", t1.includes("Ada Example already has this email address.") && l1 === `/people/${id}` && t2.includes("Ada Example already has this email address.") && l2 === `/people/${id}` && nPersons() === before && beaEmail === "bea@example.com",
      `add: msg=${t1.includes("Ada Example already has this email address.")} link=${l1}; edit: msg=${t2.includes("Ada Example already has this email address.")} link=${l2}; persons ${before}->${nPersons()}; Bea still ${beaEmail}`);
  });

  await sec("US2 scenario 3", async () => {
    await fillPerson(linus, { first: "Cy", last: "Neworg", emails: ["cy@example.com"] });
    await linus.getByRole("combobox", { name: "Organisation" }).fill("New Org");
    await linus.getByRole("listbox", { name: "Organisations" }).getByRole("button", { name: "Add organisation 'New Org'" }).click();
    await save(linus);
    const row = sql("select o.name||'|'||u.name from persons p join organisations o on o.id=p.organisation_id join users u on u.id=o.owner_id where p.first_name='Cy'");
    const d = await details(linus);
    check("US2 scenario 3", row === "New Org|Linus Fake" && d.includes("New Org"), `db=${row}; person page shows New Org=${d.includes("New Org")}`);
  });

  await sec("US2 scenario 5", async () => {
    const id = pid("Bea Linked");
    await linus.goto(`${BASE}/people/${id}/edit`); await settle(linus);
    await linus.getByRole("button", { name: "[ CLEAR ]" }).click(); await save(linus);
    const d = await details(linus);
    await linus.goto(`${BASE}/organisations/${oid("Fakeco Ltd")}`); await settle(linus);
    const people = await linus.locator('[aria-label="People"]').innerText().catch(() => "");
    check("US2 scenario 5", !d.includes("Fakeco Ltd") && !people.includes("Bea Linked") && people.includes("Ada Example"), `person details has Fakeco=${d.includes("Fakeco Ltd")}; org people=${JSON.stringify(people.replace(/\s+/g, " ").slice(0, 200))}`);
  });

  await sec("Edge case 1", async () => {
    const before = nPersons();
    await fillPerson(ada, { first: "Twice", emails: ["a@x.com", "A@x.com "] }); await save(ada);
    check("Edge case 1", (await text(ada)).includes("This email address is listed twice.") && nPersons() === before, `msg=${(await text(ada)).includes("This email address is listed twice.")}; persons ${before}->${nPersons()}`);
  });

  await sec("Edge case 2", async () => {
    await addPerson(ada, { first: "Trim", last: "Case", emails: [" Ada@Example.COM "] });
    const t1 = await text(ada);
    // that collides with ada@example.com (Ada Example), so use another address to check the lowercasing on the page
    const url = await addPerson(ada, { first: "Trim", last: "Case", emails: [" Trim@Example.COM "], phones: ["  +44 (0)20 7946-0001  "] });
    const d = await details(ada);
    const before = nPersons();
    await fillPerson(ada, { first: "Bad", last: "Phone", phones: ["+44 20 7946 0000 ext#5"] }); await save(ada);
    const t2 = await text(ada);
    check("Edge case 2", d.includes("trim@example.com") && !d.includes("Trim@Example.COM") && d.includes("+44 (0)20 7946-0001") && t2.includes("Enter a valid phone number.") && nPersons() === before,
      `" Ada@Example.COM " (same as Ada Example) refused as duplicate=${t1.includes("already has this email address")}; " Trim@Example.COM " shown lowercase=${d.includes("trim@example.com")}; phone shown trimmed=${d.includes("+44 (0)20 7946-0001")}; bad phone msg=${t2.includes("Enter a valid phone number.")}; persons ${before}->${nPersons()}; page ${url.replace(BASE, "")}`);
  });

  await sec("Edge case 3", async () => {
    const o = [];
    await fillOrg(ada, { Name: "Webco Fake", Website: "webco.example" }); await save(ada);
    o.push(`website saved=${sql("select website from organisations where name='Webco Fake'")}`);
    const before = sql("select count(*) from organisations");
    await fillOrg(ada, { Name: "Badsite Fake", Website: "not a site" }); await save(ada);
    o.push(`not a site msg=${(await text(ada)).includes("Enter a valid website address.")} orgs ${before}->${sql("select count(*) from organisations")}`);
    await addPerson(ada, { first: "Lin", last: "Kedin", linkedin: "linkedin.com/in/ada-example" });
    o.push(`linkedin shown=${(await details(ada)).includes("https://linkedin.com/in/ada-example")}`);
    const n = nPersons();
    await fillPerson(ada, { first: "Lin", last: "Bad", linkedin: "https://example.com/ada" }); await save(ada);
    o.push(`bad linkedin msg=${(await text(ada)).includes("Enter a LinkedIn profile link (linkedin.com/…).")} persons ${n}->${nPersons()}`);
    check("Edge case 3", o[0].endsWith("https://webco.example") && o[1].includes("msg=true") && !o[1].match(/(\d+)->(?!\1)/) && o[2].endsWith("true") && o[3].includes("msg=true") && nPersons() === n, o.join("; "));
  });

  await sec("Edge case 4", async () => {
    const o = []; const no = sql("select count(*) from organisations"); const np = nPersons();
    for (const w of ["javascript:alert(1)", "ftp://fakeco.example"]) {
      await fillOrg(ada, { Name: "Js Fake " + w.length, Website: w }); await save(ada);
      o.push(`website ${w}: ${(await text(ada)).includes("Enter a valid website address.")}`);
      await fillPerson(ada, { first: "Js", linkedin: w.replace("fakeco.example", "linkedin.com/in/x") }); await save(ada);
      o.push(`linkedin ${w}: ${(await text(ada)).includes("Enter a LinkedIn profile link (linkedin.com/…).")}`);
    }
    check("Edge case 4", o.every((s) => s.endsWith("true")) && sql("select count(*) from organisations") === no && nPersons() === np, o.join("; ") + `; orgs ${no}->${sql("select count(*) from organisations")} persons ${np}->${nPersons()}`);
  });

  await sec("Edge case 10", async () => {
    await addPerson(ada, { first: "Arch", last: "Ived", emails: ["arch@example.com"] });
    const id = pid("Arch Ived");
    await Promise.all([settle(ada), ada.getByRole("button", { name: "[ ARCHIVE ]" }).click()]); await settle(ada);
    const n = nPersons();
    await fillPerson(linus, { first: "New", emails: ["arch@example.com"] }); await save(linus);
    const msg = (await text(linus)).includes("Arch Ived already has this email address.");
    const link = linus.getByRole("link", { name: "Arch Ived" }); const href = await link.getAttribute("href").catch(() => null);
    await Promise.all([settle(linus), link.click()]); await settle(linus);
    const h = await linus.locator("h1").textContent(); const restore = await linus.getByRole("button", { name: "[ RESTORE ]" }).count();
    check("Edge case 10", msg && href === `/people/${id}` && h.includes("Archived") && restore === 1 && nPersons() === n, `(archived person "Arch Ived") msg=${msg}; link=${href}; linked page h1=${JSON.stringify(h)}; RESTORE=${restore}; persons ${n}->${nPersons()}`);
  });

  await sec("Edge case 11", async () => {
    const id = pid("Arch Ived");
    await ada.goto(`${BASE}/people/${id}`); await settle(ada);
    await Promise.all([settle(ada), ada.getByRole("link", { name: "[ DELETE ]" }).click()]); await settle(ada);
    await Promise.all([settle(ada), ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click()]); await settle(ada);
    const url = await addPerson(linus, { first: "Reuse", last: "Mail", emails: ["arch@example.com"] });
    check("Edge case 11", /\/people\/\d+$/.test(url) && (await linus.locator("h1").textContent()).includes("Reuse Mail") && (await details(linus)).includes("arch@example.com"), `after delete, new person saved at ${url.replace(BASE, "")}`);
  });

  await sec("Edge case 13", async () => {
    const o = [];
    for (const path of ["/people/999999", "/people/abc", "/organisations/999999", "/organisations/1x", "/people/99999999999999999999"]) {
      const r = await ada.goto(BASE + path); await settle(ada);
      o.push(`${path}: ${r.status()} notfound=${(await text(ada)).includes("Page not found.")} sidebar=${(await ada.locator("nav").count()) > 0}`);
    }
    check("Edge case 13", o.every((s) => s.includes("notfound=true sidebar=true")), o.join("; "));
  });

  await sec("Edge case 14", async () => {
    await ada.goto(BASE + "/people/new"); await settle(ada);
    const form = await ada.locator("form.recform").innerText();
    await ada.goto(`${BASE}/people/${pid("Ada Example")}`); await settle(ada);
    const d = (await details(ada)).replace(/\s+/g, " ");
    check("Edge case 14", !/Last contacted|Date added/i.test(form) && /Last contacted:? ?Never/i.test(d), `form has those fields=${/Last contacted|Date added/i.test(form)}; page: ${JSON.stringify((d.match(/Last contacted.{0,10}/i) || [""])[0])}`);
  });
}

async function phaseB(browser) {
  const ada = await user(browser, "ada@barnacle.ai", "Ada Fake");       // admin, creator of private Gus Lorem
  const grace = await user(browser, "grace@barnacle.ai", "Grace Fake"); // admin
  const linus = await user(browser, "linus@barnacle.ai", "Linus Fake"); // user
  const total = Number(sql("select count(*) from persons where archived_at is null and (not private or created_by=3)"));

  await sec("US3 scenario 1", async () => {
    await linus.goto(BASE + "/people"); await settle(linus);
    const search = await linus.getByRole("searchbox").count(); const selects = await linus.locator("form[role=search] select").count();
    const order = await linus.locator("tbody tr td:first-child a.nm").allInnerTexts();
    const names = order.filter(Boolean);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    const heads = (await linus.locator("thead").innerText()).replace(/\s+/g, " ");
    const count = await linus.locator(".count").innerText().catch(() => "");
    const first = await rows(linus).first().innerText();
    const formBeforeTable = await linus.evaluate(() => { const f = document.querySelector("form[role=search]"); const t = document.querySelector("table"); return !!f && !!t && !!(f.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING); });
    // more than 50: add 30 people by SQL then check paging
    check("US3 scenario 1", search === 1 && selects >= 5 && formBeforeTable && count.includes(`${total} PEOPLE`) && JSON.stringify(names) === JSON.stringify(sorted) && (await rows(linus).count()) === Math.min(50, total),
      `search=${search} filters=${selects} filters above table=${formBeforeTable}; count line=${JSON.stringify(count)} (expected ${total}); headers=${JSON.stringify(heads)}; rows=${await rows(linus).count()}; sorted A–Z=${JSON.stringify(names) === JSON.stringify(sorted)}; first row=${JSON.stringify(first.replace(/\s+/g, " "))}`);
  });

  await sec("US3 scenario 2", async () => {
    await linus.goto(BASE + "/people"); await settle(linus);
    const f = linus.locator("form[role=search]");
    await f.getByLabel("Lead source").selectOption({ label: "Exec dinner" }); await settle(linus);
    await f.getByLabel("Owner").selectOption({ label: "Ada Fake" }); await settle(linus);
    await f.getByLabel("Consent").selectOption({ label: "Subscribed" }); await settle(linus);
    await f.getByLabel("Sort by").selectOption({ value: "added" }).catch(async () => { await linus.locator("form[role=search] select[name=sort]").selectOption("added"); }); await settle(linus);
    await f.getByLabel("Order").selectOption("desc"); await settle(linus);
    const url = linus.url();
    const expect = sql("select string_agg(btrim(first_name||' '||last_name), ',' order by p.created_at desc, p.id desc) from persons p join lead_sources l on l.id=p.lead_source_id join users u on u.id=p.owner_id where l.name='Exec dinner' and u.name='Ada Fake' and consent='subscribed' and archived_at is null and (not private or created_by=3)");
    const got = (await linus.locator("tbody tr td:first-child a.nm").allInnerTexts()).join(",");
    const count = await linus.locator(".count").innerText();
    // copy the address into a new tab
    const tab = await linus.context().newPage(); await tab.goto(url); await settle(tab);
    const got2 = (await tab.locator("tbody tr td:first-child a.nm").allInnerTexts()).join(",");
    await tab.close();
    // also label and organisation filters
    const lab = sql("select id from labels where name='Hot'"); const org = oid("Fakeco Ltd");
    await linus.goto(`${BASE}/people?label=${lab}&org=${org}`); await settle(linus);
    const e2 = sql(`select count(*) from persons p join person_labels pl on pl.person_id=p.id where pl.label_id=${lab} and organisation_id=${org} and archived_at is null and (not private or created_by=3)`);
    const r2 = await rows(linus).count(); const c2 = await linus.locator(".count").innerText();
    check("US3 scenario 2", got === expect && got2 === got && count.includes(`${expect.split(",").filter(Boolean).length} PEOPLE`.replace(/^1 PEOPLE/, "1 PERSON")) && String(r2) === e2,
      `url=${url.replace(BASE, "")}; shown=[${got}] expected=[${expect}]; count=${count}; new tab same=${got2 === got}; label Hot + org Fakeco: rows=${r2} expected=${e2} count=${c2}`);
  });

  await sec("US3 scenario 3", async () => {
    await linus.goto(`${BASE}/people?consent=unsubscribed&source=${sql("select id from lead_sources where name='Ambassador'")}&owner=4&label=${sql("select id from labels where name='Investor'")}`); await settle(linus);
    const t = await text(linus); const clr = linus.getByRole("link", { name: "[ CLEAR FILTERS ]" });
    const href = await clr.getAttribute("href").catch(() => null);
    check("US3 scenario 3", t.includes("No people match these filters.") && href === "/people", `msg=${t.includes("No people match these filters.")}; clear link=${href}; rows=${await rows(linus).count()}`);
  });

  await sec("US3 scenario 4", async () => {
    await linus.goto(BASE + "/organisations"); await settle(linus);
    const heads = (await linus.locator("thead").innerText()).replace(/\s+/g, " ");
    const fr = linus.locator("form[role=search]");
    const filt = [await fr.getByLabel("Owner").count(), await fr.getByLabel("Sector").count(), await fr.getByLabel("Size").count()];
    const first = (await rows(linus).first().innerText()).replace(/\s+/g, " ");
    const names = (await linus.locator("tbody tr td:first-child a.nm").allInnerTexts()).filter(Boolean);
    // filter by sector Fitness, sort by people desc
    await fr.getByLabel("Sector").selectOption({ label: "Fitness" }); await settle(linus);
    const fit = (await linus.locator("tbody tr td:first-child a.nm").allInnerTexts()).filter(Boolean);
    const expFit = sql("select string_agg(name, ',' order by lower(name)) from organisations where sector='Fitness' and archived_at is null");
    const sortOpts = await fr.locator("select[name=sort] option").allTextContents().catch(() => []);
    await linus.goto(BASE + "/organisations?sort=people&dir=desc"); await settle(linus);
    const ppl = await linus.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => Number(tr.lastElementChild.textContent.trim())));
    const ppldesc = ppl.every((v, i) => i === 0 || ppl[i - 1] >= v);
    const fakecoCount = Number(sql(`select count(*) from persons where organisation_id=${oid("Fakeco Ltd")} and archived_at is null and (not private or created_by=3)`));
    const fakecoRow = (await rows(linus).filter({ hasText: "Fakeco Ltd" }).first().innerText()).replace(/\s+/g, " ");
    await linus.goto(BASE + "/organisations?sort=added&dir=desc"); await settle(linus);
    const added = (await linus.locator("tbody tr td:first-child a.nm").allInnerTexts()).filter(Boolean);
    const expAdded = sql("select string_agg(name, ',' order by created_at desc, id desc) from organisations where archived_at is null");
    check("US3 scenario 4", ["NAME", "WEBSITE", "SECTOR", "SIZE", "LOCATION", "OWNER", "PEOPLE"].every((h) => heads.toUpperCase().includes(h)) && filt.every((n) => n === 1) && fit.join(",") === expFit && ppldesc && fakecoRow.endsWith(String(fakecoCount)) && added.join(",") === expAdded,
      `headers=${JSON.stringify(heads)}; filters owner/sector/size=${filt}; first row=${JSON.stringify(first)}; sector Fitness=[${fit}] expected [${expFit}]; sort options=${JSON.stringify(sortOpts)}; people desc=${JSON.stringify(ppl)}; Fakeco row=${JSON.stringify(fakecoRow)} (expected ${fakecoCount}); by date added desc ok=${added.join(",") === expAdded}`);
  });

  await sec("US3 scenario 5", async () => {
    await linus.goto(BASE + "/people?q=Fay"); await settle(linus);
    const hidden = await rows(linus).filter({ hasText: "Fay Mockup" }).count();
    await linus.getByLabel("Show archived").check(); await settle(linus);
    const shown = (await rows(linus).filter({ hasText: "Fay Mockup" }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
    const url1 = linus.url();
    await linus.getByLabel("Show archived").uncheck(); await settle(linus);
    const hidden2 = await rows(linus).filter({ hasText: "Fay Mockup" }).count();
    await linus.goto(BASE + "/organisations"); await settle(linus);
    const oh = await rows(linus).filter({ hasText: "Old Fakeco Archive" }).count();
    await linus.getByLabel("Show archived").check(); await settle(linus);
    const os = (await rows(linus).filter({ hasText: "Old Fakeco Archive" }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
    await linus.goto(BASE + "/organisations?q=Old Fakeco"); await settle(linus);
    const osearch = await rows(linus).filter({ hasText: "Old Fakeco Archive" }).count();
    check("US3 scenario 5", hidden === 0 && /archived/i.test(shown) && hidden2 === 0 && oh === 0 && /archived/i.test(os) && osearch === 0,
      `people search "Fay" hidden=${hidden === 0}; ticked (${url1.replace(BASE, "")}) row=${JSON.stringify(shown.slice(0, 120))}; unticked hidden=${hidden2 === 0}; orgs list hidden=${oh === 0}; ticked row=${JSON.stringify(os)}; org search hidden=${osearch === 0}`);
  });

  await sec("US3 scenario 6", async () => {
    await linus.goto(`${BASE}/people?source=${sql("select id from lead_sources where name='Referral'")}&sort=added`); await settle(linus);
    const r = rows(linus).first(); const nm = (await r.locator("td:first-child a.nm").first().innerText()).trim();
    const id = pid(nm);
    await Promise.all([settle(linus), r.locator("td").nth(2).click()]); await settle(linus);
    const url = linus.url();
    const sel = await rows(linus).filter({ hasText: nm }).first().getAttribute("class").catch(() => "") + "|" + (await rows(linus).first().getAttribute("aria-selected").catch(() => ""));
    const dr = (await drawer(linus).innerText().catch(() => "")).replace(/\s+/g, " ");
    const db = sql(`select coalesce(o.name,'')||'|'||coalesce(p.role,'')||'|'||coalesce((select email from person_emails where person_id=p.id order by position limit 1),'')||'|'||coalesce((select phone from person_phones where person_id=p.id order by position limit 1),'')||'|'||coalesce(l.name,'')||'|'||p.consent from persons p left join organisations o on o.id=p.organisation_id left join lead_sources l on l.id=p.lead_source_id where p.id=${id}`).split("|");
    const miss = [nm, ...db.slice(0, 5).filter(Boolean)].filter((s) => !dr.includes(s));
    const consentOk = dr.toLowerCase().includes(db[5]);
    const keeps = url.includes("source=") && url.includes("sort=added") && url.includes(`open=${id}`);
    const rightSide = await drawer(linus).evaluate((el) => el.getBoundingClientRect().left > window.innerWidth / 2).catch(() => false);
    await Promise.all([settle(linus), drawer(linus).getByRole("link", { name: "[ OPEN PAGE ]" }).click()]); await settle(linus);
    const open1 = linus.url().endsWith(`/people/${id}`);
    await linus.goBack(); await settle(linus);
    await Promise.all([settle(linus), rows(linus).first().getByRole("link", { name: nm, exact: true }).click()]); await settle(linus);
    const open2 = linus.url().endsWith(`/people/${id}`);
    check("US3 scenario 6", dr && miss.length === 0 && consentOk && keeps && /selected|current|active|true/.test(sel) && rightSide && open1 && open2,
      `clicked role cell of ${nm}; url=${url.replace(BASE, "")} (keeps filters=${keeps}); row class/aria=${sel}; drawer right=${rightSide}; drawer=${JSON.stringify(dr)}; missing=${JSON.stringify(miss)} consent=${consentOk}; OPEN PAGE→page=${open1}; name link→page=${open2}`);
  });

  await sec("US3 scenario 7", async () => {
    await linus.goto(BASE + "/organisations"); await settle(linus);
    const r = rows(linus).filter({ hasText: "Fakeco Ltd" }).first();
    await Promise.all([settle(linus), r.locator("td").nth(2).click()]); await settle(linus);
    const dr = (await drawer(linus).innerText().catch(() => "")).replace(/\s+/g, " ");
    const n = sql(`select count(*) from persons where organisation_id=${oid("Fakeco Ltd")} and archived_at is null and (not private or created_by=3)`);
    const want = ["Fakeco Ltd", "fakeco.example", "Fitness", "201–1,000", "London", "Ada Fake", n, "[ OPEN PAGE ]"];
    const miss = want.filter((s) => !dr.includes(s));
    check("US3 scenario 7", dr && miss.length === 0, `drawer=${JSON.stringify(dr)}; missing=${JSON.stringify(miss)}`);
  });

  await sec("US3 scenario 8", async () => {
    await linus.goto(`${BASE}/people?consent=subscribed&sort=added&dir=desc&page=1`); await settle(linus);
    const before = (await linus.locator("tbody tr td:first-child a.nm").allInnerTexts()).join(",");
    await Promise.all([settle(linus), rows(linus).nth(1).locator("td").nth(3).click()]); await settle(linus);
    const withOpen = linus.url();
    await linus.reload(); await settle(linus);
    const afterReload = await drawer(linus).count();
    await Promise.all([settle(linus), drawer(linus).getByRole("link", { name: "[ CLOSE ]" }).click()]); await settle(linus);
    const closed = linus.url(); const after = (await linus.locator("tbody tr td:first-child a.nm").allInnerTexts()).join(",");
    check("US3 scenario 8", /open=\d+/.test(withOpen) && afterReload === 1 && (await drawer(linus).count()) === 0 && !/open=/.test(closed) && /consent=subscribed/.test(closed) && /sort=added/.test(closed) && /dir=desc/.test(closed) && before === after,
      `open url=${withOpen.replace(BASE, "")}; drawer after reload=${afterReload}; after CLOSE url=${closed.replace(BASE, "")}; same rows=${before === after}`);
  });

  await sec("US4 scenario 1", async () => {
    const id = pid("Bob Placeholder");
    await linus.goto(`${BASE}/people/${id}`); await settle(linus);
    await Promise.all([settle(linus), linus.getByRole("button", { name: "[ ARCHIVE ]" }).click()]); await settle(linus);
    const h = await linus.locator("h1").textContent(); const rb = await linus.getByRole("button", { name: "[ RESTORE ]" }).count(); const t = await tl(linus);
    await linus.goto(`${BASE}/people?q=Bob Placeholder`); await settle(linus);
    const gone = await rows(linus).filter({ hasText: "Bob Placeholder" }).count();
    await linus.goto(`${BASE}/people?q=Bob Placeholder&archived=1`); await settle(linus);
    const back = await rows(linus).filter({ hasText: "Bob Placeholder" }).count();
    await linus.goto(`${BASE}/people`); await settle(linus);
    const inList = await rows(linus).filter({ hasText: "Bob Placeholder" }).count();
    // organisation too
    const o = oid("Mockup Capital Fake");
    await linus.goto(`${BASE}/organisations/${o}`); await settle(linus);
    await Promise.all([settle(linus), linus.getByRole("button", { name: "[ ARCHIVE ]" }).click()]); await settle(linus);
    const oh = await linus.locator("h1").textContent(); const ot = await tl(linus); const orb = await linus.getByRole("button", { name: "[ RESTORE ]" }).count();
    await linus.goto(`${BASE}/organisations?q=Mockup`); await settle(linus);
    const ogone = await rows(linus).count();
    check("US4 scenario 1", h.includes("Archived") && rb === 1 && /^Archived by Linus Fake/.test(t[0] || "") && gone === 0 && back === 1 && inList === 0 && oh.includes("Archived") && orb === 1 && /^Archived by Linus Fake/.test(ot[0] || "") && ogone === 0,
      `person: h1=${JSON.stringify(h)} RESTORE=${rb} timeline top=${JSON.stringify(t[0])} search hidden=${gone === 0} list hidden=${inList === 0} shown with Show archived=${back}; org: h1=${JSON.stringify(oh)} RESTORE=${orb} timeline=${JSON.stringify(ot[0])} search rows=${ogone}`);
  });

  await sec("US4 scenario 2", async () => {
    const id = pid("Bob Placeholder");
    await ada.goto(`${BASE}/people/${id}`); await settle(ada);
    await Promise.all([settle(ada), ada.getByRole("button", { name: "[ RESTORE ]" }).click()]); await settle(ada);
    const t = await tl(ada);
    await ada.goto(`${BASE}/people?q=Bob Placeholder`); await settle(ada);
    const back = await rows(ada).filter({ hasText: "Bob Placeholder" }).count();
    const o = oid("Mockup Capital Fake");
    await ada.goto(`${BASE}/organisations/${o}`); await settle(ada);
    await Promise.all([settle(ada), ada.getByRole("button", { name: "[ RESTORE ]" }).click()]); await settle(ada);
    const ot = await tl(ada);
    await ada.goto(`${BASE}/organisations?q=Mockup`); await settle(ada);
    const oback = await rows(ada).filter({ hasText: "Mockup Capital Fake" }).count();
    check("US4 scenario 2", /^Restored by Ada Fake/.test(t[0] || "") && back === 1 && /^Restored by Ada Fake/.test(ot[0] || "") && oback === 1, `person timeline=${JSON.stringify(t[0])} in search=${back}; org timeline=${JSON.stringify(ot[0])} in search=${oback}`);
  });

  await sec("US4 scenario 5", async () => {
    const id = pid("Cleo Testperson");
    await linus.goto(`${BASE}/people/${id}`); await settle(linus);
    const btn = await linus.getByRole("link", { name: "[ DELETE ]" }).count() + await linus.getByRole("button", { name: /DELETE/ }).count();
    const o = oid("Lorem Logistics Fake");
    await linus.goto(`${BASE}/organisations/${o}`); await settle(linus);
    const obtn = await linus.getByText("[ DELETE ]").count();
    // action id of the admin's delete form
    await ada.goto(`${BASE}/people/${id}?confirm=delete`); await settle(ada);
    const field = await ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const res = await linus.request.post(`${BASE}/people/${id}`, { multipart: { [field]: "", id: String(id) } });
    const body = await res.text();
    await ada.goto(`${BASE}/organisations/${o}?confirm=delete`); await settle(ada);
    const ofield = await ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const ores = await linus.request.post(`${BASE}/organisations/${o}`, { multipart: { [ofield]: "", id: String(o) } });
    const obody = await ores.text();
    const still = sql(`select count(*) from persons where id=${id}`) + "/" + sql(`select count(*) from organisations where id=${o}`);
    const msg = (b) => b.includes("You don&#x27;t have access to this page.") || b.includes("You don't have access to this page.");
    check("US4 scenario 5", btn === 0 && obtn === 0 && msg(body) && msg(obody) && still === "1/1", `no DELETE on person/org page=${btn === 0}/${obtn === 0}; direct person delete status=${res.status()} msg=${msg(body)}; direct org delete status=${ores.status()} msg=${msg(obody)}; still exist=${still}`);
  });

  await sec("US4 scenario 3", async () => {
    await addPerson(grace, { first: "Ada", last: "Example", emails: ["ada@example.com"] });
    const id = pid("Ada Example");
    await Promise.all([settle(grace), grace.getByRole("link", { name: "[ DELETE ]" }).click()]); await settle(grace);
    const confirm = (await text(grace)).includes("Delete Ada Example for good? This can't be undone.");
    await Promise.all([settle(grace), grace.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click()]); await settle(grace);
    const url = grace.url(); const msg = (await text(grace)).includes("Ada Example was deleted.");
    await grace.reload(); await settle(grace);
    const once = !(await text(grace)).includes("Ada Example was deleted.");
    const r = await grace.goto(`${BASE}/people/${id}`); await settle(grace);
    check("US4 scenario 3", confirm && /\/people$/.test(url) && msg && (await text(grace)).includes("Page not found.") && r.status() === 404,
      `confirm text=${confirm}; after delete url=${url.replace(BASE, "")} notice=${msg} (gone after reload=${once}); old address status=${r.status()} "Page not found."=${(await text(grace)).includes("Page not found.")}`);
  });

  await sec("US4 scenario 4", async () => {
    const o = oid("Dummy Leisure Fake");
    const ppl = sql(`select string_agg(id::text, ',') from persons where organisation_id=${o}`);
    await grace.goto(`${BASE}/organisations/${o}`); await settle(grace);
    await Promise.all([settle(grace), grace.getByRole("link", { name: "[ DELETE ]" }).click()]); await settle(grace);
    await Promise.all([settle(grace), grace.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click()]); await settle(grace);
    const after = sql(`select count(*)||'/'||count(organisation_id) from persons where id in (${ppl})`);
    const r = await grace.goto(`${BASE}/organisations/${o}`); await settle(grace);
    const firstId = ppl.split(",")[0];
    await grace.goto(`${BASE}/people/${firstId}`); await settle(grace);
    const d = await details(grace);
    check("US4 scenario 4", ppl && after === `${ppl.split(",").length}/0` && r.status() === 404 && !d.includes("Dummy Leisure"), `linked people ids=${ppl}; after delete persons/with org=${after}; org page status=${r.status()}; person page shows org=${d.includes("Dummy Leisure")}`);
  });

  await sec("US4 scenario 6", async () => {
    const o = oid("Old Fakeco Archive");
    const p = sql(`select id from persons where organisation_id=${o} and not private and archived_at is null limit 1`);
    let id = p;
    if (!id) { sql(`update persons set organisation_id=${o} where id=${pid("Cleo Testperson")}`); id = pid("Cleo Testperson"); }
    await linus.goto(`${BASE}/people/${id}`); await settle(linus);
    const d = (await details(linus)).replace(/\s+/g, " ");
    check("US4 scenario 6", /Old Fakeco Archive\s*Archived/.test(d), `${p ? "seeded" : "linked by SQL"} person ${id}: details=${JSON.stringify((d.match(/Organisation.{0,50}/) || [d.slice(0, 80)])[0])}`);
  });

  await sec("US5 scenario 1", async () => {
    await addPerson(linus, { first: "Priv", last: "Ate", emails: ["priv@example.com"], org: ["Fakeco", "Fakeco Ltd"] });
    const id = pid("Priv Ate");
    await linus.goto(`${BASE}/people/${id}/edit`); await settle(linus);
    await linus.getByLabel(/Private/).check(); await save(linus);
    const h = await linus.locator("h1").textContent();
    await linus.goto(`${BASE}/people?q=Priv`); await settle(linus);
    const s = await rows(linus).filter({ hasText: "Priv Ate" }).count();
    await linus.goto(`${BASE}/people?sort=added&dir=desc`); await settle(linus);
    const l = await rows(linus).filter({ hasText: "Priv Ate" }).count();
    check("US5 scenario 1", h.includes("Private") && s === 1 && l === 1, `h1=${JSON.stringify(h)}; in Linus's search=${s}, list=${l}; db private=${sql(`select private from persons where id=${id}`)}`);
  });

  await sec("US5 scenario 2", async () => {
    const id = pid("Priv Ate"); const o = oid("Fakeco Ltd"); const out = [];
    const visibleN = sql(`select count(*) from persons where organisation_id=${o} and archived_at is null and not private`);
    for (const [who, p] of [["Ada (admin)", ada], ["Grace (admin)", grace]]) {
      await p.goto(`${BASE}/people?sort=added&dir=desc`); await settle(p); const a = await rows(p).filter({ hasText: "Priv Ate" }).count();
      await p.goto(`${BASE}/people?q=priv`); await settle(p); const b = await rows(p).filter({ hasText: "Priv Ate" }).count();
      await p.goto(`${BASE}/organisations/${o}`); await settle(p); const c = (await text(p)).includes("Priv Ate");
      await p.goto(`${BASE}/organisations?q=Fakeco Ltd`); await settle(p); const cnt = (await rows(p).filter({ hasText: "Fakeco Ltd" }).first().innerText()).trim().split(/\s+/).pop();
      await p.goto(`${BASE}/organisations?open=${o}`); await settle(p); const dcnt = (await drawer(p).innerText()).replace(/\s+/g, " ");
      const r = await p.goto(`${BASE}/people/${id}`); await settle(p); const nf = (await text(p)).includes("Page not found.");
      await p.goto(`${BASE}/people?open=${id}`); await settle(p); const dr = await drawer(p).count();
      out.push(`${who}: list=${a} search=${b} orgPage=${c} orgCount=${cnt}(exp ${visibleN}) drawerCountHas=${dcnt.includes(visibleN)} page=${r.status()}/${nf} drawer=${dr}`);
    }
    check("US5 scenario 2", out.every((s) => s.includes("list=0 search=0 orgPage=false") && s.includes(`orgCount=${visibleN}(`) && s.includes("page=404/true drawer=0")), out.join("; "));
  });

  await sec("US5 scenario 3", async () => {
    await ada.goto(`${BASE}/people/${pid("Cleo Testperson")}/edit`); await settle(ada);
    const creator = sql(`select u.name from persons p join users u on u.id=p.created_by where p.id=${pid("Cleo Testperson")}`);
    const a = await ada.getByLabel(/Private/).count();
    await linus.goto(`${BASE}/people/${pid("Bob Placeholder")}/edit`); await settle(linus);
    const creator2 = sql(`select u.name from persons p join users u on u.id=p.created_by where p.id=${pid("Bob Placeholder")}`);
    const b = creator2 === "Linus Fake" ? "n/a" : await linus.getByLabel(/Private/).count();
    check("US5 scenario 3", creator !== "Ada Fake" && a === 0 && (b === 0 || b === "n/a"), `Cleo Testperson created by ${creator}: Private offered to Ada=${a}; Bob Placeholder created by ${creator2}: offered to Linus=${b}`);
  });

  await sec("US5 scenario 4", async () => {
    await addPerson(linus, { first: "Sec", last: "Ret", emails: ["secret@example.com"], private: true });
    const n = nPersons();
    await fillPerson(ada, { first: "Other", emails: ["secret@example.com"] }); await save(ada);
    const t = await text(ada); const err = await ada.locator(".row-item").first().innerText();
    const leak = t.includes("Sec Ret") || (await ada.locator(`a[href="/people/${pid("Sec Ret")}"]`).count()) > 0;
    check("US5 scenario 4", t.includes("Another person already has this email address.") && !leak && nPersons() === n, `msg=${t.includes("Another person already has this email address.")}; names/links private person=${leak}; field text=${JSON.stringify(err.replace(/\s+/g, " "))}; persons ${n}->${nPersons()}`);
  });

  await sec("US6 scenario 2", async () => {
    await ada.goto(BASE + "/admin/lead-sources-and-labels"); await settle(ada);
    await ada.getByLabel("Name of Event", { exact: true }).fill("Events");
    await Promise.all([settle(ada), ada.getByRole("button", { name: "Rename Event", exact: true }).click()]); await settle(ada);
    await ada.getByLabel("Name of Hot", { exact: true }).fill("Very hot");
    await Promise.all([settle(ada), ada.getByRole("button", { name: "Rename Hot", exact: true }).click()]); await settle(ada);
    const ev = sql("select string_agg(p.id::text, ',') from persons p join lead_sources l on l.id=lead_source_id where l.name='Events' and not private");
    const hot = sql("select p.id from persons p join person_labels pl on pl.person_id=p.id join labels l on l.id=pl.label_id where l.name='Very hot' and not private limit 1");
    const o = [];
    for (const id of ev.split(",").slice(0, 3)) { await linus.goto(`${BASE}/people/${id}`); await settle(linus); const d = await details(linus); o.push(`${id}:${/Events/.test(d)}`); }
    await linus.goto(`${BASE}/people/${hot}`); await settle(linus); o.push(`label ${hot}:${(await details(linus)).includes("Very hot")}`);
    await linus.goto(`${BASE}/people?source=${sql("select id from lead_sources where name='Events'")}`); await settle(linus);
    const listRow = await rows(linus).first().innerText();
    check("US6 scenario 2", ev && o.every((s) => s.endsWith("true")) && listRow.includes("Events"), `people with Events: ${o.join(", ")}; list row shows Events=${listRow.includes("Events")}`);
  });

  await sec("US6 scenario 3", async () => {
    await ada.goto(BASE + "/admin/lead-sources-and-labels"); await settle(ada);
    await Promise.all([settle(ada), ada.getByRole("button", { name: "Remove Inbound", exact: true }).click()]); await settle(ada);
    await Promise.all([settle(ada), ada.getByRole("button", { name: "Remove Partner", exact: true }).click()]); await settle(ada);
    const inb = sql("select p.id from persons p join lead_sources l on l.id=lead_source_id where l.name='Inbound' and not private limit 1");
    const par = sql("select p.id from persons p join person_labels pl on pl.person_id=p.id join labels l on l.id=pl.label_id where l.name='Partner' and not private limit 1");
    await linus.goto(BASE + "/people/new"); await settle(linus);
    const srcOpts = await linus.locator("form.recform select[name=leadSourceId]").locator("option").allTextContents();
    const labOpts = await linus.locator("fieldset", { hasText: "Labels" }).innerText();
    await linus.goto(`${BASE}/people/${inb}`); await settle(linus); const keeps = (await details(linus)).includes("Inbound");
    await linus.goto(`${BASE}/people/${par}`); await settle(linus); const keepsL = (await details(linus)).includes("Partner");
    await linus.goto(`${BASE}/people/${inb}/edit`); await settle(linus);
    const editSel = await linus.locator("form.recform select[name=leadSourceId]").evaluate((s) => s.options[s.selectedIndex].text + "|" + [...s.options].map((o) => o.text).join(","));
    await linus.goto(BASE + "/people"); await settle(linus);
    const fSrc = await linus.locator("form[role=search]").getByLabel("Lead source").locator("option").allTextContents();
    const fLab = await linus.locator("form[role=search]").getByLabel("Label").locator("option").allTextContents();
    check("US6 scenario 3", !srcOpts.includes("Inbound") && !labOpts.includes("Partner") && keeps && keepsL && fSrc.includes("Inbound") && fLab.includes("Partner"),
      `new form offers Inbound=${srcOpts.includes("Inbound")} Partner=${labOpts.includes("Partner")}; person keeps Inbound=${keeps} Partner=${keepsL}; edit form of Inbound person select=${JSON.stringify(editSel)}; filters offer Inbound=${fSrc.includes("Inbound")} Partner=${fLab.includes("Partner")}`);
  });

  await sec("US6 scenario 4", async () => {
    const before = sql("select count(*) from lead_sources") + "/" + sql("select count(*) from labels");
    await ada.goto(BASE + "/admin/lead-sources-and-labels"); await settle(ada);
    await ada.getByLabel("New lead source").fill("  referral "); await Promise.all([settle(ada), ada.locator('section[aria-label="Lead sources"]').getByRole("button", { name: "[ ADD ]" }).click()]); await settle(ada);
    const m1 = (await text(ada)).includes("This name is already on the list.");
    await ada.getByLabel("New label").fill(" INVESTOR"); await Promise.all([settle(ada), ada.locator('section[aria-label="Labels"]').getByRole("button", { name: "[ ADD ]" }).click()]); await settle(ada);
    const m2 = (await text(ada)).includes("This name is already on the list.");
    const after = sql("select count(*) from lead_sources") + "/" + sql("select count(*) from labels");
    check("US6 scenario 4", m1 && m2 && before === after, `lead source "  referral ": msg=${m1}; label " INVESTOR": msg=${m2}; counts ${before}->${after}`);
  });

  await sec("US6 scenario 5", async () => {
    const r = await linus.goto(BASE + "/admin/lead-sources-and-labels"); await settle(linus);
    const t = await text(linus); const nav = await linus.locator("nav").allTextContents().then((a) => a.join(" "));
    // replay the admin's add form as Linus
    await ada.goto(BASE + "/admin/lead-sources-and-labels"); await settle(ada);
    const field = await ada.getByLabel("New label").locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const rfield = await ada.getByRole("button", { name: "Rename Investor", exact: true }).locator("xpath=ancestor::form").locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const before = sql("select string_agg(name, ',' order by id) from labels");
    const res = await linus.request.post(`${BASE}/admin/lead-sources-and-labels`, { multipart: { [field]: "", name: "Sneaky" } });
    const res2 = await linus.request.post(`${BASE}/admin/lead-sources-and-labels`, { multipart: { [rfield]: "", id: sql("select id from labels where name='Investor'"), name: "Renamed" } });
    const b1 = await res.text(); const b2 = await res2.text();
    const msg = (b) => b.includes("You don&#x27;t have access to this page.") || b.includes("You don't have access to this page.");
    const after = sql("select string_agg(name, ',' order by id) from labels");
    check("US6 scenario 5", t.includes("You don't have access to this page.") && !nav.includes("Lead sources and labels") && msg(b1) && msg(b2) && before === after,
      `page status=${r.status()} msg=${t.includes("You don't have access to this page.")}; sidebar link=${nav.includes("Lead sources and labels")}; direct add msg=${msg(b1)} (${res.status()}), rename msg=${msg(b2)} (${res2.status()}); labels unchanged=${before === after}`);
  });

  await sec("Edge case 5", async () => {
    const id = sql("select p.id from persons p join users u on u.id=p.owner_id where u.status<>'active' and not private limit 1");
    let pidv = id;
    if (!pidv) { pidv = pid("Cleo Testperson"); sql(`update persons set owner_id=5 where id=${pidv}`); }
    await linus.goto(`${BASE}/people/${pidv}`); await settle(linus);
    const d = await details(linus);
    await linus.goto(`${BASE}/people/${pidv}/edit`); await settle(linus);
    const opts = await linus.locator("form.recform select[name=ownerId]").locator("option").allTextContents();
    const sel = await linus.locator("form.recform select[name=ownerId]").evaluate((s) => s.options[s.selectedIndex]?.text);
    await linus.goto(BASE + "/people/new"); await settle(linus);
    const newOpts = await linus.locator("form.recform select[name=ownerId]").locator("option").allTextContents();
    check("Edge case 5", d.includes("Alan Fake (deactivated)") && !newOpts.some((o) => o.includes("Alan")), `${id ? "seeded" : "set by SQL"} person ${pidv}: page shows "Alan Fake (deactivated)"=${d.includes("Alan Fake (deactivated)")}; edit owner options=${JSON.stringify(opts)} selected=${sel}; new-person owner options=${JSON.stringify(newOpts)}`);
  });

  await sec("Edge case 6", async () => {
    const id = pid("Cleo Testperson");
    await ada.goto(`${BASE}/people/${id}/edit`); await settle(ada);
    await linus.goto(`${BASE}/people/${id}/edit`); await settle(linus);
    await ada.getByLabel("Role or job title").fill("First wins"); await save(ada);
    await linus.getByLabel("Role or job title").fill("Second loses"); await save(linus);
    const t = await text(linus);
    await linus.goto(`${BASE}/people/${id}`); await settle(linus);
    const d = await details(linus);
    check("Edge case 6", t.includes("Someone else changed this person while you were editing. Reload to see their changes.") && d.includes("First wins") && !d.includes("Second loses"), `second save msg=${t.includes("Someone else changed this person while you were editing.")}; page after reload shows first=${d.includes("First wins")} second=${d.includes("Second loses")}`);
  });

  await sec("Edge case 7", async () => {
    await addPerson(ada, { first: "Fifty", last: "50% Off", emails: ["fifty@example.com"] });
    await addPerson(ada, { first: "Fivehundred", last: "500 Off", emails: ["five@example.com"] });
    await addPerson(ada, { first: "O'Brien", last: "Under_score", emails: ["ob@example.com"] });
    const o = [];
    for (const [q, exp] of [["50%", "Fifty 50% Off"], ["_", "O'Brien Under_score"], ["O'Brien", "O'Brien Under_score"], ['"', null], ["zz%none", null]]) {
      await ada.goto(`${BASE}/people?q=${encodeURIComponent(q)}`); await settle(ada);
      const names = (await ada.locator("tbody tr td:first-child a.nm").allInnerTexts()).filter(Boolean);
      const none = (await text(ada)).includes("No people match these filters.");
      o.push(`${q}→[${names}]${none ? " (No people match)" : ""}`);
      if (exp ? !(names.length === 1 && names[0].includes(exp)) : !(names.length === 0 && none)) o.push("BAD");
    }
    check("Edge case 7", !o.includes("BAD"), o.join("; "));
  });

  await sec("Edge case 8", async () => {
    sql("insert into persons (first_name, last_name, owner_id, created_by, consent) select 'Bulk', 'Fake ' || g, 1, 1, 'subscribed' from generate_series(1, 60) g");
    await ada.goto(`${BASE}/people?q=Bulk`); await settle(ada);
    const n = await rows(ada).count(); const c = await ada.locator(".count").innerText();
    const next = ada.getByRole("link", { name: /next/i }); const href = await next.first().getAttribute("href").catch(() => null);
    check("Edge case 8", n === 50 && c.includes("60 PEOPLE") && href && href.includes("page=2") && href.includes("q=Bulk"), `rows=${n}; count=${JSON.stringify(c)}; next link=${href}`);
  });

  await sec("Edge case 9", async () => {
    await ada.goto(`${BASE}/people?q=Bulk&page=99`); await settle(ada);
    const n = await rows(ada).count(); const t = (await text(ada)).replace(/\s+/g, " ");
    const pager = (await ada.locator(".pager, nav[aria-label*=age]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
    check("Edge case 9", n === 10 && /page 2 of 2|2 \/ 2|PAGE 2/i.test(pager || t), `page=99: rows=${n}; pager=${JSON.stringify(pager)}`);
  });

  await sec("Edge case 12", async () => {
    // Margaret creates a private person, then is deactivated by SQL (as the admin's Users page would).
    const marg = await user(browser, "margaret@barnacle.ai", "Margaret Fake");
    await addPerson(marg, { first: "Hidden", last: "Margaret", emails: ["hidden.m@example.com"], private: true });
    const id = pid("Hidden Margaret");
    sql("update users set status='deactivated' where email='margaret@barnacle.ai'");
    await ada.goto(`${BASE}/people?sort=added&dir=desc`); await settle(ada); const a = await rows(ada).filter({ hasText: "Hidden Margaret" }).count();
    await ada.goto(`${BASE}/people?q=Hidden`); await settle(ada); const b = await rows(ada).filter({ hasText: "Hidden Margaret" }).count();
    const r = await ada.goto(`${BASE}/people/${id}`); await settle(ada); const nf = (await text(ada)).includes("Page not found.");
    check("Edge case 12", a === 0 && b === 0 && nf && r.status() === 404, `private=${sql(`select private from persons where id=${id}`)}; admin list=${a} search=${b}; page ${r.status()} not found=${nf}`);
  });
}

(async () => {
  const browser = await chromium.launch();
  try { if (process.argv[2] === "A") await phaseA(browser); else await phaseB(browser); }
  finally { await browser.close(); }
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
})();
