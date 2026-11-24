// SF-115 US2 + edges 3, 5, 8, 9, 11, 12 (spec numbering after fix round 1). Run after reset-db.sh.
const H = require("./sf115-lib.js"); const { check, q, go, submit, main, addField, fieldId, more } = H;
const save = (p) => submit(p, p.locator('main button:has-text("[ SAVE ]")').first());
const tl = async (p) => { const t = await main(p); return t.slice(t.indexOf("// TIMELINE")); };
const ncustom = (pid) => q(`select count(*) from timeline_events where person_id=${pid} and kind like 'custom_%'`);
(async () => {
  const b = await H.chromium.launch(); const p = await H.newPage(b, "ada@barnacle.ai", "Ada Fake");
  await addField(p, "people", "Fake text", "text", null, true);
  await addField(p, "people", "Fake money", "money", null, true);
  await addField(p, "people", "Fake flag", "yes_no", null, true);
  const id = { diet: fieldId("person", "Diet (fake)"), bday: fieldId("person", "Birthday (fake)"), topics: fieldId("person", "Newsletter topics (fake)"),
    head: fieldId("person", "Head count met (fake)"), notes: fieldId("person", "Notes (fake)"), text: fieldId("person", "Fake text"), money: fieldId("person", "Fake money"), flag: fieldId("person", "Fake flag") };
  // US2-1
  const shapes = {};
  for (const u of ["/people/new", "/people/41/edit"]) {
    await go(p, u); const t = await main(p);
    const sh = await p.locator('[name^="cf."]').evaluateAll((es) => { const o = {}; for (const e of es) { const k = e.name; o[k] = o[k] || (e.tagName.toLowerCase() + ":" + (e.type || "") + (e.tagName === "SELECT" ? ":" + [...e.options].map((x) => x.text).join("/") : "")); } return o; });
    const ordered = Object.keys(sh).join(",");
    const builtInBefore = t.indexOf("// MORE DETAILS") > t.indexOf("OWNER") || t.indexOf("// MORE DETAILS") > t.toUpperCase().indexOf("CONSENT");
    shapes[u] = { ordered, sh, builtInBefore, heading: t.includes("// MORE DETAILS") };
  }
  const s = shapes["/people/new"].sh;
  const ok1shape = s["cf." + id.text] === "input:text" && s["cf." + id.notes].startsWith("textarea") && s["cf." + id.head] === "input:text" && s["cf." + id.money].startsWith("input:text")
    && s["cf." + id.bday] === "input:date" && s["cf." + id.diet] === "select:select-one:/None/Vegetarian/Vegan" && s["cf." + id.topics] === "input:checkbox" && s["cf." + id.flag] === "select:select-one:/Yes/No";
  // optional: create a person with no custom values
  await go(p, "/people/new"); await p.fill('input[name="firstName"]', "Opt"); await p.fill('input[name="lastName"]', "Fakeperson"); await save(p);
  const created = /\/people\/\d+$/.test(p.url());
  const expOrder = Object.entries(id).sort((a, b2) => +q(`select position from custom_fields where id=${a[1]}`) - +q(`select position from custom_fields where id=${b2[1]}`)).map((e) => "cf." + e[1]).join(",");
  check("US2 scenario 1", ok1shape && shapes["/people/new"].ordered === expOrder && shapes["/people/41/edit"].ordered === expOrder && shapes["/people/new"].heading && shapes["/people/new"].builtInBefore && created,
    `inputs ${JSON.stringify(s)}; order ok=${shapes["/people/new"].ordered === expOrder}; heading after built-ins; saved a new person with all custom fields empty → ${p.url()}`);
  // US2-2 invalid values on person 41
  const role0 = q("select coalesce(role,'') from persons where id=41"); const v0 = q("select count(*) from custom_values where person_id=41");
  const bad = { text: "x".repeat(256), notes: "y".repeat(10001), head: "abc", money: "-5", bday: "2026-02-30" };
  await go(p, "/people/41/edit");
  await p.fill('input[name="role"]', "Changed role");
  await p.fill(`[name="cf.${id.text}"]`, bad.text); await p.fill(`[name="cf.${id.notes}"]`, bad.notes); await p.fill(`[name="cf.${id.head}"]`, bad.head); await p.fill(`[name="cf.${id.money}"]`, bad.money);
  await p.locator(`[name="cf.${id.bday}"]`).evaluate((e, v) => { e.type = "text"; e.value = v; }, bad.bday);
  await p.locator(`[name="cf.${id.diet}"]`).evaluate((e) => { const o = document.createElement("option"); o.value = "4"; o.text = "Pescatarian"; e.add(o); e.value = "4"; });
  await save(p); const t2 = await main(p);
  const want = ["Fake text: at most 255 characters.", "Notes (fake): at most 10,000 characters.", "Head count met (fake): enter a number.", "Fake money: enter an amount in pounds", "Birthday (fake): enter a real date.", "Diet (fake): choose one of the choices."];
  const kept = (await p.inputValue(`[name="cf.${id.head}"]`)) === "abc" && (await p.inputValue(`[name="cf.${id.money}"]`)) === "-5" && (await p.inputValue('input[name="role"]')) === "Changed role";
  const miss = want.filter((w) => !t2.includes(w));
  // decimals and range
  await p.fill(`[name="cf.${id.head}"]`, "1.23456"); await p.fill(`[name="cf.${id.text}"]`, ""); await p.fill(`[name="cf.${id.notes}"]`, ""); await p.fill(`[name="cf.${id.money}"]`, "");
  await p.locator(`[name="cf.${id.bday}"]`).evaluate((e) => { e.value = ""; }); await p.locator(`[name="cf.${id.diet}"]`).selectOption("");
  await save(p); const t2b = await main(p);
  await p.fill(`[name="cf.${id.head}"]`, "2000000000000"); await save(p); const t2c = await main(p);
  await p.fill(`[name="cf.${id.head}"]`, ""); await p.fill(`[name="cf.${id.money}"]`, "12.345"); await save(p); const t2d = await main(p);
  const nothing = q("select coalesce(role,'') from persons where id=41") === role0 && q("select count(*) from custom_values where person_id=41") === v0;
  check("US2 scenario 2", !miss.length && kept && nothing && t2b.includes("Head count met (fake): at most 4 decimal places.") && t2c.includes("Head count met (fake): enter a number between") && t2d.includes("Fake money: enter an amount"),
    `missing messages ${JSON.stringify(miss)}; typed values kept=${kept}; decimals msg=${t2b.includes("at most 4 decimal places")}; range msg=${t2c.includes("enter a number between")}; money 12.345 refused=${t2d.includes("Fake money: enter an amount")}; nothing saved=${nothing}`);
  // US2-3 + US2-4 (set)
  const ev0 = ncustom(41);
  await go(p, "/people/41/edit");
  await p.fill(`[name="cf.${id.text}"]`, "Hello fake"); await p.fill(`[name="cf.${id.notes}"]`, "Line one\nLine two"); await p.fill(`[name="cf.${id.head}"]`, "1234.5");
  await p.fill(`[name="cf.${id.money}"]`, "1234.5"); await p.fill(`[name="cf.${id.bday}"]`, "2026-11-24"); await p.locator(`[name="cf.${id.diet}"]`).selectOption({ label: "Vegan" });
  await p.check(`[name="cf.${id.topics}"][value="${q(`select id from custom_field_choices where field_id=${id.topics} and name='Hiring'`)}"]`);
  await p.check(`[name="cf.${id.topics}"][value="${q(`select id from custom_field_choices where field_id=${id.topics} and name='AI'`)}"]`);
  await p.locator(`[name="cf.${id.flag}"]`).selectOption({ label: "Yes" });
  await save(p); const m3 = await more(p);
  const pre = await p.locator("main dd", { hasText: "Line one" }).evaluate((e) => getComputedStyle(e).whiteSpace + "|" + e.innerText);
  const exp3 = [/Fake text\s+Hello fake/i, /Fake money\s+£1,234\.50/i, /Birthday \(fake\)\s+24 Nov 2026/i, /Newsletter topics \(fake\)\s+AI, Hiring/i, /Fake flag\s+Yes/i, /Diet \(fake\)\s+Vegan/i, /Head count met \(fake\)\s+1,?234\.5/i];
  const miss3 = exp3.filter((r) => !r.test(m3)).map(String);
  // whole money, empty field shown —
  await go(p, "/people/41/edit"); await p.fill(`[name="cf.${id.money}"]`, "1000"); await p.fill(`[name="cf.${id.text}"]`, ""); await save(p); const m3b = await more(p);
  // drawer and deal page
  await go(p, "/deals?open=54"); const dr = await main(p); await go(p, "/deals/54"); const dp = await more(p);
  check("US2 scenario 3", !miss3.length && pre.startsWith("pre-wrap|Line one\nLine two") && /Fake money\s+£1,000\s/i.test(m3b) && /Fake text\s+—/i.test(m3b) && dr.includes("// MORE DETAILS") && /Contract end \(fake\)\s+31 Mar 2027/i.test(dp) && /Signed NDA \(fake\)\s+Yes/i.test(dp) && m3.toLowerCase().indexOf("newsletter") > -1,
    `missing ${JSON.stringify(miss3)}; long text ${JSON.stringify(pre)}; £1,000 whole=${/£1,000\s/.test(m3b)}; empty —=${/Fake text\s+—/i.test(m3b)}; drawer has MORE DETAILS=${dr.includes("// MORE DETAILS")}; deal page ${JSON.stringify(dp.replace(/\s+/g, " "))}; (no-field kind checked at the end)`);
  // US2-4 change / clear / long text
  await go(p, "/people/41/edit"); await p.locator(`[name="cf.${id.diet}"]`).selectOption({ label: "Vegetarian" }); await p.fill(`[name="cf.${id.bday}"]`, "");
  await p.fill(`[name="cf.${id.notes}"]`, "Line three"); await save(p); const t4 = await tl(p);
  const exp4 = ["Fake text set to Hello fake", "Diet (fake) set to Vegan", "Diet (fake) changed from Vegan to Vegetarian", "Birthday (fake) cleared", "Notes (fake) changed", "Fake money changed from £1,234.50 to £1,000", "Fake text cleared", "Newsletter topics (fake) set to AI, Hiring", "Fake flag set to Yes"];
  const miss4 = exp4.filter((x) => !t4.includes(x));
  const notesLeak = t4.includes("Line one") || t4.includes("Line three");
  const look = await p.locator("main li, main div", { hasText: /^CHANGE\s*Diet \(fake\) changed from Vegan to Vegetarian/ }).count();
  check("US2 scenario 4", !miss4.length && !notesLeak && /CHANGE\s*Diet \(fake\) changed from Vegan to Vegetarian\s*by Ada Fake\s*\d\d:\d\d/.test(t4),
    `missing ${JSON.stringify(miss4)}; long text value not shown=${!notesLeak}; entry reads "${(t4.match(/CHANGE\s*Diet \(fake\) changed[^\n]*\n?[^\n]*/) || [""])[0].replace(/\s+/g, " ")}"`);
  // US2-5
  const ev5 = ncustom(41); await go(p, "/people/41/edit"); await p.fill('input[name="role"]', "Role only"); await save(p);
  check("US2 scenario 5", ncustom(41) === ev5 && q("select role from persons where id=41") === "Role only", `custom timeline events ${ev5}→${ncustom(41)} after a save changing only the role`);
  // US2-6 removed choice Pescatarian on person 39
  await go(p, "/people/39/edit"); const o6a = await p.locator(`[name="cf.${id.diet}"] option`).allInnerTexts(); await p.fill('input[name="role"]', "Kept choice"); await save(p);
  const kept6 = q(`select c.name from custom_values v join custom_field_choices c on c.id=v.choice_id where v.person_id=39 and v.field_id=${id.diet}`);
  await go(p, "/people/39/edit"); await p.locator(`[name="cf.${id.diet}"]`).selectOption({ label: "Vegan" }); await save(p);
  await go(p, "/people/39/edit"); const o6b = await p.locator(`[name="cf.${id.diet}"] option`).allInnerTexts();
  check("US2 scenario 6", o6a.includes("Pescatarian") && kept6 === "Pescatarian" && !o6b.includes("Pescatarian"), `form options before ${JSON.stringify(o6a)}; after untouched save value=${kept6}; after change options ${JSON.stringify(o6b)}`);
  // Edge 8: multiple choice all ticks removed
  await go(p, "/people/41/edit"); for (const c of await p.locator(`[name="cf.${id.topics}"]`).all()) await c.uncheck(); await save(p);
  const t8 = await tl(p); const v8 = q(`select count(*) from custom_values where person_id=41 and field_id=${id.topics}`);
  check("Edge case 9", v8 === "0" && t8.includes("Newsletter topics (fake) cleared") && /Newsletter topics \(fake\)\s+—/i.test(await more(p)), `value rows ${v8}; timeline has 'Newsletter topics (fake) cleared'=${t8.includes("Newsletter topics (fake) cleared")}`);
  // US2-7: rename Diet after the changes
  await go(p, `/admin/custom-fields?kind=people&field=${id.diet}`); await p.locator('[role="dialog"] input[name="name"]').first().fill("Diet now"); await submit(p, p.locator('[role="dialog"] button:has-text("[ SAVE ]")'));
  await go(p, "/people/41"); const t7 = await tl(p);
  check("US2 scenario 7", t7.includes("Diet (fake) changed from Vegan to Vegetarian") && !t7.includes("Diet now") && /Diet now\s+Vegetarian/i.test(await more(p)), `after renaming to "Diet now": old entries say "Diet (fake) …"; page shows the new name`);
  // Edge 3: field added while the edit form is open
  await go(p, "/people/43/edit"); const a2 = await H.newPage(b, "grace@barnacle.ai", "Grace Fake");
  await addField(a2, "people", "Late field", "text", null, false);
  await p.fill(`[name="cf.${id.text}"]`, "Typed before"); await p.fill('input[name="role"]', "Edge three role"); await save(p); const m3e = await more(p);
  check("Edge case 3", /Fake text\s+Typed before/i.test(m3e) && /Late field\s+—/i.test(m3e) && (await main(p)).includes("Edge three role"), `page after save: ${JSON.stringify(m3e.replace(/\s+/g, " ").slice(0, 300))}`);
  // Edge 5: archived Fay Mockup (31)
  q(`insert into custom_values (field_id, person_id, text_value) values (${id.text}, 31, 'Archived value')`);
  await go(p, "/people/31"); const m5 = await more(p);
  await go(p, "/people/31/edit"); const editUrl = p.url(); const hasForm = await p.locator('form:has(button:has-text("[ SAVE ]"))').count(); const cfIn = await p.locator('[name^="cf."]').count();
  let refused = "no form", through = "no form";
  if (hasForm) {
    await p.locator('form:has(button:has-text("[ SAVE ]"))').evaluate((f, [fid]) => { const a = document.createElement("input"); a.type = "hidden"; a.name = "cf." + fid; a.value = "Changed!"; f.appendChild(a); const c = document.createElement("input"); c.type = "hidden"; c.name = "cfShown"; c.value = fid; f.appendChild(c); }, [id.text]);
    await save(p); refused = (await main(p)).includes("Restore this record before changing its custom fields.") + "/" + q(`select text_value from custom_values where person_id=31 and field_id=${id.text}`);
    await go(p, "/people/31/edit"); await p.fill('input[name="role"]', "Archived role"); await save(p); through = q("select role from persons where id=31");
  }
  check("Edge case 5", /Fake text\s+Archived value/i.test(m5) && cfIn === 0 && refused === "true/Archived value" && through === "Archived role",
    `page shows value=${/Fake text\s+Archived value/i.test(m5)}; edit form (${editUrl}) has ${cfIn} custom inputs; injected cf value → message/value ${refused}; role-only save → role ${through}`);
  // Edge 7: zero values
  await go(p, `/admin/custom-fields?kind=people&field=${id.head}`); await p.locator('[role="dialog"] input[name="inList"]').check(); await submit(p, p.locator('[role="dialog"] button:has-text("[ SAVE ]")'));
  const in7 = q(`select in_list from custom_fields where id=${id.head}`);
  await go(p, "/people/42/edit"); await p.fill(`[name="cf.${id.head}"]`, "0"); await p.fill(`[name="cf.${id.money}"]`, "0"); await p.locator(`[name="cf.${id.flag}"]`).selectOption({ label: "No" }); await save(p);
  const m7 = await more(p);
  const counts = []; for (const f of [id.head, id.money, id.flag]) { await go(p, `/admin/custom-fields?kind=people&delete=${f}`); counts.push(q(`select count(*) from custom_values where field_id=${f}`) + ":" + ((await main(p)).match(/\d+ (people|person)/) || ["?"])[0]); }
  const f7 = [];
  for (const qs of [`cf${id.head}_from=0&cf${id.head}_to=0`, `cf${id.money}_from=0&cf${id.money}_to=0`, `cf${id.flag}=no`]) { await go(p, "/people?" + qs); f7.push(await p.locator("main table tbody tr").allInnerTexts().then((r) => r.map((x) => x.split("\t")[0]).join("|"))); }
  check("Edge case 8", /Head count met \(fake\)\s+0\s/i.test(m7) && /Fake money\s+£0\s/i.test(m7) && /Fake flag\s+No\s/i.test(m7) && f7.every((x) => x.includes("Fakeperson") === false && x.length > 0) ,
    `in_list=${in7}; page ${JSON.stringify(m7.replace(/\s+/g, " "))}; delete box counts (db:box) ${counts.join(", ")}; filters =0 / £0 / No list: ${JSON.stringify(f7)}`);
  // Edge 10: deal money field
  await addField(p, "deals", "Fake deal money", "money", null, true); const dm = fieldId("deal", "Fake deal money");
  const val0 = q("select value_pence from deals where id=54");
  await go(p, "/deals"); const board0 = await main(p); await go(p, "/deals/list"); const list0 = (await main(p)).match(/\d+ deals? ·[^\n]*/i)?.[0];
  await go(p, "/deals/54/edit"); await p.fill(`[name="cf.${dm}"]`, "99999"); await save(p);
  await go(p, "/deals"); const board1 = await main(p); await go(p, "/deals/list"); const list1 = (await main(p)).match(/\d+ deals? ·[^\n]*/i)?.[0];
  const set10 = q(`select money_pence from custom_values where deal_id=54 and field_id=${dm}`);
  const strip = (t) => t.replace(/£99,999/g, "");
  check("Edge case 11", set10 === "9999900" && q("select value_pence from deals where id=54") === val0 && (board0.match(/£[\d,.]+[km]?/g) || []).join() === (strip(board1).match(/£[\d,.]+[km]?/g) || []).join() && list0 === list1,
    `custom money set=${set10}; deal value ${val0} unchanged; board £ amounts equal=${(board0.match(/£[\d,.]+[km]?/g) || []).join() === (strip(board1).match(/£[\d,.]+[km]?/g) || []).join()}; list total "${list0}" → "${list1}"`);
  // Edge 11: hand-over (Alan's private Sam Leftfake 35, deal 52)
  q(`insert into custom_values (field_id, person_id, text_value) values (${id.text}, 35, 'Leaver value')`);
  q(`insert into custom_values (field_id, deal_id, date_value) values (${fieldId("deal", "Contract end (fake)")}, 52, '2027-05-01')`);
  await go(p, "/admin/users"); await Promise.all([p.waitForURL(/handover=/), p.locator("tr", { hasText: "alan@barnacle.ai" }).getByRole("link", { name: "[ HAND OVER ]" }).click()]); await p.waitForLoadState("networkidle");
  await p.locator("form.handover select").selectOption({ label: "Margaret Fake" });
  await submit(p, p.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }));
  const m = await H.newPage(b, "margaret@barnacle.ai", "Margaret Fake");
  await go(m, "/people/35"); const hp = await more(m); await go(m, "/deals/52"); const hd = await more(m) || "";
  check("Edge case 12", /Fake text\s+Leaver value/i.test(hp || "") && /Contract end \(fake\)\s+0?1 May 2027/i.test(hd), `Margaret's person page: ${JSON.stringify((hp || "none").replace(/\s+/g, " ").slice(0, 120))}; deal page: ${JSON.stringify(hd.replace(/\s+/g, " "))}`);
  // US2-3 last part: kind with no custom fields shows no section
  q("delete from custom_fields where kind='organisation'"); await go(p, "/organisations/3"); const o = await main(p); await go(p, "/organisations/3/edit"); const oe = await main(p);
  check("US2 scenario 3 (no fields)", !o.includes("// MORE DETAILS") && !oe.includes("// MORE DETAILS"), "organisation page and form with no organisation fields: no // MORE DETAILS");
  await b.close();
})();
