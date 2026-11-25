// A stand-in Supabase Storage for edge cases (SF-116): listens on $PORT (default 54321) and forwards
// /storage/v1/* to the app's fake storage at $UPSTREAM (default http://localhost:3000/dev/fake-storage).
// Answers CORS like Storage (the browser PUTs uploads to it). MODE=fail-deletes answers 500 to every DELETE (Storage failing to remove contents); MODE=pass forwards all.
// Start a second app with SUPABASE_URL=http://localhost:54321 SUPABASE_SECRET_KEY=fake-storage-key (see test-env.md).
const http = require("http");
const PORT = Number(process.env.PORT || 54321);
const UP = process.env.UPSTREAM || "http://localhost:3000/dev/fake-storage";
const MODE = process.env.MODE || "pass";
// SF-122: DELAY=<ms> holds every PUT (an upload) that long before forwarding it (a slow file copy); POST /__mode
// {"mode": "pass"|"fail-deletes"|"down", "delay": ms} changes both at run time ("down": every Storage call answers 503).
let mode = MODE, delay = Number(process.env.DELAY || 0);
http.createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS", "access-control-allow-headers": "*" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  if (req.url === "/__mode") { const j = JSON.parse(Buffer.concat(chunks).toString() || "{}"); if (j.mode) mode = j.mode; if (j.delay !== undefined) delay = j.delay; res.writeHead(200); return res.end("ok"); }
  if (mode === "down") { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"statusCode":"503","error":"unavailable","message":"fake outage"}'); }
  if (req.method === "PUT" && delay) await new Promise((r) => setTimeout(r, delay));
  if (mode === "fail-deletes" && req.method === "DELETE") { res.writeHead(500, { "content-type": "application/json" }); return res.end('{"statusCode":"500","error":"internal","message":"fake failure"}'); }
  const url = UP + req.url.replace(/^\/storage\/v1/, "");
  const headers = { ...req.headers }; delete headers.host; delete headers["content-length"];
  try {
    const r = await fetch(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: "manual" });
    const h = {}; r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "content-length"].includes(k)) h[k] = v; });
    res.writeHead(r.status, { ...h, ...cors }); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(PORT, () => console.log(`storage proxy on ${PORT} → ${UP} (${MODE})`));
