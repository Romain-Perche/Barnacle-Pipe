"use server";
// Pipedrive import actions (SF-117 contracts/routes.md § Server actions): requireUser() first, the signed-in user's own
// import only, redirects to the fixed import page only. runPipedrivePartAction returns no record data and no text.
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { continueImport, runPart, startImport, stopImport, type PartResult } from "@/server/pipedrive/imports";

const PAGE = "/settings/pipedrive-import";

export async function startPipedriveImportAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const consent = form.get("consent");
  const result = await startImport(user.id, {
    people: form.get("people") === "on",
    organisations: form.get("organisations") === "on",
    deals: form.get("deals") === "on",
    notes: form.get("notes") === "on",
    activities: form.get("activities") === "on",
    files: form.get("files") === "on",
    consent: typeof consent === "string" ? consent : null,
  });
  if ("error" in result) redirect(result.error === "pipedrive_not_connected" ? "/settings" : `${PAGE}?error=${result.error}`);
  redirect(PAGE);
}

// Called by ImportRunner.tsx, one part at a time, while the page is open.
export async function runPipedrivePartAction(importId: number): Promise<PartResult> {
  const user = await requireUser();
  if (!Number.isSafeInteger(importId) || importId <= 0) return { next: "stop" };
  return runPart(user.id, importId);
}

export async function continuePipedriveImportAction(): Promise<void> {
  const user = await requireUser();
  await continueImport(user.id);
  redirect(PAGE);
}

export async function stopPipedriveImportAction(): Promise<void> {
  const user = await requireUser();
  await stopImport(user.id);
  redirect(PAGE);
}
