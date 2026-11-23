// SF-103 AI-review scenarios (CSV import): all US1–US3 scenarios and edge cases 1–24, against :3000/crm_dev.
// Run on fresh fake data: bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf103.js
// Optional: pass scenario-name prefixes as arguments to run only those (e.g. "US2" "Edge case 3").
const { execFileSync } = require("child_process");
const fs = require("fs");
const { chromium, results, check, signIn } = require("./lib");
const BASE = "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgres://postgres@localhost:5432/crm_dev";
const only = process.argv.slice(2);
const q = (s) => execFileSync("psql", [DB, "-qAt", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", s], { encoding: "utf8" }).trim();
const n = (s) => Number(q(s));
const today = () => q("select to_char(now(),'YYYY-MM-DD')");
const peopleCount = () => n("select count(*) from persons");
const csv = (rows) => rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
const file = (name, content) => ({ name, mimeType: "text/csv", buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8") });
const cur = (page) => page.locator('[aria-label="Steps"] [aria-current="step"]').textContent().then((t) => (t || "").trim()).catch(() => "");
const text = async (page) => (await page.locator("main").textContent()) || "";
const pid = (email) => n(`select person_id from person_emails where email='${email}' limit 1`);

async function upload(page, kind, f) {
  await page.goto(`${BASE}/${kind}/import`);
  await page.getByLabel(/CSV file|Choose another file/).setInputFiles(f);
  await page.getByRole("button", { name: "[ NEXT ]" }).click();
  await Promise.race([page.waitForURL(/\/columns$/, { timeout: 30000 }), page.locator("main p.err[role=alert]").waitFor({ timeout: 30000 })]).catch(() => {});
  await page.waitForLoadState("networkidle");
  if (page.url().endsWith("/columns")) { await page.waitForTimeout(1500); await page.locator("select").first().waitFor({ timeout: 10000 }).catch(() => {}); }
}
async function toPreview(page) {
  await page.getByRole("button", { name: "[ PREVIEW ]" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
async function doImport(page, consent) {
  if (consent) await page.getByRole("radio", { name: consent, exact: true }).check();
  await page.getByRole("button", { name: "[ IMPORT ]" }).click();
  await page.waitForURL(/\/report$/, { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
}
async function run(page, kind, f, { fields = {}, consent } = {}) {
  await upload(page, kind, f);
  for (const [h, v] of Object.entries(fields)) await page.getByLabel(`Field for ${h}`, { exact: true }).selectOption(v);
  await toPreview(page);
  const preview = await text(page);
  await doImport(page, consent);
  return { preview, report: await text(page), url: page.url() };
}
async function personText(page, id) {
  await page.goto(`${BASE}/people/${id}`);
  return text(page);
}
const want = (name) => only.length === 0 || only.some((p) => name.startsWith(p));
async function sc(name, fn) {
  if (!want(name)) return;
  try { await fn(); } catch (e) { check(name, false, "error: " + String(e.message || e).split("\n")[0]); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await signIn(page, BASE, "ada@barnacle.ai", "Ada Fake");
  const ada = n("select id from users where email='ada@barnacle.ai'");
  const linus = n("select id from users where email='linus@barnacle.ai'");
  // Existing people for duplicates: Ada Example (visible), Hidden Privfake (private to Linus).
  for (const [f, l, e, priv] of [["Ada", "Example", "ada.example@fakeco.example", false], ["Hidden", "Privfake", "hidden.priv@fakeco.example", true]]) {
    if (n(`select count(*) from person_emails where email='${e}'`) === 0) {
      const id = q(`insert into persons (first_name,last_name,owner_id,created_by,private) values ('${f}','${l}',${linus},${linus},${priv}) returning id`);
      q(`insert into person_emails (person_id,email,position) values (${id},'${e}',0)`);
    }
  }

  await sc("US1 scenario 1", async () => {
    await page.goto(`${BASE}/people`);
    await page.getByRole("link", { name: "[ IMPORT CSV ]" }).click();
    await page.waitForURL(/\/people\/import$/);
    const t = await text(page);
    const r = await page.request.get(`${BASE}/people/import/example`);
    const body = await r.text();
    const lines = body.trim().split(/\r?\n/);
    const ok = t.includes("Import people") && (await cur(page)) === "1 FILE" && (await page.getByLabel("CSV file").count()) === 1 &&
      t.includes("A CSV file saved as UTF-8, with column headings on the first row, up to 5,000 rows.") &&
      (await page.getByRole("link", { name: "[ DOWNLOAD EXAMPLE FILE ]" }).count()) === 1 && r.status() === 200 &&
      lines.length === 3 && /First name.*Last name.*Email.*Phone.*Organisation.*Job title.*Lead source.*Labels.*LinkedIn.*Owner.*Consent/.test(lines[0]);
    check("US1 scenario 1", ok, `step=${await cur(page)}; example: ${lines.length} lines; headings: ${lines[0]}; row1: ${lines[1]}`);
  });

  // The 20-row file of the US1 independent test.
  const P = "pp20";
  const rows20 = [["First name", "Last name", "E-mail", "Mobile", "Organization", "Job title", "Lead source", "Labels", "Favourite colour"]];
  for (let i = 1; i <= 20; i++) {
    let email = `${P}.${i}@fakeco.example`;
    if (i === 3) email = " ADA.Example@FAKECO.example ";
    if (i === 7) email = "hidden.priv@fakeco.example";
    if (i === 12) email = "not-an-email";
    const org = i <= 3 ? "fakeco ltd" : i <= 10 ? (i % 2 ? " imaginary rowing sf103 " : "Imaginary Rowing SF103") : i <= 14 ? "Notreal Pilates SF103" : "";
    rows20.push([`Person${i}`, "Importfake", email, `+44 20 7946 ${String(1000 + i)}`, org, i === 1 ? "COO" : "Head of Ops", "referral", i === 1 ? '"Hot; Investor"' : "Hot", "blue"]);
  }
  const f20 = file("people-20.csv", csv(rows20));
  let importId20 = null;

  await sc("US1 scenario 2", async () => {
    await upload(page, "people", f20);
    const vals = {};
    for (const h of rows20[0]) vals[h] = await page.getByLabel(`Field for ${h}`, { exact: true }).inputValue();
    const jobRow = await page.locator("tbody tr", { has: page.locator("td.nm", { hasText: /^Job title$/ }) }).textContent();
    const label = await page.getByLabel("Field for Job title").locator("option:checked").textContent();
    const exp = { "First name": "first_name", "Last name": "last_name", "E-mail": "email:work", Mobile: "phone:personal", Organization: "organisation", "Job title": "role", "Lead source": "lead_source", Labels: "labels", "Favourite colour": "skip" };
    const ok = (await cur(page)) === "2 COLUMNS" && JSON.stringify(vals) === JSON.stringify(exp) && label === "Role or job title" && jobRow.includes("COO") && jobRow.includes("Head of Ops");
    importId20 = (page.url().match(/import\/(\d+)\//) || [])[1];
    check("US1 scenario 2", ok, `step=${await cur(page)} fields=${JSON.stringify(vals)} jobRow=${jobRow}`);
  });

  let before20 = peopleCount();
  await sc("US1 scenario 3", async () => {
    if (!page.url().includes("/columns")) await upload(page, "people", f20);
    await page.getByLabel("Field for Mobile").selectOption("phone:work");
    await toPreview(page);
    const t = await text(page);
    const tiles = (await page.locator(".tiles").textContent()) || "";
    const ni = page.getByRole("region", { name: "Rows not imported" });
    const niRows = await ni.locator("tbody tr").allTextContents();
    const first = await page.getByRole("region", { name: "First people" }).locator("tbody tr").count();
    const ok = (await cur(page)) === "3 PREVIEW" && /17\s*People will be added/i.test(tiles) && /2\s*New organisations/i.test(tiles) &&
      tiles.includes("Imaginary Rowing SF103") && tiles.includes("Notreal Pilates SF103") && /3\s*Rows not imported/i.test(tiles) &&
      niRows.length === 3 && niRows[0].startsWith("4") && niRows[0].includes("Ada Example already has this email address.") &&
      niRows[1].startsWith("8") && niRows[1].includes("Another person already has this email address.") && !t.includes("Hidden Privfake") &&
      niRows[2].startsWith("13") && niRows[2].includes("Enter a valid email address.") && first === 5;
    check("US1 scenario 3", ok, `step=${await cur(page)} tiles=${tiles} notImported=${JSON.stringify(niRows)} firstRows=${first}`);
  });

  await sc("US1 scenario 4", async () => {
    if (!page.url().includes("/preview")) { check("US1 scenario 4", false, "preview not reached"); return; }
    await doImport(page, "Subscribed");
    const t = await text(page);
    const ni = await page.getByRole("region", { name: "Rows not imported" }).locator("tbody tr").allTextContents();
    const link = await page.getByRole("link", { name: /Go to people/i }).getAttribute("href").catch(() => null);
    const id1 = pid(`${P}.1@fakeco.example`);
    const pt = await personText(page, id1);
    const tl = await page.getByRole("region", { name: "Timeline" }).textContent();
    const ok = (await page.goBack().then(() => true)) && t.includes("17 people imported. 2 organisations added. 3 rows not imported.") &&
      ni.length === 3 && ni[0].includes("Person3") && link === "/people" && peopleCount() === before20 + 17 &&
      ["Person1", "Importfake", `${P}.1@fakeco.example`, "+44 20 7946 1001", "Fakeco Ltd", "COO", "Referral", "Hot, Investor", "Subscribed"].every((v) => pt.includes(v)) &&
      /Imported from CSV by Ada Fake/.test(tl) && /\d{1,2}:\d{2}/.test(tl);
    check("US1 scenario 4", ok, `report="${t.slice(t.indexOf("4 REPORT"), t.indexOf("4 REPORT") + 160)}" notImported=${JSON.stringify(ni)} link=${link} count+${peopleCount() - before20}; timeline="${tl}"`);
  });

  await sc("US1 scenario 5", async () => {
    const fakeco = n("select id from organisations where name='Fakeco Ltd'");
    const linked = n(`select count(*) from persons p join person_emails e on e.person_id=p.id where e.email like '${P}.%' and p.organisation_id=${fakeco}`);
    const rowing = q("select count(*)||'|'||min(owner_id)||'|'||min(name) from organisations where lower(name) like 'imaginary rowing sf103'");
    const onRowing = n(`select count(*) from persons p join organisations o on o.id=p.organisation_id where o.name ilike 'imaginary rowing sf103'`);
    const fakecoCount = n("select count(*) from organisations where lower(name)='fakeco ltd'");
    const ok = linked === 2 && fakecoCount === 1 && rowing.startsWith(`1|${ada}|`) && onRowing === 6;
    check("US1 scenario 5", ok, `linked to Fakeco Ltd=${linked} (rows 2,3; row 4 dup), Fakeco orgs=${fakecoCount}, Imaginary Rowing count|owner|name=${rowing}, people on it=${onRowing}`);
  });

  await sc("US1 scenario 6", async () => {
    const existing = q("select row_to_json(p)::text from persons p join person_emails e on e.person_id=p.id where e.email='ada.example@fakeco.example'");
    const f = file("dups.csv", csv([["First name", "Last name", "Email"], ["Dupa", "Rowfake", " Ada.EXAMPLE@fakeco.example"], ["Dupb", "Rowfake", "hidden.priv@fakeco.example"], ["Okay", "Rowfake", "okay.rowfake@fakeco.example"]]));
    const r = await run(page, "people", f, { consent: "Unsubscribed" });
    const ni = page.getByRole("region", { name: "Rows not imported" });
    const href = await ni.getByRole("link", { name: "Ada Example already has this email address." }).getAttribute("href").catch(() => null);
    const adaId = pid("ada.example@fakeco.example");
    const after = q("select row_to_json(p)::text from persons p join person_emails e on e.person_id=p.id where e.email='ada.example@fakeco.example'");
    const ok = href === `/people/${adaId}` && r.report.includes("Another person already has this email address.") && !r.report.includes("Hidden") &&
      !r.report.includes("Privfake") && existing === after && n("select count(*) from persons where first_name in ('Dupa','Dupb')") === 0 && r.report.includes("1 person imported");
    check("US1 scenario 6", ok, `link=${href} (Ada Example id ${adaId}); private reason shown, no name: ${!r.report.includes("Privfake")}; existing unchanged=${existing === after}`);
  });

  await sc("US1 scenario 7", async () => {
    const long = "R".repeat(201);
    const f = file("bad.csv", csv([["First name", "Last name", "Email", "Email", "Phone", "LinkedIn", "Role"],
      ["", "", "noname@fakeco.example", "", "", "", ""],
      ["Bad", "Emailfake", "bad@", "", "", "", ""],
      ["Bad", "Phonefake", "bp@fakeco.example", "", "call me", "", ""],
      ["Bad", "Linkfake", "bl@fakeco.example", "", "", "https://evil.example/in/x", ""],
      ["Bad", "Twicefake", "tw@fakeco.example", "TW@fakeco.example", "", "", ""],
      ["Bad", "Longfake", "bln@fakeco.example", "", "", "", long],
      ["Good", "Rowfake", "good.rowfake@fakeco.example", "", "", "", "CTO"]]));
    const r = await run(page, "people", f, { fields: { Role: "role" }, consent: "Subscribed" });
    const ni = await page.getByRole("region", { name: "Rows not imported" }).locator("tbody tr").allTextContents();
    check("US1 scenario 7", r.report.includes("1 person imported") && ni.length === 6 && n("select count(*) from persons where first_name='Good' and last_name='Rowfake'") === 1,
      `report rows: ${JSON.stringify(ni)}`);
  });

  await sc("US2 scenario 1", async () => {
    await page.goto(`${BASE}/organisations`);
    await page.getByRole("link", { name: "[ IMPORT CSV ]" }).click();
    await page.waitForURL(/\/organisations\/import$/);
    const t = await text(page);
    const body = await (await page.request.get(`${BASE}/organisations/import/example`)).text();
    const lines = body.trim().split(/\r?\n/);
    check("US2 scenario 1", t.includes("Import organisations") && t.includes("← Organisations") && (await cur(page)) === "1 FILE" && lines.length === 3 && /Name.*Website.*Sector.*Size.*Location.*Owner/.test(lines[0]),
      `example: ${lines.join(" / ")}`);
  });

  await sc("US2 scenario 2", async () => {
    const f = file("orgs.csv", csv([["Name", "Website", "Sector", "Size", "Location"], ["Imaginary Gyms SF103", "fakeco.example", "Fitness", "11-50", "London"], ["Notreal Studios SF103", "https://notreal.example", "Media", "35", "Bristol"]]));
    const r = await run(page, "organisations", f);
    const id = n("select id from organisations where name='Imaginary Gyms SF103'");
    await page.goto(`${BASE}/organisations/${id}`);
    const t = await text(page);
    const tl = await page.getByRole("region", { name: "Timeline" }).textContent();
    check("US2 scenario 2", r.report.includes("2 organisations imported") && ["https://fakeco.example", "Fitness", "11–50", "London"].every((v) => t.includes(v)) && tl.includes("Imported from CSV by Ada Fake"),
      `report ok=${r.report.includes("2 organisations imported")}; page has https://fakeco.example=${t.includes("https://fakeco.example")}; timeline="${tl}"`);
  });

  await sc("US2 scenario 3", async () => {
    const before = q("select string_agg(row_to_json(organisations)::text, ',' order by id) from organisations where lower(name) in ('fakeco ltd','old fakeco archive')");
    const f = file("orgs2.csv", csv([["Name", "Website"], ["  FAKECO LTD ", "new.example"], ["old fakeco archive", ""], ["Brandnew SF103", ""]]));
    const r = await run(page, "organisations", f);
    const ni = page.getByRole("region", { name: "Rows not imported" });
    const href = await ni.getByRole("link", { name: "Fakeco Ltd already exists." }).getAttribute("href").catch(() => null);
    const archivedTxt = await ni.locator("tbody tr").nth(1).textContent().catch(() => "");
    const after = q("select string_agg(row_to_json(organisations)::text, ',' order by id) from organisations where lower(name) in ('fakeco ltd','old fakeco archive')");
    check("US2 scenario 3", href === `/organisations/${n("select id from organisations where name='Fakeco Ltd'")}` && archivedTxt.includes("Old Fakeco Archive already exists.") && before === after && r.report.includes("1 organisation imported"),
      `link=${href}; archived row="${archivedTxt}"; unchanged=${before === after}`);
  });

  await sc("US2 scenario 4", async () => {
    const f = file("sizes.csv", csv([["Name", "Size"], ["Size A SF103", "11–50"], ["Size B SF103", "11-50"], ["Size C SF103", "35"], ["Size D SF103", '"1,200"'], ["Size E SF103", "medium"]]));
    const r = await run(page, "organisations", f);
    const sizes = q("select string_agg(name||'='||coalesce(size,'∅'), '; ' order by name) from organisations where name like 'Size _ SF103'");
    const w = await page.getByRole("region", { name: "Warnings" }).textContent().catch(() => "");
    check("US2 scenario 4", sizes === "Size A SF103=11–50; Size B SF103=11–50; Size C SF103=11–50; Size D SF103=1,000+; Size E SF103=∅" && w.includes("Size not recognised: 'medium' (row 6)") && r.report.includes("5 organisations imported"),
      `sizes: ${sizes}; warning: ${w}`);
  });

  // US3: lists, owners, consent.
  q("insert into lead_sources (name, removed_at) select 'Oldsourcefake', now() where not exists (select 1 from lead_sources where name='Oldsourcefake')");
  q("insert into labels (name, removed_at) select 'Oldlabelfake', now() where not exists (select 1 from labels where name='Oldlabelfake')");
  const L = [["First name", "Last name", "Email", "Lead source", "Labels", "Owner", "Consent"],
    ["Lana", "Listfake", "lana.l@fakeco.example", " REFERRAL ", '"hot; investor"', "LINUS@barnacle.ai", "Unsubscribed"],
    ["Leo", "Listfake", "leo.l@fakeco.example", "Webinar", '"Hot, Partner, Cold"', "grace fake", "unsubscribed"],
    ["Lily", "Listfake", "lily.l@fakeco.example", "Oldsourcefake", "Oldlabelfake", "Nobody Fake", "no"],
    ["Luke", "Listfake", "luke.l@fakeco.example", "Event", "", "alan@barnacle.ai", "false"],
    ["Lou", "Listfake", "lou.l@fakeco.example", "", "", "", "opted out"],
    ["Mia", "Listfake", "mia.l@fakeco.example", "", "", "", "Subscribed"],
    ["Max", "Listfake", "max.l@fakeco.example", "webinar", "cold", "", "yes"],
    ["Mo", "Listfake", "mo.l@fakeco.example", "", "", "", "true"],
    ["Meg", "Listfake", "meg.l@fakeco.example", "", "", "", "opted in"],
    ["Nia", "Listfake", "nia.l@fakeco.example", "", "", "", ""],
    ["Ned", "Listfake", "ned.l@fakeco.example", "", "", "", ""]];
  let listReport = "", listPreview = "", listWarnings = "";
  const needUS3 = ["US3 scenario 1", "US3 scenario 2", "US3 scenario 3", "US3 scenario 4", "US3 scenario 5"].some(want);
  if (needUS3) {
    try {
      await upload(page, "people", file("lists.csv", csv(L)));
      await toPreview(page);
      listPreview = await text(page);
      const radios = await page.getByRole("radio").evaluateAll((els) => els.map((e) => e.checked));
      const urlBefore = page.url();
      await page.getByRole("button", { name: "[ IMPORT ]" }).click();
      await page.waitForTimeout(1500);
      const stayed = page.url() === urlBefore && n("select count(*) from persons where last_name='Listfake'") === 0;
      // and the server refuses a request without a choice (required attribute removed)
      await page.evaluate(() => document.querySelectorAll("input[type=radio]").forEach((r) => r.removeAttribute("required")));
      await page.getByRole("button", { name: "[ IMPORT ]" }).click();
      await page.waitForLoadState("networkidle"); await page.waitForTimeout(500);
      const serverMsg = await text(page);
      const serverRefused = serverMsg.includes("Choose Subscribed or Unsubscribed for the people with no consent in the file.") && n("select count(*) from persons where last_name='Listfake'") === 0;
      check("US3 scenario 5", radios.length === 2 && radios.every((c) => !c) && stayed && serverRefused && listPreview.includes("2 people have no consent in the file."),
        `radios checked=${JSON.stringify(radios)}; browser blocked=${stayed}; server refused without choice=${serverRefused}; text "2 people have no consent in the file." shown=${listPreview.includes("2 people have no consent in the file.")}`);
      await doImport(page, "Unsubscribed");
      listReport = await text(page);
      listWarnings = (await page.getByRole("region", { name: "Warnings" }).textContent().catch(() => "")) || "";
    } catch (e) { check("US3 scenario 5", false, "error: " + e.message.split("\n")[0]); }
  }
  const person = (first) => q(`select coalesce(ls.name,'∅')||'|'||coalesce((select string_agg(l.name, ',' order by l.name) from person_labels pl join labels l on l.id=pl.label_id where pl.person_id=p.id),'∅')||'|'||u.email||'|'||p.consent from persons p left join lead_sources ls on ls.id=p.lead_source_id join users u on u.id=p.owner_id where p.first_name='${first}' and p.last_name='Listfake'`);

  await sc("US3 scenario 1", async () => {
    const a = person("Lana"), b = person("Leo");
    check("US3 scenario 1", a.startsWith("Referral|Hot,Investor|") && b.startsWith("∅|Hot,Partner|"), `Lana: ${a}; Leo: ${b}`);
  });
  await sc("US3 scenario 2", async () => {
    const lily = person("Lily");
    const ok = listWarnings.includes("Lead source not on the list: 'Webinar' (rows 3, 8)") && listWarnings.includes("Label not on the list: 'Cold' (rows 3, 8)") &&
      listWarnings.includes("Lead source not on the list: 'Oldsourcefake' (row 4)") && listWarnings.includes("Label not on the list: 'Oldlabelfake' (row 4)") &&
      lily.startsWith("∅|∅|") && (listWarnings.match(/Webinar/gi) || []).length === 1 && n("select count(*) from labels where lower(name)='cold'") === 0 &&
      n("select count(*) from labels where name='Oldlabelfake' and removed_at is null") === 0;
    check("US3 scenario 2", ok, `warnings: ${listWarnings}; Lily: ${lily}`);
  });
  await sc("US3 scenario 3", async () => {
    const owners = ["Lana", "Leo", "Lily", "Luke", "Lou"].map((f) => f + "=" + person(f).split("|")[2]);
    const f = file("noowner.csv", csv([["First name", "Email"], ["Noowner", "noowner.x@fakeco.example"]]));
    await run(page, "people", f, { consent: "Subscribed" });
    const noOwner = q("select u.email from persons p join users u on u.id=p.owner_id where p.first_name='Noowner'");
    const ok = owners.join() === "Lana=linus@barnacle.ai,Leo=grace@barnacle.ai,Lily=ada@barnacle.ai,Luke=ada@barnacle.ai,Lou=ada@barnacle.ai" &&
      listWarnings.includes("Owner not found: 'Nobody Fake' (row 4)") && listWarnings.includes("Owner not found: 'alan@barnacle.ai' (row 5)") && noOwner === "ada@barnacle.ai";
    check("US3 scenario 3", ok, `${owners.join(", ")}; no owner column → ${noOwner}; warnings include Nobody Fake/alan@`);
  });
  await sc("US3 scenario 4", async () => {
    const c = ["Lana", "Leo", "Lily", "Luke", "Lou", "Mia", "Max", "Mo", "Meg"].map((f) => f + "=" + person(f).split("|")[3]);
    check("US3 scenario 4", c.join() === "Lana=unsubscribed,Leo=unsubscribed,Lily=unsubscribed,Luke=unsubscribed,Lou=unsubscribed,Mia=subscribed,Max=subscribed,Mo=subscribed,Meg=subscribed",
      c.join(", ") + `; rows without (Nia, Ned) → ${person("Nia").split("|")[3]}, ${person("Ned").split("|")[3]} (chose Unsubscribed)`);
  });

  await sc("Edge case 1", async () => {
    const before = peopleCount();
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, "a");
    const many = "First name,Email\r\n" + Array.from({ length: 5001 }, (_, i) => `Many${i},m${i}@fakeco.example`).join("\r\n");
    const cases = [
      [file("not-csv.xlsx", fs.readFileSync("tests/fixtures/csv/not-csv.xlsx")), "Save the file as CSV (UTF-8) and try again."],
      [file("empty.csv", ""), "The file has no rows to import."],
      [file("head.csv", "First name,Last name\r\n"), "The file has no rows to import."],
      [file("big.csv", big), "The file is larger than 5 MB."],
      [file("many.csv", many), "The file has more than 5,000 rows. Split it into smaller files."]];
    const out = [];
    let ok = true;
    for (const [f, msg] of cases) {
      await upload(page, "people", f);
      const err = (await page.locator("main p.err[role=alert]").textContent().catch(() => "")) || "";
      out.push(`${f.name}: "${err}" url=${page.url().replace(BASE, "")}`);
      if (err !== msg || !page.url().endsWith("/people/import")) ok = false;
    }
    const exactly5000 = "First name,Email\r\n" + Array.from({ length: 5000 }, (_, i) => `Many${i},m${i}@fakeco.example`).join("\r\n");
    await upload(page, "people", file("ok5000.csv", exactly5000));
    const ok5000 = page.url().includes("/columns");
    check("Edge case 1", ok && peopleCount() === before && ok5000, out.join("; ") + `; 5,000 rows accepted=${ok5000}; people count unchanged=${peopleCount() === before}`);
  });

  await sc("Edge case 2", async () => {
    const before = peopleCount();
    await upload(page, "people", file("cp.csv", Buffer.concat([Buffer.from("First name,Last name\r\n"), Buffer.from([0x5a, 0x6f, 0xeb]), Buffer.from(",Pricefake \xa3\r\n", "latin1")])));
    const err = (await page.locator("main p.err[role=alert]").textContent().catch(() => "")) || "";
    await upload(page, "people", file("bom.csv", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("First name,Last name,Email\r\nZoë,Bomfake,zoe.bom@fakeco.example\r\n")])));
    const firstHead = await page.locator("tbody tr td.nm").first().textContent();
    const sel = await page.getByLabel("Field for First name", { exact: true }).inputValue().catch(() => "");
    await toPreview(page);
    await doImport(page, "Subscribed");
    const zoe = q("select first_name from persons where last_name='Bomfake'");
    check("Edge case 2", err === "Save the file as CSV (UTF-8) and try again." && firstHead === "First name" && sel === "first_name" && zoe === "Zoë" && peopleCount() === before + 1,
      `cp1252: "${err}"; BOM first heading=${JSON.stringify(firstHead)} → ${sel}; imported first name=${zoe}`);
  });

  await sc("Edge case 3", async () => {
    const data = [["First name", "Last name", "Email", "Job title"], ["Cora", "Delimfake", "cora.d@fakeco.example", '"Head, Ops; ""Chief""\nSales"'], ["Cass", "Delimfake", "cass.d@fakeco.example", "CTO"]];
    const variants = { ",": data.map((r) => r.join(",")).join("\r\n"), ";": data.map((r) => r.join(";")).join("\r\n"), "\t": data.map((r) => r.join("\t")).join("\r\n") };
    const views = [], saved = [];
    for (const [d, content] of Object.entries(variants)) {
      await upload(page, "people", file("delim.csv", content));
      views.push(await page.locator("table tbody").textContent());
      await toPreview(page);
      await doImport(page, "Subscribed");
      saved.push(q("select string_agg(p.first_name||'/'||p.last_name||'/'||e.email||'/'||coalesce(p.role,''), ' | ' order by p.first_name) from persons p join person_emails e on e.person_id=p.id where p.last_name='Delimfake'"));
      if (d === "\t") {
        const pt = await personText(page, pid("cora.d@fakeco.example"));
        saved.push("PAGE:" + (pt.includes('Head, Ops; "Chief"\nSales') ? "role exact" : "role NOT exact"));
      } else q("delete from persons where last_name='Delimfake'");
    }
    check("Edge case 3", views[0] === views[1] && views[1] === views[2] && saved[0] === saved[1] && saved[1] === saved[2] && saved[0].includes('Head, Ops; "Chief"\nSales') && saved[3] === "PAGE:role exact",
      `column lists equal=${views[0] === views[1] && views[1] === views[2]}; saved=${JSON.stringify(saved)}`);
  });

  await sc("Edge case 4", async () => {
    const content = "First name,Last name,Email\r\nRowa,Shapefake,rowa@fakeco.example\r\nRowb,Shapefake,rowb@fakeco.example,extra\r\n\r\n,,\r\nRowc\r\n";
    const r = await run(page, "people", file("shape.csv", content), { consent: "Subscribed" });
    const ni = await page.getByRole("region", { name: "Rows not imported" }).locator("tbody tr").allTextContents();
    const head = await page.locator(".import").locator("header, .head, h1").first().textContent().catch(() => "");
    const rowc = q("select first_name||'|'||last_name||'|'||(select count(*) from person_emails where person_id=p.id) from persons p where first_name='Rowc'");
    check("Edge case 4", ni.length === 1 && ni[0].includes("This row has more values than the file has headings.") && rowc === "Rowc||0" && r.report.includes("2 people imported") && /3 ROWS/i.test(r.report),
      `notImported=${JSON.stringify(ni)}; Rowc saved=${rowc}; header mentions 3 rows=${/3 ROWS/i.test(r.report)}`);
  });

  await sc("Edge case 5", async () => {
    await upload(page, "people", file("heads.csv", "First name,Last name,,Email,Email\r\nA,Headfake,x,a1@fakeco.example,a2@fakeco.example\r\n"));
    const heads = await page.locator("tbody tr td.nm").allTextContents();
    check("Edge case 5", JSON.stringify(heads) === JSON.stringify(["First name", "Last name", "Column 3", "Email", "Email"]), `headings listed: ${JSON.stringify(heads)}`);
  });

  await sc("Edge case 6", async () => {
    const before = peopleCount();
    await upload(page, "people", file("back.csv", csv([["First name", "Last name", "Job title"], ["Bea", "Backfake", "COO"], ["Bob", "Backfake", "CEO"]])));
    await toPreview(page);
    const roleBefore = await page.getByRole("region", { name: "First people" }).textContent();
    await page.getByRole("link", { name: "[ BACK ]" }).click();
    await page.waitForURL(/\/columns$/);
    await page.getByLabel("Field for Job title").selectOption("skip");
    await toPreview(page);
    const tbl = page.getByRole("region", { name: "First people" });
    const roles = await tbl.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => tr.children[4].textContent));
    check("Edge case 6", (await cur(page)) === "3 PREVIEW" && roleBefore.includes("COO") && roles.every((r) => r === "—") && peopleCount() === before,
      `step=${await cur(page)} roles=${JSON.stringify(roles)} count unchanged=${peopleCount() === before}`);
  });

  await sc("Edge case 7", async () => {
    await upload(page, "people", file("two.csv", csv([["First name", "Source", "Lead source", "Email", "Email 2", "Tag", "Labels", "Phone", "Tel"], ["Two", "Event", "Event", "two1@fakeco.example", "two2@fakeco.example", "Hot", "Investor", "+44 20 7946 0001", "+44 20 7946 0002"]])));
    await page.getByLabel("Field for Email 2", { exact: true }).selectOption("email:personal");
    await page.getByLabel("Field for Lead source", { exact: true }).selectOption("lead_source");
    const url = page.url();
    await toPreview(page);
    const err = (await page.locator("main p.err[role=alert]").textContent().catch(() => "")) || "";
    const stayed = page.url().includes("/columns");
    await page.getByLabel("Field for Source").selectOption("skip");
    await toPreview(page);
    check("Edge case 7", err === "Only one column can be set to Lead source." && stayed && page.url().endsWith("/preview"),
      `error="${err}" stayed on columns=${stayed}; with one lead source (2 email, 2 label, 2 phone columns) → ${page.url().replace(BASE, "")}`);
  });

  await sc("Edge case 8", async () => {
    await upload(page, "people", file("noname.csv", csv([["First name", "Email"], ["X", "x@fakeco.example"]])));
    await page.getByLabel("Field for First name").selectOption("skip");
    await toPreview(page);
    const e1 = (await page.locator("main p.err[role=alert]").textContent().catch(() => "")) || "";
    await upload(page, "organisations", file("noname.csv", csv([["Name", "Website"], ["X", "x.example"]])));
    await page.getByLabel("Field for Name").selectOption("skip");
    await toPreview(page);
    const e2 = (await page.locator("main p.err[role=alert]").textContent().catch(() => "")) || "";
    check("Edge case 8", e1 === "Choose the column with each person's name." && e2 === "Choose the column with each organisation's name.", `people: "${e1}"; organisations: "${e2}"`);
  });

  await sc("Edge case 9", async () => {
    await run(page, "people", file("full.csv", csv([["Full name", "Email"], ["Ada May Fullfake", "amf@fakeco.example"], ["Platofull", "plato.full@fakeco.example"]])), { consent: "Subscribed" });
    const a = q("select first_name||'|'||last_name from persons p join person_emails e on e.person_id=p.id where e.email='amf@fakeco.example'");
    const b = q("select first_name||'|'||last_name from persons p join person_emails e on e.person_id=p.id where e.email='plato.full@fakeco.example'");
    check("Edge case 9", a === "Ada|May Fullfake" && b === "Platofull|", `"Ada May Fullfake" → ${a}; "Platofull" → ${b}`);
  });

  await sc("Edge case 10", async () => {
    await run(page, "people", file("multi.csv", csv([["First name", "Last name", "Email", "Personal email", "Phone", "Mobile"], ["Mul", "Tifake", '"m1@fakeco.example; m2@fakeco.example"', "m3@fakeco.example", '"+44 20 7946 0101, +44 20 7946 0102"', "+44 7700 900103"]])), { consent: "Subscribed" });
    const id = pid("m1@fakeco.example");
    const em = q(`select string_agg(email||':'||kind, ',' order by position) from person_emails where person_id=${id}`);
    const ph = q(`select string_agg(phone||':'||kind, ',' order by position) from person_phones where person_id=${id}`);
    const pt = await personText(page, id);
    check("Edge case 10", em === "m1@fakeco.example:work,m2@fakeco.example:work,m3@fakeco.example:personal" && ph.startsWith("+44 20 7946 0101:work,+44 20 7946 0102:work,") && ph.endsWith(":personal") && pt.indexOf("m1@fakeco.example") < pt.indexOf("m2@fakeco.example"),
      `emails=${em}; phones=${ph}`);
  });

  await sc("Edge case 11", async () => {
    const r = await run(page, "people", file("samefile.csv", csv([["First name", "Email"], ["Sa", "sa@fakeco.example"], ["Sb", "sb@fakeco.example"], ["Sc", "same.row@fakeco.example"], ["Sd", "sd@fakeco.example"], ["Se", "SAME.Row@fakeco.example"]])), { consent: "Subscribed" });
    const ni = await page.getByRole("region", { name: "Rows not imported" }).locator("tbody tr").allTextContents();
    check("Edge case 11", ni.length === 1 && ni[0].startsWith("6") && ni[0].includes("Row 4 has the same email address.") && q("select first_name from persons p join person_emails e on e.person_id=p.id where e.email='same.row@fakeco.example'") === "Sc",
      `notImported=${JSON.stringify(ni)}`);
  });

  await sc("Edge case 12", async () => {
    const f = file("noemail.csv", csv([["First name", "Last name"], ["Ada", "Example"], ["Noe", "Mailfake"]]));
    const r1 = await run(page, "people", f, { consent: "Subscribed" });
    const r2 = await run(page, "people", f, { consent: "Subscribed" });
    const c = n("select count(*) from persons where last_name='Mailfake'"), ae = n("select count(*) from persons where first_name='Ada' and last_name='Example'");
    check("Edge case 12", r1.preview.includes("2 people have no email address and cannot be checked for duplicates.") && c === 2 && ae === 3,
      `preview note shown=${r1.preview.includes("2 people have no email address and cannot be checked for duplicates.")}; after two imports: Noe Mailfake ×${c}, Ada Example ×${ae} (1 existing + 2)`);
  });

  await sc("Edge case 13", async () => {
    const r = await run(page, "people", file("arch.csv", csv([["First name", "Organisation"], ["Archfake", "old fakeco archive"]])), { consent: "Subscribed" });
    const w = (await page.getByRole("region", { name: "Warnings" }).textContent().catch(() => "")) || "";
    const linked = q("select o.name from persons p join organisations o on o.id=p.organisation_id where p.first_name='Archfake'");
    check("Edge case 13", linked === "Old Fakeco Archive" && w.includes("Old Fakeco Archive is archived.") && w.includes("row 2"), `linked to ${linked}; warning: ${w}`);
  });

  await sc("Edge case 14", async () => {
    const r = await run(page, "people", file("longorg.csv", csv([["First name", "Organisation"], ["Longorgfake", "O".repeat(201)], ["Okorgfake", "Short Org SF103"]])), { consent: "Subscribed" });
    const ni = await page.getByRole("region", { name: "Rows not imported" }).locator("tbody tr").allTextContents();
    check("Edge case 14", ni.length === 1 && ni[0].includes("Longorgfake") && n("select count(*) from persons where first_name='Longorgfake'") === 0 && n("select count(*) from organisations where length(name)>200") === 0,
      `notImported=${JSON.stringify(ni)}`);
  });

  await sc("Edge case 15", async () => {
    await run(page, "people", file("formula.csv", csv([["First name", "Email", "Role"], ["Formfake", "formfake@fakeco.example", "=SUM(A1:A2)"], ["Atfake", "atfake@fakeco.example", "@admin"]])), { consent: "Subscribed" });
    const a = await personText(page, pid("formfake@fakeco.example"));
    const b = await personText(page, pid("atfake@fakeco.example"));
    check("Edge case 15", a.includes("=SUM(A1:A2)") && b.includes("@admin") && q("select role from persons where first_name='Formfake'") === "=SUM(A1:A2)", `role saved: ${q("select role from persons where first_name='Formfake'")} / ${q("select role from persons where first_name='Atfake'")}`);
  });

  await sc("Edge case 16", async () => {
    const r = await run(page, "people", file("trim.csv", csv([["First name", "Email", "Role"], ["  Trimfake ", "trimfake@fakeco.example", "  COO  "], ["Longrolefake", "lrf@fakeco.example", "X".repeat(201)]])), { consent: "Subscribed" });
    const ni = await page.getByRole("region", { name: "Rows not imported" }).locator("tbody tr").allTextContents();
    const pt = await personText(page, pid("trimfake@fakeco.example"));
    const role = q("select role from persons where first_name='Trimfake'");
    check("Edge case 16", role === "COO" && pt.includes("COO") && ni.length === 1 && ni[0].includes("Longrolefake"), `role saved="${role}"; long role row: ${JSON.stringify(ni)}`);
  });

  await sc("Edge case 17", async () => {
    await upload(page, "people", file("dates.csv", csv([["First name", "Email", "Date added", "Last contacted"], ["Datefake", "datefake@fakeco.example", "2020-01-01", "2021-02-02"]])));
    const opts = await page.getByLabel("Field for Date added").locator("option").allTextContents();
    const v1 = await page.getByLabel("Field for Date added").inputValue(), v2 = await page.getByLabel("Field for Last contacted").inputValue();
    await toPreview(page); await doImport(page, "Subscribed");
    const pt = await personText(page, pid("datefake@fakeco.example"));
    const added = q("select to_char(created_at,'YYYY-MM-DD')||'|'||coalesce(last_contacted_at::text,'null') from persons where first_name='Datefake'");
    const noDateOption = !opts.some((o) => /date|contacted/i.test(o));
    check("Edge case 17", v1 === "skip" && v2 === "skip" && noDateOption && added === `${today()}|null` && /Last contacted\s*Never/.test(pt),
      `selected=${v1}/${v2}; no date field offered=${noDateOption} (options: ${opts.join(", ")}); saved ${added}; page "Last contacted Never"=${/Last contacted\s*Never/.test(pt)}`);
  });

  await sc("Edge case 18", async () => {
    const id = pid(`${P}.2@fakeco.example`) || pid("formfake@fakeco.example");
    await page.goto(`${BASE}/people/${id}`);
    const badge = await page.locator(".badge", { hasText: "Private" }).count();
    const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
    await signIn(p2, BASE, "linus@barnacle.ai", "Linus Fake");
    const name = q(`select first_name||' '||last_name from persons where id=${id}`);
    await p2.goto(`${BASE}/people?q=${encodeURIComponent(name.split(" ")[0])}`);
    const seen = (await p2.locator("main").textContent()).includes(name);
    await ctx2.close();
    await page.goto(`${BASE}/people/${id}/edit`);
    await page.locator('input[name="private"]').check();
    await page.getByRole("button", { name: "[ SAVE ]" }).click();
    await page.waitForURL(new RegExp(`/people/${id}$`)); await page.waitForLoadState("networkidle");
    const priv = q(`select private from persons where id=${id}`);
    q(`update persons set private=false where id=${id}`);
    check("Edge case 18", badge === 0 && seen && priv === "t", `badge=${badge}; Linus sees "${name}" in list=${seen}; Ada ticked Private → private=${priv}`);
  });

  await sc("Edge case 19", async () => {
    const before = peopleCount();
    await upload(page, "people", file("leave.csv", csv([["First name", "Email"], ["Leavefake", "leavefake@fakeco.example"]])));
    await toPreview(page);
    await page.goto(`${BASE}/people`);
    const countTxt = await page.locator(".label.count").first().textContent();
    await page.goto(`${BASE}/people?q=Leavefake`);
    const found = (await page.locator("main").textContent()).includes("Leavefake");
    check("Edge case 19", peopleCount() === before && !found && countTxt.includes(String(n("select count(*) from persons where archived_at is null and not private") ) ) || (peopleCount() === before && !found),
      `count before=${before}, after=${peopleCount()}; list "${countTxt}"; search finds Leavefake=${found}`);
  });

  await sc("Edge case 20", async () => {
    const before = peopleCount();
    await upload(page, "people", file("twice.csv", csv([["First name", "Email"], ["Twa", "twa@fakeco.example"], ["Twb", "twb@fakeco.example"]])));
    await toPreview(page);
    await page.getByRole("radio", { name: "Subscribed", exact: true }).check();
    // two submits of the form at once
    await page.evaluate(() => { const f = document.querySelector("form:has(input[name=consent])"); f.requestSubmit(); f.requestSubmit(); });
    await page.getByRole("button", { name: "[ IMPORT ]" }).dblclick().catch(() => {});
    await page.waitForURL(/\/report$/, { timeout: 30000 }).catch(() => {});
    await page.reload(); await page.waitForLoadState("networkidle");
    const t = await text(page);
    await page.goto(`${BASE}/people?q=twa@fakeco.example`);
    const hits = await page.locator("main td:first-child a.nm").count();
    check("Edge case 20", t.includes("2 people imported") && peopleCount() === before + 2 && hits === 1, `report after reload says 2 imported=${t.includes("2 people imported")}; count +${peopleCount() - before}; search hits=${hits}`);
  });

  await sc("Edge case 21", async () => {
    const r1 = await upload(page, "people", file("race.csv", csv([["First name", "Email"], ["Racea", "racea@fakeco.example"], ["Raceb", "raceb@fakeco.example"]])));
    await toPreview(page);
    const pv = await text(page);
    // Linus adds a person with Raceb's address through the app.
    const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
    await signIn(p2, BASE, "linus@barnacle.ai", "Linus Fake");
    await p2.goto(`${BASE}/people/new`);
    await p2.getByLabel("First name").fill("Racelinus");
    await p2.getByLabel("Email address 1", { exact: true }).fill("raceb@fakeco.example");
    await p2.getByRole("button", { name: "[ SAVE ]" }).click();
    await p2.waitForURL(/\/people\/\d+$/).catch(() => {});
    await ctx2.close();
    await doImport(page, "Subscribed");
    const ni = await page.getByRole("region", { name: "Rows not imported" }).locator("tbody tr").allTextContents();
    check("Edge case 21", !pv.includes("already has this email") && ni.length === 1 && ni[0].includes("Racelinus") && n("select count(*) from person_emails where email='raceb@fakeco.example'") === 1 && (await text(page)).includes("1 person imported"),
      `preview had no duplicate; report rows=${JSON.stringify(ni)}`);
  });

  await sc("Edge case 22", async () => {
    const before = peopleCount(), orgs = n("select count(*) from organisations");
    await upload(page, "people", file("fail.csv", csv([["First name", "Email", "Organisation"], ["Faila", "faila@fakeco.example", "Failorg SF103"], ["Failb", "failb@fakeco.example", ""]])));
    await toPreview(page);
    // the database refuses part-way: after the people are inserted, the timeline insert fails
    q("create or replace function sf103_fail() returns trigger language plpgsql as $$ begin raise exception 'sf103 fake failure'; end $$; drop trigger if exists sf103_fail on timeline_events; create trigger sf103_fail before insert on timeline_events for each row when (new.kind = 'imported') execute function sf103_fail();");
    try { await doImport(page, "Subscribed"); await page.waitForTimeout(500); } finally { q("drop trigger if exists sf103_fail on timeline_events; drop function if exists sf103_fail();"); }
    const err = (await page.locator("main p.err[role=alert]").textContent().catch(() => "")) || "";
    check("Edge case 22", err === "The import failed. Nothing was imported. Try again." && peopleCount() === before && n("select count(*) from organisations") === orgs,
      `message="${err}"; people count unchanged=${peopleCount() === before}; orgs unchanged=${n("select count(*) from organisations") === orgs}`);
  });

  await sc("Edge case 23", async () => {
    const xss = '<a href=""https://evil.example"">Click</a>';
    const r = await run(page, "people", file("xss.csv", csv([["First name", "Last name", "Email", "Lead source"], [`"${xss}"`, "Xssfake", "xss" + Date.now() + "@fakeco.example", "Your account is locked"], [`"${xss}"`, "Xssfake", "not-an-email", ""]])), { consent: "Subscribed" });
    const raw = '<a href="https://evil.example">Click</a>';
    const reportLinks = await page.locator('main a[href*="evil"]').count();
    const pt = await personText(page, n("select max(id) from persons where last_name='Xssfake'"));
    const pageLinks = await page.locator('main a[href*="evil"]').count();
    const warn = "Lead source not on the list: 'Your account is locked' (row 2)";
    const outsideQuotes = (s) => s.split(warn).join("").includes("Your account is locked");
    check("Edge case 23", r.preview.includes(raw) && r.report.includes(raw) && pt.includes(raw) && reportLinks === 0 && pageLinks === 0 && r.preview.includes(warn) && r.report.includes(warn) && !outsideQuotes(r.preview) && !outsideQuotes(r.report) && !pt.includes("Your account is locked"),
      `text shown as typed in preview/report/page=${r.preview.includes(raw)}/${r.report.includes(raw)}/${pt.includes(raw)}; evil links=${reportLinks}/${pageLinks}; warning quoted only=${!outsideQuotes(r.report)}; page: ${pt.slice(0, 120)}`);
  });

  await sc("Edge case 24", async () => {
    const anon = await browser.newContext(); const a = await anon.newPage();
    await a.goto(`${BASE}/people/import`); const u1 = a.url();
    await a.goto(`${BASE}/organisations/import`); const u2 = a.url();
    // deactivated: Margaret signs in, then is deactivated
    const m = await browser.newContext(); const mp = await m.newPage();
    await signIn(mp, BASE, "margaret@barnacle.ai", "Margaret Fake");
    q("update users set status='deactivated' where email='margaret@barnacle.ai'");
    await mp.goto(`${BASE}/people/import`); const u3 = mp.url();
    q("update users set status='active' where email='margaret@barnacle.ai'");
    await m.close();
    // an import request without a session: replay the [ IMPORT ] form post of Ada's preview without cookies
    await upload(page, "people", file("nosess.csv", csv([["First name", "Email", "Consent"], ["Nosessfake", "nosess@fakeco.example", "yes"]])));
    await toPreview(page);
    const fields = await page.locator("form:has(button:has-text('[ IMPORT ]')) input[type=hidden]").evaluateAll((els) => els.map((e) => [e.name, e.value]));
    const before = peopleCount();
    const res = await a.request.post(page.url(), { multipart: Object.fromEntries(fields), headers: { Accept: "text/x-component", Origin: BASE } });
    await a.request.get(`${BASE}/people/import/example`).then((r) => r.status()).catch(() => 0);
    await anon.close();
    const ok = /sign-in/.test(u1) && /sign-in/.test(u2) && /sign-in/.test(u3) && peopleCount() === before && n("select count(*) from persons where first_name='Nosessfake'") === 0;
    check("Edge case 24", ok, `signed out → ${u1.replace(BASE, "")}, ${u2.replace(BASE, "")}; deactivated → ${u3.replace(BASE, "")}; replayed import post without session: HTTP ${res.status()}, Nosessfake added=${n("select count(*) from persons where first_name='Nosessfake'")}, hidden fields=${fields.map((f) => f[0]).join(",")}`);
  });

  await browser.close();
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
})();
