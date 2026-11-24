"use client";
// Add / edit a deal (contracts/routes.md § Pages). Messages show next to their fields and every typed value is kept.
// Pipeline and stage only on add: moves are made from the board. Deal labels as checkboxes (SF-95, as on PersonForm).
import Link from "next/link";
import { useActionState, useState } from "react";
import type { DealChoices } from "@/server/deals/deals";
import type { DealForm as Values } from "@/server/deals/rules";
import { messages } from "@/server/messages";
import type { FieldErrors } from "@/server/records/rules";
import { FieldError } from "../records/FieldError";
import type { FormState } from "../records/form-state";
import { OrganisationPicker } from "../records/OrganisationPicker";
import { PersonPicker } from "../records/PersonPicker";
import { ReferrerPicker, type CurrentReferrer } from "../records/ReferrerPicker";
import { StageSelect } from "./StageSelect";
import type { FormField } from "@/server/custom-fields/values";
import { CustomInputs } from "../records/CustomInputs";

type Props = {
  action: (prev: FormState<Values>, fd: FormData) => Promise<FormState<Values>>;
  initial: Values;
  choices: DealChoices;
  canSetPrivate: boolean;
  withStage: boolean;
  // SF-114: the deal's current referrer (edit only).
  currentReferrer?: CurrentReferrer;
  // SF-115: the custom fields of deals.
  customFields?: FormField[];
  id?: number;
  version?: number;
  cancelHref: string;
  // Where the save returns (SF-95): the deal page or the list; absent: the board.
  back?: "page" | "list";
};

// The main person and "Referred by" (SF-114 research.md §11): on add, picking a main person fills "Referred by" with
// that person's referrer when it is offered (else empties it); the user can change it before saving. Edit never does.
// Inside the form, so it starts again from the posted values after a refusal.
function PersonAndReferrer({ choices, personId, referredBy, prefill, current, error }: {
  choices: DealChoices; personId: string; referredBy: string; prefill: boolean; current: CurrentReferrer; error?: FieldErrors[string];
}) {
  const [referrer, setReferrer] = useState(referredBy);
  const onPerson = (id: number | null) => {
    if (!prefill) return;
    const by = choices.people.find((p) => p.id === id)?.referredById ?? null;
    setReferrer(by === null ? "" : String(by));
  };
  return (
    <>
      <div className="field">
        <span>Person</span>
        <PersonPicker people={choices.people} initialId={personId} onChange={onPerson} />
      </div>
      <div className="field">
        <span>Referred by</span>
        <ReferrerPicker options={choices.ambassadors} current={current} value={referrer} onChange={setReferrer} />
        <FieldError error={error} />
      </div>
    </>
  );
}

function Text({ name, label, value, error, type = "text", placeholder }: { name: string; label: string; value: string; error?: FieldErrors[string]; type?: string; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={type} name={name} defaultValue={value} placeholder={placeholder} aria-invalid={error ? true : undefined} />
      <FieldError error={error} />
    </label>
  );
}

export function DealForm({ action, initial, choices, canSetPrivate, withStage, currentReferrer = null, customFields = [], id, version, cancelHref, back }: Props) {
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
      {back && <input type="hidden" name="back" value={back} />}
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
        <PersonAndReferrer
          choices={choices}
          personId={v.personId}
          referredBy={v.referredBy}
          prefill={withStage}
          current={currentReferrer}
          error={errors.referredBy}
        />
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
      <fieldset className="choices">
        <legend>Labels</legend>
        {choices.labels.length === 0 && <span className="hint">No deal labels yet.</span>}
        {choices.labels.map((l) => (
          <label key={l.id} className="check">
            <input type="checkbox" name="labelIds" value={l.id} defaultChecked={v.labelIds.includes(String(l.id))} /> {l.name}
          </label>
        ))}
      </fieldset>
      {canSetPrivate && (
        <label className="check private">
          <input type="checkbox" name="private" defaultChecked={v.private} /> Private (only its creator and owner can see this deal)
        </label>
      )}
      <CustomInputs fields={customFields} values={v.custom} errors={errors} />
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
