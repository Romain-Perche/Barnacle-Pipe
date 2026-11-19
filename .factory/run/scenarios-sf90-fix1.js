// SF-90 fix round 1 edge cases 14–20 (AI review). Run on the seed against :3000/crm_dev:
//   bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf90-fix1.js
const { execFileSync } = require("child_process");
const { chromium, results, check, signIn } = require("./lib");
const BASE = process.env.BASE || "http://localhost:3000";
const sql = (q) => execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", "-d", "crm_dev", "-Atc", q]).toString().trim();
const settle = (p) => p.waitForLoadState("networkidle").then(() => p.waitForTimeout(300));
const main = async (p) => (await p.textContent("main")) || "";
const details = async (p) => (await p.locator('[aria-label="Details"]').textContent().catch(() => "")) || "";
const sec = async (n, f) => { try { await f(); } catch (e) { check(n, false, "error: " + String(e.message || e).split("\n")[0]); } };
const save = async (p) => { await Promise.all([settle(p), p.getByRole("button", { name: "[ SAVE ]" }).click()]); await settle(p); };
const combo = (p) => p.getByRole("combobox", { name: "Organisation" });
async function newPerson(p, first) { await p.goto(BASE + "/people/new"); await settle(p); await p.getByLabel("First name").fill(first); }

(async () => {
  const browser = await chromium.launch();
  const p = await (await browser.newContext()).newPage();
  await signIn(p, BASE, "linus@barnacle.ai", "Linus Fake");

  await sec("Edge case 14", async () => {
    const r = await p.goto(BASE + "/organisations?sector=" + encodeURIComponent("Your account is locked, call 0800 000")); await settle(p);
    const html = await p.content();
    const rows = await p.locator("tbody tr").count();
    const expected = Number(sql("select count(*) from organisations where archived_at is null"));
    const sel = await p.locator("select[name=sector] option:checked").textContent();
    check("Edge case 14", rows === expected && /Any sector/.test(sel) && !html.includes("Your account is locked"), `status=${r.status()} rows=${rows} (exp ${expected}); selected="${sel}"; text in html=${html.includes("Your account is locked")}`);
  });

  await sec("Edge case 15", async () => {
    await newPerson(p, "Fifteen");
    await combo(p).fill("Brand New Org");
    const hint = await p.locator(".picker .hint").textContent().catch(() => "");
    await p.locator("h1").click(); // leave the field without choosing
    await save(p);
    const row = sql("select o.name||'|'||u.name from persons p join organisations o on o.id=p.organisation_id join users u on u.id=o.owner_id where p.first_name='Fifteen'");
    check("Edge case 15", hint === 'A new organisation “Brand New Org” will be added.' && row === "Brand New Org|Linus Fake" && /\/people\/\d+$/.test(p.url()), `hint=${JSON.stringify(hint)}; saved org=${row}; url=${p.url().replace(BASE, "")}`);
  });

  await sec("Edge case 16", async () => {
    const id = sql("select p.id from persons p join organisations o on o.id=p.organisation_id where o.name='Sample Studios Fake' and not p.private limit 1");
    await p.goto(`${BASE}/people/${id}/edit`); await settle(p);
    const before = await combo(p).inputValue();
    await combo(p).fill("Fake"); await p.locator("h1").click();
    await save(p);
    const a = sql(`select coalesce(o.name,'NONE') from persons p left join organisations o on o.id=p.organisation_id where p.id=${id}`);
    const nFake = sql("select count(*) from organisations where name='Fake'");
    await p.goto(`${BASE}/people/${id}/edit`); await settle(p);
    await p.getByRole("button", { name: "[ CLEAR ]" }).click();
    await save(p);
    const b = sql(`select coalesce(o.name,'NONE') from persons p left join organisations o on o.id=p.organisation_id where p.id=${id}`);
    const d = await details(p);
    check("Edge case 16", before === "Sample Studios Fake" && a === "Fake" && nFake === "1" && b === "NONE", `person ${id}: field before=${before}; after typing "Fake"=${a} (orgs named Fake=${nFake}); after CLEAR=${b}; details org part=${JSON.stringify((d.match(/Organisation.{0,12}/) || [""])[0])}`);
  });

  await sec("Edge case 17", async () => {
    await newPerson(p, "Seventeen");
    await combo(p).fill("Sample"); await combo(p).press("Enter"); await p.waitForTimeout(200);
    const v1 = await combo(p).inputValue(); const h1 = await p.locator(".picker .hint").textContent().catch(() => "");
    const url1 = p.url();
    await combo(p).fill("sample studios fake"); await combo(p).press("Enter"); await p.waitForTimeout(200);
    const v2 = await combo(p).inputValue(); const h2 = await p.locator(".picker .hint").count();
    const hid = await p.locator("input[name=organisationId]").inputValue();
    check("Edge case 17", v1 === "Sample" && h1.includes("“Sample” will be added") && url1.endsWith("/people/new") && v2 === "Sample Studios Fake" && h2 === 0 && hid === sql("select id from organisations where name='Sample Studios Fake'"),
      `Enter on "Sample": value=${v1} hint=${JSON.stringify(h1)} still on form=${url1.endsWith("/people/new")}; Enter on "sample studios fake": value=${v2} hints=${h2} organisationId=${hid}`);
  });

  await sec("Edge case 18", async () => {
    await newPerson(p, "Eighteen");
    await combo(p).fill(" sample studios fake "); await p.locator("h1").click();
    const hints = await p.locator(".picker .hint").count();
    await save(p);
    const org = sql("select o.name from persons p join organisations o on o.id=p.organisation_id where p.first_name='Eighteen'");
    const n = sql("select count(*) from organisations where lower(btrim(name))='sample studios fake'");
    await p.goto(BASE + "/organisations?q=Sample+Studios"); await settle(p);
    const listRows = await p.locator("tbody tr").count();
    const np = Number(sql("select count(*) from persons"));
    await newPerson(p, "EighteenB");
    await combo(p).fill("OLD FAKECO ARCHIVE"); await p.locator("h1").click();
    await save(p);
    const t = await main(p);
    const link = await p.locator("a", { hasText: "Old Fakeco Archive" }).first().getAttribute("href").catch(() => null);
    const np2 = Number(sql("select count(*) from persons"));
    check("Edge case 18", hints === 0 && org === "Sample Studios Fake" && n === "1" && listRows === 1 && t.includes("Old Fakeco Archive already exists.") && link === `/organisations/${sql("select id from organisations where name='Old Fakeco Archive'")}` && np === np2,
      `hints=${hints}; linked=${org}; orgs with that name=${n}; list rows=${listRows}; archived: msg=${t.includes("Old Fakeco Archive already exists.")} link=${link} persons ${np}->${np2}`);
  });

  await sec("Edge case 19", async () => {
    const a = await (await browser.newContext()).newPage();
    await signIn(a, BASE, "ada@barnacle.ai", "Ada Fake");
    const id = sql("select id from persons where first_name='Seventeen'") || sql("select id from persons where first_name='Fifteen'");
    const name = sql(`select btrim(first_name||' '||last_name) from persons where id=${id}`);
    await a.goto(`${BASE}/people/${id}?confirm=delete`); await settle(a);
    let btn = a.getByRole("button", { name: /DELETE/ });
    if (!(await a.textContent("main")).includes("for good")) { await a.getByRole("link", { name: "[ DELETE ]" }).or(a.getByRole("button", { name: "[ DELETE ]" })).first().click(); await settle(a); }
    await Promise.all([settle(a), a.getByRole("button", { name: /DELETE/ }).last().click()]); await settle(a);
    const t1 = await main(a); await a.reload(); await settle(a); const t2 = await main(a);
    check("Edge case 19", t1.includes(`${name} was deleted.`) && !t2.includes("was deleted.") && a.url().endsWith("/people"), `deleted "${name}": notice shown=${t1.includes(`${name} was deleted.`)}; after reload=${t2.includes("was deleted.")}; url=${a.url().replace(BASE, "")}`);
  });

  await sec("Edge case 20", async () => {
    const a = await (await browser.newContext()).newPage();
    await signIn(a, BASE, "ada@barnacle.ai", "Ada Fake");
    const o = [];
    for (const [kind, table, removed, other] of [["lead source", "lead_sources", "Inbound", "Event"], ["label", "labels", "Partner", "Investor"]]) {
      sql(`update ${table} set removed_at=now() where name='${removed}'`);
      await a.goto(BASE + "/admin/lead-sources-and-labels"); await settle(a);
      const input = a.locator(`input[value="${other}"]`).first();
      await input.fill(removed.toLowerCase());
      const form = input.locator("xpath=ancestor::form[1]");
      await Promise.all([settle(a), form.getByRole("button", { name: /rename/i }).first().click()]); await settle(a);
      const t = await main(a);
      const still = sql(`select count(*) from ${table} where name='${other}'`);
      o.push(`${kind} ${other}->${removed.toLowerCase()}: msg=${t.includes("A removed entry already has this name. Add it again to bring it back.")} unchanged=${still === "1"}`);
    }
    check("Edge case 20", o.every((s) => !s.includes("false")), o.join("; "));
  });

  await browser.close();
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
})();
