// SF-121: RFC 8058 one-click unsubscribe, POSTed by mail apps with the body "List-Unsubscribe=One-Click" (no cookie,
// no sign-in). Answers directly, never with a redirect: 400 wrong body → 404 unknown token → 200 / 503.
import { isOneClickBody } from "@/server/records/unsubscribe-rules";
import { unsubscribeByToken } from "@/server/records/unsubscribe";

export const dynamic = "force-dynamic";

const answer = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

async function readBody(req: Request): Promise<URLSearchParams | FormData> {
  if (req.headers.get("content-type")) {
    try {
      return await req.clone().formData();
    } catch {
      // Not form data after all: read it as urlencoded text below.
    }
  }
  return new URLSearchParams(await req.text().catch(() => ""));
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isOneClickBody(await readBody(req))) return answer(400, "Bad request");
  try {
    return (await unsubscribeByToken(token, "mail_app")) === "done" ? answer(200, "Unsubscribed") : answer(404, "Not found");
  } catch {
    return answer(503, "Try again later");
  }
}
