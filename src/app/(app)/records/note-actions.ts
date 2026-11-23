"use server";
// Note actions (SF-102 contracts/routes.md § Server actions). Each checks the user first; src/server/records/notes.ts
// re-checks visibility, archived state and version inside its transaction. Redirects are built from numeric ids only.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { setFlash } from "@/server/records/flash";
import { idFrom } from "@/server/records/form-data";
import { parseId } from "@/server/records/list-query";
import * as notes from "@/server/records/notes";
import { parseShown } from "@/server/records/notes-rules";
import type { FieldError } from "@/server/records/rules";
import type { FormState } from "./form-state";
import { listPath, noteTarget, targetPath } from "./note-target";

export type NoteValues = { body: string; mentions: number[] };
export type NoteState = FormState<NoteValues>;

const MAX_MENTIONS = 50;

function read(form: FormData) {
  const id = idFrom(form, "targetId");
  const target = id === null ? null : noteTarget(String(form.get("target") ?? ""), id);
  const body = String(form.get("body") ?? "");
  const mentions = form
    .getAll("mention")
    .slice(0, MAX_MENTIONS)
    .map((v) => parseId(typeof v === "string" ? v : null))
    .filter((v): v is number => v !== null);
  return { target, values: { body, mentions } };
}

function refusal(result: notes.NoteResult): FieldError {
  switch (result.status) {
    case "invalid":
      return { code: result.code };
    case "cannot_mention":
      return { code: "mention_cannot_see", name: result.name };
    case "archived":
      return { code: "note_record_archived" };
    case "gone":
      return { code: "note_gone" };
    case "conflict":
      return { code: "note_edit_conflict" };
    default:
      return { code: "note_not_found" };
  }
}

const answer = (prev: NoteState, values: NoteValues, error: FieldError): NoteState => ({
  errors: { body: error },
  values,
  seq: (prev?.seq ?? 0) + 1,
});

// The record page and the shared layout (a self-mention never counts, but a mention changes others' counts on their
// next load; this keeps the actor's sidebar in step too).
function refresh(path: string) {
  revalidatePath(path);
  revalidatePath("/", "layout");
}

export async function addNote(prev: NoteState, form: FormData): Promise<NoteState> {
  const user = await requireUser();
  const { target, values } = read(form);
  if (!target) return answer(prev, values, { code: "note_not_found" });
  const result = await notes.addNote(user.id, target, values.body, values.mentions);
  if (result.status !== "ok") return answer(prev, values, refusal(result));
  refresh(targetPath(target));
  // Empty again after a successful add.
  return { errors: {}, values: { body: "", mentions: [] }, seq: (prev?.seq ?? 0) + 1 };
}

export async function editNote(prev: NoteState, form: FormData): Promise<NoteState> {
  const user = await requireUser();
  const { target, values } = read(form);
  const noteId = idFrom(form, "noteId");
  const version = idFrom(form, "version");
  if (!target || noteId === null || version === null) return answer(prev, values, { code: "note_not_found" });
  const result = await notes.editNote(user.id, target, noteId, version, values.body, values.mentions);
  if (result.status !== "ok") return answer(prev, values, refusal(result));
  const shown = parseShown(String(form.get("timeline") ?? ""));
  refresh(targetPath(target));
  redirect(`${targetPath(target)}${shown > 50 ? `?timeline=${shown}` : ""}#entry-${noteId}`);
}

export async function deleteNote(form: FormData): Promise<void> {
  const user = await requireUser();
  const { target } = read(form);
  const noteId = idFrom(form, "noteId");
  // A missing or unknown target, or a record the user cannot see: the kind's list with a one-shot notice that
  // never names the record.
  if (!target) {
    await setFlash({ code: "note_not_found", name: "" });
    redirect("/deals");
  }
  const here = targetPath(target);
  if (noteId === null) redirect(`${here}?error=note_not_found`);
  const result = await notes.deleteNote(user.id, target, noteId);
  if (result.status === "record_not_found") {
    await setFlash({ code: "note_not_found", name: "" });
    redirect(listPath(target));
  }
  if (result.status === "archived") redirect(`${here}?error=note_record_archived`);
  if (result.status === "not_found") redirect(`${here}?error=note_not_found`);
  const shown = parseShown(String(form.get("timeline") ?? ""));
  await setFlash({ code: "note_deleted", name: "" });
  refresh(here);
  redirect(`${here}${shown > 50 ? `?timeline=${shown}` : ""}`);
}
