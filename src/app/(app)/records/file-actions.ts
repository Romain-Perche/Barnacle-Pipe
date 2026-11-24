"use server";
// File actions (SF-116 contracts/routes.md § Server actions). Each checks the user first; src/server/files/files.ts
// re-checks the record (visible, not archived) itself. Answers are codes only: never text taken from the request.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSafeNext } from "@/server/auth/rules";
import { requireUser } from "@/server/auth/session";
import { appBaseUrl } from "@/server/env";
import * as files from "@/server/files/files";
import { addParam } from "@/server/activities/rules";
import { setFlash } from "@/server/records/flash";
import { idFrom } from "@/server/records/form-data";
import { parseId } from "@/server/records/list-query";
import { listPath, noteTarget, targetPath } from "./note-target";

export type StartAnswer = { uploadId: number; url: string; contentType: string } | { error: string };
export type FinishAnswer = { ok: true } | { error: string };

const asId = (v: unknown) => (typeof v === "number" ? parseId(String(v)) : null);

export async function startFileUpload(input: { kind: string; id: number; name: string; size: number }): Promise<StartAnswer> {
  const user = await requireUser();
  const id = asId(input?.id);
  const target = id === null ? null : noteTarget(String(input.kind), id);
  if (!target) return { error: "file_record_not_found" };
  if (typeof input.name !== "string" || typeof input.size !== "number") return { error: "file_upload_failed" };
  const result = await files.startFileUpload(user.id, target, { name: input.name, size: input.size });
  if (result.status !== "ok") return { error: result.status };
  return { uploadId: result.uploadId, url: result.url, contentType: result.contentType };
}

export async function finishFileUpload(input: { uploadId: number }): Promise<FinishAnswer> {
  const user = await requireUser();
  const uploadId = asId(input?.uploadId);
  if (uploadId === null) return { error: "file_upload_failed" };
  const result = await files.finishFileUpload(user.id, uploadId);
  if (result.status !== "ok") return { error: result.status };
  return { ok: true };
}

// The [ DELETE ] of the confirmation box: back to the page (without the box) with "File deleted." or the error code;
// a record the user cannot see → its kind's list with "This file doesn't exist or you can't see it.".
export async function deleteFileAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = idFrom(form, "targetId");
  const target = id === null ? null : noteTarget(String(form.get("target") ?? ""), id);
  const fileId = idFrom(form, "fileId");
  const back = isSafeNext(String(form.get("back") ?? ""), appBaseUrl());
  if (!target) redirect("/");
  const result = fileId === null ? { status: "file_gone" as const } : await files.deleteFile(user.id, target, fileId);
  if (result.status === "file_record_not_found") {
    await setFlash({ code: "file_not_found", name: "" });
    redirect(listPath(target));
  }
  revalidatePath(targetPath(target));
  if (result.status === "ok") {
    await setFlash({ code: "file_deleted", name: "" });
    redirect(back);
  }
  redirect(addParam(back, "error", result.status));
}
