"use server";
// Notifications actions (SF-102 contracts/routes.md § Server actions, research.md §12): a form post, never a GET link,
// so link prefetching cannot mark a notification read. Redirects are built from numeric ids and fixed paths only.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { settingsWarning, settingsWarnLabel } from "@/server/gmail/connections";
import * as notifications from "@/server/notifications";
import { idFrom } from "@/server/records/form-data";

// Posts `kind` (mention when absent or unknown; SF-109: assignment; SF-123: reminder) and `id` (`eventId` before SF-109).
export async function openNotification(form: FormData): Promise<void> {
  const user = await requireUser();
  const posted = form.get("kind");
  const kind = posted === "assignment" || posted === "reminder" ? posted : "mention";
  const id = idFrom(form, "id") ?? idFrom(form, "eventId");
  const opened = id === null ? null : await notifications.openNotification(user.id, { kind, id });
  // The sidebar count lives in the shared layout: refresh it.
  revalidatePath("/", "layout");
  redirect(opened ? opened.href : "/notifications");
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  await notifications.markAllRead(user.id);
  revalidatePath("/", "layout");
  redirect("/notifications");
}

// gmailWarn: the Settings "!" shows; warnLabel: its label (SF-124: Gmail needs reconnecting, or Calendar access missing).
export type SidebarState = { unread: number; gmailWarn: boolean; warnLabel: string | null };

// SF-108: the sidebar count right now, asked by UnreadLink after every navigation (the shared layout is not rendered
// again on client navigation); SF-118: with the Settings "!" (Gmail needs reconnecting). Read only: opening a page
// never marks anything read (FR-004).
export async function currentSidebar(): Promise<SidebarState> {
  const user = await requireUser();
  const [unread, warning] = await Promise.all([notifications.unreadCount(user.id), settingsWarning(user.id)]);
  const warnLabel = settingsWarnLabel(warning);
  return { unread, gmailWarn: warnLabel !== null, warnLabel };
}
