// GET /cron/gmail — the 15-minute Gmail check and the daily renewal of Gmail's notices (SF-118 research.md §7), run by
// Vercel's cron (vercel.json) with "Authorization: Bearer ${CRON_SECRET}", compared in constant time. 401 without it,
// 204 after the check; empty bodies. With Gmail off it does nothing.
import { createHash, timingSafeEqual } from "node:crypto";
import { gmailConfig } from "@/server/env";
import { runGmailCheck } from "@/server/gmail/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const digest = (v: string) => createHash("sha256").update(v).digest();

function cronAllowed(authorization: string | null, secret: string): boolean {
  if (secret.length < 16) return false;
  return timingSafeEqual(digest(authorization ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(req: Request) {
  const cfg = gmailConfig();
  if (cfg.mode === "off") return new Response(null, { status: 204 });
  if (!cronAllowed(req.headers.get("authorization"), cfg.cronSecret)) return new Response(null, { status: 401 });
  await runGmailCheck(new Date());
  return new Response(null, { status: 204 });
}
