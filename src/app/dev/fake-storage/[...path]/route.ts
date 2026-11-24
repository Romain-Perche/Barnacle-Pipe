// The fake Supabase Storage as the browser reaches it (SF-116 contracts/storage.md § The fake): the signed upload PUT
// and the signed GET of a download or preview. Every method is forwarded to the same in-process FakeStorage the server
// uses, so its tokens, expiry and checks apply. 404 unless fakes are allowed and no real Storage is set.
import { isFakeAllowed, storageConfig } from "@/server/env";
import { fakeStorage } from "@/server/files/fake-storage";

export const dynamic = "force-dynamic";

async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const config = storageConfig();
  if (!isFakeAllowed() || config.mode !== "fake") return new Response("Not found", { status: 404 });
  const rest = (await params).path.map(encodeURIComponent).join("/");
  const url = `${config.baseUrl}/${rest}${new URL(req.url).search}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const res = await fakeStorage().fetch(url, {
    method: req.method === "HEAD" ? "GET" : req.method,
    headers: req.headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
  });
  return req.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

export { forward as GET, forward as PUT, forward as POST, forward as DELETE, forward as HEAD };
