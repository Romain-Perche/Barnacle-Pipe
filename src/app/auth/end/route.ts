// GET /auth/end?reason=removed | ?next=… — clears an ended session (expired, revoked, deactivated user)
// and its cookie, then shows the sign-in page. A still-valid session is left alone (no sign-out by link).
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/cookie";
import { isSafeNext } from "@/server/auth/rules";
import { endSession, lookupSession } from "@/server/auth/session";
import { isPreview } from "@/server/env";

export async function GET(req: NextRequest) {
  const next = isSafeNext(req.nextUrl.searchParams.get("next"));
  const removed = req.nextUrl.searchParams.get("reason") === "removed";
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (token && !isPreview()) {
    const session = await lookupSession(token);
    if (session.ok) return NextResponse.redirect(new URL(next, req.url));
    await endSession(token);
  }

  const target = new URL("/sign-in", req.url);
  if (removed) target.searchParams.set("error", "removed");
  else if (next !== "/") target.searchParams.set("next", next);
  const res = NextResponse.redirect(target);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
