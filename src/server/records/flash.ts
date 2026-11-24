// One-shot notice after a change that leaves the page (a deal delete or a save that hides a private deal, "Ada Example was deleted.", "2 private people and 1 private
// deal handed to Margaret Fake."), research.md §8. The name is the server's copy from the database, never text from the URL;
// the cookie lives 60 seconds and src/proxy.ts deletes it on the next page load, so it shows once.
import { cookies } from "next/headers";
import { messageFor, templates } from "@/server/messages";
import { FLASH_COOKIE as COOKIE } from "@/server/records/flash-cookie";

const CODES = ["person_deleted", "organisation_deleted", "person_no_longer_visible", "handed_over", "handover_none", "deal_deleted", "deal_no_longer_visible", "note_deleted", "note_not_found", "activity_deleted", "file_deleted", "file_not_found", "custom_field_deleted", "custom_choice_error", "segment_deleted", "segment_not_found",
  // SF-119: a deleted campaign draft (its name from the database) and a draft another user deleted.
  "campaign_deleted", "campaign_gone"] as const;
export type FlashCode = (typeof CODES)[number];
// `count`: people handed over, `deals`: deals handed over (handed_over only). `detail`: the refusal code of a
// custom_choice_error (SF-115: a choice change refused in the custom field box; `name` is the choice typed).
type Flash = { code: FlashCode; name: string; count?: number; deals?: number; detail?: string };
const CHOICE_ERRORS = ["custom_choice_exists", "custom_choice_removed_exists", "custom_choice_last", "custom_choices_limit",
  "custom_choice_name_required", "custom_choice_name_too_long"];

export async function setFlash(flash: Flash): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify({ code: flash.code, name: flash.name, count: flash.count, deals: flash.deals, detail: flash.detail }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60,
  });
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10_000;

function render(code: FlashCode, name: string, count: unknown, deals: unknown = 0, detail: unknown = undefined): string | undefined {
  if (code === "custom_choice_error") {
    if (typeof detail !== "string" || !CHOICE_ERRORS.includes(detail)) return undefined;
    return detail === "custom_choice_exists" ? templates.custom_choice_exists(name) : messageFor(detail);
  }
  if (code === "handed_over") {
    if (!isCount(count) || !isCount(deals) || count + deals < 1) return undefined;
    return templates.handed_over(name, count, deals);
  }
  return templates[code](name);
}

// Only a notice for one of the `allowed` codes is returned; anything else in the cookie is ignored.
export async function readFlash(allowed: FlashCode[]): Promise<{ text: string } | undefined> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { code?: unknown; name?: unknown; count?: unknown; deals?: unknown; detail?: unknown };
    const code = allowed.find((c) => c === value.code);
    if (!code || typeof value.name !== "string" || value.name.length > 300) return undefined;
    const text = render(code, value.name, value.count, value.deals, value.detail);
    return text === undefined ? undefined : { text };
  } catch {
    return undefined;
  }
}
