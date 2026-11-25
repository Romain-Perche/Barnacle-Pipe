// SF-124 AI review, part a: US1 1-5, US2 1-8, US4 6 (event before connect, Linus), Edge case 5 (Margaret).
// Fresh data first: rm -rf .fake-gmail && bash .factory/run/reset-db.sh (Ada Fake connected with Calendar by the seed).
// Run: NODE_PATH=/opt/playwright/node_modules node .factory/run/scenarios-sf124-a.js
const H = require("./sf124-lib");
const { A, L, G, M, q, live, evOf, act, uid, R, norm, sleep, pageAs, card, warn, connect, schedule, edit, tick, delAct, addEvent, fakeBtn, runCheck, person, actCount, BASE } = H;
const GMAIL2 = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send";

(async () => {
  const browser = await H.lib.chromium.launch();
  const ap = await pageAs(browser, A);
  const lp = await pageAs(browser, L);
  const mp = await pageAs(browser, M);
  const gp = await pageAs(browser, G);
  const ana = person("Ana", "Fake", ["ana@example.test", "ana.k@example.test"]);
  const tomorrow = q("select to_char((now() at time zone 'Europe/London')::date + 1, 'YYYY-MM-DD')");
  const yesterday = q("select to_char((now() at time zone 'Europe/London')::date - 1, 'YYYY-MM-DD')");

  // US4-6 part 1: an event with a CRM guest in Linus's calendar before he connects.
  const pre = await addEvent(ap, L, { title: "SF124 before connect", date: "2026-12-10", start: "10:00", end: "11:00", guests: "ana@example.test" });

  // ---- US1 ----
  {
    const r = await connect(lp);
    const lines = r.card;
    const iCal = lines.indexOf("Calendar: Syncing your activities with your Google Calendar");
    const iLast = Math.max(lines.indexOf("Last sync"), lines.indexOf("conversations copied"));
    R("US1 scenario 1", r.consent.length === 3 && r.consent.some((c) => /calendars you own/.test(c)) && lines.includes("Gmail · connected") && iCal > iLast && iLast > 0,
      `consent boxes: ${JSON.stringify(r.consent)}; card: "${lines}"`);
  }
  {
    const c1 = await connect(mp, { untick: /calendars you own/ });
    const n1 = q(`select count(*) from gmail_connections where user_id=${uid(M)}`);
    const c2 = await connect(mp, { untick: "Send email" });
    const n2 = q(`select count(*) from gmail_connections where user_id=${uid(M)}`);
    const msg = "Google needs all the permissions asked for. Try again and tick every box.";
    R("US1 scenario 2", c1.card.includes(msg) && c2.card.includes(msg) && n1 === "0" && n2 === "0", `Calendar unticked: "${c1.card}" rows ${n1}; Send unticked: "${c2.card}" rows ${n2}`);
  }
  let missingActId;
  {
    // Ada's connection as made before this issue: only the two Gmail scopes (the fake's keys lose the Calendar scope too).
    q(`update gmail_connections set scopes='${GMAIL2}' where user_id=1`);
    H.ctl("events", A); // noop warm-up
    await ap.goto(BASE + "/activities"); await ap.waitForLoadState("networkidle");
    const w = await warn(ap);
    await ap.goto(BASE + "/people"); const w2 = await warn(ap);
    const c = await card(ap);
    const buttons = norm(await ap.locator('section[aria-label="Gmail"]').locator("button, a.btn").allInnerTexts().then((x) => x.join(" | ")));
    const before = /(\d+) conversations? copied/.exec(c);
    const crmEmail = q(`select e.email from person_emails e join persons p on p.id=e.person_id where p.archived_at is null and not p.private order by p.id limit 1`);
    await ap.goto(BASE + "/dev/fake-gmail?user=" + A);
    await ap.fill('input[name="from"]', crmEmail); await ap.fill('input[name="subject"]', "SF124 still copying"); await ap.fill('textarea[name="text"]', "hi");
    await Promise.all([ap.waitForURL(/done=/), ap.click("text=[ PUT IN THE MAILBOX ]")]);
    const c2 = await card(ap);
    const after = /(\d+) conversations? copied/.exec(c2);
    const copied = q(`select count(*) from email_messages where subject='SF124 still copying'`);
    // While missing, a new activity of Ada's is not put in her calendar (checked again after the reconnect).
    missingActId = await schedule(ap, { type: "Call", subject: "SF124 while missing", dueOn: tomorrow, dueTime: "09:00", duration: 30 });
    const none = evOf(A, missingActId).length;
    R("US1 scenario 3", w === 1 && w2 === 1 && c.includes("Gmail · connected") && c.includes("Reconnect Google to sync your activities with your calendar.") && c.includes("Calendar: Not synced: Calendar access missing") && /RECONNECT GMAIL/.test(buttons) && /SEND ME A TEST EMAIL/.test(buttons) && /DISCONNECT/.test(buttons) && copied === "1" && Number(after[1]) === Number(before[1]) + 1,
      `"!" on /activities ${w}, /people ${w2}; card "${c}"; buttons ${buttons}; conversations ${before && before[1]} → ${after && after[1]}, message stored ${copied}; activity saved while missing has ${none} event(s)`);
  }
  {
    const r = await connect(ap);
    await sleep(2500);
    const w = await warn(ap);
    const due = q(`select string_agg(id::text, ',') from activities where assignee_id=1 and done_at is null and due_on >= (now() at time zone 'Europe/London')::date`).split(",");
    const counts = due.map((id) => evOf(A, id).length);
    R("US1 scenario 4", r.card.includes("Gmail reconnected.") && r.card.includes("Calendar: Syncing your activities with your Google Calendar") && w === 0 && counts.every((n) => n === 1),
      `card "${r.card}"; "!" ${w}; Ada's planned activities due today or later ${due.length}, events each: ${counts.join(",")} (incl. #${missingActId} made while missing: ${evOf(A, missingActId).length})`);
  }
  {
    const id = await schedule(ap, { type: "Task", subject: "SF124 for Grace", dueOn: tomorrow, dueTime: "", assignee: uid(G) });
    await gp.goto(BASE + "/activities?when=planned"); await gp.waitForLoadState("networkidle");
    const shown = (await gp.locator("tr", { hasText: "SF124 for Grace" }).count());
    const anywhere = [A, L, G, M].map((u) => H.events(u).filter((e) => (e.summary || "").includes("SF124 for Grace")).length);
    R("US1 scenario 5", id && shown === 1 && anywhere.every((n) => n === 0), `activity #${id} saved, on Grace's Activities list ${shown}x; events in calendars of Ada/Linus/Grace/Margaret: ${anywhere.join("/")}`);
  }

  // ---- US4-6: events before connect / started before today ----
  {
    const past = await addEvent(lp, L, { title: "SF124 started yesterday", date: yesterday, start: "10:00", end: "11:00", guests: "ana@example.test" });
    await runCheck(lp, L);
    const n = actCount(`subject in ('SF124 before connect','SF124 started yesterday')`);
    await lp.goto(BASE + "/activities?when=planned&assignee=all"); const t = await lp.locator("body").innerText();
    R("US4 scenario 6", n === 0 && !t.includes("SF124 before connect") && pre.id && past.id, `event made before Linus connected (${pre.id}) and one started yesterday (${past.id}, delivered + check): activities with those subjects ${n}`);
  }

  // ---- US2 ----
  let callId;
  {
    callId = await schedule(ap, { type: "Call", subject: "Call Ada about the proposal", dueOn: "2026-12-02", dueTime: "10:00", duration: 30, assignee: "1", note: "Bring the price list" });
    const evs = evOf(A, callId);
    const e = evs[0] || {};
    const link = (/(http\S+activity=\d+)/.exec(e.description || "") || [])[1];
    let opens = false;
    if (link) { await ap.goto(link); await ap.waitForLoadState("networkidle"); opens = (await ap.getByRole("dialog").count()) === 1 && (await ap.getByRole("dialog").getByLabel("Subject").inputValue()) === "Call Ada about the proposal"; }
    const sent = q(`select count(*) from email_messages m join gmail_connections c on c.id=m.connection_id where c.user_id=1 and m.direction='sent'`).trim();
    R("US2 scenario 1", evs.length === 1 && e.summary === "Call · Call Ada about the proposal" && e.start.dateTime === "2026-12-02T10:00:00.000Z" && e.end.dateTime === "2026-12-02T10:30:00.000Z" && (e.description || "").includes("Bring the price list") && opens && !e.attendees && JSON.stringify(e.reminders) === JSON.stringify({ useDefault: false, overrides: [{ method: "email", minutes: 15 }, { method: "popup", minutes: 15 }] }),
      `${evs.length} event: "${e.summary}" ${e.start && e.start.dateTime}–${e.end && e.end.dateTime} (UK = GMT in Dec), description "${e.description}", link opens the activity box: ${opens}, attendees ${JSON.stringify(e.attendees)}, reminders ${JSON.stringify(e.reminders)}; sent emails by Ada: ${sent}`);
  }
  {
    const id = await schedule(ap, { type: "Call", subject: "SF124 no duration", dueOn: "2026-12-02", dueTime: "13:00", duration: "" });
    const e = evOf(A, id)[0] || {};
    const mins = e.start ? (new Date(e.end.dateTime) - new Date(e.start.dateTime)) / 60000 : null;
    R("US2 scenario 2", act(id).duration === "" && mins === 30, `activity duration "${act(id).duration}"; event ${e.start && e.start.dateTime}–${e.end && e.end.dateTime} = ${mins} min`);
  }
  {
    const id = await schedule(ap, { type: "Task", subject: "Send contract", dueOn: "2026-12-03", dueTime: "" });
    const e = evOf(A, id)[0] || {};
    R("US2 scenario 3", e.summary === "Task · Send contract" && e.start.date === "2026-12-03" && e.end.date === "2026-12-04" && e.reminders && e.reminders.useDefault === false && (e.reminders.overrides || []).length === 0,
      `"${e.summary}" ${JSON.stringify(e.start)}–${JSON.stringify(e.end)}, reminders ${JSON.stringify(e.reminders)}, ${e.transparency}`);
  }
  {
    const id = await schedule(ap, { type: "Call", subject: "SF124 edit me", dueOn: "2026-12-07", dueTime: "09:00", duration: 30, note: "n1" });
    const e0 = evOf(A, id)[0];
    await edit(ap, id, { type: "Meeting", subject: "SF124 edited", note: "n2", dueOn: "2026-12-09", dueTime: "14:30", duration: 90 });
    const e1 = evOf(A, id);
    await edit(ap, id, { dueTime: "", duration: "" });
    const e2 = evOf(A, id);
    // as Linus, who can see Ada's non-private activity
    await edit(lp, id, { dueTime: "08:00", duration: 15 });
    const e3 = evOf(A, id);
    const ok = e1.length === 1 && e1[0].id === e0.id && e1[0].summary === "Meeting · SF124 edited" && e1[0].description.includes("n2") && e1[0].start.dateTime === "2026-12-09T14:30:00.000Z" && e1[0].end.dateTime === "2026-12-09T16:00:00.000Z"
      && e2.length === 1 && e2[0].id === e0.id && e2[0].start.date === "2026-12-09" && (e2[0].reminders.overrides || []).length === 0
      && e3.length === 1 && e3[0].id === e0.id && e3[0].start.dateTime === "2026-12-09T08:00:00.000Z" && e3[0].end.dateTime === "2026-12-09T08:15:00.000Z" && e3[0].reminders.overrides.length === 2;
    R("US2 scenario 4", ok, `same id ${e0.id}: after edit "${e1[0] && e1[0].summary}" ${e1[0] && e1[0].start.dateTime}–${e1[0] && e1[0].end.dateTime} desc "${e1[0] && e1[0].description}"; time cleared → ${JSON.stringify(e2[0] && e2[0].start)} reminders ${JSON.stringify(e2[0] && e2[0].reminders)}; Linus sets 08:00/15 → ${e3[0] && e3[0].start.dateTime}–${e3[0] && e3[0].end.dateTime} reminders ${JSON.stringify(e3[0] && e3[0].reminders)}; events for it ${e1.length}/${e2.length}/${e3.length}`);
  }
  {
    await tick(ap, callId);
    const t = evOf(A, callId);
    await tick(ap, callId);
    const u = evOf(A, callId);
    R("US2 scenario 5", act(callId).done === "" && t.length === 1 && t[0].summary === "✓ Call · Call Ada about the proposal" && (t[0].reminders.overrides || []).length === 0 && u.length === 1 && u[0].summary === "Call · Call Ada about the proposal" && u[0].reminders.overrides.length === 2,
      `ticked: "${t[0] && t[0].summary}" reminders ${JSON.stringify(t[0] && t[0].reminders)}; unticked: "${u[0] && u[0].summary}" reminders ${JSON.stringify(u[0] && u[0].reminders)}`);
  }
  {
    const id = await schedule(ap, { type: "Call", subject: "SF124 reassign", dueOn: "2026-12-11", dueTime: "11:00", duration: 30 });
    const a0 = evOf(A, id).length;
    await edit(ap, id, { assignee: uid(L) });
    const a1 = evOf(A, id).length, l1 = evOf(L, id).length;
    const id2 = await schedule(ap, { type: "Call", subject: "SF124 reassign grace", dueOn: "2026-12-11", dueTime: "12:00", duration: 30 });
    const b0 = evOf(A, id2).length;
    await edit(ap, id2, { assignee: uid(G) });
    const any2 = [A, L, G, M].map((u) => evOf(u, id2).length);
    R("US2 scenario 6", a0 === 1 && a1 === 0 && l1 === 1 && b0 === 1 && any2.every((n) => n === 0), `to Linus (connected): Ada ${a0}→${a1}, Linus ${l1}; to Grace (not connected): Ada ${b0}→ all calendars ${any2.join("/")}`);
  }
  {
    const id = await schedule(ap, { type: "Call", subject: "SF124 delete me", dueOn: "2026-12-12", dueTime: "11:00", duration: 30 });
    const e0 = evOf(A, id)[0];
    await delAct(ap, id);
    const gone1 = !H.live(A).some((e) => e.id === (e0 && e0.id)) && actCount(`id=${id}`) === 0;
    // with the person it was linked to
    const p = person("Delia", "Gonefake", ["delia@example.test"]);
    const id2 = await schedule(ap, { type: "Call", subject: "SF124 on Delia", dueOn: "2026-12-12", dueTime: "12:00", duration: 30 }, `/people/${p}`);
    const linked = q(`select person_id from activities where id=${id2}`);
    const e2 = evOf(A, id2)[0];
    await ap.goto(BASE + `/people/${p}?confirm=delete`); await ap.waitForLoadState("networkidle");
    await ap.getByRole("alertdialog").getByRole("button").first().click(); await ap.waitForLoadState("networkidle"); await sleep(2000);
    const gone2 = !H.live(A).some((e) => e.id === (e2 && e2.id)) && actCount(`id=${id2}`) === 0;
    await ap.goto(BASE + "/activities?when=planned&assignee=all"); const listHas = (await ap.locator("tr", { hasText: "SF124 on Delia" }).count());
    R("US2 scenario 7", !!e0 && gone1 && !!e2 && linked === p && gone2, `deleted by user: event ${e0 && e0.id} gone ${gone1}; activity on person #${p} (linked ${linked}) event ${e2 && e2.id}, person deleted → activity and event gone ${gone2}`);
    R("Edge case 12", !!e2 && gone2 && listHas === 0, `the only linked record (person #${p}) deleted: activity on the Activities list ${listHas}x, event ${e2 && e2.id} in the fake calendar: ${!gone2 ? "still there" : "gone"}`);
  }
  {
    await fakeBtn(ap, A, "[ MAKE GOOGLE UNREACHABLE ]");
    const id = await schedule(ap, { type: "Call", subject: "SF124 while down", dueOn: "2026-12-14", dueTime: "16:00", duration: 45, note: "down note" });
    const err = await ap.locator("p.err").allInnerTexts();
    const before = evOf(A, id).length;
    await fakeBtn(ap, A, "[ MAKE GOOGLE REACHABLE ]");
    await runCheck(ap, A);
    const e = evOf(A, id)[0] || {};
    R("US2 scenario 8", !!id && err.join("").trim() === "" && before === 0 && e.summary === "Call · SF124 while down" && e.start.dateTime === "2026-12-14T16:00:00.000Z" && e.end.dateTime === "2026-12-14T16:45:00.000Z" && (e.description || "").includes("down note"),
      `saved #${id} while Google unreachable, errors on page: ${JSON.stringify(err)}, events then ${before}; after reachable + check: "${e.summary}" ${e.start && e.start.dateTime}–${e.end && e.end.dateTime}`);
  }

  // ---- Edge case 5: Margaret connects with a planned activity due yesterday, a done one due tomorrow, a planned one tomorrow ----
  {
    const mid = uid(M);
    const ins = (s, d, done) => q(`insert into activities (type,subject,due_on,due_time,duration_minutes,assignee_id,created_by,assigned_by,done_at,done_by) values ('call','${s}','${d}','10:00',30,${mid},${mid},${mid},${done ? "now()" : "null"},${done ? mid : "null"}) returning id`).split("\n")[0];
    const y = ins("SF124 M yesterday", yesterday, false), d = ins("SF124 M done tomorrow", tomorrow, true), t = ins("SF124 M tomorrow", tomorrow, false);
    await connect(mp); await sleep(2500);
    const titles = H.live(M).map((e) => e.summary);
    R("Edge case 5", evOf(M, t).length === 1 && evOf(M, y).length === 0 && evOf(M, d).length === 0, `Margaret's calendar after connecting: ${JSON.stringify(titles)}`);
  }
  console.log(JSON.stringify({ callId }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
