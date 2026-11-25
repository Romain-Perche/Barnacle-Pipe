// Next.js proxy: runs before every page. No session cookie on a protected path → sign-in page.
// It only checks that the cookie is there; requireUser() checks the session itself. SF-116: the matcher leaves out
// /dev/fake-storage: the proxy would cut upload bodies at 10 MB, and the fake checks its own tokens like Storage's
// signed addresses (it answers 404 outside development/test).
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/cookie";
import { FLASH_COOKIE } from "@/server/records/flash-cookie";

// SF-118: Google's push (/gmail/push, a Google-signed token), Vercel's cron (/cron/gmail, CRON_SECRET) and the fake
// Gmail pages (404 outside development/test) check their own proof; /settings/gmail/callback stays protected.
const PUBLIC = [
  /^\/sign-in\/?$/,
  /^\/auth(\/|$)/,
  /^\/dev\/fake-google\/?$/,
  /^\/dev\/fake-google\/gmail(\/answer)?\/?$/,
  /^\/dev\/fake-gmail\/?$/,
  /^\/gmail\/push\/?$/,
  /^\/cron\/gmail\/?$/,
  // SF-124: Google Calendar change notices (channel token checked by the route) and the fake calendar page (404 outside fake mode).
  /^\/calendar\/push\/?$/,
  /^\/dev\/fake-calendar\/?$/,
  // SF-121: public by design, the token in the address is the authority (the page, its button, RFC 8058 one-click);
  // the development links page answers 404 outside development and test.
  /^\/unsubscribe\/[^/]+(\/(confirm|one-click))?\/?$/,
  /^\/dev\/unsubscribe-links\/?$/,
];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const isPublic = PUBLIC.some((re) => re.test(pathname));

  if (!isPublic && !token) {
    const url = new URL("/sign-in", req.url);
    if (pathname !== "/" || search) url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname + search);
  const res = NextResponse.next({ request: { headers } });
  // Keep the cookie alive while the app is used (FR-006). Only on page loads: server actions and
  // /auth routes set or delete the cookie themselves.
  if (token && !isPublic && req.method === "GET") {
    const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(secure));
  }
  // The delete notice shows once: the browser drops the cookie, but the page still reads it from this request.
  // A raw header, after any res.cookies change: res.cookies also rewrites the cookies the page sees.
  if (req.method === "GET" && req.cookies.has(FLASH_COOKIE)) {
    res.headers.append("set-cookie", `${FLASH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|dev/fake-storage/|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
