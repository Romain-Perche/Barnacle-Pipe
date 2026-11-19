// One-shot notice after a delete ("Ada Example was deleted."), research.md §8. The name is the server's copy
// of the deleted record, never text from the URL; the cookie lives 60 seconds.
import { cookies } from "next/headers";
import { templates } from "@/server/messages";

const COOKIE = "crm_flash";
const CODES = ["person_deleted", "organisation_deleted"] as const;
type FlashCode = (typeof CODES)[number];

export async function setFlash(flash: { code: FlashCode; name: string }): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify({ code: flash.code, name: flash.name }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60,
  });
}

// Only a notice for `allowed` codes is returned; anything else in the cookie is ignored.
export async function readFlash(allowed: FlashCode): Promise<{ text: string } | undefined> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { code?: unknown; name?: unknown };
    if (value.code !== allowed || typeof value.name !== "string" || value.name.length > 300) return undefined;
    return { text: templates[allowed](value.name) };
  } catch {
    return undefined;
  }
}
