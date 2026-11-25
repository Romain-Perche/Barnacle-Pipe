// SF-124 AI review, part c: Edge cases 1 (disconnect / deactivation) and 2 (key refused), plus the reassignment while
// the old assignee's connection needs reconnecting. Run after parts a and b (Ada and Margaret connected, Linus disconnected).
// Run: NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf124-c.js
const H = require("./sf124-lib");
const { A, L, M, q, live, evOf, eventId, act, uid, R, norm, sleep, pageAs, card, connect, schedule, edit, changeEvent, fakeBtn, runCheck, BASE } = H;

(async () => {
  const browser = await H.lib.chromium.launch();
  const ap = await pageAs(browser, A);
  const lp = await pageAs(browser, L);
  const fresh = (subject, dueOn, dueTime = "10:00") => schedule(ap, { type: "Call", subject, dueOn, dueTime, duration: 30 });

  // ---- Edge case 1 ----
  {
    const id = await fresh("SF124 E1 keep", "2026-12-28");
    const ev = H.events(A).find((e) => e.id === eventId(id));
    await ap.goto(BASE + "/settings?disconnect=1"); await ap.getByRole("alertdialog").getByRole("button", { name: "[ DISCONNECT ]" }).click(); await ap.waitForLoadState("networkidle");
    const st = q(`select state from gmail_connections where user_id=1`);
    await edit(ap, id, { dueOn: "2026-12-29", dueTime: "11:00" });
    const after = H.events(A).find((e) => e.id === ev.id);
    await ap.goto(BASE + "/activities?when=planned"); const shown = await ap.locator("tr", { hasText: "SF124 E1 keep" }).count();
    // deactivation: Margaret's event stays
    const mAct = q(`select id from activities where subject='SF124 M tomorrow'`);
    const mEv = H.events(M).find((e) => e.id === eventId(mAct));
    await ap.goto(BASE + "/admin/users");
    await H.lib.rowAction(ap, M, "Deactivate");
    if (q(`select status from users where email='${M}'`) !== "deactivated") {
      const sel = ap.locator("select").first(); if (await sel.count()) { const v = await sel.locator("option").nth(1).getAttribute("value"); if (v) await sel.selectOption(v); }
      await Promise.all([ap.waitForLoadState("networkidle"), ap.locator("button", { hasText: /DEACTIVATE/i }).last().click()]);
      await sleep(800);
    }
    const mst = q(`select status from users where email='${M}'`);
    await edit(ap, mAct, { dueTime: "13:00" });
    const mAfter = H.events(M).find((e) => e.id === mEv.id);
    // connect again
    await connect(ap); await sleep(3000);
    const due = q(`select string_agg(id::text, ',') from activities where assignee_id=1 and done_at is null and due_on >= (now() at time zone 'Europe/London')::date`).split(",");
    const ended = q(`select coalesce(string_agg(activity_id::text, ','), '') from calendar_events where state='ended'`).split(",");
    const counts = due.filter((i) => !ended.includes(i)).map((i) => [i, live(A).filter((e) => e.extendedProperties?.private?.barnacleCrmActivity === i || e.id === eventId(i)).length]);
    const bad = counts.filter(([, n]) => n !== 1);
    const e1 = live(A).filter((e) => e.extendedProperties?.private?.barnacleCrmActivity === String(id));
    R("Edge case 1", st === "disconnected" && JSON.stringify(after) === JSON.stringify(ev) && shown === 1 && mst === "deactivated" && JSON.stringify(mAfter) === JSON.stringify(mEv) && bad.length === 0,
      `disconnected (${st}): event unchanged after rescheduling ${JSON.stringify(after) === JSON.stringify(ev)}, activity on list ${shown}x; Margaret deactivated (${mst}): her event unchanged after rescheduling ${JSON.stringify(mAfter) === JSON.stringify(mEv)}; after Ada reconnects: ${counts.length} planned (not ended) activities due today or later, ones without exactly one event: ${JSON.stringify(bad)}; E1 event now ${e1.map((e) => e.start.dateTime).join(",")}`);
  }

  // ---- Edge case 2 ----
  {
    const id = await fresh("SF124 E2 a", "2026-12-28", "09:00");
    const id2 = await fresh("SF124 E2 b", "2026-12-28", "15:00");
    const ev2 = eventId(id2);
    await H.fakePage(ap, A);
    await ap.goto(BASE + "/dev/fake-gmail?user=" + A);
    await Promise.all([ap.waitForURL(/done=/), ap.locator("button", { hasText: "[ REFUSE THE KEY ]" }).first().click()]);
    await runCheck(ap, A);
    const c = await card(ap);
    await edit(ap, id, { dueTime: "10:30" });
    const err1 = norm((await ap.locator("p.err").allInnerTexts()).join(" "));
    const id3 = await fresh("SF124 E2 new", "2026-12-29", "09:00");
    const err2 = norm((await ap.locator("p.err").allInnerTexts()).join(" "));
    await changeEvent(ap, A, ev2, { date: "2026-12-28", start: "17:00", end: "17:30" });
    const mid = act(id2).dueTime;
    const r = await connect(ap); await sleep(2500);
    await runCheck(ap, A);
    const e1 = H.events(A).find((e) => e.id === eventId(id));
    const e3 = evOf(A, id3);
    const a2 = act(id2);
    R("Edge case 2", c.includes("Gmail · needs reconnecting") && !err1 && !err2 && !!id3 && mid === "15:00" && e1.start.dateTime === "2026-12-28T10:30:00.000Z" && e3.length === 1 && a2.dueTime === "17:00",
      `card while refused "${c}"; errors after edit "${err1}", after schedule "${err2}"; moved in Google meanwhile → CRM still ${mid}; after reconnect ("${r.card.slice(0, 40)}…") + check: edited event ${e1.start.dateTime}, new activity events ${e3.length}, moved activity due ${a2.dueTime}`);
  }

  // ---- extra (code review finding): reassign while the old assignee's connection needs reconnecting ----
  {
    await connect(lp); await sleep(2000);
    const id = await fresh("SF124 reassign while refused", "2026-12-30");
    const ev = eventId(id);
    await ap.goto(BASE + "/dev/fake-gmail?user=" + A);
    await Promise.all([ap.waitForURL(/done=/), ap.locator("button", { hasText: "[ REFUSE THE KEY ]" }).first().click()]);
    await runCheck(ap, A);
    const st = q(`select state from gmail_connections where user_id=1`);
    await edit(ap, id, { assignee: uid(L) });
    await runCheck(ap, A);
    const inL = evOf(L, id).length;
    await connect(ap); await sleep(2500); await runCheck(ap, A);
    const stale = live(A).filter((e) => e.id === ev).length;
    R("Extra reassign while refused", stale === 0, `Ada ${st}, call reassigned to Linus (events in Linus's ${inL}); after Ada reconnects and a check, her old event ${ev} still live: ${stale}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
