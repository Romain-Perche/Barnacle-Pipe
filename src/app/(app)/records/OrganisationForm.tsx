"use client";
// Add / edit an organisation. Messages show next to their fields and every typed value is kept.
import Link from "next/link";
import { useActionState } from "react";
import { messages } from "@/server/messages";
import { SIZES, type OrganisationForm as Values } from "@/server/records/rules";
import { FieldError } from "./FieldError";
import type { FormState } from "./form-state";

type Props = {
  action: (prev: FormState<Values>, fd: FormData) => Promise<FormState<Values>>;
  initial: Values;
  owners: { id: number; name: string }[];
  id?: number;
  version?: number;
  cancelHref: string;
};

export function OrganisationForm({ action, initial, owners, id, version, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;
  const errors = state?.errors ?? {};
  const text = (name: keyof Values, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type="text" name={name} defaultValue={v[name]} aria-invalid={errors[name] ? true : undefined} />
      <FieldError error={errors[name]} />
    </label>
  );
  return (
    <form action={formAction} className="recform" key={state?.seq ?? 0} noValidate>
      {errors.form && (
        <p className="err" role="alert">
          {messages[errors.form.code as "edit_conflict_organisation"] ?? ""}
        </p>
      )}
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {version !== undefined && <input type="hidden" name="version" value={version} />}
      <div className="grid2">
        {text("name", "Name")}
        {text("website", "Website")}
        {text("sector", "Sector")}
        <label className="field">
          <span>Size</span>
          <select className="input" name="size" defaultValue={v.size}>
            <option value="">Not set</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {text("location", "Location")}
        <label className="field">
          <span>Owner</span>
          <select className="input" name="ownerId" defaultValue={v.ownerId}>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-acts">
        <button className="btn solid" type="submit" disabled={pending}>
          [ SAVE ]
        </button>
        <Link className="btn" href={cancelHref}>
          [ CANCEL ]
        </Link>
      </div>
    </form>
  );
}
