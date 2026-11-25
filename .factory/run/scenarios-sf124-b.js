// SF-124 AI review, part b: US3 1-6, US4 1-5, 7, 8, Edge cases 3, 5-10, 12, 13. Run after part a on the same data
// (Ada, Linus and Margaret connected with Calendar, Ana Fake added by part a).
// Run: NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf124-b.js [name prefixes…]
const H = require("./sf124-lib");
const { A, L, G, q, live, evOf, eventId, act, uid, R, norm, sleep, pageAs, schedule, edit, tick, delAct, addEvent, changeEvent, eventBtn, fakeBtn, runCheck, push, person, actCount, BASE, ctl } = H;
const ONLY = process.argv.slice(2);
const want = (n) => !ONLY.length || ONLY.some((o) => n.startsWith(o));
const same = (a, b, keys) => keys.every((k) => a[k] === b[k]);

(async () => {
  const browser = await H.lib.chromium.launch();
  const ap = await pageAs(browser, A);
  const lp = await pageAs(browser, L);
  const org = q(`insert into organisations (name, created_by, owner_id) values ('Fake Ltd SF124', 1, 1) returning id`).split("\n")[0];
  let ana = q(`select person_id from person_emails where email='ana@example.test'`);
  if (!ana) ana = person("Ana", "Fake", ["ana@example.test", "ana.k@example.test"]);
  q(`update persons set organisation_id=${org} where id=${ana}`);
  const stage = q(`select id from stages order by pipeline_id, position, id limit 1`);
  const deal = q(`insert into deals (title, stage_id, owner_id, created_by, person_id) values ('SF124 Deal', ${stage}, 1, 1, ${ana}) returning id`).split("\n")[0];
  const fresh = async (subject, o = {}) => schedule(ap, { type: o.type || "Call", subject, dueOn: o.dueOn || "2026-12-02", dueTime: o.dueTime ?? "10:00", duration: o.duration ?? 30, note: o.note ?? "Bring the price list" }, o.path || `/deals/${deal}`);
  const KEEP = ["type", "note", "deal", "person", "org", "assignee", "done"];

  if (want("US3")) {
    const id = await fresh("Call Ada about the proposal US3");
    const ev = eventId(id);
    // US3-1
    await changeEvent(ap, A, ev, { date: "2026-12-04", start: "11:00", end: "12:00" });
    const a1 = act(id);
    await ap.goto(BASE + "/activities?when=planned&assignee=all"); const row = norm(await ap.locator("tr", { hasText: "Call Ada about the proposal US3" }).first().innerText());
    await ap.goto(BASE + `/deals/${deal}`); const dn = norm(await ap.getByRole("region", { name: "Next activities" }).innerText());
    await ap.goto(BASE + `/people/${ana}`); const pn = norm(await ap.getByRole("region", { name: "Next activities" }).innerText());
    await ap.goto(BASE + `/deals`); await ap.waitForLoadState("networkidle"); const cardT = norm(await ap.locator("a.card", { hasText: "SF124 Deal" }).first().innerText());
    R("US3 scenario 1", a1.dueOn === "2026-12-04" && a1.dueTime === "11:00" && a1.duration === "60" && /4 Dec/.test(row) && /11:00/.test(row) && /4 Dec/.test(dn) && /11:00/.test(dn) && /4 Dec/.test(pn) && /4 Dec|11:00|Thu/.test(cardT),
      `activity ${a1.dueOn} ${a1.dueTime} ${a1.duration} min; list row "${row}"; deal page "${dn}"; person page "${pn}"; board card "${cardT}"`);
    // US3-2
    await changeEvent(ap, A, ev, { date: "2026-12-05", allDay: true });
    const a2 = act(id);
    await changeEvent(ap, A, ev, { date: "2026-12-05", start: "14:00", end: "14:45" });
    const a3 = act(id);
    R("US3 scenario 2", a2.dueOn === "2026-12-05" && a2.dueTime === "" && a2.duration === "" && a3.dueOn === "2026-12-05" && a3.dueTime === "14:00" && a3.duration === "45",
      `all-day → ${a2.dueOn} time "${a2.dueTime}" duration "${a2.duration}"; back to 14:00–14:45 → ${a3.dueOn} ${a3.dueTime} ${a3.duration}`);
    // US3-3
    await changeEvent(ap, A, ev, { title: "Call · Call Ada about the new price" });
    const b1 = act(id);
    await changeEvent(ap, A, ev, { title: "Lunch plan SF124" });
    const b2 = act(id);
    R("US3 scenario 3", b1.subject === "Call Ada about the new price" && b1.type === "call" && b2.subject === "Lunch plan SF124" && b2.type === "call",
      `"Call · Call Ada about the new price" → subject "${b1.subject}" type ${b1.type}; "Lunch plan SF124" → "${b2.subject}" type ${b2.type}`);
    // US3-4
    await changeEvent(ap, A, ev, { date: "2026-12-06", start: "10:00", end: "10:30", deliver: false });
    const c0 = act(id);
    const notice = ctl("notice", A); // the lost notice, kept for later
    await runCheck(ap, A);
    const c1 = act(id);
    const r = await push(notice);
    await sleep(500);
    const c2 = act(id);
    R("US3 scenario 4", c0.dueOn === "2026-12-05" && c1.dueOn === "2026-12-06" && c1.dueTime === "10:00" && c1.duration === "30" && r.status === 204 && JSON.stringify(c1) === JSON.stringify(c2),
      `notice dropped: still ${c0.dueOn} ${c0.dueTime}; after check ${c1.dueOn} ${c1.dueTime} ${c1.duration} (v${c1.version}); late notice HTTP ${r.status} → v${c2.version} ${c2.dueOn} ${c2.dueTime}`);
    // US3-5
    const before = act(id);
    await changeEvent(ap, A, ev, { date: "2026-12-07", start: "09:00", end: "09:30" });
    const moved = act(id);
    ctl("change", A, ev, { description: "changed in Google", location: "Room 1", attendees: ["someone@unknown.test"] });
    const r5 = await push(ctl("notice", A)); await sleep(500);
    const after = act(id);
    R("US3 scenario 5", moved.dueOn === "2026-12-07" && same(before, moved, KEEP) && JSON.stringify(moved) === JSON.stringify(after) && r5.status === 204,
      `before ${JSON.stringify(before)}; moved ${JSON.stringify(moved)}; after description/place/guest change (HTTP ${r5.status}) ${JSON.stringify(after)}`);
    // US3-6
    const d0 = act(id);
    await eventBtn(ap, A, ev, 2);
    const d1 = act(id);
    const st = q(`select state from calendar_events where activity_id=${id}`);
    await edit(ap, id, { subject: "SF124 after google delete", dueTime: "15:00", duration: 30 });
    await tick(ap, id); await tick(ap, id);
    await edit(ap, id, { assignee: uid(L) });
    const anyEv = [A, L, "margaret@barnacle.ai"].map((u) => live(u).filter((e) => e.extendedProperties?.private?.barnacleCrmActivity === String(id)).length);
    const a6 = act(id);
    ctl("change", A, ev, { summary: "Renamed after delete" }); await push(ctl("notice", A)); await runCheck(ap, A);
    const a7 = act(id);
    await ap.goto(BASE + "/activities?when=planned&assignee=all"); const shown = await ap.locator("tr", { hasText: "SF124 after google delete" }).count();
    R("US3 scenario 6", JSON.stringify(d0) === JSON.stringify(d1) && st === "ended" && anyEv.every((n) => n === 0) && a7.subject === "SF124 after google delete" && shown === 1,
      `after delete in Google: activity unchanged ${JSON.stringify(d0) === JSON.stringify(d1)}, link ${st}; edited/ticked/unticked/reassigned to Linus → live events for it Ada/Linus/Margaret ${anyEv.join("/")}; Google change after → subject "${a7.subject}"; on list ${shown}x`);
  }

  if (want("US4")) {
    const base = actCount();
    const r1 = await addEvent(ap, A, { title: "Intro with Ana", date: "2026-12-08", start: "15:00", end: "15:45", guests: "ANA.K@example.test" });
    const m = q(`select id from activities where subject='Intro with Ana'`);
    const am = m && act(m);
    await ap.goto(BASE + `/people/${ana}`); const pn = norm(await ap.getByRole("region", { name: "Next activities" }).innerText());
    await ap.goto(BASE + `/organisations/${org}`); const on = norm(await ap.getByRole("region", { name: "Next activities" }).innerText());
    await ap.goto(BASE + "/activities?when=planned"); const own = await ap.locator("tr", { hasText: "Intro with Ana" }).count();
    R("US4 scenario 1", !!am && am.type === "meeting" && am.dueOn === "2026-12-08" && am.dueTime === "15:00" && am.duration === "45" && am.assignee === "1" && am.person === ana && am.org === org && am.note === "" && am.done === "" && pn.includes("Intro with Ana") && on.includes("Intro with Ana") && own === 1,
      `event ${r1.id} (${r1.done}); activity ${JSON.stringify(am)} (Ana #${ana}, Fake Ltd #${org}); Ana's next "${pn.slice(0, 120)}"; org's next has it ${on.includes("Intro with Ana")}; Ada's list ${own}x`);

    // US4-2
    const n0 = actCount();
    const e1 = await addEvent(ap, A, { title: "SF124 teammates", date: "2026-12-09", start: "10:00", end: "11:00", guests: "linus@barnacle.ai, nobody@unknown.test" });
    const e2 = await addEvent(ap, A, { title: "SF124 no guests", date: "2026-12-09", start: "12:00", end: "13:00" });
    await changeEvent(ap, A, e1.id, { date: "2026-12-10", start: "10:00", end: "11:00" });
    await runCheck(ap, A);
    await ap.goto(BASE + "/activities?when=planned&assignee=all"); const t2 = await ap.locator("body").innerText();
    const n1 = actCount();
    R("US4 scenario 2", n1 === n0 && !t2.includes("SF124 teammates") && !t2.includes("SF124 no guests"), `activities ${n0} → ${n1} after a teammates/unknown event, a no-guest event, a change and a check`);

    // US4-8: a CRM guest added to the no-guest event
    ctl("change", A, e2.id, { attendees: ["ana@example.test"] });
    const r8 = await push(ctl("notice", A)); await sleep(800);
    const m8 = q(`select id from activities where subject='SF124 no guests'`);
    const a8 = m8 && act(m8);
    await changeEvent(ap, A, e2.id, { date: "2026-12-11", start: "12:00", end: "12:30" });
    const a8b = m8 && act(m8);
    R("US4 scenario 8", !!a8 && a8.type === "meeting" && a8.person === ana && a8.dueOn === "2026-12-09" && a8.dueTime === "12:00" && a8.duration === "60" && a8b.dueOn === "2026-12-11" && a8b.duration === "30",
      `guest Ana added (HTTP ${r8.status}) → ${JSON.stringify(a8)}; moved after → ${a8b && a8b.dueOn} ${a8b && a8b.dueTime} ${a8b && a8b.duration}`);

    // US4-3
    const ev = r1.id;
    await changeEvent(ap, A, ev, { date: "2026-12-09", start: "16:00", end: "17:00", title: "Intro with Ana (moved)" });
    const g1 = act(m);
    await edit(ap, m, { subject: "Intro with Ana CRM", dueTime: "16:30", duration: 30, note: "crm note" });
    const e3 = H.events(A).find((e) => e.id === ev);
    await tick(ap, m);
    const e4 = H.events(A).find((e) => e.id === ev);
    await tick(ap, m);
    await delAct(ap, m);
    const e5 = H.events(A).find((e) => e.id === ev);
    R("US4 scenario 3", g1.dueOn === "2026-12-09" && g1.dueTime === "16:00" && g1.duration === "60" && g1.subject === "Intro with Ana (moved)" && e3.summary === "Intro with Ana CRM" && e3.start.dateTime === "2026-12-09T16:30:00.000Z" && e3.end.dateTime === "2026-12-09T17:00:00.000Z" && (e3.attendees || []).some((x) => x.email === "ANA.K@example.test") && e4.summary === "Intro with Ana CRM" && e5 && e5.status !== "cancelled",
      `Google move/rename → ${g1.dueOn} ${g1.dueTime} ${g1.duration} "${g1.subject}"; CRM edit → event "${e3.summary}" ${e3.start.dateTime}–${e3.end.dateTime} guests ${JSON.stringify(e3.attendees)} desc ${JSON.stringify(e3.description)}; ticked → "${e4.summary}" (clarified: ticking changes nothing in Google); deleted in CRM → event ${e5 && e5.status} (clarified: left as it is), activities left ${actCount(`id=${m}`)}`);

    // US4-4
    const cara = person("Cara", "SFfirst", ["cara.sf124@example.test"], { org });
    const dora = person("Dora", "SFprivate", ["dora.sf124@example.test"], { priv: true, owner: uid(L) });
    await addEvent(ap, A, { title: "SF124 several", date: "2026-12-12", start: "10:00", end: "11:00", guests: "nobody@unknown.test, dora.sf124@example.test, cara.sf124@example.test, ana@example.test" });
    const m4 = q(`select string_agg(id::text, ',') from activities where subject='SF124 several'`);
    const a4 = m4 && !m4.includes(",") && act(m4);
    await ap.goto(BASE + "/activities?when=planned&assignee=all"); const c4 = await ap.locator("tr", { hasText: "SF124 several" }).count();
    R("US4 scenario 4", !!a4 && a4.person === cara && a4.org === org && c4 === 1, `activities ${m4}: person ${a4 && a4.person} (Cara #${cara}, private Dora #${dora} listed before her, Ana after), org ${a4 && a4.org}; list ${c4}x`);

    // US4-5
    const arch = person("Arch", "SFarchived", ["arch.sf124@example.test"], { archived: true });
    const n5 = actCount();
    await addEvent(ap, A, { title: "SF124 private only", date: "2026-12-12", start: "12:00", end: "13:00", guests: "dora.sf124@example.test" });
    await addEvent(ap, A, { title: "SF124 archived only", date: "2026-12-12", start: "14:00", end: "15:00", guests: "arch.sf124@example.test" });
    await runCheck(ap, A);
    await ap.goto(BASE + "/activities?when=planned&assignee=all"); const t5 = await ap.locator("body").innerText();
    R("US4 scenario 5", actCount() === n5 && !t5.includes("SF124 private only") && !t5.includes("SF124 archived only"), `activities ${n5} → ${actCount()} (private Dora #${dora} of Linus's, archived #${arch})`);

    // US4-7
    const id7 = await fresh("SF124 crm made", { path: "/activities" });
    await push(ctl("notice", A)); await runCheck(ap, A);
    await ap.goto(BASE + "/activities?when=planned&assignee=all"); const c7 = await ap.locator("tr", { hasText: "SF124 crm made" }).count();
    R("US4 scenario 7", c7 === 1 && actCount(`subject='SF124 crm made'`) === 1 && evOf(A, id7).length === 1, `after the notice and a check: list ${c7}x, activities ${actCount(`subject='SF124 crm made'`)}, events ${evOf(A, id7).length}`);
  }

  if (want("Edge case 3")) {
    const id = await fresh("SF124 both sides", { path: "/activities", dueOn: "2026-12-15", dueTime: "09:00" });
    const ev = eventId(id);
    await fakeBtn(ap, A, "[ MAKE GOOGLE UNREACHABLE ]");
    await edit(ap, id, { dueTime: "11:00" });
    await sleep(1500);
    await changeEvent(ap, A, ev, { date: "2026-12-15", start: "14:00", end: "14:30", deliver: false });
    await fakeBtn(ap, A, "[ MAKE GOOGLE REACHABLE ]");
    await runCheck(ap, A);
    const a = act(id); const e = H.events(A).find((x) => x.id === ev);
    R("Edge case 3", a.dueTime === "14:00" && e.start.dateTime === "2026-12-15T14:00:00.000Z", `CRM 11:00 (Google unreachable, so not sent), then Google 14:00 with no notice; after check: activity ${a.dueTime}, event ${e.start.dateTime}–${e.end.dateTime}`);
  }

  if (want("Edge case 5")) {
    const id = await fresh("SF124 clock change", { path: "/activities", dueOn: "2026-12-16", dueTime: "10:00" });
    await edit(ap, id, { dueOn: "2026-03-29", dueTime: "00:30", duration: 120 });
    const e = H.events(A).find((x) => x.id === eventId(id));
    const id2 = await fresh("SF124 new york", { path: "/activities", dueOn: "2026-12-04", dueTime: "09:00" });
    ctl("change", A, eventId(id2), { start: "2026-12-04T10:00:00-05:00", end: "2026-12-04T11:00:00-05:00" }); await push(ctl("notice", A)); await sleep(800);
    const a2 = act(id2);
    R("Edge case 5", e.start.dateTime === "2026-03-29T00:30:00.000Z" && e.end.dateTime === "2026-03-29T02:30:00.000Z" && a2.dueTime === "15:00" && a2.dueOn === "2026-12-04",
      `29 Mar 00:30 for 2 h (synced first while due in Dec, then moved: an activity due in the past is never first synced): event ${e.start.dateTime}–${e.end.dateTime} (UTC; 00:30 GMT → 02:30 BST); 10:00 New York on 4 Dec → ${a2.dueOn} ${a2.dueTime}`);
  }

  if (want("Edge case 6")) {
    const id = await fresh("SF124 odd times", { path: "/activities", dueOn: "2026-12-17", dueTime: "10:00" });
    const ev = eventId(id);
    const res = [];
    const step = async (o, check) => { await changeEvent(ap, A, ev, o); const a = act(id); const e = H.events(A).find((x) => x.id === ev); res.push({ a: `${a.dueOn} ${a.dueTime} ${a.duration}`, e: JSON.stringify([e.start, e.end]), ok: check(a, e) }); };
    await step({ date: "2026-12-17", start: "10:07", end: "10:52" }, (a, e) => a.dueTime === "10:07" && a.duration === "45" && e.start.dateTime === "2026-12-17T10:07:00.000Z" && e.end.dateTime === "2026-12-17T10:52:00.000Z");
    await step({ date: "2026-12-17", start: "10:00", end: "10:07" }, (a, e) => a.dueTime === "10:00" && a.duration === "5" && e.end.dateTime === "2026-12-17T10:07:00.000Z");
    ctl("change", A, ev, { start: "2026-12-17T10:00:00Z", end: "2026-12-18T16:00:00Z" }); await push(ctl("notice", A)); await sleep(800);
    { const a = act(id); const e = H.events(A).find((x) => x.id === ev); res.push({ a: `${a.dueOn} ${a.dueTime} ${a.duration}`, e: JSON.stringify([e.start, e.end]), ok: a.duration === "1440" && e.end.dateTime === "2026-12-18T16:00:00.000Z" }); }
    await changeEvent(ap, A, ev, { date: "2026-12-04", allDay: true });
    ctl("change", A, ev, { start: "2026-12-04", end: "2026-12-07", allDay: true }); await push(ctl("notice", A)); await sleep(800);
    { const a = act(id); const e = H.events(A).find((x) => x.id === ev); res.push({ a: `${a.dueOn} ${a.dueTime} ${a.duration}`, e: JSON.stringify([e.start, e.end]), ok: a.dueOn === "2026-12-04" && a.dueTime === "" && e.end.date === "2026-12-07" }); }
    R("Edge case 6", res.every((r) => r.ok), JSON.stringify(res));
  }

  if (want("Edge case 7")) {
    const id = await fresh("SF124 title limits", { path: "/activities", dueOn: "2026-12-18" });
    const ev = eventId(id);
    await changeEvent(ap, A, ev, { title: "" });
    const a1 = act(id);
    const long = "X".repeat(250);
    await changeEvent(ap, A, ev, { title: long });
    const a2 = act(id);
    R("Edge case 7", a1.subject === "SF124 title limits" && a2.subject === "X".repeat(200), `empty title → "${a1.subject}"; 250 chars → ${a2.subject.length} chars`);
  }

  if (want("Edge case 8")) {
    const n = actCount();
    await addEvent(ap, A, { title: "SF124 weekly", date: "2026-12-18", start: "09:00", end: "09:30", guests: "ana@example.test", recurring: true });
    await runCheck(ap, A);
    await ap.goto(BASE + "/activities?when=planned&assignee=all"); const t = await ap.locator("body").innerText();
    R("Edge case 8", actCount() === n && !t.includes("SF124 weekly"), `activities ${n} → ${actCount()}`);
  }

  if (want("Edge case 9")) {
    const p = person("Archie", "SFlater", ["archie.sf124@example.test"]);
    const id = await fresh("SF124 archived person", { path: `/people/${p}`, dueOn: "2026-12-02" });
    q(`update persons set archived_at=now() where id=${p}`);
    await changeEvent(ap, A, eventId(id), { date: "2026-12-04", start: "10:00", end: "10:30" });
    const a = act(id);
    await ap.goto(BASE + `/people/${p}`); await ap.waitForLoadState("networkidle");
    const nx = norm(await ap.getByRole("region", { name: "Next activities" }).innerText());
    // [ EDIT ] of the activity through its address on the person's page
    await ap.goto(BASE + `/people/${p}?activity=${id}`); await ap.waitForLoadState("networkidle");
    let msg = norm(await ap.locator("body").innerText());
    const refused = msg.includes("Restore this record before changing its activities.");
    R("Edge case 9", a.dueOn === "2026-12-04" && a.person === p && /4 Dec/.test(nx) && refused, `activity ${a.dueOn} ${a.dueTime}; person's next activities "${nx.slice(0, 160)}"; edit refused with the SF-109 message: ${refused}`);
  }

  if (want("Edge case 10")) {
    const p = person("Pria", "SFprivate", ["pria.sf124@example.test"], { priv: true, owner: 1 });
    const id = await fresh("SF124 private subject", { path: `/people/${p}`, dueOn: "2026-12-19", note: "private note" });
    const inAda = evOf(A, id);
    const others = [L, "margaret@barnacle.ai", G].map((u) => evOf(u, id).length);
    R("Edge case 10", inAda.length === 1 && inAda[0].summary === "Call · SF124 private subject" && inAda[0].description.includes("private note") && others.every((n) => n === 0) && inAda[0].visibility === "private",
      `owner Ada's calendar: "${inAda[0] && inAda[0].summary}" desc ${JSON.stringify(inAda[0] && inAda[0].description)} visibility ${inAda[0] && inAda[0].visibility}; Linus/Margaret/Grace ${others.join("/")}`);
  }

  if (want("Edge case 12")) {
    const n = actCount();
    const e = await addEvent(ap, A, { title: "SF124 declined invite", date: "2026-12-20", start: "10:00", end: "11:00", guests: "ana@example.test", organizer: "boss@elsewhere.test", deliver: false });
    await eventBtn(ap, A, e.id, 1);
    await runCheck(ap, A);
    const n1 = actCount();
    const e2 = await addEvent(ap, A, { title: "SF124 decline later", date: "2026-12-21", start: "10:00", end: "11:00", guests: "ana@example.test", organizer: "boss@elsewhere.test" });
    const m = q(`select id from activities where subject='SF124 decline later'`);
    const before = m && act(m);
    await eventBtn(ap, A, e2.id, 1);
    const after = m && act(m);
    const st = m && q(`select state from calendar_events where activity_id=${m}`);
    await edit(ap, m, { dueTime: "12:00" });
    const ev2 = H.events(A).find((x) => x.id === e2.id);
    R("Edge case 12", n1 === n && !!m && JSON.stringify(before) === JSON.stringify(after) && st === "ended" && ev2.start.dateTime === "2026-12-21T10:00:00.000Z",
      `declined new invite: activities ${n} → ${n1}; meeting #${m} declined after coming in: unchanged ${JSON.stringify(before) === JSON.stringify(after)}, link ${st}; CRM edit to 12:00 → event still ${ev2.start.dateTime}`);
  }

  if (want("Edge case 13")) {
    const id = await fresh("SF124 notice check", { path: "/activities", dueOn: "2026-12-22" });
    const ev = eventId(id);
    ctl("change", A, ev, { start: "2026-12-23T10:00:00Z", end: "2026-12-23T10:30:00Z" });
    const good = ctl("notice", A);
    const bad = { ...good, "x-goog-channel-token": "wrong-token" };
    const r1 = await push(bad);
    const r2 = await push({ ...good, "x-goog-resource-id": "other" });
    const r3 = await push({});
    // a user with no working connection: Linus disconnects, then his old channel's notice
    const lnotice = ctl("notice", L);
    q(`select 1`);
    await lp.goto(BASE + "/settings?disconnect=1"); await lp.getByRole("alertdialog").getByRole("button", { name: "[ DISCONNECT ]" }).click(); await lp.waitForLoadState("networkidle");
    const r4 = lnotice ? await push(lnotice) : { status: "no channel", body: "" };
    const a = act(id);
    const e = H.events(A).find((x) => x.id === ev);
    R("Edge case 13", r1.status === 403 && r2.status === 403 && r3.status === 403 && r4.status === 403 && a.dueOn === "2026-12-22" && e.start.dateTime === "2026-12-23T10:00:00.000Z" && [r1, r2, r3, r4].every((r) => !r.body),
      `wrong token ${r1.status}, wrong resource ${r2.status}, no headers ${r3.status}, disconnected Linus's channel ${r4.status}; bodies empty; activity still ${a.dueOn}; fake event ${e.start.dateTime}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
