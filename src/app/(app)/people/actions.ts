"use server";
// People actions (contracts/routes.md). Each checks the user first; src/server/records/people.ts re-checks
// visibility and rights inside its transaction.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminForAction, requireUser } from "@/server/auth/session";
import { setFlash } from "@/server/records/flash";
import { idFrom, personFormFromData } from "@/server/records/form-data";
import * as people from "@/server/records/people";
import type { SaveResult } from "@/server/records/common";
import type { PersonForm } from "@/server/records/rules";
import type { FormState } from "../records/form-state";

async function answer(result: SaveResult, values: PersonForm, prev: FormState<PersonForm>, id: number | null): Promise<FormState<PersonForm>> {
  if (result.status === "saved") {
    revalidatePath("/people");
    revalidatePath("/organisations");
    // The actor's own save hid the person from them (SF-92 FR-003): the People list says so, once.
    if (result.visible === false) {
      await setFlash({ code: "person_no_longer_visible", name: result.name ?? "" });
      redirect("/people");
    }
    redirect(`/people/${result.id}`);
  }
  // Gone or not visible: its address shows "Page not found.".
  if (result.status === "not_found") redirect(id ? `/people/${id}` : "/people");
  return { errors: result.errors, values, seq: (prev?.seq ?? 0) + 1 };
}

export async function createPerson(prev: FormState<PersonForm>, formData: FormData): Promise<FormState<PersonForm>> {
  const user = await requireUser();
  const values = personFormFromData(formData);
  return answer(await people.createPerson(user.id, values), values, prev, null);
}

export async function updatePerson(prev: FormState<PersonForm>, formData: FormData): Promise<FormState<PersonForm>> {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect("/people");
  const values = personFormFromData(formData);
  const version = idFrom(formData, "version") ?? 0;
  return answer(await people.updatePerson(user.id, id, version, values), values, prev, id);
}

async function archiveOrRestore(formData: FormData, change: (actorId: number, id: number) => Promise<"ok" | "not_found">) {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect("/people");
  await change(user.id, id);
  revalidatePath("/people");
  redirect(`/people/${id}`);
}

export async function archivePerson(formData: FormData) {
  await archiveOrRestore(formData, people.archivePerson);
}

export async function restorePerson(formData: FormData) {
  await archiveOrRestore(formData, people.restorePerson);
}

// Admins only: a non-admin is sent to the "You don't have access to this page." page and nothing is deleted.
export async function deletePerson(formData: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(formData);
  if (id === null) redirect("/people");
  const result = await people.deletePerson(user.id, id);
  if (result.status === "forbidden") redirect("/admin/users");
  if (result.status === "not_found") redirect(`/people/${id}`);
  await setFlash({ code: "person_deleted", name: result.name });
  revalidatePath("/people");
  redirect("/people");
}
