// SF-121: the unsubscribe page's [ UNSUBSCRIBE ] button (a plain HTML form, no server action, no sign-in). Unsubscribes
// and sends the browser back to the page with a 303; on a database error, back with ?error=unavailable. No cookie is
// read or set; GET is not exported (405).
import { NextResponse } from "next/server";
import { appBaseUrl } from "@/server/env";
import { unsubscribeByToken } from "@/server/records/unsubscribe";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = new URL(`/unsubscribe/${encodeURIComponent(token)}`, appBaseUrl());
  try {
    await unsubscribeByToken(token, "link");
  } catch {
    page.searchParams.set("error", "unavailable");
  }
  return NextResponse.redirect(page, 303);
}
