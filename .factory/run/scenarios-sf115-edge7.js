// SF-115 Edge case 7 (fix round 1): a Text / Long text filter for the word "empty" matches text containing it, not
// records with no value; only Single choice and Yes/No filters offer "Empty". Run after reset-db.sh.
const H = require("./sf115-lib.js"); const { check, q, go, main } = H;
const names = (p) => p.locator("main table tbody tr").evaluateAll((rs) => rs.map((r) => r.querySelector("td")?.innerText.split("\n")[0].trim()));
(async () => {
  const b = await H.chromium.launch();
  // organisation field 6 "Account code (fake)" (text, in list); person field 5 "Notes (fake)" (long text) shown in list.
  q(`update custom_fields set in_list=true where id=5`);
  q(`delete from custom_values where field_id in (5,6)`);
  q(`insert into custom_values (field_id, organisation_id, text_value) select 6, id, 'Empty shell' from organisations where name='Fakeco Ltd'`);
  q(`insert into custom_values (field_id, person_id, text_value) values (5,36,'line one\nnot EMPTY at all'),(5,38,'nothing here')`);
  const p = await H.newPage(b, "ada@barnacle.ai", "Ada Fake");
  await go(p, "/organisations?cf6=empty"); const o1 = await names(p);
  await go(p, "/organisations?cf6=EMPTY"); const o2 = await names(p);
  await go(p, "/people?cf5=empty"); const p1 = await names(p);
  await go(p, "/organisations"); const textInput = await p.locator('[name="cf6"]').evaluate((e) => e.tagName + ":" + (e.type || ""));
  await go(p, "/deals/list"); const ynOpts = await p.locator('select[name="cf9"] option').allInnerTexts();
  await go(p, "/people"); const scOpts = await p.locator('select[name="cf1"] option').allInnerTexts();
  const cara = q(`select trim(first_name||' '||last_name) from persons where id=36`);
  check("Edge case 7", JSON.stringify(o1) === '["Fakeco Ltd"]' && JSON.stringify(o2) === '["Fakeco Ltd"]' && JSON.stringify(p1) === JSON.stringify([cara])
    && textInput.startsWith("INPUT") && ynOpts.some((o) => /empty/i.test(o)) && scOpts.some((o) => /empty/i.test(o)),
    `orgs cf6=empty → ${JSON.stringify(o1)}, cf6=EMPTY → ${JSON.stringify(o2)}; people Notes=empty → ${JSON.stringify(p1)} (expected ${cara}); text filter control ${textInput}; Yes/No options ${JSON.stringify(ynOpts)}; Diet options ${JSON.stringify(scOpts)}`);
  await b.close();
})();
