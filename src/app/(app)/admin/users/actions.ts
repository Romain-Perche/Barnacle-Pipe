"use server";
// Users page actions. Each one checks admin rights first (FR-011), then src/server/users.ts re-checks
// them inside its locked transaction.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminForAction } from "@/server/auth/session";
import { setFlash } from "@/server/records/flash";
import { handOverPrivateRecords } from "@/server/records/handover";
import * as users from "@/server/users";

const PAGE = "/admin/users";

function userIdFrom(formData: FormData): number | null {
  const id = Number(formData.get("userId"));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function finish(result: users.ChangeResult, onSuccess = PAGE): never {
  // Roles shape the sidebar: render the shared layout again, not only the page.
  revalidatePath("/", "layout");
  if (result.ok) redirect(onSuccess);
  // "forbidden": the actor lost admin rights meanwhile; the page then shows the forbidden message.
  redirect(result.code === "forbidden" ? PAGE : `${PAGE}?error=${result.code}`);
}

export async function addUser(formData: FormData) {
  const actor = await assertAdminForAction();
  finish(await users.addUser(actor.id, String(formData.get("email") ?? "")));
}

async function onUser(formData: FormData, change: (actorId: number, userId: number) => Promise<users.ChangeResult>, home = false) {
  const actor = await assertAdminForAction();
  const userId = userIdFrom(formData);
  if (userId === null) redirect(PAGE);
  // Removing your own admin rights: you can no longer see this page, so go home.
  finish(await change(actor.id, userId), home && userId === actor.id ? "/" : PAGE);
}

export async function makeAdmin(formData: FormData) {
  await onUser(formData, users.makeAdmin);
}
export async function removeAdmin(formData: FormData) {
  await onUser(formData, users.removeAdmin, true);
}
export async function deactivate(formData: FormData) {
  await onUser(formData, users.deactivate);
}
export async function reactivate(formData: FormData) {
  await onUser(formData, users.reactivate);
}

// Hand a deactivated user's private people and private deals to an active user (SF-92 contracts/routes.md §
// handOver, SF-97).
// handOverPrivateRecords re-checks every rule inside its locked transaction.
export async function handOver(formData: FormData) {
  const actor = await assertAdminForAction();
  const userId = userIdFrom(formData);
  if (userId === null) redirect(PAGE);
  const to = Number(formData.get("toUserId"));
  const chooseAgain = `${PAGE}?handover=${userId}&error=handover_choose_user`;
  if (!Number.isSafeInteger(to) || to <= 0) redirect(chooseAgain);
  const result = await handOverPrivateRecords(actor.id, userId, to);
  revalidatePath("/admin/users");
  revalidatePath("/people");
  revalidatePath("/deals");
  switch (result.status) {
    case "handed":
      await setFlash({ code: "handed_over", name: result.toName, count: result.people, deals: result.deals });
      redirect(PAGE);
    case "none":
      await setFlash({ code: "handover_none", name: result.fromName });
      redirect(PAGE);
    case "choose_user":
      redirect(chooseAgain);
    case "not_deactivated":
      redirect(`${PAGE}?error=handover_not_deactivated`);
    case "forbidden":
      redirect(PAGE);
  }
}
