"use server";
// Custom fields admin (SF-115 contracts/routes.md § Server actions): admins only. assertAdminForAction() first; fields.ts
// re-checks the actor is an active admin inside its transaction. Redirects go to fixed paths built from the tab word and
// numeric ids; a name a message needs travels in the flash cookie, never in the address.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminForAction } from "@/server/auth/session";
import * as fields from "@/server/custom-fields/fields";
import { KIND_OF_TAB, TAB_OF_KIND, type KindTab, type RecordKind } from "@/server/custom-fields/rules";
import { setFlash } from "@/server/records/flash";
import { idFrom } from "@/server/records/form-data";
import type { FormState } from "../../records/form-state";

const PAGE = "/admin/custom-fields";

export type FieldBoxValues = { name: string; type: string; choices: string; inList: boolean };
export type FieldBoxState = FormState<FieldBoxValues>;

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function kindFrom(fd: FormData): RecordKind {
  const tab = text(fd, "kind");
  return Object.hasOwn(KIND_OF_TAB, tab) ? KIND_OF_TAB[tab as KindTab] : "person";
}

const dirFrom = (fd: FormData): fields.Direction => (text(fd, "dir") === "up" ? "up" : "down");

function refresh() {
  revalidatePath(PAGE);
  revalidatePath("/people", "layout");
  revalidatePath("/organisations", "layout");
  revalidatePath("/deals", "layout");
}

const tabHref = (kind: RecordKind, extra = "") => `${PAGE}?kind=${TAB_OF_KIND[kind]}${extra}`;

const boxValues = (fd: FormData): FieldBoxValues => ({
  name: text(fd, "name").slice(0, 200),
  type: text(fd, "type"),
  choices: text(fd, "choices").slice(0, 20_000),
  inList: text(fd, "inList") === "on",
});

function boxAnswer(result: fields.FieldResult, values: FieldBoxValues, prev: FieldBoxState, kind: RecordKind): FieldBoxState {
  refresh();
  if (result.ok) redirect(tabHref(result.kind));
  if (result.code === "forbidden" || result.code === "not_found") redirect(tabHref(kind));
  const errors = result.errors ?? { form: { code: result.code, name: result.name } };
  return { errors, values, seq: (prev?.seq ?? 0) + 1 };
}

export async function addCustomField(prev: FieldBoxState, fd: FormData): Promise<FieldBoxState> {
  const user = await assertAdminForAction();
  const kind = kindFrom(fd);
  const values = boxValues(fd);
  return boxAnswer(await fields.addField(user.id, kind, values), values, prev, kind);
}

export async function updateCustomField(prev: FieldBoxState, fd: FormData): Promise<FieldBoxState> {
  const user = await assertAdminForAction();
  const kind = kindFrom(fd);
  const id = idFrom(fd);
  if (id === null) redirect(tabHref(kind));
  const values = boxValues(fd);
  return boxAnswer(await fields.updateField(user.id, id, { name: values.name, inList: values.inList }), values, prev, kind);
}

export async function moveCustomField(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  if (id !== null) await fields.moveField(user.id, id, dirFrom(fd));
  refresh();
  redirect(tabHref(kindFrom(fd)));
}

export async function deleteCustomField(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  const result = id === null ? null : await fields.deleteField(user.id, id);
  if (result?.ok) await setFlash({ code: "custom_field_deleted", name: result.name });
  refresh();
  redirect(tabHref(kindFrom(fd)));
}

// Choice changes go back to the field's box; a refusal's message is in the flash cookie (it may name the choice).
async function choiceAnswer(fd: FormData, fieldId: number | null, result: fields.FieldResult): Promise<never> {
  refresh();
  const kind = kindFrom(fd);
  if (!result.ok && result.code !== "forbidden" && result.code !== "not_found") {
    await setFlash({ code: "custom_choice_error", name: result.name ?? "", detail: result.code });
  }
  redirect(fieldId === null || (!result.ok && result.code === "not_found") ? tabHref(kind) : tabHref(kind, `&field=${fieldId}`));
}

const nameOf = (fd: FormData) => text(fd, "name").slice(0, 200);

export async function addCustomChoice(fd: FormData) {
  const user = await assertAdminForAction();
  const fieldId = idFrom(fd, "fieldId");
  await choiceAnswer(fd, fieldId, fieldId === null ? { ok: false, code: "not_found" } : await fields.addFieldChoice(user.id, fieldId, nameOf(fd)));
}

export async function renameCustomChoice(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  await choiceAnswer(fd, idFrom(fd, "fieldId"), id === null ? { ok: false, code: "not_found" } : await fields.renameFieldChoice(user.id, id, nameOf(fd)));
}

export async function moveCustomChoice(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  await choiceAnswer(fd, idFrom(fd, "fieldId"), id === null ? { ok: false, code: "not_found" } : await fields.moveFieldChoice(user.id, id, dirFrom(fd)));
}

export async function removeCustomChoice(fd: FormData) {
  const user = await assertAdminForAction();
  const id = idFrom(fd);
  await choiceAnswer(fd, idFrom(fd, "fieldId"), id === null ? { ok: false, code: "not_found" } : await fields.removeFieldChoice(user.id, id));
}
