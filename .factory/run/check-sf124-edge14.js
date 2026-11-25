// SF-124 Edge case 14 (Calendar not set up): app on :3003 started with CALENDAR_SYNC= (same crm_dev and .fake-gmail as :3000):
// PORT=3003 SKIP_BUILD=1 SKIP_SEED=1 CALENDAR_SYNC= bash .factory/run/start-app.sh. Grace connects there and schedules.
const H = require("./sf124-lib");
const B = "http://localhost:3003";
(async () => {
  const b = await H.lib.chromium.launch(); const p = await H.pageAs(b, H.G, B);
  const r = await H.connect(p, { base: B });
  const w = await H.warn(p);
  const page404 = (await fetch(B + "/dev/fake-calendar")).status;
  await p.goto(B + "/activities?activity=new"); await p.getByRole("dialog").waitFor();
  await H.fillBox(p, { type: "Call", subject: "SF124 calendar off", dueOn: "2026-12-30", dueTime: "10:00", duration: 30 });
  await p.getByRole("dialog").getByRole("button", { name: "[ SAVE ]" }).click(); await p.waitForLoadState("networkidle"); await H.sleep(2000);
  const saved = H.actCount("subject='SF124 calendar off'");
  await p.goto(B + "/activities?when=planned"); const shown = await p.locator("tr", { hasText: "SF124 calendar off" }).count();
  const anywhere = [H.A, H.L, H.G, H.M].map((u) => H.events(u).filter((e) => (e.summary || "").includes("SF124 calendar off")).length);
  const scopes = H.q(`select scopes from gmail_connections where user_id=${H.uid(H.G)}`);
  const ok = r.consent.length === 2 && !r.card.includes("Calendar") && r.card.includes("Gmail · connected") && w === 0 && saved === 1 && shown === 1 && anywhere.every((n) => n === 0) && page404 === 404;
  H.R("Edge case 14", ok, `consent boxes ${JSON.stringify(r.consent)}; card "${r.card}"; "!" ${w}; stored scopes "${scopes}"; activity saved ${saved}, on list ${shown}x; events anywhere ${anywhere.join("/")}; /dev/fake-calendar ${page404}`);
  await b.close();
})();
