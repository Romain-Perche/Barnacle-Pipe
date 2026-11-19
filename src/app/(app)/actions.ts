"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/server/auth/cookie";
import { endSession } from "@/server/auth/session";

// [ Sign out ]: ends this browser's session only (other browsers stay signed in).
export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await endSession(token);
  jar.delete(SESSION_COOKIE);
  redirect("/sign-in");
}
