// GET /auth/google/start?next=… → Google's account chooser (OAuth code flow + PKCE + state).
import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE } from "@/server/auth/cookie";
import { authorizationUrl, newPkce, randomToken } from "@/server/auth/google";
import { isSafeNext } from "@/server/auth/rules";
import { appBaseUrl, isPreview } from "@/server/env";

export async function GET(req: NextRequest) {
  if (isPreview()) return NextResponse.redirect(new URL("/sign-in", req.url));
  const next = isSafeNext(req.nextUrl.searchParams.get("next"), appBaseUrl());
  const state = randomToken();
  const { verifier, challenge } = newPkce();
  let url: string;
  try {
    url = authorizationUrl({ state, codeChallenge: challenge });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL("/sign-in?error=cancelled", req.url));
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, next }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/auth/google",
    secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    maxAge: 600,
  });
  return res;
}
