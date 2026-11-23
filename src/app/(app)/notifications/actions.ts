"use server";
// Notifications actions (SF-102 contracts/routes.md § Server actions, research.md §12): a form post, never a GET link,
// so link prefetching cannot mark a notification read. Redirects are built from numeric ids and fixed paths only.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import * as notifications from "@/server/notifications";
import { idFrom } from "@/server/records/form-data";

export async function openNotification(form: FormData): Promise<void> {
  const user = await requireUser();
  const eventId = idFrom(form, "eventId");
  const opened = eventId === null ? null : await notifications.openNotification(user.id, eventId);
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
