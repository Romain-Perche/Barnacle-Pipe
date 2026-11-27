"use server";
// The email box's actions (SF-129 contracts/routes.md § Server actions). Each checks the user first; compose.ts
// re-checks the record (visible, not archived), the files and Gmail at send time. Answers are codes only: never text
// taken from the request. After a send the flash "Email sent to …" is set from the server's copy of the addresses and
// the box goes to `back` (checked by isSafeNext) itself. SF-130: sendEmailReply, the same for a reply, reply all or
// forward (reply.ts re-checks the conversation's visibility, the answered email, the record and every attachment).
import { revalidatePath } from "next/cache";
import { isSafeNext } from "@/server/auth/rules";
import { requireUser } from "@/server/auth/session";
import { appBaseUrl } from "@/server/env";
import * as compose from "@/server/emails/compose";
import { sendReply } from "@/server/emails/reply";
import { setFlash } from "@/server/records/flash";
import { parseId } from "@/server/records/list-query";

export type UploadAnswer = compose.UploadResult;
export type SendAnswer =
  | { status: "sent"; back: string }
  | { status: "refused"; errors: compose.Refusal[] }
  | { status: "gmail"; state: "off" | "not_connected" | "needs_reconnect" };

const KINDS = ["deal", "person", "organisation"] as const;
const isStrings = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length <= 1000);
const ids = (v: unknown): number[] | null => {
  if (!Array.isArray(v) || v.length > 100) return null;
  const out = v.map((x) => (typeof x === "number" ? parseId(String(x)) : null));
  return out.every((x): x is number => x !== null) ? out : null;
};

export async function startEmailUpload(input: { name: string; size: number; type?: string }): Promise<UploadAnswer> {
  const user = await requireUser();
  if (typeof input?.name !== "string" || typeof input.size !== "number" || !Number.isInteger(input.size)) return { status: "files_unreachable" };
  return compose.startEmailUpload(user.id, { name: input.name, size: input.size, type: typeof input.type === "string" ? input.type : undefined });
}

export async function sendEmailFromRecord(input: {
  target: string; id: number; sendKey: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string;
  fileIds: number[]; uploadIds: number[]; back: string;
}): Promise<SendAnswer> {
  const user = await requireUser();
  const failed: SendAnswer = { status: "refused", errors: [{ code: "compose_send_failed" }] };
  const kind = KINDS.find((k) => k === input?.target);
  const id = typeof input?.id === "number" ? parseId(String(input.id)) : null;
  const fileIds = ids(input?.fileIds);
  const uploadIds = ids(input?.uploadIds);
  if (
    !kind || id === null || fileIds === null || uploadIds === null || typeof input.sendKey !== "string" ||
    !isStrings(input.to, 1000) || !isStrings(input.cc, 1000) || !isStrings(input.bcc, 1000) ||
    typeof input.subject !== "string" || typeof input.text !== "string" || input.text.length > 1_000_000 || input.subject.length > 10_000
  ) {
    return failed;
  }
  const back = isSafeNext(typeof input.back === "string" ? input.back : "", appBaseUrl());
  const result = await compose.sendFromRecord(user.id, {
    target: { kind, id }, sendKey: input.sendKey, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.text,
    fileIds, uploadIds,
  });
  if (result.status !== "sent") return result;
  await setFlash({ code: "email_sent", name: result.notice.name, count: result.notice.count });
  revalidatePath(back.split("?")[0]);
  return { status: "sent", back };
}

const MODES = ["reply", "reply_all", "forward"] as const;

export async function sendEmailReply(input: {
  mode: string; messageId: number; record: { target: string; id: number } | null; sendKey: string; to: string[]; cc: string[]; bcc: string[];
  subject: string; text: string; fileIds: number[]; uploadIds: number[]; forwardIds: number[]; back: string;
}): Promise<SendAnswer> {
  const user = await requireUser();
  const failed: SendAnswer = { status: "refused", errors: [{ code: "compose_send_failed" }] };
  const mode = MODES.find((m) => m === input?.mode);
  const messageId = typeof input?.messageId === "number" ? parseId(String(input.messageId)) : null;
  const kind = input?.record === null ? null : KINDS.find((k) => k === input?.record?.target);
  const recordId = input?.record === null ? null : typeof input?.record?.id === "number" ? parseId(String(input.record.id)) : null;
  const fileIds = ids(input?.fileIds);
  const uploadIds = ids(input?.uploadIds);
  const forwardIds = ids(input?.forwardIds);
  if (
    !mode || messageId === null || (input.record !== null && (!kind || recordId === null)) || fileIds === null || uploadIds === null ||
    forwardIds === null || typeof input.sendKey !== "string" || !isStrings(input.to, 1000) || !isStrings(input.cc, 1000) ||
    !isStrings(input.bcc, 1000) || typeof input.subject !== "string" || typeof input.text !== "string" || input.text.length > 1_000_000 ||
    input.subject.length > 10_000
  ) {
    return failed;
  }
  const back = isSafeNext(typeof input.back === "string" ? input.back : "", appBaseUrl());
  const result = await sendReply(user.id, {
    mode, messageId, record: kind && recordId !== null ? { kind, id: recordId } : null, sendKey: input.sendKey, to: input.to, cc: input.cc,
    bcc: input.bcc, subject: input.subject, text: input.text, fileIds, uploadIds, forwardIds,
  });
  if (result.status !== "sent") return result;
  await setFlash({ code: "email_sent", name: result.notice.name, count: result.notice.count });
  revalidatePath(back.split("?")[0]);
  return { status: "sent", back };
}
