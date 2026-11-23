"use server";
// Notifications actions (SF-102 contracts/routes.md § Server actions, research.md §12): a form post, never a GET link,
// so link prefetching cannot mark a notification read. Redirects are built from numeric ids and fixed paths only.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import * as notifications from "@/server/notifications";
import { idFrom } from "@/server/records/form-data";

// Posts `kind` (mention when absent; SF-109: assignment) and `id` (`eventId` before SF-109).
export async function openNotification(form: FormData): Promise<void> {
  const user = await requireUser();
  const kind = form.get("kind") === "assignment" ? "assignment" : "mention";
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

// SF-108: the sidebar count right now, asked by UnreadLink after every navigation (the shared layout is not rendered
// again on client navigation). Read only: opening a page never marks anything read (FR-004).
export async function currentUnread(): Promise<number> {
  const user = await requireUser();
  return notifications.unreadCount(user.id);
}
