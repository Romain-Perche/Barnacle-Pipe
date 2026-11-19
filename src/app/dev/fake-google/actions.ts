"use server";
// The fake Google login's actions: the same completeSignIn() as real Google, so the same rules apply.
import { notFound, redirect } from "next/navigation";
import { isSafeNext } from "@/server/auth/rules";
import { setSessionCookie } from "@/server/auth/session";
import { completeSignIn } from "@/server/auth/sign-in";
import { isFakeAllowed } from "@/server/env";

export async function fakeSignIn(formData: FormData) {
  if (!isFakeAllowed()) notFound();
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const next = isSafeNext(String(formData.get("next") ?? "/"));
  const result = await completeSignIn({ email, name: name || null, emailVerified: true, hd: null });
  if (!result.ok) redirect(`/sign-in?error=${result.code}`);
  await setSessionCookie(result.token);
  redirect(next);
}

export async function fakeCancel() {
  if (!isFakeAllowed()) notFound();
  redirect("/sign-in?error=cancelled");
}
