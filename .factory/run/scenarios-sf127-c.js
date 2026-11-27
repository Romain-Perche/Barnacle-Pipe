// SF-127 AI review, part c (fix round 1): edges 17 and 18, edge 14 again (its check reordered in part b) and US6
// scenario 4 (not in part a). ONLY="Edge case 18,US6 scenario 4" runs some of them.
// Runs after part b on the same data: it connects Ada's and Linus's mailboxes again first (part b breaks them).
const fs = require("fs");
const { execFileSync } = require("child_process");
const { chromium, A, L, q, norm, R, pageAs, go, put, connect, conv, pid, emailEntries, countSubj } = require("./sf127-lib");
const ADA = "Ada Fake <ada@barnacle.ai>", LIN = "Linus Fake <linus@barnacle.ai>", ANA = "Ana Example <ana@example.test>";
const ctlEnv = { ...process.env, APP_ENV: "development", DATABASE_URL: "postgres://postgres@localhost:5432/crm_dev", GMAIL_TOKEN_KEY: fs.readFileSync("/tmp/gmail-token-key", "utf8").trim(), APP_URL: "http://localhost:3000" };
const ctl = (...args) => execFileSync("npx", ["tsx", ".factory/run/gmail-ctl.ts", ...args], { encoding: "utf8", env: ctlEnv }).trim().split("\n").pop();
async function run(name, fn) { if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) return; try { await fn(); } catch (e) { R(name, false, "error: " + e.message.split("\n")[0]); } }
const UNAVAILABLE = "This attachment can't be fetched from Gmail right now. Try again later.";

(async () => {
  const browser = await chromium.launch();
  const ada = await pageAs(browser, A), lin = await pageAs(browser, L);
  ctl("unreachable", "off");
  const working = (e) => q(`select count(*) from gmail_connections where email='${e}' and state='working'`) === "1";
  if (!working(A)) await connect(ada);
  if (!working(L)) await connect(lin);
  const conns = q(`select email||':'||state from gmail_connections where email in ('${A}','${L}') order by 1`).replace(/\n/g, ", ");
  console.log("connections", conns);
  const ana = pid("Ana");

  await run("Edge case 17", async () => {
    await put(ada, A, { from: ANA, to: ADA, subject: "BackLink17", text: "Attachment soon gone.", att: ["back17.pdf:3000"] });
    ctl("delete", A, "BackLink17");
    // Open the conversation from Ana's timeline, as a user would.
    await go(ada, `/people/${ana}`);
    const entry = ada.getByRole("region", { name: "Timeline" }).locator("li.ent:has(.kd.email)", { hasText: "BackLink17" }).first();
    await Promise.all([ada.waitForURL(/\/emails\/\d+/), entry.locator("a.subj").click()]);
    await ada.waitForLoadState("networkidle");
    const opened = new URL(ada.url());
    const dl = ada.locator('a[aria-label="Download back17.pdf"]');
    const href = await dl.getAttribute("href");
    let downloaded = false;
    ada.once("download", () => { downloaded = true; });
    await Promise.all([ada.waitForURL(/notice=attachment-unavailable/), dl.click()]);
    await ada.waitForLoadState("networkidle");
    const text = norm(await ada.locator("main").innerText());
    const back = ada.locator("a", { hasText: "← ANA EXAMPLE" });
    const backHref = (await back.count()) ? await back.first().getAttribute("href") : null;
    const u = new URL(ada.url());
    R("Edge case 17", text.includes(UNAVAILABLE) && backHref === `/people/${ana}` && !downloaded,
      `opened ${opened.pathname}${opened.search}; download href ${href}; landed ${u.pathname}${u.search}${u.hash}; notice ${text.includes(UNAVAILABLE)}; back link ${backHref}; downloaded ${downloaded}`);
  });

  await run("Edge case 18", async () => {
    const mid = `<dup18-${Date.now()}@example.test>`;
    const o = { from: ANA, to: `${ADA}, ${LIN}`, subject: "Dup18", text: "Two files, one name.", att: ["dup.pdf:1000", "dup.pdf:2000"], messageId: mid };
    await put(ada, A, o); await put(lin, L, o);
    const c = conv("Dup18");
    const copies = q(`select count(*) from email_messages where subject='Dup18'`);
    await go(ada, `/emails/${c}`);
    const hrefs = await ada.locator('a[aria-label="Download dup.pdf"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const sizes = async () => { const out = []; for (const h of hrefs) { const r = await ada.context().request.get("http://localhost:3000" + h, { maxRedirects: 0 }); out.push(`${r.status()}/${(await r.body()).length}`); } return out; };
    const own = await sizes();
    // The shown copy's mailbox no longer has it: the other copy (Linus's) answers, part by part.
    const shownOwner = q(`select g.email from email_attachments a join email_messages m on m.id=a.message_id join gmail_connections g on g.id=m.connection_id where a.id=${hrefs[0].split("/")[3]}`);
    ctl("delete", shownOwner, "Dup18");
    const fallback = await sizes();
    const onAna = countSubj(await emailEntries(ada, `/people/${ana}`), "Dup18");
    R("Edge case 18", copies === "2" && hrefs.length === 2 && own.join() === "200/1000,200/2000" && fallback.join() === "200/1000,200/2000",
      `copies ${copies}, shown once on Ana ${onAna}; links ${hrefs.join(" ")}; own mailbox (${shownOwner}) ${own.join(", ")}; after deleting it there, from the other copy ${fallback.join(", ")}`);
  });

  await run("Edge case 14", async () => {
    await put(ada, A, { from: ANA, to: ADA, subject: "SecretLink3", text: "Linked to a private person by hand." });
    const c = conv("SecretLink3");
    const kim = pid("Kim");
    q(`update persons set private = true, owner_id = 1 where id = ${kim}`);
    await go(ada, `/emails/${c}?link=person`);
    await ada.getByRole("combobox", { name: "Person" }).fill("Kim Twoaddr");
    await ada.getByRole("option", { name: "Kim Twoaddr", exact: true }).click();
    await Promise.all([ada.waitForURL(/notice=/), ada.getByRole("button", { name: "[ LINK ]" }).click()]);
    const lp = (await go(lin, `/emails/${c}`)).status();
    const onAna = countSubj(await emailEntries(lin, `/people/${ana}`), "SecretLink3");
    const fay = (await go(lin, `/emails/${conv("FayConv")}`)).status();
    q(`update persons set private = false where id = ${kim}`);
    const viaOrg = (await go(lin, `/emails/${conv("CatConv")}`)).status(); // linked to Mover Org (and Kim) by hand in US4 3
    const orgPrivate = q(`select count(*) from information_schema.columns where table_name='organisations' and column_name='private'`);
    R("Edge case 14", lp === 404 && onAna === 0 && fay === 404 && viaOrg === 200 && orgPrivate === "0",
      `linked to private Kim: Linus page ${lp}, on Ana ${onAna}; FayConv (private deal) ${fay}; CatConv (org link) ${viaOrg}; organisations private column ${orgPrivate}`);
  });

  await run("US6 scenario 4", async () => {
    const pia = pid("Pia");
    q(`update persons set private = true, owner_id = 1, last_contacted_at = '2026-11-01 09:00+00' where id = ${pia}`);
    await put(ada, A, { from: "Pia Private <pia@example.test>", to: ADA, subject: "PiaLC", text: "Private contact." });
    const at = q(`select to_char(received_at at time zone 'UTC','YYYY-MM-DD HH24:MI') from email_messages where subject='PiaLC' limit 1`);
    const lc = q(`select to_char(last_contacted_at at time zone 'UTC','YYYY-MM-DD HH24:MI') from persons where id=${pia}`);
    await go(ada, `/people/${pia}`);
    const page = norm(await ada.locator("main").innerText());
    const m = /LAST CONTACTED\s+(.{0,25})/i.exec(page);
    R("US6 scenario 4", lc === at && lc > "2026-11-01", `private Pia: last contacted 2026-11-01 09:00 → ${lc} (email at ${at}); Ada sees "${m ? m[0] : "?"}"`);
  });

  await browser.close();
})();
