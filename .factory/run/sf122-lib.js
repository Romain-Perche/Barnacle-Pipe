// Helpers for the SF-122 AI-review scripts (Pipedrive import of deals, notes, activities, files).
// Needs the app on :3001 (PIPEDRIVE_URL=http://localhost:9400) and the stand-in Pipedrive on :9400 (see .factory/test-env.md).
// setupData() resets the stand-in and the database (reset-db.sh), then adds the SF-122 scenario data on top of the dev fake
// and returns the Pipedrive ids it made (saved to $TMPDIR/sf122-ids.json).
const { execFileSync } = require("child_process");
const fs = require("fs");
const L = require("./sf117-lib");
const CO = 1001;
const pidOf = (i) => 60 + i; // dev fake person i
const orgOf = (i) => i; // dev fake organisation i (ids 1–60)
const b64 = (s) => ({ __b64: Buffer.from(s).toString("base64") });

async function setupData() {
  execFileSync("bash", [".factory/run/reset-db.sh"], { stdio: "ignore" });
  await L.ctl("reset");
  const c = (op, ...a) => L.ctl(op, CO, ...a);
  const ids = {};
  // CRM side: a deal custom field "Budget" (number); deal label "Hot" exists (seed), "Strategic" does not.
  L.q("insert into custom_fields (kind,name,type,position,in_list) values ('deal','Budget','number',3,true)");
  await L.ctl("addUser", CO, { id: 4, name: "Grace Pipedrive Fake", email: "grace@barnacle.ai" });
  await c("addField", "deal", { field_code: "fake_deal_field_02", field_name: "Region", field_type: "varchar", is_custom_field: true });
  await c("addActivityType", "fake_visit", "Site visit");
  // People: linked to existing CRM people (Bob shared, Dora private of Linus), a private one of Margaret.
  ids.bob = await c("addPerson", { name: "Bob Pdname Fake", first_name: "Bob", last_name: "Pdname Fake", owner_id: 1, emails: [{ value: "bob.placeholder@example.net", primary: true, label: "work" }] });
  ids.dora = await c("addPerson", { name: "Dora Pdname Fake", first_name: "Dora", last_name: "Pdname Fake", owner_id: 1, emails: [{ value: "dora.ambassador@example.com", primary: true, label: "work" }] });
  ids.margPriv = await c("addPerson", { name: "Margprivate Fake", first_name: "Margprivate", last_name: "Fake", owner_id: 2, visible_to: 1, emails: [{ value: "margprivate@fake.example", primary: true, label: "work" }] });
  ids.noName = pidOf(99);
  // Pipelines
  const sales = await c("addPipeline", { name: "sales ", order_nr: 3 });
  const st = {};
  for (const n of ["lead in", "Qualified", "qualified ", "Demo Fake", "Proposal"]) st[n] = await c("addStage", { pipeline_id: sales, name: n });
  const SALES = await c("addPipeline", { name: "SALES", order_nr: 4 });
  const SALESp = await c("addStage", { pipeline_id: SALES, name: "Proposal" });
  const empty = await c("addPipeline", { name: "Fake Empty Pipeline", order_nr: 5 });
  await c("addStage", { pipeline_id: empty, name: "Empty One" }); await c("addStage", { pipeline_id: empty, name: "Empty Two" });
  const longP = await c("addPipeline", { name: "P".repeat(101), order_nr: 6 });
  const longPs = await c("addStage", { pipeline_id: longP, name: "Fine stage" });
  const fakeSalesLong = await c("addStage", { pipeline_id: 0 + (await fakeSalesId()), name: "S".repeat(101) });
  ids.stages = st;
  const deal = (title, x = {}, extra = {}) => c("addDeal", { title, owner_id: 1, stage_id: st["lead in"], person_id: pidOf(4), add_time: "2025-06-01 09:00:00", ...x }, extra);
  ids.dLeadIn = await deal("SF122 lead in deal", { value: 1234.56, stage_change_time: "2025-10-20 10:00:00", expected_close_date: "2026-12-31", org_id: orgOf(4),
    label_ids: [31, 32], custom_fields: { fake_deal_field_01: 4200, fake_deal_field_02: "North" } }, { followers: [1, 2, 3], participants: [pidOf(4), pidOf(5), pidOf(99)] });
  ids.dQual1 = await deal("SF122 qualified A", { stage_id: st["Qualified"] });
  ids.dQual2 = await deal("SF122 qualified B", { stage_id: st["qualified "] });
  ids.dDemo = await deal("SF122 demo deal", { stage_id: st["Demo Fake"] });
  ids.dSALES = await deal("SF122 SALES deal", { stage_id: SALESp });
  ids.dLongP = await deal("SF122 long pipeline deal", { stage_id: longPs });
  ids.dLongS = await deal("SF122 long stage deal", { stage_id: fakeSalesLong });
  ids.dNoPerson = await deal("SF122 no person deal", { person_id: pidOf(99) });
  ids.dNoOrg = await deal("SF122 no org deal", { org_id: orgOf(60) });
  ids.dPriv2 = await deal("SF122 private Margaret", { owner_id: 2, visible_to: 1 });
  ids.dLostLong = await deal("SF122 lost long reason", { status: "lost", lost_time: "2025-11-03 12:00:00", lost_reason: "R".repeat(501) });
  ids.dEmpty = await deal("", {});
  ids.dLongTitle = await deal("T".repeat(201), {});
  ids.dBigVal = await deal("SF122 big value", { value: 1e13 });
  ids.dNeg = await deal("SF122 negative value", { value: -5 });
  ids.dBadDate = await deal("SF122 bad date", { expected_close_date: "2026-02-30" });
  ids.dBob = await deal("SF122 Bob deal", { person_id: ids.bob });
  ids.dDora = await deal("SF122 Dora deal", { person_id: ids.dora });
  ids.dMargPriv = await deal("SF122 Margprivate deal", { person_id: ids.margPriv });
  ids.dXss = await deal('<a href="https://evil.example">Click</a>', {});
  // Notes
  const note = (content, x = {}) => c("addNote", { content, user_id: 1, add_time: "2025-10-15 08:30:00", ...x });
  ids.nDealPerson = await note("<p>SF122 note on deal and person</p>", { deal_id: ids.dLeadIn, person_id: pidOf(4), add_time: "2025-10-16 14:45:00", user_id: 2 });
  ids.nPersonOrg = await note("<p>SF122 note on person and org</p>", { person_id: pidOf(5), org_id: orgOf(5), user_id: 3 });
  ids.nNoPersonDeal = await note("<p>SF122 note on missing deal</p>", { deal_id: ids.dNoPerson });
  ids.nNoName = await note("<p>SF122 note on nameless person</p>", { person_id: pidOf(99) });
  ids.nLong = await note("<p>" + "N".repeat(100001) + "</p>", { person_id: pidOf(4) });
  ids.nEmpty = await note("<p> </p><br>", { person_id: pidOf(4) });
  ids.nPriv = await note("<p>SF122 note on private deal</p>", { deal_id: ids.dPriv2 });
  ids.nXss = await note('<p><a href="https://evil.example">Click</a> &lt;b&gt;x&lt;/b&gt;</p><ul><li>one</li><li>two</li></ul>', { deal_id: ids.dXss });
  ids.nLead2 = await note("<p>SF122 note on lead</p>", { lead_id: "fake-lead-2" });
  // Activities
  const act = (subject, x = {}) => c("addActivity", { subject, owner_id: 1, type: "call", due_date: "2026-12-10", ...x });
  ids.aWinter = await act("SF122 winter call", { deal_id: ids.dLeadIn, person_id: pidOf(4), org_id: orgOf(4), due_time: "14:00", duration: "00:45", note: "<p>Agenda <b>one</b></p>" });
  ids.aSummer = await act("SF122 summer meeting", { type: "meeting", person_id: pidOf(4), due_date: "2027-07-01", due_time: "14:00", duration: "01:00" });
  ids.aGrace = await act("SF122 task for Grace", { type: "task", owner_id: 4, deal_id: ids.dDemo, due_date: "2026-11-20" });
  ids.aToday = await act("SF122 today call", { deal_id: ids.dQual1, due_date: "2026-11-24" });
  ids.aJane = await act("SF122 Jane call", { owner_id: 3, due_date: "2026-12-11" });
  ids.aVisit = await act("SF122 site visit", { type: "fake_visit", person_id: pidOf(5) });
  ids.aDone = await act("SF122 done call", { person_id: pidOf(6), done: true, marked_as_done_time: "2026-11-02 15:30:00", due_date: "2026-11-02", due_time: "15:00" });
  ids.aDoneOld = await act("SF122 done old meeting", { type: "meeting", person_id: pidOf(6), done: true, marked_as_done_time: "2024-01-02 10:00:00", due_date: "2024-01-02" });
  ids.aNoDeal = await act("SF122 activity on missing deal", { deal_id: ids.dNoPerson });
  ids.aNothing = await act("SF122 activity on nothing", {});
  ids.aLead = await act("SF122 activity on lead", { lead_id: "fake-lead-3" });
  ids.aProject = await act("SF122 activity on project", { project_id: 77 });
  ids.aLongNote = await act("SF122 long note activity", { note: "x".repeat(10001) });
  ids.aEmptySubj = await act("", {});
  ids.aLongSubj = await act("A".repeat(201), {});
  ids.aNoDue = await act("SF122 no due date", { due_date: null });
  ids.aDur7 = await act("SF122 duration 7", { due_time: "10:00", duration: "00:07" });
  ids.aDur25 = await act("SF122 duration 25h", { due_time: "10:00", duration: "25:00" });
  ids.aPriv = await act("SF122 activity on private deal", { deal_id: ids.dPriv2 });
  ids.aXss = await act('<a href="https://evil.example">Click</a>', {});
  // Files
  const file = (meta, bytes) => c("addFile", { user_id: 1, add_time: "2025-10-07 09:15:00", ...meta }, bytes);
  ids.fDealPerson = await file({ name: "sf122 deal+person.pdf", deal_id: ids.dLeadIn, person_id: pidOf(4), user_id: 2 }, b64("%PDF-1.4\n% sf122 deal person\n%%EOF\n"));
  ids.fPersonOrg = await file({ name: "sf122 person+org.png", person_id: pidOf(5), org_id: orgOf(5), user_id: 3 }, { __b64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" });
  ids.fNoName = await file({ name: "sf122 nameless.pdf", person_id: pidOf(99) }, b64("%PDF-1.4\nx\n"));
  ids.fLongName = await file({ name: "L".repeat(252) + ".pdf", deal_id: ids.dLeadIn }, b64("%PDF-1.4\nx\n"));
  ids.fGone = await file({ name: "sf122 gone.pdf", deal_id: ids.dLeadIn }, b64("%PDF-1.4\ngone\n"));
  await c("loseFileBytes", ids.fGone);
  ids.fXss = await file({ name: '<a href="https://evil.example">Click</a>.txt', deal_id: ids.dXss }, b64("hello xss\n"));
  ids.fPriv = await file({ name: "sf122 private.pdf", deal_id: ids.dPriv2 }, b64("%PDF-1.4\npriv\n"));
  ids.fLead = await file({ name: "sf122 on lead.pdf", lead_id: "fake-lead-4" }, b64("%PDF-1.4\nlead\n"));
  fs.writeFileSync((process.env.TMPDIR || "/tmp") + "/sf122-ids.json", JSON.stringify(ids));
  return ids;
}
async function fakeSalesId() {
  // the dev fake's "Fake Sales" pipeline is its first pipeline: read it back through the API
  const r = await fetch(L.PD + "/api/v2/pipelines", { headers: { "x-api-token": "fake-pipedrive-token" } });
  const j = await r.json();
  return j.data.find((p) => p.name === "Fake Sales").id;
}
async function startAll(page, { consent = "subscribed", kinds = ["people", "organisations", "deals", "notes", "activities", "files"] } = {}) {
  await page.goto(L.BASE + "/settings/pipedrive-import?new=1");
  for (const k of kinds) if (!(await page.locator(`input[type=checkbox][name="${k}"]`).first().isChecked())) await page.check(`input[type=checkbox][name="${k}"]`);
  if (consent && (await page.locator(`input[name="consent"][value="${consent}"]`).isVisible())) await page.check(`input[name="consent"][value="${consent}"]`);
  await Promise.all([page.waitForLoadState("networkidle"), page.click("text=[ IMPORT ]")]);
  await page.waitForTimeout(500);
}
async function reportText(page) { return (await page.textContent("main")).replace(/\s+/g, " "); }
module.exports = { ...L, CO, pidOf, orgOf, b64, setupData, startAll, reportText };
