// SF-119 part A: US1 1–5, US6 1–3, US5-7, edge cases 1, 9, 10, 11, 12. Run after reset-db.sh (fresh fake data).
const H = require("./sf119-lib.js");
const { chromium, check, results, q, go, newPage, newCampaign, save, frameText, choosePerson, camp, B } = H;
(async () => {
  const b = await chromium.launch();
  const p = await newPage(b, "ada@barnacle.ai", "Ada Fake");
  const dialogs = []; p.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });

  // US1-1 empty state, then list
  const saved = q("create table if not exists _c_bak as select * from campaigns; select count(*) from _c_bak");
  q("delete from campaigns");
  await go(p, "/campaigns");
  const empty = await H.main(p);
  q("insert into campaigns overriding system value select * from _c_bak; drop table _c_bak");
  q("update campaigns set updated_at = now() - interval '1 day', updated_by = 3 where name='Welcome note (fake)'");
  await go(p, "/campaigns");
  const head = await p.locator("table.campaigns-list thead").innerText();
  const rows = await p.locator("table.campaigns-list tbody tr").allInnerTexts();
  const order = q("select name from campaigns order by updated_at desc").split("\n");
  const names = await p.locator("table.campaigns-list tbody tr a.nm").allInnerTexts();
  const hdr = await p.locator(".page-head").innerText();
  check("US1 scenario 1", empty.includes("No campaigns yet.") && /Name\s+Subject\s+Status\s+Created by\s+Last edited/i.test(head) && JSON.stringify(names) === JSON.stringify(order) && rows.every((r) => /DRAFT/i.test(r)) && hdr.includes("[ NEW CAMPAIGN ]") && rows.some((r) => r.includes("Welcome note (fake)") && r.includes("Grace Fake") && r.includes("Linus Fake ·")),
    `empty: ${empty.includes("No campaigns yet.")}; header ${JSON.stringify(head)}; ${saved} rows in order ${JSON.stringify(names)}; welcome row ${JSON.stringify(rows.find((r) => r.includes("Welcome")))}`);

  // US1-2
  const id = await newCampaign(p, "Exec dinner – April (fake)");
  const r2 = camp(id);
  const val = async (n) => p.locator(`#campaign-form [name="${n}"]`).inputValue();
  check("US1 scenario 2", r2.startsWith("Exec dinner – April (fake)|Ada Fake||||") && (await val("senderName")) === "Ada Fake" && (await val("subject")) === "" && (await p.locator("h1").innerText()) === "Exec dinner – April (fake)",
    `row ${r2.slice(0, 80)}; url ${p.url()}`);

  // US1-5 (empty subject / content first)
  const n5 = await save(p);
  await p.fill('[name="senderName"]', "");
  const n5b = await save(p);
  check("US1 scenario 5", n5.includes("Draft saved.") && n5.includes("Still empty: Subject, Content") && n5b.includes("Still empty: Sender name, Subject, Content") && camp(id).split("|")[1] === "",
    `${JSON.stringify(n5)} / ${JSON.stringify(n5b)}`);

  // US1-3
  await p.fill('[name="name"]', "Exec dinner – April v2 (fake)");
  await p.fill('[name="senderName"]', "Ada at Fakeco");
  await p.fill('[name="replyTo"]', "events@example.test");
  await p.fill("#campaign-subject", "S".repeat(255));
  await p.fill('[name="previewText"]', "P".repeat(255));
  const n3 = await save(p);
  await p.reload(); await p.waitForLoadState("networkidle");
  const v3 = [await val("name"), await val("senderName"), await val("replyTo"), (await val("subject")).length, (await val("previewText")).length];
  check("US1 scenario 3", n3.includes("Draft saved.") && JSON.stringify(v3) === JSON.stringify(["Exec dinner – April v2 (fake)", "Ada at Fakeco", "events@example.test", 255, 255]),
    `notes ${JSON.stringify(n3)}; after reload ${JSON.stringify(v3)}`);

  // US1-4: through the UI (maxlength stops typing more), then with maxlength removed (a pasted/forced value)
  const ver = camp(id).split("|")[8];
  await p.fill('[name="name"]', "");
  const e1 = await save(p);
  const e1b = await p.locator("#campaign-form").innerText();
  await p.fill('[name="name"]', "Kept name");
  await p.fill('[name="replyTo"]', "not-an-email");
  const vmsg = await p.locator('[name="replyTo"]').evaluate((e) => e.validationMessage);
  const e2 = await save(p);
  const e2form = await p.locator("#campaign-form").innerText();
  await p.evaluate(() => { const f = document.getElementById("campaign-form"); f.noValidate = true; f.querySelectorAll("[maxlength]").forEach((e) => e.removeAttribute("maxlength")); });
  await p.fill('[name="replyTo"]', "not-an-email");
  await p.fill('[name="name"]', "N".repeat(101));
  await p.fill("#campaign-subject", "S".repeat(256));
  await p.fill('[name="senderName"]', "X".repeat(101));
  await p.fill('[name="previewText"]', "P".repeat(256));
  const e3 = await p.locator("#campaign-form").innerText().then(async () => { await save(p); return p.locator("#campaign-form").innerText(); });
  const kept = (await val("name")).length === 101 && (await val("replyTo")) === "not-an-email";
  check("US1 scenario 4", camp(id).split("|")[8] === ver && e1b.includes("Give the campaign a name.") && e3.includes("A campaign name can be at most 100 characters.") && e3.includes("Reply-to: enter one valid email address.") && e3.includes("Subject: at most 255 characters.") && e3.includes("Sender name: at most 100 characters.") && e3.includes("Preview text: at most 255 characters.") && kept && e2form.includes("Reply-to: enter one valid email address."),
    `empty name → ${e1b.includes("Give the campaign a name.")}; reply-to "not-an-email" through the normal form → app message shown=${e2form.includes("Reply-to: enter one valid email address.")} (browser validation "${vmsg}" blocks the submit: the form has no noValidate); with validation/maxlength off: all five messages=${["A campaign name can be at most 100","Reply-to: enter","Subject: at most 255","Sender name: at most 100","Preview text: at most 255"].map((m) => e3.includes(m))}; typed kept=${kept}; version unchanged=${camp(id).split("|")[8] === ver}`);

  // Edge 1: two users at the same time
  await go(p, `/campaigns/${id}`);
  const g = await newPage(b, "grace@barnacle.ai", "Grace Fake");
  await go(g, `/campaigns/${id}`);
  await g.fill("#campaign-subject", "Grace's subject (fake)");
  const gs = await save(g);
  await p.fill("#campaign-subject", "Ada's subject (fake)");
  const as = await save(p);
  const typed = await p.locator("#campaign-subject").inputValue();
  await p.reload(); await p.waitForLoadState("networkidle");
  check("Edge case 1", gs.includes("Draft saved.") && as.includes("Grace Fake changed this campaign since you opened it. Reload to see their changes.") && typed === "Ada's subject (fake)" && (await p.locator("#campaign-subject").inputValue()) === "Grace's subject (fake)",
    `grace ${JSON.stringify(gs.split("\n")[0])}; ada ${JSON.stringify(as.split("\n")[0])}; typed kept ${typed}; after reload ${await p.locator("#campaign-subject").inputValue()}`);

  // US5-7: chosen person not stored; another user sees an empty picker
  await choosePerson(p, "Cara", "Cara Example");
  const ns = await save(p);
  const cols = q("select string_agg(column_name, ',') from information_schema.columns where table_name='campaigns'");
  await go(g, `/campaigns/${id}`);
  const gp = await g.locator(".preview-picker input").inputValue();
  await p.reload(); await p.waitForLoadState("networkidle");
  const ap = await p.locator(".preview-picker input").inputValue();
  check("US5 scenario 7", ns.includes("Draft saved.") && !/person/.test(cols) && !camp(id).includes("Cara") && gp === "" && ap === "", `columns ${cols}; other user's picker "${gp}"; after reload "${ap}"`);

  // US6-1 duplicate from the edit page
  await p.fill("#campaign-subject", "Dup subject {{First name | there}}");
  await save(p);
  const before = camp(id);
  await Promise.all([p.waitForURL((u) => !u.pathname.endsWith(`/${id}`)), g.waitForTimeout(0), p.click('form:has(input[name="id"]) button:has-text("[ DUPLICATE ]")')]);
  await p.waitForLoadState("networkidle");
  const cid = Number(p.url().match(/(\d+)$/)[1]);
  const c = camp(cid).split("|"), o = before.split("|");
  const by = q(`select created_by from campaigns where id=${cid}`);
  check("US6 scenario 1", c[0] === "Copy of " + o[0] && JSON.stringify(c.slice(1, 8)) === JSON.stringify(o.slice(1, 8)) && camp(id) === before && by === "1" && (await p.locator("h1").innerText()) === c[0],
    `copy ${cid} "${c[0]}" created_by ${by}; same fields ${JSON.stringify(c.slice(1, 8)) === JSON.stringify(o.slice(1, 8))}; original unchanged ${camp(id) === before}`);

  // US6-2 delete: cancel, then confirm (from the Campaigns page)
  await go(p, "/campaigns");
  await p.click(`a[aria-label="Delete ${c[0]}"]`); await p.waitForTimeout(800);
  const box = await p.locator('[role="alertdialog"]').innerText();
  await p.locator('[role="alertdialog"] a:has-text("[ CANCEL ]")').click(); await p.waitForTimeout(800);
  const still = q(`select count(*) from campaigns where id=${cid}`);
  await p.click(`a[aria-label="Delete ${c[0]}"]`); await p.waitForTimeout(800);
  await Promise.all([p.waitForLoadState("networkidle"), p.click("text=[ DELETE FOR GOOD ]")]); await p.waitForTimeout(800);
  const after = await H.main(p);
  check("US6 scenario 2", box.includes(c[0]) && still === "1" && q(`select count(*) from campaigns where id=${cid}`) === "0" && after.includes(`Campaign "${c[0]}" deleted.`) && (await p.locator("a.nm", { hasText: c[0] }).count()) === 0,
    `box ${JSON.stringify(box)}; after cancel row=${still}; after confirm: flash ${after.includes(`Campaign "${c[0]}" deleted.`)}`);

  // US6-3 deleted by another user: open, save
  const did = await newCampaign(p, "Gone soon (fake)");
  await go(g, `/campaigns/${did}`);
  q(`delete from campaigns where id=${did}`);
  await g.fill("#campaign-subject", "won't save");
  const gn = await save(g);
  await go(g, `/campaigns/${did}`);
  const open = await H.main(g);
  check("US6 scenario 3", gn.includes("This campaign no longer exists.") && open.includes("This campaign no longer exists.") && q(`select count(*) from campaigns where id=${did}`) === "0",
    `save → ${JSON.stringify(gn.split("\n")[0])}; open → ${JSON.stringify(open.slice(0, 120))}`);

  // Edge 9: markup in name, sender, subject, fallback
  const xid = await newCampaign(p, "<script>alert(1)</script> (fake)");
  await p.fill('[name="senderName"]', "<b>Sender</b>");
  await p.fill("#campaign-subject", "Hi {{First name | <i>there</i>}} <script>x</script>");
  await save(p);
  await p.reload(); await p.waitForLoadState("networkidle");
  const h1 = await p.locator("h1").innerText();
  const from = await p.locator(".mail-from").innerText();
  const subj = await p.locator(".mail-subject").innerText();
  await go(p, "/campaigns");
  const row = await p.locator("tr", { hasText: "(fake)" }).filter({ hasText: "<script>" }).first().innerText();
  check("Edge case 9", h1 === "<script>alert(1)</script> (fake)" && from.includes("From: <b>Sender</b>") && subj.includes("<script>x</script>") && row.includes("<script>alert(1)</script> (fake)") && dialogs.length === 0 && camp(xid).startsWith("<script>alert(1)</script> (fake)|<b>Sender</b>||Hi {{First name | <i>there</i>}} <script>x</script>"),
    `h1 ${h1}; preview ${from} / ${subj}; list row ${JSON.stringify(row)}; no dialog ${dialogs.length === 0}`);

  // Edge 10: 100-character name duplicated
  const long = "L".repeat(93) + " (fake)";
  q(`update campaigns set name='${long}' where id=${xid}`);
  await go(p, "/campaigns");
  await Promise.all([p.waitForURL((u) => /\/campaigns\/\d+$/.test(u.pathname)), p.click(`button[aria-label="Duplicate ${long}"]`)]);
  await p.waitForLoadState("networkidle");
  const ln = await p.locator("h1").innerText();
  check("Edge case 10", ln === ("Copy of " + long).slice(0, 100) && [...ln].length === 100, `copy name (${[...ln].length}) ${ln}`);

  // Edge 11: empty draft
  const eid = await newCampaign(p, "Only a name (fake)");
  await p.fill('[name="senderName"]', "");
  const en = await save(p);
  const es = await p.locator(".mail-subject").innerText();
  const ef = await frameText(p);
  await Promise.all([p.waitForURL((u) => !u.pathname.endsWith(`/${eid}`)), p.click('form:has(input[name="id"]) button:has-text("[ DUPLICATE ]")')]);
  await p.waitForLoadState("networkidle");
  check("Edge case 11", en.includes("Draft saved.") && es.trim() === "" && ef.trim() === "Don't want these emails? Unsubscribe" && (await p.locator("h1").innerText()) === "Copy of Only a name (fake)",
    `notes ${JSON.stringify(en)}; subject "${es}"; frame "${ef.trim()}"; copy ${await p.locator("h1").innerText()}`);

  // Edge 12: deactivated user's drafts
  const zid = q("insert into campaigns (name, created_by, updated_by) values ('Alan draft (fake)', 5, 5) returning id").split("\n")[0];
  await go(p, "/campaigns");
  const zr = await p.locator("tr", { hasText: "Alan draft (fake)" }).innerText();
  check("Edge case 12", q("select status from users where id=5") === "deactivated" && zr.includes("Alan Fake"), `row ${JSON.stringify(zr)}`);

  console.log(JSON.stringify(results.map((r) => [r.name, r.ok])));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
