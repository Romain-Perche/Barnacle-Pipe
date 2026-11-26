// SF-127 AI review, part b: US4, US5, US7, US2 scenario 4, edges 1-5, 12, 14, 15, 16. Runs after part a on the same
// data (see scenarios-sf127-a.js). Results: /tmp/sf127-b.json. Uses gmail-ctl.ts (delete, unreachable).
const fs = require("fs");
const { execFileSync } = require("child_process");
const L_ = require("./sf127-lib");
const { chromium, A, L, G, q, norm, sleep, S, R, pageAs, go, put, connect, conv, pid, oid, did, links, emailEntries, countSubj, gThread } = L_;
const ADA = "Ada Fake <ada@barnacle.ai>", ANA = "Ana Example <ana@example.test>";
const ctlEnv = { ...process.env, APP_ENV: "development", DATABASE_URL: "postgres://postgres@localhost:5432/crm_dev", GMAIL_TOKEN_KEY: fs.readFileSync("/tmp/gmail-token-key", "utf8").trim(), APP_URL: "http://localhost:3000" };
const ctl = (...args) => execFileSync("npx", ["tsx", ".factory/run/gmail-ctl.ts", ...args], { encoding: "utf8", env: ctlEnv }).trim().split("\n").pop();
async function run(name, fn) { try { await fn(); } catch (e) { R(name, false, "error: " + e.message.split("\n")[0]); } }
const UNAVAILABLE = "This attachment can't be fetched from Gmail right now. Try again later.";

async function linkBy(p, c, kind, name) {
  await go(p, `/emails/${c}?link=${kind}`);
  const label = kind === "deal" ? "Deal" : kind === "person" ? "Person" : "Organisation";
  await p.getByRole("combobox", { name: label }).fill(name);
  await p.getByRole("option", { name, exact: true }).click();
  await Promise.all([p.waitForURL(/notice=/), p.getByRole("button", { name: "[ LINK ]" }).click()]);
  return new URL(p.url()).searchParams.get("notice");
}
async function unlinkBy(p, c, name) {
  await go(p, `/emails/${c}`);
  await Promise.all([p.waitForURL(/notice=/), p.getByRole("button", { name: `Unlink ${name}`, exact: true }).click()]);
  return new URL(p.url()).searchParams.get("notice");
}
async function options(p, c, kind, typed) {
  await go(p, `/emails/${c}?link=${kind}`);
  const label = kind === "deal" ? "Deal" : kind === "person" ? "Person" : "Organisation";
  await p.getByRole("combobox", { name: label }).fill(typed);
  await sleep(200);
  return (await p.locator("[role=option]").allInnerTexts()).map(norm);
}
async function download(p, attId) {
  const r = await p.context().request.get(`http://localhost:3000/emails/attachments/${attId}/download`, { maxRedirects: 0 });
  return { status: r.status(), loc: r.headers()["location"] || "", type: r.headers()["content-type"], len: (await r.body()).length };
}
async function followNotice(p, loc) { await go(p, loc); return norm(await p.locator("main, body").first().innerText()).includes(UNAVAILABLE); }
const att = (name) => q(`select a.id from email_attachments a where a.name='${name}' order by a.id limit 1`);

(async () => {
  const browser = await chromium.launch();
  const ada = await pageAs(browser, A);
  const lin = await pageAs(browser, L);
  const ana = pid("Ana");

  // ---- US4 ----
  await run("US4 scenario 1", async () => {
    await go(lin, `/emails/${conv("Proposal")}`);
    const items = (await lin.locator(".conv-links li").allInnerTexts()).map(norm);
    const hrefs = await lin.locator(".conv-links li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const btns = norm(await lin.locator(".conv-acts").innerText());
    R("US4 scenario 1", items.length === 3 && /^PERSON ?Ana Example \[ UNLINK \]$/.test(items[0]) && /^ORG ?Example Ltd \[ UNLINK \]$/.test(items[1]) && /^DEAL ?Example Ltd – pilot \[ UNLINK \]$/.test(items[2]) &&
      hrefs[0] === `/people/${ana}` && hrefs[1] === `/organisations/${oid("Example Ltd")}` && hrefs[2] === `/deals/${did("Example Ltd – pilot")}` && btns === "[ LINK DEAL ] [ LINK PERSON ] [ LINK ORGANISATION ]", `items ${JSON.stringify(items)}; hrefs ${JSON.stringify(hrefs)}; buttons "${btns}"`);
  });
  await run("US4 scenario 2", async () => {
    const n = await linkBy(lin, conv("CatConv"), "deal", "Other Co – renewal");
    const es = await emailEntries(lin, `/deals/${did("Other Co – renewal")}`);
    R("US4 scenario 2", n === "linked" && countSubj(es, "CatConv") === 1 && links(conv("CatConv")).includes("d:Other Co – renewal/manual"), `notice ${n}; on the deal ${countSubj(es, "CatConv")}; links ${JSON.stringify(links(conv("CatConv")))}`);
  });
  await run("US4 scenario 3", async () => {
    const n1 = await linkBy(lin, conv("CatConv"), "person", "Kim Twoaddr");
    const n2 = await linkBy(lin, conv("CatConv"), "organisation", "Mover Org");
    const a = countSubj(await emailEntries(lin, `/people/${pid("Kim")}`), "CatConv"), b = countSubj(await emailEntries(lin, `/organisations/${oid("Mover Org")}`), "CatConv");
    R("US4 scenario 3", n1 === "linked" && n2 === "linked" && a === 1 && b === 1, `notices ${n1}/${n2}; on Kim (not in its emails) ${a}; on Mover Org ${b}`);
  });
  await run("US4 scenario 4", async () => {
    const c = conv("Proposal"), deal = did("Example Ltd – pilot");
    const n = await unlinkBy(lin, c, "Example Ltd – pilot");
    const gone = countSubj(await emailEntries(lin, `/deals/${deal}`), "Proposal");
    await put(ada, A, { from: ANA, to: ADA, subject: "Re: Proposal", text: "One more on the proposal.", thread: gThread(A, "Proposal"), offset: 40 });
    // A change to Ana's deals: she becomes a linked person of no other deal but her deal is saved again; and a new address.
    q(`update deals set version = version + 1 where id = ${deal}`);
    await go(ada, `/people/${ana}/edit`);
    await ada.click("text=[ ADD EMAIL ADDRESS ]");
    await ada.getByLabel("Email address 3", { exact: true }).fill("ana.third@example.test");
    await Promise.all([ada.waitForURL(new RegExp(`/people/${ana}(\\?|$)`)), ada.click("text=[ SAVE ]")]);
    const l = links(c); const after = countSubj(await emailEntries(lin, `/deals/${deal}`), "Proposal") + countSubj(await emailEntries(lin, `/deals/${deal}`), "Re: Proposal");
    R("US4 scenario 4", n === "unlinked" && gone === 0 && after === 0 && l.includes("d:Example Ltd – pilot(removed)/auto"), `notice ${n}; on the deal after unlink ${gone}; after a new email + Ana saved with a new address ${after}; links ${JSON.stringify(l)}`);
  });
  await run("US4 scenario 5", async () => {
    const c = conv("Three");
    const n = await unlinkBy(lin, c, "Ana Example");
    const gone = countSubj(await emailEntries(lin, `/people/${ana}`), "Three");
    await put(ada, A, { from: ANA, to: ADA, subject: "Re: Three", text: "Fourth email.", thread: gThread(A, "Three"), offset: 41 });
    const still = (await emailEntries(lin, `/people/${ana}`)).filter((e) => /Three/.test(e.subj)).length;
    const l1 = links(c);
    const n2 = await linkBy(lin, c, "person", "Ana Example");
    const back = (await emailEntries(lin, `/people/${ana}`)).filter((e) => /Three/.test(e.subj)).length;
    R("US4 scenario 5", n === "unlinked" && gone === 0 && still === 0 && l1.includes("p:Ana(removed)/auto") && n2 === "linked" && back === 4 && links(c).includes("p:Ana/manual"), `unlink ${n}; Three entries on Ana after unlink ${gone}, after a new email ${still} (links ${JSON.stringify(l1)}); linked again ${n2} → ${back} entries`);
  });
  await run("US4 scenario 6", async () => {
    q(`insert into organisations (name, owner_id, created_by, archived_at) values ('Arch Org', 1, 1, now()) on conflict do nothing`);
    const c = conv("CatConv");
    const pPia = await options(lin, c, "person", "Pia"), pHal = await options(lin, c, "person", "Hal Arch"), pAna = await options(lin, c, "person", "Ana Ex");
    const dFay = await options(lin, c, "deal", "Fay Private"), dSec = await options(lin, c, "deal", "Ada Secret"), dArch = await options(lin, c, "deal", "Dan Arch"), dOk = await options(lin, c, "deal", "Cat D");
    const oArch = await options(lin, c, "organisation", "Arch Org"), oOk = await options(lin, c, "organisation", "Example");
    const aPia = await options(ada, c, "person", "Pia"), aFay = await options(ada, c, "deal", "Fay Private");
    R("US4 scenario 6", pPia.length === 0 && pHal.length === 0 && pAna.includes("Ana Example") && dFay.length === 0 && dSec.length === 0 && dArch.length === 0 && dOk.length === 2 && oArch.length === 0 && oOk.includes("Example Ltd") && aPia.includes("Pia Private") && aFay.includes("Fay Private Deal"),
      `Linus: Pia ${JSON.stringify(pPia)}, archived Hal ${JSON.stringify(pHal)}, Ana ${JSON.stringify(pAna)}, Fay's private deal ${JSON.stringify(dFay)}, Ada's secret ${JSON.stringify(dSec)}, archived deal ${JSON.stringify(dArch)}, Cat D ${JSON.stringify(dOk)}, archived org ${JSON.stringify(oArch)}, Example ${JSON.stringify(oOk)}; Ada (owner): Pia ${JSON.stringify(aPia)}, Fay deal ${JSON.stringify(aFay)}`);
  });

  // ---- US5 ----
  const pia = pid("Pia");
  await run("US5 scenario 1", async () => {
    await put(ada, A, { from: "Pia Private <pia@example.test>", to: ADA, cc: ANA, subject: "PiaConv", text: "Private chat.", att: ["pia.pdf:3000"], offset: 42 });
    const paths = { Ana: `/people/${ana}`, Pia: `/people/${pia}`, "Example Ltd": `/organisations/${oid("Example Ltd")}`, "Pia Org": `/organisations/${oid("Pia Org")}` };
    const a = {}, b = {};
    for (const [k, path] of Object.entries(paths)) { a[k] = countSubj(await emailEntries(ada, path), "PiaConv"); const r = await go(lin, path); b[k] = r.status() === 404 ? "404" : countSubj(await emailEntries(lin), "PiaConv"); }
    R("US5 scenario 1", Object.values(a).every((n) => n === 1) && Object.values(b).every((n) => n === 0 || n === "404") && b.Ana === 0 && b["Example Ltd"] === 0 && b["Pia Org"] === 0, `Ada ${JSON.stringify(a)}; Linus ${JSON.stringify(b)}`);
  });
  await run("US5 scenario 2", async () => {
    const c = conv("PiaConv"), aid = att("pia.pdf");
    const r1 = await go(lin, `/emails/${c}`); const t1 = norm(await lin.locator("main").innerText());
    const r2 = await go(lin, `/emails/999999`); const t2 = norm(await lin.locator("main").innerText());
    const d1 = await download(lin, aid), d2 = await download(lin, 999999);
    R("US5 scenario 2", r1.status() === 404 && r2.status() === 404 && t1 === t2 && !/PiaConv|Pia|pia\.pdf/.test(t1) && d1.status === 404 && d2.status === 404 && d1.len === d2.len, `conversation ${r1.status()} "${t1}" vs missing ${r2.status()} "${t2}"; attachment ${d1.status}/${d1.len} bytes vs missing ${d2.status}/${d2.len}`);
  });
  await run("US5 scenario 3", async () => {
    await put(ada, A, { from: ANA, to: ADA, subject: "SecretLink", text: "Only Ana.", offset: 43 });
    const c = conv("SecretLink");
    const before = countSubj(await emailEntries(lin, `/people/${ana}`), "SecretLink");
    const n = await linkBy(ada, c, "deal", "Ada Secret Deal");
    const gra = await pageAs(browser, G);
    const lAna = countSubj(await emailEntries(lin, `/people/${ana}`), "SecretLink"), lPage = (await go(lin, `/emails/${c}`)).status();
    const gAna = countSubj(await emailEntries(gra, `/people/${ana}`), "SecretLink"), gPage = (await go(gra, `/emails/${c}`)).status();
    const aAna = countSubj(await emailEntries(ada, `/people/${ana}`), "SecretLink"), aDeal = countSubj(await emailEntries(ada, `/deals/${did("Ada Secret Deal")}`), "SecretLink");
    await gra.context().close();
    R("US5 scenario 3", before === 1 && n === "linked" && lAna === 0 && lPage === 404 && gAna === 0 && gPage === 404 && aAna === 1 && aDeal === 1, `Linus before ${before}; linked ${n}; Linus: Ana ${lAna}, page ${lPage}; Grace (admin): Ana ${gAna}, page ${gPage}; Ada: Ana ${aAna}, deal ${aDeal}`);
  });
  await run("US5 scenario 6", async () => {
    const c = conv("PiaConv");
    const n = await unlinkBy(ada, c, "Pia Private");
    const page = (await go(lin, `/emails/${c}`)).status(), onAna = countSubj(await emailEntries(lin, `/people/${ana}`), "PiaConv");
    R("US5 scenario 6", n === "unlinked" && page === 404 && onAna === 0 && links(c).includes("p:Pia(removed)/auto"), `unlink ${n}; Linus: page ${page}, on Ana ${onAna}`);
  });
  await run("US5 scenario 4", async () => {
    const c = conv("PiaConv");
    const before = (await go(lin, `/emails/${c}`)).status();
    await go(ada, `/people/${pia}/edit`);
    await ada.locator('input[name="private"]').uncheck();
    await Promise.all([ada.waitForURL(new RegExp(`/people/${pia}(\\?|$)`)), ada.click("text=[ SAVE ]")]);
    const priv = q(`select private from persons where id=${pia}`);
    const after = (await go(lin, `/emails/${c}`)).status(), onAna = countSubj(await emailEntries(lin, `/people/${ana}`), "PiaConv");
    R("US5 scenario 4", before === 404 && priv === "f" && after === 200 && onAna === 1, `Linus before ${before}; Pia private ${priv}; after: page ${after}, on Ana ${onAna}`);
  });
  await run("US5 scenario 5", async () => {
    const own = q(`select string_agg(distinct g.email, ',') from email_messages m join gmail_connections g on g.id=m.connection_id where m.subject='Proposal'`);
    const n = countSubj(await emailEntries(lin, `/people/${ana}`), "Proposal");
    R("US5 scenario 5", own === A && n === 1, `Proposal copied only in ${own}; Linus sees it on Ana's page: ${n}`);
  });
  await run("Edge case 14", async () => {
    await put(ada, A, { from: ANA, to: ADA, subject: "SecretLink2", text: "Linked to a private person by hand.", offset: 44 });
    const c = conv("SecretLink2");
    // Fay's private deal (US3 9) and a private person linked by hand both hide it; an organisation never does.
    q(`update persons set private = true, owner_id = 1 where id = ${pid("Kim")}`);
    const n = await linkBy(ada, c, "person", "Kim Twoaddr");
    const lp = (await go(lin, `/emails/${c}`)).status(), onAna = countSubj(await emailEntries(lin, `/people/${ana}`), "SecretLink2");
    const fay = (await go(lin, `/emails/${conv("FayConv")}`)).status();
    const orgPrivate = q(`select count(*) from information_schema.columns where table_name='organisations' and column_name='private'`);
    const viaOrg = (await go(lin, `/emails/${conv("CatConv")}`)).status(); // linked to Mover Org by hand (US4 3)
    q(`update persons set private = false where id = ${pid("Kim")}`);
    R("Edge case 14", n === "linked" && lp === 404 && onAna === 0 && fay === 404 && orgPrivate === "0" && viaOrg === 200, `linked to private Kim ${n}: Linus page ${lp}, on Ana ${onAna}; FayConv (private deal) ${fay}; organisations have no private column (${orgPrivate}); conversation linked to an organisation ${viaOrg}`);
  });

  // ---- Edges 1-5, 12 ----
  await run("Edge case 1", async () => {
    await put(ada, A, { from: "Jo Gone <jo@example.test>", to: ADA, cc: "Gus Mover <gus@example.test>", subject: "JoConv", text: "Jo and Gus.", offset: 45 });
    const c = conv("JoConv"); const l0 = links(c);
    const jo = pid("Jo");
    await go(ada, `/people/${jo}?confirm=delete`);
    await Promise.all([ada.waitForURL((u) => !u.pathname.endsWith(`/people/${jo}`)), ada.getByRole("alertdialog").getByRole("button").filter({ hasText: /DELETE/ }).click()]);
    const gone = q(`select count(*) from persons where id=${jo}`);
    const onGus = countSubj(await emailEntries(lin, `/people/${pid("Gus")}`), "JoConv"), onEx = countSubj(await emailEntries(lin, `/organisations/${oid("Example Ltd")}`), "JoConv");
    // A conversation linked to nothing: Kim's only link removed by hand.
    await put(ada, A, { from: "Kim Twoaddr <kim@example.test>", to: ADA, subject: "Lonely", text: "Nobody left.", offset: 46 });
    await unlinkBy(ada, conv("Lonely"), "Kim Twoaddr");
    const lonely = links(conv("Lonely")).filter((x) => !x.includes("removed")).length;
    const onKim = countSubj(await emailEntries(ada, `/people/${pid("Kim")}`), "Lonely");
    const anywhere = q(`select count(*) from email_links where conversation_id=${conv("Lonely")} and not removed`);
    R("Edge case 1", gone === "0" && onGus === 1 && onEx === 1 && lonely === 0 && onKim === 0 && anywhere === "0", `JoConv links before ${JSON.stringify(l0)}; Jo deleted (${gone} left); after: ${JSON.stringify(links(c))}, on Gus ${onGus}, on Example Ltd ${onEx}; "Lonely" live links ${anywhere}, on Kim ${onKim}`);
  });
  await run("Edge case 2", async () => {
    const c = conv("JoConv"), deal = did("Jo Deal"), org = oid("Gone Org");
    await go(ada, `/deals/${deal}?confirm=delete`);
    await Promise.all([ada.waitForURL((u) => !u.pathname.endsWith(`/deals/${deal}`)), ada.getByRole("alertdialog").getByRole("button").filter({ hasText: /DELETE/ }).click()]);
    await go(ada, `/organisations/${org}?confirm=delete`);
    await Promise.all([ada.waitForURL((u) => !u.pathname.endsWith(`/organisations/${org}`)), ada.getByRole("alertdialog").getByRole("button").filter({ hasText: /DELETE/ }).click()]);
    const l = links(c);
    const onGus = countSubj(await emailEntries(lin, `/people/${pid("Gus")}`), "JoConv");
    R("Edge case 2", q(`select count(*) from deals where id=${deal}`) === "0" && q(`select count(*) from organisations where id=${org}`) === "0" && !l.some((x) => /Jo Deal|Gone Org/.test(x)) && onGus === 1, `links now ${JSON.stringify(l)}; on Gus ${onGus}`);
  });
  await run("Edge case 4", async () => {
    const c = conv("JoConv");
    q(`update persons set organisation_id = ${oid("Mover Org")} where id = ${pid("Gus")}`);
    await put(ada, A, { from: "Gus Mover <gus@example.test>", to: ADA, subject: "Re: JoConv", text: "From my new company.", thread: gThread(A, "JoConv"), offset: 47 });
    const l = links(c);
    const onEx = countSubj(await emailEntries(lin, `/organisations/${oid("Example Ltd")}`), "JoConv"), onMover = (await emailEntries(lin, `/organisations/${oid("Mover Org")}`)).filter((e) => /JoConv/.test(e.subj)).length;
    R("Edge case 4", l.includes("o:Example Ltd/auto") && l.includes("o:Mover Org/auto") && onEx === 1 && onMover === 2, `links ${JSON.stringify(l)}; Example Ltd shows ${onEx}, Mover Org shows ${onMover} JoConv entries`);
  });
  await run("Edge case 5", async () => {
    const deal = did("Eve Deal");
    await go(ada, `/deals/${deal}`);
    await ada.getByRole("button", { name: "[ WON ]" }).click(); await ada.waitForLoadState("networkidle"); await sleep(500);
    const st = q(`select status from deals where id=${deal}`);
    await put(ada, A, { from: "Eve Linked <eve@example.test>", to: ADA, subject: "Re: EveConv", text: "After the win.", thread: gThread(A, "EveConv"), offset: 48 });
    const l = links(conv("EveConv"));
    const n = (await emailEntries(lin, `/deals/${deal}`)).filter((e) => /EveConv/.test(e.subj)).length;
    R("Edge case 5", st === "won" && l.includes("d:Eve Deal/auto") && n === 2, `status ${st}; links ${JSON.stringify(l)}; EveConv entries on the won deal ${n}`);
  });
  await run("Edge case 3", async () => {
    await put(ada, A, { from: "Hal Archived <hal@example.test>", to: ADA, cc: ANA, subject: "HalConv", text: "From an archived person.", offset: 49 });
    const c = conv("HalConv");
    q(`update deals set archived_at = now() where id = ${did("Eve Deal")}`);
    q(`update organisations set archived_at = now() where id = ${oid("Mover Org")}`);
    const onHal = countSubj(await emailEntries(lin, `/people/${pid("Hal")}`), "HalConv"), page = (await go(lin, `/emails/${c}`)).status(), onAna = countSubj(await emailEntries(lin, `/people/${ana}`), "HalConv");
    const dealN = (await emailEntries(lin, `/deals/${did("Eve Deal")}`)).filter((e) => /EveConv/.test(e.subj)).length;
    const orgN = (await emailEntries(lin, `/organisations/${oid("Mover Org")}`)).filter((e) => /JoConv|CatConv/.test(e.subj)).length;
    q(`update organisations set archived_at = null where id = ${oid("Mover Org")}`);
    R("Edge case 3", links(c).includes("p:Hal/auto") && onHal === 1 && page === 200 && onAna === 1 && dealN === 2 && orgN === 3, `links ${JSON.stringify(links(c))}; archived Hal's page ${onHal}; Linus: conversation ${page}, on Ana ${onAna}; archived Eve Deal shows ${dealN}; archived Mover Org shows ${orgN}`);
  });
  await run("Edge case 12", async () => {
    const c = conv("Both");
    const convs = q(`select count(distinct t.conversation_id) from email_messages m join email_threads t on t.id=m.thread_id where m.subject='Both'`);
    const n = await unlinkBy(lin, c, "Example Ltd");
    const onOrg = countSubj(await emailEntries(ada, `/organisations/${oid("Example Ltd")}`), "Both");
    await go(ada, `/emails/${c}`); const shown = await ada.locator("article.msg").count();
    const onAna = countSubj(await emailEntries(ada, `/people/${ana}`), "Both");
    R("Edge case 12", convs === "1" && n === "unlinked" && onOrg === 0 && shown === 1 && onAna === 1 && links(c).includes("o:Example Ltd(removed)/auto"), `copies in ${convs} conversation; unlinked ${n} (by Linus); Example Ltd shows ${onOrg} for Ada; conversation shows ${shown}; Ana shows ${onAna}`);
  });

  // ---- Edge 15: paging ----
  await run("Edge case 15", async () => {
    q(`insert into persons (first_name,last_name,owner_id,created_by) values ('Lia','Pager',1,1)`);
    const lia = pid("Lia");
    q(`insert into person_emails (person_id,email,kind,position) values (${lia},'lia@example.test','work',0)`);
    for (let i = 1; i <= 53; i++) await put(ada, A, { from: "Lia Pager <lia@example.test>", to: ADA, subject: `Page ${String(i).padStart(2, "0")}`, text: `n${i}`, offset: 50 + i, deliver: false });
    await L_.runCheck(ada, A);
    const stored = q(`select count(*) from email_messages where subject like 'Page %'`);
    await go(ada, `/people/${lia}`);
    const first = (await emailEntries(ada)).map((e) => e.subj);
    const more = ada.getByRole("link", { name: /SHOW MORE/ }).or(ada.getByRole("button", { name: /SHOW MORE/ }));
    const hasMore = await more.count();
    if (hasMore) { await more.first().click(); await ada.waitForLoadState("networkidle"); await sleep(500); }
    const all = (await emailEntries(ada)).map((e) => e.subj);
    const sorted = [...all].sort().reverse();
    R("Edge case 15", stored === "53" && first.length === 50 && first[0] === "Page 53" && hasMore > 0 && all.length === 53 && JSON.stringify(all) === JSON.stringify(sorted), `stored ${stored}; first page ${first.length} (newest ${first[0]}, oldest ${first[first.length - 1]}); [ SHOW MORE ] ${hasMore}; after it ${all.length}, newest first: ${JSON.stringify(all) === JSON.stringify(sorted)}`);
  });

  // ---- US7 ----
  await run("US7 scenario 1", async () => {
    const res = {};
    for (const [k, path] of [["person", `/people/${ana}`], ["organisation", `/organisations/${oid("Example Ltd")}`], ["deal", `/deals/${did("Example Ltd – pilot")}`]]) {
      await go(ada, path);
      const lb = await ada.locator(".recordleft").boundingBox(), rb = await ada.locator(".recordright").boundingBox();
      const right = await ada.locator(".recordright > *").evaluateAll((xs) => xs.map((x) => x.getAttribute("aria-label") || (x.querySelector("textarea") ? "note box" : x.className)));
      const left = norm(await ada.locator(".recordleft").innerText());
      res[k] = { side: lb.x + lb.width <= rb.x, right, left: left.slice(0, 400) };
    }
    const order = (r) => { const s = r.join("|"); const i = ["note", "Next activities", "Files", "Timeline"].map((w) => s.toLowerCase().indexOf(w.toLowerCase())); return i.every((x, j) => x >= 0 && (j === 0 || x > i[j - 1])); };
    const ok = Object.values(res).every((r) => r.side && order(r.right)) && /MORE DETAILS/.test(res.person.left) && /Referred by/i.test(res.person.left + res.deal.left) && /VALUE|Value/.test(res.deal.left) && /Ana Example/.test(res.deal.left);
    R("US7 scenario 1", ok, JSON.stringify(res));
  });
  await run("US7 scenario 2", async () => {
    const narrow = await pageAs(browser, A, { width: 800, height: 1000 });
    const res = {};
    for (const [k, path] of [["person", `/people/${ana}`], ["organisation", `/organisations/${oid("Example Ltd")}`], ["deal", `/deals/${did("Example Ltd – pilot")}`]]) {
      await go(narrow, path);
      const lb = await narrow.locator(".recordleft").boundingBox(), rb = await narrow.locator(".recordright").boundingBox();
      res[k] = { leftBottom: Math.round(lb.y + lb.height), rightTop: Math.round(rb.y), sameX: Math.round(lb.x) === Math.round(rb.x) };
    }
    await narrow.context().close();
    R("US7 scenario 2", Object.values(res).every((r) => r.leftBottom <= r.rightTop && r.sameX), JSON.stringify(res));
  });
  await run("US7 scenario 3", async () => {
    const deal = did("Ivy Deal");
    await go(ada, `/deals/${deal}`);
    const box = ada.getByRole("form", { name: "Add a note" });
    await box.getByRole("textbox", { name: "Note" }).fill("Layout note SF127");
    await box.getByRole("button", { name: "[ ADD NOTE ]" }).click(); await ada.waitForLoadState("networkidle"); await sleep(800);
    await go(ada, `/deals/${deal}?activity=new`); await ada.getByRole("dialog").waitFor();
    await ada.getByRole("dialog").getByLabel("Subject").fill("Layout call SF127");
    await ada.getByRole("dialog").getByLabel("Date").fill("2026-12-03");
    await ada.getByRole("dialog").getByRole("button", { name: "[ SAVE ]" }).click(); await ada.waitForLoadState("networkidle"); await sleep(1500);
    await go(ada, `/deals/${deal}`);
    fs.writeFileSync("/tmp/sf127-layout.txt", "layout file\n");
    await ada.locator('input[aria-label="Files to add"]').first().setInputFiles("/tmp/sf127-layout.txt");
    await ada.waitForFunction(() => { const s = document.querySelector(".upload-status"); return s && !s.querySelector(".uploading") && s.querySelector(".notice,.err"); }, null, { timeout: 60000 });
    await ada.waitForLoadState("networkidle"); await sleep(1200);
    await go(ada, `/deals/${deal}`);
    await ada.getByRole("button", { name: "[ WON ]" }).click(); await ada.waitForLoadState("networkidle"); await sleep(800);
    await go(ada, `/deals/${deal}`);
    const right = norm(await ada.locator(".recordright").innerText()), left = norm(await ada.locator(".recordleft").innerText());
    const head = norm(await ada.locator(".page-head").first().innerText()) + " " + norm(await ada.locator(".deal-acts").innerText()) + ` (actions inside the columns: ${await ada.locator(".recordcols .deal-acts").count()})`;
    const ok = right.includes("Layout note SF127") && right.includes("Layout call SF127") && right.includes("sf127-layout.txt") && /Won/i.test(right) && !/Layout note SF127|Layout call SF127|sf127-layout/.test(left) && head.includes("[ EDIT ]") && head.includes("[ ARCHIVE ]") && head.includes("inside the columns: 0");
    R("US7 scenario 3", ok, `status ${q(`select status from deals where id=${deal}`)}; header "${head}"; right has note ${right.includes("Layout note SF127")}, activity ${right.includes("Layout call SF127")}, file ${right.includes("sf127-layout.txt")}, won line ${(right.match(/[^.]{0,40}Won[^.]{0,40}/) || [""])[0]}`);
  });

  // ---- US2 scenario 4 and edge 16 (break mailboxes: last) ----
  await run("US2 scenario 4", async () => {
    const out = [];
    // (a) Gmail no longer has the message.
    await put(ada, A, { from: ANA, to: ADA, subject: "GoneMsg", text: "Soon gone.", att: ["gone.pdf:4000"], offset: 120 });
    ctl("delete", A, "GoneMsg");
    let d = await download(ada, att("gone.pdf"));
    out.push(`gone: ${d.status} → ${d.loc} notice ${d.status === 303 && (await followNotice(ada, d.loc))}`);
    const okGone = d.status === 303 && (await followNotice(ada, d.loc));
    // (b) Gmail unreachable.
    ctl("unreachable", "on");
    d = await download(ada, att("figures.pdf"));
    const okDown = d.status === 303; out.push(`unreachable: ${d.status}`);
    ctl("unreachable", "off");
    const pageText = (await followNotice(ada, d.loc));
    const noCause = !/unreachable|network|fetch failed|401|404|refused|token/i.test(norm(await ada.locator("p.err").first().innerText()));
    // (c) Deactivated owner: Grace's mailbox only.
    const gra = await pageAs(browser, G); await connect(gra);
    await put(gra, G, { from: ANA, to: "Grace Fake <grace@barnacle.ai>", subject: "GraceMail", text: "Only Grace has it.", att: ["grace.pdf:2000"], offset: 121 });
    await gra.context().close();
    await go(ada, "/admin/users");
    await Promise.all([ada.waitForLoadState("networkidle"), ada.locator("tr", { hasText: G }).getByRole("button", { name: "[ DEACTIVATE ]" }).click()]);
    await sleep(800);
    const okDeact = q(`select status from users where email='${G}'`) === "deactivated" && (d = await download(ada, att("grace.pdf"))).status === 303; out.push(`deactivated: ${d.status}`);
    // (d) Needs reconnecting: Ada's key refused; "Both" is also in Linus's working mailbox → that copy is used.
    await go(ada, "/dev/fake-gmail?user=" + encodeURIComponent(A));
    await Promise.all([ada.waitForURL(/done=refused/), ada.click("text=[ REFUSE THE KEY ]")]);
    const fig = await download(ada, att("figures.pdf"));
    const stA = q(`select state from gmail_connections where email='${A}'`);
    const both = await download(ada, att("both.pdf"));
    out.push(`refused: figures ${fig.status}, Ada's connection ${stA}; both.pdf (also in Linus's) ${both.status} ${both.type} ${both.len} bytes`);
    // (e) Disconnected: Linus disconnects.
    await go(lin, "/settings");
    await lin.getByRole("link", { name: "[ DISCONNECT ]" }).or(lin.getByRole("button", { name: "[ DISCONNECT ]" })).first().click(); await lin.waitForLoadState("networkidle");
    const confirmBtn = lin.getByRole("button", { name: /DISCONNECT/ }).last(); await confirmBtn.click(); await lin.waitForLoadState("networkidle"); await sleep(500);
    const stL = q(`select state from gmail_connections where email='${L}'`);
    const both2 = await download(lin, att("both.pdf"));
    out.push(`Linus ${stL}: both.pdf ${both2.status}`);
    const ok = okGone && okDown && pageText && noCause && okDeact && fig.status === 303 && stA === "needs_reconnect" && both.status === 200 && both.len === 1000 && stL === "disconnected" && both2.status === 303;
    R("US2 scenario 4", ok, out.join("; ") + `; notice shown ${pageText}, names no cause ${noCause}`);
  });
  await run("Edge case 16", async () => {
    const es = await emailEntries(lin, `/people/${ana}`);
    const conns = q(`select string_agg(email||':'||state, ',' order by email) from gmail_connections`);
    R("Edge case 16", countSubj(es, "Both") === 1 && countSubj(es, "GraceMail") === 1 && countSubj(es, "Proposal") === 1, `connections ${conns}; on Ana: Both ${countSubj(es, "Both")} (Linus disconnected, Ada needs reconnect), GraceMail ${countSubj(es, "GraceMail")} (Grace deactivated), Proposal ${countSubj(es, "Proposal")}; attachments: see US2 scenario 4`);
  });

  fs.writeFileSync("/tmp/sf127-b.json", JSON.stringify(S, null, 1));
  await browser.close();
})();
