"use server";
// Link and unlink a conversation by hand (SF-127 contracts/routes.md § Server actions). requireUser() first; the
// server re-checks the conversation's and the record's visibility in the transaction. Redirects back to the
// conversation with a fixed notice; `from` is re-parsed, never passed through as typed.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { linkRecord as link, unlinkRecord as unlink } from "@/server/emails/conversations";
import { fromParam, parseFrom, parseLinkKind } from "@/server/emails/rules";
import { parseId } from "@/server/records/list-query";

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

function back(conversationId: number, fd: FormData, notice: string): never {
  const from = fromParam(parseFrom(text(fd, "from")));
  redirect(`/emails/${conversationId}?${from ? `from=${from}&` : ""}notice=${notice}`);
}

export async function linkRecord(fd: FormData) {
  const user = await requireUser();
  const conversationId = parseId(text(fd, "conversationId"));
  if (conversationId === null) redirect("/people");
  const kind = parseLinkKind(text(fd, "kind"));
  const recordId = kind === null ? null : parseId(text(fd, kind === "deal" ? "dealId" : kind === "person" ? "personId" : "organisationId"));
  if (kind === null || recordId === null) back(conversationId, fd, "link-refused");
  const r = await link(user.id, { conversationId, kind, recordId });
  if (r.status === "not_found") redirect(`/emails/${conversationId}`);
  revalidatePath(`/emails/${conversationId}`);
  back(conversationId, fd, r.status === "ok" ? "linked" : "link-refused");
}

export async function unlinkRecord(fd: FormData) {
  const user = await requireUser();
  const conversationId = parseId(text(fd, "conversationId"));
  const linkId = parseId(text(fd, "linkId"));
  if (conversationId === null) redirect("/people");
  if (linkId === null) redirect(`/emails/${conversationId}`);
  const r = await unlink(user.id, { conversationId, linkId });
  if (r.status === "not_found") redirect(`/emails/${conversationId}`);
  revalidatePath(`/emails/${conversationId}`);
  back(conversationId, fd, "unlinked");
}
