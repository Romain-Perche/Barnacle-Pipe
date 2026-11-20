"use client";
// Add / edit a deal (contracts/routes.md § Pages). Messages show next to their fields and every typed value is kept.
// Pipeline and stage only on add: moves are made from the board.
import Link from "next/link";
import { useActionState } from "react";
import type { DealChoices } from "@/server/deals/deals";
import type { DealForm as Values } from "@/server/deals/rules";
import { messages } from "@/server/messages";
import type { FieldErrors } from "@/server/records/rules";
import { FieldError } from "../records/FieldError";
import type { FormState } from "../records/form-state";
import { OrganisationPicker } from "../records/OrganisationPicker";
import { PersonPicker } from "../records/PersonPicker";
import { StageSelect } from "./StageSelect";

type Props = {
  action: (prev: FormState<Values>, fd: FormData) => Promise<FormState<Values>>;
  initial: Values;
  choices: DealChoices;
  canSetPrivate: boolean;
  withStage: boolean;
  id?: number;
  version?: number;
  cancelHref: string;
};

function Text({ name, label, value, error, type = "text", placeholder }: { name: string; label: string; value: string; error?: FieldErrors[string]; type?: string; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={type} name={name} defaultValue={value} placeholder={placeholder} aria-invalid={error ? true : undefined} />
      <FieldError error={error} />
    </label>
  );
}

export function DealForm({ action, initial, choices, canSetPrivate, withStage, id, version, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;
  const errors = state?.errors ?? {};
  return (
    <form action={formAction} className="recform" key={state?.seq ?? 0} noValidate>
      {errors.form && (
        <p className="err" role="alert">
          {messages.deal_edit_conflict}
        </p>
      )}
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {version !== undefined && <input type="hidden" name="version" value={version} />}
      <div className="grid2">
        <Text name="title" label="Title" value={v.title} error={errors.title} />
        <Text name="value" label="Value (£)" value={v.value} error={errors.value} placeholder="4000" />
        {withStage && (
          <>
            <StageSelect pipelines={choices.pipelines} pipelineId={v.pipelineId} stageId={v.stageId} />
            {errors.stage && (
              <div className="full">
                <FieldError error={errors.stage} />
              </div>
            )}
          </>
        )}
        <div className="field">
          <span>Organisation</span>
          <OrganisationPicker organisations={choices.organisations} initialId={v.organisationId} initialNew={v.newOrganisationName} />
          <FieldError error={errors.organisation} />
        </div>
        <div className="field">
          <span>Person</span>
          <PersonPicker people={choices.people} initialId={v.personId} />
        </div>
        <label className="field">
          <span>Owner</span>
          <select className="input" name="ownerId" defaultValue={v.ownerId}>
            {choices.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <Text name="expectedClose" label="Expected close date" type="date" value={v.expectedClose} error={errors.expectedClose} />
      </div>
      {canSetPrivate && (
        <label className="check private">
          <input type="checkbox" name="private" defaultChecked={v.private} /> Private (only its creator and owner can see this deal)
        </label>
      )}
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
