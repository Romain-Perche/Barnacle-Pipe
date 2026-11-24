"use server";
// Campaign actions (SF-119 contracts/routes.md § Server actions). Each checks the signed-in user first, on every request
// (FR-018); drafts are shared, so no admin check. Redirects go to fixed paths built from numeric ids only.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import * as campaigns from "@/server/campaigns/campaigns";
import type { Link, PreviewValues } from "@/server/campaigns/merge";
import { previewValues, searchPreviewPeople, type PreviewPerson } from "@/server/campaigns/preview";
import { messages } from "@/server/messages";
import { setFlash } from "@/server/records/flash";
import { toId } from "@/server/records/rules";

export type NewCampaignState = { error: string; name: string; seq: number } | null;
export type SaveCampaignState =
  | { ok: true; version: number; lastEdited: string; links: Link[]; message: string; previewPersonId: number | null; preview: PreviewValues | null; seq: number }
  | { ok: false; errors: Record<string, string>; seq: number }
  | null;

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export async function createCampaignAction(prev: NewCampaignState, fd: FormData): Promise<NewCampaignState> {
  const user = await requireUser();
  const name = text(fd, "name");
  const r = await campaigns.createCampaign(user.id, name);
  if (!r.ok) return { error: r.error, name, seq: (prev?.seq ?? 0) + 1 };
  revalidatePath("/campaigns");
  redirect(`/campaigns/${r.id}`);
}

export async function saveCampaignAction(prev: SaveCampaignState, fd: FormData): Promise<SaveCampaignState> {
  const user = await requireUser();
  const seq = (prev?.seq ?? 0) + 1;
  const id = toId(text(fd, "id"));
  const version = toId(text(fd, "version"));
  if (id === null || version === null) return { ok: false, errors: { form: messages.campaign_gone }, seq };
  const r = await campaigns.saveCampaign(user.id, id, version, {
    name: text(fd, "name"), senderName: text(fd, "senderName"), replyTo: text(fd, "replyTo"), subject: text(fd, "subject"),
    previewText: text(fd, "previewText"), contentKind: text(fd, "contentKind"), blocks: text(fd, "blocks"), html: text(fd, "html"),
  });
  if (!r.ok) return { ok: false, errors: r.errors, seq };
  revalidatePath("/campaigns");
  // The chosen person is asked again on every save: someone may have hidden or archived them since (research.md §6).
  const previewPersonId = toId(text(fd, "previewPersonId"));
  const preview = previewPersonId === null ? null : await previewValues(user.id, previewPersonId);
  return { ok: true, version: r.version, lastEdited: r.lastEdited, links: r.links, message: r.message, previewPersonId, preview, seq };
}

// Copies the draft as last saved (only the id is posted).
export async function duplicateCampaignAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = toId(text(fd, "id"));
  const r = id === null ? ({ ok: false } as const) : await campaigns.duplicateCampaign(user.id, id);
  revalidatePath("/campaigns");
  if (r.ok) redirect(`/campaigns/${r.id}`);
  await setFlash({ code: "campaign_gone", name: "" });
  redirect("/campaigns");
}

export async function deleteCampaignAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = toId(text(fd, "id"));
  const r = id === null ? ({ ok: false } as const) : await campaigns.deleteCampaign(user.id, id);
  await setFlash(r.ok ? { code: "campaign_deleted", name: r.name } : { code: "campaign_gone", name: "" });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function findPreviewPeople(query: string): Promise<PreviewPerson[]> {
  const user = await requireUser();
  return searchPreviewPeople(user.id, typeof query === "string" ? query : "");
}

export async function previewPerson(personId: number): Promise<PreviewValues | null> {
  const user = await requireUser();
  const id = toId(personId);
  return id === null ? null : previewValues(user.id, id);
}
