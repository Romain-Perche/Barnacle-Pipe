// SF-124 Edge case 9 (archived person): the activity's [ EDIT ] is not offered on the archived person's page, and an
// edit posted for it anyway (another activity's edit box pointed at it, as SF-109's review did) is refused with the
// SF-109 message. Run after scenarios-sf124-b.js "Edge case 9".
const H = require("./sf124-lib");
(async () => {
  const b = await H.lib.chromium.launch(); const p = await H.pageAs(b, H.A);
  const id = H.q("select id from activities where subject='SF124 archived person'");
  const pid = H.q(`select person_id from activities where id=${id}`);
  await p.goto(H.BASE + `/people/${pid}`); await p.waitForLoadState("networkidle");
  const nx = p.getByRole("region", { name: "Next activities" });
  console.log("activity edit links in next activities:", await nx.getByRole("link", { name: /EDIT|Edit/ }).count());
  const other = H.q("select id from activities where subject='SF124 crm made'");
  await p.goto(H.BASE + `/activities?when=planned&assignee=all&activity=${other}`); await p.getByRole("dialog").waitFor();
  const v = H.q(`select version from activities where id=${id}`);
  await p.locator('dialog, [role=dialog]').locator('input[name="id"]').evaluate((e, x) => (e.value = String(x)), id);
  await p.locator('[role=dialog] input[name="version"]').evaluate((e, x) => (e.value = String(x)), v);
  await p.getByRole("dialog").getByLabel("Subject").fill("SF124 try edit");
  await H.saveBox(p);
  console.log("refused with message:", (await p.textContent("main")).includes("Restore this record before changing its activities."), "subject now:", H.act(id).subject, "due", H.act(id).dueOn);
  await b.close();
})();
