"use server";
// Lead sources and labels (contracts/routes.md): admins only. assertAdminForAction() first; choices.ts
// re-checks the actor is an active admin inside its transaction.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminForAction } from "@/server/auth/session";
import * as choices from "@/server/records/choices";
import { idFrom } from "@/server/records/form-data";

const PAGE = "/admin/lead-sources-and-labels";

function finish(result: choices.ChoiceResult): never {
  revalidatePath(PAGE);
  if (result.ok || result.code === "not_found") redirect(PAGE);
  // "forbidden": the actor lost admin rights meanwhile; the page then shows the forbidden message.
  redirect(result.code === "forbidden" ? PAGE : `${PAGE}?error=${result.code}`);
}

const name = (fd: FormData) => String(fd.get("name") ?? "");

async function add(kind: choices.ChoiceKind, fd: FormData) {
  const user = await assertAdminForAction();
  finish(await choices.addChoice(user.id, kind, name(fd)));
}
async function rename(kind: choices.ChoiceKind, fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id === null) redirect(PAGE);
  finish(await choices.renameChoice(user.id, kind, id, name(fd)));
}
async function remove(kind: choices.ChoiceKind, fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id === null) redirect(PAGE);
  finish(await choices.removeChoice(user.id, kind, id));
}

export async function addLeadSource(fd: FormData) {
  await add("lead_source", fd);
}
export async function renameLeadSource(fd: FormData) {
  await rename("lead_source", fd);
}
export async function removeLeadSource(fd: FormData) {
  await remove("lead_source", fd);
}
export async function addLabel(fd: FormData) {
  await add("label", fd);
}
export async function renameLabel(fd: FormData) {
  await rename("label", fd);
}
export async function removeLabel(fd: FormData) {
  await remove("label", fd);
}
