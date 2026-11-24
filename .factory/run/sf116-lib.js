// SF-116 helpers for the AI review's file scenarios (run with NODE_PATH=/opt/playwright/node_modules).
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { execSync } = require("child_process");
const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DB || "crm_dev";
const DIR = path.join(os.tmpdir(), "sf116-files");
function sql(q) { return execSync(`/usr/lib/postgresql/17/bin/psql -h localhost -U postgres -d ${DB} -tAc ${JSON.stringify(q)}`).toString().trim(); }
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
// Test files made once in $TMPDIR/sf116-files.
function makeFiles() {
  fs.mkdirSync(DIR, { recursive: true });
  const pdfHead = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%");
  const files = {
    "proposal.pdf": Buffer.concat([pdfHead, crypto.randomBytes(Math.round(2.1 * 1024 * 1024) - pdfHead.length)]),
    "exact25.bin": crypto.randomBytes(25 * 1024 * 1024),
    "big26.bin": crypto.randomBytes(26 * 1024 * 1024),
    "empty.txt": Buffer.alloc(0),
    "notes.docx": crypto.randomBytes(5000),
    "fake.png": Buffer.from("this is only text, not an image\n"),
    "pic.svg": Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    "page.html": Buffer.from("<html><script>alert(1)</script></html>"),
    "data.csv": Buffer.from("a,b\n1,2\n"),
    "shot.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
    "<b>bold<\\b> ü日本.txt": Buffer.from("markup name\n"),
    "small.pdf": Buffer.concat([pdfHead, Buffer.from("small")]),
  };
  for (const [n, b] of Object.entries(files)) { const p = path.join(DIR, n); if (!fs.existsSync(p) || fs.statSync(p).size !== b.length) fs.writeFileSync(p, b); }
  return (n) => path.join(DIR, n);
}
async function upload(page, paths) {
  await page.locator('input[aria-label="Files to add"]').first().setInputFiles(paths);
  await page.waitForFunction(() => { const s = document.querySelector(".upload-status"); return s && !s.querySelector(".uploading") && s.querySelector(".notice,.err"); }, null, { timeout: 120000 });
  const text = await page.locator(".upload-status").first().innerText();
  await page.waitForLoadState("networkidle"); await page.waitForTimeout(1200); // router.refresh() re-renders the list after the notice
  return text;
}
async function filesText(page) { return page.locator('section[aria-label="Files"]').first().innerText(); }
async function rows(page) { return page.locator("table.files-table tbody tr").allInnerTexts(); }
module.exports = { BASE, sql, sha, makeFiles, upload, filesText, rows, DIR };
