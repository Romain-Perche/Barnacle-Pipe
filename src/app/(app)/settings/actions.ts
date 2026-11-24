"use server";
// Settings actions (SF-117 contracts/routes.md § Server actions): requireUser() first, the signed-in user's own token
// only, redirects to fixed /settings addresses only. The token is never sent back.
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { removeToken, saveToken } from "@/server/pipedrive/connection";

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
