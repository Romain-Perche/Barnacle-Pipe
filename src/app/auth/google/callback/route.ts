// GET /auth/google/callback?code=…&state=… — Google sends the browser back here.
import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/cookie";
import { signInWithGoogleCode } from "@/server/auth/google";
import { isSafeNext } from "@/server/auth/rules";
import { completeSignIn } from "@/server/auth/sign-in";
import { appBaseUrl, isPreview } from "@/server/env";

type OAuthState = { state: string; verifier: string; next: string };

function readOAuth(raw: string | undefined): OAuthState | null {
  try {
    const v = JSON.parse(raw ?? "") as Partial<OAuthState>;
    return typeof v.state === "string" && typeof v.verifier === "string" ? { state: v.state, verifier: v.verifier, next: isSafeNext(v.next, appBaseUrl()) } : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/auth/google", maxAge: 0 });
    return res;
  };
  if (isPreview()) return go("/sign-in");

  const params = req.nextUrl.searchParams;
  const oauth = readOAuth(req.cookies.get(OAUTH_COOKIE)?.value);
  const code = params.get("code");
  if (!oauth || params.get("error") || !code || params.get("state") !== oauth.state) return go("/sign-in?error=cancelled");

  const google = await signInWithGoogleCode(code, oauth.verifier);
  if (!google.ok) return go("/sign-in?error=cancelled");

  const result = await completeSignIn(google.identity);
  if (!result.ok) return go(`/sign-in?error=${result.code}`);

  const res = go(oauth.next);
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(secure));
  return res;
}
