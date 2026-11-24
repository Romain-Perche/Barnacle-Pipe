// SF-115 US3, US4, US6 + edges 6, 12 (lists, delete, privacy). Run after reset-db.sh.
const H = require("./sf115-lib.js"); const { check, q, go, submit, main, fieldId, more } = H;
const nm = (id) => q(`select trim(first_name||' '||last_name) from persons where id=${id}`);
const names = (p) => p.locator("main table tbody tr").evaluateAll((rs) => rs.map((r) => r.querySelector("td")?.innerText.split("\n")[0].trim()));
const count = async (p) => +(((await main(p)).match(/(\d+) (people|persons?|organisations?|deals?)\b/i) || [0, -1])[1]);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
(async () => {
  const b = await H.chromium.launch();
  // data (fields 1..5 seeded; 10 text, 11 money, 12 yes/no, 13 extra not in list)
  q(`update custom_fields set in_list=true where id in (2,4,5)`);
  q(`insert into custom_fields (kind,name,type,position,in_list) values ('person','Ftext','text',6,true),('person','Fmoney','money',7,true),('person','Fflag','yes_no',8,true),('person','Fextra','text',9,false)`);
  const [T, M, F, X] = ["Ftext", "Fmoney", "Fflag", "Fextra"].map((n) => fieldId("person", n));
  const long = "L".repeat(79) + "MNOP" + "z".repeat(20);
  q(`insert into custom_values (field_id, person_id, number_value) values (4,36,5),(4,38,10),(4,40,0),(4,37,7)`);
  q(`insert into custom_values (field_id, person_id, money_pence) values (${M},36,100000),(${M},38,5000),(${M},40,0),(${M},37,6000)`);
  q(`insert into custom_values (field_id, person_id, date_value) values (2,38,'2026-01-15'),(2,40,'2026-12-31'),(2,37,'2026-06-01')`);
  q(`insert into custom_values (field_id, person_id, text_value) values (${T},36,'Hello World'),(${T},38,'hello there'),(${T},40,'Bye'),(${T},37,'hello private'),(5,38,'${long}'),(${X},38,'Extra')`);
  q(`insert into custom_values (field_id, person_id, bool_value) values (${F},36,true),(${F},38,false),(${F},37,true)`);
  q(`update custom_values set choice_ids='{5,7}' where person_id=37 and field_id=3; insert into custom_values (field_id, person_id, choice_ids) select 3,37,'{5}' where not exists (select 1 from custom_values where person_id=37 and field_id=3)`);
  const g = await H.newPage(b, "grace@barnacle.ai", "Grace Fake");
  // US3-1
  await go(g, "/people"); const head = (await g.locator("main table thead").innerText()).split("\t").map((s) => s.replace(/[▲▼]/g, "").trim().toLowerCase());
  const expCols = ["diet (fake)", "birthday (fake)", "newsletter topics (fake)", "head count met (fake)", "notes (fake)", "ftext", "fmoney", "fflag"];
  const tail = head.slice(-8);
  const row38 = await g.locator("main table tbody tr", { hasText: nm(38) }).first().innerText();
  const row41 = await g.locator("main table tbody tr", { hasText: nm(41) }).first().innerText();
  const cut = row38.includes("L".repeat(79) + "M…") && !row38.includes("MNOP");
  check("US3 scenario 1", JSON.stringify(tail) === JSON.stringify(expCols) && head[0] === "name" && !head.includes("fextra") && cut && row38.includes("£50") && row38.includes("15 Jan 2026") && /Ezra Formerfake[\s\S]*Never\s+—\s+15 Jan 2026/.test(row38),
    `headers ${JSON.stringify(head)}; long text cut at 80 + …=${cut}; row 38 ${JSON.stringify(row38.replace(/\s+/g, " ").slice(0, 300))}; empty row shows —`);
  // US3-2 sort by number
  await go(g, "/people?sort=cf4"); const asc = await names(g); await go(g, "/people?sort=cf4&dir=desc"); const desc = await names(g);
  const a4 = [40, 36, 38, 39].map(nm), d4 = [39, 38, 36, 40].map(nm);
  await go(g, `/people?sort=cf${T}`); const ascT = (await names(g)).slice(0, 3); await go(g, `/people?sort=cf${T}&dir=desc`); const dT = await names(g);
  const ths = await g.locator("main table thead th").evaluateAll((ts) => ts.map((t) => t.innerText.replace(/[▲▼]/g, "").trim().toLowerCase() + ":" + !!t.querySelector("a")));
  const notSort = ths.includes("notes (fake):false") && ths.includes("newsletter topics (fake):false") && ths.includes("diet (fake):true") && ths.includes("fflag:true") && ths.includes("fmoney:true") && ths.includes("birthday (fake):true") && ths.includes("ftext:true") && ths.includes("head count met (fake):true");
  check("US3 scenario 2", JSON.stringify(asc.slice(0, 4)) === JSON.stringify(a4) && JSON.stringify(desc.slice(0, 4)) === JSON.stringify(d4) && !asc.includes(nm(37)) && dT.slice(0, 3).join() === [36, 38, 40].map(nm).join() && ascT.join() === [40, 38, 36].map(nm).join() && notSort,
    `Head asc ${JSON.stringify(asc.slice(0, 5))} desc ${JSON.stringify(desc.slice(0, 5))} (empties after); Ftext asc ${JSON.stringify(ascT)} desc ${JSON.stringify(dT.slice(0, 3))}; ${JSON.stringify(ths.slice(-8))}; notSortable(long,multi)=${notSort}`);
  // US3-3 + US6-1 filters (as Grace: 37 is private to Linus)
  const all = await (async () => { await go(g, "/people"); return names(g); })();
  const cases = [[`cf${T}=HELLO`, [36, 38]], ["cf4_from=5&cf4_to=10", [36, 38]], [`cf${M}_from=50&cf${M}_to=1000`, [36, 38]], ["cf2_from=2026-01-15&cf2_to=2026-12-31", [38, 40]],
    ["cf1=3", [36]], ["cf1=2", []], ["cf1=4", [39]], ["cf3=5", [36]], [`cf${F}=yes`, [36]], [`cf${F}=no`, [38]], ["cf5=fridays", [36]], [`cf${T}=hello&owner=1`, [36, 38].filter((i) => q(`select owner_id from persons where id=${i}`) === "1")]];
  const bad3 = []; const out3 = [];
  for (const [qs, ids] of cases) { await go(g, "/people?" + qs); const n = await names(g); const c = await count(g); const ok = same(n, ids.map(nm)) && c === ids.length; out3.push(`${qs}→${n.length}/${c}${ok ? "" : " WANT " + ids}`); if (!ok) bad3.push(qs + " got " + JSON.stringify(n)); }
  for (const [qs, exclude] of [["cf1=empty", [36, 39]], [`cf${F}=empty`, [36, 38]]]) { await go(g, "/people?" + qs); const n = await names(g); const want = all.filter((x) => !exclude.map(nm).includes(x)); const ok = same(n, want); out3.push(`${qs}→${n.length}`); if (!ok) bad3.push(qs); }
  // deals: count and total follow
  const a = await H.newPage(b, "ada@barnacle.ai", "Ada Fake");
  await go(a, "/deals/list?cf9=yes"); const dn = await names(a); const dtxt = ((await main(a)).match(/\d+ deals? · £[\d,.]+/i) || [""])[0];
  const v54 = (+q("select value_pence from deals where id=54") / 100).toLocaleString("en-GB");
  await go(a, "/deals/list?cf8_from=2027-01-01&cf8_to=2027-03-31"); const dn2 = await names(a); const dtxt2 = ((await main(a)).match(/\d+ deals? · £[\d,.]+/i) || [""])[0];
  const okDeals = dn.length === 1 && dtxt.toLowerCase() === `1 deal · £${v54}` && dn2.length === 1 && dn2[0] === dn[0];
  check("US3 scenario 3", !bad3.length && okDeals, `${out3.join("; ")}; bad ${JSON.stringify(bad3)}; deals NDA=yes ${JSON.stringify(dn)} "${dtxt}" (deal value £${v54}); Contract end 2027-01-01..03-31 ${JSON.stringify(dn2)} "${dtxt2}" (57, private to Linus with 2027-01-15, not counted)`);
  // US6-1 specifically
  const leak = []; for (const qs of [`cf${T}=private`, "cf4_from=7&cf4_to=7", `cf${M}_from=60&cf${M}_to=60`, "cf2_from=2026-06-01&cf2_to=2026-06-01", "cf1=2", "sort=cf4", "sort=cf1"]) { await go(g, "/people?" + qs); const n = await names(g); const c = await count(g); if (n.includes(nm(37)) || (qs.startsWith("cf") && c !== 0)) leak.push(qs + `:${c}`); }
  await go(g, "/people?sort=cf4"); const cAll = await count(g); await go(g, "/people"); const cAll0 = await count(g);
  await go(g, "/deals/list?cf8_from=2027-01-15&cf8_to=2027-01-15"); const dprv = await count(g); const dprvT = ((await main(g)).match(/\d+ deals?[^\n]*/i) || [""])[0];
  // filter option of a removed choice only from visible records: Pescatarian is on 39 (shared) → shown; Vegetarian (37 private, choice 2 is offered) fine
  check("US6 scenario 1", !leak.length && cAll === cAll0 && dprv === 0, `as Grace (37 ${nm(37)} private to Linus, values matching each filter): leaks ${JSON.stringify(leak)}; count with sort ${cAll} = without ${cAll0}; deal list filter on hidden deal's date → "${dprvT}"`);
  // US3-4 junk address parts
  await go(g, "/people"); const base = await names(g);
  const deadId = q(`insert into custom_fields (kind,name,type,position,in_list) values ('person','Doomed','text',10,true) returning id`).split("\n")[0]; q(`delete from custom_fields where id=${deadId}`);
  const junk = `/people?cf${deadId}=ZZQDEAD&cf${X}=ZZQHIDDEN&cf4_from=ZZQABC&cf2_from=ZZQDATE&cf1=ZZQ99&cf1=99999&cf${F}=maybeZZQ&cf3=ZZQ&sort=cf3&cf999999=ZZQX`;
  await go(g, junk); const jn = await names(g); const jt = await main(g);
  await go(g, `/people?sort=cf${X}`); const jn2 = await names(g); await go(g, `/people?sort=cf${deadId}&dir=asc`); const jn3 = await names(g);
  await go(g, "/people?sort=cf3"); const jn4 = await names(g);
  check("US3 scenario 4", JSON.stringify(jn) === JSON.stringify(base) && !jt.includes("ZZQ") && JSON.stringify(jn2) === JSON.stringify(base) && JSON.stringify(jn3) === JSON.stringify(base) && JSON.stringify(jn4) === JSON.stringify(base),
    `junk filters (deleted field, field not in list, bad numbers/date/choice/yes-no) → same ${jn.length} rows as no filter=${JSON.stringify(jn) === JSON.stringify(base)}; no ZZQ text shown=${!jt.includes("ZZQ")}; sort by hidden / deleted / multiple-choice field ignored=${JSON.stringify(jn2) === JSON.stringify(base)}/${JSON.stringify(jn3) === JSON.stringify(base)}/${JSON.stringify(jn4) === JSON.stringify(base)}`);
  // US3-5: 8 in list, try a 9th
  await go(a, `/admin/custom-fields?kind=people&field=${X}`); await a.locator('[role="dialog"] input[name="inList"]').check(); await submit(a, a.locator('[role="dialog"] button:has-text("[ SAVE ]")'));
  const t5 = await main(a); const tick = await a.locator('[role="dialog"] input[name="inList"]').isChecked().catch(() => "no box");
  await go(a, `/admin/custom-fields?kind=people&field=${X}`); const tick2 = await a.locator('[role="dialog"] input[name="inList"]').isChecked();
  check("US3 scenario 5", t5.includes("At most 8 custom fields can be shown in a list.") && q(`select in_list from custom_fields where id=${X}`) === "f" && tick2 === false,
    `message shown=${t5.includes("At most 8 custom fields can be shown in a list.")}; in_list stays ${q(`select in_list from custom_fields where id=${X}`)}; tick in the re-shown box=${tick}, after reopening=${tick2}`);
  // Edge 12: lists with no custom field shown
  q("update custom_fields set in_list=false");
  const e12 = [];
  for (const u of ["/people", "/organisations", "/deals/list"]) { await go(a, u); const h = await a.content(); const hd = await a.locator("main table thead").innerText(); e12.push(`${u}: cf inputs ${(h.match(/name="cf\d/g) || []).length}, headers ${JSON.stringify(hd.replace(/\s+/g, " "))}`); }
  const mainHtml = await (async () => { await go(a, "/people"); return a.locator("main table thead th").count(); })();
  check("Edge case 12", e12.every((x) => x.includes("cf inputs 0")) && mainHtml === 8, e12.join("; ") + ` (people: ${mainHtml} built-in columns, as on main)`);
  q("update custom_fields set in_list=true where kind='person' and id<>" + X + "; update custom_fields set in_list=true where kind<>'person'");
  // US4-1 / US6-2: delete confirmation
  q("insert into custom_values (field_id, person_id, choice_id) values (1, 31, 1)"); // archived Fay Mockup
  const dietCount = q("select count(*) from custom_values where field_id=1");
  await go(a, "/admin/custom-fields?kind=people&delete=1"); const box = await a.locator('[role="alertdialog"]').innerText();
  await go(a, `/admin/custom-fields?kind=people&delete=${X}`); const box0 = await a.locator('[role="alertdialog"]').innerText();
  q(`delete from custom_values where field_id=${X}`); await go(a, `/admin/custom-fields?kind=people&delete=${X}`); const box00 = await a.locator('[role="alertdialog"]').innerText();
  const exp = `${dietCount} people have a value in Diet (fake). Deleting the field deletes these values for good.`;
  check("US4 scenario 1", box.includes(exp) && box.includes("[ DELETE FIELD ]") && box.includes("[ CANCEL ]") && box00.includes("No record has a value in Fextra.") && /1 person has a value in Fextra/.test(box0),
    `box: ${JSON.stringify(box.replace(/\s+/g, " "))} (db rows ${dietCount}: Cara, private Dora, Ben with a removed choice, archived Fay); one value: ${JSON.stringify(box0.replace(/\s+/g, " ").slice(0, 60))}; none: ${JSON.stringify(box00.replace(/\s+/g, " ").slice(0, 60))}`);
  check("US6 scenario 2", box.includes(exp) && !box.includes("Dora") && !box.includes("Privatefake"), `as Ada (Dora Privatefake private to Linus): count ${dietCount} includes her, no name in ${JSON.stringify(box.replace(/\s+/g, " "))}`);
  // US4-3 cancel
  await go(a, "/admin/custom-fields?kind=people&delete=1"); await submit(a, a.locator('[role="alertdialog"] a:has-text("[ CANCEL ]")'));
  check("US4 scenario 3", q("select count(*) from custom_values where field_id=1") === dietCount && q("select count(*) from custom_fields where id=1") === "1" && (await a.locator('[role="alertdialog"]').count()) === 0, `after [ CANCEL ] at ${a.url().replace(H.B, "")}: field and ${dietCount} values still there`);
  // US4-5 setup: Linus opens an edit form with Birthday (2)
  const l = await H.newPage(b, "linus@barnacle.ai", "Linus Fake"); await go(l, "/people/41/edit");
  // Edge 6 setup: counts before deleting person 40 (values in 4, M, 2, T)
  const before6 = []; for (const f of [4, M, 2, T]) { await go(a, `/admin/custom-fields?kind=people&delete=${f}`); before6.push(((await a.locator('[role="alertdialog"]').innerText()).match(/\d+ (people|person)/) || ["?"])[0]); }
  // US4-2 + US4-4 confirm delete of Diet
  const ev0 = q("select count(*) from timeline_events");
  await go(a, "/admin/custom-fields?kind=people&delete=1"); await submit(a, a.locator('[role="alertdialog"] button:has-text("[ DELETE FIELD ]")'));
  const notice = (await main(a)).includes("Diet (fake) deleted.");
  await go(a, "/people/36"); const pg = await more(a); const tl36 = await main(a);
  await go(a, "/people/new"); const fm = await a.locator('[name="cf.1"]').count();
  await go(a, "/people"); const hd2 = (await a.locator("main table thead").innerText()).toLowerCase(); const flt = await a.locator('[name="cf1"]').count();
  const gone = q("select count(*) from custom_values where field_id=1") === "0" && q("select count(*) from custom_field_choices where field_id=1") === "0";
  check("US4 scenario 2", notice && gone && !/diet/i.test(pg) && fm === 0 && !hd2.includes("diet") && flt === 0, `notice "Diet (fake) deleted."=${notice}; values/choices gone=${gone}; page/form/column/filter free of it=${!/diet/i.test(pg)}/${fm === 0}/${!hd2.includes("diet")}/${flt === 0} (import mapping in import script)`);
  check("US4 scenario 4", tl36.includes("Diet (fake) set to Vegan") && q("select count(*) from timeline_events") === ev0, `Cara's timeline still has "Diet (fake) set to Vegan"; timeline events ${ev0}→${q("select count(*) from timeline_events")}`);
  // US4-5: delete Birthday while Linus's form is open, then Linus saves with a birthday
  await go(a, "/admin/custom-fields?kind=people&delete=2"); await submit(a, a.locator('[role="alertdialog"] button:has-text("[ DELETE FIELD ]")'));
  await l.fill('[name="cf.2"]', "2020-02-02"); await l.fill('input[name="role"]', "Saved after delete"); await submit(l, l.locator('main button:has-text("[ SAVE ]")').first());
  check("US4 scenario 5", q("select role from persons where id=41") === "Saved after delete" && /\/people\/41$/.test(l.url()) && q("select count(*) from custom_values where field_id=2") === "0",
    `role saved=${q("select role from persons where id=41")}; url ${l.url().replace(H.B, "")}; no value for the deleted field`);
  // Edge 6: delete person 40 (admin, for good) and deal 54
  await go(a, "/people/40"); await submit(a, a.getByRole("link", { name: "[ DELETE ]" })); await submit(a, a.getByRole("button", { name: "[ DELETE FOR GOOD ]" }));
  const after6 = []; for (const f of [4, M, T]) { await go(a, `/admin/custom-fields?kind=people&delete=${f}`); after6.push(((await a.locator('[role="alertdialog"]').innerText()).match(/\d+ (people|person)/) || ["?"])[0]); }
  await go(a, "/admin/custom-fields?kind=deals&delete=8"); const d8a = (await a.locator('[role="alertdialog"]').innerText()).match(/\d+ deals?/)?.[0];
  await go(a, "/deals/54"); await submit(a, a.getByRole("link", { name: "[ DELETE ]" })); await submit(a, a.getByRole("button", { name: /DELETE FOR GOOD/ }));
  await go(a, "/admin/custom-fields?kind=deals&delete=8"); const d8b = (await a.locator('[role="alertdialog"]').innerText()).match(/\d+ deals?/)?.[0];
  check("Edge case 6", q("select count(*) from custom_values where person_id=40") === "0" && q("select count(*) from persons where id=40") === "0" && after6.join() === [before6[0], before6[1], before6[3]].map((s) => s.replace(/\d+/, (n) => n - 1)).join().replace(/\b1 people/g, "1 person") && q("select count(*) from deals where id=54") === "0" && d8b === "1 deal" && d8a === "2 deals",
    `person 40 deleted; counts before ${JSON.stringify(before6)} after ${JSON.stringify(after6)}; deal Contract end count ${d8a} → ${d8b}`);
  // US6-3: Grace on Linus's private 37
  await go(g, "/people/37"); const r1 = await main(g); await go(g, "/people/37/edit"); const r2 = await main(g);
  await go(g, "/people/38/edit"); const tv = q(`select text_value from custom_values where person_id=37 and field_id=${T}`);
  await g.locator('form:has(button:has-text("[ SAVE ]"))').evaluate((f, T) => { f.querySelector('[name="id"]').value = "37"; const i = f.querySelector(`[name="cf.${T}"]`); i.value = "HACKED"; }, T);
  await submit(g, g.locator('main button:has-text("[ SAVE ]")').first()); const r3 = await main(g);
  await go(g, "/deals/57"); const r4 = await main(g); await go(g, "/deals?open=57"); const r5 = await main(g);
  const nf = (t) => /doesn't exist or you can't see it|Page not found/.test(t);
  check("US6 scenario 3", nf(r1) && nf(r2) && nf(r3) && nf(r4) && q(`select text_value from custom_values where person_id=37 and field_id=${T}`) === tv && !r5.includes("Fake referral · audit") && !r1.includes("hello private"),
    `GET /people/37: ${JSON.stringify(r1.slice(0, 60))}; edit: ${JSON.stringify(r2.slice(0, 40))}; forged save (id=37, Ftext=HACKED): ${JSON.stringify((r3.match(/[^\n]*(doesn't exist|can't see)[^\n]*/) || [r3.slice(0, 60)])[0])}, value still ${tv}; /deals/57: ${JSON.stringify(r4.slice(0, 40))}; drawer not shown`);
  await b.close();
})();
