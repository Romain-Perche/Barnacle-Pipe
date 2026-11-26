"use server";
// Settings actions (SF-117 contracts/routes.md § Server actions; SF-118 contracts/routes.md § Server actions):
// requireUser() first, the signed-in user's own token and connection only, redirects to fixed /settings addresses
// (or Google's consent screen) only. No token is ever sent back.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { newPkce, randomToken } from "@/server/auth/google";
import { requireUser } from "@/server/auth/session";
import { gmailConfig } from "@/server/env";
import { disconnect, GMAIL_OAUTH_COOKIE, GMAIL_OAUTH_PATH } from "@/server/gmail/connections";
import { consentUrl } from "@/server/gmail/google-api";
import { runPastFetchPartFor, startPastFetch, type PageAnswer } from "@/server/gmail/past";
import { testEmail } from "@/server/gmail/rules";
import { GmailNeedsReconnect, sendGmail } from "@/server/gmail/send";
import { removeToken, saveToken } from "@/server/pipedrive/connection";
import { setFlash } from "@/server/records/flash";

export async function saveTokenAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const raw = form.get("token");
  const result = await saveToken(user.id, typeof raw === "string" ? raw : "");
  redirect("ok" in result ? "/settings?saved=1" : `/settings?error=${result.error}`);
}

export async function removeTokenAction(): Promise<void> {
  const user = await requireUser();
  await removeToken(user.id);
  redirect("/settings?removed=1");
}

// SF-118: [ CONNECT GMAIL ] and [ RECONNECT GMAIL ]: remembers this request (state, PKCE verifier, user) in a
// 10-minute cookie only the callback reads, then sends the browser to Google's consent screen.
export async function startGmailConnect(): Promise<void> {
  const user = await requireUser();
  const cfg = gmailConfig();
  if (cfg.mode === "off") redirect("/settings?gmail=unavailable");
  const state = randomToken();
  const { verifier, challenge } = newPkce();
  const url = consentUrl({ state, codeChallenge: challenge, loginHint: user.email });
  const secure = cfg.appUrl.startsWith("https:") || (await headers()).get("x-forwarded-proto") === "https";
  (await cookies()).set(GMAIL_OAUTH_COOKIE, JSON.stringify({ state, verifier, userId: user.id }), {
    httpOnly: true,
    sameSite: "lax",
    path: GMAIL_OAUTH_PATH,
    secure,
    maxAge: 600,
  });
  redirect(url);
}

// SF-118: [ DISCONNECT ] in the confirmation box: forgets the key (Google told after commit, best effort).
export async function disconnectGmail(): Promise<void> {
  const user = await requireUser();
  await disconnect(user.id);
  await setFlash({ code: "gmail_disconnected", name: "" });
  redirect("/settings");
}

// SF-118: [ SEND ME A TEST EMAIL ]: one email from the user's Gmail to their own address (FR-014).
export async function sendTestEmail(): Promise<void> {
  const user = await requireUser();
  let outcome: "sent" | "needs_reconnect" | "failed";
  try {
    await sendGmail(user.id, testEmail(user.email));
    outcome = "sent";
  } catch (e) {
    outcome = e instanceof GmailNeedsReconnect ? "needs_reconnect" : "failed";
  }
  if (outcome === "sent") {
    await setFlash({ code: "gmail_test_sent", name: user.email });
    redirect("/settings");
  }
  redirect(outcome === "needs_reconnect" ? "/settings" : "/settings?gmail=test_failed");
}

// SF-128: [ FETCH PAST EMAILS ]: starts a fetch of the user's own mailbox only on a working connection with none running
// (otherwise nothing changes), then back to Settings.
export async function startPastFetchAction(): Promise<void> {
  const user = await requireUser();
  await startPastFetch(user.id, new Date());
  redirect("/settings");
}

// SF-128: one part of the user's own fetch, called by PastFetchRunner while Settings is open. Answers only what to do
// next: never email content nor text.
export async function runPastFetchPartAction(): Promise<PageAnswer> {
  const user = await requireUser();
  return runPastFetchPartFor(user.id, { now: new Date() });
}
