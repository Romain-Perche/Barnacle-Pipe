"use server";
// Activity actions (SF-109 contracts/routes.md § Server actions). Each checks the user first; activities.ts re-checks
// visibility, archived records and the version inside its transaction. Every redirect goes to the posted `back` through
// isSafeNext (an in-app path only), plus fixed parameters built from numeric ids and allow-listed codes.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as activities from "@/server/activities/activities";
import { addParam, afterTickPath, type ActivityForm } from "@/server/activities/rules";
import { isSafeNext } from "@/server/auth/rules";
import { requireUser } from "@/server/auth/session";
import { appBaseUrl } from "@/server/env";
import { setFlash } from "@/server/records/flash";
import { idFrom } from "@/server/records/form-data";
import type { FieldErrors } from "@/server/records/rules";
import type { FormState } from "../records/form-state";

export type ActivityState = FormState<ActivityForm>;

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function formFrom(fd: FormData): ActivityForm {
  return {
    type: text(fd, "type"), subject: text(fd, "subject"), dueOn: text(fd, "dueOn"), dueTime: text(fd, "dueTime"), duration: text(fd, "duration"),
    assigneeId: text(fd, "assigneeId"), note: text(fd, "note"), dealId: text(fd, "dealId"), personId: text(fd, "personId"),
    organisationId: text(fd, "organisationId"),
  };
}

// The page the box or button is on (default: the Activities list), an in-app path only.
const backFrom = (fd: FormData) => isSafeNext(text(fd, "back") || "/activities", appBaseUrl());

function errorsOf(result: activities.SaveResult): FieldErrors {
  switch (result.status) {
    case "invalid":
      return result.errors;
    case "assignee_cannot_see":
      return { assigneeId: { code: "assignee_cannot_see", name: result.name } };
    case "archived":
      return { form: { code: "activity_record_archived" } };
    case "link_not_found":
      return { form: { code: "activity_link_not_found" } };
    case "gone":
      return { form: { code: "activity_gone" } };
    case "conflict":
      return { form: { code: "activity_conflict" } };
    default:
      return { form: { code: "activity_not_found" } };
  }
}

// The page and the shared layout (the sidebar count of a new assignee is theirs, but keep the actor's in step too).
function refresh() {
  revalidatePath("/", "layout");
}

export async function scheduleActivity(prev: ActivityState, fd: FormData): Promise<ActivityState> {
  const user = await requireUser();
  const values = formFrom(fd);
  const result = await activities.scheduleActivity(user.id, values);
  if (result.status !== "ok") return { errors: errorsOf(result), values, seq: (prev?.seq ?? 0) + 1 };
  refresh();
  redirect(backFrom(fd));
}

export async function editActivity(prev: ActivityState, fd: FormData): Promise<ActivityState> {
  const user = await requireUser();
  const values = formFrom(fd);
  const id = idFrom(fd, "id");
  const version = idFrom(fd, "version");
  const result = id === null || version === null ? ({ status: "not_found" } as const) : await activities.editActivity(user.id, id, version, values);
  if (result.status !== "ok") return { errors: errorsOf(result), values, seq: (prev?.seq ?? 0) + 1 };
  refresh();
  redirect(backFrom(fd));
}

const TICK_ERRORS = { archived: "activity_record_archived", not_found: "activity_not_found" } as const;

export async function tickActivity(fd: FormData): Promise<void> {
  const user = await requireUser();
  const back = backFrom(fd);
  const id = idFrom(fd, "id");
  const result = id === null ? ({ status: "not_found" } as const) : await activities.tickActivity(user.id, id);
  if (result.status !== "ok") redirect(addParam(back, "error", TICK_ERRORS[result.status]));
  refresh();
  redirect(afterTickPath(back, id!, text(fd, "followup") === "1"));
}

export async function untickActivity(fd: FormData): Promise<void> {
  const user = await requireUser();
  const back = backFrom(fd);
  const id = idFrom(fd, "id");
  const result = id === null ? ({ status: "not_found" } as const) : await activities.untickActivity(user.id, id);
  if (result.status !== "ok") redirect(addParam(back, "error", TICK_ERRORS[result.status]));
  refresh();
  redirect(back);
}

const DELETE_ERRORS = { archived: "activity_record_archived", not_found: "activity_not_found", gone: "activity_gone", conflict: "activity_conflict" } as const;

export async function deleteActivity(fd: FormData): Promise<void> {
  const user = await requireUser();
  const back = backFrom(fd);
  const id = idFrom(fd, "id");
  const version = idFrom(fd, "version");
  const result = id === null || version === null ? ({ status: "not_found" } as const) : await activities.deleteActivity(user.id, id, version);
  if (result.status !== "ok") redirect(addParam(back, "error", DELETE_ERRORS[result.status]));
  await setFlash({ code: "activity_deleted", name: "" });
  refresh();
  redirect(back);
}
