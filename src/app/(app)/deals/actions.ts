"use server";
// Deal actions (contracts/routes.md § Server actions; SF-95 adds the deal page's). Each checks the user first;
// src/server/deals/*.ts re-checks visibility, rights, state and versions inside its transaction. Redirects go to
// fixed paths built from ids; `back` is read through an allow-list (parseBack).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminForAction, requireUser } from "@/server/auth/session";
import * as deals from "@/server/deals/deals";
import * as links from "@/server/deals/links";
import { boardHref, parseBack, type Back, type DealForm } from "@/server/deals/rules";
import { setFlash } from "@/server/records/flash";
import { dealFormFromData, idFrom } from "@/server/records/form-data";
import { toId } from "@/server/records/rules";
import type { FormState } from "../records/form-state";
import { calendarAfterChange } from "@/server/calendar/sync";
import { runAfterResponse } from "@/server/calendar/soon";

const LIST = "/deals/list";
const page = (id: number, extra = "") => `/deals/${id}${extra}`;

function backFrom(fd: FormData): Back | null {
  const v = fd.get("back");
  return parseBack(typeof v === "string" ? v : null);
}

// The board, the list and the deal page all show the deal.
function refresh(id?: number) {
  revalidatePath("/deals");
  revalidatePath(LIST);
  if (id !== undefined) revalidatePath(page(id));
}

// Where a saved deal is shown again: its page, the list with its drawer, or (default) the board with its drawer.
function dealHome(back: Back | null, id: number, pipelineId: number): string {
  if (back === "page") return page(id);
  if (back === "list") return `${LIST}?open=${id}`;
  return boardHref(pipelineId, { open: id });
}

async function answer(result: deals.DealSaveResult, values: DealForm, prev: FormState<DealForm>, back: Back | null): Promise<FormState<DealForm>> {
  if (result.status === "saved") {
    refresh(result.id);
    redirect(dealHome(back, result.id, result.pipelineId));
  }
  if (result.status === "no_longer_visible") {
    await setFlash({ code: "deal_no_longer_visible", name: result.title });
    refresh();
    redirect(back ? LIST : boardHref(result.pipelineId));
  }
  // Gone, archived or not visible: back to the board (or the list), nothing said about it.
  if (result.status === "not_found") redirect(back ? LIST : "/deals");
  return { errors: result.errors, values, seq: (prev?.seq ?? 0) + 1 };
}

export async function createDeal(prev: FormState<DealForm>, formData: FormData): Promise<FormState<DealForm>> {
  const user = await requireUser();
  const values = dealFormFromData(formData);
  return answer(await deals.createDeal(user.id, values), values, prev, null);
}

export async function updateDeal(prev: FormState<DealForm>, formData: FormData): Promise<FormState<DealForm>> {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect("/deals");
  const values = dealFormFromData(formData);
  const version = idFrom(formData, "version") ?? 0;
  return answer(await deals.updateDeal(user.id, id, version, values), values, prev, backFrom(formData));
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
  refresh(dealId);
  return { status: result.status };
}

// The drawer's "Move to" form: works without dragging and without JavaScript. From the list's drawer (`back=list`)
// it returns to the list.
export async function moveDeal(formData: FormData) {
  const user = await requireUser();
  const id = idFrom(formData);
  const toStageId = idFrom(formData, "toStageId");
  const shown = idFrom(formData, "pipelineId");
  const back = backFrom(formData);
  if (id === null || toStageId === null) redirect(back ? LIST : boardHref(shown));
  const result = await deals.moveDeal(user.id, { dealId: id, version: idFrom(formData, "version") ?? 0, fromStageId: null, toStageId });
  refresh(id);
  if (back) redirect(`${LIST}?open=${id}`);
  if (result.status === "stale") redirect(boardHref(shown, { error: "deal_changed" }));
  redirect(boardHref(result.status === "moved" ? result.pipelineId : shown, { open: id }));
}

// The deal page's stage bar (SF-95 FR-003): the same move as the board, refused when the deal changed meanwhile.
export async function moveDealFromPage(formData: FormData) {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect(LIST);
  const toStageId = idFrom(formData, "toStageId");
  const fromStageId = idFrom(formData, "fromStageId");
  const version = idFrom(formData, "version") ?? 0;
  const result = toStageId === null ? { status: "stale" as const } : await deals.moveDeal(user.id, { dealId: id, version, fromStageId, toStageId });
  refresh(id);
  redirect(result.status === "stale" ? page(id, "?error=deal_edit_conflict") : page(id));
}

export async function archiveDeal(formData: FormData) {
  const user = await requireUser();
  const id = idFrom(formData);
  const back = backFrom(formData);
  if (id === null) redirect("/deals");
  const result = await deals.archiveDeal(user.id, id);
  if (result.status === "not_found") redirect(back ? LIST : "/deals");
  refresh(id);
  redirect(back === "page" ? page(id) : back === "list" ? LIST : boardHref(result.pipelineId));
}

// Admins only: a non-admin is sent to the "You don't have access to this page." page and nothing is deleted.
export async function deleteDeal(formData: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(formData);
  const back = backFrom(formData);
  if (id === null) redirect("/deals");
  const result = await deals.deleteDeal(user.id, id);
  if (result.status === "forbidden") redirect("/admin/users");
  if (result.status === "not_found") redirect(back ? LIST : "/deals");
  // SF-124: once the answer is sent, the events of the activities deleted with it leave Google Calendar.
  runAfterResponse(() => calendarAfterChange([]));
  await setFlash({ code: "deal_deleted", name: result.name });
  refresh(id);
  redirect(back ? LIST : boardHref(result.pipelineId));
}

// --- The deal page (SF-95 contracts/routes.md § Server actions) --------------------------------------------------

async function result(id: number | null, run: (id: number) => Promise<deals.StatusResult>) {
  if (id === null) redirect(LIST);
  const r = await run(id);
  refresh(id);
  if (r.status === "not_found") redirect(LIST);
  if (r.status === "conflict") redirect(page(id, "?error=deal_edit_conflict"));
  if (r.status === "invalid") redirect(page(id, `?confirm=lost&error=${r.code}`));
  redirect(page(id));
}

export async function markWon(formData: FormData) {
  const user = await requireUser();
  const version = idFrom(formData, "version") ?? 0;
  await result(idFrom(formData), (id) => deals.markWon(user.id, id, version));
}

export async function markLost(formData: FormData) {
  const user = await requireUser();
  const version = idFrom(formData, "version") ?? 0;
  const reason = formData.get("reason");
  await result(idFrom(formData), (id) => deals.markLost(user.id, id, version, typeof reason === "string" ? reason : ""));
}

export async function reopenDeal(formData: FormData) {
  const user = await requireUser();
  const version = idFrom(formData, "version") ?? 0;
  await result(idFrom(formData), (id) => deals.reopenDeal(user.id, id, version));
}

export async function restoreDeal(formData: FormData) {
  const user = await requireUser();
  await result(idFrom(formData), (id) => deals.restoreDeal(user.id, id));
}

export async function linkPerson(formData: FormData) {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect(LIST);
  const personId = idFrom(formData, "personId");
  const r = personId === null ? { status: "not_allowed" as const } : await links.linkPerson(user.id, id, personId);
  refresh(id);
  if (r.status === "not_found") redirect(LIST);
  redirect(r.status === "already_linked" ? page(id, "?error=deal_person_already_linked") : page(id));
}

export async function unlinkPerson(formData: FormData) {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect(LIST);
  const personId = idFrom(formData, "personId");
  const r = personId === null ? { status: "not_linked" as const } : await links.unlinkPerson(user.id, id, personId);
  refresh(id);
  redirect(r.status === "not_found" ? LIST : page(id));
}

async function follow(formData: FormData, on: boolean) {
  const user = await requireUser();
  const id = idFrom(formData);
  if (id === null) redirect(LIST);
  const r = on ? await links.followDeal(user.id, id) : await links.unfollowDeal(user.id, id);
  refresh(id);
  redirect(r.status === "not_found" ? LIST : page(id));
}

export async function followDeal(formData: FormData) {
  await follow(formData, true);
}

export async function unfollowDeal(formData: FormData) {
  await follow(formData, false);
}
