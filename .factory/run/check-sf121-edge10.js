const { chromium } = require("playwright");
(async () => { const b = await chromium.launch(); const p = await b.newPage(); const r = await p.goto("http://localhost:3002/dev/unsubscribe-links");
console.log(r.status(), (await p.locator("body").innerText()).replace(/\s+/g," ").slice(0,200)); await b.close(); })();
