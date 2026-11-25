// POST /gmail/push — Gmail's notices through the Pub/Sub push subscription (SF-118 research.md §6, FR-008, FR-015).
// Only a Google-signed token for this app's subscription is accepted (receiveGmailPush). Answers are empty: 403 bad
// proof, 400 bad body, 204 otherwise (Pub/Sub retries anything that is not 2xx). Never any data.
import { receiveGmailPush } from "@/server/gmail/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const { status } = await receiveGmailPush(req.headers.get("authorization"), body);
  return new Response(null, { status });
}
