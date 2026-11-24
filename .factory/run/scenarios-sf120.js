// SF-120 segments: AI review scenarios. Needs the app (start-app.sh) on crm_dev freshly seeded, then
// `psql -h localhost -U postgres crm_dev -f .factory/run/sf120-setup.sql`. Run: NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf120.js
const { execSync } = require("child_process");
const { chromium, check, signIn, bodyText } = require("./lib.js");
const base = process.env.BASE || "http://localhost:3000";
const q = (s) => execSync(`/usr/lib/postgresql/17/bin/psql -h localhost -U postgres crm_dev -Atc "${s.replace(/"/g, '\\"')}"`).toString().trim();
const main = (p) => p.innerText("main");
async function idle(p) { await p.waitForLoadState("networkidle"); await p.waitForTimeout(300); }
async function openNew(p) { await p.goto(base + "/segments"); await p.click("text=[ NEW SEGMENT ]"); await idle(p); }
async function who(p, w, pipeline, stage, status) {
  const label = { everyone: "Everyone in the CRM", pipeline: "People on the deals of a pipeline", stage: "People on the deals of a stage" }[w];
  await p.getByLabel(label).check();
  if (pipeline) await p.selectOption('select[name="pipelineId"]', { label: pipeline });
  if (stage) await p.selectOption('select[name="stageId"]', { label: stage });
  if (status) await p.selectOption('select[name="dealStatus"]', { label: status });
}
async function addCond(p, field) { await p.selectOption('select[aria-label="Field"]', { label: field }); await p.click("text=[ ADD CONDITION ]"); }
async function pick(p, label, option) {
  const box = p.locator(`.cond`, { has: p.locator(".typ", { hasText: label }) }).last().locator('input[role="combobox"]');
  await box.click(); await box.fill(option);
  await p.locator(".picker-list button", { hasText: option }).first().click();
  await p.keyboard.press("Escape");
}
async function countAgain(p) { await p.click("text=[ COUNT AGAIN ]"); await idle(p); return main(p); }
async function save(p) { await p.click("text=[ SAVE ]"); await idle(p); return main(p); }
const reaches = (t) => (t.match(/Reaches (\d+) (?:people|person) now/) || [])[1];
const segId = (name) => q(`select id from segments where name='${name.replace(/'/g, "''")}'`);
async function rowText(p, name) { await p.goto(base + "/segments"); const r = p.locator("tr", { has: p.locator(`a:text-is("${name}")`) }); return (await r.count()) ? r.first().innerText() : null; }

(async () => {
  // fresh data each run: empty + seed, then the review's own data
  execSync("bash .factory/run/reset-db.sh crm_dev >/dev/null 2>&1 && /usr/lib/postgresql/17/bin/psql -h localhost -U postgres crm_dev -q -v ON_ERROR_STOP=1 -f .factory/run/sf120-setup.sql >/dev/null", { cwd: __dirname + "/../.." });
  const b = await chromium.launch();
  const ctxA = await b.newContext(), ctxG = await b.newContext();
  const a = await ctxA.newPage(), g = await ctxG.newPage();
  await signIn(a, base, "ada@barnacle.ai", "Ada Fake"); await signIn(g, base, "grace@barnacle.ai", "Grace Fake");
  let t;

  // US1-1
  await openNew(a); t = await main(a);
  const radios = ["Everyone in the CRM", "People on the deals of a pipeline", "People on the deals of a stage"].every((x) => t.includes(x));
  const nameBox = await a.locator('input[name="name"]').count();
  const noPipeEveryone = (await a.locator('select[name="pipelineId"]').count()) === 0;
  await who(a, "pipeline");
  const statusOpts = await a.locator('select[name="dealStatus"] option').allInnerTexts();
  const statusDefault = await a.locator('select[name="dealStatus"]').evaluate((s) => s.options[s.selectedIndex].text);
  const noStageForPipeline = (await a.locator('select[name="stageId"]').count()) === 0;
  await who(a, "stage", "RevPipe");
  const stageOpts = await a.locator('select[name="stageId"] option').allInnerTexts();
  check("US1 scenario 1", a.url().endsWith("/segments/new") && radios && nameBox && noPipeEveryone && noStageForPipeline &&
    JSON.stringify(statusOpts) === JSON.stringify(["Open deals", "Won deals", "Lost deals", "All deals"]) && statusDefault === "Open deals" && stageOpts.join() === "—,RA,RB",
    `url ${a.url()}, radios ${radios}, status ${statusOpts} default ${statusDefault}, stages for RevPipe ${stageOpts}`);

  // US1-2
  await openNew(a); await a.fill('input[name="name"]', "Rv RA"); await who(a, "stage", "RevPipe", "RA", "Open deals");
  const open = reaches(await countAgain(a));
  await a.selectOption('select[name="dealStatus"]', { label: "All deals" }); const all = reaches(await countAgain(a));
  await a.selectOption('select[name="dealStatus"]', { label: "Won deals" }); const won = reaches(await countAgain(a));
  check("US1 scenario 2", open === "3" && all === "5" && won === "2", `Open ${open} (want 3), All ${all} (want 5: A1,A2,A3,W1,W2, never X1 of the archived deal), Won ${won}`);

  // US1-3 + Edge 2 + US1-7 (pipeline RevPipe open: A1 on two deals with 2 emails, L1/L2/L3 left out)
  await openNew(a); await a.fill('input[name="name"]', "Rv pipe open"); await who(a, "pipeline", "RevPipe");
  t = await countAgain(a);
  const lo = "Left out: 1 archived · 1 unsubscribed · 1 with no email address";
  const note = "Recipients are worked out when the campaign is sent, so this number can change.";
  const c3 = t.includes("Reaches 4 people now") && t.includes(lo) && t.includes(note);
  t = await save(a);
  const strip = t.replace(/\s+/g, " ");
  check("US1 scenario 3", c3 && /REACHES NOW 4 ARCHIVED 1 UNSUBSCRIBED 1 NO EMAIL ADDRESS 1/i.test(strip) && t.includes(note), `count again: ${c3}; after save url ${a.url()} strip: ${strip.slice(0, 200)}`);
  const first = execSync(`cd /home/agent/repo && DATABASE_URL=postgres://postgres@localhost:5432/crm_dev APP_ENV=development npx tsx -e 'import("@/server/segments/reach").then(async (m) => { const r = await m.reachedPeople((await import("@/server/db")).sql, 1, { who: "pipeline", pipelineId: ${q("select id from pipelines where name='RevPipe'")}, stageId: null, dealStatus: "open", conditions: [] }); console.log(JSON.stringify(r.map((x) => x.email))); process.exit(0); })'`).toString().trim();
  check("US1 scenario 7", /REACHES NOW\s+4/i.test(t) && first.includes("rv.a1@example.test") && !first.includes("rv.a1.second"), `A1 on Rv D1 and Rv D5, 2 addresses: count 4 (A1,A2,A3,M1), recipients ${first}`);
  // Edge 2 on stage RB: A1, M1 reached; L1 archived+unsub+no email, L2 unsub+no email, L3 no email
  await openNew(a); await a.fill('input[name="name"]', "Rv RB"); await who(a, "stage", "RevPipe", "RB"); t = await save(a);
  const rbId = segId("Rv RB");
  check("Edge case 2", /REACHES NOW 2 ARCHIVED 1 UNSUBSCRIBED 1 NO EMAIL ADDRESS 1/i.test(t.replace(/\s+/g, " ")), `stage RB page strip: ${t.replace(/\s+/g, " ").slice(0, 160)}`);

  // US1-4 + US2-2
  await openNew(a); await a.fill('input[name="name"]', "Rv RA three"); await who(a, "stage", "RevPipe", "RA");
  await addCond(a, "Role"); await a.locator('.cond input[aria-label="Role"]').fill("director");
  await addCond(a, "Lead source"); await pick(a, "Lead source", "Inbound");
  await addCond(a, "Label"); await pick(a, "Label", "Hot");
  await addCond(a, "Owner"); await pick(a, "Owner", "Grace Fake");
  const withFour = reaches(await countAgain(a));
  await a.locator(".cond", { has: a.locator(".typ", { hasText: "Owner" }) }).locator("text=[ REMOVE ]").click();
  const withThree = reaches(await countAgain(a));
  check("US2 scenario 2", withFour === "0" && withThree === "1", `stage RA + role/lead source/label + owner Grace: ${withFour} (want 0); after [ REMOVE ] owner: ${withThree} (want 1: A1)`);
  t = await save(a);
  const pageOk = t.includes("Rv RA three") && /Last changed by Ada Fake · \d{1,2} Nov 2026 \d{2}:\d{2}/.test(t) && /REACHES NOW\s+1/i.test(t) && t.includes(note) &&
    t.includes("// WHO") && /DEALS\s+Open deals/i.test(t) && /PIPELINE · STAGE\s+RevPipe · RA/i.test(t) && t.includes("// CONDITIONS") && /ROLE/i.test(t) && /LEAD SOURCE\s+Inbound/i.test(t) && /LABEL\s+Hot/i.test(t);
  const row = await rowText(a, "Rv RA three");
  const href = await a.locator('a:text-is("Rv RA three")').getAttribute("href");
  check("US1 scenario 4", pageOk && row && row.includes("People on open deals of RevPipe · RA + 3 conditions") && /\t1\t/.test(row) && row.includes("Ada Fake") && href === `/segments/${segId("Rv RA three")}`,
    `page ok ${pageOk}; row: ${JSON.stringify(row)}; href ${href}. Page: ${t.replace(/\s+/g, " ").slice(0, 400)}`);

  // US1-5
  const before = q("select count(*) from segments");
  const msgs = [];
  for (const [nm, want] of [["", "Give the segment a name."], ["x".repeat(101), "A segment name can be at most 100 characters."], ["  rv ra THREE  ", "There is already a segment called rv ra THREE."]]) {
    await openNew(a); await a.fill('input[name="name"]', nm); await who(a, "stage", "RevPipe", "RB", "Won deals"); await addCond(a, "Role"); await a.locator('.cond input[aria-label="Role"]').fill("keepme");
    t = await save(a);
    const kept = (await a.getByLabel("People on the deals of a stage").isChecked()) && (await a.locator('select[name="stageId"]').evaluate((s) => s.options[s.selectedIndex].text)) === "RB" &&
      (await a.locator('select[name="dealStatus"]').evaluate((s) => s.options[s.selectedIndex].text)) === "Won deals" && (await a.locator('.cond input[aria-label="Role"]').inputValue()) === "keepme";
    msgs.push([want, t.includes(want), kept, a.url()]);
  }
  check("US1 scenario 5", msgs.every((m) => m[1] && m[2]) && q("select count(*) from segments") === before, JSON.stringify(msgs));

  // US1-6
  await openNew(a); await a.fill('input[name="name"]', "Rv no pipe"); await who(a, "pipeline"); const t6a = await save(a);
  await openNew(a); await a.fill('input[name="name"]', "Rv no stage"); await who(a, "stage", "RevPipe"); const t6b = await save(a);
  check("US1 scenario 6", t6a.includes("Choose a pipeline.") && t6b.includes("Choose a stage.") && q("select count(*) from segments") === before, `pipeline msg ${t6a.includes("Choose a pipeline.")}, stage msg ${t6b.includes("Choose a stage.")}`);

  // US2-1
  await openNew(a); const kinds = {};
  for (const f of ["Lead source", "Label", "Organisation", "Owner", "Role", "Diet (fake)", "Birthday (fake)", "Newsletter topics (fake)", "Head count met (fake)", "Notes (fake)", "Rv Opted (fake)"]) {
    await addCond(a, f);
    const row = a.locator(".cond", { has: a.locator(".typ", { hasText: f }) }).last();
    kinds[f] = (await row.locator('input[role="combobox"]').count()) ? "picker" : (await row.locator("select").count()) ? "select:" + (await row.locator("select option").allInnerTexts()).join("/") :
      (await row.locator('input[type="date"]').count()) === 2 ? "date-range" : (await row.locator(".range input").count()) === 2 ? "range" : "text";
  }
  const dietRow = a.locator(".cond", { has: a.locator(".typ", { hasText: "Diet (fake)" }) }); await dietRow.locator('input[role="combobox"]').click();
  const dietOpts = await a.locator(".picker-list button").allInnerTexts(); await a.keyboard.press("Escape");
  const exp = { "Lead source": "picker", Label: "picker", Organisation: "picker", Owner: "picker", Role: "text", "Diet (fake)": "picker", "Birthday (fake)": "date-range", "Newsletter topics (fake)": "picker", "Head count met (fake)": "range", "Notes (fake)": "text", "Rv Opted (fake)": "select:—/Yes/No/Empty" };
  check("US2 scenario 1", JSON.stringify(kinds) === JSON.stringify(exp) && dietOpts.includes("Empty"), `${JSON.stringify(kinds)}; Diet options ${dietOpts}`);

  // US2-3
  await openNew(a); await a.fill('input[name="name"]', "Rv bad cond"); await addCond(a, "Lead source"); const t3a = await save(a);
  await openNew(a); await a.fill('input[name="name"]', "Rv bad num"); await addCond(a, "Head count met (fake)");
  await a.locator('.cond input[aria-label="Head count met (fake) from"]').fill("abc"); const t3b = await save(a);
  const numMsg = (t3b.match(/Head count met \(fake\)[^\n]*/) || [""])[0];
  check("US2 scenario 3", t3a.includes("Lead source: choose at least one.") && numMsg.length > 0 && q("select count(*) from segments") === before, `lead source: ${t3a.includes("Lead source: choose at least one.")}; number: "${numMsg}"`);

  // US2-4 — remove label Partner and lead source Event; a segment already holding them keeps them
  await openNew(a); await a.fill('input[name="name"]', "Rv partner"); await addCond(a, "Label"); await pick(a, "Label", "Partner");
  await addCond(a, "Lead source"); await pick(a, "Lead source", "Event"); await a.locator(".cond", { has: a.locator(".typ", { hasText: "Lead source" }) }).locator("text=[ REMOVE ]").click();
  await addCond(a, "Lead source"); await pick(a, "Lead source", "Event"); await pick(a, "Lead source", "Inbound");
  await save(a); const partnerId = segId("Rv partner");
  const partnerBefore = reaches(await (await a.goto(base + `/segments/${partnerId}`), main(a))) || (await main(a)).match(/REACHES NOW\s+(\d+)/i)?.[1];
  q("update labels set removed_at=now() where name='Partner'"); q("update lead_sources set removed_at=now() where name='Event'");
  async function opts(p, field) { await addCond(p, field); const box = p.locator(".cond", { has: p.locator(".typ", { hasText: field }) }).last().locator('input[role="combobox"]'); await box.click(); await p.waitForTimeout(200); const r = await p.locator(".picker-list button").allInnerTexts(); await p.keyboard.press("Escape"); return r; }
  await openNew(a); const newLabels = await opts(a, "Label"); const newSources = await opts(a, "Lead source"); const orgs = await opts(a, "Organisation"); const owners = await opts(a, "Owner");
  await a.goto(base + `/segments/${partnerId}/edit`); await idle(a);
  const editLabels = await a.locator(".cond", { has: a.locator(".typ", { hasText: "Label" }) }).first().locator(".chip").allInnerTexts();
  const editSources = await a.locator(".cond", { has: a.locator(".typ", { hasText: "Lead source" }) }).first().locator(".chip").allInnerTexts();
  const allOrgs = q("select count(*) from organisations");
  check("US2 scenario 4", !newLabels.some((x) => x.startsWith("Partner")) && !newSources.some((x) => x.startsWith("Event")) && orgs.length === Math.min(30, +allOrgs) &&
    owners.some((o) => o.startsWith("Alan Fake")) && owners.length === +q("select count(*) from users") && editLabels.some((x) => /partner \(removed\)/i.test(x)) && editSources.some((x) => /event \(removed\)/i.test(x)),
    `new form labels ${newLabels}; sources ${newSources}; orgs ${orgs.length}/${allOrgs} (${orgs.filter((o) => o.includes("(")).join(";")}); owners ${owners}; edit chips label ${editLabels} sources ${editSources}`);

  // Edge 4 part: removed label still matches
  await a.goto(base + `/segments/${partnerId}`); const partnerAfter = (await main(a)).match(/REACHES NOW\s+(\d+)/i)?.[1];

  // US3-1 (edit opens filled; same checks)
  await a.goto(base + `/segments/${segId("Rv RA three")}`); await a.click("text=[ EDIT ]"); await idle(a);
  const editUrl = a.url(); const nm = await a.locator('input[name="name"]').inputValue();
  const stageSel = await a.locator('select[name="stageId"]').evaluate((s) => s.options[s.selectedIndex].text);
  const condCount = await a.locator(".cond").count();
  await a.fill('input[name="name"]', "Rv pipe open"); t = await save(a); const dupMsg = t.includes("There is already a segment called Rv pipe open.");
  await a.fill('input[name="name"]', "Rv RA three renamed"); t = await save(a);
  check("US3 scenario 1", editUrl.endsWith("/edit") && nm === "Rv RA three" && stageSel === "RA" && condCount === 3 && dupMsg && t.includes("Rv RA three renamed"), `edit url ${editUrl}, name ${nm}, stage ${stageSel}, ${condCount} conditions, dup refused ${dupMsg}, rename ok`);

  // US3-2
  const sid = segId("Rv RA three renamed");
  await a.goto(base + `/segments/${sid}/edit`); await g.goto(base + `/segments/${sid}/edit`); await idle(a); await idle(g);
  await a.fill('input[name="name"]', "Rv by Ada"); await save(a);
  await g.fill('input[name="name"]', "Rv by Grace"); t = await save(g);
  check("US3 scenario 2", t.includes("Someone else changed this segment. Open it again to see their changes.") && q(`select name from segments where id=${sid}`) === "Rv by Ada", `Grace sees: ${t.includes("Someone else changed")}; stored name ${q(`select name from segments where id=${sid}`)}`);

  // US3-3
  await a.goto(base + `/segments/${sid}`); await a.click("text=[ DELETE ]"); await idle(a); const conf = await main(a);
  const cancel = a.locator("text=[ CANCEL ]").first(); await cancel.click(); await idle(a); const stillThere = q(`select count(*) from segments where id=${sid}`) === "1";
  await a.goto(base + `/segments/${sid}`); await a.click("text=[ DELETE ]"); await idle(a);
  await a.locator('form button:has-text("DELETE")').last().click(); await idle(a); const after = await main(a);
  const gList = await (await g.goto(base + "/segments"), main(g));
  check("US3 scenario 3", conf.includes("Delete the segment Rv by Ada?") && stillThere && a.url().endsWith("/segments") && after.includes("Segment Rv by Ada deleted.") && !gList.includes("Rv by Ada"),
    `confirm text ok ${conf.includes("Delete the segment Rv by Ada?")}, cancel kept ${stillThere}, after ${a.url()} msg ${after.includes("Segment Rv by Ada deleted.")}, gone for Grace ${!gList.includes("Rv by Ada")}`);

  // US3-4
  await openNew(a); await a.fill('input[name="name"]', "Rv gone"); await save(a); const gid = segId("Rv gone");
  await g.goto(base + `/segments/${gid}/edit`); await idle(g);
  const g2 = await ctxG.newPage(); await g2.goto(base + `/segments/${gid}?confirm=delete`); await idle(g2);
  q(`delete from segments where id=${gid}`);
  await g.fill('input[name="name"]', "Rv gone again"); t = await save(g); const s1 = t.includes("This segment no longer exists.");
  await g2.locator('form button:has-text("DELETE")').last().click(); await idle(g2); const s2 = (await main(g2)).includes("This segment no longer exists.");
  await g.goto(base + `/segments/${gid}`); const s3 = (await bodyText(g)).includes("This segment no longer exists.");
  check("US3 scenario 4", s1 && s2 && s3 && q("select count(*) from segments where name like 'Rv gone%'") === "0", `save ${s1}, delete ${s2}, open ${s3}`);

  // Edge 1
  await openNew(a); await a.fill('input[name="name"]', "Rv everyone"); await save(a); const eid = segId("Rv everyone");
  const cnt = async (p, id) => +((await (await p.goto(base + `/segments/${id}`), main(p))).match(/REACHES NOW\s+(\d+)/i)[1]);
  const a1 = await cnt(a, eid), g1 = await cnt(g, eid); const adaPage = await main(a); const hiddenWords = (adaPage.match(/.{0,40}(hidden|private).{0,40}/gi) || []).join(" | ");
  q("update persons set private=false where first_name='Rv' and last_name='G1'"); const a2 = await cnt(a, eid), g2c = await cnt(g, eid);
  q("update persons set private=true where first_name='Rv' and last_name='G1'");
  const raA = reaches(await (async () => { await openNew(a); await a.fill('input[name="name"]', "x"); await who(a, "stage", "RevPipe", "RA"); return countAgain(a); })());
  const raG = reaches(await (async () => { await openNew(g); await g.fill('input[name="name"]', "x"); await who(g, "stage", "RevPipe", "RA"); return countAgain(g); })());
  check("Edge case 1", a2 === a1 + 1 && g2c === g1 && raA === "3" && raG === "4" && !/hidden|private/i.test(adaPage),
    `G1 private: Ada ${a1}, Grace ${g1}; G1 shared: Ada ${a2}, Grace ${g2c} (Grace sees G1 Ada not); Grace's private deal Rv D10: Ada RA ${raA}, Grace RA ${raG}; words on Ada's page: ${hiddenWords}`);

  // Edge 3
  await openNew(a); await a.fill('input[name="name"]', "Rv nobody"); await addCond(a, "Role"); await a.locator('.cond input[aria-label="Role"]').fill("zzz-nobody");
  const z = await countAgain(a); t = await save(a); const zr = await rowText(a, "Rv nobody");
  check("Edge case 3", z.includes("Reaches 0 people now") && segId("Rv nobody") !== "" && zr && /\t0\t/.test(zr), `count ${z.includes("Reaches 0 people now")}; row ${JSON.stringify(zr)}`);

  // Edge 4
  await openNew(a); await a.fill('input[name="name"]', "Rv broken"); await who(a, "stage", "DelPipe", "DA");
  await addCond(a, "Organisation"); await pick(a, "Organisation", "Rv TempOrg");
  await addCond(a, "Rv Opted (fake)"); await a.locator('.cond select[aria-label="Rv Opted (fake)"]').selectOption("yes");
  const brokenBefore = reaches(await countAgain(a)); await save(a); const bid = segId("Rv broken");
  // Diet choice removed later: segment on a Diet choice a person has
  const dietChoice = q("select c.name from custom_field_choices c join custom_values v on v.choice_id=c.id join persons p on p.id=v.person_id where p.private=false and p.archived_at is null and p.consent='subscribed' and exists(select 1 from person_emails e where e.person_id=p.id) limit 1");
  await openNew(a); await a.fill('input[name="name"]', "Rv diet"); await addCond(a, "Diet (fake)"); await pick(a, "Diet (fake)", dietChoice); await save(a); const did = segId("Rv diet");
  const dietBefore = await cnt(a, did);
  await openNew(a); await a.fill('input[name="name"]', "Rv alan"); await addCond(a, "Owner"); await pick(a, "Owner", "Alan Fake"); await save(a);
  const alanCount = await cnt(a, segId("Rv alan"));
  const alanSql = q("select count(*) from persons p where p.owner_id=5 and (not p.private or p.created_by=1 or p.owner_id=1) and p.archived_at is null and p.consent='subscribed' and exists(select 1 from person_emails e where e.person_id=p.id)");
  q("delete from deals where title='Rv DZ'"); q("delete from stages where name='DA'"); q("delete from pipelines where name='DelPipe'");
  q("delete from organisations where name='Rv TempOrg'"); q("delete from custom_fields where name='Rv Opted (fake)'");
  q(`update custom_field_choices set removed_at=now() where name='${dietChoice}'`);
  const dietAfter = await cnt(a, did);
  await a.goto(base + `/segments/${bid}`); const bp = await main(a);
  const br = await rowText(a, "Rv broken");
  await a.goto(base + `/segments/${bid}/edit`); await idle(a); const bf = await a.locator("form.segform").innerText(); const bfSel = await a.locator('select[name="pipelineId"]').evaluate((s) => s.options[s.selectedIndex].text);
  const dr = await rowText(a, "Rv diet"); await a.goto(base + `/segments/${did}`); const dp = await main(a);
  const BM = "This segment refers to something that was deleted. Edit it before using it.";
  check("Edge case 4", brokenBefore === "1" && bp.includes(BM) && br && br.includes(BM) && /\t0\t/.test(br) && bp.includes("(deleted)") && br.includes("(deleted)") && bfSel === "(deleted)" && bf.includes("(deleted)") &&
    partnerBefore === partnerAfter && dietBefore === dietAfter && dietBefore > 0 && String(alanCount) === alanSql && alanCount > 0,
    `broken before ${brokenBefore}; page msg ${bp.includes(BM)}; row ${JSON.stringify(br)}; form pipeline ${bfSel}; diet "${dietChoice}" before ${dietBefore} after ${dietAfter}, diet page: ${dp.replace(/\s+/g, " ").slice(-120)}; label Partner removed: ${partnerBefore} → ${partnerAfter}; Alan Fake owner ${alanCount} (sql ${alanSql})`);

  // Edge 5 — move Rv D9 (only person M1) from RB to RA on the deal page
  const rb1 = await cnt(a, rbId);
  await a.goto(base + `/deals/${q("select id from deals where title='Rv D9'")}`); await idle(a); await a.click('button[aria-label="Move to RA"]'); await idle(a);
  const rb2 = await cnt(a, rbId);
  check("Edge case 5", rb1 === 2 && rb2 === 1 && q("select s.name from deals d join stages s on s.id=d.stage_id where d.title='Rv D9'") === "RA", `RB before ${rb1}, after the move ${rb2}`);

  // Edge 6
  await openNew(a); await a.fill('input[name="name"]', "Rv old org"); await addCond(a, "Organisation"); await pick(a, "Organisation", "Old Fakeco Archive"); await save(a);
  const oc = await cnt(a, segId("Rv old org"));
  const osql = q("select count(*) from persons p join organisations o on o.id=p.organisation_id where o.name='Old Fakeco Archive' and (not p.private or p.created_by=1 or p.owner_id=1) and p.archived_at is null and p.consent='subscribed' and exists(select 1 from person_emails e where e.person_id=p.id)");
  check("Edge case 6", String(oc) === osql && oc >= 1, `count ${oc}, expected (sql) ${osql}`);

  // Edge 7
  await openNew(a); await a.fill('input[name="name"]', "<b>Test</b>"); await save(a);
  await a.goto(base + "/segments"); const links = await a.locator("table a").allInnerTexts(); const link = { count: async () => links.filter((x) => x === "<b>Test</b>").length }; const bold = await a.locator("table b").count();
  await a.goto(base + "/segments/987654"); const nf1 = await bodyText(a);
  await a.goto(base + "/segments/abc%3Cscript%3E"); const nf2 = await bodyText(a);
  await a.goto(base + "/segments/987654/edit"); const nf3 = await bodyText(a);
  await a.goto(base + `/segments/new?name=XSSPROBE1&who=XSSPROBE2&c.0.field=role&c.0.value=XSSPROBE3`); const np = (await a.innerText("body")) + (await a.locator("input,select").evaluateAll((els) => els.map((e) => e.value).join(" ")));
  await a.goto(base + `/segments/${rbId}?confirm=XSSPROBE4&x=XSSPROBE5`); const sp = await a.innerText("body");
  check("Edge case 7", (await link.count()) === 1 && bold === 0 && nf1.includes("This segment no longer exists.") && nf2.includes("This segment no longer exists.") && nf3.includes("This segment no longer exists.") && !/XSSPROBE/.test(np + sp),
    `link as typed ${await link.count()}, <b> in table ${bold}, made-up id: ${nf1.includes("This segment no longer exists.")}/${nf2.includes("This segment no longer exists.")}/${nf3.includes("This segment no longer exists.")}, probes echoed ${/XSSPROBE/.test(np + sp)}`);

  // Edge 8
  const anon = await (await b.newContext()).newPage(); await anon.goto(base + "/segments"); await idle(anon); const anonUrl = anon.url();
  const ctxM = await b.newContext(); const m = await ctxM.newPage(); await signIn(m, base, "margaret@barnacle.ai", "Margaret Fake");
  await openNew(m); await m.fill('input[name="name"]', "Rv by deactivated");
  q("update users set status='deactivated' where email='margaret@barnacle.ai'");
  await m.click("text=[ SAVE ]"); await m.waitForTimeout(1500); await idle(m); const mUrl = m.url(); const mBody = await bodyText(m);
  await m.goto(base + "/segments"); await idle(m); const mUrl2 = m.url();
  q("update users set status='active' where email='margaret@barnacle.ai'");
  check("Edge case 8", /sign-in/.test(anonUrl) && segId("Rv by deactivated") === "" && !/\/segments$/.test(mUrl2), `signed out → ${anonUrl}; deactivated save → ${mUrl} (${mBody.replace(/\s+/g, " ").slice(0, 100)}), saved: ${segId("Rv by deactivated") !== ""}; /segments → ${mUrl2}`);

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
