// SF-115 US5 (CSV import to custom fields) + the import parts of US1-4 and US4-2. Run after reset-db.sh.
const H = require("./sf115-lib.js"); const { check, q, go, submit, main, fieldId } = H;
const file = (name, s) => ({ name, mimeType: "text/csv", buffer: Buffer.from(s, "utf8") });
async function upload(p, kind, f) {
  await go(p, `/${kind}/import`); await p.getByLabel(/CSV file|Choose another file/).setInputFiles(f);
  await p.getByRole("button", { name: "[ NEXT ]" }).click(); await p.waitForURL(/\/columns$/, { timeout: 30000 }); await p.waitForLoadState("networkidle"); await p.waitForTimeout(1000);
}
const preview = async (p) => { await submit(p, p.getByRole("button", { name: "[ PREVIEW ]" })); return main(p); };
const doImport = async (p) => { const r = p.getByRole("radio", { name: "Subscribed", exact: true }); if (await r.count()) await r.check(); await p.getByRole("button", { name: "[ IMPORT ]" }).click(); await p.waitForURL(/\/report$/, { timeout: 60000 }); await p.waitForLoadState("networkidle"); return main(p); };
const sel = (p, h) => p.getByLabel(`Field for ${h}`, { exact: true });
const pv = (email, f) => q(`select coalesce(v.text_value, v.number_value::text, v.money_pence::text, v.date_value::text, c.name, (select string_agg(x.name, ',' order by x.position) from custom_field_choices x where x.id = any(v.choice_ids)), v.bool_value::text) from custom_values v left join custom_field_choices c on c.id=v.choice_id join person_emails e on e.person_id=v.person_id where e.email='${email}' and v.field_id=${f}`);
(async () => {
  const b = await H.chromium.launch(); const p = await H.newPage(b, "ada@barnacle.ai", "Ada Fake");
  q(`insert into custom_fields (kind,name,type,position,in_list) values ('person','Fflag','yes_no',6,false),('person','Fmoney','money',7,false),('person','Ftext','text',8,false)`);
  const [FL, MO, TX] = ["Fflag", "Fmoney", "Ftext"].map((n) => fieldId("person", n));
  const rows = [
    ["First name", "Last name", "Email", "diet-(FAKE)", "BIRTHDAY fake", "Newsletter topics (fake)", "head count met fake", "Fflag", "Fmoney", "Ftext", "Other"],
    ["Ann", "Csvfake", "ann@csv.example", "vegan", "24/11/2026", "ai; Hiring", "3", "yes", "£1,234.50", "short", "x"],
    ["Bob", "Csvfake", "bob@csv.example", "Pescatarian", "24 Nov 2026", "AI, Nope", "abc", "Y", "1,000", "", "x"],
    ["Cid", "Csvfake", "cid@csv.example", "Pescatarian", "2026-11-24", "events", "1.5", "maybe", "£x", "", "x"],
    ["Dan", "Csvfake", "dan@csv.example", "VEGETARIAN", "31/02/2026", "", "", "0", "12.345", "", "x"],
    ["Eve", "Csvfake", "eve@csv.example", "", "", "", "", "false", "", "T".repeat(256), "x"],
    ["Fay", "Csvfake", "fay@csv.example", "", "", "", "", "n", "", "", "x"],
    ["Gil", "Csvfake", "gil@csv.example", "", "", "", "", "TRUE", "", "", "x"],
    ["Hal", "Csvfake", "hal@csv.example", "", "", "", "", "1", "", "", "x"],
    ["Ivy", "Csvfake", "ivy@csv.example", "", "", "", "", "No", "", "", "x"],
  ];
  const csv = rows.map((r) => r.join(",").replace(/ai; Hiring/, '"ai; Hiring"').replace(/AI, Nope/, '"AI, Nope"').replace(/£1,234\.50/, '"£1,234.50"').replace(/,1,000,/, ',"1,000",')).join("\r\n") + "\r\n";
  // rename a field first (US1-4 import part)
  q("update custom_fields set name='Head count met (fake)' where id=4");
  await upload(p, "people", file("c.csv", csv));
  const sugg = {}; for (const h of rows[0]) sugg[h] = await sel(p, h).evaluate((s) => s.options[s.selectedIndex].text + "=" + s.value);
  const opts = await sel(p, "Other").evaluate((s) => [...s.querySelectorAll("optgroup")].map((g) => g.label + ":" + [...g.querySelectorAll("option")].map((o) => o.text).join("/")).join(" | ") || [...s.options].map((o) => o.text).join("/"));
  const allOpts = await sel(p, "Other").evaluate((s) => [...s.options].map((o) => o.text));
  const firstCustom = allOpts.indexOf("Diet (fake)"); const builtInAfter = allOpts.slice(firstCustom).some((t) => /^(Email|First name|Last name|Owner|Role)/.test(t));
  // map two columns to the same custom field
  const target = await sel(p, "diet-(FAKE)").inputValue();
  await sel(p, "Other").selectOption(target); const dupT = await preview(p); const stillCols = p.url().endsWith("/columns");
  const dupMsg = (dupT.match(/[^\n]*(more than one|twice|one column|already)[^\n]*/i) || ["(none)"])[0];
  await sel(p, "Other").selectOption({ index: 0 });
  const ok1 = sugg["diet-(FAKE)"].startsWith("Diet (fake)=custom:") && sugg["BIRTHDAY fake"].startsWith("Birthday (fake)") && sugg["head count met fake"].startsWith("Head count met (fake)") && sugg["Fflag"].startsWith("Fflag") && firstCustom > 0 && !builtInAfter && dupMsg.includes("Only one column can be set to Diet (fake).");
  check("US5 scenario 1", ok1, `suggestions ${JSON.stringify(sugg)}; options ${opts.slice(0, 400)}; mapping "Other" to the Diet field too → refused, message "${dupMsg}"`);
  const prev = await preview(p);
  const report = await doImport(p);
  const w = (re) => re.test(prev) && re.test(report);
  // US5-2
  const v2 = [pv("ann@csv.example", 1), pv("ann@csv.example", 3), pv("bob@csv.example", 3), pv("dan@csv.example", 1), pv("bob@csv.example", 1), pv("cid@csv.example", 3)];
  const warnChoice = (prev.match(/[^\n]*Pescatarian[^\n]*/) || ["none"])[0]; const warnNope = (prev.match(/[^\n]*Nope[^\n]*/) || ["none"])[0];
  check("US5 scenario 2", v2.join("|") === "Vegan|AI,Hiring|AI|Vegetarian||Events" && w(/Pescatarian[^\n]*\(rows \d+, \d+\)/) && w(/Nope/),
    `values Ann diet/topics, Bob topics, Dan diet, Bob diet, Cid topics = ${JSON.stringify(v2)}; preview warnings: "${warnChoice}" / "${warnNope}"; in report too=${/Pescatarian/.test(report) && /Nope/.test(report)}`);
  // US5-3
  const v3 = ["ann", "bob", "cid", "dan", "fay", "gil", "hal", "ivy"].map((n) => n + ":" + pv(n + "@csv.example", FL));
  check("US5 scenario 3", v3.join() === "ann:true,bob:true,cid:,dan:false,fay:false,gil:true,hal:true,ivy:false" && w(/maybe/), `${v3.join(", ")}; warning "${(prev.match(/[^\n]*maybe[^\n]*/) || ["none"])[0]}"`);
  // US5-4
  const v4 = { annBd: pv("ann@csv.example", 2), bobBd: pv("bob@csv.example", 2), cidBd: pv("cid@csv.example", 2), danBd: pv("dan@csv.example", 2), annM: pv("ann@csv.example", MO), bobM: pv("bob@csv.example", MO), cidM: pv("cid@csv.example", MO), danM: pv("dan@csv.example", MO), annN: pv("ann@csv.example", 4), bobN: pv("bob@csv.example", 4), cidN: pv("cid@csv.example", 4) };
  const imported = q("select string_agg(first_name, ',' order by first_name) from persons where last_name='Csvfake'");
  const eveReason = (prev.match(/[^\n]*Keep the Ftext under 255 characters[^\n]*/i) || ["none"])[0];
  check("US5 scenario 4", v4.annBd === "2026-11-24" && v4.bobBd === "2026-11-24" && v4.cidBd === "2026-11-24" && v4.danBd === "" && v4.annM === "123450" && v4.bobM === "100000" && v4.cidM === "" && v4.danM === "" && v4.annN === "3.0000" && v4.bobN === "" && v4.cidN === "1.5000"
    && imported === "Ann,Bob,Cid,Dan,Fay,Gil,Hal,Ivy" && w(/31\/02\/2026/) && w(/abc/) && w(/12\.345/) && /Keep the Ftext under 255 characters/i.test(prev),
    `${JSON.stringify(v4)}; imported ${imported} (Eve not: "${eveReason.slice(0, 120)}"); warnings for 31/02/2026, abc, £x, 12.345: ${["31/02/2026", "abc", "£x", "12.345"].map((x) => x + "=" + prev.includes(x)).join(",")}`);
  // US5-5: preview, delete a mapped field, then import
  const csv5 = "First name,Last name,Email,Ftext,head count met fake\r\nJo,Gonefake,jo@csv.example,keep me,7\r\n";
  await upload(p, "people", file("d.csv", csv5)); await preview(p);
  const a2 = await H.newPage(b, "grace@barnacle.ai", "Grace Fake");
  await go(a2, `/admin/custom-fields?kind=people&delete=${TX}`); await submit(a2, a2.locator('[role="alertdialog"] button:has-text("[ DELETE FIELD ]")'));
  const rep5 = await doImport(p);
  check("US5 scenario 5", rep5.includes("Ftext was deleted before the import ran: its column was not imported.") && pv("jo@csv.example", 4) === "7.0000" && q("select count(*) from persons where last_name='Gonefake'") === "1",
    `report: "${(rep5.match(/[^\n]*deleted before[^\n]*/) || ["none"])[0]}"; Jo imported with Head count 7: ${pv("jo@csv.example", 4)}`);
  // US1-4 / US4-2 import parts: renamed name offered; deleted field gone
  q("update custom_fields set name='Renamed diet' where id=1");
  await upload(p, "people", file("e.csv", "First name,Ftext,Renamed diet\r\nKim,x,Vegan\r\n"));
  const o2 = await sel(p, "First name").evaluate((s) => [...s.options].map((o) => o.text));
  const sug2 = await sel(p, "Renamed diet").evaluate((s) => s.options[s.selectedIndex].text);
  check("Import mapping after rename/delete", o2.includes("Renamed diet") && !o2.includes("Diet (fake)") && !o2.includes("Ftext"), `options ${JSON.stringify(o2.slice(-8))}; "Renamed diet" column suggested → ${sug2}`);
  // organisations import
  await upload(p, "organisations", file("o.csv", "Name,account code (fake)\r\nCsv Org Fake,ACC-9\r\n"));
  const so = await sel(p, "account code (fake)").evaluate((s) => s.options[s.selectedIndex].text);
  await preview(p); await doImport(p);
  check("Org import", so === "Account code (fake)" && q("select v.text_value from custom_values v join organisations o on o.id=v.organisation_id where o.name='Csv Org Fake'") === "ACC-9", `suggested ${so}; value saved`);
  await b.close();
})();
