"use server";
// Deal actions (contracts/routes.md § Server actions). Each checks the user first; src/server/deals/deals.ts
// re-checks visibility, rights and versions inside its transaction. Redirects go to fixed paths built from ids.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminForAction, requireUser } from "@/server/auth/session";
import * as deals from "@/server/deals/deals";
import { boardHref, type DealForm } from "@/server/deals/rules";
import { setFlash } from "@/server/records/flash";
import { dealFormFromData, idFrom } from "@/server/records/form-data";
import { toId } from "@/server/records/rules";
import type { FormState } from "../records/form-state";

async function answer(result: deals.DealSaveResult, values: DealForm, prev: FormState<DealForm>): Promise<FormState<DealForm>> {
  if (result.status === "saved") {
    revalidatePath("/deals");
    redirect(boardHref(result.pipelineId, { open: result.id }));
  }
  if (result.status === "no_longer_visible") {
    await setFlash({ code: "deal_no_longer_visible", name: result.title });
    revalidatePath("/deals");
    redirect(boardHref(result.pipelineId));
  }
  // Gone, archived or not visible: back to the board, nothing said about it.
  if (result.status === "not_found") redirect("/deals");
  return { errors: result.errors, values, seq: (prev?.seq ?? 0) + 1 };
}

export async function createDeal(prev: FormState<DealForm>, formData: FormData): Promise<FormState<DealForm>> {
  const user = await requireUser();
  const values = dealFormFromData(formData);
  return answer(await deals.createDeal(user.id, values), values, prev);
}

export async function updateDeal(prev: FormState<DealForm>, formData: FormData): Promise<FormState<DealForm>> {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect("/deals");
  const values = dealFormFromData(formData);
  const version = idFrom(formData, "version") ?? 0;
  return answer(await deals.updateDeal(user.id, id, version, values), values, prev);
}

// Called by Board.tsx after a drop (not a form). "stale" makes the board show the deal_changed message; the fresh
// board comes back with this action's answer (revalidatePath).
export async function moveDealFromBoard(input: { dealId: unknown; version: unknown; fromStageId: unknown; toStageId: unknown }): Promise<{ status: "moved" | "same" | "stale" }> {
  const user = await requireUser();
  const dealId = toId(input?.dealId);
  const version = toId(input?.version);
  const fromStageId = toId(input?.fromStageId);
  const toStageId = toId(input?.toStageId);
  if (dealId === null || version === null || fromStageId === null || toStageId === null) return { status: "stale" };
  const result = await deals.moveDeal(user.id, { dealId, version, fromStageId, toStageId });
  revalidatePath("/deals");
  return { status: result.status };
}

// The drawer's "Move to" form: works without dragging and without JavaScript.
export async function moveDeal(formData: FormData) {
  const user = await requireUser();
  const id = idFrom(formData);
  const toStageId = idFrom(formData, "toStageId");
  const shown = idFrom(formData, "pipelineId");
  if (id === null || toStageId === null) redirect(boardHref(shown));
  const result = await deals.moveDeal(user.id, { dealId: id, version: idFrom(formData, "version") ?? 0, fromStageId: null, toStageId });
  revalidatePath("/deals");
  if (result.status === "stale") redirect(boardHref(shown, { error: "deal_changed" }));
  redirect(boardHref(result.status === "moved" ? result.pipelineId : shown, { open: id }));
}

export async function archiveDeal(formData: FormData) {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect("/deals");
  const result = await deals.archiveDeal(user.id, id);
  if (result.status === "not_found") redirect("/deals");
  revalidatePath("/deals");
  redirect(boardHref(result.pipelineId));
}

// Admins only: a non-admin is sent to the "You don't have access to this page." page and nothing is deleted.
export async function deleteDeal(formData: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(formData);
  if (id === null) redirect("/deals");
  const result = await deals.deleteDeal(user.id, id);
  if (result.status === "forbidden") redirect("/admin/users");
  if (result.status === "not_found") redirect("/deals");
  await setFlash({ code: "deal_deleted", name: result.name });
  revalidatePath("/deals");
  redirect(boardHref(result.pipelineId));
}
