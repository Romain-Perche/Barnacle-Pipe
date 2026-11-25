// GET /settings/gmail/callback?code=…&state=… — Google's consent screen sends the browser back here (SF-118
// research.md §3). Signed-in users only; the return must belong to the request this user started (cookie
// crm_gmail_oauth). The cookie is always cleared. A 303 to /settings: the success notice through the one-shot flash,
// a refusal as a fixed ?gmail= code. SF-124: once the answer is sent, a first calendar sync (the planned activities
// due today or later go into the calendar; syncCalendar does nothing without the Calendar permission).
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/session";
import { runAfterResponse } from "@/server/calendar/soon";
import { calendarConnectionOf, syncCalendar } from "@/server/calendar/sync";
import { connectFromCallback, GMAIL_OAUTH_COOKIE, GMAIL_OAUTH_PATH } from "@/server/gmail/connections";
import { setFlash } from "@/server/records/flash";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const jar = await cookies();
  const cookie = jar.get(GMAIL_OAUTH_COOKIE)?.value;
  jar.set(GMAIL_OAUTH_COOKIE, "", { path: GMAIL_OAUTH_PATH, maxAge: 0 });
  const outcome = await connectFromCallback(user, cookie, req.nextUrl.searchParams);
  if (outcome === "connected" || outcome === "reconnected") {
    runAfterResponse(async () => {
      const id = await calendarConnectionOf(user.id);
      if (id !== null) await syncCalendar(id);
    });
    await setFlash({ code: outcome === "connected" ? "gmail_connected" : "gmail_reconnected", name: "" });
    return NextResponse.redirect(new URL("/settings", req.url), 303);
  }
  return NextResponse.redirect(new URL(`/settings?gmail=${outcome}`, req.url), 303);
}
