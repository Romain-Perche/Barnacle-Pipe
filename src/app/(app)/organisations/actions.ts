"use server";
// Organisation actions (contracts/routes.md). Each checks the user first; src/server/records/organisations.ts
// re-checks rights inside its transaction.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminForAction, requireUser } from "@/server/auth/session";
import type { SaveResult } from "@/server/records/common";
import { setFlash } from "@/server/records/flash";
import { idFrom, organisationFormFromData } from "@/server/records/form-data";
import * as organisations from "@/server/records/organisations";
import type { OrganisationForm } from "@/server/records/rules";
import type { FormState } from "../records/form-state";

function answer(result: SaveResult, values: OrganisationForm, prev: FormState<OrganisationForm>, id: number | null): FormState<OrganisationForm> {
  if (result.status === "saved") {
    revalidatePath("/organisations");
    redirect(`/organisations/${result.id}`);
  }
  if (result.status === "not_found") redirect(id ? `/organisations/${id}` : "/organisations");
  return { errors: result.errors, values, seq: (prev?.seq ?? 0) + 1 };
}

export async function createOrganisation(prev: FormState<OrganisationForm>, formData: FormData): Promise<FormState<OrganisationForm>> {
  const user = await requireUser();
  const values = organisationFormFromData(formData);
  return answer(await organisations.createOrganisation(user.id, values), values, prev, null);
}

export async function updateOrganisation(prev: FormState<OrganisationForm>, formData: FormData): Promise<FormState<OrganisationForm>> {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect("/organisations");
  const values = organisationFormFromData(formData);
  const version = idFrom(formData, "version") ?? 0;
  return answer(await organisations.updateOrganisation(user.id, id, version, values), values, prev, id);
}

async function archiveOrRestore(formData: FormData, change: (actorId: number, id: number) => Promise<"ok" | "not_found">) {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect("/organisations");
  await change(user.id, id);
  revalidatePath("/organisations");
  redirect(`/organisations/${id}`);
}

export async function archiveOrganisation(formData: FormData) {
  await archiveOrRestore(formData, organisations.archiveOrganisation);
}

export async function restoreOrganisation(formData: FormData) {
  await archiveOrRestore(formData, organisations.restoreOrganisation);
}

// Admins only; the organisation's people stay, with no organisation.
export async function deleteOrganisation(formData: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(formData);
  if (id === null) redirect("/organisations");
  const result = await organisations.deleteOrganisation(user.id, id);
  if (result.status === "forbidden") redirect("/admin/users");
  if (result.status === "not_found") redirect(`/organisations/${id}`);
  await setFlash({ code: "organisation_deleted", name: result.name });
  revalidatePath("/organisations");
  revalidatePath("/people");
  redirect("/organisations");
}
