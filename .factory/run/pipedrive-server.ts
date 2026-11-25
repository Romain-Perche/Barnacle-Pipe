// A stand-in Pipedrive over HTTP for the AI review (SF-117): serves Build's FakePipedrive (src/server/pipedrive/
// fake-pipedrive.ts, the same data as the app's in-process fake: buildDevFake()) on $PORT (default 9400), so that a
// second app started with PIPEDRIVE_URL=http://localhost:9400 reads it like the real Pipedrive, and a scenario script
// can steer it: POST /__control with JSON {op, args} calls the fake's own switches (slowDownEvery, failNext, hangNext,
// refuseToken, addPerson, addOrganization, addField, addUser, addCompany, deletePerson, deleteOrganization,
// noMarketingApp), {op:"reset"} rebuilds it, {op:"down", args:[true|false]} answers every call with a network error
// (socket destroyed), {op:"requests"} returns the recorded requests (never the token). SF-122: an addFile byte argument
// is sent as {"__b64": "<base64>"} or {"__fill": [length, byte]}.
// Run: npx tsx .factory/run/pipedrive-server.ts   (see .factory/test-env.md).
import http from "node:http";
import { buildDevFake, type FakePipedrive } from "../../src/server/pipedrive/fake-pipedrive";

const PORT = Number(process.env.PORT || 9400);
let fake: FakePipedrive = buildDevFake();
let down = false;

http
  .createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname === "/__control" && req.method === "POST") {
      const { op, args: raw = [] } = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      // SF-122: bytes for addFile: {"__b64": "..."} or {"__fill": [length, byte]}
      const args = (raw as unknown[]).map((a) =>
        a && typeof a === "object" && "__b64" in (a as object) ? new Uint8Array(Buffer.from((a as { __b64: string }).__b64, "base64"))
        : a && typeof a === "object" && "__fill" in (a as object) ? new Uint8Array((a as { __fill: number[] }).__fill[0]).fill((a as { __fill: number[] }).__fill[1])
        : a);
      let out: unknown = null;
      try {
        if (op === "reset") fake = buildDevFake();
        else if (op === "down") down = !!args[0];
        else if (op === "requests") out = fake.requests;
        else out = (fake as unknown as Record<string, (...a: unknown[]) => unknown>)[op](...args);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, out: out ?? null }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
      return;
    }
    if (down) return req.socket.destroy();
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r = await fake.fetch(`http://localhost:${PORT}${req.url}`, { method: req.method, headers });
    const h: Record<string, string> = {};
    r.headers.forEach((v, k) => (h[k] = v));
    res.writeHead(r.status, h);
    res.end(Buffer.from(await r.arrayBuffer()));
  })
  .listen(PORT, () => console.log(`fake Pipedrive on ${PORT}`));
