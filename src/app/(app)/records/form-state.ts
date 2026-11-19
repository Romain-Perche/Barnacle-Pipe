// What a form's server action answers on a refusal: the messages and the values as typed (research.md §4).
// `seq` changes on every answer so the form is rebuilt with those values.
import type { FieldErrors } from "@/server/records/rules";

export type FormState<V> = { errors: FieldErrors; values: V; seq: number } | null;
