// SF-122 US3-4: an imported deal's board card shows its next planned activity, not "⚠ No next activity".
// Run after any sf122 import (e.g. scenarios-sf122-a.js), app on BASE (default :3000).
const L = require("./sf122-lib");
(async () => {
  const b = await L.chromium.launch();
  const p = await L.newPage(b, "ada@barnacle.ai", "Ada Fake");
  await p.goto(L.BASE + "/deals");
  for (const t of ["SF122 lead in deal", "SF122 today call", "SF122 demo deal", "Fake deal 03"]) {
    const card = p.locator("li, article, a", { hasText: t }).last();
    console.log(t, "=>", (await card.count()) ? (await card.innerText()).replace(/\s+/g, " ") : "(not on this board)");
  }
  await b.close();
})();
