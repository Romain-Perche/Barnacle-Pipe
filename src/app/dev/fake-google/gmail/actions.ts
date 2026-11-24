"use server";
// The fake consent screen's buttons (SF-118 research.md §14), development and tests only: [ ALLOW ] makes a code in the
// fake Google for the account and the ticked boxes, [ CANCEL ] returns error=access_denied, both to the app's own
// Gmail callback only.
import { notFound, redirect } from "next/navigation";
import { appBaseUrl, gmailConfig, isFakeAllowed } from "@/server/env";
import { fakeGmail } from "@/server/gmail/fake-gmail";
import { GMAIL_SCOPES } from "@/server/gmail/rules";

const str = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

// The callback address, only when it is this app's Gmail callback.
function callback(form: FormData): URL {
  if (!isFakeAllowed() || gmailConfig().mode !== "fake") notFound();
  const raw = str(form, "redirect_uri");
  const expected = `${appBaseUrl()}/settings/gmail/callback`;
  if (raw !== expected) notFound();
  const url = new URL(raw);
  url.searchParams.set("state", str(form, "state"));
  return url;
}

export async function allowFakeGmail(form: FormData): Promise<void> {
  const url = callback(form);
  const scopes = GMAIL_SCOPES.filter((s) => form.get(`scope:${s}`) === "on");
  const code = fakeGmail().consent({
    email: str(form, "email"),
    scopes,
    codeChallenge: str(form, "code_challenge"),
    redirectUri: str(form, "redirect_uri"),
    clientId: str(form, "client_id"),
    offline: str(form, "access_type") === "offline",
  });
  url.searchParams.set("code", code);
  redirect(url.toString());
}

export async function cancelFakeGmail(form: FormData): Promise<void> {
  const url = callback(form);
  url.searchParams.set("error", "access_denied");
  redirect(url.toString());
}
