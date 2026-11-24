"use client";
// The add / edit box of a custom field over the Custom fields page (SF-115 design B, like the activity box): name, type
// (add only: the type never changes), the choices textarea for the two choice types, "Show in the <Kind> list". On edit,
// the choice rows (server forms, `children`) sit between the type and the tick: forms cannot nest, so the tick and the
// buttons join the main form through its id. A refusal comes back through useActionState with the values as typed.
import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import { CUSTOM_TYPES, LIST_WORD, MAX_NAME, TYPE_LABELS, isChoiceType, type CustomType, type RecordKind } from "@/server/custom-fields/rules";
import { fieldMessage } from "@/server/messages";
import { FieldError } from "../../records/FieldError";
import type { FieldBoxState, FieldBoxValues } from "./actions";

type Props = {
  action: (prev: FieldBoxState, fd: FormData) => Promise<FieldBoxState>;
  kind: RecordKind;
  tab: string;
  // Edit: the field as stored.
  field?: { id: number; name: string; type: CustomType; inList: boolean };
  back: string;
  children?: ReactNode;
};

export function FieldBox({ action, kind, tab, field, back, children }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const ids = { title: useId(), form: useId(), name: useId() };
  const values: FieldBoxValues = state?.values ?? { name: field?.name ?? "", type: field?.type ?? "text", choices: "", inList: field?.inList ?? false };
  const [type, setType] = useState(values.type);
  const err = state?.errors ?? {};
  const formError = err.form ? fieldMessage(err.form) : undefined;
  const kindWord = kind.toUpperCase();
  return (
    <div className="overlay">
      <div className="lostbox actbox fieldbox" role="dialog" aria-modal="true" aria-labelledby={ids.title}>
        <div className="label">{field ? `EDIT ${kindWord} FIELD` : `ADD ${kindWord} FIELD`}</div>
        <h2 id={ids.title}>{field ? field.name : "New field"}</h2>
        {formError && (
          <p className="err" role="alert">
            {formError}
          </p>
        )}
        <form action={formAction} id={ids.form} key={state?.seq ?? 0}>
          <input type="hidden" name="kind" value={tab} />
          {field && <input type="hidden" name="id" value={field.id} />}
          <label className="field">
            <span>Name</span>
            <input className="input" name="name" maxLength={MAX_NAME + 20} defaultValue={values.name} autoFocus autoComplete="off"
              {...(err.name ? { "aria-invalid": true, "aria-describedby": `${ids.name}-err` } : {})} />
          </label>
          <FieldError error={err.name} id={`${ids.name}-err`} />
          {field ? (
            <div className="field">
              <span>Type</span>
              <p className="typ">{TYPE_LABELS[field.type]} (can&apos;t be changed)</p>
            </div>
          ) : (
            <>
              <label className="field">
                <span>Type</span>
                <select className="input" name="type" value={type} onChange={(e) => setType(e.target.value)}>
                  {CUSTOM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <FieldError error={err.type} />
              {isChoiceType(type as CustomType) && (
                <>
                  <label className="field">
                    <span>Choices, one per line</span>
                    <textarea className="input" name="choices" rows={5} defaultValue={values.choices} />
                  </label>
                  <FieldError error={err.choices} />
                </>
              )}
            </>
          )}
        </form>
        {children}
        <label className="check">
          <input type="checkbox" name="inList" form={ids.form} defaultChecked={values.inList} key={`t${state?.seq ?? 0}`} /> Show in the {LIST_WORD[kind]} list
        </label>
        <FieldError error={err.inList} />
        <div className="form-acts">
          <button className="btn solid" type="submit" form={ids.form} disabled={pending}>
            [ SAVE ]
          </button>
          <Link className="btn" href={back} scroll={false}>
            [ CANCEL ]
          </Link>
        </div>
      </div>
    </div>
  );
}
