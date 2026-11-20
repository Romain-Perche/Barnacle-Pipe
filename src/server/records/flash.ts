// One-shot notice after a change that leaves the page ("Ada Example was deleted.", "2 private people handed to
// Margaret Fake."), research.md §8. The name is the server's copy from the database, never text from the URL;
// the cookie lives 60 seconds and src/proxy.ts deletes it on the next page load, so it shows once.
import { cookies } from "next/headers";
import { templates } from "@/server/messages";
import { FLASH_COOKIE as COOKIE } from "@/server/records/flash-cookie";

const CODES = ["person_deleted", "organisation_deleted", "person_no_longer_visible", "handed_over", "handover_none"] as const;
export type FlashCode = (typeof CODES)[number];
type Flash = { code: FlashCode; name: string; count?: number };

export async function setFlash(flash: Flash): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify({ code: flash.code, name: flash.name, count: flash.count }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60,
  });
}

function render(code: FlashCode, name: string, count: unknown): string | undefined {
  if (code === "handed_over") {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 10_000) return undefined;
    return templates.handed_over(name, count);
  }
  return templates[code](name);
}

// Only a notice for one of the `allowed` codes is returned; anything else in the cookie is ignored.
export async function readFlash(allowed: FlashCode[]): Promise<{ text: string } | undefined> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { code?: unknown; name?: unknown; count?: unknown };
    const code = allowed.find((c) => c === value.code);
    if (!code || typeof value.name !== "string" || value.name.length > 300) return undefined;
    const text = render(code, value.name, value.count);
    return text === undefined ? undefined : { text };
  } catch {
    return undefined;
  }
}
