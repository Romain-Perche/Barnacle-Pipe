// SF-115 US1 + edges 1, 2, 4, 10 (admin page). Run after reset-db.sh. node scenarios-sf115-us1.js
const H = require("./sf115-lib.js"); const { check, q, go, submit, main, addField, fieldId, more } = H;
(async () => {
  const b = await H.chromium.launch(); const p = await H.newPage(b, "ada@barnacle.ai", "Ada Fake");
  // US1-1: add each of the eight types to organisations
  const types = [["text","Text"],["long_text","Long text"],["number","Number"],["money","Money (£)"],["date","Date"],["single_choice","Single choice"],["multiple_choice","Multiple choice"],["yes_no","Yes/No"]];
  let ok1 = true, n1 = [];
  for (const [t, label] of types) {
    await go(p, "/admin/custom-fields?kind=organisations");
    const before = +(await p.locator('nav[aria-label="Record kinds"] a', { hasText: "Organisations" }).innerText()).split("·")[1];
    await addField(p, "organisations", "Org " + label, t, t.includes("choice") ? "A\nB" : null, false);
    const dlg = await p.locator('[role="dialog"]').count();
    const after = +(await p.locator('nav[aria-label="Record kinds"] a', { hasText: "Organisations" }).innerText()).split("·")[1];
    const last = await p.locator("table tbody tr").last().innerText();
    const good = dlg === 0 && after === before + 1 && last.includes("Org " + label) && last.includes(label);
    if (!good) { ok1 = false; n1.push(`${t}: dlg=${dlg} ${before}->${after} last=${last.replace(/\s+/g, " ")}`); }
  }
  check("US1 scenario 1", ok1, ok1 ? "8 types added, each last row with its type, tab count +1, box closed; URL " + p.url() : n1.join("; "));
  // US1-2 / Edge 1
  const cnt = () => q("select count(*) from custom_fields");
  const c0 = cnt(); const msgs = [];
  for (const [nm, want] of [["", "Give the field a name."], ["x".repeat(61), "A field name can be at most 60 characters."], ["  diet (FAKE) ", "There is already a field called"], ["Email address", "There is already a field called Email address."], ["owner", "There is already a field called"]]) {
    await go(p, "/admin/custom-fields?kind=people&field=new");
    const d = p.locator('[role="dialog"]');
    await d.locator('input[name="name"]').evaluate((e, v) => { e.removeAttribute("maxlength"); e.value = v; }, nm);
    await submit(p, d.locator('button:has-text("[ SAVE ]")'));
    const t = await main(p); msgs.push(`${JSON.stringify(nm.slice(0,15))}→${t.includes(want) ? "ok" : "MISSING " + want} (${(t.match(/There is already a field called[^\n]*/)||[""])[0]})`);
  }
  const ok2 = cnt() === c0 && msgs.every((m) => m.includes("→ok"));
  check("US1 scenario 2", ok2, msgs.join("; ") + `; fields ${c0}→${cnt()}`);
  check("Edge case 1", ok2, "built-in 'Email address' and 'owner', custom '  diet (FAKE) ' all refused with There is already a field called …; nothing added");
  // US1-3
  const r3 = [];
  for (const [t, ch, want] of [["single_choice", "", "Add at least one choice."], ["multiple_choice", "", "Add at least one choice."], ["single_choice", "Red\nred", "Two choices have the same name."], ["multiple_choice", "y".repeat(61), "A choice name can be at most 60 characters."]]) {
    await addField(p, "people", "Choicey", t, ch, false);
    const t2 = await main(p); r3.push(`${t}/${JSON.stringify(ch.slice(0,8))}: ${t2.includes(want) ? "ok" : "missing " + want}`);
  }
  const ok3 = cnt() === c0 && r3.every((x) => x.endsWith("ok"));
  check("US1 scenario 3", ok3, r3.join("; ") + `; nothing added: ${cnt() === c0}`);
  // US1-4 rename (other places checked in the records script); name rules
  const dietId = fieldId("person", "Diet (fake)");
  await go(p, `/admin/custom-fields?kind=people&field=${dietId}`);
  await p.locator('[role="dialog"] input[name="name"]').first().fill("Birthday (fake)");
  await submit(p, p.locator('[role="dialog"] button:has-text("[ SAVE ]")'));
  const dup = (await main(p)).includes("There is already a field called Birthday (fake).");
  await go(p, `/admin/custom-fields?kind=people&field=${dietId}`);
  await p.locator('[role="dialog"] input[name="name"]').first().fill("Diet");
  await submit(p, p.locator('[role="dialog"] button:has-text("[ SAVE ]")'));
  const renamed = q(`select name from custom_fields where id=${dietId}`);
  const pages = {};
  await go(p, "/people/36"); const m4 = await more(p); pages.page = /Diet\s+Vegan/i.test(m4) && !/Diet \(fake\)/i.test(m4);
  await go(p, "/people/36/edit"); pages.form = (await p.locator('select[name="cf.' + dietId + '"]').evaluate((e) => e.parentElement.innerText)).toLowerCase().startsWith("diet\n");
  await go(p, "/people"); const head = await p.locator("table thead").innerText(); pages.column = /\bDiet\b/i.test(head) && !/Diet \(fake\)/i.test(head);
  pages.filter = (await p.locator('select[name="cf' + dietId + '"] option').first().innerText()).includes("Diet");
  await go(p, "/people/import"); pages.importPage = true;
  check("US1 scenario 4", dup && renamed === "Diet" && pages.page && pages.form && pages.column && pages.filter,
    `dup refused=${dup}; renamed=${renamed}; page=${pages.page} form=${pages.form} column=${pages.column} filter=${pages.filter} (import mapping checked in the import script)`);
  // US1-5: move Newsletter topics (3) up above Birthday(2)? order is Diet,Birthday,Newsletter,Head,Notes
  const nl = fieldId("person", "Newsletter topics (fake)");
  await go(p, "/admin/custom-fields?kind=people");
  await submit(p, p.locator('button[aria-label="Move Newsletter topics (fake) up"]'));
  await submit(p, p.locator('button[aria-label="Move Newsletter topics (fake) up"]'));
  const order = q("select string_agg(name, ',' order by position) from custom_fields where kind='person'");
  await go(p, "/people/36"); const md = (await more(p)).toLowerCase();
  const pageOrder = md.indexOf("newsletter") < md.indexOf("diet") && md.indexOf("diet") < md.indexOf("birthday");
  await go(p, "/people/36/edit"); const names = await p.locator('[name^="cf."]').evaluateAll((es) => [...new Set(es.map((e) => e.name))]);
  const formOrder = names[0] === "cf." + nl && names[1] === "cf." + dietId;
  await go(p, "/people/new"); const names2 = await p.locator('[name^="cf."]').evaluateAll((es) => [...new Set(es.map((e) => e.name))]);
  await go(p, "/people"); const h2 = (await p.locator("table thead").innerText()).toLowerCase(); const colOrder = h2.indexOf("newsletter") < h2.indexOf("diet");
  const fnames = await p.locator('[name^="cf"]').evaluateAll((es) => es.map((e) => e.name));
  const filtOrder = fnames.indexOf("cf" + nl) < fnames.indexOf("cf" + dietId);
  check("US1 scenario 5", order.startsWith("Newsletter topics (fake),Diet,Birthday") && pageOrder && formOrder && names2[0] === "cf." + nl && colOrder && filtOrder,
    `order=${order}; page=${pageOrder} edit=${formOrder} add=${names2[0] === "cf." + nl} columns=${colOrder} filters=${filtOrder}`);
  q(`insert into custom_values (field_id, person_id, choice_id) select ${dietId}, 38, id from custom_field_choices where field_id=${dietId} and name='Vegetarian'`);
  // US1-6: choices of Diet: rename Vegan→Plant based, move Vegan up, remove Vegetarian (person 37 has it)
  await go(p, `/admin/custom-fields?kind=people&field=${dietId}`);
  await p.locator('input[aria-label="Name of Vegan"]').fill("Plant based");
  await submit(p, p.locator('button[aria-label="Rename Vegan"]'));
  const stillBox = await p.locator('[role="dialog"]').count();
  await submit(p, p.locator('button[aria-label="Move Plant based up"]'));
  await submit(p, p.locator('button[aria-label="Remove Vegetarian"]'));
  await go(p, "/people/36"); const r36 = (await more(p)).includes("Plant based");
  await go(p, "/people/38"); const r37 = (await more(p)).includes("Vegetarian");
  await go(p, "/people/41/edit"); const opts = await p.locator(`select[name="cf.${dietId}"] option`).allInnerTexts();
  await go(p, "/people/38/edit"); const opts37 = await p.locator(`select[name="cf.${dietId}"] option`).allInnerTexts();
  await go(p, "/people"); const fopts = await p.locator(`select[name="cf${dietId}"] option`).allInnerTexts();
  const ok6 = r36 && r37 && opts.join(",") === ",None,Plant based" && fopts.includes("Vegetarian") && fopts.indexOf("Plant based") < fopts.indexOf("None") + 2;
  check("US1 scenario 6", ok6 && stillBox === 1, `box stays open after rename=${stillBox === 1}; renamed shown on person 36=${r36}; removed kept on 38=${r37}; edit form options (41)=${JSON.stringify(opts)}; 38's own form=${JSON.stringify(opts37)}; list filter=${JSON.stringify(fopts)}`);
  // Edge 2: rename choice to another's name; remove last offered choice
  await go(p, `/admin/custom-fields?kind=people&field=${dietId}`);
  await p.locator('input[aria-label="Name of None"]').fill("plant BASED");
  await submit(p, p.locator('button[aria-label="Rename None"]'));
  const e2a = (await main(p)); const refusedA = q(`select count(*) from custom_field_choices where field_id=${dietId} and name='None'`) === "1";
  const ofid = fieldId("organisation", "Org Single choice");
  await go(p, `/admin/custom-fields?kind=organisations&field=${ofid}`);
  await submit(p, p.locator('button[aria-label="Remove A"]'));
  await submit(p, p.locator('button[aria-label="Remove B"]'));
  const e2b = await main(p); const left = q(`select count(*) from custom_field_choices where field_id=${ofid} and removed_at is null`);
  check("Edge case 2", refusedA && e2b.includes("A choice field needs at least one choice.") && left === "1",
    `rename to other's name refused=${refusedA} msg="${(e2a.match(/There is already a choice[^\n]*/)||["none"])[0]}"; last-choice message shown=${e2b.includes("A choice field needs at least one choice.")}, offered left=${left}`);
  // US1-7
  await go(p, `/admin/custom-fields?kind=people&field=${dietId}`);
  const d7 = p.locator('[role="dialog"]');
  check("US1 scenario 7", (await d7.innerText()).includes("Single choice (can't be changed)") && (await d7.locator('[name="type"]').count()) === 0, "edit box shows 'Single choice (can't be changed)', no type input");
  // Edge 4: two admins rename from pages opened at the same time
  const g = await H.newPage(b, "grace@barnacle.ai", "Grace Fake");
  const bid = fieldId("person", "Birthday (fake)");
  await go(p, `/admin/custom-fields?kind=people&field=${bid}`); await go(g, `/admin/custom-fields?kind=people&field=${bid}`);
  await p.locator('[role="dialog"] input[name="name"]').first().fill("Born on"); await submit(p, p.locator('[role="dialog"] button:has-text("[ SAVE ]")'));
  await g.locator('[role="dialog"] input[name="name"]').first().fill("Birth date"); await submit(g, g.locator('[role="dialog"] button:has-text("[ SAVE ]")'));
  await go(p, "/admin/custom-fields?kind=people"); const rows = await p.locator("table tbody tr td:nth-child(2)").allInnerTexts();
  const pos = q("select string_agg(position::text, ',' order by position) from custom_fields where kind='person'");
  check("Edge case 4", rows.filter((r) => r === "Birth date").length === 1 && !rows.includes("Born on") && rows.length === 5 && pos === "1,2,3,4,5", `rows=${JSON.stringify(rows)} positions=${pos}`);
  // US1-8 non-admin
  const l = await H.newPage(b, "linus@barnacle.ai", "Linus Fake");
  await go(l, "/admin/users"); const t8u = await main(l); await go(l, "/admin/custom-fields"); const t8 = await main(l);
  const side = await l.locator("nav").first().innerText();
  // replay an admin action id as Linus: take the delete form of Ada's page
  await go(p, `/admin/custom-fields?kind=people&delete=${bid}`);
  const html = await p.content(); const aid = (html.match(/name="\$ACTION_ID_([0-9a-f]+)"/g) || []).map((s) => s.match(/_([0-9a-f]+)"/)[1]);
  const before8 = q("select count(*) from custom_fields");
  for (const id of aid) {
    await l.evaluate(async ([id, fid]) => { const f = new FormData(); f.append("$ACTION_ID_" + id, ""); f.append("id", fid); f.append("kind", "people"); f.append("dir", "up"); f.append("name", "Hacked");
      await fetch("/admin/custom-fields?kind=people", { method: "POST", body: f, headers: { "Next-Action": id } }).catch(() => {}); }, [id, bid]);
  }
  const after8 = q("select count(*) from custom_fields"); const nm8 = q(`select name from custom_fields where id=${bid}`);
  check("US1 scenario 8", !side.includes("Custom fields") && t8 === t8u && before8 === after8 && nm8 === "Birth date",
    `sidebar has no Custom fields; page says "${t8.split("\n").slice(0, 3).join(" / ")}"; replayed ${aid.length} admin actions as Linus: fields ${before8}→${after8}, name ${nm8}`);
  // Edge 9: markup in field name, choice and value
  await addField(p, "people", "<b>Fake</b> field", "single_choice", "<i>Choice</i>", true);
  const mid = fieldId("person", "<b>Fake</b> field"); const cid = q(`select id from custom_field_choices where field_id=${mid}`);
  await addField(p, "people", "Markup text", "text", null, true); const tid = fieldId("person", "Markup text");
  q(`insert into custom_values (field_id, person_id, choice_id) values (${mid}, 42, ${cid}); insert into custom_values (field_id, person_id, text_value) values (${tid}, 42, '<b>Fake</b>')`);
  const spots = [];
  for (const u of ["/admin/custom-fields?kind=people", `/admin/custom-fields?kind=people&field=${mid}`, "/people/42", "/people/42/edit", "/people"]) {
    await go(p, u); const t = await main(p); const h = await p.content();
    const vals = u.includes("edit") ? (await p.locator("input,option").evaluateAll((es) => es.map((e) => e.value + "|" + e.textContent).join(" "))) : "";
    spots.push(`${u}: text=${(t.includes("<b>Fake</b>") || u.includes("edit")) && (u.includes("field=") || t.includes("<i>Choice</i>") || vals.includes("<i>Choice</i>")) && (!u.includes("edit") || (vals.includes("|<b>Fake</b>") || vals.includes("<b>Fake</b>|")))} noTag=${!/<b>Fake<\/b>/.test(h)}`);
  }
  check("Edge case 10", spots.every((s) => !s.includes("false")), spots.join("; "));
  await b.close();
})();
