// POST /dev/fake-google/gmail/answer — the fake consent screen's buttons (SF-118 research.md §14, plan.md Fix round 1),
// development and tests only. [ ALLOW ] (decision=allow) makes a code in the fake Google for the account and the ticked
// boxes, [ CANCEL ] (decision=cancel) returns error=access_denied, both with the state, to the app's own Gmail callback
// only. A 303 so the browser loads the callback as a full navigation, as after real Google, and sends the
// crm_gmail_oauth cookie (path /settings/gmail).
import { notFound } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { appBaseUrl, gmailConfig, isFakeAllowed } from "@/server/env";
import { fakeGmail } from "@/server/gmail/fake-gmail";
import { askedScopes } from "@/server/gmail/rules";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isFakeAllowed() || gmailConfig().mode !== "fake") notFound();
  const form = await req.formData();
  const str = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const redirectUri = str("redirect_uri");
  if (redirectUri !== `${appBaseUrl()}/settings/gmail/callback`) notFound();
  const decision = str("decision");
  if (decision !== "allow" && decision !== "cancel") notFound();
  const url = new URL(redirectUri);
  url.searchParams.set("state", str("state"));
  if (decision === "cancel") url.searchParams.set("error", "access_denied");
  else {
    const code = fakeGmail().consent({
      email: str("email"),
      scopes: askedScopes().filter((s) => form.get(`scope:${s}`) === "on"),
      codeChallenge: str("code_challenge"),
      redirectUri,
      clientId: str("client_id"),
      offline: str("access_type") === "offline",
    });
    url.searchParams.set("code", code);
  }
  return NextResponse.redirect(url, 303);
}
