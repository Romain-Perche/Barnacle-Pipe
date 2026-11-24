"use server";
// Segment actions (SF-120 contracts/routes.md § Actions). Each calls requireUser() first (a deactivated user's session is
// refused there, nothing saved); segments are shared, so no owner or admin check. Redirects are fixed paths built from
// numeric ids only.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { messages } from "@/server/messages";
import { setFlash } from "@/server/records/flash";
import { idFrom } from "@/server/records/form-data";
import { readSegmentForm, type Reach, type SegmentErrors, type SegmentFormValues } from "@/server/segments/rules";
import { countDefinition, createSegment, deleteSegment, updateSegment } from "@/server/segments/segments";

// What the form gets back: the values as typed, the errors in words, the count (COUNT AGAIN). `seq` rebuilds the form.
export type SegmentFormState = { values: SegmentFormValues; errors: SegmentErrors; reach: Reach | null; seq: number } | null;

async function gone(): Promise<never> {
  await setFlash({ code: "segment_not_found", name: "" });
  redirect("/segments");
}

export async function saveSegmentAction(prev: SegmentFormState, fd: FormData): Promise<SegmentFormState> {
  const user = await requireUser();
  const input = readSegmentForm(fd);
  const { id, version, intent, ...values } = input;
  const seq = (prev?.seq ?? 0) + 1;
  if (intent === "count") {
    const r = await countDefinition(user.id, { ...values, id });
    if (!r.ok && "code" in r) return gone();
    return r.ok ? { values, errors: {}, reach: r.reach, seq } : { values, errors: r.errors, reach: null, seq };
  }
  const result = id === null ? await createSegment(user.id, values) : await updateSegment(user.id, id, version ?? 0, values);
  if (result.ok) {
    revalidatePath("/segments");
    redirect(`/segments/${result.id}`);
  }
  if ("code" in result) {
    if (result.code === "segment_not_found") return gone();
    return { values, errors: { form: messages.segment_changed }, reach: null, seq };
  }
  return { values, errors: result.errors, reach: null, seq };
}

export async function deleteSegmentAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = idFrom(fd);
  const result = id === null ? null : await deleteSegment(user.id, id);
  if (result?.ok) {
    await setFlash({ code: "segment_deleted", name: result.name });
    revalidatePath("/segments");
  } else {
    await setFlash({ code: "segment_not_found", name: "" });
  }
  redirect("/segments");
}
