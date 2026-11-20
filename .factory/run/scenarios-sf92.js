// SF-92 scenarios (US1–US3, edge cases 1–13) against :3000 / crm_dev freshly reset with the seed:
//   bash .factory/run/reset-db.sh && NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf92.js
// Users from the seed: Ada Fake, Grace Fake (admins), Linus Fake, Margaret Fake (users), Alan Fake (deactivated).
// Carl Fake (user) and Dee Fake (deactivated, no private people) are added through the Users page.
const { execFileSync } = require("child_process");
const { chromium, results, check } = require("./lib.js");
const BASE = "http://localhost:3000";
const q = (s) => execFileSync("/usr/lib/postgresql/17/bin/psql", ["-h", "localhost", "-U", "postgres", "-d", "crm_dev", "-Atc", s]).toString().trim();
const pid = (name) => Number(q(`select id from persons where btrim(first_name||' '||last_name)='${name}' order by id desc limit 1`));
const uid = (email) => Number(q(`select id from users where email='${email}'`));
const fakeco = () => Number(q("select id from organisations where name='Fakeco Ltd'"));

let browser;
const pages = {};
async function as(who) {
  if (pages[who]) return pages[who];
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/dev/fake-google");
  if (who.includes("@")) {
    await page.fill('input[name="email"]:visible', who);
    await page.fill('input[name="name"]:visible', "Carl Fake");
    await page.click("text=[ CONTINUE ]");
  } else {
    await page.getByRole("button", { name: new RegExp(`^${who}`) }).click();
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/dev/fake-google"));
  pages[who] = page;
  return page;
}
async function relogin(who) { if (pages[who]) { await pages[who].context().close(); delete pages[who]; } return as(who); }
const text = async (p, sel = "main") => ((await p.locator(sel).first().textContent()) || "").replace(/\s+/g, " ");
const go = async (p, path) => { const r = await p.goto(BASE + path); await p.waitForLoadState("networkidle"); return r; };
async function save(p) { await Promise.all([p.waitForLoadState("networkidle"), p.getByRole("button", { name: "[ SAVE ]" }).click()]); await p.waitForTimeout(500); }
async function pickOrg(p, typed, option) {
  await p.getByRole("combobox", { name: "Organisation" }).fill(typed);
  await p.getByRole("listbox", { name: "Organisations" }).getByRole("button", { name: option, exact: true }).click();
}
async function addPerson(p, { first, last, email, org, priv, owner, role }) {
  await go(p, "/people/new");
  await p.getByLabel("First name").fill(first);
  await p.getByLabel("Last name").fill(last);
  if (role) await p.getByLabel("Role or job title").fill(role);
  if (email) await p.getByLabel("Email address 1", { exact: true }).fill(email);
  if (org) await pickOrg(p, org.slice(0, 6), org);
  if (owner) await p.locator('select[name="ownerId"]').selectOption({ label: owner });
  if (priv) await p.getByLabel(/Private \(only/).check();
  await save(p);
}
async function orgCount(p) { await go(p, "/organisations?q=Fakeco%20Ltd"); return ((await p.locator("tbody tr", { hasText: "Fakeco Ltd" }).locator("td").last().textContent()) || "").trim(); }
async function timelineItems(p) { return (await p.getByRole("region", { name: "Timeline" }).getByRole("listitem").allTextContents()).map((s) => s.replace(/\s+/g, " ").trim()); }
async function sees(p, name, id) {
  await go(p, "/people"); const list = (await text(p)).includes(name);
  await go(p, "/people?q=" + encodeURIComponent(name.split(" ")[0])); const search = (await text(p)).includes(name);
  await go(p, `/organisations/${fakeco()}`); const org = ((await p.getByRole("region", { name: "People" }).textContent()) || "").includes(name);
  await go(p, `/people?open=${id}`); const drawer = (await p.getByRole("complementary", { name: "Preview" }).count()) > 0 && ((await p.getByRole("complementary", { name: "Preview" }).textContent()) || "").includes(name);
  const r = await go(p, `/people/${id}`); const pageOk = r.status() === 200 && (await text(p)).includes(name);
  const head = pageOk ? ((await p.locator("h1").first().textContent()) || "") : "";
  const nf = r.status() === 404 && (await text(p, "body")).includes("Page not found.");
  return { list, search, org, drawer, page: pageOk, privateBadge: /private/i.test(head), nf };
}
async function usersRow(p, email) { return ((await p.locator("tr", { hasText: email }).first().textContent()) || "").replace(/\s+/g, " "); }

(async () => {
  browser = await chromium.launch();
  const ada = await as("Ada Fake");
  // Carl (user) and Dee (deactivated, no private people) for US1 and US3 scenario 6.
  await go(ada, "/admin/users");
  for (const e of ["carl@barnacle.ai", "dee@barnacle.ai"]) { await ada.fill('input[name="email"]', e); await Promise.all([ada.waitForLoadState("networkidle"), ada.click("text=[ ADD USER ]")]); await ada.waitForTimeout(300); }
  const carl = await as("carl@barnacle.ai");
  q(`update users set name='Dee Fake' where email='dee@barnacle.ai'`);
  await go(ada, "/admin/users");
  await Promise.all([ada.waitForLoadState("networkidle"), ada.locator("tr", { hasText: "dee@barnacle.ai" }).locator('button:has-text("[ DEACTIVATE ]")').click()]);
  const linus = await as("Linus Fake"), margaret = await as("Margaret Fake"), grace = await as("Grace Fake");

  // ---------- US1 ----------
  await addPerson(linus, { first: "Ada", last: "Example", email: "ada.example@example.com", org: "Fakeco Ltd", priv: true, owner: "Margaret Fake", role: "Analyst" });
  const adaEx = pid("Ada Example");
  const sA = await sees(linus, "Ada Example", adaEx), sB = await sees(margaret, "Ada Example", adaEx);
  const cB = await orgCount(margaret), cC = await orgCount(carl), cAdmin = await orgCount(ada), cA = await orgCount(linus);
  check("US1 scenario 1", sB.list && sB.search && sB.org && sB.drawer && sB.page && sB.privateBadge && JSON.stringify(sA) === JSON.stringify(sB) && cB === cA && Number(cB) === Number(cC) + 1,
    `B(Margaret)=${JSON.stringify(sB)} A(Linus)=${JSON.stringify(sA)}; Fakeco count B=${cB} A=${cA} C=${cC}`);
  const sC = await sees(carl, "Ada Example", adaEx), sAd = await sees(ada, "Ada Example", adaEx);
  const nothing = (s) => !s.list && !s.search && !s.org && !s.drawer && !s.page && s.nf;
  check("US1 scenario 2", nothing(sC) && nothing(sAd) && cC === cAdmin && Number(cC) === Number(cB) - 1, `C=${JSON.stringify(sC)} admin=${JSON.stringify(sAd)} counts C=${cC} admin=${cAdmin} B=${cB}`);

  await go(margaret, `/people/${adaEx}/edit`);
  await margaret.getByLabel("Role or job title").fill("Director"); await save(margaret);
  const det = (await margaret.getByRole("region", { name: "Details" }).textContent()) || ""; let tl = await timelineItems(margaret);
  check("US1 scenario 3", margaret.url().endsWith(`/people/${adaEx}`) && det.includes("Director") && tl[0].startsWith("Edited by Margaret Fake: Role"), `url=${margaret.url()} details has Director=${det.includes("Director")} timeline[0]="${tl[0]}"`);

  // US1-5 (while Ada is private)
  await go(margaret, "/people/new"); await margaret.getByLabel("First name").fill("Copy"); await margaret.getByLabel("Email address 1", { exact: true }).fill("ada.example@example.com"); await save(margaret);
  const mErr = await text(margaret); const mLink = await margaret.locator(`a[href="/people/${adaEx}"]`, { hasText: "Ada Example" }).count();
  await go(carl, "/people/new"); await carl.getByLabel("First name").fill("Copy"); await carl.getByLabel("Email address 1", { exact: true }).fill("ada.example@example.com"); await save(carl);
  const cErr = await text(carl); const cLink = await carl.locator(`a[href="/people/${adaEx}"]`).count();
  check("US1 scenario 5", mErr.includes("Ada Example already has this email address.") && mLink > 0 && cErr.includes("Another person already has this email address.") && !cErr.includes("Ada Example") && cLink === 0,
    `B message ok=${mErr.includes("Ada Example already has this email address.")} link=${mLink}; C anon=${cErr.includes("Another person already has this email address.")} names Ada=${cErr.includes("Ada Example")} link=${cLink}`);

  // US1-6 / Edge 13 on a second person
  await addPerson(linus, { first: "Bea", last: "Example", email: "bea.example@example.com", priv: true, owner: "Margaret Fake" });
  const bea = pid("Bea Example");
  await go(margaret, `/people/${bea}/edit`); await margaret.locator('select[name="ownerId"]').selectOption({ label: "Carl Fake" }); await save(margaret);
  const mUrl = margaret.url(), mNotice = await text(margaret);
  const bB = await sees(margaret, "Bea Example", bea), bA = await sees(linus, "Bea Example", bea), bC = await sees(carl, "Bea Example", bea);
  check("US1 scenario 6", /\/people$/.test(mUrl) && mNotice.includes("You can no longer see Bea Example: only their creator and owner can.") && nothing(bB) && bA.page && bA.list && bC.page && bC.list,
    `B url=${mUrl} notice=${mNotice.includes("You can no longer see Bea Example: only their creator and owner can.")}; B=${JSON.stringify(bB)} A page=${bA.page} C page=${bC.page} (used Bea Example: Ada Example is needed private for US1-4)`);
  const bAd = await sees(ada, "Bea Example", bea), bG = await sees(grace, "Bea Example", bea);
  check("Edge case 13", nothing(bB) && nothing(bAd) && nothing(bG) && bA.list && bC.list, `creator Linus sees=${bA.list}, owner Carl sees=${bC.list}, former owner Margaret=${JSON.stringify(bB)}, Ada/Grace nothing=${nothing(bAd)}/${nothing(bG)}`);

  // US1-4
  await go(margaret, `/people/${adaEx}/edit`);
  const box = margaret.getByLabel(/Private \(only/); const offered = (await box.count()) > 0 && (await box.isChecked());
  await go(linus, `/people/${adaEx}/edit`); const offeredA = (await linus.getByLabel(/Private \(only/).count()) > 0;
  await box.uncheck(); await save(margaret); tl = await timelineItems(margaret);
  const cAfter = await sees(carl, "Ada Example", adaEx), adAfter = await sees(ada, "Ada Example", adaEx);
  check("US1 scenario 4", offered && offeredA && tl[0].startsWith("Edited by Margaret Fake: Private") && cAfter.page && cAfter.list && adAfter.page,
    `offered to B=${offered} to A=${offeredA}; timeline[0]="${tl[0]}"; C sees=${cAfter.page}/${cAfter.list} admin sees=${adAfter.page}`);

  // ---------- US2 ----------
  const org = fakeco();
  await addPerson(linus, { first: "Del", last: "Linked", org: "Fakeco Ltd" });
  const delL = pid("Del Linked");
  const linkedAt = q(`select to_char(created_at at time zone 'Europe/London','DD Mon YYYY') from timeline_events where related_person_id=${delL} and kind='person_linked'`);
  await addPerson(linus, { first: "Del", last: "Unlinked", org: "Fakeco Ltd" });
  const delU = pid("Del Unlinked");
  await go(linus, `/people/${delU}/edit`); await linus.getByRole("combobox", { name: "Organisation" }).fill(""); await save(linus);
  const unlinkedEv = q(`select count(*) from timeline_events where related_person_id=${delU} and kind='person_unlinked'`);
  await addPerson(ada, { first: "Del", last: "Private", org: "Fakeco Ltd", priv: true, owner: "Linus Fake" });
  const delP = pid("Del Private");
  await addPerson(linus, { first: "Del", last: "Nowhere", email: "del.nowhere@example.com", role: "Tester" });
  const delN = pid("Del Nowhere");
  q(`insert into person_phones (person_id, phone, kind, position) select ${delL}, '+44 20 7946 0000', 'work', 0`);
  await go(ada, `/organisations/${org}`); const before = await timelineItems(ada);
  const orgEventsBefore = q("select count(*) from timeline_events where organisation_id is not null");
  async function del(id) {
    await go(ada, `/people/${id}`);
    await await ada.getByRole("link", { name: "[ DELETE ]" }).first().click(); await ada.waitForLoadState("networkidle");
    await Promise.all([ada.waitForLoadState("networkidle"), ada.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click()]);
    await ada.waitForTimeout(400);
  }
  await del(delN);
  const orgEventsAfterN = q("select count(*) from timeline_events where organisation_id is not null");
  await go(ada, `/organisations/${org}`); const afterN = await timelineItems(ada);
  check("Edge case 10", orgEventsAfterN === orgEventsBefore && JSON.stringify(afterN) === JSON.stringify(before) && pid("Del Nowhere") === 0,
    `organisation events ${orgEventsBefore} -> ${orgEventsAfterN}; Fakeco timeline unchanged=${JSON.stringify(afterN) === JSON.stringify(before)}`);
  await del(delL); await del(delU);
  const viewers = { ada, linus, carl, margaret };
  const tls = {};
  for (const [n, p] of Object.entries(viewers)) { await go(p, `/organisations/${org}`); tls[n] = { items: await timelineItems(p), html: await p.getByRole("region", { name: "Timeline" }).innerHTML(), main: await text(p) }; }
  const t = tls.carl.items;
  const linkedLines = t.filter((s) => s.startsWith("A deleted person was linked by Linus Fake"));
  const unl = t.findIndex((s) => s.startsWith("A deleted person was unlinked by Linus Fake"));
  const noLinks = !/href="\/people\/(${delL}|${delU})"/.test(tls.carl.html) && !tls.carl.html.match(/<a[^>]*>[^<]*deleted person/i);
  const noName = Object.values(tls).every((v) => !v.main.includes("Del Linked") && !v.main.includes("Del Unlinked"));
  check("US2 scenario 1", linkedLines.length >= 2 && linkedLines[0].includes(linkedAt) && noLinks && noName,
    `lines="${linkedLines.join(" | ")}" (original date ${linkedAt}); no links=${noLinks}; no names anywhere=${noName}`);
  // newest first: for Del Unlinked, its "unlinked" comes before its "linked"
  const evs = q(`select string_agg(kind, ',' order by created_at desc, id desc) from timeline_events where organisation_id=${org} and related_person_id is null and kind like 'person_%' and actor_id=${uid("linus@barnacle.ai")}`);
  check("US2 scenario 2", unlinkedEv === "1" && unl >= 0 && unl < t.lastIndexOf(linkedLines[linkedLines.length - 1]) && t.filter((s) => s.startsWith("A deleted person was unlinked by Linus Fake")).length === 1,
    `Fakeco timeline (newest first): ${JSON.stringify(t.filter((s) => s.startsWith("A deleted")))}; db order (newest first) ${evs}`);
  const r = await go(carl, `/people/${delL}`); const nfText = (await text(carl, "body")).includes("Page not found.");
  const left = q(`select (select count(*) from person_emails where person_id in (${delL},${delU}))+(select count(*) from person_phones where person_id in (${delL},${delU}))+(select count(*) from person_labels where person_id in (${delL},${delU}))+(select count(*) from timeline_events where person_id in (${delL},${delU}))`);
  check("US2 scenario 3", r.status() === 404 && nfText && left === "0", `status=${r.status()} "Page not found."=${nfText}; emails+phones+labels+own events left=${left}`);
  check("Edge case 12", t.filter((s) => s.startsWith("A deleted person was unlinked")).length === 1 && q(`select count(*) from timeline_events where organisation_id=${org} and related_person_id is null and kind='person_unlinked'`) === "1",
    `only Del Unlinked's own unlink is shown; Del Linked (still linked when deleted) kept as linked, no new unlinked`);
  check("Edge case 11", linkedLines.length >= 2 && linkedLines.every((s) => s.replace(/\d.*$/, "") === linkedLines[0].replace(/\d.*$/, "")), `two deleted people's events: ${JSON.stringify(linkedLines)}`);
  // US2-4: private Del Private (created by Ada, owned by Linus) deleted by Ada
  await go(ada, `/organisations/${org}`); const adaBeforeP = await timelineItems(ada);
  await go(linus, `/organisations/${org}`); const linusBeforeP = await timelineItems(linus);
  await del(delP);
  const after4 = {};
  for (const [n, p] of Object.entries({ ada, linus, carl })) { await go(p, `/organisations/${org}`); after4[n] = await timelineItems(p); }
  const evLeft = q(`select count(*) from timeline_events where organisation_id=${org} and actor_id=${uid("ada@barnacle.ai")} and kind='person_linked'`);
  check("US2 scenario 4", adaBeforeP.some((s) => s.includes("Del Private")) && after4.ada.length === adaBeforeP.length - 1 && after4.linus.length === linusBeforeP.length - 1 && !Object.values(after4).flat().some((s) => /Del Private|linked by Ada Fake/.test(s)) && evLeft === "0",
    `before: creator Ada saw ${adaBeforeP.length} items (incl. Del Private), after ${after4.ada.length}; owner Linus ${linusBeforeP.length} -> ${after4.linus.length}; no "A deleted person was linked by Ada Fake" for anyone; events left in db=${evLeft}`);

  // ---------- US3 ----------
  const alan = uid("alan@barnacle.ai");
  q(`update person_emails set email='secret@example.com' where email='sam.leftfake@example.net'`);
  await go(ada, "/admin/users");
  const alanRow = await usersRow(ada, "alan@barnacle.ai"); const alanBtn = await ada.locator("tr", { hasText: "alan@barnacle.ai" }).getByRole("link", { name: "[ HAND OVER ]" }).count();
  check("US3 scenario 1", alanRow.includes("2 private people") && alanBtn === 1 && !/Leftfake|example\.com/.test(await text(ada)), `Alan row: "${alanRow.trim()}"; no names/emails on page`);
  const others = []; for (const e of ["ada@", "grace@", "linus@", "margaret@", "carl@", "dee@"]) others.push(`${e}:${await ada.locator("tr", { hasText: e }).getByRole("link", { name: "[ HAND OVER ]" }).count()}`);
  check("US3 scenario 6", others.every((s) => s.endsWith(":0")) && (await usersRow(ada, "dee@barnacle.ai")).includes("Deactivated"), `HAND OVER links per row: ${others.join(" ")} (dee = deactivated, no private people)`);

  const openPanel = async (p) => { await go(p, "/admin/users"); await Promise.all([p.waitForURL(/handover=/), p.locator("tr", { hasText: "alan@barnacle.ai" }).getByRole("link", { name: "[ HAND OVER ]" }).click()]); await p.waitForLoadState("networkidle"); };
  const owners = () => q(`select string_agg(u.name, ',' order by p.first_name) from persons p join users u on u.id=p.owner_id where p.last_name='Leftfake'`);
  await openPanel(ada);
  const panel = ada.locator("form.handover");
  const tableBelow = await ada.evaluate(() => { const f = document.querySelector("form.handover"), t = document.querySelector("table.users"); return !!f && !!t && !!(f.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING); });
  const opts = await panel.locator("select option").allTextContents();
  const hasBtns = (await panel.getByRole("button", { name: "[ HAND OVER ]" }).count()) === 1 && (await panel.getByRole("link", { name: "[ CANCEL ]" }).count()) === 1;
  await panel.locator("select").selectOption({ label: "Margaret Fake" });
  const pText = await text(ada, "form.handover");
  check("US3 scenario 2", tableBelow && !opts.includes("Alan Fake") && !opts.includes("Dee Fake") && opts.includes("Margaret Fake") && hasBtns && pText.includes("Hand Alan Fake's 2 private people to Margaret Fake?") && pText.includes("They stay private. Margaret Fake becomes their owner and can see them. You will not see who they are.") && !pText.includes("Leftfake"),
    `panel above table=${tableBelow}; options=${JSON.stringify(opts)}; buttons=${hasBtns}; panel text="${pText.trim()}"`);
  await Promise.all([ada.waitForURL(/\/admin\/users$/), panel.getByRole("link", { name: "[ CANCEL ]" }).click()]);
  check("Edge case 3", (await ada.locator("form.handover").count()) === 0 && (await usersRow(ada, "alan@barnacle.ai")).includes("2 private people") && owners() === "Alan Fake,Alan Fake", `panel closed, Alan row="${(await usersRow(ada, "alan@barnacle.ai")).trim()}", owners=${owners()}`);
  await openPanel(ada);
  await Promise.all([ada.waitForLoadState("networkidle"), ada.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click()]); await ada.waitForTimeout(500);
  check("Edge case 4", (await ada.locator("form.handover").count()) === 1 && (await text(ada, "form.handover")).includes("Choose an active user.") && owners() === "Alan Fake,Alan Fake", `panel open, text="${(await text(ada, "form.handover")).trim()}", owners=${owners()}`);
  // Edge 6: Grace chosen, then deactivated by another admin before confirming
  await openPanel(ada); await ada.locator("form.handover select").selectOption({ label: "Grace Fake" });
  q(`update users set status='deactivated' where email='grace@barnacle.ai'`);
  await Promise.all([ada.waitForLoadState("networkidle"), ada.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click()]); await ada.waitForTimeout(500);
  check("Edge case 6", (await text(ada, "form.handover")).includes("Choose an active user.") && owners() === "Alan Fake,Alan Fake", `panel="${(await text(ada, "form.handover")).trim()}", owners=${owners()}`);
  q(`update users set status='active' where email='grace@barnacle.ai'`);
  // Direct requests: field from the server-rendered panel
  await openPanel(ada); await go(ada, ada.url().replace(BASE, ""));
  const field = await ada.locator('form.handover input[name^="$ACTION_ID_"]').getAttribute("name");
  const post = async (p, userId, toUserId) => { const res = await p.request.post(BASE + "/admin/users", { multipart: { [field]: "", userId: String(userId), toUserId: String(toUserId) } }); return { url: res.url(), body: (await res.text()).replace(/&#x27;/g, "'") }; };
  const linusId = uid("linus@barnacle.ai"), margId = uid("margaret@barnacle.ai");
  const e7a = await post(ada, linusId, margId);
  const e7b = await post(ada, alan, alan);
  check("Edge case 7", e7a.body.includes("Only a deactivated user's private people can be handed over.") && e7b.body.includes("Choose an active user.") && owners() === "Alan Fake,Alan Fake" && q(`select count(*) from timeline_events where kind='handed_over'`) === "0",
    `active user's: ${e7a.url} message=${e7a.body.includes("Only a deactivated user's private people can be handed over.")}; to Alan himself: ${e7b.url} message=${e7b.body.includes("Choose an active user.")}; owners=${owners()}`);
  const s7 = await post(linus, alan, linusId);
  check("US3 scenario 7", s7.body.includes("You don't have access to this page.") && owners() === "Alan Fake,Alan Fake", `Linus's direct post -> ${s7.url}, forbidden shown=${s7.body.includes("You don't have access to this page.")}, owners=${owners()}`);

  // US3-3 by Grace; Ada's panel (open with Margaret chosen) confirmed afterwards = Edge 8 "none"
  await openPanel(ada); await ada.locator("form.handover select").selectOption({ label: "Margaret Fake" });
  await openPanel(grace); await grace.locator("form.handover select").selectOption({ label: "Margaret Fake" });
  await Promise.all([grace.waitForURL(/\/admin\/users$/), grace.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click()]); await grace.waitForLoadState("networkidle");
  const gText = await text(grace), gRow = await usersRow(grace, "alan@barnacle.ai");
  check("US3 scenario 3", gText.includes("2 private people handed to Margaret Fake.") && !/private/i.test(gRow) && (await grace.locator("tr", { hasText: "alan@barnacle.ai" }).getByRole("link", { name: "[ HAND OVER ]" }).count()) === 0 && owners() === "Margaret Fake,Margaret Fake",
    `notice=${gText.includes("2 private people handed to Margaret Fake.")}; Alan row="${gRow.trim()}"; owners=${owners()}`);
  await Promise.all([ada.waitForURL(/\/admin\/users$/), ada.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click()]); await ada.waitForLoadState("networkidle");
  const e8none = (await text(ada)).includes("Alan Fake has no private people to hand over.");

  // US3-4
  await go(margaret, "/people?q=Leftfake"); const m1 = await margaret.locator("tbody tr").count();
  await go(margaret, `/people?owner=${margId}`); const mOwner = await text(margaret);
  const robin = pid("Robin Leftfake"), sam = pid("Sam Leftfake");
  let ok4 = m1 === 2 && mOwner.includes("Robin Leftfake") && mOwner.includes("Sam Leftfake"); const det4 = [];
  for (const id of [robin, sam]) { await go(margaret, `/people/${id}`); const h = (await margaret.locator("h1").first().textContent()) || ""; const d = (await margaret.getByRole("region", { name: "Details" }).textContent()) || ""; const tl0 = (await timelineItems(margaret))[0];
    det4.push(`${h.trim()} | owner Margaret=${d.includes("Margaret Fake")} | "${tl0}"`); ok4 = ok4 && /private/i.test(h) && d.includes("Margaret Fake") && tl0.startsWith("Handed to Margaret Fake by Grace Fake"); }
  check("US3 scenario 4", ok4, `search rows=${m1}; owner filter (?owner=${margId}) lists both=${mOwner.includes("Robin Leftfake") && mOwner.includes("Sam Leftfake")}; ${det4.join(" ; ")}`);
  // US3-5
  await go(margaret, "/people/new"); await margaret.getByLabel("First name").fill("Copy"); await margaret.getByLabel("Email address 1", { exact: true }).fill("secret@example.com"); await save(margaret);
  const m5 = (await text(margaret)).includes("Sam Leftfake already has this email address.") && (await margaret.locator(`a[href="/people/${sam}"]`).count()) > 0;
  await go(margaret, `/people/${sam}/edit`); await margaret.getByRole("button", { name: "Remove email address 1" }).click(); await save(margaret);
  await addPerson(linus, { first: "New", last: "Secret", email: "secret@example.com" });
  const newId = pid("New Secret");
  check("US3 scenario 5", m5 && newId > 0 && linus.url().endsWith(`/people/${newId}`), `Margaret's duplicate named+linked Sam=${m5}; after removing it, Linus saved New Secret and is on ${linus.url()}`);
  check("Edge case 1", (await sees(margaret, "Robin Leftfake", robin)).page && !(await usersRow(ada, "alan@barnacle.ai")).includes("private") && q(`select status from users where id=${alan}`) === "deactivated",
    "Robin/Sam: creator Alan deactivated, owner Margaret active — Margaret sees and edited them (US3-5); Alan's row shows no count / no HAND OVER");

  // Edge 2 / 5 / 8 (count): Linus creates private Edgar Two, owner set to Alan by SQL (owner select offers active users only)
  await addPerson(linus, { first: "Edgar", last: "Two", priv: true });
  const e2 = pid("Edgar Two"); q(`update persons set owner_id=${alan} where id=${e2}`);
  await openPanel(ada); const cnt1 = (await usersRow(ada, "alan@barnacle.ai")).includes("1 private person");
  await ada.locator("form.handover select").selectOption({ label: "Ada Fake" });
  await addPerson(linus, { first: "Edgar", last: "Three", priv: true }); const e3 = pid("Edgar Three"); q(`update persons set owner_id=${alan} where id=${e3}`);
  await Promise.all([ada.waitForURL(/\/admin\/users$/), ada.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click()]); await ada.waitForLoadState("networkidle");
  const e8msg = (await text(ada)).includes("2 private people handed to Ada Fake.");
  check("Edge case 8", e8none && cnt1 && e8msg, `confirming after Grace already handed over: "Alan Fake has no private people to hand over."=${e8none}; panel opened with "1 private person"=${cnt1}, one more added before confirming -> "2 private people handed to Ada Fake."=${e8msg}`);
  const adaSees = await sees(ada, "Edgar Two", e2), linusSees = await sees(linus, "Edgar Two", e2);
  check("Edge case 5", e8msg && adaSees.page && adaSees.list && q(`select owner_id from persons where id=${e2}`) === String(uid("ada@barnacle.ai")), `admin handed to self; Ada sees Edgar Two=${adaSees.page}/${adaSees.list}`);
  check("Edge case 2", cnt1 && linusSees.page && linusSees.list && q(`select owner_id from persons where id=${e2}`) !== String(alan), `Edgar Two (created by Linus, owned by Alan) counted as Alan's, handed over; Linus still sees=${linusSees.page}/${linusSees.list}`);

  // Edge 9: reactivate Alan
  await go(ada, "/admin/users");
  await Promise.all([ada.waitForLoadState("networkidle"), ada.locator("tr", { hasText: "alan@barnacle.ai" }).locator('button:has-text("[ REACTIVATE ]")').click()]); await ada.waitForTimeout(400);
  const alanP = await as("Alan Fake");
  const aR = await sees(alanP, "Robin Leftfake", robin);
  await go(alanP, `/people/${robin}`); const aDet = (await alanP.getByRole("region", { name: "Details" }).textContent()) || "";
  check("Edge case 9", aR.page && aR.list && aDet.includes("Margaret Fake") && q(`select owner_id from persons where id=${robin}`) === String(margId), `Alan sees Robin=${aR.page}/${aR.list}, owner shown Margaret=${aDet.includes("Margaret Fake")}`);

  await browser.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
})().catch(async (e) => { console.error(e); console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed before the error`); process.exit(1); });
