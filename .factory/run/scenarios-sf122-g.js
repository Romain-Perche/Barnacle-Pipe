// SF-122 AI review round 2, part g (app :3001, fresh data each run): Edge 10 (records private to another owner that give a
// warning or are not imported are never named in the importer's report; the owner's own import names them) and Edge 18
// (Pipedrive slows down every 3rd / 4th call during the whole import; deals with followers and participants all come in once).
// Usage: SLOW=3 WHO=ada node scenarios-sf122-g.js  (WHO=margaret: Margaret runs the import; output $TMPDIR/sf122-g-<WHO>-<SLOW>.json)
const L = require("./sf122-lib");
const fs = require("fs");
const TMP = process.env.TMPDIR || "/tmp";
const WHO = process.env.WHO || "ada", SLOW = +(process.env.SLOW || 3);
const t = async (p) => (await p.locator("main").innerText()).replace(/[ \t]+/g, " ");
(async () => {
  const ids = await L.setupData();
  const c = (op, ...a) => L.ctl(op, L.CO, ...a);
  const P = ids.dPriv2; // "SF122 private Margaret" (owner 2, visible_to 1)
  const secret = {};
  secret.usd = "SF122 E10 secret USD deal";
  await c("addDeal", { title: secret.usd, owner_id: 2, visible_to: 1, stage_id: ids.stages["Proposal"], person_id: L.pidOf(4), value: 9, currency: "USD" });
  secret.note = "SECRETNOTE" + "x".repeat(100001);
  await c("addNote", { content: "<p>" + secret.note + "</p>", user_id: 2, deal_id: P });
  secret.subj = "SECRETSUBJ" + "y".repeat(191);
  await c("addActivity", { subject: secret.subj, owner_id: 2, type: "call", due_date: "2026-12-12", deal_id: P });
  secret.file = "SECRETFILE big.bin";
  await c("addFile", { name: secret.file, user_id: 2, deal_id: P }, { __fill: [27_400_000, 66] });
  secret.person = "Secretperson Noorgfake";
  await c("addPerson", { name: secret.person, first_name: "Secretperson", last_name: "Noorgfake", owner_id: 2, visible_to: 1, org_id: L.orgOf(60), emails: [{ value: "secretperson@fake.example", primary: true, label: "work" }] });
  // Edge 18: 8 deals with followers and participants
  const fp = [];
  for (let i = 0; i < 8; i++) fp.push(await c("addDeal", { title: `SF122 E18 deal ${i}`, owner_id: 1, stage_id: ids.stages["Proposal"], person_id: L.pidOf(40 + i) }, { followers: [1, 2], participants: [L.pidOf(40 + i), L.pidOf(20 + i), L.pidOf(30 + i)] }));
  await L.ctl("slowDownEvery", SLOW, 1);
  const browser = await L.chromium.launch();
  const u = WHO === "ada" ? ["ada@barnacle.ai", "Ada Fake"] : ["margaret@barnacle.ai", "Margaret Fake"];
  const p = await L.newPage(browser, ...u);
  await L.saveToken(p, "fake-pipedrive-token");
  const t0 = Date.now();
  await L.startAll(p);
  await L.waitReport(p, 1500000);
  const out = { secs: Math.round((Date.now() - t0) / 1000) };
  await L.ctl("slowDownEvery", null);
  const rep = await t(p);
  out.report = rep.split("\n").filter((l) => !/Number of employees/.test(l)).join("\n");
  out.named = Object.fromEntries(Object.entries(secret).map(([k, v]) => [k, rep.includes(v.slice(0, 15))]));
  out.privLines = rep.split("\n").filter((l) => /private|Secret|SECRET/.test(l));
  out.e18 = fp.map((d) => L.q(`select d.title||' f='||(select string_agg(u.email,',' order by u.email) from deal_followers f join users u on u.id=f.user_id where f.deal_id=d.id)||' p='||(select count(*) from deal_people where deal_id=d.id)||' n='||(select count(*) from deals x where x.title=d.title) from deals d join pipedrive_links l on l.deal_id=d.id and l.kind='deal' where l.pipedrive_id=${d}`));
  out.dupLinks = L.q("select string_agg(kind||':'||n||'/'||dd, ' ') from (select kind, count(*) n, count(distinct pipedrive_id) dd from pipedrive_links group by kind) x");
  fs.writeFileSync(`${TMP}/sf122-g-${WHO}-${SLOW}.json`, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ secs: out.secs, named: out.named, privLines: out.privLines, e18: out.e18, dupLinks: out.dupLinks }, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
