"use server";
// CSV import actions (SF-103 contracts/routes.md § Server actions). Each checks the user first; the domain checks that
// the import is the user's own in every query. Redirects are built from numeric ids and the fixed kind paths only.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import type { ImportKind } from "@/server/imports/columns";
import * as imports from "@/server/imports/imports";
import { toId } from "@/server/records/rules";
import { importPath, isImportKind, KIND } from "./kinds";

type Refusal = { error: string };

export async function startImport(kind: ImportKind, fileName: string, size: number): Promise<{ id: number } | Refusal> {
  const user = await requireUser();
  if (!isImportKind(kind) || typeof fileName !== "string" || typeof size !== "number") return { error: "import_upload_failed" };
  return imports.startImport(user.id, kind, fileName, size);
}

export async function uploadPart(formData: FormData): Promise<{ ok: true } | Refusal> {
  const user = await requireUser();
  const id = toId(formData.get("id"));
  const index = Number(formData.get("index"));
  const part = formData.get("part");
  if (id === null || !(part instanceof Blob)) return { error: "import_upload_failed" };
  return imports.uploadPart(user.id, id, index, new Uint8Array(await part.arrayBuffer()));
}

export async function finishUpload(formData: FormData): Promise<{ next: string } | Refusal> {
  const user = await requireUser();
  const id = toId(formData.get("id"));
  if (id === null) return { error: "import_upload_failed" };
  const result = await imports.finishUpload(user.id, id);
  return "error" in result ? result : { next: importPath(result.kind, id, "columns") };
}

// `field.<index>` holds a field key, or "email:<kind>" / "phone:<kind>".
export async function saveColumns(formData: FormData) {
  const user = await requireUser();
  const id = toId(formData.get("id"));
  const info = id === null ? null : await imports.getImport(user.id, id);
  if (id === null || !info) redirect("/people");
  const choices = new Map<number, { field: string; kind: string }>();
  for (const [name, value] of formData.entries()) {
    const m = /^field\.(\d{1,4})$/.exec(name);
    if (!m || typeof value !== "string") continue;
    // SF-115: a custom field target is "custom:<id>" as a whole.
    const [field, kind = "work"] = value.startsWith("custom:") ? [value] : value.split(":");
    choices.set(Number(m[1]), { field, kind });
  }
  const result = await imports.saveColumns(user.id, id, choices);
  if ("error" in result) {
    const field = result.error.code === "import_one_column" ? `&field=${result.error.field}` : "";
    redirect(`${importPath(info.kind, id, "columns")}?error=${result.error.code}${field}`);
  }
  if ("status" in result) redirect(result.status === "done" ? importPath(info.kind, id, "report") : KIND[info.kind].path);
  redirect(importPath(info.kind, id, "preview"));
}

export async function runImport(formData: FormData) {
  const user = await requireUser();
  const id = toId(formData.get("id"));
  const info = id === null ? null : await imports.getImport(user.id, id);
  if (id === null || !info) redirect("/people");
  const consent = formData.get("consent");
  let result: imports.RunResult | "failed";
  try {
    result = await imports.runImport(user.id, id, typeof consent === "string" ? consent : null);
  } catch (err) {
    console.error("CSV import failed", err);
    result = "failed";
  }
  if (result === "failed") redirect(`${importPath(info.kind, id, "preview")}?error=import_failed`);
  if (result.status === "consent_required") redirect(`${importPath(info.kind, id, "preview")}?error=import_consent_required`);
  if (result.status === "not_found") redirect(KIND[info.kind].path);
  revalidatePath("/people");
  revalidatePath("/organisations");
  redirect(importPath(info.kind, id, "report"));
}
