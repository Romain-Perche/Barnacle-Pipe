"use client";
// Add / edit a person (research.md §4). Messages show next to their fields and every typed value is kept.
import Link from "next/link";
import { useActionState, useState } from "react";
import { messages } from "@/server/messages";
import { CONSENT_LABELS, CONSENTS, KIND_LABELS, KINDS, type FieldErrors, type PersonForm as Values } from "@/server/records/rules";
import { FieldError } from "./FieldError";
import type { FormState } from "./form-state";
import { OrganisationPicker } from "./OrganisationPicker";
import { ReferrerPicker, type CurrentReferrer } from "./ReferrerPicker";
import type { FormField } from "@/server/custom-fields/values";
import { CustomInputs } from "./CustomInputs";

type Option = { id: number; name: string };
export type PersonChoices = {
  owners: Option[]; leadSources: Option[]; labels: Option[]; organisations: { id: number; name: string; archived: boolean }[];
  // SF-114: the offered ambassadors (the person left out).
  ambassadors: { id: number; name: string; detail: string }[];
};

type Props = {
  action: (prev: FormState<Values>, fd: FormData) => Promise<FormState<Values>>;
  initial: Values;
  choices: PersonChoices;
  canSetPrivate: boolean;
  // SF-114: the person's current referrer; an archived person's tick and referrer are not editable (spec Edge Cases).
  currentReferrer?: CurrentReferrer;
  archived?: boolean;
  // SF-115: the custom fields of people (none shown on an archived person's form).
  customFields?: FormField[];
  id?: number;
  version?: number;
  cancelHref: string;
};

type Row = { key: number; value: string; kind: string };
let nextKey = 1;
const toRows = (rows: { value: string; kind: string }[]): Row[] =>
  (rows.length > 0 ? rows : [{ value: "", kind: "work" }]).map((r) => ({ ...r, key: nextKey++ }));

function Rows({ name, noun, title, initial, errors, type }: { name: "emails" | "phones"; noun: string; title: string; initial: { value: string; kind: string }[]; errors: FieldErrors; type: string }) {
  const [rows, setRows] = useState(() => toRows(initial));
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setRows(next);
  };
  return (
    <fieldset className="rows">
      <legend>{title}</legend>
      {rows.map((r, i) => (
        <div key={r.key} className="row-item">
          <div className="row-line">
            <input
              className="input"
              type={type}
              name={`${name}.${i}.value`}
              aria-label={`${noun[0].toUpperCase() + noun.slice(1)} ${i + 1}`}
              value={r.value}
              onChange={(e) => set(i, { value: e.target.value })}
            />
            <select className="input kind" name={`${name}.${i}.kind`} aria-label={`Kind of ${noun} ${i + 1}`} value={r.kind} onChange={(e) => set(i, { kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <button type="button" className="btn link" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className="btn link" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button type="button" className="btn link red" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              [ REMOVE ]
            </button>
            {i === 0 && rows.length > 1 && <span className="hint">Main</span>}
          </div>
          <FieldError error={errors[`${name}.${i}`]} />
        </div>
      ))}
      <button type="button" className="btn link" onClick={() => setRows([...rows, { key: nextKey++, value: "", kind: "work" }])}>
        [ ADD {noun.toUpperCase()} ]
      </button>
    </fieldset>
  );
}

function Text({ name, label, value, error, type = "text" }: { name: string; label: string; value: string; error?: FieldErrors[string]; type?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={type} name={name} defaultValue={value} aria-invalid={error ? true : undefined} />
      <FieldError error={error} />
    </label>
  );
}

export function PersonForm({ action, initial, choices, canSetPrivate, currentReferrer = null, archived = false, customFields = [], id, version, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;
  const errors = state?.errors ?? {};
  return (
    <form action={formAction} className="recform" key={state?.seq ?? 0} noValidate>
      {errors.form && (
        <p className="err" role="alert">
          {messages[errors.form.code as "edit_conflict"] ?? ""}
        </p>
      )}
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {version !== undefined && <input type="hidden" name="version" value={version} />}
      <div className="grid2">
        <Text name="firstName" label="First name" value={v.firstName} error={errors.name} />
        <Text name="lastName" label="Last name" value={v.lastName} />
        <div className="field">
          <span>Organisation</span>
          <OrganisationPicker organisations={choices.organisations} initialId={v.organisationId} initialNew={v.newOrganisationName} />
          <FieldError error={errors.organisation} />
        </div>
        <Text name="role" label="Role or job title" value={v.role} />
      </div>
      <Rows name="emails" noun="email address" title="Email addresses" type="email" initial={v.emails} errors={errors} />
      <Rows name="phones" noun="phone number" title="Phone numbers" type="tel" initial={v.phones} errors={errors} />
      <div className="grid2">
        <label className="field">
          <span>Lead source</span>
          <select className="input" name="leadSourceId" defaultValue={v.leadSourceId}>
            <option value="">No lead source</option>
            {choices.leadSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {!archived && (
          <div className="field">
            <span>Referred by</span>
            <ReferrerPicker options={choices.ambassadors} current={currentReferrer} initial={v.referredBy} />
            <FieldError error={errors.referredBy} />
          </div>
        )}
        {!archived && (
          <label className="check ambassador">
            <input type="checkbox" name="ambassador" defaultChecked={v.ambassador} /> Ambassador
          </label>
        )}
        <Text name="linkedin" label="LinkedIn profile" value={v.linkedin} error={errors.linkedin} />
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
        <fieldset className="field choices">
          <legend>Email consent</legend>
          {CONSENTS.map((c) => (
            <label key={c} className="check">
              <input type="radio" name="consent" value={c} defaultChecked={v.consent === c} /> {CONSENT_LABELS[c]}
            </label>
          ))}
        </fieldset>
      </div>
      <fieldset className="field choices">
        <legend>Labels</legend>
        {choices.labels.length === 0 && <span className="hint">No labels yet.</span>}
        {choices.labels.map((l) => (
          <label key={l.id} className="check">
            <input type="checkbox" name="labelIds" value={l.id} defaultChecked={v.labelIds.includes(String(l.id))} /> {l.name}
          </label>
        ))}
      </fieldset>
      {canSetPrivate && (
        <label className="check private">
          <input type="checkbox" name="private" defaultChecked={v.private} /> {messages.private_label}
        </label>
      )}
      {!archived && <CustomInputs fields={customFields} values={v.custom} errors={errors} />}
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
