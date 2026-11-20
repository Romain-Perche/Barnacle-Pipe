"use server";
// Pipelines and stages (contracts/routes.md): admins only. assertAdminForAction() first; pipelines.ts re-checks the
// actor is an active admin inside its transaction. Refusals go back with an allow-listed ?error= code.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminForAction } from "@/server/auth/session";
import * as pipelines from "@/server/deals/pipelines";
import { idFrom } from "@/server/records/form-data";

const PAGE = "/admin/pipelines";

const name = (fd: FormData) => String(fd.get("name") ?? "");
const dir = (fd: FormData): pipelines.Direction => (fd.get("direction") === "down" ? "down" : "up");

// `back` is the page the change was made on; a refused delete keeps its confirmation open.
function finish(result: pipelines.PipelineResult, back: string, deleting?: number): never {
  revalidatePath("/deals");
  revalidatePath(PAGE, "layout");
  if (result.status === "ok") redirect(back);
  // "forbidden": the actor lost admin rights meanwhile; the page then shows the forbidden message.
  if (result.status !== "invalid") redirect(result.status === "not_found" ? PAGE : back);
  redirect(`${back}?${deleting ? `delete=${deleting}&` : ""}error=${result.code}`);
}

function stagesPage(fd: FormData): string {
  const id = idFrom(fd, "pipelineId");
  return id === null ? PAGE : `${PAGE}/${id}`;
}

export async function addPipeline(fd: FormData) {
  const user = await assertAdminForAction();
  finish(await pipelines.addPipeline(user.id, name(fd)), PAGE);
}

export async function renamePipeline(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id === null) redirect(PAGE);
  finish(await pipelines.renamePipeline(user.id, id, name(fd)), PAGE);
}

export async function movePipeline(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id === null) redirect(PAGE);
  finish(await pipelines.movePipeline(user.id, id, dir(fd)), PAGE);
}

export async function deletePipeline(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id === null) redirect(PAGE);
  finish(await pipelines.deletePipeline(user.id, id, idFrom(fd, "targetStageId")), PAGE, id);
}

export async function addStage(fd: FormData) {
  const user = await assertAdminForAction();
  const pipelineId = idFrom(fd, "pipelineId");
  if (pipelineId === null) redirect(PAGE);
  finish(await pipelines.addStage(user.id, pipelineId, name(fd)), stagesPage(fd));
}

export async function renameStage(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id === null) redirect(stagesPage(fd));
  finish(await pipelines.renameStage(user.id, id, name(fd)), stagesPage(fd));
}

export async function moveStage(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id === null) redirect(stagesPage(fd));
  finish(await pipelines.moveStage(user.id, id, dir(fd)), stagesPage(fd));
}

export async function deleteStage(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id === null) redirect(stagesPage(fd));
  finish(await pipelines.deleteStage(user.id, id, idFrom(fd, "targetStageId")), stagesPage(fd), id);
}
