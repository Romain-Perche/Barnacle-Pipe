// SF-117 AI review, part A: US1 (connection), US2 (what is imported) and the edge cases on values (1, 3–8, 10–15, 18).
// Fresh data first: bash .factory/run/reset-db.sh, the stand-in Pipedrive reset, the app on :3001 (PIPEDRIVE_URL=:9400)
// and, for Edge 18, an app on :3002 with PIPEDRIVE_TOKEN_KEY= (see test-env.md). ~3 min.
const L = require("./sf117-lib");
const { q, ctl, check, BASE } = L;
const T = "fake-pipedrive-token";
const ONLY = process.argv.slice(2);
const want = (n) => ONLY.length === 0 || ONLY.some((o) => n.startsWith(o));

(async () => {
  const browser = await L.chromium.launch();
  await ctl("reset");
  // ---- CRM data the scenarios need
  q(`insert into custom_fields (kind,name,type,position) values ('person','Budget','number',20),('person','Tier','single_choice',21),('person','Score','number',22),('person','Job title','text',23),('person','Nickname','text',24)`);
  q(`insert into custom_field_choices (field_id,name,position) select id,c,p from custom_fields, (values ('Gold',1),('Silver',2)) v(c,p) where name='Tier'`);
  const mk = (first, last, emails, extra = "") => {
    const id = q(`insert into persons (first_name,last_name,owner_id,created_by,consent,private,role) values (${first},${last},${extra || "1,1,'subscribed',false,'Old role'"}) returning id`).split("\n")[0];
    emails.forEach((e, i) => q(`insert into person_emails (person_id,email,kind,position) values (${id},'${e}','work',${i})`));
    return id;
  };
  const adaEx = mk("'Ada'", "'Example'", ["person006@fake.example"]);
  const hidden = mk("'Hidden'", "'Privfake'", ["person016@fake.example"], "3,3,'subscribed',true,'Secret role'");
  const twoA = mk("'Two'", "'Onefake'", ["person024@fake.example"]);
  const twoB = mk("'Two'", "'Twofake'", ["home024@fake.example"]);
  const unsub = mk("'Stays'", "'Unsubfake'", ["person035@fake.example"], "2,1,'unsubscribed',false,'Kept role'");
  const before = (id) => q(`select first_name,last_name,role,owner_id,consent,private,organisation_id,version from persons where id=${id}`);
  const adaExBefore = before(adaEx), unsubBefore = before(unsub), twoABefore = before(twoA);

  // ---- Pipedrive data the scenarios need (company 1001, ids 5000+)
  const C = 1001;
  await ctl("addUser", C, { id: 4, name: "Alan Pipedrive Fake", email: "ALAN@barnacle.ai" });
  await ctl("addField", C, "person", { field_code: "fake_tier", field_name: "Tier", field_type: "enum", is_custom_field: true, options: [{ id: 31, label: "Gold" }, { id: 32, label: "Silver" }, { id: 33, label: "Bronze" }, { id: 34, label: '<a href="https://evil.example">Click</a>' }] });
  await ctl("addField", C, "person", { field_code: "fake_score", field_name: "Score", field_type: "varchar", is_custom_field: true });
  await ctl("addField", C, "person", { field_code: "fake_nick", field_name: " nickname ", field_type: "varchar", is_custom_field: true });
  const cf = (o) => ({ fake_custom_field_03: null, ...o });
  await ctl("addPerson", C, { id: 5001, first_name: "Multi", last_name: "Contactfake", owner_id: 1, add_time: "2024-03-15 10:00:00", marketing_status: "subscribed",
    emails: [{ value: "home5001@fake.example", primary: false, label: "home" }, { value: "work5001@fake.example", primary: true, label: "work" }],
    phones: [{ value: "+44 20 7946 0501", primary: true, label: "work" }, { value: "07700 900501", primary: false, label: "mobile" }, { value: "01632 960501", primary: false, label: "home" }, { value: "01632 960502", primary: false, label: "fax" }] });
  await ctl("addPerson", C, { id: 5002, name: "Ada May Example", first_name: "", last_name: "", owner_id: 1, emails: [{ value: "adamay@fake.example", primary: true, label: "work" }] });
  await ctl("addPerson", C, { id: 5003, first_name: "Orgless", last_name: "Fake", owner_id: 1, org_id: 60, custom_fields: cf({ fake_tier: 31, fake_score: "12", fake_custom_field_05: "not a link" }) });
  await ctl("addPerson", C, { id: 5004, first_name: "Longrole", last_name: "Fake", owner_id: 1, custom_fields: cf({ fake_custom_field_03: "R".repeat(201) }) });
  await ctl("addPerson", C, { id: 5005, first_name: '<a href="https://evil.example">Click</a>', last_name: "Your account is locked", owner_id: 1, custom_fields: cf({ fake_tier: 34 }) });
  await ctl("addPerson", C, { id: 5006, first_name: "Alanowned", last_name: "Fake", owner_id: 4 });
  await ctl("addOrganization", C, { id: 5100, name: "old fakeco archive ", owner_id: 1 });
  await ctl("addPerson", C, { id: 5007, first_name: "Archorg", last_name: "Fake", owner_id: 1, org_id: 5100 });
  await ctl("addOrganization", C, { id: 5101, name: "Twin Org Fake", owner_id: 1 });
  await ctl("addOrganization", C, { id: 5102, name: "  TWIN org fake ", owner_id: 1 });
  await ctl("addPerson", C, { id: 5008, first_name: "Longnick", last_name: "Fake", owner_id: 1, custom_fields: cf({ fake_nick: "N".repeat(300), fake_tier: 31 }) });
  await ctl("addPerson", C, { id: 5009, first_name: "Bronze", last_name: "Fake", owner_id: 1, custom_fields: cf({ fake_tier: 33, fake_custom_field_01: 1.234567 }) });

  const ada = await L.newPage(browser, "ada@barnacle.ai", "Ada Fake");
  const linus = await L.newPage(browser, "linus@barnacle.ai", "Linus Fake");

  // ---- US1
  if (want("US1 scenario 1")) {
    await ada.goto(BASE + "/people");
    const link = ada.locator("aside a", { hasText: /^Settings$/ });
    const n = await link.count();
    if (n) await Promise.all([ada.waitForURL(/\/settings$/), link.first().click()]);
    const s = await L.section(ada);
    const pw = await ada.locator('section[aria-label="Pipedrive"] input[name="token"]').count();
    const order = await ada.evaluate(() => { const a = [...document.querySelectorAll("aside a, aside button")].map((e) => e.textContent.trim()); return a.slice(-4).join(" | "); });
    check("US1 scenario 1", n === 1 && s.includes("// PIPEDRIVE") && pw === 1 && s.includes("Personal preferences → API") && s.includes("[ SAVE TOKEN ]"), `sidebar link=${n}; sidebar end: ${order}; section: ${s}`);
  }
  if (want("Edge case 1")) {
    const s1 = await L.saveToken(ada, "   ");
    const reqs0 = (await ctl("requests")).length;
    const s2 = await L.saveToken(ada, "x".repeat(201));
    const reqs1 = (await ctl("requests")).length;
    const s3 = await L.saveToken(ada, "   " + T + "  ");
    check("Edge case 1", s1.includes("Paste your Pipedrive API token.") && s2.includes("Pipedrive did not accept this token") && reqs1 === reqs0 && s3.includes("Connected to Pipedrive as Fake Person"),
      `empty: ${s1.slice(0, 90)} | 201 chars: ${s2.slice(0, 110)} (Pipedrive calls ${reqs1 - reqs0}) | spaces: ${s3.slice(0, 90)}`);
  }
  if (want("US1 scenario 2")) {
    const s = await L.saveToken(ada, T);
    const html = await ada.content();
    const raw = await (await ada.context().request.get(BASE + "/settings")).text();
    const sealed = q(`select encode(token,'escape') like '%fake-pipedrive%' from pipedrive_connections where user_id=1`);
    const leak = [html, raw].some((h) => h.includes(T) || h.includes("pipedrive-token") || h.includes("fake-pipedrive"));
    const ok = s.includes("Connected to Pipedrive as Fake Person (Fakeco Pipedrive)") && /Token saved on \d+ \w+ 20\d\d/.test(s) && ["[ REPLACE TOKEN ]", "[ REMOVE TOKEN ]", "[ IMPORT FROM PIPEDRIVE ]"].every((b) => s.includes(b)) && !leak && sealed === "f";
    check("US1 scenario 2", ok, `section: ${s}; token in page/source: ${leak}; stored in plain: ${sealed}`);
  }
  if (want("US1 scenario 3")) {
    const tokBefore = q("select encode(token,'hex'),saved_at from pipedrive_connections where user_id=1");
    const s = await L.saveToken(ada, "wrong-fake-token");
    const tokAfter = q("select encode(token,'hex'),saved_at from pipedrive_connections where user_id=1");
    check("US1 scenario 3", s.includes("Pipedrive did not accept this token. Copy it again from Pipedrive and try again.") && tokBefore === tokAfter && s.includes("Connected to Pipedrive as Fake Person"), `section: ${s.slice(0, 200)}; earlier token kept: ${tokBefore === tokAfter}`);
  }
  if (want("US1 scenario 4")) {
    await ctl("down", true);
    const s = await L.saveToken(linus, T);
    await ctl("down", false);
    const n = q("select count(*) from pipedrive_connections where user_id=3");
    check("US1 scenario 4", s.includes("Pipedrive can't be reached right now. Try again in a minute.") && n === "0", `Linus, Pipedrive down: ${s.slice(0, 160)}; rows saved: ${n}`);
  }
  if (want("US1 scenario 6")) {
    const s = await L.saveToken(linus, "fake-pipedrive-other");
    const a = await L.section(ada);
    await ada.goto(BASE + "/settings"); const a2 = await L.section(ada);
    const adminPages = []; for (const p of ["/admin/users", "/settings?user=3"]) { await ada.goto(BASE + p); adminPages.push((await ada.content()).includes("Otherco")); }
    check("US1 scenario 6", s.includes("Connected to Pipedrive as Other Person Fake (Otherco Pipedrive)") && a2.includes("Fakeco Pipedrive") && !a2.includes("Otherco") && !adminPages.some(Boolean),
      `Linus: ${s.slice(0, 120)} | Ada (admin): ${a2.slice(0, 120)} | Otherco on Ada's admin pages: ${adminPages}`);
  }
  if (want("US1 scenario 5")) {
    // Margaret: token, an import started, then removed → back to empty field; the import stops (paused, token gone).
    const m = await L.newPage(browser, "margaret@barnacle.ai", "Margaret Fake");
    await L.saveToken(m, T);
    await L.startImport(m, { orgs: true });
    await m.goto(BASE + "/settings?remove-token=1");
    const dlg = await m.locator('[role="alertdialog"], dialog').first().innerText().catch(() => "");
    await Promise.all([m.waitForURL(/removed=1/), m.locator('[role="alertdialog"] button, dialog button').filter({ hasText: /REMOVE/ }).first().click()]);
    const s = await L.section(m);
    const rows = q("select count(*) from pipedrive_connections where user_id=4");
    await m.goto(BASE + "/settings/pipedrive-import"); await m.waitForTimeout(3000); await m.reload(); await m.waitForTimeout(500);
    const b = await L.body(m);
    const st = q("select state||':'||coalesce(pause_reason,'') from pipedrive_imports where user_id=4");
    check("US1 scenario 5", rows === "0" && s.includes("[ SAVE TOKEN ]") && !s.includes("Connected to") && st.startsWith("paused"), `confirm: ${dlg.replace(/\s+/g, " ")}; after: ${s.slice(0, 150)}; token rows ${rows}; import ${st}; import page: ${b.slice(0, 260)}`);
    await m.goto(BASE + "/settings/pipedrive-import?stop=1");
    await m.locator('[role="alertdialog"] button, dialog button').filter({ hasText: /STOP/ }).first().click().catch(() => {});
  }

  // ---- US2 1 and 7: the choose step
  if (want("US2 scenario 1") || want("US2 scenario 7")) {
    await ada.goto(BASE + "/settings");
    await Promise.all([ada.waitForURL(/pipedrive-import/), ada.click("text=[ IMPORT FROM PIPEDRIVE ]")]);
    const b = await L.body(ada);
    const boxes = await ada.locator('main input[type="checkbox"]').evaluateAll((e) => e.map((x) => x.name + ":" + x.checked));
    const step = await L.stepNow(ada);
    const consentVisible0 = await ada.locator('input[name="consent"]').first().isVisible();
    const before = q("select count(*) from pipedrive_imports where user_id=1");
    await Promise.all([ada.waitForURL(/error=/), ada.click("text=[ IMPORT ]")]);
    const e1 = await L.body(ada);
    const after = q("select count(*) from pipedrive_imports where user_id=1");
    if (want("US2 scenario 1")) check("US2 scenario 1", ["← Settings", "// PIPEDRIVE", "Import from Pipedrive", "FAKECO PIPEDRIVE", "1 CHOOSE", "2 IMPORTING", "3 REPORT"].every((t) => b.includes(t)) && step.startsWith("1 CHOOSE") && boxes.join() === "people:false,organisations:false" && !/deals|notes|activities|files/i.test(boxes.join()) && e1.includes("Tick what to import.") && before === after,
      `step ${step}; checkboxes ${boxes}; page: ${b.slice(0, 420)}; nothing ticked → ${e1.includes("Tick what to import.")}, imports ${before}→${after}`);
    await ada.check('input[name="people"]');
    const consentVisible1 = await ada.locator('input[name="consent"]').first().isVisible();
    const checkedRadios = await ada.locator('input[name="consent"]:checked').count();
    await Promise.all([ada.waitForURL(/error=/), ada.click("text=[ IMPORT ]")]);
    const e2 = await L.body(ada);
    if (want("US2 scenario 7")) global.us27 = `consent shown before People ticked: ${consentVisible0}, after: ${consentVisible1}; pre-chosen radios: ${checkedRadios}; People without consent → "${(e2.match(/Choose the email consent[^.]*\./) || [""])[0]}"`;
    global.us27ok = !consentVisible0 && consentVisible1 && checkedRadios === 0 && e2.includes("Choose the email consent");
  }

  // ---- the main import: Ada, People + Organisations, consent Subscribed for people with no status
  await L.startImport(ada, { people: true, orgs: true, consent: "subscribed" });
  const t0 = Date.now();
  const s2 = await L.stepNow(ada);
  const ok = await L.waitReport(ada);
  console.log(`main import: step after start ${s2}; report reached ${ok} in ${Math.round((Date.now() - t0) / 1000)} s`);
  const rep = await L.body(ada);
  console.log("REPORT: " + rep.slice(0, 6000));
  const has = (t) => rep.includes(t);
  const P = (n) => L.pid(n >= 5000 ? n : n + 60), O = (n) => L.oid(n);
  const person = (id) => q(`select first_name||'/'||last_name||'/'||coalesce(role,'')||'/'||coalesce(linkedin_url,'')||'/'||coalesce((select name from lead_sources where id=lead_source_id),'')||'/'||owner_id||'/'||consent||'/'||private||'/'||created_by||'/'||coalesce(organisation_id::text,'')||'/'||to_char(created_at,'YYYY-MM-DD') from persons where id=${id}`);
  const page = async (path) => { await ada.goto(BASE + path); return L.body(ada); };

  if (want("US2 scenario 2")) {
    const id = P(5001);
    const em = q(`select email||':'||kind from person_emails where person_id=${id} order by position`).replace(/\n/g, ", ");
    const ph = q(`select phone||':'||kind from person_phones where person_id=${id} order by position`).replace(/\n/g, ", ");
    const b = await page(`/people/${id}`);
    check("US2 scenario 2", em === "work5001@fake.example:work, home5001@fake.example:personal" && /:work, .*:personal, .*:personal, .*:other$/.test(ph), `emails ${em}; phones ${ph}; page has both emails: ${b.includes("work5001@") && b.includes("home5001@")}`);
  }
  if (want("US2 scenario 3")) {
    const a = person(P(5002)), b = person(P(1));
    check("US2 scenario 3", a.startsWith("Ada/May Example/") && b.startsWith("Person001/Fake/"), `full name only: ${a}; first+last: ${b}`);
  }
  if (want("US2 scenario 4")) {
    const fakeco = q("select id from organisations where name='Fakeco Ltd'");
    const p1 = person(P(1)), p2 = person(P(2));
    global.us24 = `person 1 org ${p1.split("/")[9]} (Fakeco Ltd ${fakeco}); person 2 org ${p2.split("/")[9]} (PD org 2 → ${O(2)})`;
    global.us24ok = p1.split("/")[9] === fakeco && p2.split("/")[9] === O(2);
  }
  if (want("US2 scenario 5")) {
    const p = person(P(36));
    const b = await page(`/people/${P(36)}`);
    const line = (rep.match(/Lead source not on the list: 'Webinar' \(\d+ people\)/) || [""])[0];
    const webinar = q("select count(*) from persons p join pipedrive_links l on l.person_id=p.id and l.how='imported' where l.pipedrive_id % 10 = 0 and l.pipedrive_id between 61 and 360");
    check("US2 scenario 5", p.startsWith("Person036/Fake/Fake Director/https://www.linkedin.com/in/person036-fake/Referral/") && b.includes("Fake Director") && b.includes("Referral") && line !== "", `person 36: ${p}; report: "${line}" (imported people with Webinar ${webinar})`);
  }
  if (want("US2 scenario 6")) {
    const l5 = q(`select string_agg(l.name, ',') from person_labels pl join labels l on l.id=pl.label_id where person_id=${P(5)}`);
    const l7 = q(`select count(*) from person_labels where person_id=${P(7)}`);
    const lab = q("select string_agg(name, ',' order by name) from labels");
    const line = (rep.match(/[^.]*'Cold'[^)]*\)/) || [""])[0];
    check("US2 scenario 6", l5 === "Hot" && l7 === "0" && lab === "Hot,Investor,Partner" && line !== "", `person 5 labels ${l5}; person 7 (Cold) labels ${l7}; labels list ${lab}; report: "${line}"`);
  }
  if (want("US2 scenario 7")) {
    const c = (n) => q(`select consent from persons where id=${P(n)}`);
    const r = { unsub: c(36), sub: c(5), noConsent: c(2), archived: c(3), notSet: c(4) };
    check("US2 scenario 7", global.us27ok && r.unsub === "unsubscribed" && r.sub === "subscribed" && r.noConsent === "subscribed" && r.archived === "subscribed" && r.notSet === "subscribed", `${global.us27}; chose Subscribed: ${JSON.stringify(r)}`);
  }
  if (want("US2 scenario 8")) {
    const o10 = person(P(10)).split("/")[5], o22 = person(P(22)).split("/")[5], o5006 = person(P(5006)).split("/")[5];
    const lines = rep.match(/Owner [^)]*\)[^.]*records? given to you\./g) || [];
    check("US2 scenario 8", o10 === "4" && o22 === "1" && o5006 === "1" && lines.some((l) => /^Owner '?Jane Fake'? \(jane@fake.example\) has no CRM user: \d+ records given to you\.$/.test(l)) && lines.some((l) => /alan@barnacle.ai/i.test(l)), `person 10 (Margaret) owner ${o10}; 22 (Jane) owner ${o22}; 5006 (deactivated Alan) owner ${o5006}; lines: ${lines.join(" | ")}`);
  }
  if (want("US2 scenario 9")) {
    const p13 = person(P(13)), p65 = person(P(65)), p143 = person(P(143)), p1 = person(P(1));
    const b = await page("/people?q=Person065");
    const b2 = await page("/people?q=Person013");
    const priv = (rep.match(/\d+ private (people|person) of other owners imported\./) || [""])[0];
    const ownerOnly = (rep.match(/\d+ owner-only organisations? imported as shared\./) || [""])[0];
    const orgPriv = q(`select count(*) from organisations o join pipedrive_links l on l.organisation_id=o.id where l.pipedrive_id in (10,20,30)`);
    const named = rep.includes("Person065");
    check("US2 scenario 9", p13.split("/").slice(5, 9).join("/") === "1/subscribed/true/1".replace("subscribed", p13.split("/")[6]) && p65.split("/")[7] === "true" && p65.split("/")[8] === "4" && p65.split("/")[5] === "4" && p143.split("/")[5] === "1" && p143.split("/")[8] === "1" && p143.split("/")[7] === "true" && p1.split("/")[7] === "false" && !b.includes("Person065") && b2.includes("Person013") && priv !== "" && ownerOnly !== "" && !named,
      `13 (Ada's, owner only): ${p13}; 65 (Margaret's): ${p65}; 143 (Jane's): ${p143}; 1 (shared): private=${p1.split("/")[7]}; Ada finds Person065: ${b.includes("Person065")}; report: "${priv}" "${ownerOnly}"; orgs (owner only 10,20,30) in CRM: ${orgPriv}`);
  }
  if (want("US2 scenario 10")) {
    const o = (n) => q(`select name||'|'||coalesce(website,'')||'|'||coalesce(sector,'')||'|'||coalesce(size,'')||'|'||coalesce(location,'') from organisations where id=${O(n)}`);
    const o4 = o(4), o5 = o(5);
    const b = await page(`/organisations/${O(4)}`);
    const warn = rep.match(/Organisation · Pipedrive Org 05 Fake[^|]{0,120}/);
    check("US2 scenario 10", o4.startsWith("Pipedrive Org 04 Fake|") && o4.includes("fakeorg4.example") && o4.includes("|Retail|") && o4.endsWith("|4 Fake Street, London") && o4.split("|")[3] !== "" && b.includes("4 Fake Street, London"),
      `org 4: ${o4}; org 5 (0 employees): ${o5}; warning org 5: ${warn ? warn[0] : "none"}`);
  }
  if (want("US2 scenario 11")) {
    const v = (n, f) => q(`select coalesce(string_agg(coalesce(c.name, v.text_value, trim_scale(v.number_value)::text), ','), '') from custom_values v join custom_fields f on f.id=v.field_id left join custom_field_choices c on c.id = v.choice_id or c.id = any(v.choice_ids) where f.name='${f}' and v.person_id=${P(n)}`);
    let tier3, tier9, bud;
    try { tier3 = v(5003, "Tier"); tier9 = v(5009, "Tier"); bud = v(4, "Budget"); } catch (e) { tier3 = "ERR " + e.message.slice(0, 200); }
    const line = (rep.match(/'Bronze' is not a choice of 'Tier'[^)]*\)/) || [""])[0];
    check("US2 scenario 11", tier3 === "Gold" && tier9 === "" && bud === "400" && line !== "", `5003 Tier ${tier3}; 5009 Tier (Bronze) ${tier9}; person 4 Budget ${bud}; report: "${line}"`);
  }
  if (want("US2 scenario 12")) {
    const a = has("No CRM field named 'Favourite colour'."), b = has("'Score' is a text field in Pipedrive and a number field in the CRM.");
    const nScore = q("select count(*) from custom_values v join custom_fields f on f.id=v.field_id where f.name='Score'");
    const once = (rep.match(/Favourite colour/g) || []).length;
    check("US2 scenario 12", a && b && nScore === "0" && once === 1, `Favourite colour line ${a} (×${once}); Score line ${b}; Score values ${nScore}`);
  }
  if (want("US2 scenario 13")) {
    const nAda = q("select count(*) from person_emails where email='person006@fake.example'");
    const link = q("select person_id||':'||how from pipedrive_links where company_id=1001 and kind='person' and pipedrive_id=66");
    const hid = q("select person_id||':'||how from pipedrive_links where company_id=1001 and kind='person' and pipedrive_id=76");
    const after = before(adaEx).replace("subscribed", "X").replace("unX", "X");
    check("US2 scenario 13", nAda === "1" && link === `${adaEx}:linked` && hid === `${hidden}:linked` && has("Ada Example was already in the CRM: linked, not changed.") && has("A person already in the CRM has this email address: linked, not changed.") && !has("Hidden Privfake"),
      `persons with person006@: ${nAda}; link 6 → ${link}; link 16 (Linus's private) → ${hid}; named hidden: ${has("Hidden Privfake")}`);
  }
  if (want("US2 scenario 14") || want("Edge case 14")) {
    const a = before(adaEx);
    const b = await page(`/people/${adaEx}`);
    const tl = (b.match(/Unsubscribed by the Pipedrive import of Ada Fake[^A-Z]{0,40}/) || [""])[0];
    const diff = adaExBefore.split("|").map((v, i) => (v !== a.split("|")[i] ? i : null)).filter((x) => x !== null);
    if (want("US2 scenario 14")) check("US2 scenario 14", a.split("|")[4] === "unsubscribed" && diff.every((i) => i === 4 || i === 7) && b.includes("Unsubscribed") && tl !== "" && has("Ada Example is unsubscribed in Pipedrive: now Unsubscribed in the CRM.") && has("A person already in the CRM is unsubscribed in Pipedrive: now Unsubscribed in the CRM.") && before(hidden).split("|")[4] === "unsubscribed",
      `Ada Example before ${adaExBefore} after ${a}; timeline: "${tl}"; hidden person consent ${before(hidden).split("|")[4]}`);
    const u = before(unsub);
    if (want("Edge case 14")) check("Edge case 14", u === unsubBefore && a.split("|").slice(0, 4).join() === adaExBefore.split("|").slice(0, 4).join(), `Stays Unsubfake (Pipedrive subscribed) before ${unsubBefore} after ${u}; Ada Example values/owner/privacy unchanged except consent`);
  }
  if (want("US2 scenario 15")) {
    const n = q("select count(*) from organisations where lower(btrim(name))='fakeco ltd'");
    const l = q("select organisation_id||':'||how from pipedrive_links where company_id=1001 and kind='organisation' and pipedrive_id=1");
    const fakeco = q("select id from organisations where name='Fakeco Ltd'");
    const tlNew = q(`select count(*) from timeline_events where organisation_id=${fakeco} and kind='pipedrive_imported'`);
    check("US2 scenario 15", n === "1" && l === `${fakeco}:linked` && tlNew === "0" && /Fakeco Ltd[^.]*linked/.test(rep), `Fakeco Ltd count ${n}; link → ${l}; report has linked line: ${/Fakeco Ltd[^.]*linked/.test(rep)}`);
  }
  if (want("US2 scenario 16")) {
    const b = await page(`/people/${P(5001)}`);
    const tl = (b.match(/Imported from Pipedrive by Ada Fake[^A-Z]{0,40}/) || [""])[0];
    const ob = await page(`/organisations/${O(4)}`);
    const otl = ob.includes("Imported from Pipedrive by Ada Fake");
    await ada.goto(BASE + "/settings/pipedrive-import");
    const links = await ada.locator('main a[href="/people"], main a[href="/organisations"]').count();
    const perKind = /People[^A-Za-z]*imported|imported[^.]{0,20}people/i.test(rep) && /Organisations[^A-Za-z]*imported/i.test(rep);
    check("US2 scenario 16", (await L.stepNow(ada)).startsWith("3 REPORT") && has("Imported") && has("Linked to CRM records") && has("Not imported") && has("Already imported") && has("// NOT IMPORTED") && links === 2 && tl !== "" && otl && perKind,
      `three tiles + "Already imported"; per-kind counts (people/organisations imported/linked) shown: ${perKind}; links to lists ${links}; person timeline "${tl}"; org timeline ${otl}`);
  }
  if (want("US2 scenario 4")) {
    // Only People ticked (Linus, Otherco): the person's organisation comes with it, no other organisation.
    await ctl("addOrganization", 1002, { id: 7001, name: "Otherco Lonely Fake", owner_id: 50 });
    const otherOrg = await ctl("addOrganization", 1002, { id: 7002, name: "Otherco Linked Fake", owner_id: 50 });
    await ctl("addPerson", 1002, { id: 7003, first_name: "Otherperson", last_name: "Fake", owner_id: 50, org_id: 7002, marketing_status: "subscribed" });
    await L.startImport(linus, { people: true, consent: "unsubscribed" });
    await L.waitReport(linus, 120000);
    const p = q("select organisation_id from persons where id=(select person_id from pipedrive_links where company_id=1002 and pipedrive_id=7003)");
    const o = q("select organisation_id from pipedrive_links where company_id=1002 and kind='organisation' and pipedrive_id=7002");
    const lonely = q("select count(*) from organisations where name in ('Otherco Lonely Fake','Otherco Client Fake')");
    check("US2 scenario 4", global.us24ok && p !== "" && p === o && lonely === "0", `${global.us24}; People only (Linus/Otherco): person org ${p}, its PD org → ${o}; other Otherco orgs imported: ${lonely}`);
  }
  // ---- edge cases on values
  if (want("Edge case 3")) check("Edge case 3", has("Another Pipedrive person, 'Person001 Fake', has the same email address.") && P(17) === "", `report line present: ${has("Another Pipedrive person, 'Person001 Fake'")}; PD 17 link: '${P(17)}'`);
  if (want("Edge case 4")) {
    const l = q("select count(*) from pipedrive_links where company_id=1001 and kind='person' and pipedrive_id=84");
    check("Edge case 4", has("Its email addresses belong to more than one person in the CRM.") && l === "0" && before(twoA) === twoABefore, `line ${has("Its email addresses belong to more than one person")}; link rows ${l}; CRM person unchanged ${before(twoA) === twoABefore}`);
  }
  if (want("Edge case 5")) {
    const a = O(5101), b = O(5102);
    const how = q("select string_agg(how, ',' order by pipedrive_id) from pipedrive_links where company_id=1001 and pipedrive_id in (5101,5102) and kind='organisation'");
    const n = q("select count(*) from organisations where lower(btrim(name))='twin org fake'");
    check("Edge case 5", a === b && a !== "" && how === "imported,linked" && n === "1" && /twin org fake/i.test(rep), `5101 → ${a}, 5102 → ${b} (${how}); CRM count ${n}; listed in report: ${/twin org fake/i.test(rep)}`);
  }
  if (want("Edge case 6")) {
    const p23 = P(23), e23 = q(`select string_agg(email, ',') from person_emails where person_id=${p23 || 0}`);
    const r5004 = person(P(5004)).split("/")[2], l5003 = person(P(5003)).split("/")[3];
    const ok = has("Email address 'not-an-email@' is not valid: left out.") && e23 === "person023@fake.example" && has("No name.") && P(99) === "" && has("Role longer than 200 characters: left out.") && P(5004) !== "" && r5004 === "" && l5003 === "" && /LinkedIn[^.]*'not a link'[^.]*not valid/i.test(rep);
    check("Edge case 6", ok, `23 emails ${e23}; email line ${has("Email address 'not-an-email@' is not valid: left out.")}; No name ${has("No name.")} (99 linked '${P(99)}'); role line ${has("Role longer than 200 characters: left out.")}, role '${r5004}'; LinkedIn of 5003 '${l5003}', line ${/LinkedIn[^.]*'not a link'/i.test(rep)}`);
  }
  if (want("Edge case 7")) {
    const p = person(P(5003));
    const line = (rep.match(/Its organisation '[^']*' was not imported: imported without an organisation\./) || [""])[0];
    check("Edge case 7", P(5003) !== "" && p.split("/")[9] === "" && line !== "" && O(60) === "", `5003: org '${p.split("/")[9]}'; line "${line.slice(0, 80)}…"; org 60 linked '${O(60)}'`);
  }
  if (want("Edge case 8")) {
    const arch = q("select id from organisations where name='Old Fakeco Archive'");
    const p = person(P(5007)).split("/")[9];
    check("Edge case 8", O(5100) === arch && has("Old Fakeco Archive is archived.") && p === arch, `5100 → ${O(5100)} (archived ${arch}); warning ${has("Old Fakeco Archive is archived.")}; person 5007 org ${p}`);
  }
  if (want("Edge case 10")) {
    const n = (rep.match(/'Region' is an address field in Pipedrive: not imported\./g) || []).length;
    check("Edge case 10", n === 1, `"'Region' is an address field in Pipedrive: not imported." ×${n}`);
  }
  if (want("Edge case 11")) {
    const nick = q(`select count(*) from custom_values v join custom_fields f on f.id=v.field_id where f.name='Nickname' and person_id=${P(5008)}`);
    const tier = q(`select count(*) from custom_values v join custom_fields f on f.id=v.field_id where f.name='Tier' and person_id=${P(5008)}`);
    const bud = q(`select count(*) from custom_values v join custom_fields f on f.id=v.field_id where f.name='Budget' and person_id=${P(5009)}`);
    const w = rep.match(/Person · (Longnick|Bronze) Fake(Nickname longer|Budget '1.234567')/g) || [];
    check("Edge case 11", nick === "0" && tier === "1" && bud === "0" && w.length >= 2, `5008 Nickname values ${nick}, Tier kept ${tier}; 5009 Budget 1.234567 values ${bud}; warnings: ${w.join(" | ")}`);
  }
  if (want("Edge case 12")) {
    const n = q("select count(*) from custom_values v join custom_fields f on f.id=v.field_id where f.name='Job title'");
    check("Edge case 12", !/Job title|'LinkedIn'|Lead source'/.test(rep.replace(/Lead source not on the list/g, "")) && person(P(36)).split("/")[2] === "Fake Director", `Job title/LinkedIn/Lead source listed as fields: ${/Job title|'LinkedIn'/.test(rep)}; CRM custom "Job title" values ${n}; role of 36 '${person(P(36)).split("/")[2]}'`);
  }
  if (want("Edge case 13")) {
    await ada.goto(BASE + "/settings/pipedrive-import");
    const evilRep = await ada.locator('a[href*="evil"]').count();
    const quoted = /'<a href="https:\/\/evil.example">Click<\/a>' is not a choice/.test(rep);
    const pb = await page(`/people/${P(5005)}`);
    const evilPage = await ada.locator('a[href*="evil"]').count();
    await ada.goto(BASE + "/people?q=locked"); const evilList = await ada.locator('a[href*="evil"]').count();
    check("Edge case 13", evilRep + evilPage + evilList === 0 && quoted && pb.includes('<a href="https://evil.example">Click</a>'), `links to evil: report ${evilRep}, person page ${evilPage}, list ${evilList}; choice quoted in report: ${quoted}; name shown as text on page: ${pb.includes('<a href="https://evil.example">Click</a>')}`);
  }
  if (want("Edge case 15")) {
    const d = person(P(5001)).split("/")[10];
    const b = await page(`/people/${P(5001)}`);
    const lc = q(`select coalesce(last_contacted_at::text,'') from persons where id=${P(5001)}`);
    check("Edge case 15", d === "2024-03-15" && b.includes("15 Mar 2024") && lc === "", `created_at ${d}; page shows 15 Mar 2024: ${b.includes("15 Mar 2024")}; last contacted '${lc}'`);
  }
  if (want("Edge case 18")) {
    const c = await browser.newContext(); const p = await c.newPage();
    await L.signIn(p, "http://localhost:3002", "grace@barnacle.ai", "Grace Fake");
    await p.goto("http://localhost:3002/settings");
    const s = await L.section(p);
    const inputs = await p.locator('section[aria-label="Pipedrive"] input[name="token"]').count();
    await p.goto("http://localhost:3002/people"); const ppl = (await p.textContent("main")).includes("Fake");
    check("Edge case 18", s.includes("The Pipedrive import isn't set up yet.") && inputs === 0 && ppl, `section: ${s}; token inputs ${inputs}; People page works ${ppl}`);
  }
  console.log("\n" + JSON.stringify(L.results.map((r) => ({ name: r.name, ok: r.ok }))));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
